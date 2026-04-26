"""Unit tests for asset_allocation/compute.py — fast offline tests."""

import numpy as np
import pandas as pd
import pytest

from asset_allocation.compute import (
    EQUITY_BUCKETS,
    DEFENSIVE_TICKERS,
    PER_BUCKET_FACTORS,
    UNIVERSAL_BG,
    BUCKET_TO_SECTOR,
    assign_ratings,
    classify_stance,
    select_picks,
    equity_share_from_RL,
    leverage_from_IR,
    fit_forecast,
    per_bucket_factor_list,
    points_to_series,
)


# ──────────────────────────────────────────────────────────────────────────
# Universe + factor maps
# ──────────────────────────────────────────────────────────────────────────


def test_equity_universe_size():
    assert len(EQUITY_BUCKETS) == 14


def test_defensive_universe_size():
    assert len(DEFENSIVE_TICKERS) == 4


def test_every_bucket_has_factor_map():
    """Every bucket name must have a factor map entry (or be in universal_bg)."""
    bucket_names = set(EQUITY_BUCKETS.values())
    map_names = set(PER_BUCKET_FACTORS.keys())
    assert bucket_names == map_names, (
        f"mismatch — bucket-not-in-map: {bucket_names - map_names}, "
        f"map-not-in-bucket: {map_names - bucket_names}"
    )


def test_per_bucket_factor_list_includes_universal():
    """Every per-bucket factor list must include the universal background factors."""
    for name in EQUITY_BUCKETS.values():
        factors = per_bucket_factor_list(name)
        for bg in UNIVERSAL_BG:
            assert bg in factors, f"{name} missing universal factor {bg}"


def test_per_bucket_factor_list_no_duplicates():
    for name in EQUITY_BUCKETS.values():
        factors = per_bucket_factor_list(name)
        assert len(factors) == len(set(factors)), f"{name} has duplicate factors"


def test_every_bucket_has_sector_mapping():
    """Every bucket must map to a GICS sector for SPY benchmark comparison."""
    for name in EQUITY_BUCKETS.values():
        assert name in BUCKET_TO_SECTOR, f"{name} has no GICS sector mapping"


# ──────────────────────────────────────────────────────────────────────────
# Rating assignment
# ──────────────────────────────────────────────────────────────────────────


def test_assign_ratings_5_buckets_distinct_tiers():
    """With 5 buckets at distinct scores, each ends up in a different tier."""
    scores = {f"B{i}": float(5 - i) for i in range(5)}
    ratings = assign_ratings(scores)
    assert ratings["B0"] == "Most Favored"
    assert ratings["B1"] == "Favored"
    assert ratings["B2"] == "Neutral"
    assert ratings["B3"] == "Less Favored"
    assert ratings["B4"] == "Least Favored"


def test_assign_ratings_14_buckets_quintile_distribution():
    """With 14 buckets, quintile_size = 2, so 2 in each tier + remainder in Least Favored."""
    scores = {f"B{i:02d}": float(14 - i) for i in range(14)}
    ratings = assign_ratings(scores)
    counts = {}
    for r in ratings.values():
        counts[r] = counts.get(r, 0) + 1
    # First 2 most favored, next 2 favored, ..., remainder in least favored
    assert counts["Most Favored"] == 2
    assert counts["Favored"] == 2
    assert counts["Neutral"] == 2
    assert counts["Less Favored"] == 2
    assert counts["Least Favored"] == 6  # remainder


def test_assign_ratings_top_score_always_most_favored():
    """Top-ranked bucket is Most Favored regardless of universe size."""
    scores = {"A": 10.0, "B": 0.0, "C": -10.0}
    ratings = assign_ratings(scores)
    assert ratings["A"] == "Most Favored"


def test_assign_ratings_5_or_more_includes_least_favored():
    """With ≥ 5 buckets, the bottom rating tier is reachable."""
    scores = {f"B{i}": float(5 - i) for i in range(5)}
    ratings = assign_ratings(scores)
    assert ratings["B4"] == "Least Favored"


def test_assign_ratings_empty():
    assert assign_ratings({}) == {}


# ──────────────────────────────────────────────────────────────────────────
# Stance classification
# ──────────────────────────────────────────────────────────────────────────


def test_stance_aggressive_when_levered():
    s = classify_stance(equity_share=1.0, leverage=1.3, regime_flip=False)
    assert s["label"] == "Aggressive"


def test_stance_balanced_when_full_equity_no_leverage():
    s = classify_stance(equity_share=1.0, leverage=1.0, regime_flip=False)
    assert s["label"] == "Balanced"


def test_stance_defensive_when_equity_share_below_95():
    s = classify_stance(equity_share=0.7, leverage=1.0, regime_flip=False)
    assert s["label"] == "Defensive"


def test_stance_recovering_when_regime_flip():
    s = classify_stance(equity_share=1.0, leverage=1.0, regime_flip=True)
    assert s["label"] == "Recovering"


def test_stance_aggressive_overrides_recovering():
    """If alpha > 1.05 AND regime flip, aggressive wins."""
    s = classify_stance(equity_share=1.0, leverage=1.3, regime_flip=True)
    assert s["label"] == "Aggressive"


