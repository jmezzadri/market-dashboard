#!/usr/bin/env python3
"""
compute_cycle_v2.py — v2 Cycle Mechanism producer (PR 1).

Per CYCLE_MECHANISM_V2_SPEC.md (Joe approval 2026-05-10), this is the
horizon-aware Cycle Mechanism producer that emits:

  • Per-indicator IC profile (1m / 3m / 6m / 12m) computed against SPY
    forward log returns, using the per-sub-composite lookback window.
  • signal_type_at_horizon (momentum / mean_reversion / flat) derived
    from the IC sign at each horizon.
  • horizon_sensitive boolean (true if the signal_type sign flips
    across horizons — Buffett, bank_reserves, USD, CFNAI, etc.).
  • Sub-composite scores at each horizon, computed via the spec's
    horizon-aware scoring rule (Section 6.5): high score contributes
    as-is when IC at the horizon is negative (momentum); inverted
    (100 − raw) when IC is positive (mean_reversion → opportunity).
  • 3 headline scores at each horizon: Cycle & Value, Market Stress,
    Real Economy. Equal-weight average of the sub-composite scores in
    each headline.
  • 4-cell regime classification per horizon, with a horizon-specific
    recommended action.

The Real Economy sub-composite uses absolute thresholds per Section
6.2 (PMI 40/50/60, jobless claims 350K/230K/180K, etc.) — not
rolling percentile.

This producer runs ALONGSIDE the v1 single-composite producer
(compute_v11_mechanisms.py) until 2026-05-31 cutover. The v1 keeps
writing public/cycle_board_snapshot.json; we write public/cycle_v2.json.
Frontend consumers can opt into either during the transition window.

WRITES
──────
  public/cycle_v2.json — the full v2 panel keyed by indicator id,
  sub-composite, horizon, headline, and regime.

VALIDATION GATES (Section 9)
────────────────────────────
  • Per-indicator IC gate: |IC| ≥ 0.10 at AT LEAST ONE horizon.
    Indicators failing get passes_ic_gate: false and are EXCLUDED from
    sub-composite scoring (still surfaced in the JSON for transparency
    + the All Indicators detail view).
  • Sub-composite + headline scoring is robust to dropped indicators —
    if every indicator in a sub-composite is dropped, the sub-composite
    score for that horizon is None.

SOURCES
───────
  • public/indicator_history.json — every indicator's historical panel.
  • SPY weekly close via yfinance — for IC computation.

USAGE
─────
    python3 scripts/compute_cycle_v2.py
    # Writes public/cycle_v2.json. Idempotent and side-effect free
    # except for the output file.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
import warnings
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

REPO_ROOT = Path(__file__).resolve().parent.parent
INDICATOR_HISTORY = REPO_ROOT / "public" / "indicator_history.json"
OUT_PATH = REPO_ROOT / "public" / "cycle_v2.json"

# ─── horizons ──────────────────────────────────────────────────────────
HORIZONS_WEEKS: List[Tuple[int, str]] = [(4, "1m"), (13, "3m"), (26, "6m"), (52, "12m")]
HORIZON_LABELS = [h for _, h in HORIZONS_WEEKS]
PRIMARY_HORIZON = "6m"
IC_GATE = 0.10

# ─── sub-composite definitions (from spec section 4) ───────────────────
# Each indicator carries: id (canonical), history_key (in indicator_history.json),
# direction (high_is_concerning / low_is_concerning), and (for Real Economy)
# absolute thresholds.
SUB_COMPOSITE_DEFS: Dict[str, Dict[str, Any]] = {
    "Equities": {
        "label": "Equities",
        "lookback_start": "1986-01-01",
        "scoring": "percentile",
        "indicators": [
            {"id": "cape",        "history_key": "cape",        "direction": "high_is_concerning"},
            {"id": "erp",         "history_key": "erp",         "direction": "low_is_concerning"},
            {"id": "buffett",     "history_key": "buffett",     "direction": "high_is_concerning"},
            {"id": "bkx_spx",     "history_key": "bkx_spx",     "direction": "low_is_concerning"},
        ],
    },
    "Credit": {
        "label": "Credit",
        "lookback_start": "2011-01-01",
        "scoring": "percentile",
        "indicators": [
            {"id": "hy_oas",      "history_key": "hy_ig",       "direction": "high_is_concerning"},
            {"id": "ig_oas",      "history_key": "ig_oas",      "direction": "high_is_concerning"},
            {"id": "hy_ig_ratio", "history_key": "hy_ig_ratio", "direction": "high_is_concerning"},
            {"id": "cmdi",        "history_key": "cmdi",        "direction": "high_is_concerning"},
            {"id": "loan_syn",    "history_key": "loan_syn",    "direction": "high_is_concerning"},
        ],
    },
    "Rates": {
        "label": "Rates",
        "lookback_start": "1986-01-01",
        "scoring": "percentile",
        "indicators": [
            {"id": "yield_curve",   "history_key": "yield_curve",   "direction": "low_is_concerning"},
            {"id": "term_premium",  "history_key": "term_premium",  "direction": "high_is_concerning"},
            {"id": "breakeven_10y", "history_key": "breakeven_10y", "direction": "high_is_concerning"},
            {"id": "real_fedfunds", "history_key": "real_fedfunds", "direction": "high_is_concerning"},
            # real_rates explicitly demoted from scoring per spec section 4.3
            # (level form fails IC gate at every horizon; visible on detail view only)
        ],
    },
    "MoneyBanking": {
        "label": "Money / Banking",
        "lookback_start": "2008-01-01",
        "scoring": "percentile",
        "indicators": [
            {"id": "m2_yoy",        "history_key": "m2_yoy",        "direction": "low_is_concerning"},
            {"id": "fed_bs",        "history_key": "fed_bs",        "direction": "low_is_concerning"},
            {"id": "bank_reserves", "history_key": "bank_reserves", "direction": "low_is_concerning"},
            {"id": "bank_credit",   "history_key": "bank_credit",   "direction": "low_is_concerning"},
            {"id": "bank_unreal",   "history_key": "bank_unreal",   "direction": "high_is_concerning"},
        ],
    },
    "Funding": {
        "label": "Funding",
        "lookback_start": "2011-01-01",
        "scoring": "percentile",
        "indicators": [
            {"id": "cpff",     "history_key": "cpff",     "direction": "high_is_concerning"},
            {"id": "stlfsi",   "history_key": "stlfsi",   "direction": "high_is_concerning"},
            {"id": "anfci",    "history_key": "anfci",    "direction": "high_is_concerning"},
            {"id": "fra_ois",  "history_key": "fra_ois",  "direction": "high_is_concerning"},
            {"id": "sofr_ois", "history_key": "sofr_ois", "direction": "high_is_concerning"},
            {"id": "rrp",      "history_key": "rrp",      "direction": "low_is_concerning"},
            {"id": "tga",      "history_key": "tga",      "direction": "high_is_concerning"},
        ],
    },
    "RealEconomy": {
        "label": "Real Economy",
        "lookback_start": None,  # absolute-threshold scoring (Section 6.2)
        "scoring": "threshold",
        "indicators": [
            {"id": "ism_mfg",    "history_key": "ism_mfg",    "direction": "low_is_concerning",
             "thresholds": {"max_stress": 40,   "neutral": 50,  "peak_strength": 60}},
            {"id": "ism_svc",    "history_key": "ism_svc",    "direction": "low_is_concerning",
             "thresholds": {"max_stress": 40,   "neutral": 50,  "peak_strength": 60}},
            {"id": "gdpnow",     "history_key": "gdpnow",     "direction": "low_is_concerning",
             "thresholds": {"max_stress": -3.0, "neutral": 1.5, "peak_strength": 5.0}},
            {"id": "jobless",    "history_key": "jobless",    "direction": "high_is_concerning",
             "thresholds": {"max_stress": 350,  "neutral": 230, "peak_strength": 180}},
            {"id": "jolts_quits", "history_key": "jolts_quits", "direction": "low_is_concerning",
             "thresholds": {"max_stress": 1.5,  "neutral": 2.5, "peak_strength": 3.5}},
            {"id": "cfnai_3ma",  "history_key": "cfnai_3ma",  "direction": "low_is_concerning",
             "thresholds": {"max_stress": -1.0, "neutral": 0.0, "peak_strength": 1.0}},
            {"id": "copper_gold","history_key": "copper_gold","direction": "low_is_concerning",
             # Copper/Gold ratio YoY % — series in indicator_history is the ratio level,
             # so we compute YoY change at score time.
             "thresholds": {"max_stress": -20, "neutral": 0,   "peak_strength": 20},
             "transform": "yoy_pct"},
        ],
    },
    "PositioningVol": {
        "label": "Positioning / Vol",
        "lookback_start": "2011-01-01",
        "scoring": "percentile",
        "indicators": [
            {"id": "vix",        "history_key": "vix",        "direction": "high_is_concerning"},
            {"id": "move",       "history_key": "move",       "direction": "high_is_concerning"},
            {"id": "skew",       "history_key": "skew",       "direction": "high_is_concerning"},
            {"id": "naaim",      "history_key": "naaim",      "direction": "low_is_concerning"},
            {"id": "spx_200dma", "history_key": "spx_200dma", "direction": "low_is_concerning"},
            {"id": "eq_cr_corr", "history_key": "eq_cr_corr", "direction": "high_is_concerning"},
        ],
    },
}

# ─── headline definitions (from spec section 5) ────────────────────────
HEADLINE_DEFS: Dict[str, Dict[str, Any]] = {
    "cycle_value": {
        "label": "Cycle & Value",
        "tagline": "The Setup",
        "subcomposites": ["Equities", "Rates", "MoneyBanking"],
        "question": "Is the structural backdrop high-risk or low-risk?",
    },
    "market_stress": {
        "label": "Market Stress",
        "tagline": "The Panic",
        "subcomposites": ["Credit", "Funding", "PositioningVol"],
        "question": "Are the markets actually breaking right now?",
    },
    "real_economy": {
        "label": "Real Economy",
        "tagline": "The Truth",
        "subcomposites": ["RealEconomy"],
        "question": "Is the real world confirming what the market is saying?",
    },
}

# ─── regime classifier (from spec section 8) ───────────────────────────
# (setup_low, setup_high, stress_low, stress_high, label, action_by_horizon)
REGIME_DEFS: List[Tuple[float, float, float, float, str, Dict[str, str]]] = [
    (60, 100, 0, 40, "Late-cycle setup", {
        "1m":  "Hold or trim slightly — momentum likely persists near-term",
        "3m":  "Pull a little risk off — late-cycle but no panic yet",
        "6m":  "Pull a little risk off — strategic trim, raise quality",
        "12m": "De-risk — multi-quarter valuation drag",
    }),
    (60, 100, 60, 100, "Late-cycle correction", {
        "1m":  "Hedge entries — vol about to cluster",
        "3m":  "Pull a lot of risk off — defensive overweight",
        "6m":  "Pull a lot of risk off — hedges on",
        "12m": "De-risk strategically — wait for capitulation",
    }),
    (0, 40, 60, 100, "Capitulation / panic", {
        "1m":  "Sell covered calls — harvest panic premium",
        "3m":  "Sell covered calls / size capitulation entries",
        "6m":  "Capitulation buy — mean-reversion plays out",
        "12m": "Lever up — recovery + cheap setup combined",
    }),
    (0, 40, 0, 40, "Early expansion", {
        "1m":  "Risk-on — momentum continues",
        "3m":  "Risk-on — trend confirmed",
        "6m":  "Risk-on / leverage in line with risk tolerance",
        "12m": "Strategic overweight equities",
    }),
]

REGIME_FALLBACK = ("Mixed regime", {
    "1m":  "Neutral — wait for confirmation",
    "3m":  "Neutral — wait for confirmation",
    "6m":  "Neutral — wait for confirmation",
    "12m": "Neutral — wait for confirmation",
})


# ─── tiny pure-numpy spearmanr (no scipy dependency) ───────────────────
def spearmanr(x: List[float], y: List[float]) -> float:
    if len(x) != len(y) or len(x) < 3:
        return 0.0
    import numpy as np
    xa = np.asarray(x, dtype=float)
    ya = np.asarray(y, dtype=float)
    rx = np.argsort(np.argsort(xa)).astype(float)
    ry = np.argsort(np.argsort(ya)).astype(float)
    rx -= rx.mean(); ry -= ry.mean()
    denom = math.sqrt(float((rx**2).sum()) * float((ry**2).sum()))
    if denom == 0:
        return 0.0
    return float((rx * ry).sum() / denom)


# ─── helpers for indicator series + scoring ────────────────────────────
def to_friday(d_str: str) -> Optional[dt.date]:
    try:
        d = dt.date.fromisoformat(d_str)
    except ValueError:
        return None
    return d + dt.timedelta(days=(4 - d.weekday()) % 7)


def latest_value(series_points: List[Tuple[str, Any]]) -> Tuple[Optional[float], Optional[str]]:
    """Latest non-null (date, value) in a series."""
    for d, v in reversed(series_points):
        if v is not None:
            try:
                return float(v), d
            except (TypeError, ValueError):
                continue
    return None, None


def percentile_score(value: float, sample: List[float], direction: str) -> float:
    """Direction-corrected percentile in 0..100. Empty sample → 50."""
    if not sample:
        return 50.0
    below = sum(1 for v in sample if v < value)
    pct = below / len(sample) * 100.0
    if direction == "low_is_concerning":
        return 100.0 - pct
    return pct  # high_is_concerning is the default


def threshold_score(value: float, anchors: Dict[str, float], direction: str) -> float:
    """Linear interpolation between (max_stress=100, neutral=50, peak_strength=0)
    anchors per spec Section 6.2. Capped at [0, 100] outside the anchor range."""
    max_stress = float(anchors["max_stress"])
    neutral = float(anchors["neutral"])
    peak = float(anchors["peak_strength"])
    # If direction is "low_is_concerning", max_stress is the SMALLER anchor
    # (e.g. ISM PMI: max_stress=40, neutral=50, peak=60). Linear interpolation
    # between the three anchors maps:
    #   value = max_stress     → 100
    #   value = neutral        →  50
    #   value = peak_strength  →   0
    # Outside the anchor range we clamp at 0 or 100.
    if direction == "low_is_concerning":
        if value <= max_stress:
            return 100.0
        if value >= peak:
            return 0.0
        if value <= neutral:
            # interpolate between max_stress (100) and neutral (50)
            t = (value - max_stress) / (neutral - max_stress)
            return 100.0 - t * 50.0
        # interpolate between neutral (50) and peak (0)
        t = (value - neutral) / (peak - neutral)
        return 50.0 - t * 50.0
    # high_is_concerning: max_stress is the LARGER anchor (e.g. jobless 350/230/180).
    if value >= max_stress:
        return 100.0
    if value <= peak:
        return 0.0
    if value >= neutral:
        t = (value - neutral) / (max_stress - neutral)
        return 50.0 + t * 50.0
    t = (value - peak) / (neutral - peak)
    return t * 50.0


def yoy_pct_change(points: List[Tuple[str, Any]], as_of_date: dt.date) -> Optional[float]:
    """Compute YoY % change in a series, anchored at as_of_date."""
    one_year_ago = as_of_date - dt.timedelta(days=365)
    cur = None
    prior = None
    for d_str, v in points:
        if v is None:
            continue
        try:
            d = dt.date.fromisoformat(d_str)
        except ValueError:
            continue
        if d <= as_of_date:
            cur = float(v); cur_d = d
        if d <= one_year_ago:
            prior = float(v)
    if cur is None or prior is None or prior == 0:
        return None
    return (cur / prior - 1.0) * 100.0


# ─── IC computation ────────────────────────────────────────────────────
def fetch_spy_weekly() -> Tuple[List[float], List[dt.date]]:
    """Pull SPY adjusted-close weekly bars via yfinance, 1986-01 → today."""
    import yfinance as yf
    import numpy as np
    end = dt.date.today()
    start = "1986-01-01"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        df = yf.download("SPY", start=start, end=end.isoformat(),
                         interval="1wk", progress=False, auto_adjust=False)
    if df is None or df.empty:
        raise RuntimeError("yfinance returned no SPY history")
    if df.columns.nlevels == 2:
        adj = df["Adj Close"]["SPY"]
    else:
        adj = df["Adj Close"]
    adj = adj.dropna()
    spy_log = list(np.log(adj.values))
    spy_dates = [d.date() for d in adj.index]
    return spy_log, spy_dates


def compute_ic_profile(
    indicator_id: str,
    history_points: List[Tuple[str, Any]],
    direction: str,
    lookback_start: str,
    spy_log: List[float],
    spy_dates: List[dt.date],
) -> Dict[str, Optional[float]]:
    """Compute IC at each horizon for one indicator. Returns {1m: ic, 3m: ic, ...}.
    None at a horizon if the test had < 50 aligned observations.
    """
    # Snap each indicator point to its Friday-of-week bucket
    by_friday: Dict[dt.date, float] = {}
    for d_str, v in history_points:
        if v is None:
            continue
        try:
            f = to_friday(d_str)
            if f is None:
                continue
            by_friday[f] = float(v)
        except (TypeError, ValueError):
            continue
    if len(by_friday) < 24:
        return {h: None for h in HORIZON_LABELS}

    sorted_fridays = sorted(by_friday.keys())
    lookback_dt = dt.date.fromisoformat(lookback_start)

    # For each spy_date, find the latest indicator value on or before that date,
    # then compute its rolling-window-percentile score (direction-corrected).
    scores: List[Optional[float]] = []
    for d in spy_dates:
        sample = [by_friday[k] for k in sorted_fridays if lookback_dt <= k <= d]
        if len(sample) < 24:
            scores.append(None)
            continue
        cur = sample[-1]
        scores.append(percentile_score(cur, sample[:-1], direction))

    out: Dict[str, Optional[float]] = {}
    for w, label in HORIZONS_WEEKS:
        x: List[float] = []; y: List[float] = []
        for i in range(len(spy_log) - w):
            s = scores[i]
            if s is None:
                continue
            x.append(s); y.append(spy_log[i + w] - spy_log[i])
        if len(x) < 50:
            out[label] = None
        else:
            out[label] = round(spearmanr(x, y), 3)
    return out


def signal_type_at_horizon(ic: Optional[float]) -> str:
    if ic is None or abs(ic) < IC_GATE:
        return "flat"
    return "momentum" if ic < 0 else "mean_reversion"


def is_horizon_sensitive(ic_profile: Dict[str, Optional[float]]) -> bool:
    """True if the signal_type sign flips across horizons (not counting flats)."""
    seen = set()
    for h in HORIZON_LABELS:
        st = signal_type_at_horizon(ic_profile.get(h))
        if st != "flat":
            seen.add(st)
    return len(seen) >= 2


# ─── horizon-aware sub-composite scoring (Section 6.5) ─────────────────
def horizon_aware_subcomposite_score(
    indicator_rows: List[Dict[str, Any]],
    horizon: str,
) -> Tuple[Optional[int], int, int]:
    """Average each indicator's CURRENT direction-corrected score, with
    sign-flip when the indicator's IC at this horizon is positive
    (mean_reversion → high score is OPPORTUNITY → invert to 100 − raw).

    Returns (score, n_scored, n_eligible). score is None if no indicators
    contribute at this horizon.
    """
    contribs: List[float] = []
    eligible = 0
    for ind in indicator_rows:
        if ind.get("current_score") is None:
            continue
        if not ind.get("passes_ic_gate"):
            continue
        eligible += 1
        ic_at_h = ind.get("ic_profile", {}).get(horizon)
        if ic_at_h is None or abs(ic_at_h) < IC_GATE:
            continue  # no signal at this horizon for this indicator
        raw = float(ind["current_score"])
        if ic_at_h < 0:
            # momentum: high score → low forward return → "more concerning" → contribute as-is
            contribs.append(raw)
        else:
            # mean_reversion: high score → high forward return → "opportunity at this horizon"
            # → invert so it CONTRIBUTES NEGATIVELY to "more concerning"
            contribs.append(100.0 - raw)
    if not contribs:
        return None, 0, eligible
    return round(sum(contribs) / len(contribs)), len(contribs), eligible


# ─── regime classifier ─────────────────────────────────────────────────
def classify_regime(setup: Optional[float], stress: Optional[float],
                     real_econ: Optional[float]) -> Tuple[str, Dict[str, str], str]:
    """Return (label, action_by_horizon, real_economy_caption)."""
    if setup is None or stress is None:
        return "Mixed regime", REGIME_FALLBACK[1], "real economy reading unavailable"
    for s_lo, s_hi, st_lo, st_hi, label, actions in REGIME_DEFS:
        if s_lo <= setup <= s_hi and st_lo <= stress <= st_hi:
            re_caption = real_economy_caption(real_econ)
            return label, actions, re_caption
    return REGIME_FALLBACK[0], REGIME_FALLBACK[1], real_economy_caption(real_econ)


def real_economy_caption(real_econ: Optional[float]) -> str:
    if real_econ is None:
        return "real economy reading unavailable"
    if real_econ < 40:
        return "real economy expanding — market read confirmed for risk-on / fragile for risk-off"
    if real_econ < 60:
        return "real economy mid-range — market read uncorroborated"
    return "real economy weakening — market read confirmed for risk-off / suspect for risk-on"


# ─── main ──────────────────────────────────────────────────────────────
def main() -> int:
    if not INDICATOR_HISTORY.exists():
        print(f"FATAL: {INDICATOR_HISTORY} missing", file=sys.stderr)
        return 2
    history = json.loads(INDICATOR_HISTORY.read_text())
    today = dt.date.today()

    print(f"Fetching SPY weekly history (1986+)...")
    try:
        spy_log, spy_dates = fetch_spy_weekly()
        print(f"  SPY weekly bars: {len(spy_log)}, {spy_dates[0]} → {spy_dates[-1]}")
    except Exception as e:
        print(f"FATAL: SPY fetch failed: {e}", file=sys.stderr)
        return 2

    indicator_rows: List[Dict[str, Any]] = []
    indicators_by_subcomposite: Dict[str, List[Dict[str, Any]]] = {}

    for sub_id, sub_def in SUB_COMPOSITE_DEFS.items():
        indicators_by_subcomposite[sub_id] = []
        for ind_cfg in sub_def["indicators"]:
            ind_id = ind_cfg["id"]
            history_key = ind_cfg["history_key"]
            direction = ind_cfg["direction"]
            series = history.get(history_key)
            row: Dict[str, Any] = {
                "id": ind_id,
                "history_key": history_key,
                "sub_composite": sub_id,
                "direction": direction,
                "current_value": None,
                "current_value_as_of": None,
                "current_score": None,
                "ic_profile": {h: None for h in HORIZON_LABELS},
                "signal_type_at_horizon": {h: "flat" for h in HORIZON_LABELS},
                "primary_signal_type": "flat",
                "horizon_sensitive": False,
                "passes_ic_gate": False,
                "scoring": sub_def["scoring"],
                "lookback_start": sub_def["lookback_start"],
            }

            # No data → record null and continue
            if not series or "points" not in series:
                row["status"] = "no_data"
                indicator_rows.append(row)
                indicators_by_subcomposite[sub_id].append(row)
                continue

            points: List[Tuple[str, Any]] = series["points"]
            if not points:
                row["status"] = "empty_series"
                indicator_rows.append(row)
                indicators_by_subcomposite[sub_id].append(row)
                continue

            # Current value
            current_value, current_as_of = latest_value(points)
            row["current_value"] = current_value
            row["current_value_as_of"] = current_as_of

            # Current score
            if sub_def["scoring"] == "threshold":
                value_for_score = current_value
                if ind_cfg.get("transform") == "yoy_pct" and current_as_of:
                    try:
                        as_of_date = dt.date.fromisoformat(current_as_of)
                    except ValueError:
                        as_of_date = today
                    value_for_score = yoy_pct_change(points, as_of_date)
                if value_for_score is not None and "thresholds" in ind_cfg:
                    row["current_score"] = round(threshold_score(
                        value_for_score, ind_cfg["thresholds"], direction))
                    row["scored_value"] = round(value_for_score, 3)
                else:
                    row["current_score"] = None
            else:
                # percentile
                lookback_dt = dt.date.fromisoformat(sub_def["lookback_start"])
                sample = [
                    float(v) for d, v in points
                    if v is not None and dt.date.fromisoformat(d) >= lookback_dt
                ]
                if current_value is not None and len(sample) >= 24:
                    row["current_score"] = round(percentile_score(
                        current_value, sample[:-1] if sample[-1:] == [current_value] else sample,
                        direction))
                    row["sample_size"] = len(sample)

            # IC profile (only for percentile-scored series — threshold-scored
            # series like Real Economy don't need IC because the score is
            # absolute, not relative to history)
            if sub_def["scoring"] == "percentile":
                row["ic_profile"] = compute_ic_profile(
                    ind_id, points, direction, sub_def["lookback_start"],
                    spy_log, spy_dates,
                )
            else:
                # For threshold-scored RealEconomy indicators, run the IC test
                # on the threshold-score series so we can still tag signal_type
                # at each horizon for the regime classifier.
                row["ic_profile"] = compute_ic_profile_threshold(
                    points, ind_cfg, spy_log, spy_dates,
                )

            # Signal type tagging
            row["signal_type_at_horizon"] = {
                h: signal_type_at_horizon(row["ic_profile"].get(h))
                for h in HORIZON_LABELS
            }
            row["primary_signal_type"] = row["signal_type_at_horizon"][PRIMARY_HORIZON]
            row["horizon_sensitive"] = is_horizon_sensitive(row["ic_profile"])
            row["passes_ic_gate"] = any(
                ic is not None and abs(ic) >= IC_GATE
                for ic in row["ic_profile"].values()
            )

            indicator_rows.append(row)
            indicators_by_subcomposite[sub_id].append(row)

    # Sub-composite scores per horizon
    subcomposite_scores: Dict[str, Dict[str, Any]] = {}
    for sub_id, sub_def in SUB_COMPOSITE_DEFS.items():
        rows = indicators_by_subcomposite[sub_id]
        per_horizon: Dict[str, Optional[int]] = {}
        per_horizon_n: Dict[str, int] = {}
        per_horizon_eligible: Dict[str, int] = {}
        for h in HORIZON_LABELS:
            score, n_scored, n_eligible = horizon_aware_subcomposite_score(rows, h)
            per_horizon[h] = score
            per_horizon_n[h] = n_scored
            per_horizon_eligible[h] = n_eligible
        subcomposite_scores[sub_id] = {
            "label": sub_def["label"],
            "scores_by_horizon": per_horizon,
            "n_scored_by_horizon": per_horizon_n,
            "n_eligible_by_horizon": per_horizon_eligible,
            "n_indicators_total": len(rows),
        }

    # Headline scores per horizon — equal weight average of sub-composite scores
    headlines: Dict[str, Dict[str, Any]] = {}
    for headline_id, headline_def in HEADLINE_DEFS.items():
        per_horizon: Dict[str, Optional[int]] = {}
        per_horizon_n: Dict[str, int] = {}
        for h in HORIZON_LABELS:
            scores = []
            for sub_id in headline_def["subcomposites"]:
                s = subcomposite_scores[sub_id]["scores_by_horizon"].get(h)
                if s is not None:
                    scores.append(s)
            per_horizon[h] = round(sum(scores) / len(scores)) if scores else None
            per_horizon_n[h] = len(scores)
        headlines[headline_id] = {
            "label": headline_def["label"],
            "tagline": headline_def["tagline"],
            "question": headline_def["question"],
            "subcomposites": headline_def["subcomposites"],
            "scores_by_horizon": per_horizon,
            "n_subcomposites_by_horizon": per_horizon_n,
        }

    # Regime classifier per horizon
    regimes: Dict[str, Dict[str, Any]] = {}
    for h in HORIZON_LABELS:
        setup = headlines["cycle_value"]["scores_by_horizon"][h]
        stress = headlines["market_stress"]["scores_by_horizon"][h]
        real_econ = headlines["real_economy"]["scores_by_horizon"][h]
        label, actions, re_caption = classify_regime(setup, stress, real_econ)
        regimes[h] = {
            "label": label,
            "recommended_action": actions[h],
            "real_economy_caption": re_caption,
            "setup": setup,
            "stress": stress,
            "real_economy": real_econ,
        }

    # Validation summary
    n_indicators = len(indicator_rows)
    n_passes_gate = sum(1 for r in indicator_rows if r["passes_ic_gate"])
    n_horizon_sensitive = sum(1 for r in indicator_rows if r["horizon_sensitive"])

    out = {
        "_doc": (
            "v2 Cycle Mechanism panel — horizon-aware. Per CYCLE_MECHANISM_V2_SPEC.md "
            "(Joe approval 2026-05-10). Refreshed daily by "
            "scripts/compute_cycle_v2.py at 22:30 UTC weekdays. Runs alongside the v1 "
            "single-composite producer until 2026-05-31 cutover."
        ),
        "as_of": today.isoformat(),
        "framework": "v11 cycle mechanisms v2 — horizon-aware",
        "spec_doc": "/Users/joemezzadri/Documents/market-dashboard/CYCLE_MECHANISM_V2_SPEC.md",
        "horizons": HORIZON_LABELS,
        "primary_horizon": PRIMARY_HORIZON,
        "ic_gate": IC_GATE,
        "validation_summary": {
            "n_indicators_total": n_indicators,
            "n_passes_ic_gate": n_passes_gate,
            "n_horizon_sensitive": n_horizon_sensitive,
        },
        "indicators": indicator_rows,
        "subcomposites": subcomposite_scores,
        "headlines": headlines,
        "regimes": regimes,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2) + "\n")

    # Console summary
    print()
    print(f"=== Cycle Mechanism v2 — {today.isoformat()} ===")
    print(f"Indicators: {n_indicators} total · {n_passes_gate} pass IC gate · "
          f"{n_horizon_sensitive} horizon-sensitive")
    print()
    print(f"{'sub-composite':<18} {'1m':>5} {'3m':>5} {'6m':>5} {'12m':>5}  scored/eligible@6m")
    print("─" * 75)
    for sub_id, sub_def in SUB_COMPOSITE_DEFS.items():
        s = subcomposite_scores[sub_id]
        sb = s["scores_by_horizon"]
        ns = s["n_scored_by_horizon"][PRIMARY_HORIZON]
        ne = s["n_eligible_by_horizon"][PRIMARY_HORIZON]
        print(f"  {sub_def['label']:<16} "
              f"{str(sb['1m']):>5} {str(sb['3m']):>5} {str(sb['6m']):>5} {str(sb['12m']):>5}  "
              f"{ns}/{ne}")
    print()
    print(f"{'headline':<22} {'1m':>5} {'3m':>5} {'6m':>5} {'12m':>5}")
    print("─" * 55)
    for headline_id, headline_def in HEADLINE_DEFS.items():
        h = headlines[headline_id]
        sb = h["scores_by_horizon"]
        print(f"  {headline_def['label']:<20} "
              f"{str(sb['1m']):>5} {str(sb['3m']):>5} {str(sb['6m']):>5} {str(sb['12m']):>5}")
    print()
    print("Regime by horizon:")
    for h in HORIZON_LABELS:
        r = regimes[h]
        print(f"  [{h}] {r['label']:<22} → {r['recommended_action']}")
        print(f"        Setup={r['setup']}  Stress={r['stress']}  RE={r['real_economy']}")
    print()
    print(f"Wrote {OUT_PATH}")
    return 0


def compute_ic_profile_threshold(
    history_points: List[Tuple[str, Any]],
    ind_cfg: Dict[str, Any],
    spy_log: List[float],
    spy_dates: List[dt.date],
) -> Dict[str, Optional[float]]:
    """IC profile for a threshold-scored Real Economy indicator. Score is the
    absolute-threshold transform (Section 6.2) applied to each historical
    point; IC then computed against SPY forward log returns."""
    direction = ind_cfg["direction"]
    anchors = ind_cfg["thresholds"]
    transform = ind_cfg.get("transform")

    # Snap series to weekly Friday buckets
    by_friday: Dict[dt.date, float] = {}
    sorted_pts: List[Tuple[dt.date, float]] = []
    for d_str, v in history_points:
        if v is None:
            continue
        try:
            d = dt.date.fromisoformat(d_str)
        except ValueError:
            continue
        sorted_pts.append((d, float(v)))
    sorted_pts.sort()
    for d, v in sorted_pts:
        f = d + dt.timedelta(days=(4 - d.weekday()) % 7)
        by_friday[f] = v
    if len(by_friday) < 24:
        return {h: None for h in HORIZON_LABELS}

    sorted_fridays = sorted(by_friday.keys())
    scores: List[Optional[float]] = []
    for d in spy_dates:
        # latest value on or before d
        latest = None
        latest_d = None
        for f in reversed(sorted_fridays):
            if f <= d:
                latest = by_friday[f]; latest_d = f
                break
        if latest is None:
            scores.append(None); continue
        if transform == "yoy_pct":
            value = yoy_pct_change([(p_d.isoformat(), p_v) for p_d, p_v in sorted_pts],
                                    latest_d)
            if value is None:
                scores.append(None); continue
        else:
            value = latest
        scores.append(threshold_score(value, anchors, direction))

    out: Dict[str, Optional[float]] = {}
    for w, label in HORIZONS_WEEKS:
        x: List[float] = []; y: List[float] = []
        for i in range(len(spy_log) - w):
            s = scores[i]
            if s is None: continue
            x.append(s); y.append(spy_log[i + w] - spy_log[i])
        out[label] = round(spearmanr(x, y), 3) if len(x) >= 50 else None
    return out


if __name__ == "__main__":
    raise SystemExit(main())
