"""
Signal Intelligence v5 — Phase 3 walk-forward backtest CLI.

Usage:
    # Step 1: build cache (one-time, ~3-5 min). Pulls all 9 tables across
    # the full 52-week backtest span into a pickle.
    python scripts/run_v5_backtest.py --build-cache \
           --cache /tmp/v5_cache.pkl

    # Step 2: run any number of (very fast) walk-forwards from the cache.
    python scripts/run_v5_backtest.py --run A --cache /tmp/v5_cache.pkl \
           --output /tmp/run_A.parquet
    python scripts/run_v5_backtest.py --run B --cache /tmp/v5_cache.pkl \
           --output /tmp/run_B.parquet     # same parquet as A; B is post-hoc filter
    python scripts/run_v5_backtest.py --run C --cache /tmp/v5_cache.pkl \
           --weights /tmp/refit_weights.json --output /tmp/run_C.parquet

    # Live (no cache) mode — re-runs all queries every scan date. Slow.
    python scripts/run_v5_backtest.py --run A --live --output /tmp/run_A.parquet

Run definitions (Joe's spec):
    A : equal-weight v5 (default); analysis filters to bullish bands.
    B : equal-weight v5 (same parquet); analysis filters to bearish bands.
    C : re-weighted v5 from A+B per-signal calibration.

Requires SUPABASE_ACCESS_TOKEN env var. PYTHONPATH must include the
trading-scanner repo root so that `scanner.signal_intelligence_v5` resolves.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scanner.signal_intelligence_v5.backtest_harness import (  # noqa: E402
    load_phase1_artifacts, prefetch_full_window, run_walkforward,
    run_walkforward_cached,
)

DEFAULT_SCAN_DATES = (
    REPO_ROOT.parent / "backtest_artifacts" / "phase1" / "v41_backtest_scan_dates_2026.txt"
)
DEFAULT_UNIVERSE = (
    REPO_ROOT.parent / "backtest_artifacts" / "phase1" / "v41_backtest_universe_per_date.json"
)


def cmd_build_cache(args) -> int:
    # Stage-by-stage cache build so each stage fits in a 45s bash window.
    # Stages: caps, prices, insiders, options, congress, analyst,
    # si_finra, si_daily, fwd. We pull stages independently then union.
    import pickle
    from scanner.signal_intelligence_v5.backtest_harness import _q, _qlist
    from collections import defaultdict
    from datetime import date as _date, timedelta
    from scanner.signal_intelligence_v5.backtest_harness import (
        PRICE_LOOKBACK_DAYS, INSIDER_LOOKBACK_DAYS, CONGRESS_LOOKBACK_DAYS,
        ANALYST_LOOKBACK_DAYS, SI_DAILY_LOOKBACK_DAYS, PRICE_SOURCES,
    )

    scan_dates, universe_per_date, _eff = load_phase1_artifacts(
        args.scan_dates, args.universe,
    )
    full_universe = sorted({tk for d in scan_dates for tk in universe_per_date.get(d, [])})
    earliest = datetime.strptime(scan_dates[0], "%Y-%m-%d").date()
    latest = datetime.strptime(scan_dates[-1], "%Y-%m-%d").date()

    # Load existing partial cache if present.
    cache: dict = {}
    if os.path.exists(args.cache):
        with open(args.cache, "rb") as f:
            cache = pickle.load(f)

    stage = args.stage or "all"
    qlist = _qlist(full_universe)

    def save():
        with open(args.cache, "wb") as f:
            pickle.dump(cache, f, protocol=pickle.HIGHEST_PROTOCOL)

    if stage in ("all", "caps"):
        print("Stage: caps", flush=True)
        t0 = time.time()
        sql = f"""
          SELECT ticker, as_of_date, market_cap
          FROM historical_marketcap
          WHERE ticker IN ({qlist})
            AND as_of_date BETWEEN '{earliest - timedelta(days=14)}' AND '{latest}';
        """
        rows = _q(sql)
        d: dict = defaultdict(list)
        for r in rows:
            try:
                dd = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
                d[r["ticker"]].append((dd, float(r["market_cap"])))
            except Exception: continue
        for v in d.values(): v.sort()
        cache["caps_by_ticker"] = dict(d)
        save(); print(f"  caps: {len(rows)} rows in {time.time()-t0:.1f}s")

    if stage in ("all", "prices"):
        print("Stage: prices", flush=True); t0 = time.time()
        px_start = earliest - timedelta(days=PRICE_LOOKBACK_DAYS + 7)
        sql = f"""
          SELECT ticker, trade_date, close, volume
          FROM prices_eod
          WHERE ticker IN ({qlist})
            AND trade_date BETWEEN '{px_start}' AND '{latest}'
            AND source IN ({_qlist(PRICE_SOURCES)})
          ORDER BY ticker, trade_date ASC;
        """
        rows = _q(sql)
        d = defaultdict(list)
        for r in rows:
            try:
                dd = datetime.strptime(r["trade_date"], "%Y-%m-%d").date()
                c = float(r["close"]) if r["close"] is not None else None
                v = float(r["volume"]) if r["volume"] is not None else None
                if c is None or v is None: continue
                d[r["ticker"]].append((dd, c, v))
            except Exception: continue
        cache["prices_by_ticker"] = dict(d)
        save(); print(f"  prices: {len(rows)} rows in {time.time()-t0:.1f}s")

    if stage in ("all", "insiders"):
        print("Stage: insiders", flush=True); t0 = time.time()
        ins_start = earliest - timedelta(days=INSIDER_LOOKBACK_DAYS + 7)
        sql = f"""
          SELECT ticker, transaction_date, owner_name, owner_name_lower,
                 transaction_code, amount, stock_price, is_officer,
                 is_director, is_ten_percent_owner, is_10b5_1, marketcap
          FROM insider_history
          WHERE ticker IN ({qlist})
            AND transaction_date BETWEEN '{ins_start}' AND '{latest}';
        """
        rows = _q(sql)
        d = defaultdict(list)
        for r in rows:
            try:
                r["__d"] = datetime.strptime(r["transaction_date"], "%Y-%m-%d").date()
                d[r["ticker"]].append(r)
            except Exception: continue
        cache["insiders_by_ticker"] = dict(d)
        save(); print(f"  insiders: {len(rows)} rows in {time.time()-t0:.1f}s")

    if stage in ("all", "options"):
        print("Stage: options", flush=True); t0 = time.time()
        sql = f"""
          SELECT ticker, as_of_date, call_premium, put_premium,
                 ask_side_premium, bid_side_premium, sweep_count, unusual_count
          FROM options_flow_daily
          WHERE ticker IN ({qlist});
        """
        rows = _q(sql)
        d = defaultdict(list)
        for r in rows:
            try:
                dd = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
                d[r["ticker"]].append((dd, r))
            except Exception: continue
        for v in d.values(): v.sort(reverse=True)
        cache["options_by_ticker"] = dict(d)
        save(); print(f"  options: {len(rows)} rows in {time.time()-t0:.1f}s")

    if stage in ("all", "congress"):
        print("Stage: congress", flush=True); t0 = time.time()
        cong_start = earliest - timedelta(days=CONGRESS_LOOKBACK_DAYS + 7)
        sql = f"""
          SELECT ticker, transaction_date, member_name, chamber,
                 transaction_type, amount_bucket
          FROM congress_trades_daily
          WHERE ticker IN ({qlist})
            AND transaction_date BETWEEN '{cong_start}' AND '{latest}';
        """
        rows = _q(sql)
        d = defaultdict(list)
        for r in rows:
            try:
                r["__d"] = datetime.strptime(r["transaction_date"], "%Y-%m-%d").date()
                d[r["ticker"]].append(r)
            except Exception: continue
        cache["congress_by_ticker"] = dict(d)
        save(); print(f"  congress: {len(rows)} rows in {time.time()-t0:.1f}s")

    if stage in ("all", "analyst"):
        print("Stage: analyst", flush=True); t0 = time.time()
        ana_start = earliest - timedelta(days=ANALYST_LOOKBACK_DAYS + 7)
        sql = f"""
          SELECT ticker, action_date, firm, action, recommendation,
                 target_price, prev_target, broker_tier
          FROM analyst_ratings_daily
          WHERE ticker IN ({qlist})
            AND action_date BETWEEN '{ana_start}' AND '{latest}';
        """
        rows = _q(sql)
        d = defaultdict(list)
        for r in rows:
            try:
                r["__d"] = datetime.strptime(r["action_date"], "%Y-%m-%d").date()
                d[r["ticker"]].append(r)
            except Exception: continue
        cache["analyst_by_ticker"] = dict(d)
        save(); print(f"  analyst: {len(rows)} rows in {time.time()-t0:.1f}s")

    if stage in ("all", "si_finra"):
        print("Stage: si_finra", flush=True); t0 = time.time()
        sql = f"""
          SELECT ticker, as_of_date, short_interest_float_pct,
                 short_interest_shares, avg_daily_volume
          FROM short_interest
          WHERE ticker IN ({qlist}) AND source = 'finra'
          ORDER BY ticker, as_of_date DESC;
        """
        rows = _q(sql)
        d = defaultdict(list)
        for r in rows:
            try:
                r["__d"] = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
                d[r["ticker"]].append(r)
            except Exception: continue
        cache["si_finra_by_ticker"] = dict(d)
        save(); print(f"  si_finra: {len(rows)} rows in {time.time()-t0:.1f}s")

    if stage in ("all", "si_daily"):
        print("Stage: si_daily", flush=True); t0 = time.time()
        sid_start = earliest - timedelta(days=SI_DAILY_LOOKBACK_DAYS + 7)
        sql = f"""
          SELECT ticker, as_of_date, cost_to_borrow_pct, borrow_shares_available,
                 ftd_quantity, short_volume_ratio
          FROM short_interest_daily
          WHERE ticker IN ({qlist})
            AND as_of_date BETWEEN '{sid_start}' AND '{latest}'
          ORDER BY ticker, as_of_date DESC;
        """
        rows = _q(sql)
        d = defaultdict(list)
        for r in rows:
            try:
                r["__d"] = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
                d[r["ticker"]].append(r)
            except Exception: continue
        cache["si_daily_by_ticker"] = dict(d)
        save(); print(f"  si_daily: {len(rows)} rows in {time.time()-t0:.1f}s")

    if stage in ("all", "fwd"):
        print("Stage: fwd", flush=True); t0 = time.time()
        sql = f"""
          SELECT ticker, as_of_date, fwd_return_21d
          FROM forward_returns_21d
          WHERE ticker IN ({qlist})
            AND as_of_date BETWEEN '{earliest - timedelta(days=14)}' AND '{latest}';
        """
        rows = _q(sql)
        d2: dict = {}
        for r in rows:
            try:
                dd = datetime.strptime(r["as_of_date"], "%Y-%m-%d").date()
                d2[(r["ticker"], dd)] = float(r["fwd_return_21d"])
            except Exception: continue
        cache["fwd_returns"] = d2
        save(); print(f"  fwd: {len(rows)} rows in {time.time()-t0:.1f}s")

    print(f"Cache stages present: {sorted(cache.keys())}")
    return 0


def cmd_run(args) -> int:
    weights = None
    if args.run == "C":
        if not args.weights:
            print("ERROR: Run C requires --weights JSON path", file=sys.stderr)
            return 2
        with open(args.weights) as f:
            weights = json.load(f)

    scan_dates, universe_per_date, eff_map = load_phase1_artifacts(
        args.scan_dates, args.universe,
    )
    if args.smoke > 0:
        scan_dates = scan_dates[:args.smoke]
    if args.end > 0:
        scan_dates = scan_dates[args.start:args.end]
    elif args.start > 0:
        scan_dates = scan_dates[args.start:]
    universe_per_date = {d: universe_per_date.get(d, []) for d in scan_dates}

    print(f"Run {args.run}: {len(scan_dates)} scan dates, "
          f"cap ${args.cap_min/1e6:.0f}M-${args.cap_max/1e9:.0f}B, "
          f"weights={'refit' if weights else 'equal'}, "
          f"{'CACHED' if args.cache and not args.live else 'LIVE'}")
    t0 = time.time()

    def progress(scan_iso, i, n):
        elapsed = time.time() - t0
        eta = elapsed / i * (n - i) if i > 0 else 0
        print(f"  [{i:>3}/{n}] {scan_iso}  elapsed={elapsed:.1f}s  ETA={eta:.0f}s",
              flush=True)

    if args.cache and not args.live:
        import pickle
        with open(args.cache, "rb") as f:
            cache = pickle.load(f)
        summary = run_walkforward_cached(
            scan_dates=scan_dates, universe_per_date=universe_per_date,
            cache=cache, scan_date_to_effective_date=eff_map,
            weights=weights, output_path=args.output,
            universe_cap_min=args.cap_min, universe_cap_max=args.cap_max,
            progress_callback=progress,
        )
    else:
        summary = run_walkforward(
            scan_dates=scan_dates, universe_per_date=universe_per_date,
            scan_date_to_effective_date=eff_map,
            weights=weights, output_path=args.output,
            universe_cap_min=args.cap_min, universe_cap_max=args.cap_max,
            progress_callback=progress,
        )
    print()
    print(json.dumps(summary, indent=2, default=str))
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--build-cache", action="store_true",
                   help="Pre-fetch the full window into a pickle, then exit")
    p.add_argument("--stage", choices=["caps","prices","insiders","options",
                                       "congress","analyst","si_finra",
                                       "si_daily","fwd"],
                   help="Build only this stage of the cache")
    p.add_argument("--cache", help="Pickle cache path (in/out)")
    p.add_argument("--live", action="store_true",
                   help="Force live SQL mode (ignore --cache)")
    p.add_argument("--run", choices=["A", "B", "C"],
                   help="A=equal-wt; B=same parquet; C=refit weights")
    p.add_argument("--output", help="Parquet output path")
    p.add_argument("--weights", help="JSON file with 6-signal weights (Run C)")
    p.add_argument("--scan-dates", default=str(DEFAULT_SCAN_DATES))
    p.add_argument("--universe", default=str(DEFAULT_UNIVERSE))
    p.add_argument("--smoke", type=int, default=0)
    p.add_argument("--start", type=int, default=0)
    p.add_argument("--end", type=int, default=0)
    p.add_argument("--cap-min", type=float, default=300_000_000.0)
    p.add_argument("--cap-max", type=float, default=25_000_000_000.0)
    args = p.parse_args()

    if "SUPABASE_ACCESS_TOKEN" not in os.environ:
        print("ERROR: SUPABASE_ACCESS_TOKEN env var required", file=sys.stderr)
        return 2

    if args.build_cache:
        if not args.cache:
            print("ERROR: --build-cache requires --cache PATH", file=sys.stderr)
            return 2
        return cmd_build_cache(args)
    if not args.run:
        print("ERROR: --run {A,B,C} required (or --build-cache)", file=sys.stderr)
        return 2
    if not args.output:
        print("ERROR: --output PATH required", file=sys.stderr)
        return 2
    return cmd_run(args)


if __name__ == "__main__":
    sys.exit(main())
