"""Unit tests for paper_portfolio.sleeves — EQUAL-WEIGHT / FULL-CAPITAL
sizing (Joe decision 2026-07-15). The sleeve always deploys ~100% of its
capital, split equally across every qualifying name: entries (score >= 4)
plus held names still above the exit floor (score >= 3). Per-name is
floored to the cent so gross never exceeds capital; no leverage, ever."""
from __future__ import annotations
from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_b_target, build_momentum_target

CAP = 500_000


def _mk(score_list, held_scores=None):
    sigs = [EquitySignal(ticker=t, mt_score=s * 10.0, buy_score=s,
            band="Strong Buy" if s >= 5 else "Watch Buy", scan_date="2026-07-15")
            for t, s in score_list]
    all_scores = {t.upper(): s for t, s in score_list}
    all_scores.update({t.upper(): s for t, s in (held_scores or {}).items()})
    return EquityScannerSnapshot("2026-07-15", sigs, len(sigs), [], all_scores)


def test_three_names_split_full_capital():
    # Hand-check (2026-07-15 live case): RH/GGAL/AVO at score 5 →
    # $500K / 3 = $166,666.66 each (cent-floored), gross $499,999.98.
    t = build_sleeve_b_target(_mk([("RH", 5.0), ("GGAL", 5.0), ("AVO", 5.0)]), CAP)
    assert len(t.lines) == 3
    assert all(l.notional == 166_666.66 for l in t.lines)
    assert abs(t.gross_long - 499_999.98) < 0.001 and t.leverage_used == 0.0
    assert abs(t.idle_cash - 0.02) < 0.001


def test_one_name_takes_whole_sleeve():
    t = build_sleeve_b_target(_mk([("RH", 5.0)]), CAP)
    assert len(t.lines) == 1 and t.lines[0].notional == 500_000.0
    assert t.idle_cash == 0.0


def test_seventeen_names_equal_weight():
    t = build_sleeve_b_target(_mk([(f"T{i:02d}", 4.5) for i in range(17)]), CAP)
    assert len(t.lines) == 17
    assert all(l.notional == 29_411.76 for l in t.lines)  # int(50000000/17)/100
    assert t.gross_long <= CAP


def test_held_name_above_exit_floor_counts_in_n():
    # 2 fresh entries + 1 held name decayed to 3.4 (>= exit floor 3) → N = 3.
    t = build_sleeve_b_target(
        _mk([("A", 5.0), ("B", 4.0)], held_scores={"HELD": 3.4}),
        CAP, held_tickers={"HELD"})
    tk = {l.ticker for l in t.lines}
    assert tk == {"A", "B", "HELD"}
    assert all(l.notional == 166_666.66 for l in t.lines)


def test_held_name_below_floor_not_counted():
    t = build_sleeve_b_target(
        _mk([("A", 5.0)], held_scores={"DEAD": 2.0}),
        CAP, held_tickers={"DEAD"})
    tk = {l.ticker for l in t.lines}
    assert tk == {"A"} and t.lines[0].notional == 500_000.0


def test_below_buy_threshold_excluded():
    t = build_sleeve_b_target(_mk([("KEEP", 4.0), ("DROP", 3.9)]), CAP)
    tk = {l.ticker for l in t.lines}
    assert tk == {"KEEP"}


def test_zero_signals_full_cash():
    t = build_sleeve_b_target(_mk([]), CAP)
    assert len(t.lines) == 0 and t.gross_long == 0.0 and t.idle_cash == CAP


# ── Sleeve M (Power Trend) sizing — min-8 floor, 15-cap owned by producer ──

class _PTE:
    def __init__(self, rank, ticker, roc):
        self.rank, self.ticker, self.roc_3m = rank, ticker, roc


class _PTSnap:
    def __init__(self, entries, all_cash=False):
        self.rebalance_date = "2026-07-14"
        self.next_rebalance_date = "2026-08-01"
        self.entries = entries
        self.all_cash = all_cash


def test_power_trend_fourteen_names():
    # Hand-check: $500K / 14 = $35,714.28 (cent-floored); idle $0.08.
    snap = _PTSnap([_PTE(i + 1, f"P{i:02d}", 50.0) for i in range(14)])
    t = build_momentum_target(snap, CAP)
    assert len(t.lines) == 14
    assert all(l.notional == 35_714.28 for l in t.lines)
    assert abs(t.gross_long - 499_999.92) < 0.001 and abs(t.idle_cash - 0.08) < 0.001


def test_power_trend_min8_floor():
    # Hand-check: 3 names → $500K / max(3,8) = $62,500 each; $312,500 in cash.
    snap = _PTSnap([_PTE(1, "A", 90.0), _PTE(2, "B", 60.0), _PTE(3, "C", 30.0)])
    t = build_momentum_target(snap, CAP)
    assert len(t.lines) == 3
    assert all(l.notional == 62_500.0 for l in t.lines)
    assert t.gross_long == 187_500.0 and t.idle_cash == 312_500.0


def test_power_trend_all_cash_publish():
    t = build_momentum_target(_PTSnap([], all_cash=True), CAP)
    assert t.lines == [] and t.idle_cash == CAP


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print(f"PASS {name}")
    print("test_sleeves: all tests passed")
