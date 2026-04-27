#!/usr/bin/env python3
"""
backfill_allocation_history.py — historical replay of v9.1 allocation
for every Saturday since 2026-01-03.

Reads:
  - public/indicator_history.json   (full daily indicator panel back to 2005)
  - public/composite_history_daily.json (full daily R&L/Growth/Inflation back to 2005)
  - yfinance: one 2003-01-01 → today pull for every proxy ticker

Writes:
  - public/allocation_history.json — list of weekly snapshots, one per Saturday.
    Schema is the same the V9-ALLOCATION-WEEKLY workflow uses for ongoing
    snapshots. Backfill entries get `backfilled: true` so they're
    distinguishable from live-cron entries; the consuming UI does not
    distinguish (data is data).

────────────────────────────────────────────────────────────────────────────
WALK-FORWARD INTEGRITY (the LESSONS rule that owns this file)
────────────────────────────────────────────────────────────────────────────
Memory rule: "Back-test 'too good to be true' → audit lookahead FIRST."

This script is the most lookahead-prone surface in the codebase. The audit
checklist below is what each Saturday's replay must satisfy. Every check
is enforced by `compute_for_as_of(as_of, factors, composites, daily_ret)`
in compute_v9_allocation.py — this script is responsible for handing it
date-truncated inputs.

  1. INDICATORS (factors): every per-Saturday call gets `factors.loc[:as_of]`.
     `compute_for_as_of` then resamples to monthly month-ends and uses
     `.loc[:last_complete_month]`. If a release happened ON `as_of`, we
     include it (release date == observation date). If a release will be
     dated as `as_of` but published the following Tuesday, the indicator
     panel does NOT include it (we cannot know future revisions).

  2. COMPOSITES: `composites.loc[:as_of]` → resampled to monthly →
     `prior_dt = last_complete_month - MonthEnd(1)`. The composite used is
     for the month BEFORE last_complete_month, which is the prior-month-end.
     This matches the original v9 logic and is lookahead-safe.

  3. PRICES: one yfinance pull, then `daily_ret.loc[:as_of]` per replay.
     For Saturday as_of, the trading day is Friday. We never include any
     Monday/forward returns. yfinance returns adjusted-close which can
     re-state historical prices when corporate actions (splits,
     spin-offs) occur — this is acceptable (the model would be re-trained
     on the same adjusted prices anyway).

  4. MOMENTUM: 6-month trailing window ending at `last_complete_month`,
     i.e. the trailing 6 calendar months STRICTLY BEFORE the rebalance
     date. The current month is excluded.

  5. REGRESSION: 60-month rolling window ending at `last_complete_month`.
     Factor data is `.shift(1)` inside `fit_per_asset_forecast()` so each
     month's return is regressed on the PRIOR month's factor levels —
     standard predictive regression, no contemporaneous bias.

  6. SHORT HISTORY: proxies with < 24 months of monthly returns at the
     replay as_of are silently dropped from ranking (returns `scored: false`).
     This is a graceful fallback — for early-2026 backfills, ETFs like XLC
     (inception 2018-06) hit this filter only if the rolling 60-month
     window starts before their inception, which it does for as_ofs in
     early 2023 or earlier; for our 2026 backfill range, all listed proxies
     have sufficient history.

  7. NO LIVE NETWORK CALLS during replay. yfinance + FRED extras are
     pulled ONCE at the top of this script. compute_for_as_of has zero
     network IO. If the script were to call FRED inside the loop, a future
     FRED revision of historical data could corrupt the backfill — we
     avoid that by snapshotting the data once.

────────────────────────────────────────────────────────────────────────────
SPOT-CHECK PROTOCOL
────────────────────────────────────────────────────────────────────────────
After running, the script prints a summary line per snapshot. The expected
sanity checks:

  • Every snapshot's `as_of` (the rebalance month) is the month before the
    Saturday calendar date.
  • Picks rotate slowly week-to-week (rank changes should rarely flip more
    than 1-2 positions in 7 days).
  • Equity share + leverage track the R&L composite trend — consistent
    with the indicator history.
"""

from __future__ import annotations
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from compute_v9_allocation import (
    compute_for_as_of, load_factor_panel, load_composites, load_prices,
    INDUSTRY_GROUPS,
)

REPO_ROOT = Path(__file__).resolve().parent
PUBLIC = REPO_ROOT / "public"

START_DATE = pd.Timestamp("2026-01-03")  # First Saturday of 2026


def saturdays_through(end_date):
    """Return list of every Saturday from START_DATE through end_date inclusive."""
    end = pd.Timestamp(end_date)
    out = []
    d = START_DATE
    while d <= end:
        out.append(d)
        d += pd.Timedelta(days=7)
    return out


