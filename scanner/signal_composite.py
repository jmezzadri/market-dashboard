"""
Signal Composite — bidirectional −100..+100 scoring engine.

Python port of market-dashboard/src/ticker/sectionComposites.js. Both paths
must produce identical numbers so the modal (in the dashboard) matches the
scanner's Buy Alert / Near Trigger tiering.

Why both: the legacy 0–100 score in scorer.py is bullish-only by design and
cannot represent bearish setups. The composite is the tiering driver now —
names only surface on Buy Alert / Near Trigger when the composite says so.
The legacy score is kept on the artifact for backward-compat sorting and
because parts of the report / email still display it.

Section weights (sum to 100):
    technicals 25, insider 25, options 20, congress 15, analyst 10, darkpool 5

Overall composite = weight-blended average of sections with non-null scores.

Tier bands (labelFromScore):
    ≥ 60  STRONG BULL     → Buy Alert
    ≥ 30  BULLISH         → Near Trigger
    ≥ 10  TILT BULL       → below threshold (no alert)
      … NEUTRAL (−10, 10)
    ≤ −10 TILT BEAR
    ≤ −30 BEARISH
    ≤ −60 STRONG BEAR
"""

from __future__ import annotations

import datetime as _dt
import math
from typing import Any

__all__ = [
    "SECTION_WEIGHTS",
    "SECTION_ORDER",
    "SCORE_BUY_ALERT_COMPOSITE",
    "SCORE_WATCH_ALERT_COMPOSITE",
    "compute_composite",
    "compute_sections",
    "direction_from_score",
    "label_from_score",
]

# ─────────────────────────────────────────────────────────────────────────────
# Constants — MUST mirror sectionComposites.js exactly
# ─────────────────────────────────────────────────────────────────────────────

SECTION_WEIGHTS: dict[str, int] = {
    "technicals": 25,
    "insider":    25,
    "options":    20,
    "congress":   15,
    "analyst":    10,
    "darkpool":    5,
}
# Verify: 25 + 25 + 20 + 15 + 10 + 5 = 100.

SECTION_ORDER: list[str] = ["technicals", "options", "insider", "congress", "analyst", "darkpool"]

# Tier thresholds — these name the COMPOSITE bands (labelFromScore).
SCORE_BUY_ALERT_COMPOSITE = 60     # STRONG BULL
SCORE_WATCH_ALERT_COMPOSITE = 30   # BULLISH

CONGRESS_AMOUNT_POINTS: dict[str, int] = {
    "$1,001 - $15,000":        2,
    "$15,001 - $50,000":       4,
    "$50,001 - $100,000":      7,
    "$100,001 - $250,000":    12,
    "$250,001 - $500,000":    18,
    "$500,001 - $1,000,000":  25,
    "$1,000,001 +":           30,
}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _sign(v: float) -> int:
    return 1 if v > 0 else (-1 if v < 0 else 0)


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def direction_from_score(s: int | None) -> str:
    if s is None:
        return "neutral"
    if s >= 30:
        return "bullish"
    if s <= -30:
        return "bearish"
    if s >= 10:
        return "tilt-bull"
    if s <= -10:
        return "tilt-bear"
    return "neutral"


def label_from_score(s: int | None) -> str:
    if s is None:
        return "NO DATA"
    if s >= 60:
        return "STRONG BULL"
    if s >= 30:
        return "BULLISH"
    if s >= 10:
        return "TILT BULL"
    if s <= -60:
        return "STRONG BEAR"
    if s <= -30:
        return "BEARISH"
    if s <= -10:
        return "TILT BEAR"
    return "NEUTRAL"


# ─────────────────────────────────────────────────────────────────────────────
# Per-section composites
# ─────────────────────────────────────────────────────────────────────────────

def _technicals_composite(tech: dict[str, Any] | None) -> int | None:
    """SCTR-style composite if present, else rescale legacy tech_score (×5)."""
    if not tech:
        return None
    comp = tech.get("composite")
    if isinstance(comp, dict) and isinstance(comp.get("score"), (int, float)):
        return int(round(_clamp(comp["score"], -100, 100)))
    ts = tech.get("tech_score")
    if isinstance(ts, (int, float)):
        return int(round(_clamp(ts * 5, -100, 100)))
    return None


