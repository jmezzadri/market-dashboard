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
            "position_type", "plain_english", "the_trade",
            "thesis", "evidence", "levels", "other_side", "risks", "so_what",
            "charts"]

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

# Words that mean nothing to a reader who is not a trader. Banned in
# `plain_english` ONLY — the thesis, the levels and the evidence are allowed to
# be technical, and should be.
JARGON = [
    "beta", "duration", "convexity", "carry", "basis point", "bp", "bps",
    "curve", "spread", "percentile", "steepener", "flattener", "notional",
    "overweight", "underweight", "risk premium", "term premium", "vol",
]

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
             idea.get("other_side", ""), idea.get("so_what", ""), idea.get("plain_english", "")]
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
    pe = str(idea["plain_english"]).strip()
    if not (40 <= len(pe) <= 260):
        raise ContractError(f"plain_english must be one clear sentence of 40-260 chars, got {len(pe)}")
    hits = [w for w in JARGON if re.search(rf"\b{re.escape(w)}\b", pe, re.I)]
    if hits:
        raise ContractError(
            f"plain_english contains jargon {hits} — this line is for a reader who is not a trader. "
            "Put the technical version in `instrument` and the thesis.")
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
        if prev.get("id") == idea.get("id"):
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


def normalise(idea: dict) -> dict:
    """Fill the derived fields the site reads, leaving authored prose alone."""
    out = dict(idea)
    slug = re.sub(r"[^a-z0-9]+", "-", str(out["title"]).lower()).strip("-")[:48]
    out["id"] = out.get("id") or f"{out['date']}-{slug}"
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
