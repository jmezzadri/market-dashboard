"""Unit tests for paper_portfolio.sleeves — FIXED-size, NO-leverage sizing
(Conviction-Insider rebuild 2026-07-07). Each launched name enters at
min($100K, 10% of capital); gross never exceeds capital; when more names
qualify than cash allows, highest buy_score fills first and the rest are
skipped (idle cash) — never pro-rated, never levered."""
from __future__ import annotations
from paper_portfolio.signals import EquityScannerSnapshot, EquitySignal
from paper_portfolio.sleeves import build_sleeve_b_target
from paper_portfolio.config import SLEEVE_B_ENTRY_NOTIONAL, SLEEVE_B_MAX_PCT_NAV

CAP = 1_000_000
PER = min(SLEEVE_B_ENTRY_NOTIONAL, SLEEVE_B_MAX_PCT_NAV * CAP)  # $100K

def _mk(score_list):
    sigs = [EquitySignal(ticker=t, mt_score=s*10.0, buy_score=s,
            band="Strong Buy" if s >= 9 else "Watch Buy", scan_date="2026-06-23")
            for t, s in score_list]
    return EquityScannerSnapshot("2026-06-23", sigs, len(sigs), [], {})

def test_fixed_size_no_leverage_all_fit():
    t = build_sleeve_b_target(_mk([(f"T{i}", 6.0) for i in range(5)]), CAP, 2.0)
    assert len(t.lines) == 5
    assert all(l.notional == PER for l in t.lines)
    assert t.gross_long == 5*PER and t.leverage_used == 0.0
    assert t.idle_cash == CAP - 5*PER

def test_no_leverage_caps_at_capital():
    t = build_sleeve_b_target(_mk([(f"T{i:02d}", 6.0) for i in range(15)]), CAP, 2.0)
    assert len(t.lines) == int(CAP // PER)  # 10
    assert t.gross_long <= CAP + 0.01 and t.leverage_used == 0.0
    assert all(l.notional == PER for l in t.lines)

def test_highest_score_priority_when_capped():
    pairs = [(f"H{i}", 9.0) for i in range(10)] + [("LOW1", 5.0), ("LOW2", 5.5)]
    t = build_sleeve_b_target(_mk(pairs), CAP)
    tk = {l.ticker for l in t.lines}
    assert len(tk) == 10 and "LOW1" not in tk and "LOW2" not in tk

def test_idle_cash_when_scarce():
    t = build_sleeve_b_target(_mk([("A", 5.0), ("B", 6.0), ("C", 7.0)]), CAP)
    assert t.gross_long == 3*PER and t.idle_cash == CAP - 3*PER and t.leverage_used == 0.0

def test_zero_signals_full_cash():
    t = build_sleeve_b_target(_mk([]), CAP)
    assert len(t.lines) == 0 and t.gross_long == 0.0 and t.idle_cash == CAP

def test_below_threshold_excluded():
    t = build_sleeve_b_target(_mk([("KEEP", 9.0), ("AT5", 5.0), ("DROP", 4.9)]), CAP)
    tk = {l.ticker for l in t.lines}
    assert "DROP" not in tk and "KEEP" in tk and "AT5" in tk
    assert all(l.notional == PER for l in t.lines)

def test_ten_pct_cap_scales_with_capital():
    cap = 500_000
    per = min(SLEEVE_B_ENTRY_NOTIONAL, SLEEVE_B_MAX_PCT_NAV * cap)  # $50K
    t = build_sleeve_b_target(_mk([("A", 6.0)]), cap)
    assert t.lines[0].notional == per == 50_000
