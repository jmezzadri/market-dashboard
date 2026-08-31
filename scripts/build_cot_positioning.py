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

# ── Own your own deadline (2026-08-31) ────────────────────────────────────
# CFTC-COT-WEEKLY was "cancelled" on 2026-07-04, 2026-08-01 and 2026-08-29 —
# three weeks of positioning silently one release behind. Confirmed from the
# 8/29 log, not inferred: the step started 15:22:48, GitHub printed "The
# operation was canceled" at 15:37:47 (exactly timeout-minutes: 15) and then
# "Terminate orphan process: pid (2270) (python3)". Successful runs finish in
# ~3 minutes, so this is a hang, not a slow week.
#
# A job killed by timeout-minutes ends with conclusion=cancelled, and
# WORKFLOW_FAILURE_ALERT deliberately suppresses cancelled runs as GitHub
# runner shortages (2026-05-06 rule). So the job hung, the data went stale,
# and NOTHING alerted — three times in two months. The producer therefore
# owns its own deadline: it exits 1 with a message well before the runner
# kills it, which turns an invisible cancellation into an ordinary failure
# the existing alerting already handles.
#
# 10 minutes: >3x the observed spread of a healthy run, 5 minutes clear of
# timeout-minutes. LESSONS 4.28 rule 1 — never set a deadline inside the
# spread you are grading.
BUDGET_SECONDS = int(os.environ.get("COT_BUDGET_SECONDS", "600"))
# No paginated pull of one CFTC contract pattern legitimately runs past this.
# An unbounded `while True` that keeps receiving full pages is an infinite
# loop that prints nothing, which is exactly what a zero-output hang looks
# like. Bounded, it becomes a loud error naming the query.
MAX_PAGES = int(os.environ.get("COT_MAX_PAGES", "200"))

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
    ("Commodities", "Natural Gas", "NAT GAS NYME"),
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
    pages = 0
    while True:
        pages += 1
        if pages > MAX_PAGES:
            raise RuntimeError(
                f"socrata: {MAX_PAGES} full pages and still going for where=({where}) "
                f"— the offset is not advancing. Refusing to loop forever.")
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


NYFED_PD_URL = "https://markets.newyorkfed.org/api/pd/get/{}.json"
IG_BUCKETS = [("PDPOSCSBND-L13", "\u226413mo"), ("PDPOSCSBND-G13", "1\u20135yr"), ("PDPOSCSBND-G5L10", "5\u201310yr"), ("PDPOSCSBND-G10", "10yr+")]
HY_BUCKETS = [("PDPOSCSBND-BELL13", "\u226413mo"), ("PDPOSCSBND-BELG13", "1\u20135yr"), ("PDPOSCSBND-BELG5L10", "5\u201310yr"), ("PDPOSCSBND-BELG10", "10yr+")]


# The NY Fed markets API intermittently returns an EMPTY 200 body to
# data-center IP ranges (GitHub Actions). The old bare requests.get with the
# default python-requests User-Agent hit that empty body, threw "Expecting
# value: line 1 column 1" at .json(), and the Credit bucket silently kept its
# prior value — it froze at 2026-05-27 for weeks while fresh data was available
# (LESSONS 4.5: never accept a silent empty pull). Send browser-like headers and
# retry on an empty / non-JSON / empty-timeseries body before giving up.
_NYFED_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://markets.newyorkfed.org/",
}

def _nyfed_series(keyid):
    """One NY Fed Primary Dealer weekly series -> pd.Series(index=date, value=$mm).
    Robust: browser headers + retry on an empty/non-JSON body so a transient
    empty 200 from the API can no longer silently freeze the Credit bucket."""
    import requests, time
    last_err = None
    for attempt in range(4):
        try:
            r = requests.get(NYFED_PD_URL.format(keyid), headers=_NYFED_HEADERS, timeout=60)
            r.raise_for_status()
            if not (r.text or "").strip():
                raise ValueError("empty response body")
            rows = r.json().get("pd", {}).get("timeseries", [])
            if not rows:
                raise ValueError("no timeseries rows")
            out = {}
            for o in rows:
                try:
                    out[str(o["asofdate"])[:10]] = float(o["value"])
                except (TypeError, ValueError, KeyError):
                    continue
            return pd.Series(out)
        except Exception as e:
            last_err = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"NY Fed {keyid}: {last_err}")


