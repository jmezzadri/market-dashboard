#!/usr/bin/env python3
"""
backtest_scenario_stress.py — Phase 2D backtest harness.

For each (scenario × mechanism) pair, compares the model's PREDICTED stressed
score (read from public/scenario_stress.json — computed from hand-curated
calibration values by Phase 2C) against the OBSERVED v11 mechanism score for
the scenario's peak date (computed by replaying the same v11 scoring math
against indicator_history.json values as of that date).

Tolerance, per scope doc SCENARIO_STRESS_PHASE2_SCOPE.md:
  • mechanism level — |predicted - observed| <= 15  percentile points
  • composite level — |predicted - observed| <= 10  percentile points

Outputs:
  • dist/scenario_stress_backtest/SUMMARY.json   — full machine-readable result
  • dist/scenario_stress_backtest/SUMMARY.md     — top-level pass/fail table
  • dist/scenario_stress_backtest/<scenario>.pdf — one PDF per scenario
                                                   (predicted vs observed +
                                                    indicator-level detail)

Exit codes:
  0 — every observable (scenario × mechanism) pair is within tolerance
  1 — at least one observable pair is outside tolerance (calibration rejected)
  2 — a hard input is missing (scenario_stress.json or indicator_history.json)

NOT-OBSERVABLE pairs (peak date predates indicator_history.json coverage)
DO NOT cause a non-zero exit — they are reported as "self-attest" rows so
Senior Quant can still evidence the calibration based on documented sources
in the calibration JSON's source_note field.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
CALIB_PATH = REPO_ROOT / "public" / "scenario_stress_calibration.json"
INDICATOR_HISTORY_PATH = REPO_ROOT / "public" / "indicator_history.json"
PRED_PATH = REPO_ROOT / "public" / "scenario_stress.json"
OUT_DIR = REPO_ROOT / "dist" / "scenario_stress_backtest"

# Match the producer's history window so PREDICTED + OBSERVED use the same
# percentile sample. If we ever change one, change both.
HISTORY_START = "2011-01-01"

# Maximum days BEFORE the peak date we'll accept as "the observation" for
# an indicator. Beyond this, the indicator is marked NOT_OBSERVABLE for
# that scenario even if the series exists.
OBSERVATION_LOOKBACK_DAYS = 180

# Tolerance bands (percentile points).
MECHANISM_TOLERANCE_PP = 15
COMPOSITE_TOLERANCE_PP = 10

# Same alias map the producer uses; copied here so the harness is
# self-contained. If you change one, change both.
INDICATOR_HISTORY_ALIAS: Dict[str, str] = {
    "hy_oas": "hy_ig",
    "fed_bs_yoy": "fed_bs",
    "ism_mfg": "ism",
    "ism_svc": "ism",
}

# Same documented-no-history list the producer uses.
INDICATORS_NO_HISTORY = {
    "ig_hy_ratio",
}

MECHANISM_ORDER = [
    ("valuation",            "01", "Equity Valuations"),
    ("credit",               "02", "Credit"),
    ("funding",              "03", "Funding"),
    ("growth",               "04", "Growth"),
    ("liquidity_policy",     "05", "Liquidity & Policy"),
    ("positioning_breadth",  "06", "Positioning & Breadth"),
]


# ─── scoring helpers (same convention as producer + live v11 scorer) ────────
def direction_corrected_score(percentile: float, direction: str) -> float:
    d = (direction or "high_is_concerning").lower()
    if d in ("low_is_concerning", "bidir_bottom"):
        return 100.0 - percentile
    return percentile


def percentile_of(value: float, sorted_sample: List[float]) -> float:
    n = len(sorted_sample)
    if n == 0:
        return 50.0
    below = sum(1 for v in sorted_sample if v < value)
    return below / n * 100.0


def historical_sample(indicators: dict, calib_id: str) -> Optional[List[float]]:
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


# ─── peak-date parsing + observation lookup ─────────────────────────────────
ISO_DATE = re.compile(r"(\d{4}-\d{2}-\d{2})")
ANCHOR_RE = re.compile(r"anchor:\s*(\d{4}-\d{2}-\d{2})")


def parse_peak_window_range(peak_window: str
                            ) -> Tuple[Optional[str], Optional[str]]:
    """
    Return (start_date, end_date) for the scenario's peak window. The
    calibration's peak_window string is shaped 'YYYY-MM-DD to YYYY-MM-DD
    (note)' — possibly with an explicit 'anchor: YYYY-MM-DD' inside.

    Both endpoints come from the 'X to Y' portion. The anchor — if
    present — is returned alongside via parse_peak_date for code that
    only needs a single peak point.
    """
    if not peak_window:
        return None, None
    matches = ISO_DATE.findall(peak_window)
    if len(matches) >= 2:
        return matches[0], matches[1]
    if len(matches) == 1:
        return matches[0], matches[0]
    return None, None


def parse_peak_date(peak_window: str) -> Optional[str]:
    """
    The single 'peak point' to label the scenario by. Prefer an explicit
    'anchor: YYYY-MM-DD' if present; otherwise fall back to the end-date
    of the X-to-Y window.
    """
    if not peak_window:
        return None
    m = ANCHOR_RE.search(peak_window)
    if m:
        return m.group(1)
    _start, end = parse_peak_window_range(peak_window)
    return end


def worst_in_window(
    indicators: dict, calib_id: str, peak_date: str,
    peak_window_start: Optional[str], peak_window_end: Optional[str],
    direction: str,
) -> Tuple[Optional[float], Optional[str]]:
    """
    Return (value, observed_date) for the observation closest in time to
    the scenario's anchor peak_date, subject to a hard 45-day coverage
    rule.

    Priority order:
      1. The LATEST observation on or before peak_date, within
         OBSERVATION_LOOKBACK_DAYS, AND within 45 days of peak_date.
      2. If no on-or-before observation is within 45 days, fall back
         to the EARLIEST observation in (peak_date, peak_date + 45d].
      3. Otherwise (None, None) — the indicator's coverage doesn't span
         the peak. The harness drops this indicator from the comparison
         and re-aggregates the mechanism on the matched subset only.

    The 45-day window is data-coverage-driven. Quarterly series (e.g.,
    hy_ig / ig_oas pre-2023) report at quarter-end; if the scenario peak
    happens 60+ days from the nearest quarter-end, no point on the
    series captures the peak event and pretending one does would
    silently mis-stress the mechanism. 45 days is wide enough to catch
    monthly series reporting around the peak (covid_2020 anchor
    2020-03-23 finds CAPE 2020-03-01, ERP 2020-03-31) and narrow enough
    to drop quarterly series that are too far away (covid_2020 anchor
    finds hy_ig 2019-12-31 / 83 days, drops it).

    `peak_window_start` / `peak_window_end` accepted but not consulted —
    preserved for future per-mechanism timing rules.
    """
    history_key = INDICATOR_HISTORY_ALIAS.get(calib_id, calib_id)
    series = indicators.get(history_key)
    if not isinstance(series, dict):
        return None, None
    points = series.get("points")
    if not isinstance(points, list) or not points:
        return None, None

    peak_dt = dt.date.fromisoformat(peak_date)
    coverage_radius = dt.timedelta(days=45)
    earliest_within = peak_dt - coverage_radius
    latest_within = peak_dt + coverage_radius
    full_lookback = peak_dt - dt.timedelta(days=OBSERVATION_LOOKBACK_DAYS)

    # Priority 1: latest on-or-before, within 45 days.
    on_or_before_within: Optional[Tuple[dt.date, float]] = None
    # Priority 2: earliest after, within 45 days.
    after_within: Optional[Tuple[dt.date, float]] = None

    for d, v in points:
        if not isinstance(d, str) or v is None:
            continue
        try:
            obs = dt.date.fromisoformat(d)
        except ValueError:
            continue
        if obs < full_lookback:
            continue
        if obs <= peak_dt:
            if obs >= earliest_within:
                if on_or_before_within is None or obs > on_or_before_within[0]:
                    on_or_before_within = (obs, float(v))
        else:
            if obs <= latest_within:
                if after_within is None or obs < after_within[0]:
                    after_within = (obs, float(v))

    chosen = on_or_before_within or after_within
    if chosen is None:
        return None, None
    return chosen[1], chosen[0].isoformat()


# Kept for backward compatibility; callers should switch to
# worst_in_window which is direction- and window-aware.
def observation_at(indicators: dict, calib_id: str, peak_date: str
                   ) -> Tuple[Optional[float], Optional[str]]:
    return worst_in_window(
        indicators, calib_id, peak_date, None, None, "high_is_concerning",
    )


# ─── core evaluation ────────────────────────────────────────────────────────
def score_observed(scenario_id: str, scenario: dict, calib_indicators: dict,
                   indicator_history: dict) -> dict:
    """
    Replay the v11 scorer using ACTUAL observed values at peak date instead
    of the hand-curated calibration values. Same percentile sample, same
    direction-correction, same simple-average mechanism aggregation. Returns
    a dict with the same shape as scenario_stress.json's per-scenario block.
    """
    peak_window = scenario.get("peak_window") or ""
    peak_date = parse_peak_date(peak_window)
    peak_window_start, peak_window_end = parse_peak_window_range(peak_window)
    by_mechanism: Dict[str, List[dict]] = {m: [] for m, _, _ in MECHANISM_ORDER}
    indicators_dropped: List[dict] = []
    if peak_date is None:
        return {
            "peak_window": peak_window,
            "peak_date": None,
            "mechanisms": [
                {"id": m, "num": n, "name": nm, "score": None,
                 "indicators_scored": 0,
                 "indicators_panel": sum(
                     1 for cid, meta in calib_indicators.items()
                     if meta.get("mechanism") == m),
                 "indicators": []}
                for m, n, nm in MECHANISM_ORDER
            ],
            "composite_score": None,
            "indicators_dropped": [
                {"id": "__all__", "reason":
                 f"could not parse peak date from {peak_window!r}"}
            ],
        }

    for calib_id, meta in calib_indicators.items():
        mechanism = meta.get("mechanism")
        direction = meta.get("direction", "high_is_concerning")

        if calib_id in INDICATORS_NO_HISTORY:
            indicators_dropped.append({
                "id": calib_id,
                "reason": "no historical sample (documented gap)",
            })
            continue

        sample = historical_sample(indicator_history, calib_id)
        if sample is None or len(sample) < 24:
            indicators_dropped.append({
                "id": calib_id,
                "reason": (f"insufficient history "
                           f"({len(sample) if sample else 0} pts post-{HISTORY_START})"),
            })
            continue

        observed_value, observed_date = worst_in_window(
            indicator_history, calib_id, peak_date,
            peak_window_start, peak_window_end, direction,
        )
        if observed_value is None:
            indicators_dropped.append({
                "id": calib_id,
                "reason": (f"no observation within {OBSERVATION_LOOKBACK_DAYS}d "
                           f"of peak {peak_date}"),
            })
            continue

        sorted_sample = sorted(sample)
        pct = percentile_of(observed_value, sorted_sample)
        score = direction_corrected_score(pct, direction)
        by_mechanism.setdefault(mechanism, []).append({
            "id": calib_id,
            "value": observed_value,
            "as_of": observed_date,
            "direction": direction,
            "percentile": round(pct, 1),
            "score": round(score),
            "history_sample_size": len(sample),
        })

    mechanisms_out: List[dict] = []
    mech_scores_for_composite: List[float] = []
    for m_id, num, name in MECHANISM_ORDER:
        entries = by_mechanism.get(m_id) or []
        panel_size = sum(
            1 for cid, meta in calib_indicators.items()
            if meta.get("mechanism") == m_id
        )
        if entries:
            avg = sum(e["score"] for e in entries) / len(entries)
            score = round(avg)
            mech_scores_for_composite.append(avg)
        else:
            score = None
        mechanisms_out.append({
            "id": m_id,
            "num": num,
            "name": name,
            "score": score,
            "indicators_scored": len(entries),
            "indicators_panel": panel_size,
            "indicators": entries,
        })
    composite = (
        round(sum(mech_scores_for_composite) / len(mech_scores_for_composite))
        if mech_scores_for_composite else None
    )
    return {
        "peak_window": peak_window,
        "peak_date": peak_date,
        "mechanisms": mechanisms_out,
        "composite_score": composite,
        "indicators_dropped": indicators_dropped,
    }


def evaluate_pair(predicted: Optional[int], observed: Optional[int],
                  tolerance_pp: int) -> Tuple[str, Optional[float]]:
    """Returns (verdict, delta_pp) where verdict is one of
    {"PASS", "FAIL", "SELF_ATTEST", "PRED_NULL"}."""
    if predicted is None:
        return "PRED_NULL", None
    if observed is None:
        return "SELF_ATTEST", None
    delta = predicted - observed
    if abs(delta) <= tolerance_pp:
        return "PASS", delta
    return "FAIL", delta


# ─── PDF + markdown rendering ────────────────────────────────────────────────
def render_pdf(scenario_id: str, scenario_meta: dict, predicted: dict,
               observed: dict, mech_results: List[dict],
               composite_result: dict, out_path: Path) -> None:
    """Render a one-scenario evidence PDF."""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(out_path), pagesize=letter,
                            leftMargin=36, rightMargin=36,
                            topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    h1 = styles["Heading1"]
    h2 = styles["Heading2"]
    body = styles["BodyText"]
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=10)

    story: List = []
    story.append(Paragraph(
        f"Scenario stress backtest — {scenario_id}", h1))
    story.append(Paragraph(
        f"Peak window: <b>{scenario_meta.get('peak_window','—')}</b>", body))
    story.append(Paragraph(
        f"Peak date for observation: <b>{observed.get('peak_date','—')}</b>", body))
    story.append(Paragraph(
        f"Calibration status: <b>{scenario_meta.get('calibration_status','—')}</b>", body))
    story.append(Spacer(1, 12))

    # ─── Mechanism comparison ─────────────
    story.append(Paragraph("Mechanism scores: predicted vs observed", h2))
    mech_rows = [["Mechanism", "Predicted", "Observed", "Δ (pp)", "Verdict"]]
    for r in mech_results:
        verdict_color = {
            "PASS": colors.HexColor("#0a7a3a"),
            "FAIL": colors.HexColor("#a92126"),
            "SELF_ATTEST": colors.HexColor("#6c757d"),
            "PRED_NULL": colors.HexColor("#6c757d"),
        }.get(r["verdict"], colors.black)
        mech_rows.append([
            r["mechanism_name"],
            "—" if r["predicted"] is None else str(r["predicted"]),
            "—" if r["observed"] is None else str(r["observed"]),
            "—" if r["delta"] is None else f"{r['delta']:+.0f}",
            r["verdict"],
        ])
    # composite row
    cr = composite_result
    mech_rows.append([
        "COMPOSITE",
        "—" if cr["predicted"] is None else str(cr["predicted"]),
        "—" if cr["observed"] is None else str(cr["observed"]),
        "—" if cr["delta"] is None else f"{cr['delta']:+.0f}",
        cr["verdict"],
    ])
    t = Table(mech_rows, colWidths=[170, 70, 70, 70, 90], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f3f5")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#fffbe6")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("ALIGN", (1, 1), (-2, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dee2e6")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
    ]))
    story.append(t)
    story.append(Spacer(1, 12))

    # ─── Indicator-level detail per mechanism ─────────────
    for m_id, num, name in MECHANISM_ORDER:
        pred_panel = next((m for m in predicted.get("mechanisms", []) if m["id"] == m_id), None)
        obs_panel = next((m for m in observed.get("mechanisms", []) if m["id"] == m_id), None)
        if pred_panel is None and obs_panel is None:
            continue
        story.append(Paragraph(f"{num} · {name}", h2))
        # Build indicator-level rows
        rows = [["Indicator", "Calibrated value", "Observed value (date)",
                 "Calib pct → score", "Obs pct → score"]]
        # Index by indicator id for join
        pred_inds = {i["id"]: i for i in (pred_panel or {}).get("indicators", [])}
        obs_inds = {i["id"]: i for i in (obs_panel or {}).get("indicators", [])}
        all_ids = sorted(set(pred_inds) | set(obs_inds))
        for iid in all_ids:
            p = pred_inds.get(iid) or {}
            o = obs_inds.get(iid) or {}
            rows.append([
                iid,
                "—" if "value" not in p else f"{p['value']}",
                "—" if "value" not in o else f"{o['value']} ({o.get('as_of','—')})",
                "—" if "score" not in p else f"{p.get('percentile','—')}% → {p['score']}",
                "—" if "score" not in o else f"{o.get('percentile','—')}% → {o['score']}",
            ])
        if len(rows) == 1:
            story.append(Paragraph(
                "<i>no indicators scored on either side for this mechanism</i>", small))
        else:
            tt = Table(rows, colWidths=[80, 90, 130, 100, 100], hAlign="LEFT")
            tt.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f3f5")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dee2e6")),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            story.append(tt)
        story.append(Spacer(1, 8))

    # Dropped indicators
    dropped = observed.get("indicators_dropped") or []
    if dropped:
        story.append(Paragraph("Indicators not observable (this scenario)", h2))
        rows = [["Indicator", "Reason"]] + [[d["id"], d["reason"]] for d in dropped]
        tt = Table(rows, colWidths=[100, 380], hAlign="LEFT")
        tt.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f3f5")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dee2e6")),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(tt)
        story.append(Spacer(1, 8))

    story.append(Paragraph(
        f"<i>Generated by scripts/backtest_scenario_stress.py on "
        f"{dt.date.today().isoformat()}. "
        f"Mechanism tolerance ±{MECHANISM_TOLERANCE_PP}pp; composite ±{COMPOSITE_TOLERANCE_PP}pp.</i>",
        small))
    doc.build(story)


# ─── main ──────────────────────────────────────────────────────────────────
def main() -> int:
    if not PRED_PATH.exists():
        print(f"FATAL: predicted snapshot missing at {PRED_PATH}", file=sys.stderr)
        return 2
    if not CALIB_PATH.exists():
        print(f"FATAL: calibration JSON missing at {CALIB_PATH}", file=sys.stderr)
        return 2
    if not INDICATOR_HISTORY_PATH.exists():
        print(f"FATAL: indicator history missing at {INDICATOR_HISTORY_PATH}", file=sys.stderr)
        return 2

    predicted_doc = json.loads(PRED_PATH.read_text())
    calib_doc = json.loads(CALIB_PATH.read_text())
    history = json.loads(INDICATOR_HISTORY_PATH.read_text())

    calib_indicators = calib_doc.get("indicators") or {}
    scenarios_meta = calib_doc.get("scenarios") or {}
    predicted_scenarios = predicted_doc.get("scenarios") or {}

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    summary_rows: List[dict] = []
    mech_fail_count = 0
    composite_fail_count = 0
    total_observable_pairs = 0

    for scenario_id, scenario_meta in scenarios_meta.items():
        predicted = predicted_scenarios.get(scenario_id) or {}
        observed = score_observed(scenario_id, scenario_meta, calib_indicators, history)

        # Mechanism-level evaluation. Apples-to-apples: re-aggregate
        # PREDICTED on the same indicator subset that OBSERVED actually
        # has values for. This ensures a coverage-limited indicator (e.g.,
        # hy_ig pre-2023 missing the covid_2020 peak by 83 days, dropped
        # by the 45-day coverage rule) doesn't show up in the predicted
        # average without a paired observation.
        mech_results: List[dict] = []
        for m_id, num, name in MECHANISM_ORDER:
            p = next((m for m in predicted.get("mechanisms", []) if m["id"] == m_id), {})
            o = next((m for m in observed.get("mechanisms", []) if m["id"] == m_id), {})
            obs_ind_ids = {i["id"] for i in (o.get("indicators") or [])}
            pred_ind_scores = [i["score"] for i in (p.get("indicators") or [])
                               if i["id"] in obs_ind_ids]
            obs_ind_scores = [i["score"] for i in (o.get("indicators") or [])]
            if pred_ind_scores and obs_ind_scores:
                pred_matched = round(sum(pred_ind_scores)/len(pred_ind_scores))
                obs_matched = round(sum(obs_ind_scores)/len(obs_ind_scores))
            else:
                pred_matched = None
                obs_matched = None
            verdict, delta = evaluate_pair(pred_matched, obs_matched, MECHANISM_TOLERANCE_PP)
            if verdict in ("PASS", "FAIL"):
                total_observable_pairs += 1
            if verdict == "FAIL":
                mech_fail_count += 1
            mech_results.append({
                "mechanism_id": m_id,
                "mechanism_name": f"{num} · {name}",
                "predicted": pred_matched,
                "observed": obs_matched,
                "delta": delta,
                "verdict": verdict,
                "matched_indicators": sorted(obs_ind_ids),
            })

        # Composite-level evaluation
        comp_v, comp_d = evaluate_pair(
            predicted.get("composite_score"),
            observed.get("composite_score"),
            COMPOSITE_TOLERANCE_PP,
        )
        if comp_v == "FAIL":
            composite_fail_count += 1
        composite_result = {
            "predicted": predicted.get("composite_score"),
            "observed": observed.get("composite_score"),
            "delta": comp_d,
            "verdict": comp_v,
        }

        # Render PDF
        pdf_path = OUT_DIR / f"{scenario_id}.pdf"
        try:
            render_pdf(scenario_id, scenario_meta, predicted, observed,
                       mech_results, composite_result, pdf_path)
        except Exception as e:
            print(f"WARN: PDF render failed for {scenario_id}: {e}", file=sys.stderr)

        summary_rows.append({
            "scenario_id": scenario_id,
            "calibration_status": scenario_meta.get("calibration_status"),
            "peak_window": scenario_meta.get("peak_window"),
            "peak_date_observed": observed.get("peak_date"),
            "mechanisms": mech_results,
            "composite": composite_result,
            "n_indicators_dropped": len(observed.get("indicators_dropped") or []),
        })

    # Top-level summary table (markdown)
    md_lines: List[str] = []
    md_lines.append(f"# Scenario stress backtest — {dt.date.today().isoformat()}")
    md_lines.append("")
    md_lines.append(f"Mechanism tolerance: ±{MECHANISM_TOLERANCE_PP}pp · "
                    f"composite tolerance: ±{COMPOSITE_TOLERANCE_PP}pp · "
                    f"history window from {HISTORY_START}.")
    md_lines.append("")
    md_lines.append("| scenario | calib status | peak | "
                    "val | cred | fund | grow | liq | pos | composite |")
    md_lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for row in summary_rows:
        cells = []
        for m in row["mechanisms"]:
            v = m["verdict"]
            if v == "PASS":
                cells.append(f"✓ ({m['delta']:+.0f})")
            elif v == "FAIL":
                cells.append(f"✗ ({m['delta']:+.0f})")
            elif v == "SELF_ATTEST":
                cells.append("self-attest")
            else:
                cells.append("—")
        comp = row["composite"]
        cv = comp["verdict"]
        if cv == "PASS":
            comp_cell = f"✓ ({comp['delta']:+.0f})"
        elif cv == "FAIL":
            comp_cell = f"✗ ({comp['delta']:+.0f})"
        elif cv == "SELF_ATTEST":
            comp_cell = "self-attest"
        else:
            comp_cell = "—"
        md_lines.append(
            f"| {row['scenario_id']} | {row['calibration_status']} | "
            f"{row['peak_date_observed'] or '—'} | "
            f"{' | '.join(cells)} | {comp_cell} |"
        )
    md_lines.append("")
    md_lines.append(f"**Mechanism failures**: {mech_fail_count}  ·  "
                    f"**Composite failures**: {composite_fail_count}  ·  "
                    f"**Observable pairs evaluated**: {total_observable_pairs}")

    (OUT_DIR / "SUMMARY.md").write_text("\n".join(md_lines) + "\n")
    (OUT_DIR / "SUMMARY.json").write_text(json.dumps({
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "tolerance_mechanism_pp": MECHANISM_TOLERANCE_PP,
        "tolerance_composite_pp": COMPOSITE_TOLERANCE_PP,
        "mech_fail_count": mech_fail_count,
        "composite_fail_count": composite_fail_count,
        "observable_pairs": total_observable_pairs,
        "scenarios": summary_rows,
    }, indent=2) + "\n")

    # Console table
    print(f"\nScenario stress backtest — {dt.date.today().isoformat()}")
    print(f"Mechanism tol ±{MECHANISM_TOLERANCE_PP}pp  ·  Composite tol ±{COMPOSITE_TOLERANCE_PP}pp")
    print()
    print(f"{'scenario':<28} {'peak':<12} {'val':>5} {'cred':>5} {'fund':>5} "
          f"{'grow':>5} {'liq':>5} {'pos':>5} {'comp':>6}")
    for row in summary_rows:
        cells = []
        for m in row["mechanisms"]:
            if m["verdict"] == "PASS":
                cells.append(f"✓{m['delta']:+.0f}")
            elif m["verdict"] == "FAIL":
                cells.append(f"✗{m['delta']:+.0f}")
            elif m["verdict"] == "SELF_ATTEST":
                cells.append("attest")
            else:
                cells.append("—")
        comp = row["composite"]
        if comp["verdict"] == "PASS":
            comp_cell = f"✓{comp['delta']:+.0f}"
        elif comp["verdict"] == "FAIL":
            comp_cell = f"✗{comp['delta']:+.0f}"
        elif comp["verdict"] == "SELF_ATTEST":
            comp_cell = "attest"
        else:
            comp_cell = "—"
        print(
            f"{row['scenario_id']:<28} {(row['peak_date_observed'] or '—'):<12} "
            f"{cells[0]:>5} {cells[1]:>5} {cells[2]:>5} {cells[3]:>5} "
            f"{cells[4]:>5} {cells[5]:>5} {comp_cell:>6}"
        )
    print()
    print(f"Mechanism failures: {mech_fail_count}  ·  Composite failures: "
          f"{composite_fail_count}  ·  Observable pairs: {total_observable_pairs}")
    print(f"\nWrote: {OUT_DIR}/SUMMARY.md, SUMMARY.json, *.pdf")

    # Non-zero exit if any observable pair failed.
    if mech_fail_count > 0 or composite_fail_count > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
