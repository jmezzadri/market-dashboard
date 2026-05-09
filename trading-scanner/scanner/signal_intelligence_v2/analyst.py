"""
Analyst Signal — v2 Signal Intelligence engine.

Two components, summed (range −100 to +100):

  Action score (broker-tier-weighted)  ±50  Womack (1996), Barber-Lehavy-
                                            McNichols-Trueman (2001)
  Consensus PT change                  ±25  Brav-Lehavy (2003)

Replaces v1's three-component construction (rec-mix level signal +
asymmetric PT cap + recent action) with the academic version. Key
changes:

1. **Drop the rec-mix level signal entirely.** Womack and Barber show the
   predictive value is in CHANGES (upgrades, downgrades, initiations),
   not in the static distribution of buy/hold/sell ratings. v1 put 30 of
   its 100 points on the level — backwards.

2. **Score on consensus PT *change*, not static gap.** v1's "PT vs current
   price" is partly mechanical: when stock falls, target-upside
   automatically rises but that's not new information. v2 reads the
   change in the median consensus PT over the window — actual broker
   re-rating, not arithmetic.

3. **Symmetric PT cap** (v1 was −50/+60 — bullish bias baked in).

4. **Top-tier initiation bonus** (+10 / −10) for new coverage from major
   brokers (Loh-Stulz 2011 — top-tier broker calls are more influential).

Returns None when no actions AND no PT data.
"""

from __future__ import annotations

from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Action point table
# ─────────────────────────────────────────────────────────────────────────────

ACTION_POINTS: dict[str, int] = {
    "upgrade":                12,
    "downgrade":             -12,
    "initiation_buy":         12,
    "initiation_overweight":  12,
    "initiation_outperform":  12,
    "initiation_sell":       -12,
    "initiation_underweight":-12,
    "initiation_underperform":-12,
    # Hold initiations, maintained, reiterated → 0 (no directional change).
    "initiation_hold":         0,
    "initiation_neutral":      0,
    "maintained":              0,
    "reiterated":              0,
}

INITIATION_BONUS = 10  # +10 for top-tier bullish initiations, −10 for bearish

BROKER_TIER_WEIGHT: dict[str, float] = {
    "top":   1.0,
    "mid":   0.7,
    "small": 0.4,
}

ACTION_MAX = 50.0
PT_CHANGE_SCALE = 4.0    # 1pp consensus PT change → 4 points
PT_CHANGE_MAX = 25.0


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _is_initiation(action_type: str) -> bool:
    return action_type.startswith("initiation_")


def _is_directional_initiation(action_type: str) -> bool:
    """Initiation with a directional rating (not hold/neutral)."""
    return _is_initiation(action_type) and action_type not in (
        "initiation_hold",
        "initiation_neutral",
    )


def compute_analyst_signal(
    actions: list[dict[str, Any]] | None,
    pt_change_pct: float | None = None,
) -> int | None:
    """
    Compute the Analyst Signal for one ticker.

    Args:
        actions: List of rating-action events in the lookback window
            (default 30 days; caller is responsible for the window). Each row:
                action_type  (str) — see ACTION_POINTS keys
                broker_tier  (str) — 'top' / 'mid' / 'small'
            Maintained/reiterated/hold-initiations contribute 0 but DO count
            as having data (Signal returns 0, not None).
        pt_change_pct: % change in median consensus price target over the
            same window (e.g. +6.25 for a 6.25% raise). None if missing.

    Returns:
        Integer score in [−100, +100], or None if `actions` is empty/None
        AND `pt_change_pct` is None.
    """
    actions = actions or []
    have_actions = len(actions) > 0
    have_pt = pt_change_pct is not None

    if not have_actions and not have_pt:
        return None

    # ── Action score ──────────────────────────────────────────────────────────
    action_total = 0.0
    for a in actions:
        atype = (a.get("action_type") or "").lower()
        tier = (a.get("broker_tier") or "mid").lower()

        points = ACTION_POINTS.get(atype, 0)

        # Top-tier initiation bonus: +10 for bullish, −10 for bearish.
        # Only applies to DIRECTIONAL initiations (not hold/neutral).
        if _is_directional_initiation(atype) and tier == "top":
            points += INITIATION_BONUS if points > 0 else -INITIATION_BONUS

        weight = BROKER_TIER_WEIGHT.get(tier, 0.5)
        action_total += points * weight

    action_score = _clamp(action_total, -ACTION_MAX, ACTION_MAX)

    # ── Consensus PT change ───────────────────────────────────────────────────
    if have_pt:
        pt_score = _clamp(_f(pt_change_pct) * PT_CHANGE_SCALE, -PT_CHANGE_MAX, PT_CHANGE_MAX)
    else:
        pt_score = 0.0

    raw = action_score + pt_score
    return int(round(_clamp(raw, -100.0, 100.0)))
