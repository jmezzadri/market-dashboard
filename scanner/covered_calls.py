"""Covered call screener — Greeks, IV gate, earnings avoidance, liquidity (Phase 2)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
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


def find_covered_call(
    ticker: str,
    current_price: float,
    options_chain: list[dict[str, Any]],
    iv_rank: float | None = None,
    next_earnings_date: str | None = None,
) -> dict[str, Any] | None:
    """
    Best covered call with delta/IV/spread/earnings gates.
    If iv_rank is below CC_MIN_IV_RANK, returns None (caller may attach cc_skip note).
    """
    if current_price <= 0 or not options_chain:
        return None

    if iv_rank is not None and iv_rank < CC_MIN_IV_RANK:
        return None

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    min_expiry = today + timedelta(days=CC_MIN_EXPIRY_DAYS)
    max_expiry = today + timedelta(days=CC_MAX_EXPIRY_DAYS)

    earnings_dt: datetime | None = None
    if next_earnings_date:
        try:
            earnings_dt = datetime.strptime(str(next_earnings_date).strip()[:10], "%Y-%m-%d")
        except ValueError:
            earnings_dt = None

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
        if earnings_dt:
            ed = earnings_dt.date()
            win_lo = ed - timedelta(days=7)
            win_hi = ed + timedelta(days=7)
            if win_lo <= exp_date <= win_hi:
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
        if not (CC_MIN_DELTA <= delta <= CC_MAX_DELTA):
            continue

        bid = _float(contract.get("nbbo_bid"))
        ask = _float(contract.get("nbbo_ask") or contract.get("ask"))
        if ask is None or ask <= 0:
            continue
        if bid is None:
            bid = 0.0
        mid = (bid + ask) / 2 if bid > 0 else ask
        spread_pct = (ask - bid) / mid if mid and mid > 0 else 1.0
        if spread_pct > CC_MAX_SPREAD_PCT:
            continue

        premium = bid if bid > 0 else ask * 0.97
        annualized_yield = (premium / current_price) * (365 / days_to_expiry)
        if annualized_yield < CC_MIN_ANNUALIZED_YIELD:
            continue

        otm_pct = (strike - current_price) / current_price * 100

        candidates.append(
            {
                "ticker": ticker,
                "current_price": current_price,
                "strike": strike,
                "expiry": exp.strftime("%Y-%m-%d"),
                "days_to_expiry": days_to_expiry,
                "otm_pct": round(otm_pct, 1),
                "delta": round(delta, 3),
                "iv": round(iv * 100, 1),
                "iv_rank": iv_rank,
                "premium": round(premium, 4),
                "premium_bid": bid,
                "premium_ask": ask,
                "spread_pct": round(spread_pct * 100, 1),
                "annualized_yield": round(annualized_yield * 100, 1),
                "open_interest": contract.get("open_interest"),
                "earnings_safe": True,
            }
        )

    if not candidates:
        return None
    return max(candidates, key=lambda x: x["annualized_yield"])
