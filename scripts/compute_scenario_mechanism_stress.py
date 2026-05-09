#!/usr/bin/env python3
"""
compute_scenario_mechanism_stress.py — Phase 2C producer.

Reads the Phase 2 calibration JSON (per-scenario peak-stress indicator values)
and re-percentiles each calibrated value against the live full-sample in
indicator_history.json. Applies the same direction-corrected scoring and
simple-average aggregation the live cycle-mechanism scorer uses, so the
"under stress" mechanism scores rendered on the Scenario Analysis page are
on the same 0-100 scale as the "current" scores from cycle_board_snapshot.json.

Reads:
  - public/scenario_stress_calibration.json  (Phase 2A scope + Phase 2B values)
  - public/indicator_history.json            (live full-sample for each indicator)

Writes:
  - public/scenario_stress.json              (per-scenario x mechanism scores +
                                              page-level composite + indicator
                                              detail for the methodology drawer)

Schedule: nightly at 23:00 UTC weekdays via .github/workflows/scenario-stress-daily.yml.
The composite changes when the calibration JSON changes; the daily refresh
also captures any indicator-history sample additions that shift percentiles.

CONTRACT (read by Scenario Analysis page Cycle Mechanism Results table at
Phase 2E and the methodology drawer): see _doc field in the output snapshot.

SCORING: direction-corrected percentile, averaged across available indicators.

  For each (scenario, indicator) where calibration value is non-null AND a
  historical sample is available:
    pct   = percentile_of(value, sorted(historical_sample))
    score = direction_corrected_score(pct, direction)

  Mechanism score = round(mean of indicator scores in the mechanism's panel
                          that were successfully scored).
  Composite score = round(mean of mechanism scores).

  Per Phase 2B Q5 decision: re-percentile available indicators against the
  live sample, then take the simple-average of the AVAILABLE indicators in
  each mechanism panel. No imputation, no bespoke per-scenario aggregation.

  Per Phase 2B Q4 decision: indicators with value=null (e.g. RRP for pre-2013
  scenarios) are dropped from the mechanism's denominator, NOT scored as zero.
  Same simple-average over available inputs that the live engine uses today.

INDICATOR HISTORY ALIASES: calibration JSON uses canonical FRED-side names;
indicator_history.json uses the engine's internal keys. Where the two diverge,
INDICATOR_HISTORY_ALIAS maps calibration_id -> history_key.

DOCUMENTED GAPS: indicators in the calibration that have no usable full-sample
in indicator_history.json yet. Listed in INDICATORS_NO_HISTORY. The producer
records these in indicators_dropped[] with reason "no historical sample
available" so Senior Quant + Data Steward can see exactly which inputs aren't
being scored. Closing each gap is a Phase 2 follow-up.
"""
from __future__ import annotations

import json
import datetime as dt
import sys
from pathlib import Path
from typing import Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
CALIB_PATH = REPO_ROOT / "public" / "scenario_stress_calibration.json"
INDICATOR_HISTORY_PATH = REPO_ROOT / "public" / "indicator_history.json"
SNAPSHOT_OUT = REPO_ROOT / "public" / "scenario_stress.json"

# Sample window — match the v11 live scorer's Sprint 2 default.
HISTORY_START = "2011-01-01"

# 6 cycle mechanisms in the order the Scenario Analysis page renders them.
MECHANISM_ORDER = [
    ("valuation",            "01", "Equity Valuations"),
    ("credit",               "02", "Credit"),
    ("funding",              "03", "Funding"),
    ("growth",               "04", "Growth"),
    ("liquidity_policy",     "05", "Liquidity & Policy"),
    ("positioning_breadth",  "06", "Positioning & Breadth"),
]

# Calibration_id -> indicator_history_key mapping for renames.
INDICATOR_HISTORY_ALIAS: Dict[str, str] = {
    "hy_oas": "hy_ig",          # indicator_history calls the HY OAS series "hy_ig"
    "fed_bs_yoy": "fed_bs",     # indicator_history fed_bs is already YoY %
    "ism_mfg": "ism",           # indicator_history has combined PMI; mfg + svc both
    "ism_svc": "ism",           # alias to it until split backfill ships
}

