"""Tests for the Momentum sleeve driven by the POWER TREND signal
(2026-07-15 swap; replaces the 12-1 list + Faber guard).

Every expected number below is HAND-COMPUTED (Senior Quant worked examples):
sizing = capital / max(N, 8) with per-name floored to the cent; a CASH
sentinel publish = zero lines; the diff trades only on a new publish
(buy new names, resize holds beyond the band, sell drops); the scanner
sleeve never touches Momentum's shares (overlap = intended double position).
"""
from __future__ import annotations

from paper_portfolio.alpaca_client import AlpacaPosition
from paper_portfolio.momentum import (
    PowerTrendEntry,
    PowerTrendSnapshot,
    MomentumTriggerState,
    build_momentum_intents,
)
from paper_portfolio.sleeves import build_momentum_target


def _snap(tickers, reb="2026-07-14", all_cash=False):
    entries = [PowerTrendEntry(rank=i + 1, ticker=t, roc_3m=100.0 - i, rs_vs_spx=90.0 - i)
               for i, t in enumerate(tickers)]
    return PowerTrendSnapshot(rebalance_date=reb, next_rebalance_date="2026-08-01",
                              entries=entries, all_cash=all_cash)


_EOD = {"AAA": 100.0, "BBB": 50.0, "CCC": 25.0, "DDD": 20.0, "NVDA": 200.0}
CAP = 500_000.0

# ── Sizing (Senior Quant worked examples) ────────────────────────────────────

def test_equal_weight_14_names():
    # $500,000 / 14 = $35,714.285… → cent-floored $35,714.28; idle $0.08.
    t = build_momentum_target(_snap([f"T{i:02d}" for i in range(14)]), CAP)
    assert len(t.lines) == 14
    assert all(l.notional == 35_714.28 for l in t.lines)
    assert abs(t.idle_cash - 0.08) < 0.001 and t.leverage_used == 0.0


def test_equal_weight_15_names_full_deploy():
    # $500,000 / 15 = $33,333.33; gross $499,999.95; idle $0.05.
    t = build_momentum_target(_snap([f"T{i:02d}" for i in range(15)]), CAP)
    assert all(l.notional == 33_333.33 for l in t.lines)
    assert abs(t.gross_long - 499_999.95) < 0.001


def test_min8_floor_five_names():
    # 5 names → $500K / max(5,8) = $62,500 each; $187,500 stays in cash.
    t = build_momentum_target(_snap(["A", "B", "C", "D", "E"]), CAP)
    assert all(l.notional == 62_500.0 for l in t.lines)
    assert t.gross_long == 312_500.0 and t.idle_cash == 187_500.0


def test_all_cash_publish_zero_lines():
    t = build_momentum_target(_snap([], all_cash=True), CAP)
    assert t.lines == [] and t.idle_cash == CAP


def test_never_levers():
    for n in (1, 3, 8, 9, 11, 13, 15):
        t = build_momentum_target(_snap([f"T{i:02d}" for i in range(n)]), CAP)
        assert t.gross_long <= CAP + 0.001 and t.leverage_used == 0.0


# ── Trigger (monthly publish only) ───────────────────────────────────────────

def test_first_run_fires():
    fire, why = MomentumTriggerState(rebalance_date=None).differs_from(_snap(["AAA"]))
    assert fire and "first" in why.lower()


def test_new_publish_fires():
    st = MomentumTriggerState(rebalance_date="2026-06-30")
    fire, why = st.differs_from(_snap(["AAA"], reb="2026-07-14"))
    assert fire and "2026-07-14" in why


def test_same_publish_holds():
    st = MomentumTriggerState(rebalance_date="2026-07-14")
    fire, why = st.differs_from(_snap(["AAA"], reb="2026-07-14"))
    assert not fire


def test_old_12_1_capture_fires_on_power_trend_publish():
    # The last capture predates the swap (old list's 2026-06-30) — the first
    # Power Trend publish (2026-07-14) must fire the cutover rebalance.
    st = MomentumTriggerState(rebalance_date="2026-06-30")
    fire, _ = st.differs_from(_snap(["AAA"], reb="2026-07-14"))
    assert fire


# ── Diff (buy new / resize held / sell dropped) ──────────────────────────────

def test_buys_new_names_equal_weight():
    tgt = build_momentum_target(_snap(["AAA", "BBB", "CCC", "DDD", "NVDA",
                                       "A2", "B2", "C2"]), CAP)  # 8 names → $62.5K
    out = build_momentum_intents(tgt, {}, {**_EOD, "A2": 10.0, "B2": 10.0, "C2": 10.0})
    assert len(out) == 8 and all(i.side == "buy" for i in out)
    by = {i.ticker: i for i in out}
    assert by["AAA"].target_notional == 62_500.0
    assert by["AAA"].target_quantity == 625.0  # $62.5K / $100


