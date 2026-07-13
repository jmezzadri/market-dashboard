#!/usr/bin/env python3
"""One-off validation harness: run the real detector over the staged
full-universe bars (divergence_validation_tmp, anon-readable) for the
2026-07-10 reference scan and compare against the prototype's lists.
Not part of the nightly pipeline."""
import json, sys, os, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compute_divergences import detect_divergences

URL = "https://yqaqqzseepebrocgibcw.supabase.co/rest/v1/divergence_validation_tmp"
KEY = os.environ["ANON_KEY"]

rows = []
offset = 0
while True:
    req = urllib.request.Request(
        f"{URL}?select=ticker,name,adv_usd,payload&order=ticker&limit=200&offset={offset}",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    batch = json.load(urllib.request.urlopen(req, timeout=60))
    rows.extend(batch)
    if len(batch) < 200:
        break
    offset += 200

print(f"fetched {len(rows)} tickers")
out = []
for r in rows:
    p = r["payload"]
    closes = [float(x) for x in p["c"]]
    if len(closes) < 26:
        continue
    highs = [float(x) for x in p["h"]]
    lows  = [float(x) for x in p["l"]]
    vwaps = [float(x) if x is not None else None for x in p["v"]]
    for d in detect_divergences(highs, lows, closes, vwaps):
        out.append({"ticker": r["ticker"], **d})

out.sort(key=lambda r: (r["bars_ago"], -r["rsi_gap"]))
bull = [r for r in out if r["direction"] == "bull"]
bear = [r for r in out if r["direction"] == "bear"]
print(f"\nTOTAL {len(out)}  bull {len(bull)}  bear {len(bear)}\n")
print("BULLISH (sorted freshest, top 20):")
for r in bull[:20]:
    print(f"  {r['ticker']:6} rsi {r['rsi1']:5.1f}->{r['rsi2']:5.1f}  px {r['px1']:9.2f}->{r['px2']:9.2f}  age {r['bars_ago']:2}b sep {r['sep_bars']:2}b{'  STRONG' if r['strong'] else ''}")
print("BEARISH (sorted freshest, top 20):")
for r in bear[:20]:
    print(f"  {r['ticker']:6} rsi {r['rsi1']:5.1f}->{r['rsi2']:5.1f}  px {r['px1']:9.2f}->{r['px2']:9.2f}  age {r['bars_ago']:2}b sep {r['sep_bars']:2}b{'  STRONG' if r['strong'] else ''}")

REF_BULL = {"TXNM":(12,46),"T":(25,30),"CEG":(30,46),"ULTA":(23,40),"APD":(20,44),"SF":(15,41),"ICE":(19,23),"CBOE":(19,27),"COIN":(26,48),"TSLA":(37,46)}
REF_BEAR = {"HUM":(80,65),"CDW":(89,62),"BB":(93,82),"ETSY":(86,85),"RCL":(67,61),"LEN":(66,53),"MS":(77,65)}
got_bull = {r["ticker"]: (r["rsi1"], r["rsi2"]) for r in bull}
got_bear = {r["ticker"]: (r["rsi1"], r["rsi2"]) for r in bear}
print("\nREFERENCE CHECK (prototype 2026-07-13 run, scan through 07-10):")
for label, ref, got in (("bull", REF_BULL, got_bull), ("bear", REF_BEAR, got_bear)):
    for tk, (a, b) in ref.items():
        if tk in got:
            ga, gb = got[tk]
            near = abs(ga - a) <= 3 and abs(gb - b) <= 3
            print(f"  {label} {tk:6} FOUND  rsi {ga:5.1f}->{gb:5.1f}  vs ref {a}->{b}  {'MATCH' if near else 'DRIFT'}")
        else:
            print(f"  {label} {tk:6} MISSING")
extra_b = [t for t in got_bull if t not in REF_BULL]
extra_s = [t for t in got_bear if t not in REF_BEAR]
print(f"\nnon-reference extras: bull {extra_b}\n                      bear {extra_s}")
