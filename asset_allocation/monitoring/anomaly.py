"""
monitoring.anomaly — post-pipeline anomaly detection.

Compares the new allocation against the previously-published one. Flags
suspicious changes that an operator should review BEFORE the new output
is trusted in production.

Flags don't halt the run — they surface in the run log + email alert.
The operator decides whether to keep the new allocation or roll back to
last-known-good.

Anomaly types:
  - rating_skip: a bucket jumped >2 rating tiers in one rebalance
  - stance_flip: stance changed from Aggressive to Defensive (or vice
    versa) in a single rebalance without R&L move > 20 points
  - leverage_discontinuity: leverage changed by > 0.3x in a single rebalance
  - mass_reshuffling: > 4 buckets had their rating changed
  - extreme_alpha: alpha > 1.4 or < 0.6 (unusual for normal regimes)
  - unexpected_regime_flip: regime_flip activated without R&L change > 10
"""

from __future__ import annotations

from typing import Any

TIER_ORDER = ["Least Favored", "Less Favored", "Neutral", "Favored", "Most Favored"]


def detect_anomalies(current: dict, prior: dict | None) -> list[dict]:
    """Run all anomaly checks. Returns list of {type, description, severity}.

    Returns empty list if no prior allocation (first run after deployment)."""
    if prior is None:
        return []

    anomalies = []
    anomalies.extend(_check_rating_skips(current, prior))
    anomalies.extend(_check_stance_flip(current, prior))
    anomalies.extend(_check_leverage_discontinuity(current, prior))
    anomalies.extend(_check_mass_reshuffling(current, prior))
    anomalies.extend(_check_extreme_alpha(current))
    anomalies.extend(_check_unexpected_regime_flip(current, prior))
    return anomalies


def _check_rating_skips(current: dict, prior: dict) -> list[dict]:
    """A bucket jumping >2 tiers (e.g., Least Favored → Most Favored) in
    one rebalance is suspicious."""
    out = []
    cur_by_bucket = _flatten_ratings(current)
    prior_by_bucket = _flatten_ratings(prior)
    for bucket, cur_rating in cur_by_bucket.items():
        prior_rating = prior_by_bucket.get(bucket)
        if prior_rating is None:
            continue
        if cur_rating not in TIER_ORDER or prior_rating not in TIER_ORDER:
            continue
        skip = abs(TIER_ORDER.index(cur_rating) - TIER_ORDER.index(prior_rating))
        if skip >= 3:
            out.append({
                "type": "rating_skip",
                "severity": "warning",
                "description": (
                    f"{bucket} jumped {skip} rating tiers in one rebalance: "
                    f"{prior_rating} → {cur_rating}"
                ),
            })
    return out


def _check_stance_flip(current: dict, prior: dict) -> list[dict]:
    """Aggressive → Defensive (or vice versa) in one rebalance without a
    big R&L move is suspicious."""
    cur_stance = current.get("stance", {}).get("label")
    prior_stance = prior.get("stance", {}).get("label")
    if not cur_stance or not prior_stance:
        return []
    polar = (
        (cur_stance == "Aggressive" and prior_stance == "Defensive") or
        (cur_stance == "Defensive" and prior_stance == "Aggressive")
    )
    if not polar:
        return []
    cur_rl = _get_rl_value(current)
    prior_rl = _get_rl_value(prior)
    rl_move = abs(cur_rl - prior_rl)
    if rl_move < 20:
        return [{
            "type": "stance_flip",
            "severity": "warning",
            "description": (
                f"Stance flipped {prior_stance} → {cur_stance} but R&L moved only "
                f"{rl_move:.1f} points (threshold 20). Investigate before publishing."
            ),
        }]
    return []


def _check_leverage_discontinuity(current: dict, prior: dict) -> list[dict]:
    cur_lev = current.get("headline", {}).get("leverage", 1.0)
    prior_lev = prior.get("headline", {}).get("leverage", 1.0)
    delta = cur_lev - prior_lev
    if abs(delta) > 0.3:
        return [{
            "type": "leverage_discontinuity",
            "severity": "warning",
            "description": (
                f"Leverage changed by {delta:+.2f}x ({prior_lev:.2f}x → {cur_lev:.2f}x) "
                f"in one rebalance. Threshold is 0.3x."
            ),
        }]
    return []


def _check_mass_reshuffling(current: dict, prior: dict) -> list[dict]:
    cur = _flatten_ratings(current)
    prior_r = _flatten_ratings(prior)
    n_changed = 0
    for bucket, cur_rating in cur.items():
        prior_rating = prior_r.get(bucket)
        if prior_rating is None:
            continue
        if cur_rating != prior_rating:
            n_changed += 1
    if n_changed > 4:
        return [{
            "type": "mass_reshuffling",
            "severity": "info",
            "description": (
                f"{n_changed} buckets changed rating in one rebalance. "
                f"Could indicate a real regime change OR an indicator data issue."
            ),
        }]
    return []


def _check_extreme_alpha(current: dict) -> list[dict]:
    alpha = current.get("headline", {}).get("alpha", 1.0)
    if alpha > 1.4:
        return [{
            "type": "extreme_alpha",
            "severity": "info",
            "description": f"Alpha at {alpha:.2f}x — near the leverage cap. Confirm composites are calm.",
        }]
    if alpha < 0.6:
        return [{
            "type": "extreme_alpha",
            "severity": "warning",
            "description": f"Alpha at {alpha:.2f} — defensive bucket dominant. Confirm R&L stress signal is real.",
        }]
    return []


def _check_unexpected_regime_flip(current: dict, prior: dict) -> list[dict]:
    cur_flip = current.get("regime", {}).get("regime_flip_active", False)
    prior_flip = prior.get("regime", {}).get("regime_flip_active", False)
    if cur_flip and not prior_flip:
        cur_rl = _get_rl_value(current)
        prior_rl = _get_rl_value(prior)
        rl_move = abs(cur_rl - prior_rl)
        if rl_move < 10:
            return [{
                "type": "unexpected_regime_flip",
                "severity": "warning",
                "description": (
                    f"Regime flip activated but R&L moved only {rl_move:.1f} points. "
                    f"Threshold is 10. Verify composite computation."
                ),
            }]
    return []


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def _flatten_ratings(allocation: dict) -> dict[str, str]:
    """Build {bucket_name: rating} from an allocation's tiered ratings."""
    out = {}
    ratings = allocation.get("ratings", {})
    if isinstance(ratings, list):  # compute-layer shape
        for entry in ratings:
            name = entry.get("bucket_name") or entry.get("bucket")
            if name:
                out[name] = entry.get("rating", "Neutral")
    elif isinstance(ratings, dict):  # output-layer shape (tiered)
        for tier, entries in ratings.items():
            for entry in entries:
                name = entry.get("bucket")
                if name:
                    out[name] = entry.get("rating", "Neutral")
    return out


def _get_rl_value(allocation: dict) -> float:
    rl = allocation.get("regime", {}).get("risk_liquidity")
    if isinstance(rl, dict):
        return float(rl.get("value", 0))
    if isinstance(rl, (int, float)):
        return float(rl)
    return 0.0
