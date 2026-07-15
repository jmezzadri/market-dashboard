#!/usr/bin/env python3
"""compute_power_trend_list.py — monthly Power Trend sleeve list publisher.

Pipeline: equity-power_trend_list-monthly (POWER-TREND-LIST-MONTHLY.yml).
Replaces the retired 12-1 momentum list (compute_momentum_list.py) and the
Faber crash guard: the Power Trend signal has no separate guard — a month
where nothing fires publishes a single CASH sentinel row and the paper
engine reads a CASH-only list as all-cash.

Signal: public.power_trend_scan (migration 081 — validated SQL, the math
lives server-side and is NOT re-derived here):
  * Universe: liquid US common stock via strategy_bt_universe (close >= $2,
    45-day ADV $50M-$40B) on the latest prices_eod day.
  * 3-mo ROC = 63 trading days; top-20% cross-sectional.
  * RS gate: >= 5 percentage points vs SPY over the same window.
  * Breakout: new 10-day closing high on > 1.3x 20-day avg volume.
  * Trend: close above the 10/21/50/200 EMAs (truncated weighted-sum EMAs,
    <= 720 rows, >= 250 required). roc_3m / rs_vs_spx come back in percent
    points; adv_usd is in DOLLARS (close * 20-day avg volume).

Sleeve construction (scripts/power_trend_rules.py, unit-tested):
  * cap_top15 — hold at most the 15 highest-ROC names (ticker-asc tiebreak);
    rank 1..N by roc_3m desc.
  * per-name sizing (engine-side): capital / max(n, 8) — the min-8
    diversification floor; unfilled slots stay in cash.

rebalance_date = the scan's panel date (max prices_eod trade_date).
next_rebalance_date = 1st of the following month.

Writes public.power_trend_list — append-only across rebalance_dates,
delete+rewrite within one (idempotent re-publish within a date).

Fail-loud gates (LESSON 4.5: never publish partial; any failure red-stamps
pipeline_health.power_trend_list and publishes nothing):
  * scan result is a list, < 900 rows (PostgREST silently truncates at
    1000 — LESSONS 4.18 — so a near-cap response means a truncated read)
    and <= 200 rows (a wider result is a signal-regime anomaly: stop)
  * every scan row's panel_date == max prices_eod trade_date
  * universe >= 800 names on the panel date (paged strategy_bt_universe,
    the same SQL p_limit/p_offset pattern as compute_momentum_list used)
  * post-write verification: row count read back == rows written
"""

import json
import os
import sys
import time
from datetime import date

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compute_divergences import rpc, rpc_paged, _env, _headers  # noqa: E402
from power_trend_rules import cap_top15, next_first_of_month     # noqa: E402

TABLE            = "power_trend_list"
INDICATOR        = "power_trend_list"
MIN_UNIVERSE     = 800
MAX_SCAN_ROWS    = 200   # sane upper bound for names clearing every gate
TRUNCATION_GUARD = 900   # PostgREST caps at 1000; near-cap = truncated read


def stamp(status, data_as_of=None, error=None):
    os.system(f'python3 {os.path.dirname(os.path.abspath(__file__))}/upsert_pipeline_health.py '
              f'{INDICATOR} {data_as_of or "-"} {status} "{(error or "")[:300]}"')


def fail_red(msg, t0):
    print(f"FATAL: {msg} ({time.time()-t0:.0f}s)", file=sys.stderr)
    stamp("red", None, msg)
    sys.exit(1)


