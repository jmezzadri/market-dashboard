#!/usr/bin/env python3
"""
compute_v11_mechanisms.py — daily compute for the 6 v11 cycle mechanisms.

Reads:
  - methodology_calibration_v11.json  (Sprint 1 mechanism definitions — Val/Credit/Growth)
  - public/indicator_history.json     (live daily indicator panel — Sprint 2 fallback)

Writes:
  - public/cycle_board_snapshot.json  (CONTRACT-COMPATIBLE shape for src/App.jsx)

Schedule: nightly at 22:30 UTC weekdays via .github/workflows/cycle-mechanisms-daily.yml.

CONTRACT (read by src/App.jsx home Macro Overview tile + AssetTilt page):
  {
    "_doc": "...",
    "as_of": "YYYY-MM-DD",
    "framework": "v11 — six cycle mechanisms",
    "calibration_label": "Sprint 1+2 calibration",
    "mechanisms": [
      {"id": "valuation",            "num": "01", "name": "Valuation",             "score": 99},
      {"id": "credit",               "num": "02", "name": "Credit",                "score": 67},
      {"id": "funding",              "num": "03", "name": "Funding",               "score": 30},
      {"id": "growth",               "num": "04", "name": "Growth",                "score": 45},
      {"id": "liquidity_policy",     "num": "05", "name": "Liquidity & Policy",    "score": 55},
      {"id": "positioning_breadth",  "num": "06", "name": "Positioning & Breadth", "score": 70}
    ]
  }

Bands: 0-25 Risk On, 25-50 Neutral, 50-75 Caution, 75-100 Risk Off.

SCORING — direction-corrected percentile, averaged across indicators.

  For Sprint 1 mechanisms (Valuation, Credit, Growth): the calibration JSON
  is the authoritative source. Read each tile's `indicators` array. Each
  indicator has a precomputed `percentile` and a `direction`. Direction
  encoding (handled here):
    - "high_is_concerning"  → score = percentile          (high reading = concerning)
    - "low_is_concerning"   → score = 100 - percentile    (low reading = concerning)
    - "bidir_top"           → score = percentile          (current is in top half;
                                                            being at top is concerning)
    - "bidir_bottom"        → score = 100 - percentile    (current is in bottom half;
                                                            being at bottom is concerning,
                                                            e.g. credit spreads too tight = complacency)
  Default (missing direction): treat as high_is_concerning.

  For Sprint 2 mechanisms (Funding / Liquidity & Policy / Positioning & Breadth):
  the calibration JSON does not have indicator panels yet. Fall back to the
  panels defined below in PANELS, computed from indicator_history.json
  post-2011 sample.

  Mechanism score = round(mean of indicator scores).
"""
from __future__ import annotations

import json
import datetime as dt
from pathlib import Path
from typing import Dict, List, Tuple, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
INDICATOR_HISTORY = REPO_ROOT / "public" / "indicator_history.json"
SNAPSHOT_OUT = REPO_ROOT / "public" / "cycle_board_snapshot.json"
# Calibration JSON lives at public/methodology_calibration_v11.json (per repo layout).
CALIB_PATH = REPO_ROOT / "public" / "methodology_calibration_v11.json"
# Fallback path for environments that previously had it at the repo root.
CALIB_PATH_LEGACY = REPO_ROOT / "methodology_calibration_v11.json"

# Sprint 1 = read from calibration JSON. Sprint 2 = use the panels below.
SPRINT1_IDS = {"valuation", "credit", "growth"}

# Sprint 2 fallback panels — used only when the calibration JSON does not
# carry indicator data for that mechanism. Direction strings match the
# calibration JSON convention.
PANELS: Dict[str, dict] = {
    "valuation":         {"num": "01", "name": "Valuation"},   # Sprint 1 — calibration JSON
    "credit":            {"num": "02", "name": "Credit"},      # Sprint 1
    "funding": {
        "num": "03",
        "name": "Funding",
        "indicators": [
            ("cpff",          "Commercial Paper risk premium", "high_is_concerning"),
            ("stlfsi",        "St. Louis Fed FSI",             "high_is_concerning"),
            ("bank_reserves", "Bank reserves at Fed",          "low_is_concerning"),
            ("rrp",           "Reverse repo balance",          "low_is_concerning"),
        ],
    },
    "growth":            {"num": "04", "name": "Growth"},      # Sprint 1
    "liquidity_policy": {
        "num": "05",
        "name": "Liquidity & Policy",
        "indicators": [
            ("anfci",    "Chicago Fed ANFCI",          "high_is_concerning"),
            ("fed_bs",   "Fed Balance Sheet YoY %",    "low_is_concerning"),
            ("sloos_ci", "SLOOS C&I lending",          "high_is_concerning"),
            ("m2_yoy",   "M2 Money Supply YoY",        "low_is_concerning"),
        ],
    },
    "positioning_breadth": {
        "num": "06",
        "name": "Positioning & Breadth",
        "indicators": [
            ("skew",       "CBOE SKEW",                       "high_is_concerning"),
            ("vix",        "VIX",                             "high_is_concerning"),
            ("eq_cr_corr", "Equity-credit correlation (60d)", "high_is_concerning"),
            ("move",       "MOVE Index (Treasury vol)",       "high_is_concerning"),
        ],
    },
}

