#!/usr/bin/env python3
"""
scanner-insider_edgar-daily — SEC EDGAR Form 4/4A/5/5A ingest.

Free replacement for the Unusual Whales insider feed. Writes to
public.insider_history_edgar (shadow of insider_history) with
source='edgar'. Idempotent: natural-key unique index + ON CONFLICT
ignore, so any number of re-runs collapse to one dataset.

Approach (proven 2026-07 session): fetch the daily form index, keep
accessions whose ANY associated CIK is in our universe, fetch the full
submission .txt, regex out <ownershipDocument>, parse the XML. Never
rely on primaryDocument filenames.

Usage:
  ingest_form4.py                      # nightly: last 5 calendar days
  ingest_form4.py --start 2026-04-20 --end 2026-05-04   # backfill chunk
"""
import argparse, datetime as dt, json, os, re, sys, time
import xml.etree.ElementTree as ET
import requests

UA = {"User-Agent": os.environ.get(
    "EDGAR_USER_AGENT", "MacroTilt Data Steward josephmezzadri@gmail.com")}
SB_URL = os.environ["SUPABASE_URL"].rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SB_HDR = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}
FORMS = {"4", "4/A", "5", "5/A"}
MIN_INTERVAL = 0.13          # ~7.7 req/s, under SEC's 10/s ceiling
_last = [0.0]

def throttled_get(url, tries=3):
    for i in range(tries):
        wait = MIN_INTERVAL - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        r = requests.get(url, headers=UA, timeout=30)
        if r.status_code == 200:
            return r
        if r.status_code == 404:
            return None
        time.sleep(2 * (i + 1))          # 429/5xx backoff
    print(f"    WARN giving up on {url} (HTTP {r.status_code})")
    return None

def sb_get_all(path_and_query):
    """Explicit limit/offset paging (LESSONS 4.18 — never trust one call)."""
    out, off, page = [], 0, 1000
    while True:
        joiner = "&" if "?" in path_and_query else "?"
        r = requests.get(
            f"{SB_URL}/rest/v1/{path_and_query}{joiner}limit={page}&offset={off}",
            headers=SB_HDR, timeout=60)
        if r.status_code >= 300:
            sys.exit(f"supabase GET {path_and_query} offset {off}: "
                     f"HTTP {r.status_code} {r.text[:200]}")
        rows = r.json()
        out.extend(rows)
        if len(rows) < page:
            return out
        off += page

def load_maps():
    uni = sb_get_all("universe_master?select=ticker,cik&active=is.true&order=ticker")
    tickers = {u["ticker"] for u in uni}
    cik2t = {}
    for u in uni:
        if u["cik"]:
            cik2t.setdefault(int(u["cik"]), set()).add(u["ticker"])
    # fill missing CIKs from SEC's official symbol map
    r = throttled_get("https://www.sec.gov/files/company_tickers.json")
    if r:
        no_cik = tickers - {t for s in cik2t.values() for t in s}
        for v in r.json().values():
            sym = str(v["ticker"]).upper().replace(".", "-")
            if sym in no_cik:
                cik2t.setdefault(int(v["cik_str"]), set()).add(sym)
    ref = sb_get_all("ticker_reference?select=ticker,market_cap,sic_description&order=ticker")
    refmap = {x["ticker"]: x for x in ref}
    print(f"    universe: {len(tickers):,} tickers, {len(cik2t):,} CIKs mapped, "
          f"{len(refmap):,} reference rows")
    return tickers, cik2t, refmap

def daily_accessions(day, cik2t):
    """{accession: (path, filing_date)} for universe-relevant ownership forms."""
    q = (day.month - 1) // 3 + 1
    r = throttled_get(f"https://www.sec.gov/Archives/edgar/daily-index/"
                      f"{day.year}/QTR{q}/form.{day:%Y%m%d}.idx")
    if r is None:
        return {}                                    # weekend / holiday
    pat = re.compile(r"^(4(?:/A)?|5(?:/A)?)\s+.*?\s+(\d+)\s+(\d{8})\s+(edgar/\S+\.txt)\s*$")
    keep = {}
    for line in r.text.splitlines():
        m = pat.match(line)
        if not m:
            continue
        cik = int(m.group(2))
        path = m.group(4)
        acc = path.rsplit("/", 1)[-1].removesuffix(".txt")
        if cik in cik2t:
            keep[acc] = (path, m.group(3))
    return keep

def txt(el, path):
    v = el.findtext(path)
    return v.strip() if v else None

def num(el, path):
    v = txt(el, path)
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def flag(el, path):
    return (txt(el, path) or "").lower() in ("1", "true")

