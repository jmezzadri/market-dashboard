#!/usr/bin/env python3
"""Trade Idea — the versioned contract for MacroTilt's editorial note.

WHAT THIS IS
------------
MacroTilt publishes one proprietary trade idea twice a week (Sunday and
Wednesday evenings ET). The note is COMPOSED by the scheduled Cowork session
on Joe's subscription (see scripts/trade_idea_playbook.md) and PUBLISHED
through this script, which is the only thing allowed to write
public/trade_ideas.json.

That split is deliberate and comes straight from LESSONS 4.21(f): a surface
that goes to readers under the MacroTilt name is never produced by a prompt
that cannot be reviewed in a pull request. The prose is written by a model;
the CONTRACT it has to satisfy is code, in git, and enforced here.

    python3 scripts/build_trade_idea.py --prepare-file /tmp/idea.json
        validate one composed idea, normalise it, merge it into the published
        file (newest first, capped) and write the result. Prints "prepared OK".

    python3 scripts/build_trade_idea.py --check
        re-validate everything already published (CI guard).

THE CONTRACT (mirrors the daily brief's, adapted for a position note)
---------------------------------------------------------------------
1.  Every claim that carries a NUMBER lives in `evidence[]`, and every entry
    there carries its own `source` and `as_of`. A figure with no provenance is
    rejected, not printed. (LESSONS 4.21a — sourced-or-omitted.)
2.  A trade idea must be FALSIFIABLE: `levels.invalidation` is required and
    must be concrete. "Manage risk carefully" is not an invalidation.
3.  A trade idea must be BALANCED: `other_side` is required and must be a real
    argument against the position, not a hedge clause. Joe's words: "Should be
    balanced but technical and informative."
4.  No direction word ("rebounded", "eased back", "stabilised") anywhere in the
    note unless the evidence block carries two dated observations. The daily
    brief lost Joe's trust on exactly this. (LESSONS 4.21b.)
5.  Banned copy is scrubbed deterministically, same list as the brief:
    "washed out", "crowded".
6.  Novelty is a data field, not an instruction (LESSONS 4.19): an idea whose
    primary instrument matches a still-open idea from the last 21 days is
    rejected, so the tile cannot show the same trade twice in a row wearing a
    different headline.
7.  No performance claim. The note never states or implies a track record;
    there is no verified one, and inventing one is the worst failure available
    to this surface.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

PUBLISHED_PATH = os.environ.get("TRADE_IDEAS_PATH", "public/trade_ideas.json")
MAX_PUBLISHED = 40          # the tile shows one; the rest are the archive
NOVELTY_WINDOW_DAYS = 21

VALID_KINDS = {
    "macro", "cross-asset", "single-name", "rates", "credit",
    "fx", "commodity", "equity",
}

REQUIRED = ["date", "kind", "title", "dek", "instrument", "horizon",
            "position_type", "call", "the_trade", "edge", "variant",
            "thesis", "evidence", "levels", "other_side", "risks", "so_what",
            "charts", "scorecard"]

# 2026-08-17 (Joe): "Can we somehow track our trade ideas and how they
# performed? I'd like to start collecting historical data on our calls."
#
# A note cannot be marked from its prose. "US bank equities — the KBW-style bank
# complex, held outright" is a good sentence and a useless instruction to a
# scorer. So every note now states its position a second time, in machine-
# readable form, and it does so BEFORE publication — which is the only moment at
# which it can be written honestly. A scorecard block added after the fact, once
# the outcome is visible, is not a record of a call; it is a record of a
# preference. scripts/score_trade_ideas.py consumes this and nothing else.
SCORE_MEASURES = {"pct_change", "level_change"}
SCORE_SIDES = {"long", "short"}
SCORE_OPS = {">=", "<=", ">", "<"}
SCORE_BASES = {"close", "weekly_close"}

# 2026-08-14 (Joe): "Making a call 10 years out is not helpful. I want more
# trades ideas... next several quarters. This bond idea is not profound at all.
# You could look at Buffet Indicator or CAPE alone and say 'stocks are expensive
# over long term historical context.' What about positioning, technical analysis
# across assets. You keep coming back to such basic crap anyone can see - not
# something someone with decades of trading and risk managing experience can see."
#
# Three rules come out of that, and together they are the difference between
# research and a truism with a chart on it.
#
# (a) A TRADE idea is a next-several-quarters proposition. A ten-year valuation
#     view is an asset-allocation opinion; it is not this product.
# (b) Long-horizon valuation ratios — CAPE, the Buffett indicator, the equity
#     risk premium — cannot be the DRIVER. They are visible to anyone with a
#     browser, they say the same thing for years at a time, and they are silent
#     about the next two quarters. They are allowed as context.
# (c) The driver must be an EDGE that was measured: positioning, cross-asset
#     divergence, technicals, volatility structure, flows, relative value,
#     calendar mechanics or credit — and it must come with a backtest that
#     includes the UNCONDITIONAL BASELINE. A hit rate with nothing to compare it
#     to is a statistic, not an edge. This rule has already earned its keep: the
#     first idea written under it (equity index positioning at a 3-year extreme
#     → squeeze) was killed by its own backtest, which came in at or below the
#     unconditional baseline at every horizon.
EDGE_SOURCES = {
    "positioning", "cross-asset divergence", "technicals", "volatility structure",
    "flows", "relative value", "calendar mechanics", "credit", "market structure",
}
# Ratios that are famous, slow, and say the same thing for years.
TRUISM_SIGNALS = [
    "cape", "shiller", "buffett indicator", "market cap to gdp",
    "equity risk premium", "cyclically-adjusted price", "price to book",
]
MAX_HORIZON_MONTHS = 18

# 2026-08-13, Joe on the first published note: "Are we saying to buy treasuries
# and short stocks? I'm confused what the trade is." He was right — the note led
# with "Long the 10-year Treasury, funded by trimming US large-cap equity beta",
# which a professional reads as an allocation shift and everyone else reads as a
# short. A note whose central claim has to be decoded has failed no matter how
# good its evidence is. So the position TYPE is now a required enum rendered as a
# badge, and a plain-English sentence is a required field with its own jargon
# ban — the reader learns whether anything is being sold short before they read
# a single number.
POSITION_TYPES = {
    "allocation shift":  "Move money from one asset to another. Nothing sold short, no leverage.",
    "outright long":     "Buy and hold it. Nothing sold short.",
    "outright short":    "A short position — sold with the intention of buying it back lower.",
    "long/short spread": "Long one thing and short the other, sized against each other.",
    "hedge":             "Protection bought against something already owned.",
    "watch only":        "Not a position yet — the setup to watch and what would make it one.",
}

# 2026-08-13 (Joe, third pass): "Can we not be so blunt... It should be more
# editorial - something like UST are likely to yield more than large caps over x
# time period... We also need to be much more technical in this... Are we talking
# about a 6 month trade, a 5 year trade. Saying SELL STOCKS AND BUY TREASURIES is
# a terrible headline. We need to set stage."
#
# The previous field, `plain_english`, over-corrected. Solving "the reader cannot
# tell if we are shorting" by writing an imperative instruction produced a
# headline that reads like a broker's cold call. The fix is not less technical
# language — Joe asked for MORE — it is a CLAIM instead of an ORDER:
#
#   ORDER  Sell a slice of your US large-company stocks and buy 10-year bonds.
#   CLAIM  Over a five-to-ten-year horizon the 10-year Treasury is priced to
#          out-return the S&P 500 by the widest margin in our data since 2006.
#
# So `call` is a claim, and three things are enforced: it may not OPEN with an
# imperative, it MUST carry an explicit horizon (a six-month view and a five-year
# view are different products and the reader is entitled to know which), and it
# still may not lean on genuinely opaque desk shorthand. Note what is NOT banned
# any more — yield, total return, valuation, percentile, spread, term premium.
# Those are the technical vocabulary of the argument and Joe wants them.
JARGON = [
    "beta", "convexity", "carry", "notional", "steepener", "flattener",
    "dv01", "gamma", "vega", "basis risk", "roll-down", "rolldown",
]

# An order, not a claim. Checked against the FIRST word of `call`.
IMPERATIVE_OPENERS = {
    "buy", "sell", "short", "own", "add", "cut", "trim", "move", "rotate",
    "switch", "hold", "avoid", "get", "put", "take", "go",
}

# A horizon has to be a period a reader can hold in their head. "Medium term"
# is not one.
_PERIOD = (r"(?:\d+\s*(?:-|–|\s+to\s+)?\s*\d*\s*(?:month|quarter|year)s?"
           r"|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen)"
           r"(?:[- ]to[- ](?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen))?"
           r"[- ](?:month|quarter|year)s?)")

# The `horizon` FIELD is labelled, so a bare period is unambiguous there.
HORIZON_PERIOD_RE = re.compile(rf"\b{_PERIOD}\b|\bthrough\s+\w*\s*\d{{4}}\b|\binto\s+\w+\s+\d{{4}}\b", re.I)

# Inside `call` it is NOT unambiguous: "the 10-year Treasury" contains a perfect
# period expression and says nothing about how long the view is held. A first
# version of this check passed a call with no horizon at all for exactly that
# reason. So in prose the period must follow a horizon CUE, or be the thing a
# horizon is "of" — an instrument tenor never satisfies it.
HORIZON_PHRASE_RE = re.compile(
    rf"(?:\b(?:over|within|across|for|through|into|out\s+to|by)\s+(?:the\s+)?(?:next\s+)?(?:a\s+)?{_PERIOD}\b"
    rf"|\b{_PERIOD}\s+(?:horizon|view|window|out)\b"
    rf"|\bhorizon\s+of\s+{_PERIOD}\b"
    rf"|\bnext\s+{_PERIOD}\b"
    rf"|\bthrough\s+\w*\s*\d{{4}}\b|\binto\s+\w+\s+\d{{4}}\b)", re.I)

# Path words: a claim about how something MOVED needs two dated observations
# behind it. Checked against the evidence block, never taken on trust.
DIRECTION_WORDS = [
    "rebounded", "eased back", "eased off", "stabilised", "stabilized",
    "off its highs", "off the highs", "off its lows", "little changed",
    "recovered", "rolled over", "broke down", "broke out", "reversed",
    "accelerated", "decelerated", "cooled", "reheated", "backed up",
]

BANNED_COPY = {
    "washed out": "extended short",
    "crowded": "extended long",
}

# Claims the note may never make about itself.
PERFORMANCE_CLAIM = re.compile(
    r"\b(our (last|previous|prior) (call|idea|trade)|we (called|nailed|caught)|"
    r"track record|batting average|win rate|since inception|"
    r"(up|down)\s+\d+(\.\d+)?%\s+since we)\b", re.I)

# Language that reads as personalised advice rather than research.
ADVICE_CLAIM = re.compile(
    r"\b(you should (buy|sell|short|own)|we recommend you|guaranteed|"
    r"risk[- ]free|can'?t lose|sure thing)\b", re.I)


def _max_months(text: str):
    """Largest horizon in a phrase, in months. 'five-to-ten-year' -> 120."""
    words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
             "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "eighteen": 18}
    best = 0
    for m in re.finditer(r"([\w.-]+)[\s-]+(month|quarter|year)s?", str(text), re.I):
        raw, unit = m.group(1), m.group(2).lower()
        nums = [int(x) for x in re.findall(r"\d+", raw)]
        nums += [words[w] for w in re.findall(r"[a-z]+", raw.lower()) if w in words]
        if not nums:
            continue
        mult = {"month": 1, "quarter": 3, "year": 12}[unit]
        best = max(best, max(nums) * mult)
    return best or None


def _history():
    """The series catalogue a chart must exist in. Local copy first (the repo
    ships one), then --history, then the live file. Returns None only if every
    route failed, which downgrades the chart check to a warning rather than
    silently passing a chart of nothing."""
    for path in (os.environ.get("INDICATOR_HISTORY_PATH"), "public/indicator_history.json"):
        if path and os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:  # noqa: BLE001
                pass
    try:
        import urllib.request
        with urllib.request.urlopen("https://macrotilt.com/indicator_history.json", timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


class ContractError(Exception):
    pass


# ── small helpers ──────────────────────────────────────────────────────────
def _text_of(idea: dict) -> str:
    """Every reader-facing string in one blob, for the copy scans."""
    parts = [idea.get("title", ""), idea.get("dek", ""), idea.get("instrument", ""),
             idea.get("other_side", ""), idea.get("so_what", ""), idea.get("call", "")]
    tt = idea.get("the_trade") or {}
    if isinstance(tt, dict):
        parts += [str(v) for v in tt.values()]
    for c in idea.get("charts") or []:
        if isinstance(c, dict):
            parts += [str(c.get("title", "")), str(c.get("subtitle", "")), str(c.get("caption", ""))]
    parts += list(idea.get("thesis") or [])
    parts += list(idea.get("risks") or [])
    for e in idea.get("evidence") or []:
        parts += [str(e.get("claim", "")), str(e.get("value", ""))]
    for s in idea.get("sections") or []:
        parts.append(s.get("title", ""))
        parts.append(s.get("prose", "") or "")
        parts += list(s.get("bullets") or [])
    lv = idea.get("levels") or {}
    parts += [str(lv.get(k, "")) for k in ("trigger", "invalidation", "target")]
    return "\n".join(str(p) for p in parts)


def _is_concrete(s: str) -> bool:
    """An invalidation or trigger has to be checkable: it names a level, a
    date, a percentage, or a specific observable event."""
    s = (s or "").strip()
    if len(s) < 12:
        return False
    if re.search(r"\d", s):
        return True
    # Allow a purely qualitative but still checkable event, e.g.
    # "the Fed cuts at the September meeting".
    return bool(re.search(r"\b(above|below|through|breaks?|closes?|prints?|cuts?|hikes?|"
                          r"crosses|falls|rises|exceeds|drops)\b", s, re.I))


def _scrub(idea: dict) -> list[str]:
    """Deterministic banned-copy replacement, in place. Returns what changed."""
    changed = []

    def fix(s):
        if not isinstance(s, str):
            return s
        out = s
        for bad, good in BANNED_COPY.items():
            if re.search(rf"\b{re.escape(bad)}\b", out, re.I):
                out = re.sub(rf"\b{re.escape(bad)}\b", good, out, flags=re.I)
                changed.append(bad)
        return out

    def walk(node):
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return fix(node)

    scrubbed = walk(idea)
    idea.clear()
    idea.update(scrubbed)
    return sorted(set(changed))


# ── the contract ───────────────────────────────────────────────────────────
def validate(idea: dict, published: list[dict] | None = None) -> list[str]:
    """Raise ContractError on anything that must not ship. Return warnings."""
    warnings: list[str] = []
    published = published or []

    missing = [k for k in REQUIRED if not idea.get(k)]
    if missing:
        raise ContractError(f"missing required field(s): {', '.join(missing)}")

    # 0 — shape
    try:
        idea_date = dt.date.fromisoformat(idea["date"])
    except (ValueError, TypeError):
        raise ContractError(f"date must be ISO yyyy-mm-dd, got {idea['date']!r}")
    if idea["kind"] not in VALID_KINDS:
        raise ContractError(f"kind must be one of {sorted(VALID_KINDS)}, got {idea['kind']!r}")
    for key in ("thesis", "risks", "evidence"):
        if not isinstance(idea[key], list) or not idea[key]:
            raise ContractError(f"{key} must be a non-empty list")
    if len(idea["thesis"]) < 3:
        raise ContractError("thesis needs at least three points — a one-line call is not a note")
    if not isinstance(idea["levels"], dict):
        raise ContractError("levels must be an object")

    # 1 — every number carries provenance
    for i, e in enumerate(idea["evidence"]):
        if not isinstance(e, dict):
            raise ContractError(f"evidence[{i}] must be an object")
        for k in ("claim", "value", "source", "as_of"):
            if not str(e.get(k, "")).strip():
                raise ContractError(f"evidence[{i}] is missing {k} — a figure with no provenance is not printable")
        try:
            as_of = dt.date.fromisoformat(str(e["as_of"]))
        except ValueError:
            raise ContractError(f"evidence[{i}].as_of must be ISO yyyy-mm-dd, got {e['as_of']!r}")
        if as_of > idea_date:
            raise ContractError(f"evidence[{i}].as_of ({as_of}) is after the note's date — a note cannot cite the future")
        if (idea_date - as_of).days > 45:
            warnings.append(f"evidence[{i}] is {(idea_date - as_of).days} days old ({e['source']})")

    # 2 — falsifiable
    if not _is_concrete(idea["levels"].get("invalidation", "")):
        raise ContractError(
            "levels.invalidation must be concrete — name the level, date or event that proves the idea wrong")

    # 3 — balanced
    other = str(idea["other_side"]).strip()
    if len(other) < 60:
        raise ContractError("other_side must be a real counter-argument, not a hedge clause (min 60 chars)")

    # 3b — the reader must know what the position IS before any number
    if idea["position_type"] not in POSITION_TYPES:
        raise ContractError(f"position_type must be one of {sorted(POSITION_TYPES)}, got {idea['position_type']!r}")
    pe = str(idea["call"]).strip()
    if not (60 <= len(pe) <= 340):
        raise ContractError(f"call must be a claim of 60-340 chars, got {len(pe)}")
    first = re.sub(r"[^a-z]", "", pe.split()[0].lower()) if pe.split() else ""
    if first in IMPERATIVE_OPENERS:
        raise ContractError(
            f"call opens with the imperative {first!r} — that is an order, not a claim. "
            "State what is likely to happen and over what period; the instruction belongs in `the_trade`.")
    if not HORIZON_PHRASE_RE.search(pe):
        raise ContractError(
            "call must name its horizon — a six-month view and a five-year view are different products. "
            "e.g. 'over the next 12 months', 'over a five-to-ten-year horizon', 'through 2027'. "
            "(An instrument tenor such as 'the 10-year Treasury' is not a horizon.)")
    hits = [w for w in JARGON if re.search(rf"\b{re.escape(w)}\b", pe, re.I)]
    if hits:
        raise ContractError(
            f"call leans on desk shorthand {hits} — say it in words the argument can carry. "
            "Technical vocabulary is welcome; opaque shorthand is not.")
    hz = str(idea["horizon"]).strip()
    if not HORIZON_PERIOD_RE.search(hz):
        raise ContractError(
            f"horizon must state an explicit period, got {hz!r} — 'medium term' is not a horizon.")
    months = _max_months(hz) or _max_months(pe)
    if months and months > MAX_HORIZON_MONTHS:
        raise ContractError(
            f"horizon reaches {months} months — a trade idea is a next-several-quarters proposition "
            f"(max {MAX_HORIZON_MONTHS}). A multi-year valuation view is an allocation opinion, not this product.")

    # 3d — the edge, and the baseline it was measured against
    edge = idea["edge"]
    if not isinstance(edge, dict):
        raise ContractError("edge must be an object")
    if edge.get("source") not in EDGE_SOURCES:
        raise ContractError(f"edge.source must be one of {sorted(EDGE_SOURCES)}, got {edge.get('source')!r}")
    bt = edge.get("backtest")
    if not isinstance(bt, dict):
        raise ContractError("edge.backtest is required — an idea with no measured base rate is an opinion")
    for k in ("window", "n", "result", "baseline"):
        if not str(bt.get(k, "")).strip():
            raise ContractError(
                f"edge.backtest is missing {k}. Every field is load-bearing: `baseline` is the UNCONDITIONAL "
                "outcome over the same horizon, and without it a hit rate means nothing.")
    try:
        if int(bt["n"]) < 3:
            raise ContractError(f"edge.backtest.n is {bt['n']} — too few observations to claim an edge")
    except (TypeError, ValueError):
        raise ContractError(f"edge.backtest.n must be a number, got {bt['n']!r}")

    # the truism check — a famous ratio may support a note, never drive it
    driver_text = " ".join([pe, str(idea["title"]), str(edge.get("summary", "")), str(idea.get("dek", ""))]).lower()
    hits = [t for t in TRUISM_SIGNALS if t in driver_text]
    if hits and edge["source"] not in ("relative value", "cross-asset divergence"):
        raise ContractError(
            f"the call/title leans on {hits} — a long-horizon valuation ratio is visible to anyone and says the "
            "same thing for years. It may appear as context in the thesis; it may not be the driver.")

    # 3e — variant perception: why is this not obvious?
    var = str(idea["variant"]).strip()
    if len(var) < 80:
        raise ContractError(
            "variant must say what consensus believes and where this differs (min 80 chars). "
            "If the answer is 'nothing', the idea is not worth publishing.")
    tt = idea["the_trade"]
    if not isinstance(tt, dict) or not str(tt.get("buy", "")).strip():
        raise ContractError("the_trade must be an object naming at least what is bought (`buy`)")
    if idea["position_type"] in ("outright short", "long/short spread") and not str(tt.get("short", "")).strip():
        raise ContractError(f"position_type {idea['position_type']!r} requires the_trade.short — say what is sold short")
    if idea["position_type"] not in ("outright short", "long/short spread") and str(tt.get("short", "")).strip():
        raise ContractError("the_trade.short is set but position_type says nothing is sold short — pick one")

    # 3c — charts. Joe, 2026-08-13: "I'd like to include charts embedded in the
    # tile and note. Several charts to show visuals of what you're writing
    # about." Charts are DECLARATIVE: a note names a series that already exists
    # in indicator_history.json and the site draws it. Nothing is plotted from
    # numbers typed into the note, so a chart can never disagree with the
    # sentence beside it — and a note cannot illustrate a series we do not have.
    charts = idea["charts"]
    if not isinstance(charts, list) or not (2 <= len(charts) <= 5):
        raise ContractError(f"charts must be a list of 2 to 5 entries, got {len(charts) if isinstance(charts, list) else type(charts).__name__}")
    hist = _history()
    for i, c in enumerate(charts):
        if not isinstance(c, dict):
            raise ContractError(f"charts[{i}] must be an object")
        for k in ("series", "title", "caption", "source"):
            if not str(c.get(k, "")).strip():
                raise ContractError(f"charts[{i}] is missing {k}")
        if c.get("window") and c["window"] not in ("1y", "3y", "5y", "10y", "20y", "full"):
            raise ContractError(f"charts[{i}].window must be one of 1y/3y/5y/10y/20y/full, got {c['window']!r}")
        if hist is not None:
            ser = hist.get(c["series"])
            if ser is None:
                raise ContractError(
                    f"charts[{i}] names series {c['series']!r}, which is not in indicator_history.json — "
                    "a chart of a series we do not carry cannot be drawn")
            pts = [p for p in (ser.get("points") or []) if p and p[1] is not None]
            if len(pts) < 24:
                raise ContractError(f"charts[{i}] series {c['series']!r} has only {len(pts)} observations — too few to plot")
        else:
            warnings.append(f"charts[{i}] series {c['series']!r} NOT verified — no indicator_history.json available")
    if len({c.get("series") for c in charts}) < len(charts):
        raise ContractError("two charts plot the same series — each chart must show something the others do not")

    # 3f — the scorecard: the same position, in a form that can be marked.
    sc = idea["scorecard"]
    if not isinstance(sc, dict):
        raise ContractError("scorecard must be an object")
    legs = sc.get("legs")
    if not isinstance(legs, list) or not legs:
        raise ContractError("scorecard.legs must be a non-empty list — name the series the mark is taken from")
    for i, leg in enumerate(legs):
        if not isinstance(leg, dict):
            raise ContractError(f"scorecard.legs[{i}] must be an object")
        if leg.get("side") not in SCORE_SIDES:
            raise ContractError(f"scorecard.legs[{i}].side must be long or short, got {leg.get('side')!r}")
        if leg.get("measure", "pct_change") not in SCORE_MEASURES:
            raise ContractError(
                f"scorecard.legs[{i}].measure must be one of {sorted(SCORE_MEASURES)} — a yield or spread moves "
                "in levels, a price moves in percent, and marking one as the other is silently wrong")
        if hist is not None:
            ser = hist.get(leg.get("series"))
            if ser is None:
                raise ContractError(
                    f"scorecard.legs[{i}] names series {leg.get('series')!r}, which is not in "
                    "indicator_history.json — a position we do not carry data for cannot be marked")
    try:
        months = int(sc.get("horizon_months"))
    except (TypeError, ValueError):
        raise ContractError("scorecard.horizon_months must be a whole number of months")
    if not (1 <= months <= MAX_HORIZON_MONTHS):
        raise ContractError(f"scorecard.horizon_months is {months} — must be 1 to {MAX_HORIZON_MONTHS}")
    # The prose `horizon` and the scored horizon must not disagree. They are the
    # same promise written twice, and if they drift the note says one thing and
    # is graded on another.
    stated = _max_months(hz)
    if stated and months > stated:
        raise ContractError(
            f"scorecard.horizon_months ({months}) is longer than the horizon the note states ({stated}) — "
            "a call cannot be graded over a period it did not claim")
    inv = sc.get("invalidation")
    if inv is not None:
        if not isinstance(inv, dict):
            raise ContractError("scorecard.invalidation must be an object or omitted")
        if inv.get("op") not in SCORE_OPS:
            raise ContractError(f"scorecard.invalidation.op must be one of {sorted(SCORE_OPS)}")
        if inv.get("basis", "close") not in SCORE_BASES:
            raise ContractError(f"scorecard.invalidation.basis must be one of {sorted(SCORE_BASES)}")
        try:
            float(inv.get("level"))
        except (TypeError, ValueError):
            raise ContractError("scorecard.invalidation.level must be a number — a stop you cannot check is not a stop")
        if hist is not None and inv.get("series") not in hist:
            raise ContractError(
                f"scorecard.invalidation names series {inv.get('series')!r}, which is not in indicator_history.json")
    elif _is_concrete(idea["levels"].get("invalidation", "")):
        warnings.append(
            "levels.invalidation states a condition in prose but scorecard.invalidation is absent — the stop "
            "will not be enforced when the note is marked")

    # 4 — no direction word without two dated observations
    blob = _text_of(idea)
    dated = len({str(e.get("as_of")) for e in idea["evidence"]})
    used = [w for w in DIRECTION_WORDS if re.search(rf"\b{re.escape(w)}\b", blob, re.I)]
    if used and dated < 2:
        raise ContractError(
            f"path claim(s) {used} need at least two differently-dated evidence rows; the note has {dated}")

    # 5 — banned copy (scrubbed, then confirmed gone)
    scrubbed = _scrub(idea)
    if scrubbed:
        warnings.append(f"banned copy replaced: {', '.join(scrubbed)}")

    # 6 — novelty
    for prev in published:
        try:
            prev_date = dt.date.fromisoformat(prev.get("date", ""))
        except ValueError:
            continue
        if abs((idea_date - prev_date).days) > NOVELTY_WINDOW_DAYS:
            continue
        if prev.get("id") == derive_id(idea):
            continue
        a = re.sub(r"[^a-z0-9]", "", str(prev.get("instrument", "")).lower())
        b = re.sub(r"[^a-z0-9]", "", str(idea.get("instrument", "")).lower())
        if a and a == b:
            raise ContractError(
                f"same instrument as the note dated {prev_date} ({prev.get('instrument')}) — "
                "within the 21-day novelty window. Absence is correct; a repeat is not.")

    # 7 — no performance or advice claims
    m = PERFORMANCE_CLAIM.search(blob)
    if m:
        raise ContractError(f"performance claim {m.group(0)!r} — there is no verified track record to cite")
    m = ADVICE_CLAIM.search(blob)
    if m:
        raise ContractError(f"advice language {m.group(0)!r} — this is research, not a recommendation to a person")

    return warnings


def derive_id(idea: dict) -> str:
    """The note's stable id. Split out of normalise() on 2026-08-17: the
    novelty gate skips a previously-published note with the SAME id (that is a
    correction, not a repeat), but ids were only assigned in normalise(), which
    runs AFTER validate(). So re-publishing a note to fix a figure failed the
    instrument-novelty check against its own earlier copy. Correcting a
    published number has to be a one-command operation or it does not happen."""
    if idea.get("id"):
        return str(idea["id"])
    slug = re.sub(r"[^a-z0-9]+", "-", str(idea.get("title", "")).lower()).strip("-")[:48]
    return f"{idea.get('date')}-{slug}"


def normalise(idea: dict) -> dict:
    """Fill the derived fields the site reads, leaving authored prose alone."""
    out = dict(idea)
    out["id"] = derive_id(out)
    out.setdefault("status", "live")
    out.setdefault("sections", [])
    out["published_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out


def next_publish_after(d: dt.date) -> str:
    """Sunday and Wednesday, stated once here and mirrored in useTradeIdea.js."""
    for i in range(1, 8):
        n = d + dt.timedelta(days=i)
        if n.weekday() in (6, 2):  # Sunday, Wednesday
            return n.isoformat()
    return ""


def load_published(path: str) -> dict:
    if not os.path.exists(path):
        return {"ideas": []}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--prepare-file", help="path to one composed idea (JSON object)")
    ap.add_argument("--check", action="store_true", help="re-validate the published file")
    ap.add_argument("--out", default=PUBLISHED_PATH)
    args = ap.parse_args(argv)

    doc = load_published(args.out)
    ideas = list(doc.get("ideas") or [])

    if args.check:
        bad = 0
        for i, idea in enumerate(ideas):
            try:
                validate(dict(idea), [x for x in ideas if x is not idea])
            except ContractError as exc:
                print(f"FAIL ideas[{i}] ({idea.get('date')}): {exc}", file=sys.stderr)
                bad += 1
        print(f"checked {len(ideas)} published idea(s), {bad} failing")
        return 1 if bad else 0

    if not args.prepare_file:
        ap.error("one of --prepare-file or --check is required")

    with open(args.prepare_file, encoding="utf-8") as f:
        idea = json.load(f)
    if not isinstance(idea, dict):
        print("FATAL: --prepare-file must contain a single JSON object", file=sys.stderr)
        return 1

    try:
        warnings = validate(idea, ideas)
    except ContractError as exc:
        print(f"FATAL: contract violation — {exc}", file=sys.stderr)
        return 1

    idea = normalise(idea)
    ideas = [x for x in ideas if x.get("id") != idea["id"]]
    ideas.insert(0, idea)
    ideas.sort(key=lambda x: x.get("date", ""), reverse=True)
    ideas = ideas[:MAX_PUBLISHED]

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cadence": "Sunday and Wednesday evenings, US Eastern",
        "next_publish": next_publish_after(dt.date.fromisoformat(idea["date"])),
        "disclaimer": ("MacroTilt research is published for information only. It is not investment advice "
                       "and it is not a recommendation to buy or sell any security."),
        "ideas": ideas,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")

    for w in warnings:
        print(f"  warning: {w}", file=sys.stderr)
    print(f"prepared OK — {idea['id']} ({len(ideas)} published, next {payload['next_publish']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
