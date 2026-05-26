"""
Tests for paper_portfolio.diff.build_order_intents.

These tests verify the target-vs-live diff logic, including the
sleeve-attribution rule and the no-rebalance-on-tiny-drift tolerance.
"""

from __future__ import annotations

from paper_portfolio.alpaca_client import AlpacaPosition
from paper_portfolio.diff import build_order_intents
from paper_portfolio.signals import (
    AssetTiltIG,
    AssetTiltSnapshot,
    EquityScannerSnapshot,
    EquitySignal,
)
from paper_portfolio.sleeves import (
    build_sleeve_a_target,
    build_sleeve_b_target,
)


def _mk_pos(ticker: str, qty: float, mv: float) -> AlpacaPosition:
    return AlpacaPosition(
        ticker=ticker, qty=qty, avg_entry_price=(mv / qty) if qty else 0,
        market_value=mv, cost_basis=mv, unrealized_pl=0, side="long",
    )


def _at_two_etf(weights, extra_tickers_per_ig=None):
    """weights: [(etf, weight_pct, rating), ...]
       extra_tickers_per_ig: optional dict mapping primary_etf -> [other ETFs in that IG]
    """
    extra = extra_tickers_per_ig or {}
    igs = [
        AssetTiltIG(ig_id=etf.lower(), name=etf, sector="X",
                    primary_etf=etf, weight_pct=w, rating=r)
        for etf, w, r in weights
    ]
    raw_igs = [
        {"id": etf.lower(), "name": etf, "sector": "X",
         "tickers": [etf, *extra.get(etf, [])]}
        for etf, _, _ in weights
    ]
    return AssetTiltSnapshot("2026-05-26", "test", 1.0, igs,
                             {"industry_groups": raw_igs})


def _scanner(pairs):
    sigs = [
        EquitySignal(ticker=t, mt_score=score * 10, buy_score=score,
                     band="Strong Buy" if score >= 9 else "Watch Buy",
                     scan_date="2026-05-26")
        for t, score in pairs
    ]
    return EquityScannerSnapshot("2026-05-26", sigs, len(sigs), [])


def test_diff_empty_live_state_produces_full_buy_list():
    """With nothing held in Alpaca, every target line becomes a buy."""
    at = _at_two_etf([("SOXX", 0.5, "OW"), ("IGV", 0.5, "MW")])
    a = build_sleeve_a_target(at, 500_000)
    scan = _scanner([("NVDA", 9.5)])
    b = build_sleeve_b_target(scan, 500_000)

    intents = build_order_intents(a, b, live_positions=[], alpaca=None)
    by_t = {i.ticker: i for i in intents}
    assert by_t["SOXX"].side == "buy"
    assert by_t["SOXX"].sleeve == "A"
    assert by_t["SOXX"].target_notional == 250_000.0
    assert by_t["IGV"].target_notional == 250_000.0
    assert by_t["NVDA"].sleeve == "B"
    assert by_t["NVDA"].side == "buy"
    assert by_t["NVDA"].target_notional == 50_000.0


def test_diff_in_tolerance_no_order():
    """An IG ETF already at $250,001 vs target $250,000 should not fire a $1 buy."""
    at = _at_two_etf([("SOXX", 1.0, "OW")])
    a = build_sleeve_a_target(at, 500_000)
    b_scan = _scanner([])
    b = build_sleeve_b_target(b_scan, 500_000)

    live = [_mk_pos("SOXX", 100, 500_001)]   # held very close to target
    intents = build_order_intents(a, b, live, alpaca=None)
    # diff is $1 — well below both the $250 absolute and 0.5 % tolerance
    soxx_intents = [i for i in intents if i.ticker == "SOXX"]
    assert soxx_intents == []


def test_diff_orphan_etf_in_live_state_generates_sell():
    """If a position exists in Alpaca that isn't in any target → close it.
    The snapshot's wider IG-ticker universe (here: XLE listed as an
    Energy IG candidate ticker) lets us attribute XLE to Sleeve A even
    though it isn't today's primary."""
    at = _at_two_etf(
        [("SOXX", 1.0, "OW")],
        extra_tickers_per_ig={"SOXX": ["XLE"]},   # XLE listed in IG universe
    )
    a = build_sleeve_a_target(at, 500_000)
    b = build_sleeve_b_target(_scanner([]), 500_000)

    live = [
        _mk_pos("SOXX", 1, 500_000),
        _mk_pos("XLE", 100, 10_000),       # ETF no longer in today's target
        _mk_pos("AAPL", 50, 15_000),       # equity dropped out of scanner
    ]
    intents = build_order_intents(a, b, live, alpaca=None,
                                  asset_tilt_snapshot=at)
    by_t = {i.ticker: i for i in intents}
    assert by_t["XLE"].side == "sell"
    assert by_t["XLE"].sleeve == "A"
    assert by_t["AAPL"].side == "sell"
    assert by_t["AAPL"].sleeve == "B"


def test_diff_resize_when_existing_position_drifts():
    """A live position larger than target should produce a sell of the diff,
    not a full close."""
    at = _at_two_etf([("SOXX", 0.5, "OW"), ("IGV", 0.5, "MW")])
    a = build_sleeve_a_target(at, 500_000)
    b = build_sleeve_b_target(_scanner([]), 500_000)

    # SOXX target = $250K, live = $300K → sell $50K
    # IGV   target = $250K, live = $200K → buy  $50K
    live = [_mk_pos("SOXX", 100, 300_000), _mk_pos("IGV", 100, 200_000)]
    intents = build_order_intents(a, b, live, alpaca=None)
    by_t = {i.ticker: i for i in intents}
    assert by_t["SOXX"].side == "sell"
    assert by_t["SOXX"].target_notional == -50_000.0
    assert by_t["IGV"].side == "buy"
    assert by_t["IGV"].target_notional == 50_000.0
