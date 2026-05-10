"""
Composite MT Score — Signal Intelligence v5 Phase 2.

Blends the six v5 sub-scores (Insider / Options / Congress / Technicals /
Analyst / Short Interest) into a single MacroTilt Score in [-100, +100],
then assigns one of five bidirectional bands.

Joe's locked v5 methodology:

    Equal-weight v1     Each of the six signals contributes ~16.7% (1/6).

    Cap-discount        ONLY the Insider weight is haircut by market cap.
                        Linear in log10 space:
                            log10($500M)  = 8.6990 -> factor 1.00
                            log10($50B)   = 10.6990 -> factor 0.50
                            log10($500B)  = 11.6990 -> factor 0.25
                        Below $500M, clamp at 1.00.
                        Above $500B, clamp at 0.25.
                        The reduced insider weight is redistributed
                        PRO-RATA across the other 5 signals so total
                        weights always sum to 1.0.

    None-handling       When a sub_score is None (no data for that
                        signal on that ticker / date), it is excluded
                        from the weighted denominator. NOT treated as
                        zero. Anchor: v2 rollup pattern.

    Bands               -100..-50  Strong Sell
                         -50..-20  Watch Sell
                         -20..+20  Neutral
                         +20..+50  Watch Buy
                         +50..+100 Strong Buy

    So-What             Plain-English 1-2 sentence summary derived
                        from which sub-scores are most extreme. Phase
                        2 ships a deterministic rules-based generator
                        (no LLM call).

Public API:

    compute_mt_score(ticker, score_date, market_cap=None) -> dict
    insider_weight_factor(market_cap) -> float
    assign_band(mt_score) -> str
    so_what_summary(mt_score, band, sub_scores) -> str

The full per-ticker dict shape returned by compute_mt_score is documented
on the function itself.

Phase 3 (backtest) will refit the weights with calibrated numbers; this
module accepts an optional `weights` override to support that.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any

from scanner.signal_intelligence_v5 import (
    analyst_score,
    congress_score,
    insider_score,
    options_score,
    short_interest_score,
    technicals_score,
)


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

SIGNAL_KEYS: list[str] = [
    "insider",
    "options",
    "congress",
    "technicals",
    "analyst",
    "short_interest",
]

# Equal-weight v1 (original Phase 2 default).
EQUAL_WEIGHTS: dict[str, float] = {k: 1.0 / 6.0 for k in SIGNAL_KEYS}

# Phase 3 calibrated weights (Run C-floored), derived from per-signal
# bullish + bearish alpha × hit-rate calibration on the 52-week 2025-05
# to 2026-05 walk-forward, with a 1/6 baseline floor preserved for
# signals that did not have enough historical data to score.
# See V5_BACKTEST_REPORT_2026-05-10.md Section 5 for the math.
DEFAULT_WEIGHTS: dict[str, float] = {
    "insider":        0.3630,   # 36.30% — best signal: +7.18% alpha when strong, 61% hit rate
    "options":        0.1667,   # 16.67% — 1/6 floor (historical data only on 2026-05-10)
    "congress":       0.1667,   # 16.67% — 1/6 floor (only 13 strong-signal obs across the year)
    "technicals":     0.0869,   # 8.69%  — calibrated: +3.42% alpha when strong, 56% hit rate
    "analyst":        0.0500,   # 5.00%  — calibrated: +1.65% alpha when strong, 56.6% hit rate
    "short_interest": 0.1667,   # 16.67% — 1/6 floor (only 93 tickers populated)
}

# Insider cap-discount anchors (per Joe's locked spec).
CAP_DISCOUNT_FLOOR_USD = 500_000_000      # below this -> factor 1.00
CAP_DISCOUNT_CEILING_USD = 500_000_000_000  # above this -> factor 0.25
CAP_DISCOUNT_SLOPE_PER_LOG = 0.25         # factor drops 0.25 per log10 unit

# Band cutoffs — strict numeric boundaries (upper-exclusive except top band).
# Joe's bidirectional 5-band scheme.
BAND_CUTOFFS: list[tuple[float, float, str]] = [
    (-100.0,  -50.0, "Strong Sell"),
    ( -50.0,  -20.0, "Watch Sell"),
    ( -20.0,   20.0, "Neutral"),
    (  20.0,   50.0, "Watch Buy"),
    (  50.0,  100.0, "Strong Buy"),
]

# Plain-English label for the "so what" generator.
SIGNAL_LABEL: dict[str, str] = {
    "insider":        "insider buying" ,
    "options":        "options flow",
    "congress":       "congress trades",
    "technicals":     "technicals",
    "analyst":        "analyst actions",
    "short_interest": "short interest",
}

SIGNAL_LABEL_NEG: dict[str, str] = {
    "insider":        "insider selling",
    "options":        "options flow",
    "congress":       "congress trades",
    "technicals":     "technicals",
    "analyst":        "analyst actions",
    "short_interest": "short interest",
}


# ─────────────────────────────────────────────────────────────────────────────
# Cap-discount math
# ─────────────────────────────────────────────────────────────────────────────

def insider_weight_factor(market_cap: float | None) -> float:
    """
    Return the insider-weight cap-discount factor for `market_cap` (USD).

    At $500M: 1.00. At $50B: 0.50. At $500B: 0.25.
    Linear in log10 space:
        log10($500M)  = 8.6990 -> factor 1.00
        log10($50B)   = 10.6990 -> factor 0.50
        log10($500B)  = 11.6990 -> factor 0.25

    Implementation: a single piecewise-linear function with slope
    -0.25 per log10 unit between the two clamps. Verify against the
    three anchor checkpoints in the tests.

    Below $500M (or unknown cap): clamp at 1.00 (full weight).
    Above $500B: clamp at 0.25.
    """
    if market_cap is None or market_cap <= 0:
        return 1.0
    log_cap = math.log10(float(market_cap))
    log_floor = math.log10(CAP_DISCOUNT_FLOOR_USD)
    factor = 1.0 - CAP_DISCOUNT_SLOPE_PER_LOG * (log_cap - log_floor)
    return max(0.25, min(1.0, factor))


def _apply_cap_discount(
    base_weights: dict[str, float],
    insider_factor: float,
) -> dict[str, float]:
    """
    Apply the cap-discount: shrink insider weight by `insider_factor`,
    redistribute the freed weight pro-rata across the other 5 signals.

    Total weights always sum to 1.0 (within float epsilon).
    """
    insider_w = base_weights.get("insider", 0.0)
    new_insider_w = insider_w * insider_factor
    freed = insider_w - new_insider_w  # >= 0

    others = [k for k in SIGNAL_KEYS if k != "insider"]
    other_total = sum(base_weights.get(k, 0.0) for k in others)

    out: dict[str, float] = {"insider": new_insider_w}
    if other_total > 0:
        for k in others:
            share = base_weights.get(k, 0.0) / other_total
            out[k] = base_weights.get(k, 0.0) + freed * share
    else:
        for k in others:
            out[k] = base_weights.get(k, 0.0)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Band assignment
# ─────────────────────────────────────────────────────────────────────────────

def assign_band(mt_score: float | None) -> str:
    """
    Map an MT Score to its band label. None or NaN -> "Neutral" is wrong
    semantically; we return "No Data" to make the absence explicit. The
    composite caller never passes None here unless every sub-score was
    None.
    """
    if mt_score is None:
        return "No Data"
    s = float(mt_score)
    if math.isnan(s):
        return "No Data"
    # Boundary convention (matches Joe's spec table "-100 to -50",
    # "-50 to -20", etc. - lower-inclusive, upper-exclusive so every
    # boundary belongs to the LESS-EXTREME band):
    #   exactly -50 -> Watch Sell
    #   exactly -20 -> Neutral
    #   exactly +20 -> Watch Buy
    #   exactly +50 -> Strong Buy
    if s >= 50.0:
        return "Strong Buy"
    if s >= 20.0:
        return "Watch Buy"
    if s >= -20.0:
        return "Neutral"
    if s >= -50.0:
        return "Watch Sell"
    return "Strong Sell"


# ─────────────────────────────────────────────────────────────────────────────
# "So what" plain-English generator
# ─────────────────────────────────────────────────────────────────────────────

def _top_signals(sub_scores: dict[str, float | None], direction: str,
                 n: int = 2) -> list[tuple[str, float]]:
    """
    Return the top `n` non-null signals in the requested `direction`.
        direction="bullish" -> highest positive sub-scores
        direction="bearish" -> lowest negative sub-scores
    Ties broken by alphabetical key for determinism.
    """
    items = [(k, float(v)) for k, v in sub_scores.items() if v is not None]
    if direction == "bullish":
        items = [it for it in items if it[1] > 0]
        items.sort(key=lambda kv: (-kv[1], kv[0]))
    else:
        items = [it for it in items if it[1] < 0]
        items.sort(key=lambda kv: (kv[1], kv[0]))
    return items[:n]


def _label_pair(items: list[tuple[str, float]], direction: str) -> str:
    """Return 'X and Y' or 'X' from a list of (signal_key, sub_score)."""
    lookup = SIGNAL_LABEL if direction == "bullish" else SIGNAL_LABEL_NEG
    labels = [lookup[k] for k, _ in items]
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    return f"{labels[0]} and {labels[1]}"


def so_what_summary(mt_score: float | None, band: str,
                    sub_scores: dict[str, float | None]) -> str:
    """
    Build a 1-2 sentence plain-English summary explaining why this score
    is where it is. Deterministic, rules-based; no LLM call.

    Patterns:
      Strong Buy    Bullish on [top 2 +ve signals]. [Caveat if any <-30]
      Watch Buy     Tilting bullish - [top +ve], but [strongest -ve] complicates.
      Neutral       Mixed read - [what's bullish] vs [what's bearish].
                    (or "Quiet - no signal is firing meaningfully." if all near 0)
      Watch Sell    Tilting bearish - [top -ve], but [strongest +ve] complicates.
      Strong Sell   Bearish on [top 2 -ve signals]. [Caveat if any >+30]
    """
    if mt_score is None or band == "No Data":
        return "No signals firing - insufficient data on this name today."

    top_bull = _top_signals(sub_scores, "bullish", n=2)
    top_bear = _top_signals(sub_scores, "bearish", n=2)

    # Strongest single in each direction (for caveat / driver).
    strongest_bull = top_bull[0] if top_bull else None
    strongest_bear = top_bear[0] if top_bear else None

    if band == "Strong Buy":
        pair = _label_pair(top_bull, "bullish") or "broad signal strength"
        out = f"Bullish on {pair}."
        if strongest_bear and strongest_bear[1] < -30:
            out += f" Watch the {SIGNAL_LABEL_NEG[strongest_bear[0]]} drag, though."
        return out

    if band == "Strong Sell":
        pair = _label_pair(top_bear, "bearish") or "broad signal weakness"
        out = f"Bearish on {pair}."
        if strongest_bull and strongest_bull[1] > 30:
            out += f" Note the {SIGNAL_LABEL[strongest_bull[0]]} pushback."
        return out

    if band == "Watch Buy":
        driver = (
            SIGNAL_LABEL[strongest_bull[0]] if strongest_bull else "modest signal strength"
        )
        if strongest_bear and strongest_bear[1] < -20:
            return (
                f"Tilting bullish - {driver} leads, "
                f"but {SIGNAL_LABEL_NEG[strongest_bear[0]]} complicates."
            )
        return f"Tilting bullish - {driver} is the main driver."

    if band == "Watch Sell":
        driver = (
            SIGNAL_LABEL_NEG[strongest_bear[0]] if strongest_bear else "modest signal weakness"
        )
        if strongest_bull and strongest_bull[1] > 20:
            return (
                f"Tilting bearish - {driver} leads, "
                f"but {SIGNAL_LABEL[strongest_bull[0]]} complicates."
            )
        return f"Tilting bearish - {driver} is the main driver."

    # Neutral.
    has_bull = strongest_bull is not None and strongest_bull[1] >= 15
    has_bear = strongest_bear is not None and strongest_bear[1] <= -15
    if has_bull and has_bear:
        return (
            f"Mixed read - {SIGNAL_LABEL[strongest_bull[0]]} positive "
            f"vs {SIGNAL_LABEL_NEG[strongest_bear[0]]} negative."
        )
    if has_bull:
        return f"Mostly quiet - only {SIGNAL_LABEL[strongest_bull[0]]} leans positive."
    if has_bear:
        return f"Mostly quiet - only {SIGNAL_LABEL_NEG[strongest_bear[0]]} leans negative."
    return "Quiet - no signal is firing meaningfully."


# ─────────────────────────────────────────────────────────────────────────────
# Composite (pure)
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def compute_composite(
    sub_scores: dict[str, float | int | None],
    market_cap: float | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """
    Pure function: combine sub-scores into MT Score + band + so-what.

    Separated from compute_mt_score (which hits Supabase via scorers) so
    that tests can drive the math directly.

    Returns the same dict shape as compute_mt_score MINUS the "diagnostic"
    block (which is added by the I/O wrapper).
    """
    base = dict(weights or DEFAULT_WEIGHTS)
    factor = insider_weight_factor(market_cap)
    discounted = _apply_cap_discount(base, factor)

    # Walk the signals, applying weights only to non-null sub-scores.
    weighted_sum = 0.0
    weight_used = 0.0
    clean_subs: dict[str, float | None] = {}
    for k in SIGNAL_KEYS:
        v = sub_scores.get(k)
        if v is None:
            clean_subs[k] = None
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            clean_subs[k] = None
            continue
        clean_subs[k] = fv
        w = discounted.get(k, 0.0)
        weighted_sum += fv * w
        weight_used += w

    if weight_used <= 0:
        return {
            "mt_score": None,
            "band": "No Data",
            "sub_scores": clean_subs,
            "weights_used": discounted,
            "cap_discount_applied": factor,
            "so_what": "No signals firing - insufficient data on this name today.",
        }

    mt_raw = weighted_sum / weight_used
    mt_score = round(_clamp(mt_raw, -100.0, 100.0), 2)
    band = assign_band(mt_score)
    so_what = so_what_summary(mt_score, band, clean_subs)

    return {
        "mt_score": mt_score,
        "band": band,
        "sub_scores": clean_subs,
        "weights_used": discounted,
        "cap_discount_applied": factor,
        "so_what": so_what,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public I/O entry point — wires the six scorers + cap-discount + band.
# ─────────────────────────────────────────────────────────────────────────────

def compute_mt_score(
    ticker: str,
    score_date: date,
    market_cap: float | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """
    Compute the v5 MacroTilt composite for `ticker` on `score_date`.

    Args:
        ticker:       Symbol (case-insensitive).
        score_date:   As-of date for all six signal lookups.
        market_cap:   In USD. Used for the insider cap-discount.
                      None -> factor 1.00 (no discount).
        weights:      Optional override of equal-weight defaults
                      (Phase 3 uses this with calibrated weights).

    Returns:
        {
            "mt_score":              float in [-100, 100] (None if every sub_score is None),
            "band":                  one of {Strong Sell, Watch Sell, Neutral, Watch Buy, Strong Buy, No Data},
            "sub_scores":            {insider, options, congress, technicals, analyst, short_interest},
            "weights_used":          {same keys; sums to 1.0},
            "cap_discount_applied":  float in [0.25, 1.0] -- the insider haircut factor,
            "so_what":               plain-English summary string,
            "diagnostic": {
                "ticker":            str,
                "score_date":        "YYYY-MM-DD",
                "market_cap":        float | None,
                "scorer_diagnostics": {insider: {...}, ...},
            }
        }
    """
    ticker_u = ticker.upper()

    # Pull all six sub-scores. Each scorer returns
    # {sub_score, components, diagnostic}; we keep the diagnostics for
    # downstream debugging but only the sub_scores feed the composite.
    raw_results: dict[str, dict[str, Any]] = {
        "insider":        insider_score.score(ticker_u, score_date),
        "options":        options_score.score(ticker_u, score_date),
        "congress":       congress_score.score(ticker_u, score_date),
        "technicals":     technicals_score.score(ticker_u, score_date),
        "analyst":        analyst_score.score(ticker_u, score_date),
        "short_interest": short_interest_score.score(ticker_u, score_date),
    }
    sub_scores: dict[str, float | None] = {
        k: r.get("sub_score") for k, r in raw_results.items()
    }

    composite = compute_composite(sub_scores, market_cap=market_cap, weights=weights)

    diagnostic = {
        "ticker": ticker_u,
        "score_date": score_date.isoformat(),
        "market_cap": float(market_cap) if market_cap is not None else None,
        "scorer_diagnostics": {
            k: r.get("diagnostic") for k, r in raw_results.items()
        },
        "scorer_components": {
            k: r.get("components") for k, r in raw_results.items()
        },
    }
    composite["diagnostic"] = diagnostic
    return composite


# CLI: dump the composite for a ticker in JSON form.
if __name__ == "__main__":  # pragma: no cover
    import json
    import sys
    if len(sys.argv) < 2:
        print("Usage: python -m scanner.signal_intelligence_v5.composite TICKER [YYYY-MM-DD] [MARKET_CAP]")
        sys.exit(2)
    t = sys.argv[1]
    d = date.fromisoformat(sys.argv[2]) if len(sys.argv) >= 3 else date.today()
    mcap = float(sys.argv[3]) if len(sys.argv) >= 4 else None
    print(json.dumps(compute_mt_score(t, d, market_cap=mcap), indent=2, default=str))