# Indicators known to have no usable full-sample in indicator_history.json.
# Recorded as dropped per scenario (reason='no historical sample available').
# Queue closing each as a Phase 2 follow-up.
INDICATORS_NO_HISTORY = {
    "ig_hy_ratio",   # only 72 monthly points (2023-05 onward) — too short to percentile
    # ism_mfg/ism_svc/gdpnow now have indicator_history coverage (gdpnow backfilled
    # 2026-05-09; ism_mfg + ism_svc aliased to combined ism series).
}


def direction_corrected_score(percentile: float, direction: str) -> float:
    """Same convention as scripts/compute_v11_mechanisms.py.

    high_is_concerning: high reading = stress  -> score = percentile
    low_is_concerning : low reading = stress   -> score = 100 - percentile
    bidir_top         : top half = stress      -> score = percentile
    bidir_bottom      : bottom half = stress   -> score = 100 - percentile

    Default (missing direction): treat as high_is_concerning.
    """
    d = (direction or "high_is_concerning").lower()
    if d in ("low_is_concerning", "bidir_bottom"):
        return 100.0 - percentile
    return percentile


def percentile_of(value: float, sorted_sample: List[float]) -> float:
    """Strict-less-than rank, matching compute_v11_mechanisms.percentile_of()."""
    n = len(sorted_sample)
    if n == 0:
        return 50.0
    below = sum(1 for v in sorted_sample if v < value)
    return below / n * 100.0


def historical_sample(indicators: dict, calib_id: str) -> Optional[List[float]]:
    """Return the post-HISTORY_START values list for a calibration indicator id.

    Resolves aliases via INDICATOR_HISTORY_ALIAS; returns None if no sample
    is found or the series doesn't have a 'points' array.
    """
    history_key = INDICATOR_HISTORY_ALIAS.get(calib_id, calib_id)
    series = indicators.get(history_key)
    if not isinstance(series, dict):
        return None
    points = series.get("points")
    if not isinstance(points, list) or not points:
        return None
    sample = [
        v for d, v in points
        if isinstance(d, str) and d >= HISTORY_START and v is not None
    ]
    return sample if sample else None


def score_scenario(
    scenario_id: str,
    scenario: dict,
    calib_indicators: dict,
    indicator_history: dict,
) -> dict:
    """Score one scenario against the live indicator-history sample."""
    values = scenario.get("values") or {}
    indicators_dropped: List[dict] = []
    by_mechanism: Dict[str, List[dict]] = {m_id: [] for m_id, _, _ in MECHANISM_ORDER}

    for calib_id, meta in calib_indicators.items():
        mechanism = meta.get("mechanism")
        direction = meta.get("direction", "high_is_concerning")
        cell = values.get(calib_id) or {}
        value = cell.get("value")

        # Drop reason 1: calibration value explicitly null (Q4 RRP rule etc.)
        if value is None:
            indicators_dropped.append({
                "id": calib_id,
                "reason": (cell.get("source_note") or
                           "value=null in calibration (e.g. Q4 pre-2013 RRP rule)")
            })
            continue

        # Drop reason 2: indicator in the documented no-history gap list.
        if calib_id in INDICATORS_NO_HISTORY:
            indicators_dropped.append({
                "id": calib_id,
                "reason": "no historical sample available in indicator_history.json"
            })
            continue

        sample = historical_sample(indicator_history, calib_id)
        # Drop reason 3: history aliasing miss / new indicator.
        if sample is None or len(sample) < 24:
            indicators_dropped.append({
                "id": calib_id,
                "reason": (f"insufficient history ({len(sample) if sample else 0} "
                           f"points post-{HISTORY_START}); minimum 24 required")
            })
            continue

        sorted_sample = sorted(sample)
        pct = percentile_of(float(value), sorted_sample)
        score = direction_corrected_score(pct, direction)
        by_mechanism.setdefault(mechanism, []).append({
            "id": calib_id,
            "value": value,
            "as_of": cell.get("as_of"),
            "direction": direction,
            "percentile": round(pct, 1),
            "score": round(score),
            "history_key": INDICATOR_HISTORY_ALIAS.get(calib_id, calib_id),
            "history_sample_size": len(sample),
            "source_note": cell.get("source_note"),
        })

    mechanisms_out: List[dict] = []
    mech_scores_for_composite: List[float] = []
    for m_id, num, name in MECHANISM_ORDER:
        entries = by_mechanism.get(m_id) or []
        panel_size = sum(
            1 for cid, m in calib_indicators.items()
            if m.get("mechanism") == m_id
        )
        if entries:
            avg = sum(e["score"] for e in entries) / len(entries)
            mech_score = round(avg)
            mech_scores_for_composite.append(avg)
        else:
            mech_score = None
        mechanisms_out.append({
            "id": m_id,
            "num": num,
            "name": name,
            "score": mech_score,
            "indicators_scored": len(entries),
            "indicators_panel": panel_size,
            "indicators": entries,
        })

    composite_score: Optional[int] = (
        round(sum(mech_scores_for_composite) / len(mech_scores_for_composite))
        if mech_scores_for_composite else None
    )
    indicators_scored_total = sum(m["indicators_scored"] for m in mechanisms_out)

    return {
        "peak_window": scenario.get("peak_window"),
        "calibration_status": scenario.get("calibration_status"),
        "mechanisms": mechanisms_out,
        "composite_score": composite_score,
        "indicators_scored_total": indicators_scored_total,
        "indicators_dropped": indicators_dropped,
    }


