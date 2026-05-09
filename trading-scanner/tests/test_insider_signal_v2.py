"""
Unit tests for scanner.signal_intelligence_v2.insider.

Anchors against the canonical NVDA worked example in
TRADING_OPPS_V2_SPEC.md §A0.5 (Insider Signal +80) and the bear-side
counter-example (cluster sell → Strong Bearish, score ≤ −75).

Run:
    cd trading-scanner && python -m pytest tests/test_insider_signal_v2.py -v
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from scanner.signal_intelligence_v2.insider import (
    CLUSTER_BONUS_HIGH,
    classify_routine,
    compute_insider_signal,
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixture helpers
# ─────────────────────────────────────────────────────────────────────────────

def _row(amount, price, owner, is_officer, is_routine=False):
    return {
        "amount": amount,
        "stock_price": price,
        "owner_name": owner,
        "is_officer": is_officer,
        "is_routine": is_routine,
    }


# ─────────────────────────────────────────────────────────────────────────────
# A0.5 NVDA worked example — must produce Insider Signal = +80
#
#   CFO Colette Kress   bought  5,000 @ $850 = $4.25M  (officer, opportunistic)
#   Director Aarti Shah bought  2,000 @ $860 = $1.72M  (director, opportunistic)
#   CEO Jensen Huang    sold  100,000 @ $870 = $87M    (10b5-1 plan → routine)
#   VP Tim Teter        sold    5,000 @ $865 = $4.32M  (10b5-1 plan → routine)
#
# Buys: $5.97M total, log10 − 5 = 1.776, ×1.5 officer mult = 2.664
# Sells: 0 (both classified routine, excluded)
# Net = 2.664. Cluster bonus = 0 (only 2 unique buyers, need 3+).
# Raw = 2.664 × 30 + 0 = 79.92 → +80
# ─────────────────────────────────────────────────────────────────────────────

def test_nvda_worked_example_score_80():
    buys = [
        _row(5_000, 850.0, "Colette Kress", is_officer=True, is_routine=False),
        _row(2_000, 860.0, "Aarti Shah", is_officer=False, is_routine=False),
    ]
    sells = [
        _row(100_000, 870.0, "Jensen Huang", is_officer=True, is_routine=True),
        _row(5_000, 865.0, "Tim Teter", is_officer=True, is_routine=True),
    ]
    assert compute_insider_signal(buys, sells) == 80


# ─────────────────────────────────────────────────────────────────────────────
# Bear-side counter-example — coordinated officer exit must trigger Strong
# Bearish (≤ −75). 4 officers selling opportunistically in the window fires
# the cluster-sell trigger, restoring full weight on the sell side.
# ─────────────────────────────────────────────────────────────────────────────

def test_cluster_sell_triggers_strong_bearish():
    sells = [
        _row(50_000, 200.0, "CEO Smith", is_officer=True, is_routine=False),
        _row(40_000, 200.0, "CFO Jones", is_officer=True, is_routine=False),
        _row(30_000, 200.0, "VP Lee", is_officer=True, is_routine=False),
        _row(20_000, 200.0, "VP Patel", is_officer=True, is_routine=False),
    ]
    score = compute_insider_signal([], sells)
    assert score is not None
    assert score <= -75, f"Expected Strong Bearish (≤ −75), got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Single opportunistic officer sell — no cluster trigger, sells weighted ½.
# Should land in Moderate Bearish band, not Strong Bearish.
# ─────────────────────────────────────────────────────────────────────────────

def test_single_opportunistic_sell_at_half_weight():
    sells = [_row(10_000, 500.0, "VP Single", is_officer=True, is_routine=False)]
    score = compute_insider_signal([], sells)
    assert score is not None
    assert -50 < score <= -25, f"Expected Moderate Bearish, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# All-routine — Signal returns None (not 0), excluded from Magnitude rollup.
# ─────────────────────────────────────────────────────────────────────────────

def test_all_routine_returns_none():
    buys = [_row(10_000, 100.0, "Director Smith", is_officer=False, is_routine=True)]
    sells = [_row(5_000, 100.0, "VP Jones", is_officer=True, is_routine=True)]
    assert compute_insider_signal(buys, sells) is None


def test_no_data_returns_none():
    assert compute_insider_signal(None, None) is None
    assert compute_insider_signal([], []) is None


# ─────────────────────────────────────────────────────────────────────────────
# Below $25K floor — excluded.
# ─────────────────────────────────────────────────────────────────────────────

def test_below_floor_excluded():
    buys = [_row(100, 100.0, "Director Tiny", is_officer=False, is_routine=False)]
    assert compute_insider_signal(buys, []) is None


# ─────────────────────────────────────────────────────────────────────────────
# Cluster buy bonus fires at 5 unique opportunistic buyers.
# 5 × $100K = $500K total, log10 − 5 = 0.699, no officer mult.
# Net = 0.699. Cluster bonus = +15.
# Raw = 0.699 × 30 + 15 = 35.97 → +36.
# ─────────────────────────────────────────────────────────────────────────────

def test_cluster_buy_bonus_high():
    buys = [
        _row(1_000, 100.0, f"Buyer {i}", is_officer=False, is_routine=False)
        for i in range(5)
    ]
    score = compute_insider_signal(buys, [])
    assert score is not None
    # Without cluster bonus, the score would be ~21. The bonus pushes it past 30.
    assert score >= 30, f"Expected cluster bonus to push score ≥ 30, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Mixed buys + lone opportunistic sell — sells at ½ weight, partial offset.
# ─────────────────────────────────────────────────────────────────────────────

def test_mixed_buys_and_lone_sell():
    """Buys outweigh a lone sell; ½-weight on the sell preserves bullish tilt."""
    buys = [
        _row(5_000, 850.0, "Colette Kress", is_officer=True, is_routine=False),
        _row(2_000, 860.0, "Aarti Shah", is_officer=False, is_routine=False),
    ]
    sells = [
        _row(5_000, 865.0, "Tim Teter", is_officer=True, is_routine=False),
    ]
    score = compute_insider_signal(buys, sells)
    # Buy contribution: 1.776 × 1.5 = 2.664
    # Sell contribution: 1.635 × 1.5 × 0.5 = 1.226
    # Net = 1.438. Raw = 1.438 × 30 = 43.14 → +43.
    assert score is not None
    assert 35 <= score <= 50, f"Expected Moderate Bullish, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Routine classifier — 3+ prior years, same calendar month → routine.
# ─────────────────────────────────────────────────────────────────────────────

def test_classify_routine_three_year_pattern():
    target = datetime(2026, 5, 8, tzinfo=timezone.utc)
    history = [
        {"transaction_date": datetime(2025, 5, 12, tzinfo=timezone.utc)},
        {"transaction_date": datetime(2024, 5, 8, tzinfo=timezone.utc)},
        {"transaction_date": datetime(2023, 5, 15, tzinfo=timezone.utc)},
    ]
    assert classify_routine("ceo_jensen_nvda", target, history) is True


def test_classify_opportunistic_irregular():
    target = datetime(2026, 5, 8, tzinfo=timezone.utc)
    history = [
        {"transaction_date": datetime(2025, 9, 12, tzinfo=timezone.utc)},
        {"transaction_date": datetime(2024, 1, 8, tzinfo=timezone.utc)},
    ]
    assert classify_routine("cfo_kress_nvda", target, history) is False


def test_classify_opportunistic_two_years_only():
    """2 prior years same month is not enough — must be 3+."""
    target = datetime(2026, 5, 8, tzinfo=timezone.utc)
    history = [
        {"transaction_date": datetime(2025, 5, 12, tzinfo=timezone.utc)},
        {"transaction_date": datetime(2024, 5, 8, tzinfo=timezone.utc)},
    ]
    assert classify_routine("ceo", target, history) is False
