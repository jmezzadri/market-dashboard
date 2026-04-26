"""
narrative.headline — top-level macro narrative paragraphs.

Generates the 3 paragraphs at the top of the page:
  1. Composite snapshot — what the three macro composites are reading.
  2. Leading indicators — what specific factors are firing.
  3. Implications — what this regime tilts the allocation toward.

Plus the one-line headline in headline.narrative ("April 2026 — ...").

Inputs: regime dict (composite values + 3-mo changes), bucket ratings,
selected themes, stance.

Output: list[str] of paragraphs + the one-line headline.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .templates import (
    label_rl, label_growth, label_ir,
    trend_phrase, fmt_index, fmt_pp, sentence_case,
)


def headline_one_liner(as_of: str, stance_label: str, top_themes: list[str]) -> str:
    """One-line headline at the top of the page.

    Examples:
      "April 2026 — Aggressive equity tilt; AI infrastructure and energy discipline driving allocation."
      "March 2009 — Defensive bucket activated; recovering from Risk & Liquidity stress."
      "October 2008 — Maximum defensive positioning amid GFC-level stress."
    """
    month_label = _month_label(as_of)
    stance_phrase = {
        "Aggressive": "aggressive equity tilt",
        "Balanced": "balanced equity allocation",
        "Defensive": "defensive bucket activated",
        "Recovering": "recovering posture, indicator-driven picks",
    }.get(stance_label, "neutral allocation")

    if top_themes:
        themes = " and ".join(top_themes[:2]).lower()
        return sentence_case(f"{month_label} — {stance_phrase}; {themes} driving allocation.")
    return sentence_case(f"{month_label} — {stance_phrase}.")


def composite_snapshot_paragraph(regime: dict) -> str:
    """Paragraph 1 — what the three composites are saying."""
    rl = regime.get("risk_liquidity", 0.0)
    gr = regime.get("growth", 0.0)
    ir = regime.get("inflation_rates", 0.0)
    rl_change = regime.get("rl_3mo_change", 0.0)

    rl_label = label_rl(rl)
    gr_label = label_growth(gr)
    ir_label = label_ir(ir)
    rl_trend = trend_phrase(rl, rl_change)

    sentence = (
        f"Macro composites read {rl_label} on Risk & Liquidity ({fmt_index(rl)}), "
        f"{gr_label} on Growth ({fmt_index(gr)}), and {ir_label} on Inflation & "
        f"Rates ({fmt_index(ir)})."
    )

    if rl_trend != "stable":
        sentence += (
            f" Risk & Liquidity has been {rl_trend} over the past three months "
            f"({fmt_pp(rl_change)} change)."
        )

    if regime.get("regime_flip_active"):
        sentence += (
            " The model has detected a regime flip from stress to recovery — "
            "momentum signal is being overridden in favor of indicator-driven picks."
        )

    return sentence


def implications_paragraph(stance_label: str, n_most_favored: int,
                            n_least_favored: int, defensive_active: bool) -> str:
    """Paragraph 3 — what this regime tilts the allocation toward."""
    parts = []

    if stance_label == "Aggressive":
        parts.append(
            "The regime supports an aggressive posture: equity sleeve fully invested "
            "with leverage above 1.0x."
        )
    elif stance_label == "Balanced":
        parts.append(
            "The regime supports a balanced posture: fully invested in equities "
            "without leverage and without defensive activation."
        )
    elif stance_label == "Defensive":
        parts.append(
            "The regime calls for a defensive posture: a portion of the portfolio "
            "rotates into cash, long Treasuries, gold, and investment-grade bonds."
        )
    elif stance_label == "Recovering":
        parts.append(
            "The regime is in transition: indicator signals lead momentum during "
            "the recovery, with the strategy positioning ahead of the price action."
        )

    if n_most_favored > 0 or n_least_favored > 0:
        parts.append(
            f"The model rates {n_most_favored} industry group{'s' if n_most_favored != 1 else ''} as Most Favored "
            f"and {n_least_favored} as Least Favored within the equity universe."
        )

    if defensive_active:
        parts.append(
            "Defensive bucket weights reflect the dominant stress signal — cash "
            "for liquidity stress, long Treasuries for growth weakness, gold for "
            "inflation hedging, investment-grade bonds for credit recovery."
        )

    return " ".join(parts)


def macro_narrative(regime: dict, ratings_by_tier: dict[str, list[dict]],
                    stance: dict, themes: list[dict] | None = None) -> list[str]:
    """Generate the full 2-3 paragraph macro narrative for the headline.

    Returns list[str] — currently 2 paragraphs (composite snapshot +
    implications). Paragraph 2 (leading indicators) lives in
    Phase 4.5 once the per-factor reading data is wired through.
    """
    n_most_favored = len(ratings_by_tier.get("most_favored", []))
    n_least_favored = len(ratings_by_tier.get("least_favored", []))
    defensive_active = stance.get("label") == "Defensive"

    return [
        composite_snapshot_paragraph(regime),
        implications_paragraph(stance.get("label", "Balanced"),
                                n_most_favored, n_least_favored, defensive_active),
    ]


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def _month_label(as_of_date: str) -> str:
    """Convert YYYY-MM-DD to 'Month YYYY' for headlines."""
    try:
        dt = datetime.strptime(as_of_date, "%Y-%m-%d")
        return dt.strftime("%B %Y")
    except (ValueError, TypeError):
        return as_of_date
