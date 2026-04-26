"""
narrative.templates — core helpers for prose generation.

These are the small, reusable building blocks that the rationale / headline /
themes / risks modules use to compose sentences. Every helper has tests.

Design principles:
  - Plain English, no jargon — every quant term gets a one-line gloss.
  - Conservative — when in doubt, the helper says less rather than more.
  - Numerical guards — divide-by-zero, NaN, sentinel values handled explicitly.
  - Deterministic — same input → same output, byte-for-byte.
"""

from __future__ import annotations

import math
from typing import Any


# ──────────────────────────────────────────────────────────────────────────
# Composite labels
# ──────────────────────────────────────────────────────────────────────────


def label_rl(value: float) -> str:
    """Plain-English label for the Risk & Liquidity composite.

    Boundary at 0 — negative readings are calm/supportive; positive readings
    are neutral-to-stressed depending on magnitude. Aligns with the v9
    de-risk thresholds (>20 = start scaling defensive, >50 = max defensive).
    """
    if value < 0:    return "calm"
    if value <= 20:  return "neutral"
    if value <= 30:  return "elevated"
    if value <= 50:  return "stressed"
    return "extreme"


def label_growth(value: float) -> str:
    """Plain-English label for the Growth composite.

    Negative = supportive (low stress on growth); positive = weakening or
    contracting depending on magnitude.
    """
    if value < 0:    return "supportive"
    if value <= 25:  return "neutral"
    if value <= 50:  return "weakening"
    return "contracting"


def label_ir(value: float) -> str:
    """Plain-English label for the Inflation & Rates composite.

    Negative = cool/supportive for risk assets; positive = neutral to hot.
    """
    if value < 0:    return "cool"
    if value <= 25:  return "neutral"
    if value <= 50:  return "hot"
    return "overheating"


# ──────────────────────────────────────────────────────────────────────────
# Direction / magnitude phrases for indicator changes
# ──────────────────────────────────────────────────────────────────────────


def direction_phrase(change: float, magnitude_threshold: float = 0.0) -> str:
    """'rising' / 'falling' / 'flat' depending on sign of change.

    Below magnitude_threshold returns 'flat' regardless of sign.
    """
    if math.isnan(change) or abs(change) <= magnitude_threshold:
        return "flat"
    return "rising" if change > 0 else "falling"


def magnitude_phrase(zscore: float) -> str:
    """'modestly' / 'meaningfully' / 'sharply' / 'extremely' from |z|."""
    az = abs(zscore)
    if az < 0.5:  return "modestly"
    if az < 1.5:  return "meaningfully"
    if az < 2.5:  return "sharply"
    return "extremely"


def comparison_phrase(current: float, baseline: float) -> str:
    """'above' / 'below' / 'in line with' the baseline. Tolerance is 5% of
    baseline magnitude."""
    if math.isnan(current) or math.isnan(baseline):
        return "comparable to"
    if baseline == 0:
        if abs(current) < 0.01: return "in line with"
        return "above" if current > 0 else "below"
    diff = current - baseline
    tol = abs(baseline) * 0.05
    if abs(diff) <= tol:
        return "in line with"
    return "above" if diff > 0 else "below"


# ──────────────────────────────────────────────────────────────────────────
# Composite trend phrases
# ──────────────────────────────────────────────────────────────────────────


def trend_phrase(value: float, change: float, threshold: float = 5.0) -> str:
    """How a composite reading is trending — 'improving' / 'deteriorating' /
    'stable'.

    Improvement = composite is moving toward calm (negative for R&L,
    Growth, Inflation & Rates — all use the convention that higher = more
    stress).
    """
    if math.isnan(change) or abs(change) < threshold:
        return "stable"
    return "deteriorating" if change > 0 else "improving"


# ──────────────────────────────────────────────────────────────────────────
# Number formatting — keep these consistent across all narrative
# ──────────────────────────────────────────────────────────────────────────


def fmt_pct(value: float, decimals: int = 1) -> str:
    """Format as percent with sign, e.g. '+2.5%' / '-3.0%'."""
    if math.isnan(value):
        return "n/a"
    return f"{value*100:+.{decimals}f}%"


def fmt_pp(value: float, decimals: int = 1) -> str:
    """Format as percentage points (already in pp), e.g. '+2.5pp'."""
    if math.isnan(value):
        return "n/a"
    return f"{value:+.{decimals}f}pp"


def fmt_bp(value: float, decimals: int = 0) -> str:
    """Format as basis points, e.g. '50 bps'."""
    if math.isnan(value):
        return "n/a"
    return f"{value:+.{decimals}f} bps"


def fmt_index(value: float, decimals: int = 1) -> str:
    """Format as a plain index level, e.g. '18.5'."""
    if math.isnan(value):
        return "n/a"
    return f"{value:.{decimals}f}"


# ──────────────────────────────────────────────────────────────────────────
# Sentence assembly
# ──────────────────────────────────────────────────────────────────────────


def join_sentence(*clauses: str, separator: str = " ") -> str:
    """Join clauses, filter out empty/None, ensure proper spacing.

    Used by templates that assemble sentences from optional clauses."""
    parts = [c.strip() for c in clauses if c and c.strip()]
    return separator.join(parts)


def sentence_case(text: str) -> str:
    """Capitalize the first letter of a sentence; preserve the rest."""
    if not text:
        return ""
    return text[0].upper() + text[1:]


def truncate(text: str, max_chars: int = 280) -> str:
    """Truncate a paragraph at max_chars, preserving word boundaries."""
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    space = cut.rfind(" ")
    if space > 0:
        cut = cut[:space]
    return cut.rstrip(".,;: ") + "…"
