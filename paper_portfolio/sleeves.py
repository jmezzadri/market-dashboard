"""
paper_portfolio.sleeves — pure functions that compute target positions.

Both sleeve targets are computed in dollars-of-notional, NOT shares. The
diff layer (diff.py / momentum.py) converts notional → shares at the time
the order is built, using the EOD close, so this module stays deterministic
and unit-testable without a live price feed.

  * Sleeve B — Insider Conviction. EQUAL-WEIGHT, FULL-CAPITAL (Joe decision
                2026-07-15): the sleeve always deploys 100% of its capital,
                split equally across every qualifying name ($500K ÷ N).
                N = names at/above the buy line (score ≥ 4) PLUS held names
                still above the exit floor (score ≥ 3, hysteresis holds).
                1 name → $500K. 3 names → ~$167K each. 10 names → $50K each.
                No idle cash by design; no leverage; long-only.

  * Sleeve M — Momentum, driven by the POWER TREND signal (Joe decision
                2026-07-15, replacing 12-1 momentum + Faber guard). Owns the
                current monthly power_trend_list equal-weight, capped at 15
                names by the producer. MIN-8 DIVERSIFICATION FLOOR: sizing
                divides by max(N, 8) so fewer than 8 firing names leaves the
                unfilled slots in cash rather than concentrating the sleeve.
                A CASH-sentinel publish (zero names fired) → all cash.

Senior Quant owns this file. Any edit requires backtest re-run
(Power_Trend_Breakout_Simulation.xlsx is the Policy-A record for sleeve M).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from paper_portfolio.config import (
    SLEEVE_B_BUY_THRESHOLD,
    SLEEVE_B_EXIT_THRESHOLD,
    SLEEVE_M_MIN_NAMES_FLOOR,
)
from paper_portfolio.signals import EquityScannerSnapshot


# ─────────────────────────────────────────────────────────────────────────────
# Target dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TargetLine:
    sleeve: str              # 'B' or 'M'
    ticker: str
    notional: float          # dollar notional to hold long; 0 means "exit"
    rationale: str           # plain-English so-what for audit + UI
    score: float | None = None  # buy_score for Sleeve B; None for Sleeve M


@dataclass(frozen=True)
class SleeveTarget:
    sleeve: str
    capital_assigned: float          # cash cap for this sleeve (e.g. $500K)
    gross_long: float                # sum of TargetLine.notional
    leverage_used: float             # max(0, gross_long - capital_assigned)
    idle_cash: float                 # max(0, capital_assigned - gross_long)
    leverage_ratio: float            # gross_long / capital_assigned
    lines: list[TargetLine] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve B — Insider Conviction, equal-weight / full-capital
# ─────────────────────────────────────────────────────────────────────────────

def build_sleeve_b_target(
    snapshot: EquityScannerSnapshot,
    sleeve_b_capital: float,
    held_tickers: set[str] | None = None,
    exit_threshold: float = SLEEVE_B_EXIT_THRESHOLD,
    max_leverage: float = 1.0,  # kept for call-compat; never levered
) -> SleeveTarget:
    """EQUAL-WEIGHT, FULL-CAPITAL target (Joe decision 2026-07-15).

    The qualifying set Q =
        {scanned names with buy_score >= buy threshold (4)}
      ∪ {held names whose current score is still >= exit floor (3)}
    (the second set is the hysteresis: a name bought at 5 that decays to 3.4
    is still held, and still owns its equal-weight slot).

    Every name in Q gets notional = capital / N. The sleeve deploys 100% of
    capital whenever N >= 1 — no idle cash, no leverage, long-only.

    Worked example (Senior Quant, checked by hand 2026-07-15):
      capital $500,000, scan shows RH/GGAL/AVO at score 5, nothing held →
      N = 3, per-name = $166,666.67, gross $500,000.00, idle $0.
      If a 4th name is held at score 3.5 → N = 4, per-name = $125,000.00.

    Resizing of already-held names to the new per-name target is decided in
    diff.py against COST BASIS with a tolerance band, so pure price drift
    never trades (signal-only discipline preserved).
    """
    held = {t.upper() for t in (held_tickers or set())}
    if sleeve_b_capital <= 0:
        return SleeveTarget(sleeve="B", capital_assigned=0, gross_long=0,
                            leverage_used=0, idle_cash=0, leverage_ratio=0, lines=[])

    scores = {s.ticker.upper(): s.buy_score for s in snapshot.signals}
    # signals already filtered to >= buy threshold upstream, but re-assert:
    entries = {t for t, sc in scores.items() if sc >= SLEEVE_B_BUY_THRESHOLD}
    holds = {t for t in held
             if (snapshot.scores_by_ticker or {}).get(t) is not None
             and snapshot.scores_by_ticker[t] >= exit_threshold}
    qualifying = sorted(entries | holds)

    n = len(qualifying)
    if n == 0:
        return SleeveTarget(sleeve="B", capital_assigned=sleeve_b_capital,
                            gross_long=0, leverage_used=0,
                            idle_cash=sleeve_b_capital, leverage_ratio=0, lines=[])

    # floor to the cent so N × per_name never exceeds capital (no leverage)
    per_name = int(sleeve_b_capital * 100 / n) / 100.0
    lines: list[TargetLine] = []
    for t in qualifying:
        sc = scores.get(t, (snapshot.scores_by_ticker or {}).get(t))
        lines.append(TargetLine(
            sleeve="B", ticker=t, notional=per_name,
            rationale=(f"Equal-weight full-capital: ${sleeve_b_capital:,.0f} ÷ {n} "
                       f"qualifying names = ${per_name:,.0f} "
                       f"(score {sc:.1f}; enter ≥4, hold ≥3)" if sc is not None else
                       f"Equal-weight full-capital: ${sleeve_b_capital:,.0f} ÷ {n} "
                       f"= ${per_name:,.0f}"),
            score=sc,
        ))

    gross = round(per_name * n, 2)
    return SleeveTarget(
        sleeve="B",
        capital_assigned=sleeve_b_capital,
        gross_long=gross,
        leverage_used=0.0,
        idle_cash=round(max(0.0, sleeve_b_capital - gross), 2),
        leverage_ratio=(gross / sleeve_b_capital) if sleeve_b_capital else 0.0,
        lines=lines,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve M — Power Trend (2026-07-15 swap; replaces 12-1 momentum + guard)
# Equal-weight the current monthly power_trend_list with a min-8 floor:
# per-name = capital / max(N, 8). Producer caps the list at 15 names.
# Math validated in Power_Trend_Breakout_Simulation.xlsx (2020–2026 sim,
# 8-name floor: 18.2%/yr vs SPY 14.8%, Sharpe 1.26, MaxDD −19.7%).
# ─────────────────────────────────────────────────────────────────────────────

def build_momentum_target(snapshot, capital: float) -> SleeveTarget:
    """Power Trend sleeve target: capital / max(N, 8) per name, long-only,
    no leverage. All-cash publish (CASH sentinel) → zero lines.

    `snapshot` is a momentum.PowerTrendSnapshot (duck-typed: .entries with
    .ticker/.rank/.roc_3m, .all_cash, .rebalance_date).

    Worked example (Senior Quant, checked by hand 2026-07-15):
      14-name list, $500K → $35,714.29 per name, gross $500,000.06→
      rounded per-line 35714.29×14 = $500,000.06; builder clamps gross to
      capital by flooring the per-name cent (35_714.28 × 14 = $499,999.92,
      idle $0.08). 3-name list → $500K / max(3,8) = $62,500 per name,
      gross $187,500, idle cash $312,500 (min-8 floor: never concentrate).
    """
    entries = [] if (capital <= 0 or getattr(snapshot, "all_cash", False)) \
        else list(snapshot.entries)
    if capital <= 0 or not entries:
        return SleeveTarget(sleeve="M", capital_assigned=max(capital, 0), gross_long=0,
                            leverage_used=0, idle_cash=max(capital, 0),
                            leverage_ratio=0, lines=[])
    n = len(entries)
    slots = max(n, SLEEVE_M_MIN_NAMES_FLOOR)
    # floor to the cent so N × per_name never exceeds capital
    per_name = int(capital * 100 / slots) / 100.0
    lines = [
        TargetLine(
            sleeve="M", ticker=e.ticker, notional=per_name,
            rationale=(f"Power Trend rank {e.rank}/{n} (3-mo return {e.roc_3m:+.1f}%), "
                       f"equal-weight ${per_name:,.0f} of the {snapshot.rebalance_date} list"
                       + (f" — {slots - n} of {slots} slots in cash (min-8 floor)"
                          if n < slots else "")),
            score=None,
        )
        for e in entries
    ]
    gross = round(per_name * n, 2)
    return SleeveTarget(
        sleeve="M", capital_assigned=capital, gross_long=gross,
        leverage_used=0.0, idle_cash=round(max(0.0, capital - gross), 2),
        leverage_ratio=gross / capital, lines=lines,
    )
