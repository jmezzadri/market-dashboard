"""
Insider Activity Signal — v5.

Spec (from v5 methodology):
    Form 4 P-buys (positive), Form 4 S-sales excluding 10b5-1 plans
    (negative), magnitude as bps of market cap, first-buy classifier
    (no prior buy in 12 months) boosts weight.
    Output: -100..+100. Source: insider_history Supabase table.

Implementation reuses the v2 `compute_insider_signal` math (Cohen-Malloy-
Pomorski routine classification, Lakonishok-Lee officer multiplier,
cluster-sell trigger). The v5 wrapper:

  1. Pulls Form 4 rows from insider_history for ticker over INSIDER_WINDOW_DAYS.
  2. Excludes 10b5-1 plans (treated as routine).
  3. Computes magnitude as basis-points-of-market-cap (bps) for diagnostic.
  4. Applies first-buy boost (+10 to bull side if no prior P-buy in 365d).
  5. Returns the v5 contract: {sub_score, components, diagnostic}.

Insider weight cap-discount (per the v5 spec: $500M=100%, $50B=50%,
$500B=25%, log-linear) is applied at the COMPOSITE step in Phase 2 — this
module returns the un-discounted sub-score.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

import requests

from scanner.signal_intelligence_v2.insider import compute_insider_signal


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

INSIDER_WINDOW_DAYS = 30                # primary scoring window
FIRST_BUY_LOOKBACK_DAYS = 365           # 12-month "first buy" classifier
FIRST_BUY_BONUS = 10                    # added to bullish side when fires
FIRST_BUY_MAX_BUMP = 100                # cap remains [-100,+100]


# ─────────────────────────────────────────────────────────────────────────────
# Supabase data access (PostgREST)
# ─────────────────────────────────────────────────────────────────────────────

def _supa_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }


def _supa_url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _fetch_window(ticker: str, score_date: date,
                  window_days: int = INSIDER_WINDOW_DAYS) -> list[dict[str, Any]]:
    """Fetch all insider rows in [score_date - window_days, score_date]."""
    start = score_date - timedelta(days=window_days)
    url = f"{_supa_url()}/rest/v1/insider_history"
    params = [
        ("select", "ticker,transaction_date,transaction_code,amount,stock_price,"
                   "owner_name,is_officer,is_director,is_ten_percent_owner,"
                   "is_10b5_1,marketcap"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("transaction_date", f"gte.{start.isoformat()}"),
        ("transaction_date", f"lte.{score_date.isoformat()}"),
        ("limit", "500"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=15)
    if r.status_code >= 400:
        return []
    return r.json() if r.text else []


def _has_prior_p_buy(ticker: str, owner_name: str, gate_start: date,
                     lookback_days: int = FIRST_BUY_LOOKBACK_DAYS) -> bool:
    """True if owner has a P-buy in the prior `lookback_days` before gate_start."""
    if not owner_name:
        return True
    look_lo = gate_start - timedelta(days=lookback_days)
    url = f"{_supa_url()}/rest/v1/insider_history"
    params = [
        ("select", "id"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("owner_name_lower", f"eq.{owner_name.strip().lower()}"),
        ("transaction_code", "eq.P"),
        ("transaction_date", f"gte.{look_lo.isoformat()}"),
        ("transaction_date", f"lt.{gate_start.isoformat()}"),
        ("limit", "1"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        return True
    rows = r.json() if r.text else []
    return len(rows) > 0


# ─────────────────────────────────────────────────────────────────────────────
# Adapter: insider_history row -> v2 compute_insider_signal input
# ─────────────────────────────────────────────────────────────────────────────

def _row_to_v2(row: dict[str, Any], is_first_buy: bool) -> dict[str, Any]:
    """Map an insider_history row to the dict shape compute_insider_signal expects.

    10b5-1 sales are treated as routine (per v5 spec: 'excluding 10b5-1 plans').
    """
    is_routine = bool(row.get("is_10b5_1", False))
    return {
        "amount": int(row.get("amount") or 0),
        "stock_price": float(row.get("stock_price") or 0.0),
        "owner_name": row.get("owner_name") or "",
        "is_officer": bool(row.get("is_officer", False)),
        "is_routine": is_routine,
    }


def _bps_of_mcap(rows: list[dict[str, Any]], code: str) -> float | None:
    """Aggregate dollar value of `code` rows, expressed as bps of market cap."""
    rows_typed = [r for r in rows if (r.get("transaction_code") or "").upper() == code]
    if not rows_typed:
        return None
    notional = sum(
        abs(float(r.get("amount") or 0)) * float(r.get("stock_price") or 0.0)
        for r in rows_typed
    )
    mcap = next((float(r.get("marketcap") or 0) for r in rows_typed if r.get("marketcap")), 0.0)
    if mcap <= 0:
        return None
    return round((notional / mcap) * 10000.0, 4)  # bps


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def score(ticker: str, score_date: date) -> dict[str, Any]:
    """
    Compute v5 Insider Activity sub-score for a ticker on a date.

    Returns:
        {
            "sub_score":  int in [-100, +100] (None if no opportunistic activity),
            "components": {
                "buy_count": int,
                "sell_count": int,
                "buy_dollar_total": float,
                "sell_dollar_total": float,
                "buy_bps_of_mcap": float | None,
                "sell_bps_of_mcap": float | None,
                "first_buy_fires": bool,
                "v2_signal": int | None  # un-boosted v2 score
            },
            "diagnostic": {
                "ticker": str,
                "score_date": "YYYY-MM-DD",
                "window_days": int,
                "rows_pulled": int,
            }
        }
    """
    rows = _fetch_window(ticker, score_date, INSIDER_WINDOW_DAYS)

    buys = [r for r in rows if (r.get("transaction_code") or "").upper() == "P"]
    sells = [r for r in rows if (r.get("transaction_code") or "").upper() == "S"]

    # First-buy classifier — fires if any opportunistic buyer is a first-time buyer.
    gate_start = score_date - timedelta(days=INSIDER_WINDOW_DAYS)
    first_buy_fires = False
    if buys:
        opp_buyers = {(r.get("owner_name") or "").strip()
                      for r in buys
                      if not bool(r.get("is_10b5_1", False))}
        for owner in opp_buyers:
            if owner and not _has_prior_p_buy(ticker, owner, gate_start):
                first_buy_fires = True
                break

    v2_buys = [_row_to_v2(r, first_buy_fires) for r in buys]
    v2_sells = [_row_to_v2(r, False) for r in sells]
    v2_signal = compute_insider_signal(v2_buys, v2_sells)

    sub_score: int | None
    if v2_signal is None:
        sub_score = None
    else:
        boosted = v2_signal + (FIRST_BUY_BONUS if first_buy_fires and v2_signal > 0 else 0)
        sub_score = max(-FIRST_BUY_MAX_BUMP, min(FIRST_BUY_MAX_BUMP, boosted))

    components = {
        "buy_count": len(buys),
        "sell_count": len(sells),
        "buy_dollar_total": round(sum(
            abs(float(r.get("amount") or 0)) * float(r.get("stock_price") or 0.0)
            for r in buys), 2),
        "sell_dollar_total": round(sum(
            abs(float(r.get("amount") or 0)) * float(r.get("stock_price") or 0.0)
            for r in sells if not bool(r.get("is_10b5_1"))), 2),
        "buy_bps_of_mcap": _bps_of_mcap(rows, "P"),
        "sell_bps_of_mcap": _bps_of_mcap(rows, "S"),
        "first_buy_fires": first_buy_fires,
        "v2_signal": v2_signal,
    }
    diagnostic = {
        "ticker": ticker.upper(),
        "score_date": score_date.isoformat(),
        "window_days": INSIDER_WINDOW_DAYS,
        "rows_pulled": len(rows),
    }
    return {"sub_score": sub_score, "components": components, "diagnostic": diagnostic}
