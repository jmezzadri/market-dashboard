"""
Short Interest Signal — v5.

Spec (from v5 methodology, bidirectional):

  Regime A — Bearish:
    Rising SI + rising CTB on a stock above 50-SMA = bearish
    (smart money positioning against an uptrend)

  Regime B — Squeeze setup (bullish):
    High SI (>30% of float) + cheap CTB into earnings (within 14 days)
    = bullish (squeeze setup)

  Regime C — Capitulation (bullish):
    Falling SI + rising price = bullish (short capitulation)

Source: short_interest (FINRA bi-monthly) + short_interest_daily
(UW continuous CTB / borrow / FTD / volume-ratio).

Per the SHORT_INTEREST_DATA_FEED_DESIGN.md:
  - FINRA settlements are the gold standard for SI level (lag ~8 BD).
  - UW continuous fills the gaps with CTB, borrow availability, daily SVR.
  - The UW /shorts/{ticker}/interest-float endpoint is STALE — do NOT use.

Returns sub_score = None when no SI data exists for the ticker.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

import requests


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

FINRA_LOOKBACK_DAYS = 90              # for delta calculations
DAILY_LOOKBACK_DAYS = 60              # CTB/borrow rolling window
PRICE_LOOKBACK_DAYS = 90              # for trend + capitulation detection
EARNINGS_PROXIMITY_DAYS = 14          # squeeze-setup window

HIGH_SI_THRESHOLD = 30.0              # % of float
RISING_SI_THRESHOLD_PP = 2.0          # pp delta over latest two settlements
RISING_CTB_THRESHOLD_PP = 1.0         # pp delta in CTB over 30 days
CHEAP_CTB_THRESHOLD = 5.0             # CTB% — below this = "cheap" borrow

REGIME_BEAR_MAX = -65
REGIME_SQUEEZE_BULL_MAX = +75
REGIME_CAPITULATION_BULL_MAX = +50


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


def _fetch_finra(ticker: str, score_date: date,
                 lookback_days: int = FINRA_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    start = score_date - timedelta(days=lookback_days)
    url = f"{_supa_url()}/rest/v1/short_interest"
    params = [
        ("select", "*"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("as_of_date", f"gte.{start.isoformat()}"),
        ("as_of_date", f"lte.{score_date.isoformat()}"),
        ("source", "eq.finra"),
        ("order", "as_of_date.desc"),
        ("limit", "20"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        return []
    return r.json() if r.text else []


def _fetch_daily(ticker: str, score_date: date,
                 lookback_days: int = DAILY_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    start = score_date - timedelta(days=lookback_days)
    url = f"{_supa_url()}/rest/v1/short_interest_daily"
    params = [
        ("select", "*"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("as_of_date", f"gte.{start.isoformat()}"),
        ("as_of_date", f"lte.{score_date.isoformat()}"),
        ("order", "as_of_date.desc"),
        ("limit", "100"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        return []
    return r.json() if r.text else []


def _fetch_prices(ticker: str, score_date: date,
                  lookback_days: int = PRICE_LOOKBACK_DAYS) -> list[dict[str, Any]]:
    start = score_date - timedelta(days=lookback_days)
    url = f"{_supa_url()}/rest/v1/prices_eod"
    params = [
        ("select", "trade_date,close"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("trade_date", f"gte.{start.isoformat()}"),
        ("trade_date", f"lte.{score_date.isoformat()}"),
        ("order", "trade_date.asc"),
        ("limit", "200"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        return []
    return r.json() if r.text else []


# ─────────────────────────────────────────────────────────────────────────────
# Pure scoring
# ─────────────────────────────────────────────────────────────────────────────

def compute_short_interest_signal(
    finra_rows: list[dict[str, Any]],
    daily_rows: list[dict[str, Any]],
    closes: list[float],
    days_to_earnings: int | None = None,
) -> tuple[int | None, dict[str, Any]]:
    """
    Compute v5 Short Interest sub-score from raw inputs.

    finra_rows: most-recent-first list of short_interest (source='finra').
    daily_rows: most-recent-first list of short_interest_daily.
    closes: chronological prices oldest->newest for the ticker.
    days_to_earnings: int | None — None means no upcoming earnings flag.

    Returns (sub_score, components). None when no SI data at all.
    """
    if not finra_rows and not daily_rows:
        return None, {"reason": "no_si_data"}

    # ── Pull the latest readings ─────────────────────────────────────────────
    # v5.4: short_interest_float_pct is NULL on every row in production
    # because the FINRA ingest never computes it. Derive on the fly from
    # short_interest_shares / float_shares (or shares_outstanding as
    # fallback) so the scorer actually reflects the underlying data.
    def _si_pct(row):
        if row is None:
            return None
        precomputed = row.get("short_interest_float_pct")
        if precomputed is not None:
            try:
                v = float(precomputed)
                if v > 0:
                    return v
            except (TypeError, ValueError):
                pass
        shares = row.get("short_interest_shares")
        float_sh = row.get("float_shares") or row.get("shares_outstanding")
        try:
            shares = float(shares) if shares is not None else None
            float_sh = float(float_sh) if float_sh is not None else None
        except (TypeError, ValueError):
            return None
        if shares is None or not float_sh or float_sh <= 0:
            return None
        return (shares / float_sh) * 100.0   # percent of float

    latest_si_pct = None
    prev_si_pct = None
    rising_si_pp = None
    if finra_rows:
        latest_si_pct = _si_pct(finra_rows[0])
        if len(finra_rows) > 1:
            prev_si_pct = _si_pct(finra_rows[1])
        if latest_si_pct is not None and prev_si_pct is not None:
            rising_si_pp = latest_si_pct - prev_si_pct

    latest_ctb = None
    prev_ctb = None
    rising_ctb_pp = None
    if daily_rows:
        for r in daily_rows:
            v = r.get("cost_to_borrow_pct")
            if v is not None:
                try:
                    latest_ctb = float(v)
                    break
                except (TypeError, ValueError):
                    continue
        # Find a CTB ~30d earlier
        if len(daily_rows) > 20:
            for r in daily_rows[20:40]:
                v = r.get("cost_to_borrow_pct")
                if v is not None:
                    try:
                        prev_ctb = float(v)
                        break
                    except (TypeError, ValueError):
                        continue
        if latest_ctb is not None and prev_ctb is not None:
            rising_ctb_pp = latest_ctb - prev_ctb

    # ── Trend signals on the price series ────────────────────────────────────
    above_50sma = None
    rising_price = None
    if len(closes) >= 50:
        sma50 = sum(closes[-50:]) / 50
        above_50sma = closes[-1] > sma50
    if len(closes) >= 21:
        rising_price = closes[-1] > closes[-21]      # ~1 month rising

    # ── Regime classifier ────────────────────────────────────────────────────
    regime = "neutral"
    raw_pts = 0.0

    # Regime A — Bearish: rising SI + rising CTB + above 50-SMA
    bear_a = (
        rising_si_pp is not None and rising_si_pp >= RISING_SI_THRESHOLD_PP
        and rising_ctb_pp is not None and rising_ctb_pp >= RISING_CTB_THRESHOLD_PP
        and above_50sma is True
    )
    if bear_a:
        regime = "bearish_smart_money"
        raw_pts = float(REGIME_BEAR_MAX)

    # Regime B — Squeeze setup: high SI + cheap CTB + earnings within 14d
    squeeze_b = (
        latest_si_pct is not None and latest_si_pct >= HIGH_SI_THRESHOLD
        and latest_ctb is not None and latest_ctb <= CHEAP_CTB_THRESHOLD
        and days_to_earnings is not None and 0 <= days_to_earnings <= EARNINGS_PROXIMITY_DAYS
    )
    if squeeze_b:
        regime = "squeeze_setup"
        # Stronger when CTB is very cheap and SI is very high
        si_excess = latest_si_pct - HIGH_SI_THRESHOLD
        si_bonus = min(15.0, si_excess * 0.5)
        raw_pts = float(REGIME_SQUEEZE_BULL_MAX) - si_bonus + si_bonus  # cap at 75
        raw_pts = min(raw_pts + si_bonus, float(REGIME_SQUEEZE_BULL_MAX))

    # Regime C — Capitulation: falling SI + rising price
    capitulation_c = (
        rising_si_pp is not None and rising_si_pp <= -1.0
        and rising_price is True
    )
    if capitulation_c and not bear_a and not squeeze_b:
        regime = "capitulation"
        raw_pts = float(REGIME_CAPITULATION_BULL_MAX)

    # Soft fallback: high SI alone (no other regime fired)
    if regime == "neutral" and latest_si_pct is not None:
        if latest_si_pct >= HIGH_SI_THRESHOLD:
            regime = "elevated_si_neutral"
            raw_pts = -15.0          # high SI w/o squeeze setup leans bear
        elif latest_si_pct >= 15.0:
            regime = "moderate_si_neutral"
            raw_pts = -5.0

    sub_score = int(round(_clamp(raw_pts, -100.0, 100.0)))

    components = {
        "latest_si_pct_of_float": latest_si_pct,
        "prev_si_pct_of_float": prev_si_pct,
        "rising_si_pp": rising_si_pp,
        "latest_ctb_pct": latest_ctb,
        "prev_ctb_pct": prev_ctb,
        "rising_ctb_pp": rising_ctb_pp,
        "above_50sma": above_50sma,
        "rising_price_21d": rising_price,
        "days_to_earnings": days_to_earnings,
        "regime": regime,
    }
    return sub_score, components


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def score(ticker: str, score_date: date,
          days_to_earnings: int | None = None) -> dict[str, Any]:
    finra = _fetch_finra(ticker, score_date)
    daily = _fetch_daily(ticker, score_date)
    price_rows = _fetch_prices(ticker, score_date)
    closes = [float(r["close"]) for r in price_rows if r.get("close") is not None]
    sub, components = compute_short_interest_signal(
        finra, daily, closes, days_to_earnings=days_to_earnings,
    )
    diagnostic = {
        "ticker": ticker.upper(),
        "score_date": score_date.isoformat(),
        "finra_rows": len(finra),
        "daily_rows": len(daily),
        "closes_pulled": len(closes),
    }
    return {"sub_score": sub, "components": components, "diagnostic": diagnostic}
