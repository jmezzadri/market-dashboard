#!/usr/bin/env python3
"""build_brief_edition.py — the prepare step for the Midday Update and the
Market Close (Joe, 2026-11-03: two scheduled editions plus an event-gated
midday; spec in the "MacroTilt Brief Editions — Spec" doc).

Same contract as scripts/build_daily_brief.py --prepare-file, applied to the
two new editions: the session composes JSON, this file validates it, forces
date / edition / label / written_at, scrubs banned copy, and refuses anything
over the caps or in the wrong register. A file that fails here is never
submitted. The voice, shape, outside-research and duplication checks are the
morning brief's own, imported from build_daily_brief so the three editions can
never drift apart.

  python3 scripts/build_brief_edition.py --edition midday --prepare-file /tmp/midday.json --gates /tmp/midday_gates.json
  python3 scripts/build_brief_edition.py --edition close  --prepare-file /tmp/close.json

Schema (what the homepage renders — src/overhaul/lib/useDailyBrief.js):
  date, edition, label, written_at            written HERE, not by the session
  headline        <=95 chars, a comma-separated DATA LINE, no full stop
  stance          <=200 chars, max 2 sentences
  trigger         midday only: {"gate": <a fired gate name>, "detail": <=120}
  scorecard[]     0-3 of {"call": <=120, "actual": <=120} — what the earlier
                  edition said, what happened. Required at the close.
  bullets[]       midday only, 0-5, each <=175
  sections[]      close only: exactly Macro & Rates / Equity Markets /
                  Credit & Liquidity, each {title, bullets[<=3 x 175],
                  positioning <=200|null, single_name {ticker,note<=180}|null}
  items[]         0-4 of {head <=60, body <=155} — COMPANIES only (pre-market
                  reports at midday, post-market reports at the close)
  watch[]         0-4 of {head <=55, body <=155} — midday: this afternoon;
                  close: tomorrow
Every sentence anywhere: 20 words. Whole edition: midday 350 words, close 600.
"""
import argparse
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_daily_brief as bdb  # noqa: E402

EDITIONS = {
    "midday": {"label": "Midday Update", "max_words": 350},
    "close":  {"label": "Market Close",  "max_words": 600},
}
CAPS = {
    "headline": 95, "stance": 200,
    "scorecard": {"items": 3, "call": 120, "actual": 120},
    "bullets": {"items": 5, "chars": 175},
    "section_bullets": {"items": 3, "chars": 175},
    "positioning": 200, "single_note": 180,
    "items": {"items": 4, "head": 60, "body": 155},
    "watch": {"items": 4, "head": 55, "body": 155},
    "trigger_detail": 120,
}


def _shadow(ed, edition):
    """Reshape an edition into the morning brief's field names so the morning's
    voice / shape / duplication checks run unchanged."""
    sh = {"headline": ed.get("headline"), "stance": ed.get("stance"),
          "news": ed.get("items") or [], "watch": ed.get("watch") or [],
          "implications": [f"{r.get('call','')} {r.get('actual','')}" for r in (ed.get("scorecard") or [])]}
    if edition == "close":
        sh["sections"] = ed.get("sections") or []
    else:
        sh["sections"] = [{"title": "Midday", "bullets": ed.get("bullets") or [], "positioning": None, "single_name": None}]
        if ed.get("trigger"):
            sh["positioning"] = str((ed["trigger"] or {}).get("detail") or "")
    return sh


def enforce_caps(ed, edition, bad):
    def chk(where, s, cap):
        n = len(bdb._plain(s))
        if n > cap:
            bad.append(f"{where}: {n} chars (max {cap}) — cut {n - cap}")
    chk("headline", ed.get("headline"), CAPS["headline"])
    chk("stance", ed.get("stance"), CAPS["stance"])
    sc = ed.get("scorecard") or []
    if len(sc) > CAPS["scorecard"]["items"]:
        bad.append(f"scorecard: {len(sc)} rows (max {CAPS['scorecard']['items']})")
    for i, r in enumerate(sc):
        if not isinstance(r, dict) or not r.get("call") or not r.get("actual"):
            bad.append(f"scorecard[{i}]: needs both call and actual")
            continue
        chk(f"scorecard[{i}].call", r["call"], CAPS["scorecard"]["call"])
        chk(f"scorecard[{i}].actual", r["actual"], CAPS["scorecard"]["actual"])
    if edition == "midday":
        bl = ed.get("bullets") or []
        if len(bl) > CAPS["bullets"]["items"]:
            bad.append(f"bullets: {len(bl)} (max {CAPS['bullets']['items']})")
        for i, b in enumerate(bl):
            chk(f"bullets[{i}]", b, CAPS["bullets"]["chars"])
        tr = ed.get("trigger")
        if not isinstance(tr, dict) or not tr.get("gate") or not tr.get("detail"):
            bad.append("trigger: midday needs {gate, detail} naming the gate that fired")
        else:
            chk("trigger.detail", tr["detail"], CAPS["trigger_detail"])
    else:
        secs = ed.get("sections") or []
        titles = [str(s.get("title", "")) for s in secs if isinstance(s, dict)]
        if titles != bdb.SECTION_TITLES:
            bad.append(f"sections must be exactly {bdb.SECTION_TITLES} — got {titles}")
        for s in secs:
            if not isinstance(s, dict):
                continue
            t = s.get("title", "?")
            bl = s.get("bullets") or []
            if len(bl) > CAPS["section_bullets"]["items"]:
                bad.append(f"{t}: {len(bl)} bullets (max {CAPS['section_bullets']['items']})")
            for i, b in enumerate(bl):
                chk(f"{t} bullet {i + 1}", b, CAPS["section_bullets"]["chars"])
            if s.get("positioning"):
                chk(f"{t} positioning", s["positioning"], CAPS["positioning"])
            sn = s.get("single_name")
            if isinstance(sn, dict) and sn.get("note"):
                chk(f"{t} single name", sn["note"], CAPS["single_note"])
        if not sc:
            bad.append("scorecard: the Market Close carries at least one row (what the morning said, what happened)")
    for key in ("items", "watch"):
        lst = ed.get(key) or []
        if len(lst) > CAPS[key]["items"]:
            bad.append(f"{key}: {len(lst)} (max {CAPS[key]['items']})")
        for i, it in enumerate(lst):
            if not isinstance(it, dict):
                bad.append(f"{key}[{i}]: must be {{head, body}}")
                continue
            chk(f"{key}[{i}].head", it.get("head"), CAPS[key]["head"])
            chk(f"{key}[{i}].body", it.get("body"), CAPS[key]["body"])
    words = bdb.count_words(_shadow(ed, edition))
    cap = EDITIONS[edition]["max_words"]
    if words > cap:
        bad.append(f"whole edition: ~{words} words (max {cap}) — cut {words - cap}")
    return words


