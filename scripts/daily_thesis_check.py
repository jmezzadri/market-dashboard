#!/usr/bin/env python3
"""daily_thesis_check.py — is every open call's reason still TRUE, today?

Joe, 2026-10-30: "I think we need a check that proves the posted idea is still
factual. ... our current trade idea thats been on since Oct 22 says credit
spreads widening. Then when you look at the chart, spreads are 36pts tighter
than when we published the note."

The scorer asks one question every evening: did price cross the stop. The
Monday thesis review asks whether the reason is still there, once a week. This
script asks the second question EVERY evening, in code, with no judgment and
no model: it re-measures each open call's machine-checkable review conditions
and the call's DRIVER, and writes public/thesis_checks.json.

Two tests per call (LESSONS 6.28):

1. Level test — each condition's `check {series, op, level, transform?,
   basis?}` against the latest reading. A broken CRITICAL condition trips the
   call.
2. Give-back test — the critical condition's `driver {series, direction,
   move_start {date, value}, max_giveback?}`. The move the note was built on
   runs from `move_start` to the most favourable reading since publication.
   If the latest reading has handed back more than `max_giveback` of that move
   (default one third), the call trips — even while the level test still
   passes. This is the Oct 22 lesson: the stated line (300bp) sat halfway back
   through a 66bp widening, so credit could undo half of the reason for the
   trade and the weekly review would still have said "intact".

Notes published before review conditions carried a `check` (everything before
REVIEW_CHECKS_FROM in build_trade_idea.py) take their machine form from
scripts/thesis_checks.json — a sidecar keyed by note id, written once, never
edited after the fact. A published note is never edited (LESSONS 4.21).

A trip is an ALERT, not a close: the Scorecard still closes a call only on its
stop or on the weekly review's verdict. send_thesis_check_alert.py emails Joe
once per tripped (call, reason), and the next morning's Trade Idea run and the
Monday review must answer every trip in plain English.

Standard library only (the record must not break because a wheel moved).

Usage:
  python scripts/daily_thesis_check.py [--today YYYY-MM-DD]   # writes public/thesis_checks.json, prints a summary
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

IDEAS_PATH = "public/trade_ideas.json"
SCORES_PATH = "public/trade_idea_scores.json"
HISTORY_PATH = "public/indicator_history.json"
SIDECAR_PATH = "scripts/thesis_checks.json"
OUT_PATH = "public/thesis_checks.json"

OPS = {">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b,
       ">": lambda a, b: a > b, "<": lambda a, b: a < b}
TRANSFORMS = {"level", "pctile_3y", "pct_vs_200d"}
BASES = {"close", "weekly_close"}
DIRECTIONS = {"up", "down"}
DEFAULT_MAX_GIVEBACK = 1.0 / 3.0
STALE_BUSINESS_DAYS = 5          # a reading older than this is reported, never trusted
PCTILE_WINDOW = 756              # three years of sessions
AVG_WINDOW = 200


class CheckError(Exception):
    pass


# ── the spec (shared with build_trade_idea.py, which refuses a bad one) ─────

def validate_check(check, where: str, series_known=None) -> None:
    """Raise CheckError unless `check` is a well-formed level test."""
    if not isinstance(check, dict):
        raise CheckError(f"{where}.check must be an object {{series, op, level}}")
    s = str(check.get("series") or "")
    if not s:
        raise CheckError(f"{where}.check.series is required")
    if check.get("op") not in OPS:
        raise CheckError(f"{where}.check.op must be one of {sorted(OPS)}")
    try:
        float(check.get("level"))
    except (TypeError, ValueError):
        raise CheckError(f"{where}.check.level must be a number")
    if check.get("transform", "level") not in TRANSFORMS:
        raise CheckError(f"{where}.check.transform must be one of {sorted(TRANSFORMS)}")
    if check.get("basis", "close") not in BASES:
        raise CheckError(f"{where}.check.basis must be close or weekly_close")
    if series_known is not None and not s.startswith("ticker:") and s not in series_known:
        raise CheckError(f"{where}.check.series {s!r} is not in indicator_history.json — it cannot be re-measured")


def validate_driver(drv, where: str, series_known=None) -> None:
    """Raise CheckError unless `drv` is a well-formed give-back test."""
    if not isinstance(drv, dict):
        raise CheckError(f"{where}.driver must be an object {{series, direction, move_start{{date, value}}}}")
    s = str(drv.get("series") or "")
    if not s:
        raise CheckError(f"{where}.driver.series is required")
    if drv.get("direction") not in DIRECTIONS:
        raise CheckError(f"{where}.driver.direction must be 'up' or 'down' — the way the thesis needs the driver to have moved")
    ms = drv.get("move_start")
    if not isinstance(ms, dict):
        raise CheckError(f"{where}.driver.move_start {{date, value}} is required — where the move the note rests on began")
    try:
        dt.date.fromisoformat(str(ms.get("date")))
        float(ms.get("value"))
    except (TypeError, ValueError):
        raise CheckError(f"{where}.driver.move_start needs an ISO date and a numeric value")
    g = drv.get("max_giveback", DEFAULT_MAX_GIVEBACK)
    try:
        g = float(g)
    except (TypeError, ValueError):
        raise CheckError(f"{where}.driver.max_giveback must be a number between 0.1 and 0.5")
    if not 0.1 <= g <= 0.5:
        raise CheckError(f"{where}.driver.max_giveback must be between 0.1 and 0.5 (default one third)")
    if series_known is not None and not s.startswith("ticker:") and s not in series_known:
        raise CheckError(f"{where}.driver.series {s!r} is not in indicator_history.json — it cannot be re-measured")


# ── measurement ────────────────────────────────────────────────────────────

def _bdays_between(d0: str, d1: str) -> int:
    a, b = dt.date.fromisoformat(d0), dt.date.fromisoformat(d1)
    n, d = 0, a
    while d < b:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def _week_closes(series):
    """The last observation of every COMPLETED week (a week whose Friday has
    passed in the data: a later observation sits in a later week, or the last
    observation is itself a Friday)."""
    out = []
    for i, (d, v) in enumerate(series):
        iso = dt.date.fromisoformat(d).isocalendar()[:2]
        if i + 1 < len(series):
            if dt.date.fromisoformat(series[i + 1][0]).isocalendar()[:2] != iso:
                out.append((d, v))
        elif dt.date.fromisoformat(d).weekday() == 4:
            out.append((d, v))
    return out


def transformed(series, transform: str):
    """[(date, value)] after the transform, oldest first."""
    if transform == "level":
        return list(series)
    vals = [v for _, v in series]
    out = []
    for i, (d, v) in enumerate(series):
        if transform == "pctile_3y":
            if i + 1 < 252:
                continue
            w = vals[max(0, i + 1 - PCTILE_WINDOW): i + 1]
            out.append((d, 100.0 * sum(1 for x in w if x <= v) / len(w)))
        elif transform == "pct_vs_200d":
            if i + 1 < AVG_WINDOW:
                continue
            avg = sum(vals[i + 1 - AVG_WINDOW: i + 1]) / AVG_WINDOW
            out.append((d, 100.0 * (v / avg - 1.0)))
    return out


def measure_check(check: dict, hist: dict, today: str) -> dict:
    ser = hist.get(check["series"])
    res = {"series": check["series"], "op": check["op"], "level": float(check["level"]),
           "transform": check.get("transform", "level"), "basis": check.get("basis", "close")}
    if not ser:
        return {**res, "status": "no_data", "value": None, "value_date": None}
    t = transformed(ser, res["transform"])
    if res["basis"] == "weekly_close":
        t = _week_closes(t)
    if not t:
        return {**res, "status": "no_data", "value": None, "value_date": None}
    d, v = t[-1]
    res.update(value=round(v, 4), value_date=d)
    if _bdays_between(d, today) > STALE_BUSINESS_DAYS:
        res["status"] = "stale"
    else:
        res["status"] = "holds" if OPS[res["op"]](v, res["level"]) else "broken"
    return res


def measure_driver(drv: dict, hist: dict, published: str, today: str) -> dict:
    ser = hist.get(drv["series"])
    start = float(drv["move_start"]["value"])
    g_max = float(drv.get("max_giveback", DEFAULT_MAX_GIVEBACK))
    res = {"series": drv["series"], "direction": drv["direction"],
           "move_start": {"date": str(drv["move_start"]["date"]), "value": start},
           "max_giveback_pct": round(100 * g_max, 1)}
    if not ser:
        return {**res, "status": "no_data"}
    since = [(d, v) for d, v in ser if d >= published]
    if not since:
        return {**res, "status": "no_data"}
    up = drv["direction"] == "up"
    best_d, best_v = (max if up else min)(since, key=lambda x: x[1])
    last_d, last_v = since[-1]
    move = (best_v - start) if up else (start - best_v)
    given = (best_v - last_v) if up else (last_v - best_v)
    res.update(best={"date": best_d, "value": best_v}, latest={"date": last_d, "value": last_v},
               move=round(move, 4), given_back=round(given, 4))
    if move <= 0:
        # The driver never moved the thesis's way from the stated start: the
        # premise itself is gone.
        res.update(status="broken", given_back_pct=None)
        return res
    gb = given / move
    res["given_back_pct"] = round(100 * gb, 1)
    if _bdays_between(last_d, today) > STALE_BUSINESS_DAYS:
        res["status"] = "stale"
    else:
        res["status"] = "broken" if gb > g_max else "holds"
    return res


# ── plain-English lines (what Joe reads) ───────────────────────────────────

OP_WORDS = {">=": "at or above", "<=": "at or below", ">": "above", "<": "below"}


def _fmt(v, unit=""):
    if v is None:
        return "n/a"
    a = abs(v)
    s = f"{v:,.0f}" if a >= 100 else (f"{v:,.2f}" if a < 10 else f"{v:,.1f}")
    return s + unit


def check_line(claim: str, r: dict, unit: str = "") -> str:
    tr = {"pctile_3y": " (percentile of three years)", "pct_vs_200d": "% versus its 200-day average"}.get(r["transform"], "")
    if r["status"] in ("no_data", "stale"):
        return f"{claim}: no current reading ({r['status'].replace('_', ' ')}, last {r.get('value_date') or 'none'})."
    word = "holds" if r["status"] == "holds" else "BROKEN"
    u = "" if r["transform"] != "level" else unit
    return (f"{claim}: {word} — {_fmt(r['value'], u)}{tr} on {r['value_date']}, "
            f"needs to stay {OP_WORDS[r['op']]} {_fmt(r['level'], u)}.")


def driver_line(r: dict, unit: str = "") -> str:
    if r["status"] in ("no_data", "stale"):
        return "The move behind the call: no current reading."
    s, b, l = r["move_start"], r["best"], r["latest"]
    if r.get("given_back_pct") is None:
        return (f"The move behind the call: BROKEN — never moved the thesis's way from {_fmt(s['value'], unit)} "
                f"({s['date']}); latest {_fmt(l['value'], unit)} on {l['date']}.")
    word = "holds" if r["status"] == "holds" else "TRIPPED"
    return (f"The move behind the call: {word} — moved {_fmt(s['value'], unit)} ({s['date']}) to {_fmt(b['value'], unit)} "
            f"({b['date']}); now {_fmt(l['value'], unit)} ({l['date']}), {r['given_back_pct']:.0f}% of the move "
            f"given back against a {r['max_giveback_pct']:.0f}% limit.")


# ── the run ────────────────────────────────────────────────────────────────

def _load_hist(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    out = {}
    for k, node in raw.items():
        pts = node.get("points") if isinstance(node, dict) else None
        if not isinstance(pts, list):
            continue
        s = []
        for p in pts:
            try:
                s.append((str(p[0])[:10], float(p[1])))
            except (TypeError, ValueError, IndexError):
                continue
        if s:
            s.sort()
            out[k] = s
    return out


def _units(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        return {k: {"bps": "bp", "%": "%"}.get(str(v.get("unit", "")), "")
                for k, v in raw.items() if isinstance(v, dict)}
    except Exception:  # noqa: BLE001
        return {}


def specs_for(idea: dict, sidecar: dict):
    """[(claim, critical, check|None, driver|None)] — the note's own machine
    form first, then the sidecar for notes that predate it."""
    out = []
    side = (sidecar.get(idea.get("id")) or {}).get("conditions") or []
    for i, c in enumerate(idea.get("review_conditions") or []):
        if not isinstance(c, dict):
            continue
        sc = side[i] if i < len(side) and isinstance(side[i], dict) else {}
        out.append((str(c.get("claim") or f"condition {i + 1}"), bool(c.get("critical")),
                    c.get("check") or sc.get("check"), c.get("driver") or sc.get("driver")))
    return out


def run(ideas: list, scores: dict, hist: dict, sidecar: dict, today: str, units: dict | None = None) -> dict:
    units = units or {}
    open_ids = {r.get("id") for r in (scores.get("scores") or []) if r.get("status") in ("open", "pending_entry")}
    calls = []
    for idea in ideas:
        if idea.get("id") not in open_ids:
            continue
        pub = str(idea.get("date"))
        specs = specs_for(idea, sidecar)
        row = {"id": idea["id"], "date": pub, "title": idea.get("title"), "conditions": [],
               "tripped": False, "trip_reasons": [], "lines": []}
        if not specs:
            row["coverage"] = "none"
            row["lines"].append("No machine-checkable conditions on record for this call; the weekly review covers it.")
            calls.append(row)
            continue
        checked = 0
        for i, (claim, crit, chk, drv) in enumerate(specs):
            c = {"claim": claim, "critical": crit}
            if chk:
                validate_check(chk, f"{idea['id']} condition {i}")
                r = measure_check(chk, hist, today)
                c["check"] = r
                checked += 1
                row["lines"].append(("Critical — " if crit else "") + check_line(claim, r, units.get(chk["series"], "")))
                if r["status"] == "broken" and crit:
                    row["tripped"] = True
                    row["trip_reasons"].append({"key": f"cond{i}", "text": f"Critical condition broken: {claim}"})
            if drv:
                validate_driver(drv, f"{idea['id']} condition {i}")
                r = measure_driver(drv, hist, pub, today)
                c["driver"] = r
                checked += 1
                row["lines"].append(driver_line(r, units.get(drv["series"], "")))
                if r["status"] == "broken":
                    row["tripped"] = True
                    row["trip_reasons"].append({"key": f"giveback{i}",
                                                "text": "The move the call was built on has been given back"
                                                        + (f" ({r['given_back_pct']:.0f}% of it)" if r.get("given_back_pct") is not None else "")})
            row["conditions"].append(c)
        row["coverage"] = "full" if checked else "none"
        calls.append(row)
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "as_of": today,
        "rule": ("Every open call's review conditions and driver are re-measured each evening. A call trips when a "
                 "critical condition breaks, or when the move it was built on has handed back more than a third "
                 "(the note may set 10-50%) from its best reading since publication."),
        "calls": calls,
        "tripped": [c["id"] for c in calls if c["tripped"]],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--today")
    ap.add_argument("--out", default=OUT_PATH)
    a = ap.parse_args(argv)
    today = a.today or dt.date.today().isoformat()
    with open(IDEAS_PATH, encoding="utf-8") as f:
        ideas = json.load(f).get("ideas") or []
    with open(SCORES_PATH, encoding="utf-8") as f:
        scores = json.load(f)
    sidecar = {}
    if os.path.exists(SIDECAR_PATH):
        with open(SIDECAR_PATH, encoding="utf-8") as f:
            sidecar = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    hist = _load_hist(HISTORY_PATH)
    # ticker: series come from prices_eod, through the scorer's own fetcher.
    wanted = set()
    for idea in ideas:
        for _, _, chk, drv in specs_for(idea, sidecar):
            for s in (chk or {}).get("series"), (drv or {}).get("series"):
                if isinstance(s, str) and s.startswith("ticker:"):
                    wanted.add(s)
    if wanted:
        import score_trade_ideas as S
        for t in sorted(wanted):
            try:
                hist[t] = S.fetch_ticker_series(t[len("ticker:"):])
            except Exception as e:  # noqa: BLE001 — reported as no_data, never a silent pass
                print(f"warning: {t}: {e}", file=sys.stderr)
    doc = run(ideas, scores, hist, sidecar, today, _units(HISTORY_PATH))
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    for c in doc["calls"]:
        tag = "TRIPPED " if c["tripped"] else ("ok      " if c.get("coverage") == "full" else "no check")
        print(tag + " " + str(c["title"]))
        for ln in c["lines"]:
            print("   " + ln)
    return 0


if __name__ == "__main__":
    sys.exit(main())
