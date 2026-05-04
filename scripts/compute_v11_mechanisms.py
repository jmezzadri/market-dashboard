#!/usr/bin/env python3
"""
compute_v11_mechanisms.py — daily compute for the 6 v11 cycle mechanisms.

Reads:
  - public/indicator_history.json     (existing daily indicator panel)
  - methodology_calibration_v11.json  (Sprint 1 mechanism definitions)

Writes:
  - public/cycle_board_snapshot.json  (CONTRACT-COMPATIBLE shape)

Schedule: nightly at 22:30 UTC weekdays via .github/workflows/cycle-mechanisms-daily.yml.

CONTRACT (read by src/App.jsx home Macro Overview tile):
  {
    "_doc": "...",
    "as_of": "YYYY-MM-DD",
    "framework": "v11 — six cycle mechanisms",
    "calibration_label": "Sprint 1 calibration" | "Sprint 2 calibration",
    "mechanisms": [
      {"id": "valuation",            "num": "01", "name": "Valuation",             "score": 87},
      {"id": "credit",               "num": "02", "name": "Credit",                "score": 69},
      {"id": "funding",              "num": "03", "name": "Funding",               "score": 30},
      {"id": "growth",               "num": "04", "name": "Growth",                "score": 47},
      {"id": "liquidity_policy",     "num": "05", "name": "Liquidity & Policy",    "score": 55},
      {"id": "positioning_breadth",  "num": "06", "name": "Positioning & Breadth", "score": 70}
    ]
  }

The home tile bands score:
  0-25 = Risk-on, 25-50 = Neutral, 50-75 = Caution, 75-100 = Risk-off.

Score derivation (uniform across all 6 mechanisms):
  For each indicator: concerning_score = direction-corrected percentile (0-100)
    if high_is_concerning: percentile of current value in post-2011 sample
    if low_is_concerning:  100 - percentile
  Mechanism score = mean of its indicator scores.
"""
from __future__ import annotations

import json
import datetime as dt
from pathlib import Path
from typing import Dict, List, Tuple, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
INDICATOR_HISTORY = REPO_ROOT / "public" / "indicator_history.json"
SNAPSHOT_OUT = REPO_ROOT / "public" / "cycle_board_snapshot.json"
CALIB_REF = REPO_ROOT / "methodology_calibration_v11.json"

# All 6 mechanism panels — Sprint 1 (Val/Credit/Growth) and Sprint 2 (Funding/Liq&Pol/Pos&Br).
# Each entry: indicator_id, label, high_is_concerning (True) or low_is_concerning (False).
PANELS: Dict[str, dict] = {
    "valuation": {
        "num": "01",
        "name": "Valuation",
        "indicators": [
            ("cape",   "Shiller CAPE",                         True),
            # ERP and Buffett are MONTHLY/QUARTERLY series we don't have in indicator_history yet;
            # Sprint 1 calibration JSON has them. We pick them up via _calibration_passthrough below.
        ],
        "passthrough_from_calibration": ["cape", "erp", "buffett"],
    },
    "credit": {
        "num": "02",
        "name": "Credit",
        "indicators": [
            ("hy_ig",      "HY-IG credit spread",  True),
            ("hy_ig_etf",  "HY/IG ETF ratio",      False),
            ("eq_cr_corr", "Equity-credit corr",   True),
            ("credit_3y",  "3y CDX HY",            True),
        ],
    },
    "funding": {
        "num": "03",
        "name": "Funding",
        "indicators": [
            ("cpff",          "Commercial Paper risk premium", True),
            ("stlfsi",        "St. Louis Fed FSI",             True),
            ("bank_reserves", "Bank reserves at Fed",          False),
            ("rrp",           "Reverse repo balance",          False),
        ],
    },
    "growth": {
        "num": "04",
        "name": "Growth",
        "indicators": [
            ("ism",          "ISM Manufacturing PMI",       False),
            ("cfnai_3ma",    "Chicago Fed Activity (3M)",   False),
            ("jobless",      "Initial Jobless Claims",      True),
            ("jolts_quits",  "JOLTS Quits Rate",            False),
        ],
    },
    "liquidity_policy": {
        "num": "05",
        "name": "Liquidity & Policy",
        "indicators": [
            ("anfci",    "Chicago Fed ANFCI",          True),
            ("fed_bs",   "Fed Balance Sheet YoY %",    False),
            ("sloos_ci", "SLOOS C&I lending",          True),
            ("m2_yoy",   "M2 Money Supply YoY",        False),
        ],
    },
    "positioning_breadth": {
        "num": "06",
        "name": "Positioning & Breadth",
        "indicators": [
            ("skew",       "CBOE SKEW",                       True),
            ("vix",        "VIX",                             True),
            ("eq_cr_corr", "Equity-credit correlation (60d)", True),
            ("move",       "MOVE Index (Treasury vol)",       True),
        ],
    },
}

