#!/usr/bin/env python3
"""
apply_gate_to_backtest.py — re-derive the gate-dependent columns of the locked
strategy backtest (public/macrotilt_engine_backtest.json) after a change to the
AXIS-1 stress rule in compute_macrotilt_engine.py.

Why this works without re-sourcing 40 years of prices: the artifact already
carries, per week, the point-in-time MOVE percentile, the ΔY-3M percentile, the
SPY weekly total return, and the realised weekly returns of the engine, the
regime-only variant and the asset-tilt variant. The confirmation filter can only
REMOVE de-risk weeks, never add them, so for every week the new rule is
de-risked the old artifact was de-risked too — which means the defensive-sleeve
return and the tilted-equity return for that week can be solved exactly out of
the old columns:

    engine_w      = eq_old * spy_w + (1 - eq_old) * sleeve_w
    asset_tilt_w  = eq_old * tilt_w + (1 - eq_old) * sleeve_w

Everything downstream (cumulatives, drawdowns, validation block, per-episode
depths) is then recomputed from the new state path.

Usage:  python3 scripts/apply_gate_to_backtest.py [--dry-run]
"""
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_macrotilt_engine import (  # noqa: E402
    ALLOCATION, DEFENSIVE_SLEEVE, CONFIRM_WEEKS, WATCH_PCTILE,
    classify_yield_regime, stress_path,
)

ART = Path(__file__).resolve().parent.parent / "public" / "macrotilt_engine_backtest.json"
EQ = {k: v["equity_pct"] / 100.0 for k, v in ALLOCATION.items()}