def main():
    t0 = time.time()
    dry = os.environ.get("DRY_RUN", "false").lower() == "true"
    url, key = _env()
    h = _headers(key)

    # 1) panel date = max prices_eod trade_date (the scan's own d0)
    rp = requests.get(f"{url}/rest/v1/prices_eod?select=trade_date&order=trade_date.desc&limit=1",
                      headers=h, timeout=60)
    if rp.status_code >= 300 or not rp.json():
        fail_red(f"could not resolve panel date: HTTP {rp.status_code} {rp.text[:200]}", t0)
    rebal = date.fromisoformat(rp.json()[0]["trade_date"])
    print(f"panel date (rebalance_date) {rebal}")

    # 2) run the scan
    rows = rpc("power_trend_scan", {})
    if not isinstance(rows, list):
        fail_red(f"power_trend_scan returned non-list: {type(rows)}", t0)
    if len(rows) >= TRUNCATION_GUARD:
        fail_red(f"scan returned {len(rows)} rows (>= {TRUNCATION_GUARD}) — possible "
                 "PostgREST 1000-row truncation (LESSONS 4.18); refusing to publish", t0)
    if len(rows) > MAX_SCAN_ROWS:
        fail_red(f"scan returned {len(rows)} rows (> {MAX_SCAN_ROWS} sanity cap)", t0)
    pds = {r["panel_date"] for r in rows}
    if rows and (len(pds) != 1 or date.fromisoformat(next(iter(pds))) != rebal):
        fail_red(f"scan panel_date inconsistent with prices_eod max: {sorted(pds)} vs {rebal}", t0)
    print(f"scan: {len(rows)} names cleared every gate")

    # 3) universe sanity gate — same paged pattern the old producer used
    universe = rpc_paged("strategy_bt_universe", {"p_scan_date": str(rebal)})
    if len(universe) < MIN_UNIVERSE:
        fail_red(f"universe too small: {len(universe)} names (< {MIN_UNIVERSE})", t0)
    print(f"universe: {len(universe)} names on {rebal}")

    # 4) cap to 15, rank 1..N by roc_3m desc (cap_top15 output is pre-sorted)
    picks = cap_top15(rows)
    nxt = next_first_of_month(rebal)

    # 5) company names (trivial lookup carried over from compute_momentum_list)
    names = {}
    if picks:
        q = ",".join(f'"{r["ticker"]}"' for r in picks)
        rg = requests.get(f"{url}/rest/v1/universe_master?select=ticker,name&ticker=in.({q})",
                          headers=h, timeout=60)
        if rg.status_code < 300:
            names.update({r["ticker"]: r.get("name") for r in rg.json()})

    if picks:
        out_rows = [{
            "rebalance_date": str(rebal), "rank": k + 1, "ticker": r["ticker"],
            "name": names.get(r["ticker"]), "roc_3m": r["roc_3m"],
            "rs_vs_spx": r["rs_vs_spx"], "breakout_volx": r.get("breakout_volx"),
            "adv_usd": r.get("adv_usd"), "close": r.get("close"),
            "next_rebalance_date": str(nxt),
        } for k, r in enumerate(picks)]
    else:
        # ZERO names fired: publish a single CASH sentinel row (rank=0).
        # The paper engine reads a CASH-only list as an all-cash month —
        # publishing nothing would instead read as "producer never ran"
        # and leave the engine trading a stale list.
        out_rows = [{
            "rebalance_date": str(rebal), "rank": 0, "ticker": "CASH",
            "name": None, "roc_3m": 0, "rs_vs_spx": 0,
            "breakout_volx": None, "adv_usd": None, "close": None,
            "next_rebalance_date": str(nxt),
        }]
        print("zero names fired — publishing the CASH sentinel (all-cash month)")

    if dry:
        print(json.dumps(out_rows[:5], indent=1))
        print(f"DRY RUN: computed {len(out_rows)} rows for {rebal}; nothing written")
        return

    # 6) publish (idempotent within rebalance_date: delete then insert)
    rdel = requests.delete(f"{url}/rest/v1/{TABLE}?rebalance_date=eq.{rebal}", headers=h, timeout=120)
    if rdel.status_code >= 300:
        fail_red(f"delete of prior {rebal} rows failed: HTTP {rdel.status_code} {rdel.text[:200]}", t0)
    rins = requests.post(f"{url}/rest/v1/{TABLE}", headers=h, data=json.dumps(out_rows), timeout=120)
    if rins.status_code >= 300:
        requests.delete(f"{url}/rest/v1/{TABLE}?rebalance_date=eq.{rebal}", headers=h, timeout=120)
        fail_red(f"insert failed (HTTP {rins.status_code}: {rins.text[:200]}) — "
                 "rows cleaned up, nothing published", t0)

    rv = requests.get(f"{url}/rest/v1/{TABLE}?rebalance_date=eq.{rebal}&select=ticker",
                      headers=_headers(key, {"Prefer": "count=exact", "Range": "0-0"}), timeout=60)
    got = int(rv.headers.get("Content-Range", "/0").split("/")[-1])
    if got != len(out_rows):
        fail_red(f"post-write verification mismatch: wrote {len(out_rows)}, table shows {got}", t0)

    stamp("green", str(rebal))
    label = "CASH sentinel" if out_rows[0]["ticker"] == "CASH" else f"{len(out_rows)} names"
    print(f"published {label} for {rebal}; next rebalance {nxt}; {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
