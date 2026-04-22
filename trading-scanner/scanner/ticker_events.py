"""ticker_events — 3x-weekday per-ticker event ingestion.

Fills the gap between universe_snapshot (prices/options flow/IV) and the
daily scanner (technicals/analyst/composite): news, insider trades,
congressional trades, and dark pool prints now refresh on the same
3x/weekday cadence as prices.

Architecture
------------
Firehose-then-filter, with filters chosen per source by PURPOSE:
  - news     → tracked set (positions ∪ watchlist) — personal awareness
  - insider  → NO filter (market-wide) — discovery: insider buys surface
               alpha at small caps not otherwise on the radar. Applies
               Form 4 P/S code filter + excludes Rule 10b5-1 automatic
               plans (same business rules as the daily scanner).
  - congress → NO filter (market-wide) — political info-edge discovery
  - darkpool → universe filter ($1B+ mcap) — volume-bounded discovery

Per-source lookback windows (mirror config.py used by the daily scanner):
  - news:     6h      (real-time)
  - darkpool: 24h     (intraday market data)
  - insider:  14 days (Form 4 disclosure lag + buffer)
  - congress: 45 days (congressional disclosure lag)

Insider and congress pass `date_from` to UW so the server filters before
we download — saves bandwidth and keeps us inside the per-minute ceiling.

Rate budget per run (estimated)
-------------------------------
    news firehose      : ~5 calls
    congress firehose  : ~1 call  (date_from = 45d, low volume)
    darkpool firehose  : ~10 calls
    insider firehose   : ~3 calls (date_from = 14d)
    ----------------------------------------------------------
    total              : ~20 calls / run × 3 runs/day = ~60/day
    UW Basic ceiling   : 20,000/day → <1% of budget

Deduplication
-------------
UW firehoses re-surface events across multiple polls — a dark pool
print from 10:15 AM will appear in 10:00, 13:00, AND 15:45 feeds. We
compute a stable dedup_key per source (see _dedup_key_for_*) and rely
on the UNIQUE (source, dedup_key) constraint to swallow duplicates.

Environment
-----------
    UNUSUAL_WHALES_API_KEY         — required
    SUPABASE_URL                   — required unless dry_run
    SUPABASE_SERVICE_ROLE_KEY      — required unless dry_run

Entry point
-----------
    run_ticker_events(*, dry_run=False) -> dict
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from .uw_usage_logger import UWUsageLogger

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# UW endpoint paths
# ---------------------------------------------------------------------------
# NOTE (2026-04-21): paths below match UW's current public API surface.
# The scanner fails loudly on 404 — if UW renames an endpoint we see it
# on the first run and fix here. Do NOT silently skip a 404.

ENDPOINT_NEWS      = "/api/news/headlines"
ENDPOINT_CONGRESS  = "/api/congress/recent-trades"
ENDPOINT_DARKPOOL  = "/api/darkpool/recent"
ENDPOINT_INSIDER   = "/api/insider/transactions"

# Page size caps. UW enforces `limit < 200` on every paginated endpoint
# tested — requesting 500 returns 422 "Invalid limit". News caps at 100
# server-side, so 100 is our uniform page size.
PAGE_LIMIT_NEWS      = 100
PAGE_LIMIT_CONGRESS  = 100
PAGE_LIMIT_DARKPOOL  = 100
PAGE_LIMIT_INSIDER   = 100

# Per-source lookback windows. Different from each other because disclosure
# lag and signal cadence differ (mirrors the values in config.py used by
# the daily scanner).
#   news      — real-time; 6h covers the 3h cadence with 2x safety margin
#   darkpool  — intraday market data; 24h catches prints from the prior run
#   insider   — SEC Form 4 filings lag transactions by up to 2 business days;
#               14 days is the standard lookback for "recent insider buys"
#   congress  — congressional disclosures can lag trades by up to 45 days
LOOKBACK_HOURS_NEWS      = 6
LOOKBACK_HOURS_DARKPOOL  = 24
LOOKBACK_DAYS_INSIDER    = 14
LOOKBACK_DAYS_CONGRESS   = 45

MAX_NEWS_PAGES        = 5
MAX_CONGRESS_PAGES    = 5   # 45d window can have more pages than 6h used to
MAX_DARKPOOL_PAGES    = 10  # dark pool prints are high-volume; allow more pagination
MAX_INSIDER_PAGES     = 10  # 14d window means more pages than the old 6h

UPSERT_BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# Universe + tracked ticker resolution
# ---------------------------------------------------------------------------

def _get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
    from supabase import create_client  # type: ignore
    return create_client(url, key)


def _load_universe_tickers(client) -> set[str]:
    """Pull the universe ticker set from the latest universe_snapshots run.

    Used to client-side filter firehose responses. If universe_snapshots
    is empty (e.g. local dev before first run), returns an empty set —
    events still get ingested, they just don't get universe-filtered.
    """
    # Latest snapshot_ts
    latest = (
        client.table("universe_snapshots")
        .select("snapshot_ts")
        .order("snapshot_ts", desc=True)
        .limit(1)
        .execute()
    )
    if not latest.data:
        logger.warning("ticker_events: universe_snapshots empty — skipping universe filter")
        return set()
    ts = latest.data[0]["snapshot_ts"]

    # All tickers at that ts, paginated (1000-row PostgREST cap)
    tickers: set[str] = set()
    page = 0
    while page < 10:  # 10k ceiling is plenty for our 1,700-ticker universe
        start = page * 1000
        end = start + 999
        resp = (
            client.table("universe_snapshots")
            .select("ticker")
            .eq("snapshot_ts", ts)
            .range(start, end)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break
        for r in rows:
            if r.get("ticker"):
                tickers.add(r["ticker"].upper())
        if len(rows) < 1000:
            break
        page += 1

    logger.info("ticker_events: loaded universe filter — %d tickers at %s", len(tickers), ts)
    return tickers


def _load_tracked_tickers(client) -> set[str]:
    """Union of all users' positions ∪ watchlist tickers.

    Used to scope per-ticker insider fetches. Kept small on purpose (~50
    tickers today) so we don't blow the per-minute rate limit.
    """
    tracked: set[str] = set()

    # Positions
    try:
        pos = client.table("positions").select("ticker").execute()
        for r in (pos.data or []):
            if r.get("ticker"):
                tracked.add(r["ticker"].upper())
    except Exception as exc:
        logger.warning("ticker_events: positions lookup failed: %s", exc)

    # Watchlist
    try:
        wl = client.table("watchlist").select("ticker").execute()
        for r in (wl.data or []):
            if r.get("ticker"):
                tracked.add(r["ticker"].upper())
    except Exception as exc:
        logger.warning("ticker_events: watchlist lookup failed: %s", exc)

    logger.info("ticker_events: loaded tracked set — %d tickers (positions ∪ watchlist)", len(tracked))
    return tracked


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stable_hash(*parts: Any) -> str:
    """Stable SHA1 hash of the string-joined parts — for dedup_key generation."""
    joined = "|".join("" if p is None else str(p) for p in parts)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()


def _parse_ts(value: Any) -> str | None:
    """Coerce UW timestamp into ISO 8601 UTC string, or None if unparseable."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # epoch seconds or millis — distinguish by magnitude
        v = float(value)
        if v > 1e11:  # treat as millis
            v /= 1000.0
        return datetime.fromtimestamp(v, tz=timezone.utc).isoformat()
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        # Try a few formats UW uses
        for fmt in (
            "%Y-%m-%dT%H:%M:%S.%fZ",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                dt = datetime.strptime(s, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.isoformat()
            except ValueError:
                continue
        # Last-ditch: try Python 3.11+ fromisoformat (handles most ISO variants)
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            return None
    return None


def _within_lookback_seconds(event_ts_iso: str | None, seconds: float) -> bool:
    """Client-side safety net for time-window filters.

    Used when UW either doesn't accept date_from or we want a tighter window
    than the server filter. Pass the per-source lookback in seconds.
    """
    if not event_ts_iso:
        return False
    try:
        dt = datetime.fromisoformat(event_ts_iso)
    except ValueError:
        return False
    cutoff = datetime.now(timezone.utc).timestamp() - seconds
    return dt.timestamp() >= cutoff


def _iso_date_days_ago(days: int) -> str:
    """Return YYYY-MM-DD for (today - days) — the format UW's date_from wants."""
    return (date.today() - timedelta(days=days)).isoformat()


# ---------------------------------------------------------------------------
# Insider business-rule filter (mirrors scanner/unusual_whales.py)
# ---------------------------------------------------------------------------

_INSIDER_CODE_BUY  = "P"   # SEC Form 4 code P: open-market purchase
_INSIDER_CODE_SELL = "S"   # SEC Form 4 code S: open-market sale


def _is_10b5_1_plan(row: dict[str, Any]) -> bool:
    """Rule 10b5-1 automatic-plan transactions have no informational value."""
    v = row.get("is_10b5_1")
    if v is True:
        return True
    if isinstance(v, str) and v.strip().lower() in ("true", "1", "yes"):
        return True
    return False


def _insider_passes_business_rules(item: dict[str, Any]) -> bool:
    """Open-market P or S codes only; exclude 10b5-1 automatic plans.

    Matches the filter in scanner/unusual_whales.py so ticker_events insider
    rows stay consistent with what the daily scanner surfaces today.
    """
    code = str(item.get("transaction_code") or item.get("transaction_type") or "").strip().upper()
    if code not in (_INSIDER_CODE_BUY, _INSIDER_CODE_SELL):
        return False
    if _is_10b5_1_plan(item):
        return False
    return True


# ---------------------------------------------------------------------------
# Source: news
# ---------------------------------------------------------------------------

def ingest_news(usage: UWUsageLogger, tracked: set[str], run_id: uuid.UUID) -> list[dict[str, Any]]:
    """Pull UW /api/news/headlines firehose, filter to tracked set.

    News is the personal-awareness source: "what's happening to stocks I
    own or watch". Filter to `tracked` = union of all users' positions +
    watchlist. UW returns headlines with a `tickers: [...]` array — we
    emit one row per (headline, tracked-ticker) pair. Headlines untagged
    to any tracked ticker are dropped.
    """
    rows: list[dict[str, Any]] = []
    lookback_sec = LOOKBACK_HOURS_NEWS * 3600
    page = 0
    while page < MAX_NEWS_PAGES:
        resp = usage.get(ENDPOINT_NEWS, params={"limit": PAGE_LIMIT_NEWS, "page": page})
        if not resp.ok:
            logger.warning("ticker_events news: %s on page %d — stopping pagination", resp.status_code, page)
            break
        body = resp.json()
        items = body.get("data") if isinstance(body, dict) else body
        if not items:
            break
        for item in items:
            event_ts = _parse_ts(item.get("created_at") or item.get("published_at") or item.get("date"))
            if not _within_lookback_seconds(event_ts, lookback_sec):
                continue
            tickers = item.get("tickers") or item.get("symbols") or []
            if isinstance(tickers, str):
                tickers = [tickers]
            headline = item.get("headline") or item.get("title") or ""
            url = item.get("url") or item.get("link") or ""
            for t in tickers:
                T = str(t).upper()
                if tracked and T not in tracked:
                    continue
                dedup = _stable_hash("news", T, event_ts, headline[:200], url)
                rows.append({
                    "ticker":      T,
                    "source":      "news",
                    "event_ts":    event_ts,
                    "run_id":      str(run_id),
                    "dedup_key":   dedup,
                    "payload": {
                        "headline":  headline,
                        "url":       url,
                        "source":    item.get("source"),
                        "sentiment": item.get("sentiment"),
                        "summary":   item.get("description") or item.get("summary"),
                    },
                })
        if len(items) < PAGE_LIMIT_NEWS:
            break
        page += 1

    logger.info("ticker_events news: %d rows emitted (tracked set = %d tickers)", len(rows), len(tracked))
    return rows


# ---------------------------------------------------------------------------
# Source: congress
# ---------------------------------------------------------------------------

def ingest_congress(usage: UWUsageLogger, run_id: uuid.UUID) -> list[dict[str, Any]]:
    """Pull UW /api/congress/recent-trades firehose — market-wide, no filter.

    Congressional trades are a DISCOVERY signal: political info-edge, not a
    personal-awareness feed. Filtering to a user's tracked set or the $1B+
    universe defeats the point. Surface everything that UW returns inside
    the 45-day disclosure-lag window.
    """
    rows: list[dict[str, Any]] = []
    lookback_sec = LOOKBACK_DAYS_CONGRESS * 86400
    date_from = _iso_date_days_ago(LOOKBACK_DAYS_CONGRESS)
    page = 0
    while page < MAX_CONGRESS_PAGES:
        resp = usage.get(
            ENDPOINT_CONGRESS,
            params={"limit": PAGE_LIMIT_CONGRESS, "page": page, "date_from": date_from},
        )
        if not resp.ok:
            logger.warning("ticker_events congress: %s on page %d — stopping", resp.status_code, page)
            break
        body = resp.json()
        items = body.get("data") if isinstance(body, dict) else body
        if not items:
            break
        for item in items:
            T = str(item.get("ticker") or "").upper()
            if not T:
                continue
            event_ts = _parse_ts(item.get("transaction_date") or item.get("date"))
            if not _within_lookback_seconds(event_ts, lookback_sec):
                continue
            dedup = _stable_hash(
                "congress",
                T,
                event_ts,
                item.get("representative"),
                item.get("transaction_type"),
                item.get("amount") or item.get("amount_range"),
            )
            rows.append({
                "ticker":    T,
                "source":    "congress",
                "event_ts":  event_ts,
                "run_id":    str(run_id),
                "dedup_key": dedup,
                "payload": {
                    "representative":    item.get("representative"),
                    "chamber":           item.get("chamber"),
                    "party":             item.get("party"),
                    "transaction_type":  item.get("transaction_type"),
                    "amount":            item.get("amount"),
                    "amount_range":      item.get("amount_range"),
                    "reported_date":     item.get("reported_date"),
                    "transaction_date":  item.get("transaction_date"),
                },
            })
        if len(items) < PAGE_LIMIT_CONGRESS:
            break
        page += 1

    logger.info("ticker_events congress: %d rows emitted (market-wide, date_from=%s)", len(rows), date_from)
    return rows


# ---------------------------------------------------------------------------
# Source: dark pool
# ---------------------------------------------------------------------------

def ingest_darkpool(usage: UWUsageLogger, universe: set[str], run_id: uuid.UUID) -> list[dict[str, Any]]:
    """Pull UW /api/darkpool/recent firehose, filter to $1B+ universe.

    Dark pool is a DISCOVERY signal ("institution taking a position"), but
    the firehose volume is otherwise unmanageable (hundreds of prints per
    minute). The $1B+ universe filter is a volume ceiling, not a
    personal-awareness filter — it's the smallest cut that keeps the
    pipeline inside rate limits while still covering the tickers where
    a dark pool print is actually institutional-scale.
    """
    rows: list[dict[str, Any]] = []
    lookback_sec = LOOKBACK_HOURS_DARKPOOL * 3600
    page = 0
    while page < MAX_DARKPOOL_PAGES:
        resp = usage.get(ENDPOINT_DARKPOOL, params={"limit": PAGE_LIMIT_DARKPOOL, "page": page})
        if not resp.ok:
            logger.warning("ticker_events darkpool: %s on page %d — stopping", resp.status_code, page)
            break
        body = resp.json()
        items = body.get("data") if isinstance(body, dict) else body
        if not items:
            break
        for item in items:
            T = str(item.get("ticker") or item.get("symbol") or "").upper()
            if not T:
                continue
            if universe and T not in universe:
                continue
            event_ts = _parse_ts(
                item.get("executed_at")
                or item.get("timestamp")
                or item.get("trade_time")
                or item.get("date")
            )
            if not _within_lookback_seconds(event_ts, lookback_sec):
                continue
            size = item.get("size") or item.get("volume")
            price = item.get("price")
            dedup = _stable_hash("darkpool", T, event_ts, size, price, item.get("exchange"))
            rows.append({
                "ticker":    T,
                "source":    "darkpool",
                "event_ts":  event_ts,
                "run_id":    str(run_id),
                "dedup_key": dedup,
                "payload": {
                    "price":       price,
                    "size":        size,
                    "premium":     item.get("premium") or item.get("notional"),
                    "exchange":    item.get("exchange"),
                    "conditions":  item.get("conditions"),
                    "executed_at": item.get("executed_at"),
                },
            })
        if len(items) < PAGE_LIMIT_DARKPOOL:
            break
        page += 1

    logger.info("ticker_events darkpool: %d rows emitted (universe-filtered)", len(rows))
    return rows


# ---------------------------------------------------------------------------
# Source: insider (market-wide firehose, filter to universe)
# ---------------------------------------------------------------------------

def ingest_insider(usage: UWUsageLogger, run_id: uuid.UUID) -> list[dict[str, Any]]:
    """Pull UW /api/insider/transactions firehose — market-wide, no filter.

    Insider is the HIGHEST-alpha discovery signal in this pipeline. Insider
    activity concentrates at small caps (below the $1B universe cut) where
    the signal is strongest — ONCO, BMNR, SEV, etc. Filtering to the $1B+
    universe, let alone a user's tracked set, would kill the whole point of
    the scan. Stay market-wide; the UI layer can narrow for the personal
    view but the ingestion layer surfaces everything.

    Business rules (mirrors scanner/unusual_whales.py so ticker_events
    insider rows stay consistent with the daily scanner):
      - Form 4 code P (open-market purchase) or S (open-market sale) only
      - Exclude Rule 10b5-1 automatic-plan transactions (no informational value)

    Server-side `date_from` caps the 14-day window so we're not paginating
    through months of history on every run.
    """
    rows: list[dict[str, Any]] = []
    lookback_sec = LOOKBACK_DAYS_INSIDER * 86400
    date_from = _iso_date_days_ago(LOOKBACK_DAYS_INSIDER)
    page = 0
    dropped_rules = 0
    while page < MAX_INSIDER_PAGES:
        resp = usage.get(
            ENDPOINT_INSIDER,
            params={"limit": PAGE_LIMIT_INSIDER, "page": page, "date_from": date_from},
        )
        if not resp.ok:
            logger.warning("ticker_events insider: %s on page %d — stopping", resp.status_code, page)
            break
        body = resp.json()
        items = body.get("data") if isinstance(body, dict) else body
        if not items:
            break
        for item in items:
            T = str(item.get("ticker") or item.get("symbol") or "").upper()
            if not T:
                continue
            if not _insider_passes_business_rules(item):
                dropped_rules += 1
                continue
            event_ts = _parse_ts(
                item.get("filing_date")
                or item.get("transaction_date")
                or item.get("date")
            )
            if not _within_lookback_seconds(event_ts, lookback_sec):
                continue
            dedup = _stable_hash(
                "insider",
                T,
                event_ts,
                item.get("owner_name") or item.get("insider_name") or item.get("name"),
                item.get("transaction_type") or item.get("transaction_code"),
                item.get("amount") or item.get("shares"),
                item.get("price"),
            )
            rows.append({
                "ticker":    T,
                "source":    "insider",
                "event_ts":  event_ts,
                "run_id":    str(run_id),
                "dedup_key": dedup,
                "payload": {
                    "owner_name":       item.get("owner_name") or item.get("insider_name") or item.get("name"),
                    "title":            item.get("title") or item.get("relationship"),
                    "is_director":      item.get("is_director"),
                    "is_officer":       item.get("is_officer"),
                    "is_ten_percent":   item.get("is_ten_percent_owner") or item.get("is_ten_percent"),
                    "transaction_code": item.get("transaction_code") or item.get("transaction_type"),
                    "transaction_type": item.get("transaction_type") or item.get("transaction_code"),
                    "amount":           item.get("amount") or item.get("shares"),
                    "transactions":     item.get("transactions"),
                    "price":            item.get("price"),
                    "value":            item.get("value") or item.get("total_value"),
                    "filing_date":      item.get("filing_date"),
                    "transaction_date": item.get("transaction_date"),
                    "is_10b5_1":        item.get("is_10b5_1"),
                },
            })
        if len(items) < PAGE_LIMIT_INSIDER:
            break
        page += 1

    logger.info(
        "ticker_events insider: %d rows emitted across %d pages "
        "(market-wide, date_from=%s, dropped %d by business rules)",
        len(rows), page + 1, date_from, dropped_rules,
    )
    return rows


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def _upsert_events(rows: list[dict[str, Any]]) -> int:
    """Batch-insert ticker_events rows. ON CONFLICT via (source, dedup_key)
    swallows duplicates from overlapping runs.

    Pre-dedups rows in memory before hitting Postgres — two rows with the
    same (source, dedup_key) inside a single batch trigger error 21000
    "ON CONFLICT DO UPDATE command cannot affect row a second time".
    In-batch dupes do happen at volume (UW darkpool prints can share
    ticker/timestamp/size/price/exchange across split fills; news pages
    sometimes overlap). Last-write-wins — rows with identical dedup_key
    are by definition the same event, so picking one is safe.
    """
    if not rows:
        return 0

    unique: dict[tuple[str | None, str | None], dict[str, Any]] = {}
    for r in rows:
        unique[(r.get("source"), r.get("dedup_key"))] = r
    deduped = list(unique.values())
    dropped = len(rows) - len(deduped)
    if dropped > 0:
        logger.info("ticker_events: in-batch dedup dropped %d duplicate rows (%d → %d)",
                    dropped, len(rows), len(deduped))

    client = _get_supabase_client()
    total = 0
    for i in range(0, len(deduped), UPSERT_BATCH_SIZE):
        batch = deduped[i : i + UPSERT_BATCH_SIZE]
        client.table("ticker_events").upsert(
            batch, on_conflict="source,dedup_key"
        ).execute()
        total += len(batch)
        logger.info("ticker_events upserted batch %d (%d rows, %d total)",
                    i // UPSERT_BATCH_SIZE, len(batch), total)
    return total


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_ticker_events(*, dry_run: bool = False) -> dict[str, Any]:
    """Main orchestrator — pulls all four sources, upserts to ticker_events.

    Returns a summary dict with per-source counts, API call totals, and
    final rate-limit headroom.
    """
    start = time.monotonic()
    run_id = uuid.uuid4()

    client = _get_supabase_client()
    universe = _load_universe_tickers(client)  # for darkpool only
    tracked  = _load_tracked_tickers(client)   # for news only

    all_rows: list[dict[str, Any]] = []
    per_source_counts: dict[str, int] = {}

    # Filter-by-purpose: each source gets the filter its signal type requires.
    #   news     → tracked     (personal awareness)
    #   insider  → (none)      (market-wide discovery — small-cap alpha lives here)
    #   congress → (none)      (market-wide discovery — political info-edge)
    #   darkpool → universe    (universe is a volume ceiling, not a relevance filter)
    with UWUsageLogger(source="ticker_events", run_id=run_id, flush_to_db=not dry_run) as usage:
        sources = [
            ("news",     lambda: ingest_news(usage, tracked, run_id)),
            ("insider",  lambda: ingest_insider(usage, run_id)),
            ("congress", lambda: ingest_congress(usage, run_id)),
            ("darkpool", lambda: ingest_darkpool(usage, universe, run_id)),
        ]
        for name, fn in sources:
            try:
                src_rows = fn()
                per_source_counts[name] = len(src_rows)
                all_rows.extend(src_rows)
            except Exception as exc:
                logger.exception("ticker_events: %s source failed: %s", name, exc)
                per_source_counts[name] = 0
                usage.status = "partial"

        upserted = 0
        if not dry_run and all_rows:
            upserted = _upsert_events(all_rows)
        elif dry_run:
            logger.info("ticker_events DRY RUN — skipping DB write (%d rows prepared)", len(all_rows))

    duration = time.monotonic() - start
    summary = {
        "run_id":              str(run_id),
        "per_source_counts":   per_source_counts,
        "total_rows":          len(all_rows),
        "rows_upserted":       upserted if not dry_run else 0,
        "api_calls":           len(usage.calls),
        "remaining_daily":     usage.last_remaining,
        "peak_rpm":            usage._peak_rpm(),
        "universe_size":       len(universe),
        "tracked_size":        len(tracked),
        "duration_seconds":    round(duration, 2),
        "status":              usage.status,
        "dry_run":             dry_run,
    }
    logger.info("ticker_events run complete: %s", summary)
    return summary
