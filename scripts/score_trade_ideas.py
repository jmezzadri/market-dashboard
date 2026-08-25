#!/usr/bin/env python3
"""score_trade_ideas.py — mark every published Trade Idea, honestly.

Joe, 2026-08-17: *"Can we somehow track our trade ideas and how they performed?
I'd like to start collecting historical data on our calls."*

The problem this solves is not arithmetic, it is discipline. A note says
"US bank equities — the KBW-style bank complex, held outright", which is prose
and cannot be marked. So every note now carries a `scorecard` block naming the
series, the side, the horizon and the invalidation LEVEL, written at publication
time and never touched afterwards. This script is a pure function of that block
plus public/indicator_history.json. It has no opinions and no inputs a later
session could nudge.

Five rules are enforced here rather than remembered:

  1. ENTRY IS THE LAST CLOSE THAT EXISTED WHEN THE NOTE PUBLISHED. Not a level
     chosen afterwards, not an intraday print, not the best fill that week —
     the most recent settled close as of the note's own `published_at` stamp.

     The first version of this rule said "the first close ON OR AFTER the
     publish date", and it was wrong in a way that took a day to see. Every
     note so far published while its market was shut or mid-session: the FX
     note at 2:17 PM ET Friday, the rates note at 7:28 PM ET Sunday, the equity
     note at 11:01 AM ET Monday. Under the old rule each entered at the NEXT
     close, which silently threw away the first full session of the call.
     Joe, 2026-08-18: "It's 8/18, we've made calls 8/14, 8/16, and 8/17 - all
     made before Monday's market open and we have no performance tracked. This
     doesn't make sense."

     The corrected rule is also the one that agrees with the notes themselves.
     The FX note printed "EUR/USD, spot 1.153" and the last close before it
     published was 1.1535; the rates note printed a 2.27% breakeven and the
     last close was 2.27. A reader acts on the level the note showed them, so
     that is the level the note is graded from.

     This is still not the level TYPED in the prose — it is looked up from
     indicator_history by timestamp, so it cannot be chosen, only computed. A
     close dated D is treated as available from 21:00 UTC on D (5 PM ET, after
     the 17:05 futures and FX settlement), which is deliberately conservative:
     a note published at 4:30 PM ET enters at the PREVIOUS day's close rather
     than claiming a settle that was minutes old.

  2. EVERY NOTE IS SCORED, INCLUDING THE ONES THAT DID NOT WORK. A note whose
     series is missing is reported as `unscoreable` WITH THE REASON and counted
     in the totals — never silently dropped. Silent omission is how a track
     record becomes a marketing document.

  3. THE INVALIDATION LEVEL IS HONOURED. If the note said "this dies above 1.00"
     and 1.00 prints, the call closes there, at whatever it is worth on that
     day. It does not get to run on into a recovery. A stop written before the
     fact and ignored afterwards is worse than no stop.

  4. THE PATH IS RECORDED, NOT JUST THE DESTINATION. Maximum favourable and
     adverse excursion, so a call that was 12% underwater before it came good
     cannot be reported as though it were a straight line.

  5. NO AGGREGATE STATISTICS UNTIL THERE IS A SAMPLE. Below MIN_CLOSED_FOR_STATS
     closed calls the summary block refuses to compute a hit rate and says why.
     Three calls is not a track record, and a number invites being judged on
     noise. This mirrors the `PERFORMANCE_CLAIM` gate in build_trade_idea.py:
     the site may not claim a record it does not have.

Usage:
    python scripts/score_trade_ideas.py                     # write the file
    python scripts/score_trade_ideas.py --print             # ... and show it
    python scripts/score_trade_ideas.py --check             # exit 1 if unscoreable
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

IDEAS_PATH = "public/trade_ideas.json"
HISTORY_PATH = "public/indicator_history.json"
OUT_PATH = "public/trade_idea_scores.json"

# Below this many CLOSED calls the summary reports no hit rate. Ten is not a
# statistically magic number; it is the point below which a single outcome
# swings the headline by ten percentage points, which makes the headline
# actively misleading.
MIN_CLOSED_FOR_STATS = 10

# 2026-08-18 (Joe): every call is marked as a PRICE RETURN in per cent, on both
# legs, netted, and sized to a common risk budget. Before this, each call was a
# single leg on a pre-computed ratio or spread, so a bank/index pair printed
# "-0.33%", a breakeven printed "+0.01pp", and the two sat in one column as
# though they were comparable bets. They were not comparable in unit, in
# decomposition, or in size.
#
#   pct_change   — a price/level series -> % price return.
#   bond_return  — a YIELD series (per cent) -> the % price return of a par bond
#                  of `maturity_years` at that yield: -ModDur x (y_now - y_entry).
#                  This is what turns "the breakeven widened 1bp" into a number
#                  that can sit next to an equity return.
#   level_change — retained for INVALIDATION only. It is no longer a legal leg
#                  measure: a raw spread move is not a return and cannot be
#                  netted, sized or benchmarked. A note that still uses it is
#                  reported unscoreable WITH the reason rather than quietly
#                  printed in pp.
MEASURES = {"pct_change", "bond_return"}
LEGACY_MEASURES = {"level_change"}
SIDES = {"long": 1.0, "short": -1.0}

# Every call is sized so that its unlevered spread would have run at this
# annualised volatility over the year before entry. Without this a duration-
# matched TIPS/UST pair (~1.5% vol) and a bank/Nasdaq pair (~12% vol) print
# side by side as if they were the same bet, and the record is dominated by
# whichever asset class happens to be noisiest.
TARGET_VOL_PCT = 10.0
VOL_LOOKBACK_DAYS = 365
VOL_MIN_OBS = 120
SIZE_MIN, SIZE_MAX = 0.25, 5.0

# ONE benchmark, the S&P 500, on every row — Joe, 2026-08-25: "yes lets put it
# all vs. S&P. How does anyone have a clue what we're measuring against?!"
# The previous scheme picked a per-asset-class alternative (10-year Treasuries
# for rates calls, nothing for FX, each with a defensible rationale) and the
# result was a column no reader could interpret without reading the rationale.
# A benchmark's first job is to be the SAME yardstick everywhere; the honest
# footnote is that a market-neutral spread "trailing the S&P" is not a failure
# — that caveat lives in the method text, once, instead of a different
# benchmark per row. Per-note scorecard.benchmark overrides are ignored for
# the same reason: one page, one yardstick.
BENCHMARK = {"series": "spx_index", "measure": "pct_change", "label": "S&P 500"}

# Series the scorer builds from stored ones. These are NOT written to
# indicator_history.json and never render on the site, so they need no manifest
# element or health row — they exist only so a leg can name the thing the note
# actually named. bkx_spx is the bank complex DIVIDED BY the S&P, so
# multiplying it back by the S&P recovers the bank index level itself.
DERIVED = {
    "kbw_index": {"op": "mul", "of": ("bkx_spx", "spx_index"),
                  "label": "KBW-style US bank complex"},
}


def build_derived(hist: dict) -> dict:
    """Add DERIVED series to hist, on the dates where every input traded."""
    for name, spec in DERIVED.items():
        a_key, b_key = spec["of"]
        if a_key not in hist or b_key not in hist:
            continue
        bmap = dict(hist[b_key])
        pts = [(d, v * bmap[d]) for d, v in hist[a_key]
               if d in bmap and isinstance(v, (int, float)) and isinstance(bmap[d], (int, float))]
        if pts:
            hist[name] = pts
    return hist


def modified_duration(yield_pct: float, maturity_years: float) -> float:
    """Modified duration of a PAR bond at this yield, semiannual coupons.

    Closed form: (1/y) * (1 - (1 + y/2)^(-2T)). At 4.72% and 10 years this is
    7.899; at a 2.44% real yield it is 8.826 — which is exactly why a TIPS/UST
    pair is not duration-neutral at equal notional and why the two legs are
    priced with their OWN yields rather than one shared constant. Cross-checked
    against Macaulay-then-divide-by-(1+y/2): 8.0851 -> 7.8987, 8.9337 -> 8.8260.

    Convexity is ignored. Over the moves these notes are graded on (tens of
    basis points) the second-order term is under a basis point of return; it is
    stated here rather than silently assumed.
    """
    y = float(yield_pct) / 100.0
    if y <= 0 or maturity_years <= 0:
        return float(maturity_years)          # degenerate: duration -> maturity
    return (1.0 / y) * (1.0 - (1.0 + y / 2.0) ** (-2.0 * maturity_years))


def leg_return_pct(leg: dict, value_now: float) -> float:
    """The % PRICE return of one leg from its entry to `value_now`."""
    ev = leg["entry_value"]
    if leg["measure"] == "bond_return":
        d = modified_duration(ev, leg.get("maturity_years", 10))
        return -d * (float(value_now) - ev)        # yields are already in pp
    return 100.0 * (float(value_now) / ev - 1.0)


def _daily_returns(series: list, measure: str, maturity_years: float) -> list:
    """[(date, one-session % return)] for a series, on the leg's own measure."""
    out = []
    for i in range(1, len(series)):
        (d0, v0), (d1, v1) = series[i - 1], series[i]
        if not (isinstance(v0, (int, float)) and isinstance(v1, (int, float))):
            continue
        if measure == "bond_return":
            out.append((d1, -modified_duration(v0, maturity_years) * (v1 - v0)))
        elif v0:
            out.append((d1, 100.0 * (v1 / v0 - 1.0)))
    return out


