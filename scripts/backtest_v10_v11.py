#!/usr/bin/env python3
"""
backtest_v10_v11.py — point-in-time backtest harness for v10.1c allocator.

For each month-end 2012-01 through 2026-03, this script:
  1. Computes the six v11 cycle-mechanism scores using indicator_history.json data
     available through that month-end (no lookahead). Uses the same direction-corrected
     percentile scoring as compute_v11_mechanisms.py.
  2. Runs the v10.1c allocator decision rules from compute_v10_allocation.py to produce
     equity / defensive / leverage / 11 sector weights / 4 defensive weights.
  3. Applies those weights to the next month's sector ETF returns (yfinance).
  4. Aggregates month-by-month returns into CAGR, Sharpe, max drawdown, calendar-year
     wins vs SPY, and percentage of months at 100% equity.

Outputs:
  - public/backtest_v10_v11_summary.json — headline numbers for site consumers
  - PHASE2_V10_BACKTEST.md regenerated copy at the repo root

Usage:
  python scripts/backtest_v10_v11.py
"""
from __future__ import annotations
import json
import datetime as dt
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf

REPO_ROOT = Path(__file__).resolve().parent.parent
INDICATOR_HISTORY = REPO_ROOT / "public" / "indicator_history.json"
CALIB_PATH = REPO_ROOT / "public" / "methodology_calibration_v11.json"
SUMMARY_OUT = REPO_ROOT / "public" / "backtest_v10_v11_summary.json"

# Production sensitivity matrix from compute_v10_allocation.py — kept in sync manually.
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
SECTORS = list(SECTOR_SENSITIVITY.keys())
PRIMARY_ETF = {
    "Information Technology": "XLK", "Communication Services": "XLC", "Financials": "XLF",
    "Health Care": "XLV", "Consumer Discretionary": "XLY", "Industrials": "XLI",
    "Consumer Staples": "XLP", "Energy": "XLE", "Materials": "XLB", "Real Estate": "XLRE",
    "Utilities": "XLU",
}
DEFENSIVE_ETFS = ["BIL", "TLT", "GLD", "LQD"]
SPY_WEIGHTS = {
    "Information Technology": 0.27, "Communication Services": 0.10, "Financials": 0.135,
    "Health Care": 0.11, "Consumer Discretionary": 0.105, "Industrials": 0.085,
    "Consumer Staples": 0.06, "Energy": 0.038, "Materials": 0.022, "Real Estate": 0.025,
    "Utilities": 0.025,
}

# Sprint 1 indicators (mapped to indicator_history.json keys + direction code).
CALIB_MAPPING: Dict[str, List[Tuple[str, str]]] = {
    "valuation": [
        ("cape", "high_is_concerning"),
        ("erp", "low_is_concerning"),
        ("buffett", "high_is_concerning"),
    ],
    "credit": [
        ("ig_oas", "bidir_bottom"),
        ("hy_ig_etf", "bidir_bottom"),
        ("hy_ig_ratio", "bidir_top"),
    ],
    "growth": [
        ("cfnai_3ma", "low_is_concerning"),
        ("ic4wsa", "high_is_concerning"),
        ("ism", "low_is_concerning"),
        ("bkx_spx", "low_is_concerning"),
    ],
}

# Sprint 2 panels — matches PANELS in scripts/compute_v11_mechanisms.py.
SPRINT2_PANELS: Dict[str, List[Tuple[str, str]]] = {
    "funding": [
        ("cpff", "high_is_concerning"),
        ("stlfsi", "high_is_concerning"),
        ("bank_reserves", "low_is_concerning"),
        ("rrp", "low_is_concerning"),
    ],
    "liquidity_policy": [
        ("anfci", "high_is_concerning"),
        ("fed_bs", "low_is_concerning"),
        ("sloos_ci", "high_is_concerning"),
        ("m2_yoy", "low_is_concerning"),
    ],
    "positioning_breadth": [
        ("skew", "high_is_concerning"),
        ("vix", "high_is_concerning"),
        ("eq_cr_corr", "high_is_concerning"),
        ("move", "high_is_concerning"),
    ],
}