def _dealer_market(disp, buckets, start):
    """Net primary-dealer inventory ($bn) summed across the 4 maturity buckets,
    percentile-ranked in its own 3-year range, PLUS the per-bucket breakdown.
    Dealer inventory, NOT speculators."""
    s = None
    bucket_out = []
    for k, lab in buckets:
        ser = _nyfed_series(k)
        if not ser.empty:
            bucket_out.append({"label": lab, "net": round(float(ser.sort_index().iloc[-1]) / 1000.0, 1)})
        s = ser if s is None else s.add(ser, fill_value=0)
    if s is None or s.empty:
        return None
    s = s.sort_index()
    s = s[s.index >= start]
    bn = (s / 1000.0).dropna()
    if bn.empty:
        return None
    pct = pctrank(bn)
    hist = [[str(d)[:10], round(float(v), 1), None] for d, v in bn.items()][-WINDOW:]
    return {
        "market": disp, "spec": pct, "comm": None,
        "specNet": round(float(bn.iloc[-1]), 1),
        "asof": str(bn.index[-1])[:10], "history": hist, "dealerUnit": "$bn net",
        "buckets": bucket_out,
    }


def credit_takeaway(markets):
    hot = max(markets, key=lambda m: m["spec"])
    nm, p = hot["market"].lower(), hot["spec"]
    if p >= 90:
        return (f"Primary dealers are warehousing heavy credit inventory \u2014 {nm} at a 3-year peak "
                f"(the {p}th percentile of dealers' net positions). Full balance sheets leave less room to absorb client selling.")
    if p <= 10:
        return (f"Primary dealers are carrying unusually light credit inventory \u2014 {nm} near a 3-year low "
                f"(the {p}th percentile of dealers' net positions).")
    return (f"Primary-dealer credit inventory sits mid-range \u2014 {nm} at the {p}th percentile of its 3-year net-position range.")


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
    fresh_buckets = set(domains.keys())          # only the CFTC-built buckets
    # Credit bucket = live NY Fed Primary Dealer net inventory in IG / HY
    # corporate bonds (dealer inventory; NOT CFTC speculators/hedgers).
    try:
        start4 = (dt.date.today() - dt.timedelta(days=365 * 4)).isoformat()
        ig = _dealer_market("Investment-grade bonds", IG_BUCKETS, start4)
        hy = _dealer_market("High-yield bonds", HY_BUCKETS, start4)
        cmk = [m for m in (ig, hy) if m]
        if cmk:
            cr_asof = max(m["asof"] for m in cmk)
            top = max(cmk, key=lambda m: m["spec"])
            domains["Credit"] = {
                "markets": cmk, "dealer": True, "as_of": cr_asof,
                "takeaway": credit_takeaway(cmk),
                "headline": {"market": top["market"], "spec": top["spec"], "comm": None, "div": False},
            }
            latest = max(latest, cr_asof) if latest else cr_asof
            print(f"  Credit (NY Fed dealer) IG p{ig['spec'] if ig else '-'} HY p{hy['spec'] if hy else '-'} as_of {cr_asof}")
            # The Credit row (credit_positioning) is a SEPARATE pipeline_health
            # row from cftc-cot — stamp it green + fresh here, or it reds on the
            # pull clock forever even with fresh data.
            _sync_credit_positioning(cr_asof, True)
        elif "Credit" in prior:
            domains["Credit"] = prior["Credit"]; print("  Credit: NY Fed empty, kept prior")
            _sync_credit_positioning(None, False, "NY Fed returned no dealer-inventory rows")
    except Exception as e:
        print(f"  Credit NY Fed fetch failed: {e}")
        if "Credit" in prior:
            domains["Credit"] = prior["Credit"]
        # Fail loud: never leave a frozen green — mark the row red with the error.
        _sync_credit_positioning(None, False, e)
    # headline + takeaway only for freshly built buckets (preserved buckets keep
    # theirs). Defensive .get so a market missing a field can never crash the run.
    for b in fresh_buckets:
        d = domains[b]
        if not d.get("markets"):
            continue
        hot = max(d["markets"], key=lambda m: abs(m.get("spec", 50) - 50))
        d["headline"] = {"market": hot.get("market"), "spec": hot.get("spec"), "comm": hot.get("comm"), "div": hot.get("div", False)}
        d["takeaway"] = takeaway_for(b, d["markets"])
    out = {"as_of": latest, "domains": domains}
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"\nWrote {OUT_PATH}: {sum(len(d.get('markets', [])) for d in domains.values())} markets across {len(domains)} buckets, as_of {latest}")
    stamp_manifest(latest)
    _sync_pipeline_health(latest)



