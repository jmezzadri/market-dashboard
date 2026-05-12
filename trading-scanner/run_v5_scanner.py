#!/usr/bin/env python3
"""
v5 Signal Intelligence — production daily scan.

Walks the v5 universe (US Common Stock + ADR with market cap >= $300M
AND last close > $5, ~3,300 names live), runs every ticker through
`scanner.signal_intelligence_v5.composite.compute_mt_score`, and upserts
one row per (ticker, scan_date) to public.signal_intel_v5_daily.

The Trading Opportunities React page swaps to this table in Phase 4.
Until then `signal_intel_daily` (v4.1) stays the live source; both run
in parallel.

Usage:
    python run_v5_scanner.py                       # live run -> Supabase
    python run_v5_scanner.py --dry-run             # score only, no write
    python run_v5_scanner.py --scan-date 2026-05-09
    python run_v5_scanner.py --limit 50            # smoke-test small universe
    python run_v5_scanner.py --tickers NVDA,AAPL,TSLA

Env required:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    SUPABASE_ACCESS_TOKEN
    (UNUSUAL_WHALES_API_KEY only if upstream scorers need a live UW call;
     the v5 scorers read from Supabase caches populated by the Phase 1
     ingest workflows, so the daily scan is offline-from-UW.)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any

import requests

# Local-package import path.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from scanner.signal_intelligence_v5.composite import compute_mt_score  # noqa: E402
from scanner.signal_intelligence_v5.universe import (  # noqa: E402
    build_universe_v5_from_supabase,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("v5_scanner")

PROJECT_REF = "yqaqqzseepebrocgibcw"


# ─────────────────────────────────────────────────────────────────────────────
# Universe + cap fetch
# ─────────────────────────────────────────────────────────────────────────────

def _management_query(sql: str) -> list[dict[str, Any]]:
    """Run a SQL query through the Supabase Management API."""
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    url = os.environ.get("SUPABASE_URL", "")
    if not token or not url:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN and SUPABASE_URL must be set.")
    project = url.replace("https://", "").split(".")[0]
    api = f"https://api.supabase.com/v1/projects/{project}/database/query"
    r = requests.post(
        api,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": sql},
        timeout=120,
    )
    r.raise_for_status()
    return r.json() if r.text else []


def fetch_universe_with_caps(scan_date: date,
                             limit: int | None = None,
                             tickers: list[str] | None = None,
                             ) -> list[tuple[str, float]]:
    """
    Pull the v5 universe + each ticker's current market cap.

    Returns [(ticker, market_cap), ...] sorted by ticker.

    The universe filter (mcap >= $300M, last close > $5, type in CS/ADRC)
    runs in `build_universe_v5_from_supabase`; here we just bolt the
    market_cap column onto the surviving tickers so the composite can
    apply the insider cap-discount.
    """
    if tickers:
        # Explicit-ticker mode bypasses the universe filter (useful for
        # smoke tests on well-known names).
        clean = sorted({t.strip().upper() for t in tickers if t.strip()})
    else:
        clean = build_universe_v5_from_supabase(as_of_date=scan_date)
        if limit:
            clean = clean[:int(limit)]

    if not clean:
        return []

    in_list = ",".join(f"'{t}'" for t in clean)
    sql = f"""
        SELECT ticker, market_cap
          FROM ticker_reference
         WHERE ticker IN ({in_list})
    """
    rows = _management_query(sql)
    cap_by_ticker: dict[str, float] = {}
    for r in rows:
        try:
            cap_by_ticker[r["ticker"]] = float(r["market_cap"])
        except (TypeError, ValueError, KeyError):
            continue

    out: list[tuple[str, float]] = []
    for t in clean:
        mc = cap_by_ticker.get(t)
        if mc is None:
            # Universe builder already enforced mcap >= $300M, so a None
            # here is rare — skip rather than ship a row without cap data.
            logger.debug("no market_cap row for %s -- skipping", t)
            continue
        out.append((t, mc))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Scoring loop
# ─────────────────────────────────────────────────────────────────────────────

def _score_one(args: tuple[str, float, date]) -> dict[str, Any] | None:
    ticker, market_cap, scan_date = args
    try:
        res = compute_mt_score(ticker, scan_date, market_cap=market_cap)
    except Exception as exc:  # noqa: BLE001
        logger.warning("compute_mt_score failed for %s: %s", ticker, exc)
        return None
    return {
        "scan_date":    scan_date.isoformat(),
        "ticker":       ticker,
        "market_cap":   market_cap,
        "mt_score":     res.get("mt_score"),
        "band":         res.get("band", "No Data"),
        "sub_scores":   res.get("sub_scores", {}),
        "weights_used": res.get("weights_used", {}),
        "cap_discount": res.get("cap_discount_applied"),
        "so_what":      res.get("so_what"),
        "diagnostic":   res.get("diagnostic", {}),
    }


def score_universe(scan_date: date,
                   universe: list[tuple[str, float]],
                   workers: int = 12,
                   progress_every: int = 200,
                   ) -> list[dict[str, Any]]:
    """
    Score each ticker through compute_mt_score; return rows ready to upsert.

    Each scorer is I/O-bound on Supabase REST calls, so we use a thread
    pool to overlap latency. Default 12 workers drops a 3,300-ticker run
    from ~80min serial to ~7min.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    rows: list[dict[str, Any]] = []
    band_counts: Counter[str] = Counter()
    n_total = len(universe)
    t_start = time.time()

    if workers <= 1:
        # Serial path -- preserved for debugging.
        for i, (ticker, market_cap) in enumerate(universe, start=1):
            r = _score_one((ticker, market_cap, scan_date))
            if r is None:
                continue
            rows.append(r)
            band_counts[r["band"]] += 1
            if i % progress_every == 0:
                elapsed = time.time() - t_start
                rate = i / elapsed if elapsed > 0 else 0
                logger.info("  scored %d/%d (%.1f/s); bands so far: %s",
                            i, n_total, rate, dict(band_counts))
    else:
        args_list = [(t, c, scan_date) for t, c in universe]
        done = 0
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [ex.submit(_score_one, a) for a in args_list]
            for fut in as_completed(futures):
                r = fut.result()
                done += 1
                if r is None:
                    continue
                rows.append(r)
                band_counts[r["band"]] += 1
                if done % progress_every == 0:
                    elapsed = time.time() - t_start
                    rate = done / elapsed if elapsed > 0 else 0
                    remaining = (n_total - done) / rate if rate > 0 else 0
                    logger.info(
                        "  scored %d/%d (%.1f/s, ~%.0fs left); "
                        "bands so far: %s",
                        done, n_total, rate, remaining, dict(band_counts),
                    )

    logger.info("Scored %d / %d tickers in %.1fs. Final band counts: %s",
                len(rows), n_total, time.time() - t_start, dict(band_counts))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Upsert
