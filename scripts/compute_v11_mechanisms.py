#!/usr/bin/env python3
"""
compute_v11_mechanisms.py — production daily compute for the 6 v11 cycle mechanisms.

Reads:
  - public/indicator_history.json     (existing daily indicator panel)

Writes:
  - public/cycle_board_snapshot.json  (one row per mechanism with state + indicator details)

Schedule: nightly at 22:30 UTC via .github/workflows/cycle-mechanisms-daily.yml.
This is the live compute that the Macro Overview cycle board and the Asset Tilt
engine both consume.

Sprint scope:
  - Sprint 1 (live): Valuation, Credit, Growth (already calibrated upstream)
  - Sprint 2 (this script): Funding, Liquidity & Policy, Positioning & Breadth
    (calibrated 2026-05-03 — see PHASE1_SPRINT2_SPEC.md and PHASE1_SPRINT2_BACKTEST.md)

Mechanism state derivation (uniform across all 6):
  - 0 indicators in concerning quartile → Risk On
  - 1 → Neutral
  - 2 → Cautious
  - 3+ → Risk Off

Concerning quartile depends on each indicator's "direction":
  - high_is_concerning=True  → Q4 is concerning
  - high_is_concerning=False → Q1 is concerning

Quartile boundaries are computed once from post-2011 history (stable post-GFC regime)
and locked in cycle_board_snapshot.json. Production refresh updates each indicator's
current value, recomputes its quartile, and rolls up to mechanism state.
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

# Sprint 2 input panels — calibrated 2026-05-03 against post-2011 history.
# Direction: True = high reading is concerning, False = low reading is concerning.
SPRINT_2_PANELS: Dict[str, List[Tuple[str, str, bool]]] = {
    "funding": [
        ("cpff",          "Commercial Paper risk premium",     True),
        ("stlfsi",        "St. Louis Fed Financial Stress Index", True),
        ("bank_reserves", "Bank reserves at Fed",              False),
        ("rrp",           "Reverse repo balance",              False),
    ],
    "liquidity_policy": [
        ("anfci",    "Chicago Fed ANFCI",          True),
        ("fed_bs",   "Fed Balance Sheet YoY %",    False),
        ("sloos_ci", "SLOOS C&I lending standards", True),
        ("m2_yoy",   "M2 Money Supply YoY %",      False),
    ],
    "positioning_breadth": [
        ("skew",       "CBOE SKEW Index",                  True),
        ("vix",        "VIX (S&P 500 implied vol)",        True),
        ("eq_cr_corr", "Equity-Credit Correlation (60d)",  True),
        ("move",       "MOVE Index (Treasury vol)",        True),
    ],
}

MECHANISM_LABEL = {
    "valuation": "Valuation",
    "credit": "Credit",
    "funding": "Funding",
    "growth": "Growth",
    "liquidity_policy": "Liquidity & Policy",
    "positioning_breadth": "Positioning & Breadth",
}

QUARTILE_HISTORY_START = "2011-01-01"


def _load_indicator(ind: dict, key: str) -> Optional[Tuple[List[Tuple[str, float]], str, str]]:
    s = ind.get(key)
    if not isinstance(s, dict) or "points" not in s:
        return None
    pts = [(d, v) for d, v in s["points"] if v is not None and d >= QUARTILE_HISTORY_START]
    if not pts:
        return None
    return pts, s.get("unit", ""), s.get("source", "")


def _quartiles(values: List[float]) -> Tuple[float, float, float]:
    s = sorted(values)
    n = len(s)
    return s[n // 4], s[n // 2], s[3 * n // 4]


def _classify_quartile(value: float, q25: float, q50: float, q75: float) -> int:
    if value <= q25:
        return 1
    if value <= q50:
        return 2
    if value <= q75:
        return 3
    return 4


def _state_from_count(concerning_count: int) -> str:
    if concerning_count >= 3:
        return "Risk Off"
    if concerning_count == 2:
        return "Cautious"
    if concerning_count == 1:
        return "Neutral"
    return "Risk On"


def _compute_mechanism(mech_id: str, panel: List[Tuple[str, str, bool]],
                       indicators: dict) -> dict:
    indicator_rows = []
    concerning_count = 0
    for key, label, high_is_concerning in panel:
        loaded = _load_indicator(indicators, key)
        if loaded is None:
            indicator_rows.append({
                "id": key, "label": label, "status": "missing",
                "direction": "high_is_concerning" if high_is_concerning else "low_is_concerning",
            })
            continue
        pts, unit, source = loaded
        values = [v for _, v in pts]
        q25, q50, q75 = _quartiles(values)
        latest_date, latest_val = pts[-1]
        quartile = _classify_quartile(latest_val, q25, q50, q75)
        is_concerning = (quartile == 4 and high_is_concerning) or (quartile == 1 and not high_is_concerning)
        if is_concerning:
            concerning_count += 1
        indicator_rows.append({
            "id": key,
            "label": label,
            "direction": "high_is_concerning" if high_is_concerning else "low_is_concerning",
            "current": {"date": latest_date, "value": round(latest_val, 4), "unit": unit},
            "quartile": quartile,
            "in_concerning_quartile": is_concerning,
            "thresholds": {
                "q25": round(q25, 4), "q50": round(q50, 4), "q75": round(q75, 4),
                "history_window": f"{QUARTILE_HISTORY_START} to present",
            },
            "source": source,
        })

    state = _state_from_count(concerning_count)
    return {
        "id": mech_id,
        "name": MECHANISM_LABEL[mech_id],
        "state": state,
        "concerning_count": concerning_count,
        "total_indicators": len(panel),
        "indicators": indicator_rows,
        "rule": "0 concerning → Risk On · 1 → Neutral · 2 → Cautious · 3+ → Risk Off",
        "calibration": "sprint2_locked_2026_05_03",
    }


def _carry_forward_sprint1(calib: dict, mech_id: str) -> Optional[dict]:
    """Pass through Sprint 1 mechanisms (Valuation/Credit/Growth) from the live
    calibration JSON unchanged — Sprint 2 doesn't touch their math."""
    for tile in calib.get("tiles", []):
        if tile.get("id") == mech_id and tile.get("live"):
            return {
                "id": mech_id,
                "name": tile.get("name"),
                "state": tile.get("current_state", "Risk On"),
                "concerning_count": tile.get("rule_status", "").split(" ")[0] if tile.get("rule_status") else None,
                "total_indicators": len(tile.get("indicators", [])),
                "indicators": tile.get("indicators", []),
                "rule": tile.get("rule", {}).get("description", ""),
                "calibration": "sprint1_locked",
            }
    return None