QUARTILE_HISTORY_START = "2011-01-01"


def percentile_of(value: float, sorted_sample: List[float]) -> float:
    """Returns the percentile (0-100) of value within sorted_sample."""
    n = len(sorted_sample)
    if n == 0:
        return 50.0
    below = sum(1 for v in sorted_sample if v < value)
    return below / n * 100.0


def indicator_score(value: float, sample: List[float], high_is_concerning: bool) -> float:
    """Direction-corrected concerning-score (0-100) for a single indicator."""
    if value is None or not sample:
        return 50.0  # neutral fallback
    pctile = percentile_of(value, sorted(sample))
    return pctile if high_is_concerning else (100.0 - pctile)


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


def compute_mechanism_score(mech_id: str, panel: dict, indicators: dict, calib: dict) -> int:
    scores = []
    # Live indicators from indicator_history.json
    for key, _label, high in panel.get("indicators", []):
        loaded = latest_value_and_history(indicators, key)
        if loaded is None:
            continue
        value, sample = loaded
        scores.append(indicator_score(value, sample, high))

    # For Sprint 1 mechanisms (Valuation in particular), pull pre-computed
    # quartile/percentile data straight from methodology_calibration_v11.json
    # — these include monthly/quarterly indicators (CAPE, ERP, Buffett) that
    # don't live in the daily indicator_history.json.
    passthrough = panel.get("passthrough_from_calibration", [])
    if passthrough and calib:
        for tile in calib.get("tiles", []):
            if tile.get("id") != mech_id:
                continue
            for ind_def in tile.get("indicators", []):
                if ind_def.get("id") not in passthrough:
                    continue
                pctile = ind_def.get("percentile")
                if pctile is None:
                    continue
                direction = ind_def.get("direction", "high_is_concerning")
                # Sprint 1 calibration encodes percentile in the indicator's
                # natural direction; convert to concerning-score:
                #  - high_is_concerning (or unspecified): score = pctile
                #  - low_is_concerning: score = 100 - pctile
                if direction == "low_is_concerning":
                    scores.append(100.0 - pctile)
                else:
                    scores.append(pctile)

    if not scores:
        return 0
    return round(sum(scores) / len(scores))


def main() -> None:
    indicators = json.loads(INDICATOR_HISTORY.read_text())
    calib = {}
    if CALIB_REF.exists():
        try:
            calib = json.loads(CALIB_REF.read_text())
        except Exception:
            calib = {}

    mechanisms_out = []
    for mech_id, panel in PANELS.items():
        score = compute_mechanism_score(mech_id, panel, indicators, calib)
        mechanisms_out.append({
            "id": mech_id,
            "num": panel["num"],
            "name": panel["name"],
            "score": score,
        })

    snapshot = {
        "_doc": (
            "v11 cycle-mechanism scores. Source of truth read by both the home "
            "Macro Overview tile (src/App.jsx) and the v11 page "
            "(public/MacroTilt_Macro_Overview_Page_v11.html). The aggregate "
            "verdict is COMPUTED from these scores using the same labelFn as "
            "v11 — do not pre-compute it here. Refreshed nightly by "
            "scripts/compute_v11_mechanisms.py at 22:30 UTC weekdays."
        ),
        "as_of": dt.date.today().isoformat(),
        "framework": "v11 — six cycle mechanisms",
        "calibration_label": "Sprint 2 calibration",
        "mechanisms": mechanisms_out,
    }
    SNAPSHOT_OUT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_OUT.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {SNAPSHOT_OUT}")
    avg = sum(m["score"] for m in mechanisms_out) / len(mechanisms_out)
    band = "Risk-on" if avg < 25 else "Neutral" if avg < 50 else "Caution" if avg < 75 else "Risk-off"
    print(f"Composite average: {round(avg)}/100 ({band})")
    for m in mechanisms_out:
        print(f"  {m['num']} · {m['name']:24s}  score={m['score']:3d}/100")


if __name__ == "__main__":
    main()
