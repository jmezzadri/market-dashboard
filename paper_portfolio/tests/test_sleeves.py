"""
Unit tests for paper_portfolio.sleeves — the Sleeve A + Sleeve B math.

Required by the Phase 2 spec:
  1. Sleeve B overflow with leverage
  2. Idle cash with too few signals
  3. Tier-fill prioritization (9-10 first)
  4. Sleeve isolation (A and B do not bleed into each other)
  5. Exit on score drop below 5

Run: python -m pytest paper_portfolio/tests/ -v
"""

from __future__ import annotations

import pytest

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


# ─────────────────────────────────────────────────────────────────────────────
# Test fixtures
# ─────────────────────────────────────────────────────────────────────────────

def _mk_scanner(score_list: list[tuple[str, float]]) -> EquityScannerSnapshot:
    """Build an EquityScannerSnapshot from a list of (ticker, buy_score) pairs.
    The buy_score input is the NORMALIZED 0-10 value (post mt_score/10)."""
    signals = [
        EquitySignal(
            ticker=t,
            mt_score=score * 10.0,        # reverse-engineer mt_score
            buy_score=score,
            band="Strong Buy" if score >= 9 else "Watch Buy",
            scan_date="2026-05-26",
        )
        for t, score in score_list
    ]
    return EquityScannerSnapshot(
        scan_date="2026-05-26",
        signals=signals,
        all_count=len(signals),
        raw_payload_sample=[],
    )


def _mk_asset_tilt(weights: list[tuple[str, str, float, str]]) -> AssetTiltSnapshot:
    """weights = [(ig_id, primary_etf, weight_pct, rating), ...] where
    weight_pct is the fraction (0.10 = 10 %). Sum should be 1.0 for a
    full equity sleeve."""
    igs = [
        AssetTiltIG(ig_id=ig_id, name=ig_id.title(), sector="X",
                    primary_etf=etf, weight_pct=w, rating=rating)
        for ig_id, etf, w, rating in weights
    ]
    return AssetTiltSnapshot(
        as_of="2026-05-26", engine_version="test", equity_pct=1.0,
        industry_groups=igs, raw={},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 1 — Sleeve B overflow with leverage
# ─────────────────────────────────────────────────────────────────────────────

def test_sleeve_b_overflow_uses_leverage_up_to_cap():
    """Total demand at full sizing > $500K → use leverage, cap at $1M."""
    # 11 names at $50K each = $550K → overflow by $50K, all fillable under $1M cap
    signals = [(f"T{i}", 9.5) for i in range(11)]
    snap = _mk_scanner(signals)
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)

    assert target.sleeve == "B"
    # All 11 names get full $50K
    assert len(target.lines) == 11
    assert all(l.notional == 50_000.0 for l in target.lines)
    assert target.gross_long == 550_000.0
    assert target.leverage_used == 50_000.0
    assert target.idle_cash == 0.0
    assert target.leverage_ratio == 1.1

    # Now push demand past the $1M cap: 25 names at tier1 = $1.25M demand
    big_signals = [(f"X{i}", 10.0) for i in range(25)]
    snap2 = _mk_scanner(big_signals)
    target2 = build_sleeve_b_target(snap2, sleeve_b_capital=500_000, max_leverage=2.0)
    # gross_long should NEVER exceed $1M (the levered cap)
    assert target2.gross_long <= 1_000_000.01
    # All 25 lines exist; each was pro-rated within tier1 since tier1 alone exceeded budget
    assert len(target2.lines) == 25
    assert all(l.notional < 50_000.0 for l in target2.lines)
    assert all(l.notional == pytest.approx(40_000.0, rel=1e-6) for l in target2.lines)


# ─────────────────────────────────────────────────────────────────────────────
# Test 2 — Idle cash with too few signals
# ─────────────────────────────────────────────────────────────────────────────

def test_sleeve_b_idle_cash_when_signals_scarce():
    """Few signals → fill at full size; residual sits as literal idle cash."""
    # 3 tier1 names at $50K = $150K — leaves $350K idle
    snap = _mk_scanner([("AAA", 9.5), ("BBB", 9.0), ("CCC", 10.0)])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)

    assert target.gross_long == 150_000.0
    assert target.idle_cash == 350_000.0
    assert target.leverage_used == 0.0
    assert target.leverage_ratio == 0.30
    assert len(target.lines) == 3
    assert all(l.notional == 50_000.0 for l in target.lines)


