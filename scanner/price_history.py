"""yfinance-backed price change columns (1W / 1M / YTD). Cached per scan run."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

_PRICE_CHANGES_CACHE: dict[str, dict[str, str]] = {}


def clear_price_changes_cache() -> None:
    _PRICE_CHANGES_CACHE.clear()


def get_price_changes(ticker: str) -> dict[str, str]:
    """
    Returns 1W, 1M, and YTD percentage price changes for a ticker.
    Falls back to "N/A" for any period that fails.
    """
    sym = (ticker or "").strip().upper()
    if not sym:
        return {"1w": "N/A", "1m": "N/A", "ytd": "N/A"}
    if sym in _PRICE_CHANGES_CACHE:
        return _PRICE_CHANGES_CACHE[sym]

    out = _fetch_price_changes(sym)
    _PRICE_CHANGES_CACHE[sym] = out
    return out


def _fetch_price_changes(ticker: str) -> dict[str, str]:
    try:
        import yfinance as yf
    except ImportError:
        logger.warning("yfinance not installed; price changes will be N/A")
        return {"1w": "N/A", "1m": "N/A", "ytd": "N/A"}

    try:
        stock = yf.Ticker(ticker)
        hist: Any = stock.history(period="1y")
        if hist is None or hist.empty or "Close" not in hist.columns:
            return {"1w": "N/A", "1m": "N/A", "ytd": "N/A"}

        current = float(hist["Close"].iloc[-1])
        today = datetime.now().date()

        idx = hist.index
        idx_norm = pd.to_datetime(idx)
        if getattr(idx_norm, "tz", None) is not None:
            idx_norm = idx_norm.tz_localize(None)

        def pct_change(days_ago: int) -> str:
            target = pd.Timestamp(today - timedelta(days=days_ago))
            mask = idx_norm <= target
            sub = hist.loc[mask]
            if sub is None or sub.empty:
                return "N/A"
            price = float(sub["Close"].iloc[-1])
            if price <= 0:
                return "N/A"
            return f"{((current - price) / price * 100):+.1f}%"

        jan1 = pd.Timestamp(datetime(today.year, 1, 1).date())
        ytd_str = "N/A"
        mask_ytd = idx_norm >= jan1
        ytd_data = hist.loc[mask_ytd]
        if ytd_data is not None and not ytd_data.empty:
            ytd_open = float(ytd_data["Close"].iloc[0])
            if ytd_open > 0:
                ytd_str = f"{((current - ytd_open) / ytd_open * 100):+.1f}%"

        return {
            "1w": pct_change(7),
            "1m": pct_change(30),
            "ytd": ytd_str,
        }
    except Exception as e:
        logger.debug("get_price_changes failed for %s: %s", ticker, e)
        return {"1w": "N/A", "1m": "N/A", "ytd": "N/A"}
