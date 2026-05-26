"""
Dark-pool ingest — UW per-ticker dark-pool feed -> public.darkpool_prints.

Part of Phase 1 of the Trading Opportunities overhaul
(TRADING_OPPS_OVERHAUL_PLAN_2026-05-20.md). Feeds the rebuilt screener's
dark-pool layer (locked spec Section 6): the last ~48h of large
off-exchange block prints per name, from which the engine derives the
institutional clustering band that anchors entry / stop levels.

How it works
────────────
For every name in the screener universe, pull the most recent dark-pool
prints for the last few calendar days from UW's per-ticker endpoint
(GET /api/darkpool/{ticker}?date=...). The bulk /api/darkpool/recent feed
is unusable for a 48h window — 200 prints span only ~10 seconds of tape —
so the pull is per-ticker.

The table is a rolling window, not an append-forever log:
  * Every print is UPSERTed on its unique tracking_id (idempotent — a
    re-run, or the same print returned by two adjacent day-queries, is a
    no-op).
  * After the pull, prints older than RETENTION_DAYS are deleted, so the
    table always holds ~4 calendar days (covers a 48h trading window plus
    a weekend buffer) and never grows without bound.

Because the table persists between runs, a normal nightly run only needs
the last few days — older prints are already stored. A cold start (empty
table) seeds whatever the day-queries return.

Service-only table (Pattern C). No front-end tile reads darkpool_prints
directly; the Phase 2 screener engine reads it.

Resume-friendly via --max-seconds. Idempotent. CLI flags mirror the other
trading-scanner ingest jobs.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
import uuid
from scanner.api_usage_helper import log_run_summary

from scanner.trading_opps.universe import build_screener_candidate_universe


UW_BASE = "https://api.unusualwhales.com/api"
TABLE = "darkpool_prints"

# Rolling-window retention. The screener's clustering math uses a 48h
# window; 4 calendar days keeps that fully covered across a weekend.
RETENTION_DAYS = 4

# How many calendar days back to query each run. 3 (today, -1, -2) keeps a
# steady-state nightly run cheap while still giving 48h+ of trading prints
# on any weekday. The table accumulates across runs, so this is overlap /
# dropped-run insurance, not the only source of history.
DEFAULT_DAYS_BACK = 3

# UW per-ticker page size. 500 is the endpoint max.
PAGE_LIMIT = 500

# Polite spacing between UW calls (the v5 screener fallback path proved
# ~0.3s avoids 429 cascades).
SLEEP_PER_CALL = 0.30

# Columns on public.darkpool_prints we populate, in UW-key -> column form.
# day_volume is UW's `volume` (cumulative session volume in the underlying).
_NUMERIC_KEYS = ("price", "premium", "nbbo_bid", "nbbo_ask")
_BIGINT_KEYS = ("size", "day_volume")
_INT_KEYS = ("nbbo_bid_quantity", "nbbo_ask_quantity")
_TEXT_KEYS = ("sale_cond_codes", "ext_hour_sold_codes", "market_center",
              "trade_code", "trade_settlement")


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def _uw_headers() -> dict[str, str]:
    key = os.environ.get("UNUSUAL_WHALES_API_KEY", "")
    if not key:
        raise RuntimeError("UNUSUAL_WHALES_API_KEY is not set")
    return {
        "Authorization": f"Bearer {key}",
        "UW-CLIENT-API-ID": os.environ.get("UW_CLIENT_API_ID", "100001"),
        "Accept": "application/json",
    }


def _supa_url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _supa_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _uw_get(path: str, params: dict[str, Any], retries: int = 3) -> list[dict[str, Any]]:
    """GET a UW endpoint, returning the `data` list. Retries 429 with backoff."""
    url = f"{UW_BASE}{path}"
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=_uw_headers(), params=params, timeout=30)
        except requests.RequestException:
            if attempt < retries:
                time.sleep(1.5 ** attempt)
                continue
            return []
        if r.status_code == 429 and attempt < retries:
            time.sleep(2.0 ** attempt)
            continue
        if r.status_code != 200:
            return []
        body = r.json() or {}
        data = body.get("data")
        return data if isinstance(data, list) else []
    return []


# ── value coercion ───────────────────────────────────────────────────────────

def _as_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _as_int(v: Any) -> int | None:
    f = _as_float(v)
    return int(f) if f is not None else None


def _normalize_print(row: dict[str, Any]) -> dict[str, Any] | None:
    """Map one UW dark-pool print to a darkpool_prints row. None if unusable."""
    if not isinstance(row, dict):
        return None
    tracking_id = _as_int(row.get("tracking_id"))
    ticker = (row.get("ticker") or "").strip().upper()
    executed_at = row.get("executed_at")
    # tracking_id is the primary key; ticker + executed_at are NOT NULL.
    if tracking_id is None or not ticker or not executed_at:
        return None

    out: dict[str, Any] = {
        "tracking_id": tracking_id,
        "ticker": ticker,
        "executed_at": executed_at,
        "trf_executed_at": row.get("trf_executed_at"),
        "canceled": bool(row.get("canceled")),
    }
    for k in _NUMERIC_KEYS:
        out[k] = _as_float(row.get(k))
    # UW key `volume` is the underlying's cumulative session volume.
    out["size"] = _as_int(row.get("size"))
    out["day_volume"] = _as_int(row.get("volume"))
    for k in _INT_KEYS:
        out[k] = _as_int(row.get(k))
    for k in _TEXT_KEYS:
        v = row.get(k)
        out[k] = str(v) if v is not None else None
    return out


# ── Supabase writes ──────────────────────────────────────────────────────────

def upsert_prints(rows: list[dict[str, Any]], batch_size: int = 500) -> int:
    """Idempotent UPSERT on tracking_id. Dedupes within the call first."""
    if not rows:
        return 0
    seen: set[int] = set()
    deduped: list[dict[str, Any]] = []
    for r in rows:
        tid = r["tracking_id"]
        if tid in seen:
            continue
        seen.add(tid)
        deduped.append(r)

    url = f"{_supa_url()}/rest/v1/{TABLE}?on_conflict=tracking_id"
    total = 0
    for i in range(0, len(deduped), batch_size):
        batch = deduped[i:i + batch_size]
        r = requests.post(url, headers=_supa_headers(), json=batch, timeout=45)
        if r.status_code >= 400:
            raise RuntimeError(f"darkpool UPSERT failed: HTTP {r.status_code} {r.text[:200]}")
        total += len(batch)
    return total


def prune_old_prints(retention_days: int = RETENTION_DAYS) -> int:
    """Delete prints older than the retention window. Returns rows deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    # 'Z' suffix, not '+00:00' — a literal '+' in a URL query decodes to a
    # space. Passing the filter via requests `params` also keeps it encoded.
    cutoff_iso = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    url = f"{_supa_url()}/rest/v1/{TABLE}"
    headers = {**_supa_headers(), "Prefer": "count=exact,return=minimal"}
    r = requests.delete(url, headers=headers,
                        params={"executed_at": f"lt.{cutoff_iso}"}, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"darkpool prune failed: HTTP {r.status_code} {r.text[:200]}")
    # content-range header carries the deleted count (e.g. "*/10").
    cr = r.headers.get("content-range", "")
    if "/" in cr:
        try:
            return int(cr.split("/")[-1])
        except ValueError:
            pass
    return 0


