"""Short interest enrichment via yfinance.

yfinance exposes FINRA biweekly short interest data in `Ticker(sym).info`. Relevant keys:
    sharesShort               — shares short at last report
    sharesShortPriorMonth     — shares short at prior report (for trend)
    shortPercentOfFloat       — shortInterest / float (preferred %)
    sharesPercentSharesOut    — shortInterest / shares outstanding (fallback %)
    shortRatio                — days to cover (shortInterest / avg 30d share volume)
    dateShortInterest         — unix timestamp of the as-of date

NOTE: FINRA data is reported semi-monthly with a ~15-day lag. This data is NEVER
real-time and should be labeled as such everywhere it's displayed.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Per-process cache keyed by ticker — cleared at each scan run invocation.
_SI_CACHE: dict[str, dict[str, Any]] = {}


def clear_short_interest_cache() -> None:
    _SI_CACHE.clear()


def _safe_float(val: Any) -> float | None:
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    # yfinance sometimes returns NaN for missing fields
    if f != f:  # NaN check
        return None
    return f


def get_short_interest(ticker: str) -> dict[str, Any] | None:
    """
    Return a dict of short-interest fields for `ticker`, or None if unavailable.

    Fields returned:
        short_pct_float      — float, 0.0–1.0+ (e.g. 0.18 = 18% of float)
        short_pct_shares_out — float, 0.0–1.0+ (fallback denominator)
        days_to_cover        — float (shortRatio)
        shares_short         — int
        shares_short_prior   — int (for trend-direction)
        short_as_of          — ISO date string (e.g. "2026-04-01")

    Any field may be None if the underlying yfinance key is missing.
    """
    sym = str(ticker).upper().strip()
    if not sym:
        return None
    if sym in _SI_CACHE:
        return _SI_CACHE[sym]

    try:
        import yfinance as yf  # noqa: F401
    except ImportError:
        logger.warning("yfinance not installed; short-interest unavailable")
        return None

    try:
        info = yf.Ticker(sym).info or {}
    except Exception as e:  # network error, 404 on delisted, etc.
        logger.warning("yfinance .info failed for %s: %s", sym, e)
        _SI_CACHE[sym] = None  # type: ignore[assignment]
        return None

    pct_float = _safe_float(info.get("shortPercentOfFloat"))
    pct_sout = _safe_float(info.get("sharesPercentSharesOut"))
    days_cov = _safe_float(info.get("shortRatio"))
    shares_short = _safe_float(info.get("sharesShort"))
    shares_short_prior = _safe_float(info.get("sharesShortPriorMonth"))
    date_ts = _safe_float(info.get("dateShortInterest"))

    as_of_iso: str | None = None
    if date_ts and date_ts > 0:
        try:
            as_of_iso = datetime.fromtimestamp(int(date_ts), tz=timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            pass

    # If every field is empty, treat as unavailable so the dashboard can hide the panel.
    if all(v is None for v in (pct_float, pct_sout, days_cov, shares_short)):
        _SI_CACHE[sym] = None  # type: ignore[assignment]
        return None

    out: dict[str, Any] = {
        "short_pct_float": pct_float,
        "short_pct_shares_out": pct_sout,
        "days_to_cover": days_cov,
        "shares_short": int(shares_short) if shares_short is not None else None,
        "shares_short_prior": int(shares_short_prior) if shares_short_prior is not None else None,
        "short_as_of": as_of_iso,
    }
    _SI_CACHE[sym] = out
    return out


def enrich_screener_with_short_interest(screener: dict[str, dict[str, Any]]) -> None:
    """
    In-place enrichment: for every ticker in `screener`, attach short-interest
    fields directly onto the existing screener row. Missing fields are left as None
    so downstream consumers can coalesce.

    This is a best-effort pass — individual yfinance failures do not abort the run.
    """
    if not screener:
        return
    for sym, row in screener.items():
        if not isinstance(row, dict):
            continue
        si = get_short_interest(sym)
        if not si:
            continue
        # Merge without clobbering any upstream-set values (defensive)
        for k, v in si.items():
            row.setdefault(k, v)