def parse_filing(body, acc, filing_date, tickers, cik2t, refmap):
    rows = []
    for xml_m in re.finditer(r"<ownershipDocument>.*?</ownershipDocument>", body, re.S):
        try:
            x = ET.fromstring(xml_m.group(0))
        except ET.ParseError:
            continue
        form = txt(x, "documentType") or "4"
        sym = (txt(x, "issuer/issuerTradingSymbol") or "").upper().strip()
        sym = sym.replace(".", "-")
        ticker = sym if sym in tickers else None
        if ticker is None:
            icik = txt(x, "issuer/issuerCik")
            cand = cik2t.get(int(icik)) if icik and icik.isdigit() else None
            if cand and len(cand) == 1:
                ticker = next(iter(cand))
        if ticker is None:
            continue
        aff = flag(x, "aff10b5One")
        ref = refmap.get(ticker, {})
        # Lead reporting owner ONLY. Group filings (e.g. an LP + its GP + its
        # fund entities) list 2-4 affiliated owners for the SAME shares; one
        # row per owner would multiply Rule B window dollars and let Rule C
        # (3+ distinct insiders) fire off a single beneficial owner. UW
        # attributes the row to the lead filer -- mirror that exactly.
        owners = x.findall("reportingOwner")[:1]
        for tr in x.findall("nonDerivativeTable/nonDerivativeTransaction"):
            code = txt(tr, "transactionCoding/transactionCode")
            tdate = txt(tr, "transactionDate/value")
            shares = num(tr, "transactionAmounts/transactionShares/value")
            price = num(tr, "transactionAmounts/transactionPricePerShare/value")
            ad = txt(tr, "transactionAmounts/transactionAcquiredDisposedCode/value")
            after = num(tr, "postTransactionAmounts/sharesOwnedFollowingTransaction/value")
            if not (code and tdate and shares is not None):
                continue
            before = None
            if after is not None:
                before = after - shares if ad == "A" else after + shares
            for ro in owners:
                name = txt(ro, "reportingOwnerId/rptOwnerName")
                if not name:
                    continue
                rows.append({
                    "ticker": ticker, "formtype": form,
                    "filing_date": f"{filing_date[:4]}-{filing_date[4:6]}-{filing_date[6:]}",
                    "transaction_date": tdate[:10], "transaction_code": code,
                    "amount": int(round(shares)),
                    "stock_price": price,
                    "owner_name": name,
                    "is_officer": flag(ro, "reportingOwnerRelationship/isOfficer"),
                    "is_director": flag(ro, "reportingOwnerRelationship/isDirector"),
                    "is_ten_percent_owner": flag(ro, "reportingOwnerRelationship/isTenPercentOwner"),
                    "is_10b5_1": aff,
                    "officer_title": txt(ro, "reportingOwnerRelationship/officerTitle"),
                    "marketcap": int(ref["market_cap"]) if ref.get("market_cap") else None,
                    "sector": ref.get("sic_description"),
                    "shares_owned_before": int(round(before)) if before is not None else None,
                    "shares_owned_after": int(round(after)) if after is not None else None,
                    "source": "edgar", "accession_no": acc,
                    "raw": {"acquired_disposed": ad},
                })
    return rows

NATKEY = ("accession_no,owner_name_lower,transaction_date,"
          "transaction_code,amount,stock_price,shares_owned_after")  # generated col fine in conflict target

def insert(rows):
    n = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        r = requests.post(
            f"{SB_URL}/rest/v1/insider_history_edgar?on_conflict={NATKEY}",
            headers={**SB_HDR, "Content-Type": "application/json",
                     "Prefer": "resolution=ignore-duplicates,return=minimal"},
            data=json.dumps(batch), timeout=120)
        if r.status_code >= 300:
            sys.exit(f"insert batch failed: HTTP {r.status_code} {r.text[:300]}")
        n += len(batch)
    return n

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start"); ap.add_argument("--end")
    a = ap.parse_args()
    end = dt.date.fromisoformat(a.end) if a.end else dt.date.today()
    start = (dt.date.fromisoformat(a.start) if a.start
             else end - dt.timedelta(days=5))
    tickers, cik2t, refmap = load_maps()
    day, total_rows, total_filings = start, 0, 0
    while day <= end:
        accs = daily_accessions(day, cik2t)
        rows = []
        for acc, (path, fdate) in accs.items():
            r = throttled_get(f"https://www.sec.gov/Archives/{path}")
            if r is None:
                continue
            rows.extend(parse_filing(r.text, acc, fdate, tickers, cik2t, refmap))
        if rows:
            insert(rows)
        print(f"  {day}: {len(accs):,} filings -> {len(rows):,} rows")
        total_rows += len(rows); total_filings += len(accs)
        day += dt.timedelta(days=1)
    print(f"DONE {start}..{end}: {total_filings:,} filings, {total_rows:,} rows upserted")
    if total_filings == 0 and (end - start).days >= 4:
        sys.exit("FAIL-LOUD: zero filings across a 5+ day window — index fetch broken?")

if __name__ == "__main__":
    main()
