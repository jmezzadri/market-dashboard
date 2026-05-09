"""
Congress Signal — v2 Signal Intelligence engine.

One signed score (range −100 to +100):

    raw = (Σ buy_tier_pts) − (Σ sell_tier_pts × 0.5) + cluster_bonus
    score = z-score normalization vs universe distribution × 25

Replaces v1's ×3.3 hack with proper z-score normalization. The ×3.3
scaling was a heuristic that fit the typical raw range to ±100 — works
well enough for typical names but fails on extreme tails. v2 normalizes
against the cross-sectional universe distribution so the score has a
calibrated statistical interpretation: +25 ≈ 1 standard deviation above
the universe mean (Moderate Bullish band on the 8-band scheme).

Sells weighted at 0.5 per academic literature (politicians sell for many
non-information reasons — diversification, taxes, lifestyle — the same
asymmetry as insider trades). Note: post-STOCK Act (2012) literature
shows congressional alpha has decayed substantially from Ziobrowski's
original headline. This Signal is intentionally weighted only 5% in the
v2 rollup; do not over-read it.

Cluster bonus on the buy side only (5+ unique buyers → +15, 3+ → +10).
The negative side scales naturally without a sell-side cluster — if four
politicians sell aggressively in a window, the raw points and z-score
already produce a strongly bearish reading.

Default 45-day window (matches STOCK Act disclosure lag). Phase D will
test 45 / 90 / 120.

Returns None when no buys AND no sells.
"""

from __future__ import annotations

from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Tier point table (UW disclosure-bucket format)
# ─────────────────────────────────────────────────────────────────────────────

CONGRESS_AMOUNT_POINTS: dict[str, int] = {
    "$1,001 - $15,000":        2,
    "$15,001 - $50,000":       4,
    "$50,001 - $100,000":      7,
    "$100,001 - $250,000":    12,
    "$250,001 - $500,000":    18,
    "$500,001 - $1,000,000":  25,
    "$1,000,001 +":           30,
}

CONGRESS_SELL_WEIGHT = 0.5             # academic asymmetry
CONGRESS_CLUSTER_HIGH = 5              # 5+ unique buyers
CONGRESS_CLUSTER_LOW = 3               # 3+ unique buyers
CONGRESS_CLUSTER_BONUS_HIGH = 15
CONGRESS_CLUSTER_BONUS_LOW = 10

CONGRESS_Z_SCALE = 25.0                # 1σ → 25 points
CONGRESS_FALLBACK_SCALE = 3.3          # v1 backup if rolling_stats absent


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _normalize_amounts(s: Any) -> str:
    """Strip whitespace, replace en-dash / em-dash with ASCII hyphen."""
    return " ".join(str(s or "").split()).replace("–", "-").replace("—", "-")


def _amount_pts(amounts: Any) -> int:
    """Map a UW amount-bucket string to tier points."""
    k = _normalize_amounts(amounts)
    if not k:
        return 0
    if k in CONGRESS_AMOUNT_POINTS:
        return CONGRESS_AMOUNT_POINTS[k]
    # Fuzzy fallback — strip $/, casing
    nk = k.replace("$", "").replace(",", "").lower()
    for ak, pts in CONGRESS_AMOUNT_POINTS.items():
        if ak.replace("$", "").replace(",", "").lower() == nk:
            return pts
    return 0


def compute_congress_signal(
    buys: list[dict[str, Any]] | None,
    sells: list[dict[str, Any]] | None,
    rolling_stats: dict[str, float] | None = None,
) -> int | None:
    """
    Compute the Congress Signal for one ticker.

    Args:
        buys: List of disclosed buy events in the lookback window. Each row:
            name     (str) — member name (used for clustering)
            amounts  (str) — UW bucket string (e.g., "$50,001 - $100,000")
        sells: Same shape, sell events.
        rolling_stats: {"mean": float, "sd": float} for raw points across
            the universe distribution. Falls back to v1's ×3.3 scaling
            (fallback maintained so this works in isolation, but Phase D
            calibration produces real stats).

    Returns:
        Integer score in [−100, +100], or None if no congressional activity.
    """
    buys = buys or []
    sells = sells or []

    if not buys and not sells:
        return None

    buy_pts = sum(_amount_pts(r.get("amounts")) for r in buys)
    sell_pts = sum(_amount_pts(r.get("amounts")) for r in sells)

    net = buy_pts - sell_pts * CONGRESS_SELL_WEIGHT

    # Cluster bonus on buys only
    unique_buyers = len({(r.get("name") or "").strip().lower() for r in buys})
    if unique_buyers >= CONGRESS_CLUSTER_HIGH:
        cluster = CONGRESS_CLUSTER_BONUS_HIGH
    elif unique_buyers >= CONGRESS_CLUSTER_LOW:
        cluster = CONGRESS_CLUSTER_BONUS_LOW
    else:
        cluster = 0

    raw = net + cluster

    # Normalize: z-score if stats provided, else fall back to v1 ×3.3
    if rolling_stats:
        mean = _f(rolling_stats.get("mean"), 0.0)
        sd = _f(rolling_stats.get("sd"), 0.0)
        if sd > 0:
            z = (raw - mean) / sd
            score = z * CONGRESS_Z_SCALE
        else:
            score = raw * CONGRESS_FALLBACK_SCALE
    else:
        score = raw * CONGRESS_FALLBACK_SCALE

    return int(round(_clamp(score, -100.0, 100.0)))
