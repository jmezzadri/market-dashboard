#!/usr/bin/env python3
"""
compute_v10_allocation.py — v10 allocator (Phase 2 of Asset Tilt re-architecture).

Reads:
  - public/cycle_board_snapshot.json  (6 mechanism scores 0-100, refreshed nightly)

Writes:
  - public/v10_allocation.json        (today's recommended allocation)

Replaces the deprecated v9 allocator that keyed off the now-retired R&L composite.
v10 keys off the live 6-mechanism cycle board.

DECISION RULES (Phase 2 — every threshold backtestable per Joe directive 2026-05-03):

  1. Equity vs Defensive split — driven by the 3 stress-detection mechanisms:
     Credit, Liquidity & Policy, Positioning & Breadth.
     stress_score = sum over the 3:
         mechanism in caution band (50-75)  → +1
         mechanism in risk-off band (75-100) → +2
     defensive_pct = stress_score × 8.33%, hard cap 50%.

  2. Leverage — driven by Valuation + Funding mechanisms.
     Default 1.0x.
     Up to 1.5x ONLY in regime-flip mode (3+ mechanisms transitioning from
     risk-off to caution in a single month — the V-bottom signal). Not active
     in v10 v1 since regime-flip detection requires history of recent states;
     ships as v10.1.

  3. Defensive XOR leverage — Joe's hard rule: NEVER on at the same time.
     If defensive_pct > 0, leverage forced to 1.0x.

  4. Per-sector tilts — documented sensitivity matrix (rows = 11 sectors,
     cols = 6 mechanisms). For each sector:
         tilt_score = sum over mechanisms of (sensitivity × (score - 50) / 50)
     Sectors with tilt_score > +0.3 → Overweight
     Sectors with tilt_score in [-0.3, +0.3] → Market weight
     Sectors with tilt_score < -0.3 → Underweight
     Allocations sized so OW totals to ~110% of SPY weight, UW to ~80%.
     All sector weights sum to equity_pct.
"""
from __future__ import annotations

import json
import datetime as dt
from pathlib import Path
from typing import Dict, List

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_IN = REPO_ROOT / "public" / "cycle_board_snapshot.json"
ALLOC_OUT = REPO_ROOT / "public" / "v10_allocation.json"

# 11 GICS sector universe — Joe-locked 2026-05-03.
SECTORS = [
    "Information Technology", "Communication Services", "Financials",
    "Health Care", "Consumer Discretionary", "Industrials",
    "Consumer Staples", "Energy", "Materials", "Real Estate", "Utilities",
]

# SPY benchmark weights (approximate, 2026-Q1).
SPY_WEIGHTS = {
    "Information Technology": 0.27, "Communication Services": 0.09,
    "Financials": 0.13, "Health Care": 0.13,
    "Consumer Discretionary": 0.11, "Industrials": 0.09,
    "Consumer Staples": 0.06, "Energy": 0.04,
    "Materials": 0.02, "Real Estate": 0.03, "Utilities": 0.03,
}