def main(dry: bool = False) -> None:
    art = json.loads(ART.read_text())
    df = pd.DataFrame(art["weekly"])
    df["dt"] = pd.to_datetime(df["date"])
    df = df.set_index("dt").sort_index()

    # The locked artifact applies each Friday's state to the FOLLOWING week's
    # return (signal Friday, execute Monday open), so the effective equity
    # weight for week i is the state of week i-1. Verified: in every week whose
    # effective weight is 1.0 the engine return equals the SPY return exactly.
    eq_old = (df["equity_pct"] / 100.0).shift(1).fillna(1.0)
    spy = df["spy_weekly_return"]

    # solve the sleeve and tilted-equity legs out of the locked columns
    with np.errstate(invalid="ignore", divide="ignore"):
        sleeve = (df["engine_weekly_return"] - eq_old * spy) / (1 - eq_old)
        tilt = (df["asset_tilt_weekly_return"] - (1 - eq_old) * sleeve.fillna(0)) / eq_old
    sleeve = sleeve.where(eq_old < 1.0)          # undefined in fully-invested weeks
    tilt = tilt.fillna(df["asset_tilt_weekly_return"])

    # new state path from the same point-in-time percentiles
    states = stress_path(df["move_pctile_5y"])
    eq_new = states.map(EQ).shift(1).fillna(1.0)
    assert bool((eq_new >= eq_old - 1e-9).all()), "confirmation filter must never de-risk MORE"
    missing = int(((eq_new < 1.0) & sleeve.isna()).sum())
    assert missing == 0, f"{missing} newly de-risked weeks have no solvable sleeve return"

    yreg = df["delta_y_3m_pctile_5y"].map(classify_yield_regime)
    sleeve_f = sleeve.fillna(0.0)
    eng_new = eq_new * spy + (1 - eq_new) * sleeve_f
    tilt_new = eq_new * tilt + (1 - eq_new) * sleeve_f
    cash_leg = sleeve_f * 0.0  # regime-only parks in cash; the locked artifact's
    # regime-only leg is recovered the same way as the sleeve
    with np.errstate(invalid="ignore", divide="ignore"):
        cash = (df["regime_only_weekly_return"] - eq_old * spy) / (1 - eq_old)
    cash = cash.where(eq_old < 1.0).fillna(0.0)
    ro_new = eq_new * spy + (1 - eq_new) * cash

    def curve(r):
        c = (1 + r).cumprod()
        return c, c / c.cummax() - 1

    cE, dE = curve(eng_new); cR, dR = curve(ro_new); cT, dT = curve(tilt_new); cS, dS = curve(spy)

    # Conventions reverse-engineered from the locked artifact and verified to
    # reproduce all four of its validation blocks exactly under CONFIRM_WEEKS=1:
    #   years  = number of weekly observations / 52
    #   Sharpe = (CAGR - RISK_FREE) / annualised vol, RISK_FREE = 3.25%
    RISK_FREE = 3.25

    def stats(r, c, d):
        yrs = len(r) / 52.0
        cagr = (float(c.iloc[-1]) ** (1 / yrs) - 1) * 100
        vol = float(r.std() * np.sqrt(52)) * 100
        return {"cagr": round(cagr, 2), "vol": round(vol, 2),
                "sharpe": round((cagr - RISK_FREE) / vol, 3),
                "max_drawdown": round(float(d.min()), 4),
                "final_value": round(float(c.iloc[-1]), 4)}

    for i, dtx in enumerate(df.index):
        row = art["weekly"][i]
        st = states.iloc[i]
        row["stress_state"] = st
        row["yield_regime"] = yreg.iloc[i]
        row["equity_pct"] = ALLOCATION[st]["equity_pct"]
        row["defensive_pct"] = ALLOCATION[st]["defensive_pct"]
        row["active_sleeve"] = yreg.iloc[i]
        row["sleeve_composition"] = DEFENSIVE_SLEEVE[yreg.iloc[i]]
        row["engine_weekly_return"] = float(eng_new.iloc[i])
        row["regime_only_weekly_return"] = float(ro_new.iloc[i])
        row["asset_tilt_weekly_return"] = float(tilt_new.iloc[i])
        row["engine_cumulative"] = round(float(cE.iloc[i]), 4)
        row["regime_only_cumulative"] = round(float(cR.iloc[i]), 4)
        row["asset_tilt_cumulative"] = round(float(cT.iloc[i]), 4)
        row["engine_drawdown"] = round(float(dE.iloc[i]), 4)
        row["regime_only_drawdown"] = round(float(dR.iloc[i]), 4)
        row["asset_tilt_drawdown"] = round(float(dT.iloc[i]), 4)

    v = art["validation"]
    v["engine"].update(stats(eng_new, cE, dE))
    v["regime_only"].update(stats(ro_new, cR, dR))
    v["asset_tilt"].update(stats(tilt_new, cT, dT))
    v["spy"].update(stats(spy, cS, dS))

    for ep in art["drawdowns"]:
        m = (df.index >= ep["window_start"]) & (df.index <= ep["window_end"])
        if not m.any():
            continue
        c = (1 + eng_new[m]).cumprod()
        ep["engine_depth"] = round(float((c / c.cummax() - 1).min()), 4)
        ep["diff_pp"] = round((ep["engine_depth"] - ep["spy_depth"]) * 100, 1)
        ep["yield_regime_dominant"] = yreg[m].mode().iloc[0]

    art["calibration_label"] = "1986-2026 validated (confirmation filter added 2026-07-29)"
    art["_doc"] = (art["_doc"].rstrip() +
                   f" Stress gate carries a {CONFIRM_WEEKS}-week confirmation filter "
                   f"(added 2026-07-29): a de-risk only starts after the MOVE percentile has "
                   f"been at or above the {int(WATCH_PCTILE*100)}th for {CONFIRM_WEEKS} consecutive "
                   f"Fridays. Gate-dependent columns re-derived by scripts/apply_gate_to_backtest.py.")

    print("validation after re-derivation:")
    for k in ["spy", "regime_only", "engine", "asset_tilt"]:
        s = v[k]
        print(f"  {k:12s} CAGR {s['cagr']:>6}%  Sharpe {s['sharpe']:>6}  maxDD {s['max_drawdown']*100:>6.1f}%  $1 -> {s['final_value']}")
    derisk = (eq_new < 1.0)
    runs = (derisk != derisk.shift()).cumsum()
    n = sum(1 for _, g in derisk.groupby(runs) if bool(g.iloc[0]))
    print(f"  de-risk episodes: {n} (was 69 under the unfiltered rule)")

    if dry:
        print("dry run — not written")
        return
    ART.write_text(json.dumps(art, indent=2) + "\n")
    print(f"wrote {ART}")


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
