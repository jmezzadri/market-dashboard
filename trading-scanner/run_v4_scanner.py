#!/usr/bin/env python3
"""
v4.1 Signal Intelligence — production daily scan.

Walks the FULL US-listed Common Stock + ADR universe (no cap ceiling on
display), scores every name through the v4.1 pipeline, and writes one row
per (ticker, scan_date) to public.signal_intel_daily. The Trading
Opportunities React page reads from that table.

Surfacing rules:
  - score >= 45 + gates pass + insider $ clears HC threshold + cap in
    [$300M, $3B] → band = "High Conviction"
  - score >= 20 + gates pass + cap in [$300M, $3B] → band = "Watch"
  - score >= 20 but cap > $3B (or < $300M) → band = "Outside surfacing zone"
  - score < 20 OR gate fail → band = "Not Surfaced"

Above $3B the score is informational ONLY — the academic / backtest
evidence supporting Watch / HC tags is monotonically declining in cap.
The 12-month backtest showed the $8B-$25B bucket beats SPY only 41.2%
of weeks, and the production spec is the validated $300M-$3B universe
with cap-normalized magnitude.

Usage:
    python run_v4_scanner.py                      # live run, writes to Supabase
    python run_v4_scanner.py --dry-run            # fetch + score only
    python run_v4_scanner.py --scan-date 2026-05-09  # backfill specific date
    python run_v4_scanner.py --limit 50           # smoke test on small universe

Env required:
    SUPABASE_ACCESS_TOKEN     — Management API for Supabase queries
    SUPABASE_URL              — REST endpoint
    SUPABASE_SERVICE_ROLE_KEY — service-role key for the upsert
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

# Make sure the local scanner package is importable when run from anywhere.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from scanner.signal_intelligence_v4.score import score_ticker  # noqa: E402
from scanner.signal_intelligence_v4.backtest_harness import (  # noqa: E402
    _q,
    _qlist,
    fetch_prices_for_window,
    fetch_marketcap_at_date,
    fetch_insider_history_for_window,
    TRAILING_CLOSES_REQUIRED,
    INSIDER_LOOKBACK_DAYS,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("v4_scanner")

PROJECT_REF = "yqaqqzseepebrocgibcw"

# Surfacing zone (validated by 12-month backtest, see SIGNAL_INTELLIGENCE_V4_LOCKED.md)
SURFACE_CAP_FLOOR = 300_000_000      # $300M
SURFACE_CAP_CEILING = 3_000_000_000  # $3B

# Display universe — score every name with cap data, no ceiling.
DISPLAY_CAP_FLOOR = 50_000_000       # $50M sanity floor (sub-$50M is mostly nano-cap noise)


# ─────────────────────────────────────────────────────────────────────────────
# Universe construction
# ─────────────────────────────────────────────────────────────────────────────

def fetch_full_display_universe(scan_date: date, limit: int | None = None) -> list[tuple[str, float]]:
    """All US-listed CS+ADR tickers with a cap on/before scan_date.

    Returns [(ticker, market_cap_dollars), ...] sorted by cap desc.
    The display universe has no explicit ceiling — every ticker with cap
    data gets scored. Surfacing zone tagging is applied later.
    """
    limit_clause = f"LIMIT {int(limit)}" if limit else ""
    sql = f"""
        WITH latest_cap AS (
            SELECT DISTINCT ON (h.ticker)
                   h.ticker, h.market_cap
              FROM historical_marketcap h
              JOIN universe_master u ON u.ticker = h.ticker
             WHERE h.as_of_date <= '{scan_date}'
               AND u.type IN ('CS', 'ADRC')
               AND h.market_cap >= {DISPLAY_CAP_FLOOR}
             ORDER BY h.ticker, h.as_of_date DESC
        )
        SELECT ticker, market_cap
          FROM latest_cap
         ORDER BY market_cap DESC
         {limit_clause};
    """
    rows = _q(sql)
    out: list[tuple[str, float]] = []
    for r in rows:
        try:
            out.append((r["ticker"], float(r["market_cap"])))
        except (TypeError, ValueError):
            continue
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Scoring loop
# ─────────────────────────────────────────────────────────────────────────────

def score_universe(scan_date: date, universe: list[tuple[str, float]]) -> list[dict[str, Any]]:
    """Score every ticker in `universe` for `scan_date`. Returns rows ready to upsert."""
    tickers = [t for t, _ in universe]
    cap_by_ticker = {t: c for t, c in universe}

    # 1. Bulk-fetch prices in ONE query (~70 calendar days back covers the
    #    51 trading-day indicator window comfortably).
    price_window_start = scan_date - timedelta(days=110)
    logger.info("Fetching prices for %d tickers from %s to %s ...",
                len(tickers), price_window_start, scan_date)
    t0 = time.time()
    prices = fetch_prices_for_window(tickers, price_window_start, scan_date)
    logger.info("  prices: %d tickers with rows (%.1fs)", len(prices), time.time() - t0)

    # 2. Bulk-fetch insider history (425 days = 30 gate + 365 first-buy + buffer).
    ins_window_start = scan_date - timedelta(days=INSIDER_LOOKBACK_DAYS)
    logger.info("Fetching insider history from %s to %s ...", ins_window_start, scan_date)
    t0 = time.time()
    insider_by_ticker = fetch_insider_history_for_window(tickers, ins_window_start, scan_date)
    logger.info("  insider: %d tickers with events (%.1fs)", len(insider_by_ticker), time.time() - t0)

    # 3. Score every ticker.
    rows: list[dict[str, Any]] = []
    n_scored = 0
    n_no_data = 0
    n_surfaced = 0
    n_outside_zone = 0
    for ticker, market_cap in universe:
        ohlcv = prices.get(ticker, [])
        # Need at least 51 closes through scan_date.
        closes = [c for (d, c, _v) in ohlcv if d <= scan_date]
        if len(closes) < TRAILING_CLOSES_REQUIRED:
            n_no_data += 1
            continue

        closes = closes[-TRAILING_CLOSES_REQUIRED:]
        today_close = closes[-1]
        # 22-day avg volume
        recent_vols = [v for (d, _c, v) in ohlcv if d <= scan_date][-22:]
        if not recent_vols:
            n_no_data += 1
            continue
        avg_vol_22d = sum(recent_vols) / len(recent_vols)
        volume_today = recent_vols[-1]

        try:
            result = score_ticker(
                ticker=ticker,
                score_date=scan_date,
                today_close=today_close,
                volume_today=volume_today,
                avg_volume_22d=avg_vol_22d,
                closes_for_indicators=closes,
                insider_history=insider_by_ticker.get(ticker, []),
                require_first_buy=True,
                data_source="supabase",
                market_cap=market_cap,
                magnitude_mode="capnorm",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("score_ticker failed for %s: %s", ticker, exc)
            continue

        n_scored += 1
        in_zone = SURFACE_CAP_FLOOR <= market_cap <= SURFACE_CAP_CEILING

        # Band override: if score qualifies but cap is outside zone, tag as
        # informational rather than Watch / High Conviction.
        ui_band = result.band.value
        if not in_zone and result.score >= 20 and result.gate_pass:
            ui_band = "Outside surfacing zone"
            n_outside_zone += 1
        elif ui_band in ("Watch", "High Conviction"):
            n_surfaced += 1

        rows.append({
            "scan_date": scan_date.isoformat(),
            "ticker": ticker,
            "market_cap": market_cap,
            "score": result.score,
            "band": ui_band,
            "gate_pass": result.gate_pass,
            "hc_eligible": result.hc_eligible,
            "surfacing_zone": in_zone,
            "insider_dollar_30d": result.insider_dollar_tiebreaker,
            "gate_diagnostic": result.gate_diagnostic,
            "pillar_diagnostic": result.pillar_diagnostic,
        })

    logger.info(
        "Scored %d tickers (%d skipped for missing data). "
        "Surfaced (Watch/HC): %d. Outside zone but signal fired: %d.",
        n_scored, n_no_data, n_surfaced, n_outside_zone,
    )
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Upsert to signal_intel_daily
# ─────────────────────────────────────────────────────────────────────────────

def upsert_rows(rows: list[dict[str, Any]], batch_size: int = 500) -> int:
    """Upsert rows into public.signal_intel_daily. Returns # written."""
    if not rows:
        return 0
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        logger.error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — cannot upsert.")
        return 0

    endpoint = f"{url}/rest/v1/signal_intel_daily"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        # JSONB diagnostic columns travel as JSON strings via PostgREST.
        # PostgREST accepts native JSON in the body for jsonb columns.
        r = requests.post(endpoint, headers=headers, data=json.dumps(batch), timeout=60)
        if r.status_code >= 400:
            logger.error("Upsert batch %d failed: %s %s", i // batch_size, r.status_code, r.text[:300])
            continue
        total += len(batch)
    logger.info("Upserted %d rows to signal_intel_daily", total)
    return total


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scan-date", type=str, default=None,
                        help="YYYY-MM-DD; defaults to today (UTC).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Score only — do not write to Supabase.")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit universe size for smoke testing.")
    args = parser.parse_args()

    scan_date = (
        date.fromisoformat(args.scan_date)
        if args.scan_date
        else datetime.now(timezone.utc).date()
    )
    logger.info("v4.1 production scan for %s (dry_run=%s, limit=%s)",
                scan_date, args.dry_run, args.limit)

    universe = fetch_full_display_universe(scan_date, limit=args.limit)
    if not universe:
        logger.error("Empty universe — historical_marketcap may be stale for %s", scan_date)
        return 1
    logger.info("Universe: %d tickers, cap range $%.1fM - $%.1fB",
                len(universe),
                universe[-1][1] / 1e6 if universe else 0,
                universe[0][1] / 1e9 if universe else 0)

    rows = score_universe(scan_date, universe)

    if args.dry_run:
        logger.info("DRY RUN — would write %d rows to signal_intel_daily.", len(rows))
        # Print a preview of the top 10 by score for sanity.
        top = sorted(rows, key=lambda r: (-r["score"], -float(r["market_cap"] or 0)))[:10]
        for r in top:
            logger.info("  %s  score=%d  band=%-22s  cap=$%.2fB",
                        r["ticker"], r["score"], r["band"], r["market_cap"] / 1e9)
        return 0

    n = upsert_rows(rows)
    logger.info("Done. %d rows written for %s.", n, scan_date)
    return 0 if n > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
