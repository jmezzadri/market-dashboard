"""
Analyst Ratings Signal — v5.

Spec (from v5 methodology):
    Net upgrades minus downgrades in last 90 days, weighted by analyst tier.
    Average price target vs spot (>15% above = bullish, >15% below = bearish).
    Output: -100..+100. Source: UW /screener/analysts.
    Cache to analyst_ratings_daily Supabase table.

Implementation (two components, summed):
    1. Action score (broker-tier-weighted)  ±60  Womack 1996, Barber et al 2001
    2. Consensus PT vs spot (gap-based)     ±40  Brav-Lehavy 2003 baseline

Note vs v2: v5 spec calls out "PT vs spot" (gap), v2 used PT change. The
v5 caller may not always have prev_target wired (UW data layer hasn't
populated change history yet) so gap-based is the conservative ship —
we keep change-based scoring available for Phase 2.

Returns sub_score = None when there are no actions AND no PT data.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

import requests


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

ANALYST_WINDOW_DAYS = 90

ACTION_POINTS: dict[str, int] = {
    "upgrade": 12,
    "downgrade": -12,
    "upgraded": 12,
    "downgraded": -12,
    "initiated": 6,                  # neutral default for ambiguous initiations
    "initiation_buy": 12,
    "initiation_overweight": 12,
    "initiation_outperform": 12,
    "initiation_sell": -12,
    "initiation_underweight": -12,
    "initiation_underperform": -12,
    "initiation_hold": 0,
    "initiation_neutral": 0,
    "maintained": 0,
    "reiterated": 0,
}

# Initiation/recommendation overrides — when action == 'initiated' but
# the recommendation field tells us the direction, use the rec to refine.
RECOMMENDATION_INITIATION_DELTA: dict[str, int] = {
    "buy": 6,
    "overweight": 6,
    "outperform": 6,
    "sell": -6,
    "underweight": -6,
    "underperform": -6,
    "hold": 0,
    "neutral": 0,
}

BROKER_TIER_WEIGHT: dict[str, float] = {
    "top": 1.0,
    "major": 0.7,
    "other": 0.5,
}

ACTION_MAX = 60.0
ACTION_SCALE = 3.0           # ~20 effective rating events saturate

PT_BULL_THRESHOLD = 0.15     # >15% above spot saturates bull
PT_BEAR_THRESHOLD = -0.15    # >15% below spot saturates bear
PT_MAX = 40.0
PT_SCALE = 40.0 / 0.15       # ±15% gap → ±40 pts


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
                  window_days: int = ANALYST_WINDOW_DAYS) -> list[dict[str, Any]]:
    start = score_date - timedelta(days=window_days)
    url = f"{_supa_url()}/rest/v1/analyst_ratings_daily"
    params = [
        ("select", "*"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("action_date", f"gte.{start.isoformat()}"),
        ("action_date", f"lte.{score_date.isoformat()}"),
        ("limit", "200"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        return []
    return r.json() if r.text else []


def _fetch_spot(ticker: str, score_date: date) -> float | None:
    """Most recent close for the ticker on or before score_date."""
    cutoff_lo = score_date - timedelta(days=14)
    url = f"{_supa_url()}/rest/v1/prices_eod"
    params = [
        ("select", "trade_date,close"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("trade_date", f"gte.{cutoff_lo.isoformat()}"),
        ("trade_date", f"lte.{score_date.isoformat()}"),
        ("order", "trade_date.desc"),
        ("limit", "1"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        return None
    rows = r.json() if r.text else []
    if not rows:
        return None
    try:
        return float(rows[0]["close"])
    except (KeyError, TypeError, ValueError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Pure scoring
# ─────────────────────────────────────────────────────────────────────────────

def _action_pts(row: dict[str, Any]) -> float:
    a = (row.get("action") or "").strip().lower()
    base = ACTION_POINTS.get(a, 0)
    if a == "initiated":
        rec = (row.get("recommendation") or "").strip().lower()
        base += RECOMMENDATION_INITIATION_DELTA.get(rec, 0)
    tier = (row.get("broker_tier") or "other").strip().lower()
    return base * BROKER_TIER_WEIGHT.get(tier, 0.5)


def compute_analyst_signal(rows: list[dict[str, Any]],
                           spot: float | None) -> tuple[int | None, dict[str, Any]]:
    """
    Compute the v5 Analyst sub-score.

    rows: analyst_ratings_daily rows in the lookback window.
    spot: most recent close for the ticker (None → PT component skipped).

    Returns (sub_score, components). None when no actions AND no PT data.
    """
    if not rows and spot is None:
        return None, {"reason": "no_data"}

    # 1. Action component + v5.3 breakdown counts so the modal tile can
    # show "5 upgrades · 1 downgrade" instead of just "X actions".
    up_count = down_count = init_count = maintained_count = 0
    if rows:
        per_row = [_action_pts(r) for r in rows]
        action_raw = sum(per_row)
        action_pts = _clamp(action_raw * ACTION_SCALE, -ACTION_MAX, ACTION_MAX)
        for r, pts in zip(rows, per_row):
            a = (r.get("action") or "").strip().lower()
            if a == "upgraded":
                up_count += 1
            elif a == "downgraded":
                down_count += 1
            elif a == "initiated":
                init_count += 1
            elif a in ("maintained", "reiterated"):
                maintained_count += 1
            else:
                # Fallback: classify by the points contribution sign.
                if pts > 0:
                    up_count += 1
                elif pts < 0:
                    down_count += 1
                else:
                    maintained_count += 1
    else:
        action_raw = 0.0
        action_pts = 0.0

    # 2. PT vs spot
    pt_pts = 0.0
    avg_pt = None
    pt_gap = None
    if spot is not None and rows:
        targets = [r.get("target_price") for r in rows if r.get("target_price") is not None]
        targets = [float(t) for t in targets if t is not None]
        if targets and spot > 0:
            avg_pt = sum(targets) / len(targets)
            pt_gap = (avg_pt - spot) / spot
            pt_pts = _clamp(pt_gap * PT_SCALE, -PT_MAX, PT_MAX)

    if not rows and pt_pts == 0.0 and spot is None:
        return None, {"reason": "no_actions_no_pt"}

    raw = action_pts + pt_pts
    sub_score = int(round(_clamp(raw, -100.0, 100.0)))

    components = {
        "action_count": len(rows),
        "upgrades": up_count,
        "downgrades": down_count,
        "initiations": init_count,
        "maintained": maintained_count,
        "action_raw_points": round(action_raw, 2),
        "action_pts": round(action_pts, 2),
        "spot": round(spot, 2) if spot is not None else None,
        "avg_target": round(avg_pt, 2) if avg_pt is not None else None,
        "pt_gap_pct": round(pt_gap * 100, 2) if pt_gap is not None else None,
        "pt_pts": round(pt_pts, 2),
    }
    return sub_score, components


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def score(ticker: str, score_date: date) -> dict[str, Any]:
    rows = _fetch_window(ticker, score_date, ANALYST_WINDOW_DAYS)
    spot = _fetch_spot(ticker, score_date)
    sub, components = compute_analyst_signal(rows, spot)
    diagnostic = {
        "ticker": ticker.upper(),
        "score_date": score_date.isoformat(),
        "window_days": ANALYST_WINDOW_DAYS,
        "rows_pulled": len(rows),
        "spot_present": spot is not None,
    }
    return {"sub_score": sub, "components": components, "diagnostic": diagnostic}
