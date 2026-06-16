#!/usr/bin/env python3
"""
fetch_market_indicators.py — MacroTilt commodity + FX market indicators.

Each indicator is the daily market price ranked into its own trailing 3-year
range (the same percentile-and-state logic every other indicator uses), so
"crude oil in the top decile of 3 years" reads consistently with the rest of
the page. Intraday market data: refreshed through the session, goes stale in
hours (trading-calendar aware), never a multi-day tolerance.

Read-modify-write MERGE into public/indicator_history.json — never overwrites,
refuses to drop any existing key.

USAGE
  python3 scripts/fetch_market_indicators.py            # pull + merge
  python3 scripts/fetch_market_indicators.py --selftest # offline math check
"""
from __future__ import annotations
import sys, os, json, time
import numpy as np

HISTORY_PATH = os.environ.get("MKT_HISTORY_PATH", "public/indicator_history.json")
WINDOW_DAYS = 756        # ~3 trading years
YH = "https://query1.finance.yahoo.com/v8/finance/chart"

# id -> (yahoo ticker, plain display name, bucket, unit)
TARGETS = [
    ("cmdty_gold",     "GC=F",       "Gold",              "Commodities", "$/oz"),
    ("cmdty_silver",   "SI=F",       "Silver",            "Commodities", "$/oz"),
    ("cmdty_copper",   "HG=F",       "Copper",            "Commodities", "$/lb"),
    ("cmdty_uranium",  "UX=F",       "Uranium",           "Commodities", "$/lb"),
    ("cmdty_oil",      "CL=F",       "Crude oil",         "Commodities", "$/bbl"),
    ("cmdty_brent",    "BZ=F",       "Brent crude",       "Commodities", "$/bbl"),
    ("cmdty_natgas",   "NG=F",       "Natural gas",       "Commodities", "$/MMBtu"),
    ("cmdty_corn",     "ZC=F",       "Corn",              "Commodities", "c/bu"),
    ("cmdty_soybeans", "ZS=F",       "Soybeans",          "Commodities", "c/bu"),
    ("cmdty_wheat",    "ZW=F",       "Wheat",             "Commodities", "c/bu"),
    ("fx_eur",         "EURUSD=X",   "Euro",              "FX",          "$/€"),
    ("fx_jpy",         "JPY=X",       "Japanese yen",     "FX",          "¥/$"),
    # 2026-06-11 (Joe): flipped from GBP=X (pounds per dollar, ~0.75) to
    # GBPUSD=X — cable, dollars per pound (~1.33), the desk-standard quote.
    ("fx_gbp",         "GBPUSD=X",    "British pound",    "FX",          "$/£"),
]


def pctrank_latest(vals, window):
    a = np.asarray([v for v in vals if v is not None], float)
    w = a[-window:] if len(a) >= window else a
    cur = w[-1]
    return round(float((w <= cur).mean() * 100.0), 1)


def zscore_latest(vals, window):
    a = np.asarray([v for v in vals if v is not None], float)
    w = a[-window:] if len(a) >= window else a
    mu, sd = w.mean(), w.std(ddof=0)
    return round(float((w[-1] - mu) / sd), 2) if sd else 0.0


def state_for(pct):
    # Bidirectional: a price at either 3-year tail is notable. Direction
    # (which tail is "risk") is a Senior Quant calibration step, done later.
    if pct >= 90 or pct <= 10:
        return "extreme"
    if pct >= 75 or pct <= 25:
        return "elevated"
    return "calm"


def fetch(ticker):
    import requests
    r = requests.get(f"{YH}/{ticker}", params={"range": "5y", "interval": "1d"},
                     headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    r.raise_for_status()
    res = r.json()["chart"]["result"]
    if not res:
        raise RuntimeError("no result")
    q = res[0]
    ts = q["timestamp"]
    closes = q["indicators"]["quote"][0]["close"]
    pts = []
    for t, c in zip(ts, closes):
        if c is None:
            continue
        d = time.strftime("%Y-%m-%d", time.gmtime(t))
        pts.append([d, round(float(c), 4)])
    return pts


def merge(updates):
    hist = {}
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH) as f:
            hist = json.load(f)
    before = set(hist)
    hist.update(updates)
    lost = before - set(hist)
    if lost:
        raise RuntimeError(f"REFUSING — would drop keys: {sorted(lost)}")
    with open(HISTORY_PATH, "w") as f:
        json.dump(hist, f, separators=(",", ":"))
    return len(hist)



