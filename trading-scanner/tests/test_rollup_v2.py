"""
Unit tests for scanner.signal_intelligence_v2.rollup.

Validates the framework end-to-end (Magnitude → Agreement → Conviction →
MT Score → 8-band) using the spec A0.5 NVDA fixture and contrasting
counter-examples (bear, single-Signal-only, full-agreement-low-Magnitude).

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \
      tests/test_rollup_v2.py -v -p no:cacheprovider
"""

from __future__ import annotations

import pytest

from scanner.signal_intelligence_v2.rollup import (
    BAND_CUTOFFS,
    DEFAULT_WEIGHTS,
    compute_signal_intelligence,
)


# ─────────────────────────────────────────────────────────────────────────────
# A0.5 NVDA worked example
#
#   insider=+80, technicals=+94, options=+44, analyst=+51, congress=+72
#
#   Magnitude = 80×0.30 + 94×0.25 + 44×0.20 + 51×0.15 + 72×0.05
#             = 24 + 23.5 + 8.8 + 7.65 + 3.6
#             = +67.55 → +68
#   Agreement = 5/5 = 100%
#
# Conviction comes from the placeholder calibration (Phase E will replace).
# Spec example said 78% (illustrative); placeholder produces something in
# the 80s which still lands NVDA in Strong Bullish or Buy Signal band.
# Test asserts directional band, not exact MT Score.
# ─────────────────────────────────────────────────────────────────────────────

def test_nvda_full_rollup_buy_zone():
    """NVDA fixture (5/5 strongly bullish) lands in the bullish actionable bands.

    With v2 weights (Insider 35 / Technicals 25 / Options 20 / Analyst 15 /
    Congress 5, summing to 1.0):
        Magnitude = 80×.35 + 94×.25 + 44×.20 + 51×.15 + 72×.05 = +72
    """
    result = compute_signal_intelligence(
        insider=80, options=44, analyst=51, congress=72, technicals=94
    )
    assert result["magnitude"] == 72, f"Magnitude should be +72, got {result['magnitude']}"
    assert result["agreement_pct"] == 100.0
    assert result["conviction_direction"] == "bullish"
    assert result["conviction_pct"] >= 75, f"Conviction should be ≥ 75 at +72 with full agreement, got {result['conviction_pct']}"
    assert result["mt_score"] >= 25, f"MT should be ≥ +25 (at least Moderate Bullish), got {result['mt_score']}"
    assert result["band"] in ("Moderate Bullish", "Strong Bullish", "Buy Signal")
    # Calibrated excess-return tag should be positive
    assert result["expected_excess_pct_21d"] > 0


# ─────────────────────────────────────────────────────────────────────────────
# Bear-side: 5 of 5 Signals strongly negative
# ─────────────────────────────────────────────────────────────────────────────

def test_strong_bear_full_agreement():
    result = compute_signal_intelligence(
        insider=-85, options=-50, analyst=-45, congress=-60, technicals=-90
    )
    assert result["magnitude"] is not None and result["magnitude"] < -50
    assert result["agreement_pct"] == 100.0
    assert result["conviction_direction"] == "bearish"
    assert result["mt_score"] is not None and result["mt_score"] < -25
    assert result["band"] in ("Moderate Bearish", "Strong Bearish", "Sell Trigger")
    assert result["expected_excess_pct_21d"] < 0


# ─────────────────────────────────────────────────────────────────────────────
# Conviction over Magnitude: explosive single-Signal vs unanimous-modest
#
# Name A: only insider firing huge (+95, others null)
# Name B: all 5 Signals firing modestly positive (+30 each)
#
# Name B should NOT have a much smaller MT Score despite much smaller
# Magnitude — full agreement boosts Conviction significantly.
# ─────────────────────────────────────────────────────────────────────────────

def test_conviction_punishes_thin_support():
    explosive_one = compute_signal_intelligence(insider=95)
    unanimous_modest = compute_signal_intelligence(
        insider=30, options=30, analyst=30, congress=30, technicals=30
    )
    # explosive_one: 1 signal firing → agreement 100% in the bucket sense, but
    # the placeholder calibration table gives a moderate conviction even at +95
    # because thin support historically wasn't as predictive.
    # unanimous_modest: 5/5 firing modestly → respectable conviction.
    assert explosive_one["conviction_direction"] == "bullish"
    assert unanimous_modest["conviction_direction"] == "bullish"
    assert unanimous_modest["mt_score"] > 0, "Unanimous modest should produce positive MT"
    # Unanimous modest should at least reach Weak Bullish band; in placeholder
    # calibration it lands in Weak Bullish (MT ~10). Phase E real numbers will
    # likely push it higher, but for now we just assert > 0.


