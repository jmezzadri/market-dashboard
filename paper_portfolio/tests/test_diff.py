"""Tests for the SIGNAL-ONLY diff engine (Equity Scanner / Sleeve B only).

Sleeve A (Asset Tilt) was retired 2026-06-23. build_order_intents now takes a
single Sleeve B target; every held name absent from that target is exited to
cash — which is how the retired Sleeve-A ETFs are unwound.
"""
from __future__ import annotations

from paper_portfolio.alpaca_client import AlpacaPosition
from paper_portfolio.diff import build_order_intents
from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_b_target


def _pos(ticker, qty, cost_basis, market_value=None):
    # market_value is set DELIBERATELY different from cost_basis to prove the
    # engine ignores market value (price) and uses cost basis (signal anchor).
    mv = market_value if market_value is not None else cost_basis
    return AlpacaPosition(ticker=ticker, qty=qty, avg_entry_price=(cost_basis / qty if qty else 0),
                          market_value=mv, cost_basis=cost_basis, unrealized_pl=mv - cost_basis, side="long")


def _scan(pairs):
    sigs = [EquitySignal(ticker=t, mt_score=s * 10, buy_score=s, band="Strong Buy", scan_date="2026-06-23")
            for t, s in pairs]
    return EquityScannerSnapshot("2026-06-23", sigs, len(sigs), [])


_EOD = {"AMR": 50.0, "NVDA": 200.0, "SOXX": 100.0, "IGV": 100.0, "XLE": 10.0}


def test_new_signals_become_buys():
    """Nothing held; scanner names -> all buys, sized at the EOD price."""
    b = build_sleeve_b_target(_scan([("AMR", 10), ("NVDA", 7.5)]), 500_000)
    ints = build_order_intents(b, [], eod_prices=_EOD)
    bt = {i.ticker: i for i in ints}
    assert bt["AMR"].side == "buy" and bt["NVDA"].side == "buy"
    assert all(i.sleeve == "B" and i.signal_source == "equity_scanner" for i in ints)
    # AMR tier1 = $50k / $50 = 1000 sh
    assert bt["AMR"].target_quantity == 1000.0


def test_held_name_signal_unchanged_price_moved_no_trade():
    """THE KEY ONE: held name, signal unchanged, price moved a lot -> NO trade.
    Cost basis is the anchor; price drift never trips a rebalance."""
    b = build_sleeve_b_target(_scan([("NVDA", 10)]), 500_000)   # tier1 = $50k target
    held = [_pos("NVDA", 250, cost_basis=50_000, market_value=70_000)]  # price rose 40%
    ints = build_order_intents(b, held, eod_prices=_EOD)
    assert [i for i in ints if i.ticker == "NVDA"] == []


def test_scanner_signal_gone_full_exit():
    """A held scanner name that dropped off the scan is exited in full."""
    b = build_sleeve_b_target(_scan([]), 500_000)   # AMR dropped
    held = [_pos("AMR", 1000, cost_basis=50_000, market_value=90_000)]
    ints = build_order_intents(b, held, eod_prices=_EOD)
    amr = [i for i in ints if i.ticker == "AMR"]
    assert amr and amr[0].side == "sell" and amr[0].target_quantity == 1000


def test_retired_sleeve_a_etf_is_exited_not_orphaned():
    """A held former-Sleeve-A ETF (e.g. SOXX) is NOT in the Sleeve B target,
    so it must be emitted as a full exit to cash — never left orphaned."""
    b = build_sleeve_b_target(_scan([("NVDA", 9.5)]), 500_000)
    held = [
        _pos("SOXX", 2500, cost_basis=250_000, market_value=300_000),  # retired Sleeve-A ETF
        _pos("IGV", 2500, cost_basis=250_000, market_value=180_000),   # retired Sleeve-A ETF
        _pos("NVDA", 250, cost_basis=50_000, market_value=55_000),     # current Sleeve B name
    ]
    ints = build_order_intents(b, held, eod_prices=_EOD)
    by = {i.ticker: i for i in ints}
    # Both retired ETFs are sold in full
    assert by["SOXX"].side == "sell" and by["SOXX"].target_quantity == 2500
    assert by["IGV"].side == "sell" and by["IGV"].target_quantity == 2500
    # exits are attributed to Sleeve B (the only sleeve) and report cost-basis dollars
    assert by["SOXX"].sleeve == "B" and by["SOXX"].target_notional == -250_000.0
    # NVDA is in target, signal unchanged within band -> no trade for it
    assert "NVDA" not in by


def test_tier_change_resizes():
    """Signal tier changed -> resize. AMR target jumps $30k->$50k (basis $30k)."""
    b = build_sleeve_b_target(_scan([("AMR", 10)]), 500_000)  # tier1 = $50k
    held = [_pos("AMR", 600, cost_basis=30_000, market_value=33_000)]
    ints = build_order_intents(b, held, eod_prices=_EOD)
    amr = [i for i in ints if i.ticker == "AMR"]
    assert amr and amr[0].side == "buy" and round(amr[0].target_notional) == 20_000


def test_open_order_guard_skips_duplicate():
    """A ticker with a live open order gets no second intent this run."""
    b = build_sleeve_b_target(_scan([("AMR", 10)]), 500_000)
    ints = build_order_intents(b, [], eod_prices=_EOD, open_order_tickers={"AMR"})
    assert [i for i in ints if i.ticker == "AMR"] == []