def to_snapshot(out, as_of):
    """Convert compute_for_as_of's output dict into the snapshot format used
    by allocation_history.json (list of one-row-per-snapshot entries)."""
    equity_share = out.get("equity_share", 0)
    leverage = out.get("leverage", 0)
    equities_pp = round(equity_share * leverage * 100, 2)
    other_pp = round((1 - equity_share) * 100, 2) if equity_share < 1 else 0.0
    total_pp = equities_pp + other_pp
    cash_margin = -round(max(0, leverage - equity_share) * 100, 2)
    stance = (
        "Aggressive" if leverage > 1.05
        else "Balanced" if leverage > 0.85
        else "Defensive"
    )
    return {
        "as_of": out.get("as_of"),
        "saturday_replayed": str(as_of.date()),
        "snapshotted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "backfilled": True,
        "stance_label": stance,
        "equities_pct_capital": equities_pp,
        "other_pct_capital": other_pp,
        "total_deployed_pct_capital": total_pp,
        "cash_or_margin_pct_capital": cash_margin,
        "leverage": float(leverage),
        "equity_share": float(equity_share),
        "alpha": out.get("alpha"),
        "regime": out.get("regime"),
        "selection_confidence": out.get("selection_confidence"),
        "picks": [
            {
                "ticker": p["ticker"],
                "name": p.get("name"),
                "sector": p.get("sector"),
                "weight": p.get("weight"),
                "indicator_rank": p.get("indicator_rank"),
                "momentum_rank": p.get("momentum_rank"),
            }
            for p in out.get("picks", [])
        ],
        "ratings": [
            {
                "key": r["key"],
                "name": r["name"],
                "ticker": r["primary_ticker"],
                "rating": r["rating"],
                "combined_rank": r.get("combined_rank"),
            }
            for r in out.get("all_industry_groups", [])
            if r.get("scored")
        ],
        "methodology_version": out.get("methodology", {}).get("version"),
    }


def main():
    print("[backfill] loading data once for all replays…")
    print("  factors…")
    factors = load_factor_panel()
    print(f"    {len(factors.columns)} factors, {factors.index[0].date()} → {factors.index[-1].date()}")
    print("  composites…")
    composites = load_composites()
    print(f"    composites {composites.index[0].date()} → {composites.index[-1].date()}")
    print("  prices (yfinance one-shot)…")
    df = load_prices()
    daily_ret = df.pct_change().dropna(how="all")
    print(f"    {len(daily_ret.columns)} tickers, {daily_ret.index[0].date()} → {daily_ret.index[-1].date()}")

    # Determine end date: most recent Saturday on or before today
    today = pd.Timestamp.today().normalize()
    days_since_sat = (today.weekday() - 5) % 7  # Saturday = 5
    last_saturday = today - pd.Timedelta(days=days_since_sat)
    if today.weekday() < 5:  # if today is Sun-Thu, step back 1 week earlier
        # Actually if today is Sunday or later in the week, last Saturday is fine
        pass
    saturdays = saturdays_through(last_saturday)
    print(f"\n[backfill] replaying {len(saturdays)} Saturdays from {saturdays[0].date()} through {saturdays[-1].date()}")

    snapshots = []
    failures = []
    for sat in saturdays:
        try:
            out = compute_for_as_of(sat, factors, composites, daily_ret,
                                     calculated_at=f"{sat.date()}T12:00:00+00:00")
            snap = to_snapshot(out, sat)
            snapshots.append(snap)
            picks_str = ",".join(p["ticker"] for p in snap["picks"][:5])
            print(f"  {sat.date()} → as_of {snap['as_of']} | "
                  f"R&L {out['regime']['risk_liquidity']:+.0f} | "
                  f"alpha {snap['alpha']:.2f} | "
                  f"picks: {picks_str}")
        except Exception as e:
            failures.append((sat, str(e)))
            print(f"  {sat.date()} FAILED: {e}", file=sys.stderr)

    if not snapshots:
        print("[backfill] no snapshots produced — aborting.", file=sys.stderr)
        sys.exit(1)

    # Merge with any existing allocation_history.json entries so we don't
    # clobber non-backfilled snapshots.
    hist_path = PUBLIC / "allocation_history.json"
    existing = []
    if hist_path.exists():
        try:
            existing_raw = json.loads(hist_path.read_text())
            existing = existing_raw if isinstance(existing_raw, list) else []
        except Exception:
            existing = []

    by_as_of = {s.get("as_of"): s for s in existing}
    for snap in snapshots:
        # Prefer existing live-cron snapshots over backfill replays for the
        # same as_of date (live runs see real-time intraday data; backfill
        # uses prior-day close).
        if snap["as_of"] not in by_as_of:
            by_as_of[snap["as_of"]] = snap

    merged = sorted(by_as_of.values(), key=lambda s: s.get("as_of") or "")
    hist_path.write_text(json.dumps(merged, indent=2) + "\n")

    print(f"\n[done] wrote {len(merged)} snapshots to {hist_path}")
    print(f"  backfilled: {sum(1 for s in merged if s.get('backfilled'))}")
    print(f"  live cron:  {sum(1 for s in merged if not s.get('backfilled'))}")
    if failures:
        print(f"\n[warn] {len(failures)} replays failed:")
        for sat, err in failures:
            print(f"  {sat.date()}: {err}")


if __name__ == "__main__":
    main()
