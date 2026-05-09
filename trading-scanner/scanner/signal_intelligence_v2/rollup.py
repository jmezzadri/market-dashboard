"""
Signal Intelligence rollup — combines the 5 Signals into the headline metric.

Computes Magnitude → Conviction → MacroTilt Score → 8-band classification.
Reads from a calibration table (placeholder values shipped here; Phase E
back-test will replace with real numbers and pin the result to JSON).

The page renders three numbers per name:

    Magnitude        — weighted average of 5 Signals, range −100..+100
    Expected excess  — calibrated lookup of (Magnitude → 21-day excess vs SPY)
    Conviction       — calibrated probability lookup, range 50..100 (50 = coin flip)

And the headline:

    MacroTilt Score = Magnitude × (Conviction% − 50%) / 50

Bands fire on MT Score per the 8-band scheme (Joe 2026-05-08):

    +75..+100  Buy Signal
    +50..+75   Strong Bullish
    +25..+50   Moderate Bullish
      0..+25   Weak Bullish
    −25..0     Weak Bearish
    −50..−25   Moderate Bearish
    −75..−50   Strong Bearish
   −100..−75   Sell Trigger

The placeholder calibration in this module is illustrative-monotonic;
real numbers are produced by Phase E and pinned to:
    public/calibration_v2_magnitude_to_return.json
    public/calibration_v2_conviction_table.json
    public/calibration_v2_bands.json

This module reads calibration as a dict argument; default is the placeholder.
"""

from __future__ import annotations

from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# v2 starting weights (Phase D will refit from data)
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_WEIGHTS: dict[str, float] = {
    "insider":    0.35,   # 30% in spec table + 5% reallocated from dropped Dark Pool
    "technicals": 0.25,
    "options":    0.20,
    "analyst":    0.15,
    "congress":   0.05,
}
# Dark Pool dropped per A6 (Zhu 2014: dark pools attract uninformed flow).
# Its 5% reallocated to Insider — strongest academic foundation per A1.
# Weights sum to 1.0 (verified by test_default_weights_sum_to_one).

SIGNAL_KEYS = list(DEFAULT_WEIGHTS.keys())

# ─────────────────────────────────────────────────────────────────────────────
# 8-band cutoffs (Joe's 25-point grid — Phase E may adjust)
# ─────────────────────────────────────────────────────────────────────────────

BAND_CUTOFFS: list[tuple[int, str]] = [
    ( 75, "Buy Signal"),
    ( 50, "Strong Bullish"),
    ( 25, "Moderate Bullish"),
    (  0, "Weak Bullish"),
    (-25, "Weak Bearish"),
    (-50, "Moderate Bearish"),
    (-75, "Strong Bearish"),
    (-101, "Sell Trigger"),  # catches anything below -75
]

# ─────────────────────────────────────────────────────────────────────────────
# Placeholder calibration (Phase E replaces with real back-test stats)
#
# 2-D Conviction table — indexed by (agreement_pct_bucket, abs_magnitude).
# Each cell = empirical hit rate (% of historical names with that profile
# that beat SPY in the directional sense over 21 days).
#
# These numbers are MONOTONIC by construction (higher Magnitude → higher
# Conviction; higher Agreement → higher Conviction). The Phase E back-test
# will produce real numbers — these placeholders just let the producer run
# end-to-end and let the page render reasonable-looking previews before
# the back-test ships.
# ─────────────────────────────────────────────────────────────────────────────

PLACEHOLDER_CONVICTION_TABLE: dict[int, list[tuple[int, float]]] = {
    # agreement_pct_bucket : [(abs_magnitude, conviction_pct), ...]
    100: [(0, 55), (25, 65), (50, 75), (75, 88), (100, 92)],
    80:  [(0, 53), (25, 60), (50, 70), (75, 80), (100, 85)],
    60:  [(0, 51), (25, 58), (50, 65), (75, 72), (100, 76)],
    40:  [(0, 50), (25, 55), (50, 60), (75, 65), (100, 68)],
    20:  [(0, 50), (25, 52), (50, 55), (75, 58), (100, 60)],
}

# Magnitude → average historical 21-day excess return vs SPY (placeholder)
PLACEHOLDER_EXCESS_RETURN_CURVE: list[tuple[int, float]] = [
    (-100, -5.5), (-75, -4.0), (-50, -2.5), (-25, -1.0),
    (0, 0.0),
    (25, 1.0), (50, 2.5), (75, 4.0), (100, 5.5),
]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _interp(x: float, curve: list[tuple[float, float]]) -> float:
    """Piecewise-linear interpolation on a sorted [(x, y)] curve."""
    sc = sorted(curve, key=lambda p: p[0])
    if x <= sc[0][0]:
        return sc[0][1]
    if x >= sc[-1][0]:
        return sc[-1][1]
    for i in range(len(sc) - 1):
        x0, y0 = sc[i]
        x1, y1 = sc[i + 1]
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 != x0 else y0
    return sc[-1][1]


