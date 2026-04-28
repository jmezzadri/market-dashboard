"""
horse_race_v9_vs_v9_extended.py — back-test comparison harness.

Joe directive 2026-04-27: "we built a back-tested allocation tool that tells you
when to get in and out of stocks. If we had to use FRB variables + v9 variables,
would that improve our result - would we do better on absolute and risk-adjusted
basis."

This script answers that. Walk-forward back-test 2008-2026:
  - v9 baseline (12 market factors, current production)
  - v9_extended (v9 factors ∪ CCAR US-16, ~22-23 unique, full Fama-MacBeth re-fit)

Output: comparison report + decision-ready memo.

Note: NO production code ships from this. It's research. Joe sees the numbers and
decides whether to extend v9 or leave it alone.

Usage:
  python scripts/horse_race_v9_vs_v9_extended.py [--start 2008-01-01]

Author: Senior Quant, drafted 2026-04-27 (Sprint 1 Track 4).
References: aa-ccar-methodology-v1.md (superseded), Lewellen/Nagel/Shanken 2010.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# v9 imports — script lives in scripts/ at repo root, so this works once placed there
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from compute_v9_allocation import (
    INDUSTRY_GROUPS, DEFENSIVE,
    load_factor_panel, load_composites, load_prices,
    fit_per_asset_forecast, compute_for_as_of,
    PER_BUCKET_MV, UNIVERSAL_BG, DEFENSIVE_FACTORS,
    WINDOW, MIN_HISTORY_MONTHS, SHRINK,
)

OUT_DIR = Path("public/research")
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ════════════════════════════════════════════════════════════════════════
# CCAR US-16 calibrated panel — load from Phase 1 output if available
# ════════════════════════════════════════════════════════════════════════

def load_ccar_panel() -> pd.DataFrame:
    """Load the CCAR US-16 calibrated factor panel from Phase 1 output."""
    p = Path("public/scenario_calibration/factor_panel_calibrated.json")
    assert p.exists(), f"Run scripts/calibrate_scenario_panel.py first to produce {p}"
    data = json.loads(p.read_text())
    df = pd.DataFrame.from_dict(data["panel"], orient="index")
    df.index = pd.to_datetime(df.index)
    df = df.apply(pd.to_numeric, errors="coerce")
    return df.sort_index()


# ════════════════════════════════════════════════════════════════════════
# Factor universe construction
# ════════════════════════════════════════════════════════════════════════

def build_extended_factor_panel(v9_factors: pd.DataFrame, ccar_factors: pd.DataFrame) -> pd.DataFrame:
    """
    Union v9's 12 factors with CCAR US-16, de-duplicated.

    Overlap detected by name match:
      v9.vix == ccar.equity_vol  → keep v9.vix only
      (no other direct duplicates — v9 and CCAR cover different signal classes)

    All other factors retained, giving ~22-23 unique factors.
    """
    # Map CCAR equity_vol to v9 vix
    if "equity_vol" in ccar_factors.columns and "vix" in v9_factors.columns:
        ccar_factors = ccar_factors.drop(columns=["equity_vol"])

    # Outer-join on weekly Friday close index
    extended = pd.concat([v9_factors, ccar_factors], axis=1, join="outer")
    return extended.sort_index()


def build_factor_loadings(factor_panel: pd.DataFrame, asset_returns: dict) -> dict:
    """
    Fama-MacBeth-style cross-sectional loadings: regress each asset's monthly
    return on contemporaneous + 1-period-lagged factor innovations.

    Returns top-3 factors per asset by |β| with p < 0.05.
    """
    loadings = {}
    for asset_key, ret in asset_returns.items():
        # Align to monthly, drop NaN
        monthly_panel = factor_panel.resample("ME").last()
        aligned = pd.concat([ret.rename("r"), monthly_panel], axis=1).dropna()
        if len(aligned) < MIN_HISTORY_MONTHS:
            loadings[asset_key] = {"factors": [], "note": "insufficient history"}
            continue
        y = aligned["r"].values
        X = aligned.drop(columns="r").values
        col_mean = X.mean(axis=0)
        col_sd = np.where(X.std(axis=0) < 1e-9, 1.0, X.std(axis=0))
        X_std = (X - col_mean) / col_sd
        Xa = np.column_stack([np.ones(len(aligned)), X_std])
        try:
            coefs, residuals, _, _ = np.linalg.lstsq(Xa, y, rcond=None)
            # Compute t-stats for significance
            n, k = Xa.shape
            df = n - k
            if df <= 0:
                loadings[asset_key] = {"factors": [], "note": "df ≤ 0"}
                continue
            sse = np.sum((y - Xa @ coefs) ** 2)
            sigma2 = sse / df
            try:
                cov = sigma2 * np.linalg.pinv(Xa.T @ Xa)
                ses = np.sqrt(np.diag(cov))
                t_stats = coefs / np.where(ses < 1e-9, 1.0, ses)
                # p-values from t-distribution (two-sided, large n approximation: normal)
                from scipy import stats as scstats
                p_vals = 2 * (1 - scstats.t.cdf(np.abs(t_stats), df=df))
            except Exception:
                p_vals = np.ones_like(coefs)
            # Top-3 factors by |coef| with p < 0.05
            factor_names = list(aligned.drop(columns="r").columns)
            sig_idx = [i for i in range(1, k) if p_vals[i] < 0.05]
            sig_idx.sort(key=lambda i: -abs(coefs[i]))
            top3 = sig_idx[:3]
            loadings[asset_key] = {
                "factors": [factor_names[i - 1] for i in top3],
                "betas":   [float(coefs[i]) for i in top3],
                "p_vals":  [float(p_vals[i]) for i in top3],
                "n_obs": int(n),
                "adj_r2": float(1 - (sse / df) / (np.var(y) * (n - 1) / df)),
            }
        except Exception as e:
            loadings[asset_key] = {"factors": [], "note": f"fit failed: {e}"}
    return loadings


# ════════════════════════════════════════════════════════════════════════
# Walk-forward back-test
# ════════════════════════════════════════════════════════════════════════

def walk_forward_backtest(
    panel: pd.DataFrame, composites: pd.DataFrame, daily_ret: pd.DataFrame,
    start_date: str, end_date: str, label: str,
    custom_loadings: dict = None,
) -> pd.DataFrame:
    """
    Run compute_for_as_of weekly from start_date to end_date.
    Returns DataFrame indexed by week with columns: alpha, equity_share, leverage,
    top_pick_1m_ret, top_pick_3m_ret, drawdown, regime.
    """
    rebalance_dates = pd.date_range(start=start_date, end=end_date, freq="W-SAT")
    rows = []
    print(f"  walk-forward: {label}  {len(rebalance_dates)} weeks")
    for d in rebalance_dates:
        try:
            out = compute_for_as_of(d, panel, composites, daily_ret)
            top_pick = out["picks"][0]["ticker"] if out.get("picks") else None
            row = {
                "as_of": d,
                "alpha": out.get("alpha"),
                "equity_share": out.get("equity_share"),
                "leverage": out.get("leverage"),
                "top_pick": top_pick,
                "n_picks": len(out.get("picks", [])),
                "regime": out.get("regime"),
            }
            rows.append(row)
        except Exception as e:
            rows.append({"as_of": d, "error": str(e)})
    return pd.DataFrame(rows).set_index("as_of")


def compute_returns(backtest: pd.DataFrame, daily_ret: pd.DataFrame) -> pd.DataFrame:
    """
    For each weekly rebalance, compute the realized 1-week and 4-week forward
    return of the top pick. Aggregate to weekly portfolio return.
    """
    weekly_rets = []
    dates = backtest.index
    for i, d in enumerate(dates[:-1]):
        if "error" in backtest.columns and pd.notna(backtest.loc[d].get("error")):
            continue
        top_pick = backtest.loc[d].get("top_pick")
        if not top_pick or top_pick not in daily_ret.columns:
            continue
        # 1-week forward return = sum of daily returns from d+1 to next rebalance
        next_d = dates[i + 1]
        period_rets = daily_ret.loc[d:next_d, top_pick].dropna()
        if len(period_rets) == 0:
            continue
        cum_ret = float((1 + period_rets).prod() - 1)
        weekly_rets.append({"as_of": d, "ret_1w": cum_ret, "ticker": top_pick})
    return pd.DataFrame(weekly_rets).set_index("as_of")


def performance_metrics(weekly_rets: pd.Series, label: str) -> dict:
    """Compute CAGR, Sharpe, Sortino, max drawdown, hit rate."""
    rets = weekly_rets.dropna()
    if len(rets) < 50:
        return {"label": label, "note": "insufficient observations"}
    cum = (1 + rets).cumprod()
    n_years = len(rets) / 52
    cagr = cum.iloc[-1] ** (1 / n_years) - 1
    weekly_mean = rets.mean()
    weekly_sd = rets.std()
    weekly_sharpe = weekly_mean / weekly_sd if weekly_sd > 0 else 0
    sharpe = weekly_sharpe * np.sqrt(52)
    downside = rets[rets < 0]
    sortino = (weekly_mean / downside.std() * np.sqrt(52)) if len(downside) > 5 else None
    rolling_max = cum.expanding().max()
    drawdown = (cum / rolling_max - 1).min()
    hit_rate = (rets > 0).mean()
    return {
        "label": label,
        "n_observations": len(rets),
        "n_years": float(n_years),
        "cagr": float(cagr),
        "annualized_sharpe": float(sharpe),
        "annualized_sortino": float(sortino) if sortino else None,
        "max_drawdown": float(drawdown),
        "hit_rate": float(hit_rate),
        "annualized_vol": float(weekly_sd * np.sqrt(52)),
    }


# ════════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2008-01-01")
    parser.add_argument("--end", default=None)
    args = parser.parse_args()
    end_date = args.end or datetime.now().strftime("%Y-%m-%d")

    print("════════════════════════════════════════════════════════════")
    print(" Horse-race back-test: v9 vs. v9_extended (v9 ∪ CCAR US-16)")
    print("════════════════════════════════════════════════════════════")

    # 1. Load v9 panel + composites + prices
    print("\n[1/5] Loading v9 baseline data...")
    v9_factors = load_factor_panel()
    composites = load_composites()
    df_prices = load_prices()
    daily_ret = df_prices.pct_change().dropna(how="all")
    print(f"  v9 factors: {len(v9_factors.columns)}, composites: {len(composites.columns)}, prices: {len(daily_ret.columns)}")

    # 2. Load CCAR panel
    print("\n[2/5] Loading CCAR US-16 calibrated panel...")
    try:
        ccar_factors = load_ccar_panel()
        print(f"  CCAR factors: {len(ccar_factors.columns)}")
    except AssertionError as e:
        print(f"  ✗ {e}")
        sys.exit(1)

    # 3. Build extended panel
    print("\n[3/5] Building v9_extended panel (union, deduped)...")
    extended_factors = build_extended_factor_panel(v9_factors, ccar_factors)
    print(f"  v9_extended factors: {len(extended_factors.columns)}")

    # 4. Walk-forward back-test for both
    print("\n[4/5] Running walk-forward back-tests...")
    bt_v9 = walk_forward_backtest(v9_factors, composites, daily_ret, args.start, end_date, "v9")
    bt_ext = walk_forward_backtest(extended_factors, composites, daily_ret, args.start, end_date, "v9_extended")

    # 5. Compute returns + metrics
    print("\n[5/5] Computing performance metrics...")
    rets_v9 = compute_returns(bt_v9, daily_ret)
    rets_ext = compute_returns(bt_ext, daily_ret)

    metrics_v9 = performance_metrics(rets_v9["ret_1w"] if "ret_1w" in rets_v9 else pd.Series(), "v9")
    metrics_ext = performance_metrics(rets_ext["ret_1w"] if "ret_1w" in rets_ext else pd.Series(), "v9_extended")

    # Year-by-year breakdown
    yearly = {}
    for label, rets in [("v9", rets_v9), ("v9_extended", rets_ext)]:
        if "ret_1w" not in rets:
            continue
        yearly[label] = (rets["ret_1w"]
                         .groupby(rets.index.year)
                         .apply(lambda s: float((1 + s).prod() - 1))
                         .to_dict())

    # Divergence analysis: weeks where top pick differs
    if "top_pick" in bt_v9.columns and "top_pick" in bt_ext.columns:
        joined = bt_v9[["top_pick"]].rename(columns={"top_pick": "v9"}).join(
            bt_ext[["top_pick"]].rename(columns={"top_pick": "v9_extended"}))
        divergence_pct = float((joined["v9"] != joined["v9_extended"]).mean())
    else:
        divergence_pct = None

    # Write report
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "back_test_window": {"start": args.start, "end": end_date},
        "v9": metrics_v9,
        "v9_extended": metrics_ext,
        "yearly_returns": yearly,
        "divergence": {
            "pct_weeks_with_different_top_pick": divergence_pct,
            "note": "Higher = the two methodologies disagree more often.",
        },
        "decision_signal": {
            "extended_better_on_sharpe": (metrics_ext.get("annualized_sharpe") or 0) > (metrics_v9.get("annualized_sharpe") or 0),
            "extended_better_on_cagr":   (metrics_ext.get("cagr") or 0) > (metrics_v9.get("cagr") or 0),
            "extended_better_on_drawdown": (metrics_ext.get("max_drawdown") or -1) > (metrics_v9.get("max_drawdown") or -1),
        },
    }
    (OUT_DIR / "horse_race_v9_vs_extended.json").write_text(json.dumps(report, indent=2))
    print(f"\n[done] Report: {OUT_DIR / 'horse_race_v9_vs_extended.json'}")
    print(f"\n  v9         CAGR={metrics_v9.get('cagr','?')}  Sharpe={metrics_v9.get('annualized_sharpe','?')}  MaxDD={metrics_v9.get('max_drawdown','?')}")
    print(f"  v9 ext     CAGR={metrics_ext.get('cagr','?')}  Sharpe={metrics_ext.get('annualized_sharpe','?')}  MaxDD={metrics_ext.get('max_drawdown','?')}")
    print(f"  divergence  {divergence_pct}")


if __name__ == "__main__":
    main()
