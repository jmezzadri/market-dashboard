#!/usr/bin/env python3
"""
fetch_bdc_nav.py — what the market pays for private-credit loan books versus
what their managers say those books are worth.

Listed business development companies (BDCs) hold private loans and report a
net asset value (NAV) per share every quarter in their 10-Q / 10-K. Their
shares trade every day. Price / NAV is the market's live haircut on the
managers' quarterly marks — the number that tells you whether investors in the
non-traded funds have a reason to queue for redemptions at NAV.

Added 2026-10-07 (Joe): the private-credit stress was the story and we had no
way to measure it.

SOURCES
  NAV per share  SEC XBRL companyconcept us-gaap/NetAssetValuePerShare (free, no key)
  Daily close    Supabase prices_eod (already ingested daily)

NO LOOK-AHEAD: on each date a BDC's ratio uses the latest NAV whose 10-Q/10-K
was FILED BEFORE that date (strictly — a filing dated D can land after D's
close, so it first applies to the next session). A period's NAV is fixed at its
FIRST filing; later 10-Q/A restatements are deliberately ignored, because the
market priced the original.

STALENESS: a NAV older than NAV_MAX_AGE_DAYS past its period end is dropped for
that date (tag change, fiscal-year change, delisting) rather than used forever.

OUTPUTS (merge-only; refuses to drop keys)
  public/indicator_history.json  key credit_bdc_pnav — basket median price/NAV, daily
  public/bdc_nav.json            per-BDC latest price, NAV, NAV date, price/NAV

USAGE
  python3 scripts/fetch_bdc_nav.py
  python3 scripts/fetch_bdc_nav.py --selftest
"""
from __future__ import annotations
import json, os, sys, statistics, datetime as dt

HISTORY_PATH = os.environ.get("MKT_HISTORY_PATH", "public/indicator_history.json")
DETAIL_PATH = os.environ.get("BDC_DETAIL_PATH", "public/bdc_nav.json")
UA = {"User-Agent": "MacroTilt research contact@macrotilt.com"}
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
CONCEPT_URL = "https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/us-gaap/NetAssetValuePerShare.json"
PRICES_FROM = "2025-01-01"

# The largest listed BDCs with daily closes in prices_eod. A basket median, so
# one name's markdown or one bad print can't move the series on its own.
BDCS = ["ARCC", "OBDC", "FSK", "BXSL", "GBDC", "TSLX", "OCSL", "MAIN", "HTGC", "PSEC", "BBDC"]
MIN_NAMES = 6     # fewer names than this on a date -> no basket point that day
NAV_MAX_AGE_DAYS = 135   # one quarter + ~45-day filing lag


def nav_facts(concept_json):
    """[(period_end, filed, nav)] from 10-Q/10-K facts, one per period (FIRST filing wins)."""
    by_end = {}
    for unit, arr in ((concept_json or {}).get("units") or {}).items():
        if unit != "USD/shares":
            continue
        for it in arr:
            if it.get("form") not in ("10-Q", "10-K", "10-Q/A", "10-K/A"):
                continue
            end, filed, v = it.get("end"), it.get("filed"), it.get("val")
            if not (end and filed) or v is None:
                continue
            try:
                v = float(v)
            except (TypeError, ValueError):
                continue
            if not (0.5 <= v <= 500):          # a NAV/share outside this is a parse error
                continue
            # The same period re-appears as a prior-period comparative in later
            # filings; the FIRST filing is when the market learned it.
            if end not in by_end or filed < by_end[end][1]:
                by_end[end] = (end, filed, v)
    return sorted(by_end.values())


def _nav_known(facts, date):
    """(period_end, filed, nav) of the latest NAV filed strictly before `date`
    and not stale, else None."""
    known = [f for f in facts if f[1] < date]
    if not known:
        return None
    f = max(known)
    age = (dt.date.fromisoformat(date) - dt.date.fromisoformat(f[0])).days
    return f if age <= NAV_MAX_AGE_DAYS else None


def nav_asof(facts, date):
    f = _nav_known(facts, date)
    return f[2] if f else None


def basket_points(prices, navs):
    """prices: {ticker: {date: close}}; navs: {ticker: facts}. -> [[date, median p/nav]]"""
    dates = sorted({d for p in prices.values() for d in p})
    out = []
    for d in dates:
        r = []
        for t, p in prices.items():
            c, n = p.get(d), nav_asof(navs.get(t) or [], d)
            if c and n:
                r.append(c / n)
        if len(r) >= MIN_NAMES:
            out.append([d, round(statistics.median(r), 4)])
    return out


def _sb_prices():
    import requests
    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    out, off = {}, 0
    while True:
        r = requests.get(f"{url}/rest/v1/prices_eod", headers=h, timeout=60, params={
            "select": "ticker,trade_date,close",
            "ticker": f"in.({','.join(BDCS)})",
            "trade_date": f"gte.{PRICES_FROM}",
            "order": "trade_date.asc,ticker.asc", "limit": 1000, "offset": off})
        r.raise_for_status()
        rows = r.json()
        for x in rows:
            if x.get("close") is not None:
                out.setdefault(x["ticker"], {})[str(x["trade_date"])[:10]] = float(x["close"])
        if len(rows) < 1000:
            return out
        off += 1000


