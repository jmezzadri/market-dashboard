"""
Technical analysis signals computed from shared yfinance OHLCV (see price_history.get_ohlcv).

Two products:

1. `tech_score` — the legacy integer contribution to the overall ticker score
   (+20 / −10 bounded). Consumed by scorer.py. Unchanged.

2. `composite` — a standalone, signed technicals-only score spanning -100 to +100,
   modelled after SCTR (long-term trend 60% / mid 30% / short 10%) with IBD-style
   relative strength vs. SPY, ADX regime filter, and volume confirmation. This
   answers "what is the tape saying for this ticker, independent of fundamental
   signals?" and drives the SIGNAL column on the dashboard's Technicals tab.

See docs/TECHNICALS_COMPOSITE.md (or Methodology tab) for the full formula and
professional-methodology references (SCTR, TradingView, Barchart, IBD).
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
    Returns RSI, MACD cross, MA position (bool + signed %), ADX, SPY-relative
    returns, volume surge, 1W/1M/YTD raw returns, plus:
      - tech_score / tech_summary — legacy scorer input
      - composite — signed -100 to +100 directional tape-strength signal

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
        "close": None,
        "rsi_14": None,
        "macd_cross": None,
        "above_50ma": None,
        "above_200ma": None,
        "pct_vs_50ma": None,
        "pct_vs_200ma": None,
        "adx_14": None,
        "vol_surge": None,
        "week_change": None,
        "month_change": None,
        "ytd_change": None,
        "spy_relative_month": None,
        "spy_relative_ytd": None,
        "tech_score": 0,
        "tech_summary": [],
        "composite": {
            "score": None,
            "label": "NO DATA",
            "regime": None,
            "components": {},
        },
    }


def _compute_technicals(sym: str) -> dict[str, Any]:
    empty = _empty_technicals()
    try:
        hist = get_ohlcv(sym)
        if hist is None or hist.empty or len(hist) < 30 or "Close" not in hist.columns:
            return empty

        close = hist["Close"]
        high = hist["High"] if "High" in hist.columns else None
        low = hist["Low"] if "Low" in hist.columns else None
        volume = hist["Volume"] if "Volume" in hist.columns else None

        rsi = _calc_rsi(close, 14)
        macd_cross = _calc_macd_cross(close)

        sma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None
        sma200 = float(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None
        current = float(close.iloc[-1])

        above_50 = current > sma50 if sma50 is not None else None
        above_200 = current > sma200 if sma200 is not None else None
        # Signed percentage distance from each MA — positive = above, negative = below.
        # The composite score reads these, not just the booleans, so "5% above the 200MA"
        # earns more credit than "0.1% above."
        pct_vs_50 = (current - sma50) / sma50 if sma50 else None
        pct_vs_200 = (current - sma200) / sma200 if sma200 else None

        # ADX(14) — Wilder's trend-strength indicator. Not directional; acts as a
        # regime filter in the composite (>25 confirms, <20 dampens).
        adx = None
        if high is not None and low is not None:
            adx = _calc_adx(high, low, close, 14)

        vol_surge = _calc_vol_surge(volume, 20) if volume is not None else None

        # Price changes from OHLCV history
        week_change = _pct_change(close, 5)
        month_change = _pct_change(close, 21)
        ytd_change = _calc_ytd_change(close)

        # Relative strength vs. SPY — the ticker's excess return. Skip for SPY
        # itself to avoid zero-return lookups, and for tickers where the SPY
        # fetch fails.
        spy_rel_month = None
        spy_rel_ytd = None
        if sym != "SPY":
            spy_month = _spy_pct_change(21)
            spy_ytd = _spy_ytd_change()
            if month_change is not None and spy_month is not None:
                spy_rel_month = month_change - spy_month
            if ytd_change is not None and spy_ytd is not None:
                spy_rel_ytd = ytd_change - spy_ytd

        score, bullets = _score_technicals(
            rsi=rsi,
            macd_cross=macd_cross,
            above_50ma=above_50,
            above_200ma=above_200,
            vol_surge=vol_surge,
        )

        composite = _compute_composite(
            pct_vs_200=pct_vs_200,
            spy_rel_ytd=spy_rel_ytd,
            pct_vs_50=pct_vs_50,
            spy_rel_month=spy_rel_month,
            macd_cross=macd_cross,
            rsi=rsi,
            adx=adx,
            vol_surge=vol_surge,
        )

        return {
            # Latest close from OHLCV — the dashboard's PRICE column falls back
            # to this when the UW screener row (sc.prev_close) is missing.
            "close": round(current, 4) if current is not None else None,
            "rsi_14": round(rsi, 1) if rsi is not None else None,
            "macd_cross": macd_cross,
            "above_50ma": above_50,
            "above_200ma": above_200,
            "pct_vs_50ma": round(pct_vs_50, 4) if pct_vs_50 is not None else None,
            "pct_vs_200ma": round(pct_vs_200, 4) if pct_vs_200 is not None else None,
            "adx_14": round(adx, 1) if adx is not None else None,
            "vol_surge": round(vol_surge, 2) if vol_surge is not None else None,
            "week_change": round(week_change, 4) if week_change is not None else None,
            "month_change": round(month_change, 4) if month_change is not None else None,
            "ytd_change": round(ytd_change, 4) if ytd_change is not None else None,
            "spy_relative_month": round(spy_rel_month, 4) if spy_rel_month is not None else None,
            "spy_relative_ytd": round(spy_rel_ytd, 4) if spy_rel_ytd is not None else None,
            "tech_score": score,
            "tech_summary": bullets,
            "composite": composite,
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


def _calc_adx(
    high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14
) -> float | None:
    """
    Wilder's Average Directional Index. Returns the ADX value at the most recent bar.

    ADX is not directional — it measures *trend strength* regardless of up/down.
    Above 25 = strong trend (trust trend-following signals). Below 20 = range-bound
    (mean-reversion regime). Used as the regime filter in the technicals composite.

    Uses Wilder's smoothing (equivalent to EMA with alpha = 1/period).
    """
    if len(close) < period * 2 + 1:
        return None
    try:
        # True Range = max(high-low, |high-prev_close|, |low-prev_close|)
        prev_close = close.shift(1)
        tr = pd.concat(
            [(high - low).abs(), (high - prev_close).abs(), (low - prev_close).abs()],
            axis=1,
        ).max(axis=1)
        atr = tr.ewm(alpha=1 / period, adjust=False).mean()

        # Directional Movement: only keep the larger of up-move vs. down-move,
        # and only if it's positive.
        up_move = high.diff()
        down_move = -low.diff()
        plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
        minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)

        plus_di = 100.0 * (plus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr.replace(0, np.nan))
        minus_di = 100.0 * (minus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr.replace(0, np.nan))

        dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
        adx = dx.ewm(alpha=1 / period, adjust=False).mean()

        val = adx.iloc[-1]
        return float(val) if not pd.isna(val) else None
    except Exception as e:
        logger.debug("ADX calc failed: %s", e)
        return None


def _spy_pct_change(n_bars: int) -> float | None:
    """Return SPY's n-bar return. Cached via get_ohlcv after first call."""
    spy = get_ohlcv("SPY")
    if spy is None or spy.empty or "Close" not in spy.columns:
        return None
    return _pct_change(spy["Close"], n_bars)


