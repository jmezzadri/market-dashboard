"""
Unit tests for scanner.signal_intelligence_v2.analyst.

Anchors against the canonical NVDA worked example in
TRADING_OPPS_V2_SPEC.md §A0.5 (Analyst Signal +51).

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \
      tests/test_analyst_signal_v2.py -v -p no:cacheprovider
"""

from __future__ import annotations

import pytest

from scanner.signal_intelligence_v2.analyst import compute_analyst_signal


def _act(action_type: str, broker_tier: str = "top"):
    return {"action_type": action_type, "broker_tier": broker_tier}


# ─────────────────────────────────────────────────────────────────────────────
# A0.5 NVDA worked example — Analyst Signal +51
#
#   Goldman Sachs upgrade Hold → Buy   (top-tier)   → +12 × 1.0 = +12
#   Citi initiation Buy from no-cov    (top-tier)   → (12 + 10) × 1.0 = +22
#   BTIG downgrade Buy → Hold          (mid-tier)   → -12 × 0.7 = -8.4
#   JPM reiterated Buy                 (top-tier)   → 0
#   Morgan Stanley PT raise            → captured via pt_change_pct, not actions
#
#   Action total = 12 + 22 - 8.4 + 0 = 25.6
#   PT change: $880 → $935 = +6.25% × 4 = +25 (capped)
#   Total = 25.6 + 25 = 50.6 → +51
# ─────────────────────────────────────────────────────────────────────────────

def test_nvda_worked_example_score_51():
    actions = [
        _act("upgrade", "top"),
        _act("initiation_buy", "top"),
        _act("downgrade", "mid"),
        _act("maintained", "top"),
    ]
    score = compute_analyst_signal(actions, pt_change_pct=6.25)
    assert score == 51, f"Expected +51, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Symmetry — bearish version of NVDA fixture mirrors to roughly opposite sign
# ─────────────────────────────────────────────────────────────────────────────

def test_bearish_actions_mirror_score():
    actions = [
        _act("downgrade", "top"),
        _act("initiation_sell", "top"),
        _act("upgrade", "mid"),
        _act("maintained", "top"),
    ]
    score = compute_analyst_signal(actions, pt_change_pct=-6.25)
    # Action total = -12 -22 +8.4 +0 = -25.6
    # PT change = -25
    # Total ≈ -51
    assert score is not None
    assert -55 <= score <= -45, f"Expected ≈ −51 (mirror of NVDA), got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Top-tier initiation bonus — without bonus, score is much smaller
# ─────────────────────────────────────────────────────────────────────────────

def test_top_tier_initiation_bonus_applied():
    """A top-tier initiation should produce +22 (12 + 10), mid-tier just +8.4."""
    top = compute_analyst_signal([_act("initiation_buy", "top")], pt_change_pct=None)
    mid = compute_analyst_signal([_act("initiation_buy", "mid")], pt_change_pct=None)
    assert top == 22, f"Top-tier initiation should be +22, got {top}"
    # Mid-tier: 12 × 0.7 = 8.4 → 8 rounded
    assert mid == 8, f"Mid-tier initiation should be +8 (no bonus), got {mid}"


# ─────────────────────────────────────────────────────────────────────────────
# Hold initiation — no points (no directional bias)
# ─────────────────────────────────────────────────────────────────────────────

def test_hold_initiation_zero_points():
    score = compute_analyst_signal([_act("initiation_hold", "top")], pt_change_pct=None)
    # Action contribution 0, no PT data → returns 0 (not None — actions present).
    assert score == 0


# ─────────────────────────────────────────────────────────────────────────────
# PT change alone (no action events) → score from PT change only
# ─────────────────────────────────────────────────────────────────────────────

def test_pt_change_only():
    """Median PT raised 5% over window, no rating events."""
    score = compute_analyst_signal(actions=[], pt_change_pct=5.0)
    # Action 0, PT 5 × 4 = 20 → +20
    assert score == 20


def test_pt_change_caps_at_25():
    """Massive PT raise still caps at +25."""
    score = compute_analyst_signal([], pt_change_pct=20.0)
    assert score == 25


# ─────────────────────────────────────────────────────────────────────────────
# No data → None (excluded from Magnitude rollup)
# ─────────────────────────────────────────────────────────────────────────────

def test_no_data_returns_none():
    assert compute_analyst_signal(None, None) is None
    assert compute_analyst_signal([], None) is None


# ─────────────────────────────────────────────────────────────────────────────
# Action score caps at ±50
# ─────────────────────────────────────────────────────────────────────────────

def test_action_score_caps_at_max():
    """A pile of top-tier upgrades shouldn't push past ±50."""
    actions = [_act("upgrade", "top") for _ in range(10)]  # 10 × 12 = 120 raw
    score = compute_analyst_signal(actions, pt_change_pct=None)
    assert score == 50, f"Action component should cap at +50, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Mid-tier upgrades scaled by 0.7
# ─────────────────────────────────────────────────────────────────────────────

def test_broker_tier_weighting():
    """Same action at different broker tiers produces different contributions."""
    top = compute_analyst_signal([_act("upgrade", "top")], pt_change_pct=None)
    mid = compute_analyst_signal([_act("upgrade", "mid")], pt_change_pct=None)
    small = compute_analyst_signal([_act("upgrade", "small")], pt_change_pct=None)
    # top: 12 × 1.0 = 12. mid: 12 × 0.7 = 8.4 → 8. small: 12 × 0.4 = 4.8 → 5.
    assert top == 12
    assert mid == 8
    assert small == 5
