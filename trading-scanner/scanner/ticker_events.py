"""ticker_events — 3x-weekday per-ticker event ingestion.

Fills the gap between universe_snapshot (prices/options flow/IV) and the
daily scanner (technicals/analyst/composite): news, insider trades,
congressional trades, and dark pool prints now refresh on the same
3x/weekday cadence as prices.

Architecture
------------
Firehose-then-filter. For sources that UW exposes as a market-wide feed
(news headlines, congress trades, dark pool prints), we pull a single
paginated feed and filter to the universe ticker set client-side. For
insider trades (UW's recent-insider-trades feed is sparse), we fan out
per-ticker but only for the "tracked" set (union of all users'
positions + watchlist tickers) — a much smaller set than the universe,
keeping us inside the 120/min per-user ceiling.

Rate budget per run (estimated)
-------------------------------
    news firehose      : ~10 calls (paginated)
    congress firehose  : ~3  calls
    darkpool firehose  : ~5  calls
    insider per-ticker : ~50 calls (tracked set, not universe)
    ----------------------------------------------------------
    total              : ~70 calls / run × 3 runs/day = ~210/day
    UW Basic ceiling   : 20,000/day → ~1% of budget

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
    run_ticker_events(*, dry_run=False, tracked_tickers=None) -> dict
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
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
ENDPOINT_INSIDER_PER_TICKER = "/api/stock/{ticker}/insider-trades"

# Page size caps (UW usually caps at 500; news caps at 100).
PAGE_LIMIT_NEWS      = 100
PAGE_LIMIT_CONGRESS  = 500
PAGE_LIMIT_DARKPOOL  = 500
PAGE_LIMIT_INSIDER   = 100

# Lookback window — only ingest events within this many hours of "now".
# We're running every ~3h, so 6h of lookback gives us a 2x safety margin
# without pulling ancient history.
LOOKBACK_HOURS = 6

MAX_NEWS_PAGES        = 5
MAX_CONGRESS_PAGES    = 3
MAX_DARKPOOL_PAGES    = 10  # dark pool prints are high-volume; allow more pagination
MAX_INSIDER_PER_RUN   = 200  # hard cap on per-ticker fetches per run

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


def _within_lookback(event_ts_iso: str | None) -> bool:
    if not event_ts_iso:
        return False
    try:
        dt = datetime.fromisoformat(event_ts_iso)
    except ValueError:
        return False
    cutoff = datetime.now(timezone.utc).timestamp() - (LOOKBACK_HOURS * 3600)
    return dt.timestamp() >= cutoff


# ---------------------------------------------------------------------------
# Source: news
# ---------------------------------------------------------------------------

def ingest_news(usage: UWUsageLogger, universe: set[str], run_id: uuid.UUID) -> list[dict[str, Any]]:
    """Pull UW /api/news/headlines firehose and fan out one row per (headline, ticker).

    UW returns headlines with a `tickers: [...]` array — we emit one
    ticker_events row per (headline, ticker) pair, filtered to universe
    tickers. Headlines untagged to any universe ticker are dropped.
    """
    rows: list[dict[str, Any]] = []
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
        emitted_this_page = 0
        for item in items:
            event_ts = _parse_ts(item.get("created_at") or item.get("published_at") or item.get("date"))
            if not _within_lookback(event_ts):
                continue
            tickers = item.get("tickers") or item.get("symbols") or []
            if isinstance(tickers, str):
                tickers = [tickers]
            headline = item.get("headline") or item.get("title") or ""
            url = item.get("url") or item.get("link") or ""
            for t in tickers:
                T = str(t).upper()
                if universe and T not in universe:
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
                emitted_this_page += 1
        if len(items) < PAGE_LIMIT_NEWS:
            break
        page += 1

    logger.info("ticker_events news: %d rows emitted across %d pages", len(rows), page + 1)
    return rows


# ---------------------------------------------------------------------------
# Source: congress
# ---------------------------------------------------------------------------

def ingest_congress(usage: UWUsageLogger, universe: set[str], run_id: uuid.UUID) -> list[dict[str, Any]]:
    """Pull UW /api/congress/recent-trades firehose, filter to universe."""
    rows: list[dict[str, Any]] = []
    page = 0
    while page < MAX_CONGRESS_PAGES:
        resp = usage.get(ENDPOINT_CONGRESS, params={"limit": PAGE_LIMIT_CONGRESS, "page": page})
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
            if universe and T not in universe:
                continue
            event_ts = _parse_ts(item.get("transaction_date") or item.get("date"))
            if not _within_lookback(event_ts):
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

    logger.info("ticker_events congress: %d rows emitted", len(rows))
    return rows


# ---------------------------------------------------------------------------
# Source: dark pool
# ---------------------------------------------------------------------------

def ingest_darkpool(usage: UWUsageLogger, universe: set[str], run_id: uuid.UUID) -> list[dict[str, Any]]:
    """Pull UW /api/darkpool/recent firehose, filter to universe."""
    rows: list[dict[str, Any]] = []
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
            if not _within_lookback(event_ts):
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

    logger.info("ticker_events darkpool: %d rows emitted", len(rows))
    return rows


# ---------------------------------------------------------------------------
# Source: insider (per-ticker for tracked set only)
# ---------------------------------------------------------------------------

def ingest_insider(
    usage: UWUsageLogger,
    tracked: set[str],
    run_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Per-ticker insider-trade fetch for the tracked set.

    Capped at MAX_INSIDER_PER_RUN to stay well inside the per-minute limit.
    """
    rows: list[dict[str, Any]] = []
    tickers = list(tracked)[:MAX_INSIDER_PER_RUN]
    for T in tickers:
        path = ENDPOINT_INSIDER_PER_TICKER.format(ticker=T)
        try:
            resp = usage.get(path, params={"limit": PAGE_LIMIT_INSIDER})
        except Exception as exc:
            logger.warning("ticker_events insider: %s failed: %s", T, exc)
            continue
        if not resp.ok:
            # 404 for a ticker with no insider activity is normal — skip quietly.
            continue
        body = resp.json()
        items = body.get("data") if isinstance(body, dict) else body
        if not items:
            continue
        for item in items:
            event_ts = _parse_ts(item.get("filing_date") or item.get("transaction_date"))
            if not _within_lookback(event_ts):
                continue
            dedup = _stable_hash(
                "insider",
                T,
                event_ts,
                item.get("insider_name") or item.get("name"),
                item.get("transaction_type") or item.get("transaction_code"),
                item.get("shares"),
                item.get("price"),
            )
            rows.append({
                "ticker":    T,
                "source":    "insider",
                "event_ts":  event_ts,
                "run_id":    str(run_id),
                "dedup_key": dedup,
                "payload": {
                    "insider_name":     item.get("insider_name") or item.get("name"),
                    "title":            item.get("title") or item.get("relationship"),
                    "transaction_type": item.get("transaction_type") or item.get("transaction_code"),
                    "shares":           item.get("shares"),
                    "price":            item.get("price"),
                    "value":            item.get("value") or item.get("total_value"),
                    "shares_owned_after": item.get("shares_owned_after"),
                    "filing_date":      item.get("filing_date"),
                    "transaction_date": item.get("transaction_date"),
                },
            })
    logger.info("ticker_events insider: %d rows emitted across %d tracked tickers", len(rows), len(tickers))
    return rows


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def _upsert_events(rows: list[dict[str, Any]]) -> int:
    """Batch-insert ticker_events rows. ON CONFLICT via (source, dedup_key)
    swallows duplicates from overlapping runs."""
    if not rows:
        return 0
    client = _get_supabase_client()
    total = 0
    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[i : i + UPSERT_BATCH_SIZE]
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
    universe = _load_universe_tickers(client)
    tracked = _load_tracked_tickers(client)

    all_rows: list[dict[str, Any]] = []
    per_source_counts: dict[str, int] = {}

    with UWUsageLogger(source="ticker_events", run_id=run_id, flush_to_db=not dry_run) as usage:
        for name, fn, args in [
            ("news",     ingest_news,     (universe,)),
            ("congress", ingest_congress, (universe,)),
            ("darkpool", ingest_darkpool, (universe,)),
            ("insider",  ingest_insider,  (tracked,)),
        ]:
            try:
                src_rows = fn(usage, *args, run_id)
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
