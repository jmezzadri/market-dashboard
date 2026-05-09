"""
Unit tests for scanner.signal_intelligence_v2.technicals.

Anchors against the canonical NVDA worked example in
TRADING_OPPS_V2_SPEC.md §A0.5 (Technicals Signal +94 spec / ~+92 computed).

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \
      tests/test_technicals_signal_v2.py -v -p no:cacheprovider
"""

from __future__ import annotations

import pytest

from scanner.signal_intelligence_v2.technicals import compute_technicals_signal


# ─────────────────────────────────────────────────────────────────────────────
# A0.5 NVDA worked example — Technicals Signal target ~+94 (computed +92)
#
#   12-month return excl. last month: +37.1% → top 8% of universe (rank 0.92)
#   52-week-high proximity: 890/920 = 0.967
#   6-month excess return vs SPY: +12% (NVDA +18% vs SPY +6%)
#   Volume ratio: 1.58 (above 1.5x threshold → ×1.1 amplify)
#
#   c1 = (0.92 − 0.5) × 77.78 = +32.67
#   c2 = (0.967 − 0.85) × 233.33 = +27.30
#   c3 = 12 × 2.0 = +24.00
#   sum = 83.97
#   ×1.1 (vol amplify) = +92.37 → +92
#
# Spec says +94; this is illustrative-vs-precise rounding. Test accepts
# the band [88, 100] — Strong Bullish to Buy Signal range.
# ─────────────────────────────────────────────────────────────────────────────

def test_nvda_worked_example_strong_bullish_with_volume_amp():
    score = compute_technicals_signal(
        momentum_rank_pct=0.92,
        pct_to_52w_high=0.967,
        excess_return_6m_pct=12.0,
        vol_ratio=1.58,
    )
    assert score is not None
    assert 88 <= score <= 100, f"Expected near +94 (88–100), got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Strong bear — bottom rank, deep drawdown from 52w high, underperforming SPY
# ─────────────────────────────────────────────────────────────────────────────

def test_strong_bear():
    score = compute_technicals_signal(
        momentum_rank_pct=0.05,        # bottom 5%
        pct_to_52w_high=0.50,          # 50% below 52w high
        excess_return_6m_pct=-15.0,    # -15% vs SPY
        vol_ratio=1.0,                 # normal volume
    )
    # c1 = (-0.45)*77.78 = -35
    # c2 = (-0.35)*233.33 = -81.7 → clamped -35
    # c3 = -30 (saturates at ±30 per scale)
    # sum = -100, no vol mult, score = -100
    assert score == -100, f"Expected −100 (saturated bear), got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Volume dampens thin participation
# ─────────────────────────────────────────────────────────────────────────────

def test_volume_dampens_thin_action():
    """A bullish setup on thin volume gets dampened ×0.9."""
    no_vol = compute_technicals_signal(
        momentum_rank_pct=0.85, pct_to_52w_high=0.95,
        excess_return_6m_pct=8.0, vol_ratio=None,
    )
    thin = compute_technicals_signal(
        momentum_rank_pct=0.85, pct_to_52w_high=0.95,
        excess_return_6m_pct=8.0, vol_ratio=0.5,  # below 0.7 threshold
    )
    assert no_vol > 0 and thin > 0
    assert thin < no_vol, f"Thin volume should produce lower score; no_vol={no_vol}, thin={thin}"


# ─────────────────────────────────────────────────────────────────────────────
# Volume amplifies heavy participation
# ─────────────────────────────────────────────────────────────────────────────

def test_volume_amplifies_heavy_action():
    no_vol = compute_technicals_signal(
        momentum_rank_pct=0.85, pct_to_52w_high=0.95,
        excess_return_6m_pct=8.0, vol_ratio=None,
    )
    heavy = compute_technicals_signal(
        momentum_rank_pct=0.85, pct_to_52w_high=0.95,
        excess_return_6m_pct=8.0, vol_ratio=2.0,
    )
    assert heavy > no_vol


# ─────────────────────────────────────────────────────────────────────────────
# All-None → Signal returns None
# ─────────────────────────────────────────────────────────────────────────────

def test_no_data_returns_none():
    assert compute_technicals_signal(None, None, None) is None


# ─────────────────────────────────────────────────────────────────────────────
# Partial data still scores (caller passes some Nones)
# ─────────────────────────────────────────────────────────────────────────────

def test_partial_inputs_score():
    """Only momentum rank known → score from rank component alone."""
    score = compute_technicals_signal(
        momentum_rank_pct=0.95,   # top 5% → +35
        pct_to_52w_high=None,
        excess_return_6m_pct=None,
    )
    assert score == 35


# ─────────────────────────────────────────────────────────────────────────────
# Median name (rank 0.5, at midpoint of 52w range, no excess) → near zero
# ─────────────────────────────────────────────────────────────────────────────

def test_median_name_near_zero():
    score = compute_technicals_signal(
        momentum_rank_pct=0.50,
        pct_to_52w_high=0.85,    # at proximity center
        excess_return_6m_pct=0.0,
    )
    assert score == 0


# ─────────────────────────────────────────────────────────────────────────────
# Symmetry — invert all three inputs around their centers and signs flip
# ─────────────────────────────────────────────────────────────────────────────

def test_symmetry():
    bull = compute_technicals_signal(0.92, 0.967, 12.0, 1.0)
    bear = compute_technicals_signal(0.08, 0.733, -12.0, 1.0)
    # 0.92 ↔ 0.08 (mirror around 0.5)
    # 0.967 ↔ 0.733 (mirror around 0.85)
    # +12 ↔ -12
    assert bull is not None and bear is not None
    assert abs(bull + bear) <= 2, f"Symmetric inputs should mirror; bull={bull}, bear={bear}"


# ─────────────────────────────────────────────────────────────────────────────
# Score caps at ±100
# ─────────────────────────────────────────────────────────────────────────────

def test_score_caps_at_100():
    score = compute_technicals_signal(
        momentum_rank_pct=1.0, pct_to_52w_high=1.0,
        excess_return_6m_pct=50.0, vol_ratio=2.5,
    )
    assert score == 100
