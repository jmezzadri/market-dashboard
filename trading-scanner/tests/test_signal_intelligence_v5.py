"""
Unit tests — Signal Intelligence v5 Phase 1.

Covers all six scorer modules. Each scorer gets at least 4 tests:
bullish path, bearish path, neutral/empty path, edge case.

Pure scoring functions are tested directly (no Supabase round-trip).
The score(ticker, score_date) functions that hit Supabase are exercised
via monkey-patching in the per-scorer "integration" tests below.

Run:
    cd trading-scanner && python -m pytest tests/test_signal_intelligence_v5.py -v
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest

# ─────────────────────────────────────────────────────────────────────────────
# Universe selection
# ─────────────────────────────────────────────────────────────────────────────

from scanner.signal_intelligence_v5.universe import filter_universe_v5


def test_universe_passes_common_stock_above_thresholds():
    candidates = [
        {"ticker": "AAPL", "type": "CS", "market_cap": 3e12, "last_close": 195.0},
        {"ticker": "MSFT", "type": "CS", "market_cap": 2.8e12, "last_close": 415.0},
        {"ticker": "BABA", "type": "ADRC", "market_cap": 200e9, "last_close": 78.0},
    ]
    out = filter_universe_v5(candidates)
    assert out == ["AAPL", "BABA", "MSFT"]


def test_universe_excludes_etfs_warrants_funds():
    candidates = [
        {"ticker": "SPY", "type": "ETF", "market_cap": 500e9, "last_close": 500.0},
        {"ticker": "ARKK", "type": "ETF", "market_cap": 6e9, "last_close": 50.0},
        {"ticker": "FOO.WS", "type": "WARRANT", "market_cap": 1e9, "last_close": 6.0},
        {"ticker": "BAR", "type": "FUND", "market_cap": 2e9, "last_close": 10.0},
        {"ticker": "QQQ", "type": "ETF", "market_cap": 200e9, "last_close": 470.0},
    ]
    assert filter_universe_v5(candidates) == []


def test_universe_excludes_below_market_cap():
    candidates = [
        {"ticker": "TINY", "type": "CS", "market_cap": 100e6, "last_close": 50.0},
        {"ticker": "EDGE", "type": "CS", "market_cap": 299_999_999, "last_close": 50.0},
        {"ticker": "JUST", "type": "CS", "market_cap": 300_000_000, "last_close": 50.0},
    ]
    assert filter_universe_v5(candidates) == ["JUST"]


def test_universe_excludes_below_5_dollar_close():
    candidates = [
        {"ticker": "PENNY", "type": "CS", "market_cap": 1e9, "last_close": 4.99},
        {"ticker": "EDGE", "type": "CS", "market_cap": 1e9, "last_close": 5.00},  # > $5 strictly
        {"ticker": "OK", "type": "CS", "market_cap": 1e9, "last_close": 5.01},
    ]
    # Spec says "> $5" — strictly greater. $5.00 is excluded.
    out = filter_universe_v5(candidates)
    assert out == ["OK"]


def test_universe_handles_missing_fields_safely():
    candidates = [
        {"ticker": "MISSING_MCAP", "type": "CS", "last_close": 50.0},
        {"ticker": "MISSING_CLOSE", "type": "CS", "market_cap": 1e9},
        {"ticker": "MISSING_TYPE", "market_cap": 1e9, "last_close": 50.0},
        {"ticker": "", "type": "CS", "market_cap": 1e9, "last_close": 50.0},
        {"ticker": "OK", "type": "CS", "market_cap": 1e9, "last_close": 50.0},
    ]
    assert filter_universe_v5(candidates) == ["OK"]


# ─────────────────────────────────────────────────────────────────────────────
# Insider scorer
# ─────────────────────────────────────────────────────────────────────────────

from scanner.signal_intelligence_v5 import insider_score


def _ih_row(code, amount, price, owner, is_officer=False, is_10b5_1=False, mcap=2_000_000_000):
    return {
        "transaction_code": code, "amount": amount, "stock_price": price,
        "owner_name": owner, "is_officer": is_officer, "is_director": False,
        "is_ten_percent_owner": False, "is_10b5_1": is_10b5_1, "marketcap": mcap,
    }


def test_insider_bullish_officer_buy_no_prior():
    rows = [
        _ih_row("P", 5_000, 850.0, "Colette Kress", is_officer=True),
        _ih_row("P", 2_000, 860.0, "Aarti Shah", is_officer=False),
    ]
    with patch.object(insider_score, "_fetch_window", return_value=rows), \
         patch.object(insider_score, "_has_prior_p_buy", return_value=False):
        out = insider_score.score("NVDA", date(2026, 5, 10))
    assert out["sub_score"] is not None and out["sub_score"] >= 70
    assert out["components"]["first_buy_fires"] is True


def test_insider_bearish_cluster_sell():
    rows = [
        _ih_row("S", 50_000, 200.0, "CEO Smith", is_officer=True),
        _ih_row("S", 40_000, 200.0, "CFO Jones", is_officer=True),
        _ih_row("S", 30_000, 200.0, "VP Lee", is_officer=True),
        _ih_row("S", 20_000, 200.0, "VP Patel", is_officer=True),
    ]
    with patch.object(insider_score, "_fetch_window", return_value=rows), \
         patch.object(insider_score, "_has_prior_p_buy", return_value=True):
        out = insider_score.score("BAD", date(2026, 5, 10))
    assert out["sub_score"] is not None and out["sub_score"] <= -50


def test_insider_neutral_only_routine_10b5_1_returns_none():
    rows = [
        _ih_row("S", 100_000, 870.0, "Jensen", is_officer=True, is_10b5_1=True),
        _ih_row("S", 5_000, 865.0, "Tim", is_officer=True, is_10b5_1=True),
    ]
    with patch.object(insider_score, "_fetch_window", return_value=rows), \
         patch.object(insider_score, "_has_prior_p_buy", return_value=True):
        out = insider_score.score("NVDA", date(2026, 5, 10))
    assert out["sub_score"] is None


def test_insider_edge_no_history_ipo():
    """New IPO with zero insider rows — sub_score is None, no exception."""
    with patch.object(insider_score, "_fetch_window", return_value=[]):
        out = insider_score.score("IPO", date(2026, 5, 10))
    assert out["sub_score"] is None
    assert out["components"]["buy_count"] == 0
    assert out["components"]["sell_count"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# Options scorer
# ─────────────────────────────────────────────────────────────────────────────

from scanner.signal_intelligence_v5 import options_score


def test_options_bullish_call_heavy_ask_side():
    snap = {
        "call_premium": 50_000_000.0,
        "put_premium": 5_000_000.0,
        "ask_side_premium": 45_000_000.0,
        "bid_side_premium": 3_000_000.0,
        "sweep_count": 6,
        "unusual_count": 4,
    }
    sub, comp = options_score.compute_options_signal(snap)
    assert sub is not None and sub >= 60
    assert comp["ratio_pts"] > 0


def test_options_bearish_put_heavy_bid_side():
    snap = {
        "call_premium": 5_000_000.0,
        "put_premium": 50_000_000.0,
        "ask_side_premium": 3_000_000.0,
        "bid_side_premium": 45_000_000.0,
        "sweep_count": 5,
        "unusual_count": 3,
    }
    sub, comp = options_score.compute_options_signal(snap)
    assert sub is not None and sub <= -60


def test_options_neutral_balanced_returns_modest_score():
    snap = {
        "call_premium": 1_000_000.0,
        "put_premium": 1_000_000.0,
        "ask_side_premium": 500_000.0,
        "bid_side_premium": 500_000.0,
        "sweep_count": 0,
        "unusual_count": 0,
    }
    sub, _ = options_score.compute_options_signal(snap)
    # log10(1)=0 and ask_bias=0 -> 0; unusual=0 -> 0. score=0
    assert sub == 0


def test_options_edge_no_flow_returns_none():
    sub, comp = options_score.compute_options_signal(None)
    assert sub is None
    sub, _ = options_score.compute_options_signal({"call_premium": 0, "put_premium": 0})
    assert sub is None


def test_options_edge_only_calls_saturates_bull():
    snap = {"call_premium": 1_000_000.0, "put_premium": 0.0,
            "ask_side_premium": 1_000_000.0, "bid_side_premium": 0.0,
            "sweep_count": 0, "unusual_count": 0}
    sub, _ = options_score.compute_options_signal(snap)
    # ratio_log saturates at 1.5 -> ratio_pts = 25*1.5 = 37.5 capped at 50
    # ask_bias = 1.0 -> ask_pts = 30
    # unusual = 0
    # raw ~ 50 + 30 = 80
    assert sub is not None and sub >= 60


# ─────────────────────────────────────────────────────────────────────────────
# Congress scorer
# ─────────────────────────────────────────────────────────────────────────────

from scanner.signal_intelligence_v5 import congress_score


def _ct(member, txn_type, bucket, txn_date="2026-05-01"):
    return {
        "member_name": member, "transaction_type": txn_type,
        "amount_bucket": bucket, "transaction_date": txn_date,
    }


def test_congress_bullish_cluster_of_buys():
    rows = [
        _ct("Pelosi, Nancy", "buy", "$500,001 - $1,000,000"),
        _ct("Wyden, Ron", "purchase", "$250,001 - $500,000"),
        _ct("Greene, Marjorie", "buy", "$100,001 - $250,000"),
        _ct("Crenshaw, Dan", "buy", "$50,001 - $100,000"),
    ]
    sub, comp = congress_score.compute_congress_signal(rows)
    assert sub is not None and sub > 50
    assert comp["unique_buyers"] == 4
    assert comp["cluster_bonus"] == congress_score.CLUSTER_BONUS_LOW


def test_congress_bearish_multiple_large_sells():
    rows = [
        _ct("Pelosi, Nancy", "sale", "$1,000,001 +"),
        _ct("Wyden, Ron", "sell", "$500,001 - $1,000,000"),
        _ct("Greene, Marjorie", "sale_partial", "$250,001 - $500,000"),
    ]
    sub, comp = congress_score.compute_congress_signal(rows)
    assert sub is not None and sub < -10
    assert comp["sell_tier_points"] > 0


def test_congress_neutral_empty_returns_none():
    sub, _ = congress_score.compute_congress_signal([])
    assert sub is None


def test_congress_edge_unknown_bucket_zero_pts():
    rows = [_ct("Foo", "buy", "garbage")]
    sub, comp = congress_score.compute_congress_signal(rows)
    # No tier points awarded, but signal still fires (single buy, 1 unique buyer)
    assert sub is not None
    assert comp["buy_tier_points"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# Technicals scorer
# ─────────────────────────────────────────────────────────────────────────────

from scanner.signal_intelligence_v5 import technicals_score


def _trend_closes(start: float, drift: float, n: int) -> list[float]:
    return [start + drift * i for i in range(n)]


def test_technicals_bullish_uptrend_above_smas():
    closes = _trend_closes(50.0, 0.5, 220)         # 50 -> 159.5
    volumes = [1_000_000] * 219 + [3_000_000]      # last day 3x volume
    sub, comp = technicals_score.compute_technicals_signal(closes, volumes)
    # Strong uptrend: SMA50 + SMA200 + RVOL bullish; RSI saturates overbought
    # (Wilder mean-reversion penalty) so net score is moderate-bullish.
    assert sub is not None and sub >= 20
    assert comp["sma200"] is not None
    assert comp["sma50_pts"] > 0
    assert comp["sma200_pts"] > 0
    assert comp["rvol_pts"] > 0


def test_technicals_bearish_downtrend_below_smas():
    closes = _trend_closes(200.0, -0.5, 220)
    volumes = [1_000_000] * 219 + [3_000_000]
    sub, comp = technicals_score.compute_technicals_signal(closes, volumes)
    assert sub is not None and sub <= -25
    assert comp["sma50_pts"] < 0
    assert comp["sma200_pts"] < 0


def test_technicals_neutral_sideways_score_near_zero():
    closes = [100.0] * 220
    volumes = [1_000_000] * 220
    sub, comp = technicals_score.compute_technicals_signal(closes, volumes)
    # Flat: SMA50 = SMA200 = today close, distance pts = 0
    # RSI = 100 (no losses) -> classified bearish
    assert sub is not None
    assert comp["sma50_pts"] == 0.0
    assert comp["sma200_pts"] == 0.0


def test_technicals_edge_too_few_closes_returns_none():
    closes = [100.0] * 10
    volumes = [1_000_000] * 10
    sub, comp = technicals_score.compute_technicals_signal(closes, volumes)
    assert sub is None
    assert comp.get("reason") == "too_few_closes"


def test_technicals_pure_indicator_math():
    # Spot-check the indicator helpers
    closes = list(range(1, 51))   # 1..50
    s = technicals_score.sma(closes, 20)
    assert s == sum(range(31, 51)) / 20
    r = technicals_score.rsi(list(range(1, 16)), 14)
    assert r is not None and r > 99    # all gains -> ~100
    bw = technicals_score.bollinger_bandwidth(closes, 20)
    assert bw is not None and bw > 0


# ─────────────────────────────────────────────────────────────────────────────
# Analyst scorer
# ─────────────────────────────────────────────────────────────────────────────

from scanner.signal_intelligence_v5 import analyst_score


def _ar(action, firm, target, recommendation=None, action_date="2026-04-15", broker_tier=None):
    return {
        "action": action, "firm": firm, "target_price": target,
        "recommendation": recommendation, "action_date": action_date,
        "broker_tier": broker_tier or analyst_score._action_pts.__globals__[
            "BROKER_TIER_WEIGHT"
        ] and "top",
    }


def test_analyst_bullish_multiple_upgrades_with_pt_above_spot():
    rows = [
        {"action": "upgrade", "firm": "Goldman Sachs", "target_price": 250.0,
         "recommendation": "buy", "action_date": "2026-04-20", "broker_tier": "top"},
        {"action": "upgrade", "firm": "Morgan Stanley", "target_price": 240.0,
         "recommendation": "buy", "action_date": "2026-04-25", "broker_tier": "top"},
        {"action": "upgrade", "firm": "RBC Capital", "target_price": 260.0,
         "recommendation": "buy", "action_date": "2026-04-30", "broker_tier": "major"},
    ]
    sub, comp = analyst_score.compute_analyst_signal(rows, spot=200.0)
    assert sub is not None and sub >= 50
    assert comp["pt_pts"] > 0


def test_analyst_bearish_downgrades_with_pt_below_spot():
    rows = [
        {"action": "downgrade", "firm": "Goldman Sachs", "target_price": 80.0,
         "recommendation": "sell", "action_date": "2026-04-20", "broker_tier": "top"},
        {"action": "downgrade", "firm": "Morgan Stanley", "target_price": 75.0,
         "recommendation": "underperform", "action_date": "2026-04-25", "broker_tier": "top"},
    ]
    sub, comp = analyst_score.compute_analyst_signal(rows, spot=120.0)
    assert sub is not None and sub <= -40
    assert comp["pt_pts"] < 0


def test_analyst_neutral_no_data_returns_none():
    sub, _ = analyst_score.compute_analyst_signal([], spot=None)
    assert sub is None


def test_analyst_edge_initiation_with_recommendation():
    rows = [
        {"action": "initiated", "firm": "Goldman Sachs", "target_price": 100.0,
         "recommendation": "buy", "action_date": "2026-04-25", "broker_tier": "top"},
    ]
    sub, comp = analyst_score.compute_analyst_signal(rows, spot=85.0)
    assert sub is not None
    # action 'initiated' base = 6, + recommendation 'buy' delta = +6, * top tier 1.0 = 12
    # action_pts = 12 * 3 = 36 (clamped at 60)
    # PT gap = (100-85)/85 = 0.176 -> 0.15 saturates -> 40
    assert sub >= 40


# ─────────────────────────────────────────────────────────────────────────────
# Short Interest scorer
# ─────────────────────────────────────────────────────────────────────────────

from scanner.signal_intelligence_v5 import short_interest_score


def _finra(date_str, si_pct, d2c=2.0, shares=1_000_000):
    return {
        "as_of_date": date_str, "short_interest_float_pct": si_pct,
        "days_to_cover": d2c, "short_interest_shares": shares,
    }


def _daily(date_str, ctb=None, svr=None):
    return {
        "as_of_date": date_str, "cost_to_borrow_pct": ctb,
        "short_volume_ratio": svr, "borrow_shares_available": None,
        "ftd_quantity": None, "ftd_price": None,
    }


def test_short_interest_bearish_smart_money_regime_a():
    # Rising SI + rising CTB + above 50-SMA = bearish
    finra = [_finra("2026-04-30", 18.0), _finra("2026-04-15", 14.0)]   # +4pp
    daily = [_daily("2026-05-09", ctb=8.0)] * 5 + [_daily("2026-04-09", ctb=4.0)] * 25
    # Latest above 50-SMA: last 25 closes = 70 averages above last 50's = ~65
    closes = [50.0] * 50 + [60.0] * 25 + [70.0] * 25
    sub, comp = short_interest_score.compute_short_interest_signal(
        finra, daily, closes, days_to_earnings=None,
    )
    assert sub == short_interest_score.REGIME_BEAR_MAX
    assert comp["regime"] == "bearish_smart_money"


def test_short_interest_bullish_squeeze_setup_regime_b():
    # High SI (>30%) + cheap CTB + earnings within 14 days = bullish
    finra = [_finra("2026-04-30", 38.0), _finra("2026-04-15", 36.0)]
    daily = [_daily("2026-05-09", ctb=2.0)] * 30
    closes = [10.0] * 100
    sub, comp = short_interest_score.compute_short_interest_signal(
        finra, daily, closes, days_to_earnings=5,
    )
    assert sub is not None and sub >= 60
    assert comp["regime"] == "squeeze_setup"


def test_short_interest_bullish_capitulation_regime_c():
    # Falling SI + rising price = capitulation bullish
    finra = [_finra("2026-04-30", 12.0), _finra("2026-04-15", 18.0)]   # -6pp
    daily = []
    closes = [50.0] * 60 + [60.0] * 30 + [80.0]                       # rising
    sub, comp = short_interest_score.compute_short_interest_signal(
        finra, daily, closes, days_to_earnings=None,
    )
    assert sub == short_interest_score.REGIME_CAPITULATION_BULL_MAX
    assert comp["regime"] == "capitulation"


def test_short_interest_neutral_no_data_returns_none():
    sub, comp = short_interest_score.compute_short_interest_signal([], [], [])
    assert sub is None
    assert comp.get("reason") == "no_si_data"


def test_short_interest_edge_high_si_no_squeeze_setup_lean_bear():
    # High SI without earnings nearby and CTB not cheap -> moderate bear
    finra = [_finra("2026-04-30", 35.0)]
    daily = [_daily("2026-05-09", ctb=15.0)]
    closes = [50.0] * 100
    sub, comp = short_interest_score.compute_short_interest_signal(
        finra, daily, closes, days_to_earnings=None,
    )
    assert sub is not None and sub <= 0
    assert comp["regime"] == "elevated_si_neutral"
