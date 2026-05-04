#!/usr/bin/env python3
"""
compute_v10_allocation.py — v10 allocator (Phase 2 of Asset Tilt re-architecture).

Reads:
  - public/cycle_board_snapshot.json  (6 mechanism scores 0-100, refreshed nightly)

Writes:
  - public/v10_allocation.json        (today's recommended allocation)

Replaces the deprecated v9 allocator that keyed off the now-retired R&L composite.
v10 keys off the live 6-mechanism cycle board.

DECISION RULES — v10.1c, locked 2026-05-04 after backtest sweep:

  1. Equity vs Defensive split — driven by the 3 stress-detection mechanisms:
     Credit, Liquidity & Policy, Positioning & Breadth.
     stress_score = sum over the 3:
         mechanism in caution band (50-75)  → +1
         mechanism in risk-off band (75-100) → +2
     defensive_pct = 0% if stress_score < 4, else (stress_score - 3) × 20%,
     hard cap 50%. Calibrated 2026-05-04: keeps allocator at 100% equity 88%
     of the time per Joe directive ("most of the time at 100% equity"); only
     activates defensive sleeve in genuinely severe stress.

  2. Leverage — 1.25x when ALL 6 mechanisms read Risk-on or Neutral (no
     Caution, no Risk-off bands). Otherwise 1.0x. The 1.5x ceiling is reserved
     for V-bottom regime-flip detection (transition from risk-off to caution
     across 3+ mechanisms in a single month) — placeholder for v10.2.

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

# 25 GICS Industry Groups — child of each sector with its own sensitivity tweaks.
# Each IG inherits parent sector sensitivity then adds adjustments.
# tickers = ETFs that give exposure (most-liquid first).
INDUSTRY_GROUPS: List[Dict] = [
    {"id":"semis",       "sector":"Information Technology",  "name":"Semiconductors",            "tickers":["SOXX","SMH","PSI"],          "weight_within_sector":0.46, "adj":{"growth":-0.4,"positioning_breadth":-0.3}},
    {"id":"software",    "sector":"Information Technology",  "name":"Software",                   "tickers":["IGV","XSW","CLOU"],          "weight_within_sector":0.35, "adj":{"valuation":-0.2,"liquidity_policy":+0.2}},
    {"id":"hardware",    "sector":"Information Technology",  "name":"Hardware",                   "tickers":["IYW","XLK"],                 "weight_within_sector":0.19, "adj":{}},
    {"id":"intmedia",    "sector":"Communication Services",  "name":"Interactive Media",          "tickers":["XLC","PNQI"],                "weight_within_sector":0.60, "adj":{"valuation":-0.3,"liquidity_policy":+0.3}},
    {"id":"telecom",     "sector":"Communication Services",  "name":"Telecom & Media",            "tickers":["IYZ","FCOM"],                "weight_within_sector":0.40, "adj":{"valuation":+0.2,"positioning_breadth":+0.2}},
    {"id":"banks",       "sector":"Financials",              "name":"Banks",                      "tickers":["KBE","KRE","IAT"],           "weight_within_sector":0.54, "adj":{"funding":-0.4,"credit":-0.3}},
    {"id":"insurance",   "sector":"Financials",              "name":"Insurance",                  "tickers":["KIE","IAK"],                 "weight_within_sector":0.31, "adj":{"funding":+0.5}},
    {"id":"divfin",      "sector":"Financials",              "name":"Diversified Financials",     "tickers":["IAI","KCE"],                 "weight_within_sector":0.15, "adj":{"valuation":-0.2}},
    {"id":"capgoods",    "sector":"Industrials",             "name":"Capital Goods",              "tickers":["XLI","VIS"],                 "weight_within_sector":0.50, "adj":{"growth":-0.2}},
    {"id":"transport",   "sector":"Industrials",             "name":"Transportation",             "tickers":["IYT","XTN"],                 "weight_within_sector":0.30, "adj":{"growth":-0.3}},
    {"id":"defense",     "sector":"Industrials",             "name":"Defense & Aerospace",        "tickers":["ITA","XAR","PPA"],           "weight_within_sector":0.20, "adj":{"growth":+0.4,"positioning_breadth":+0.3}},
    {"id":"pharma",      "sector":"Health Care",             "name":"Pharmaceuticals",            "tickers":["PPH","IHE","XPH"],           "weight_within_sector":0.46, "adj":{"valuation":+0.2,"positioning_breadth":+0.2}},
    {"id":"devices",     "sector":"Health Care",             "name":"Medical Devices",            "tickers":["IHI","XHE"],                 "weight_within_sector":0.32, "adj":{"growth":+0.2}},
    {"id":"biotech",     "sector":"Health Care",             "name":"Biotech",                    "tickers":["IBB","XBI","BBH"],           "weight_within_sector":0.22, "adj":{"valuation":-0.4,"positioning_breadth":-0.3}},
    {"id":"foodbev",     "sector":"Consumer Staples",        "name":"Food & Beverage",            "tickers":["PBJ","XLP"],                 "weight_within_sector":0.62, "adj":{}},
    {"id":"household",   "sector":"Consumer Staples",        "name":"Household & Personal Care",  "tickers":["XLP","VDC"],                 "weight_within_sector":0.38, "adj":{}},
    {"id":"retail",      "sector":"Consumer Discretionary",  "name":"Retail",                     "tickers":["XRT","RTH"],                 "weight_within_sector":0.57, "adj":{"growth":-0.2}},
    {"id":"autos",       "sector":"Consumer Discretionary",  "name":"Autos",                      "tickers":["CARZ","DRIV"],               "weight_within_sector":0.43, "adj":{"growth":-0.3,"credit":-0.3}},
    {"id":"oilgas",      "sector":"Energy",                  "name":"Oil & Gas",                  "tickers":["XOP","IEO","XLE"],           "weight_within_sector":0.80, "adj":{}},
    {"id":"oilfield",    "sector":"Energy",                  "name":"Equipment & Services",       "tickers":["OIH","IEZ","XES"],           "weight_within_sector":0.20, "adj":{"growth":-0.4}},
    {"id":"mining",      "sector":"Materials",               "name":"Metals & Mining",            "tickers":["XME","GDX","SLX"],           "weight_within_sector":0.65, "adj":{"growth":-0.3}},
    {"id":"chemicals",   "sector":"Materials",               "name":"Chemicals",                  "tickers":["PYZ","XLB"],                 "weight_within_sector":0.35, "adj":{"growth":-0.2}},
    {"id":"reits",       "sector":"Real Estate",             "name":"REITs",                      "tickers":["VNQ","XLRE","MORT"],         "weight_within_sector":1.00, "adj":{}},
    {"id":"electric",    "sector":"Utilities",               "name":"Electric & Multi-Utility",   "tickers":["XLU","VPU","FUTY"],          "weight_within_sector":1.00, "adj":{}},
]

# Sector-level ETFs for inline display in the sector row of the page.
SECTOR_ETFS: Dict[str, List[str]] = {
    "Information Technology":   ["XLK","VGT","FTEC"],
    "Communication Services":   ["XLC","VOX","FCOM"],
    "Financials":               ["XLF","VFH","FNCL"],
    "Health Care":              ["XLV","VHT","FHLC"],
    "Consumer Discretionary":   ["XLY","VCR","FDIS"],
    "Industrials":              ["XLI","VIS","FIDU"],
    "Consumer Staples":         ["XLP","VDC","FSTA"],
    "Energy":                   ["XLE","VDE","FENY"],
    "Materials":                ["XLB","VAW","FMAT"],
    "Real Estate":              ["XLRE","VNQ","FREL"],
    "Utilities":                ["XLU","VPU","FUTY"],
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
    """v10.1c: defensive 0% if stress < 4, else (stress-3) × 20%, cap 50%."""
    if stress_score < 4:
        return 0.0
    return min(0.50, (stress_score - 3) * 0.20)


def compute_leverage(mechanism_scores: Dict[str, float], defensive_pct: float, regime_flip: bool = False) -> float:
    """v10.1c: 1.25x when ALL 6 mechanisms in risk-on or neutral band; else 1.0x.
    Joe hard caps: ≤ 1.5x; never with defensive on.
    1.5x ceiling reserved for V-bottom regime-flip (placeholder for v10.2).
    """
    if defensive_pct > 0:
        return 1.0  # XOR rule
    bands_present = {band(v) for v in mechanism_scores.values()}
    all_calm = bands_present <= {"risk-on", "neutral"}
    if all_calm:
        return 1.25
    if regime_flip:
        return 1.5
    return 1.0


def compute_sector_tilts(mechanism_scores: Dict[str, float], equity_pct: float) -> List[Dict]:
    """For each sector: tilt score, rating, and dollar weight.
    Also adds the per-mechanism contribution breakdown for the heatmap."""
    rows = []
    for sector in SECTORS:
        sens = SECTOR_SENSITIVITY[sector]
        tilt_score = 0.0
        contributions = {}
        for mech, sensitivity in sens.items():
            score = mechanism_scores.get(mech, 50)
            normalized = (score - 50) / 50.0  # -1 (deeply risk-on) to +1 (deeply risk-off)
            contrib = sensitivity * normalized
            contributions[mech] = round(contrib, 3)
            tilt_score += contrib
        if tilt_score > 0.3:
            rating, multiplier = "OW", 1.20
        elif tilt_score < -0.3:
            rating, multiplier = "UW", 0.75
        else:
            rating, multiplier = "MW", 1.0
        rows.append({
            "sector": sector,
            "tilt_score": round(tilt_score, 3),
            "rating": rating,
            "spy_weight": SPY_WEIGHTS[sector],
            "raw_weight": SPY_WEIGHTS[sector] * multiplier,
            "etfs": SECTOR_ETFS[sector],
            "contributions": contributions,
        })
    # Normalize so total equity weight = equity_pct
    total_raw = sum(r["raw_weight"] for r in rows)
    for r in rows:
        r["weight"] = round(r["raw_weight"] / total_raw * equity_pct, 4)
        r["dollar"] = round(r["weight"] * 100, 2)
        r["vs_spy_pp"] = round((r["weight"] / equity_pct - r["spy_weight"]) * 100, 1) if equity_pct > 0 else 0
    return rows


def compute_ig_tilts(mechanism_scores: Dict[str, float], sector_rows: List[Dict]) -> List[Dict]:
    """For each industry group: inherit parent sector sensitivity + IG adjustment,
    compute IG-level tilt and weight (within the sector's allocation)."""
    sector_dollar = {r["sector"]: r["dollar"] for r in sector_rows}
    ig_rows = []
    for ig in INDUSTRY_GROUPS:
        parent_sens = SECTOR_SENSITIVITY[ig["sector"]]
        # Add IG-specific adjustment to parent sector sensitivity
        sens = {m: parent_sens.get(m, 0) + ig["adj"].get(m, 0) for m in parent_sens}
        tilt_score = 0.0
        contributions = {}
        for mech, sensitivity in sens.items():
            score = mechanism_scores.get(mech, 50)
            normalized = (score - 50) / 50.0
            contrib = sensitivity * normalized
            contributions[mech] = round(contrib, 3)
            tilt_score += contrib
        # IG dollar = parent sector dollar × within-sector weight × tilt-adjusted multiplier
        if tilt_score > 0.3:
            rating, multiplier = "OW", 1.15
        elif tilt_score < -0.3:
            rating, multiplier = "UW", 0.80
        else:
            rating, multiplier = "MW", 1.0
        base_dollar = sector_dollar[ig["sector"]] * ig["weight_within_sector"]
        # Apply multiplier; renormalize within sector below
        ig_rows.append({
            "id": ig["id"],
            "name": ig["name"],
            "sector": ig["sector"],
            "tickers": ig["tickers"],
            "tilt_score": round(tilt_score, 3),
            "rating": rating,
            "raw_dollar": base_dollar * multiplier,
            "contributions": contributions,
        })
    # Renormalize so each sector's IG dollars sum back to the sector's total
    for sector in SECTORS:
        sector_igs = [ig for ig in ig_rows if ig["sector"] == sector]
        if not sector_igs:
            continue
        sector_total = sector_dollar.get(sector, 0)
        raw_sum = sum(ig["raw_dollar"] for ig in sector_igs)
        if raw_sum > 0:
            for ig in sector_igs:
                ig["dollar"] = round(ig["raw_dollar"] / raw_sum * sector_total, 2)
        del_keys = ["raw_dollar"]
        for ig in sector_igs:
            for k in del_keys:
                ig.pop(k, None)
    return ig_rows


def compute_contribution_matrix(sector_rows: List[Dict], ig_rows: List[Dict]) -> Dict:
    """Heatmap data: per-sector and per-IG contribution by mechanism."""
    return {
        "by_sector": {r["sector"]: r["contributions"] for r in sector_rows},
        "by_ig": {ig["id"]: {"name": ig["name"], "sector": ig["sector"],
                              "contributions": ig["contributions"]} for ig in ig_rows},
        "rows": ["valuation", "credit", "funding", "growth", "liquidity_policy", "positioning_breadth"],
        "cols_sectors": SECTORS,
    }


def main() -> None:
    snapshot = json.loads(SNAPSHOT_IN.read_text())
    mechs = {m["id"]: m["score"] for m in snapshot["mechanisms"]}

    bands = {k: band(v) for k, v in mechs.items()}
    stress_score = compute_stress_score(mechs)
    defensive_pct = compute_defensive_pct(stress_score)
    equity_pct = 1.0 - defensive_pct
    leverage = compute_leverage(mechs, defensive_pct, regime_flip=False)
    sectors = compute_sector_tilts(mechs, equity_pct)
    igs = compute_ig_tilts(mechs, sectors)
    contribution_matrix = compute_contribution_matrix(sectors, igs)

    # Defensive sleeve composition — equal-weight 4 buckets when active
    defensive = []
    if defensive_pct > 0:
        each = defensive_pct * 100 / 4
        for ticker, name in [("BIL", "Cash (1-3M Treasury)"), ("TLT", "Long Treasuries"),
                              ("GLD", "Gold"), ("LQD", "IG Corporate Bonds")]:
            defensive.append({"ticker": ticker, "name": name, "dollar": round(each, 2)})

    # Page-level stance label
    if stress_score >= 5: page_stance = "Risk Off"
    elif stress_score >= 3: page_stance = "Cautious"
    elif stress_score >= 1: page_stance = "Neutral"
    else: page_stance = "Risk On"

    out = {
        "as_of": snapshot["as_of"],
        "version": "v10.1c",
        "engine": "Phase 2 — 6-mechanism cycle-board allocator (tuned 2026-05-04)",
        "page_stance": page_stance,
        "mechanism_scores": mechs,
        "mechanism_bands": bands,
        "stress_score": stress_score,
        "equity_pct": round(equity_pct, 4),
        "defensive_pct": round(defensive_pct, 4),
        "leverage": leverage,
        "gross_exposure": round(equity_pct * leverage, 4),
        "sectors": sectors,
        "industry_groups": igs,
        "contribution_matrix": contribution_matrix,
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
