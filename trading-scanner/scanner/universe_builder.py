"""
Wide-universe technicals pre-filter.

Two-stage compute model:
  1. Gate pass — cheap filters over all index members (S&P 500 + Nasdaq 100 +
     Dow 30, plus optional Russell 2000). Survivors get tagged with direction
     (long / short) based on MA regime and relative strength vs SPY.
  2. Composite pass (downstream, in main.py) — the full SCTR-style composite
     score runs ONLY on gate survivors. The gate pass warms the OHLCV cache
     so the composite call is effectively free.

Gate stack (in order — cheapest first, most-eliminating first):
  Gate 1 — Liquidity:   20-day avg $ volume ≥ WIDE_UNIVERSE_MIN_ADV_USD
  Gate 2 — Trend:       above/below BOTH 50MA and 200MA (chop = dropped)
  Gate 3 — RS vs SPY:   |3M excess return| ≥ WIDE_UNIVERSE_RS_THRESHOLD
  Gate 4 — RSI band:    directional (longs 40–75, shorts 25–60)

Output is cached to reports/wide_universe.json per calendar date. Intraday
scans on the same day read the cache instead of rebuilding.
"""

from __future__ import annotations

import datetime as _dt
import json as _json
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from config import (
    WIDE_UNIVERSE_BATCH_SIZE,
    WIDE_UNIVERSE_INCLUDE_RUSSELL_2000,
    WIDE_UNIVERSE_MIN_ADV_USD,
    WIDE_UNIVERSE_RS_THRESHOLD,
    WIDE_UNIVERSE_RSI_LONG_MAX,
    WIDE_UNIVERSE_RSI_LONG_MIN,
    WIDE_UNIVERSE_RSI_SHORT_MAX,
    WIDE_UNIVERSE_RSI_SHORT_MIN,
)
from scanner.indices import build_index_universe, deduped_universe
from scanner.price_history import get_ohlcv

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_CACHE_PATH = _PROJECT_ROOT / "reports" / "wide_universe.json"

# Reuse the same ETF blacklist that main.py uses (index/sector products show
# up on some Nasdaq 100 composite sub-tables and must not be scanned).
_SYMBOL_SKIP = frozenset({"SPY", "QQQ", "DIA", "IWM"})


def _calc_rsi(close: pd.Series, period: int = 14) -> float | None:
    if close is None or len(close) < period + 1:
        return None
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))
    val = rsi.iloc[-1]
    return float(val) if not np.isnan(val) else None


def _three_month_return(close: pd.Series) -> float | None:
    if close is None or len(close) < 64:  # ~63 trading days in 3 months
        return None
    prior = float(close.iloc[-64])
    current = float(close.iloc[-1])
    if prior <= 0:
        return None
    return (current - prior) / prior


