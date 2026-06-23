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
    SLEEVE_B_TIER_BANDS,
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
    snapshot: EquityScannerSnapshot,
    sleeve_b_capital: float,
    max_leverage: float = 2.0,
) -> SleeveTarget:
    """Score-stepped fill with overflow leverage.

    Algorithm (Senior Quant-locked, re-sized 2026-06-23):
      0. Filter signals to buy_score >= SLEEVE_B_BUY_THRESHOLD (long-only).
      1. Each surviving name's base size = its score band's notional
         (score 5 -> $50K, 6 -> $60K, ... 10 -> $100K).
      2. Bands fill in DESCENDING score order (highest-scored names first).
         Within a band, sort by buy_score DESC then ticker (deterministic).
      3. If total demand <= sleeve_b_capital: fill every name at full base
         size; the residual rests as idle cash.
      4. If total demand > sleeve_b_capital: budget = min(total_demand,
         sleeve_b_capital * max_leverage). Walk bands high->low, filling each
         at full base while it fits; the first band that exceeds the remaining
         budget is pro-rated evenly within itself; lower bands then get nothing.
      5. gross_long never exceeds sleeve_b_capital * max_leverage.

    Returns a SleeveTarget with one TargetLine per filled name.
    """
    if sleeve_b_capital <= 0:
        return SleeveTarget(
            sleeve="B", capital_assigned=0, gross_long=0,
            leverage_used=0, idle_cash=0, leverage_ratio=0, lines=[],
        )

    base_for = {name: base for name, _, _, base in SLEEVE_B_TIER_BANDS}
    # Fill priority = descending base size (= descending score).
    order = [name for name, _, _, _ in sorted(SLEEVE_B_TIER_BANDS, key=lambda b: -b[3])]
    buckets: dict[str, list[tuple]] = {name: [] for name, _, _, _ in SLEEVE_B_TIER_BANDS}

    # Step 0 + 1 — bucket survivors by score band
    for sig in snapshot.signals:
        if sig.buy_score < SLEEVE_B_BUY_THRESHOLD:
            continue
        t = _tier_for(sig.buy_score)
        if t is None:
            continue
        buckets[t[0]].append((sig.ticker, sig.buy_score, sig.mt_score, sig.band))

    # Step 2 — deterministic sort within each band
    for name in buckets:
        buckets[name].sort(key=lambda x: (-x[1], x[0]))

    leverage_cap = sleeve_b_capital * max_leverage
    total_demand = sum(len(buckets[n]) * base_for[n] for n in buckets)

    lines: list[TargetLine] = []

    def _line(ticker: str, score: float, mt: float, band: str, notional: float,
              band_name: str, prorated: bool) -> TargetLine:
        rationale = (
            f"Scanner buy-score {score:.1f} (raw {mt:+.0f}); "
            f"base size ${base_for[band_name]:,.0f}"
            + (" — pro-rated within score band" if prorated else "")
        )
        return TargetLine(sleeve="B", ticker=ticker, notional=round(notional, 2),
                          rationale=rationale, score=score)

    # Step 3 — fast path: no leverage needed, fill all at full base size
    if total_demand <= sleeve_b_capital:
        for name in order:
            base = base_for[name]
            for ticker, score, mt, band in buckets[name]:
                lines.append(_line(ticker, score, mt, band, base, name, prorated=False))
        gross = sum(l.notional for l in lines)
        return SleeveTarget(
            sleeve="B",
            capital_assigned=sleeve_b_capital,
            gross_long=round(gross, 2),
            leverage_used=0.0,
            idle_cash=round(max(0.0, sleeve_b_capital - gross), 2),
            leverage_ratio=(gross / sleeve_b_capital) if sleeve_b_capital else 0.0,
            lines=lines,
        )

    # Step 4 — overflow: budget capped at the levered cap; fill bands high->low
    budget = min(total_demand, leverage_cap)
    remaining = budget
    for name in order:
        bucket = buckets[name]
        if not bucket:
            continue
        if remaining <= 0.0:
            break  # budget exhausted — lower bands get nothing (drop to cash/exit)
        base = base_for[name]
        demand = len(bucket) * base
        if demand <= remaining:
            for ticker, score, mt, band in bucket:
                lines.append(_line(ticker, score, mt, band, base, name, prorated=False))
            remaining -= demand
        else:
            per = remaining / len(bucket)
            for ticker, score, mt, band in bucket:
                lines.append(_line(ticker, score, mt, band, per, name, prorated=True))
            remaining = 0.0

    gross = sum(l.notional for l in lines)
    # Rounding guard: per-line cents can nudge gross a hair over the cap.
    if gross > leverage_cap + 0.01:
        scale = leverage_cap / gross
        lines = [TargetLine(sleeve=l.sleeve, ticker=l.ticker,
                            notional=round(l.notional * scale, 2),
                            rationale=l.rationale + " (final cap-fit shrink)",
                            score=l.score) for l in lines]
        gross = sum(l.notional for l in lines)

    leverage_used = max(0.0, gross - sleeve_b_capital)
    idle = max(0.0, sleeve_b_capital - gross)
    return SleeveTarget(
        sleeve="B",
        capital_assigned=sleeve_b_capital,
        gross_long=round(gross, 2),
        leverage_used=round(leverage_used, 2),
        idle_cash=round(idle, 2),
        leverage_ratio=(gross / sleeve_b_capital) if sleeve_b_capital else 0.0,
        lines=lines,
    )