def test_sleeve_b_zero_signals_full_cash():
    """No qualifying signals → entire sleeve is idle cash; zero lines."""
    snap = _mk_scanner([])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)

    assert len(target.lines) == 0
    assert target.gross_long == 0.0
    assert target.idle_cash == 500_000.0
    assert target.leverage_used == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Test 3 — Tier-fill prioritization (9-10 first, then 7-8, then 5-6)
# ─────────────────────────────────────────────────────────────────────────────

def test_sleeve_b_tier_fill_prioritization():
    """Under leverage pressure, tier1 fills first at full $50K, tier2 next at
    full $40K, tier3 shares the remainder."""
    # tier1: 8 names × $50K = $400K
    # tier2: 5 names × $40K = $200K
    # tier3: 4 names × $30K = $120K
    # total demand = $720K > $500K → leverage; under $1M cap → all fit
    signals = (
        [(f"H{i}", 9.5) for i in range(8)] +
        [(f"M{i}", 7.5) for i in range(5)] +
        [(f"L{i}", 5.5) for i in range(4)]
    )
    snap = _mk_scanner(signals)
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)

    h_lines = [l for l in target.lines if l.ticker.startswith("H")]
    m_lines = [l for l in target.lines if l.ticker.startswith("M")]
    l_lines = [l for l in target.lines if l.ticker.startswith("L")]

    assert len(h_lines) == 8
    assert all(l.notional == 50_000.0 for l in h_lines), "tier1 must fill at full $50K first"
    assert len(m_lines) == 5
    assert all(l.notional == 40_000.0 for l in m_lines), "tier2 fills at full $40K after tier1"
    assert len(l_lines) == 4
    assert all(l.notional == 30_000.0 for l in l_lines), "tier3 fills at $30K when budget remains"
    assert target.gross_long == 720_000.0
    assert target.leverage_used == 220_000.0


def test_sleeve_b_tier3_shares_remainder_when_budget_tight():
    """When tier1+tier2 fully consume budget except a thin slice, tier3
    receives only the slice — pro-rated, per-name <= $30K."""
    # tier1: 18 names × $50K = $900K   (eats most of the levered cap)
    # tier2: 3 names × $40K = $120K   → tier1+tier2 = $1.02M, exceeds $1M cap
    # tier3: 5 names                    → after the cap, no budget left
    signals = (
        [(f"H{i}", 10.0) for i in range(18)] +
        [(f"M{i}", 8.0) for i in range(3)] +
        [(f"L{i}", 6.0) for i in range(5)]
    )
    snap = _mk_scanner(signals)
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)

    # tier1 fills at $50K (fits — 18 × $50K = $900K)
    h_lines = [l for l in target.lines if l.ticker.startswith("H")]
    assert len(h_lines) == 18
    assert all(l.notional == 50_000.0 for l in h_lines)

    # remaining budget = $1M - $900K = $100K → tier2 demand $120K → pro-rated to ~$33.33K each
    m_lines = [l for l in target.lines if l.ticker.startswith("M")]
    assert len(m_lines) == 3
    for l in m_lines:
        assert l.notional == pytest.approx(100_000.0 / 3, rel=1e-3)

    # tier3 gets nothing — budget exhausted in tier2 pro-rate
    l_lines = [l for l in target.lines if l.ticker.startswith("L")]
    if l_lines:
        assert all(l.notional == 0.0 for l in l_lines)

    assert target.gross_long <= 1_000_000.01


# ─────────────────────────────────────────────────────────────────────────────
# Test 4 — Sleeve isolation
# ─────────────────────────────────────────────────────────────────────────────

