"""
Unit tests for paper_portfolio.sleeves — Sleeve B sizing math.

Sizing re-scaled 2026-06-23 (Joe): notional = floor(buy_score) x $20K
  score 5 -> $100K, 6 -> $120K, 7 -> $140K, 8 -> $160K, 9 -> $180K, 10 -> $200K.
Base capital is the full $1M book (Sleeve A retired); 2x cap = $2M gross.

Run: python -m pytest paper_portfolio/tests/ -v
"""

from __future__ import annotations

import pytest

from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_b_target

CAP = 1_000_000   # $1M book base
LEV = 2.0         # -> $2M gross cap


def _mk(score_list):
    sigs = [EquitySignal(ticker=t, mt_score=s*10.0, buy_score=s,
                         band="Strong Buy" if s >= 9 else "Watch Buy",
                         scan_date="2026-06-23") for t, s in score_list]
    return EquityScannerSnapshot(scan_date="2026-06-23", signals=sigs,
                                 all_count=len(sigs), raw_payload_sample=[])


# 1 — overflow with leverage
def test_overflow_uses_leverage_up_to_cap():
    # 8 @9.5 -> $180K each = $1.44M (> $1M base, < $2M cap) -> all fill full
    t = build_sleeve_b_target(_mk([(f"T{i}", 9.5) for i in range(8)]), CAP, LEV)
    assert len(t.lines) == 8
    assert all(l.notional == 180_000.0 for l in t.lines)
    assert t.gross_long == 1_440_000.0
    assert t.leverage_used == 440_000.0
    assert t.leverage_ratio == pytest.approx(1.44, rel=1e-6)
    # 20 @10 -> $200K each = $4M demand, capped at $2M -> $100K each
    t2 = build_sleeve_b_target(_mk([(f"X{i}", 10.0) for i in range(20)]), CAP, LEV)
    assert t2.gross_long <= 2_000_000.01
    assert len(t2.lines) == 20
    assert all(l.notional == pytest.approx(100_000.0, rel=1e-6) for l in t2.lines)


# 2 — idle cash when signals scarce
def test_idle_cash_when_scarce():
    # 5,6,7 -> $100K,$120K,$140K = $360K; $640K idle
    t = build_sleeve_b_target(_mk([("A", 5.0), ("B", 6.0), ("C", 7.0)]), CAP, LEV)
    assert t.gross_long == 360_000.0
    assert t.idle_cash == 640_000.0
    assert t.leverage_used == 0.0
    assert {round(l.notional) for l in t.lines} == {100_000, 120_000, 140_000}


def test_zero_signals_full_cash():
    t = build_sleeve_b_target(_mk([]), CAP, LEV)
    assert len(t.lines) == 0
    assert t.gross_long == 0.0
    assert t.idle_cash == 1_000_000.0


# 3 — band prioritization, all fit
def test_band_fill_prioritization():
    # 4 @9.5 ($180K=720K) + 2 @7.5 ($140K=280K) + 4 @5.5 ($100K=400K) = $1.4M
    sigs = ([(f"H{i}", 9.5) for i in range(4)] + [(f"M{i}", 7.5) for i in range(2)]
            + [(f"L{i}", 5.5) for i in range(4)])
    t = build_sleeve_b_target(_mk(sigs), CAP, LEV)
    h = [l for l in t.lines if l.ticker[0] == "H"]
    m = [l for l in t.lines if l.ticker[0] == "M"]
    lo = [l for l in t.lines if l.ticker[0] == "L"]
    assert len(h) == 4 and all(l.notional == 180_000.0 for l in h)
    assert len(m) == 2 and all(l.notional == 140_000.0 for l in m)
    assert len(lo) == 4 and all(l.notional == 100_000.0 for l in lo)
    assert t.gross_long == 1_400_000.0
    assert t.leverage_used == 400_000.0


# 4 — marginal band pro-rated; lower bands get nothing
def test_marginal_band_prorate():
    # 9 @10 ($200K=1.8M) + 3 @8 ($160K=480K) + 5 @6 ($120K=600K); cap $2M
    sigs = ([(f"H{i}", 10.0) for i in range(9)] + [(f"M{i}", 8.0) for i in range(3)]
            + [(f"L{i}", 6.0) for i in range(5)])
    t = build_sleeve_b_target(_mk(sigs), CAP, LEV)
    h = [l for l in t.lines if l.ticker[0] == "H"]
    m = [l for l in t.lines if l.ticker[0] == "M"]
    lo = [l for l in t.lines if l.ticker[0] == "L"]
    assert len(h) == 9 and all(l.notional == 200_000.0 for l in h)
    assert len(m) == 3
    for l in m:
        assert l.notional == pytest.approx(200_000.0 / 3, rel=1e-3)
    assert len(lo) == 0
    assert t.gross_long <= 2_000_000.01


# 5 — depends only on scanner
def test_depends_only_on_scanner():
    t = build_sleeve_b_target(_mk([("ZZZ", 9.5), ("YYY", 7.5)]), CAP, LEV)
    assert {l.ticker for l in t.lines} == {"ZZZ", "YYY"}
    assert t.gross_long == 180_000.0 + 140_000.0
    assert t.leverage_used == 0.0


# 6 — exit below threshold
def test_exit_below_5():
    t = build_sleeve_b_target(_mk([("KEEP1", 9.0), ("KEEP2", 5.0), ("DROP", 4.9)]), CAP, LEV)
    tk = {l.ticker for l in t.lines}
    assert "DROP" not in tk and "KEEP1" in tk
    assert next(l for l in t.lines if l.ticker == "KEEP2").notional == 100_000.0  # score 5 -> $100K


def test_threshold_5_qualifies():
    t = build_sleeve_b_target(_mk([("AT_5", 5.0)]), CAP)
    assert len(t.lines) == 1 and t.lines[0].notional == 100_000.0


# 7 — hard cap
def test_never_exceeds_2m():
    t = build_sleeve_b_target(_mk([(f"M{i}", 10.0) for i in range(40)]), CAP, LEV)
    assert t.gross_long <= 2_000_000.01
    assert t.leverage_used <= 1_000_000.01