def _merge_history(key, entry):
    hist = json.load(open(HISTORY_PATH)) if os.path.exists(HISTORY_PATH) else {}
    before = set(hist)
    hist[key] = entry
    if before - set(hist):
        raise RuntimeError("REFUSING — would drop keys")
    with open(HISTORY_PATH, "w") as f:
        json.dump(hist, f, separators=(",", ":"))


def run():
    import requests, time
    sym2cik = {str(v["ticker"]).upper(): int(v["cik_str"])
               for v in requests.get(TICKERS_URL, headers=UA, timeout=60).json().values()}
    navs = {}
    for t in BDCS:
        cik = sym2cik.get(t)
        if not cik:
            print(f"  WARNING {t}: no CIK"); continue
        try:
            r = requests.get(CONCEPT_URL.format(cik=cik), headers=UA, timeout=60)
            r.raise_for_status()
            navs[t] = nav_facts(r.json())
            last = navs[t][-1] if navs[t] else None
            print(f"  {t:5s} NAV facts={len(navs[t]):3d} latest={last}")
        except Exception as e:
            print(f"  WARNING {t}: {e}")
        time.sleep(0.15)                       # SEC fair-access: <10 req/s
    prices = _sb_prices()
    pts = basket_points(prices, navs)
    if len(pts) < 60:
        print(f"Only {len(pts)} basket points — not writing."); sys.exit(1)

    today = pts[-1][0]
    detail = []
    for t in BDCS:
        p = prices.get(t) or {}
        if not p or not navs.get(t):
            continue
        d = max(p)
        k = _nav_known(navs[t], d)
        if not k:
            print(f"  {t}: no current NAV for {d} — left out of detail")
            continue
        end, filed, n = k
        detail.append({"ticker": t, "date": d, "close": p[d], "nav": n,
                       "nav_period_end": end, "nav_filed": filed,
                       "price_to_nav": round(p[d] / n, 4)})
    _merge_history("credit_bdc_pnav", {
        "freq": "D", "unit": "x NAV", "as_of": today, "points": pts,
        # No percentile/state yet: price history starts 2025, short of the
        # 3-year window every ranked series uses. Raw ratio only.
        "stats": {"direction": "bw", "ranked": False, "bucket": "Credit",
                  "label": "Listed BDCs: price / reported NAV (median)",
                  "source": "SEC XBRL NetAssetValuePerShare (as filed) + daily closes",
                  "names": sorted(navs)}})
    with open(DETAIL_PATH, "w") as f:
        json.dump({"as_of": today, "basket_median": pts[-1][1], "bdcs": detail}, f, indent=1)
    print(f"\ncredit_bdc_pnav: {len(pts)} pts {pts[0][0]}->{today}, latest {pts[-1][1]} "
          f"({len(detail)} names in detail)")


def selftest():
    ok = True
    cj = {"units": {"USD/shares": [
        {"end": "2026-03-31", "filed": "2026-04-29", "val": 20.0, "form": "10-Q"},
        {"end": "2026-03-31", "filed": "2026-07-30", "val": 20.0, "form": "10-Q"},  # comparative
        {"end": "2026-06-30", "filed": "2026-07-30", "val": 19.0, "form": "10-Q"},
        {"end": "2026-06-30", "filed": "2026-07-30", "val": 9999, "form": "10-Q"},   # junk
        {"end": "2026-06-30", "filed": "2026-07-30", "val": 18.0, "form": "8-K"}]}}
    f = nav_facts(cj)
    c1 = f == [("2026-03-31", "2026-04-29", 20.0), ("2026-06-30", "2026-07-30", 19.0)]
    print(f"  {'OK' if c1 else 'FAIL'} facts: first filing kept, junk + 8-K dropped: {f}"); ok &= c1
    c2 = (nav_asof(f, "2026-07-30") == 20.0 and nav_asof(f, "2026-07-31") == 19.0
          and nav_asof(f, "2026-01-01") is None)
    print(f"  {'OK' if c2 else 'FAIL'} no look-ahead: Q2 NAV applies the session AFTER its filing date"); ok &= c2
    c5 = nav_asof(f, "2026-11-12") == 19.0 and nav_asof(f, "2026-11-13") is None   # 06-30 + 135d = 11-12
    print(f"  {'OK' if c5 else 'FAIL'} stale NAV (>{NAV_MAX_AGE_DAYS}d past period end) dropped"); ok &= c5
    prices = {f"T{i}": {"2026-08-03": 15.0 + i} for i in range(6)}
    navs = {t: f for t in prices}
    b = basket_points(prices, navs)
    exp = round(statistics.median([(15.0 + i) / 19.0 for i in range(6)]), 4)
    c3 = b == [["2026-08-03", exp]]
    print(f"  {'OK' if c3 else 'FAIL'} basket median {b} == {exp}"); ok &= c3
    prices["T0"] = {}
    c4 = basket_points({k: v for k, v in prices.items() if k != "T0"}, navs) == []
    print(f"  {'OK' if c4 else 'FAIL'} fewer than {MIN_NAMES} names -> no point"); ok &= c4
    print("\nSELFTEST", "PASSED" if ok else "FAILED")
    return ok


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    run()
