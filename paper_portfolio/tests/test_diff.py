"""Tests for the SIGNAL-ONLY diff with HYSTERESIS + FIXED SIZE
(Conviction-Insider rebuild 2026-07-07)."""
from __future__ import annotations
from paper_portfolio.alpaca_client import AlpacaPosition
from paper_portfolio.diff import build_order_intents
from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_b_target
from paper_portfolio.config import SLEEVE_B_ENTRY_NOTIONAL, SLEEVE_B_MAX_PCT_NAV

def _pos(ticker, qty, cost_basis, market_value=None):
    mv = market_value if market_value is not None else cost_basis
    return AlpacaPosition(ticker=ticker, qty=qty, avg_entry_price=(cost_basis/qty if qty else 0),
                          market_value=mv, cost_basis=cost_basis, unrealized_pl=mv-cost_basis, side="long")

def _scan(pairs):
    sigs = [EquitySignal(ticker=t, mt_score=s*10, buy_score=s, band="Strong Buy", scan_date="2026-06-23")
            for t, s in pairs]
    return EquityScannerSnapshot("2026-06-23", sigs, len(sigs), [], {t.upper(): s for t, s in pairs})

_EOD = {"AMR": 50.0, "NVDA": 200.0, "NVRI": 22.0, "SOXX": 100.0}
CAP = 500_000
PER = min(SLEEVE_B_ENTRY_NOTIONAL, SLEEVE_B_MAX_PCT_NAV * CAP)  # $50K

def test_new_signals_become_buys():
    s = _scan([("AMR", 6.0), ("NVDA", 7.5)])
    b = build_sleeve_b_target(s, CAP)
    bt = {i.ticker: i for i in build_order_intents(b, [], held_scores=s.scores_by_ticker, eod_prices=_EOD)}
    assert bt["AMR"].side == "buy" and bt["NVDA"].side == "buy"
    assert bt["AMR"].target_quantity == PER/50.0  # $50K / $50 = 1000 sh

def test_held_target_no_trade_on_price():
    s = _scan([("NVDA", 10.0)])
    b = build_sleeve_b_target(s, CAP)
    held = [_pos("NVDA", 250, cost_basis=50_000, market_value=70_000)]  # +40% price
    assert [i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD) if i.ticker=="NVDA"] == []

def test_hysteresis_holds_below_buy_line():  # THE CHURN FIX
    s = _scan([("AMR", 6.0)])                       # NVRI not in >=5 target
    held_scores = {**s.scores_by_ticker, "NVRI": 4.0}   # dropped to 4, still >= exit floor 3
    b = build_sleeve_b_target(s, CAP)
    held = [_pos("NVRI", 2000, cost_basis=44_000, market_value=40_000)]
    assert [i for i in build_order_intents(b, held, held_scores=held_scores, eod_prices=_EOD) if i.ticker=="NVRI"] == []

def test_exit_when_decayed_below_floor():
    s = _scan([("AMR", 6.0)])
    held_scores = {**s.scores_by_ticker, "NVRI": 2.0}   # below exit floor 3
    b = build_sleeve_b_target(s, CAP)
    held = [_pos("NVRI", 2000, cost_basis=44_000, market_value=40_000)]
    out = [i for i in build_order_intents(b, held, held_scores=held_scores, eod_prices=_EOD) if i.ticker=="NVRI"]
    assert out and out[0].side == "sell" and out[0].target_quantity == 2000

def test_exit_when_off_scan():
    s = _scan([("AMR", 6.0)])
    b = build_sleeve_b_target(s, CAP)
    held = [_pos("SOXX", 2500, cost_basis=250_000, market_value=300_000)]
    out = [i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD) if i.ticker=="SOXX"]
    assert out and out[0].side == "sell" and out[0].target_quantity == 2500

def test_no_tier_resize_when_held():
    s = _scan([("AMR", 10.0)])
    b = build_sleeve_b_target(s, CAP)
    held = [_pos("AMR", 600, cost_basis=30_000, market_value=33_000)]  # old engine would resize
    assert [i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD) if i.ticker=="AMR"] == []

def test_open_order_guard():
    s = _scan([("AMR", 6.0)])
    b = build_sleeve_b_target(s, CAP)
    assert [i for i in build_order_intents(b, [], held_scores=s.scores_by_ticker, eod_prices=_EOD, open_order_tickers={"AMR"}) if i.ticker=="AMR"] == []
