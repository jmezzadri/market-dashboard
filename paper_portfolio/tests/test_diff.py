"""Tests for the SIGNAL-ONLY diff with HYSTERESIS + EQUAL-WEIGHT resizing
(2026-07-15 rebuild). Resize compares TARGET vs COST BASIS behind the band
(max($500, 3% of target)), so pure price drift never trades — only a change
in N (the qualifying count) can move a held name."""
from __future__ import annotations
from paper_portfolio.alpaca_client import AlpacaPosition
from paper_portfolio.diff import build_order_intents
from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_b_target


def _pos(ticker, qty, cost_basis, market_value=None):
    mv = market_value if market_value is not None else cost_basis
    return AlpacaPosition(ticker=ticker, qty=qty, avg_entry_price=(cost_basis/qty if qty else 0),
                          market_value=mv, cost_basis=cost_basis, unrealized_pl=mv-cost_basis, side="long")


def _scan(pairs, extra_scores=None):
    sigs = [EquitySignal(ticker=t, mt_score=s*10, buy_score=s, band="Strong Buy", scan_date="2026-07-15")
            for t, s in pairs]
    scores = {t.upper(): s for t, s in pairs}
    scores.update({t.upper(): s for t, s in (extra_scores or {}).items()})
    return EquityScannerSnapshot("2026-07-15", sigs, len(sigs), [], scores)


_EOD = {"AMR": 50.0, "NVDA": 200.0, "NVRI": 22.0, "SOXX": 100.0, "RH": 250.0}
CAP = 500_000


def test_new_signals_become_equal_weight_buys():
    s = _scan([("AMR", 5.0), ("NVDA", 4.5)])
    b = build_sleeve_b_target(s, CAP)
    bt = {i.ticker: i for i in build_order_intents(b, [], held_scores=s.scores_by_ticker, eod_prices=_EOD)}
    assert bt["AMR"].side == "buy" and bt["NVDA"].side == "buy"
    assert bt["AMR"].target_notional == 250_000.0   # $500K / 2
    assert bt["AMR"].target_quantity == 5000.0      # $250K / $50


def test_held_target_no_trade_on_price_drift():
    # N unchanged (1 name), target $500K == basis $500K; price +40% — NO trade.
    s = _scan([("NVDA", 5.0)])
    b = build_sleeve_b_target(s, CAP, held_tickers={"NVDA"})
    held = [_pos("NVDA", 2500, cost_basis=500_000, market_value=700_000)]
    assert [i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD)
            if i.ticker == "NVDA"] == []


def test_resize_up_when_n_shrinks():
    # Held at $50K basis; alone in the book today → target $500K → buy +$450K.
    s = _scan([("NVDA", 5.0)])
    b = build_sleeve_b_target(s, CAP, held_tickers={"NVDA"})
    held = [_pos("NVDA", 250, cost_basis=50_000)]
    out = [i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD)
           if i.ticker == "NVDA"]
    assert out and out[0].side == "buy"
    assert out[0].target_notional == 450_000.0
    assert out[0].target_quantity == 2250.0  # $450K / $200


def test_resize_down_when_n_grows_and_sell_clamped():
    # Held RH at $500K basis; a 2nd name qualifies → target $250K each →
    # sell $250K of RH (and buy $250K AMR).
    s = _scan([("RH", 5.0), ("AMR", 5.0)])
    b = build_sleeve_b_target(s, CAP, held_tickers={"RH"})
    held = [_pos("RH", 2000, cost_basis=500_000)]
    by = {i.ticker: i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD)}
    assert by["RH"].side == "sell" and by["RH"].target_notional == -250_000.0
    assert by["RH"].target_quantity == 1000.0  # $250K / $250, < held 2000
    assert by["AMR"].side == "buy" and by["AMR"].target_notional == 250_000.0


def test_resize_inside_band_holds():
    # Target $166,666.66 vs basis $170,000 → drift ~$3,333 < 3% of target (~$5K) → hold.
    s = _scan([("A", 5.0), ("B", 5.0), ("RH", 5.0)])
    b = build_sleeve_b_target(s, CAP, held_tickers={"RH"})
    held = [_pos("RH", 680, cost_basis=170_000)]
    assert [i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker,
                                           eod_prices={**_EOD, "A": 10.0, "B": 10.0})
            if i.ticker == "RH"] == []


def test_hysteresis_holds_below_buy_line_and_resizes():
    # NVRI decayed to 3.4 — still above the exit floor, so it KEEPS its slot
    # and is resized to the equal weight alongside the fresh entry.
    s = _scan([("AMR", 5.0)], extra_scores={"NVRI": 3.4})
    b = build_sleeve_b_target(s, CAP, held_tickers={"NVRI"})
    held = [_pos("NVRI", 2000, cost_basis=44_000, market_value=40_000)]
    by = {i.ticker: i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD)}
    assert by["NVRI"].side == "buy"                       # top up toward $250K
    assert by["NVRI"].target_notional == 206_000.0        # 250,000 − 44,000
    assert by["AMR"].target_notional == 250_000.0


def test_exit_when_decayed_below_floor():
    s = _scan([("AMR", 5.0)], extra_scores={"NVRI": 2.0})
    b = build_sleeve_b_target(s, CAP, held_tickers={"NVRI"})
    held = [_pos("NVRI", 2000, cost_basis=44_000, market_value=40_000)]
    out = [i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD)
           if i.ticker == "NVRI"]
    assert out and out[0].side == "sell" and out[0].target_quantity == 2000


def test_exit_when_off_scan():
    s = _scan([("AMR", 5.0)])
    b = build_sleeve_b_target(s, CAP, held_tickers={"SOXX"})
    held = [_pos("SOXX", 2500, cost_basis=250_000, market_value=300_000)]
    out = [i for i in build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD)
           if i.ticker == "SOXX"]
    assert out and out[0].side == "sell" and out[0].target_quantity == 2500


def test_open_order_guard():
    s = _scan([("AMR", 5.0)])
    b = build_sleeve_b_target(s, CAP)
    assert [i for i in build_order_intents(b, [], held_scores=s.scores_by_ticker, eod_prices=_EOD,
                                           open_order_tickers={"AMR"}) if i.ticker == "AMR"] == []


def test_momentum_shares_invisible_to_scanner():
    # The broker position is entirely sleeve-M's — the scanner sleeve doesn't
    # hold it, so a scanner entry for the same name is a fresh full-size buy,
    # and no exit is ever emitted against Momentum's shares.
    s = _scan([("AMR", 5.0)])
    b = build_sleeve_b_target(s, CAP)
    held = [_pos("AMR", 1000, cost_basis=50_000)]
    out = build_order_intents(b, held, held_scores=s.scores_by_ticker, eod_prices=_EOD,
                              sleeve_m_qty={"AMR": 1000})
    by = {i.ticker: i for i in out}
    assert by["AMR"].side == "buy" and by["AMR"].target_notional == 500_000.0


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print(f"PASS {name}")
    print("test_diff: all tests passed")