def direction_corrected(percentile: float, direction: str) -> float:
    d = (direction or "high_is_concerning").lower()
    if d in ("low_is_concerning", "bidir_bottom"):
        return 100.0 - percentile
    return percentile


def percentile_of(value: float, sorted_sample: List[float]) -> float:
    n = len(sorted_sample)
    if n == 0:
        return 50.0
    below = sum(1 for v in sorted_sample if v < value)
    return below / n * 100.0


def indicator_score_at(history_key: str, direction: str, history: dict, asof_date: str,
                        window_start: str = "2011-01-01") -> Optional[float]:
    if history_key not in history:
        return None
    pts = history[history_key].get("points", [])
    pts = [(d, v) for d, v in pts if v is not None and d <= asof_date and d >= window_start]
    if len(pts) < 12:
        return None
    sample = sorted(v for _, v in pts)
    latest = pts[-1][1]
    pct = percentile_of(latest, sample)
    return direction_corrected(pct, direction)


def mechanism_scores_at(asof_date: str, history: dict) -> Dict[str, Optional[int]]:
    """Compute all six mechanism scores at a given month-end, no lookahead."""
    scores: Dict[str, Optional[int]] = {}
    all_panels = {**CALIB_MAPPING, **SPRINT2_PANELS}
    for mech_id, indicators in all_panels.items():
        contribs = []
        for key, direction in indicators:
            s = indicator_score_at(key, direction, history, asof_date)
            if s is not None:
                contribs.append(s)
        scores[mech_id] = round(sum(contribs) / len(contribs)) if contribs else None
    return scores


# ---- v10.1c allocator (replicates compute_v10_allocation.py decision rules) ----
def stress_score(scores: Dict[str, int]) -> int:
    s = 0
    for m in ("credit", "liquidity_policy", "positioning_breadth"):
        sc = scores.get(m)
        if sc is None:
            continue
        if sc >= 75:
            s += 2
        elif sc >= 50:
            s += 1
    return s


def defensive_pct(stress: int) -> float:
    if stress < 4:
        return 0.0
    return min(0.50, (stress - 3) * 0.20)


def leverage_factor(scores: Dict[str, int], def_pct: float) -> float:
    if def_pct > 0:
        return 1.0
    if all(scores.get(m, 50) < 50 for m in scores):
        return 1.25
    return 1.0


def sector_weights(scores: Dict[str, int]) -> Dict[str, float]:
    raws = {}
    for sec in SECTORS:
        sens = SECTOR_SENSITIVITY[sec]
        tilt = sum(sens[m] * ((scores.get(m, 50) - 50) / 50) for m in sens)
        if tilt > 0.3:
            mult = 1.20
        elif tilt < -0.3:
            mult = 0.75
        else:
            mult = 1.00
        raws[sec] = SPY_WEIGHTS[sec] * mult
    total = sum(raws.values())
    return {sec: w / total for sec, w in raws.items()}


def allocate(scores: Dict[str, int]) -> Tuple[Dict[str, float], float, float, float, int]:
    s = stress_score(scores)
    def_p = defensive_pct(s)
    eq_p = 1.0 - def_p
    lev = leverage_factor(scores, def_p)
    sec_w = sector_weights(scores)
    out = {PRIMARY_ETF[sec]: w * eq_p * lev for sec, w in sec_w.items()}
    if def_p > 0:
        for d in DEFENSIVE_ETFS:
            out[d] = def_p / 4
    return out, eq_p, def_p, lev, s


# ---- Aggregate metrics ----
def cagr(monthly_returns: pd.Series) -> float:
    cum = float((1 + monthly_returns).prod())
    yrs = len(monthly_returns) / 12
    return cum ** (1 / yrs) - 1


def sharpe(monthly_returns: pd.Series) -> float:
    return float(monthly_returns.mean() / monthly_returns.std() * np.sqrt(12))


def max_drawdown(monthly_returns: pd.Series) -> float:
    cum = (1 + monthly_returns).cumprod()
    peak = cum.cummax()
    return float((cum / peak - 1).min())