# ─────────────────────────────────────────────────────────────────────────────

def upsert_rows(rows: list[dict[str, Any]], batch_size: int = 500) -> int:
    """Upsert into signal_intel_v5_daily; returns # rows written."""
    if not rows:
        return 0
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        logger.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.")
        return 0

    endpoint = f"{url}/rest/v1/signal_intel_v5_daily"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        r = requests.post(endpoint, headers=headers, data=json.dumps(batch, default=str),
                          timeout=120)
        if r.status_code >= 400:
            logger.error("Upsert batch %d failed: %s %s",
                         i // batch_size, r.status_code, r.text[:300])
            continue
        total += len(batch)
    logger.info("Upserted %d rows to signal_intel_v5_daily", total)

    # ── Phase 1b · Data Steward overhaul (2026-05-12) ──────────────────────
    # Write scanner-v5-daily to pipeline_health so a silent scanner death
    # (like 5/9 -> 5/12 when SUPABASE_ACCESS_TOKEN was missing for 2 cron
    # runs) becomes a visible amber/red chip instead of an invisible 3-day-
    # stale Trading Opps table. data_as_of anchors to the actual scan_date
    # this run produced, not now(); coverage_pct compares to the expected
    # 3,300-ticker v5 universe so a half-broken scan that writes 1,800 rows
    # flags coverage-low.
    if total > 0 and rows:
        try:
            scan_date_str = str(rows[0].get("scan_date") or rows[0].get("scanDate") or "")
            EXPECTED = 3300
            cov = (total / EXPECTED) * 100
            from datetime import timedelta as _td
            now = datetime.now(timezone.utc)
            ph_patch = {
                "indicator_id": "scanner-v5-daily",
                "label": "Scanner · V5 Composite Daily",
                "source": "Computed (in-house v5 from UW + Massive + Polygon)",
                "cadence": "D",
                "expected_cadence_minutes": 1440,
                "last_check_at": now.isoformat(),
                "last_good_at": now.isoformat(),
                "status": "green",
                "last_error": None,
                "data_as_of": f"{scan_date_str}T20:00:00+00:00",
                "expected_next_run": (now + _td(hours=24)).isoformat(),
                "coverage_pct": cov,
            }
            ph_endpoint = f"{url}/rest/v1/pipeline_health"
            ph_headers = dict(headers)
            ph_headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
            ph_r = requests.post(ph_endpoint, headers=ph_headers,
                                 data=json.dumps([ph_patch], default=str), timeout=30)
            if ph_r.status_code >= 400:
                logger.warning("[pipeline_health] scanner-v5-daily upsert failed %s: %s",
                               ph_r.status_code, ph_r.text[:200])
            else:
                logger.info("[pipeline_health] scanner-v5-daily registered, coverage=%.1f%%", cov)
        except Exception as e:
            # Never fail the scan because the health write hiccuped.
            logger.warning("[pipeline_health] write failed (non-fatal): %s", e)

    return total


# ─────────────────────────────────────────────────────────────────────────────
# Distribution print-out
# ─────────────────────────────────────────────────────────────────────────────

def summarize(rows: list[dict[str, Any]]) -> None:
    band_counts: Counter[str] = Counter(r["band"] for r in rows)
    total = len(rows)
    logger.info("=== Band distribution (n=%d) ===", total)
    for band in ["Strong Sell", "Watch Sell", "Neutral",
                 "Watch Buy", "Strong Buy", "No Data"]:
        c = band_counts.get(band, 0)
        pct = (c / total * 100) if total else 0
        logger.info("  %-12s  %5d  %5.1f%%", band, c, pct)

    # Top 5 / bottom 5 by score (informational).
    scored = [r for r in rows if r["mt_score"] is not None]
    if scored:
        top = sorted(scored, key=lambda r: -float(r["mt_score"]))[:5]
        bot = sorted(scored, key=lambda r:  float(r["mt_score"]))[:5]
        logger.info("Top 5 by MT Score:")
        for r in top:
            logger.info("  %-8s  %+6.1f  %-12s  cap=$%.1fB",
                        r["ticker"], r["mt_score"], r["band"],
                        float(r["market_cap"]) / 1e9)
        logger.info("Bottom 5 by MT Score:")
        for r in bot:
            logger.info("  %-8s  %+6.1f  %-12s  cap=$%.1fB",
                        r["ticker"], r["mt_score"], r["band"],
                        float(r["market_cap"]) / 1e9)


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--scan-date", type=str, default=None,
                        help="YYYY-MM-DD; defaults to today (UTC).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Score only - do not write to Supabase.")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit universe size for smoke testing.")
    parser.add_argument("--tickers", type=str, default=None,
                        help="Comma-separated explicit tickers (bypasses universe).")
    parser.add_argument("--workers", type=int, default=12,
                        help="Thread pool size for scoring (default 12). 1 = serial.")
    args = parser.parse_args()

    scan_date = (
        date.fromisoformat(args.scan_date)
        if args.scan_date
        else datetime.now(timezone.utc).date()
    )
    tickers = [t for t in (args.tickers or "").split(",") if t.strip()] or None
    logger.info("v5 production scan for %s (dry_run=%s, limit=%s, tickers=%s)",
                scan_date, args.dry_run, args.limit, tickers)

    universe = fetch_universe_with_caps(scan_date, limit=args.limit, tickers=tickers)
    if not universe:
        logger.error("Empty universe -- check ticker_reference / prices_eod freshness.")
        return 1
    logger.info("Universe: %d tickers, cap range $%.1fM - $%.1fB",
                len(universe),
                min(c for _, c in universe) / 1e6,
                max(c for _, c in universe) / 1e9)

    rows = score_universe(scan_date, universe, workers=args.workers)
    summarize(rows)

    if args.dry_run:
        logger.info("DRY RUN -- would write %d rows to signal_intel_v5_daily.", len(rows))
        return 0

    n = upsert_rows(rows)
    logger.info("Done. %d rows written for %s.", n, scan_date)
    return 0 if n > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
