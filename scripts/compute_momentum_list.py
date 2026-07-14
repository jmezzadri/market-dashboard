#!/usr/bin/env python3
"""compute_momentum_list.py — monthly Momentum sleeve list publisher.

Pipeline: equity-momentum_list-monthly (MOMENTUM-LIST-MONTHLY.yml).
Spec: MOMENTUM_SLEEVE_BUILD_SPEC.md (approved 2026-07-14). Rule set is the
cleared 22-year backtest's MOM/MOMG strategy, verbatim (scripts/
backtest_strategies.py, Strategy_Backtest_2026-07-14.xlsx):

  * Universe: strategy_bt_universe(rebalance_date) — liquid US common stocks
    (CS + active, close >= $2, 45-day ADV $50M..$40B, >= 40/45 days present).
  * Signal: 12-1 momentum — total return from t-252 to t-21 trading days on
    the panel-complete calendar (skip the latest month; Jegadeesh & Titman
    1993). Rank descending; own the top quintile clamped to 20-50 names.
  * Crash guard: SPY close vs its 200-day simple average at the rebalance
    day (Faber 2007). guard_exposed = SPY >= average (same for all rows).
  * insider_badge: >= 1 officer/director open-market buyer in the trailing
    90 days, filing-date basis, 10b5-1 excluded — DISPLAY INFO ONLY, does
    not affect the list (the intersection test failed; sleeves stay separate).

Rebalance day: the PRIOR month's last panel-complete day (this job runs the
1st at 06:00 ET; the month just ended supplies the ranks).

Writes public.momentum_list — append-only across rebalance_dates,
delete+rewrite within one (idempotent). Also upserts the day's
public.momentum_guard row so guard state is consistent with the publish.

Fail-loud gates (any failure red-stamps pipeline_health.momentum_list and
publishes nothing):
  * universe >= 800 names
  * final list within the 20-50 clamp
  * exactly 200 SPY closes for the guard input
  * post-write verification: row count read back == rows written

Paging: SQL p_limit/p_offset everywhere (LESSONS 4.18); the calendar/
universe/insider RPCs are the paged migration-078 helpers. Ticker-chunked
GETs stay < 1000 rows per call by construction.
"""

import json
import os
import sys
import time
from datetime import date, timedelta

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compute_divergences import rpc, rpc_paged, _env, _headers  # noqa: E402
from momentum_rules import pick_rebalance_day, momentum_ranks, quintile_clamp, guard_invested  # noqa: E402

TABLE        = "momentum_list"
MIN_UNIVERSE = 800
N_MIN, N_MAX = 20, 50
MOM_LB, MOM_SKIP = 252, 21
SMA_GUARD    = 200
INS_WINDOW   = 90
CHUNK_BARS   = 50
CHUNK_INSERT = 200


def stamp(status, data_as_of=None, error=None):
    os.system(f'python3 {os.path.dirname(os.path.abspath(__file__))}/upsert_pipeline_health.py '
              f'momentum_list {data_as_of or "-"} {status} "{(error or "")[:300]}"')


def fail_red(msg, t0):
    print(f"FATAL: {msg} ({time.time()-t0:.0f}s)", file=sys.stderr)
    stamp("red", None, msg)
    sys.exit(1)


def first_of_next_month(d):
    return (d.replace(day=1) + timedelta(days=32)).replace(day=1)