# ---- Main ----
def main():
    print(f"[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] backtest_v10_v11.py starting")
    history = json.loads(INDICATOR_HISTORY.read_text())

    tickers = list(PRIMARY_ETF.values()) + DEFENSIVE_ETFS + ["SPY"]
    print(f"  fetching monthly returns for {len(tickers)} tickers...")
    data = yf.download(tickers, start="2010-01-01", end="2026-04-30",
                        interval="1mo", auto_adjust=True, progress=False)
    prices = data["Close"]
    returns = prices.pct_change().dropna(how="all")

    rows = []
    months_at_100 = 0
    for i, asof in enumerate(returns.index[:-1]):
        if asof < pd.Timestamp("2012-01-01") or asof > pd.Timestamp("2026-03-31"):
            continue
        scores = mechanism_scores_at(asof.strftime("%Y-%m-%d"), history)
        if any(scores.get(m) is None for m in ("credit", "liquidity_policy", "positioning_breadth")):
            continue
        # Default missing non-stress mechs to neutral 50
        for k in list(scores.keys()):
            if scores[k] is None:
                scores[k] = 50
        weights, eq_p, def_p, lev, ss = allocate(scores)
        if eq_p == 1.0 and lev == 1.0:
            months_at_100 += 1
        next_idx = returns.index[i + 1]
        next_ret = returns.loc[next_idx]
        port_ret = sum(w * next_ret.get(t, 0.0) for t, w in weights.items()
                       if not pd.isna(next_ret.get(t, 0.0)))
        spy_ret = float(next_ret.get("SPY", 0.0)) if not pd.isna(next_ret.get("SPY", 0.0)) else 0.0
        rows.append({"month": next_idx.strftime("%Y-%m"), "v10": port_ret, "spy": spy_ret,
                     "stress": ss, "eq_pct": eq_p, "def_pct": def_p, "lev": lev})

    df = pd.DataFrame(rows)
    v10 = df["v10"]; spy = df["spy"]
    df["year"] = df["month"].str[:4]
    yearly = df.groupby("year").apply(
        lambda g: pd.Series({"v10": (1 + g["v10"]).prod() - 1,
                             "spy": (1 + g["spy"]).prod() - 1}),
        include_groups=False,
    )
    yearly["delta_pp"] = (yearly["v10"] - yearly["spy"]) * 100
    yearly["win"] = yearly["delta_pp"] > 0

    summary = {
        "as_of": dt.date.today().isoformat(),
        "engine": "v10.1c",
        "window": f"{df['month'].iloc[0]} → {df['month'].iloc[-1]} ({len(df)} months)",
        "v10": {
            "cagr_pct": round(cagr(v10) * 100, 2),
            "sharpe": round(sharpe(v10), 3),
            "max_dd_pct": round(max_drawdown(v10) * 100, 2),
            "calendar_wins": int(yearly["win"].sum()),
            "calendar_total": len(yearly),
            "months_at_100_equity_pct": round(months_at_100 / len(df) * 100, 0),
        },
        "spy": {
            "cagr_pct": round(cagr(spy) * 100, 2),
            "sharpe": round(sharpe(spy), 3),
            "max_dd_pct": round(max_drawdown(spy) * 100, 2),
        },
        "yearly": [
            {"year": y, "v10_pct": round(yearly.loc[y, "v10"] * 100, 2),
             "spy_pct": round(yearly.loc[y, "spy"] * 100, 2),
             "delta_pp": round(yearly.loc[y, "delta_pp"], 2),
             "win": bool(yearly.loc[y, "win"])}
            for y in yearly.index
        ],
    }
    SUMMARY_OUT.write_text(json.dumps(summary, indent=2) + "\n")

    print()
    print(f"v10.1c   CAGR={summary['v10']['cagr_pct']:.2f}%  Sharpe={summary['v10']['sharpe']:.3f}  "
          f"MaxDD={summary['v10']['max_dd_pct']:.2f}%  Wins={summary['v10']['calendar_wins']}/"
          f"{summary['v10']['calendar_total']}")
    print(f"SPY      CAGR={summary['spy']['cagr_pct']:.2f}%  Sharpe={summary['spy']['sharpe']:.3f}  "
          f"MaxDD={summary['spy']['max_dd_pct']:.2f}%")
    print(f"At 100% equity: {summary['v10']['months_at_100_equity_pct']:.0f}% of months")
    print(f"\nWrote {SUMMARY_OUT}")


if __name__ == "__main__":
    main()
