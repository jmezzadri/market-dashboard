#!/usr/bin/env python3
"""adjust_splits_retroactive.py — keep prices_eod on one share basis across splits.

Bug (2026-07-20, LESSONS 4.20): the daily ingest writes each day's close at
that day's share basis and never re-adjusts history, so a split leaves a seam
in the stored series (CRWD 4:1 on 2026-07-01: 763.14 -> 193.185 overnight,
which return math reads as a fake -75% crash). This corrupted every return
window crossing a seam — Power Trend ROC, 12-1 momentum, RSI inputs.

Doctrine: the whole stored series for a ticker sits on the CURRENT post-split
basis. This script runs inside MASSIVE-DAILY after the day's ingest:

  1. Pull splits with execution_date in the last SPLIT_ADJUST_DAYS days
     (default 10) from public.splits.
  2. For each, scan the stored closes +/- 6 trading rows around the execution
     date for the seam: the day whose close/prev_close ratio matches the
     split's price factor (split_from/split_to) within TOLERANCE (15% —
     the residual is the stock's real move that day).
  3. Seam found -> RPC apply_split_adjustment(ticker, seam_date, factor):
     all rows BEFORE the seam get price*factor, volume/factor.
  4. No seam but a single-day inverse-then-forward pair (one row on the
     wrong basis between two good ones, e.g. HON 2026-06-26) -> RPC
     apply_split_adjustment_day for that row only.
  5. Idempotent: once adjusted the seam is gone, so re-runs no-op.

Fail-loud: a split whose expected seam is neither found nor already
adjusted is printed as UNRESOLVED and exits 1 so the workflow shows red.

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional SPLIT_ADJUST_DAYS.
"""
import math
import os
import sys
from datetime import date, timedelta

import requests

TOLERANCE = 0.15          # |log(observed/expected)| tolerance for seam match
WINDOW_ROWS = 6           # trading rows scanned either side of execution date


def env(k, default=None):
    v = os.environ.get(k, default)
    if v is None:
        sys.exit(f"missing env {k}")
    return v


def rest(url, key, path, params):
    r = requests.get(f"{url}/rest/v1/{path}", params=params,
                     headers={"apikey": key, "Authorization": f"Bearer {key}"},
                     timeout=60)
    r.raise_for_status()
    return r.json()


def rpc(url, key, fn, payload):
    r = requests.post(f"{url}/rest/v1/rpc/{fn}", json=payload,
                      headers={"apikey": key, "Authorization": f"Bearer {key}"},
                      timeout=120)
    r.raise_for_status()
    return r.json()


def close_ratio_matches(observed, expected):
    if observed <= 0 or expected <= 0:
        return False
    return abs(math.log(observed / expected)) <= TOLERANCE


def main():
    url = env("SUPABASE_URL").rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    lookback = int(env("SPLIT_ADJUST_DAYS", "10"))
    since = (date.today() - timedelta(days=lookback)).isoformat()
    today = date.today().isoformat()

    splits = rest(url, key, "splits", {
        "select": "ticker,execution_date,split_from,split_to",
        "execution_date": [f"gte.{since}", f"lte.{today}"],
        "order": "execution_date.asc",
    })
    print(f"splits executed since {since}: {len(splits)}")

    unresolved = []
    for s in splits:
        tkr = s["ticker"]
        exec_d = s["execution_date"]
        try:
            factor = float(s["split_from"]) / float(s["split_to"])
        except (TypeError, ValueError, ZeroDivisionError):
            print(f"  {tkr} {exec_d}: unusable ratio {s}")
            continue
        if abs(factor - 1.0) < 1e-9:
            continue

        lo = (date.fromisoformat(exec_d) - timedelta(days=WINDOW_ROWS * 2)).isoformat()
        hi = (date.fromisoformat(exec_d) + timedelta(days=WINDOW_ROWS * 2)).isoformat()
        rows = rest(url, key, "prices_eod", {
            "select": "trade_date,close",
            "ticker": f"eq.{tkr}",
            "trade_date": [f"gte.{lo}", f"lte.{hi}"],
            "order": "trade_date.asc",
        })
        if len(rows) < 2:
            print(f"  {tkr} {exec_d}: <2 stored rows near seam — nothing to adjust")
            continue

        ratios = []  # (this_date, close/prev_close)
        for a, b in zip(rows, rows[1:]):
            pc, cc = float(a["close"] or 0), float(b["close"] or 0)
            if pc > 0 and cc > 0:
                ratios.append((b["trade_date"], cc / pc))

        seam = next((d for d, r in ratios if close_ratio_matches(r, factor)), None)
        if seam:
            n = rpc(url, key, "apply_split_adjustment",
                    {"p_ticker": tkr, "p_seam": seam, "p_factor": factor})
            print(f"  {tkr} {exec_d}: seam {seam}, factor {factor:g} -> {n} rows re-based")
            continue

        # single bad day: prev ratio ~ 1/factor immediately followed by ~ factor
        one_day = next((d1 for (d1, r1), (_d2, r2) in zip(ratios, ratios[1:])
                        if close_ratio_matches(r1, 1.0 / factor)
                        and close_ratio_matches(r2, factor)), None)
        if one_day:
            n = rpc(url, key, "apply_split_adjustment_day",
                    {"p_ticker": tkr, "p_day": one_day, "p_factor": factor})
            print(f"  {tkr} {exec_d}: single wrong-basis day {one_day}, "
                  f"factor {factor:g} -> {n} row re-based")
            continue

        if not any(r < 0.6 or r > 1.7 for _d, r in ratios):
            print(f"  {tkr} {exec_d}: no seam — already adjusted, ok")
        else:
            unresolved.append((tkr, exec_d, factor))
            print(f"  {tkr} {exec_d}: UNRESOLVED — gap present but does not "
                  f"match factor {factor:g}; inspect manually")

    if unresolved:
        print(f"UNRESOLVED splits: {unresolved}")
        sys.exit(1)
    print("split retro-adjustment pass complete")


if __name__ == "__main__":
    main()
