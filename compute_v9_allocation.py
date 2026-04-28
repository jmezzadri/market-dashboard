#!/usr/bin/env python3
"""
compute_v9_allocation.py — production calibration of v9 strategy.

Reads:
  - public/indicator_history.json  (existing daily indicator panel)
  - public/composite_history_daily.json  (Risk & Liquidity / Growth / Inflation & Rates)
  - Live FRED + Yahoo data for missing factors
  - yfinance for daily ETF prices

Writes:
  - public/v9_allocation.json  (current allocation with picks, weights, regime state)

Designed to run nightly via INDICATOR-REFRESH_7AM_WEEKDAYS workflow. Reads
the same data files maintained by that workflow plus pulls a few extra
factors directly from FRED (no API key needed).

Methodology: see asset-allocation-methodology-v9-LOCKED.md.
"""

from __future__ import annotations
import json
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

# ────────────────────────────────────────────────────────────────────────────
# Universe
# ────────────────────────────────────────────────────────────────────────────

EQUITY = {
    "IGV":  {"name": "Software",          "fund": "iShares Software ETF"},
    "SOXX": {"name": "Semiconductors",    "fund": "iShares Semiconductor ETF"},
    "IBB":  {"name": "Biotech",           "fund": "iShares Biotechnology ETF"},
    "XLF":  {"name": "Financials",        "fund": "SPDR Financials Select Sector"},
    "XLV":  {"name": "HealthCare",        "fund": "SPDR Health Care Select Sector"},
    "XLI":  {"name": "Industrials",       "fund": "SPDR Industrials Select Sector"},
    "XLE":  {"name": "Energy",            "fund": "SPDR Energy Select Sector"},
    "XLY":  {"name": "ConsDisc",          "fund": "SPDR Consumer Discretionary"},
    "XLP":  {"name": "ConsStaples",       "fund": "SPDR Consumer Staples"},
    "XLU":  {"name": "Utilities",         "fund": "SPDR Utilities"},
    "XLB":  {"name": "Materials",         "fund": "SPDR Materials"},
    "IYR":  {"name": "RealEstate",        "fund": "iShares US Real Estate ETF"},
    "IYZ":  {"name": "CommSvcs",          "fund": "iShares US Telecommunications"},
    "MGK":  {"name": "MegaCapGrowth",     "fund": "Vanguard Mega-Cap Growth ETF"},
}
DEFENSIVE = {
    "BIL": "SPDR 1-3 Month Treasury Bill ETF (cash proxy)",
    "TLT": "iShares 20+ Year Treasury Bond ETF (long duration)",
    "GLD": "SPDR Gold Shares",
    "LQD": "iShares Investment Grade Corporate Bond ETF",
}

# Factor maps locked from v8 multivariate analysis (extended for MGK)
PER_BUCKET_MV = {
    "Software":       ["jobless", "m2_yoy", "industrial_prod"],
    "Semiconductors": ["copper_gold"],
    "Biotech":        ["jobless"],
    "Financials":     ["anfci", "capacity_util"],
    "HealthCare":     ["jobless", "sloos_ci"],
    "Industrials":    ["jobless", "stlfsi", "vix", "breakeven_10y"],
    "Energy":         ["jobless", "sloos_cre"],
    "ConsDisc":       ["jobless", "natgas_henry"],
    "ConsStaples":    ["sloos_ci", "jobless"],
    "Utilities":      ["sloos_ci"],
    "Materials":      ["jobless", "stlfsi", "vix", "breakeven_10y", "skew"],
    "RealEstate":     ["anfci", "capacity_util"],
    "CommSvcs":       ["sloos_ci", "vix", "capacity_util", "real_rates", "anfci", "cpff"],
    "MegaCapGrowth":  ["jobless", "real_rates", "breakeven_10y", "vix"],
}
UNIVERSAL_BG = ["yield_curve", "term_premium"]

DEFENSIVE_FACTORS = {
    "BIL": ["yield_curve", "fed_funds"],
    "TLT": ["yield_curve", "term_premium", "real_rates"],
    "GLD": ["copper_gold", "real_rates"],
    "LQD": ["yield_curve", "term_premium"],
}

# ────────────────────────────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────────────────────────────