def _sync_pipeline_health(as_of):
    """Upsert the cftc-cot pipeline_health row so positioning is tracked on
    Admin·Data + the watchdog. Silent no-op without Supabase env."""
    import os as _os, urllib.request as _ur, json as _json
    url=_os.environ.get("SUPABASE_URL"); key=_os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key and as_of): return
    # Honest-stamp rule (2026-06-11): the COT report is as of its Tuesday
    # DATE — no invented 4 PM close; last_good_at = the real ingest time.
    import datetime as _dtm
    _now_iso=_dtm.datetime.now(_dtm.timezone.utc).isoformat()
    das=f"{min(str(as_of)[:10], _now_iso[:10])}T00:00:00+00:00"
    row={"indicator_id":"cftc-cot","label":"CFTC positioning","source":"cftc","cadence":"W",
         "expected_cadence_minutes":10080,"data_as_of":das,"last_good_at":_now_iso,
         "status":"green","last_error":None,"coverage_pct":100.0}
    req=_ur.Request(f"{url}/rest/v1/pipeline_health?on_conflict=indicator_id",data=_json.dumps(row).encode(),method="POST",
        headers={"apikey":key,"Authorization":f"Bearer {key}","Content-Type":"application/json","Prefer":"return=minimal,resolution=merge-duplicates"})
    try:
        with _ur.urlopen(req,timeout=10) as r: r.read(); print("  pipeline_health: cftc-cot upserted")
    except Exception as ex: print(f"  pipeline_health upsert cftc-cot: {ex}")


def _sync_credit_positioning(as_of, ok, err=None):
    """Upsert the credit_positioning pipeline_health row (NY Fed dealer
    inventory, IG + HY corporate bonds — split out from cftc-cot). Green + a
    fresh last_good_at on a successful pull; red with the error on failure
    (fail-loud — never leave a frozen green). On failure last_good_at and
    data_as_of are left untouched so they keep the last real success. No-op
    without Supabase env."""
    import os as _os, urllib.request as _ur, json as _json, datetime as _dtm
    url=_os.environ.get("SUPABASE_URL"); key=_os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key): return
    _now=_dtm.datetime.now(_dtm.timezone.utc).isoformat()
    row={"indicator_id":"credit_positioning","label":"Credit positioning (NY Fed dealer)",
         "source":"ny_fed","cadence":"W","expected_cadence_minutes":10080,
         "status":"green" if ok else "red",
         "last_error":None if ok else (str(err)[:200] if err else "NY Fed dealer-inventory pull failed")}
    if ok and as_of:
        row["data_as_of"]=f"{str(as_of)[:10]}T00:00:00+00:00"
        row["last_good_at"]=_now
        row["coverage_pct"]=100.0
    req=_ur.Request(f"{url}/rest/v1/pipeline_health?on_conflict=indicator_id",data=_json.dumps(row).encode(),method="POST",
        headers={"apikey":key,"Authorization":f"Bearer {key}","Content-Type":"application/json","Prefer":"return=minimal,resolution=merge-duplicates"})
    try:
        with _ur.urlopen(req,timeout=10) as r: r.read(); print(f"  pipeline_health: credit_positioning {'green' if ok else 'red'}")
    except Exception as ex: print(f"  pipeline_health upsert credit_positioning: {ex}")


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


def _install_budget():
    """Fail loudly before the runner kills us silently. SIGALRM only exists on
    POSIX; on anything else this is a no-op and the job timeout stays the only
    backstop."""
    try:
        import signal
    except ImportError:
        return
    if not hasattr(signal, "SIGALRM") or BUDGET_SECONDS <= 0:
        return
    def _blown(signum, frame):
        sys.stdout.flush()
        raise SystemExit(
            f"FATAL: build_cot_positioning exceeded its {BUDGET_SECONDS}s budget "
            f"(a healthy run takes ~3 minutes). Nothing was written; the prior "
            f"cot_positioning.json still renders. The last line printed above is "
            f"where it hung.")
    signal.signal(signal.SIGALRM, _blown)
    signal.alarm(BUDGET_SECONDS)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    _install_budget()
    run()
