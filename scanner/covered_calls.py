"""Covered call screener — Greeks, IV gate, earnings avoidance, liquidity (Phase 2)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
from scipy.stats import norm

from config import (
    CC_MAX_DELTA,
    CC_MAX_EXPIRY_DAYS,
    CC_MAX_SPREAD_PCT,
    CC_MIN_ANNUALIZED_YIELD,
    CC_MIN_DELTA,
    CC_MIN_EXPIRY_DAYS,
    CC_MIN_IV_RANK,
    CC_ROLL_UP_MAX_DELTA,
    CC_ROLL_UP_MIN_DELTA,
    CC_SELECT_MAX_DELTA,
    CC_SELECT_MIN_DELTA,
    CC_SPREAD_WIDE_NOTE_MIN_PCT,
)


def _float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def call_delta(S: float, K: float, T_days: int, sigma: float, r: float = 0.05) -> float:
    """Black–Scholes call delta. sigma annualized decimal (e.g. 0.30)."""
    if T_days <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 0.0
    T = T_days / 365.0
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    return float(norm.cdf(d1))


def parse_option_symbol(symbol: str | None) -> dict[str, Any] | None:
    """Parse OCC option symbol, e.g. AAPL260516C00205000."""
    if not symbol:
        return None
    s = str(symbol).strip().upper()
    m = re.match(r"^([A-Z]{1,6})(\d{6})([CP])(\d{8})$", s)
    if not m:
        return None
    _, date_str, cp, strike_str = m.groups()
    try:
        expiry = datetime.strptime(date_str, "%y%m%d")
    except ValueError:
        return None
    strike = int(strike_str) / 1000.0
    return {
        "expiry": expiry,
        "type": "call" if cp == "C" else "put",
        "strike": strike,
    }


def _iv_decimal(iv: float | None) -> float:
    if iv is None or iv <= 0:
        return 0.0
    if iv > 1.25:
        return iv / 100.0
    return float(iv)


def earnings_within_window(next_earnings_date: str | None, expiry_date: date) -> bool:
    """True if option expiry falls in [earnings−7, earnings+7] (avoid selling through earnings)."""
    if not next_earnings_date:
        return False
    try:
        ed = datetime.strptime(str(next_earnings_date).strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        return False
    win_lo = ed - timedelta(days=7)
    win_hi = ed + timedelta(days=7)
    return win_lo <= expiry_date <= win_hi


def find_optimal_covered_call(
    ticker: str,
    current_price: float,
    options_chain: list[dict[str, Any]],
    iv_rank: float | None = None,
    next_earnings_date: str | None = None,
    *,
    min_delta: float = CC_SELECT_MIN_DELTA,
    max_delta: float = CC_SELECT_MAX_DELTA,
    min_strike: float | None = None,
    exclude_strike_expiry: tuple[float, str] | None = None,
) -> dict[str, Any] | None:
    """
    Highest bid (income) among contracts passing IV, DTE, delta, spread, yield gates.
    Income and annualized yield use **bid** (conservative). Includes bid/ask/mid/spread_pct.
    """
    if current_price <= 0 or not options_chain:
        return None

    if iv_rank is not None and iv_rank < CC_MIN_IV_RANK:
        return None

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    min_expiry = today + timedelta(days=CC_MIN_EXPIRY_DAYS)
    max_expiry = today + timedelta(days=CC_MAX_EXPIRY_DAYS)

    candidates: list[dict[str, Any]] = []

    for contract in options_chain:
        raw = contract.get("_raw") or contract
        opt_sym = contract.get("option_symbol") or raw.get("option_symbol")
        parsed = parse_option_symbol(opt_sym) if opt_sym else None

        strike: float | None = None
        exp: datetime | None = None

        if parsed and parsed["type"] == "call":
            exp = parsed["expiry"]
            strike = float(parsed["strike"])
        else:
            try:
                strike = float(contract.get("strike") or 0)
            except (TypeError, ValueError):
                continue
            exp_s = str(contract.get("expiry") or "")[:10]
            if not exp_s:
                continue
            try:
                exp = datetime.strptime(exp_s, "%Y-%m-%d")
            except ValueError:
                continue

        if exp is None or strike is None:
            continue
        if not (min_expiry <= exp <= max_expiry):
            continue

        exp_date = exp.date()
        exp_s = exp.strftime("%Y-%m-%d")
        if exclude_strike_expiry is not None:
            ex_st, ex_e = exclude_strike_expiry
            if abs(float(strike) - float(ex_st)) < 0.02 and ex_e[:10] == exp_s[:10]:
                continue

        if min_strike is not None and strike < min_strike - 0.02:
            continue

        if earnings_within_window(next_earnings_date, exp_date):
            continue

        days_to_expiry = max((exp - today).days, 1)

        iv_raw = contract.get("implied_volatility")
        if iv_raw is None:
            iv_raw = raw.get("implied_volatility") if raw else None
        if iv_raw is None:
            iv_raw = contract.get("iv") or (raw.get("iv") if raw else None)
        iv = _iv_decimal(_float(iv_raw))
        if iv <= 0:
            continue

        delta = call_delta(current_price, strike, days_to_expiry, iv)
        if not (min_delta <= delta <= max_delta):
            continue

        bid = _float(contract.get("nbbo_bid"))
        ask = _float(contract.get("nbbo_ask") or contract.get("ask"))
        if ask is None or ask <= 0:
            continue
        if bid is None:
            bid = 0.0
        if bid <= 0:
            continue
        mid = (bid + ask) / 2
        spread_frac = (ask - bid) / mid if mid and mid > 0 else 1.0
        if spread_frac > CC_MAX_SPREAD_PCT:
            continue

        ann_yield = (bid / current_price) * (365 / days_to_expiry)
        if ann_yield < CC_MIN_ANNUALIZED_YIELD:
            continue

        otm_pct = (strike - current_price) / current_price * 100

        liquidity_note = None
        if CC_SPREAD_WIDE_NOTE_MIN_PCT <= spread_frac < CC_MAX_SPREAD_PCT:
            liquidity_note = (
                f"Spread is moderately wide — try a limit order at ${mid:.2f} "
                "and give it 10–15 minutes to fill before adjusting."
            )

        candidates.append(
            {
                "ticker": ticker,
                "current_price": current_price,
                "strike": strike,
                "expiry": exp_s,
                "days_to_expiry": days_to_expiry,
                "otm_pct": round(otm_pct, 1),
                "delta": round(delta, 3),
                "iv": round(iv * 100, 1),
                "iv_rank": iv_rank,
                "bid": round(bid, 4),
                "ask": round(ask, 4),
                "mid": round(mid, 4),
                "spread_pct": round(spread_frac * 100, 2),
                "liquidity_note": liquidity_note,
                "premium": round(bid, 4),
                "premium_bid": bid,
                "premium_ask": ask,
                "annualized_yield": round(ann_yield * 100, 1),
                "open_interest": contract.get("open_interest"),
                "earnings_safe": True,
            }
        )

    if not candidates:
        return None
    return max(candidates, key=lambda x: x["bid"])


def find_covered_call(
    ticker: str,
    current_price: float,
    options_chain: list[dict[str, Any]],
    iv_rank: float | None = None,
    next_earnings_date: str | None = None,
) -> dict[str, Any] | None:
    """
    Best covered call for Buy-tier display — uses optimal selection band (default 0.20–0.30 delta).
    """
    return find_optimal_covered_call(
        ticker,
        current_price,
        options_chain,
        iv_rank=iv_rank,
        next_earnings_date=next_earnings_date,
        min_delta=CC_SELECT_MIN_DELTA,
        max_delta=CC_SELECT_MAX_DELTA,
    )
