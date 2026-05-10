"""
Unit tests for scanner.signal_intelligence_v4.

Validates the gate-and-pillar logic per spec at
SIGNAL_INTELLIGENCE_V4_LOCKED.md.

Run:
    cd trading-scanner && PYTHONPATH=. python3 -m pytest \\
      tests/test_signal_intelligence_v4.py -v -p no:cacheprovider
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from scanner.signal_intelligence_v4 import (
    Band,
    HEDGE_TICKERS,
    apply_gates,
    aggression_pillar,
    hc_magnitude_threshold,
    is_first_buy,
    insider_gate_passes,
    magnitude_threshold,
    momentum_pillar,
    overbought_red_flag,
    score_pillars,
    score_ticker,
    squeeze_pillar,
)


# Default market cap for fixtures predating the cap-normalized magnitude rule.
# At $2B, the gate threshold is max(2 bps × $2B, $500k) = $400k, so the existing
# "_ev(...) at amount=1000, stock_price=50" → $50k aggregate would FAIL the
# magnitude check. Tests that need to focus on the first-buy path pass a
# market_cap of None (default) to skip the magnitude check, OR use the helper
# below to set an amount large enough to clear the $400k threshold.
DEFAULT_MARKET_CAP = 2_000_000_000  # $2B


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ev(d: date, owner: str, code: str = "P", amount: int = 10_000,
        stock_price: float = 50.0, is_officer: bool = True):
    """Default insider event = 10,000 shares × $50 = $500k aggregate.

    At $2B market cap (DEFAULT_MARKET_CAP), the cap-normalized magnitude
    threshold is max(2 bps × $2B, $500k) = $500k, so a single default _ev
    JUST clears the gate. Tests that need to fail magnitude can pass a
    smaller amount or set market_cap higher.
    """
    return {"date": d, "owner": owner, "transaction_code": code,
            "amount": amount, "stock_price": stock_price, "is_officer": is_officer}


# ─────────────────────────────────────────────────────────────────────────────
# Gate 1 — Insider P-buy + first-buy filter
# ─────────────────────────────────────────────────────────────────────────────

def test_gate_1_passes_with_one_first_buyer():
    today = date(2026, 4, 1)
    history = [_ev(today - timedelta(days=10), "Alice CEO")]
    result = insider_gate_passes(today, history, require_first_buy=True)
    assert result["passes"] is True
    assert result["unique_p_buyers"] == 1
    assert "alice ceo" in result["first_buyers"]
    assert result["total_dollar"] == 500_000.0


def test_gate_1_fails_when_only_repeat_buyer():
    """Buyer made a P-buy 6 months ago — not a first-buy → gate fails."""
    today = date(2026, 4, 1)
    history = [
        _ev(today - timedelta(days=200), "Alice CEO"),  # prior P-buy
        _ev(today - timedelta(days=10), "Alice CEO"),   # current 30d window
    ]
    result = insider_gate_passes(today, history, require_first_buy=True)
    # Current window has buyer, but they're a repeat-buyer
    assert result["passes"] is False
    assert "alice ceo" not in result["first_buyers"]


def test_gate_1_passes_with_first_buyer_alongside_repeat():
    today = date(2026, 4, 1)
    history = [
        _ev(today - timedelta(days=200), "Alice CEO"),  # repeat
        _ev(today - timedelta(days=10), "Alice CEO"),
        _ev(today - timedelta(days=5), "Bob Director"), # first
    ]
    result = insider_gate_passes(today, history, require_first_buy=True)
    assert result["passes"] is True
    assert result["unique_p_buyers"] == 2
    assert "bob director" in result["first_buyers"]


def test_gate_1_filters_non_p_codes():
    """Only 'P' transaction codes count. 'A', 'M', 'F', 'S' are NOT buys."""
    today = date(2026, 4, 1)
    history = [
        _ev(today - timedelta(days=10), "Alice CEO", code="A"),  # RSU grant
        _ev(today - timedelta(days=8), "Alice CEO", code="M"),    # option exercise
        _ev(today - timedelta(days=5), "Alice CEO", code="F"),    # tax withholding
    ]
    result = insider_gate_passes(today, history, require_first_buy=True)
    assert result["passes"] is False
    assert result["p_buys_in_window"] == 0


def test_gate_1_v4_0_fallback_no_first_buy_required():
    """require_first_buy=False falls back to v4.0 — any P-buy in window."""
    today = date(2026, 4, 1)
    history = [
        _ev(today - timedelta(days=200), "Alice CEO"),
        _ev(today - timedelta(days=10), "Alice CEO"),
    ]
    result = insider_gate_passes(today, history, require_first_buy=False)
    assert result["passes"] is True


def test_is_first_buy_helper():
    today = date(2026, 4, 1)
    history = [_ev(today - timedelta(days=200), "alice ceo")]
    assert is_first_buy("alice ceo", today, history) is False
    assert is_first_buy("bob director", today, history) is True


# ─────────────────────────────────────────────────────────────────────────────
# Gate 2 — Liquidity + Gate 3 — Anti-hedge
# ─────────────────────────────────────────────────────────────────────────────

def test_gate_2_blocks_low_price():
    result = apply_gates("LOWPX", date(2026, 4, 1), today_close=4.99,
                        avg_volume_22d=1_000_000, insider_history=[],
                        market_cap=DEFAULT_MARKET_CAP)
    assert result["gate_2_liquidity"] is False
    assert result["all_pass"] is False


def test_gate_2_blocks_low_volume():
    result = apply_gates("ILLIQUID", date(2026, 4, 1), today_close=20,
                        avg_volume_22d=100_000, insider_history=[],
                        market_cap=DEFAULT_MARKET_CAP)
    assert result["gate_2_liquidity"] is False


def test_gate_3_blocks_hedge_tickers():
    for t in HEDGE_TICKERS:
        result = apply_gates(t, date(2026, 4, 1), today_close=400,
                            avg_volume_22d=10_000_000,
                            insider_history=[_ev(date(2026, 3, 25), "X")],
                            market_cap=DEFAULT_MARKET_CAP)
        assert result["gate_3_anti_hedge"] is False, f"{t} should be blocked"


# ─────────────────────────────────────────────────────────────────────────────
# Pillar 1 — Aggression (RVOL > 1.5)
# ─────────────────────────────────────────────────────────────────────────────

def test_aggression_fires_at_rvol_above_1_5():
    assert aggression_pillar(volume_today=1_600_000, avg_volume_22d=1_000_000) == 25


def test_aggression_does_not_fire_at_rvol_below_1_5():
    assert aggression_pillar(volume_today=1_400_000, avg_volume_22d=1_000_000) == 0


def test_aggression_handles_zero_avg_volume():
    assert aggression_pillar(volume_today=1_000_000, avg_volume_22d=0) == 0


# ─────────────────────────────────────────────────────────────────────────────
# Pillar 2 — Squeeze (BB BandWidth < 4%)
# ─────────────────────────────────────────────────────────────────────────────

def test_squeeze_fires_in_tight_band():
    """Closes oscillating in a narrow range trigger the squeeze."""
    closes = [100.0 + 0.05 * (-1) ** i for i in range(20)]  # ±5 cents jitter
    assert squeeze_pillar(closes) == 20


def test_squeeze_does_not_fire_with_wide_band():
    """Wider price swings exceed 4% bandwidth."""
    closes = [100.0 + 5 * (-1) ** i for i in range(20)]
    assert squeeze_pillar(closes) == 0


# ─────────────────────────────────────────────────────────────────────────────
# Pillar 3 — Momentum (Close > 50-SMA AND RSI 40-70)
# ─────────────────────────────────────────────────────────────────────────────

def test_momentum_fires_when_above_sma_and_rsi_in_range():
    """Gentle uptrend with oscillation — close above SMA, RSI in healthy 40-70 range."""
    # +0.15/day drift with ±2 daily oscillation keeps RSI(14) near 50
    closes = [100 + 0.15 * i + 2 * ((-1) ** i) for i in range(60)]
    pts = momentum_pillar(closes)
    assert pts == 20


def test_momentum_blocked_by_overbought_rsi():
    """Vertical run-up → RSI > 70 → momentum blocked AND red flag fires."""
    closes = [100 + 2.0 * i for i in range(60)]  # straight up
    assert overbought_red_flag(closes) is True
    diag = score_pillars(volume_today=1, avg_volume_22d=1, closes=closes)
    assert diag["score_final"] == 0  # red flag zeros the score


def test_momentum_blocked_below_sma():
    """Downtrending series — close below 50-SMA → no momentum points."""
    closes = [200 - 1.0 * i for i in range(60)]
    pts = momentum_pillar(closes)
    assert pts == 0


# ─────────────────────────────────────────────────────────────────────────────
# Top-level scoring
# ─────────────────────────────────────────────────────────────────────────────

def test_score_ticker_actionable_path():
    """Full pipeline — passes all gates, fires Aggression + Momentum (RSI in 40-70)."""
    today = date(2026, 4, 1)
    # Gentle uptrend with oscillation — keeps RSI in healthy 40-70 range
    closes = [100 + 0.15 * i + 2 * ((-1) ** i) for i in range(60)]
    history = [_ev(today - timedelta(days=10), "Alice CEO")]

    result = score_ticker(
        ticker="ABCD",
        score_date=today,
        today_close=closes[-1],
        volume_today=1_800_000,         # RVOL = 1.8 → fires
        avg_volume_22d=1_000_000,
        closes_for_indicators=closes,
        insider_history=history,
        market_cap=DEFAULT_MARKET_CAP,
    )
    assert result.gate_pass is True
    assert result.score >= 25            # at least Aggression (RVOL 1.8 > 1.5)
    assert result.band in (Band.WATCH, Band.HIGH_CONVICTION)


def test_score_ticker_blocks_when_gate_fails():
    """No insider P-buy → gate fail → score 0 → not surfaced."""
    today = date(2026, 4, 1)
    closes = [100 + 0.5 * i for i in range(60)]
    result = score_ticker(
        ticker="XYZ",
        score_date=today,
        today_close=closes[-1],
        volume_today=10_000_000,
        avg_volume_22d=1_000_000,
        closes_for_indicators=closes,
        insider_history=[],
        market_cap=DEFAULT_MARKET_CAP,
    )
    assert result.gate_pass is False
    assert result.score == 0
    assert result.band == Band.NOT_SURFACED


def test_score_ticker_repeat_buyer_blocked_under_v4_1():
    """Repeat-buyer — should fail gate under v4.1 default (require_first_buy=True)."""
    today = date(2026, 4, 1)
    history = [
        _ev(today - timedelta(days=200), "Alice CEO"),
        _ev(today - timedelta(days=10), "Alice CEO"),
    ]
    closes = [100 + 0.5 * i for i in range(60)]
    result = score_ticker(
        ticker="ABCD", score_date=today, today_close=closes[-1],
        volume_today=2_000_000, avg_volume_22d=1_000_000,
        closes_for_indicators=closes, insider_history=history,
        require_first_buy=True,
        market_cap=DEFAULT_MARKET_CAP,
    )
    assert result.gate_pass is False
    assert result.band == Band.NOT_SURFACED


def test_score_ticker_repeat_buyer_passes_under_v4_0_fallback():
    """Same fixture passes when require_first_buy=False (v4.0 fallback)."""
    today = date(2026, 4, 1)
    history = [
        _ev(today - timedelta(days=200), "Alice CEO"),
        _ev(today - timedelta(days=10), "Alice CEO"),
    ]
    closes = [100 + 0.5 * i for i in range(60)]
    result = score_ticker(
        ticker="ABCD", score_date=today, today_close=closes[-1],
        volume_today=2_000_000, avg_volume_22d=1_000_000,
        closes_for_indicators=closes, insider_history=history,
        require_first_buy=False,
        market_cap=DEFAULT_MARKET_CAP,
    )
    assert result.gate_pass is True


# ─────────────────────────────────────────────────────────────────────────────
# data_source param — production switch
# ─────────────────────────────────────────────────────────────────────────────

def test_data_source_memory_is_default():
    """Default data_source='memory' uses in-memory list, no env vars needed."""
    today = date(2026, 4, 1)
    history = [_ev(today - timedelta(days=10), "Alice CEO")]
    result = apply_gates(
        ticker="TEST", score_date=today,
        today_close=100, avg_volume_22d=1_000_000,
        insider_history=history,
        market_cap=DEFAULT_MARKET_CAP,
    )
    # Should pass without any Supabase env vars
    assert result["data_source"] == "memory"
    assert result["gate_1_insider"]["passes"] is True


def test_data_source_supabase_requires_ticker():
    """data_source='supabase' without ticker should error."""
    today = date(2026, 4, 1)
    with pytest.raises(ValueError, match="ticker"):
        insider_gate_passes(
            score_date=today,
            insider_history=[_ev(today, "Alice")],
            data_source="supabase",
            ticker=None,
        )


def test_data_source_supabase_path_imports_correctly():
    """data_source='supabase' should import insider_ingest without error.

    We don't actually call query_first_buy here (no live Supabase in tests),
    but the import should resolve. With an empty 30-day window the gate
    short-circuits before hitting Supabase.
    """
    today = date(2026, 4, 1)
    # No P-buys → gate fails on the 30-day window before any first-buy lookup
    result = insider_gate_passes(
        score_date=today,
        insider_history=[],
        data_source="supabase",
        ticker="TEST",
    )
    assert result["passes"] is False
    assert result["data_source"] == "supabase"


# ─────────────────────────────────────────────────────────────────────────────
# Cap-normalized magnitude threshold (v4.1.1, 2026-05-09)
# ─────────────────────────────────────────────────────────────────────────────

def test_magnitude_threshold_caps_normalized():
    """Verify the threshold math at $500M, $5B, $25B, $500B, $4T.

    Gate threshold = max(2 bps × cap, $500k floor).
    HC threshold   = max(5 bps × cap, $5M floor).
    """
    # $500M — both floors bind
    assert magnitude_threshold(500_000_000) == 500_000           # max($100k, $500k)
    assert hc_magnitude_threshold(500_000_000) == 5_000_000      # max($250k, $5M)

    # $5B — gate ratio binds, HC floor binds
    assert magnitude_threshold(5_000_000_000) == 1_000_000       # max($1M, $500k)
    assert hc_magnitude_threshold(5_000_000_000) == 5_000_000    # max($2.5M, $5M)

    # $25B — both ratios bind
    assert magnitude_threshold(25_000_000_000) == 5_000_000      # max($5M, $500k)
    assert hc_magnitude_threshold(25_000_000_000) == 12_500_000  # max($12.5M, $5M)

    # $500B — both ratios bind, well above floors
    assert magnitude_threshold(500_000_000_000) == 100_000_000   # max($100M, $500k)
    assert hc_magnitude_threshold(500_000_000_000) == 250_000_000  # max($250M, $5M)

    # $4T — mega-cap
    assert magnitude_threshold(4_000_000_000_000) == 800_000_000  # max($800M, $500k)
    assert hc_magnitude_threshold(4_000_000_000_000) == 2_000_000_000  # max($2B, $5M)


def test_gate_1_fails_when_magnitude_below_threshold_at_large_cap():
    """At a $25B cap, the gate threshold is $5M (2 bps × $25B).

    A buy aggregating to $5M JUST clears; $4M aggregate fails.
    """
    today = date(2026, 4, 1)
    cap = 25_000_000_000  # $25B → $5M gate threshold

    # $5M aggregate — 100k shares × $50 = $5,000,000 → clears (>= 5M)
    history_pass = [_ev(today - timedelta(days=10), "Alice CEO",
                        amount=100_000, stock_price=50.0)]
    result_pass = insider_gate_passes(
        today, history_pass, require_first_buy=True, market_cap=cap,
    )
    assert result_pass["total_dollar"] == 5_000_000.0
    assert result_pass["magnitude_passes"] is True
    assert result_pass["passes"] is True

    # $4M aggregate — 80k shares × $50 = $4,000,000 → fails
    history_fail = [_ev(today - timedelta(days=10), "Alice CEO",
                        amount=80_000, stock_price=50.0)]
    result_fail = insider_gate_passes(
        today, history_fail, require_first_buy=True, market_cap=cap,
    )
    assert result_fail["total_dollar"] == 4_000_000.0
    assert result_fail["magnitude_passes"] is False
    assert result_fail["passes"] is False


def test_high_conviction_requires_hc_magnitude():
    """At $25B cap, HC threshold is $12.5M (5 bps × $25B).

    A score >= 45 with $10M insider $ → demoted to Watch.
    Same setup with $15M insider $ → lands in High Conviction.
    """
    today = date(2026, 4, 1)
    cap = 25_000_000_000  # $25B
    # Closes engineered to land RSI in 40-70 + close > 50-SMA + tight band:
    # all three pillars fire → score 65.
    closes = [100.0 + 0.05 * (-1) ** i for i in range(60)]

    # $10M insider $ — clears gate ($5M) but NOT HC ($12.5M) → Watch
    history_watch = [_ev(today - timedelta(days=10), "Alice CEO",
                         amount=200_000, stock_price=50.0)]  # $10M
    result_watch = score_ticker(
        ticker="BIG", score_date=today, today_close=closes[-1],
        volume_today=1_800_000, avg_volume_22d=1_000_000,
        closes_for_indicators=closes, insider_history=history_watch,
        market_cap=cap,
    )
    assert result_watch.gate_pass is True
    assert result_watch.score >= 45
    assert result_watch.hc_eligible is False
    assert result_watch.band == Band.WATCH

    # $15M insider $ — clears both gate ($5M) and HC ($12.5M) → High Conviction
    history_hc = [_ev(today - timedelta(days=10), "Alice CEO",
                      amount=300_000, stock_price=50.0)]  # $15M
    result_hc = score_ticker(
        ticker="BIG", score_date=today, today_close=closes[-1],
        volume_today=1_800_000, avg_volume_22d=1_000_000,
        closes_for_indicators=closes, insider_history=history_hc,
        market_cap=cap,
    )
    assert result_hc.gate_pass is True
    assert result_hc.score >= 45
    assert result_hc.hc_eligible is True
    assert result_hc.band == Band.HIGH_CONVICTION


def test_floor_binds_at_small_cap():
    """At $300M cap, 2 bps × $300M = $60k → $500k FLOOR binds.

    $400k aggregate fails ($400k < $500k); $600k clears.
    """
    today = date(2026, 4, 1)
    cap = 300_000_000  # $300M

    # $400k — below floor → fails
    history_fail = [_ev(today - timedelta(days=10), "Alice CEO",
                        amount=8_000, stock_price=50.0)]  # $400k
    result_fail = insider_gate_passes(
        today, history_fail, require_first_buy=True, market_cap=cap,
    )
    assert result_fail["total_dollar"] == 400_000.0
    assert result_fail["magnitude_threshold"] == 500_000
    assert result_fail["magnitude_passes"] is False
    assert result_fail["passes"] is False

    # $600k — above floor → clears
    history_pass = [_ev(today - timedelta(days=10), "Alice CEO",
                        amount=12_000, stock_price=50.0)]  # $600k
    result_pass = insider_gate_passes(
        today, history_pass, require_first_buy=True, market_cap=cap,
    )
    assert result_pass["total_dollar"] == 600_000.0
    assert result_pass["magnitude_threshold"] == 500_000
    assert result_pass["magnitude_passes"] is True
    assert result_pass["passes"] is True
