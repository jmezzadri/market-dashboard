"""
v4.1 walk-forward backtest CLI runner.

Usage:
    python scripts/run_v4_backtest.py --run A --output /tmp/run_A.parquet
    python scripts/run_v4_backtest.py --run B --output /tmp/run_B.parquet
    python scripts/run_v4_backtest.py --run A --smoke --output /tmp/smoke_A.parquet

Requires SUPABASE_ACCESS_TOKEN env var. PYTHONPATH must include the
trading-scanner repo root so that `scanner.signal_intelligence_v4` resolves.

Run A : universe $300M-$3B,  require_first_buy=True, magnitude_mode='absolute'
        (current production spec, pre-PR-#510 — $1M absolute insider floor)
Run B : universe $300M-$25B, require_first_buy=True, magnitude_mode='capnorm'
        (proposed spec — cap-normalized magnitude from PR #510)

The ONLY differences between A and B are the universe ceiling and the
magnitude rule. Both runs use require_first_buy=True (v4.1 default), the
same liquidity gate ($5 / 500k), the same anti-hedge gate, the same
pillars, the same red-flag, and the same HC tiebreaker (5 bps × cap, $5M
floor) — HC is sizing on top of the gate, applied identically in both
runs.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scanner.signal_intelligence_v4.backtest_harness import (  # noqa: E402
    load_phase1_artifacts,
    run_walkforward,
)

# Phase 1 artifacts live in backtest_artifacts/phase1 of the parent repo
DEFAULT_SCAN_DATES = (
    REPO_ROOT.parent / "backtest_artifacts" / "phase1" / "v41_backtest_scan_dates_2026.txt"
)
DEFAULT_UNIVERSE = (
    REPO_ROOT.parent / "backtest_artifacts" / "phase1" / "v41_backtest_universe_per_date.json"
)


RUN_PRESETS = {
    "A": {
        "cap_min": 300_000_000.0,
        "cap_max": 3_000_000_000.0,
        "require_first_buy": True,
        "magnitude_mode": "absolute",
    },
    "B": {
        "cap_min": 300_000_000.0,
        "cap_max": 25_000_000_000.0,
        "require_first_buy": True,
        "magnitude_mode": "capnorm",
    },
}


def _progress(scan_iso, i, total):
    print(f"  [{i:>2}/{total}] {scan_iso} processed", flush=True)


def main() -> int:
    p = argparse.ArgumentParser(description="v4.1 walk-forward backtest runner")
    p.add_argument("--run", choices=["A", "B"], required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--scan-dates", default=str(DEFAULT_SCAN_DATES))
    p.add_argument("--universe", default=str(DEFAULT_UNIVERSE))
    p.add_argument("--smoke", action="store_true",
                   help="Smoke: 3 recent scan dates x 50 random tickers each")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    if "SUPABASE_ACCESS_TOKEN" not in os.environ:
        print("ERROR: SUPABASE_ACCESS_TOKEN env var must be set.", file=sys.stderr)
        return 2

    preset = RUN_PRESETS[args.run]
    scan_dates, universe, eff_map = load_phase1_artifacts(args.scan_dates, args.universe)
    print(f"Loaded {len(scan_dates)} scan dates, {len(universe)} universe entries")

    if args.smoke:
        smoke_dates = ["2026-04-06", "2026-04-13", "2026-04-20"]
        scan_dates = [d for d in smoke_dates if d in universe]
        if not scan_dates:
            print("ERROR: no smoke dates present in universe file", file=sys.stderr)
            return 2
        rng = random.Random(args.seed)
        sampled_universe: dict = {}
        for d in scan_dates:
            full = universe[d]
            sampled_universe[d] = rng.sample(full, min(50, len(full)))
        universe = sampled_universe
        print(f"Smoke mode: {len(scan_dates)} dates x ~50 tickers = "
              f"{sum(len(v) for v in universe.values())} pairs")

    print(f"\nRun {args.run} config:")
    print(f"  cap range:        ${preset['cap_min']:,.0f} - ${preset['cap_max']:,.0f}")
    print(f"  require_first_buy: {preset['require_first_buy']}")
    print(f"  magnitude_mode:    {preset['magnitude_mode']}")
    print(f"  output:           {args.output}\n")

    t0 = time.time()
    summary = run_walkforward(
        scan_dates=scan_dates,
        universe_per_date=universe,
        universe_cap_min=preset["cap_min"],
        universe_cap_max=preset["cap_max"],
        require_first_buy=preset["require_first_buy"],
        output_path=args.output,
        scan_date_to_effective_date=eff_map,
        magnitude_mode=preset["magnitude_mode"],
        progress_callback=_progress,
    )
    walltime = time.time() - t0
    print("\n=== Summary ===")
    print(json.dumps(summary, indent=2, default=str))
    print(f"\nWrote {summary['total_rows']:,} rows to {args.output} in {walltime:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
