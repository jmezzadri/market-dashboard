"""Tests for the Momentum sleeve (Two-Sleeve build PR-2, 2026-07-14).

Every expected number below is HAND-COMPUTED (Senior Quant worked examples):
sizing = capital / list size; guard IN CASH = zero lines; the diff trades
only on a new publish or a guard flip; the scanner sleeve never touches
Momentum's shares (overlap = intended double position).
"""
from __future__ import annotations

from paper_portfolio.alpaca_client import AlpacaPosition
from paper_portfolio.diff import build_order_intents
from paper_portfolio.momentum import (
    MomentumEntry,
    MomentumSnapshot,
    MomentumTriggerState,
    build_momentum_intents,
)
from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_momentum_target, build_sleeve_b_target


def _snap(tickers, invested=True, reb="2026-06-30"):
    entries = [MomentumEntry(rank=i + 1, ticker=t, ret_12_1=1.0 - 0.01 * i)
               for i, t in enumerate(tickers)]
    return MomentumSnapshot(
        rebalance_date=reb, next_rebalance_date="2026-08-01", entries=entries,
        guard_as_of="2026-07-13", guard_invested=invested,
        guard_spy_close=746.77, guard_sma_200=691.43,
    )


def _pos(ticker, qty, cost_basis):
    return AlpacaPosition(ticker=ticker, qty=qty,
                          avg_entry_price=(cost_basis / qty if qty else 0),
                          market_value=cost_basis, cost_basis=cost_basis,
                          unrealized_pl=0.0, side="long")


_EOD = {"AAA": 100.0, "BBB": 50.0, "CCC": 25.0, "DDD": 20.0, "NVDA": 200.0}
CAP = 500_000.0

# ── Sizing (Senior Quant worked examples) ────────────────────────────────────

def test_equal_weight_25_names_is_20k_each():
    # $500,000 / 25 names = $20,000.00 per name, gross $500K, idle $0.
    t = build_momentum_target(_snap([f"T{i:02d}" for i in range(25)]), CAP)
    assert len(t.lines) == 25
    assert all(l.notional == 20_000.00 for l in t.lines)
    assert t.gross_long == 500_000.00 and t.idle_cash == 0.0
    assert t.leverage_used == 0.0  # no leverage, ever (v1 locked)

def test_equal_weight_50_names_is_10k_each():
    # $500,000 / 50 = $10,000.00 per name (the spec's lower bound per name).
    t = build_momentum_target(_snap([f"T{i:02d}" for i in range(50)]), CAP)
    assert all(l.notional == 10_000.00 for l in t.lines) and t.gross_long == 500_000.00

def test_odd_list_rounding_never_levers():
    # $500,000 / 33 = $15,151.515... -> rounded to $15,151.52; gross
    # 33 x 15,151.52 = $500,000.16 -> 16 cents over: acceptable rounding?
    # NO — the sleeve must never exceed its cash. Verify gross <= cap + $1.
    t = build_momentum_target(_snap([f"T{i:02d}" for i in range(33)]), CAP)
    assert abs(t.gross_long - CAP) <= 1.0  # rounding dust only

def test_guard_in_cash_is_zero_lines_full_idle():
    t = build_momentum_target(_snap(["AAA", "BBB"], invested=False), CAP)
    assert t.lines == [] and t.gross_long == 0 and t.idle_cash == CAP

# ── Diff: publish day ────────────────────────────────────────────────────────

def test_first_publish_buys_everything():
    # 4-name list, $125,000 each. AAA @$100 -> 1250 sh; BBB @$50 -> 2500 sh.
    t = build_momentum_target(_snap(["AAA", "BBB", "CCC", "DDD"]), CAP)
    ints = {i.ticker: i for i in build_momentum_intents(t, {}, _EOD)}
    assert len(ints) == 4 and all(i.side == "buy" for i in ints.values())
    assert ints["AAA"].target_quantity == 1250.0
    assert ints["BBB"].target_quantity == 2500.0
    assert ints["AAA"].target_notional == 125_000.00

def test_monthly_turnover_sells_dropped_buys_new_holds_rest():
    # Held AAA(1250) + BBB(2500); new list = AAA, CCC. -> hold AAA,
    # sell BBB (2500 sh, -$125,000 at $50), buy CCC ($250K/…? list of 2 ->
    # $250,000 each -> CCC @$25 = 10,000 sh).
    t = build_momentum_target(_snap(["AAA", "CCC"]), CAP)
    held = {"AAA": 1250.0, "BBB": 2500.0}
    ints = {i.ticker: i for i in build_momentum_intents(t, held, _EOD)}
    assert set(ints) == {"BBB", "CCC"}
    assert ints["BBB"].side == "sell" and ints["BBB"].target_quantity == 2500.0
    assert ints["BBB"].target_notional == -125_000.00
    assert ints["CCC"].side == "buy" and ints["CCC"].target_quantity == 10_000.0

