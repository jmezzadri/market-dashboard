#!/usr/bin/env python3
"""
compute_macrotilt_engine.py — daily/weekly compute for the MacroTilt 2-axis
regime engine.

This is the production version of the engine validated 2026-05-13 over the
1986-2026 window (Sharpe 0.61, max drawdown 35.0% vs SPY's 54.6%).

Reads:
  - public/indicator_history.json  (spliced MOVE series; 2002-11-12 onward)
  - FRED DGS10                     (10Y Treasury yield; pulled live)

Writes:
  - public/macrotilt_engine.json   (regime state, yield regime, active
                                     defensive sleeve, equity %, as-of,
                                     next-refresh, percentile reads, source
                                     attribution — consumed by Macro Overview
                                     page, Asset Tilt page, and the home tile)

Schedule: Friday 15:45 ET (19:45 UTC standard time / 20:45 UTC during DST)
via .github/workflows/macrotilt-engine-daily.yml. Also runs daily on weekdays
to keep the as-of stamp current and catch mid-week vol spikes.

ENGINE SPEC (locked 2026-05-13 — do not change without re-validation):

  AXIS 1 — STRESS SIGNAL (drives the de-risking decision)
    Source:           ICE BofA MOVE Index (Yahoo ^MOVE), 2002-11-12 onward
    Pre-2002 proxy:   21-day rolling std of DGS10 daily changes x sqrt(252),
                      Z-score-standardized. Not used in live production
                      (live engine only reads trailing 5y, which is well
                      inside the 2002+ actual MOVE window).
    Rule:             trailing 5-year percentile, weekly Friday close
                        < 75th pctile  -> Risk On     (100% equity)
                       75-85th pctile  -> Watch       (80% equity / 20% defensive)
                        >= 85th pctile -> Risk Off    (50% equity / 50% defensive)

  AXIS 2 — YIELD DIRECTION (selects defensive sleeve when de-risked)
    Source:           10Y Treasury yield (FRED DGS10)
    Computation:      trailing 3-month change in yield (in basis points)
    Rule:             trailing 5-year percentile of the 3-month change
                        >= 70th pctile -> Inflationary
                        <= 30th pctile -> Deflationary
                        in between     -> Neutral
    Display:          delta_y_3m_bp_live — the same 3-month change computed
                      on the raw DAILY yield (not Friday-resampled) so the dial
                      headline moves every trading day. Display-only; the regime
                      classification above always uses the weekly read.

  DEFENSIVE SLEEVE (regime-dependent)
    Inflationary:   50% cash, 30% GLD, 20% SHY, 0% TLT  (avoid duration)
    Deflationary:   25% cash, 25% GLD, 0% SHY, 50% TLT  (lean into FTQ)
    Neutral:        50% cash, 25% GLD, 0% SHY, 25% TLT  (balanced)

  REBALANCE
    Cadence: weekly Friday close, execute following Monday open.
"""
from __future__ import annotations

import json
import os
import sys
import datetime as dt
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

# ── Paths ────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
INDICATOR_HISTORY = REPO_ROOT / "public" / "indicator_history.json"
SNAPSHOT_OUT = REPO_ROOT / "public" / "macrotilt_engine.json"

# ── Engine constants (LOCKED) ────────────────────────────────────────
WATCH_PCTILE = 0.75
RISK_OFF_PCTILE = 0.85
INFLATIONARY_PCTILE = 0.70
DEFLATIONARY_PCTILE = 0.30
ROLLING_YEARS = 5
MIN_OBS_WEEKLY = 52  # at least one year of weekly data before producing a read

ALLOCATION = {
    "Risk On":  {"equity_pct": 100, "defensive_pct": 0},
    "Watch":    {"equity_pct": 80,  "defensive_pct": 20},
    "Risk Off": {"equity_pct": 50,  "defensive_pct": 50},
}

