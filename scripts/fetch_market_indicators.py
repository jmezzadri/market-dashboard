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
WINDOW_DAYS = 756        # trailing window for the percentile/z stats only (~3y)
# 2026-06-16: pull FULL Yahoo history ("max") and MERGE-preserve the stored series
# so the chart carries ~20y depth; daily runs extend it and never truncate. The
# stats below still rank the latest value in its trailing 3y, unchanged.
RANGE = os.environ.get("MKT_RANGE", "max")
YH = "https://query1.finance.yahoo.com/v8/finance/chart"

# id -> (yahoo ticker, plain display name, bucket, unit)
TARGETS = [
    ("cmdty_gold",     "GC=F",       "Gold",              "Commodities", "$/oz"),
    ("cmdty_silver",   "SI=F",       "Silver",            "Commodities", "$/oz"),
    ("cmdty_copper",   "HG=F",       "Copper",            "Commodities", "$/lb"),
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


STATS_YEARS = 3

def _stats_window(points, years=STATS_YEARS):
    """The population a "trailing 3-year percentile" is supposed to rank against.

    Two faults this replaces, both found 2026-08-19:

    1. The window was the last 756 OBSERVATIONS, not the last 3 years. For a
       daily series those are the same thing. For uranium -- 462 monthly points
       with 46 daily ones behind them -- 756 observations is the ENTIRE series,
       so a card labelled "trailing 3-year percentile" was ranking today against
       thirty-eight years. It read 97.2 and coloured the pill red.
    2. Cadence. Uranium's raw 3-year window is ~36 monthly points plus ~45 daily
       ones, so the most recent two months supply over half the sample and any
       recent drift mechanically ranks high (92.5). A percentile only means
       something over a population sampled EVENLY IN TIME, so a sparse window is
       normalised to one observation per calendar month (83.3).

    Dense daily series are untouched by both changes: gold, silver, copper, oil
    and natgas each return the identical number to the old code. LESSONS 4.49.
    """
    import datetime as _sd
    pts = [(d, v) for d, v in (points or []) if v is not None]
    if not pts:
        return []
    cut = (_sd.date.fromisoformat(pts[-1][0])
           - _sd.timedelta(days=365 * years)).isoformat()
    latest = pts[-1][0]
    # Bounded at BOTH ends. The upper bound matters: the month-end map is read
    # back in sorted-key order, so a single future-dated point would silently
    # become "today's value" and be ranked against everything else.
    w = [(d, v) for d, v in pts if cut <= d <= latest]
    if len(w) >= 250:                 # genuinely daily across the window
        return [v for _, v in w]
    monthly = {}
    for d, v in w:                    # last observation in each calendar month;
        monthly[d[:7]] = v            # the newest month keeps today's reading
    return [monthly[k] for k in sorted(monthly)]


def pctrank_points(points, years=STATS_YEARS):
    w = _stats_window(points, years)
    if not w:
        return None
    a = np.asarray(w, float)
    return round(float((a <= a[-1]).mean() * 100.0), 1)


def zscore_points(points, years=STATS_YEARS):
    w = _stats_window(points, years)
    if not w:
        return None
    a = np.asarray(w, float)
    mu, sd = a.mean(), a.std(ddof=0)
    return round(float((a[-1] - mu) / sd), 2) if sd else 0.0


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
    import requests, time as _t
    # Full DAILY history via explicit date range. range="max" downsamples old
    # data to monthly; period1/period2 with interval=1d returns true daily bars
    # all the way back to the contract's Yahoo inception (~2000 for futures).
    params = {"period1": 788918400, "period2": int(_t.time()) + 86400, "interval": "1d"}
    r = requests.get(f"{YH}/{ticker}", params=params,
                     headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
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


def fetch_uranium_spot():
    """Live spot U3O8 ($/lb) from Numerco via Yellow Cake plc's public endpoint.
    Not a Yahoo ticker — returns the single live spot value (updated daily); we
    append today's reading onto the accumulating history. Returns float or None."""
    import requests, re
    r = requests.get("https://www.yellowcakeplc.com/api/spotUraniumPrice.php",
                     headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    r.raise_for_status()
    m = re.search(r"US\$([0-9.]+)/lb", r.text)
    return float(m.group(1)) if m else None


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
        row={"indicator_id":k,"label":st.get("label") or k,"source":st.get("source") or "Yahoo Finance",
             "cadence":e.get("freq") or "D","expected_cadence_minutes":10080 if e.get("freq")=="W" else 1440,
             "data_as_of":das,"last_good_at":_now_iso,"status":"green","last_error":None,"coverage_pct":100.0}
        req=_ur.Request(f"{url}/rest/v1/pipeline_health?on_conflict=indicator_id",data=_json.dumps(row).encode(),method="POST",
            headers={"apikey":key,"Authorization":f"Bearer {key}","Content-Type":"application/json","Prefer":"return=minimal,resolution=merge-duplicates"})
        try:
            with _ur.urlopen(req,timeout=10) as r: r.read(); n+=1
        except Exception as ex: print(f"  pipeline_health upsert {k}: {ex}")
    print(f"  pipeline_health: {n} commodity/FX rows upserted")


def _load_hist():
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH) as f:
            return json.load(f)
    return {}


def _merge_points(stored_pts, fresh_pts):
    """Full-history union: stored points kept, fresh points win on shared dates,
    ascending by date. This is the 'hydrate-from-stored' preserve so a one-time
    deep seed is never truncated by later runs (LESSONS 4.8)."""
    m = {str(d): v for d, v in (stored_pts or [])}
    for d, v in (fresh_pts or []):
        m[str(d)] = v
    return [[d, m[d]] for d in sorted(m)]


# The daily Numerco accumulation began on this date. Everything BEFORE it is
# monthly backbone; everything from it on is our own daily readings.
URANIUM_DAILY_FROM = "2026-06-16"

def fetch_uranium_history_cameco():
    """Monthly industry-average spot U3O8 ($/lb), Jan-1988 -> latest, from Cameco.

    Cameco publishes each month-end average of the UxC and TradeTech spot
    prices. That is the SAME benchmark our daily Numerco reading measures:
    Cameco's Jun-2026 average is $85.00 and our first daily point (2026-06-16)
    is $85.75.

    It replaces IndexMundi, which was serving the Nuexco "restricted" price -- a
    DIFFERENT and much lower benchmark. Ours read $40.06 for Jan-2023 against
    Cameco's $50.63, $80.36 for Jan-2024 against $100.25, and $52.41 for
    Mar-2026 against $84.25. Splicing it behind the Numerco daily feed
    manufactured a ~20% step at the seam and made the card's trailing 3-year
    percentile a comparison between two different price definitions -- which is
    why $88.13 was reading 99th percentile. IndexMundi had also published
    nothing since Mar-2026. LESSONS 4.48.

    Returns [[YYYY-MM-01, price], ...] ascending, or raises.
    """
    import requests, re
    r = requests.get("https://www.cameco.com/invest/markets/uranium-price",
                     headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"},
                     timeout=30)
    r.raise_for_status()
    html = r.text
    # The full-history table is the first one carrying YYYY/MM/DD rows; the two
    # summary grids further down are year-by-month pivots of the same numbers.
    start = html.find("<table")
    out = {}
    while start != -1 and not out:
        tbl = html[start:html.find("</table>", start)]
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", tbl, re.S):
            cells = [re.sub(r"\s+", " ", re.sub("<[^>]+>", "", c)).strip()
                     for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
            cells = [c for c in cells if c]
            if len(cells) >= 2 and re.match(r"^\d{4}/\d{2}/\d{2}$", cells[0]):
                try:
                    v = float(cells[1].replace(",", ""))
                except ValueError:
                    continue
                y, mo, _ = cells[0].split("/")
                out[f"{y}-{mo}-01"] = round(v, 2)
        start = html.find("<table", start + 1)
    # Sanity gate: a layout change must fail LOUD and leave the held history
    # alone, never quietly hand back three rows that then overwrite 38 years.
    if len(out) < 400:
        raise RuntimeError(f"only {len(out)} monthly rows parsed (expected 400+)")
    bad = [d for d, v in out.items() if not (5.0 <= v <= 500.0)]
    if bad:
        raise RuntimeError(f"{len(bad)} implausible price(s), e.g. {bad[:3]}")
    return [[d, out[d]] for d in sorted(out)]


def run():
    updates = {}
    hist0 = _load_hist()
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
            stored = (hist0.get(key) or {}).get("points") or []
            # MKT_RESEED replaces with the clean daily pull (one-time, wipes any prior
            # coarse/monthly data); normal runs merge-preserve so depth never regresses.
            allpts = pts if os.environ.get("MKT_RESEED") else _merge_points(stored, pts)
            vals = [p[1] for p in allpts]
            freq = "D"
            thin = len(vals) < 60          # not enough history to rank yet
            pct = None if thin else pctrank_points(allpts)
            z = None if thin else zscore_points(allpts)
            state = "calm" if thin else state_for(pct)
            updates[key] = {
                "freq": freq, "unit": unit, "as_of": allpts[-1][0],
                "points": allpts,
                "stats": {"direction": "bw", "pctile_3yr": pct, "z_3yr": z,
                          "state": state, "bucket": bucket, "label": name,
                          "ranked": not thin},
            }
            pctxt = "  history building" if thin else f"{pct:5.1f}%ile  z={z:+.2f}  [{state}]"
            print(f"  {bucket:11s} {name:16s} {ticker:10s} pts={len(allpts):>5} {allpts[0][0]}->{allpts[-1][0]} last={allpts[-1][1]:>10}  {pctxt}")
        except Exception as e:
            print(f"  WARNING {name} ({ticker}): {e}")

    # Spot uranium (U3O8) — Numerco via Yellow Cake plc. Daily live value appended
    # onto accumulating history. Fail-loud: on any error we DON'T write, so the
    # chip honestly goes stale (red) rather than fake-green on a frozen value.
    try:
        spot = fetch_uranium_spot()
        if spot is None:
            raise RuntimeError("could not parse spot U3O8 from source")
        import datetime as _du
        today = _du.date.today().isoformat()
        existing = (hist0.get("cmdty_uranium") or {})
        upts = [list(pt) for pt in (existing.get("points") or []) if pt[0] != today]
        # Monthly backbone, rebuilt on EVERY run rather than seeded once.
        # A one-time seed cannot correct itself and cannot extend: this one was
        # seeded in June 2026 from a source that had the wrong benchmark AND had
        # stopped publishing, and both faults sat there for two months because
        # nothing ever looked again. One HTTP call a day fixes that permanently.
        # Pre-seam points are REPLACED, not merged — Cameco is the authority for
        # every date before our own daily readings begin. LESSONS 4.48.
        daily = [p for p in upts if p[0] >= URANIUM_DAILY_FROM]
        try:
            monthly = fetch_uranium_history_cameco()
            backbone = [m for m in monthly if m[0] < URANIUM_DAILY_FROM]
            if len(backbone) < 400:
                raise RuntimeError(f"backbone only {len(backbone)} points before the seam")
            upts = backbone + daily
            print(f"  Uranium backbone: {len(backbone)} monthly points from Cameco "
                  f"({backbone[0][0]}->{backbone[-1][0]}) + {len(daily)} daily since "
                  f"{URANIUM_DAILY_FROM}")
        except Exception as se:
            print(f"  WARNING Uranium Cameco backbone: {se} — keeping existing history")
        upts.append([today, round(spot, 2)])
        um = {p[0]: p[1] for p in upts}
        upts = [[d, um[d]] for d in sorted(um)]   # dedupe + ascending; no truncation
        uvals = [pt[1] for pt in upts]
        uthin = len(uvals) < 60
        upct = None if uthin else pctrank_points(upts)
        uz = None if uthin else zscore_points(upts)
        updates["cmdty_uranium"] = {
            "freq": "D", "unit": "$/lb", "as_of": today, "points": upts,
            "stats": {"direction": "bw", "pctile_3yr": upct, "z_3yr": uz,
                      "state": "calm" if uthin else state_for(upct), "bucket": "Commodities",
                      "label": "Uranium",
                      "source": "Numerco daily spot U3O8 (Yellow Cake plc) over "
                                "Cameco monthly industry-average spot (UxC + TradeTech)",
                      "stats_basis": f"{STATS_YEARS}y window, month-end sampled",
                      "ranked": not uthin},
        }
        print(f"  Commodities Uranium          spot=US${spot}/lb  ({'history building' if uthin else f'{upct:.1f}%ile'})")
    except Exception as e:
        print(f"  WARNING Uranium (Numerco/Yellow Cake): {e} — not written; chip will read stale")

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
    # _stats_window: a dense daily window passes through; a sparse mixed one is
    # normalised to one point per month and is bounded by the 3-year cut.
    import datetime as _td
    base = _td.date(2026, 8, 19)
    dense = [[(base - _td.timedelta(days=i)).isoformat(), float(i)] for i in range(1500)][::-1]
    w1 = _stats_window(dense)
    ok &= 250 <= len(w1) <= 1100
    print(f"  {'OK' if 250 <= len(w1) <= 1100 else 'FAIL'} dense kept daily and cut at 3y, n={len(w1)} (of 1500)")
    sparse = ([[f"2015-{m:02d}-01", 10.0] for m in range(1, 13)]
              + [[f"{y}-{m:02d}-01", 20.0] for y in (2024, 2025) for m in range(1, 13)]
              + [[f"2026-{m:02d}-01", 20.0] for m in range(1, 8)]
              + [[f"2026-08-{d:02d}", 30.0] for d in range(1, 20)])
    w2 = _stats_window(sparse)
    ok &= len(w2) <= 40 and w2[-1] == 30.0
    print(f"  {'OK' if len(w2) <= 40 and w2[-1] == 30.0 else 'FAIL'} sparse window month-end sampled, n={len(w2)}, last={w2[-1]}")
    ok &= all(v != 10.0 for v in w2)
    print(f"  {'OK' if all(v != 10.0 for v in w2) else 'FAIL'} 2015 points excluded by the 3y cut")
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
