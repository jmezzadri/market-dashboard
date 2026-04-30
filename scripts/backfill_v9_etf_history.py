#!/usr/bin/env python3
"""
backfill_v9_etf_history.py — one-shot historical backfill of the 18 v9
universe ETFs into public.prices_eod.

Why this script exists
----------------------
The Saturday v9 rebalance (compute_v9_allocation.py) reads daily ETF
closes via yfinance over a 20-year window because the optimizer's
multivariate regression needs decades of monthly returns to be
statistically valid.

After this backfill lands, compute_v9_allocation.py can read the same
prices from public.prices_eod (the Massive/Polygon-fed table that the
daily EOD ingest already populates forward), eliminating the yfinance
dependency in the optimizer chain.

Tickers (18) — must match EQUITY + DEFENSIVE in compute_v9_allocation.py:
  EQUITY:    IGV SOXX IBB XLF XLV XLI XLE XLY XLP XLU XLB IYR IYZ MGK
  DEFENSIVE: BIL TLT GLD LQD

Polygon endpoint
----------------
GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}?adjusted=true

Polygon Basic tier serves up to 50,000 bars per call, so 20 years of
daily history (~5,040 bars per ticker) fits in ONE call per ticker.
At 5 calls/minute throttle, total wall-clock is ~4 minutes.

Trigger: GitHub Actions workflow_dispatch (one-shot). After completion,
PR #9 (compute_v9_allocation.py yfinance -> Supabase swap) can land.

Reads MASSIVE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from env.
"""
import json
import os
import sys
import time
from datetime import date, datetime, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError

THROTTLE_SECONDS = 13   # 60s / 5 req per minute, with margin
START_DATE = "2003-01-01"
PAGE_SIZE = 50000

# Must match compute_v9_allocation.py EQUITY + DEFENSIVE keys.
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

def http_json(url, timeout=60):
    req = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8")
            return r.status, json.loads(body)
    except HTTPError as e:
        try: body = e.read().decode("utf-8")
        except Exception: body = str(e)
        return e.code, body
    except URLError as e:
        return 0, str(e)

def supabase_upsert(url, key, table, rows, on_conflict, chunk=500):
    """Upsert rows into a Supabase table via PostgREST. Chunked to avoid 413."""
    if not rows:
        return 0
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}"
    qs = urlencode({"on_conflict": on_conflict})
    full = f"{endpoint}?{qs}"
    headers_base = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    total = 0
    for i in range(0, len(rows), chunk):
        slice_ = rows[i:i+chunk]
        body = json.dumps(slice_).encode("utf-8")
        req = Request(full, data=body, method="POST")
        for h, v in headers_base.items():
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

def update_health(url, key, name, status, msg=""):
    """Mirrors the health write pattern from backfill_massive_initial.py."""
    now = datetime.now(timezone.utc).isoformat()
    row = [{
        "indicator_name": name,
        "status": status,
        "last_good_at": now if status == "green" else None,
        "last_check_at": now,
        "expected_cadence_minutes": 60 * 24 * 365,  # one-shot
        "last_error": (msg or None) if status != "green" else None,
    }]
    try:
        supabase_upsert(url, key, "pipeline_health", row, "indicator_name")
    except Exception as e:
        print(f"  ! pipeline_health write failed for {name}: {e}")

# ──────────────────────────────────────────────────────────────────
def fetch_etf_history(ticker, mkey, end_iso):
    """One call: 20 years of daily aggs for one ticker."""
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/day/"
        f"{START_DATE}/{end_iso}"
        f"?adjusted=true&sort=asc&limit={PAGE_SIZE}&apiKey={mkey}"
    )
    status, body = http_json(url, timeout=60)
    if status >= 300 or not isinstance(body, dict):
        raise RuntimeError(f"{ticker} HTTP {status}: {body if isinstance(body, str) else body.get('error') or body}")
    results = body.get("results") or []
    rows = []
    for b in results:
        if not b.get("t"):
            continue
        # Polygon returns 't' as ms-epoch; convert to YYYY-MM-DD.
        d = datetime.fromtimestamp(b["t"] / 1000.0, tz=timezone.utc).date().isoformat()
        rows.append({
            "ticker":       ticker,
            "trade_date":   d,
            "open":         b.get("o"),
            "high":         b.get("h"),
            "low":          b.get("l"),
            "close":        b.get("c"),
            "volume":       b.get("v"),
            "vwap":         b.get("vw"),
            "transactions": b.get("n"),
            "source":       "massive",
        })
    return rows

def main():
    URL  = env("SUPABASE_URL")
    SK   = env("SUPABASE_SERVICE_ROLE_KEY")
    MKEY = env("MASSIVE_API_KEY")
    end_iso = date.today().isoformat()

    print(f"v9 ETF backfill — {len(TICKERS)} tickers, {START_DATE} → {end_iso}")
    print(f"throttle: {THROTTLE_SECONDS}s between calls (Polygon Basic = 5 req/min)")
    print()

    grand_total = 0
    failures = []
    for i, t in enumerate(TICKERS, 1):
        print(f"[{i:2}/{len(TICKERS)}] {t} …", flush=True)
        try:
            rows = fetch_etf_history(t, MKEY, end_iso)
        except Exception as e:
            print(f"   ! fetch failed: {e}")
            failures.append((t, str(e)))
            continue
        if not rows:
            print("   (no bars returned)")
            continue
        # Upsert in chunks to be safe — even 5,040 rows is one upsert call.
        n = supabase_upsert(URL, SK, "prices_eod", rows, "ticker,trade_date")
        grand_total += n
        first = rows[0]["trade_date"]; last = rows[-1]["trade_date"]
        print(f"   upserted {n} bars ({first} → {last})")
        if i < len(TICKERS):
            time.sleep(THROTTLE_SECONDS)

    print()
    print(f"DONE. Total bars upserted: {grand_total}")
    if failures:
        print(f"FAILURES: {len(failures)}")
        for t, e in failures:
            print(f"  {t}: {e}")
        # Mark health red if any ticker failed.
        update_health(URL, SK, "massive-v9-etf-backfill", "red",
                      f"failed tickers: {','.join(t for t,_ in failures)}")
        sys.exit(2)
    update_health(URL, SK, "massive-v9-etf-backfill", "green",
                  f"{grand_total} bars across {len(TICKERS)} tickers, {START_DATE}+")
    print("OK")

if __name__ == "__main__":
    main()
