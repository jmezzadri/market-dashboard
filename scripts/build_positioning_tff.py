#!/usr/bin/env python3
"""Hedge-fund vs real-money positioning — builds public/positioning_tff.json.

WHY THIS EXISTS
---------------
Joe, 2026-08-14: "I really think positioning is a huge market tell... Weekly COT
positioning on S&P Futures, NASDAQ, etc. Coupled with Goldman Sachs Prime
Brokerage positioning data."

Goldman's Prime Services positioning work is distributed to their prime
brokerage clients under contract. There is no API and it is not licensable, so
the site will never carry it and no proxy should be dressed up as it.

The CFTC's **Traders in Financial Futures** report is the public instrument that
answers the same question, and it is materially better than what MacroTilt was
already using. The legacy Commitments of Traders split — "commercial" versus
"non-commercial" — lumps hedge funds together with pension funds, insurers and
index managers under one "speculator" heading. TFF breaks that apart into:

    Leveraged Funds   hedge funds, CTAs, the fast money
    Asset Managers    pensions, insurers, mutual funds — real money
    Dealers           the sell side, largely hedging its own book

The difference is not cosmetic. On the E-mini S&P 500 for the week of
2026-08-04, the legacy report shows one blended speculative figure of −1.3% of
open interest sitting at the 80th percentile of three years, which reads as
"nothing much". The TFF split shows what is actually happening underneath:

    Hedge funds     net SHORT  15.6% of open interest
    Asset managers  net LONG   43.9% of open interest

Real money is heavily long, fast money is short, and they have been on opposite
sides for a month. A blended number cannot see that, and a blended number is
what every previous MacroTilt note was reading.

WHAT THIS PRODUCES
------------------
For each market, per trader class: net position as a share of open interest, its
percentile against the FULL available history (TFF starts 2010, so this is a
far longer base rate than the three-year window the legacy COT feed uses), the
week-over-week change, and a trimmed history for charting.

It also flags the thing worth looking at: markets where hedge funds and asset
managers are positioned on OPPOSITE sides, both at an extreme. That is the tell.

BASE RATES, NOT ADJECTIVES
--------------------------
Percentiles are computed over every week the CFTC has published, not over a
convenient window. LESSONS 4.33: a conditional reading means nothing without the
unconditional one, and a short window is how a coincidence gets published.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"
OUT_PATH = "public/positioning_tff.json"
HISTORY_START = "2010-01-01"     # TFF begins mid-2010
HISTORY_KEEP_YEARS = 5           # trimmed for the file; percentiles use everything
EXTREME_HI, EXTREME_LO = 85, 15  # percentile bands that count as "at an extreme"

# The exact `market_and_exchange_names` strings. These were read off the live
# report rather than guessed — "NASDAQ-100 - CHICAGO" returns nothing, the
# contract is called "NASDAQ-100 Consolidated". The Consolidated series combine
# the full-size and micro contracts, which is the honest measure of how much of
# a market a group actually holds.
MARKETS = [
    # group,            CFTC name,                                            display
    ("Equity indices",  "S&P 500 Consolidated - CHICAGO MERCANTILE EXCHANGE",        "S&P 500"),
    ("Equity indices",  "NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE",     "Nasdaq 100"),
    ("Equity indices",  "RUSSELL E-MINI - CHICAGO MERCANTILE EXCHANGE",              "Russell 2000"),
    ("Equity indices",  "E-MINI S&P 400 STOCK INDEX - CHICAGO MERCANTILE EXCHANGE",  "S&P Midcap 400"),
    ("Equity indices",  "MSCI EAFE  - ICE FUTURES U.S.",                             "MSCI EAFE"),
    ("Equity indices",  "MSCI EM INDEX - ICE FUTURES U.S.",                          "MSCI Emerging Markets"),
    ("Equity indices",  "NIKKEI STOCK AVERAGE YEN DENOM - CHICAGO MERCANTILE EXCHANGE", "Nikkei 225"),
    ("Volatility",      "VIX FUTURES - CBOE FUTURES EXCHANGE",                       "VIX"),
    ("Rates",           "UST 2Y NOTE - CHICAGO BOARD OF TRADE",                      "2-year Treasury"),
    ("Rates",           "UST 5Y NOTE - CHICAGO BOARD OF TRADE",                      "5-year Treasury"),
    ("Rates",           "UST 10Y NOTE - CHICAGO BOARD OF TRADE",                     "10-year Treasury"),
    ("Rates",           "ULTRA UST 10Y - CHICAGO BOARD OF TRADE",                    "Ultra 10-year"),
    ("Rates",           "UST BOND - CHICAGO BOARD OF TRADE",                         "Treasury bond"),
    ("Rates",           "ULTRA UST BOND - CHICAGO BOARD OF TRADE",                   "Ultra bond"),
    ("Rates",           "SOFR-3M - CHICAGO MERCANTILE EXCHANGE",                     "3-month SOFR"),
    ("Rates",           "FED FUNDS - CHICAGO BOARD OF TRADE",                        "Fed funds"),
    ("Currencies",      "USD INDEX - ICE FUTURES U.S.",                              "Dollar index"),
    ("Currencies",      "EURO FX - CHICAGO MERCANTILE EXCHANGE",                     "Euro"),
    ("Currencies",      "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",                "Japanese yen"),
    ("Currencies",      "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE",               "British pound"),
    ("Currencies",      "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE",                 "Swiss franc"),
    ("Currencies",      "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",             "Canadian dollar"),
    ("Currencies",      "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",           "Australian dollar"),
    ("Currencies",      "MEXICAN PESO - CHICAGO MERCANTILE EXCHANGE",                "Mexican peso"),
    ("Crypto",          "BITCOIN - CHICAGO MERCANTILE EXCHANGE",                     "Bitcoin"),
]

CLASSES = {
    "hedge_funds":    ("lev_money_positions_long", "lev_money_positions_short",
                       "Leveraged funds — hedge funds and CTAs, the fast money"),
    "asset_managers": ("asset_mgr_positions_long", "asset_mgr_positions_short",
                       "Asset managers — pensions, insurers and mutual funds, the real money"),
    "dealers":        ("dealer_positions_long_all", "dealer_positions_short_all",
                       "Dealers — the sell side, largely hedging its own book"),
}


def fetch(name: str):
    """Every weekly row for one market, oldest first."""
    out, offset = [], 0
    while True:
        q = urllib.parse.urlencode({
            "$where": f"market_and_exchange_names = '{name}' and report_date_as_yyyy_mm_dd >= '{HISTORY_START}'",
            "$order": "report_date_as_yyyy_mm_dd ASC",
            "$limit": 1000, "$offset": offset,
        })
        req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": "MacroTilt/positioning-tff"})
        with urllib.request.urlopen(req, timeout=90) as r:
            page = json.loads(r.read().decode("utf-8"))
        out += page
        if len(page) < 1000:
            return out
        offset += 1000


def pct_rank(sorted_vals, x):
    import bisect
    if not sorted_vals:
        return None
    return round(100 * bisect.bisect_left(sorted_vals, x) / len(sorted_vals), 1)


def build_market(group, name, display):
    rows = fetch(name)
    if len(rows) < 60:
        return None, f"{display}: only {len(rows)} weekly rows — skipped"

    series = {}   # class -> [(date, net_pct_oi)]
    for cls, (lk, sk, _) in CLASSES.items():
        pts = []
        for r in rows:
            try:
                oi = float(r.get("open_interest_all") or 0)
                if oi <= 0:
                    continue
                net = float(r.get(lk) or 0) - float(r.get(sk) or 0)
                pts.append((r["report_date_as_yyyy_mm_dd"][:10], round(100 * net / oi, 2)))
            except (TypeError, ValueError):
                continue
        series[cls] = pts

    if not series["hedge_funds"]:
        return None, f"{display}: no usable rows"

    asof = series["hedge_funds"][-1][0]
    cut = (dt.date.fromisoformat(asof) - dt.timedelta(days=365 * HISTORY_KEEP_YEARS)).isoformat()

    out = {"market": display, "group": group, "cftc_name": name, "as_of": asof,
           "open_interest": int(float(rows[-1].get("open_interest_all") or 0)), "classes": {}}

    for cls, pts in series.items():
        if not pts:
            continue
        vals = sorted(v for _, v in pts)
        cur = pts[-1][1]
        prev = pts[-2][1] if len(pts) > 1 else None
        out["classes"][cls] = {
            "net_pct_oi": cur,
            "pctile": pct_rank(vals, cur),
            "pctile_basis": f"{len(pts)} weekly reports from {pts[0][0]}",
            "wow_change_pct_oi": None if prev is None else round(cur - prev, 2),
            "wow_change_pctile": None if prev is None else round((pct_rank(vals, cur) or 0) - (pct_rank(vals, prev) or 0), 1),
        }

    hf = out["classes"].get("hedge_funds", {})
    am = out["classes"].get("asset_managers", {})
    # The tell: fast money and real money at opposite extremes. A single class at
    # an extreme is one group's opinion; the two at opposite extremes is a
    # disagreement, and disagreements are what resolve.
    out["opposed"] = bool(
        hf.get("pctile") is not None and am.get("pctile") is not None
        and ((hf["pctile"] >= EXTREME_HI and am["pctile"] <= EXTREME_LO)
             or (hf["pctile"] <= EXTREME_LO and am["pctile"] >= EXTREME_HI))
    )
    out["net_sign_split"] = bool(
        hf.get("net_pct_oi") is not None and am.get("net_pct_oi") is not None
        and hf["net_pct_oi"] * am["net_pct_oi"] < 0
    )
    out["history"] = [[d, h, a] for (d, h), (_, a) in
                      zip(series["hedge_funds"], series["asset_managers"]) if d >= cut]
    return out, None


def main(argv):
    out_path = argv[1] if len(argv) > 1 else OUT_PATH
    groups, problems = {}, []
    for group, name, display in MARKETS:
        try:
            m, err = build_market(group, name, display)
        except Exception as exc:  # noqa: BLE001
            m, err = None, f"{display}: {exc}"
        if err:
            problems.append(err)
        if m:
            groups.setdefault(group, []).append(m)

    total = sum(len(v) for v in groups.values())
    if total < 8:
        # A near-empty positioning file is a broken fetch, not a quiet week.
        print(f"FATAL: only {total} markets built", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        return 1

    asof = max(m["as_of"] for v in groups.values() for m in v)
    opposed = [{"market": m["market"], "group": m["group"],
                "hedge_funds_pct_oi": m["classes"]["hedge_funds"]["net_pct_oi"],
                "hedge_funds_pctile": m["classes"]["hedge_funds"]["pctile"],
                "asset_managers_pct_oi": m["classes"]["asset_managers"]["net_pct_oi"],
                "asset_managers_pctile": m["classes"]["asset_managers"]["pctile"]}
               for v in groups.values() for m in v if m["opposed"]]

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "as_of": asof,
        "source": "CFTC Traders in Financial Futures (TFF), publicreporting.cftc.gov",
        "counts": {"markets": total, "opposed": len(opposed)},
        "what_this_is": (
            "Weekly futures positioning split by WHO holds it. The legacy Commitments of Traders "
            "report has one 'non-commercial' bucket that mixes hedge funds in with pensions and "
            "insurers; this splits them, so a large real-money long and a large hedge-fund short "
            "stop cancelling out into a number that looks like nothing."
        ),
        "class_notes": {k: v[2] for k, v in CLASSES.items()},
        "extreme_bands": {"high": EXTREME_HI, "low": EXTREME_LO},
        "opposed_markets": opposed,
        "problems": problems,
        "groups": groups,
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {out_path}: {total} markets, as of {asof}, {len(opposed)} with fast and real money opposed")
    for p in problems:
        print("  problem: " + p, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
