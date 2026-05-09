#!/usr/bin/env python3
"""
run_backtest_v2.py — produce the three calibration JSONs the producer reads.

Three modes:

    --mode placeholder
        Write the rollup.py PLACEHOLDER values to disk. Use this on launch
        day to give the UI something non-empty to read before the real
        back-test runs. Idempotent.

    --mode synthetic
        Run the harness on a synthetic dataset (deterministic seed). Useful
        for end-to-end smoke testing the pipeline without real data.

    --mode real
        Read historical data from Supabase + UW historical tables and run
        the harness across the full training window. **Requires UW
        historical backfill (Phase 9.5 Data Steward PR).** Today only
        prices_eod / ticker_reference / universe_master are backfilled in
        Supabase; insider / options flow / congress / analyst tables are
        live-pulled per scan and not historical. Until 9.5 ships, this
        mode raises NotImplementedError.

Output paths (relative to repo root):
    public/calibration_v2_magnitude_to_excess_return.json
    public/calibration_v2_conviction_table.json
    public/calibration_v2_bands.json

Usage:
    cd trading-scanner && PYTHONPATH=. python3 scripts/run_backtest_v2.py \\
        --mode placeholder \\
        --out-dir ../market-dashboard/public

    cd trading-scanner && PYTHONPATH=. python3 scripts/run_backtest_v2.py \\
        --mode synthetic --seed 42

    cd trading-scanner && PYTHONPATH=. python3 scripts/run_backtest_v2.py \\
        --mode real \\
        --train-from 2019-01-01 --train-until 2024-06-30 \\
        --holdout-from 2024-07-01 --holdout-to 2026-04-30
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add repo root to path so `scanner.*` resolves when invoked as a script
THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parent
sys.path.insert(0, str(REPO_ROOT))

from scanner.signal_intelligence_v2.calibration_io import write_calibration_files  # noqa: E402
from scanner.signal_intelligence_v2.backtest import (  # noqa: E402
    build_band_stats,
    build_conviction_table,
    build_excess_return_curve,
    compute_basket_performance,
    compute_ticker_outcomes,
    signal_ablation,
    walk_forward,
)


def _run_synthetic(seed: int = 42, n_days: int = 250, n_tickers: int = 100) -> dict:
    """Run the harness on synthetic data. Returns calibration outputs."""
    # Late import so synthetic-data factory only loads when needed
    from tests.test_backtest_v2 import _make_synthetic_days  # type: ignore

    days = _make_synthetic_days(n_days=n_days, n_tickers=n_tickers, seed=seed)
    outcomes = compute_ticker_outcomes(days)
    return {
        "excess_curve": [
            (r["magnitude_center"], r["mean_excess_pct"])
            for r in build_excess_return_curve(outcomes)
        ],
        "conviction_table": {
            agr: [(r["abs_magnitude"], r["hit_rate_pct"]) for r in curve]
            for agr, curve in build_conviction_table(outcomes).items()
        },
        "band_stats": build_band_stats(outcomes),
        "performance": compute_basket_performance(outcomes, buy_threshold=25.0),
    }


def _run_real(
    train_from: str,
    train_until: str,
    holdout_from: str,
    holdout_to: str,
) -> dict:
    """Run the harness against real historical data — requires Phase 9.5 backfill."""
    raise NotImplementedError(
        "Real-data back-test requires Phase 9.5 Data Steward PR (UW historical "
        "backfill into Supabase). Today only prices_eod / ticker_reference / "
        "universe_master are backfilled. Run --mode placeholder for now; the "
        "JSONs will refresh automatically once 9.5 lands and this script's real "
        "branch is wired."
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=("placeholder", "synthetic", "real"), default="placeholder")
    parser.add_argument(
        "--out-dir",
        default=str(REPO_ROOT.parent / "market-dashboard" / "public"),
        help="Where to write the three calibration JSONs.",
    )
    parser.add_argument("--seed", type=int, default=42, help="Synthetic mode seed.")
    parser.add_argument("--train-from", default="2019-01-01")
    parser.add_argument("--train-until", default="2024-06-30")
    parser.add_argument("--holdout-from", default="2024-07-01")
    parser.add_argument("--holdout-to", default="2026-04-30")
    args = parser.parse_args(argv)

    out_dir = Path(args.out_dir)
    print(f"Mode: {args.mode}")
    print(f"Out dir: {out_dir}")

    if args.mode == "placeholder":
        paths = write_calibration_files(out_dir, source="placeholder")
        print("Wrote placeholder calibration:")
        for k, p in paths.items():
            print(f"  {k}: {p}")
        return 0

    if args.mode == "synthetic":
        result = _run_synthetic(seed=args.seed)
        paths = write_calibration_files(
            out_dir,
            excess_curve=result["excess_curve"],
            conviction_table=result["conviction_table"],
            band_stats=result["band_stats"],
            source=f"synthetic_seed{args.seed}",
        )
        print("Synthetic-mode calibration written:")
        for k, p in paths.items():
            print(f"  {k}: {p}")
        print(f"Synthetic basket performance: {result['performance']}")
        return 0

    if args.mode == "real":
        try:
            _run_real(args.train_from, args.train_until, args.holdout_from, args.holdout_to)
            return 0
        except NotImplementedError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 2

    return 1


if __name__ == "__main__":
    sys.exit(main())