def test_sleeve_isolation_a_and_b_independent():
    """Sleeve A target depends only on Asset Tilt; Sleeve B only on Scanner.
    Building both with the same capital cap should produce independent
    line lists, and neither leverages into the other."""
    at = _mk_asset_tilt([
        ("semis", "SOXX", 0.10, "OW"),
        ("software", "IGV", 0.05, "MW"),
        ("banks", "KBE", 0.20, "UW"),
        ("staples", "XLP", 0.65, "OW"),
    ])
    a = build_sleeve_a_target(at, sleeve_a_capital=500_000)

    # Sleeve A — unlevered, no negative weights, idle cash = 0 (weights sum to 1.0)
    assert a.sleeve == "A"
    assert a.gross_long == pytest.approx(500_000.0, rel=1e-4)
    assert a.leverage_used == 0.0
    assert a.idle_cash == pytest.approx(0.0, abs=0.5)
    a_tickers = {l.ticker for l in a.lines}
    assert a_tickers == {"SOXX", "IGV", "KBE", "XLP"}

    snap = _mk_scanner([("ZZZ", 9.5), ("YYY", 7.5)])
    b = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    b_tickers = {l.ticker for l in b.lines}
    assert b_tickers == {"ZZZ", "YYY"}
    assert b.gross_long == 50_000.0 + 40_000.0
    assert b.idle_cash == 500_000.0 - 90_000.0

    # No overlap in tickers
    assert a_tickers.isdisjoint(b_tickers)


def test_sleeve_a_respects_equity_pct():
    """When the engine carves out defensive (equity_pct < 1.0), Sleeve A
    target shrinks; difference rests in cash."""
    at = _mk_asset_tilt([
        ("semis", "SOXX", 0.50, "OW"),
        ("software", "IGV", 0.50, "MW"),
    ])
    # Override equity_pct → 0.7 means 70 % equity, 30 % defensive
    at = AssetTiltSnapshot(
        as_of=at.as_of, engine_version=at.engine_version,
        equity_pct=0.7, industry_groups=at.industry_groups, raw=at.raw,
    )
    a = build_sleeve_a_target(at, sleeve_a_capital=500_000)
    # Expected gross = 0.7 × $500K = $350K; idle = $150K
    assert a.gross_long == pytest.approx(350_000.0, abs=0.5)
    assert a.idle_cash == pytest.approx(150_000.0, abs=0.5)


# ─────────────────────────────────────────────────────────────────────────────
# Test 5 — Exit on score drop below 5
# ─────────────────────────────────────────────────────────────────────────────

def test_sleeve_b_exits_when_score_drops_below_5():
    """A name whose buy_score falls below the threshold must NOT appear in
    the Sleeve B target — i.e. the diff layer will see target=0 and
    issue a sell."""
    # Three names: 9.0 (passes), 5.0 (passes), 4.9 (fails)
    snap = _mk_scanner([("KEEP1", 9.0), ("KEEP2", 5.0), ("DROP", 4.9)])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    tickers = {l.ticker for l in target.lines}

    # 4.9 falls below the 5.0 buy threshold AND below the lowest tier band
    # (5.0 <= score < 7.0). The scanner reader already filters below threshold,
    # but defensive belt+braces: even if the signal arrived, sleeve B drops it.
    assert "DROP" not in tickers
    assert "KEEP1" in tickers
    # 5.0 sits in tier3 — $30K base
    keep2 = next(l for l in target.lines if l.ticker == "KEEP2")
    assert keep2.notional == 30_000.0


def test_sleeve_b_score_at_exact_threshold_qualifies():
    """A buy_score exactly at 5.0 is a buy (>= threshold)."""
    snap = _mk_scanner([("AT_5", 5.0)])
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000)
    assert len(target.lines) == 1
    assert target.lines[0].notional == 30_000.0


# ─────────────────────────────────────────────────────────────────────────────
# Bonus — Hard cap check
# ─────────────────────────────────────────────────────────────────────────────

def test_sleeve_b_never_exceeds_1m_total():
    """No legal scanner output should produce > $1M gross long in Sleeve B."""
    # 100 names at tier1 → $5M demand, must cap at $1M
    signals = [(f"M{i}", 10.0) for i in range(100)]
    snap = _mk_scanner(signals)
    target = build_sleeve_b_target(snap, sleeve_b_capital=500_000, max_leverage=2.0)
    assert target.gross_long <= 1_000_000.01
    assert target.leverage_used <= 500_000.01
