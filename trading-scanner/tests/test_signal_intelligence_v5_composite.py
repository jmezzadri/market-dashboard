"""
Unit tests — Signal Intelligence v5 Phase 2 composite MT Score.

Covers:
  * insider_weight_factor cap-discount math at the 5 spec checkpoints
    ($500M / $5B / $50B / $500B / $4T) plus the below-floor clamp.
  * Pure compute_composite blend math:
      - all sub-scores at +50 -> MT Score = +50
      - all at -50 -> -50
      - mixed sub-scores -> matches hand-calculated weighted average
  * None-handling: a None sub-score is excluded from the denominator,
    NOT treated as zero. (Anchor: v2 rollup pattern.)
  * Band assignment at the four boundary values (-50, -20, +20, +50)
    plus far-extreme values.
  * Cap-discount reduces insider influence at large cap (insider=-100 +
    others=+50 at $4T -> MT Score >> result at $500M).
  * Weights always sum to 1.0 after cap-discount redistribution.
  * "So what" string generation across the five bands.
  * compute_mt_score (I/O wrapper) is exercised against fully mocked
    sub-scorers so we don't hit Supabase.

Run:
    cd trading-scanner && python -m pytest tests/test_signal_intelligence_v5_composite.py -v
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any
from unittest.mock import patch

import pytest

from scanner.signal_intelligence_v5.composite import (
    DEFAULT_WEIGHTS,
    EQUAL_WEIGHTS,
    SIGNAL_KEYS,
    _apply_cap_discount,
    assign_band,
    compute_composite,
    compute_mt_score,
    insider_weight_factor,
    so_what_summary,
)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Cap-discount math
# ─────────────────────────────────────────────────────────────────────────────

def test_insider_weight_factor_at_floor_is_one():
    # $500M -> factor 1.00
    assert insider_weight_factor(500_000_000) == pytest.approx(1.0, abs=1e-6)


def test_insider_weight_factor_at_50b_is_half():
    # $50B -> factor 0.50
    assert insider_weight_factor(50_000_000_000) == pytest.approx(0.5, abs=1e-6)


def test_insider_weight_factor_at_500b_is_quarter():
    # $500B -> factor 0.25
    assert insider_weight_factor(500_000_000_000) == pytest.approx(0.25, abs=1e-6)


def test_insider_weight_factor_at_5b_is_three_quarters():
    # $5B is exactly halfway in log space between $500M and $50B -> 0.75.
    assert insider_weight_factor(5_000_000_000) == pytest.approx(0.75, abs=1e-6)


def test_insider_weight_factor_above_500b_clamps_at_quarter():
    # $4T -> factor clamped at 0.25 (we don't go below).
    assert insider_weight_factor(4_000_000_000_000) == pytest.approx(0.25, abs=1e-6)


def test_insider_weight_factor_below_floor_clamps_at_one():
    # Anything below $500M floored at 1.00.
    assert insider_weight_factor(100_000_000) == pytest.approx(1.0, abs=1e-6)
    assert insider_weight_factor(300_000_000) == pytest.approx(1.0, abs=1e-6)


def test_insider_weight_factor_handles_none_and_zero():
    assert insider_weight_factor(None) == 1.0
    assert insider_weight_factor(0) == 1.0
    assert insider_weight_factor(-1) == 1.0


# ─────────────────────────────────────────────────────────────────────────────
# 2. Weight redistribution sanity
# ─────────────────────────────────────────────────────────────────────────────

def test_default_weights_sum_to_one():
    assert sum(DEFAULT_WEIGHTS.values()) == pytest.approx(1.0, abs=1e-9)
    assert set(DEFAULT_WEIGHTS.keys()) == set(SIGNAL_KEYS)


def test_cap_discount_redistribution_sums_to_one_at_all_caps():
    for mcap in [None, 100e6, 500e6, 5e9, 50e9, 200e9, 500e9, 4e12]:
        factor = insider_weight_factor(mcap)
        out = _apply_cap_discount(dict(DEFAULT_WEIGHTS), factor)
        assert sum(out.values()) == pytest.approx(1.0, abs=1e-9), \
            f"weights don't sum to 1 at cap={mcap}"


def test_cap_discount_redistribution_at_50b_halves_insider_grows_others():
    # Use EQUAL_WEIGHTS (Phase 2 baseline) — Phase 3 DEFAULT is calibrated.
    factor = insider_weight_factor(50_000_000_000)
    out = _apply_cap_discount(dict(EQUAL_WEIGHTS), factor)
    # Insider weight halved: 1/6 * 0.5 = 1/12
    assert out["insider"] == pytest.approx(1.0 / 12.0, abs=1e-9)
    # Other five share the freed 1/12 equally, each gets 1/6 + 1/60 = 11/60
    expected_other = 1.0 / 6.0 + (1.0 / 12.0) / 5.0
    for k in SIGNAL_KEYS:
        if k != "insider":
            assert out[k] == pytest.approx(expected_other, abs=1e-9), \
                f"weight mismatch for {k}"


# ─────────────────────────────────────────────────────────────────────────────
# 3. Composite blend math
# ─────────────────────────────────────────────────────────────────────────────

def test_all_subscores_at_plus_50_yields_50():
    subs = {k: 50 for k in SIGNAL_KEYS}
    out = compute_composite(subs, market_cap=1e9)
    assert out["mt_score"] == pytest.approx(50.0, abs=1e-6)
    assert out["band"] == "Strong Buy"  # 50 hits the upper band per spec


def test_all_subscores_at_minus_50_yields_minus_50():
    subs = {k: -50 for k in SIGNAL_KEYS}
    out = compute_composite(subs, market_cap=1e9)
    assert out["mt_score"] == pytest.approx(-50.0, abs=1e-6)
    # -50 is the boundary; per spec it lands in the less-bearish band:
    # "Watch Sell" (since "Strong Sell" requires score below -50).
    assert out["band"] == "Watch Sell"


def test_mixed_subscores_matches_weighted_average_at_floor():
    # At $500M cap, factor = 1.0 -> straight equal-weight average.
    # Use EQUAL_WEIGHTS (Phase 2 baseline) — Phase 3 DEFAULT is calibrated.
    subs = {
        "insider":        80,
        "options":        20,
        "congress":       -10,
        "technicals":     0,
        "analyst":        40,
        "short_interest": -30,
    }
    expected = sum(subs.values()) / 6  # 100/6 = 16.666...
    out = compute_composite(subs, market_cap=500_000_000, weights=EQUAL_WEIGHTS)
    assert out["mt_score"] == pytest.approx(round(expected, 2), abs=0.01)


def test_none_subscore_excluded_from_denominator():
    # Three Nones + three +60s -> straight equal-weight average of the
    # three +60s = +60 (not +30 as it would be if Nones counted as 0).
    #
    # v5.1: must pass weights=EQUAL_WEIGHTS explicitly. Under the calibrated
    # DEFAULT_WEIGHTS the technicals+analyst+short_interest trio is only
    # 30.36% of the total weight, which falls below the new
    # MIN_COVERAGE_WEIGHT_FRACTION (0.40) honest-score guard and now
    # returns Insufficient Data.
    from scanner.signal_intelligence_v5.composite import EQUAL_WEIGHTS
    subs = {
        "insider": None,
        "options": None,
        "congress": None,
        "technicals": 60,
        "analyst": 60,
        "short_interest": 60,
    }
    out = compute_composite(subs, market_cap=1e9, weights=EQUAL_WEIGHTS)
    assert out["mt_score"] == pytest.approx(60.0, abs=1e-6)


def test_all_none_returns_no_data():
    out = compute_composite({k: None for k in SIGNAL_KEYS}, market_cap=1e9)
    assert out["mt_score"] is None
    assert out["band"] == "No Data"


# ─────────────────────────────────────────────────────────────────────────────
# 4. Band assignment at boundaries
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("score, expected_band", [
    (-100.0, "Strong Sell"),
    (-75.0,  "Strong Sell"),
    (-50.01, "Strong Sell"),
    (-50.0,  "Watch Sell"),    # exact -50 -> Watch Sell (less-bearish band)
    (-35.0,  "Watch Sell"),
    (-20.01, "Watch Sell"),
    (-20.0,  "Neutral"),
    (-5.0,   "Neutral"),
    (0.0,    "Neutral"),
    (19.99,  "Neutral"),
    (20.0,   "Watch Buy"),
    (35.0,   "Watch Buy"),
    (49.99,  "Watch Buy"),
    (50.0,   "Strong Buy"),
    (75.0,   "Strong Buy"),
    (100.0,  "Strong Buy"),
])
def test_band_assignment_at_boundaries(score, expected_band):
    assert assign_band(score) == expected_band


def test_band_assignment_no_data_for_none():
    assert assign_band(None) == "No Data"
    assert assign_band(float("nan")) == "No Data"


# ─────────────────────────────────────────────────────────────────────────────
# 5. Cap-discount changes the composite outcome at mega-cap
# ─────────────────────────────────────────────────────────────────────────────

def test_cap_discount_reduces_insider_influence_at_megacap():
    """
    insider = -100, all other 5 signals = +50.
    At $500M (factor 1.00):    MT Score = (1*-100 + 5*50)/6 = 25
    At $4T (factor 0.25):
        insider weight   = 1/6 * 0.25 = 1/24
        others (each)    = 1/6 + (5/24)/5 = 1/6 + 1/24 = 5/24
        MT Score raw     = (-100 * 1/24) + (50 * 5/24) * 5
                         = -100/24 + 1250/24 = 1150/24 = ~47.92
    So mega-cap MT Score must be MUCH higher than small-cap (~48 vs ~25),
    because the bearish insider read is haircut to 25% influence.
    """
    subs = {
        "insider":        -100,
        "options":         50,
        "congress":        50,
        "technicals":      50,
        "analyst":         50,
        "short_interest":  50,
    }
    small = compute_composite(subs, market_cap=500_000_000, weights=EQUAL_WEIGHTS)
    mega = compute_composite(subs, market_cap=4_000_000_000_000, weights=EQUAL_WEIGHTS)

    # At $500M no discount: equal-weight average = (-100+5*50)/6 = 25.0
    assert small["mt_score"] == pytest.approx(25.0, abs=0.1)
    assert small["cap_discount_applied"] == pytest.approx(1.0, abs=1e-6)

    # At $4T factor 0.25:
    #   insider weight = (1/6) * 0.25 = 1/24
    #   freed = 1/6 - 1/24 = 3/24 = 1/8
    #   each other = 1/6 + (1/8)/5 = 1/6 + 1/40 = 23/120
    # MT raw = -100*(1/24) + 50*5*(23/120) = -100*5/120 + 50*115/120
    #        = (-500 + 5750)/120 = 5250/120 = 43.75
    expected_mega = 43.75
    assert mega["mt_score"] == pytest.approx(expected_mega, abs=0.05)
    assert mega["cap_discount_applied"] == pytest.approx(0.25, abs=1e-6)

    # And the discount must move the score meaningfully upward (the
    # bearish insider signal gets diluted to 1/24 weight at mega-cap).
    assert mega["mt_score"] > small["mt_score"] + 15


# ─────────────────────────────────────────────────────────────────────────────
# 6. "So what" generator across the 5 bands
# ─────────────────────────────────────────────────────────────────────────────

def test_so_what_strong_buy_lists_top_two_bullish():
    subs = {
        "insider":        90,
        "options":        80,
        "congress":       10,
        "technicals":     20,
        "analyst":         5,
        "short_interest": -5,
    }
    out = so_what_summary(70.0, "Strong Buy", subs)
    assert "Bullish" in out
    assert "insider buying" in out
    assert "options flow" in out


def test_so_what_strong_sell_lists_top_two_bearish_with_caveat():
    subs = {
        "insider":        -90,
        "options":        -80,
        "congress":        40,    # >+30, triggers caveat
        "technicals":     -10,
        "analyst":         -5,
        "short_interest":  -5,
    }
    out = so_what_summary(-55.0, "Strong Sell", subs)
    assert "Bearish" in out
    assert "insider selling" in out
    assert "options flow" in out
    assert "pushback" in out.lower()  # caveat about congress > +30


def test_so_what_watch_buy_mentions_main_driver():
    subs = {
        "insider":         60,
        "options":         15,
        "congress":         0,
        "technicals":      20,
        "analyst":         10,
        "short_interest":  -5,
    }
    out = so_what_summary(30.0, "Watch Buy", subs)
    assert "Tilting bullish" in out
    assert "insider buying" in out


def test_so_what_watch_sell_mentions_main_driver():
    subs = {
        "insider":        -60,
        "options":        -15,
        "congress":         0,
        "technicals":     -20,
        "analyst":         -5,
        "short_interest":   5,
    }
    out = so_what_summary(-30.0, "Watch Sell", subs)
    assert "Tilting bearish" in out
    assert "insider selling" in out


def test_so_what_neutral_mixed():
    subs = {
        "insider":         40,
        "options":        -35,
        "congress":         0,
        "technicals":       5,
        "analyst":          0,
        "short_interest":   0,
    }
    out = so_what_summary(0.0, "Neutral", subs)
    assert "Mixed read" in out or "Mostly quiet" in out


def test_so_what_no_data_is_explicit():
    out = so_what_summary(None, "No Data", {k: None for k in SIGNAL_KEYS})
    assert "insufficient data" in out.lower()


# ─────────────────────────────────────────────────────────────────────────────
# 7. Compute_mt_score I/O wrapper — mock the six scorers
# ─────────────────────────────────────────────────────────────────────────────

def _fake_score(sub: float | int | None) -> dict[str, Any]:
    return {
        "sub_score": sub,
        "components": {"reason": "mock"},
        "diagnostic": {"mock": True},
    }


def test_compute_mt_score_wires_all_six_and_applies_cap_discount():
    """
    Patch every scorer's score() to return a deterministic sub_score,
    then verify the composite result matches what compute_composite
    produces for the same inputs.
    """
    fake_subs = {
        "insider":        -60,
        "options":         30,
        "congress":         0,
        "technicals":      45,
        "analyst":         20,
        "short_interest": -10,
    }

    mod = "scanner.signal_intelligence_v5"
    with (
        patch(f"{mod}.composite.insider_score.score",
              return_value=_fake_score(fake_subs["insider"])),
        patch(f"{mod}.composite.options_score.score",
              return_value=_fake_score(fake_subs["options"])),
        patch(f"{mod}.composite.congress_score.score",
              return_value=_fake_score(fake_subs["congress"])),
        patch(f"{mod}.composite.technicals_score.score",
              return_value=_fake_score(fake_subs["technicals"])),
        patch(f"{mod}.composite.analyst_score.score",
              return_value=_fake_score(fake_subs["analyst"])),
        patch(f"{mod}.composite.short_interest_score.score",
              return_value=_fake_score(fake_subs["short_interest"])),
    ):
        out = compute_mt_score("NVDA", date(2026, 5, 10), market_cap=4e12)

    expected = compute_composite(fake_subs, market_cap=4e12)
    assert out["mt_score"] == pytest.approx(expected["mt_score"], abs=0.01)
    assert out["band"] == expected["band"]
    assert out["cap_discount_applied"] == pytest.approx(0.25, abs=1e-6)
    assert out["diagnostic"]["ticker"] == "NVDA"
    assert out["diagnostic"]["score_date"] == "2026-05-10"
    # Diagnostic carries each scorer's raw payload for debugging.
    assert set(out["diagnostic"]["scorer_diagnostics"].keys()) == set(SIGNAL_KEYS)


def test_compute_mt_score_with_all_none_returns_no_data():
    mod = "scanner.signal_intelligence_v5"
    none_payload = _fake_score(None)
    with (
        patch(f"{mod}.composite.insider_score.score", return_value=none_payload),
        patch(f"{mod}.composite.options_score.score", return_value=none_payload),
        patch(f"{mod}.composite.congress_score.score", return_value=none_payload),
        patch(f"{mod}.composite.technicals_score.score", return_value=none_payload),
        patch(f"{mod}.composite.analyst_score.score", return_value=none_payload),
        patch(f"{mod}.composite.short_interest_score.score", return_value=none_payload),
    ):
        out = compute_mt_score("ZZZZ", date(2026, 5, 10), market_cap=1e9)
    assert out["mt_score"] is None
    assert out["band"] == "No Data"