def main():
    t0 = time.time()
    dry = os.environ.get("DRY_RUN", "false").lower() == "true"
    today = date.today()

    # 1) calendar of panel-complete days (need MOM_LB+ history)
    cal_rows = rpc_paged("strategy_bt_calendar",
                         {"p_start": str(today - timedelta(days=650)), "p_end": str(today)})
    cal = [date.fromisoformat(r["trade_date"]) for r in cal_rows]
    if len(cal) < MOM_LB + 5:
        fail_red(f"calendar too short: {len(cal)} eligible days (< {MOM_LB + 5})", t0)

    rebal = pick_rebalance_day(cal, today)
    if rebal is None:
        fail_red("no prior-month panel-complete day found", t0)
    print(f"rebalance_date {rebal} (calendar {cal[0]}..{cal[-1]}, {len(cal)} days)")

    # 2) universe gate
    universe = rpc_paged("strategy_bt_universe", {"p_scan_date": str(rebal)})
    if len(universe) < MIN_UNIVERSE:
        fail_red(f"universe too small: {len(universe)} names (< {MIN_UNIVERSE})", t0)
    adv = {r["ticker"]: r["adv_usd"] for r in universe}
    tickers = sorted(adv)
    print(f"universe: {len(tickers)} names")

    # 3) bars aligned to the eligible-day calendar; 12-1 momentum
    idx = {d: i for i, d in enumerate(cal)}
    ri = idx[rebal]
    if ri < MOM_LB:
        fail_red(f"rebalance day lacks {MOM_LB}-day lookback on eligible calendar", t0)
    start, end = cal[ri - MOM_LB], rebal
    closes = {}
    for i in range(0, len(tickers), CHUNK_BARS):
        chunk = tickers[i:i + CHUNK_BARS]
        for row in rpc("strategy_bt_bars",
                       {"p_start": str(start), "p_end": str(end), "p_tickers": chunk}):
            m = {date.fromisoformat(d): c for d, c in zip(row["dates"], row["closes"])}
            closes[row["ticker"]] = [m.get(cal[k]) for k in range(ri - MOM_LB, ri + 1)]
    ranks = momentum_ranks(closes, MOM_LB, MOM_SKIP)   # [(ticker, ret_12_1)] desc
    n_hold = quintile_clamp(len(tickers), N_MIN, N_MAX)
    picks = ranks[:n_hold]
    if not (N_MIN <= len(picks) <= N_MAX):
        fail_red(f"list size {len(picks)} outside clamp {N_MIN}-{N_MAX}", t0)
    print(f"ranked {len(ranks)} names; holding top {len(picks)}")

    # 4) guard input
    spy = rpc("momentum_spy_closes", {"p_as_of": str(rebal), "p_n": SMA_GUARD})
    if not isinstance(spy, list) or len(spy) != SMA_GUARD:
        fail_red(f"guard input incomplete: {len(spy) if isinstance(spy, list) else spy} SPY closes (need {SMA_GUARD})", t0)
    spy_closes = [float(r["close"]) for r in spy]
    invested = guard_invested(spy_closes)
    sma = sum(spy_closes) / len(spy_closes)
    print(f"guard: SPY {spy_closes[-1]:.2f} vs 200-day {sma:.2f} -> {'INVESTED' if invested else 'IN CASH'}")

    # 5) insider badge (display only)
    buys = rpc_paged("strategy_bt_insider_buys", {})
    lo = rebal - timedelta(days=INS_WINDOW)
    badge = {b["ticker"] for b in buys
             if lo < date.fromisoformat(b["filing_date"]) <= rebal}

    # 6) names
    url, key = _env()
    h = _headers(key)
    names = {}
    pick_ts = [t for t, _ in picks]
    for i in range(0, len(pick_ts), 100):
        q = ",".join(f'"{t}"' for t in pick_ts[i:i + 100])
        rg = requests.get(f"{url}/rest/v1/universe_master?select=ticker,name&ticker=in.({q})",
                          headers=h, timeout=60)
        if rg.status_code < 300:
            names.update({r["ticker"]: r.get("name") for r in rg.json()})

    nxt = first_of_next_month(today if today.day > 1 else rebal)
    out_rows = [{
        "rebalance_date": str(rebal), "rank": k + 1, "ticker": t,
        "name": names.get(t), "ret_12_1": round(ret, 6),
        "adv_usd": adv.get(t), "guard_exposed": invested,
        "insider_badge": t in badge, "next_rebalance_date": str(nxt),
    } for k, (t, ret) in enumerate(picks)]

    if dry:
        print(json.dumps(out_rows[:5], indent=1))
        print(f"DRY RUN: computed {len(out_rows)} rows for {rebal}; nothing written")
        return

    # 7) publish (idempotent within rebalance_date: delete then insert)
    rdel = requests.delete(f"{url}/rest/v1/{TABLE}?rebalance_date=eq.{rebal}", headers=h, timeout=120)
    if rdel.status_code >= 300:
        fail_red(f"delete of prior {rebal} rows failed: HTTP {rdel.status_code} {rdel.text[:200]}", t0)
    for i in range(0, len(out_rows), CHUNK_INSERT):
        chunk = out_rows[i:i + CHUNK_INSERT]
        rins = requests.post(f"{url}/rest/v1/{TABLE}", headers=h, data=json.dumps(chunk), timeout=120)
        if rins.status_code >= 300:
            requests.delete(f"{url}/rest/v1/{TABLE}?rebalance_date=eq.{rebal}", headers=h, timeout=120)
            fail_red(f"insert failed (HTTP {rins.status_code}: {rins.text[:200]}) — rows cleaned up, nothing published", t0)

    rv = requests.get(f"{url}/rest/v1/{TABLE}?rebalance_date=eq.{rebal}&select=ticker",
                      headers=_headers(key, {"Prefer": "count=exact", "Range": "0-0"}), timeout=60)
    got = int(rv.headers.get("Content-Range", "/0").split("/")[-1])
    if got != len(out_rows):
        fail_red(f"post-write verification mismatch: wrote {len(out_rows)}, table shows {got}", t0)

    # 8) guard row for the same day (upsert; keeps guard consistent with publish)
    prev = requests.get(f"{url}/rest/v1/momentum_guard?select=as_of,invested&as_of=lt.{rebal}&order=as_of.desc&limit=1",
                        headers=h, timeout=60).json()
    flipped = bool(prev) and prev[0]["invested"] != invested
    requests.post(f"{url}/rest/v1/momentum_guard",
                  headers=_headers(key, {"Prefer": "resolution=merge-duplicates"}),
                  data=json.dumps([{"as_of": str(rebal), "spy_close": spy_closes[-1],
                                    "sma_200": round(sma, 4), "invested": invested,
                                    "flipped": flipped}]), timeout=60)

    stamp("green", str(rebal))
    print(f"published {len(out_rows)} rows for {rebal}; guard {'INVESTED' if invested else 'IN CASH'}; "
          f"next re-rank {nxt}; {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
