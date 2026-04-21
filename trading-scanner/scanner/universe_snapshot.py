"""Universe snapshot job — 3x-daily full US equity universe pull.

Purpose
-------
Calls UW /api/screener/stocks with adaptive marketcap band-slicing to pull
the full investable universe (>= $1B mcap; Common Stock + ADR + ETF) in
one run, then bulk-upserts into public.universe_snapshots.

Why band-slicing: UW's screener has a hard `limit=500` per call and its
`page` parameter is silently ignored. The only working pagination pattern
is to sort by marketcap desc and use the smallest marketcap from each
response as the exclusive upper bound for the next call.

API budget: ~2,845 tickers / 500 = ~7 API calls per run. At 3 runs/day
weekdays that's ~105 calls/day out of Joe's 20,000/day Basic-monthly cap
(0.5%). Massive headroom.

Contract
--------
    run_universe_snapshot(*, dry_run=False) -> dict
        Fetches + writes (unless dry_run=True). Returns a summary dict:
            {
                "snapshot_ts": "2026-04-21T14:00:00+00:00",
                "api_calls": 7,
                "rows_fetched": 2845,
                "rows_upserted": 2845,
                "issue_type_counts": {"Common Stock": 2156, "ADR": 192, "ETF": 497},
                "duration_seconds": 12.3,
            }

Env
---
    UNUSUAL_WHALES_API_KEY — required
    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — required unless dry_run
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

UW_BASE_URL = "https://api.unusualwhales.com"
SCREENER_PATH = "/api/screener/stocks"

MIN_MARKETCAP = 1_000_000_000  # $1B floor — microcaps excluded per Joe
PAGE_LIMIT = 500                # UW hard cap; higher values silently fall back to 50

# issue_types we WANT to persist. UW's issue_types[] filter is honored
# loosely server-side (Unit/Structured Product rows leak through even with
# a strict filter), so we send the filter for hinting AND enforce it
# client-side when shaping rows.
ISSUE_TYPES = ["Common Stock", "ADR", "ETF"]  # skip Index, Unit, Structured Product, etc.
ISSUE_TYPES_SET = set(ISSUE_TYPES)

# Supplemental allowlist — flagship tickers that the ordered screener
# silently drops but that resolve via per-ticker lookup (ticker_symbol=X).
# Audited 2026-04-21: of ~30 benchmark candidates (SPY, DIA, sector XL*,
# bond ETFs HYG/LQD/TLT, commodity GLD/USO, thematic ARKK/SMH, etc.),
# ONLY SPY resolves this way. Everything else is in UW's dedicated
# /api/etfs/* namespace (different field shape, not schema-compatible).
# Add candidates here if future UW API changes make them reachable.
SUPPLEMENTAL_TICKERS: list[str] = ["SPY"]

MAX_RETRIES = 3
RETRY_BACKOFF = (1.0, 2.0, 4.0)

UPSERT_BATCH_SIZE = 1000  # supabase-py handles this comfortably

# Every typed column on public.universe_snapshots. Any UW field NOT in this
# set lands in raw_extras so we never silently drop data. Keep this in sync
# with migration 009.
KNOWN_FIELDS: set[str] = {
    # identity
    "ticker", "full_name", "sector", "issue_type", "is_index",
    # price / volume (stock)
    "marketcap", "close", "prev_close", "perc_change", "high", "low",
    "stock_volume", "avg30_volume", "relative_volume",
    "week_52_high", "week_52_low",
    # IV / volatility term structure
    "iv30d", "iv30d_1d", "iv30d_1w", "iv30d_1m", "iv_rank",
    "volatility", "volatility_7", "volatility_30",
    "realized_volatility", "variance_risk_premium", "rv_1d_last_12q",
    # implied moves
    "implied_move", "implied_move_perc",
    "implied_move_7", "implied_move_perc_7",
    "implied_move_30", "implied_move_perc_30",
    # options volume
    "call_volume", "put_volume", "put_call_ratio",
    "call_volume_ask_side", "call_volume_bid_side",
    "put_volume_ask_side", "put_volume_bid_side",
    "avg_3_day_call_volume", "avg_3_day_put_volume",
    "avg_7_day_call_volume", "avg_7_day_put_volume",
    "avg_30_day_call_volume", "avg_30_day_put_volume",
    # options premium
    "call_premium", "put_premium",
    "net_call_premium", "net_put_premium",
    "bullish_premium", "bearish_premium",
    # options OI
    "call_open_interest", "put_open_interest", "total_open_interest",
    "avg_30_day_call_oi", "avg_30_day_put_oi",
    # day-over-day
    "prev_call_oi", "prev_put_oi",
    "prev_call_volume", "prev_put_volume",
    # cumulative Greeks
    "cum_dir_delta", "cum_dir_gamma", "cum_dir_vega",
    # GEX
    "gex_net_change", "gex_perc_change", "gex_ratio",
    # calendar
    "next_earnings_date", "er_time", "next_dividend_date",
    # as-of
    "date",  # UW's 'date' field maps to as_of_date column
}

# Bigint columns — cast to int (or None) to avoid numeric→bigint coercion surprises.
BIGINT_FIELDS: set[str] = {
    "stock_volume",
    "call_volume", "put_volume",
    "call_volume_ask_side", "call_volume_bid_side",
    "put_volume_ask_side", "put_volume_bid_side",
    "call_open_interest", "put_open_interest", "total_open_interest",
    "prev_call_oi", "prev_put_oi",
    "prev_call_volume", "prev_put_volume",
}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _headers() -> dict[str, str]:
    key = os.environ.get("UNUSUAL_WHALES_API_KEY")
    if not key:
        raise RuntimeError("UNUSUAL_WHALES_API_KEY not set")
    return {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }


def _fetch_band(
    min_mcap: int,
    max_mcap: int | None,
    issue_types: list[str],
) -> list[dict[str, Any]]:
    """Fetch one marketcap band. Returns up to PAGE_LIMIT rows.

    Uses requests' built-in list-param encoding for issue_types[] so the
    wire request ends up as `issue_types[]=Common Stock&issue_types[]=ADR`.
    """
    params: dict[str, Any] = {
        "min_marketcap": int(min_mcap),
        "limit": PAGE_LIMIT,
        "order": "marketcap",
        "order_direction": "desc",
        "issue_types[]": issue_types,
    }
    if max_mcap is not None:
        params["max_marketcap"] = int(max_mcap)

    url = f"{UW_BASE_URL}{SCREENER_PATH}"
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            r = requests.get(url, headers=_headers(), params=params, timeout=60)
            if r.status_code == 429 and attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning(
                    "UW screener 429 — band [%s, %s] retry %d/%d after %.0fs",
                    min_mcap, max_mcap, attempt + 1, MAX_RETRIES, wait,
                )
                time.sleep(wait)
                continue
            if 500 <= r.status_code < 600 and attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning(
                    "UW screener %d — band [%s, %s] retry %d/%d after %.0fs",
                    r.status_code, min_mcap, max_mcap, attempt + 1, MAX_RETRIES, wait,
                )
                time.sleep(wait)
                continue
            r.raise_for_status()
            body = r.json()
            data = body.get("data", [])
            if not isinstance(data, list):
                logger.error("UW screener returned unexpected shape: %s", type(data))
                return []
            return data
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                logger.warning(
                    "UW screener network error (%s) — retry %d/%d after %.0fs",
                    exc, attempt + 1, MAX_RETRIES, wait,
                )
                time.sleep(wait)
                continue
            break
    if last_exc:
        raise last_exc
    return []


# ---------------------------------------------------------------------------
# Band-slicing aggregator
# ---------------------------------------------------------------------------

def _fetch_universe(issue_types: list[str]) -> tuple[dict[str, dict[str, Any]], int]:
    """Adaptive band-slicing: repeat until fewer than PAGE_LIMIT rows come back.

    Dedupe keyed on ticker — ties at band boundaries won't double-count.
    Returns (ticker_to_row_map, api_call_count).
    """
    universe: dict[str, dict[str, Any]] = {}
    api_calls = 0
    max_mcap: int | None = None
    # Safety cap — we'd never legitimately need more than ~15 bands for a
    # 3k-ticker universe. If we hit this, something's wrong (e.g. boundary
    # not decreasing) and we bail rather than hammer the API.
    MAX_BANDS = 20

    for band_idx in range(MAX_BANDS):
        rows = _fetch_band(MIN_MARKETCAP, max_mcap, issue_types)
        api_calls += 1
        if not rows:
            break

        # Track the smallest marketcap seen in this response. The next
        # band uses this as max_marketcap (no decrement) so that if there
        # are ties AT the boundary, they all appear in the next band too —
        # dedupe by ticker handles the overlap. Decrementing by 1 risks
        # losing tie-boundary rows that didn't make it into this band.
        smallest_mcap: int | None = None
        kept_from_this_band = 0
        for row in rows:
            t = row.get("ticker")
            if not t:
                continue
            # Client-side enforcement: UW's issue_types[] filter is loose
            # server-side (Unit/Structured Product leak through). Drop them
            # here so we never upsert a non-target row.
            if row.get("issue_type") not in ISSUE_TYPES_SET:
                continue
            if t not in universe:
                universe[t] = row
                kept_from_this_band += 1
            mc_raw = row.get("marketcap")
            try:
                mc = int(float(mc_raw)) if mc_raw is not None else None
            except (TypeError, ValueError):
                mc = None
            if mc is not None and (smallest_mcap is None or mc < smallest_mcap):
                smallest_mcap = mc

        logger.info(
            "universe_snapshot band %d: min_mc=%s max_mc=%s returned=%d kept=%d total=%d smallest_mc=%s",
            band_idx, MIN_MARKETCAP, max_mcap, len(rows), kept_from_this_band,
            len(universe), smallest_mcap,
        )

        # Stop conditions:
        #   1. UW returned fewer than a full page — we've reached the bottom.
        #   2. smallest_mcap is below our floor — anything further is filtered out.
        #   3. Boundary didn't strictly decrease — defensive bail to avoid infinite loop.
        if len(rows) < PAGE_LIMIT:
            break
        if smallest_mcap is None or smallest_mcap <= MIN_MARKETCAP:
            break
        next_max = smallest_mcap  # inclusive — next band re-fetches tie boundary, dedupe cleans
        if max_mcap is not None and next_max >= max_mcap:
            logger.error(
                "universe_snapshot band boundary did not decrease (prev_max=%s next_max=%s) — bailing",
                max_mcap, next_max,
            )
            break
        max_mcap = next_max
    else:
        logger.error("universe_snapshot hit MAX_BANDS=%d — returning partial universe", MAX_BANDS)

    return universe, api_calls


# ---------------------------------------------------------------------------
# Supplemental per-ticker recovery
# ---------------------------------------------------------------------------

def _fetch_ticker(ticker: str) -> dict[str, Any] | None:
    """Direct per-ticker fetch via ticker_symbol. Returns matching row or None.

    UW's ticker_symbol param does a fuzzy/prefix match and returns up to
    `limit` rows — we filter for the exact ticker match defensively.
    """
    params = {"ticker_symbol": ticker, "limit": 5}
    url = f"{UW_BASE_URL}{SCREENER_PATH}"
    for attempt in range(MAX_RETRIES + 1):
        try:
            r = requests.get(url, headers=_headers(), params=params, timeout=30)
            if r.status_code == 429 and attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])
                continue
            if 500 <= r.status_code < 600 and attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])
                continue
            r.raise_for_status()
            rows = r.json().get("data", [])
            for row in rows:
                if row.get("ticker") == ticker:
                    return row
            return None
        except requests.RequestException:
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])
                continue
            return None
    return None


def _fetch_supplemental(
    tickers: list[str],
    existing: dict[str, dict[str, Any]],
) -> tuple[int, int]:
    """Fill in flagship tickers missing from the band-slice result.

    Only fetches tickers NOT already in `existing`. Mutates `existing`
    in place. Returns (api_calls_used, rows_added).
    """
    added = 0
    calls = 0
    for t in tickers:
        if t in existing:
            continue
        calls += 1
        row = _fetch_ticker(t)
        if row is None:
            logger.warning("universe_snapshot supplemental: %s did not resolve — skipping", t)
            continue
        if row.get("issue_type") not in ISSUE_TYPES_SET:
            logger.warning(
                "universe_snapshot supplemental: %s has issue_type=%s — skipping",
                t, row.get("issue_type"),
            )
            continue
        existing[t] = row
        added += 1
        logger.info(
            "universe_snapshot supplemental: %s recovered (mc=%s close=%s)",
            t, row.get("marketcap"), row.get("close"),
        )
    return calls, added


# ---------------------------------------------------------------------------
# Row shaping for DB
# ---------------------------------------------------------------------------

def _coerce_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _shape_row(row: dict[str, Any], snapshot_ts_iso: str) -> dict[str, Any]:
    """Convert one UW screener row into a universe_snapshots insert row.

    Unknown fields go into raw_extras jsonb. Bigint columns get numeric
    coercion. Date strings pass through as-is (Postgres parses ISO dates).
    """
    out: dict[str, Any] = {
        "snapshot_ts": snapshot_ts_iso,
    }
    extras: dict[str, Any] = {}

    for k, v in row.items():
        if k == "date":
            out["as_of_date"] = v
            continue
        if k not in KNOWN_FIELDS:
            extras[k] = v
            continue
        if k in BIGINT_FIELDS:
            out[k] = _coerce_int(v)
        else:
            out[k] = v

    if extras:
        out["raw_extras"] = extras

    return out


# ---------------------------------------------------------------------------
# Supabase write
# ---------------------------------------------------------------------------

def _get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
    try:
        from supabase import create_client  # type: ignore
    except ImportError as e:
        raise RuntimeError("supabase-py not installed; add `supabase` to requirements.txt") from e
    return create_client(url, key)


def _upsert_rows(rows: list[dict[str, Any]]) -> int:
    """Bulk upsert into universe_snapshots in batches.

    on_conflict matches the composite PK so a re-run with the same
    snapshot_ts overwrites in place (defensive — shouldn't happen in
    practice since snapshot_ts is generated per-run).
    """
    if not rows:
        return 0
    client = _get_supabase_client()
    total = 0
    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[i : i + UPSERT_BATCH_SIZE]
        client.table("universe_snapshots").upsert(
            batch, on_conflict="ticker,snapshot_ts"
        ).execute()
        total += len(batch)
        logger.info("universe_snapshots upserted batch %d (%d rows, %d total)",
                    i // UPSERT_BATCH_SIZE, len(batch), total)
    return total


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_universe_snapshot(*, dry_run: bool = False) -> dict[str, Any]:
    """Fetch full universe and (unless dry_run) write to public.universe_snapshots.

    All rows in one run share a single snapshot_ts, taken at run start.
    """
    start = time.monotonic()
    snapshot_ts = datetime.now(timezone.utc)
    snapshot_ts_iso = snapshot_ts.isoformat()
    logger.info("universe_snapshot run start ts=%s dry_run=%s", snapshot_ts_iso, dry_run)

    universe, api_calls = _fetch_universe(ISSUE_TYPES)

    # Option B: supplement with flagship tickers the ordered screener drops
    supp_calls, supp_added = _fetch_supplemental(SUPPLEMENTAL_TICKERS, universe)
    api_calls += supp_calls
    if supp_added:
        logger.info(
            "universe_snapshot supplemental recovered %d ticker(s) via %d direct call(s)",
            supp_added, supp_calls,
        )

    rows = [_shape_row(r, snapshot_ts_iso) for r in universe.values()]

    # Count by issue_type for the summary
    issue_type_counts: dict[str, int] = {}
    for r in universe.values():
        it = r.get("issue_type") or "Unknown"
        issue_type_counts[it] = issue_type_counts.get(it, 0) + 1

    upserted = 0
    if not dry_run:
        upserted = _upsert_rows(rows)
    else:
        logger.info("universe_snapshot DRY RUN — skipping DB write (%d rows prepared)", len(rows))

    duration = time.monotonic() - start
    summary = {
        "snapshot_ts": snapshot_ts_iso,
        "api_calls": api_calls,
        "rows_fetched": len(rows),
        "rows_upserted": upserted,
        "issue_type_counts": issue_type_counts,
        "supplemental_added": supp_added,
        "duration_seconds": round(duration, 2),
        "dry_run": dry_run,
    }
    logger.info("universe_snapshot run complete: %s", summary)
    return summary