def main() -> None:
    indicators = json.loads(INDICATOR_HISTORY.read_text())
    try:
        calib = json.loads(CALIB_REF.read_text())
    except FileNotFoundError:
        calib = {"tiles": []}

    mechanisms = []
    for sprint1_id in ("valuation", "credit", "growth"):
        m = _carry_forward_sprint1(calib, sprint1_id)
        if m:
            mechanisms.append(m)

    for sprint2_id, panel in SPRINT_2_PANELS.items():
        mechanisms.append(_compute_mechanism(sprint2_id, panel, indicators))

    # Page-level stance = aggregate count of mechanisms in concerning state
    # Cautious or Risk Off mechanisms count toward stress
    stress_mechs = sum(1 for m in mechanisms if m["state"] in ("Cautious", "Risk Off"))
    if stress_mechs >= 4:
        page_stance = "Risk Off"
    elif stress_mechs >= 3:
        page_stance = "Cautious"
    elif stress_mechs >= 1:
        page_stance = "Neutral"
    else:
        page_stance = "Risk On"

    snapshot = {
        "version": "v11.0.1",
        "framework": "cycle-mechanism-counting",
        "sprint": 2,
        "as_of": dt.datetime.utcnow().isoformat() + "Z",
        "page_stance": page_stance,
        "stress_mechanism_count": stress_mechs,
        "mechanisms": mechanisms,
    }
    SNAPSHOT_OUT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_OUT.write_text(json.dumps(snapshot, indent=2))
    print(f"Wrote {SNAPSHOT_OUT}")
    print(f"Page stance: {page_stance} ({stress_mechs} mechanisms in stress state)")
    for m in mechanisms:
        print(f"  {m['name']:24s} {m['state']:10s} concerning={m['concerning_count']}")


if __name__ == "__main__":
    main()
