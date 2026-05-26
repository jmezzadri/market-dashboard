"""
paper_portfolio.backtest.historical_signals — readers for the historical
data the backtest harness replays.

Two sources, both already on disk in the repo (no Supabase round-trip):

  * Asset Tilt weekly returns — from public/macrotilt_engine_backtest.json.
    Field `asset_tilt_weekly_return` is the engine's own backtest of the
    IG-tilted allocation; 40 years of weekly observations. Locked
    calibration: "1986-2026 validated (locked 2026-05-13)".

  * Equity Scanner weekly snapshots — from v5_backtest_run_C.parquet.
    140K rows × 13 cols; one row per (scan_date, ticker) for ~3,000
    tickers over 52 weekly scans (2025-05-12 → 2026-05-04). Carries
    mt_score + band + fwd_return_21d + alpha_vs_spy.

V1 backtest window is the intersection of the two — 2025-05-12 →
2026-05-04, ~1 year. The Sleeve A return series exists for the full
40-year history but we truncate to the joint window so the combined
NAV path has both sleeves in scope at every date.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd


@dataclass(frozen=True)
class HistoricalScannerRow:
    scan_date: pd.Timestamp
    ticker: str
    mt_score: float
    buy_score: float           # normalized 0-10
    band: str
    fwd_return_21d: float      # the period return — used as Sleeve B's holding-period return
    alpha_vs_spy: float        # already net of SPY for that 21-day window


def load_asset_tilt_history(
    path: str | Path = "public/macrotilt_engine_backtest.json",
) -> pd.DataFrame:
    """Return a DataFrame indexed by date with columns:
        asset_tilt_weekly_return, spy_weekly_return, engine_weekly_return,
        asset_tilt_cumulative, spy_cumulative

    These are the engine's own backtest series — sleeve A's return path
    mirrors `asset_tilt_weekly_return`.
    """
    with open(path) as f:
        d = json.load(f)
    weekly = d.get("weekly", [])
    if not weekly:
        raise RuntimeError(f"No weekly entries in {path}")
    rows = []
    for w in weekly:
        rows.append({
            "date": pd.Timestamp(w["date"]),
            "asset_tilt_weekly_return": float(w.get("asset_tilt_weekly_return", 0.0)),
            "spy_weekly_return":        float(w.get("spy_weekly_return", 0.0)),
            "engine_weekly_return":     float(w.get("engine_weekly_return", 0.0)),
            "asset_tilt_cumulative":    float(w.get("asset_tilt_cumulative", 1.0)),
            "spy_cumulative":           float(w.get("spy_cumulative", 1.0)),
            "equity_pct":               float(w.get("equity_pct", 100)) / 100.0,
            "stress_state":             w.get("stress_state", ""),
        })
    df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
    df = df.set_index("date")
    return df


def load_scanner_history(
    path: str | Path = "v5_backtest_run_C.parquet",
    buy_threshold: float = 5.0,
) -> pd.DataFrame:
    """Load the v5 scanner backtest parquet and add a normalized buy_score
    column. Returns the full panel; the harness slices by scan_date as
    it walks the timeline."""
    df = pd.read_parquet(path)
    df["scan_date"] = pd.to_datetime(df["scan_date"])
    df["mt_score"] = pd.to_numeric(df["mt_score"], errors="coerce").fillna(0.0)
    df["buy_score"] = (df["mt_score"] / 10.0).clip(lower=0.0)
    df["fwd_return_21d"] = pd.to_numeric(df["fwd_return_21d"], errors="coerce")
    if "alpha_vs_spy" in df.columns:
        df["alpha_vs_spy"] = pd.to_numeric(df["alpha_vs_spy"], errors="coerce")
    # Only keep names that pass the buy threshold — every other row is
    # below the floor and would not produce a Sleeve B intent.
    return df[df["buy_score"] >= buy_threshold].reset_index(drop=True)


def scanner_dates(df: pd.DataFrame) -> list[pd.Timestamp]:
    """Sorted unique scan_dates."""
    return sorted(df["scan_date"].unique().tolist())


def scanner_snapshot_for_date(
    df: pd.DataFrame,
    scan_date: pd.Timestamp,
) -> pd.DataFrame:
    """Slice the historical panel to a single scan_date.

    Returns ticker, mt_score, buy_score, band, fwd_return_21d.
    """
    sub = df[df["scan_date"] == scan_date].copy()
    return sub[["ticker", "mt_score", "buy_score", "band", "fwd_return_21d"]]
