#!/usr/bin/env python3
"""LESSONS-APPEND-GUARD — refuse a LESSONS.md that lost entries it did not mean to lose.

Why (LESSONS 5.25, recurrence 2026-10-23): LESSONS.md is the repo's highest-traffic
append target. A pull request that rewrites it from a copy cloned BEFORE another
PR merged carries the older file forward whole, and the squash merge raises no
conflict — three paragraphs merged on 2026-10-21/22 vanished that way within
hours, each time under an unrelated PR. The signature is always the same: a
heading or a bold dated lead-in that exists on the base branch is absent from
the PR's copy. This check compares exactly those lines.

Usage:  check_lessons_append.py <base LESSONS.md> <head LESSONS.md> [--pr-body FILE]
Exit 0 = nothing lost (or the PR body carries LESSONS-REWRITE-OK for a deliberate
restructure); exit 1 = lost lines, printed so the author can restore them from
git history rather than rewrite them (5.25 rule 3).
"""
from __future__ import annotations

import re
import sys

HEADING = re.compile(r"^#{1,4} ")
# Bold dated lead-ins: "**2026-10-22 addendum (…", "**Fourth pass (2026-10-21, …",
# "**2026-10-23 recurrence (…", "**Second pass, same day:**" — the paragraph
# openers this file uses for amendments to an existing entry.
LEADIN = re.compile(r"^\*\*[^*\n]{0,120}\b(addendum|pass|recurrence|recurred|again)\b", re.I)
OVERRIDE = "LESSONS-REWRITE-OK"


def guarded_lines(text: str) -> list[str]:
    out = []
    for line in text.splitlines():
        s = line.rstrip()
        if HEADING.match(s) or LEADIN.match(s):
            out.append(s)
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    base = open(argv[1], encoding="utf-8").read()
    head = open(argv[2], encoding="utf-8").read()
    body = ""
    if "--pr-body" in argv:
        body = open(argv[argv.index("--pr-body") + 1], encoding="utf-8", errors="replace").read()

    head_lines = set(l.rstrip() for l in head.splitlines())
    lost = [l for l in guarded_lines(base) if l not in head_lines]
    kept = len(guarded_lines(base)) - len(lost)
    print(f"LESSONS-APPEND-GUARD: {kept} guarded lines kept, {len(lost)} lost")
    if not lost:
        return 0
    for l in lost:
        print(f"  LOST: {l[:160]}")
    if OVERRIDE in body:
        print(f"  {OVERRIDE} present in the PR body — deliberate restructure, allowed.")
        return 0
    print(
        "\nThe PR's LESSONS.md is missing lines that are on the base branch. This is the\n"
        "stale-base signature (LESSONS 5.25): the file was rewritten from a copy cloned\n"
        "before another PR merged. Re-fetch main, re-apply your edit on top of it, and\n"
        "restore the lost text from git history — never from memory. For a deliberate\n"
        f"restructure, put {OVERRIDE} in the PR body."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
