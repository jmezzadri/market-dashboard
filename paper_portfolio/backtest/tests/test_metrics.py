"""Tests for backtest.metrics — pure math."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from paper_portfolio.backtest.metrics import (
    apply_margin_cost,
    cagr,
    compute_metrics,
    max_drawdown,
    sharpe,
)


def _flat_dates(n_days: int) -> pd.DatetimeIndex:
    return pd.date_range(start="2023-01-02", periods=n_days, freq="B")


def test_max_drawdown_on_known_curve():
    idx = _flat_dates(5)
    nav = pd.Series([100, 110, 90, 95, 105], index=idx)
    # Peak 110 → trough 90 = -20/110 = -18.18%
    assert max_drawdown(nav) == pytest.approx(-20/110, rel=1e-6)


def test_max_drawdown_monotonic_path():
    idx = _flat_dates(4)
    nav = pd.Series([100, 105, 110, 115], index=idx)
    assert max_drawdown(nav) == pytest.approx(0.0, abs=1e-9)


def test_cagr_one_year_doubling():
    idx = pd.date_range(start="2023-01-02", end="2024-01-02", freq="B")
    nav = pd.Series(np.linspace(100, 200, len(idx)), index=idx)
    # ~1 year, 2x → CAGR ~100%
    assert cagr(nav) == pytest.approx(1.0, rel=0.02)


def test_sharpe_positive_low_vol():
    # Series of small positive daily returns + tiny noise
    np.random.seed(42)
    idx = _flat_dates(252)
    daily = pd.Series(0.001 + np.random.normal(0, 0.001, len(idx)), index=idx)
    # Mean 0.1%/day with 0.1% noise → annualized Sharpe ≈ 0.1/0.1 * sqrt(252) ≈ 15.8
    s = sharpe(daily, rf_annual=0.0)
    assert s > 5.0     # generously high — confirms direction + magnitude


def test_sharpe_monthly_frequency_lower_than_daily_for_same_series():
    # Same series, two different frequency assumptions — monthly Sharpe
    # should be lower than daily Sharpe because annualization factor is
    # smaller (sqrt(12) vs sqrt(252)).
    np.random.seed(7)
    idx = pd.date_range("2023-01-02", periods=12, freq="ME")
    monthly = pd.Series(np.random.normal(0.01, 0.04, len(idx)), index=idx)
    s_monthly = sharpe(monthly, rf_annual=0.0, periods_per_year=12)
    s_daily = sharpe(monthly, rf_annual=0.0, periods_per_year=252)
    # Daily-assumption Sharpe always strictly higher (same mean/std, larger
    # sqrt factor).
    assert s_daily > s_monthly


def test_apply_margin_cost_zero_borrow_no_change():
    idx = _flat_dates(10)
    nav = pd.Series(np.linspace(1_000_000, 1_010_000, len(idx)), index=idx)
    borrowed = pd.Series(0.0, index=idx)
    real = apply_margin_cost(nav, borrowed)
    pd.testing.assert_series_equal(nav, real, check_names=False)


def test_apply_margin_cost_constant_borrow():
    idx = _flat_dates(252)
    nav = pd.Series(1_000_000.0, index=idx)
    borrowed = pd.Series(500_000.0, index=idx)
    real = apply_margin_cost(nav, borrowed)
    # Daily drag = 500,000 * 0.075/252 ≈ $148.81
    # Total drag over 252 days = 500,000 * 0.075 = $37,500
    final_drag = nav.iloc[-1] - real.iloc[-1]
    assert final_drag == pytest.approx(500_000 * 0.075, rel=0.01)
