#!/usr/bin/env python3
"""
build_cot_positioning.py — weekly producer for public/cot_positioning.json
==========================================================================

WHAT (plain English)
--------------------
Every Friday the CFTC publishes who holds futures positions as of the prior
Tuesday. This builds the bucketed positioning file the Macro Overview reads:
for each asset class (Rates, Equities, FX, Commodities) it ranks every
market's speculator and commercial-hedger net position (as a share of open
interest) into that market's OWN trailing 3-year range, picks the most
stretched market as the bucket headline, and writes a one-sentence, data-true
takeaway. The Credit bucket (dealer inventory, NY Fed) is preserved from the
prior file until its own producer is wired.

OUTPUT
------
public/cot_positioning.json  { as_of, domains: { <Bucket>: { takeaway, headline,
markets:[{market,spec,comm,specNet,commNet,div,oi,asof,history}] } } }
Also stamps the freshness fields of indicator-cftc-cot-weekly in the manifest.

USAGE
  python3 scripts/build_cot_positioning.py            # live pull + write
  python3 scripts/build_cot_positioning.py --selftest # offline math + takeaway
"""
from __future__ import annotations
import sys, os, json, datetime as dt
import numpy as np
import pandas as pd

API = "https://publicreporting.cftc.gov/resource"
LEGACY = "6dca-aqww"
OUT_PATH = os.environ.get("COT_POS_PATH", "public/cot_positioning.json")
MANIFEST_PATH = os.environ.get("COT_MANIFEST_PATH", "public/data_manifest.json")
MANIFEST_ELEMENT_ID = "indicator-cftc-cot-weekly"
WINDOW = 156
TAIL_LOW, TAIL_HIGH = 10.0, 90.0

# page bucket, display, CFTC name pattern
MARKETS = [
    ("Rates", "3M SOFR", "SOFR-3M"),
    ("Rates", "2Y Treasury", "2-YEAR U.S. TREASURY NOTES"),
    ("Rates", "5Y Treasury", "5-YEAR U.S. TREASURY NOTES"),
    ("Rates", "10Y Treasury", "10-YEAR U.S. TREASURY NOTES"),
    ("Rates", "Ultra Bond", "ULTRA U.S. TREASURY BOND"),
    ("Equities", "S&P 500", "E-MINI S&P 500"),
    ("Equities", "Nasdaq 100", "NASDAQ-100 STOCK INDEX (MINI)"),
    ("Equities", "Russell 2000", "RUSSELL 2000"),
    ("Equities", "VIX", "VIX FUTURES"),
    ("FX", "Dollar index", "U.S. DOLLAR INDEX"),
    ("FX", "Euro", "EURO FX"),
    ("FX", "Japanese Yen", "JAPANESE YEN"),
    ("FX", "British Pound", "BRITISH POUND"),
    ("FX", "Canadian Dollar", "CANADIAN DOLLAR"),
    ("FX", "Swiss Franc", "SWISS FRANC"),
    ("FX", "Aussie dollar", "AUSTRALIAN DOLLAR"),
    ("FX", "Mexican Peso", "MEXICAN PESO"),
    ("Commodities", "WTI Crude", "CRUDE OIL, LIGHT SWEET - NEW YORK"),
    ("Commodities", "Natural Gas", "NATURAL GAS - NEW YORK"),
    ("Commodities", "Gold", "GOLD"),
    ("Commodities", "Silver", "SILVER"),
    ("Commodities", "Copper", "COPPER"),
    ("Commodities", "Platinum", "PLATINUM"),
    ("Commodities", "Corn", "CORN"),
    ("Commodities", "Soybeans", "SOYBEANS"),
    ("Commodities", "Wheat", "WHEAT-SRW"),
    ("Commodities", "Sugar", "SUGAR NO. 11"),
    ("Commodities", "Coffee", "COFFEE C"),
]


def socrata(where, select=None, order="report_date_as_yyyy_mm_dd", page=1000):
    import requests
    base, out, off = f"{API}/{LEGACY}.json", [], 0
    while True:
        params = {"$where": where, "$order": order, "$limit": page, "$offset": off}
        if select:
            params["$select"] = select
        r = requests.get(base, params=params, timeout=60)
        r.raise_for_status()
        c = r.json()
        out.extend(c)
        if len(c) < page:
            break
        off += page
    return pd.DataFrame(out)


def resolve(pattern):
    df = socrata(
        f"market_and_exchange_names like '%{pattern}%'",
        "cftc_contract_market_code,market_and_exchange_names,open_interest_all,report_date_as_yyyy_mm_dd",
        "report_date_as_yyyy_mm_dd DESC", 300)
    if df.empty:
        return None, None
    df["open_interest_all"] = pd.to_numeric(df["open_interest_all"], errors="coerce")
    latest = df[df["report_date_as_yyyy_mm_dd"] == df["report_date_as_yyyy_mm_dd"].max()]
    row = latest.sort_values("open_interest_all", ascending=False).iloc[0]
    return str(row["cftc_contract_market_code"]), row["market_and_exchange_names"]


def netpct(df, l, s):
    oi = pd.to_numeric(df["open_interest_all"], errors="coerce")
    return (pd.to_numeric(df[l], errors="coerce") - pd.to_numeric(df[s], errors="coerce")) / oi


def pctrank(series):
    s = series.dropna()
    w = s.iloc[-WINDOW:] if len(s) >= WINDOW else s
    cur = w.iloc[-1]
    return round(float((w <= cur).mean() * 100.0))


