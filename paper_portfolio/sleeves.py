"""
paper_portfolio.sleeves — pure functions that compute target positions.

Both sleeve targets are computed in dollars-of-notional, NOT shares. The
diff layer (diff.py) converts notional → shares at the time the order
is built, using the last trade price from Alpaca, so this module stays
deterministic and unit-testable without a live price feed.

  * Sleeve B — Long-only equity scanner output, sized into three tiers
                 ($50K / $40K / $30K) on a normalized 0–10 buy-score.
                 Up to 2x leverage when total demand at full sizing
                 exceeds the $500K cash sleeve; tier-prioritized fill
                 within the levered cap.

Both targets respect cash idle: if signals are scarce the sleeves park
the residual in literal cash (no BIL/SHV proxy in v1 — locked).

Senior Quant owns this file. Any edit requires backtest re-run.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from paper_portfolio.config import (
    SLEEVE_B_BUY_THRESHOLD,
    SLEEVE_B_TIER_BANDS,  # kept for import-compat; sizing no longer tier-based
    SLEEVE_B_ENTRY_NOTIONAL,
    SLEEVE_B_MAX_PCT_NAV,
    SLEEVE_B_USE_LEVERAGE,
)
from paper_portfolio.signals import EquityScannerSnapshot


# ─────────────────────────────────────────────────────────────────────────────
# Target dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TargetLine:
    sleeve: str              # 'A' or 'B'
    ticker: str
    notional: float          # dollar notional to hold long; 0 means "exit"
    rationale: str           # plain-English so-what for audit + UI
    score: float | None = None  # buy_score for Sleeve B; None for Sleeve A


@dataclass(frozen=True)
class SleeveTarget:
    sleeve: str
    capital_assigned: float          # cash cap for this sleeve (e.g. $500K)
    gross_long: float                # sum of TargetLine.notional
    leverage_used: float             # max(0, gross_long - capital_assigned)
    idle_cash: float                 # max(0, capital_assigned - gross_long)
    leverage_ratio: float            # gross_long / capital_assigned (≥ 1 when levered)
    lines: list[TargetLine] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve B — Equity Scanner long-only, score-stepped sizing with overflow leverage
# ─────────────────────────────────────────────────────────────────────────────

def _tier_for(buy_score: float) -> tuple[str, float] | None:
    """Return (band_name, base_size) for a given normalized buy_score, or None
    if the score falls below the buy threshold. Sizing is score-stepped:
    notional = floor(score) x $10K (score 5 -> $50K ... 10 -> $100K)."""
    for band_name, lo, hi, base_size in SLEEVE_B_TIER_BANDS:
        if lo <= buy_score < hi:
            return band_name, base_size
    return None


def build_sleeve_b_target(
    snapshot,
    sleeve_b_capital: float,
    max_leverage: float = 1.0,
) -> SleeveTarget:
    """FIXED-SIZE, LONG-ONLY, NO-LEVERAGE target (Conviction-Insider rebuild 2026-07-07).

    Root-cause fix for the churn bleed: the old build sized each name by its
    0–10 score tier ($100K–$200K) and used up to 2x leverage. With buy and exit
    thresholds both at 5.0, names flapped in/out and each round-trip booked a
    loss. New rules (Policy A / P1a):
      * Every launched name (buy_score >= SLEEVE_B_BUY_THRESHOLD) enters at ONE
        fixed size = min(SLEEVE_B_ENTRY_NOTIONAL, SLEEVE_B_MAX_PCT_NAV*capital).
      * No score-tier sizing → a score wobble never resizes a held name.
      * No leverage → gross never exceeds the sleeve's own cash. If more names
        qualify than cash allows, fill highest buy_score first (ticker A→Z to
        break ties), skip the rest (idle cash). Deterministic.
    Hysteresis (hold until score decays below the exit floor) lives in diff.py.
    """
    if sleeve_b_capital <= 0:
        return SleeveTarget(sleeve="B", capital_assigned=0, gross_long=0,
                            leverage_used=0, idle_cash=0, leverage_ratio=0, lines=[])

    budget = sleeve_b_capital * (max_leverage if SLEEVE_B_USE_LEVERAGE else 1.0)
    per_name = min(SLEEVE_B_ENTRY_NOTIONAL, SLEEVE_B_MAX_PCT_NAV * sleeve_b_capital)

    eligible = sorted(
        [s for s in snapshot.signals if s.buy_score >= SLEEVE_B_BUY_THRESHOLD],
        key=lambda s: (-s.buy_score, s.ticker),
    )

    lines: list[TargetLine] = []
    spent = 0.0
    for s in eligible:
        if spent + per_name > budget + 0.01:
            continue  # no cash left — skip (higher score already filled); never lever
        lines.append(TargetLine(
            sleeve="B", ticker=s.ticker, notional=round(per_name, 2),
            rationale=(f"Scanner buy-score {s.buy_score:.1f} — fixed entry "
                       f"${per_name:,.0f} (equal-weight; no averaging down; no leverage)"),
            score=s.buy_score,
        ))
        spent += per_name

    gross = sum(l.notional for l in lines)
    return SleeveTarget(
        sleeve="B",
        capital_assigned=sleeve_b_capital,
        gross_long=round(gross, 2),
        leverage_used=round(max(0.0, gross - sleeve_b_capital), 2),
        idle_cash=round(max(0.0, sleeve_b_capital - gross), 2),
        leverage_ratio=(gross / sleeve_b_capital) if sleeve_b_capital else 0.0,
        lines=lines,
    )