def test_sells_dropped_names_full_position():
    tgt = build_momentum_target(_snap(["AAA"]), CAP)
    out = build_momentum_intents(tgt, {"NVDA": 50.0}, _EOD)
    by = {i.ticker: i for i in out}
    assert by["NVDA"].side == "sell" and by["NVDA"].target_quantity == 50.0
    assert by["NVDA"].target_notional == -10_000.0  # 50 sh × $200


def test_resizes_held_name_beyond_band():
    # Held 100 sh AAA @ $100 = $10,000 current; new target $62,500 (8 names)
    # → buy delta $52,500 = 525 sh.
    tgt = build_momentum_target(_snap(["AAA", "B1", "B2", "B3", "B4", "B5", "B6", "B7"]), CAP)
    prices = {**_EOD, "B1": 10.0, "B2": 10.0, "B3": 10.0, "B4": 10.0,
              "B5": 10.0, "B6": 10.0, "B7": 10.0}
    out = build_momentum_intents(tgt, {"AAA": 100.0}, prices)
    by = {i.ticker: i for i in out}
    assert by["AAA"].side == "buy" and by["AAA"].target_notional == 52_500.0
    assert by["AAA"].target_quantity == 525.0


def test_holds_inside_band():
    # Held AAA worth $61,500 vs target $62,500 → drift $1,000 < 3% of target
    # ($1,875) → hold, no AAA intent at all.
    tgt = build_momentum_target(_snap(["AAA", "B1", "B2", "B3", "B4", "B5", "B6", "B7"]), CAP)
    prices = {**_EOD, "B1": 10.0, "B2": 10.0, "B3": 10.0, "B4": 10.0,
              "B5": 10.0, "B6": 10.0, "B7": 10.0}
    out = build_momentum_intents(tgt, {"AAA": 615.0}, prices)  # 615 × $100 = $61,500
    assert all(i.ticker != "AAA" for i in out)


def test_resize_sell_clamped_to_held():
    # Held 700 sh AAA ($70,000) vs target $62,500 → sell $7,500 = 75 sh (< held).
    tgt = build_momentum_target(_snap(["AAA", "B1", "B2", "B3", "B4", "B5", "B6", "B7"]), CAP)
    prices = {**_EOD, "B1": 10.0, "B2": 10.0, "B3": 10.0, "B4": 10.0,
              "B5": 10.0, "B6": 10.0, "B7": 10.0}
    out = build_momentum_intents(tgt, {"AAA": 700.0}, prices)
    by = {i.ticker: i for i in out}
    assert by["AAA"].side == "sell" and by["AAA"].target_notional == -7_500.0
    assert by["AAA"].target_quantity == 75.0


def test_all_cash_sells_everything():
    tgt = build_momentum_target(_snap([], all_cash=True), CAP)
    out = build_momentum_intents(tgt, {"AAA": 10.0, "NVDA": 5.0}, _EOD)
    assert len(out) == 2 and all(i.side == "sell" for i in out)



# ── Daily trend-break stop (Joe decision 2026-07-15; backtested) ────────────

def test_trend_break_sells_full_position():
    from paper_portfolio.momentum import build_trend_break_intents
    out = build_trend_break_intents({"AAA"}, {"AAA": 350.0, "BBB": 10.0}, _EOD)
    assert len(out) == 1
    o = out[0]
    assert o.side == "sell" and o.ticker == "AAA"
    assert o.target_quantity == 350.0
    assert o.target_notional == -35_000.0  # 350 sh × $100
    assert "all four" in o.rebalance_trigger_reason


def test_trend_break_ignores_unheld_names():
    from paper_portfolio.momentum import build_trend_break_intents
    out = build_trend_break_intents({"ZZZ"}, {"AAA": 350.0}, _EOD)
    assert out == []


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print(f"PASS {name}")
    print("test_momentum_sleeve: all tests passed")


def test_momentum_whole_share_entries():
    """2026-07-21: momentum entries floor to whole shares."""
    from paper_portfolio.momentum import build_momentum_intents
    from paper_portfolio.sleeves import SleeveTarget, TargetLine
    target = SleeveTarget(
        sleeve="M", capital_assigned=1000.0, gross_long=1000.0, leverage_used=0,
        idle_cash=0, leverage_ratio=0,
        lines=[TargetLine(sleeve="M", ticker="AAA", notional=1000.0, score=None,
                          rationale="test")])
    out = build_momentum_intents(target, {}, {"AAA": 333.0})
    assert len(out) == 1 and out[0].target_quantity == 3.0
