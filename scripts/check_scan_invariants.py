#!/usr/bin/env python3
"""Value-correctness invariants for the live Trading-Opportunities scan.

Why this exists
---------------
The fake-data guard (check_no_synthetic_data.py) stops fabricated values, and
the render gate (smoke_render.mjs) stops broken/blank pages. Neither catches a
value that is wired to a real field but COMPUTED WRONG — a plausible-looking
number that's actually off. This check enforces the invariants the UI relies
on, against the real data in public.trading_opps_signals.

Invariants (per launched row, latest scan_date)
-----------------------------------------------
  1. Components sum to score:
       insider_pts + sma200_pts + rsi_pts + dark_pool_pts + options_pts
       == score   (capped at 10; tolerance 0.05 for rounding)
     This is exactly what the Scanner table + drill-down display claims, so a
     break here means the on-screen breakdown no longer reconciles.
  2. Score is in range [0, 10].
  3. Trade plan is ordered for a long: stop < entry <= target.
  4. Price is positive.

Run
---
  python scripts/check_scan_invariants.py        # exit 1 on any violation
  python scripts/check_scan_invariants.py --list  # report all, never fail

Wired into .github/workflows/SCAN-INVARIANTS-DAILY.yml (after the scan runs)
and runnable on demand. Reads the public scan table with the publishable
(anon) key — the same key shipped in the browser bundle, safe by design.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

# Public by design — the publishable key is the one shipped to every browser;
# RLS protects the data. Overridable by env for rotation.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://yqaqqzseepebrocgibcw.supabase.co")
SUPABASE_KEY = os.environ.get(
    "SUPABASE_ANON_KEY",
    "sb_publishable__q_l32rEdPZlC4Bxs6dFnA__NqouiGk",
)

SUM_TOLERANCE = 0.05
COMPONENT_FIELDS = ["insider_pts", "sma200_pts", "rsi_pts", "dark_pool_pts", "options_pts"]


def _get(path):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_latest_scan():
    latest = _get("trading_opps_signals?select=scan_date&order=scan_date.desc&limit=1")
    if not latest:
        return None, []
    scan_date = latest[0]["scan_date"]
    cols = ",".join(["ticker", "score", "price", "entry", "stop", "target", "direction"] + COMPONENT_FIELDS)
    rows = _get(f"trading_opps_signals?select={cols}&scan_date=eq.{scan_date}")
    return scan_date, rows


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def check_row(r):
    """Return a list of invariant violations for one row."""
    out = []
    score = num(r.get("score"))
    if score is None:
        return [f"score is null/non-numeric ({r.get('score')!r})"]

    # 1. components sum to score (capped at 10)
    comp = sum((num(r.get(f)) or 0.0) for f in COMPONENT_FIELDS)
    expected = min(10.0, comp)
    if abs(score - expected) > SUM_TOLERANCE:
        parts = ", ".join(f"{f}={r.get(f)}" for f in COMPONENT_FIELDS)
        out.append(f"components don't sum to score: sum={comp:.2f} (capped {expected:.2f}) vs score={score:.2f}  [{parts}]")

    # 2. score range
    if not (0.0 <= score <= 10.0):
        out.append(f"score out of range [0,10]: {score}")

    # 3. trade plan ordering (long)
    price, entry, stop, target = (num(r.get(k)) for k in ("price", "entry", "stop", "target"))
    if None not in (stop, entry, target):
        if not (stop < entry <= target):
            out.append(f"trade plan not ordered (stop<entry<=target): stop={stop} entry={entry} target={target}")

    # 4. positive price
    if price is not None and price <= 0:
        out.append(f"non-positive price: {price}")

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="report all violations without failing")
    args = ap.parse_args()

    try:
        scan_date, rows = fetch_latest_scan()
    except Exception as e:
        print(f"✗ could not read scan data: {e}")
        return 1

    if not rows:
        print("✗ no scan rows found — nothing to validate (treated as failure)")
        return 1

    violations = []
    for r in rows:
        for v in check_row(r):
            violations.append((r.get("ticker", "?"), v))

    print(f"Checked {len(rows)} rows from scan_date {scan_date}.")
    if not violations:
        print("✓ All scan invariants hold (components sum to score, score in range, trade plan ordered, price positive).")
        return 0

    print(f"\n✗ {len(violations)} invariant violation(s):")
    for ticker, v in violations:
        print(f"   {ticker}: {v}")
    return 0 if args.list else 1


if __name__ == "__main__":
    sys.exit(main())