def _options_composite(sc: dict[str, Any] | None,
                       flow_calls: list[dict[str, Any]] | None,
                       flow_puts: list[dict[str, Any]] | None) -> int | None:
    """Net premium skew + bullish/bearish mix + alert flow."""
    sc = sc or {}
    net_call = _f(sc.get("net_call_premium"))
    net_put = _f(sc.get("net_put_premium"))
    bull_pr = _f(sc.get("bullish_premium"))
    bear_pr = _f(sc.get("bearish_premium"))

    prem_score = 0.0
    skew = net_call - net_put
    if abs(skew) > 1:
        prem_score = _clamp(_sign(skew) * math.log10(abs(skew) + 1) * 10, -60, 60)

    mix_score = 0.0
    if bull_pr + bear_pr > 0:
        r = (bull_pr - bear_pr) / (bull_pr + bear_pr)
        mix_score = _clamp(r * 20, -20, 20)

    calls = flow_calls or []
    puts = flow_puts or []
    n_call = len(calls)
    n_put = len(puts)
    call_sweeps = sum(1 for f in calls if f.get("has_sweep"))
    put_sweeps = sum(1 for f in puts if f.get("has_sweep"))
    alert_score = _clamp(
        (n_call * 8) + (call_sweeps * 4) - (n_put * 8) - (put_sweeps * 4),
        -40, 40,
    )

    have_any_data = (bull_pr + bear_pr > 0) or (net_call or net_put) or n_call or n_put
    if not have_any_data:
        return None

    return int(round(_clamp(prem_score + mix_score + alert_score, -100, 100)))


def _insider_dollar(row: dict[str, Any]) -> float:
    return abs(_f(row.get("amount"))) * _f(row.get("stock_price"))


def _insider_composite(buys: list[dict[str, Any]] | None,
                       sells: list[dict[str, Any]] | None) -> int:
    """Log-scaled buy notional minus sell notional, officer ×1.5 multiplier."""
    qual_buys = [r for r in (buys or []) if _insider_dollar(r) >= 25_000]
    qual_sells = [r for r in (sells or []) if _insider_dollar(r) >= 25_000]

    if not qual_buys and not qual_sells:
        # Match JS: returns score=0 (not null) with "no data" note. A zero
        # does count in the weighted blend denominator; this is intentional —
        # absence of insider activity pulls a strong-tech-only composite
        # below the BULLISH threshold naturally.
        return 0

    buy_total = sum(_insider_dollar(r) for r in qual_buys)
    sell_total = sum(_insider_dollar(r) for r in qual_sells)
    has_off_buy = any(r.get("is_officer") for r in qual_buys)
    has_off_sell = any(r.get("is_officer") for r in qual_sells)
    unique_buyers = len({
        (r.get("owner_name") or "").strip().lower() for r in qual_buys
    })

    # Log-scaled notionals: $100k → ~1, $1M → 2, $10M → 3.
    buy_log = (math.log10(buy_total) - 5) if buy_total > 0 else 0
    sell_log = (math.log10(sell_total) - 5) if sell_total > 0 else 0
    net = (
        (buy_log * (1.5 if has_off_buy else 1))
        - (sell_log * (1.5 if has_off_sell else 1))
    )
    cluster = 15 if unique_buyers >= 5 else (8 if unique_buyers >= 3 else 0)
    raw = net * 30 + cluster
    return int(round(_clamp(raw, -100, 100)))


def _normalize_amounts(s: Any) -> str:
    return " ".join(str(s or "").split()).replace("–", "-").replace("—", "-")


def _congress_tier_pts(amounts: Any) -> int:
    k = _normalize_amounts(amounts)
    if not k:
        return 0
    if k in CONGRESS_AMOUNT_POINTS:
        return CONGRESS_AMOUNT_POINTS[k]
    nk = k.replace("$", "").replace(",", "").lower()
    for ak, pts in CONGRESS_AMOUNT_POINTS.items():
        if ak.replace("$", "").replace(",", "").lower() == nk:
            return pts
    return 0


def _congress_composite(buys: list[dict[str, Any]] | None,
                        sells: list[dict[str, Any]] | None) -> int:
    """Tier-weighted buys minus sells + unique-buyer cluster bonus."""
    b = buys or []
    s = sells or []
    if not b and not s:
        return 0

    buy_pts = sum(_congress_tier_pts(r.get("amounts")) for r in b)
    sell_pts = sum(_congress_tier_pts(r.get("amounts")) for r in s)
    unique_buyers = len({
        (r.get("name") or "").strip().lower() for r in b
    })
    cluster = 15 if unique_buyers >= 5 else (10 if unique_buyers >= 3 else 0)

    # Raw tier net + cluster → normalize so ~30 raw pts ≈ 100.
    raw = buy_pts - sell_pts + cluster
    return int(round(_clamp(raw * 3.3, -100, 100)))


