#!/usr/bin/env python3
"""
compute_composite_history.py — daily recompute for public/composite_history_daily.json.

Purpose
-------
Keeps the three Today's Macro composite dials current. Reads the existing
indicator history (already refreshed daily by INDICATOR-REFRESH workflow) plus
the per-composite indicator weights, computes EWMA z-scores per indicator,
weight-averages them per composite, and APPENDS any new trading-day rows to
public/composite_history_daily.json.

Bug #1036 background
--------------------
PR #110 shipped the three-composite TodayMacro page with composite_history_daily.json
seeded once. The "live recompute follow-up" was queued but never built — file went
stale, freshness layer went red. This script is that follow-up.

Methodology (matches TodayMacro.jsx page header)
------------------------------------------------
* Each indicator: forward-filled to daily, ±3σ winsorized on the raw value, then
  EWMA z-scored with 18-month half-life.
* Composite z = weighted average of indicator z-scores (weights from
  public/composite_weights.json), then x50 and clipped to ±100 for display score.
* SPX / DJI / NDX prices and daily % change pulled via yfinance.

Append-only — never rewrites historical rows. If we need to regenerate from
scratch, run with --rebuild. Default behavior is safe.

Run standalone:
    python3 compute_composite_history.py
Re-build full series (DESTRUCTIVE — replaces existing JSON):
    python3 compute_composite_history.py --rebuild

Exit codes:
    0 — wrote rows or already up to date
    1 — error reading inputs / yfinance failure
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent
PUBLIC = REPO_ROOT / "public"
INDICATOR_HISTORY = PUBLIC / "indicator_history.json"
COMPOSITE_WEIGHTS = PUBLIC / "composite_weights.json"
COMPOSITE_HISTORY = PUBLIC / "composite_history_daily.json"

# 18-month half-life in trading days (≈ 252 days/year × 1.5 years)
HALFLIFE_DAYS = 378
WINSORIZE_SIGMA = 3.0
SCORE_SCALE = 50
SCORE_CLIP = 100


# ───────────────────────────────────────────────────────────────────────
# EWMA z-score
# ───────────────────────────────────────────────────────────────────────


def ewma_zscore(series: pd.Series, halflife: float = HALFLIFE_DAYS) -> pd.Series:
    """EWMA z-score = (x - EWMA_mean) / EWMA_std, winsorized to ±3σ first.

    Winsorize is applied on the raw series before EWMA stats are taken so that
    a single outlier doesn't blow up the volatility estimate. Then the z-score
    itself is also clipped to ±3 before composite aggregation (per page docstring).
    """
    s = series.dropna().astype(float).copy()
    if len(s) < 30:
        return pd.Series(index=series.index, dtype=float)

    # Winsorize raw values at ±3σ from a static long-run mean/SD (full sample).
    # This is a one-pass robustness step; EWMA statistics still see the clipped
    # series so a 2008-style spike doesn't permanently distort the variance.
    long_mean = s.mean()
    long_sd = s.std(ddof=0)
    if long_sd == 0 or pd.isna(long_sd):
        return pd.Series(index=series.index, dtype=float)
    s_clipped = s.clip(
        lower=long_mean - WINSORIZE_SIGMA * long_sd,
        upper=long_mean + WINSORIZE_SIGMA * long_sd,
    )

    ewm = s_clipped.ewm(halflife=halflife, adjust=False)
    mu = ewm.mean()
    var = ewm.var(bias=False)
    sigma = var.pow(0.5).replace(0, pd.NA)

    z = (s_clipped - mu) / sigma
    z = z.clip(lower=-WINSORIZE_SIGMA, upper=WINSORIZE_SIGMA)

    # Re-index to full input index, forward-fill within the window we have
    return z.reindex(series.index).ffill()


# ───────────────────────────────────────────────────────────────────────
# Indicator → daily series
# ───────────────────────────────────────────────────────────────────────


def indicator_to_daily(points: list, calendar: pd.DatetimeIndex) -> pd.Series:
    """Convert [[date, value], ...] to a daily series on the trading calendar.

    Weekly / monthly indicators are forward-filled to daily.
    """
    if not points:
        return pd.Series(index=calendar, dtype=float)
    df = pd.DataFrame(points, columns=["date", "value"])
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    s = df["value"].astype(float)
    # Reindex to calendar, forward-filling stale values within natural release lag
    return s.reindex(calendar, method="ffill")


# ───────────────────────────────────────────────────────────────────────
# Build composite series
# ───────────────────────────────────────────────────────────────────────


def build_composite_series(
    indicator_history: dict, weights: dict, calendar: pd.DatetimeIndex
) -> pd.DataFrame:
    """Compute one column per composite (RL, GR, IR) on the trading calendar."""
    composite_keys = {
        "RL": "Risk & Liquidity",
        "GR": "Growth",
        "IR": "Inflation & Rates",
    }
    out = pd.DataFrame(index=calendar)

    for col, name in composite_keys.items():
        spec = weights.get(name, {})
        indicators = spec.get("indicators", [])
        if not indicators:
            out[col] = pd.NA
            continue

        weighted_z = pd.Series(0.0, index=calendar)
        weight_total = 0.0
        usable_mask = pd.Series(False, index=calendar)

        for ind in indicators:
            key = ind["key"]
            w = float(ind["weight"])
            ih = indicator_history.get(key)
            if not ih or "points" not in ih:
                continue
            daily = indicator_to_daily(ih["points"], calendar)
            z = ewma_zscore(daily)
            # Sign convention: every composite indicator is set up so that a
            # HIGH z-score = MORE STRESS in its category. The Risk & Liquidity
            # indicators (vix, anfci, stlfsi, cmdi) all go up when stress is
            # high — that's already the natural sign. Same for Inflation &
            # Rates (move, m2_yoy go up when inflation pressure builds).
            # Growth is the exception: the indicators (jobless, cfnai_3ma, bkx_spx)
            # mix directions. The composite_weights spec doesn't carry a sign field,
            # so we follow the page convention: positive composite = stress / risk-off,
            # negative = supportive. Per indicator semantics, jobless rises in stress
            # (natural sign), cfnai_3ma rises in growth (FLIP), bkx_spx rises with
            # banks outperforming SPX = healthy financials (FLIP).
            if key in {"cfnai_3ma", "bkx_spx"}:
                z = -z

            valid = z.notna()
            weighted_z = weighted_z.add(z.fillna(0) * w, fill_value=0)
            weight_total += w
            usable_mask = usable_mask | valid

        if weight_total > 0:
            comp = weighted_z / weight_total
        else:
            comp = pd.Series(pd.NA, index=calendar)

        # Score = z * 50, clipped to ±100. Null until we have at least one
        # contributing indicator on that date.
        score = (comp * SCORE_SCALE).clip(lower=-SCORE_CLIP, upper=SCORE_CLIP)
        score[~usable_mask] = pd.NA
        out[col] = score.round(1)

    return out


# ───────────────────────────────────────────────────────────────────────
# Price series (SPX / DJI / NDX)
# ───────────────────────────────────────────────────────────────────────


def fetch_prices(start: str, end: str) -> pd.DataFrame:
    """Pull daily close for ^GSPC / ^DJI / ^NDX via yfinance."""
    import yfinance as yf

    syms = {"SPX": "^GSPC", "DJI": "^DJI", "NDX": "^NDX"}
    out = {}
    for col, sym in syms.items():
        df = yf.download(
            sym, start=start, end=end, progress=False, auto_adjust=False, threads=False
        )
        if df.empty:
            raise RuntimeError(f"yfinance returned empty frame for {sym}")
        # yf may return MultiIndex columns when called with a list; here it's a single sym
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        out[col + "p"] = df["Close"].round(2)
        # daily % change
        out[col] = (df["Close"].pct_change() * 100).round(2)
    return pd.DataFrame(out)


# ───────────────────────────────────────────────────────────────────────
# Main
# ───────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--rebuild",
        action="store_true",
        help="Regenerate the entire history from scratch (DESTRUCTIVE)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change but don't touch the file",
    )
    ap.add_argument(
        "--output",
        type=str,
        default=None,
        help="Write to alternate path (for validation / testing)",
    )
    args = ap.parse_args()
    out_path = Path(args.output) if args.output else COMPOSITE_HISTORY

    # ── Load inputs ──
    try:
        indicator_history = json.loads(INDICATOR_HISTORY.read_text())
        weights = json.loads(COMPOSITE_WEIGHTS.read_text())
    except Exception as exc:
        print(f"[fatal] could not read inputs: {exc}", file=sys.stderr)
        return 1

    existing = []
    if COMPOSITE_HISTORY.exists():
        existing = json.loads(COMPOSITE_HISTORY.read_text())

    # ── Determine target calendar ──
    last_existing_date = (
        dt.date.fromisoformat(existing[-1]["d"]) if existing else dt.date(2005, 1, 3)
    )
    today = dt.date.today()

    if args.rebuild:
        start_date = dt.date(2005, 1, 3)
    else:
        # Append-only: start one day after last existing
        start_date = last_existing_date + dt.timedelta(days=1)

    if start_date > today:
        print(f"[ok] composite_history_daily.json already current "
              f"(last row {last_existing_date.isoformat()}, today {today.isoformat()})")
        return 0

    # Build a trading-day calendar via yfinance first (fetches SPX prices and
    # gives us the authoritative trading-day list in the same call).
    # Pull a buffer at the start so EWMA has warmup if rebuilding from 2005.
    fetch_start = start_date - dt.timedelta(days=14)
    fetch_end = today + dt.timedelta(days=1)  # yfinance end is exclusive
    print(f"[info] fetching prices {fetch_start} → {fetch_end} (exclusive)")
    try:
        price_df = fetch_prices(fetch_start.isoformat(), fetch_end.isoformat())
    except Exception as exc:
        print(f"[fatal] price fetch failed: {exc}", file=sys.stderr)
        return 1

    # Restrict to trading days at-or-after start_date
    calendar = price_df.index[price_df.index.date >= start_date]
    if len(calendar) == 0:
        print(f"[ok] no new trading days since {last_existing_date.isoformat()}")
        return 0

    # For EWMA we want the FULL history-aware calendar so warmup is correct.
    # Build the indicator daily panel on the entire span we have data for.
    earliest_indicator = min(
        (
            dt.date.fromisoformat(ih["points"][0][0])
            for ih in indicator_history.values()
            if isinstance(ih, dict) and ih.get("points")
        ),
        default=dt.date(2005, 1, 3),
    )
    full_calendar = pd.date_range(
        start=earliest_indicator, end=calendar.max().date(), freq="D"
    )
    composite_full = build_composite_series(indicator_history, weights, full_calendar)
    # Restrict to trading days that match price_df calendar
    composite_on_trading = composite_full.reindex(price_df.index)

    # ── Assemble new rows ──
    new_rows = []
    for ts in calendar:
        d_str = ts.date().isoformat()
        rl = composite_on_trading.at[ts, "RL"] if ts in composite_on_trading.index else None
        gr = composite_on_trading.at[ts, "GR"] if ts in composite_on_trading.index else None
        ir_ = composite_on_trading.at[ts, "IR"] if ts in composite_on_trading.index else None
        spx = price_df.at[ts, "SPX"] if ts in price_df.index else None
        spxp = price_df.at[ts, "SPXp"] if ts in price_df.index else None
        dji = price_df.at[ts, "DJI"] if ts in price_df.index else None
        djip = price_df.at[ts, "DJIp"] if ts in price_df.index else None
        ndx = price_df.at[ts, "NDX"] if ts in price_df.index else None
        ndxp = price_df.at[ts, "NDXp"] if ts in price_df.index else None

        def _f(x):
            if x is None or (isinstance(x, float) and pd.isna(x)) or pd.isna(x):
                return None
            return float(x)

        new_rows.append(
            {
                "d": d_str,
                "RL": _f(rl),
                "GR": _f(gr),
                "IR": _f(ir_),
                "SPX": _f(spx) if _f(spx) is not None else 0.0,
                "DJI": _f(dji) if _f(dji) is not None else 0.0,
                "NDX": _f(ndx) if _f(ndx) is not None else 0.0,
                "SPXp": _f(spxp),
                "DJIp": _f(djip),
                "NDXp": _f(ndxp),
            }
        )

    if not new_rows:
        print("[ok] nothing to append")
        return 0

    # ── Validation: if appending, our newest computed value should be a
    # smooth continuation of the existing series. Sanity check: print the
    # last existing row alongside the first new row so the operator can spot
    # discontinuities.
    if existing:
        print("[validate] last existing row:", existing[-1])
    print(f"[validate] first new row: {new_rows[0]}")
    print(f"[validate] last new row:  {new_rows[-1]}")
    print(f"[info] {len(new_rows)} new row(s) to write")

    if args.dry_run:
        print("[dry-run] not writing file")
        return 0

    if args.rebuild:
        merged = new_rows
    else:
        merged = existing + new_rows

    out_path.write_text(
        json.dumps(merged, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(f"[done] wrote {len(merged)} total rows to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