def takeaway_for(domain, markets):
    """Data-true one-sentence read for a bucket. Anchored to the most stretched
    market so it can never contradict the numbers on the tiles."""
    if not markets:
        return "No positioning data this week."
    hot = max(markets, key=lambda m: abs(m["spec"] - 50))
    nm, p = hot["market"], hot["spec"]
    divs = [m["market"] for m in markets if m.get("div")]
    tail = ""
    if p >= TAIL_HIGH:
        tail = f"Speculators are crowded long {nm} (the {p}th percentile of 3 years) — a contrarian-bearish lean."
    elif p <= TAIL_LOW:
        tail = f"Speculators are washed out of {nm} (a 3-year low) — a contrarian-bullish lean."
    else:
        tail = f"Positioning across {domain.lower()} sits mid-range — no crowded extreme this week."
    if divs:
        tail += f" Speculators and hedgers sit at opposite extremes in {', '.join(divs[:2])}."
    return tail


def build_market(disp, code, full, start):
    df = socrata(f"cftc_contract_market_code='{code}' and report_date_as_yyyy_mm_dd>='{start}'")
    if df.empty:
        return None
    df = df.sort_values("report_date_as_yyyy_mm_dd").reset_index(drop=True)
    nc = netpct(df, "noncomm_positions_long_all", "noncomm_positions_short_all")
    cm = netpct(df, "comm_positions_long_all", "comm_positions_short_all")
    spec, comm = pctrank(nc), pctrank(cm)
    dates = pd.to_datetime(df["report_date_as_yyyy_mm_dd"]).dt.strftime("%Y-%m-%d")
    hist = [[d, round(float(a) * 100, 1), round(float(b) * 100, 1)]
            for d, a, b in zip(dates, nc, cm) if pd.notna(a) and pd.notna(b)][-WINDOW:]
    return {
        "market": disp,
        "spec": spec,
        "comm": comm,
        "specNet": round(float(nc.dropna().iloc[-1]) * 100, 1),
        "commNet": round(float(cm.dropna().iloc[-1]) * 100, 1),
        "div": bool((spec >= TAIL_HIGH and comm <= TAIL_LOW) or (spec <= TAIL_LOW and comm >= TAIL_HIGH)),
        "oi": int(round(float(pd.to_numeric(df["open_interest_all"], errors="coerce").iloc[-1]))),
        "asof": str(df["report_date_as_yyyy_mm_dd"].iloc[-1])[:10],
        "history": hist,
    }


def run():
    start = (dt.date.today() - dt.timedelta(days=365 * 4)).isoformat()
    domains = {}
    latest = None
    for bucket, disp, pat in MARKETS:
        try:
            code, full = resolve(pat)
            if not code:
                print(f"  MISS {disp}"); continue
            m = build_market(disp, code, full, start)
            if not m:
                print(f"  EMPTY {disp}"); continue
            domains.setdefault(bucket, {"markets": []})["markets"].append(m)
            latest = max(latest, m["asof"]) if latest else m["asof"]
            print(f"  {bucket:11s} {disp:16s} spec p{m['spec']:>3} comm p{m['comm']:>3}{'  DIV' if m['div'] else ''}")
        except Exception as e:
            print(f"  ERR {disp}: {e}")
    if not domains:
        print("No COT markets produced; leaving file untouched."); sys.exit(1)
    # Preserve the existing Credit bucket (NY Fed dealer inventory) until its
    # own producer is wired — do not drop it.
    prior = {}
    if os.path.exists(OUT_PATH):
        try:
            prior = json.load(open(OUT_PATH)).get("domains", {})
        except Exception:
            prior = {}
    if "Credit" in prior and "Credit" not in domains:
        domains["Credit"] = prior["Credit"]
    # headline + takeaway per bucket
    for b, d in domains.items():
        if "markets" not in d:
            continue
        hot = max(d["markets"], key=lambda m: abs(m["spec"] - 50))
        d["headline"] = {"market": hot["market"], "spec": hot["spec"], "comm": hot["comm"], "div": hot["div"]}
        d["takeaway"] = takeaway_for(b, d["markets"])
    out = {"as_of": latest, "domains": domains}
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"\nWrote {OUT_PATH}: {sum(len(d.get('markets', [])) for d in domains.values())} markets across {len(domains)} buckets, as_of {latest}")
    stamp_manifest(latest)


def stamp_manifest(as_of):
    if not (as_of and os.path.exists(MANIFEST_PATH)):
        return
    man = json.load(open(MANIFEST_PATH))
    els = man.get("elements") if isinstance(man, dict) else man
    if not isinstance(els, list):
        return
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    for e in els:
        if isinstance(e, dict) and e.get("id") == MANIFEST_ELEMENT_ID:
            e["last_success_utc"] = now
            e["data_as_of"] = as_of
            e["current_status"] = "live"
            json.dump(man, open(MANIFEST_PATH, "w"), indent=1)
            print(f"  stamped {MANIFEST_ELEMENT_ID}: as_of={as_of}")
            return


def selftest():
    ok = True
    s = pd.Series(np.arange(1, 201, dtype=float))
    p = pctrank(s)
    ok &= (p == 100)
    print(f"  {'OK' if p==100 else 'FAIL'} pctrank(max)={p}")
    mk = [{"market": "VIX", "spec": 95, "comm": 8, "div": True},
          {"market": "S&P 500", "spec": 40, "comm": 55, "div": False}]
    t = takeaway_for("Equities", mk)
    ok &= ("crowded long VIX" in t and "95th" in t)
    print(f"  {'OK' if 'crowded long VIX' in t else 'FAIL'} takeaway: {t}")
    mk2 = [{"market": "Gold", "spec": 6, "comm": 92, "div": True}]
    t2 = takeaway_for("Commodities", mk2)
    ok &= ("washed out of Gold" in t2)
    print(f"  {'OK' if 'washed out' in t2 else 'FAIL'} takeaway: {t2}")
    print("\nSELFTEST", "PASSED" if ok else "FAILED")
    return ok


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    run()
