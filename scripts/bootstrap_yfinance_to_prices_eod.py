#!/usr/bin/env python3
"""
bootstrap_yfinance_to_prices_eod.py — one-shot historical bootstrap of the
18 v9 universe ETFs into public.prices_eod.

Why this script exists
----------------------
Polygon Basic tier silently caps historical aggs at ~2 years (discovered
during PR #9-prep UAT 2026-04-30). compute_v9_allocation.py needs 20+ years
of monthly returns for its multivariate regression to produce stable picks.
The hybrid path Joe approved (Phase 3 popup 2026-04-30 option C):
  1. ONE-SHOT yfinance pull populates prices_eod with 2003-01-01 → 2024-04-29
     history (the part Polygon won't give us). Source tag: 'yfinance-bootstrap'.
  2. Massive's MASSIVE-DAILY workflow already carries it forward from
     2024-04-30 onward (source='massive').
  3. PR #9-final swaps compute_v9_allocation.py from yf.download to a
     Supabase prices_eod read. yfinance never runs in the v9 pipeline again
     after this bootstrap.

Tickers (18) — must match EQUITY + DEFENSIVE in compute_v9_allocation.py:
  EQUITY    (14): IGV SOXX IBB XLF XLV XLI XLE XLY XLP XLU XLB IYR IYZ MGK
  DEFENSIVE  (4): BIL TLT GLD LQD

Date range
----------
Start: 2003-01-01 (matches the v9 regression's expected window)
End:   2024-04-29 (last trading day BEFORE Massive started ingesting
       2024-04-30+; we let Massive own everything from 2024-04-30 forward)

Trigger: GitHub Actions workflow_dispatch (one-shot). Wall-clock ~2-3 min
since yfinance is unauth and bulk-friendly (one Yahoo call per ticker
returns the full ~5,300 trading days at once).

Idempotency: upsert on (ticker, trade_date) PK. Re-running is safe; rows
already in the bootstrap window get overwritten.
"""
import json
import os
import sys
from datetime import date
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError

START_DATE = "2003-01-01"
END_DATE = "2024-04-29"     # day before Massive ingest start; non-overlapping with source='massive'

TICKERS = [
    "IGV", "SOXX", "IBB", "XLF", "XLV", "XLI", "XLE", "XLY",
    "XLP", "XLU", "XLB", "IYR", "IYZ", "MGK",
    "BIL", "TLT", "GLD", "LQD",
]

# ──────────────────────────────────────────────────────────────────
def env(name):
    v = os.environ.get(name, "").strip()
    if not v:
        raise SystemExit(f"missing env var: {name}")
    return v

def supabase_upsert(url, key, table, rows, on_conflict, chunk=500):
    if not rows:
        return 0
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}?{urlencode({'on_conflict': on_conflict})}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    total = 0
    for i in range(0, len(rows), chunk):
        slice_ = rows[i:i+chunk]
        body = json.dumps(slice_).encode("utf-8")
        req = Request(endpoint, data=body, method="POST")
        for h, v in headers.items():
            req.add_header(h, v)
        try:
            with urlopen(req, timeout=120) as r:
                if r.status >= 300:
                    raise RuntimeError(f"upsert {table} HTTP {r.status}")
                total += len(slice_)
        except HTTPError as e:
            try: body = e.read().decode("utf-8")
            except Exception: body = str(e)
            raise RuntimeError(f"upsert {table} HTTP {e.code}: {body[:300]}")
    return total

# ──────────────────────────────────────────────────────────────────
def fetch_yf_history(ticker):
    """One bulk yfinance pull for one ticker. Returns list of dicts."""
    import yfinance as yf
    import pandas as pd
    df = yf.download(ticker, start=START_DATE, end=END_DATE,
                     progress=False, auto_adjust=False, threads=False)
    if df.empty:
        return []
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    rows = []
    for d, row in df.iterrows():
        # yfinance returns Timestamp index; coerce to ISO date
        try:
            iso = d.strftime("%Y-%m-%d")
        except Exception:
            iso = str(d)[:10]
        # auto_adjust=False so we get raw OHLC + 'Adj Close'. We store CLOSE
        # (unadjusted) to match Massive's Daily Market Summary which is also
        # split-adjusted but not dividend-adjusted. compute_v9_allocation.py
        # uses pct_change which is robust to either choice as long as the
        # series is internally consistent.
        rows.append({
            "ticker":       ticker,
            "trade_date":   iso,
            "open":         _f(row.get("Open")),
            "high":         _f(row.get("High")),
            "low":          _f(row.get("Low")),
            "close":        _f(row.get("Close")),
            "volume":       _i(row.get("Volume")),
            "vwap":         None,            # yfinance doesn't expose VWAP for daily
            "transactions": None,            # yfinance doesn't expose tx count
            "source":       "yfinance-bootstrap",
        })
    return rows

def _f(v):
    try:
        if v is None: return None
        f = float(v)
        return f if f == f else None  # NaN check
    except Exception:
        return None

def _i(v):
    try:
        if v is None: return None
        i = int(v)
        return i
    except Exception:
        return None

def main():
    URL = env("SUPABASE_URL")
    SK  = env("SUPABASE_SERVICE_ROLE_KEY")
    print(f"yfinance bootstrap → prices_eod (source='yfinance-bootstrap')")
    print(f"window: {START_DATE} → {END_DATE}")
    print(f"tickers ({len(TICKERS)}): {' '.join(TICKERS)}")
    print()

    grand_total = 0
    failures = []
    for i, t in enumerate(TICKERS, 1):
        print(f"[{i:2}/{len(TICKERS)}] {t} …", flush=True)
        try:
            rows = fetch_yf_history(t)
        except Exception as e:
            print(f"   ! fetch failed: {e}")
            failures.append((t, str(e)))
            continue
        if not rows:
            print("   (no rows returned)")
            continue
        n = supabase_upsert(URL, SK, "prices_eod", rows, "ticker,trade_date")
        grand_total += n
        first = rows[0]["trade_date"]; last = rows[-1]["trade_date"]
        print(f"   upserted {n} bars ({first} → {last})")

    print()
    print(f"DONE. Total bars upserted: {grand_total}")
    if failures:
        print(f"FAILURES: {len(failures)}")
        for t, e in failures:
            print(f"  {t}: {e}")
        sys.exit(2)
    print("OK — bootstrap complete. Next step: PR #9-final swaps compute_v9_allocation.py.")

if __name__ == "__main__":
    main()
