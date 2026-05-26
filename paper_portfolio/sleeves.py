"""
paper_portfolio.sleeves — pure functions that compute target positions.

Both sleeve targets are computed in dollars-of-notional, NOT shares. The
diff layer (diff.py) converts notional → shares at the time the order
is built, using the last trade price from Alpaca, so this module stays
deterministic and unit-testable without a live price feed.

  * Sleeve A — 16-or-24 IG ETFs at Asset Tilt recommended weights ×
                 $sleeve_a_allocation. Tilts are already normalized in
                 v10_allocation.json (IG dollar values sum to 100 when
                 equity_pct == 1.0).

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
from paper_portfolio.signals import AssetTiltSnapshot, EquityScannerSnapshot


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
# Sleeve A — Asset Tilt IG ETFs
# ─────────────────────────────────────────────────────────────────────────────

def build_sleeve_a_target(
    snapshot: AssetTiltSnapshot,
    sleeve_a_capital: float,
) -> SleeveTarget:
    """Multiply each IG's weight by sleeve_a_capital; group-by primary ETF
    in case two IGs share the same ETF (the v10 file does not, but the
    code defends against it).

    The Asset Tilt page weights are scaled to 100% across the equity sleeve.
    If equity_pct < 1.0 (engine carved out defensive), the Sleeve A target
    gross_long shrinks accordingly — the difference rests in cash.
    """
    if sleeve_a_capital <= 0:
        return SleeveTarget(
            sleeve="A", capital_assigned=0, gross_long=0,
            leverage_used=0, idle_cash=0, leverage_ratio=0, lines=[],
        )

    # Aggregate by primary ETF in case of any IG → ETF collision.
    by_etf: dict[str, dict] = {}
    for ig in snapshot.industry_groups:
        notional = ig.weight_pct * snapshot.equity_pct * sleeve_a_capital
        if notional <= 0:
            continue
        slot = by_etf.setdefault(ig.primary_etf, {"notional": 0.0, "igs": []})
        slot["notional"] += notional
        slot["igs"].append(ig)

    lines: list[TargetLine] = []
    for etf, slot in by_etf.items():
        igs = slot["igs"]
        rating_set = sorted({ig.rating for ig in igs})
        rationale = (
            f"Asset Tilt IG → ETF (covers " +
            ", ".join(ig.name for ig in igs) + ") "
            f"at {sum(ig.weight_pct for ig in igs)*100:.2f}% of equity sleeve; "
            f"rating {'/'.join(rating_set)}"
        )
        lines.append(TargetLine(
            sleeve="A",
            ticker=etf,
            notional=round(slot["notional"], 2),
            rationale=rationale,
            score=None,
        ))

    gross = sum(l.notional for l in lines)
    return SleeveTarget(
        sleeve="A",
        capital_assigned=sleeve_a_capital,
        gross_long=round(gross, 2),
        leverage_used=0.0,             # Sleeve A is unlevered by spec
        idle_cash=round(max(0.0, sleeve_a_capital - gross), 2),
        leverage_ratio=(gross / sleeve_a_capital) if sleeve_a_capital else 0.0,
        lines=lines,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve B — Equity Scanner long-only, tier-fill with overflow leverage
# ─────────────────────────────────────────────────────────────────────────────

def _tier_for(buy_score: float) -> tuple[str, float] | None:
    """Return (tier_name, base_size) for a given normalized buy_score, or
    None if the score falls below the buy threshold."""
    for tier_name, lo, hi, base_size in SLEEVE_B_TIER_BANDS:
        if lo <= buy_score < hi:
            return tier_name, base_size
    return None


def build_sleeve_b_target(
    snapshot: EquityScannerSnapshot,
    sleeve_b_capital: float,
    max_leverage: float = 2.0,
) -> SleeveTarget:
    """Tier-fill Sleeve B with overflow leverage.

    Algorithm (Senior Quant-locked v1):
      0. Filter signals to buy_score >= SLEEVE_B_BUY_THRESHOLD (long-only).
      1. Bucket each surviving signal into tier1 (9–10), tier2 (7–<9), or
         tier3 (5–<7); base sizes $50K / $40K / $30K.
      2. Sort within each tier by buy_score DESC (ties broken by ticker
         alphabetical, deterministic).
      3. If total demand <= sleeve_b_capital: fill every name at full
         base size; residual rests as idle cash.
      4. If total demand > sleeve_b_capital: budget = min(total_demand,
         sleeve_b_capital * max_leverage). Fill tier1 first at full base
         size — pro-rate within tier1 only if tier1 alone exceeds budget.
         Then fill tier2 at full base — pro-rate within tier2 if it
         exceeds remaining budget. Then split the residual across tier3,
         per-name capped at the tier3 base size ($30K).
      5. gross_long never exceeds sleeve_b_capital * max_leverage.

    Returns a SleeveTarget with one TargetLine per filled name.
    """
    if sleeve_b_capital <= 0:
        return SleeveTarget(
            sleeve="B", capital_assigned=0, gross_long=0,
            leverage_used=0, idle_cash=0, leverage_ratio=0, lines=[],
        )

    # Step 0 + 1 — bucket
    buckets: dict[str, list[tuple]] = {"tier1": [], "tier2": [], "tier3": []}
    base_size_for_tier = {name: base for name, _, _, base in SLEEVE_B_TIER_BANDS}
    for sig in snapshot.signals:
        if sig.buy_score < SLEEVE_B_BUY_THRESHOLD:
            continue
        t = _tier_for(sig.buy_score)
        if t is None:
            continue
        tier_name, _ = t
        buckets[tier_name].append((sig.ticker, sig.buy_score, sig.mt_score, sig.band))

    # Step 2 — deterministic sort within each tier
    for tier_name in buckets:
        buckets[tier_name].sort(key=lambda x: (-x[1], x[0]))

    # Step 3 — fast path: no leverage needed
    leverage_cap = sleeve_b_capital * max_leverage
    total_demand = (
        len(buckets["tier1"]) * base_size_for_tier["tier1"]
        + len(buckets["tier2"]) * base_size_for_tier["tier2"]
        + len(buckets["tier3"]) * base_size_for_tier["tier3"]
    )

    lines: list[TargetLine] = []

    def _line(ticker: str, score: float, mt: float, band: str, notional: float,
              tier_name: str, prorated: bool) -> TargetLine:
        rationale = (
            f"Scanner tier {tier_name[-1]} ({band}, buy-score {score:.1f} / "
            f"raw {mt:+.0f}); base size ${base_size_for_tier[tier_name]:,.0f}"
            + (" — pro-rated within tier" if prorated else "")
        )
        return TargetLine(sleeve="B", ticker=ticker, notional=round(notional, 2),
                          rationale=rationale, score=score)

    if total_demand <= sleeve_b_capital:
        # No leverage needed — fill all at full base size
        for tier_name in ("tier1", "tier2", "tier3"):
            base = base_size_for_tier[tier_name]
            for ticker, score, mt, band in buckets[tier_name]:
                lines.append(_line(ticker, score, mt, band, base, tier_name, prorated=False))
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

    # Step 4 — overflow → budget capped at leverage_cap
    budget = min(total_demand, leverage_cap)
    remaining = budget

    # Tier 1
    t1_demand = len(buckets["tier1"]) * base_size_for_tier["tier1"]
    if t1_demand <= remaining:
        for ticker, score, mt, band in buckets["tier1"]:
            lines.append(_line(ticker, score, mt, band,
                               base_size_for_tier["tier1"], "tier1", prorated=False))
        remaining -= t1_demand
    else:
        per = remaining / len(buckets["tier1"]) if buckets["tier1"] else 0.0
        for ticker, score, mt, band in buckets["tier1"]:
            lines.append(_line(ticker, score, mt, band, per, "tier1", prorated=True))
        remaining = 0.0

    # Tier 2
    if remaining > 0.0:
        t2_demand = len(buckets["tier2"]) * base_size_for_tier["tier2"]
        if t2_demand <= remaining:
            for ticker, score, mt, band in buckets["tier2"]:
                lines.append(_line(ticker, score, mt, band,
                                   base_size_for_tier["tier2"], "tier2", prorated=False))
            remaining -= t2_demand
        else:
            per = remaining / len(buckets["tier2"]) if buckets["tier2"] else 0.0
            for ticker, score, mt, band in buckets["tier2"]:
                lines.append(_line(ticker, score, mt, band, per, "tier2", prorated=True))
            remaining = 0.0

    # Tier 3 — share remainder, never more than base size per name
    if remaining > 0.0 and buckets["tier3"]:
        per_raw = remaining / len(buckets["tier3"])
        per = min(base_size_for_tier["tier3"], per_raw)
        prorated = per < base_size_for_tier["tier3"]
        for ticker, score, mt, band in buckets["tier3"]:
            lines.append(_line(ticker, score, mt, band, per, "tier3", prorated=prorated))

    gross = sum(l.notional for l in lines)
    # Floating-point guard: never report gross_long > leverage_cap
    if gross > leverage_cap + 0.01:
        # Scale down all tier3 lines proportionally to fit exactly
        overflow = gross - leverage_cap
        t3_lines = [l for l in lines if l.score is not None and l.score < SLEEVE_B_TIER_BANDS[1][1]]
        if t3_lines:
            t3_total = sum(l.notional for l in t3_lines)
            if t3_total > 0:
                shrink_factor = max(0.0, (t3_total - overflow) / t3_total)
                # Rebuild lines with shrunk tier3
                new_lines = []
                for l in lines:
                    if l in t3_lines:
                        new_lines.append(TargetLine(
                            sleeve=l.sleeve, ticker=l.ticker,
                            notional=round(l.notional * shrink_factor, 2),
                            rationale=l.rationale + " (final cap-fit shrink)",
                            score=l.score,
                        ))
                    else:
                        new_lines.append(l)
                lines = new_lines
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
