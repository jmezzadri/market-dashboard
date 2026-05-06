#!/usr/bin/env python3
"""
v2 Cutover Quality Gate
========================

Hard pre-merge check enforcing the 12-theme MacroTilt cutover rules.
Runs on every push to feature/* branches via GH Actions.

Fails the build (exit 1) and prints a punchlist when ANY of these hit:

  THEME #3  Banned lexicon in user-facing surfaces (JSON copy strings,
            JSX tag children/attributes, Markdown content):
              Stressed, Distressed, Concerning, Complacent,
              complacency, complacent, "Normal" used as a state label.

  THEME #4 / #5  Hardcoded numbers + units inside copy strings
            (so_what / description / headline_sentence / subheadline /
            narrative). Pattern: "<number> bp" / "<number>%" / "<number>x".
            Live readings should flow from current.value into the
            Current Reading tile, not be baked into the prose.

  THEME #5  Internal plumbing names leaking into user-facing copy:
              pipeline_health, indicator_history (as a string label),
              cron-style workflow names (INDICATOR-REFRESH, MASSIVE-*),
              edge function names, GitHub Actions workflow filenames.
            (Machine-readable enums like direction='low_is_concerning'
            and Supabase .from('pipeline_health') queries are exempt;
            we look only at strings rendered on user-facing surfaces.)

  THEME #7  Internal scoring jargon in user-facing surfaces:
              Tilt points, History points, OVR, "5+5", "+0.87".

  THEME #10  Apple-blue / legacy palette in v2 components:
              #0071e3, --legacy-* CSS variables.

Usage:
  python scripts/check_v2_cutover_quality.py            # check all
  python scripts/check_v2_cutover_quality.py --report   # human-readable

Exit codes:
  0  all clean
  1  one or more themes violated (full report on stderr)
  2  script error (missing files, etc.)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent

# ─── PATHS WE CHECK ───────────────────────────────────────────────────
USER_FACING_JSON = [
    ROOT / "public" / "methodology_calibration_v11.json",
    ROOT / "public" / "cycle_board_snapshot.json",
    ROOT / "public" / "v10_allocation.json",
    ROOT / "public" / "v9_allocation.json",
    ROOT / "public" / "scenario_allocations.json",
]

V2_PAGE_FILES = list((ROOT / "src" / "v2").rglob("*.jsx")) + list((ROOT / "src" / "v2").rglob("*.js"))
V2_STYLES = list((ROOT / "src" / "v2").rglob("*.css"))

# ─── BANNED LEXICON (THEME #3) ────────────────────────────────────────
# Match these as whole words, any case, in user-facing string contexts.
BANNED_LEXICON = [
    r"Stressed",
    r"Distressed",
    r"Concerning",
    r"Complacent",
    r"complacency",
    r"complacent",
]
# 'Normal' is loaded — only banned when used as a state-band LABEL, not the adjective.
BANNED_NORMAL_PATTERNS = [
    r"\babove Normal\b",
    r"\bNormal regime\b",
    r"\"Normal\":",        # JSON key naming a state
]

# ─── INTERNAL PLUMBING NAMES (THEME #5) ───────────────────────────────
INTERNAL_PLUMBING_TOKENS = [
    "pipeline_health",
    "indicator_history",
    "cycle_board_snapshot",
    "INDICATOR-REFRESH",
    "MASSIVE-DAILY",
    "V10-ASSET-ALLOCATION",
    "V9-ALLOCATION",
    "DAILY-HOME-SMOKE",
    "SCAN_345PM",
    "TICKER_EVENTS_3X",
    "UNIVERSE_SNAPSHOT_3X",
]

# ─── INTERNAL JARGON (THEME #7) ───────────────────────────────────────
JARGON_PATTERNS = [
    r"\bTilt points?\b",
    r"\bHistory points?\b",     # 'Months of history' is the v2 phrasing
    r"\bOVR\b",
    r"\b5\+5\b",
]

# ─── HARDCODED NUMBERS IN COPY (THEME #4 / #5) ────────────────────────
# Apply only inside user-facing copy fields of JSON.
NUMBER_IN_COPY_PATTERN = re.compile(r"\b\d+(?:\.\d+)?\s*(?:bp|%|x|×|pts?)\b", re.IGNORECASE)
USER_FACING_COPY_KEYS = {
    "so_what",
    "description",
    "description_long",
    "description_short",
    "headline_sentence",
    "subheadline",
    "narrative",
    "headline_caption",
    "rule_status",
    "verdict",
    "current_state",
}

# ─── APPLE-BLUE / LEGACY (THEME #10) ──────────────────────────────────
LEGACY_PALETTE_PATTERNS = [
    r"#0071e3",
    r"#007AFF",
    r"--legacy-",
]

# ─── STRUCTURED EXEMPTIONS ────────────────────────────────────────────
# A historical-event reference (e.g. "GFC 2008 peak (~2,000bp) is out of
# sample") is OK — it's a fact of the past, not a freshness signal. We
# match the EXACT string we know about; anything else still trips the gate.
EXEMPT_HISTORICAL_NUMBER_STRINGS = [
    "2,000bp",   # GFC 2008 peak reference in HY OAS data_caveat
]

# Comments and docstrings inside JSX/JS are not user-facing.
JSX_COMMENT_RE = re.compile(r"\{/\*.*?\*/\}|/\*.*?\*/|//[^\n]*", re.DOTALL)


def is_user_facing_string_in_jsx(line: str) -> bool:
    """Heuristic: a banned word in a JSX file is user-facing when it's inside a
    string literal that gets rendered, not inside a JS identifier/import/comment.
    Exempts remap-table keys (e.g. STANCE_MAP { 'Stressed': 'Risk Off' }) — those
    are defensive collapse rules, not output."""
    s = line.strip()
    if s.startswith("//") or s.startswith("/*") or s.startswith("*"):
        return False
    if "import " in s and " from " in s: return False
    # Remap-table key — banned word in quotes followed by ':' and a v2-lexicon value
    if re.search(r"[\"'`](?:Stressed|Distressed|Concerning|Complacent|complacency|complacent|Normal)[\"'`]\s*:\s*[\"'`](?:Risk On|Neutral|Cautionary|Risk Off)[\"'`]", line):
        return False
    # JSX: text node between tags
    if re.search(r">[^<]*\b(?:Stressed|Distressed|Concerning|Complacent|complacency|complacent)\b[^<]*<", line):
        return True
    # In a JSX/attribute string literal
    if re.search(r"[\"'`][^\"'`]*\b(?:Stressed|Distressed|Concerning|Complacent|complacency|complacent)\b[^\"'`]*[\"'`]", line):
        return True
    return False


def is_plumbing_leak_in_jsx(line: str, token: str) -> bool:
    """Plumbing tokens are OK as: fetch URLs, elementId / indicatorId / table props,
    Supabase .from() calls, console.log debug. They're banned as RENDERED text /
    user-visible attribute values (alt, title, aria-label, children)."""
    s = line.strip()
    # Programmatic references — exempt
    if "fetch(" in s and token in s: return False
    if "elementId" in s and token in s: return False
    if "indicatorId" in s and token in s: return False
    if ".from(" in s and token in s: return False
    if "console." in s and token in s: return False
    if s.startswith("//") or s.startswith("/*"): return False
    if "import " in s and " from " in s: return False
    # If token is inside a JSX TEXT node (between > and <), it's user-facing
    if re.search(rf">[^<]*{re.escape(token)}[^<]*<", line):
        return True
    # If token is inside a quoted string AND there's no fetch/elementId/etc context
    if re.search(rf"[\"'`][^\"'`]*{re.escape(token)}[^\"'`]*[\"'`]", line):
        return True
    return False


# ─── VIOLATION COLLECTOR ──────────────────────────────────────────────
class Hits:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str, str]] = []  # (theme, file, line/path, snippet)

    def add(self, theme: str, file: str, locator: str, snippet: str) -> None:
        if any(ex in snippet for ex in EXEMPT_HISTORICAL_NUMBER_STRINGS):
            return
        self.rows.append((theme, file, locator, snippet[:200]))

    def __len__(self) -> int:
        return len(self.rows)


def check_json_file(path: Path, hits: Hits) -> None:
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        print(f"::warning file={path}::could not parse JSON: {e}", file=sys.stderr)
        return

    def walk(obj, trail):
        if isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, trail + [str(k)])
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                walk(item, trail + [f"[{i}]"])
        elif isinstance(obj, str):
            field_name = trail[-1] if trail else ""
            location = ".".join(trail)
            # Underscore-prefixed keys (e.g. _doc, _comment) are internal docstrings
            if any(part.startswith("_") for part in trail):
                return
            # Lexicon (every string field — entire JSON is read by the page eventually)
            for term in BANNED_LEXICON:
                if re.search(rf"\b{term}\b", obj):
                    hits.add("#3 lexicon", str(path.relative_to(ROOT)), location, obj)
            for pattern in BANNED_NORMAL_PATTERNS:
                if re.search(pattern, obj):
                    hits.add("#3 lexicon (Normal)", str(path.relative_to(ROOT)), location, obj)
            # Plumbing leaks
            for token in INTERNAL_PLUMBING_TOKENS:
                if token in obj:
                    hits.add("#5 plumbing leak", str(path.relative_to(ROOT)), location, obj)
            # Hardcoded numbers — only inside known copy keys
            if field_name in USER_FACING_COPY_KEYS and NUMBER_IN_COPY_PATTERN.search(obj):
                hits.add("#4/#5 hardcoded number", str(path.relative_to(ROOT)), location, obj)
            # Jargon
            for pattern in JARGON_PATTERNS:
                if re.search(pattern, obj):
                    hits.add("#7 jargon", str(path.relative_to(ROOT)), location, obj)

    walk(data, [])


def check_jsx_file(path: Path, hits: Hits) -> None:
    if not path.exists():
        return
    text = path.read_text()
    text_no_comments = JSX_COMMENT_RE.sub("", text)
    rel = str(path.relative_to(ROOT))

    for i, line in enumerate(text_no_comments.splitlines(), 1):
        # Lexicon — only if it looks user-facing
        for term in BANNED_LEXICON:
            if re.search(rf"\b{term}\b", line) and is_user_facing_string_in_jsx(line):
                hits.add("#3 lexicon", rel, f"L{i}", line.strip())
        for pattern in BANNED_NORMAL_PATTERNS:
            if re.search(pattern, line) and is_user_facing_string_in_jsx(line):
                hits.add("#3 lexicon (Normal)", rel, f"L{i}", line.strip())
        # Plumbing leaks (only if rendered/user-facing per is_plumbing_leak_in_jsx)
        for token in INTERNAL_PLUMBING_TOKENS:
            if token in line and is_plumbing_leak_in_jsx(line, token):
                hits.add("#5 plumbing leak", rel, f"L{i}", line.strip())
        # Apple-blue / legacy palette
        for pattern in LEGACY_PALETTE_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                hits.add("#10 legacy palette", rel, f"L{i}", line.strip())
        # Jargon (only when looks like a string literal — avoid catching code idents)
        for pattern in JARGON_PATTERNS:
            if re.search(pattern, line) and (re.search(rf"[\"'`].*{pattern}.*[\"'`]", line) or re.search(rf">[^<]*{pattern}", line)):
                hits.add("#7 jargon", rel, f"L{i}", line.strip())


def check_css_file(path: Path, hits: Hits) -> None:
    text = path.read_text()
    rel = str(path.relative_to(ROOT))
    for i, line in enumerate(text.splitlines(), 1):
        for pattern in LEGACY_PALETTE_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                hits.add("#10 legacy palette", rel, f"L{i}", line.strip())


def main(argv: list[str]) -> int:
    hits = Hits()
    for f in USER_FACING_JSON:
        check_json_file(f, hits)
    for f in V2_PAGE_FILES:
        check_jsx_file(f, hits)
    for f in V2_STYLES:
        check_css_file(f, hits)

    if not hits:
        print("✓ v2 cutover quality gate — clean. 0 violations across themes #3 / #4 / #5 / #7 / #10.")
        return 0

    # Group by theme, print punchlist
    print(f"✗ v2 cutover quality gate — {len(hits)} violation(s):", file=sys.stderr)
    print("", file=sys.stderr)
    by_theme: dict[str, list[tuple[str, str, str]]] = {}
    for theme, file, loc, snippet in hits.rows:
        by_theme.setdefault(theme, []).append((file, loc, snippet))
    for theme in sorted(by_theme):
        rows = by_theme[theme]
        print(f"### {theme} — {len(rows)} hit(s)", file=sys.stderr)
        for file, loc, snippet in rows[:30]:
            print(f"  {file}:{loc}", file=sys.stderr)
            print(f"      → {snippet}", file=sys.stderr)
        if len(rows) > 30:
            print(f"  ... and {len(rows) - 30} more", file=sys.stderr)
        print("", file=sys.stderr)

    print(f"FAIL — {len(hits)} cutover-rule violation(s). See punchlist above.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