def spread_size(legs: list, hist: dict, entry_date: str) -> dict:
    """Risk-parity multiple, computed ONCE at entry and then frozen.

    Frozen is the whole point: recomputing it later would silently restate
    every past mark every time the file is rebuilt, and a track record that
    changes retroactively is not a track record.
    """
    start = (dt.date.fromisoformat(entry_date) - dt.timedelta(days=VOL_LOOKBACK_DAYS)).isoformat()
    per_leg = {}
    for leg in legs:
        w = window(hist[leg["series"]], start, entry_date)
        per_leg[id(leg)] = dict(_daily_returns(w, leg["measure"], leg.get("maturity_years", 10)))
    dates = None
    for m in per_leg.values():
        dates = set(m) if dates is None else (dates & set(m))
    rets = []
    for d in sorted(dates or []):
        rets.append(sum(SIDES[l["side"]] * l["weight"] * per_leg[id(l)][d] for l in legs))
    if len(rets) < VOL_MIN_OBS:
        return {"method": "none", "multiple": 1.0, "spread_vol_pct": None,
                "target_vol_pct": TARGET_VOL_PCT, "observations": len(rets),
                "reason": f"only {len(rets)} common sessions in the year before entry "
                          f"(need {VOL_MIN_OBS}) — sized at 1x rather than off a vol we cannot measure"}
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    ann = (var ** 0.5) * (252 ** 0.5)
    if ann <= 0:
        return {"method": "none", "multiple": 1.0, "spread_vol_pct": 0.0,
                "target_vol_pct": TARGET_VOL_PCT, "observations": len(rets),
                "reason": "the spread did not move in the year before entry"}
    raw = TARGET_VOL_PCT / ann
    mult = max(SIZE_MIN, min(SIZE_MAX, raw))
    out = {"method": "risk_parity", "multiple": round(mult, 3),
           "spread_vol_pct": round(ann, 3), "target_vol_pct": TARGET_VOL_PCT,
           "observations": len(rets),
           "basis": f"trailing {VOL_LOOKBACK_DAYS}d daily vol of the unlevered spread "
                    f"to {entry_date}, annualised x sqrt(252), frozen at entry"}
    if abs(raw - mult) > 1e-9:
        out["clamped_from"] = round(raw, 3)
        out["clamp_reason"] = (f"uncapped size {raw:.2f}x fell outside the {SIZE_MIN}-{SIZE_MAX}x band; "
                               f"a 30x notional on a 0.3%-vol spread is a modelling artefact, not a position")
    return out
