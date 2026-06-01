#!/usr/bin/env python3
"""Anti-synthetic-data guard for MacroTilt's live React surfaces.

Why this exists
---------------
2026-06-01: large parts of the Scanner and Ticker Detail pages were rendering
FABRICATED data dressed as real — hash-seeded per-component scores, random-walk
sparklines, a synthetic `fakePath` price chart, and four hardcoded "events"
(incl. "BMO -> Outperform") shown identically on every ticker. The real values
were sitting unused in the database the whole time. This destroyed user trust.

LESSONS.md (2026-06-01) makes the rule binding: every value on a data surface
must trace to a real stored field; if a field isn't available, render an
em-dash, never a synthesized stand-in. This script ENFORCES that rule on every
PR so the pattern cannot ship again.

What it flags (in src/, the live app — tests and stories excluded)
-----------------------------------------------------------------
  * Math.random( ............... random data generated in app code
  * fake*/mock*/synth*/dummy*/stub*/placeholder* function or const definitions
    and calls .......... synthetic data generators
  * fakePath / fakeSpark / fakeBars / breakdownFor-style seeded series
  * hardcoded ISO-date series literals built in a loop (e.g. `2026-01-${i}` or
    repeated '20YY-MM-DD' literals pushed into an array) .... fabricated charts

Escape hatch
------------
A genuinely-legitimate use (e.g. a deterministic example inside a Storybook or
a demo route) can add a trailing `// synthetic-ok: <reason>` on the offending
line. The reason is logged so escape hatches stay visible and reviewable.

Usage
-----
  python scripts/check_no_synthetic_data.py            # scan, exit 1 on hits
  python scripts/check_no_synthetic_data.py --list     # list every match, no fail

Wired into .github/workflows/CHECK-NO-SYNTHETIC-DATA.yml on pull_request.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

# Directories / file suffixes that are NOT shipped as live data surfaces.
EXCLUDE_DIR_PARTS = {"__tests__", "__mocks__", "test", "tests", "stories", "node_modules"}
EXCLUDE_SUFFIXES = (".test.js", ".test.jsx", ".spec.js", ".spec.jsx", ".stories.jsx")

ALLOW_MARKER = "synthetic-ok"

# (compiled regex, human label). High-precision patterns only — a noisy guard
# that false-positives gets disabled, so we flag the genuinely-bad signatures.
RULES = [
    (re.compile(r"\bMath\.random\s*\("), "Math.random() — random data in app code"),
    (re.compile(r"\b(?:function\s+|const\s+|let\s+|var\s+)(?:fake|mock|synth|dummy|stub|placeholder)[A-Z]\w*"),
     "synthetic data generator definition (fake*/mock*/synth*/dummy*/stub*/placeholder*)"),
    (re.compile(r"\b(?:fake|synth)[A-Z]\w*\s*\("), "call to a synthetic data generator"),
    (re.compile(r"`\s*20\d\d-\d\d-\$\{"), "hardcoded ISO-date series template (fabricated chart x-axis)"),
    # NOTE: a rule flagging *static* arrays of ISO-date literals was removed —
    # it false-positived on legitimate constants like the NYSE holiday calendar
    # in freshnessClock.js. The fabrication signature we care about is a date
    # built from a loop variable in a template string (the rule above), not a
    # static lookup table. Static date tables are config, not fake series.
]


def iter_files():
    if not SRC.exists():
        return
    for p in SRC.rglob("*.js*"):
        if p.suffix not in (".js", ".jsx"):
            continue
        if any(part in EXCLUDE_DIR_PARTS for part in p.parts):
            continue
        if p.name.endswith(EXCLUDE_SUFFIXES):
            continue
        yield p


def scan():
    hits, allowed = [], []
    for path in iter_files():
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            continue
        for n, line in enumerate(lines, 1):
            for rx, label in RULES:
                if rx.search(line):
                    rel = path.relative_to(ROOT)
                    if ALLOW_MARKER in line:
                        reason = line.split(ALLOW_MARKER, 1)[1].lstrip(": ").strip()
                        allowed.append((rel, n, label, reason))
                    else:
                        hits.append((rel, n, label, line.strip()[:120]))
    return hits, allowed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list matches without failing")
    args = ap.parse_args()

    hits, allowed = scan()

    if allowed:
        print(f"ℹ {len(allowed)} allow-listed synthetic use(s) (// synthetic-ok):")
        for rel, n, label, reason in allowed:
            print(f"   {rel}:{n}  [{label}]  reason: {reason or '(none given)'}")

    if not hits:
        print("✓ No synthetic/placeholder data found in live src/ surfaces.")
        return 0

    print(f"\n✗ Found {len(hits)} synthetic/placeholder data pattern(s) in live surfaces.\n"
          "  Per LESSONS.md (2026-06-01): every value must trace to a real stored\n"
          "  field; render an em-dash when unavailable, never a fabricated stand-in.\n"
          "  If a use is genuinely legitimate, add `// synthetic-ok: <reason>` on the line.\n")
    for rel, n, label, snippet in hits:
        print(f"   {rel}:{n}")
        print(f"      rule: {label}")
        print(f"      code: {snippet}")
    return 0 if args.list else 1


if __name__ == "__main__":
    sys.exit(main())
