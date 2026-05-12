"""
Congress Trades Signal — v5.

Spec (from v5 methodology):
    Number of unique congress members buying minus selling in last 90 days,
    weighted by trade size.
    Output: -100..+100. Source: UW /congress/recent-trades.
    Cache to congress_trades_daily Supabase table.

Implementation:
    Reads congress_trades_daily rows for ticker over CONGRESS_WINDOW_DAYS.
    Buys earn full tier-points; sells earn half (academic asymmetry).
    Cluster bonus on the buy side (3+/5+ unique buyers).

    Tier-point table mirrors v2 amount-bucket points (UW disclosure-bucket
    format). Sells weighted 0.5x per Cohen-Malloy-Pomorski-style asymmetry
    (politicians sell for many non-info reasons).

    Note on STOCK Act decay: this Signal carries lower informational weight
    in the v5 composite (intentional 1/6 equal weight is already a haircut
    relative to higher-information signals like insiders).

Returns sub_score = None when no buys AND no sells in window.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

import requests


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

CONGRESS_WINDOW_DAYS = 90

# Tier-point table (UW disclosure-bucket format)
AMOUNT_POINTS: dict[str, int] = {
    "$1,001 - $15,000":         2,
    "$15,001 - $50,000":        4,
    "$50,001 - $100,000":       7,
    "$100,001 - $250,000":     12,
    "$250,001 - $500,000":     18,
    "$500,001 - $1,000,000":   25,
    "$1,000,001 +":            30,
    # legacy variants seen in UW data
    "$1,001 - $15,001":         2,
    "$1,000 - $15,000":         2,
}

SELL_WEIGHT = 0.5
CLUSTER_HIGH = 5
CLUSTER_LOW = 3
CLUSTER_BONUS_HIGH = 15
CLUSTER_BONUS_LOW = 10

RAW_SCALE = 2.5             # raw points -> -100/+100 calibration


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _supa_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {"Authorization": f"Bearer {key}", "apikey": key}


def _supa_url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _fetch_window(ticker: str, score_date: date,
                  window_days: int = CONGRESS_WINDOW_DAYS) -> list[dict[str, Any]]:
    start = score_date - timedelta(days=window_days)
    url = f"{_supa_url()}/rest/v1/congress_trades_daily"
    params = [
        ("select", "*"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("transaction_date", f"gte.{start.isoformat()}"),
        ("transaction_date", f"lte.{score_date.isoformat()}"),
        ("limit", "500"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        return []
    return r.json() if r.text else []


def _is_buy(txn_type: str) -> bool:
    t = (txn_type or "").lower()
    return "buy" in t or "purchase" in t or t == "p"


def _is_sell(txn_type: str) -> bool:
    t = (txn_type or "").lower()
    return "sell" in t or "sale" in t or t == "s"


def _tier_points(bucket: str | None) -> int:
    return AMOUNT_POINTS.get((bucket or "").strip(), 0)


# ─────────────────────────────────────────────────────────────────────────────
# Pure scoring
# ─────────────────────────────────────────────────────────────────────────────

def compute_congress_signal(rows: list[dict[str, Any]]) -> tuple[int | None, dict[str, Any]]:
    """
    Compute the v5 Congress sub-score from a list of congress_trades_daily rows.

    Returns (sub_score, components).
    sub_score is None when the window is empty.
    """
    # 2026-05-12 Senior Quant fix. composite.py spec says "None = no data
    # for this signal". Previously we returned None when nobody in Congress
    # traded this ticker in 90 days — but that IS the data (zero activity,
    # not a coverage gap). The congress_trades_daily table is populated
    # for every disclosed trade across the full universe, so "empty window"
    # is a real observation, not missing data. Set sub_score = 0 with
    # diagnostic reason so the UI can show "0 — no congressional trades in
    # 90 days" instead of an ambiguous "—".
    if not rows:
        return 0, {"reason": "no_congress_activity_90d"}

    buys = [r for r in rows if _is_buy(r.get("transaction_type", ""))]
    sells = [r for r in rows if _is_sell(r.get("transaction_type", ""))]
    if not buys and not sells:
        return 0, {"reason": "no_congress_activity_90d"}

    buy_pts = sum(_tier_points(r.get("amount_bucket")) for r in buys)
    sell_pts = sum(_tier_points(r.get("amount_bucket")) for r in sells)

    unique_buyers = len({(r.get("member_name") or "").strip().lower()
                         for r in buys
                         if (r.get("member_name") or "").strip()})
    if unique_buyers >= CLUSTER_HIGH:
        cluster_bonus = CLUSTER_BONUS_HIGH
    elif unique_buyers >= CLUSTER_LOW:
        cluster_bonus = CLUSTER_BONUS_LOW
    else:
        cluster_bonus = 0

    raw = buy_pts - (sell_pts * SELL_WEIGHT) + cluster_bonus
    sub_score = int(round(_clamp(raw * RAW_SCALE, -100.0, 100.0)))

    components = {
        "buy_count": len(buys),
        "sell_count": len(sells),
        "unique_buyers": unique_buyers,
        "buy_tier_points": buy_pts,
        "sell_tier_points": sell_pts,
        "cluster_bonus": cluster_bonus,
        "raw": round(raw, 2),
    }
    return sub_score, components


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def score(ticker: str, score_date: date) -> dict[str, Any]:
    rows = _fetch_window(ticker, score_date, CONGRESS_WINDOW_DAYS)
    sub, components = compute_congress_signal(rows)
    diagnostic = {
        "ticker": ticker.upper(),
        "score_date": score_date.isoformat(),
        "window_days": CONGRESS_WINDOW_DAYS,
        "rows_pulled": len(rows),
    }
    return {"sub_score": sub, "components": components, "diagnostic": diagnostic}