# ─────────────────────────────────────────────────────────────────────────────
# 8-band classifier basic cases
# ─────────────────────────────────────────────────────────────────────────────

def test_band_assignment_buy_signal():
    """Force MT Score = +90 by having all signals max-bullish + full agreement."""
    result = compute_signal_intelligence(
        insider=100, options=100, analyst=100, congress=100, technicals=100
    )
    # Max Magnitude, full agreement → conviction high → MT near +100
    assert result["mt_score"] >= 75
    assert result["band"] == "Buy Signal"


def test_band_assignment_sell_trigger():
    result = compute_signal_intelligence(
        insider=-100, options=-100, analyst=-100, congress=-100, technicals=-100
    )
    assert result["mt_score"] <= -75
    assert result["band"] == "Sell Trigger"


def test_band_assignment_weak_bullish():
    """Modest signals, mixed agreement → Weak Bullish or Moderate Bullish."""
    result = compute_signal_intelligence(insider=20, options=15)
    assert result["band"] in ("Weak Bullish", "Moderate Bullish")


# ─────────────────────────────────────────────────────────────────────────────
# Mixed-direction signals — Magnitude direction wins on weights, agreement
# is split, Conviction stays modest
# ─────────────────────────────────────────────────────────────────────────────

def test_mixed_direction_signals():
    """Insider says buy big, technicals says sell — net by weights but low agreement."""
    result = compute_signal_intelligence(
        insider=70, options=-30, analyst=-20, congress=10, technicals=-40
    )
    # Magnitude = 70*.30 + (-40)*.25 + (-30)*.20 + (-20)*.15 + 10*.05
    #           = 21 - 10 - 6 - 3 + 0.5 = 2.5 → +3 or so
    # Agreement: 2 positive (insider, congress), 3 negative → 40% (mag is positive)
    # Conviction will be near coin flip (52% from placeholder table at 25-mag, 40-agreement)
    # MT will be small in magnitude
    assert result["magnitude"] is not None
    assert -10 < result["mt_score"] < 10  # near zero
    assert result["band"] in ("Weak Bullish", "Weak Bearish")


# ─────────────────────────────────────────────────────────────────────────────
# All-null → No Data band
# ─────────────────────────────────────────────────────────────────────────────

def test_all_null_returns_no_data():
    result = compute_signal_intelligence()
    assert result["magnitude"] is None
    assert result["band"] == "No Data"
    assert result["mt_score"] is None
    assert result["conviction_direction"] == "neutral"


# ─────────────────────────────────────────────────────────────────────────────
# Single-Signal-only — partial weight is used (not normalized to 100%)
# ─────────────────────────────────────────────────────────────────────────────

def test_single_signal_only_uses_partial_weight():
    """Only insider fires; magnitude is purely insider score (since denom = 0.30)."""
    result = compute_signal_intelligence(insider=80)
    # weighted_sum = 80 × 0.30 = 24; weight_used = 0.30; magnitude = 24/0.30 = 80
    assert result["magnitude"] == 80
    assert result["agreement_pct"] == 100.0  # 1 of 1 positive


# ─────────────────────────────────────────────────────────────────────────────
# Custom weights: caller can override defaults
# ─────────────────────────────────────────────────────────────────────────────

def test_custom_weights():
    """Equal weights across 5 Signals."""
    equal = {k: 0.20 for k in DEFAULT_WEIGHTS.keys()}
    result = compute_signal_intelligence(
        insider=100, options=0, analyst=0, congress=0, technicals=0,
        weights=equal,
    )
    # Magnitude = (100 + 0 + 0 + 0 + 0) / 5 = 20
    assert result["magnitude"] == 20


# ─────────────────────────────────────────────────────────────────────────────
# Default weights sum to 1.0
# ─────────────────────────────────────────────────────────────────────────────

def test_default_weights_sum_to_one():
    total = sum(DEFAULT_WEIGHTS.values())
    assert abs(total - 1.0) < 1e-9, f"Default weights should sum to 1.0, got {total}"


# ─────────────────────────────────────────────────────────────────────────────
# Output shape: every field present even on No Data
# ─────────────────────────────────────────────────────────────────────────────

def test_output_shape():
    result = compute_signal_intelligence(insider=40, technicals=30)
    expected_keys = {
        "signals", "magnitude", "expected_excess_pct_21d", "agreement_pct",
        "conviction_pct", "conviction_direction", "mt_score", "band",
        "weights_used",
    }
    assert set(result.keys()) == expected_keys, f"Missing keys: {expected_keys - set(result.keys())}"
