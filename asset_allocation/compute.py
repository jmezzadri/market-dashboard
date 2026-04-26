"""
asset_allocation/compute.py — Layer 3: compute.

Reads the validated factor_panel.json + price_panel.json + reference_groups.json
+ spy_holdings.json from the run dir. Produces:

  1. Per-asset μ from multivariate regression (locked v10 factor maps).
  2. Trailing 6-month momentum (lookahead-safe).
  3. Rating assignment for ALL 14 equity buckets:
       Most Favored / Favored / Neutral / Less Favored / Least Favored
  4. Stance classification: Aggressive / Balanced / Defensive.
  5. Selected 5 picks (top by combined indicator + momentum rank, with
     confirmatory rule + regime-flip override carried over from v9).
  6. SPY benchmark sector weight comparison (overweights / underweights vs
     cap-weight S&P).
  7. Equity share + leverage from R&L and Inflation & Rates composites.

Output: allocation.json — the raw computed allocation, written to the
run dir. State management (Layer 4) reads this and produces the final
public output.

Critical: does NOT generate narrative text. That's Layer 4.

Usage:
  python -m asset_allocation.compute --run-dir /tmp/aa_run/2026-04-26
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.optimize import minimize

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# Locked v10 factor maps (multivariate, conditional |t|>2)
# Carried over from v8 multivariate analysis + extended for MGK
# ──────────────────────────────────────────────────────────────────────────

PER_BUCKET_FACTORS = {
    "Software":        ["jobless", "m2_yoy", "industrial_prod"],
    "Semiconductors":  ["copper_gold"],
    "Biotech":         ["jobless"],
    "Financials":      ["anfci", "capacity_util"],
    "HealthCare":      ["jobless", "sloos_ci"],
    "Industrials":     ["jobless", "stlfsi", "vix", "breakeven_10y"],
    "Energy":          ["jobless", "sloos_cre"],
    "ConsDisc":        ["jobless", "natgas_henry"],
    "ConsStaples":     ["sloos_ci", "jobless"],
    "Utilities":       ["sloos_ci"],
    "Materials":       ["jobless", "stlfsi", "vix", "breakeven_10y", "skew"],
    "RealEstate":      ["anfci", "capacity_util"],
    "CommSvcs":        ["sloos_ci", "vix", "capacity_util", "real_rates", "anfci", "cpff"],
    "MegaCapGrowth":   ["jobless", "real_rates", "breakeven_10y", "vix"],
}
UNIVERSAL_BG = ["yield_curve", "term_premium"]

DEFENSIVE_FACTORS = {
    "BIL": ["yield_curve", "fed_funds"],
    "TLT": ["yield_curve", "term_premium", "real_rates"],
    "GLD": ["copper_gold", "real_rates"],
    "LQD": ["yield_curve", "term_premium"],
}

# Universe — must match acquisition.py
EQUITY_BUCKETS = {
    "IGV": "Software", "SOXX": "Semiconductors", "IBB": "Biotech",
    "XLF": "Financials", "XLV": "HealthCare", "XLI": "Industrials",
    "XLE": "Energy", "XLY": "ConsDisc", "XLP": "ConsStaples",
    "XLU": "Utilities", "XLB": "Materials", "IYR": "RealEstate",
    "IYZ": "CommSvcs", "MGK": "MegaCapGrowth",
}
DEFENSIVE_TICKERS = ["BIL", "TLT", "GLD", "LQD"]

# Bucket → GICS sector mapping for SPY benchmark comparison
BUCKET_TO_SECTOR = {
    "Software": "Information Technology",
    "Semiconductors": "Information Technology",
    "Biotech": "Health Care",
    "Financials": "Financials",
    "HealthCare": "Health Care",
    "Industrials": "Industrials",
    "Energy": "Energy",
    "ConsDisc": "Consumer Discretionary",
    "ConsStaples": "Consumer Staples",
    "Utilities": "Utilities",
    "Materials": "Materials",
    "RealEstate": "Real Estate",
    "CommSvcs": "Communication Services",
    "MegaCapGrowth": "Information Technology",  # rough — MGK is mostly tech mega-caps
}

# Config — locked v9 + Joe's directives
WINDOW = 60                # months for regression
MOMENTUM_WINDOW = 6        # months for momentum signal
SHRINK = 0.5               # James-Stein-lite shrinkage toward asset long-run mean
RF_ANN = 0.04
RF_M = (1 + RF_ANN)**(1/12) - 1
LEV_FIN_M = (1.005)**(1/12) - 1
DEF_CAP = 0.70
N_PICKS = 5
RL_FLIP_THRESHOLD = -15    # R&L 3-mo change for regime-flip override


# ──────────────────────────────────────────────────────────────────────────
# Data loading
# ──────────────────────────────────────────────────────────────────────────


def points_to_series(points: list) -> pd.Series:
    if not points:
        return pd.Series(dtype=float)
    dates = pd.to_datetime([p[0] for p in points])
    values = [p[1] for p in points]
    return pd.Series(values, index=dates)


def load_factor_dataframe(factor_panel: dict) -> pd.DataFrame:
    """Convert factor_panel.json into a daily-indexed DataFrame, forward-filled."""
    out = {}
    for name, meta in factor_panel.get("factors", {}).items():
        s = points_to_series(meta.get("points", []))
        if not s.empty:
            out[name] = s
    return pd.DataFrame(out).ffill()


def load_price_dataframe(price_panel: dict) -> pd.DataFrame:
    out = {}
    for ticker, meta in price_panel.get("tickers", {}).items():
        s = points_to_series(meta.get("points", []))
        if not s.empty:
            out[ticker] = s
    return pd.DataFrame(out).ffill()


def load_composites_from_factor_panel(factor_df: pd.DataFrame) -> pd.DataFrame:
    """Composites are not in the unified factor panel — they come from the
    existing composite_history_daily.json. For Phase 1/2 we read it directly
    from the public/ directory; in production this becomes part of the
    acquisition layer."""
    public = Path("public")
    candidates = [
        Path(__file__).resolve().parent.parent / "public" / "composite_history_daily.json",
        Path("/sessions/gifted-nifty-feynman/mnt/macrotilt/market-dashboard/public/composite_history_daily.json"),
    ]
    for c in candidates:
        if c.exists():
            data = json.loads(c.read_text())
            df = pd.DataFrame(data)
            df["d"] = pd.to_datetime(df["d"])
            return df.set_index("d")[["RL", "GR", "IR"]].astype(float)
    raise FileNotFoundError("composite_history_daily.json not found in expected locations")


# ──────────────────────────────────────────────────────────────────────────
# Regression
# ──────────────────────────────────────────────────────────────────────────


def per_bucket_factor_list(name: str) -> list[str]:
    return list(dict.fromkeys(UNIVERSAL_BG + PER_BUCKET_FACTORS.get(name, [])))


def fit_forecast(asset_returns: pd.Series, factor_panel: pd.DataFrame,
                 factor_names: list[str]) -> float | None:
    """Multivariate OLS with shrinkage. Returns next-period μ or None."""
    cols = [c for c in factor_names if c in factor_panel.columns]
    if not cols:
        return None
    X = factor_panel[cols].shift(1)
    aligned = pd.concat([asset_returns.rename("r"), X], axis=1).dropna()
    if len(aligned) < 24:
        return None
    y_arr = aligned["r"].values
    X_raw = aligned.drop(columns="r").values
    col_mean = X_raw.mean(axis=0)
    col_sd = X_raw.std(axis=0)
    col_sd = np.where(col_sd < 1e-9, 1.0, col_sd)
    X_std = (X_raw - col_mean) / col_sd
    Xa = np.column_stack([np.ones(len(aligned)), X_std])
    try:
        coefs, *_ = np.linalg.lstsq(Xa, y_arr, rcond=None)
    except np.linalg.LinAlgError:
        return None
    last_X_raw = aligned.drop(columns="r").iloc[-1].values
    last_X_std = (last_X_raw - col_mean) / col_sd
    raw = float(coefs[0] + coefs[1:] @ last_X_std)
    long_run = float(asset_returns.mean())
    return (1 - SHRINK) * raw + SHRINK * long_run


# ──────────────────────────────────────────────────────────────────────────
# Rating assignment (NEW vs v9)
# ──────────────────────────────────────────────────────────────────────────


def assign_ratings(combined_scores: dict[str, float]) -> dict[str, str]:
    """Bucket combined scores (μ + momentum z-score) → 5-tier rating.

    Rating tiers based on quintiles of the universe:
      Most Favored:    top 20%
      Favored:         next 20% (top half overall)
      Neutral:         middle 20%
      Less Favored:    next 20%
      Least Favored:   bottom 20%
    """
    if not combined_scores:
        return {}
    items = sorted(combined_scores.items(), key=lambda x: -x[1])
    n = len(items)
    quintile_size = max(1, n // 5)

    ratings = {}
    for i, (bucket, _) in enumerate(items):
        if i < quintile_size:
            ratings[bucket] = "Most Favored"
        elif i < 2 * quintile_size:
            ratings[bucket] = "Favored"
        elif i < 3 * quintile_size:
            ratings[bucket] = "Neutral"
        elif i < 4 * quintile_size:
            ratings[bucket] = "Less Favored"
        else:
            ratings[bucket] = "Least Favored"
    return ratings


# ──────────────────────────────────────────────────────────────────────────
# Stance classification (NEW)
# ──────────────────────────────────────────────────────────────────────────


def classify_stance(equity_share: float, leverage: float, regime_flip: bool) -> dict:
    """Map (equity_share, leverage, regime_flip) → stance label + description."""
    alpha = equity_share * leverage
    if alpha > 1.05:
        return {
            "label": "Aggressive",
            "color": "calm",
            "description": (
                f"Strategy is at {alpha*100:.0f}% equity exposure with leverage. "
                "Macro composites are calm enough to support borrowing capacity."
            ),
        }
    if equity_share < 0.95:
        return {
            "label": "Defensive",
            "color": "stressed",
            "description": (
                f"Strategy is at {equity_share*100:.0f}% equity, "
                f"{(1-equity_share)*100:.0f}% defensive. Risk & Liquidity composite "
                "has crossed the stress threshold."
            ),
        }
    if regime_flip:
        return {
            "label": "Recovering",
            "color": "elevated",
            "description": (
                "Risk & Liquidity composite has dropped sharply — momentum signal "
                "is overridden, allocation favors indicator-based picks during the "
                "recovery."
            ),
        }
    return {
        "label": "Balanced",
        "color": "calm",
        "description": (
            "Strategy is fully invested in equities at neutral leverage. "
            "Macro composites are within normal range."
        ),
    }


# ──────────────────────────────────────────────────────────────────────────
# Selection (carried from v9)
# ──────────────────────────────────────────────────────────────────────────


def equity_share_from_RL(rl: float) -> float:
    if rl <= 20: return 1.0
    if rl <= 30: return 1.0 - (rl - 20) * 0.015
    if rl <= 50: return 0.85 - (rl - 30) * 0.0125
    return 0.60


def leverage_from_IR(ir: float) -> float:
    if ir > 30: return 1.0
    if ir > 0:  return 1.0 + (1 - ir/30) * 0.10
    if ir > -10: return 1.10 + (-ir/10) * 0.15
    if ir > -50: return 1.25 + min(1, (-ir-10)/40) * 0.25
    return 1.50


def max_sharpe(mu: np.ndarray, sigma: np.ndarray, cap: float, rf: float) -> np.ndarray:
    n = len(mu)
    def neg(w):
        ret = w @ mu
        vol = np.sqrt(max(1e-12, w @ sigma @ w))
        return -(ret - rf) / vol
    res = minimize(neg, np.ones(n)/n, method="SLSQP",
                   bounds=[(0, cap)] * n,
                   constraints=[{"type": "eq", "fun": lambda w: np.sum(w) - 1}])
    return res.x if res.success else np.ones(n) / n


def select_picks(combined_scores: dict[str, float], indicator_scores: dict[str, float],
                 momentum_scores: dict[str, float], regime_flip: bool) -> tuple[list[str], str]:
    """Confirmatory selection (both signals above median) with regime-flip override.

    Returns (selected_tickers, confidence_label)."""
    tickers = list(combined_scores.keys())
    n = len(tickers)
    if n < N_PICKS:
        return tickers, "TOO_SMALL"

    if regime_flip:
        # Override momentum, use indicator-only ranking
        ranked = sorted(tickers, key=lambda t: -indicator_scores.get(t, 0))
        return ranked[:N_PICKS], "FLIP_OVERRIDE"

    indicator_ranks = {t: r + 1 for r, t in enumerate(sorted(tickers, key=lambda t: -indicator_scores.get(t, 0)))}
    momentum_ranks = {t: r + 1 for r, t in enumerate(sorted(tickers, key=lambda t: -momentum_scores.get(t, 0)))}
    median = n / 2

    eligible, indicator_only = [], []
    for t in tickers:
        ind_top = indicator_ranks[t] <= median
        mom_top = momentum_ranks[t] <= median
        combined_rank = indicator_ranks[t] + momentum_ranks[t]
        if ind_top and mom_top:
            eligible.append((t, combined_rank))
        elif ind_top:
            indicator_only.append((t, combined_rank))

    eligible.sort(key=lambda x: x[1])
    indicator_only.sort(key=lambda x: x[1])

    if len(eligible) >= N_PICKS:
        return [t for t, _ in eligible[:N_PICKS]], "STRONG"
    picks = [t for t, _ in eligible]
    n_short = N_PICKS - len(picks)
    picks += [t for t, _ in indicator_only[:n_short]]
    if len(picks) < N_PICKS:
        return picks, "PARTIAL"
    return picks, "MIXED"


# ──────────────────────────────────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────────────────────────────────


def compute_allocation(run_dir: Path) -> dict:
    """Run the full compute pipeline. Returns the allocation dict."""
    logger.info(f"Loading inputs from {run_dir}")
    factor_panel = json.loads((run_dir / "factor_panel.json").read_text())
    price_panel = json.loads((run_dir / "price_panel.json").read_text())
    reference = json.loads((run_dir / "reference_groups.json").read_text())

    # SPY benchmark — optional; falls back to None if not present
    spy_path = run_dir / "spy_holdings.json"
    spy_holdings = json.loads(spy_path.read_text()) if spy_path.exists() else None

    factor_df = load_factor_dataframe(factor_panel)
    price_df = load_price_dataframe(price_panel)
    composites = load_composites_from_factor_panel(factor_df)

    # Resample to monthly
    monthly_ret = price_df.pct_change().resample("ME").apply(lambda x: (1 + x).prod() - 1)
    monthly_factors = factor_df.resample("ME").last().dropna(how="all")
    monthly_comp = composites.resample("ME").last().dropna()

    # Latest complete month
    today = pd.Timestamp.today()
    if today.day < 28:
        last_complete = monthly_ret.index[-2]
    else:
        last_complete = monthly_ret.index[-1]
    idx = monthly_ret.index.get_loc(last_complete)
    if idx < WINDOW:
        raise RuntimeError(f"Not enough history: idx={idx}, need >= {WINDOW}")

    win = monthly_ret.iloc[idx - WINDOW:idx]
    wf = monthly_factors.loc[:last_complete]

    # Forecast μ for every bucket
    logger.info("Computing per-bucket forecasts")
    mu = {}
    for ticker, name in EQUITY_BUCKETS.items():
        if ticker not in win.columns or win[ticker].dropna().shape[0] < 24:
            continue
        f = fit_forecast(win[ticker], wf, per_bucket_factor_list(name))
        if f is not None:
            mu[ticker] = f
    for ticker in DEFENSIVE_TICKERS:
        if ticker not in win.columns or win[ticker].dropna().shape[0] < 24:
            continue
        f = fit_forecast(win[ticker], wf, DEFENSIVE_FACTORS[ticker])
        if f is not None:
            mu[ticker] = f

    avail_eq = [t for t in EQUITY_BUCKETS if t in mu]
    avail_def = [t for t in DEFENSIVE_TICKERS if t in mu]
    if len(avail_eq) < N_PICKS:
        raise RuntimeError(f"Only {len(avail_eq)} equity buckets forecast — need >= {N_PICKS}")
    if len(avail_def) < 2:
        raise RuntimeError(f"Only {len(avail_def)} defensive assets forecast — need >= 2")

    # Trailing 6-month momentum (lookahead-safe)
    momentum = {}
    for ticker in avail_eq:
        w = monthly_ret[ticker].iloc[max(0, idx - MOMENTUM_WINDOW):idx]
        if len(w) >= MOMENTUM_WINDOW:
            momentum[ticker] = float((1 + w).prod() - 1)

    # Combined score: standardize μ and momentum, sum
    mu_eq = np.array([mu[t] for t in avail_eq])
    mom_eq = np.array([momentum.get(t, 0) for t in avail_eq])
    if mu_eq.std() > 1e-9:
        mu_z = (mu_eq - mu_eq.mean()) / mu_eq.std()
    else:
        mu_z = np.zeros_like(mu_eq)
    if mom_eq.std() > 1e-9:
        mom_z = (mom_eq - mom_eq.mean()) / mom_eq.std()
    else:
        mom_z = np.zeros_like(mom_eq)

    indicator_scores = {t: float(s) for t, s in zip(avail_eq, mu_z)}
    momentum_scores = {t: float(s) for t, s in zip(avail_eq, mom_z)}
    combined_scores = {t: indicator_scores[t] + momentum_scores[t] for t in avail_eq}

    # Composite snapshot — use prior month (lookahead-safe)
    prior_dt = last_complete - pd.offsets.MonthEnd(1)
    comp_subset = monthly_comp.loc[:prior_dt]
    if len(comp_subset) == 0:
        rl_now = gr_now = ir_now = 0.0
        rl_3mo = 0.0
    else:
        comp_t = comp_subset.iloc[-1]
        rl_now = float(comp_t["RL"])
        gr_now = float(comp_t["GR"])
        ir_now = float(comp_t["IR"])
        if len(comp_subset) >= 4:
            rl_3mo = rl_now - float(comp_subset.iloc[-4]["RL"])
        else:
            rl_3mo = 0.0
    regime_flip = (rl_3mo < RL_FLIP_THRESHOLD) and (rl_now < 30)

    # Rate ALL buckets
    ratings = assign_ratings(combined_scores)

    # Select picks
    picks, confidence = select_picks(combined_scores, indicator_scores, momentum_scores, regime_flip)
    pick_set = set(picks)

    # Defensive sub-portfolio (max-Sharpe)
    sub = win[avail_def].dropna()
    cov_D = sub.cov().values
    cov_D = 0.7 * cov_D + 0.3 * np.diag(np.diag(cov_D))
    mu_def = np.array([mu[t] for t in avail_def])
    w_D = max_sharpe(mu_def, cov_D, DEF_CAP, RF_M)

    # Equity share + leverage
    eq_share = equity_share_from_RL(rl_now)
    lev = leverage_from_IR(ir_now)
    if rl_now > 20:
        lev = 1.0
    alpha = eq_share * lev
    if alpha <= 1.0:
        w_eq_total = alpha
        w_def_total = 1.0 - alpha
        financing = 0.0
    else:
        w_eq_total = alpha
        w_def_total = 0.0
        financing = (alpha - 1.0) * (RF_M + LEV_FIN_M)

    # Stance
    stance = classify_stance(eq_share, lev, regime_flip)

    # Build full ratings list with weights
    rating_entries = []
    for ticker, name in EQUITY_BUCKETS.items():
        if ticker not in mu:
            continue
        is_pick = ticker in pick_set
        weight = (w_eq_total / N_PICKS) if is_pick else 0.0
        ref = reference["groups"].get(name, {})
        rating_entries.append({
            "ticker": ticker,
            "bucket_name": name,
            "display_name": ref.get("display_name", name),
            "gics_path": ref.get("gics_path", ""),
            "examples": ref.get("examples", []),
            "calibration_etf": ref.get("calibration_etf", ticker),
            "implementation_notes": ref.get("implementation_notes", ""),
            "kill_factors": ref.get("kill_factors", []),
            "rating": ratings.get(ticker, "Neutral"),
            "indicator_score": indicator_scores.get(ticker, 0.0),
            "momentum_score": momentum_scores.get(ticker, 0.0),
            "combined_score": combined_scores.get(ticker, 0.0),
            "expected_return_monthly": mu.get(ticker, 0.0),
            "trailing_6mo_return": momentum.get(ticker, 0.0),
            "is_picked": is_pick,
            "weight": weight,
        })

    defensive_entries = []
    for j, ticker in enumerate(avail_def):
        defensive_entries.append({
            "ticker": ticker,
            "weight": float(w_def_total * w_D[j]),
            "weight_within_defensive": float(w_D[j]),
        })

    # SPY benchmark comparison
    spy_comparison = None
    if spy_holdings:
        spy_sector_weights = spy_holdings.get("sector_weights", {})
        # Aggregate strategy weights by GICS sector
        strategy_sector_weights = {}
        for entry in rating_entries:
            sector = BUCKET_TO_SECTOR.get(entry["bucket_name"], "Other")
            strategy_sector_weights[sector] = strategy_sector_weights.get(sector, 0.0) + entry["weight"]
        # Compute differences
        all_sectors = set(spy_sector_weights.keys()) | set(strategy_sector_weights.keys())
        comparison = []
        for sector in sorted(all_sectors):
            strat = strategy_sector_weights.get(sector, 0.0)
            spy = spy_sector_weights.get(sector, 0.0)
            comparison.append({
                "sector": sector,
                "strategy_weight": strat,
                "spy_weight": spy,
                "diff_pp": (strat - spy) * 100,
            })
        spy_comparison = {
            "spy_as_of": spy_holdings.get("as_of"),
            "by_sector": comparison,
            "active_overweights_pp": sorted(
                [c for c in comparison if c["diff_pp"] > 0.5],
                key=lambda c: -c["diff_pp"]
            )[:5],
            "active_underweights_pp": sorted(
                [c for c in comparison if c["diff_pp"] < -0.5],
                key=lambda c: c["diff_pp"]
            )[:5],
        }

    return {
        "schema_version": "v10.0",
        "calculated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": str(last_complete.date()),
        "regime": {
            "risk_liquidity": rl_now,
            "growth": gr_now,
            "inflation_rates": ir_now,
            "rl_3mo_change": rl_3mo,
            "regime_flip_active": regime_flip,
        },
        "stance": stance,
        "alpha": alpha,
        "equity_share": eq_share,
        "leverage": lev,
        "financing_drag_monthly": financing,
        "selection_confidence": confidence,
        "ratings": rating_entries,
        "defensive": defensive_entries,
        "spy_comparison": spy_comparison,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--log-level", default="INFO")
    args = ap.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level),
                        format="%(asctime)s [%(levelname)s] %(message)s")

    run_dir = Path(args.run_dir)
    if not run_dir.exists():
        logger.error(f"run-dir {run_dir} does not exist")
        return 2

    allocation = compute_allocation(run_dir)
    out_path = run_dir / "allocation.json"
    out_path.write_text(json.dumps(allocation, indent=2))

    n_picks = sum(1 for r in allocation["ratings"] if r["is_picked"])
    n_most_favored = sum(1 for r in allocation["ratings"] if r["rating"] == "Most Favored")
    logger.info(f"Compute complete: stance={allocation['stance']['label']}, "
                f"alpha={allocation['alpha']:.3f}, "
                f"picks={n_picks}, most_favored_buckets={n_most_favored}, "
                f"confidence={allocation['selection_confidence']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