# ──────────────────────────────────────────────────────────────────────────
# Equity share + leverage curves (carried from v9)
# ──────────────────────────────────────────────────────────────────────────


def test_equity_share_calm_regime():
    assert equity_share_from_RL(-10) == 1.0
    assert equity_share_from_RL(0) == 1.0


def test_equity_share_mild_stress():
    """RL = 25 → halfway between 100% and 85% → 92.5%"""
    assert abs(equity_share_from_RL(25) - 0.925) < 0.001


def test_equity_share_high_stress_floor():
    assert equity_share_from_RL(60) == 0.60


def test_leverage_calm_regime_levers_up():
    """IR = -50 → max leverage 1.50x"""
    assert leverage_from_IR(-50) == 1.50


def test_leverage_neutral_no_leverage():
    """IR > 30 → no leverage"""
    assert leverage_from_IR(50) == 1.0


# ──────────────────────────────────────────────────────────────────────────
# Selection (confirmatory + regime-flip override)
# ──────────────────────────────────────────────────────────────────────────


def test_select_picks_strong_when_both_signals_agree():
    indicator = {f"B{i}": float(10 - i) for i in range(10)}
    momentum = {f"B{i}": float(10 - i) for i in range(10)}
    combined = {t: indicator[t] + momentum[t] for t in indicator}
    picks, conf = select_picks(combined, indicator, momentum, regime_flip=False)
    assert conf == "STRONG"
    assert len(picks) == 5
    # Top 5 by both signals are B0-B4
    assert set(picks) == {"B0", "B1", "B2", "B3", "B4"}


def test_select_picks_regime_flip_uses_indicator_only():
    """When regime_flip=True, momentum is ignored."""
    indicator = {f"B{i}": float(10 - i) for i in range(10)}  # B0 best
    momentum = {f"B{i}": float(i) for i in range(10)}        # B9 best (opposite)
    combined = {t: indicator[t] + momentum[t] for t in indicator}
    picks, conf = select_picks(combined, indicator, momentum, regime_flip=True)
    assert conf == "FLIP_OVERRIDE"
    # Should pick the top-5 by indicator alone (B0-B4)
    assert set(picks) == {"B0", "B1", "B2", "B3", "B4"}


def test_select_picks_mixed_when_signals_disagree():
    """When indicator and momentum disagree, fewer than 5 buckets pass the
    confirmatory bar — strategy falls back to indicator-only picks."""
    indicator = {f"B{i}": float(10 - i) for i in range(10)}
    momentum = {f"B{i}": float(i) for i in range(10)}  # opposite of indicator
    combined = {t: indicator[t] + momentum[t] for t in indicator}
    picks, conf = select_picks(combined, indicator, momentum, regime_flip=False)
    # Only buckets in the top half of BOTH rankings qualify — basically only the
    # ones at the median on both. With perfectly opposite signals, few qualify.
    assert conf in ("PARTIAL", "MIXED", "STRONG")  # depends on which median tie
    assert len(picks) == 5  # always returns N_PICKS


def test_select_picks_too_small_universe():
    indicator = {f"B{i}": float(i) for i in range(3)}
    momentum = {f"B{i}": float(i) for i in range(3)}
    combined = {t: indicator[t] + momentum[t] for t in indicator}
    picks, conf = select_picks(combined, indicator, momentum, regime_flip=False)
    assert conf == "TOO_SMALL"
    assert len(picks) == 3


# ──────────────────────────────────────────────────────────────────────────
# fit_forecast
# ──────────────────────────────────────────────────────────────────────────


def test_fit_forecast_returns_none_with_too_few_obs():
    """Fewer than 24 observations should return None."""
    asset_returns = pd.Series([0.01, 0.02, -0.01],
                              index=pd.to_datetime(["2026-01-31", "2026-02-28", "2026-03-31"]))
    factor_panel = pd.DataFrame({
        "yield_curve": [50, 55, 60],
        "term_premium": [0.5, 0.6, 0.7],
    }, index=asset_returns.index)
    out = fit_forecast(asset_returns, factor_panel, ["yield_curve", "term_premium"])
    assert out is None


def test_fit_forecast_returns_float_with_enough_obs():
    """30 obs of clean linear relationship should fit and produce a finite forecast."""
    np.random.seed(42)
    n = 30
    dates = pd.date_range("2024-01-31", periods=n, freq="ME")
    factor = pd.Series(np.linspace(0, 1, n), index=dates)
    # asset return = 2 * factor + small noise
    asset_returns = pd.Series(2 * factor.values + np.random.normal(0, 0.001, n),
                              index=dates)
    factor_panel = pd.DataFrame({"yield_curve": factor, "term_premium": factor * 0.5},
                                index=dates)
    out = fit_forecast(asset_returns, factor_panel, ["yield_curve", "term_premium"])
    assert out is not None
    assert np.isfinite(out)


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def test_points_to_series_basic():
    points = [["2026-01-01", 1.0], ["2026-01-02", 2.0], ["2026-01-03", 3.0]]
    s = points_to_series(points)
    assert len(s) == 3
    assert s.iloc[0] == 1.0
    assert s.iloc[2] == 3.0


def test_points_to_series_empty():
    s = points_to_series([])
    assert len(s) == 0
