"""
Options Signal — v2 Signal Intelligence engine.

Three components, summed (range −100 to +100):

  Directional premium z-score        ±50  Pan-Poteshman (2006), Hu (2014)
  IV skew (25-delta)                  ±25  Cremers-Weinbaum (2010)
  Premium magnitude z-score (signed)  ±25  confirmation overlay

CRITICAL: caller must pre-filter `flows` to **opening trades only** (UW
exposes a `type` field with values 'opening' / 'closing' / 'unknown').
Pan-Poteshman shows the predictive piece is opening-trade flow from end
customers, not market-making activity. Mixing in closing trades dilutes
the signal — v1 used raw premium and it shows.

The magnitude component is signed by the directional flow's sign — high
activity confirms the directional read; low activity dampens it. A
heavy-volume day with bullish directional flow scores positively on
magnitude; a thin-volume day with the same directional sign scores
negatively, reflecting weak conviction.

Returns None when no flows AND no IV data — Signal excluded from the
Magnitude rollup denominator.
"""

from __future__ import annotations

from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Component scaling — tunable in Phase D
# ─────────────────────────────────────────────────────────────────────────────

DIRECTIONAL_SCALE = 25.0     # 1σ → 25 points
DIRECTIONAL_MAX = 50.0       # ±50 cap

SKEW_SCALE = 5.0             # 1pp of skew → 5 points (so ±5pp saturates)
SKEW_MAX = 25.0              # ±25 cap

MAGNITUDE_SCALE = 12.0       # 1σ of total premium → 12 points (signed)
MAGNITUDE_MAX = 25.0         # ±25 cap


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _sign(v: float) -> int:
    return 1 if v > 0 else (-1 if v < 0 else 0)


def _net_directional(flows: list[dict[str, Any]]) -> float:
    """Net delta-adjusted premium = Σ(call_premium × call_delta) − Σ(put_premium × |put_delta|).

    Caller must pre-filter to opening trades.
    """
    total = 0.0
    for f in flows:
        otype = (f.get("option_type") or "").lower()
        prem = _f(f.get("premium"))
        delta = _f(f.get("delta"))
        if otype == "call":
            total += prem * delta
        elif otype == "put":
            total -= prem * abs(delta)
    return total


def _total_premium(flows: list[dict[str, Any]]) -> float:
    return sum(_f(f.get("premium")) for f in flows)


def _z(value: float, stats: dict[str, float] | None) -> float:
    """z-score = (value − mean) / sd. Returns 0 if stats missing or sd ≤ 0."""
    if not stats:
        return 0.0
    mean = _f(stats.get("mean"), 0.0)
    sd = _f(stats.get("sd"), 0.0)
    if sd <= 0:
        return 0.0
    return (value - mean) / sd


# ─────────────────────────────────────────────────────────────────────────────
# Options Signal
# ─────────────────────────────────────────────────────────────────────────────

def compute_options_signal(
    flows: list[dict[str, Any]] | None,
    rolling_directional: dict[str, float] | None = None,
    rolling_total: dict[str, float] | None = None,
    iv_snapshot: dict[str, float] | None = None,
) -> int | None:
    """
    Compute the Options Signal for one ticker.

    Args:
        flows: List of UW options flow rows (caller pre-filters to OPENING
            trades). Each row dict:
                option_type   (str)   — 'call' or 'put'
                premium       (float) — dollar premium
                delta         (float) — option delta (calls positive, puts neg)
                is_sweep      (bool)  — informational, not in score
        rolling_directional: {"mean": float, "sd": float} — 30-day rolling
            stats for net delta-adjusted premium for THIS ticker.
        rolling_total: {"mean": float, "sd": float} — 30-day rolling stats
            for total premium for THIS ticker.
        iv_snapshot: {"call_iv_25d": float, "put_iv_25d": float} — current
            25-delta IVs as DECIMALS (0.485 = 48.5%).

    Returns:
        Integer score in [−100, +100], or None if no flows AND no IV data.
    """
    flows = flows or []
    have_flows = len(flows) > 0
    have_iv = bool(
        iv_snapshot
        and iv_snapshot.get("call_iv_25d") is not None
        and iv_snapshot.get("put_iv_25d") is not None
    )

    if not have_flows and not have_iv:
        return None

    # ── Component 1: directional premium z-score ──────────────────────────────
    if have_flows and rolling_directional:
        net_dir = _net_directional(flows)
        z_dir = _z(net_dir, rolling_directional)
        directional_score = _clamp(
            z_dir * DIRECTIONAL_SCALE, -DIRECTIONAL_MAX, DIRECTIONAL_MAX
        )
        direction_sign = _sign(net_dir)
    else:
        net_dir = _net_directional(flows) if have_flows else 0.0
        directional_score = 0.0
        direction_sign = _sign(net_dir)

    # ── Component 2: IV skew (25-delta) ───────────────────────────────────────
    if have_iv:
        call_iv = _f(iv_snapshot.get("call_iv_25d"))
        put_iv = _f(iv_snapshot.get("put_iv_25d"))
        # Convert from decimal to percentage points. Inverted skew (calls
        # richer than puts) is bullish per Cremers-Weinbaum.
        skew_pp = (call_iv - put_iv) * 100.0
        skew_score = _clamp(skew_pp * SKEW_SCALE, -SKEW_MAX, SKEW_MAX)
    else:
        skew_score = 0.0

    # ── Component 3: premium magnitude z-score (signed by direction) ──────────
    if have_flows and rolling_total:
        total_prem = _total_premium(flows)
        z_total = _z(total_prem, rolling_total)
        # Signed: high magnitude amplifies directional read; low magnitude
        # dampens. If direction is flat, magnitude is unsignable → 0.
        magnitude_score = _clamp(
            z_total * MAGNITUDE_SCALE * direction_sign,
            -MAGNITUDE_MAX,
            MAGNITUDE_MAX,
        )
    else:
        magnitude_score = 0.0

    raw = directional_score + skew_score + magnitude_score
    return int(round(_clamp(raw, -100.0, 100.0)))
