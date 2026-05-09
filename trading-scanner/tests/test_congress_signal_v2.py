"""
Unit tests for scanner.signal_intelligence_v2.congress.

Anchors against the canonical NVDA worked example in
TRADING_OPPS_V2_SPEC.md §A0.5 (Congress Signal +72).

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \
      tests/test_congress_signal_v2.py -v -p no:cacheprovider
"""

from __future__ import annotations

import pytest

from scanner.signal_intelligence_v2.congress import compute_congress_signal


def _row(name: str, amounts: str):
    return {"name": name, "amounts": amounts}


# ─────────────────────────────────────────────────────────────────────────────
# A0.5 NVDA worked example — Congress Signal +72
#
#   Tuberville buy   $50,001 - $100,000     →  7 tier points
#   Pelosi     buy   $1,000,001 +           → 30 tier points
#   Hern       sell  $15,001 - $50,000      →  4 × 0.5 = 2 (subtracted)
#
#   Net = 37 - 2 = 35
#   Cluster bonus = 0 (only 2 unique buyers, need 3+)
#   raw = 35
#
#   Rolling stats (illustrative): mean=2, sd=11.5 across universe
#   z = (35 − 2) / 11.5 = 2.87, score = 2.87 × 25 = 71.7 → +72
# ─────────────────────────────────────────────────────────────────────────────

def test_nvda_worked_example_score_72():
    buys = [
        _row("Senator Tuberville", "$50,001 - $100,000"),
        _row("Rep. Pelosi", "$1,000,001 +"),
    ]
    sells = [_row("Rep. Hern", "$15,001 - $50,000")]
    score = compute_congress_signal(
        buys, sells, rolling_stats={"mean": 2.0, "sd": 11.5}
    )
    assert score == 72, f"Expected +72, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# Heavy buy cluster — 5 unique buyers triggers +15 bonus
# ─────────────────────────────────────────────────────────────────────────────

def test_cluster_buy_bonus_high():
    """5+ unique buyers should add +15 cluster bonus."""
    buys = [
        _row(f"Member {i}", "$15,001 - $50,000")  # 4 pts each
        for i in range(5)
    ]
    score = compute_congress_signal(
        buys, [], rolling_stats={"mean": 2.0, "sd": 11.5}
    )
    # 5 × 4 = 20 raw + 15 cluster = 35
    # z = (35 - 2) / 11.5 = 2.87, score = 71.7 → +72
    assert score is not None and score >= 65


# ─────────────────────────────────────────────────────────────────────────────
# Heavy congressional selling produces strong bearish
# ─────────────────────────────────────────────────────────────────────────────

def test_heavy_sells_produce_bearish():
    sells = [
        _row("Member A", "$1,000,001 +"),
        _row("Member B", "$500,001 - $1,000,000"),
    ]
    # Sells: 30 + 25 = 55, × 0.5 = 27.5 → net = -27.5
    # z = (-27.5 - 2) / 11.5 = -2.57, score = -64.1 → -64
    score = compute_congress_signal(
        [], sells, rolling_stats={"mean": 2.0, "sd": 11.5}
    )
    assert score is not None
    assert -75 < score <= -50, f"Expected Strong Bearish, got {score}"


# ─────────────────────────────────────────────────────────────────────────────
# No data → None
# ─────────────────────────────────────────────────────────────────────────────

def test_no_data_returns_none():
    assert compute_congress_signal(None, None) is None
    assert compute_congress_signal([], []) is None


# ─────────────────────────────────────────────────────────────────────────────
# Fallback scaling when rolling_stats absent (v1 ×3.3 retained)
# ─────────────────────────────────────────────────────────────────────────────

def test_fallback_v1_scaling():
    """Without rolling stats, fall back to v1 ×3.3 scaling for compatibility."""
    buys = [_row("Senator A", "$50,001 - $100,000")]  # 7 pts
    score = compute_congress_signal(buys, [])
    # raw = 7, no cluster, score = 7 × 3.3 = 23.1 → +23
    assert score == 23


# ─────────────────────────────────────────────────────────────────────────────
# Sells weighted at 0.5 — buys partially offset by sells
# ─────────────────────────────────────────────────────────────────────────────

def test_sells_at_half_weight():
    """A $1M+ buy is partially offset by a $1M+ sell at half weight."""
    buys = [_row("A", "$1,000,001 +")]    # 30 pts
    sells = [_row("B", "$1,000,001 +")]   # 30 pts × 0.5 = 15 (subtracted)
    score = compute_congress_signal(
        buys, sells, rolling_stats={"mean": 2.0, "sd": 11.5}
    )
    # net = 30 - 15 = 15, z = (15 - 2)/11.5 = 1.13, score = 28.3 → +28
    assert score is not None
    assert 20 < score < 35


# ─────────────────────────────────────────────────────────────────────────────
# Score caps at ±100
# ─────────────────────────────────────────────────────────────────────────────

def test_score_caps_at_100():
    """Astronomical raw shouldn't exceed +100."""
    buys = [_row(f"M{i}", "$1,000,001 +") for i in range(10)]  # 300 pts + cluster
    score = compute_congress_signal(
        buys, [], rolling_stats={"mean": 2.0, "sd": 11.5}
    )
    assert score == 100


# ─────────────────────────────────────────────────────────────────────────────
# Unknown amount string handled gracefully (0 points, not None)
# ─────────────────────────────────────────────────────────────────────────────

def test_unknown_amount_string_is_zero():
    buys = [_row("X", "Unknown Bucket")]
    score = compute_congress_signal(
        buys, [], rolling_stats={"mean": 2.0, "sd": 11.5}
    )
    # raw = 0, z = (0 - 2)/11.5 = -0.174, score = -4.35 → -4
    assert score is not None
    assert -10 < score < 5


# ─────────────────────────────────────────────────────────────────────────────
# Dash normalization — en-dash and em-dash treated as hyphen
# ─────────────────────────────────────────────────────────────────────────────

def test_dash_normalization():
    """UW occasionally returns en-dash; the function should normalize."""
    buys_endash = [_row("X", "$50,001 – $100,000")]   # en-dash (U+2013)
    buys_emdash = [_row("X", "$50,001 — $100,000")]   # em-dash (U+2014)
    s1 = compute_congress_signal(buys_endash, [])
    s2 = compute_congress_signal(buys_emdash, [])
    # Both should map to 7 pts × 3.3 = 23
    assert s1 == 23
    assert s2 == 23
