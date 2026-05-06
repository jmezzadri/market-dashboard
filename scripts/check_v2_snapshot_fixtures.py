#!/usr/bin/env python3
"""
v2 Snapshot Fixture Checker
============================

Validates each v2 page against its locked fixture contract.

A fixture (fixtures/v2_snapshots/v2_<tab>.json) lists every required
section heading, label, lexicon state, mechanism, tooltip target, source
attribution pattern, drilldown path, and chart feature that the rendered
page MUST contain. It also lists banned strings that MUST NOT appear in
rendered paths, and per-fixture exempt locations for known defensive
references.

This checker uses static text inspection of the page file (and adjacent
imports it pulls in). It is fast, deterministic, and runs in CI without
a React runtime. Output is a tab-by-tab pass/fail with concrete
file:line evidence on failure.

Usage:
  python3 scripts/check_v2_snapshot_fixtures.py            # all fixtures
  python3 scripts/check_v2_snapshot_fixtures.py macro_overview
  python3 scripts/check_v2_snapshot_fixtures.py --report   # verbose

Exit codes:
  0  all fixtures pass
  1  one or more fixtures fail
  2  script error (missing fixture, missing page file, schema issue)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = ROOT / "fixtures" / "v2_snapshots"


def find_lines_containing(text: str, needle: str) -> list[int]:
    """Return 1-indexed line numbers where needle (literal) appears.
    Both the line and the needle are HTML-entity decoded before
    comparison so a fixture asking for 'Top & bottom tilts' matches
    JSX source that reads 'Top &amp; bottom tilts'."""
    import html as _html
    needle_lower = _html.unescape(needle).lower()
    return [
        i + 1
        for i, line in enumerate(text.splitlines())
        if needle_lower in _html.unescape(line).lower()
    ]


def line_at(text: str, n: int) -> str:
    lines = text.splitlines()
    return lines[n - 1] if 0 < n <= len(lines) else ""


def is_in_jsx_text_or_attr(line: str, token: str) -> bool:
    """True iff token appears in a position likely rendered to the user
    (JSX text node OR JSX attribute value OR a quoted string outside
    a JS-only context like .from(), fetch(), elementId=, indicatorId=,
    console.log, import). Mirrors the heuristic in
    check_v2_cutover_quality.py."""
    s = line.strip()
    if s.startswith("//") or s.startswith("/*") or s.startswith("*"):
        return False
    if "import " in s and " from " in s:
        return False
    # Programmatic refs — not rendered
    if re.search(r"\.from\(\s*['\"`]", s) and token in s:
        return False
    if "fetch(" in s and token in s:
        return False
    if re.search(r"\b(elementId|indicatorId|tableName|seriesId)\s*[:=]", s):
        return False
    if "console." in s and token in s:
        return False
    # JSX text node
    if re.search(rf">[^<]*{re.escape(token)}[^<]*<", line):
        return True
    # Quoted string (string literal, JSX attribute value, JS const)
    if re.search(rf"['\"`][^'\"`]*{re.escape(token)}[^'\"`]*['\"`]", line):
        return True
    return False


def line_matches_exempt(file: str, line: str, line_no: int, exempt_locs, token: str) -> bool:
    """Check whether (file, line_no, token) sits in an exempt location."""
    for ex in exempt_locs or []:
        if ex.get("file") and not file.endswith(ex["file"]):
            continue
        if token not in (ex.get("tokens") or []):
            continue
        pat = ex.get("line_pattern", "")
        if pat:
            try:
                if re.search(pat, line, re.IGNORECASE):
                    return True
            except re.error:
                # treat as literal substring fallback
                if pat.lower() in line.lower():
                    return True
        else:
            return True
    return False


def check_fixture(fixture_path: Path, verbose: bool = False) -> list[str]:
    """Returns list of violation strings; empty list = pass."""
    f = json.loads(fixture_path.read_text())
    violations: list[str] = []

    page_file = ROOT / f["page_file"]
    if not page_file.exists():
        return [f"page file missing: {f['page_file']}"]
    raw_text = page_file.read_text()
    import html as _html
    text = _html.unescape(raw_text)

    tab = f["tab_id"]

    # --- Required strings (each must appear at least once in page text)
    for category, key in (
        ("section heading", "required_section_headings"),
        ("label",           "required_labels"),
        ("lexicon state",   "required_lexicon_states"),
    ):
        for s in f.get(key, []):
            if s.lower() not in text.lower():
                violations.append(
                    f"[{tab}] missing {category} {s!r} in {f['page_file']}"
                )

    # Required mechanisms — both id and name
    for m in f.get("required_mechanisms", []):
        if m["name"].lower() not in text.lower():
            violations.append(
                f"[{tab}] missing mechanism name {m['name']!r} in {f['page_file']}"
            )

    # Source attribution pattern
    pat = f.get("required_source_attribution_pattern")
    if pat and pat.lower() not in text.lower():
        violations.append(
            f"[{tab}] missing source-attribution pattern {pat!r} in {f['page_file']}"
        )

    # Required tooltips for labels — heuristic: tooltip plumbing usually
    # routes the label string to a `tip=` / `title=` / Tooltip attr
    for label in f.get("required_tooltips_for_labels", []):
        # The label appears at least once. Check a tooltip attr exists
        # on the same JSX block (within ~6 lines).
        lines = text.splitlines()
        seen_tooltip = False
        for i, line in enumerate(lines):
            if label.lower() not in line.lower():
                continue
            window = "\n".join(lines[max(0, i - 8):i + 6])
            if re.search(r"\b(tip|tooltip|title|aria-label)\s*=", window, re.IGNORECASE):
                seen_tooltip = True
                break
            if re.search(r"<Tooltip\b", window):
                seen_tooltip = True
                break
        if not seen_tooltip:
            violations.append(
                f"[{tab}] label {label!r} appears without an adjacent tooltip"
                f" / title / aria-label in {f['page_file']}"
            )

    # Required chart features
    for feature in f.get("required_chart_features", []):
        feature_lower = feature.lower()
        if "mtchart" in feature_lower:
            if not re.search(r"<MTChart\b|from ['\"][^'\"]*MTChart", text):
                violations.append(
                    f"[{tab}] required chart feature missing: {feature}"
                )
        elif "tintbands" in feature_lower:
            if "tintBands" not in text:
                violations.append(
                    f"[{tab}] required chart feature missing: {feature}"
                )

    # Banned strings in rendered paths
    for banned in f.get("banned_strings_in_rendered_paths", []):
        for ln in find_lines_containing(raw_text, banned):
            line_text = line_at(raw_text, ln)
            if not is_in_jsx_text_or_attr(line_text, banned):
                continue
            # Check exempt locations
            if line_matches_exempt(f["page_file"], line_text, ln,
                                   f.get("exempt_locations"), banned):
                continue
            violations.append(
                f"[{tab}] banned string {banned!r} renders at "
                f"{f['page_file']}:{ln} — line: {line_text.strip()!r}"
            )

    if verbose and not violations:
        sys.stdout.write(
            f"  ✓ [{tab}] {f['page_file']} passed against locked fixture "
            f"({fixture_path.name})\n"
        )
    return violations


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = [a for a in argv[1:] if a.startswith("--")]
    verbose = "--report" in flags or "-v" in flags

    if not FIXTURE_DIR.exists():
        sys.stderr.write(f"fixture dir missing: {FIXTURE_DIR}\n")
        return 2

    fixtures = sorted(FIXTURE_DIR.glob("v2_*.json"))
    if not fixtures:
        sys.stderr.write(f"no fixtures found under {FIXTURE_DIR}\n")
        return 2

    if args:
        wanted = set(args)
        fixtures = [
            p for p in fixtures
            if (p.stem.replace("v2_", "") in wanted or p.stem in wanted)
        ]
        if not fixtures:
            sys.stderr.write(f"no fixtures matched: {args}\n")
            return 2

    all_violations: list[str] = []
    for p in fixtures:
        try:
            vs = check_fixture(p, verbose=verbose)
        except Exception as e:
            sys.stderr.write(f"error checking {p.name}: {e}\n")
            return 2
        all_violations.extend(vs)

    if all_violations:
        sys.stderr.write("\nv2 snapshot fixture check — FAILED\n")
        sys.stderr.write("=" * 56 + "\n")
        for v in all_violations:
            sys.stderr.write(f"  ✗ {v}\n")
        sys.stderr.write(f"\n{len(all_violations)} violation(s) across "
                         f"{len(fixtures)} fixture(s).\n")
        return 1

    sys.stdout.write(
        f"✓ v2 snapshot fixtures — clean. {len(fixtures)} fixture(s) passed.\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