def _spy_ytd_change() -> float | None:
    """Return SPY's YTD return. Cached via get_ohlcv after first call."""
    spy = get_ohlcv("SPY")
    if spy is None or spy.empty or "Close" not in spy.columns:
        return None
    return _calc_ytd_change(spy["Close"])


def _compute_composite(
    *,
    pct_vs_200: float | None,
    spy_rel_ytd: float | None,
    pct_vs_50: float | None,
    spy_rel_month: float | None,
    macd_cross: str | None,
    rsi: float | None,
    adx: float | None,
    vol_surge: float | None,
) -> dict[str, Any]:
    """
    Signed technicals-only composite, −100 (STRONG BEAR) to +100 (STRONG BULL).

    Weighting follows SCTR's long-term dominance convention (long 60 / mid 30 /
    short 10), substituting IBD-style relative strength vs. SPY for ROC so the
    score reflects outperformance vs. the market rather than absolute returns.
    ADX applies a regime multiplier, and RVOL a confirmation multiplier.

    Returns dict with score (int), label (str), regime (str|None), components
    (dict of raw contributions pre-multipliers). Components sum to the pre-
    multiplier raw score — useful for hover/debug.
    """
    components: dict[str, float] = {}
    raw = 0.0

    # ── Long-term trend: 60 pts total ──────────────────────────────────────────
    # % above/below 200MA → ±30. ±5% saturates the component (keeps extreme
    # outliers from dominating the score).
    if pct_vs_200 is not None:
        v = max(-0.05, min(0.05, pct_vs_200))
        components["trend_long_200ma"] = v * 600.0  # 0.05 → 30
        raw += components["trend_long_200ma"]

    # YTD vs. SPY → ±30. ±10% relative saturates.
    if spy_rel_ytd is not None:
        v = max(-0.10, min(0.10, spy_rel_ytd))
        components["rs_ytd_vs_spy"] = v * 300.0  # 0.10 → 30
        raw += components["rs_ytd_vs_spy"]

    # ── Medium-term trend: 30 pts total ────────────────────────────────────────
    # % above/below 50MA → ±15. ±2% saturates.
    if pct_vs_50 is not None:
        v = max(-0.02, min(0.02, pct_vs_50))
        components["trend_mid_50ma"] = v * 750.0  # 0.02 → 15
        raw += components["trend_mid_50ma"]

    # 1M vs. SPY → ±15. ±5% relative saturates.
    if spy_rel_month is not None:
        v = max(-0.05, min(0.05, spy_rel_month))
        components["rs_1m_vs_spy"] = v * 300.0  # 0.05 → 15
        raw += components["rs_1m_vs_spy"]

    # ── Short-term momentum: 10 pts total ──────────────────────────────────────
    # Only add a momentum component if we actually have a MACD or RSI reading.
    # Otherwise an all-None ticker would still look like "momentum=0" in the
    # breakdown and we'd render NEUTRAL 0 instead of NO DATA.
    if macd_cross is not None or rsi is not None:
        momentum = 0.0
        if macd_cross == "bullish":
            momentum += 5.0
        elif macd_cross == "bearish":
            momentum -= 5.0

        if rsi is not None:
            if 50 <= rsi <= 70:
                momentum += 5.0  # healthy uptrend
            elif rsi < 30:
                momentum += 2.0  # mild oversold bounce setup; intentionally weak
                                 # because trend component already penalizes sub-MA
            # 70+ and 30-50 contribute 0 — overbought isn't a fade signal on its own,
            # and 30-50 is the "chop" zone.
        components["momentum"] = momentum
        raw += momentum

    # ── Regime filter: ADX ─────────────────────────────────────────────────────
    regime: str | None = None
    if adx is not None:
        if adx >= 25:
            # Strong trend — apply score as-is. Tag CONFIRMED when the composite
            # is already meaningfully directional (|raw| > 30); otherwise no tag.
            if abs(raw) > 30:
                regime = "CONFIRMED"
        elif adx < 20:
            # No trend — chop regime. Dampen the score; trend and momentum signals
            # whipsaw in ranging markets.
            raw *= 0.7
            regime = "CHOPPY"
        # 20 ≤ ADX < 25 — ambiguous; no tag, no dampening.

    # ── Volume confirmation ───────────────────────────────────────────────────
    if vol_surge is not None:
        if vol_surge >= 1.5 and raw != 0:
            raw *= 1.1  # heavy volume amplifies whatever direction the score points
        elif vol_surge < 0.7:
            raw *= 0.9  # thin participation — weaker signal

    raw = max(-100.0, min(100.0, raw))
    score = int(round(raw))

    if score >= 50:
        label = "STRONG BULL"
    elif score >= 20:
        label = "BULL"
    elif score >= -19:
        label = "NEUTRAL"
    elif score >= -49:
        label = "BEAR"
    else:
        label = "STRONG BEAR"

    # If we had literally no input, don't pretend the neutral rating means
    # anything — surface NO DATA instead.
    if not components:
        label = "NO DATA"
        regime = None
        score_out: int | None = None
    else:
        score_out = score

    return {
        "score": score_out,
        "label": label,
        "regime": regime,
        "components": {k: round(v, 2) for k, v in components.items()},
    }


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


def _pct_change(close: pd.Series, n_bars: int) -> float | None:
    """Return (current / close_n_bars_ago) - 1, or None if not enough data."""
    if len(close) < n_bars + 1:
        return None
    prior = float(close.iloc[-(n_bars + 1)])
    current = float(close.iloc[-1])
    if prior <= 0:
        return None
    return (current - prior) / prior


def _calc_ytd_change(close: pd.Series) -> float | None:
    """Return YTD % change using the first trading day of the current calendar year."""
    import pandas as _pd
    from datetime import datetime
    if close.empty:
        return None
    current_year = datetime.now().year
    try:
        idx = close.index
        # Handle timezone-aware or naive index
        if hasattr(idx[0], "tzinfo") and idx[0].tzinfo is not None:
            year_start = _pd.Timestamp(f"{current_year}-01-01", tz=idx[0].tzinfo)
        else:
            year_start = _pd.Timestamp(f"{current_year}-01-01")
        ytd_bars = close[close.index >= year_start]
        if ytd_bars.empty or len(ytd_bars) < 2:
            return None
        prior = float(ytd_bars.iloc[0])
        current = float(ytd_bars.iloc[-1])
        if prior <= 0:
            return None
        return (current - prior) / prior
    except Exception:
        return None
