"""
paper_portfolio.backtest.metrics — pure-math performance metrics.

Inputs are pandas Series of daily NAV / daily returns. No I/O here —
fully unit-testable and re-runnable from cached backtest output.

Senior Quant constants:
  * Margin cost = 7.5% annualized (midpoint of Joe's 5–10% range) applied
    daily on the time-weighted borrowed half of Sleeve B.
  * Trading days per year = 252.
  * Risk-free rate for Sharpe = 4.0% annualized (current SOFR rough proxy;
    set to 0 if you prefer excess-return-over-cash framing).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

ANNUAL_MARGIN_COST = 0.075          # 7.5 % — midpoint of Joe's 5–10 % range
TRADING_DAYS_PER_YEAR = 252
WEEKS_PER_YEAR = 52
MONTHS_PER_YEAR = 12
DEFAULT_RF_ANNUAL = 0.04            # 4 % risk-free for Sharpe


@dataclass(frozen=True)
class BacktestMetrics:
    start_date: str
    end_date: str
    n_days: int
    n_weeks: int
    cumulative_return_gross: float
    cumulative_return_real: float       # after margin cost
    cagr_gross: float
    cagr_real: float
    sharpe_gross: float
    sharpe_real: float
    max_drawdown: float                 # negative; e.g. -0.18 = -18 %
    max_drawdown_real: float
    win_rate_weekly: float              # fraction of weeks with positive return
    annualized_turnover: float          # gross notional traded / starting NAV / years
    avg_leverage_ratio_sleeve_b: float  # mean gross_sleeve_b / sleeve_b_capital
    days_levered: int                   # count of days where leverage_ratio > 1
    pct_days_levered: float
    benchmark_label: str
    cumulative_return_benchmark: float
    alpha_vs_benchmark_real: float      # real_cagr - benchmark_cagr


def daily_margin_drag(borrowed_notional: float) -> float:
    """Dollar drag for one trading day on a given borrowed notional."""
    return borrowed_notional * (ANNUAL_MARGIN_COST / TRADING_DAYS_PER_YEAR)


def apply_margin_cost(
    nav_gross: pd.Series,
    borrowed_notional: pd.Series,
) -> pd.Series:
    """Subtract daily margin drag from a gross NAV path.

    nav_gross and borrowed_notional must be aligned daily Series.
    Returns the real (after-margin-cost) NAV path.
    """
    nav_gross = nav_gross.sort_index()
    borrowed = borrowed_notional.reindex(nav_gross.index).fillna(0.0).clip(lower=0)
    daily_drag = borrowed * (ANNUAL_MARGIN_COST / TRADING_DAYS_PER_YEAR)
    cumulative_drag = daily_drag.cumsum()
    return nav_gross - cumulative_drag


def max_drawdown(nav: pd.Series) -> float:
    """Worst peak-to-trough drawdown on a NAV path. Returns a negative
    number (e.g. -0.18 = -18 %)."""
    nav = nav.dropna()
    if len(nav) < 2:
        return 0.0
    running_peak = nav.cummax()
    dd = (nav - running_peak) / running_peak
    return float(dd.min())


def sharpe(daily_returns: pd.Series, rf_annual: float = DEFAULT_RF_ANNUAL,
           periods_per_year: int = TRADING_DAYS_PER_YEAR) -> float:
    """Annualized Sharpe ratio from a return series at a given frequency.

    periods_per_year: 252 for daily, 52 for weekly, 12 for monthly.
    Standard convention: mean excess period return / period std × sqrt(periods_per_year).

    Picking the right frequency matters. If returns are artificially smooth
    because they were spread evenly across non-trading sub-periods, the
    period std understates true volatility and Sharpe is overstated. Report
    Sharpe at the cadence of the strategy's actual rebalance — monthly here.
    """
    r = daily_returns.dropna()
    if len(r) < 3:
        return 0.0
    rf_period = rf_annual / periods_per_year
    excess = r - rf_period
    sd = excess.std(ddof=1)
    if sd == 0 or np.isnan(sd):
        return 0.0
    return float(excess.mean() / sd * np.sqrt(periods_per_year))


def cagr(nav: pd.Series) -> float:
    """Compound annual growth rate over the NAV path."""
    nav = nav.dropna()
    if len(nav) < 2:
        return 0.0
    n_days = (nav.index[-1] - nav.index[0]).days
    if n_days <= 0:
        return 0.0
    years = n_days / 365.25
    total = nav.iloc[-1] / nav.iloc[0]
    if total <= 0 or years == 0:
        return 0.0
    return float(total ** (1.0 / years) - 1.0)


def compute_metrics(
    nav_gross: pd.Series,
    nav_real: pd.Series,
    borrowed_notional: pd.Series,
    weekly_returns: pd.Series,
    benchmark_nav: pd.Series,
    benchmark_label: str,
    gross_traded_dollars: float,
    sleeve_b_capital: float,
    sleeve_b_gross_long: pd.Series,
) -> BacktestMetrics:
    """Roll all backtest outputs into a single BacktestMetrics record."""
    nav_gross = nav_gross.sort_index().dropna()
    nav_real  = nav_real.sort_index().dropna()
    benchmark = benchmark_nav.sort_index().dropna()
    if len(nav_gross) < 2:
        raise ValueError("Need at least 2 NAV points for metrics.")

    start = nav_gross.index[0]
    end = nav_gross.index[-1]
    years = max((end - start).days / 365.25, 1e-9)

    cum_gross = nav_gross.iloc[-1] / nav_gross.iloc[0] - 1.0
    cum_real  = nav_real.iloc[-1]  / nav_real.iloc[0]  - 1.0
    cum_bench = (benchmark.iloc[-1] / benchmark.iloc[0] - 1.0) if len(benchmark) >= 2 else 0.0

    # Use MONTHLY-resampled returns for Sharpe. The strategy rebalances
    # monthly; per-week returns are artificially smoothed by the
    # holding-period spread, so weekly Sharpe overstates. Monthly Sharpe
    # is at the strategy's true frequency and is the honest number.
    monthly_gross_nav = nav_gross.resample("ME").last().dropna()
    monthly_real_nav  = nav_real.resample("ME").last().dropna()
    monthly_gross = monthly_gross_nav.pct_change().dropna()
    monthly_real  = monthly_real_nav.pct_change().dropna()

    cagr_real = cagr(nav_real)
    cagr_bench = cagr(benchmark) if len(benchmark) >= 2 else 0.0

    weekly = weekly_returns.dropna()
    win_rate = float((weekly > 0).mean()) if len(weekly) > 0 else 0.0

    annualized_turnover = (gross_traded_dollars / nav_gross.iloc[0]) / years if nav_gross.iloc[0] > 0 else 0.0

    sleeve_b = sleeve_b_gross_long.reindex(nav_gross.index).fillna(0.0)
    levered_mask = sleeve_b > sleeve_b_capital
    avg_lev = (sleeve_b / sleeve_b_capital).clip(lower=0).mean() if sleeve_b_capital else 0.0

    return BacktestMetrics(
        start_date=str(start.date()),
        end_date=str(end.date()),
        n_days=len(nav_gross),
        n_weeks=len(weekly),
        cumulative_return_gross=float(cum_gross),
        cumulative_return_real=float(cum_real),
        cagr_gross=cagr(nav_gross),
        cagr_real=cagr_real,
        sharpe_gross=sharpe(monthly_gross, periods_per_year=MONTHS_PER_YEAR),
        sharpe_real=sharpe(monthly_real, periods_per_year=MONTHS_PER_YEAR),
        max_drawdown=max_drawdown(nav_gross),
        max_drawdown_real=max_drawdown(nav_real),
        win_rate_weekly=win_rate,
        annualized_turnover=float(annualized_turnover),
        avg_leverage_ratio_sleeve_b=float(avg_lev),
        days_levered=int(levered_mask.sum()),
        pct_days_levered=float(levered_mask.mean()) if len(levered_mask) else 0.0,
        benchmark_label=benchmark_label,
        cumulative_return_benchmark=float(cum_bench),
        alpha_vs_benchmark_real=float(cagr_real - cagr_bench),
    )
