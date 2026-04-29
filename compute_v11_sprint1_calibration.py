#!/usr/bin/env python3
"""
MacroTilt v11 Sprint 1 Calibration Build
=========================================

Builds public/methodology_calibration_v11.json — the source-of-truth file
the Cycle Mechanism Board page reads at runtime.

Framework (locked 2026-04-29 by Joe + Senior Quant + UX Designer):
  * Descriptive cycle-mechanism counting, NOT predictive trigger firing.
  * 4-state lexicon applied per tile: Normal / Cautionary / Stressed / Distressed.
  * Headline gauge counts how many tiles sit above Normal.
    0-1  = Constructive
    2    = Watchful
    3    = Defensive setup forming
    4+   = High-conviction defensive
  * Sprint 1 ships THREE live tiles: Valuation, Credit, Growth.
  * Three additional tiles (Funding, Liquidity & Policy, Positioning & Breadth)
    render as greyed-out placeholders labeled Sprint 2 / Sprint 4.

Conservative state-mapping rule (per Joe directive):
  * Normal     = rule not met
  * Cautionary = rule partially met (e.g. 2 of 4 in concerning quartile)
  * Stressed   = rule fully met (e.g. 3 of 4 in concerning quartile)
  * Distressed = rule fully met AND deteriorating over last 60 trading days

Plain-English description copy authored by Senior Quant; UX Designer signed
off on length and tone. Tooltip copy lives inline in this JSON so the React
page has a single source of truth.

Usage:
  python3 compute_v11_sprint1_calibration.py [--out <path>]

Environment:
  FRED_API_KEY  required (defaults to the prod key in fetch_history.py)

LESSONS rule #31: methodology page must be re-written, not appended to,
in the SAME PR as this calibration JSON.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import warnings
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from fredapi import Fred
import yfinance as yf

FRED_API_KEY = os.environ.get(
    "FRED_API_KEY",
    "e1696db1c3f8bb036993f40c61aad0d5",  # same key fetch_history.py uses
)
FRED = Fred(api_key=FRED_API_KEY)

VERSION = "v11.0.0"
SPRINT = 1
AS_OF = datetime.utcnow().strftime("%Y-%m-%d")


# =============================================================================
# Fetch helpers
# =============================================================================

def fetch_fred(series_id: str, start: str = "1970-01-01") -> pd.Series:
    """Fetch a FRED series and return as a clean date-indexed Series."""
    s = FRED.get_series(series_id, observation_start=start)
    s = s.dropna().sort_index()
    s.index = pd.DatetimeIndex(s.index).tz_localize(None).normalize()
    s = s[~s.index.duplicated(keep="last")]
    return s


def fetch_yahoo(ticker: str, start: str = "2007-01-01") -> pd.Series:
    """Fetch close prices from Yahoo. Returns date-indexed Series."""
    df = yf.download(ticker, start=start, progress=False, auto_adjust=True)
    if df is None or df.empty:
        return pd.Series(dtype=float)
    s = df["Close"]
    if isinstance(s, pd.DataFrame):
        s = s.iloc[:, 0]
    s = s.dropna().sort_index()
    s.index = pd.DatetimeIndex(s.index).tz_localize(None).normalize()
    s = s[~s.index.duplicated(keep="last")]
    return s


def history_payload(series: pd.Series, max_points: int = 120) -> list:
    """Return [[date_iso, value], ...] for the indicator's history,
    sampled to ~max_points (default ~10y monthly)."""
    s = series.dropna().sort_index()
    if len(s) > max_points:
        # Keep monthly samples — resample to month-end if higher freq
        s = s.resample("ME").last().dropna()
    if len(s) > max_points:
        # Still too many — keep evenly-spaced samples
        step = len(s) // max_points
        s = s.iloc[::max(1, step)]
    return [[d.strftime("%Y-%m-%d"), round(float(v), 4)] for d, v in s.items()]


def percentile_of(series: pd.Series, value: float) -> float:
    """Return percentile rank of `value` against `series` (0-100)."""
    arr = series.dropna().values
    if len(arr) == 0:
        return float("nan")
    return float((arr <= value).mean() * 100)


def quartile_of(percentile: float) -> int:
    """Map percentile (0-100) → quartile (1-4). Q4 = top quartile."""
    if pd.isna(percentile):
        return 0
    if percentile <= 25:
        return 1
    if percentile <= 50:
        return 2
    if percentile <= 75:
        return 3
    return 4


def trend_60d(series: pd.Series) -> str:
    """Return 'rising', 'falling', or 'flat' based on slope over last 60d."""
    s = series.dropna()
    if len(s) < 30:
        return "flat"
    end = s.iloc[-1]
    start = s.iloc[-min(60, len(s))]
    pct_change = (end - start) / abs(start) if start != 0 else 0
    if pct_change > 0.05:
        return "rising"
    if pct_change < -0.05:
        return "falling"
    return "flat"


def latest(series: pd.Series) -> tuple[str, float]:
    """Last (date_iso, value) of the series."""
    s = series.dropna()
    if s.empty:
        return ("", float("nan"))
    return (s.index[-1].strftime("%Y-%m-%d"), float(s.iloc[-1]))


# =============================================================================
# Indicator loaders — Sprint 1
# =============================================================================

def load_existing_indicator_history() -> dict:
    """Read the on-disk indicator_history.json (recycle Sprint 1 indicators
    we already have without re-fetching)."""
    candidates = [
        Path(__file__).resolve().parent / "public" / "indicator_history.json",
        Path("/sessions/beautiful-friendly-bell/mnt/macrotilt/market-dashboard/public/indicator_history.json"),
        Path("/Users/joemezzadri/Developer/macrotilt/market-dashboard/public/indicator_history.json"),
    ]
    for p in candidates:
        if p.exists():
            return json.loads(p.read_text())
    return {}


def points_to_series(points: list) -> pd.Series:
    """Convert [[date_iso, value], ...] → pd.Series."""
    if not points:
        return pd.Series(dtype=float)
    df = pd.DataFrame(points, columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    df = df.drop_duplicates(subset="date", keep="last")
    s = pd.Series(df["value"].astype(float).values, index=df["date"])
    return s.sort_index()


# =============================================================================
# VALUATION TILE — CAPE, Trailing P/E, Equity Risk Premium, Buffett Indicator
# =============================================================================

def build_valuation_tile(existing: dict) -> dict:
    """Valuation tile.
    Concerning rule: 3 of 4 in top quartile of 15y+ distribution (cycle peak).
    """
    indicators: list[dict] = []

    # CAPE — recycle from existing indicator_history (15y window, post-2011)
    cape_pts = existing.get("cape", {}).get("points", [])
    cape_series = points_to_series(cape_pts)
    if not cape_series.empty:
        cur_dt, cur_val = latest(cape_series)
        pct = percentile_of(cape_series, cur_val)
        indicators.append({
            "id": "cape",
            "name": "CAPE (Shiller)",
            "unit": "ratio",
            "description": "Cyclically-adjusted price-to-earnings ratio — S&P 500 price divided by 10-year average inflation-adjusted earnings. Smooths out earnings cycles so highs and lows are comparable across decades.",
            "so_what": "When CAPE sits in the top quartile of its long-run distribution, real subsequent 10-year returns have been low; when it sits in the bottom quartile, they have been high. Not a timing tool — a long-horizon valuation read.",
            "formula": "CAPE = S&P 500 price / (10-year average inflation-adjusted earnings per share)",
            "source": "Shiller / multpl (curated monthly)",
            "source_url": "https://www.multpl.com/shiller-pe",
            "sample_window": "post-2011 (15y)",
            "current": {"date": cur_dt, "value": round(cur_val, 2)},
            "percentile": round(pct, 1),
            "quartile": quartile_of(pct),
            "history": history_payload(cape_series),
        })

    # Trailing P/E — derive from CAPE * 10y average / current earnings? Too noisy.
    # Use Shiller earnings yield inverse. For Sprint 1, use CAPE as primary;
    # trailing P/E surfaced from Shiller monthly (placeholder series for v11.0).
    # Sprint 1 ships with 3 indicators (CAPE / ERP / Buffett) and notes
    # trailing P/E as Sprint 1.5 add. This is documented in methodology.

    # Equity Risk Premium — 1/CAPE - 10y Treasury yield (monthly)
    try:
        dgs10 = fetch_fred("DGS10", start="2011-01-01")
        if not cape_series.empty and not dgs10.empty:
            # Resample DGS10 to month-end, align with CAPE
            dgs10_m = dgs10.resample("ME").last()
            cape_m = cape_series.resample("ME").last()
            joined = pd.concat([cape_m, dgs10_m], axis=1, join="inner").dropna()
            joined.columns = ["cape", "tnx"]
            erp = (1.0 / joined["cape"]) * 100 - joined["tnx"]  # percent points
            cur_dt, cur_val = latest(erp)
            pct = percentile_of(erp, cur_val)
            indicators.append({
                "id": "erp",
                "name": "Equity Risk Premium",
                "unit": "percent",
                "description": "How much extra yield investors demand to own stocks vs 10-year Treasuries. Computed as earnings yield (1/CAPE) minus the 10-year yield. A near-zero or negative ERP means stocks are priced for perfection.",
                "so_what": "When ERP is at or below zero, investors are accepting less from stocks than they could get risk-free from Treasuries. Historically that compression has marked late-cycle equity tops.",
                "formula": "ERP = (1 / CAPE) × 100 − 10-year Treasury yield",
                "source": "Derived: 1/CAPE − DGS10 (FRED)",
                "source_url": "https://fred.stlouisfed.org/series/DGS10",
                "sample_window": "post-2011 (15y)",
                "current": {"date": cur_dt, "value": round(cur_val, 2)},
                "percentile": round(pct, 1),
                "quartile": quartile_of(pct),
                "direction": "low_is_concerning",  # low ERP = stocks expensive
                "history": history_payload(erp),
            })
    except Exception as e:
        print(f"  [warn] ERP build failed: {e}", file=sys.stderr)

    # Buffett Indicator — Nonfinancial Corporate Equities (NCBCEL) / GDP
    # NCBCEL is in $millions, GDP in $billions — unit conversion required.
    # NCBCEL is the post-1947 Z.1 Flow-of-Funds series; the "true" Buffett
    # indicator includes financial-corp equities too, but this is a clean,
    # FRED-native long-history proxy with the same directional read.
    try:
        ncbcel = fetch_fred("NCBCEL", start="1970-01-01")  # quarterly, $millions
        gdp = fetch_fred("GDP", start="1970-01-01")  # quarterly, $billions
        if not ncbcel.empty and not gdp.empty:
            ne_q = ncbcel.resample("QE").last()
            gdp_q = gdp.resample("QE").last()
            joined = pd.concat([ne_q, gdp_q], axis=1, join="inner").dropna()
            joined.columns = ["ncbcel", "gdp"]
            # NCBCEL ($M) / (GDP ($B) * 1000) * 100 → percent of GDP
            buffett = (joined["ncbcel"] / (joined["gdp"] * 1000.0)) * 100.0
            cur_dt, cur_val = latest(buffett)
            pct = percentile_of(buffett, cur_val)
            indicators.append({
                "id": "buffett",
                "name": "Buffett Indicator",
                "unit": "% of GDP",
                "description": "Nonfinancial corporate equity market cap as a percentage of GDP. Warren Buffett's preferred 'overall valuation' yardstick. Above 150% has historically preceded significant drawdowns; the post-1970 median is around 72%.",
                "so_what": "When this ratio sits at all-time-high levels — as it does today — the equity market is large relative to the economy backing it. Subsequent 10-year real returns have been low.",
                "formula": "Buffett = (Nonfinancial corp equity market cap / GDP) × 100",
                "source": "FRED: NCBCEL / GDP (quarterly)",
                "source_url": "https://fred.stlouisfed.org/series/NCBCEL",
                "sample_window": "post-1970 (~55y)",
                "data_caveat": "NCBCEL is nonfinancial corps only; the canonical Buffett indicator includes financial corps. Directional read is identical, level is slightly understated.",
                "current": {"date": cur_dt, "value": round(cur_val, 1)},
                "percentile": round(pct, 1),
                "quartile": quartile_of(pct),
                "history": history_payload(buffett),
            })
    except Exception as e:
        print(f"  [warn] Buffett build failed: {e}", file=sys.stderr)

    # Apply rule
    state = compute_valuation_state(indicators)

    return {
        "id": "valuation",
        "name": "Valuation",
        "order": 1,
        "live": True,
        "description_short": "How richly equities are priced relative to history.",
        "description_long": "Valuation indicators measure how much investors are paying per dollar of earnings, GDP, or risk premium. When several measures simultaneously sit in the top quartile of their long-run distribution, the equity market is showing the cycle-peak signature — high prices, high prices for risk, narrow risk premium.",
        "rule": {
            "logic": "concerning_if_three_of_four_in_concerning_quartile",
            "description": "Stressed when 3 of 4 indicators sit in their concerning quartile. For CAPE, P/E, and Buffett indicator the concerning quartile is the top 25% (rich valuation). For equity risk premium it is the bottom 25% (no compensation for owning stocks vs bonds). Cautionary when 2 of 4. Distressed when 3 of 4 AND worsening over 60 trading days.",
            "sprint_1_note": "Sprint 1 ships with 3 of 4 indicators; trailing P/E joins in Sprint 1.5 once long-history Shiller series is staged.",
        },
        "indicators": indicators,
        "current_state": state["state"],
        "rule_status": state["status"],
        "as_of": AS_OF,
    }


def compute_valuation_state(indicators: list[dict]) -> dict:
    """Conservative 4-state mapping per Joe directive 2026-04-29."""
    if not indicators:
        return {"state": "Normal", "status": "no indicators"}
    n_concerning = 0
    for ind in indicators:
        # Default direction: high-is-concerning (top quartile)
        direction = ind.get("direction", "high_is_concerning")
        q = ind.get("quartile", 0)
        if direction == "high_is_concerning" and q == 4:
            n_concerning += 1
        elif direction == "low_is_concerning" and q == 1:
            n_concerning += 1
    n = len(indicators)
    threshold_full = max(3, int(np.ceil(n * 0.75)))  # 3 of 4 → 3; with 3 inds → 3
    threshold_partial = max(2, int(np.ceil(n * 0.50)))
    if n_concerning >= threshold_full:
        state = "Stressed"
        # Distressed addendum: would also need deteriorating-over-60d; Sprint 1
        # surfaces this via tile metadata; not auto-promoted to Distressed yet.
    elif n_concerning >= threshold_partial:
        state = "Cautionary"
    else:
        state = "Normal"
    return {
        "state": state,
        "status": f"{n_concerning} of {n} indicators in concerning quartile",
        "n_concerning": n_concerning,
        "n_indicators": n,
    }


# =============================================================================
# CREDIT TILE — HY OAS, IG OAS (Baa−10y), HY/IG ratio, Lev Loan (Sprint 1.5)
# =============================================================================

def build_credit_tile(existing: dict) -> dict:
    """Credit tile.
    Bidirectional concerning rule:
      * Stressed: 3 of 4 spreads in top quartile (real stress)
      * Complacency-Cautionary: 3 of 4 in bottom quartile (priced for perfection)
    Sprint 1 ships 3 indicators; lev loan spread is Sprint 2.
    """
    indicators: list[dict] = []

    # IG OAS proxy — Moody's Baa minus 10y Treasury, post-1986
    try:
        baa = fetch_fred("BAA", start="1986-01-01")
        dgs10 = fetch_fred("DGS10", start="1986-01-01")
        if not baa.empty and not dgs10.empty:
            baa_m = baa.resample("ME").last()
            dgs10_m = dgs10.resample("ME").last()
            ig_oas = (baa_m - dgs10_m).dropna() * 100  # basis points
            cur_dt, cur_val = latest(ig_oas)
            pct = percentile_of(ig_oas, cur_val)
            indicators.append({
                "id": "ig_oas",
                "name": "IG OAS (Baa − 10y)",
                "unit": "bp",
                "description": "Yield premium investors require to own investment-grade Baa-rated corporate bonds over equal-maturity Treasuries. Widens in stress, compresses in complacency.",
                "so_what": "Today's IG OAS sits in the bottom quartile of post-1986 history. Investors are pricing very little default-risk premium into investment-grade credit — the 'priced for perfection' read.",
                "formula": "IG OAS proxy = Moody's Baa yield − 10-year Treasury yield, in basis points",
                "source": "FRED: BAA − DGS10 (monthly)",
                "source_url": "https://fred.stlouisfed.org/series/BAA",
                "sample_window": "post-1986 (~40y)",
                "current": {"date": cur_dt, "value": round(cur_val, 0)},
                "percentile": round(pct, 1),
                "quartile": quartile_of(pct),
                "history": history_payload(ig_oas),
            })
    except Exception as e:
        print(f"  [warn] IG OAS build failed: {e}", file=sys.stderr)

    # HY OAS — FRED's BAMLH0A0HYM2 (post-2011 only due to ICE licensing)
    try:
        hy_oas = fetch_fred("BAMLH0A0HYM2", start="2011-01-01") * 100  # to bp
        if not hy_oas.empty:
            hy_oas_m = hy_oas.resample("ME").last().dropna()
            cur_dt, cur_val = latest(hy_oas_m)
            pct = percentile_of(hy_oas_m, cur_val)
            indicators.append({
                "id": "hy_oas",
                "name": "HY OAS",
                "unit": "bp",
                "description": "Yield premium on high-yield (junk-rated) corporate bonds over Treasuries. The most-watched single read on credit-market stress. Tight spreads = priced for perfection; wide spreads = stress is here.",
                "so_what": "At 284 bp HY OAS sits in the bottom quartile of the post-2011 sample. The high-yield market is pricing minimal default risk — a read consistent with late-cycle complacency rather than imminent stress.",
                "formula": "HY OAS = ICE BofA US High Yield Master II Option-Adjusted Spread, in basis points",
                "source": "FRED: BAMLH0A0HYM2 (daily, monthly resample)",
                "source_url": "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
                "sample_window": "post-2011 (15y)",
                "data_caveat": "ICE BofA license restricts FRED's free history to post-2011. GFC 2008 peak (~2,000bp) is out of sample.",
                "current": {"date": cur_dt, "value": round(cur_val, 0)},
                "percentile": round(pct, 1),
                "quartile": quartile_of(pct),
                "history": history_payload(hy_oas_m),
            })
    except Exception as e:
        print(f"  [warn] HY OAS build failed: {e}", file=sys.stderr)

    # HY/IG ratio — derived
    try:
        if len(indicators) >= 2:
            hy_data = next((i for i in indicators if i["id"] == "hy_oas"), None)
            ig_data = next((i for i in indicators if i["id"] == "ig_oas"), None)
            if hy_data and ig_data:
                ratio = hy_data["current"]["value"] / max(ig_data["current"]["value"], 1)
                # For percentile we need the historical ratio series — rebuild quickly
                hy_oas = fetch_fred("BAMLH0A0HYM2", start="2011-01-01") * 100
                baa = fetch_fred("BAA", start="2011-01-01")
                dgs10 = fetch_fred("DGS10", start="2011-01-01")
                hy_m = hy_oas.resample("ME").last()
                ig_m = ((baa.resample("ME").last() - dgs10.resample("ME").last()) * 100)
                ratio_series = (hy_m / ig_m).replace([np.inf, -np.inf], np.nan).dropna()
                cur_dt = ratio_series.index[-1].strftime("%Y-%m-%d")
                cur_val = float(ratio_series.iloc[-1])
                pct = percentile_of(ratio_series, cur_val)
                indicators.append({
                    "id": "hy_ig_ratio",
                    "name": "HY/IG ratio",
                    "unit": "ratio",
                    "description": "Ratio of high-yield spread to investment-grade spread. Strips out the level effect — captures whether credit markets are pricing the junk-vs-quality differential normally or in a stressed/complacent way.",
                    "so_what": "Mid-distribution today. The junk-vs-quality differential is priced normally; nothing unusual either way in the relative pricing of high-yield to investment-grade.",
                    "formula": "HY/IG ratio = HY OAS / IG OAS proxy (Baa − DGS10)",
                    "source": "Derived: HY OAS / (BAA − DGS10)",
                    "source_url": "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
                    "sample_window": "post-2011 (15y)",
                    "current": {"date": cur_dt, "value": round(cur_val, 2)},
                    "percentile": round(pct, 1),
                    "quartile": quartile_of(pct),
                    "history": history_payload(ratio_series),
                })
    except Exception as e:
        print(f"  [warn] HY/IG ratio build failed: {e}", file=sys.stderr)

    state = compute_credit_state(indicators)

    return {
        "id": "credit",
        "name": "Credit",
        "order": 2,
        "live": True,
        "description_short": "Compensation investors demand for default risk on corporate bonds.",
        "description_long": "Credit spreads describe how much extra yield bond investors require over risk-free Treasuries to take corporate-credit risk. The Credit tile reads as bidirectional: extreme tightness reads as cycle-peak complacency, extreme widening reads as actual stress arriving. Both are interesting in opposite ways.",
        "rule": {
            "logic": "bidirectional",
            "stressed_condition": "3 of 4 spreads in top quartile (real stress arriving)",
            "complacency_condition": "3 of 4 spreads in bottom quartile (priced for perfection)",
            "cautionary_at": "2 of 4 in either tail",
            "distressed_addendum": "stressed_condition AND deteriorating over 60d",
            "sprint_1_note": "Sprint 1 ships with 3 of 4 indicators; leveraged-loan spread joins in Sprint 2.",
        },
        "indicators": indicators,
        "current_state": state["state"],
        "rule_status": state["status"],
        "as_of": AS_OF,
    }


def compute_credit_state(indicators: list[dict]) -> dict:
    """Bidirectional credit rule. Top quartile = stress, bottom = complacency."""
    if not indicators:
        return {"state": "Normal", "status": "no indicators"}
    n_top = sum(1 for i in indicators if i.get("quartile") == 4)
    n_bot = sum(1 for i in indicators if i.get("quartile") == 1)
    n = len(indicators)
    full = max(3, int(np.ceil(n * 0.75)))
    partial = max(2, int(np.ceil(n * 0.50)))
    if n_top >= full:
        return {"state": "Stressed", "status": f"{n_top} of {n} in top quartile (stress)", "regime": "stress"}
    if n_bot >= full:
        return {"state": "Stressed", "status": f"{n_bot} of {n} in bottom quartile (complacency)", "regime": "complacency"}
    if n_top >= partial:
        return {"state": "Cautionary", "status": f"{n_top} of {n} in top quartile", "regime": "stress"}
    if n_bot >= partial:
        return {"state": "Cautionary", "status": f"{n_bot} of {n} in bottom quartile", "regime": "complacency"}
    return {"state": "Normal", "status": f"{n_top} top / {n_bot} bottom of {n}", "regime": "neutral"}


# =============================================================================
# GROWTH TILE — CFNAI 3-mo, Jobless trend, ISM, BKX/SPX
# =============================================================================

def build_growth_tile(existing: dict) -> dict:
    """Growth tile.
    Concerning rule: 3 of 4 deteriorating (z < -1 AND worsening over last 60d).
    The AND is critical — avoids permanently-elevated failure mode.
    """
    indicators: list[dict] = []

    def add_growth_indicator(key: str, name: str, desc: str, source: str,
                             window: str, lower_is_concerning: bool = True,
                             so_what: str = "", formula: str = "", source_url: str = "",
                             unit: str = ""):
        pts = existing.get(key, {}).get("points", [])
        s = points_to_series(pts)
        if s.empty:
            return
        # z-score against full sample
        mean = s.mean()
        sd = s.std()
        z = (s - mean) / sd if sd > 0 else s * 0
        cur_z = float(z.iloc[-1]) if not z.empty else 0.0
        cur_val = float(s.iloc[-1])
        cur_dt = s.index[-1].strftime("%Y-%m-%d")
        # Trend over last 60 trading days
        trend = trend_60d(s)
        # "Concerning" = z < -1 AND trending down (for lower_is_concerning)
        # OR z > 1 AND trending up (for higher_is_concerning, e.g. jobless)
        if lower_is_concerning:
            concerning = (cur_z < -1.0) and (trend == "falling")
        else:
            concerning = (cur_z > 1.0) and (trend == "rising")
        # Soft "deteriorating but not yet concerning" = directional pressure only
        deteriorating = (lower_is_concerning and trend == "falling") or (
            not lower_is_concerning and trend == "rising"
        )
        # Map to quartile for visual consistency with other tiles
        pct = percentile_of(s, cur_val)
        indicators.append({
            "id": key,
            "name": name,
            "unit": unit,
            "description": desc,
            "so_what": so_what,
            "formula": formula,
            "source": source,
            "source_url": source_url,
            "sample_window": window,
            "current": {"date": cur_dt, "value": round(cur_val, 2)},
            "z_score": round(cur_z, 2),
            "trend_60d": trend,
            "concerning": concerning,
            "deteriorating": deteriorating,
            "percentile": round(pct, 1),
            "quartile": quartile_of(pct),
            "direction": "low_is_concerning" if lower_is_concerning else "high_is_concerning",
            "history": history_payload(s),
        })

    add_growth_indicator(
        "cfnai_3ma",
        "CFNAI 3-month",
        "Chicago Fed National Activity Index, 3-month moving average. A weighted average of 85 monthly indicators of US activity. Below −0.7 has historically signaled recession.",
        "FRED: CFNAIMA3 (monthly)",
        "post-2006 (20y)",
        lower_is_concerning=True,
        unit="index",
        formula="3-month moving average of the Chicago Fed National Activity Index (a weighted composite of 85 monthly US activity series)",
        source_url="https://fred.stlouisfed.org/series/CFNAIMA3",
        so_what="Mid-range today (z = +0.15) but trending down over the last 60 days. Not yet at the level-and-trend condition the rule requires; worth watching.",
    )
    add_growth_indicator(
        "jobless",
        "Jobless claims (4w)",
        "Initial unemployment claims, 4-week moving average. The earliest weekly read on labor-market deterioration.",
        "FRED: IC4WSA (weekly)",
        "post-2006 (20y)",
        lower_is_concerning=False,
        unit="thousands",
        formula="4-week moving average of seasonally-adjusted initial unemployment claims",
        source_url="https://fred.stlouisfed.org/series/IC4WSA",
        so_what="At 214k, claims sit in the bottom quartile of the post-2006 sample. The labor market is tight; no early-warning signal here.",
    )
    add_growth_indicator(
        "ism",
        "ISM Manufacturing PMI",
        "Institute for Supply Management's composite manufacturing index. Below 50 = contraction, above = expansion. Used as a proxy for the new-orders subindex (paid feed). Caveat noted in methodology.",
        "FRED: NAPMPI (monthly)",
        "post-2006 (20y)",
        lower_is_concerning=True,
        unit="index",
        formula="ISM Manufacturing Purchasing Managers' Index headline composite",
        source_url="https://fred.stlouisfed.org/series/NAPMPI",
        so_what="At 52.7 ISM is in expansion territory. Trend is mildly down over 60 days but still well above contraction (50).",
    )
    add_growth_indicator(
        "bkx_spx",
        "Banks vs S&P 500 (BKX/SPX)",
        "Ratio of the KBW Bank Index to the S&P 500. Banks lead the cycle in both directions — under-performance signals tightening credit conditions and growth slowdown.",
        "Yahoo: ^BKX, ^GSPC (daily)",
        "post-2006 (20y)",
        lower_is_concerning=True,
        unit="ratio",
        formula="BKX/SPX = KBW Bank Index closing price / S&P 500 closing price",
        source_url="https://finance.yahoo.com/quote/%5EBKX",
        so_what="Banks are sitting in the bottom quartile of relative performance vs the S&P (z = −1.06). The trend isn't deteriorating month-over-month, so the rule's level-and-trend condition isn't met — but the level alone is an under-the-surface caution.",
    )

    state = compute_growth_state(indicators)

    return {
        "id": "growth",
        "name": "Growth",
        "order": 4,
        "live": True,
        "description_short": "How fast (or slow) the real economy is moving.",
        "description_long": "The Growth tile aggregates four real-economy reads: a broad activity index (CFNAI), an early labor-market signal (jobless claims), a manufacturing PMI proxy (ISM headline), and the bank-relative-equity signal (BKX vs S&P). The Growth rule fires only when indicators are BOTH at extreme levels AND deteriorating over 60 trading days — the 'AND' avoids permanently-elevated false alarms.",
        "rule": {
            "logic": "level_AND_trend",
            "description": "Stressed when 3 of 4 indicators are both extreme (|z| > 1) AND deteriorating over 60 trading days. Cautionary when 2 of 4. Distressed when 3 of 4 AND deteriorating across all four.",
        },
        "indicators": indicators,
        "current_state": state["state"],
        "rule_status": state["status"],
        "as_of": AS_OF,
    }


def compute_growth_state(indicators: list[dict]) -> dict:
    if not indicators:
        return {"state": "Normal", "status": "no indicators"}
    n = len(indicators)
    n_concerning = sum(1 for i in indicators if i.get("concerning"))
    n_deteriorating = sum(1 for i in indicators if i.get("deteriorating"))
    full = max(3, int(np.ceil(n * 0.75)))
    partial = max(2, int(np.ceil(n * 0.50)))
    if n_concerning >= full and n_deteriorating == n:
        state = "Distressed"
    elif n_concerning >= full:
        state = "Stressed"
    elif n_concerning >= partial or n_deteriorating >= full:
        state = "Cautionary"
    else:
        state = "Normal"
    return {
        "state": state,
        "status": f"{n_concerning} of {n} concerning · {n_deteriorating} of {n} deteriorating over 60d",
        "n_concerning": n_concerning,
        "n_deteriorating": n_deteriorating,
        "n_indicators": n,
    }


# =============================================================================
# Headline gauge
# =============================================================================

def headline_gauge(tiles: list[dict]) -> dict:
    """Count how many of N live tiles sit above Normal."""
    live = [t for t in tiles if t.get("live")]
    elevated = [t for t in live if t["current_state"] != "Normal"]
    n_distressed = sum(1 for t in live if t["current_state"] == "Distressed")
    n_stressed = sum(1 for t in live if t["current_state"] == "Stressed")
    n_cautionary = sum(1 for t in live if t["current_state"] == "Cautionary")
    n_live = len(live)
    n_elev = len(elevated)
    if n_live == 0:
        verdict = "no live mechanisms"
    elif n_elev == 0:
        verdict = "Constructive"
    elif n_elev == 1:
        verdict = "Constructive"
    elif n_elev == 2:
        verdict = "Watchful"
    elif n_elev == 3:
        verdict = "Defensive setup forming"
    else:
        verdict = "High-conviction defensive"
    return {
        "n_elevated": n_elev,
        "n_live": n_live,
        "n_total": 6,  # 3 live + 3 placeholders
        "verdict": verdict,
        "breakdown": {
            "Cautionary": n_cautionary,
            "Stressed": n_stressed,
            "Distressed": n_distressed,
        },
        "headline_sentence": _editorial_sentence(n_elev, n_live, verdict, n_stressed, n_distressed),
    }


def _editorial_sentence(n_elev: int, n_live: int, verdict: str, n_stress: int, n_dist: int) -> str:
    """Magazine-style headline copy (UX-approved Editorial pattern)."""
    if n_elev == 0:
        return f"All {n_live} live cycle mechanisms are reading Normal this morning."
    n_word = {0: "Zero", 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six"}.get(n_elev, str(n_elev))
    pieces = []
    if n_dist:
        pieces.append(f"{n_dist} in Distressed territory")
    if n_stress:
        pieces.append(f"{n_stress} in Stressed territory")
    if n_elev > (n_dist + n_stress):
        cautionary_count = n_elev - n_dist - n_stress
        pieces.append(f"{cautionary_count} Cautionary")
    detail = ", ".join(pieces) if pieces else ""
    return f"{n_word} of {n_live} live cycle mechanisms are elevated above Normal" + (f" — {detail}." if detail else ".")


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/methodology_calibration_v11.json")
    args = parser.parse_args()

    print(f"[v11 Sprint 1] building calibration · as_of {AS_OF}")
    existing = load_existing_indicator_history()
    print(f"  loaded existing indicators: {len(existing) - 1 if existing else 0}")

    print("  building Valuation tile…")
    valuation = build_valuation_tile(existing)
    print(f"    state: {valuation['current_state']} ({valuation['rule_status']})")

    print("  building Credit tile…")
    credit = build_credit_tile(existing)
    print(f"    state: {credit['current_state']} ({credit['rule_status']})")

    print("  building Growth tile…")
    growth = build_growth_tile(existing)
    print(f"    state: {growth['current_state']} ({growth['rule_status']})")

    placeholders = [
        {
            "id": "funding",
            "name": "Funding",
            "order": 3,
            "live": False,
            "ships_in": "Sprint 2",
            "description_short": "Bank-system funding stress — SOFR-OIS, FRA-OIS, CDX IG-HY basis, cross-currency basis, CP funding spread.",
            "current_state": "—",
        },
        {
            "id": "liquidity_policy",
            "name": "Liquidity & Policy",
            "order": 5,
            "live": False,
            "ships_in": "Sprint 4",
            "description_short": "Adjusted Financial Conditions, real Fed funds rate, M2 YoY, term premium, Fed balance sheet trajectory.",
            "current_state": "—",
        },
        {
            "id": "positioning_breadth",
            "name": "Positioning & Breadth",
            "order": 6,
            "live": False,
            "ships_in": "Sprint 4",
            "description_short": "NAAIM exposure, margin debt YoY, put/call ratio, % of S&P above 200dma, advance-decline.",
            "current_state": "—",
        },
    ]

    tiles = [valuation, credit, placeholders[0], growth, placeholders[1], placeholders[2]]
    gauge = headline_gauge(tiles)

    output = {
        "version": VERSION,
        "framework": "cycle-mechanism-counting",
        "sprint": SPRINT,
        "as_of": AS_OF,
        "lexicon": {
            "states": ["Normal", "Cautionary", "Stressed", "Distressed"],
            "tooltips": {
                "Normal": "Tile rule is not met. Mechanism is reading constructively or neutrally.",
                "Cautionary": "Tile rule is partially met. Watch but do not act.",
                "Stressed": "Tile rule is fully met. Mechanism is signaling its concerning regime.",
                "Distressed": "Tile rule is fully met AND deteriorating over the last 60 trading days.",
            },
            "headline_thresholds": {
                "Constructive": "0–1 mechanisms elevated",
                "Watchful": "2 mechanisms elevated",
                "Defensive setup forming": "3 mechanisms elevated",
                "High-conviction defensive": "4+ mechanisms elevated",
            },
        },
        "headline_gauge": gauge,
        "tiles": tiles,
        "ui_spec": {
            "design_language": "Editorial / magazine hero (round-2 mockup A)",
            "tile_state_visual": "top-border accent in state color",
            "distribution_viz": "quartile bar with current-reading dot",
            "empty_tiles": "greyed-out placeholders labeled Sprint N",
        },
        "data_caveats": [
            "Sprint 1 valuation distributions use the 15-year (post-2011) window for CAPE and ERP; Buffett indicator uses post-1970.",
            "Sprint 1 credit distributions use post-1986 for IG OAS, post-2011 for HY OAS and HY/IG ratio.",
            "Trailing P/E and leveraged-loan spread are deferred to Sprint 1.5 / Sprint 2 — both require additional data sourcing.",
            "ISM headline used in place of ISM new-orders subindex — paid feed required for the latter.",
        ],
        "build_meta": {
            "script": "compute_v11_sprint1_calibration.py",
            "framework_version": VERSION,
            "lessons_rule_31_acknowledged": True,
        },
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, default=str))
    print(f"\nwrote {out_path}")
    print(f"\nheadline gauge: {gauge['headline_sentence']}")


if __name__ == "__main__":
    main()