QUARTILE_HISTORY_START = "2011-01-01"


def direction_corrected_score(percentile: float, direction: str) -> float:
    """Convert a percentile (0-100) and direction string into a 0-100 concerning-score.

    high_is_concerning: high reading is the bad direction → score = percentile
    low_is_concerning:  low reading is bad → score = 100 - percentile
    bidir_top:          current value is in the top half; being there is concerning → score = percentile
    bidir_bottom:       current is in the bottom half; being there is concerning (e.g. credit spreads
                        too tight = complacency, late-cycle warning) → score = 100 - percentile
    """
    d = (direction or "high_is_concerning").lower()
    if d in ("low_is_concerning", "bidir_bottom"):
        return 100.0 - percentile
    return percentile  # high_is_concerning, bidir_top, default


def percentile_of(value: float, sorted_sample: List[float]) -> float:
    n = len(sorted_sample)
    if n == 0:
        return 50.0
    below = sum(1 for v in sorted_sample if v < value)
    return below / n * 100.0


def latest_value_and_history(ind: dict, key: str) -> Optional[Tuple[float, List[float]]]:
    s = ind.get(key)
    if not isinstance(s, dict) or "points" not in s:
        return None
    pts = [(d, v) for d, v in s["points"] if v is not None and d >= QUARTILE_HISTORY_START]
    if not pts:
        return None
    sample = [v for _, v in pts]
    latest = pts[-1][1]
    return latest, sample


def score_mechanism_from_calibration(tile: dict) -> Optional[int]:
    """Sprint 1: aggregate score from calibration JSON's indicator percentiles."""
    indicators = tile.get("indicators")
    if not indicators:
        return None
    contribs = []
    for ind in indicators:
        pct = ind.get("percentile")
        if pct is None:
            continue
        direction = ind.get("direction", "high_is_concerning")
        contribs.append(direction_corrected_score(float(pct), direction))
    if not contribs:
        return None
    return round(sum(contribs) / len(contribs))


def score_mechanism_from_indicator_history(panel: dict, indicators: dict) -> Optional[int]:
    """Sprint 2 fallback: compute live percentile from post-2011 sample."""
    panel_indicators = panel.get("indicators")
    if not panel_indicators:
        return None
    contribs = []
    for key, _label, direction in panel_indicators:
        loaded = latest_value_and_history(indicators, key)
        if loaded is None:
            continue
        cur, sample = loaded
        pct = percentile_of(cur, sorted(sample))
        contribs.append(direction_corrected_score(pct, direction))
    if not contribs:
        return None
    return round(sum(contribs) / len(contribs))


def load_calibration() -> dict:
    for p in (CALIB_PATH, CALIB_PATH_LEGACY):
        if p.exists():
            try:
                return json.loads(p.read_text())
            except Exception:
                pass
    return {"tiles": []}


def main() -> None:
    indicators = json.loads(INDICATOR_HISTORY.read_text())
    calib = load_calibration()
    calib_tiles_by_id = {t.get("id"): t for t in calib.get("tiles", [])}

    out_mechanisms = []
    for mech_id, panel in PANELS.items():
        score = None
        if mech_id in SPRINT1_IDS:
            tile = calib_tiles_by_id.get(mech_id)
            if tile is not None:
                score = score_mechanism_from_calibration(tile)
        if score is None:
            score = score_mechanism_from_indicator_history(panel, indicators)
        if score is None:
            score = 0
        out_mechanisms.append({
            "id": mech_id,
            "num": panel["num"],
            "name": panel["name"],
            "score": int(score),
        })

    snapshot = {
        "_doc": (
            "v11 cycle-mechanism scores. Sprint 1 (Valuation/Credit/Growth) reads "
            "indicator percentiles directly from methodology_calibration_v11.json with "
            "direction encoding (high/low/bidir_top/bidir_bottom). Sprint 2 (Funding/"
            "Liquidity & Policy/Positioning & Breadth) computes from indicator_history.json "
            "post-2011 sample. Refreshed nightly by scripts/compute_v11_mechanisms.py at "
            "22:30 UTC weekdays."
        ),
        "as_of": dt.date.today().isoformat(),
        "framework": "v11 — six cycle mechanisms",
        "calibration_label": "Sprint 1+2 calibration",
        "mechanisms": out_mechanisms,
    }
    SNAPSHOT_OUT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_OUT.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {SNAPSHOT_OUT}")
    avg = sum(m["score"] for m in out_mechanisms) / len(out_mechanisms)
    band = "Risk-on" if avg < 25 else "Neutral" if avg < 50 else "Caution" if avg < 75 else "Risk-off"
    print(f"Composite average: {round(avg)}/100 ({band})")
    for m in out_mechanisms:
        print(f"  {m['num']} · {m['name']:24s}  score={m['score']:3d}/100")


if __name__ == "__main__":
    main()