def _sync_pipeline_health(updates):
    """Upsert a pipeline_health row per commodity/FX key so each new feed is
    tracked (shows on Admin·Data, watched by the freshness watchdog) instead
    of being fake-green. Mirrors fetch_history.py's proven upsert. Silent no-op
    if Supabase env is absent."""
    import os as _os, urllib.request as _ur, json as _json, urllib.error as _ue
    url=_os.environ.get("SUPABASE_URL"); key=_os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key): return
    n=0
    for k,e in updates.items():
        pts=e.get("points") or []
        if not pts: continue
        st=e.get("stats") or {}
        # Honest-stamp rule (2026-06-11): see fetch_history.py — real run time
        # for last_good_at; business date (midnight UTC) for data_as_of.
        import datetime as _dtm
        _now_iso=_dtm.datetime.now(_dtm.timezone.utc).isoformat()
        das=f"{min(str(pts[-1][0])[:10], _now_iso[:10])}T00:00:00+00:00"
        row={"indicator_id":k,"label":st.get("label") or k,"source":"Yahoo Finance",
             "cadence":e.get("freq") or "D","expected_cadence_minutes":10080 if e.get("freq")=="W" else 1440,
             "data_as_of":das,"last_good_at":_now_iso,"status":"green","last_error":None,"coverage_pct":100.0}
        req=_ur.Request(f"{url}/rest/v1/pipeline_health?on_conflict=indicator_id",data=_json.dumps(row).encode(),method="POST",
            headers={"apikey":key,"Authorization":f"Bearer {key}","Content-Type":"application/json","Prefer":"return=minimal,resolution=merge-duplicates"})
        try:
            with _ur.urlopen(req,timeout=10) as r: r.read(); n+=1
        except Exception as ex: print(f"  pipeline_health upsert {k}: {ex}")
    print(f"  pipeline_health: {n} commodity/FX rows upserted")


def run():
    updates = {}
    for key, ticker, name, bucket, unit in TARGETS:
        try:
            pts = fetch(ticker)
            # In-progress-session guard (2026-06-11): drop a bar dated today
            # until futures/FX settlement (17:05 ET) — an open session is a
            # quote, not a daily close.
            import datetime as _dtm
            from zoneinfo import ZoneInfo as _zi
            _et = _dtm.datetime.now(_zi("America/New_York"))
            if pts and (_et.hour, _et.minute) < (17, 5) and pts[-1][0] >= _et.strftime("%Y-%m-%d"):
                print(f"  in-progress guard: dropped open-session bar {pts[-1][0]} for {ticker}")
                pts = pts[:-1]
            if not pts:
                raise RuntimeError("no completed-session bars")
            vals = [p[1] for p in pts]
            freq = "W" if key == "cmdty_uranium" else "D"
            thin = len(vals) < 60          # not enough history to rank yet
            pct = None if thin else pctrank_latest(vals, WINDOW_DAYS)
            z = None if thin else zscore_latest(vals, WINDOW_DAYS)
            state = "calm" if thin else state_for(pct)
            updates[key] = {
                "freq": freq, "unit": unit, "as_of": pts[-1][0],
                "points": pts[-WINDOW_DAYS:],
                "stats": {"direction": "bw", "pctile_3yr": pct, "z_3yr": z,
                          "state": state, "bucket": bucket, "label": name,
                          "ranked": not thin},
            }
            pctxt = "  history building" if thin else f"{pct:5.1f}%ile  z={z:+.2f}  [{state}]"
            print(f"  {bucket:11s} {name:16s} {ticker:10s} last={pts[-1][1]:>10}  {pctxt}")
        except Exception as e:
            print(f"  WARNING {name} ({ticker}): {e}")
    if not updates:
        print("No market indicators produced; leaving file untouched.")
        sys.exit(1)
    total = merge(updates)
    _ = total
    print(f"\nMerged {len(updates)} market indicators ({total} keys total).")
    _sync_pipeline_health(updates)


def selftest():
    ok = True
    vals = list(range(1, 201))
    p = pctrank_latest(vals, WINDOW_DAYS)
    ok &= abs(p - 100.0) < 1e-9
    print(f"  {'OK' if abs(p-100)<1e-9 else 'FAIL'} pctrank(max) = {p}")
    z = zscore_latest(vals, WINDOW_DAYS)
    ok &= z > 1.5
    print(f"  {'OK' if z>1.5 else 'FAIL'} zscore(max) = {z:+.2f}")
    ok &= state_for(95) == "extreme" and state_for(50) == "calm" and state_for(8) == "extreme"
    print(f"  states: 95->{state_for(95)} 50->{state_for(50)} 8->{state_for(8)}")
    # merge guard
    import tempfile
    global HISTORY_PATH
    with tempfile.TemporaryDirectory() as d:
        HISTORY_PATH = os.path.join(d, "h.json")
        json.dump({"vix": {"keep": 1}}, open(HISTORY_PATH, "w"))
        merge({"cmdty_gold": {"new": 1}})
        back = json.load(open(HISTORY_PATH))
        ok &= "vix" in back and "cmdty_gold" in back
        print(f"  {'OK' if ('vix' in back and 'cmdty_gold' in back) else 'FAIL'} merge preserves keys")
    print("\nSELFTEST", "PASSED" if ok else "FAILED")
    return ok


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    run()