# Defensive sleeve compositions sum to 1.0 within the defensive bucket.
DEFENSIVE_SLEEVE = {
    "Inflationary": {"cash": 0.50, "GLD": 0.30, "SHY": 0.20, "TLT": 0.00},
    "Deflationary": {"cash": 0.25, "GLD": 0.25, "SHY": 0.00, "TLT": 0.50},
    "Neutral":      {"cash": 0.50, "GLD": 0.25, "SHY": 0.00, "TLT": 0.25},
}

# FRED — 10Y Treasury constant maturity yield
FRED_API_KEY_DEFAULT = "e1696db1c3f8bb036993f40c61aad0d5"
DGS10_SERIES_ID = "DGS10"


# ── Data loaders ─────────────────────────────────────────────────────

def load_move_series() -> pd.Series:
    """Load spliced MOVE series from indicator_history.json (2002-11-12+)."""
    data = json.loads(INDICATOR_HISTORY.read_text())
    pts = data["move"]["points"]
    df = pd.DataFrame(pts, columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"])
    s = df.set_index("date")["value"].sort_index()
    # Defensive: drop rows before 2002-11-12 if any made it in
    s = s.loc[s.index >= "2002-11-12"]
    return s


def fetch_dgs10_series(api_key: str, since: str = "2018-01-01") -> pd.Series:
    """Fetch DGS10 from FRED. Pulls from `since` to today; we only need
    trailing ~5y + 3-month buffer to compute the engine for the current week.

    Uses FRED's REST endpoint directly (no fredapi dependency).
    """
    import urllib.request, urllib.parse
    params = {
        "series_id": DGS10_SERIES_ID,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": since,
    }
    url = "https://api.stlouisfed.org/fred/series/observations?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    obs = payload.get("observations", [])
    rows = [(o["date"], o["value"]) for o in obs if o.get("value") not in (".", "", None)]
    df = pd.DataFrame(rows, columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = df["value"].astype(float)
    return df.set_index("date")["value"].sort_index()


# ── Transforms ───────────────────────────────────────────────────────

def to_weekly_friday(s: pd.Series) -> pd.Series:
    """Resample a daily series to weekly Friday close. If a Friday is missing
    (holiday), fall back to the most-recent prior business day."""
    # forward-fill within the week, then take Friday
    daily = s.asfreq("B").ffill()
    weekly = daily.resample("W-FRI").last().dropna()
    return weekly


def trailing_pctile(weekly: pd.Series, asof: pd.Timestamp,
                    years: int = ROLLING_YEARS) -> tuple[Optional[float], int]:
    """Trailing N-year percentile rank of the value at `asof` within the window."""
    start = asof - pd.DateOffset(years=years)
    window = weekly.loc[(weekly.index > start) & (weekly.index <= asof)]
    if len(window) < MIN_OBS_WEEKLY:
        return None, len(window)
    current = float(weekly.loc[asof])
    rank = float((window <= current).mean())
    return rank, len(window)


def threshold_value(weekly: pd.Series, asof: pd.Timestamp, q: float,
                    years: int = ROLLING_YEARS) -> Optional[float]:
    """Value at the q-th percentile of the trailing N-year window."""
    start = asof - pd.DateOffset(years=years)
    window = weekly.loc[(weekly.index > start) & (weekly.index <= asof)]
    if len(window) < MIN_OBS_WEEKLY:
        return None
    return float(window.quantile(q))


# ── Engine logic ─────────────────────────────────────────────────────

def classify_stress(move_pctile: float) -> str:
    if move_pctile >= RISK_OFF_PCTILE:
        return "Risk Off"
    if move_pctile >= WATCH_PCTILE:
        return "Watch"
    return "Risk On"


def classify_yield_regime(delta_pctile: float) -> str:
    if delta_pctile >= INFLATIONARY_PCTILE:
        return "Inflationary"
    if delta_pctile <= DEFLATIONARY_PCTILE:
        return "Deflationary"
    return "Neutral"


def next_friday_after(d: dt.date) -> dt.date:
    """Next Friday strictly after `d`. If d is a Friday, returns d+7."""
    days_ahead = (4 - d.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return d + dt.timedelta(days=days_ahead)


def compute_engine() -> dict:
    # Stress signal — MOVE
    move_daily = load_move_series()
    move_weekly = to_weekly_friday(move_daily)

    # Yield filter — DGS10 from FRED
    api_key = os.environ.get("FRED_API_KEY", FRED_API_KEY_DEFAULT)
    # Pull enough history for a 5y + 3-month rolling window with comfortable buffer
    dgs10_daily = fetch_dgs10_series(api_key, since="2018-01-01")
    dgs10_weekly = to_weekly_friday(dgs10_daily)
    # 3-month change in yield = current minus value 13 weeks ago, in bp (yield is in pct)
    delta_y_3m = (dgs10_weekly - dgs10_weekly.shift(13)) * 100.0  # pct -> bp
    delta_y_3m = delta_y_3m.dropna()

    # ── Live (daily) ΔY-3M — display headline only ───────────────────────
    # The regime CALL above is computed on Friday closes; that weekly
    # smoothing is deliberate and is what the 1986-2026 backtest validated.
    # But the NUMBER shown on the dial should move every trading day, the
    # way the MOVE dial already does (Joe directive 2026-05-22). So we also
    # compute a daily ΔY-3M off the raw DGS10 series: latest yield minus the
    # yield ~3 months (91 calendar days = the same 13-week horizon) earlier.
    # This never feeds the regime classification — display only.
    dgs10_bday = dgs10_daily.asfreq("B").ffill().dropna()
    delta_y_3m_live_bp = None
    live_as_of_iso = None
    if len(dgs10_bday) > 0:
        live_date = dgs10_bday.index.max()
        live_yield = float(dgs10_bday.loc[live_date])
        anchor_date = live_date - pd.Timedelta(days=91)
        anchor_window = dgs10_bday.loc[:anchor_date]
        if len(anchor_window) > 0:
            anchor_yield = float(anchor_window.iloc[-1])
            delta_y_3m_live_bp = round((live_yield - anchor_yield) * 100.0, 1)
            live_as_of_iso = live_date.date().isoformat()

    # Determine the most-recent COMPLETED Friday common to both series.
    # We deliberately exclude the in-progress current week so a mid-week run
    # reports the same regime that the prior Friday's production run did.
    today = pd.Timestamp(dt.date.today())
    common_idx = move_weekly.index.intersection(delta_y_3m.index)
    common_idx = common_idx[common_idx <= today]
    if len(common_idx) == 0:
        raise RuntimeError("No completed Friday close common to MOVE and DGS10 ΔY-3M")
    asof = common_idx.max()

    # Percentile reads
    move_value = float(move_weekly.loc[asof])
    move_pct, move_n = trailing_pctile(move_weekly, asof)
    watch_thr_val = threshold_value(move_weekly, asof, WATCH_PCTILE)
    risk_off_thr_val = threshold_value(move_weekly, asof, RISK_OFF_PCTILE)

    delta_value = float(delta_y_3m.loc[asof])
    delta_pct, delta_n = trailing_pctile(delta_y_3m, asof)
    inflationary_thr = threshold_value(delta_y_3m, asof, INFLATIONARY_PCTILE)
    deflationary_thr = threshold_value(delta_y_3m, asof, DEFLATIONARY_PCTILE)

    if move_pct is None or delta_pct is None:
        raise RuntimeError(
            f"Insufficient history for percentile read "
            f"(move_n={move_n}, delta_n={delta_n}; need >= {MIN_OBS_WEEKLY})"
        )

    stress_state = classify_stress(move_pct)
    yield_regime_state = classify_yield_regime(delta_pct)
    alloc = ALLOCATION[stress_state]
    sleeve_comp = DEFENSIVE_SLEEVE[yield_regime_state]

    snapshot = {
        "_doc": (
            "MacroTilt 2-axis regime engine. Axis 1 (stress) drives the de-risking "
            "decision from MOVE percentile. Axis 2 (yield direction) selects the "
            "defensive sleeve when de-risked. Validated 1986-2026 (Sharpe 0.61, max "
            "drawdown 35.0% vs SPY's 54.6%). Refreshed weekly Friday 15:45 ET by "
            "scripts/compute_macrotilt_engine.py via "
            ".github/workflows/macrotilt-engine-daily.yml."
        ),
        "framework": "MacroTilt 2-axis engine",
        "calibration_label": "1986-2026 validated (locked 2026-05-13)",
        "as_of": asof.date().isoformat(),
        "next_refresh": next_friday_after(asof.date()).isoformat(),
        "stress": {
            "state": stress_state,
            "move_value": round(move_value, 1),
            "move_percentile_5y": round(move_pct, 3),
            "watch_threshold_value": round(watch_thr_val, 1) if watch_thr_val is not None else None,
            "risk_off_threshold_value": round(risk_off_thr_val, 1) if risk_off_thr_val is not None else None,
            "trailing_window_weeks": move_n,
        },
        "yield_regime": {
            "state": yield_regime_state,
            "delta_y_3m_bp": round(delta_value, 1),
            "delta_y_3m_bp_live": delta_y_3m_live_bp,
            "live_as_of": live_as_of_iso,
            "delta_y_3m_percentile_5y": round(delta_pct, 3),
            "inflationary_threshold_bp": round(inflationary_thr, 1) if inflationary_thr is not None else None,
            "deflationary_threshold_bp": round(deflationary_thr, 1) if deflationary_thr is not None else None,
            "trailing_window_weeks": delta_n,
        },
        "allocation": {
            "equity_pct": alloc["equity_pct"],
            "defensive_pct": alloc["defensive_pct"],
            "active_sleeve_label": yield_regime_state,
            "active_sleeve_composition": sleeve_comp,
        },
        "sources": {
            "stress_signal": "ICE BofA MOVE Index via Yahoo (^MOVE)",
            "stress_signal_pre_2002_proxy": "21-day rolling std of DGS10 daily changes x sqrt(252), Z-standardized (validation only; not used live)",
            "yield_filter": "10-year Treasury constant maturity via FRED (DGS10)",
        },
    }
    return snapshot


def main() -> None:
    snapshot = compute_engine()
    SNAPSHOT_OUT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_OUT.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {SNAPSHOT_OUT}")
    s = snapshot
    print(f"  As of: {s['as_of']}  (next refresh: {s['next_refresh']})")
    print(f"  Stress state:    {s['stress']['state']:<10}  "
          f"MOVE={s['stress']['move_value']:>5}  pct5y={s['stress']['move_percentile_5y']:.3f}  "
          f"(75th={s['stress']['watch_threshold_value']}, 85th={s['stress']['risk_off_threshold_value']})")
    print(f"  Yield regime:    {s['yield_regime']['state']:<10}  "
          f"DY3M={s['yield_regime']['delta_y_3m_bp']:>+5}bp  pct5y={s['yield_regime']['delta_y_3m_percentile_5y']:.3f}  "
          f"(70th={s['yield_regime']['inflationary_threshold_bp']}bp, 30th={s['yield_regime']['deflationary_threshold_bp']}bp)")
    if s['yield_regime'].get('delta_y_3m_bp_live') is not None:
        print(f"  Yield (live):    DY3M={s['yield_regime']['delta_y_3m_bp_live']:>+5}bp  "
              f"(daily display value, as of {s['yield_regime']['live_as_of']})")
    sleeve_status = "active" if s['allocation']['defensive_pct'] > 0 else "standby (Risk On)"
    print(f"  Allocation:      {s['allocation']['equity_pct']}% equity / "
          f"{s['allocation']['defensive_pct']}% defensive")
    sl = s['allocation']['active_sleeve_composition']
    legs = [f"{int(v*100)}% {k}" for k, v in sl.items() if v > 0]
    print(f"  Sleeve ({sleeve_status:>16}): {s['allocation']['active_sleeve_label']} -> {' · '.join(legs)}")


if __name__ == "__main__":
    main()
