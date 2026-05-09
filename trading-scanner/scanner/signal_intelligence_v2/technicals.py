"""
Technicals Signal — v2 Signal Intelligence engine.

Three components, equal-weighted-ish (range −100 to +100 after volume confirmation):

  12-1 momentum rank          ±35  Jegadeesh-Titman (1993), Asness-Moskowitz-
                                   Pedersen (2013)
  52-week-high proximity       ±35  George-Hwang (2004)
  6-month relative strength    ±30  classical momentum vs SPY benchmark
  Volume multiplier (× 1.1 / × 0.9)  Lee-Swaminathan (2000)

Replaces v1's SCTR-style construction (long-term trend 60% / mid 30% /
short 10% with ADX, RSI, MACD overlays). v1 was a sensible practitioner
heuristic but the underlying indicators are practitioner constructions
(SCTR/Pring/Wilder lineage), not peer-reviewed at the individual-name
level. The cross-sectional momentum literature is enormous and consistent.

Key changes from v1:

1. **12-1 momentum (12-month return excluding the most recent month)** —
   the canonical Jegadeesh-Titman construction. v1 used YTD-vs-SPY and
   1M-vs-SPY which approximate momentum but don't follow the academic
   convention. The "skip month" matters because last-month returns
   reverse (short-term reversal); including them contaminates the signal.

2. **52-week-high proximity (George-Hwang)** — "names trading near their
   52-week high tend to keep outperforming." Adds information beyond
   simple 12-month momentum. v1 didn't include this.

3. **ADX / RSI / MACD removed from the score.** Practitioner indicators
   with weak academic predictive evidence at the individual-name level.
   These remain on the dashboard as descriptive context (current code
   already exposes them as separate fields), but they don't drive the
   Signal score.

Caller is responsible for computing the three input metrics from price
history (Phase 6 producer wires this up via `price_history.get_ohlcv`).
This module just does the symmetric scoring.

Returns None when ALL three component inputs are None.
"""

from __future__ import annotations

from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Component scaling — tunable in Phase D
# ─────────────────────────────────────────────────────────────────────────────

# 12-1 momentum: rank percentile in [0, 1]. Top 5% → +35, bottom 5% → −35.
MOMENTUM_SCALE = 77.78          # = 35 / 0.45
MOMENTUM_MAX = 35.0

# 52-week-high proximity: ratio = price / 52w_high.
# Center at 0.85; ratio = 1.0 → +35 (saturates), ratio = 0.70 → −35.
PROX_CENTER = 0.85
PROX_SCALE = 233.33             # = 35 / 0.15
PROX_MAX = 35.0

# 6-month excess return vs SPY in PERCENTAGE POINTS (e.g. +12 for +12%).
# Saturates at ±15pp.
EXCESS_SCALE = 2.0
EXCESS_MAX = 30.0

# Volume multiplier (Lee-Swaminathan)
VOL_AMPLIFY_THRESHOLD = 1.5
VOL_AMPLIFY_FACTOR = 1.1
VOL_DAMPEN_THRESHOLD = 0.7
VOL_DAMPEN_FACTOR = 0.9


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def compute_technicals_signal(
    momentum_rank_pct: float | None,
    pct_to_52w_high: float | None,
    excess_return_6m_pct: float | None,
    vol_ratio: float | None = None,
) -> int | None:
    """
    Compute the Technicals Signal for one ticker.

    Args:
        momentum_rank_pct: Cross-sectional rank percentile of trailing
            12-month return excluding the most recent month, ∈ [0, 1].
            0 = worst in universe (bottom percentile), 1 = best.
        pct_to_52w_high: Current price / 52-week high, ∈ [0, ~1.0+].
            1.0 = at high; 0.5 = 50% off high.
        excess_return_6m_pct: 6-month return minus SPY 6-month return,
            in PERCENTAGE POINTS (e.g., +12 for +12% excess).
        vol_ratio: Today's volume / 22-day average volume. None → no
            multiplier applied.

    Returns:
        Integer score in [−100, +100], or None if all three inputs are
        None (Signal excluded from Magnitude rollup denominator).
    """
    have_any = any(
        x is not None
        for x in (momentum_rank_pct, pct_to_52w_high, excess_return_6m_pct)
    )
    if not have_any:
        return None

    # ── Component 1: 12-1 momentum cross-sectional rank ───────────────────────
    if momentum_rank_pct is not None:
        m = _clamp(_f(momentum_rank_pct), 0.0, 1.0)
        c1 = _clamp((m - 0.5) * MOMENTUM_SCALE, -MOMENTUM_MAX, MOMENTUM_MAX)
    else:
        c1 = 0.0

    # ── Component 2: 52-week-high proximity ───────────────────────────────────
    if pct_to_52w_high is not None:
        p = _clamp(_f(pct_to_52w_high), 0.0, 1.5)
        c2 = _clamp((p - PROX_CENTER) * PROX_SCALE, -PROX_MAX, PROX_MAX)
    else:
        c2 = 0.0

    # ── Component 3: 6-month excess return vs SPY ─────────────────────────────
    if excess_return_6m_pct is not None:
        e = _f(excess_return_6m_pct)
        c3 = _clamp(e * EXCESS_SCALE, -EXCESS_MAX, EXCESS_MAX)
    else:
        c3 = 0.0

    raw = c1 + c2 + c3

    # ── Volume confirmation multiplier ────────────────────────────────────────
    if vol_ratio is not None and raw != 0:
        v = _f(vol_ratio, 1.0)
        if v >= VOL_AMPLIFY_THRESHOLD:
            raw *= VOL_AMPLIFY_FACTOR
        elif v < VOL_DAMPEN_THRESHOLD:
            raw *= VOL_DAMPEN_FACTOR

    return int(round(_clamp(raw, -100.0, 100.0)))
