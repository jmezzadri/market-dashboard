#!/usr/bin/env python3
"""One-off migration (2026-10-21, Decision 5 / LESSONS 6.26): give every
published Trade Idea a `sizing.weight`.

The book is now a notional 100 and every call is sized against it. Notes
published before this field existed — open and closed — are assigned the
standard 10 here, once, and say so in `scorecard.note` so the Scorecard can
mark the weight as backfilled. Nothing else changes: no entry, no stop, no
return. A note that already carries a weight is left alone.

    python3 scripts/backfill_trade_idea_weights.py            # rewrites public/trade_ideas.json
    python3 scripts/backfill_trade_idea_weights.py --dry-run  # says what it would do

Regenerate public/trade_idea_scores.json in the same change
(scripts/score_trade_ideas.py) so the book lines reflect the weights.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_trade_idea import STANDARD_WEIGHT  # noqa: E402

IDEAS_PATH = os.environ.get("TRADE_IDEAS_PATH", "public/trade_ideas.json")
BACKFILL_NOTE = ("Weight backfilled to {w:g} of 100 on {d}, when the book gained its capital base "
                 "(Trade Idea Contract v2, Decision 5); the note itself did not state a weight. "
                 "Entry, exit level and return are unchanged.")


def backfill(doc: dict, today: str, weight: float = STANDARD_WEIGHT) -> list[str]:
    changed = []
    for idea in doc.get("ideas") or []:
        if not isinstance(idea, dict):
            continue
        sz = idea.get("sizing") if isinstance(idea.get("sizing"), dict) else {}
        try:
            if float(sz.get("weight")) > 0:
                continue
        except (TypeError, ValueError):
            pass
        sz = dict(sz)
        sz["weight"] = weight
        sz["basis"] = "of a notional book of 100; fixed at publication and never changed"
        sz["backfilled_on"] = today
        idea["sizing"] = sz
        sc = idea.get("scorecard") if isinstance(idea.get("scorecard"), dict) else {}
        note = str(sc.get("note") or "").strip()
        line = BACKFILL_NOTE.format(w=weight, d=today)
        sc["note"] = f"{note} {line}".strip() if note else line
        idea["scorecard"] = sc
        changed.append(str(idea.get("id") or idea.get("date")))
    return changed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--path", default=IDEAS_PATH)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--today", default=dt.date.today().isoformat())
    args = ap.parse_args(argv)
    with open(args.path, encoding="utf-8") as f:
        doc = json.load(f)
    changed = backfill(doc, args.today)
    print(f"{len(changed)} note(s) {'would be' if args.dry_run else ''} assigned weight {STANDARD_WEIGHT:g}: "
          + (", ".join(changed) or "none"))
    if not args.dry_run and changed:
        with open(args.path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