WINDOW = 60               # months for regression
MOMENTUM_WINDOW = 6       # months
SHRINK = 0.5
RF_ANN = 0.04
RF_M = (1 + RF_ANN)**(1/12) - 1
LEV_FIN_M = (1.005)**(1/12) - 1
DEF_CAP = 0.70
N_PICKS = 5
RL_FLIP_THRESHOLD = -15

REPO_ROOT = Path(__file__).resolve().parent
PUBLIC = REPO_ROOT / "public"

# Extra factors not in indicator_history.json — pulled live from FRED CSV
FRED_EXTRAS = {
    "fed_funds":      "DFF",
    "industrial_prod":"INDPRO",
    "capacity_util":  "TCU",
    "natgas_henry":   "DHHNGSP",
}

# ────────────────────────────────────────────────────────────────────────────
# Data loaders
# ────────────────────────────────────────────────────────────────────────────


def load_factor_panel():
    """Combine indicator_history.json + live FRED extras."""
    out = {}
    ih = json.loads((PUBLIC / "indicator_history.json").read_text())
    for k, blob in ih.items():
        if k == "__meta__": continue
        pts = blob.get("points", [])
        if not pts: continue
        s = pd.Series([v for _, v in pts], index=pd.to_datetime([d for d, _ in pts]))
        out[k] = s.astype(float)

    # Live FRED CSV pulls (no API key needed)
    for label, sid in FRED_EXTRAS.items():
        if label in out: continue  # already have it
        try:
            url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2001-01-01"
            df = pd.read_csv(url)
            df.columns = ["date", "value"]
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date")
            df["value"] = pd.to_numeric(df["value"], errors="coerce")
            out[label] = df["value"].dropna()
        except Exception as e:
            print(f"  [warn] FRED pull failed for {label}: {e}")

    return pd.DataFrame(out).ffill().dropna(how="all")


def load_composites():
    cd = json.loads((PUBLIC / "composite_history_daily.json").read_text())
    df = pd.DataFrame(cd)
    df["d"] = pd.to_datetime(df["d"])
    return df.set_index("d")[["RL", "GR", "IR"]].astype(float)


# ────────────────────────────────────────────────────────────────────────────
# Math
# ────────────────────────────────────────────────────────────────────────────


def per_bucket_factors(name):
    return list(dict.fromkeys(UNIVERSAL_BG + PER_BUCKET_MV.get(name, [])))


def fit_per_asset_forecast(asset_returns, factor_panel, factor_names, *, forecast_X_override=None):
    """Fit r[T] ~ factor[T-1] regression and forecast the next month's return.

    Parameters
    ----------
    asset_returns : pd.Series
        Monthly returns for one asset (no index gaps relative to factor_panel).
    factor_panel : pd.DataFrame
        Monthly factor values; rows must be sorted by date.
    factor_names : list[str]
        Subset of columns to use as features.
    forecast_X_override : dict[str, float] | None
        If provided, the forecast feature row is taken from this dict (in
        NATIVE units, same scale as factor_panel) instead of the last
        observed feature row. Used by Scenario Analysis to apply a stressed
        factor panel without re-fitting the regression on stressed data
        (which would corrupt the calibration).
    """
    cols = [c for c in factor_names if c in factor_panel.columns]
    if not cols: return None
    X = factor_panel[cols].shift(1)
    aligned = pd.concat([asset_returns.rename("r"), X], axis=1).dropna()
    if len(aligned) < 24: return None
    y_arr = aligned["r"].values
    X_raw = aligned.drop(columns="r").values
    col_mean = X_raw.mean(axis=0); col_sd = X_raw.std(axis=0)
    col_sd = np.where(col_sd < 1e-9, 1.0, col_sd)
    X_std = (X_raw - col_mean) / col_sd
    Xa = np.column_stack([np.ones(len(aligned)), X_std])
    try: coefs, *_ = np.linalg.lstsq(Xa, y_arr, rcond=None)
    except: return None

    if forecast_X_override is not None:
        # Use stressed feature vector — fall back to last observed for any factor
        # not present in the override dict.
        last_obs = aligned.drop(columns="r").iloc[-1]
        last_X_raw = np.array([
            float(forecast_X_override.get(c, last_obs[c])) for c in cols
        ])
    else:
        last_X_raw = aligned.drop(columns="r").iloc[-1].values

    last_X_std = (last_X_raw - col_mean) / col_sd
    raw = coefs[0] + coefs[1:] @ last_X_std
    long_run = float(asset_returns.mean())
    return float((1 - SHRINK) * raw + SHRINK * long_run)


