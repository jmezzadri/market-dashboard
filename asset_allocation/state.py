"""
asset_allocation/state.py — Layer 4: state management.

Append-only historical storage of weekly allocation snapshots. Computes
MoM and QoQ rating deltas, stance changes, leverage changes for the
"what changed" UI section.

Storage layout:
  allocation_history/
    allocation_2024-01-05.json
    allocation_2024-01-12.json
    ...
    allocation_2026-04-26.json    ← latest

Files are immutable. To roll back, the operator changes the symlink
target, never modifies a stored file.

Helpers:
  - append_allocation(allocation, history_dir): write the allocation dict
    as a new history entry. Idempotent — overwrites if same date is
    re-run.
  - find_prior_allocation(target_date, history_dir, weeks_back): locate the
    closest prior snapshot N weeks back from target_date. Returns None if
    no snapshot exists yet (early in deployment) or if the closest is
    > 2x weeks_back away.
  - compute_deltas(current, prior): produce the structured "what changed"
    list — promotions, demotions, weight changes, stance change, leverage
    change.

Usage:
  python -m asset_allocation.state --run-dir /tmp/aa/2026-04-26 \\
      --history-dir public/allocation_history
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Storage
# ──────────────────────────────────────────────────────────────────────────


def append_allocation(allocation: dict, history_dir: Path) -> Path:
    """Write an allocation dict to {history_dir}/allocation_{as_of}.json.

    Idempotent — same as_of date overwrites. Returns the path written."""
    history_dir.mkdir(parents=True, exist_ok=True)
    as_of = allocation.get("as_of")
    if not as_of:
        raise ValueError("allocation must have 'as_of' field")
    out_path = history_dir / f"allocation_{as_of}.json"
    out_path.write_text(json.dumps(allocation, indent=2))
    logger.info(f"Wrote allocation snapshot to {out_path}")
    return out_path


def list_history(history_dir: Path) -> list[Path]:
    """Return all allocation_*.json files in history_dir, sorted by date asc."""
    if not history_dir.exists():
        return []
    return sorted(history_dir.glob("allocation_*.json"))


def find_prior_allocation(target_date: str, history_dir: Path,
                          weeks_back: int = 4) -> dict | None:
    """Find the closest prior snapshot N weeks back.

    Returns None if:
      - history is empty
      - no snapshot dated before target_date exists
      - closest snapshot is more than 2x weeks_back away
    """
    target_dt = datetime.strptime(target_date, "%Y-%m-%d")
    target_back_dt = target_dt - timedelta(weeks=weeks_back)
    max_distance_days = weeks_back * 7 * 2  # 2x tolerance

    candidates = []
    for path in list_history(history_dir):
        date_str = path.stem.replace("allocation_", "")
        try:
            date_dt = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue
        if date_dt >= target_dt:
            continue  # only PRIOR snapshots
        distance = abs((date_dt - target_back_dt).days)
        candidates.append((distance, date_dt, path))

    if not candidates:
        return None
    candidates.sort()  # closest to target_back_dt first
    closest_distance, closest_dt, closest_path = candidates[0]
    if closest_distance > max_distance_days:
        return None
    return json.loads(closest_path.read_text())


# ──────────────────────────────────────────────────────────────────────────
# Delta computation
# ──────────────────────────────────────────────────────────────────────────


def _index_by_bucket(allocation: dict) -> dict[str, dict]:
    """Build {bucket_name: rating_entry} from an allocation dict."""
    out = {}
    for entry in allocation.get("ratings", []):
        out[entry["bucket_name"]] = entry
    return out


def compute_deltas(current: dict, prior: dict | None) -> list[dict]:
    """Compare current allocation to a prior snapshot. Returns structured
    list of changes for the UI's 'what changed' callout.

    Returns empty list if prior is None (e.g., early in deployment).
    """
    if prior is None:
        return []

    deltas = []
    cur_by_bucket = _index_by_bucket(current)
    prior_by_bucket = _index_by_bucket(prior)

    # Per-bucket rating changes
    for bucket, cur_entry in cur_by_bucket.items():
        prior_entry = prior_by_bucket.get(bucket)
        if prior_entry is None:
            continue  # bucket is new — handle universe expansion separately
        if cur_entry["rating"] != prior_entry["rating"]:
            tier_order = ["Least Favored", "Less Favored", "Neutral", "Favored", "Most Favored"]
            try:
                cur_tier = tier_order.index(cur_entry["rating"])
                prior_tier = tier_order.index(prior_entry["rating"])
                change_type = "promotion" if cur_tier > prior_tier else "demotion"
            except ValueError:
                change_type = "weight_change"
            deltas.append({
                "type": change_type,
                "bucket": cur_entry.get("display_name", bucket),
                "from": prior_entry["rating"],
                "to": cur_entry["rating"],
                "magnitude": None,
            })

        # Pick set changes
        if cur_entry["is_picked"] and not prior_entry.get("is_picked", False):
            deltas.append({
                "type": "added_to_picks",
                "bucket": cur_entry.get("display_name", bucket),
                "from": None, "to": None, "magnitude": None,
            })
        elif not cur_entry["is_picked"] and prior_entry.get("is_picked", False):
            deltas.append({
                "type": "removed_from_picks",
                "bucket": cur_entry.get("display_name", bucket),
                "from": None, "to": None, "magnitude": None,
            })

    # Stance change
    cur_stance = current.get("stance", {}).get("label")
    prior_stance = prior.get("stance", {}).get("label")
    if cur_stance and prior_stance and cur_stance != prior_stance:
        deltas.append({
            "type": "stance_change",
            "bucket": "Overall stance",
            "from": prior_stance, "to": cur_stance, "magnitude": None,
        })

    # Leverage change (only flag meaningful moves > 0.05x)
    cur_lev = current.get("leverage", 1.0)
    prior_lev = prior.get("leverage", 1.0)
    if abs(cur_lev - prior_lev) > 0.05:
        deltas.append({
            "type": "leverage_change",
            "bucket": "Leverage",
            "from": round(prior_lev, 3),
            "to": round(cur_lev, 3),
            "magnitude": round(cur_lev - prior_lev, 3),
        })

    return deltas


# ──────────────────────────────────────────────────────────────────────────
# Main pipeline integration
# ──────────────────────────────────────────────────────────────────────────


def attach_state(allocation: dict, history_dir: Path) -> dict:
    """Append the current allocation to history, then attach what_changed
    deltas (vs last rebalance, vs last month, vs last quarter)."""
    as_of = allocation.get("as_of")
    if not as_of:
        raise ValueError("allocation must have 'as_of' field")

    # Compute deltas BEFORE appending so we don't compare against ourselves
    last_rebalance = find_prior_allocation(as_of, history_dir, weeks_back=1)
    last_month = find_prior_allocation(as_of, history_dir, weeks_back=4)
    last_quarter = find_prior_allocation(as_of, history_dir, weeks_back=13)

    allocation["what_changed"] = {
        "vs_last_rebalance": compute_deltas(allocation, last_rebalance),
        "vs_last_month": compute_deltas(allocation, last_month),
        "vs_last_quarter": compute_deltas(allocation, last_quarter),
        "previous_rebalance_date": last_rebalance.get("as_of") if last_rebalance else None,
    }

    # Append to history
    append_allocation(allocation, history_dir)
    return allocation


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--history-dir", required=True,
                    help="Directory for append-only allocation_*.json snapshots")
    ap.add_argument("--log-level", default="INFO")
    args = ap.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level),
                        format="%(asctime)s [%(levelname)s] %(message)s")

    run_dir = Path(args.run_dir)
    history_dir = Path(args.history_dir)
    allocation_path = run_dir / "allocation.json"
    if not allocation_path.exists():
        logger.error(f"allocation.json not found in {run_dir}")
        return 2

    allocation = json.loads(allocation_path.read_text())
    allocation = attach_state(allocation, history_dir)

    out_path = run_dir / "allocation_with_state.json"
    out_path.write_text(json.dumps(allocation, indent=2))
    logger.info(f"Wrote {out_path}")

    n_deltas_rebal = len(allocation["what_changed"]["vs_last_rebalance"])
    n_deltas_month = len(allocation["what_changed"]["vs_last_month"])
    logger.info(f"State complete: {n_deltas_rebal} deltas vs last rebalance, "
                f"{n_deltas_month} vs last month")
    return 0


if __name__ == "__main__":
    sys.exit(main())
