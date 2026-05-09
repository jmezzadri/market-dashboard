"""
v4.1 Pillars — Aggression, Squeeze, Momentum + Overbought red flag.

Three pillars, additive points (max 65). Score = 0 if RSI > 70 (red flag).
"""

from __future__ import annotations

import statistics
from typing import Sequence

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

RVOL_THRESHOLD = 1.5            # Pillar 1: today's volume / 22-day avg
RVOL_LOOKBACK_DAYS = 22

BB_BANDWIDTH_THRESHOLD = 0.04   # Pillar 2: 4σ/SMA < 4%
BB_PERIOD = 20
BB_STDS = 2

MOMENTUM_SMA_PERIOD = 50        # Pillar 3: close > 50-SMA
RSI_PERIOD = 14                 # Pillar 3: RSI 40-70
RSI_FLOOR = 40
RSI_CEILING = 70

OVERBOUGHT_RSI = 70             # Red flag

PILLAR_AGGRESSION_PTS = 25
PILLAR_SQUEEZE_PTS = 20
PILLAR_MOMENTUM_PTS = 20


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _rsi(closes: Sequence[float], period: int = RSI_PERIOD) -> float | None:
    """Wilder RSI on the last `period+1` closes."""
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        diff = closes[i] - closes[i - 1]
        gains.append(max(0.0, diff))
        losses.append(max(0.0, -diff))
    avg_g = sum(gains) / period
    avg_l = sum(losses) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - (100 / (1 + rs))


def _sma(values: Sequence[float]) -> float:
    return sum(values) / len(values)


def _bb_bandwidth(closes: Sequence[float], period: int = BB_PERIOD,
                  stds: float = BB_STDS) -> float | None:
    """Bollinger BandWidth = (upper − lower) / SMA on last `period` closes."""
    if len(closes) < period:
        return None
    recent = list(closes[-period:])
    m = _sma(recent)
    if m <= 0:
        return None
    sd = statistics.pstdev(recent)
    return (2 * stds * sd) / m


# ─────────────────────────────────────────────────────────────────────────────
# Pillars
# ─────────────────────────────────────────────────────────────────────────────

def aggression_pillar(volume_today: float, avg_volume_22d: float) -> int:
    """Pillar 1: +25 if RVOL > 1.5."""
    if not avg_volume_22d or avg_volume_22d <= 0:
        return 0
    rvol = volume_today / avg_volume_22d
    return PILLAR_AGGRESSION_PTS if rvol > RVOL_THRESHOLD else 0


def squeeze_pillar(closes: Sequence[float]) -> int:
    """Pillar 2: +20 if 20-period Bollinger BandWidth < 4%."""
    bw = _bb_bandwidth(closes)
    if bw is None:
        return 0
    return PILLAR_SQUEEZE_PTS if bw < BB_BANDWIDTH_THRESHOLD else 0


def momentum_pillar(closes: Sequence[float]) -> int:
    """Pillar 3: +20 if close > 50-SMA AND RSI(14) ∈ [40, 70]."""
    if len(closes) < MOMENTUM_SMA_PERIOD + 1:
        return 0
    sma = _sma(list(closes[-MOMENTUM_SMA_PERIOD - 1:-1]))
    today_close = closes[-1]
    if today_close <= sma:
        return 0
    rsi = _rsi(closes)
    if rsi is None:
        return 0
    if RSI_FLOOR <= rsi <= RSI_CEILING:
        return PILLAR_MOMENTUM_PTS
    return 0


def overbought_red_flag(closes: Sequence[float]) -> bool:
    """Red flag: RSI(14) > 70 → score will be set to 0."""
    rsi = _rsi(closes)
    return rsi is not None and rsi > OVERBOUGHT_RSI


def score_pillars(
    volume_today: float,
    avg_volume_22d: float,
    closes: Sequence[float],
) -> dict[str, int | bool]:
    """
    Compute all three pillars + red flag. Returns full diagnostic.

    Caller adds `score_total` = sum of pillars (or 0 if red flag fires).
    """
    p1 = aggression_pillar(volume_today, avg_volume_22d)
    p2 = squeeze_pillar(closes)
    p3 = momentum_pillar(closes)
    overbought = overbought_red_flag(closes)
    raw = p1 + p2 + p3
    final = 0 if overbought else raw
    return {
        "aggression": p1,
        "squeeze": p2,
        "momentum": p3,
        "overbought_red_flag": overbought,
        "score_raw": raw,
        "score_final": final,
    }