def _log_pipeline_fetch(indicator_id: str, status: str, meta: dict[str, Any]) -> None:
    """Best-effort freshness-log row in pipeline_fetch_log. Never raises."""
    url, key = _supa_url(), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return
    try:
        requests.post(
            f"{url}/rest/v1/pipeline_fetch_log",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={"indicator_id": indicator_id, "status": status,
                  "run_kind": "aggregate", "source": "unusual_whales", "meta": meta},
            timeout=10,
        )
    except Exception:
        pass


# ── Driver ───────────────────────────────────────────────────────────────────

def fetch_ticker_prints(ticker: str, days: list[str]) -> list[dict[str, Any]]:
    """Pull and normalize dark-pool prints for one ticker across the given days."""
    out: list[dict[str, Any]] = []
    for d in days:
        raw = _uw_get(f"/darkpool/{ticker.strip().upper()}",
                      {"date": d, "limit": PAGE_LIMIT})
        for row in raw:
            norm = _normalize_print(row)
            if norm:
                out.append(norm)
        time.sleep(SLEEP_PER_CALL)
    return out


def pull_and_upsert(tickers: list[str],
                    as_of: date | None = None,
                    days_back: int = DEFAULT_DAYS_BACK,
                    max_seconds: float = 3000.0) -> dict[str, Any]:
    as_of = as_of or date.today()
    days = [(as_of - timedelta(days=i)).isoformat() for i in range(days_back)]
    t0 = time.time()

    tickers_done = 0
    tickers_with_prints = 0
    prints_upserted = 0
    pending: list[dict[str, Any]] = []

    for sym in tickers:
        if time.time() - t0 > max_seconds:
            break
        try:
            rows = fetch_ticker_prints(sym, days)
        except Exception:
            rows = []
        if rows:
            pending.extend(rows)
            tickers_with_prints += 1
        tickers_done += 1
        # Flush periodically so a mid-run timeout still persists work.
        if len(pending) >= 2000:
            prints_upserted += upsert_prints(pending)
            pending = []

    if pending:
        prints_upserted += upsert_prints(pending)

    pruned = 0
    # Only prune once the full universe was processed — a partial run must
    # not delete days it hasn't refreshed yet.
    full_run = tickers_done >= len(tickers)
    if full_run:
        try:
            pruned = prune_old_prints()
        except Exception:
            pruned = -1

    result = {
        "as_of": as_of.isoformat(),
        "days_queried": days,
        "tickers_total": len(tickers),
        "tickers_done": tickers_done,
        "tickers_with_prints": tickers_with_prints,
        "prints_upserted": prints_upserted,
        "rows_pruned": pruned,
        "full_run": full_run,
        "elapsed_sec": round(time.time() - t0, 1),
    }
    _log_pipeline_fetch(
        "scanner.darkpool-prints-uw",
        "green" if (full_run and prints_upserted > 0) else "amber",
        result,
    )
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--as-of", help="YYYY-MM-DD anchor date (default: today)", default=None)
    p.add_argument("--days-back", type=int, default=DEFAULT_DAYS_BACK,
                   help="Calendar days to query per ticker (default: 3)")
    p.add_argument("--max-seconds", type=float, default=3000.0)
    p.add_argument("--limit", type=int, default=None,
                   help="Cap the universe size (testing)")
    p.add_argument("--tickers", help="Comma-separated explicit ticker list")
    args = p.parse_args()

    if args.tickers:
        ts = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    else:
        ts = build_screener_candidate_universe()
        if args.limit:
            ts = ts[:args.limit]

    as_of = date.fromisoformat(args.as_of) if args.as_of else None

    # Bug #1032 follow-up: write one row per run to api_usage_log so the
    # Admin API Usage bar chart shows this pipeline's daily UW call volume.
    _run_id = uuid.uuid4()
    _started_at = datetime.now(timezone.utc)
    try:
        _result = pull_and_upsert(
            ts, as_of=as_of, days_back=args.days_back, max_seconds=args.max_seconds,
        )
        print(json.dumps(_result, indent=2))
        # Estimate UW calls: roughly (tickers_done * days_queried), since the
        # ingest pulls GET /api/darkpool/{ticker}?date=... once per ticker per
        # day in the window.
        _calls = int((_result.get("tickers_done") or 0) * (_result.get("days_queried") or 1))
        log_run_summary(
            source="darkpool_prints",
            run_id=_run_id,
            started_at=_started_at,
            completed_at=datetime.now(timezone.utc),
            calls_made=_calls,
            status="success" if _result.get("full_run") else "partial",
            notes={
                "tickers_done": _result.get("tickers_done"),
                "tickers_with_prints": _result.get("tickers_with_prints"),
                "prints_upserted": _result.get("prints_upserted"),
            },
        )
    except Exception as _exc:
        log_run_summary(
            source="darkpool_prints",
            run_id=_run_id,
            started_at=_started_at,
            completed_at=datetime.now(timezone.utc),
            status="failed",
            notes={"error": str(_exc)[:500]},
        )
        raise