def _band(mt_score: int) -> str:
    """Return the 8-band label for an MT Score in [−100, +100]."""
    for cutoff, label in BAND_CUTOFFS:
        if mt_score >= cutoff:
            return label
    return "Sell Trigger"


def _agreement_bucket(agreement_pct: float) -> int:
    """Map an agreement % to the nearest calibration bucket key (20/40/60/80/100)."""
    buckets = sorted(PLACEHOLDER_CONVICTION_TABLE.keys())
    return min(buckets, key=lambda b: abs(b - agreement_pct))


def _conviction_lookup(
    agreement_pct: float,
    abs_magnitude: float,
    table: dict[int, list[tuple[int, float]]],
) -> float:
    """Look up Conviction% from a 2-D (agreement, |magnitude|) calibration."""
    bucket = _agreement_bucket(agreement_pct)
    curve = table.get(bucket, table[min(table.keys())])
    return _interp(abs_magnitude, curve)


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def compute_signal_intelligence(
    insider: int | None = None,
    options: int | None = None,
    analyst: int | None = None,
    congress: int | None = None,
    technicals: int | None = None,
    weights: dict[str, float] | None = None,
    conviction_table: dict[int, list[tuple[int, float]]] | None = None,
    excess_return_curve: list[tuple[int, float]] | None = None,
) -> dict[str, Any]:
    """
    Compute the full Signal Intelligence rollup for one ticker.

    Returns:
        {
            "signals":               {"insider": 80, "options": 44, ...},
            "magnitude":             68 | None,
            "expected_excess_pct_21d": 2.8 | None,
            "agreement_pct":         100.0 | None,
            "conviction_pct":        78.0 | None,
            "conviction_direction":  "bullish" / "bearish" / "neutral",
            "mt_score":              38 | None,
            "band":                  "Moderate Bullish" / ... / "No Data",
            "weights_used":          {...},
        }
    """
    weights = weights or DEFAULT_WEIGHTS
    conviction_table = conviction_table or PLACEHOLDER_CONVICTION_TABLE
    excess_curve = excess_return_curve or PLACEHOLDER_EXCESS_RETURN_CURVE

    signals = {
        "insider":    insider,
        "options":    options,
        "analyst":    analyst,
        "congress":   congress,
        "technicals": technicals,
    }

    # ── Magnitude: weighted average of non-null Signals ───────────────────────
    weighted_sum = 0.0
    weight_used = 0.0
    non_null = []
    for key in SIGNAL_KEYS:
        score = signals.get(key)
        if score is None:
            continue
        w = float(weights.get(key, 0))
        weighted_sum += score * w
        weight_used += w
        non_null.append((key, score))

    if weight_used <= 0:
        return {
            "signals": signals,
            "magnitude": None,
            "expected_excess_pct_21d": None,
            "agreement_pct": None,
            "conviction_pct": None,
            "conviction_direction": "neutral",
            "mt_score": None,
            "band": "No Data",
            "weights_used": weights,
        }

    magnitude_raw = weighted_sum / weight_used
    magnitude = int(round(_clamp(magnitude_raw, -100.0, 100.0)))
    mag_sign = 1 if magnitude > 0 else (-1 if magnitude < 0 else 0)

    # ── Agreement: % of non-null Signals with same sign as Magnitude ──────────
    if mag_sign == 0:
        agreement_pct = 50.0
    else:
        same_sign = sum(
            1 for _, s in non_null
            if (s > 0 and mag_sign > 0) or (s < 0 and mag_sign < 0)
        )
        agreement_pct = 100.0 * same_sign / len(non_null) if non_null else 50.0

    # ── Conviction: 2-D lookup from calibration table ─────────────────────────
    conviction_pct = _conviction_lookup(
        agreement_pct, abs(magnitude), conviction_table
    )

    if mag_sign > 0:
        direction = "bullish"
    elif mag_sign < 0:
        direction = "bearish"
    else:
        direction = "neutral"

    # ── MacroTilt Score = Magnitude × (Conviction% − 50) / 50 ─────────────────
    mt_score_raw = magnitude * (conviction_pct - 50.0) / 50.0
    mt_score = int(round(_clamp(mt_score_raw, -100.0, 100.0)))

    band = _band(mt_score)

    # ── Expected excess return — calibrated curve lookup ──────────────────────
    expected_excess = _interp(magnitude, excess_curve)

    return {
        "signals": signals,
        "magnitude": magnitude,
        "expected_excess_pct_21d": round(expected_excess, 2),
        "agreement_pct": round(agreement_pct, 1),
        "conviction_pct": round(conviction_pct, 1),
        "conviction_direction": direction,
        "mt_score": mt_score,
        "band": band,
        "weights_used": dict(weights),
    }
