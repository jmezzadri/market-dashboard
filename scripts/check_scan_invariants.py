#!/usr/bin/env python3
"""Value-correctness invariants for the live Trading-Opportunities scan.

Why this exists
---------------
The fake-data guard (check_no_synthetic_data.py) stops fabricated values, and
the render gate (smoke_render.mjs) stops broken/blank pages. Neither catches a
value that is wired to a real field but COMPUTED WRONG — a plausible-looking
number that's actually off. This check enforces the invariants the UI relies
on, against the real data in public.trading_opps_signals.

The score formula is VERSIONED — read SCORING_MODELS below
----------------------------------------------------------
2026-08-19 (health sweep). This gate went red on 2026-08-18 against KURA:
`components don't sum to score: sum=6.00 vs score=3.00
 [insider_pts=4.0, sma200_pts=1, rsi_pts=-2, dark_pool_pts=0, options_pts=3]`
and the DATA WAS CORRECT. The gate was wrong.

Written 2026-06-01, it hardcoded the five-component formula of the day. On
2026-07-07 the Conviction-Insider rebuild SHELVED dark-pool and options from
the score (unvalidated — only weeks of history); they still arrive on the row
as INFORMATIONAL columns, exactly like short interest and options flow, and
`src/overhaul/lib/scoreWeights.js` — the single source of truth the drill-down
renders from — has said so since. The gate was never updated, and it kept
passing only because those two columns are 0 on a typical day. The first row
with a non-zero informational `options_pts` reddened a healthy pipeline.

That is LESSONS 4.25 rule 1 ("when you move a capability out of a pipeline,
remove the capability — do not leave it armed") pointed at a GUARD rather than
a producer, and 4.28 rule 5 (a change to a shared contract must be verified
against every consumer of it).

So the formula is no longer hardcoded. It is selected from the row's own
`scoring_version` — the field the engine already stamps for exactly this
purpose — and an UNKNOWN version is a hard failure with a named remedy. A new
scorer can no longer ship against a stale gate in silence: the gate says so.

Invariants (per row, latest scan_date)
--------------------------------------
  1. The SCORED components sum to score, per the row's scoring_version
     (tolerance 0.05 for rounding). Components outside that version's model
     are informational context and are deliberately NOT summed.
  2. Score is in range [0, cap] for that version.
  3. Trade plan is ordered for a long: stop < entry <= target.
  4. Price is positive.
  5. Every row's scoring_version is one this gate knows about.

Run
---
  python scripts/check_scan_invariants.py        # exit 1 on any violation
  python scripts/check_scan_invariants.py --list  # report all, never fail

Wired into .github/workflows/SCAN-INVARIANTS-DAILY.yml (after the scan lands)
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

# Every point column that can appear on a row. Used to report the ones a given
# model treats as informational, so a violation message shows the whole picture
# rather than half of it.
ALL_POINT_FIELDS = ["insider_pts", "sma200_pts", "rsi_pts", "dark_pool_pts", "options_pts"]

# scoring_version -> (fields that are SUMMED into the score, score cap).
#
# Keep this in step with two places, and only these two:
#   trading-scanner/scanner/trading_opps/run_screener.py   (computes the score)
#   src/overhaul/lib/scoreWeights.js                       (renders the breakdown)
# If those two and this disagree, the site shows a breakdown that does not add
# up to the number beside it — which is the entire failure this gate exists to
# catch.
SCORING_MODELS = {
    # 2026-07-07 Conviction-Insider rebuild: dark-pool + options shelved from
    # the score as unvalidated; they remain on the row as context. Ceiling
    # dropped from 10 to 5 when they came out.
    "2026-07-07-conviction-insider": (["insider_pts", "sma200_pts", "rsi_pts"], 5.0),
    # The original five-component scorer, 2026-05-19 .. 2026-07-06. Retained so
    # `--list` can still audit history honestly rather than reporting every old
    # row as broken.
    "2026-05-21-darkpool-options": (ALL_POINT_FIELDS, 10.0),
}


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
    cols = ",".join(
        ["ticker", "score", "price", "entry", "stop", "target", "direction", "scoring_version"]
        + ALL_POINT_FIELDS
    )
    rows = _get(f"trading_opps_signals?select={cols}&scan_date=eq.{scan_date}")
    return scan_date, rows


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def check_row(r):
    """Return a list of invariant violations for one row."""
    # 5. the gate must know which formula produced this row. An unknown version
    #    means the scorer moved and this file did not — say so by name rather
    #    than enforce a formula that no longer applies.
    version = r.get("scoring_version")
    model = SCORING_MODELS.get(version)
    if model is None:
        return [
            f"unknown scoring_version {version!r} — the scorer changed and this gate did not. "
            f"Add it to SCORING_MODELS in scripts/check_scan_invariants.py "
            f"(known: {', '.join(sorted(SCORING_MODELS))})"
        ]
    scored_fields, cap = model

    out = []
    score = num(r.get("score"))
    if score is None:
        return [f"score is null/non-numeric ({r.get('score')!r})"]

    # 1. the SCORED components sum to score (capped)
    comp = sum((num(r.get(f)) or 0.0) for f in scored_fields)
    expected = min(cap, comp)
    if abs(score - expected) > SUM_TOLERANCE:
        informational = [f for f in ALL_POINT_FIELDS if f not in scored_fields]
        parts = ", ".join(f"{f}={r.get(f)}" for f in scored_fields)
        extra = ", ".join(f"{f}={r.get(f)}" for f in informational)
        msg = (f"scored components don't sum to score [{version}]: sum={comp:.2f} "
               f"(capped {expected:.2f}) vs score={score:.2f}  [{parts}]")
        if extra:
            msg += f"  (informational, not scored: {extra})"
        out.append(msg)

    # 2. score range
    if not (0.0 <= score <= cap):
        out.append(f"score out of range [0,{cap:g}] for {version}: {score}")

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

    versions = sorted({str(r.get("scoring_version")) for r in rows})
    print(f"Checked {len(rows)} rows from scan_date {scan_date} "
          f"(scoring_version: {', '.join(versions)}).")
    if not violations:
        print("✓ All scan invariants hold (scored components sum to score, score in range, "
              "trade plan ordered, price positive).")
        return 0

    print(f"\n✗ {len(violations)} invariant violation(s):")
    for ticker, v in violations:
        print(f"   {ticker}: {v}")
    return 0 if args.list else 1


if __name__ == "__main__":
    sys.exit(main())
