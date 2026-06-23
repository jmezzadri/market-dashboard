"""
Unit tests for paper_portfolio.sleeves — Sleeve B sizing math.

Sizing re-scaled 2026-06-23 (Joe): notional = floor(buy_score) x $10K
  score 5 -> $50K, 6 -> $60K, 7 -> $70K, 8 -> $80K, 9 -> $90K, 10 -> $100K.

Covers:
  1. Overflow with leverage (cap at $1M)
  2. Idle cash when signals scarce
  3. Score-band fill prioritization (highest score first)
  4. Marginal-band pro-rate
  5. Exit below threshold 5

Run: python -m pytest paper_portfolio/tests/ -v
"""

from __future__ import annotations

import pytest

from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_b_target


def _mk_scanner(score_list: list[tuple[str, float]]) -> EquityScannerSnapshot:
    """Build a snapshot from (ticker, buy_score) pairs (normalized 0-10)."""
    signals = [
        EquitySignal(
            ticker=t,
            mt_score=score * 10.0,
            buy_score=score,
            band="Strong Buy" if score >= 9 else "Watch Buy",
            scan_date="2026-06-23",
        )
        for t, score in score_list
    ]
    return EquityScannerSnapshot(
        scan_date="2026-06-23", signals=signals,
        all_count=len(signals), raw_payload_sample=[],
    )


# 1 — overflow with leverage
def test_sleeve_b_overflow_uses_leverage_up_to_cap():
    # 11 names at score 9.5 -> $90K each = $990K demand (> $500K, < $1M cap)
    snap = _mk_scanner([(f"T{i}", 9.5) for i in range(11)])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    assert target.sleeve == "B"
    assert len(target.lines) == 11
    assert all(l.notional == 90_000.0 for l in target.lines)
    assert target.gross_long == 990_000.0
    assert target.leverage_used == 490_000.0
    assert target.idle_cash == 0.0
    assert target.leverage_ratio == pytest.approx(1.98, rel=1e-6)

    # 25 names at score 10 -> $100K each = $2.5M demand, capped at $1M
    snap2 = _mk_scanner([(f"X{i}", 10.0) for i in range(25)])
    target2 = build_sleeve_b_target(snap2, sleeve_b_capital=500_000, max_leverage=2.0)
    assert target2.gross_long <= 1_000_000.01
    assert len(target2.lines) == 25
    # single band, all pro-rated evenly: $1M / 25 = $40K each
    assert all(l.notional == pytest.approx(40_000.0, rel=1e-6) for l in target2.lines)


# 2 — idle cash when signals scarce
def test_sleeve_b_idle_cash_when_signals_scarce():
    # scores 9.5, 9.0, 10.0 -> $90K, $90K, $100K = $280K; $220K idle
    snap = _mk_scanner([("AAA", 9.5), ("BBB", 9.0), ("CCC", 10.0)])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    assert target.gross_long == 280_000.0
    assert target.idle_cash == 220_000.0
    assert target.leverage_used == 0.0
    assert target.leverage_ratio == pytest.approx(0.56, rel=1e-6)
    assert len(target.lines) == 3
    assert {round(l.notional) for l in target.lines} == {90_000, 100_000}


def test_sleeve_b_zero_signals_full_cash():
    snap = _mk_scanner([])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    assert len(target.lines) == 0
    assert target.gross_long == 0.0
    assert target.idle_cash == 500_000.0
    assert target.leverage_used == 0.0


# 3 — fill prioritization, all bands fit at full size
def test_sleeve_b_band_fill_prioritization():
    # 4 @9.5 ($90K=$360K) + 2 @7.5 ($70K=$140K) + 4 @5.5 ($50K=$200K) = $700K
    # > $500K -> leverage; < $1M cap -> all fill full
    signals = ([(f"H{i}", 9.5) for i in range(4)]
               + [(f"M{i}", 7.5) for i in range(2)]
               + [(f"L{i}", 5.5) for i in range(4)])
    target = build_sleeve_b_target(_mk_scanner(signals), sleeve_b_capital=500_000, max_leverage=2.0)
    h = [l for l in target.lines if l.ticker.startswith("H")]
    m = [l for l in target.lines if l.ticker.startswith("M")]
    lo = [l for l in target.lines if l.ticker.startswith("L")]
    assert len(h) == 4 and all(l.notional == 90_000.0 for l in h)
    assert len(m) == 2 and all(l.notional == 70_000.0 for l in m)
    assert len(lo) == 4 and all(l.notional == 50_000.0 for l in lo)
    assert target.gross_long == 700_000.0
    assert target.leverage_used == 200_000.0


# 4 — marginal band pro-rated, lower bands get nothing
def test_sleeve_b_marginal_band_prorate():
    # 8 @10.0 ($100K=$800K) + 3 @8.0 ($80K=$240K) + 5 @6.0 ($60K=$300K)
    # demand $1.34M -> budget $1M. s10 fills ($800K), $200K left,
    # s8 demand $240K > $200K -> pro-rate $200K/3 each; s6 gets nothing.
    signals = ([(f"H{i}", 10.0) for i in range(8)]
               + [(f"M{i}", 8.0) for i in range(3)]
               + [(f"L{i}", 6.0) for i in range(5)])
    target = build_sleeve_b_target(_mk_scanner(signals), sleeve_b_capital=500_000, max_leverage=2.0)
    h = [l for l in target.lines if l.ticker.startswith("H")]
    m = [l for l in target.lines if l.ticker.startswith("M")]
    lo = [l for l in target.lines if l.ticker.startswith("L")]
    assert len(h) == 8 and all(l.notional == 100_000.0 for l in h)
    assert len(m) == 3
    for l in m:
        assert l.notional == pytest.approx(200_000.0 / 3, rel=1e-3)
    assert len(lo) == 0  # budget exhausted before the $60K band
    assert target.gross_long <= 1_000_000.01


# 5 — depends only on the scanner
def test_sleeve_b_target_depends_only_on_scanner():
    snap = _mk_scanner([("ZZZ", 9.5), ("YYY", 7.5)])
    b = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    assert b.sleeve == "B"
    assert {l.ticker for l in b.lines} == {"ZZZ", "YYY"}
    assert b.gross_long == 90_000.0 + 70_000.0
    assert b.idle_cash == 500_000.0 - 160_000.0
    assert b.leverage_used == 0.0


# 6 — exit below threshold
def test_sleeve_b_exits_when_score_drops_below_5():
    snap = _mk_scanner([("KEEP1", 9.0), ("KEEP2", 5.0), ("DROP", 4.9)])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    tickers = {l.ticker for l in target.lines}
    assert "DROP" not in tickers
    assert "KEEP1" in tickers
    keep2 = next(l for l in target.lines if l.ticker == "KEEP2")
    assert keep2.notional == 50_000.0  # score 5 -> $50K


def test_sleeve_b_score_at_exact_threshold_qualifies():
    snap = _mk_scanner([("AT_5", 5.0)])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000)
    assert len(target.lines) == 1
    assert target.lines[0].notional == 50_000.0


# 7 — hard cap
def test_sleeve_b_never_exceeds_1m_total():
    snap = _mk_scanner([(f"M{i}", 10.0) for i in range(100)])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    assert target.gross_long <= 1_000_000.01
    assert target.leverage_used <= 500_000.01