OPS = {">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b,
       ">": lambda a, b: a > b, "<": lambda a, b: a < b}
BASES = {"close", "weekly_close"}


class ScoreError(Exception):
    pass


# ---------------------------------------------------------------- data access

def load_history(path: str = HISTORY_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    out = {}
    for key, node in raw.items():
        pts = node.get("points") if isinstance(node, dict) else node
        if not isinstance(pts, list):
            continue
        series = []
        for p in pts:
            try:
                series.append((str(p[0])[:10], float(p[1])))
            except (TypeError, ValueError, IndexError):
                continue
        if series:
            series.sort(key=lambda x: x[0])
            out[key] = series
    # Derived series are attached HERE, not at the call site: the test suite
    # called load_history() directly, missed build_derived(), and reported a
    # live note as unscoreable for a series the production path had. One
    # loader, one shape.
    return build_derived(out)


# A close dated D is not knowable until D's session settles. 21:00 UTC is
# 5:00 PM ET (EDT) — after the 16:15 ET index-vol settle and the 17:05 ET
# futures/FX settle. Under EST it is 4:00 PM ET, which is still at or after the
# equity close, and the half-hour of EST slack only ever makes entry EARLIER
# (i.e. the previous close), never later. Erring conservative is the point.
CLOSE_AVAILABLE_UTC_HOUR = 21


def _published_ts(idea: dict) -> str:
    """The moment the note went out, as a sortable UTC string. `published_at`
    is stamped by build_trade_idea.normalise() at publish time and is never
    edited afterwards, which is what makes the entry lookup non-negotiable."""
    pa = str(idea.get("published_at") or "").strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$", pa):
        return pa[:19]
    # No stamp (hand-authored or pre-2026-08 note): assume the very start of
    # the publication day, so the note enters at the prior session's close.
    return f"{str(idea.get('date', ''))[:10]}T00:00:00"


def last_close_before(series: list[tuple[str, float]], published_ts: str):
    """Rule 1. The most recent close that had SETTLED when the note published.
    Walks backwards, so it can never pick up a price the author had not seen."""
    for d, v in reversed(series):
        if f"{d}T{CLOSE_AVAILABLE_UTC_HOUR:02d}:00:00" <= published_ts:
            return d, v
    return None, None


def first_on_or_after(series: list[tuple[str, float]], iso: str):
    """The first observation on or after a date. Still used for marking a
    benchmark on a given day; NOT used to choose an entry."""
    for d, v in series:
        if d >= iso:
            return d, v
    return None, None


def window(series: list[tuple[str, float]], start: str, end: str | None):
    return [(d, v) for d, v in series if d >= start and (end is None or d <= end)]


def is_week_end(iso: str, all_dates: list[str]) -> bool:
    """Last observation of its ISO week — what "a weekly close" means on a
    series that does not always have a Friday."""
    y, w, _ = dt.date.fromisoformat(iso).isocalendar()
    nxt = [d for d in all_dates if d > iso]
    if not nxt:
        return True
    ny, nw, _ = dt.date.fromisoformat(nxt[0]).isocalendar()
    return (y, w) != (ny, nw)


def add_months(d: dt.date, months: int) -> dt.date:
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return dt.date(y, m, day)


# ------------------------------------------------------------------- scoring

def score_one(idea: dict, hist: dict, today: str) -> dict:
    date = str(idea.get("date", ""))
    pub_ts = _published_ts(idea)
    base = {
        "id": idea.get("id"),
        "date": date,
        "kind": idea.get("kind"),
        "title": idea.get("title"),
        "instrument": idea.get("instrument"),
        "position_type": idea.get("position_type"),
    }
    sc = idea.get("scorecard")
    if not isinstance(sc, dict) or not sc.get("legs"):
        return {**base, "status": "unscoreable",
                "reason": "no scorecard block — the note did not state a markable position"}

    horizon_months = sc.get("horizon_months")
    try:
        horizon_months = int(horizon_months)
    except (TypeError, ValueError):
        return {**base, "status": "unscoreable", "reason": "scorecard.horizon_months missing or not a number"}

    legs_out, entry_dates = [], []
    for i, leg in enumerate(sc["legs"]):
        key, side = leg.get("series"), leg.get("side")
        measure = leg.get("measure", "pct_change")
        weight = float(leg.get("weight", 1.0))
        if key not in hist:
            return {**base, "status": "unscoreable",
                    "reason": f"legs[{i}] names series {key!r}, which is not in indicator_history.json"}
        if side not in SIDES:
            return {**base, "status": "unscoreable", "reason": f"legs[{i}].side must be long or short, got {side!r}"}
        if measure in LEGACY_MEASURES:
            return {**base, "status": "unscoreable",
                    "reason": f"legs[{i}].measure is {measure!r}. A raw level change is not a return: it "
                              f"cannot be netted against another leg, sized to a risk budget or compared "
                              f"to a benchmark. Restate the leg as pct_change, or as bond_return on the "
                              f"underlying yield series with a maturity_years."}
        if measure not in MEASURES:
            return {**base, "status": "unscoreable", "reason": f"legs[{i}].measure must be one of {sorted(MEASURES)}"}
        ed, ev = last_close_before(hist[key], pub_ts)
        if ed is None:
            # NOT a defect. A note published on Sunday, or before tonight's
            # close has printed, simply has no entry price yet — the position
            # exists and is waiting for the tape. Conflating this with a broken
            # scorecard was the first bug in this script: three healthy notes
            # reported as `unscoreable` and the pipeline looked broken on the
            # day it shipped. `unscoreable` means something is wrong; this means
            # nothing has happened yet.
            first = hist[key][0][0] if hist[key] else "never"
            # Say WHY and WHEN. Joe, at 5:15 PM on the day a note published:
            # "It says no close on or after 8/17... Its 515pm on 8/17...." The
            # old wording was true and useless — it read as a bug when the
            # honest fact is that the session HAS closed and the data pipeline
            # simply has not pulled it yet. A staleness message that does not
            # name the schedule makes the reader debug the site.
            return {**base, "status": "pending_entry",
                    "reason": (f"No entry price: {key} has no settled close before this note published "
                               f"({pub_ts}Z); the series only begins at {first}. Nothing can be marked "
                               "from a price that did not exist yet."),
                    "waiting_on": {"series": key, "series_first": first, "published_at": pub_ts}}
        rec = {"series": key, "side": side, "measure": measure, "weight": weight,
               "entry_date": ed, "entry_value": ev,
               "label": leg.get("label") or key,
               # Short form for the scorecard table, authored in the note so the
               # page never has to shorten a name itself.
               "short_label": leg.get("short_label") or leg.get("label") or key}
        if measure == "bond_return":
            try:
                rec["maturity_years"] = float(leg.get("maturity_years"))
            except (TypeError, ValueError):
                return {**base, "status": "unscoreable",
                        "reason": f"legs[{i}].measure is bond_return but maturity_years is missing or not a "
                                  f"number — duration cannot be inferred from a yield alone"}
        legs_out.append(rec)
        entry_dates.append(ed)

    # Rule 1 — one entry date for the whole position: the latest first-available
    # across legs, so no leg is marked from before the position existed.
    # One entry date for the whole position: the latest first-available across
    # legs, so no leg is marked from before the position existed. Each leg is
    # then re-resolved to the last close at or before that date.
    entry_date = max(entry_dates)
    for leg in legs_out:
        for d, v in reversed(hist[leg["series"]]):
            if d <= entry_date:
                leg["entry_date"], leg["entry_value"] = d, v
                break

    target_date = add_months(dt.date.fromisoformat(entry_date), horizon_months).isoformat()

    # Risk-parity size, from the year BEFORE entry, frozen here for good.
    #
    # 2026-08-18, second pass (Joe: "This is SO FUCKING WILDLY CONFUSING"):
    # the size no longer scales the headline. The number on the row is the
    # POSITION RETURN — what you bought, minus what you sold — because that is
    # the number a reader can check with their own arithmetic:
    #     buy -0.85%  -  sell -0.32%  =  position -0.53%
    # If the headline is silently multiplied by 0.43, that subtraction stops
    # working and every figure on the page becomes something you have to take
    # on trust. The risk-sized figure is still computed and still carried, on
    # its own labelled line, and it is what the eventual track record will be
    # weighted by — but it is a second number, not the first one.
    sizing = spread_size(legs_out, hist, entry_date)
    mult = float(sizing.get("multiple", 1.0))

    # The mark on a given date: each leg's own % price return, signed by its
    # side, weighted, summed, then scaled by the position size. Legs are only
    # marked on dates where EVERY leg traded, so a stale leg cannot manufacture
    # a move. Per-leg returns are carried through so the page can show what the
    # thing we said to BUY did, what the thing we said to SELL did, and the net
    # — rather than one opaque number off a pre-computed ratio (Joe 2026-08-18).
    common = None
    for leg in legs_out:
        ds = {d for d, _ in window(hist[leg["series"]], entry_date, None)}
        common = ds if common is None else (common & ds)
    vmaps = {id(leg): dict(hist[leg["series"]]) for leg in legs_out}
    marks, leg_paths = [], {id(leg): {} for leg in legs_out}
    for d in sorted(common or []):
        total = 0.0
        for leg in legs_out:
            r = leg_return_pct(leg, vmaps[id(leg)][d])
            leg_paths[id(leg)][d] = r
            total += SIDES[leg["side"]] * leg["weight"] * r
        marks.append((d, round(total, 4)))       # position return, unsized
    if not marks:
        return {**base, "status": "unscoreable", "reason": "no session where every leg has an observation"}

    # Rule 3 — the invalidation level, checked from entry forward.
    inv, inv_hit = sc.get("invalidation"), None
    if isinstance(inv, dict) and inv.get("series"):
        key, op, level = inv["series"], inv.get("op"), inv.get("level")
        basis = inv.get("basis", "close")
        if key not in hist:
            return {**base, "status": "unscoreable",
                    "reason": f"invalidation names series {key!r}, which is not in indicator_history.json"}
        if op not in OPS or basis not in BASES:
            return {**base, "status": "unscoreable",
                    "reason": f"invalidation op/basis invalid: {op!r}/{basis!r}"}
        all_dates = [d for d, _ in hist[key]]
        for d, v in window(hist[key], entry_date, None):
            if d == entry_date:
                continue           # the setup cannot be invalid on the day it is taken
            if basis == "weekly_close" and not is_week_end(d, all_dates):
                continue
            if OPS[op](v, float(level)):
                inv_hit = {"date": d, "series": key, "value": v,
                           "rule": f"{key} {op} {level} ({basis.replace('_', ' ')})"}
                break

    # Close date: the earlier of the invalidation and the horizon; else open.
    close_date, status = None, "open"
    if inv_hit:
        close_date, status = inv_hit["date"], "closed_invalidated"
    elif today >= target_date:
        close_date, status = target_date, "closed_horizon"

    scored = [(d, m) for d, m in marks if close_date is None or d <= close_date]
    last_date, last_mark = scored[-1]
    mfe = max(scored, key=lambda x: x[1])
    mae = min(scored, key=lambda x: x[1])

    # Every call is now a per-cent price return, on every leg, in every asset
    # class. One unit, so the column can be read down (Joe 2026-08-18).
    unit = "%"

    # Per-leg report: the asset's OWN return since entry. Nothing else.
    # There used to be a second "contribution" column carrying side x weight x
    # size, which meant the short leg's number flipped sign and the whole row
    # was scaled — two transformations, unexplained, next to the raw figure.
    # It is gone. Sign and size are handled by the one subtraction below.
    legs_report = []
    for leg in legs_out:
        r = leg_paths[id(leg)].get(last_date)
        legs_report.append({**{k: v for k, v in leg.items()},
                            "return_pct": None if r is None else round(r, 4)})
    buy = [l for l in legs_report if l["side"] == "long"]
    sell = [l for l in legs_report if l["side"] == "short"]

    out = {
        **base,
        "status": status,
        "entry_date": entry_date,
        "target_date": target_date,
        "horizon_months": horizon_months,
        "unit": unit,
        "legs": legs_report,
        "buy_pct": round(sum(l["return_pct"] for l in buy) / len(buy), 4) if buy and all(l["return_pct"] is not None for l in buy) else None,
        "sell_pct": round(sum(l["return_pct"] for l in sell) / len(sell), 4) if sell and all(l["return_pct"] is not None for l in sell) else None,
        # The same number as `mark`, named for what it is so the page can say
        # "position return" out loud: buy minus sell.
        # The trade in one line — "Long KBW / Short NASDAQ" (Joe 2026-08-18).
        # The scorecard row used to carry the note's HEADLINE, which is written
        # to make somebody read the note, not to say what the position is.
        "trade_label": " / ".join(
            [f"Long {l['short_label']}" for l in legs_out if l["side"] == "long"]
            + [f"Short {l['short_label']}" for l in legs_out if l["side"] == "short"]),
        "position_pct": last_mark,
        "risk_sized_pct": round(last_mark * mult, 4),
        "sizing": sizing,
        "single_leg_note": (
            "One leg, because buying EUR/USD already sells dollars — there is nothing separate to short."
            if len(legs_out) == 1 else None),
        "benchmark": None,
        "mark": last_mark,
        "mark_date": last_date,
        "sessions_held": len(scored),
        "max_favourable": {"value": mfe[1], "date": mfe[0]},
        "max_adverse": {"value": mae[1], "date": mae[0]},
        "invalidation": inv_hit or (
            {"rule": f"{inv['series']} {inv.get('op')} {inv.get('level')} "
                     f"({str(inv.get('basis', 'close')).replace('_', ' ')})", "date": None}
            if isinstance(inv, dict) and inv.get("series") else None),
        "result": last_mark if status != "open" else None,
    }

    # Benchmark — the passive alternative in this call's own asset class, over
    # exactly the same window and on the same price-return convention. A note
    # may name its own; otherwise the class default applies, so no call goes
    # ungraded because nobody remembered to fill the field in.
    #
    # It is CONTEXT, not alpha. Every one of these calls is a spread that is
    # close to market-neutral by construction, so "did it beat the S&P" is a
    # different question from "did it make money", and the page says so.
    bm = BENCHMARK  # one yardstick for every row (Joe 2026-08-25); note-level
    # benchmark overrides and per-class alternatives are retired
    if isinstance(bm, dict) and bm.get("series") in hist:
        bseries = hist[bm["series"]]
        _, bv = first_on_or_after(bseries, entry_date)
        _, bnow = first_on_or_after(bseries, last_date)
        if bv and bnow:
            if bm.get("measure") == "bond_return":
                b_move = -modified_duration(bv, bm.get("maturity_years", 10)) * (bnow - bv)
            else:
                b_move = 100.0 * (bnow / bv - 1.0)
            out["benchmark"] = {
                "series": bm["series"],
                "label": bm.get("label") or bm["series"],
                "measure": bm.get("measure", "pct_change"),
                "entry_value": bv,
                "move": round(b_move, 4),
                "difference": round(last_mark - b_move, 4),
                "note": "What the obvious alternative did over exactly the same days.",
            }
    return out


def summarise(rows: list[dict]) -> dict:
    closed = [r for r in rows if str(r.get("status", "")).startswith("closed")]
    open_ = [r for r in rows if r.get("status") == "open"]
    pending = [r for r in rows if r.get("status") == "pending_entry"]
    unscoreable = [r for r in rows if r.get("status") == "unscoreable"]
    s = {
        "published": len(rows),
        "open": len(open_),
        "pending_entry": len(pending),
        "closed": len(closed),
        "unscoreable": len(unscoreable),
        "pending_reasons": [{"id": r["id"], "reason": r["reason"]} for r in pending],
        "unscoreable_reasons": [{"id": r["id"], "reason": r["reason"]} for r in unscoreable],
        "min_closed_for_stats": MIN_CLOSED_FOR_STATS,
    }
    # Rule 5 — no hit rate on a sample that cannot carry one.
    if len(closed) < MIN_CLOSED_FOR_STATS:
        s["stats_withheld"] = True
        s["stats_withheld_reason"] = (
            f"{len(closed)} closed call(s). A hit rate is not reported below {MIN_CLOSED_FOR_STATS}, "
            "because at that sample a single outcome moves it by ten points or more and the number "
            "would mislead more than it informs. Every individual call is listed regardless.")
        return s
    s["stats_withheld"] = False
    wins = [r for r in closed if (r.get("result") or 0) > 0]
    s["hit_rate"] = round(100.0 * len(wins) / len(closed), 1)
    s["mean_result"] = round(sum((r.get("result") or 0) for r in closed) / len(closed), 3)
    s["median_result"] = round(sorted((r.get("result") or 0) for r in closed)[len(closed) // 2], 3)
    s["worst"] = min(closed, key=lambda r: r.get("result") or 0)["id"]
    s["best"] = max(closed, key=lambda r: r.get("result") or 0)["id"]
    s["closed_by_invalidation"] = sum(1 for r in closed if r["status"] == "closed_invalidated")
    return s


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ideas", default=IDEAS_PATH)
    ap.add_argument("--history", default=HISTORY_PATH)
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--print", dest="show", action="store_true")
    ap.add_argument("--check", action="store_true", help="exit 1 if any note is unscoreable")
    args = ap.parse_args(argv)

    with open(args.ideas, encoding="utf-8") as f:
        doc = json.load(f)
    ideas = [i for i in (doc.get("ideas") or []) if isinstance(i, dict)]
    hist = load_history(args.history)      # already derived
    today = dt.date.today().isoformat()

    rows = [score_one(i, hist, today) for i in ideas]
    rows.sort(key=lambda r: str(r.get("date")), reverse=True)
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "as_of": today,
        "method": (
            "Each call is marked from the last closing price that existed when the note was published — the "
            "price a reader was actually looking at. We then show what the thing we said to buy has done, "
            "what the thing we said to sell has done, and the difference between them, which is the return on "
            "the position. Next to every call, whatever its market, is the same yardstick: what the S&P 500 did "
            "over the same days, and the gap between the two. One caveat, stated once: some calls are spreads "
            "built to be roughly neutral to the stock market, so trailing the S&P is not by itself failure — "
            "the comparison answers \u201cwas this better than doing the obvious thing\u201d, not \u201cdid it work\u201d. Returns are price only — no dividends on shares, no "
            "interest on bonds — on both sides of every trade. If a note named a level at which it would be "
            "wrong and that level printed, the call is closed there. Every note is listed, including the ones "
            "that did not work, and no win rate is shown until there are enough closed calls for one to mean "
            "anything. Nothing on this page is typed in by hand."),
        "disclaimer": ("MacroTilt research is published for information only. It is not investment advice and it "
                       "is not a recommendation to buy or sell any security. These marks are the movement of the "
                       "named reference series; they are not the returns of any account and include no costs, "
                       "financing or slippage."),
        "summary": summarise(rows),
        "scores": rows,
    }

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")

    s = payload["summary"]
    print(f"scored {s['published']} note(s): {s['open']} open, {s['pending_entry']} awaiting entry, "
          f"{s['closed']} closed, {s['unscoreable']} unscoreable -> {args.out}")
    for r in rows:
        if r["status"] == "unscoreable":
            print(f"  UNSCOREABLE {r['date']} {r['id']}: {r['reason']}", file=sys.stderr)
        elif r["status"] == "pending_entry":
            print(f"  {r['date']}  awaiting entry       {r['reason']}")
        else:
            inv = r.get("invalidation") or {}
            tail = f"  [invalidated {inv['date']}]" if inv.get("date") else ""
            print(f"  {r['date']}  {r['status']:20s} mark {r['mark']:+7.2f}{r['unit']} "
                  f"(MFE {r['max_favourable']['value']:+.2f} / MAE {r['max_adverse']['value']:+.2f}, "
                  f"{r['sessions_held']} sessions){tail}")
    if args.show:
        print(json.dumps(payload, indent=2)[:4000])
    if args.check and s["unscoreable"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
