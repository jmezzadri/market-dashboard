"""
Technicals Signal — v5.

Spec (from v5 methodology):
    Composite of:
      - Distance from 50-SMA
      - Distance from 200-SMA
      - RSI(14) bucketed:  >70 bearish, 30-40 bullish setup,
                            40-70 neutral, <30 bullish reversal
      - Bollinger BandWidth (squeeze = neutral but flagged)
      - Today's RVOL
    Output: -100..+100. Source: prices_eod (already populated).

Pure functions are exposed for unit testing — the score() entry point
pulls a 250-day price window from Supabase and feeds the math.
"""

from __future__ import annotations

import os
import statistics
from datetime import date, timedelta
from typing import Any, Sequence

import requests


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

PRICE_LOOKBACK_DAYS = 365            # ~250 trading days

# Component weights (sum to 100 with overshoot tolerance — final clamp [-100,+100])
SMA50_MAX = 25                       # ±25 — distance from 50-SMA
SMA200_MAX = 25                      # ±25 — distance from 200-SMA
RSI_MAX = 25                         # ±25 — RSI bucket score
BB_MAX = 10                          # ±10 — squeeze flagged but small
RVOL_MAX = 15                        # ±15 — confirmation overlay


# ─────────────────────────────────────────────────────────────────────────────
# Indicator math (pure)
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def sma(closes: Sequence[float], n: int) -> float | None:
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def rsi(closes: Sequence[float], n: int = 14) -> float | None:
    if len(closes) < n + 1:
        return None
    gains = []
    losses = []
    for i in range(1, n + 1):
        diff = closes[-i] - closes[-i - 1]
        if diff >= 0:
            gains.append(diff)
            losses.append(0.0)
        else:
            gains.append(0.0)
            losses.append(-diff)
    avg_gain = sum(gains) / n
    avg_loss = sum(losses) / n
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def bollinger_bandwidth(closes: Sequence[float], n: int = 20, k: float = 2.0) -> float | None:
    """Bollinger BandWidth = (upper - lower) / middle, expressed as a fraction."""
    if len(closes) < n:
        return None
    window = closes[-n:]
    mid = sum(window) / n
    if mid <= 0:
        return None
    sd = statistics.pstdev(window)
    return (2 * k * sd) / mid


def rvol(volumes: Sequence[float], n: int = 20) -> float | None:
    """Today's volume / mean of last n days."""
    if len(volumes) < n + 1:
        return None
    today = volumes[-1]
    avg = sum(volumes[-n - 1:-1]) / n
    if avg <= 0:
        return None
    return today / avg


# ─────────────────────────────────────────────────────────────────────────────
# Component scoring
# ─────────────────────────────────────────────────────────────────────────────

def _sma_distance_pts(close: float, sma_val: float | None, max_pts: int) -> float:
    """% above/below SMA, capped at ±20% saturating to ±max_pts."""
    if sma_val is None or sma_val <= 0:
        return 0.0
    pct = (close - sma_val) / sma_val
    return _clamp(pct * 5.0 * max_pts, -float(max_pts), float(max_pts))


def _rsi_bucket_pts(r: float | None) -> float:
    if r is None:
        return 0.0
    if r > 70:
        return -RSI_MAX                 # overbought / bearish
    if r >= 60:
        return -RSI_MAX * 0.4
    if r > 40:
        return 0.0                      # neutral
    if r >= 30:
        return RSI_MAX                  # bullish setup zone
    return RSI_MAX * 0.6                # < 30 — bullish reversal


def _bb_squeeze_pts(bw: float | None) -> float:
    """A tight Bollinger squeeze is neutral but flagged. Wide bands neutralize."""
    if bw is None:
        return 0.0
    # Squeeze (BW < 0.05) earns a small magnitude flag — sign comes from RSI
    # blend at the composite level. We surface the flag here as a small bias
    # toward the SMA-trend direction, but for v5 Phase 1 keep it neutral.
    return 0.0


