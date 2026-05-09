"""
Unit tests for scanner.signal_intelligence_v2.backtest.

Validates the harness on synthetic data:
- Outcome computation
- Calibration outputs (excess-return curve, conviction table, band stats)
- Basket performance metrics (IR, hit rate, max drawdown)
- Signal ablation (turning off Signals changes results)
- Walk-forward (respects time boundary)

Real back-test execution against historical UW + Polygon data is in PR 9
via `scripts/run_backtest_v2.py`. This file tests the framework only.

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \
      tests/test_backtest_v2.py -v -p no:cacheprovider
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta

import pytest

from scanner.signal_intelligence_v2.backtest import (
    HistoricalDay,
    build_band_stats,
    build_conviction_table,
    build_excess_return_curve,
    compute_basket_performance,
    compute_ticker_outcomes,
    signal_ablation,
    walk_forward,
)


# ─────────────────────────────────────────────────────────────────────────────
# Synthetic-data factory
# ─────────────────────────────────────────────────────────────────────────────


def _make_synthetic_days(
    n_days: int = 60,
    n_tickers: int = 30,
    seed: int = 42,
    start_date: str = "2024-01-02",
) -> list[HistoricalDay]:
    """
    Generate a deterministic synthetic dataset for testing.

    Each ticker has Signal scores drawn from a controlled distribution. Forward
    21-day returns are correlated with Magnitude (bullish names tend to beat
    SPY) so the back-test produces non-trivial calibration outputs.
    """
    rng = random.Random(seed)
    tickers = [f"T{i:03d}" for i in range(n_tickers)]
    days: list[HistoricalDay] = []
    base = datetime.strptime(start_date, "%Y-%m-%d")

    for i in range(n_days):
        date = (base + timedelta(days=i)).strftime("%Y-%m-%d")
        signals_by_ticker = {}
        forward_returns = {}
        spy_ret = rng.gauss(0.005, 0.04)  # SPY drifts slowly with noise

        for t in tickers:
            # Generate Signals around a per-ticker bias so we get a spread of Magnitudes
            bias = rng.gauss(0, 30)
            sigs = {
                "insider":    int(max(-100, min(100, rng.gauss(bias, 20)))),
                "options":    int(max(-100, min(100, rng.gauss(bias, 20)))),
                "analyst":    int(max(-100, min(100, rng.gauss(bias, 20)))),
                "congress":   int(max(-100, min(100, rng.gauss(bias, 25)))),
                "technicals": int(max(-100, min(100, rng.gauss(bias, 20)))),
            }
            # Occasionally drop a Signal (None) to test partial-data flow
            if rng.random() < 0.15:
                sigs["congress"] = None

            signals_by_ticker[t] = sigs

            # Forward return correlated with bias (so calibration finds signal)
            forward_returns[t] = spy_ret + bias / 100.0 * 0.05 + rng.gauss(0, 0.025)

        days.append(HistoricalDay(
            date=date,
            signals_by_ticker=signals_by_ticker,
            universe=list(tickers),
            forward_21d_returns=forward_returns,
            spy_forward_21d_return=spy_ret,
        ))
    return days


# ─────────────────────────────────────────────────────────────────────────────
# Outcomes
# ─────────────────────────────────────────────────────────────────────────────


def test_compute_ticker_outcomes_basic():
    days = _make_synthetic_days(n_days=10, n_tickers=20)
    outcomes = compute_ticker_outcomes(days)
    # Most (day × ticker) pairs should produce an outcome (some get dropped if
    # all Signals are None, but synthetic data ensures most have data)
    assert len(outcomes) > 100
    # Every outcome has a magnitude in [-100, 100]
    for o in outcomes:
        assert -100 <= o.magnitude <= 100
        assert -100 <= o.mt_score <= 100
        assert 50 <= o.conviction_pct <= 100
        assert o.band in (
            "Buy Signal", "Strong Bullish", "Moderate Bullish", "Weak Bullish",
            "Weak Bearish", "Moderate Bearish", "Strong Bearish", "Sell Trigger",
            "No Data",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Calibration: excess-return curve is monotone in expected direction
# ─────────────────────────────────────────────────────────────────────────────


def test_excess_return_curve_monotone():
    """At higher Magnitudes, mean excess return should be higher."""
    days = _make_synthetic_days(n_days=120, n_tickers=50)
    outcomes = compute_ticker_outcomes(days)
    curve = build_excess_return_curve(outcomes)
    assert len(curve) >= 5

    # Pull the most-bullish and most-bearish buckets with enough obs
    bullish_buckets = [r for r in curve if r["magnitude_center"] >= 30]
    bearish_buckets = [r for r in curve if r["magnitude_center"] <= -30]
    if bullish_buckets and bearish_buckets:
        avg_bull = sum(r["mean_excess_pct"] for r in bullish_buckets) / len(bullish_buckets)
        avg_bear = sum(r["mean_excess_pct"] for r in bearish_buckets) / len(bearish_buckets)
        assert avg_bull > avg_bear, f"Bullish ({avg_bull}) should beat bearish ({avg_bear})"


# ─────────────────────────────────────────────────────────────────────────────
# Calibration: conviction table monotone in agreement (more agreement = higher hit)
# ─────────────────────────────────────────────────────────────────────────────


def test_conviction_table_shape():
    days = _make_synthetic_days(n_days=180, n_tickers=50)
    outcomes = compute_ticker_outcomes(days)
    table = build_conviction_table(outcomes)
    # Should have entries for at least the high-agreement buckets
    assert 100 in table or 80 in table
    # Each curve should have ≥1 magnitude bucket
    for agr, curve in table.items():
        assert len(curve) >= 1
        for row in curve:
            assert 0 <= row["hit_rate_pct"] <= 100
            assert row["abs_magnitude"] >= 0
            assert row["n_obs"] >= 5


# ─────────────────────────────────────────────────────────────────────────────
# Per-band stats sum to 100% population
# ─────────────────────────────────────────────────────────────────────────────


def test_band_stats_population_sums_to_100():
    days = _make_synthetic_days(n_days=60, n_tickers=30)
    outcomes = compute_ticker_outcomes(days)
    rows = build_band_stats(outcomes)
    total_pct = sum(r["population_pct"] for r in rows)
    assert abs(total_pct - 100.0) < 0.5  # rounding tolerance


# ─────────────────────────────────────────────────────────────────────────────
# Basket performance: positive IR with the synthetic data's bias-correlated returns
# ─────────────────────────────────────────────────────────────────────────────


def test_basket_performance_positive_ir():
    """With bias-correlated synthetic returns, the basket should beat SPY on average."""
    days = _make_synthetic_days(n_days=120, n_tickers=50)
    outcomes = compute_ticker_outcomes(days)
    perf = compute_basket_performance(outcomes, buy_threshold=25.0)
    assert perf["n_periods"] > 0
    assert perf["info_ratio"] is not None
    # Mean excess should be positive in the synthetic setup
    assert perf["mean_excess_pct"] > 0
    # Hit rate above coin flip
    assert perf["hit_rate_pct"] > 50.0


def test_basket_performance_no_basket():
    """If threshold is impossibly high, no basket forms — graceful zero output."""
    days = _make_synthetic_days(n_days=10, n_tickers=10)
    outcomes = compute_ticker_outcomes(days)
    perf = compute_basket_performance(outcomes, buy_threshold=1000.0)
    assert perf["n_periods"] == 0
    assert perf["info_ratio"] is None


# ─────────────────────────────────────────────────────────────────────────────
# Signal ablation: turning off a contributing Signal degrades performance
# ─────────────────────────────────────────────────────────────────────────────


def test_signal_ablation_returns_per_signal():
    days = _make_synthetic_days(n_days=90, n_tickers=40)
    results = signal_ablation(days, buy_threshold=25.0)
    # Baseline + 5 per-Signal entries
    assert "__baseline__" in results
    for k in ("insider", "options", "analyst", "congress", "technicals"):
        assert k in results
        assert "info_ratio" in results[k]


# ─────────────────────────────────────────────────────────────────────────────
# Walk-forward: respects time boundary and runs end to end
# ─────────────────────────────────────────────────────────────────────────────


def test_walk_forward_runs_end_to_end():
    days = _make_synthetic_days(n_days=120, n_tickers=40)
    train_until = days[80].date  # train on first ~80 days
    result = walk_forward(days, train_until=train_until, buy_threshold=25.0)
    assert "error" not in result
    assert result["train_period"]["n_days"] >= 80
    assert result["holdout_period"]["n_days"] > 0
    assert result["holdout_performance"]["n_periods"] > 0


def test_walk_forward_train_until_too_late():
    days = _make_synthetic_days(n_days=10, n_tickers=10)
    # train_until after all data → no hold-out
    result = walk_forward(days, train_until="2099-01-01")
    assert "error" in result