# Per-sector sensitivity to each cycle mechanism.
# Positive = sector benefits when mechanism score is HIGH (concerning).
# Negative = sector hurt when mechanism score is HIGH.
# Magnitude = strength of relationship.
# Anchored on v6_per_sector_factor_map.md plus standard sell-side sector
# strategy practice. Each sensitivity is testable by regressing 2008-2026
# monthly sector returns on the mechanism's score.
SECTOR_SENSITIVITY: Dict[str, Dict[str, float]] = {
    "Information Technology":   {"valuation": -0.8, "credit": -0.1, "funding": -0.3, "growth": -0.6, "liquidity_policy": +1.0, "positioning_breadth": -0.7},
    "Communication Services":   {"valuation": -0.6, "credit": -0.1, "funding": -0.2, "growth": -0.2, "liquidity_policy": +0.5, "positioning_breadth": -0.5},
    "Financials":               {"valuation": +0.7, "credit": -1.5, "funding": -1.4, "growth": -0.6, "liquidity_policy": +0.5, "positioning_breadth": -0.4},
    "Health Care":              {"valuation": +0.6, "credit": -0.2, "funding": -0.2, "growth": +0.3, "liquidity_policy":  0.0, "positioning_breadth": +0.3},
    "Consumer Discretionary":   {"valuation": -0.5, "credit": -0.6, "funding": -0.4, "growth": -1.0, "liquidity_policy": +0.5, "positioning_breadth": -0.8},
    "Industrials":              {"valuation": +0.3, "credit": -1.1, "funding": -0.5, "growth": -1.4, "liquidity_policy": +0.5, "positioning_breadth": -0.4},
    "Consumer Staples":         {"valuation": +0.7, "credit":  0.0, "funding": -0.1, "growth": +0.7, "liquidity_policy":  0.0, "positioning_breadth": +0.4},
    "Energy":                   {"valuation": +0.5, "credit": -1.3, "funding": -0.3, "growth": -1.2, "liquidity_policy":  0.0, "positioning_breadth": -0.1},
    "Materials":                {"valuation": +0.3, "credit": -1.0, "funding": -0.4, "growth": -1.1, "liquidity_policy":  0.0, "positioning_breadth": -0.2},
    "Real Estate":              {"valuation": -0.3, "credit": -0.9, "funding": -1.0, "growth": -0.1, "liquidity_policy": -1.5, "positioning_breadth": -0.1},
    "Utilities":                {"valuation": +0.5, "credit": +0.1, "funding":  0.0, "growth": +0.8, "liquidity_policy":  0.0, "positioning_breadth": +0.4},
}


def band(score: float) -> str:
    if score < 25: return "risk-on"
    if score < 50: return "neutral"
    if score < 75: return "caution"
    return "risk-off"


def compute_stress_score(mechanism_scores: Dict[str, float]) -> int:
    """Stress score from the 3 stress-detection mechanisms (max 6)."""
    stress_mechs = ["credit", "liquidity_policy", "positioning_breadth"]
    score = 0
    for m in stress_mechs:
        b = band(mechanism_scores.get(m, 50))
        if b == "caution":
            score += 1
        elif b == "risk-off":
            score += 2
    return score


def compute_defensive_pct(stress_score: int) -> float:
    """Defensive % from stress score, hard cap 50%."""
    return min(50.0, stress_score * 8.33) / 100.0


def compute_leverage(mechanism_scores: Dict[str, float], defensive_pct: float, regime_flip: bool = False) -> float:
    """Leverage rule. Joe hard caps: ≤ 1.5x; never with defensive on."""
    if defensive_pct > 0:
        return 1.0  # XOR rule
    if not regime_flip:
        return 1.0  # No leverage outside V-bottom regime-flip
    # Regime-flip path (placeholder — v10.1 implements transition detection)
    val_band = band(mechanism_scores.get("valuation", 50))
    fund_band = band(mechanism_scores.get("funding", 50))
    if val_band == "risk-on" and fund_band == "risk-on":
        return 1.5
    if val_band in ("risk-off",) or fund_band in ("risk-off",):
        return 1.0
    return 1.25


def compute_sector_tilts(mechanism_scores: Dict[str, float], equity_pct: float) -> List[Dict]:
    """For each sector: tilt score, rating, and dollar weight."""
    rows = []
    for sector in SECTORS:
        sens = SECTOR_SENSITIVITY[sector]
        tilt_score = 0.0
        for mech, sensitivity in sens.items():
            score = mechanism_scores.get(mech, 50)
            normalized = (score - 50) / 50.0  # -1 (deeply risk-on) to +1 (deeply risk-off)
            tilt_score += sensitivity * normalized
        # Rating
        if tilt_score > 0.3:
            rating = "OW"
            multiplier = 1.20
        elif tilt_score < -0.3:
            rating = "UW"
            multiplier = 0.75
        else:
            rating = "MW"
            multiplier = 1.0
        rows.append({
            "sector": sector,
            "tilt_score": round(tilt_score, 3),
            "rating": rating,
            "spy_weight": SPY_WEIGHTS[sector],
            "raw_weight": SPY_WEIGHTS[sector] * multiplier,
        })
    # Normalize so total equity weight = equity_pct
    total_raw = sum(r["raw_weight"] for r in rows)
    for r in rows:
        r["weight"] = round(r["raw_weight"] / total_raw * equity_pct, 4)
        r["dollar"] = round(r["weight"] * 100, 2)
        r["vs_spy_pp"] = round((r["weight"] / equity_pct - r["spy_weight"]) * 100, 1) if equity_pct > 0 else 0
    return rows