def _rvol_pts(rv: float | None, sma200_above: bool | None) -> float:
    """RVOL confirms the trend if price is above/below SMA200.

    Above SMA200 + high RVOL = bullish confirmation.
    Below SMA200 + high RVOL = bearish confirmation.
    """
    if rv is None or sma200_above is None:
        return 0.0
    if rv < 1.0:
        return 0.0
    bullish_sign = 1.0 if sma200_above else -1.0
    pts = (rv - 1.0) * 7.0 * bullish_sign      # rvol=2.0, above SMA200 → +7
    return _clamp(pts, -RVOL_MAX, RVOL_MAX)


# ─────────────────────────────────────────────────────────────────────────────
# Public scoring (pure)
# ─────────────────────────────────────────────────────────────────────────────

def compute_technicals_signal(closes: Sequence[float],
                              volumes: Sequence[float]) -> tuple[int | None, dict[str, Any]]:
    """
    Compute the v5 Technicals sub-score from a price/volume window.

    Closes and volumes must be in chronological order, oldest first.
    Need ~200 closes to score all components; partial windows return None
    when SMA200 is unavailable AND no other component fires.

    Returns (sub_score, components).
    """
    if not closes or len(closes) < 30:
        return None, {"reason": "too_few_closes"}

    today_close = closes[-1]
    sma50 = sma(closes, 50)
    sma200 = sma(closes, 200)
    rsi14 = rsi(closes, 14)
    bw = bollinger_bandwidth(closes, 20)
    rv = rvol(volumes, 20) if volumes else None

    if sma50 is None and sma200 is None and rsi14 is None:
        return None, {"reason": "no_indicators_computable"}

    sma50_pts = _sma_distance_pts(today_close, sma50, SMA50_MAX)
    sma200_pts = _sma_distance_pts(today_close, sma200, SMA200_MAX)
    rsi_pts = _rsi_bucket_pts(rsi14)
    bb_pts = _bb_squeeze_pts(bw)
    sma200_above = (sma200 is not None and today_close > sma200)
    rv_pts = _rvol_pts(rv, sma200_above)

    raw = sma50_pts + sma200_pts + rsi_pts + bb_pts + rv_pts
    sub_score = int(round(_clamp(raw, -100.0, 100.0)))

    components = {
        "today_close": round(today_close, 4),
        "sma50": round(sma50, 4) if sma50 is not None else None,
        "sma200": round(sma200, 4) if sma200 is not None else None,
        "rsi14": round(rsi14, 2) if rsi14 is not None else None,
        "bb_bandwidth": round(bw, 4) if bw is not None else None,
        "rvol_20d": round(rv, 3) if rv is not None else None,
        "sma50_pts": round(sma50_pts, 2),
        "sma200_pts": round(sma200_pts, 2),
        "rsi_pts": round(rsi_pts, 2),
        "bb_pts": round(bb_pts, 2),
        "rvol_pts": round(rv_pts, 2),
    }
    return sub_score, components


# ─────────────────────────────────────────────────────────────────────────────
# Supabase data layer
# ─────────────────────────────────────────────────────────────────────────────

def _supa_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {"Authorization": f"Bearer {key}", "apikey": key}


def _supa_url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _fetch_prices(ticker: str, score_date: date) -> tuple[list[float], list[float]]:
    """Return (closes, volumes) chronologically, oldest first."""
    start = score_date - timedelta(days=PRICE_LOOKBACK_DAYS)
    url = f"{_supa_url()}/rest/v1/prices_eod"
    params = [
        ("select", "trade_date,close,volume"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("trade_date", f"gte.{start.isoformat()}"),
        ("trade_date", f"lte.{score_date.isoformat()}"),
        ("order", "trade_date.asc"),
        ("limit", "400"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=20)
    if r.status_code >= 400:
        return [], []
    rows = r.json() if r.text else []
    closes = [float(row["close"]) for row in rows if row.get("close") is not None]
    volumes = [float(row["volume"] or 0) for row in rows]
    return closes, volumes


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def score(ticker: str, score_date: date) -> dict[str, Any]:
    closes, volumes = _fetch_prices(ticker, score_date)
    sub, components = compute_technicals_signal(closes, volumes)
    diagnostic = {
        "ticker": ticker.upper(),
        "score_date": score_date.isoformat(),
        "lookback_days": PRICE_LOOKBACK_DAYS,
        "closes_pulled": len(closes),
    }
    return {"sub_score": sub, "components": components, "diagnostic": diagnostic}