def main() -> int:
    if not CALIB_PATH.exists():
        print(f"FATAL: calibration JSON missing at {CALIB_PATH}", file=sys.stderr)
        return 2
    if not INDICATOR_HISTORY_PATH.exists():
        print(
            f"FATAL: indicator history missing at {INDICATOR_HISTORY_PATH}",
            file=sys.stderr,
        )
        return 2

    calib = json.loads(CALIB_PATH.read_text())
    indicator_history = json.loads(INDICATOR_HISTORY_PATH.read_text())

    calib_indicators = calib.get("indicators") or {}
    scenarios = calib.get("scenarios") or {}

    scored: Dict[str, dict] = {}
    for scenario_id, scenario in scenarios.items():
        scored[scenario_id] = score_scenario(
            scenario_id, scenario, calib_indicators, indicator_history,
        )

    snapshot = {
        "_doc": (
            "Phase 2 scenario-stress mechanism scores. For each scenario, each "
            "calibrated indicator's peak-stress value is percentiled against the "
            "indicator's full live sample (post-2011) and direction-corrected "
            "0-100 (higher = more stress) using the same convention as the live "
            "v11 cycle-mechanism scorer. Mechanism score = simple-average of "
            "available indicator scores; composite = simple-average of mechanism "
            "scores. Indicators with value=null (e.g. RRP pre-2013) or no "
            "historical sample are dropped from the denominator and listed in "
            "indicators_dropped per scenario. Refreshed nightly by "
            "scripts/compute_scenario_mechanism_stress.py at 23:00 UTC weekdays."
        ),
        "as_of": dt.date.today().isoformat(),
        "framework": "v11 cycle mechanisms",
        "calibration_version": calib.get("version"),
        "calibration_as_of": calib.get("as_of"),
        "calibration_decisions": calib.get("_decisions_locked"),
        "history_start": HISTORY_START,
        "scenarios": scored,
    }

    SNAPSHOT_OUT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_OUT.write_text(json.dumps(snapshot, indent=2) + "\n")

    print(f"Wrote {SNAPSHOT_OUT}")
    print(f"Calibration version: {snapshot['calibration_version']}")
    print(f"History start: {HISTORY_START}")
    print(f"Scenarios scored: {len(scored)}")
    for sid, s in scored.items():
        print(
            f"  {sid:30s}  composite={s['composite_score']!s:>4s}  "
            f"scored={s['indicators_scored_total']:>3d}  "
            f"dropped={len(s['indicators_dropped'])}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