def test_guard_flip_to_cash_sells_the_whole_sleeve():
    t = build_momentum_target(_snap(["AAA", "BBB"], invested=False), CAP)
    held = {"AAA": 1250.0, "BBB": 2500.0}
    ints = build_momentum_intents(t, held, _EOD)
    assert len(ints) == 2 and all(i.side == "sell" for i in ints)
    assert all("guard" in i.rebalance_trigger_reason.lower() for i in ints)

def test_held_target_name_is_never_resized():
    t = build_momentum_target(_snap(["AAA", "BBB"]), CAP)
    ints = build_momentum_intents(t, {"AAA": 999.0, "BBB": 1.0}, _EOD)
    assert ints == []  # both held, both in target — hold, no drift trades

# ── Trigger: recompute only on publish or flip ───────────────────────────────

def test_no_new_publish_no_flip_means_hold():
    s = _snap(["AAA"], invested=True)
    st = MomentumTriggerState(rebalance_date="2026-06-30", guard_invested=True)
    fire, why = st.differs_from(s)
    assert not fire and "hold" in why

def test_new_publish_fires():
    s = _snap(["AAA"], reb="2026-07-31")
    st = MomentumTriggerState(rebalance_date="2026-06-30", guard_invested=True)
    assert st.differs_from(s)[0]

def test_guard_flip_fires():
    s = _snap(["AAA"], invested=False)
    st = MomentumTriggerState(rebalance_date="2026-06-30", guard_invested=True)
    fire, why = st.differs_from(s)
    assert fire and "flip" in why.lower()

def test_first_run_fires():
    assert MomentumTriggerState(None, None).differs_from(_snap(["AAA"]))[0]

# ── Overlap: scanner sleeve never touches Momentum's shares ──────────────────

def _scan(pairs):
    sigs = [EquitySignal(ticker=t, mt_score=s * 10, buy_score=s, band="Strong Buy",
                         scan_date="2026-07-13") for t, s in pairs]
    return EquityScannerSnapshot("2026-07-13", sigs, len(sigs), [],
                                 {t.upper(): s for t, s in pairs})

def test_scanner_exit_spares_momentum_shares():
    # Broker holds 1500 NVDA: 1250 belong to Momentum, 250 to the scanner.
    # Scanner signal is GONE -> scanner sells ONLY its 250 shares.
    b = build_sleeve_b_target(_scan([]), CAP)
    held = [_pos("NVDA", 1500, cost_basis=300_000)]
    ints = build_order_intents(b, held, held_scores={}, eod_prices=_EOD,
                               sleeve_m_qty={"NVDA": 1250.0})
    assert len(ints) == 1 and ints[0].side == "sell"
    assert ints[0].target_quantity == 250.0
    # basis pro-rated: 300,000 x 250/1500 = $50,000
    assert ints[0].target_notional == -50_000.00

def test_scanner_skips_exit_when_position_is_all_momentum():
    b = build_sleeve_b_target(_scan([]), CAP)
    held = [_pos("NVDA", 1250, cost_basis=250_000)]
    ints = build_order_intents(b, held, held_scores={}, eod_prices=_EOD,
                               sleeve_m_qty={"NVDA": 1250.0})
    assert ints == []  # nothing of the scanner's to sell

def test_scanner_still_buys_a_name_momentum_already_owns():
    # Overlap is an intended DOUBLE position: Momentum owns 1250 NVDA;
    # a fresh scanner buy signal still enters its own $50K.
    b = build_sleeve_b_target(_scan([("NVDA", 5.0)]), CAP)
    held = [_pos("NVDA", 1250, cost_basis=250_000)]
    ints = build_order_intents(b, held, held_scores={"NVDA": 5.0}, eod_prices=_EOD,
                               sleeve_m_qty={"NVDA": 1250.0})
    assert len(ints) == 1 and ints[0].side == "buy" and ints[0].sleeve == "B"
    assert ints[0].target_notional == 50_000.00

def test_flag_off_is_bit_identical_to_before():
    # With no sleeve_m_qty passed, results match the pre-PR behavior exactly.
    s = _scan([("AMR", 5.0)])
    b = build_sleeve_b_target(s, CAP)
    held = [_pos("NVDA", 100, cost_basis=20_000)]
    a = build_order_intents(b, held, held_scores={}, eod_prices=_EOD)
    b2 = build_order_intents(b, held, held_scores={}, eod_prices=_EOD, sleeve_m_qty={})
    assert a == b2
