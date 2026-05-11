#!/usr/bin/env python3
"""
compute_cycle_v2_history.py — historical sub-composite + headline series.

Joe directive 2026-05-11: every composite, sub-composite, and indicator
needs a real chart with selectable timeframe + crosshair. Indicators
already have history in indicator_history.json. Sub-composites and
headlines don't — current scores are written to cycle_v2.json daily and
the previous day overwritten. This producer back-fills the gap.

For each Friday from 2010-01-01 to today, walks indicator_history back
to that date, computes each indicator's 0-100 score using the same
percentile / threshold math as compute_cycle_v2.py (state-based — no
IC sign-flip), averages into sub-composites, averages those into the 3
headlines. Output: weekly time series per sub-composite + headline.

This is STATE-BASED scoring — matches what Macro Overview's headline
strip and the Scenario Analysis cycle stress tile already use. The
horizon-aware forecast scores in cycle_v2.json are NOT recomputed here
(they require running spearmanr over forward-return windows for each
historical date, which is a separate ~10-min job).

WRITES
------
  public/cycle_v2_history.json — {
    as_of: "YYYY-MM-DD",
    cadence: "weekly",
    series: {
      subcomposites: { Equities: [[date, score], ...], ... },
      headlines: { cycle_value: [[date, score], ...], ... }
    }
  }

USAGE
-----
    python3 scripts/compute_cycle_v2_history.py
    # Writes public/cycle_v2_history.json. Idempotent, no side effects
    # except for the output file.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

# Reuse the producer's definitions (sub-composite specs, scoring helpers).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_cycle_v2 import (  # type: ignore
    SUB_COMPOSITE_DEFS,
    HEADLINE_DEFS,
    percentile_score,
    threshold_score,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
INDICATOR_HISTORY = REPO_ROOT / "public" / "indicator_history.json"
OUT_PATH = REPO_ROOT / "public" / "cycle_v2_history.json"

# Weekly Fridays from this date onward. 2010 picks up post-GFC era after
# most v2 indicators have data; earlier dates have too many indicators
# null.
HISTORY_START = dt.date(2010, 1, 1)
# Stop on the most recent past Friday.
TODAY = dt.date.today()


def fridays_between(start: dt.date, end: dt.date) -> List[dt.date]:
    """Every Friday from start to end inclusive."""
    # First Friday >= start
    d = start + dt.timedelta(days=(4 - start.weekday()) % 7)
    out = []
    while d <= end:
        out.append(d)
        d += dt.timedelta(days=7)
    return out


def value_as_of(points: List[List[Any]], as_of: dt.date) -> Optional[float]:
    """Most recent non-null value on or before as_of."""
    best_v = None
    for d_str, v in points:
        if v is None:
            continue
        try:
            d = dt.date.fromisoformat(d_str)
        except (ValueError, TypeError):
            continue
        if d > as_of:
            break
        try:
            best_v = float(v)
        except (TypeError, ValueError):
            continue
    return best_v


def sample_through(points: List[List[Any]], as_of: dt.date,
                   lookback_start: Optional[dt.date]) -> List[float]:
    """All non-null values from lookback_start (if set) to as_of."""
    out = []
    for d_str, v in points:
        if v is None:
            continue
        try:
            d = dt.date.fromisoformat(d_str)
        except (ValueError, TypeError):
            continue
        if d > as_of:
            break
        if lookback_start and d < lookback_start:
            continue
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            continue
    return out


def yoy_pct_at(points: List[List[Any]], as_of: dt.date) -> Optional[float]:
    """% change vs ~1 year prior. None if either anchor missing."""
    cur = value_as_of(points, as_of)
    yr_ago = value_as_of(points, as_of - dt.timedelta(days=365))
    if cur is None or yr_ago is None or yr_ago == 0:
        return None
    return (cur / yr_ago - 1.0) * 100.0


def indicator_score_at(ind_def: Dict[str, Any], sub_def: Dict[str, Any],
                       points: List[List[Any]], as_of: dt.date) -> Optional[float]:
    """0-100 score for one indicator on one date. None if not enough data."""
    direction = ind_def["direction"]
    scoring = sub_def["scoring"]

    if scoring == "threshold":
        anchors = ind_def.get("thresholds")
        if not anchors:
            return None
        if ind_def.get("transform") == "yoy_pct":
            val = yoy_pct_at(points, as_of)
        else:
            val = value_as_of(points, as_of)
        if val is None:
            return None
        return threshold_score(val, anchors, direction)

    # percentile scoring
    val = value_as_of(points, as_of)
    if val is None:
        return None
    lb_start_str = sub_def.get("lookback_start")
    lb_start = dt.date.fromisoformat(lb_start_str) if lb_start_str else None
    sample = sample_through(points, as_of, lb_start)
    # Need a meaningful sample window — at least 12 points.
    if len(sample) < 12:
        return None
    return percentile_score(val, sample, direction)


def main() -> int:
    hist = json.loads(INDICATOR_HISTORY.read_text())

    fridays = fridays_between(HISTORY_START, TODAY)
    print(f"computing weekly history · {len(fridays)} fridays · "
          f"{fridays[0]} → {fridays[-1]}")

    # series shape: {Equities: [[date, score], ...], ...}
    sub_series: Dict[str, List[List[Any]]] = {sid: [] for sid in SUB_COMPOSITE_DEFS}
    head_series: Dict[str, List[List[Any]]] = {hid: [] for hid in HEADLINE_DEFS}

    indicator_points_cache: Dict[str, List[List[Any]]] = {}

    def get_points(history_key: str) -> List[List[Any]]:
        if history_key in indicator_points_cache:
            return indicator_points_cache[history_key]
        entry = hist.get(history_key)
        pts = entry.get("points", []) if entry else []
        indicator_points_cache[history_key] = pts
        return pts

    for i, friday in enumerate(fridays):
        sub_scores_today: Dict[str, Optional[float]] = {}

        for sub_id, sub_def in SUB_COMPOSITE_DEFS.items():
            ind_scores: List[float] = []
            for ind_def in sub_def["indicators"]:
                pts = get_points(ind_def["history_key"])
                if not pts:
                    continue
                s = indicator_score_at(ind_def, sub_def, pts, friday)
                if s is not None:
                    ind_scores.append(s)
            if ind_scores:
                avg = sum(ind_scores) / len(ind_scores)
                sub_scores_today[sub_id] = avg
                sub_series[sub_id].append([friday.isoformat(), round(avg, 2)])
            else:
                sub_scores_today[sub_id] = None

        for hid, hdef in HEADLINE_DEFS.items():
            vals = [sub_scores_today[s] for s in hdef["subcomposites"]
                    if sub_scores_today.get(s) is not None]
            if vals:
                avg = sum(vals) / len(vals)
                head_series[hid].append([friday.isoformat(), round(avg, 2)])

        if (i + 1) % 100 == 0:
            print(f"  ... {i+1}/{len(fridays)} done")

    out = {
        "as_of": TODAY.isoformat(),
        "cadence": "weekly",
        "methodology": "state-based (no IC sign-flip, no IC gate). "
                       "Sub-composite = simple average of its indicators' "
                       "current 0-100 scores at each historical date. "
                       "Headline = simple average of its sub-composites.",
        "series": {
            "subcomposites": sub_series,
            "headlines": head_series,
        },
        "label_map": {
            "subcomposites": {sid: sd["label"] for sid, sd in SUB_COMPOSITE_DEFS.items()},
            "headlines": {hid: hd["label"] for hid, hd in HEADLINE_DEFS.items()},
        },
    }

    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT_PATH}  ·  {OUT_PATH.stat().st_size / 1024:.1f} KB")
    print("  sub-composite series lengths:",
          {k: len(v) for k, v in sub_series.items()})
    print("  headline series lengths:",
          {k: len(v) for k, v in head_series.items()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