def enforce_midday_names(ed, bad):
    """Midday has no sections, so run the morning's one-block-per-company rule
    by hand: no ticker-looking token in a bullet, and no company named in
    items[] reappearing in a bullet or the scorecard."""
    names = set()
    for it in ed.get("items") or []:
        for w in bdb._PROPER.findall(bdb._plain(f"{it.get('head','')} {it.get('body','')}")):
            if w not in bdb._PROPER_STOP and w not in bdb._NOT_A_COMPANY:
                names.add(w)
    # The scorecard quotes the earlier edition back, so it may name whatever that
    # edition named; only the bullets are held to the one-block rule.
    for t in list(ed.get("bullets") or []):
        p = bdb._plain(t)
        for tk in bdb._TICKERISH.findall(p):
            if tk not in bdb._NOT_A_COMPANY:
                bad.append(f'"{p[:70]}…" names {tk} — single names live in the headlines block, not in a bullet')
                break
        hit = [w for w in bdb._PROPER.findall(p) if w in names]
        if hit:
            bad.append(f'"{p[:70]}…" repeats {hit[0]} from the headlines — a company appears in one block only')


def prepare(path, edition, gates_path):
    now = datetime.datetime.now(bdb.ET)
    today = now.strftime("%Y-%m-%d")
    if not bdb._ignore_calendar() and not bdb.is_trading_day(now.date()):
        print(f"not a trading day ({now:%Y-%m-%d %a}) — refusing to prepare a {edition} edition", file=sys.stderr)
        sys.exit(2)
    ed = json.load(open(path, encoding="utf-8"))
    for k in ("headline", "stance"):
        if not ed.get(k):
            raise ValueError(f"{edition} missing required key: {k}")
    for k in ("scorecard", "items", "watch"):
        if not isinstance(ed.get(k), list):
            ed[k] = []
    if edition == "midday":
        if not isinstance(ed.get("bullets"), list):
            ed["bullets"] = []
        ed.pop("sections", None)
        if gates_path:
            g = json.load(open(gates_path, encoding="utf-8"))
            if g.get("date") != today or not g.get("fired"):
                raise ValueError("gates file says nothing fired today — a Midday Update is not allowed to post")
            gate = str((ed.get("trigger") or {}).get("gate") or "")
            if gate not in (g.get("fired_gates") or []):
                raise ValueError(f"trigger.gate {gate!r} is not a fired gate ({g.get('fired_gates')}) — name the gate that actually fired")
    else:
        ed.pop("bullets", None)
        ed["trigger"] = None
        for sec in ed.get("sections") or []:
            if isinstance(sec, dict):
                sn = sec.get("single_name")
                if not isinstance(sn, dict) or not str(sn.get("ticker") or "").strip():
                    sec["single_name"] = None
    ed["date"] = today
    ed["edition"] = edition
    ed["label"] = EDITIONS[edition]["label"]
    ed["written_at"] = now.isoformat(timespec="seconds")

    bad = []
    words = enforce_caps(ed, edition, bad)
    if bad:
        raise ValueError(f"{edition} is over its caps — every item below must be cut:\n  - " + "\n  - ".join(bad))
    sh = _shadow(ed, edition)
    bdb.enforce_shape(sh)
    bdb.enforce_voice(sh)
    bdb.enforce_no_outside_research(ed)
    bdb.check_duplication(sh)
    if edition == "close":
        bdb.enforce_sections(sh)
    else:
        bad = []
        enforce_midday_names(ed, bad)
        if bad:
            raise ValueError("midday structure — a company is named in the headlines block or nowhere:\n  - " + "\n  - ".join(bad))
    ed = bdb.scrub_banned(ed)
    keep = ["date", "edition", "label", "written_at", "headline", "stance", "trigger", "scorecard",
            "bullets", "sections", "items", "watch"]
    ed = {k: ed[k] for k in keep if k in ed}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(ed, f, ensure_ascii=False, indent=2)
    print(f"prepared OK — {ed['label']} {today} · written {now:%-I:%M %p} ET · ~{words} words · "
          f"{len(ed['scorecard'])} scorecard rows · {len(ed['items'])} items · {len(ed['watch'])} watch\n"
          f"headline: {ed['headline']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--edition", choices=list(EDITIONS), required=True)
    ap.add_argument("--prepare-file", required=True)
    ap.add_argument("--gates", default=None, help="midday: the gate log this run produced (public/midday_gates.json)")
    a = ap.parse_args()
    prepare(a.prepare_file, a.edition, a.gates)
