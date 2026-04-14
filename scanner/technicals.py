"""
Technical analysis signals computed from shared yfinance OHLCV (see price_history.get_ohlcv).
Max contribution to total score: +20 points before global cap; can be negative (down to -10).
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from scanner.price_history import get_ohlcv

logger = logging.getLogger(__name__)

_TECH_CACHE: dict[str, dict[str, Any]] = {}


def clear_tech_cache() -> None:
    _TECH_CACHE.clear()


def get_technicals(ticker: str) -> dict[str, Any]:
    """
    Returns RSI, MACD cross, MA position, volume surge, score contribution, and plain-English bullets.
    Cached once per ticker per scan run.
    """
    sym = (ticker or "").strip().upper()
    if not sym:
        return _empty_technicals()
    if sym in _TECH_CACHE:
        return _TECH_CACHE[sym]

    result = _compute_technicals(sym)
    _TECH_CACHE[sym] = result
    return result


def _empty_technicals() -> dict[str, Any]:
    return {
        "rsi_14": None,
        "macd_cross": None,
        "above_50ma": None,
        "above_200ma": None,
        "vol_surge": None,
        "tech_score": 0,
        "tech_summary": [],
    }


def _compute_technicals(sym: str) -> dict[str, Any]:
    empty = _empty_technicals()
    try:
        hist = get_ohlcv(sym)
        if hist is None or hist.empty or len(hist) < 30 or "Close" not in hist.columns:
            return empty

        close = hist["Close"]
        volume = hist["Volume"] if "Volume" in hist.columns else None

        rsi = _calc_rsi(close, 14)
        macd_cross = _calc_macd_cross(close)

        sma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None
        sma200 = float(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None
        current = float(close.iloc[-1])

        above_50 = current > sma50 if sma50 is not None else None
        above_200 = current > sma200 if sma200 is not None else None

        vol_surge = _calc_vol_surge(volume, 20) if volume is not None else None

        score, bullets = _score_technicals(
            rsi=rsi,
            macd_cross=macd_cross,
            above_50ma=above_50,
            above_200ma=above_200,
            vol_surge=vol_surge,
        )

        return {
            "rsi_14": round(rsi, 1) if rsi is not None else None,
            "macd_cross": macd_cross,
            "above_50ma": above_50,
            "above_200ma": above_200,
            "vol_surge": round(vol_surge, 2) if vol_surge is not None else None,
            "tech_score": score,
            "tech_summary": bullets,
        }
    except Exception as e:
        logger.warning("Technicals failed for %s: %s", sym, e)
        return empty


def _calc_rsi(close: pd.Series, period: int = 14) -> float | None:
    if len(close) < period + 1:
        return None
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))
    val = rsi.iloc[-1]
    return float(val) if not np.isnan(val) else None


def _calc_macd_cross(close: pd.Series) -> str | None:
    """Bullish / bearish if MACD crossed signal in last 3 daily bars; else neutral."""
    if len(close) < 35:
        return None
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    diff = macd - signal

    if len(diff) < 4:
        return "neutral"
    recent = diff.iloc[-4:].values
    for i in range(len(recent) - 1):
        if recent[i] < 0 and recent[i + 1] >= 0:
            return "bullish"
        if recent[i] > 0 and recent[i + 1] <= 0:
            return "bearish"
    return "neutral"


def _calc_vol_surge(volume: pd.Series, period: int = 20) -> float | None:
    if len(volume) < period + 1:
        return None
    avg = float(volume.iloc[-(period + 1) : -1].mean())
    today = float(volume.iloc[-1])
    if avg <= 0:
        return None
    return today / avg


def _score_technicals(
    rsi: float | None,
    macd_cross: str | None,
    above_50ma: bool | None,
    above_200ma: bool | None,
    vol_surge: float | None,
) -> tuple[int, list[str]]:
    points = 0
    bullets: list[str] = []

    if rsi is not None:
        if rsi > 80:
            points -= 8
            bullets.append(
                f"RSI is {rsi:.0f} — significantly overbought. High risk of "
                f"short-term pullback."
            )
        elif rsi > 70:
            points -= 4
            bullets.append(
                f"RSI is {rsi:.0f} — overbought. Price has run significantly; "
                f"momentum could be extended."
            )
        elif rsi < 30:
            points += 8
            bullets.append(
                f"RSI is {rsi:.0f} — oversold territory. Technically attractive "
                f"entry point; price may be due for a bounce."
            )
        elif rsi < 40:
            points += 4
            bullets.append(
                f"RSI is {rsi:.0f} — approaching oversold. Momentum is weak but "
                f"not yet at an extreme."
            )

    if macd_cross == "bullish":
        points += 6
        bullets.append(
            "MACD crossed above its signal line in the last 3 days — "
            "a bullish momentum shift. Trend may be turning upward."
        )
    elif macd_cross == "bearish":
        points -= 3
        bullets.append(
            "MACD recently crossed below its signal line — "
            "short-term momentum is turning negative."
        )

    if above_50ma is True and above_200ma is True:
        points += 6
        bullets.append(
            "Trading above both the 50-day and 200-day moving averages — "
            "price action is in a confirmed uptrend."
        )
    elif above_50ma is True and above_200ma is False:
        points += 3
        bullets.append(
            "Above the 50-day moving average but below the 200-day — "
            "short-term momentum is positive but longer-term trend is still down."
        )
    elif above_50ma is False and above_200ma is False:
        points -= 2
        bullets.append(
            "Trading below both the 50-day and 200-day moving averages — "
            "price remains in a downtrend technically."
        )

    if vol_surge is not None:
        if vol_surge >= 3.0:
            points += 4
            bullets.append(
                f"Volume today is {vol_surge:.1f}x its 20-day average — "
                f"unusually strong institutional interest."
            )
        elif vol_surge >= 2.0:
            points += 2
            bullets.append(
                f"Volume is {vol_surge:.1f}x its 20-day average — "
                f"elevated activity supporting the signal."
            )

    points = max(-10, min(20, points))
    return points, bullets