def equity_share_from_RL(rl):
    if rl <= 20: return 1.0
    if rl <= 30: return 1.0 - (rl - 20) * 0.015
    if rl <= 50: return 0.85 - (rl - 30) * 0.0125
    return 0.60


def leverage_from_IR(ir):
    if ir > 30: return 1.0
    if ir > 0:  return 1.0 + (1 - ir/30) * 0.10
    if ir > -10: return 1.10 + (-ir/10) * 0.15
    if ir > -50: return 1.25 + min(1, (-ir-10)/40) * 0.25
    return 1.50


def max_sharpe(mu, sigma, cap, rf):
    from scipy.optimize import minimize
    import math
    n = len(mu)
    def neg(w): return -(w @ mu - rf) / max(1e-12, math.sqrt(w @ sigma @ w))
    res = minimize(neg, np.ones(n)/n, method="SLSQP",
                   bounds=[(0, cap)] * n,
                   constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1}])
    return res.x if res.success else np.ones(n)/n


def select_picks(avail_e, mu_dict, mom_dict, regime_flip):
    n = len(avail_e)
    if n < N_PICKS: return [(t, 1/n) for t in avail_e], "TOO_SMALL"

    mu_arr = np.array([mu_dict[t] for t in avail_e])
    indicator_ranks = (-mu_arr).argsort().argsort() + 1

    if regime_flip:
        indexed = sorted([(t, indicator_ranks[i]) for i, t in enumerate(avail_e)],
                         key=lambda x: x[1])
        picks = [(t, 1/N_PICKS) for t, _ in indexed[:N_PICKS]]
        return picks, "FLIP_OVERRIDE"

    mom_arr = np.array([mom_dict.get(t, 0) for t in avail_e])
    momentum_ranks = (-mom_arr).argsort().argsort() + 1
    median = n / 2

    eligible, indicator_only = [], []
    for i, t in enumerate(avail_e):
        ind_top = indicator_ranks[i] <= median
        mom_top = momentum_ranks[i] <= median
        combined = indicator_ranks[i] + momentum_ranks[i]
        if ind_top and mom_top:
            eligible.append((t, combined, indicator_ranks[i], momentum_ranks[i]))
        elif ind_top:
            indicator_only.append((t, combined, indicator_ranks[i], momentum_ranks[i]))
    eligible.sort(key=lambda x: x[1])
    indicator_only.sort(key=lambda x: x[1])

    if len(eligible) >= N_PICKS:
        return [(t, 1/N_PICKS, ind_r, mom_r) for t, _, ind_r, mom_r in eligible[:N_PICKS]], "STRONG"
    picks = eligible[:]
    n_short = N_PICKS - len(picks)
    picks += indicator_only[:n_short]
    if len(picks) < N_PICKS:
        return [(t, 1/len(picks), ind_r, mom_r) for t, _, ind_r, mom_r in picks], "PARTIAL"
    return [(t, 1/N_PICKS, ind_r, mom_r) for t, _, ind_r, mom_r in picks], "MIXED"


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────


def load_all_data():
    """Load every input compute_allocation_from_data needs.

    Pulled out of main() so the Scenario Analysis precompute script can re-use
    one data load across many stressed scenarios. Network calls happen here
    (FRED + yfinance), the compute path is pure.
    """
    print("  loading factor panel...")
    factors = load_factor_panel()
    print(f"    {len(factors.columns)} factors, latest: {factors.index[-1].date()}")

    print("  loading composites...")
    composites = load_composites()
    print(f"    composites latest: {composites.index[-1].date()}")

    print("  pulling daily ETF prices (yfinance)...")
    tickers = list(EQUITY) + list(DEFENSIVE)
    df = yf.download(tickers, start="2003-01-01", progress=False, auto_adjust=True, threads=True)
    if isinstance(df.columns, pd.MultiIndex): df = df["Close"]
    daily_ret = df.pct_change().dropna(how="all")
    monthly_ret = daily_ret.resample("ME").apply(lambda x: (1 + x).prod() - 1)
    return factors, composites, monthly_ret