def _analyst_composite(ratings: list[dict[str, Any]] | None,
                       current_price: float | None) -> int | None:
    """Rec mix (±30) + PT upside (curve capped −50/+60) + recent action momentum."""
    R = ratings or []
    if not R:
        return None

    BUY = {"buy", "strong_buy", "outperform", "overweight"}
    SELL = {"sell", "strong_sell", "underperform", "underweight"}
    HOLD = {"hold", "neutral", "equal_weight", "market_perform"}

    n_buy = n_hold = n_sell = 0
    for r in R:
        rec = str(r.get("recommendation") or "").lower()
        if rec in BUY:
            n_buy += 1
        elif rec in SELL:
            n_sell += 1
        elif rec in HOLD:
            n_hold += 1

    total = n_buy + n_hold + n_sell
    rec_mix = ((n_buy - n_sell) / total) * 30 if total > 0 else 0

    targets: list[float] = []
    for r in R:
        try:
            t = float(r.get("target"))
            if t > 0:
                targets.append(t)
        except (TypeError, ValueError):
            continue
    avg_pt = (sum(targets) / len(targets)) if targets else None

    upside = None
    if avg_pt is not None and current_price and current_price > 0:
        upside = ((avg_pt - current_price) / current_price) * 100

    pt_score = 0.0
    if upside is not None:
        pt_score = _clamp(upside * 1.1, -50, 60)

    # Recent action in 60-day window.
    action_score = 0
    now_ms = _dt.datetime.now(_dt.timezone.utc).timestamp() * 1000
    window_ms = 60 * 24 * 3600 * 1000
    for r in R:
        act = str(r.get("action") or "").lower()
        ts = r.get("timestamp")
        if not ts:
            continue
        try:
            t_ms = _dt.datetime.fromisoformat(
                str(ts).replace("Z", "+00:00")
            ).timestamp() * 1000
        except (TypeError, ValueError):
            continue
        if now_ms - t_ms > window_ms:
            continue
        if "upgrade" in act or "initiated_buy" in act:
            action_score += 5
        if "downgrade" in act or "initiated_sell" in act:
            action_score -= 5
    action_score = int(_clamp(action_score, -15, 15))

    return int(round(_clamp(rec_mix + pt_score + action_score, -100, 100)))


def _dark_pool_composite(sc: dict[str, Any] | None,
                         dp_rows: list[dict[str, Any]] | None) -> int:
    """Tiebreaker only — capped at ±20. Direction proxy via NBBO midpoint."""
    rows = dp_rows or []
    if not rows:
        return 0

    total_prem = sum(_f(r.get("premium")) for r in rows)

    bull_ct = 0
    bear_ct = 0
    for r in rows:
        bid = _f(r.get("nbbo_bid"))
        ask = _f(r.get("nbbo_ask"))
        p = _f(r.get("price"))
        if bid > 0 and ask > 0 and p > 0:
            mid = (bid + ask) / 2
            if p > mid:
                bull_ct += 1
            elif p < mid:
                bear_ct += 1

    mag_factor = min(1.0, math.log10(total_prem + 1) / 7)  # $10M ≈ 1.0
    dir_score = _clamp(_sign(bull_ct - bear_ct) * mag_factor * 14, -14, 14)

    rel_vol = _f((sc or {}).get("relative_volume"), 1.0)
    elevation = _clamp((rel_vol - 1) * 4, -6, 6)

    return int(round(_clamp(dir_score + elevation, -20, 20)))


# ─────────────────────────────────────────────────────────────────────────────
# Entry points
# ─────────────────────────────────────────────────────────────────────────────

def compute_sections(ticker: str, signals: dict[str, Any]) -> dict[str, int | None]:
    """
    Return per-section scores for a ticker: { section_name: score_or_None }.

    Pulls from:
        signals["screener"][ticker]      — screener row (options premium, price, rel_vol)
        signals["_technicals"][ticker]   — technicals dict (composite or tech_score)
        signals["_analyst_ratings"][ticker] — list of rating dicts
        signals[<signal_list>]           — filtered by ticker for flow / insider / congress / darkpool
    """
    T = ticker.upper()

    def _filt(key: str) -> list[dict[str, Any]]:
        return [
            r for r in (signals.get(key) or [])
            if (r.get("ticker") or "").upper() == T
        ]

    screener = signals.get("screener") or {}
    sc_row = (screener.get(T) if isinstance(screener, dict) else None) or {}

    techs = signals.get("_technicals") or {}
    tech = techs.get(T) if isinstance(techs, dict) else None

    ratings_map = signals.get("_analyst_ratings") or {}
    ratings = (ratings_map.get(T) if isinstance(ratings_map, dict) else None) or []

    current_price = _f(sc_row.get("close")) or _f(sc_row.get("prev_close")) or None

    return {
        "technicals": _technicals_composite(tech),
        "options":    _options_composite(sc_row, _filt("flow_alerts"), _filt("put_flow_alerts")),
        "insider":    _insider_composite(_filt("insider_buys"), _filt("insider_sales")),
        "congress":   _congress_composite(_filt("congress_buys"), _filt("congress_sells")),
        "analyst":    _analyst_composite(ratings, current_price),
        "darkpool":   _dark_pool_composite(sc_row, _filt("darkpool")),
    }


def compute_composite(ticker: str, signals: dict[str, Any]) -> int | None:
    """
    Return the overall signal composite (−100…+100) for a ticker, or None if
    no section has data.
    """
    sections = compute_sections(ticker, signals)

    w_sum = 0.0
    w_total = 0.0
    for key, score in sections.items():
        if score is None:
            continue
        weight = SECTION_WEIGHTS[key]
        w_sum += score * weight
        w_total += weight

    if w_total <= 0:
        return None
    return int(round(w_sum / w_total))
