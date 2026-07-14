#!/usr/bin/env python3
"""update_momentum_guard.py — daily Momentum sleeve crash-guard refresh.

Element: market-momentum_guard-daily. Runs as a step inside
DIVERGENCE_SCAN_DAILY.yml (after the panel-complete morning ingest — same
timing need, same credentials; schedule-normalization sign-off recorded in
data_manifest.json). The list is monthly but the cash/invested flag must
never be a month stale (spec, 2026-07-14).

Cheap by design: one RPC for 200 SPY closes, one upsert. Uses the same
guard rule as the monthly publisher (momentum_rules.guard_invested).
Stamps pipeline_health.momentum_guard green on success, red on failure.
"""

import json
import os
import sys
from datetime import date

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compute_divergences import rpc, _env, _headers  # noqa: E402
from momentum_rules import guard_invested            # noqa: E402

SMA_GUARD = 200


def stamp(status, data_as_of=None, error=None):
    os.system(f'python3 {os.path.dirname(os.path.abspath(__file__))}/upsert_pipeline_health.py '
              f'momentum_guard {data_as_of or "-"} {status} "{(error or "")[:300]}"')


def main():
    spy = rpc("momentum_spy_closes", {"p_as_of": str(date.today()), "p_n": SMA_GUARD})
    if not isinstance(spy, list) or len(spy) != SMA_GUARD:
        msg = f"guard input incomplete: {len(spy) if isinstance(spy, list) else spy} SPY closes (need {SMA_GUARD})"
        print(f"FATAL: {msg}", file=sys.stderr)
        stamp("red", None, msg)
        sys.exit(1)
    as_of = spy[-1]["trade_date"]
    closes = [float(r["close"]) for r in spy]
    invested = guard_invested(closes)
    sma = sum(closes) / len(closes)

    url, key = _env()
    h = _headers(key)
    prev = requests.get(f"{url}/rest/v1/momentum_guard?select=as_of,invested&as_of=lt.{as_of}&order=as_of.desc&limit=1",
                        headers=h, timeout=60).json()
    flipped = bool(prev) and prev[0]["invested"] != invested
    r = requests.post(f"{url}/rest/v1/momentum_guard",
                      headers=_headers(key, {"Prefer": "resolution=merge-duplicates"}),
                      data=json.dumps([{"as_of": as_of, "spy_close": closes[-1],
                                        "sma_200": round(sma, 4), "invested": invested,
                                        "flipped": flipped}]), timeout=60)
    if r.status_code >= 300:
        msg = f"guard upsert failed: HTTP {r.status_code} {r.text[:200]}"
        print(f"FATAL: {msg}", file=sys.stderr)
        stamp("red", None, msg)
        sys.exit(1)
    stamp("green", as_of)
    print(f"guard {as_of}: SPY {closes[-1]:.2f} vs 200-day {sma:.2f} -> "
          f"{'INVESTED' if invested else 'IN CASH'}{' (FLIP)' if flipped else ''}")


if __name__ == "__main__":
    main()