def compute_allocation_from_data(
    factors,
    composites,
    monthly_ret,
    *,
    factor_overrides=None,
    composite_overrides=None,
    scenario_id=None,
    scenario_name=None,
    quiet=False,
):
    """Pure compute path. Same v9 logic as main(); inputs are pre-loaded.

    Sprint 2 (Scenario Analysis L4 panel) calls this with `factor_overrides`
    and `composite_overrides` populated to produce a stressed allocation.

    Parameters
    ----------
    factors, composites, monthly_ret
        Outputs of `load_all_data()`.
    factor_overrides : dict[str, float] | None
        Replaces the LAST monthly observation of each named factor before the
        per-asset return regressions run. Use to apply a stressed v9 factor
        panel produced by `asset_allocation.ccar_translation.translate_ccar_to_v9`.
    composite_overrides : dict[str, float] | None
        Optional keys 'RL' / 'GR' / 'IR' replace the latest composite values
        used for equity_share + leverage sizing. Sprint 2 v1 leaves this None
        (composites held at current); Sprint 2.5 will derive composite stress
        from the factor stress.
    scenario_id, scenario_name : str | None
        If provided, recorded under `out["scenario"]` for downstream UI display.
    quiet : bool
        Suppress print output (precompute loops over 8+ scenarios).

    Returns
    -------
    dict
        Same shape as the existing v9_allocation.json.
    """
    log = (lambda *a, **k: None) if quiet else print

    # Use latest complete month for rebalance
    today = pd.Timestamp.today()
    last_complete_month = monthly_ret.index[-2] if today.day < 28 else monthly_ret.index[-1]
    idx = monthly_ret.index.get_loc(last_complete_month)
    if idx < WINDOW:
        raise RuntimeError(f"Not enough history: idx={idx}, need >={WINDOW}")

    log(f"  rebalance date: {last_complete_month.date()}")

    win = monthly_ret.iloc[idx-WINDOW:idx]
    monthly_factors = factors.resample("ME").last().dropna(how="all")
    wf = monthly_factors.loc[:last_complete_month].copy()

    # Factor overrides flow into the forecast via fit_per_asset_forecast's
    # `forecast_X_override` parameter — we do NOT mutate the factor panel itself
    # because that would change the regression's mean/std (calibration). The
    # regression coefficients stay fit on real history; only the forecast
    # feature vector gets stressed.
    if factor_overrides:
        applied = [k for k in factor_overrides if k in wf.columns]
        log(f"    factor overrides will be applied to {len(applied)} factors at forecast time")

    monthly_comp = composites.resample("ME").last().dropna()

    # Forecast each asset
    log("  forecasting per-asset μ...")
    mu = {}
    for tkr in EQUITY:
        if tkr not in win.columns or win[tkr].dropna().shape[0] < 24: continue
        f = fit_per_asset_forecast(
            win[tkr], wf, per_bucket_factors(EQUITY[tkr]["name"]),
            forecast_X_override=factor_overrides,
        )
        if f is not None: mu[tkr] = f
    for tkr in DEFENSIVE:
        if tkr not in win.columns or win[tkr].dropna().shape[0] < 24: continue
        f = fit_per_asset_forecast(
            win[tkr], wf, DEFENSIVE_FACTORS[tkr],
            forecast_X_override=factor_overrides,
        )
        if f is not None: mu[tkr] = f

    avail_e = [t for t in EQUITY if t in mu]
    avail_d = [t for t in DEFENSIVE if t in mu]
    log(f"    forecasts ready: {len(avail_e)} equity, {len(avail_d)} defensive")

    # Momentum
    mom = {}
    for t in EQUITY:
        if t not in monthly_ret.columns: continue
        w = monthly_ret[t].iloc[max(0, idx - MOMENTUM_WINDOW):idx]
        if len(w) >= MOMENTUM_WINDOW:
            mom[t] = float((1 + w).prod() - 1)

    # Composites — use prior month (lookahead-safe)
    prior_dt = last_complete_month - pd.offsets.MonthEnd(1)
    comp_subset = monthly_comp.loc[:prior_dt]
    comp_t = comp_subset.iloc[-1]
    rl_now = float(comp_t["RL"])
    gr_now = float(comp_t["GR"])
    ir_now = float(comp_t["IR"])

    # Apply composite overrides (stressed scenario)
    if composite_overrides:
        rl_now = float(composite_overrides.get("RL", rl_now))
        gr_now = float(composite_overrides.get("GR", gr_now))
        ir_now = float(composite_overrides.get("IR", ir_now))

    # Regime flip
    rl_3mo_change = 0.0
    if len(comp_subset) >= 4:
        rl_3mo_ago = float(comp_subset.iloc[-4]["RL"])
        rl_3mo_change = rl_now - rl_3mo_ago
    regime_flip = (rl_3mo_change < RL_FLIP_THRESHOLD) and (rl_now < 30)

    log(f"    composites: R&L={rl_now:.1f}, Growth={gr_now:.1f}, Inflation={ir_now:.1f}")
    log(f"    R&L 3-month change: {rl_3mo_change:+.1f}, regime_flip: {regime_flip}")

    # Select picks
    picks_info, confidence = select_picks(avail_e, mu, mom, regime_flip)

    # Defensive sub-portfolio (max-Sharpe)
    log("  computing defensive sub-portfolio...")
    sub = win[avail_d].dropna()
    cov_D = sub.cov().values
    cov_D = 0.7 * cov_D + 0.3 * np.diag(np.diag(cov_D))
    mu_d_vec = np.array([mu[t] for t in avail_d])
    w_D = max_sharpe(mu_d_vec, cov_D, DEF_CAP, RF_M)

    # Equity share + leverage
    equity_share = equity_share_from_RL(rl_now)
    leverage = leverage_from_IR(ir_now)
    if rl_now > 20: leverage = 1.0
    alpha = equity_share * leverage

    if alpha <= 1.0:
        w_eq_total = alpha; w_def_total = 1 - alpha; financing = 0.0
    else:
        w_eq_total = alpha; w_def_total = 0.0
        financing = (alpha - 1.0) * (RF_M + LEV_FIN_M)

    # Build output
    pick_rows = []
    for entry in picks_info:
        if len(entry) == 4:
            t, w_in, ind_r, mom_r = entry
        else:
            t, w_in = entry; ind_r, mom_r = None, None
        pick_rows.append({
            "ticker": t,
            "name": EQUITY[t]["name"],
            "fund": EQUITY[t]["fund"],
            "weight": float(w_eq_total * w_in),
            "weight_within_equity": float(w_in),
            "indicator_rank": int(ind_r) if ind_r is not None else None,
            "momentum_rank": int(mom_r) if mom_r is not None else None,
            "expected_return_monthly": float(mu.get(t, 0)),
            "trailing_6mo_return": float(mom.get(t, 0)),
        })

    def_rows = []
    for j, t in enumerate(avail_d):
        def_rows.append({
            "ticker": t,
            "fund": DEFENSIVE[t],
            "weight": float(w_def_total * w_D[j]),
            "weight_within_defensive": float(w_D[j]),
        })

    out = {
        "as_of": str(last_complete_month.date()),
        "calculated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "regime": {
            "risk_liquidity": rl_now,
            "growth": gr_now,
            "inflation_rates": ir_now,
            "rl_3mo_change": rl_3mo_change,
            "regime_flip_active": regime_flip,
        },
        "alpha": float(alpha),
        "equity_share": float(equity_share),
        "leverage": float(leverage),
        "financing_drag_monthly": float(financing),
        "selection_confidence": confidence,
        "picks": pick_rows,
        "defensive": def_rows,
        "methodology": {
            "version": "v9",
            "locked_at": "2026-04-25",
            "back_test_window": "2008-01 to 2026-04",
            "back_test_cagr": 0.1388,
            "back_test_sharpe": 0.610,
            "back_test_max_drawdown": -0.2364,
            "vs_spy_cagr_diff": 0.0282,
        },
    }

    if scenario_id or scenario_name:
        out["scenario"] = {"id": scenario_id, "name": scenario_name}

    return out


def main():
    print("[v9] computing current allocation...")
    factors, composites, monthly_ret = load_all_data()

    out = compute_allocation_from_data(factors, composites, monthly_ret)

    out_path = PUBLIC / "v9_allocation.json"
    out_path.write_text(json.dumps(out, indent=2) + "\n")
    print(f"\n[done] wrote {out_path}")
    print(f"  alpha = {out['alpha']:.3f} (equity_share {out['equity_share']:.2f} × leverage {out['leverage']:.2f})")
    print(f"  picks: {[p['ticker'] for p in out['picks']]}")
    print(f"  selection: {out['selection_confidence']}")


if __name__ == "__main__":
    main()
