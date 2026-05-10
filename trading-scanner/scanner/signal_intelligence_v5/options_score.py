"""
Options Flow Signal — v5.

Spec (from v5 methodology):
    Call premium $ vs Put premium $ ratio in last 30 days, sweep direction
    (ask = bullish, bid = bearish), unusual contract size.
    Output: -100..+100. Source: Unusual Whales /option-trades/flow-alerts.
    Cache to options_flow_daily Supabase table.

Implementation:

  Reads the most recent options_flow_daily row for `ticker` (populated by
  OPTIONS_FLOW_INGEST_DAILY workflow). Falls back to None if absent.

  Three sub-components, equal-weighted, summed and clamped to [-100, +100]:

    1. Call/Put premium ratio        ±50  (log10 of call/put $ ratio)
    2. Ask-side bullish skew         ±30  ((ask - bid) / total premium)
    3. Unusual / sweep activity      ±20  (signed by directional sign)

The producer-side ingest applies UW's `type=opening` filter where
available (Pan-Poteshman 2006 — predictive flow is opening end-customer
activity, not closing or market-maker prints).

Returns sub_score = None when call_premium AND put_premium are both 0.
"""

from __future__ import annotations

import math
import os
from datetime import date
from typing import Any

import requests


# ─────────────────────────────────────────────────────────────────────────────
# Component scaling
# ─────────────────────────────────────────────────────────────────────────────

# Component 1: log10(call$ / put$)
PREMIUM_RATIO_SCALE = 25.0       # 1 dex of imbalance → +25 points
PREMIUM_RATIO_MAX = 50.0         # ±50 cap

# Component 2: (ask - bid) / total premium
ASK_BIAS_SCALE = 60.0            # 50pp ask-skew → +30 points
ASK_BIAS_MAX = 30.0              # ±30 cap

# Component 3: unusual + sweep, signed by directional sign
UNUSUAL_SCALE = 4.0              # 5 sweep+unusual events → +20
UNUSUAL_MAX = 20.0               # ±20 cap


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _f(v: Any) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _supa_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }


def _supa_url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _fetch_latest(ticker: str, score_date: date) -> dict[str, Any] | None:
    """Most recent options_flow_daily row for ticker on or before score_date."""
    url = f"{_supa_url()}/rest/v1/options_flow_daily"
    params = [
        ("select", "*"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("as_of_date", f"lte.{score_date.isoformat()}"),
        ("order", "as_of_date.desc"),
        ("limit", "1"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        return None
    rows = r.json() if r.text else []
    return rows[0] if rows else None


# ─────────────────────────────────────────────────────────────────────────────
# Pure scoring (testable without Supabase)
# ─────────────────────────────────────────────────────────────────────────────

def compute_options_signal(snapshot: dict[str, Any] | None) -> tuple[int | None, dict[str, Any]]:
    """
    Compute the v5 Options Flow sub-score from a snapshot dict.

    Snapshot keys (any subset; missing → 0):
        call_premium, put_premium,
        ask_side_premium, bid_side_premium,
        sweep_count, unusual_count

    Returns (sub_score, components_dict).
    sub_score is None if no flow at all.
    """
    if not snapshot:
        return None, {"reason": "no_snapshot"}

    call_p = _f(snapshot.get("call_premium"))
    put_p = _f(snapshot.get("put_premium"))
    ask_p = _f(snapshot.get("ask_side_premium"))
    bid_p = _f(snapshot.get("bid_side_premium"))
    sweep_n = _f(snapshot.get("sweep_count"))
    unusual_n = _f(snapshot.get("unusual_count"))

    if call_p <= 0 and put_p <= 0:
        return None, {"reason": "no_flow"}

    # 1. Premium ratio (log10)
    if call_p > 0 and put_p > 0:
        ratio_log = math.log10(call_p / put_p)
    elif call_p > 0:
        ratio_log = 1.5  # all calls — saturate bullish
    else:
        ratio_log = -1.5  # all puts — saturate bearish
    ratio_pts = _clamp(ratio_log * PREMIUM_RATIO_SCALE, -PREMIUM_RATIO_MAX, PREMIUM_RATIO_MAX)

    # 2. Ask-side bias
    total = ask_p + bid_p
    if total > 0:
        ask_bias = (ask_p - bid_p) / total       # in [-1, +1]
    else:
        ask_bias = 0.0
    ask_pts = _clamp(ask_bias * ASK_BIAS_SCALE, -ASK_BIAS_MAX, ASK_BIAS_MAX)

    # 3. Unusual + sweeps, signed
    direction_sign = 1.0 if ratio_pts > 0 else (-1.0 if ratio_pts < 0 else 0.0)
    unusual_raw = (sweep_n + unusual_n) * direction_sign
    unusual_pts = _clamp(unusual_raw * UNUSUAL_SCALE, -UNUSUAL_MAX, UNUSUAL_MAX)

    raw = ratio_pts + ask_pts + unusual_pts
    sub_score = int(round(_clamp(raw, -100.0, 100.0)))

    components = {
        "call_premium": call_p,
        "put_premium": put_p,
        "ask_side_premium": ask_p,
        "bid_side_premium": bid_p,
        "ratio_log10": round(ratio_log, 4),
        "ask_bias": round(ask_bias, 4),
        "sweep_count": int(sweep_n),
        "unusual_count": int(unusual_n),
        "ratio_pts": round(ratio_pts, 2),
        "ask_pts": round(ask_pts, 2),
        "unusual_pts": round(unusual_pts, 2),
    }
    return sub_score, components


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def score(ticker: str, score_date: date) -> dict[str, Any]:
    """v5 contract: {sub_score, components, diagnostic}."""
    snap = _fetch_latest(ticker, score_date)
    sub, components = compute_options_signal(snap)
    diagnostic = {
        "ticker": ticker.upper(),
        "score_date": score_date.isoformat(),
        "snapshot_date": snap.get("as_of_date") if snap else None,
        "snapshot_present": snap is not None,
    }
    return {"sub_score": sub, "components": components, "diagnostic": diagnostic}
