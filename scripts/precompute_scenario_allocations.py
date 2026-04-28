#!/usr/bin/env python3
"""
precompute_scenario_allocations.py — Scenario Analysis L4 panel data source.

For each of the 8 historical CCAR-anchored scenarios in
public/scenario_calibration/scenario_anchors.json, this script:
  1. Loads the current v9 factor panel (latest observation, in z-score units).
  2. Adds the CCAR shock vector translated through translate_ccar_to_v9().
  3. Converts the stressed v9 z-scores back to native units.
  4. Calls compute_allocation_from_data() with those overrides, capturing
     the stressed allocation (regime, alpha, picks, defensive, weights).
  5. Writes everything to public/scenario_allocations.json — that file is
     the data source for ScenarioAnalysis.jsx's L4 panel.

Sprint 2 v1 caveats (will be tightened in v1.1 / Sprint 3):
  - Composites (R&L / Growth / Inflation & Rates) are held at current values.
    Composite stress derivation is a Senior Quant follow-up.
  - Tier-3 v9 factors (copper_gold, natgas_henry, skew) pass through at
    current value because CCAR has no analog.
  - Out-of-sample back-test acceptance gates run separately in Sprint 3 — this
    script just produces the engine output.

Architecture: the same compute_v9_allocation engine that runs nightly. The
only difference is the LAST observation of the factor panel is replaced with
the stressed values. The optimizer does not know it's been stressed.
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Ensure repo root is importable
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from compute_v9_allocation import (
    load_all_data,
    compute_allocation_from_data,
    PUBLIC,
    WINDOW,
    EQUITY,
    DEFENSIVE,
)
from asset_allocation.ccar_translation import (
    translate_ccar_to_v9,
    V9_FACTOR_IDS,
    CCAR_US_16_IDS,
    TIER_3_PASSTHROUGH,
)


# Map CCAR anchor file's variable names to the IDs translate_ccar_to_v9 expects.
# scenario_anchors.json uses 'prime' but translate uses 'prime_rate'.
ANCHOR_TO_CCAR_RENAME = {
    "prime": "prime_rate",
}


def normalise_anchor_factor_z(factor_z: dict) -> dict:
    """Apply rename + drop NaN → return clean dict[CCAR_ID -> z_score]."""
    out = {}
    for k, v in factor_z.items():
        if v is None:
            continue
        canon = ANCHOR_TO_CCAR_RENAME.get(k, k)
        out[canon] = float(v)
    return out


def fill_missing_ccar_with_zero(z_ccar: dict) -> dict:
    """translate_ccar_to_v9 requires all 16 CCAR IDs present. Missing → 0."""
    full = {k: 0.0 for k in CCAR_US_16_IDS}
    for k, v in z_ccar.items():
        if k in full:
            full[k] = v
    return full


def latest_v9_z_and_native(factors: pd.DataFrame, last_dt: pd.Timestamp):
    """Return (z, native, mu, std) dicts for v9 factors using the trailing
    WINDOW months (matches the regression window so units line up)."""
    monthly_factors = factors.resample("M").last().dropna(how="all")
    wf = monthly_factors.loc[:last_dt]
    if len(wf) < WINDOW:
        raise RuntimeError(f"need ≥{WINDOW} months of factor history, have {len(wf)}")
    win = wf.iloc[-WINDOW:]

    z, native, mu_dict, sd_dict = {}, {}, {}, {}
    for f in V9_FACTOR_IDS:
        if f not in wf.columns:
            # Factor not present in panel — leave passthrough at 0 z-score.
            z[f] = 0.0
            native[f] = 0.0
            mu_dict[f] = 0.0
            sd_dict[f] = 1.0
            continue
        latest = float(wf[f].iloc[-1])
        col = win[f].dropna()
        m = float(col.mean()) if len(col) else 0.0
        s = float(col.std()) if len(col) > 1 else 1.0
        if not np.isfinite(s) or s < 1e-9:
            s = 1.0
        z[f] = (latest - m) / s
        native[f] = latest
        mu_dict[f] = m
        sd_dict[f] = s
    return z, native, mu_dict, sd_dict


def stress_to_native_overrides(stressed_z: dict, mu_dict: dict, sd_dict: dict, factors: pd.DataFrame) -> dict:
    """Convert a stressed v9 z-score dict back to native units, only for
    factors that actually exist in the panel (others are no-ops anyway)."""
    out = {}
    for f, zv in stressed_z.items():
        if f not in factors.columns:
            continue
        native = mu_dict[f] + zv * sd_dict[f]
        out[f] = float(native)
    return out


def diff_picks(baseline_picks, stressed_picks):
    """Return {added, removed, kept} ticker lists."""
    base_t = {p["ticker"] for p in baseline_picks}
    str_t = {p["ticker"] for p in stressed_picks}
    return {
        "added": sorted(str_t - base_t),
        "removed": sorted(base_t - str_t),
        "kept": sorted(base_t & str_t),
    }


def main():
    print("[scenario-precompute] starting...")

    # 1. Load anchor scenarios
    anchor_path = PUBLIC / "scenario_calibration" / "scenario_anchors.json"
    anchors = json.loads(anchor_path.read_text())
    scenarios = anchors["scenarios"]
    print(f"  loaded {len(scenarios)} scenarios from {anchor_path.name}")

    # 2. Load all data once
    print("\n[1/3] loading factor panel + composites + ETF returns...")
    factors, composites, monthly_ret = load_all_data()
    last_dt = factors.resample("M").last().dropna(how="all").index[-1]
    print(f"  factor panel last obs: {last_dt.date()}")

    # 3. Snapshot current v9 z-scores + means/stds
    print("\n[2/3] snapshotting current v9 factor panel...")
    current_z, current_native, mu_dict, sd_dict = latest_v9_z_and_native(factors, last_dt)
    in_panel = [f for f in V9_FACTOR_IDS if f in factors.columns]
    print(f"  {len(in_panel)} of {len(V9_FACTOR_IDS)} v9 factors present in panel")

    # 4. Baseline allocation (no overrides — same as nightly v9_allocation.json)
    print("\n[3/3] computing baseline allocation (calm state)...")
    baseline = compute_allocation_from_data(
        factors, composites, monthly_ret, quiet=True,
    )
    print(f"  baseline picks: {[p['ticker'] for p in baseline['picks']]}")
    print(f"  baseline alpha: {baseline['alpha']:.3f}")

    # 5. Loop over scenarios
    out_scenarios = {}
    for sid, s in scenarios.items():
        z_ccar_raw = normalise_anchor_factor_z(s.get("factor_z", {}))
        z_ccar = fill_missing_ccar_with_zero(z_ccar_raw)
        # translate_ccar_to_v9 starts at current_v9 and ADDS shock magnitudes
        stressed_v9_z = translate_ccar_to_v9(z_ccar, current_z)
        # convert stressed z back to native units for the optimizer
        factor_overrides = stress_to_native_overrides(
            stressed_v9_z, mu_dict, sd_dict, factors,
        )

        result = compute_allocation_from_data(
            factors, composites, monthly_ret,
            factor_overrides=factor_overrides,
            scenario_id=sid,
            scenario_name=s["name"],
            quiet=True,
        )

        # Compute the deltas vs baseline
        delta = {
            "alpha": float(result["alpha"] - baseline["alpha"]),
            "equity_share": float(result["equity_share"] - baseline["equity_share"]),
            "leverage": float(result["leverage"] - baseline["leverage"]),
            "picks": diff_picks(baseline["picks"], result["picks"]),
        }

        out_scenarios[sid] = {
            "name": s["name"],
            "window_start": s.get("window_start"),
            "window_end": s.get("window_end"),
            "narrative": s.get("narrative"),
            "uses_pre1996_proxies": s.get("uses_pre1996_proxies", False),
            "ccar_z_input": z_ccar_raw,
            "v9_z_stressed": {k: round(float(v), 4) for k, v in stressed_v9_z.items()},
            "factor_overrides_applied": {k: round(v, 6) for k, v in factor_overrides.items()},
            "stressed_allocation": result,
            "delta_vs_baseline": delta,
        }

        print(
            f"  {sid:>26}: alpha {result['alpha']:.2f} (Δ{delta['alpha']:+.2f}), "
            f"picks {[p['ticker'] for p in result['picks']]}"
        )

    # 6. Pre-compute scaled CCAR shock vectors (used for nearest-anchor lookup
    # of custom user shocks in the browser — distance is L2 in z-space).
    anchor_z_matrix = {sid: normalise_anchor_factor_z(s.get("factor_z", {})) for sid, s in scenarios.items()}

    out = {
        "as_of": datetime.now(timezone.utc).date().isoformat(),
        "calculated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "factor_panel_last_obs": str(last_dt.date()),
        "n_scenarios": len(scenarios),
        "current_v9_z": {k: round(v, 4) for k, v in current_z.items()},
        "passthrough_factors": list(TIER_3_PASSTHROUGH),
        "baseline": baseline,
        "scenarios": out_scenarios,
        "anchor_ccar_z": anchor_z_matrix,
        "methodology_notes": [
            "Scenario Analysis re-runs the v9 optimizer with a stressed factor panel.",
            "CCAR US-Domestic 16 shocks are translated to v9's 18-factor panel via translate_ccar_to_v9.",
            "Tier-3 v9 factors (copper_gold, natgas_henry, skew) pass through at current value — CCAR has no analog.",
            "Composites (R&L / Growth / Inflation & Rates) are held at current values in v1; composite stress derivation is a Sprint 2.5 follow-up.",
            "Out-of-sample back-test acceptance gates are validated separately in Sprint 3.",
        ],
    }

    out_path = PUBLIC / "scenario_allocations.json"
    out_path.write_text(json.dumps(out, indent=2) + "\n")
    print(f"\n[done] wrote {out_path}")
    print(f"  baseline + {len(scenarios)} scenarios")


if __name__ == "__main__":
    main()
