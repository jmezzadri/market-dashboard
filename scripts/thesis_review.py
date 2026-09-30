#!/usr/bin/env python3
"""thesis_review.py — the weekly check that a live call still deserves to be live.

Joe, 2026-09-30: *"Do we have a process where we analyze intramonth and not
wait until the target date to ensure the thesis is still intact?"* We did not.
The daily scorer (scripts/score_trade_ideas.py) asks one question of every open
call each evening — did price cross the stop — and never asks whether the
REASON for the call still holds. A call could sit ten points under water for
six weeks with its driver gone and nothing would say so until the horizon.

This script is the other half. It runs every Monday before the open
(scripts/thesis_review_playbook.md) and does two different jobs, kept apart on
purpose:

  1. THE ARITHMETIC — computed here, from the record, with no opinion in it.
     For every open call: where it stands against what the note called for,
     how far the stop is, and a price-only range for where it can finish. The
     range is a driftless model on the position's own recent volatility:

         finish = mark_now + sigma_day x sqrt(sessions_left) x Z,  Z ~ N(0,1)

     sigma_day is the standard deviation of the position's one-session mark
     changes over the trailing REVIEW_VOL_SESSIONS sessions (the same
     increments the scorer's mark path is made of, so the range is in the same
     units as the number on the Scorecard row). From that: the 10th/50th/90th
     percentile finish, the chance of finishing positive, and the chance of
     finishing at or above what the note called for.

     The chance the STOP prints before the horizon is NOT taken from that
     model. The stop series are skewed and mean-reverting things (a vol ratio,
     a breakeven, a gas price) and the calibration study showed the
     reflection-principle formula off by a factor of two on them in one
     direction. So the stop figure is a base rate read straight from the stop
     series' own history: the share of all past windows of the same length in
     which the series moved at least the current distance in the stop's
     direction. Distance is proportional for a price and absolute for a rate
     or ratio (the unit in indicator_history.json decides).

     "Driftless" is the point: it is the range you get if you have NO view
     from here. The thesis is what argues for a drift, and the thesis is
     reviewed separately (job 2) rather than baked into the model. Calibration
     of the range is in scripts/research/thesis_review_calibration/ — the
     10-90 band is tested on the calls' own series over history before it is
     shown to anyone (LESSONS 6.19: the backtest lives in the repo or it did
     not happen).

  2. THE VERDICT — written by the Monday session, validated here, never
     computed here. For every open call the session re-measures the driver the
     note was built on and states, with a dated source, whether each claim
     the note made still holds. The verdict must be CONSISTENT with those
     checks (a call is not "intact" while a critical claim has failed) and
     "broken" CLOSES the call in the daily scorer from the review date, marked
     at the last close on or before it. The expected return the note called
     for is written once, on the first review, and can never change after —
     the same rule as the scorecard block (LESSONS 6.13): a target restated
     after the fact is a preference, not a record.

The two jobs meet in public/thesis_reviews.json, which the Scorecard page
renders (last review date and verdict per row, the review text in the note)
and THESIS-REVIEW-WEEKLY.yml emails to Joe from the committed file — the same
"email from the record, never from the session" rule the morning brief runs
under.

Usage:
    python scripts/thesis_review.py --quant                       # arithmetic only, to stdout
    python scripts/thesis_review.py --prepare-file /tmp/review.json --out public/thesis_reviews.json
    python scripts/thesis_review.py --check                       # exit 1 if the file is stale/inconsistent
    python scripts/thesis_review.py --email-html /tmp/review.html # render the email from the file
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_trade_ideas as sc  # noqa: E402  (one definition of a mark — LESSONS 6.15 rule 5)

IDEAS_PATH = sc.IDEAS_PATH
SCORES_PATH = sc.OUT_PATH
HISTORY_PATH = sc.HISTORY_PATH
OUT_PATH = "public/thesis_reviews.json"

# Trailing window for the position's own volatility. 63 sessions is one
# quarter: long enough that one wild week does not set the range, short
# enough that a regime change (a vol shock in the stop series, say) shows up
# within a few weeks. The calibration study tests this choice, not assumes it.
REVIEW_VOL_SESSIONS = 63
MIN_VOL_SESSIONS = 20
SESSIONS_PER_YEAR = 252

VERDICTS = ("intact", "weakened", "broken")
ACTIONS = ("hold", "trim", "close")

# Copy the email and the page must never carry (mirrors build_trade_idea.py).
BANNED_COPY = ("washed out", "crowded", "guaranteed", "risk-free", "you should buy", "you should sell")


class ReviewError(Exception):
    pass


# ---------------------------------------------------------------- statistics

def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


# Standard-normal quantiles for the range. Fixed constants, not a solver, so
# the numbers on the page cannot drift with a library version.
Z = {10: -1.2815515655, 25: -0.6744897502, 50: 0.0, 75: 0.6744897502, 90: 1.2815515655}


def sessions_between(d0: str, d1: str) -> int:
    """Trading sessions between two ISO dates, calendar days scaled by 252/365.
    Deliberately not a holiday calendar: the horizon is months long and one
    session either way moves the range by well under a tenth of a point."""
    a, b = dt.date.fromisoformat(d0), dt.date.fromisoformat(d1)
    days = (b - a).days
    return max(0, int(round(days * SESSIONS_PER_YEAR / 365.0)))


def sample_sd(xs: list[float]) -> float | None:
    n = len(xs)
    if n < 2:
        return None
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


# ------------------------------------------------------- the position's path

def mark_increments(row: dict, hist: dict, end_date: str, sessions: int) -> list[float]:
    """One-session changes in the position's mark, in the mark's own units
    (% of entry), over the `sessions` common sessions ending at `end_date`.
    Built from the legs exactly as the scorer builds the mark, so the range
    is in the same currency as the Scorecard row."""
    legs = row.get("legs") or []
    if not legs:
        return []
    common = None
    for leg in legs:
        s = hist.get(leg["series"])
        if not s:
            return []
        ds = {d for d, _ in s if d <= end_date}
        common = ds if common is None else (common & ds)
    dates = sorted(common or [])[-(sessions + 1):]
    if len(dates) < 2:
        return []
    vmaps = {leg["series"]: dict(hist[leg["series"]]) for leg in legs}
    out = []
    for i in range(1, len(dates)):
        d0, d1 = dates[i - 1], dates[i]
        total = 0.0
        for leg in legs:
            v0, v1 = vmaps[leg["series"]][d0], vmaps[leg["series"]][d1]
            ev = float(leg["entry_value"])
            if leg.get("measure") == "bond_return":
                inc = -sc.modified_duration(ev, leg.get("maturity_years", 10)) * (v1 - v0)
            else:
                inc = 100.0 * (v1 - v0) / ev
            total += sc.SIDES[leg["side"]] * float(leg.get("weight", 1.0)) * inc
        out.append(total)
    return out


RATE_LIKE_UNITS = {"%", "ratio", "pp", "bp", "x"}

# Plain-English names for the series a stop is written on (Joe reads the email;
# a series key is code). Anything not listed falls back to the indicator's own
# label in indicator_history.json, then to the key.
STOP_LABELS = {
    "fx_jpy": "dollar-yen", "fx_eur": "euro-dollar", "usd": "the dollar index",
    "cmdty_natgas": "front-month gas", "cmdty_wheat": "front-month wheat", "cmdty_oil": "WTI crude",
    "cmdty_gold": "gold", "vix_ts": "the VIX-to-VIX3M ratio", "vix": "the VIX",
    "breakeven_10y": "the 10-year breakeven", "ust_10y": "the 10-year yield", "ust_2y": "the 2-year yield",
    "real_rates": "the 10-year real yield", "spx_index": "the S&P 500", "ndx_index": "the Nasdaq",
}


def stop_label(key: str, units: dict | None) -> str:
    if key in STOP_LABELS:
        return STOP_LABELS[key]
    if sc.is_ticker_key(key):
        return key.split(":", 1)[1]
    lbl = ((units or {}).get("__labels__") or {}).get(key)
    return lbl or key


def load_units(path: str = HISTORY_PATH) -> dict:
    """series -> unit string from indicator_history.json (the scorer's loader
    drops metadata; the stop base rate needs to know price vs rate)."""
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except OSError:
        return {}
    out = {k: str(v.get("unit", "")) for k, v in raw.items() if isinstance(v, dict)}
    out["__labels__"] = {k: str((v.get("stats") or {}).get("label") or "") for k, v in raw.items() if isinstance(v, dict)}
    return out


def is_proportional(key: str, units: dict) -> bool:
    """A price moves in proportion to its level; a rate or ratio moves in
    absolute points. Tickers are prices."""
    if sc.is_ticker_key(key):
        return True
    return units.get(key, "") not in RATE_LIKE_UNITS


def forward_extremes(vals: list[float], h: int, proportional: bool):
    """For every start t with a full h-session window ahead: the largest move
    up and the largest move down inside the window, in the chosen units.
    O(n) per direction with a monotone deque."""
    from collections import deque
    n = len(vals)
    up, down = [None] * n, [None] * n
    dq_max, dq_min = deque(), deque()
    # window for start t is vals[t+1 .. t+h]
    for j in range(1, n):
        while dq_max and vals[dq_max[-1]] <= vals[j]:
            dq_max.pop()
        dq_max.append(j)
        while dq_min and vals[dq_min[-1]] >= vals[j]:
            dq_min.pop()
        dq_min.append(j)
        t = j - h
        if t < 0:
            continue
        while dq_max[0] <= t:
            dq_max.popleft()
        while dq_min[0] <= t:
            dq_min.popleft()
        hi, lo, v0 = vals[dq_max[0]], vals[dq_min[0]], vals[t]
        if proportional and v0:
            up[t], down[t] = 100.0 * (hi / v0 - 1.0), 100.0 * (1.0 - lo / v0)
        else:
            up[t], down[t] = hi - v0, v0 - lo
    return up, down


def touch_base_rate(vals: list[float], dist: float, direction: str, h: int, proportional: bool):
    """Share of past windows of length h in which the series moved at least
    `dist` in `direction` ('up' or 'down'). Returns (share, n_windows)."""
    if h <= 0 or len(vals) <= h + 1:
        return None, 0
    up, down = forward_extremes(vals, h, proportional)
    moves = [x for x in (up if direction == "up" else down) if x is not None]
    if not moves:
        return None, 0
    return sum(1 for m in moves if m >= dist) / len(moves), len(moves)


def stop_geometry(row: dict, idea: dict, hist: dict, end_date: str, sessions_left: int, units: dict | None = None) -> dict | None:
    """Distance to the stop in the stop series' own units and in daily sigmas,
    plus the base-rate chance the stop prints before the horizon."""
    inv = (idea.get("scorecard") or {}).get("invalidation")
    if not isinstance(inv, dict) or not inv.get("series"):
        return None
    key, op, level, basis = inv["series"], inv.get("op"), float(inv.get("level")), inv.get("basis", "close")
    s = [(d, v) for d, v in (hist.get(key) or []) if d <= end_date]
    if len(s) < MIN_VOL_SESSIONS + 1:
        return {"series": key, "rule": f"{key} {op} {level} ({basis.replace('_', ' ')})",
                "note": "not enough history on the stop series to size the distance"}
    prop = is_proportional(key, units or {})
    vals = [v for _, v in s]
    now = vals[-1]
    direction = "up" if op in (">=", ">") else "down"
    # Signed distance: positive = still on the right side of the stop.
    dist_abs = (level - now) if direction == "up" else (now - level)
    dist = 100.0 * dist_abs / now if prop else dist_abs
    recent = vals[-(REVIEW_VOL_SESSIONS + 1):]
    incs = [(100.0 * (recent[i] / recent[i - 1] - 1.0) if prop else recent[i] - recent[i - 1]) for i in range(1, len(recent))]
    sd = sample_sd(incs)
    out = {"series": key, "label": stop_label(key, units), "rule": f"{key} {op} {level:g} ({basis.replace('_', ' ')})",
           "level": level, "now": round(now, 4), "as_of": s[-1][0],
           "distance": round(dist_abs, 4),
           "distance_pct_of_level": round(100.0 * dist_abs / level, 2) if level else None,
           "units": "proportional (%)" if prop else "absolute (points)",
           "sigma_day": round(sd, 5) if sd else None,
           "sigmas_away": round(dist / sd, 2) if sd else None,
           "basis": basis}
    if sessions_left > 0 and dist > 0:
        p, n = touch_base_rate(vals, dist, direction, sessions_left, prop)
        if p is not None:
            out["p_touch_before_horizon"] = round(p, 3)
            out["p_touch_windows"] = n
            out["p_touch_note"] = (f"share of the series' own {n} past windows of {sessions_left} sessions in which it moved at least this far "
                                   f"{direction}, on closes" + ("; the rule needs a weekly close, which fires less often" if basis == "weekly_close" else ""))
    elif dist <= 0:
        out["p_touch_before_horizon"] = 1.0
        out["p_touch_note"] = "the level has already printed on a close; the scorer decides whether the rule's basis is met"
    return out


def quant_one(row: dict, idea: dict, hist: dict, called_for_pct: float | None, units: dict | None = None) -> dict:
    """The arithmetic block for one open call. Pure function of the record."""
    mark, mark_date, target = row.get("mark"), row.get("mark_date"), row.get("target_date")
    entry = row.get("entry_date")
    out = {"mark_pct": mark, "mark_date": mark_date, "entry_date": entry, "target_date": target,
           "sessions_held": row.get("sessions_held"), "vs_spx_pp": (row.get("benchmark") or {}).get("difference"),
           "max_favourable_pct": (row.get("max_favourable") or {}).get("value"),
           "max_adverse_pct": (row.get("max_adverse") or {}).get("value")}
    if mark is None or not mark_date or not target:
        out["note"] = "no mark yet"
        return out
    left = sessions_between(mark_date, target)
    total = sessions_between(entry, target) if entry else None
    out["sessions_left"] = left
    out["horizon_elapsed_pct"] = round(100.0 * (1 - left / total), 1) if total else None

    incs = mark_increments(row, hist, mark_date, REVIEW_VOL_SESSIONS)
    sd = sample_sd(incs) if len(incs) >= MIN_VOL_SESSIONS else None
    entry_vol = (row.get("sizing") or {}).get("spread_vol_pct")
    out["vol"] = {"sigma_day_pct": round(sd, 4) if sd else None,
                  "sessions_used": len(incs),
                  "annualised_pct": round(sd * math.sqrt(SESSIONS_PER_YEAR), 2) if sd else None,
                  "at_entry_annualised_pct": entry_vol,
                  "basis": f"standard deviation of the position's one-session mark changes over the trailing {len(incs)} sessions to {mark_date}"}
    if sd and left > 0:
        w = sd * math.sqrt(left)
        rng = {f"p{k}": round(mark + z * w, 2) for k, z in Z.items()}
        out["range_at_horizon"] = {**rng, "width_pct": round(w, 3),
                                   "basis": "driftless: finish = mark now + sigma x sqrt(sessions left) x Z; price only, no view"}
        out["p_finish_positive"] = round(1.0 - norm_cdf((0.0 - mark) / w), 3)
        if called_for_pct is not None:
            out["called_for_pct"] = called_for_pct
            out["p_finish_at_or_above_called_for"] = round(1.0 - norm_cdf((called_for_pct - mark) / w), 3)
            out["remaining_to_called_for_pct"] = round(called_for_pct - mark, 2)
    elif left == 0:
        out["range_at_horizon"] = None
        out["note"] = "at the horizon — the scorer closes this call"
    else:
        out["range_at_horizon"] = None
        out["note"] = f"fewer than {MIN_VOL_SESSIONS} sessions of common history to size a range"
    out["stop"] = stop_geometry(row, idea, hist, mark_date, left, units)
    return out


# ------------------------------------------------------------- the contract

def _txt(x) -> str:
    return str(x or "").strip()


def validate_submission(sub: dict, scores: dict, ideas: list, prior: dict | None) -> list[dict]:
    """Every rule a Monday session could be tempted to skip, checked here.
    Returns the cleaned review list; raises ReviewError with every failure."""
    errs = []
    if not isinstance(sub, dict):
        raise ReviewError("submission must be a JSON object")
    rd = _txt(sub.get("review_date"))
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", rd):
        errs.append("review_date must be YYYY-MM-DD")
    marked_to = _txt(scores.get("as_of"))
    # Reviewable = open, or already closed BY THIS SAME review (re-preparing
    # the week's submission after the scorer has applied its broken verdicts
    # must be idempotent, not rejected).
    open_rows = {r["id"]: r for r in scores.get("scores", [])
                 if r.get("status") == "open"
                 or (r.get("status") == "closed_thesis"
                     and (r.get("thesis_review_close") or {}).get("review_date") == rd)}
    by_id = {i.get("id"): i for i in ideas}
    reviews = sub.get("reviews")
    if not isinstance(reviews, list) or not reviews:
        raise ReviewError("reviews[] is missing or empty")
    seen = set()
    prior_called = {}
    for h in (prior or {}).get("history", []):
        for c in h.get("calls", []):
            if c.get("called_for_pct") is not None:
                prior_called.setdefault(c["id"], (c["called_for_pct"], h.get("review_date")))
    for c in ((prior or {}).get("latest") or {}).get("calls", []):
        if c.get("called_for_pct") is not None:
            prior_called.setdefault(c["id"], (c["called_for_pct"], (prior or {}).get("latest", {}).get("review_date")))

    cleaned = []
    for i, rv in enumerate(reviews):
        tag = f"reviews[{i}]"
        if not isinstance(rv, dict):
            errs.append(f"{tag} is not an object"); continue
        nid = _txt(rv.get("id"))
        if nid not in open_rows:
            errs.append(f"{tag}: {nid!r} is not an OPEN call on the scorecard (only open calls are reviewed)"); continue
        if nid in seen:
            errs.append(f"{tag}: {nid!r} reviewed twice"); continue
        seen.add(nid)
        verdict = _txt(rv.get("verdict")).lower()
        action = _txt(rv.get("action")).lower()
        if verdict not in VERDICTS:
            errs.append(f"{tag}: verdict must be one of {VERDICTS}")
        if action not in ACTIONS:
            errs.append(f"{tag}: action must be one of {ACTIONS}")
        checks = rv.get("driver_checks")
        if not isinstance(checks, list) or not checks:
            errs.append(f"{tag}: driver_checks[] is required — a verdict with no re-measured driver is a vibe")
            checks = []
        crit_fail, any_fail, crit_seen = False, False, False
        for j, ck in enumerate(checks):
            ct = f"{tag}.driver_checks[{j}]"
            if not isinstance(ck, dict):
                errs.append(f"{ct} is not an object"); continue
            for k in ("claim", "at_publication", "now", "source", "as_of"):
                if not _txt(ck.get(k)):
                    errs.append(f"{ct}.{k} is required")
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", _txt(ck.get("as_of"))):
                errs.append(f"{ct}.as_of must be YYYY-MM-DD")
            if not isinstance(ck.get("holds"), bool):
                errs.append(f"{ct}.holds must be true or false")
            crit = bool(ck.get("critical", False))
            crit_seen = crit_seen or crit
            if ck.get("holds") is False:
                any_fail = True
                crit_fail = crit_fail or crit
        if checks and not crit_seen:
            errs.append(f"{tag}: at least one driver check must be marked critical (the claim the call cannot survive losing)")
        # Verdict must follow from the checks — not the other way round.
        if verdict == "intact" and any_fail:
            errs.append(f"{tag}: verdict 'intact' but a driver check has failed")
        if verdict == "broken" and not crit_fail:
            errs.append(f"{tag}: verdict 'broken' requires a CRITICAL driver check that has failed")
        if verdict == "weakened" and not any_fail and not _txt(rv.get("weakened_reason")):
            errs.append(f"{tag}: verdict 'weakened' with every check holding needs weakened_reason (what moved against it)")
        if verdict == "broken" and action != "close":
            errs.append(f"{tag}: a broken thesis closes the call — action must be 'close'")
        if verdict != "broken" and action == "close":
            errs.append(f"{tag}: action 'close' is only for a broken thesis; a call you want off for another reason is 'trim' with the reason stated")
        for k in ("view_now", "action_reason"):
            if len(_txt(rv.get(k))) < 40:
                errs.append(f"{tag}.{k} must be a real sentence (40+ characters)")
        # The called-for return: written once, frozen forever.
        try:
            called = float(rv.get("called_for_pct"))
        except (TypeError, ValueError):
            called = None
            errs.append(f"{tag}.called_for_pct (the return the note called for over its horizon, as a number) is required")
        if not _txt(rv.get("called_for_basis")):
            errs.append(f"{tag}.called_for_basis (which figure in the note it comes from) is required")
        if called is not None and nid in prior_called:
            pc, pdate = prior_called[nid]
            if abs(float(pc) - called) > 1e-9:
                errs.append(f"{tag}.called_for_pct is {called} but was fixed at {pc} on {pdate} — it cannot change after the first review")
        try:
            exp_now = float(rv.get("expected_return_now_pct"))
        except (TypeError, ValueError):
            exp_now = None
            errs.append(f"{tag}.expected_return_now_pct (our expected finish from here, as a number) is required")
        if not _txt(rv.get("expected_basis")):
            errs.append(f"{tag}.expected_basis (how expected_return_now_pct was arrived at) is required")
        blob = json.dumps(rv).lower()
        for b in BANNED_COPY:
            if b in blob:
                errs.append(f"{tag}: banned copy {b!r}")
        cleaned.append({
            "id": nid, "verdict": verdict, "action": action,
            "driver_checks": [{k: ck.get(k) for k in ("claim", "at_publication", "now", "source", "as_of", "holds", "critical")}
                              for ck in checks if isinstance(ck, dict)],
            "weakened_reason": _txt(rv.get("weakened_reason")) or None,
            "view_now": _txt(rv.get("view_now")),
            "expected_return_now_pct": exp_now,
            "expected_basis": _txt(rv.get("expected_basis")),
            "called_for_pct": called,
            "called_for_basis": _txt(rv.get("called_for_basis")),
            "action_reason": _txt(rv.get("action_reason")),
        })
    missing = sorted(set(open_rows) - seen)
    if missing:
        errs.append("every OPEN call must be reviewed; missing: " + ", ".join(missing))
    book = _txt(sub.get("book_now"))
    if len(book) < 80:
        errs.append("book_now (what the whole book is positioned for after this review, one paragraph) is required")
    if errs:
        raise ReviewError("\n".join("  - " + e for e in errs))
    return cleaned


# ---------------------------------------------------------------- assemble

def load_all(ideas_path=IDEAS_PATH, scores_path=SCORES_PATH, history_path=HISTORY_PATH):
    with open(ideas_path, encoding="utf-8") as f:
        ideas = [i for i in (json.load(f).get("ideas") or []) if isinstance(i, dict)]
    with open(scores_path, encoding="utf-8") as f:
        scores = json.load(f)
    hist = sc.load_history(history_path)
    hist = sc.attach_ticker_series(hist, ideas)
    return ideas, scores, hist, load_units(history_path)


def build_calls(reviews: list[dict], ideas: list, scores: dict, hist: dict, units: dict | None = None) -> list[dict]:
    rows = {r["id"]: r for r in scores.get("scores", [])}
    by_id = {i.get("id"): i for i in ideas}
    out = []
    for rv in reviews:
        row, idea = rows[rv["id"]], by_id.get(rv["id"], {})
        q = quant_one(row, idea, hist, rv.get("called_for_pct"), units)
        out.append({
            "id": rv["id"], "date": row.get("date"), "kind": row.get("kind"),
            "trade_label": row.get("trade_label"), "title": row.get("title"),
            "horizon_months": row.get("horizon_months"),
            **{k: rv[k] for k in ("verdict", "action", "called_for_pct", "called_for_basis",
                                  "expected_return_now_pct", "expected_basis", "view_now",
                                  "action_reason", "weakened_reason", "driver_checks")},
            "quant": q,
        })
    order = {"broken": 0, "weakened": 1, "intact": 2}
    out.sort(key=lambda c: (order.get(c["verdict"], 9), str(c.get("date"))))
    return out


def prepare(sub_path: str, out_path: str, ideas_path=IDEAS_PATH, scores_path=SCORES_PATH,
            history_path=HISTORY_PATH) -> dict:
    with open(sub_path, encoding="utf-8") as f:
        sub = json.load(f)
    ideas, scores, hist, units = load_all(ideas_path, scores_path, history_path)
    prior = None
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            prior = json.load(f)
    reviews = validate_submission(sub, scores, ideas, prior)
    calls = build_calls(reviews, ideas, scores, hist, units)
    latest = {
        "review_date": sub["review_date"],
        "marked_to": scores.get("as_of"),
        "scores_generated_at": scores.get("generated_at"),
        "book_now": _txt(sub.get("book_now")),
        "counts": {v: sum(1 for c in calls if c["verdict"] == v) for v in VERDICTS},
        "calls": calls,
    }
    history = list((prior or {}).get("history") or [])
    if prior and prior.get("latest") and prior["latest"].get("review_date") != latest["review_date"]:
        # Keep the record compact: the verdicts and numbers, not the prose.
        history.append({
            "review_date": prior["latest"]["review_date"],
            "marked_to": prior["latest"].get("marked_to"),
            "calls": [{k: c.get(k) for k in ("id", "trade_label", "verdict", "action", "called_for_pct",
                                              "expected_return_now_pct")}
                      | {"mark_pct": (c.get("quant") or {}).get("mark_pct"),
                         "p_finish_at_or_above_called_for": (c.get("quant") or {}).get("p_finish_at_or_above_called_for")}
                      for c in prior["latest"].get("calls", [])],
        })
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cadence": "weekly, Monday before the US open",
        "method": (
            "Every Monday each open call is re-examined against the claims its note made. The numbers are "
            "computed from the record: where the call stands against what the note called for, how far the "
            "stop is, and a price-only range for where it can finish, drawn from the position's own recent "
            "volatility with no view assumed. The verdict is a judgment, stated with dated evidence: each "
            "claim the note relied on is re-measured and marked as holding or not, and the verdict has to "
            "follow from those marks. A broken thesis closes the call on the Scorecard from the review date. "
            "The return a note called for is written once and never changed."),
        "latest": latest,
        "history": history,
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return payload


def check(out_path: str, ideas_path=IDEAS_PATH, scores_path=SCORES_PATH, max_age_days: int = 8) -> list[str]:
    """Is the committed review file current and consistent with the scorecard?"""
    probs = []
    if not os.path.exists(out_path):
        return ["no review file"]
    with open(out_path, encoding="utf-8") as f:
        doc = json.load(f)
    latest = doc.get("latest") or {}
    rd = latest.get("review_date")
    try:
        age = (dt.date.today() - dt.date.fromisoformat(rd)).days
    except (TypeError, ValueError):
        return ["latest.review_date missing"]
    if age > max_age_days:
        probs.append(f"last review is {age} days old ({rd})")
    with open(scores_path, encoding="utf-8") as f:
        scores = json.load(f)
    open_ids = {r["id"] for r in scores.get("scores", []) if r.get("status") == "open"}
    reviewed = {c["id"] for c in latest.get("calls", [])}
    unreviewed = sorted(open_ids - reviewed)
    if unreviewed and age > 0:
        # A call published after the review is expected to be missing until Monday.
        with open(ideas_path, encoding="utf-8") as f:
            pub = {i.get("id"): str(i.get("date")) for i in json.load(f).get("ideas", [])}
        late = [i for i in unreviewed if pub.get(i, "9999") <= rd]
        if late:
            probs.append("open calls with no review: " + ", ".join(late))
    return probs


# ------------------------------------------------------------------- email

def _pct(v, signed=True, dp=1):
    if v is None:
        return "—"
    s = "+" if (signed and v > 0) else ""
    return f"{s}{v:.{dp}f}%"


def _prob(p):
    return "—" if p is None else f"{round(100 * p):d}%"


def render_email_html(doc: dict) -> str:
    INK, BODY, MUTE, RULE, BLUE = "#15181D", "#2A2F37", "#6B7280", "#E5E7EB", "#1D4ED8"
    GREEN, RED, AMBER = "#1F7A4D", "#B42318", "#B7791F"
    SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    SERIF = "Georgia,'Times New Roman',serif"
    MONO = "'SF Mono',Menlo,Consolas,monospace"
    L = doc.get("latest") or {}
    tone = {"intact": GREEN, "weakened": AMBER, "broken": RED}
    e = html.escape
    o = []
    o.append('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>')
    o.append(f'<body style="margin:0;background:#FAFAF7;font-family:{SANS};color:{BODY}">')
    o.append('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAF7"><tr><td align="center" style="padding:24px 12px">')
    o.append(f'<table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;width:100%;background:#FFFFFF;border:1px solid {RULE};border-radius:12px"><tr><td style="padding:24px 28px">')
    o.append(f'<div style="margin-bottom:10px"><span style="font-family:{SERIF};font-size:20px;font-weight:700;color:{INK}">Macro</span><span style="font-family:{SERIF};font-size:20px;font-weight:700;font-style:italic;color:{BLUE}">Tilt</span><span style="font-size:11px;font-weight:600;letter-spacing:.16em;color:{MUTE}">&#160;&#160;WEEKLY THESIS REVIEW</span></div>')
    c = L.get("counts") or {}
    o.append(f'<div style="font-family:{SERIF};font-size:19px;line-height:1.32;color:{INK};margin:2px 0 4px">{len(L.get("calls", []))} open calls reviewed · {c.get("intact", 0)} intact · {c.get("weakened", 0)} weakened · {c.get("broken", 0)} broken</div>')
    o.append(f'<div style="font-size:12px;color:{MUTE};margin-bottom:14px">Review of {e(L.get("review_date", ""))} · marks to {e(L.get("marked_to", ""))} · price only, no costs</div>')
    if L.get("book_now"):
        o.append(f'<div style="font-size:13px;line-height:1.55;color:{BODY};padding:12px 14px;background:#F6F7F9;border-radius:8px;margin-bottom:18px"><strong style="color:{INK}">The book now.</strong> {e(L["book_now"])}</div>')

    for call in L.get("calls", []):
        q = call.get("quant") or {}
        v = call.get("verdict", "")
        col = tone.get(v, MUTE)
        o.append(f'<div style="border-top:1px solid {RULE};padding:16px 0 6px">')
        o.append(f'<div style="display:flex"><span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.12em;color:#fff;background:{col};border-radius:4px;padding:3px 7px;vertical-align:middle">{e(v.upper())}</span>'
                 f'<span style="font-family:{SERIF};font-size:17px;color:{INK};margin-left:10px;vertical-align:middle">{e(call.get("trade_label") or "")}</span></div>')
        o.append(f'<div style="font-size:12px;color:{MUTE};margin:4px 0 10px">Entered {e(q.get("entry_date") or "")} · closes {e(q.get("target_date") or "")} · {q.get("horizon_elapsed_pct") if q.get("horizon_elapsed_pct") is not None else "—"}% of the horizon used · {q.get("sessions_left", "—")} sessions left</div>')

        rng = q.get("range_at_horizon") or {}
        stop = q.get("stop") or {}
        vol = q.get("vol") or {}
        rows = [
            ("Return so far", f'{_pct(q.get("mark_pct"))} <span style="color:{MUTE}">(vs S&amp;P {_pct(q.get("vs_spx_pp"))}; best {_pct(q.get("max_favourable_pct"))}, worst {_pct(q.get("max_adverse_pct"))})</span>'),
            ("What the note called for", f'{_pct(call.get("called_for_pct"))} over {call.get("horizon_months")} months <span style="color:{MUTE}">— {e(call.get("called_for_basis") or "")}</span>'),
            ("Still needed to get there", _pct(q.get("remaining_to_called_for_pct"))),
        ]
        if rng:
            rows.append(("Where it can finish (no view)",
                         f'10th {_pct(rng.get("p10"))} · median {_pct(rng.get("p50"))} · 90th {_pct(rng.get("p90"))} '
                         f'<span style="color:{MUTE}">— from the position\'s own volatility, {vol.get("annualised_pct", "—")}% a year now vs {vol.get("at_entry_annualised_pct") if vol.get("at_entry_annualised_pct") is not None else "—"}% at entry</span>'))
            rows.append(("Chance of finishing positive", _prob(q.get("p_finish_positive"))))
            rows.append(("Chance of reaching what was called for", _prob(q.get("p_finish_at_or_above_called_for"))))
        else:
            rows.append(("Where it can finish", e(q.get("note") or "—")))
        if stop:
            if stop.get("sigmas_away") is not None:
                rows.append(("Distance to the stop",
                             f'{e(stop.get("label") or stop.get("series", ""))} {stop.get("now")} now vs {stop.get("level"):g} at the stop — {stop.get("sigmas_away")} daily moves away '
                             f'<span style="color:{MUTE}">· a move this size within the time left has happened {_prob(stop.get("p_touch_before_horizon"))} of the time in this series\' history{" (the weekly-close rule fires less often)" if stop.get("basis") == "weekly_close" else ""}</span>'))
            else:
                rows.append(("Distance to the stop", e(stop.get("note") or stop.get("rule") or "—")))
        rows.append(("Our expected finish now", f'{_pct(call.get("expected_return_now_pct"))} <span style="color:{MUTE}">— {e(call.get("expected_basis") or "")}</span>'))
        o.append('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;line-height:1.5">')
        for k, val in rows:
            o.append(f'<tr><td style="padding:3px 10px 3px 0;color:{MUTE};white-space:nowrap;vertical-align:top;width:34%">{e(k)}</td><td style="padding:3px 0;color:{BODY};font-family:{MONO};font-size:12.5px">{val}</td></tr>')
        o.append('</table>')

        o.append(f'<div style="font-size:12px;font-weight:700;color:{INK};margin:12px 0 4px">What the note relied on — re-measured</div>')
        o.append('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:12.5px;line-height:1.45">')
        for ck in call.get("driver_checks") or []:
            mark = "✓" if ck.get("holds") else "✗"
            mc = GREEN if ck.get("holds") else RED
            crit = ' <span style="color:%s;font-size:10px;letter-spacing:.08em">CRITICAL</span>' % MUTE if ck.get("critical") else ""
            o.append(f'<tr><td style="padding:3px 8px 3px 0;color:{mc};font-weight:700;vertical-align:top;width:14px">{mark}</td>'
                     f'<td style="padding:3px 0;color:{BODY}"><span style="color:{INK}">{e(ck.get("claim") or "")}</span>{crit}<br>'
                     f'<span style="color:{MUTE}">At publication:</span> {e(ck.get("at_publication") or "")} &nbsp;·&nbsp; <span style="color:{MUTE}">Now:</span> {e(ck.get("now") or "")} '
                     f'<span style="color:{MUTE}">({e(ck.get("source") or "")}, {e(ck.get("as_of") or "")})</span></td></tr>')
        o.append('</table>')
        if call.get("weakened_reason"):
            o.append(f'<div style="font-size:13px;line-height:1.5;color:{BODY};margin-top:8px"><strong style="color:{INK}">What moved against it.</strong> {e(call["weakened_reason"])}</div>')
        o.append(f'<div style="font-size:13px;line-height:1.5;color:{BODY};margin-top:8px"><strong style="color:{INK}">Our view now.</strong> {e(call.get("view_now") or "")}</div>')
        o.append(f'<div style="font-size:13px;line-height:1.5;color:{BODY};margin-top:6px"><strong style="color:{col}">{e((call.get("action") or "").capitalize())}.</strong> {e(call.get("action_reason") or "")}</div>')
        o.append('</div>')

    o.append(f'<div style="border-top:1px solid {RULE};margin-top:14px;padding-top:12px;font-size:11px;line-height:1.5;color:{MUTE}">'
             'How to read the range: it is where the position can finish if nothing is known from here — the position\'s own recent volatility, '
             'projected over the sessions left, with no drift. It is not our forecast; "our expected finish now" is. Both are price only, before costs. '
             'The stop figure is a base rate: how often, in the stop series\' own history, a move of the current distance in the stop\'s direction happened within the sessions left. '
             'MacroTilt research is published for information only; it is not investment advice.</div>')
    o.append(f'<div style="font-size:11px;color:{MUTE};margin-top:8px">macrotilt.com/scorecard</div>')
    o.append('</td></tr></table></td></tr></table></body></html>')
    return "".join(o)


def render_email_text(doc: dict) -> str:
    L = doc.get("latest") or {}
    lines = [f"MacroTilt — weekly thesis review — {L.get('review_date')} (marks to {L.get('marked_to')})", ""]
    if L.get("book_now"):
        lines += ["The book now: " + L["book_now"], ""]
    for c in L.get("calls", []):
        q = c.get("quant") or {}
        rng = q.get("range_at_horizon") or {}
        lines.append(f"[{c.get('verdict', '').upper()}] {c.get('trade_label')} — entered {q.get('entry_date')}, closes {q.get('target_date')}")
        lines.append(f"  return so far {_pct(q.get('mark_pct'))}; called for {_pct(c.get('called_for_pct'))}; "
                     f"range at horizon {_pct(rng.get('p10'))} / {_pct(rng.get('p50'))} / {_pct(rng.get('p90'))}; "
                     f"chance of reaching call {_prob(q.get('p_finish_at_or_above_called_for'))}; expected finish now {_pct(c.get('expected_return_now_pct'))}")
        lines.append(f"  view: {c.get('view_now')}")
        lines.append(f"  {c.get('action', '').capitalize()}: {c.get('action_reason')}")
        lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ideas", default=IDEAS_PATH)
    ap.add_argument("--scores", default=SCORES_PATH)
    ap.add_argument("--history", default=HISTORY_PATH)
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--quant", action="store_true", help="print the arithmetic for every open call and stop")
    ap.add_argument("--prepare-file", help="validate a Monday submission and write the review file")
    ap.add_argument("--check", action="store_true", help="exit 1 if the review file is stale or inconsistent")
    ap.add_argument("--email-html", help="render the email HTML from the review file to this path")
    ap.add_argument("--email-text", help="render the plain-text email to this path")
    args = ap.parse_args(argv)

    if args.quant:
        ideas, scores, hist, units = load_all(args.ideas, args.scores, args.history)
        by_id = {i.get("id"): i for i in ideas}
        out = []
        for row in scores.get("scores", []):
            if row.get("status") != "open":
                continue
            out.append({"id": row["id"], "trade_label": row.get("trade_label"), "horizon_months": row.get("horizon_months"),
                        "quant": quant_one(row, by_id.get(row["id"], {}), hist, None, units)})
        print(json.dumps(out, indent=2))
        return 0

    if args.prepare_file:
        try:
            payload = prepare(args.prepare_file, args.out, args.ideas, args.scores, args.history)
        except ReviewError as e:
            print("REJECTED — the submission fails the contract:\n" + str(e), file=sys.stderr)
            return 1
        L = payload["latest"]
        print(f"prepared OK — review {L['review_date']}: " + ", ".join(f"{k} {v}" for k, v in L["counts"].items()) + f" -> {args.out}")
        for c in L["calls"]:
            q = c["quant"]
            print(f"  {c['verdict']:8s} {c['action']:5s} {c['trade_label']}: mark {_pct(q.get('mark_pct'))}, "
                  f"called for {_pct(c.get('called_for_pct'))}, P(reach) {_prob(q.get('p_finish_at_or_above_called_for'))}, "
                  f"expected now {_pct(c.get('expected_return_now_pct'))}")

    if args.email_html or args.email_text:
        with open(args.out, encoding="utf-8") as f:
            doc = json.load(f)
        if args.email_html:
            with open(args.email_html, "w", encoding="utf-8") as f:
                f.write(render_email_html(doc))
            print(f"email html -> {args.email_html}")
        if args.email_text:
            with open(args.email_text, "w", encoding="utf-8") as f:
                f.write(render_email_text(doc))
            print(f"email text -> {args.email_text}")

    if args.check:
        probs = check(args.out, args.ideas, args.scores)
        if probs:
            print("REVIEW CHECK FAILED:\n" + "\n".join("  - " + p for p in probs), file=sys.stderr)
            return 1
        print("review file current and consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