def _batch_fetch(tickers: list[str], batch_size: int) -> dict[str, pd.DataFrame]:
    """
    yfinance batch download → {ticker: OHLCV DataFrame}. Populates get_ohlcv's
    in-process cache along the way so downstream composite calls are free.

    yfinance batch mode returns a multi-index DataFrame when group_by='ticker';
    we split it back per-ticker and push each frame into _OHLCV_CACHE.
    """
    try:
        import yfinance as yf
    except ImportError:
        logger.warning("yfinance not installed; wide universe disabled")
        return {}

    # Import the module-level OHLCV cache so we can populate it directly —
    # this is what makes the downstream get_technicals() call free.
    from scanner import price_history

    out: dict[str, pd.DataFrame] = {}
    total = len(tickers)
    for i in range(0, total, batch_size):
        batch = tickers[i : i + batch_size]
        try:
            df = yf.download(
                batch,
                period="1y",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
        except Exception as e:
            logger.warning("yfinance batch %d-%d failed: %s", i, i + len(batch), e)
            continue

        if df is None or df.empty:
            continue

        # Single-ticker batches come back without the outer ticker level — handle
        # both cases.
        if isinstance(df.columns, pd.MultiIndex):
            for sym in batch:
                if sym in df.columns.get_level_values(0):
                    sub = df[sym].dropna(how="all")
                    if not sub.empty:
                        out[sym] = sub
                        price_history._OHLCV_CACHE[sym] = sub
        else:
            if batch:
                sub = df.dropna(how="all")
                if not sub.empty:
                    out[batch[0]] = sub
                    price_history._OHLCV_CACHE[batch[0]] = sub

        logger.info("wide-universe OHLCV batch %d/%d (+%d tickers)",
                    min(i + batch_size, total), total, len(out))

    return out


def _classify(
    sym: str,
    hist: pd.DataFrame,
    spy_3m_return: float | None,
) -> dict[str, Any] | None:
    """
    Return {direction, reason, stats} if survivor; None if dropped.

    reason is "long", "short", or a drop-reason string — useful for diagnostics
    but not written to the public artifact (only the direction buckets are).
    """
    if hist is None or hist.empty or "Close" not in hist.columns or len(hist) < 60:
        return {"direction": None, "reason": "insufficient_history"}

    close = hist["Close"]
    volume = hist["Volume"] if "Volume" in hist.columns else None

    current = float(close.iloc[-1])
    if current <= 0:
        return {"direction": None, "reason": "no_price"}

    # Gate 1 — Liquidity (20-day avg dollar volume)
    if volume is None or len(volume) < 20:
        return {"direction": None, "reason": "no_volume"}
    adv_shares = float(volume.iloc[-20:].mean())
    adv_dollar = adv_shares * current
    if adv_dollar < WIDE_UNIVERSE_MIN_ADV_USD:
        return {"direction": None, "reason": f"low_adv (${adv_dollar/1e6:.1f}M)"}

    # Gate 2 — Trend regime (both MAs same side)
    if len(close) < 200:
        return {"direction": None, "reason": "insufficient_history_200"}
    sma50 = float(close.rolling(50).mean().iloc[-1])
    sma200 = float(close.rolling(200).mean().iloc[-1])
    above_50 = current > sma50
    above_200 = current > sma200
    if above_50 and above_200:
        direction_candidate = "long"
    elif (not above_50) and (not above_200):
        direction_candidate = "short"
    else:
        return {"direction": None, "reason": "chop"}

    # Gate 3 — RS vs SPY (3-month excess)
    ret_3m = _three_month_return(close)
    if ret_3m is None or spy_3m_return is None:
        return {"direction": None, "reason": "no_rs_data"}
    excess = ret_3m - spy_3m_return
    if direction_candidate == "long" and excess < WIDE_UNIVERSE_RS_THRESHOLD:
        return {"direction": None, "reason": f"weak_rs_long ({excess*100:+.1f}%)"}
    if direction_candidate == "short" and excess > -WIDE_UNIVERSE_RS_THRESHOLD:
        return {"direction": None, "reason": f"weak_rs_short ({excess*100:+.1f}%)"}

    # Gate 4 — RSI band (directional)
    rsi = _calc_rsi(close, 14)
    if rsi is None:
        return {"direction": None, "reason": "no_rsi"}
    if direction_candidate == "long":
        if not (WIDE_UNIVERSE_RSI_LONG_MIN <= rsi <= WIDE_UNIVERSE_RSI_LONG_MAX):
            return {"direction": None, "reason": f"rsi_out_of_band_long ({rsi:.0f})"}
    else:
        if not (WIDE_UNIVERSE_RSI_SHORT_MIN <= rsi <= WIDE_UNIVERSE_RSI_SHORT_MAX):
            return {"direction": None, "reason": f"rsi_out_of_band_short ({rsi:.0f})"}

    return {
        "direction": direction_candidate,
        "reason": direction_candidate,
        "stats": {
            "price": round(current, 2),
            "adv_usd_m": round(adv_dollar / 1e6, 1),
            "excess_3m": round(excess, 4),
            "rsi_14": round(rsi, 1),
            "above_50ma": above_50,
            "above_200ma": above_200,
        },
    }


def build_wide_universe(
    *,
    force_rebuild: bool = False,
    include_russell_2000: bool | None = None,
) -> dict[str, Any]:
    """
    Build (or load cached) wide-universe survivor lists with direction tags.

    Returns:
      {
        "built_at": ISO timestamp,
        "long":  [TICKERS ...],
        "short": [TICKERS ...],
        "stats": { total_scanned, liquidity_survivors, long, short, chop, ... }
      }
    """
    if include_russell_2000 is None:
        include_russell_2000 = WIDE_UNIVERSE_INCLUDE_RUSSELL_2000

    today = _dt.date.today().isoformat()
    if not force_rebuild and _CACHE_PATH.exists():
        try:
            cached = _json.loads(_CACHE_PATH.read_text())
            if cached.get("date") == today:
                logger.info("Using cached wide universe (%s) — %d long, %d short",
                            today, len(cached.get("long", [])), len(cached.get("short", [])))
                return cached
        except Exception as e:
            logger.debug("Wide-universe cache read failed: %s", e)

    indices = build_index_universe(include_russell_2000=include_russell_2000)
    all_syms = [s for s in deduped_universe(indices) if s not in _SYMBOL_SKIP]

    if not all_syms:
        logger.warning("Wide universe: no tickers fetched — scan will fall back to UW-sourced universe")
        return {
            "date": today,
            "built_at": _dt.datetime.utcnow().isoformat() + "Z",
            "long": [],
            "short": [],
            "stats": {"total_scanned": 0, "error": "no_tickers"},
        }

    logger.info("Wide universe: running gates on %d deduped tickers (R2000=%s)",
                len(all_syms), include_russell_2000)

    # Warm the SPY cache first so the per-ticker RS calc has a denominator.
    spy_hist = get_ohlcv("SPY")
    spy_3m_return = _three_month_return(spy_hist["Close"]) if (spy_hist is not None and not spy_hist.empty) else None
    if spy_3m_return is None:
        logger.warning("Wide universe: no SPY 3M return — RS gate will drop everything; aborting")
        return {
            "date": today,
            "built_at": _dt.datetime.utcnow().isoformat() + "Z",
            "long": [],
            "short": [],
            "stats": {"total_scanned": len(all_syms), "error": "no_spy_baseline"},
        }

    # Batched OHLCV fetch — also populates price_history._OHLCV_CACHE so the
    # downstream composite pass doesn't re-pull these tickers.
    frames = _batch_fetch(all_syms, batch_size=WIDE_UNIVERSE_BATCH_SIZE)

    long_bucket: list[str] = []
    short_bucket: list[str] = []
    drop_reasons: dict[str, int] = {}
    details: dict[str, dict[str, Any]] = {}

    for sym in all_syms:
        hist = frames.get(sym)
        result = _classify(sym, hist, spy_3m_return)
        if result is None:
            drop_reasons["unknown"] = drop_reasons.get("unknown", 0) + 1
            continue
        direction = result.get("direction")
        if direction == "long":
            long_bucket.append(sym)
            details[sym] = result.get("stats", {})
        elif direction == "short":
            short_bucket.append(sym)
            details[sym] = result.get("stats", {})
        else:
            r = result.get("reason", "unknown")
            # Bucket the reason by leading word to keep the histogram readable.
            key = r.split()[0] if isinstance(r, str) else "unknown"
            drop_reasons[key] = drop_reasons.get(key, 0) + 1

    long_bucket.sort()
    short_bucket.sort()

    result = {
        "date": today,
        "built_at": _dt.datetime.utcnow().isoformat() + "Z",
        "include_russell_2000": include_russell_2000,
        "long": long_bucket,
        "short": short_bucket,
        "details": details,
        "stats": {
            "total_scanned": len(all_syms),
            "with_ohlcv": len(frames),
            "long": len(long_bucket),
            "short": len(short_bucket),
            "dropped_by_reason": dict(sorted(drop_reasons.items(), key=lambda kv: -kv[1])),
            "indices": {k: len(v) for k, v in indices.items()},
        },
    }

    try:
        _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CACHE_PATH.write_text(_json.dumps(result, indent=2))
        logger.info(
            "Wide universe built: %d long, %d short (from %d scanned)",
            len(long_bucket), len(short_bucket), len(all_syms),
        )
    except Exception as e:
        logger.warning("Wide-universe cache write failed: %s", e)

    return result


def direction_for_ticker(wide_universe: dict[str, Any]) -> dict[str, str]:
    """Flat lookup {ticker: 'long'|'short'} for the dashboard artifact."""
    out: dict[str, str] = {}
    for t in wide_universe.get("long", []):
        out[t] = "long"
    for t in wide_universe.get("short", []):
        out[t] = "short"
    return out
