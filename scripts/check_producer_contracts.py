#!/usr/bin/env python3
"""Producer-consumer contract checks for MacroTilt's public/*.json producers.

Why this exists
---------------
Every JSON file under public/ is a contract between a Python producer
(compute_v9_allocation.py, indicator_history pipeline, composite recompute
pipeline, etc.) and a React consumer (App.jsx Home page tiles, /pages/*).
A producer can drop or rename a key without throwing — the consumer just
silently renders an em dash and the bug ships to prod.

Bug #1109 (2026-04-28) was exactly this. The methodology block stopped
emitting back_test_spx_cagr/sharpe/max_drawdown after the v9 lock, so the
Home Outperformance tile printed `—` for three days before Joe noticed.
LESSONS rule #29 makes the contract binding; this script enforces it.

Modes
-----
  python scripts/check_producer_contracts.py
      Local mode (default) — validates committed public/*.json files.
      Used by .github/workflows/PR-CONTRACT-CHECK.yml on every PR.

  python scripts/check_producer_contracts.py --live
      Live mode — fetches https://macrotilt.com/<file>.json. Used by
      .github/workflows/DAILY-HOME-SMOKE.yml on cron.

  python scripts/check_producer_contracts.py --live --file-bug
      Live mode + on failure file a P0 bug into Supabase bug_reports
      (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars).

Exit codes
----------
  0  all contracts pass
  1  one or more contracts violated (failure prints the offending file,
     key, and the consumer that would break)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# CONTRACTS — explicit, hand-curated. Keep narrow: only fields the UI
# actually reads. Don't enumerate every field a producer happens to emit.
# ---------------------------------------------------------------------------
CONTRACTS: dict = {
    # The v9 allocation snapshot. Read by Home Outperformance tile +
    # Asset Allocation tab. Bug #1109 lived here.
    "v9_allocation.json": {
        "consumed_by": [
            "src/App.jsx Home Mission/Evidence strip (~L6440)",
            "src/pages/AssetAllocation.jsx",
        ],
        "required_top_level": [
            "as_of",
            "regime",
            "alpha",
            "equity_share",
            "leverage",
            "selection_confidence",
            "picks",
            "defensive",
            "methodology",
        ],
        # Nested keys that must exist AND be non-null.
        "required_non_null": [
            "methodology.back_test_window",
            "methodology.back_test_cagr",
            "methodology.back_test_spx_cagr",
            "methodology.back_test_sharpe",
            "methodology.back_test_spx_sharpe",
            "methodology.back_test_max_drawdown",
            "methodology.back_test_spx_max_drawdown",
        ],
    },

    # Composite history — Home Macro lead-in + Asset Allocation timeline +
    # TodayMacro chart. Validated as a non-empty list with the daily fields.
    "composite_history_daily.json": {
        "consumed_by": [
            "src/App.jsx Home Macro lead-in",
            "src/pages/AssetAllocation.jsx timeline",
            "src/pages/TodayMacro.jsx chart",
        ],
        "list_min_length": 100,
        # Each row must contain at least these keys.
        "list_row_required": ["d", "RL", "GR", "IR"],
    },

    # Indicator history — App-wide hist hook. Schema is sprawling; just
    # require the file to be a non-empty object/list.
    "indicator_history.json": {
        "consumed_by": ["src/App.jsx hist hook (~L779)"],
        "non_empty": True,
    },

    # Industry-group rationales for the Asset Allocation drill-down.
    "industry_group_rationale.json": {
        "consumed_by": ["src/pages/AssetAllocation.jsx drill-down"],
        "non_empty": True,
    },

    # Allocation history.
    "allocation_history.json": {
        "consumed_by": ["src/pages/AssetAllocation.jsx history strip"],
        "non_empty": True,
    },

    # Scenario allocations — per-scenario v9 outputs feeding the L4 panel.
    "scenario_allocations.json": {
        "consumed_by": ["src/pages/ScenarioAnalysis.jsx L4 panel"],
        "non_empty": True,
    },

    # Composite weights — methodology page + TodayMacro.
    "composite_weights.json": {
        "consumed_by": ["src/pages/TodayMacro.jsx", "src/pages/MethodologyPage.jsx"],
        "non_empty": True,
    },

    # Composite event markers — TodayMacro lead-time event-study table.
    "composite_event_markers.json": {
        "consumed_by": ["src/pages/TodayMacro.jsx event-study table"],
        "non_empty": True,
    },

    # v11 calibration — Cycle Mechanism Board (Asset Tilt page) + methodology
    # page. Sprint 1 ships 3 live tiles (Valuation / Credit / Growth) with the
    # round-6 indicator drawer field groups (kpis, episodes, comovement,
    # release, composite_breakdown). LESSONS rule #29: producer/consumer
    # contract is binding.
    "methodology_calibration_v11.json": {
        "consumed_by": [
            "src/pages/AssetAllocation.jsx (Cycle Mechanism Board)",
            "src/pages/MethodologyPage.jsx (v11 methodology preview)",
        ],
        "required_top_level": [
            "version",
            "framework",
            "as_of",
            "lexicon",
            "headline_gauge",
            "tiles",
            "ui_spec",
            "build_meta",
        ],
        # Headline gauge fields the page reads
        "required_non_null": [
            "headline_gauge.n_elevated",
            "headline_gauge.n_live",
            "headline_gauge.verdict",
            "headline_gauge.headline_sentence",
            "build_meta.framework_version",
            "build_meta.schema_version",
        ],
        # tiles is a list — at least 6 (3 live + 3 placeholders) and each
        # live tile carries the round-6 enrichment fields per indicator.
        "list_field": "tiles",
        "list_field_min_length": 6,
        # Schema for live tile indicators after round-6 enrichment.
        "live_tile_indicator_required": [
            "id", "name", "current", "percentile", "quartile",
            "history", "kpis", "episodes", "comovement", "release",
            "concerning_score", "composite_share_pct", "direction",
        ],
    },
}

LIVE_BASE = "https://macrotilt.com"
LOCAL_BASE = "public"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _walk(obj, dotted_path: str):
    """Walk dotted path through a dict; return (found, value)."""
    cur = obj
    for part in dotted_path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return False, None
        cur = cur[part]
    return True, cur


def _load_local(filename: str):
    path = os.path.join(LOCAL_BASE, filename)
    if not os.path.isfile(path):
        return None, f"missing file: {path}"
    try:
        with open(path) as f:
            return json.load(f), None
    except Exception as e:
        return None, f"could not parse {path}: {e}"


def _load_live(filename: str):
    url = f"{LIVE_BASE}/{filename}"
    try:
        # Cache-bust to avoid Vercel edge cache serving a stale copy.
        bust = int(datetime.now(timezone.utc).timestamp())
        req = urllib.request.Request(f"{url}?cb={bust}", headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code} fetching {url}"
    except Exception as e:
        return None, f"could not fetch {url}: {e}"


def _check_one(filename: str, contract: dict, data) -> list[str]:
    """Return list of violation strings (empty list = pass)."""
    out: list[str] = []
    consumers = ", ".join(contract.get("consumed_by", []))

    # File-level non-empty (object or list).
    if contract.get("non_empty"):
        if data in (None, {}, []):
            out.append(f"  [{filename}] empty payload — breaks: {consumers}")
            return out

    # List-level checks.
    if "list_min_length" in contract:
        if not isinstance(data, list):
            out.append(f"  [{filename}] expected JSON array, got {type(data).__name__}")
        elif len(data) < contract["list_min_length"]:
            out.append(
                f"  [{filename}] only {len(data)} rows (need ≥ {contract['list_min_length']}) "
                f"— breaks: {consumers}"
            )
        elif "list_row_required" in contract:
            sample = data[0]
            if not isinstance(sample, dict):
                out.append(f"  [{filename}] rows are not objects")
            else:
                for k in contract["list_row_required"]:
                    if k not in sample:
                        out.append(
                            f"  [{filename}] row missing key '{k}' "
                            f"— breaks: {consumers}"
                        )

    # Top-level required keys.
    for k in contract.get("required_top_level", []):
        if not isinstance(data, dict) or k not in data:
            out.append(f"  [{filename}] missing top-level key '{k}' — breaks: {consumers}")

    # Required non-null nested keys.
    for path in contract.get("required_non_null", []):
        found, val = _walk(data, path)
        if not found:
            out.append(f"  [{filename}] missing key '{path}' — breaks: {consumers}")
        elif val is None:
            out.append(f"  [{filename}] key '{path}' is null — breaks: {consumers}")

    # Nested list-field min-length and per-row checks (used by the v11
    # calibration contract — `tiles` is the list to validate).
    list_field = contract.get("list_field")
    if list_field:
        list_data = data.get(list_field) if isinstance(data, dict) else None
        if not isinstance(list_data, list):
            out.append(f"  [{filename}] '{list_field}' is not a list — breaks: {consumers}")
        else:
            min_len = contract.get("list_field_min_length", 0)
            if len(list_data) < min_len:
                out.append(
                    f"  [{filename}] '{list_field}' has {len(list_data)} entries "
                    f"(need ≥ {min_len}) — breaks: {consumers}"
                )
            # Per-indicator round-6 enrichment audit on live tiles only.
            ind_req = contract.get("live_tile_indicator_required") or []
            if ind_req:
                for tile in list_data:
                    if not isinstance(tile, dict) or not tile.get("live"):
                        continue
                    for ind in tile.get("indicators", []) or []:
                        if not isinstance(ind, dict):
                            continue
                        for k in ind_req:
                            if k not in ind or ind.get(k) is None:
                                out.append(
                                    f"  [{filename}] live tile '{tile.get('id')}' indicator "
                                    f"'{ind.get('id')}' missing/null '{k}' — breaks: {consumers}"
                                )

    return out


def _file_bug(violations: list[str]) -> bool:
    """File a P0 bug into Supabase bug_reports. Returns True on success."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("  (cannot file bug: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set)")
        return False
    body = (
        "Daily home-page smoke test detected one or more producer/consumer "
        "contract violations on macrotilt.com. The contract list is in "
        "scripts/check_producer_contracts.py.\n\n"
        "Violations:\n" + "\n".join(violations) +
        "\n\nFiled automatically by .github/workflows/DAILY-HOME-SMOKE.yml. "
        "See LESSONS.md rule #29 for the binding rule."
    )
    payload = json.dumps({
        "title": "P0 — producer/consumer contract violation on live site",
        "description": body,
        "url_full": LIVE_BASE,
        "reporter_email": "smoke-test@macrotilt.com",
        "status": "new",
    }).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/bug_reports",
        data=payload,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            row = json.loads(resp.read())
            num = row[0].get("report_number") if row else "?"
            print(f"  → filed bug #{num}")
            return True
    except Exception as e:
        print(f"  could not file bug: {e}")
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true",
                    help="fetch from macrotilt.com instead of local public/")
    ap.add_argument("--file-bug", action="store_true",
                    help="if any check fails, file a P0 bug in Supabase")
    args = ap.parse_args()

    print(f"[contracts] mode={'live' if args.live else 'local'} "
          f"files={len(CONTRACTS)}")
    all_violations: list[str] = []
    for filename, contract in CONTRACTS.items():
        loader = _load_live if args.live else _load_local
        data, err = loader(filename)
        if err:
            all_violations.append(f"  [{filename}] {err}")
            continue
        violations = _check_one(filename, contract, data)
        if violations:
            all_violations.extend(violations)
        else:
            print(f"  ok  {filename}")

    if not all_violations:
        print("[contracts] all contracts pass")
        return 0

    print("\n[contracts] FAIL — contract violations:")
    for v in all_violations:
        print(v)

    if args.file_bug:
        print("\n[contracts] filing P0 bug in Supabase...")
        _file_bug(all_violations)

    return 1


if __name__ == "__main__":
    sys.exit(main())