def main() -> None:
    snapshot = json.loads(SNAPSHOT_IN.read_text())
    mechs = {m["id"]: m["score"] for m in snapshot["mechanisms"]}

    bands = {k: band(v) for k, v in mechs.items()}
    stress_score = compute_stress_score(mechs)
    defensive_pct = compute_defensive_pct(stress_score)
    equity_pct = 1.0 - defensive_pct
    leverage = compute_leverage(mechs, defensive_pct, regime_flip=False)
    sectors = compute_sector_tilts(mechs, equity_pct)

    # Defensive sleeve composition — equal-weight 4 buckets when active
    defensive = []
    if defensive_pct > 0:
        each = defensive_pct * 100 / 4
        for ticker, name in [("BIL", "Cash (1-3M Treasury)"), ("TLT", "Long Treasuries"),
                              ("GLD", "Gold"), ("LQD", "IG Corporate Bonds")]:
            defensive.append({"ticker": ticker, "name": name, "dollar": round(each, 2)})

    out = {
        "as_of": snapshot["as_of"],
        "version": "v10.0",
        "engine": "Phase 2 — 6-mechanism cycle-board allocator",
        "mechanism_scores": mechs,
        "mechanism_bands": bands,
        "stress_score": stress_score,
        "equity_pct": round(equity_pct, 4),
        "defensive_pct": round(defensive_pct, 4),
        "leverage": leverage,
        "gross_exposure": round(equity_pct * leverage, 4),
        "sectors": sectors,
        "defensive": defensive,
        "rule_audit": {
            "max_defensive_50pct": defensive_pct <= 0.50,
            "max_leverage_1_5x": leverage <= 1.5,
            "defensive_xor_leverage": not (defensive_pct > 0 and leverage > 1.0),
            "all_6_mechanisms_used": len(mechs) == 6,
        },
    }
    ALLOC_OUT.parent.mkdir(parents=True, exist_ok=True)
    ALLOC_OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {ALLOC_OUT}")
    print()
    print(f"Today as of {snapshot['as_of']}:")
    for k, v in mechs.items():
        print(f"  {k:24s}  {v:3d}/100  {bands[k]}")
    print(f"\nStress score: {stress_score}/6")
    print(f"Equity %: {equity_pct*100:.1f}")
    print(f"Defensive %: {defensive_pct*100:.1f}")
    print(f"Leverage: {leverage:.2f}x")
    print(f"Gross exposure: {equity_pct * leverage * 100:.1f}%")
    print(f"\nSector allocation (per $100):")
    for r in sectors:
        print(f"  {r['sector']:24s} ${r['dollar']:>6.2f}  {r['rating']:3s}  vs SPY {r['vs_spy_pp']:+.1f}pp  tilt={r['tilt_score']:+.2f}")
    print(f"\nDefensive sleeve:")
    if defensive:
        for d in defensive:
            print(f"  {d['ticker']:5s} {d['name']:30s} ${d['dollar']:>6.2f}")
    else:
        print("  (off — stress score too low)")
    print(f"\nRule audit:")
    for k, v in out["rule_audit"].items():
        print(f"  {k:30s} {'✓' if v else '✗ FAIL'}")


if __name__ == "__main__":
    main()
