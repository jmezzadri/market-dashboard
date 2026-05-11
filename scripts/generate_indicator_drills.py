#!/usr/bin/env python3
"""
generate_indicator_drills.py — auto-generate DRILLS entries for indicators
that don't yet have a full drilldown.

Joe directive 2026-05-11: deeper drilldown on every indicator. The
hand-written DRILLS map only covers ~17 of the 38 v2 indicators. This
script reads indicator_history.json + cycle_v2.json + data_manifest.json
and emits a JSON file with computed entries — KPIs (1m / 3m / 1y change,
distance from peak), co-movement (Pearson correlation on monthly first
differences vs peer indicators), release calendar (cadence + source +
last/next release inferred from history dates), formula text (from the
indicator manifest), source URL.

Episode tables are left null — those are hand-curated narrative reads
of historical regime moments and can't be auto-generated. The page
falls back to omitting that section when episodes is null/empty.

WRITES
------
  public/indicator_drills_generated.json — keyed by indicator id.

USAGE
-----
    python3 scripts/generate_indicator_drills.py
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
INDICATOR_HISTORY = REPO_ROOT / "public" / "indicator_history.json"
CYCLE_V2 = REPO_ROOT / "public" / "cycle_v2.json"
DATA_MANIFEST = REPO_ROOT / "data_manifest.json"
OUT_PATH = REPO_ROOT / "public" / "indicator_drills_generated.json"

# Targets — indicators that already have a hand-written DRILLS entry.
# Skip these; they win against the generated entries at runtime.
COVERED_BY_HAND = {
    "adv_dec", "anfci", "bkx_spx", "buffett", "cape", "cdx_basis", "cfnai",
    "cpff", "erp", "fed_bs", "fra_ois", "hy_ig", "hy_oas", "ig_oas", "ism",
    "jobless", "m2_yoy", "margin_debt", "naaim", "put_call", "real_fedfunds",
    "sofr_ois", "spx_200dma", "term_premium", "xccy_basis",
    # Aliases — runtime falls back to these for renamed-but-same indicator.
    "cfnai_3ma", "hy_ig_ratio", "ism_mfg", "ism_svc",
}

# Plain-English indicator labels + axis units. Match the lite-drawer label map
# in MacroTilt_Macro_Overview_Page_v11.html.
INDICATOR_META = {
    "cmdi":          {"name": "Moody's distress index", "axis": "index", "freq": "Daily"},
    "loan_syn":      {"name": "Senior loan officer survey", "axis": "% banks tightening", "freq": "Quarterly"},
    "yield_curve":   {"name": "Yield curve (10y - 2y)", "axis": "pp", "freq": "Daily"},
    "breakeven_10y": {"name": "10y breakeven inflation", "axis": "%", "freq": "Daily"},
    "bank_reserves": {"name": "Bank reserves at Fed", "axis": "$T", "freq": "Weekly"},
    "bank_credit":   {"name": "Bank credit (total)", "axis": "$B", "freq": "Weekly"},
    "bank_unreal":   {"name": "Bank unrealized losses (HTM)", "axis": "$B", "freq": "Quarterly"},
    "stlfsi":        {"name": "St. Louis financial conditions", "axis": "index", "freq": "Weekly"},
    "rrp":           {"name": "Fed reverse repo balance", "axis": "$B", "freq": "Daily"},
    "tga":           {"name": "Treasury General Account", "axis": "$B", "freq": "Daily"},
    "gdpnow":        {"name": "GDPNow (Atlanta Fed)", "axis": "%", "freq": "Bi-weekly"},
    "jolts_quits":   {"name": "JOLTS quits rate", "axis": "%", "freq": "Monthly"},
    "copper_gold":   {"name": "Copper / gold ratio", "axis": "ratio", "freq": "Daily"},
    "vix":           {"name": "VIX (equity vol)", "axis": "vol points", "freq": "Daily"},
    "move":          {"name": "MOVE (rates vol)", "axis": "vol points", "freq": "Daily"},
    "skew":          {"name": "SKEW index", "axis": "index", "freq": "Daily"},
    "eq_cr_corr":    {"name": "Equity / credit 60d correlation", "axis": "corr", "freq": "Daily"},
}


def parse_date(s: str) -> Optional[dt.date]:
    try:
        return dt.date.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def value_near(points: List[List[Any]], target: dt.date, window_days: int = 14) -> Optional[float]:
    """Most recent non-null value within window_days of target."""
    target_t = target.toordinal()
    best_v = None
    best_dist = window_days + 1
    for d_str, v in points:
        if v is None:
            continue
        d = parse_date(d_str)
        if d is None:
            continue
        dist = abs(d.toordinal() - target_t)
        if dist <= window_days and dist < best_dist:
            try:
                best_v = float(v)
                best_dist = dist
            except (TypeError, ValueError):
                continue
    return best_v


def compute_kpis(points: List[List[Any]]) -> List[Dict[str, Any]]:
    """1-month / 3-month / 1-year change + distance from peak."""
    valid = [(parse_date(p[0]), float(p[1])) for p in points
             if p[1] is not None and parse_date(p[0]) is not None]
    if len(valid) < 2:
        return []
    last_date, last_val = valid[-1]

    def delta_for(days: int, label: str) -> Optional[Dict[str, Any]]:
        target = last_date - dt.timedelta(days=days)
        anchor_v = value_near(points, target, window_days=max(14, days // 8))
        if anchor_v is None:
            return None
        d = last_val - anchor_v
        return {
            "lbl": label,
            "val": f"{d:+.2f}",
            "meta": f"vs {target.strftime('%b %Y')}",
            "dir": "up" if d > 0 else ("dn" if d < 0 else "neutral"),
        }

    kpis = []
    for days, label in [(30, "1-month change"), (91, "3-month change"), (365, "1-year change")]:
        k = delta_for(days, label)
        if k:
            kpis.append(k)

    # Distance from peak (max value in series)
    vals = [v for _, v in valid]
    peak_v = max(vals)
    peak_idx = vals.index(peak_v)
    peak_date = valid[peak_idx][0]
    dist = last_val - peak_v
    kpis.append({
        "lbl": "Distance from peak",
        "val": f"{dist:+.2f}",
        "meta": f"peak {peak_v:+.2f} / {peak_date.strftime('%b %Y')}",
        "dir": "dn" if dist < 0 else "neutral",
    })

    return kpis


def downsample_monthly(points: List[List[Any]]) -> List[List[Any]]:
    """Return one [year, month, value] per month — last valid value of that month."""
    by_month: Dict[str, float] = {}
    by_month_dt: Dict[str, dt.date] = {}
    for d_str, v in points:
        if v is None:
            continue
        d = parse_date(d_str)
        if d is None:
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        key = f"{d.year:04d}-{d.month:02d}"
        if key not in by_month_dt or d > by_month_dt[key]:
            by_month[key] = fv
            by_month_dt[key] = d
    out = []
    for key in sorted(by_month):
        y, m = key.split("-")
        out.append([int(y), int(m), round(by_month[key], 4)])
    return out


def monthly_first_diffs(points: List[List[Any]]) -> List[float]:
    """Monthly close-on-close first differences (last 10 years for correlations)."""
    monthly = downsample_monthly(points)
    if len(monthly) < 2:
        return []
    cutoff_year = dt.date.today().year - 10
    monthly = [m for m in monthly if m[0] >= cutoff_year]
    diffs = []
    for i in range(1, len(monthly)):
        diffs.append(monthly[i][2] - monthly[i-1][2])
    return diffs


def pearson(x: List[float], y: List[float]) -> Optional[float]:
    n = min(len(x), len(y))
    if n < 12:
        return None
    x = x[-n:]; y = y[-n:]
    mx = sum(x) / n; my = sum(y) / n
    num = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    dx = math.sqrt(sum((xi - mx)**2 for xi in x))
    dy = math.sqrt(sum((yi - my)**2 for yi in y))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def compute_comovement(target_diffs: List[float], all_diffs: Dict[str, List[float]],
                       peer_labels: Dict[str, str], target_id: str) -> List[Dict[str, Any]]:
    if not target_diffs:
        return []
    scored = []
    for peer_id, peer_d in all_diffs.items():
        if peer_id == target_id or not peer_d:
            continue
        # 1y window = last 12 obs ; 5y window = last 60 obs.
        c1 = pearson(target_diffs[-12:], peer_d[-12:])
        c5 = pearson(target_diffs[-60:], peer_d[-60:])
        if c5 is None:
            continue
        scored.append((peer_id, c1, c5))
    # Sort by abs(5y corr) desc.
    scored.sort(key=lambda x: -abs(x[2] or 0))
    out = []
    for peer_id, c1, c5 in scored[:5]:
        out.append({
            "peer":  peer_labels.get(peer_id, peer_id),
            "c1y":   ("—" if c1 is None else f"{c1:+.2f}"),
            "n1":    12,
            "c5y":   f"{c5:+.2f}",
            "n5":    60,
        })
    return out


def main() -> int:
    hist = json.loads(INDICATOR_HISTORY.read_text())
    v2 = json.loads(CYCLE_V2.read_text())
    manifest_entries = {}
    if DATA_MANIFEST.exists():
        try:
            man = json.loads(DATA_MANIFEST.read_text())
            for el in (man.get("elements") or []):
                el_id = el.get("element") or el.get("name")
                if el_id:
                    manifest_entries[el_id] = el
        except Exception:
            pass

    indicator_by_id = {ind["id"]: ind for ind in v2["indicators"]}
    targets = [iid for iid in INDICATOR_META if iid not in COVERED_BY_HAND]

    # Pre-compute monthly diffs for ALL v2 indicators (for co-movement comparisons).
    all_diffs: Dict[str, List[float]] = {}
    all_labels: Dict[str, str] = {}
    for ind in v2["indicators"]:
        hist_key = ind.get("history_key", ind["id"])
        if hist_key in hist and "points" in hist[hist_key]:
            all_diffs[ind["id"]] = monthly_first_diffs(hist[hist_key]["points"])
            all_labels[ind["id"]] = INDICATOR_META.get(ind["id"], {}).get("name", ind["id"])

    out: Dict[str, Any] = {}
    for iid in targets:
        ind = indicator_by_id.get(iid)
        if not ind:
            continue
        hist_key = ind.get("history_key", iid)
        if hist_key not in hist:
            continue
        points = hist[hist_key].get("points", [])
        if not points:
            continue
        meta = INDICATOR_META[iid]
        kpis = compute_kpis(points)
        monthly = downsample_monthly(points)
        comov = compute_comovement(all_diffs.get(iid, []), all_diffs, all_labels, iid)

        # Last release / cadence — infer last_date from points.
        last_date_obj = None
        for d_str, v in reversed(points):
            if v is not None:
                last_date_obj = parse_date(d_str)
                if last_date_obj:
                    break
        last_release = last_date_obj.strftime("%b %d, %Y") if last_date_obj else "—"

        # Manifest lookup for source URL + name.
        man_entry = manifest_entries.get(iid) or manifest_entries.get(hist_key) or {}
        source_url = man_entry.get("source_url") or man_entry.get("url") or ""
        source_name = man_entry.get("source") or "FRED / Bloomberg"

        entry = {
            "_generated": True,
            "header_label": f"{meta['name']} · {meta['freq']}",
            "axis_label": meta["axis"],
            "kpis": kpis,
            "traj": monthly,
            "episodes": [],   # hand-curate later
            "comovement": comov,
            "release": {
                "freq": meta["freq"],
                "last": last_release,
                "next": "next scheduled refresh",
                "source": source_name,
            },
            "source_url": source_url,
            "formula": man_entry.get("formula") or f"Direct read from source ({source_name}).",
        }
        out[iid] = entry

    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT_PATH}  ·  {OUT_PATH.stat().st_size / 1024:.1f} KB")
    print(f"  entries: {len(out)}")
    for k in out:
        print(f"   · {k}: {len(out[k]['kpis'])} kpis, {len(out[k]['traj'])} monthly points, "
              f"{len(out[k]['comovement'])} comovement rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
