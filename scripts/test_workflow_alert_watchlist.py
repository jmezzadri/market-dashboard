#!/usr/bin/env python3
"""
test_workflow_alert_watchlist.py — the alert watchlist must match reality.

WORKFLOW_FAILURE_ALERT triggers on `workflow_run`, and GitHub matches that
trigger on a workflow's `name:`, NOT on its file name. Nothing has ever checked
that the names on the list correspond to workflows that exist, or that every
scheduled workflow is on it. Both gaps were live on 2026-08-18:

  * EARNINGS_HISTORY_WEEKLY was listed (the FILE name). The workflow's `name:`
    is EARNINGS-HISTORY-WEEKLY. The entry matched nothing and had been inert
    since it was added on 2026-04-30. Three more entries named workflows that
    do not exist at all.
  * 25 of the 41 scheduled workflows were absent from the trigger entirely.
    MONITOR-RECONCILE proved what that costs: four consecutive failures across
    19 hours, no workflow_failure_log row, no escalation, nothing. A workflow
    off this trigger is not merely un-emailed, it is UNRECORDED.

Both failures are silent by construction — a watchlist reads as coverage
whether or not it matches anything. So they get a test.

Run: python3 scripts/test_workflow_alert_watchlist.py     (exit 1 on failure)
"""
from __future__ import annotations
import os, sys, glob
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
WF_DIR = os.path.join(os.path.dirname(HERE), ".github", "workflows")
ALERT = os.path.join(WF_DIR, "WORKFLOW_FAILURE_ALERT.yml")

# Scheduled workflows deliberately NOT watched. Each needs a reason, and the
# reason has to be that the workflow is switched off — never that it is noisy.
# A noisy workflow is fixed or moved to the BACKGROUND tier, not hidden.
UNWATCHED_BY_DESIGN = {
    # Automated paper trading halted 2026-08-12; these are disabled stubs.
    "PAPER-PORTFOLIO-WATCHDOG",
    "PAPER-PORTFOLIO-INTRADAY",
    "CONVICTION-OPEN-DAILY",
    "CONVICTION-KILL-CHECK",
    # Unusual Whales subscription lapsed 2026-08-12; producers retired.
    "UNIVERSE_SNAPSHOT_3X_WEEKDAYS",
    "UW_METER_READ_NIGHTLY",
}


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh.read())


def _on(doc):
    """PyYAML parses a bare `on:` key as the boolean True (YAML 1.1)."""
    if not isinstance(doc, dict):
        return {}
    return doc.get("on", doc.get(True)) or {}


def main() -> int:
    real_names = {}          # workflow name -> file
    scheduled = {}           # workflow name -> file, for anything with a schedule
    for path in sorted(glob.glob(os.path.join(WF_DIR, "*.yml"))):
        doc = _load(path)
        name = (doc or {}).get("name")
        if not name:
            continue
        base = os.path.basename(path)
        real_names[name] = base
        on = _on(doc)
        if isinstance(on, dict) and "schedule" in on:
            scheduled[name] = base

    watched = _on(_load(ALERT)).get("workflow_run", {}).get("workflows") or []

    failures = []

    # 1. Every entry must name a workflow that exists. An entry that matches
    #    nothing never fires and is indistinguishable from coverage.
    for entry in watched:
        if entry not in real_names:
            near = [n for n in real_names if n.replace("-", "_") == entry.replace("-", "_")]
            hint = f"  (did you mean {near[0]!r}? the trigger matches `name:`, not the file name)" if near else ""
            failures.append(f"watchlist entry {entry!r} matches no workflow `name:` in .github/workflows/{hint}")

    # 2. Every scheduled workflow must be watched, or explicitly excused.
    for name, base in sorted(scheduled.items()):
        if name in watched or name in UNWATCHED_BY_DESIGN:
            continue
        failures.append(
            f"scheduled workflow {name!r} ({base}) is not on the WORKFLOW_FAILURE_ALERT "
            f"trigger — its failures would be unrecorded and unescalated. Add it to the "
            f"`workflows:` list (recording only; emailing Joe still needs VISIBLE), or add "
            f"it to UNWATCHED_BY_DESIGN here with the reason it is switched off."
        )

    # 3. No duplicates — a duplicate is a merge artefact, and it hides which
    #    line a later edit is actually changing.
    for entry in sorted(set(watched)):
        if watched.count(entry) > 1:
            failures.append(f"watchlist entry {entry!r} appears {watched.count(entry)} times")

    if failures:
        print("WORKFLOW_FAILURE_ALERT watchlist FAILED:\n")
        for f in failures:
            print(f"  - {f}")
        print(f"\n{len(failures)} problem(s).")
        return 1

    print(
        f"WORKFLOW_FAILURE_ALERT watchlist OK — {len(watched)} entries, all resolve to a real "
        f"workflow; {len(scheduled)} scheduled workflows, all watched or excused."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
