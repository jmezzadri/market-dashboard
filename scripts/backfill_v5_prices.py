#!/usr/bin/env python3
"""
backfill_v5_prices.py — bulk yfinance backfill for v5-universe tickers
that don't have enough daily closes in prices_eod for the technicals
scorer to compute (needs ~60+ trading days).

Why
---
The Massive (Polygon) daily ingest started writing to prices_eod on
~2026-04-27. For tickers that were added to the v5 universe after that
(or that Massive's universe missed initially — common for ADRs like
TSM), prices_eod has only 10 closes by 2026-05-12. The v5 technicals
scorer needs ~60 closes; without them, the per-ticker dossier shows a
red warning triangle. yfinance is unauth + bulk-friendly, so a one-shot
pull of 365 days for the under-covered v5 names is a clean fix.

Usage
-----
Run with no args via the V5-PRICES-BACKFILL workflow (workflow_dispatch).
Logs the tickers it touched and the rows it upserted.

Idempotent. Re-runs overwrite the same (ticker, trade_date) rows.
"""
import json, os, sys
from datetime import date, timedelta
from urllib.request import Request, urlopen

DAYS_BACK = 400          # ~250 trading days
MIN_CLOSES_THRESHOLD = 60  # v5 technicals needs ~60+ to score
SOURCE_TAG = "yfinance-v5-backfill"
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SR_KEY       = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SA_TOKEN     = os.environ.get("SUPABASE_ACCESS_TOKEN", "")

def supabase_select(table, params):
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    req = Request(
        f"{SUPABASE_URL}/rest/v1/{table}?{qs}",
        headers={"apikey": SR_KEY, "Authorization": f"Bearer {SR_KEY}", "Accept": "application/json"})
    return json.loads(urlopen(req).read().decode())

def supabase_upsert(table, rows):
    if not rows:
        return 0
    body = json.dumps(rows, default=str).encode()
    req = Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=body,
        headers={
            "apikey": SR_KEY, "Authorization": f"Bearer {SR_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }, method="POST")
    return urlopen(req).read()

def mgmt_query(sql):
    if not SA_TOKEN:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN required for ticker-list discovery")
    req = Request(
        f"https://api.supabase.com/v1/projects/{SUPABASE_URL.replace('https://','').split('.')[0]}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {SA_TOKEN}", "Content-Type": "application/json"},
        method="POST")
    return json.loads(urlopen(req).read().decode())

def main():
    # 1. Discover v5 universe tickers with < MIN_CLOSES_THRESHOLD closes.
    print(f"Discovering v5 universe tickers with < {MIN_CLOSES_THRESHOLD} closes…")
    sql = f"""
    WITH v5_universe AS (
      SELECT DISTINCT ticker
      FROM signal_intel_v5_daily
      WHERE scan_date = (SELECT MAX(scan_date) FROM signal_intel_v5_daily)
    ),
    close_counts AS (
      SELECT v.ticker, COALESCE(COUNT(p.*),0) AS n
      FROM v5_universe v
      LEFT JOIN prices_eod p
        ON p.ticker = v.ticker
       AND p.trade_date >= CURRENT_DATE - INTERVAL '400 days'
      GROUP BY v.ticker
    )
    SELECT ticker FROM close_counts WHERE n < {MIN_CLOSES_THRESHOLD}
    ORDER BY ticker;
    """
    rows = mgmt_query(sql)
    tickers = [r["ticker"] for r in rows]
    print(f"  found {len(tickers)} tickers to backfill")
    if not tickers:
        print("nothing to do.")
        return 0

    # 2. yfinance bulk pull — one batch of up to 200 tickers per call.
    import yfinance as yf
    end = date.today()
    start = end - timedelta(days=DAYS_BACK)
    BATCH = 150
    total_upserted = 0
    for i in range(0, len(tickers), BATCH):
        batch = tickers[i:i + BATCH]
        print(f"  batch {i//BATCH + 1} ({len(batch)} tickers)…")
        try:
            df = yf.download(
                tickers=" ".join(batch),
                start=start.isoformat(),
                end=(end + timedelta(days=1)).isoformat(),
                group_by="ticker",
                auto_adjust=False,
                progress=False,
                threads=True,
            )
        except Exception as e:
            print(f"    yfinance error: {e}")
            continue
        rows_to_upsert = []
        for tk in batch:
            try:
                d = df[tk] if tk in df else None
                if d is None or d.empty:
                    continue
                for trade_date, r in d.iterrows():
                    o = float(r["Open"]) if r["Open"] == r["Open"] else None
                    h = float(r["High"]) if r["High"] == r["High"] else None
                    lo = float(r["Low"])  if r["Low"]  == r["Low"]  else None
                    c = float(r["Close"]) if r["Close"] == r["Close"] else None
                    v = int(r["Volume"]) if r["Volume"] == r["Volume"] else 0
                    if c is None: continue
                    rows_to_upsert.append({
                        "ticker": tk,
                        "trade_date": trade_date.date().isoformat() if hasattr(trade_date, "date") else str(trade_date)[:10],
                        "open":   o, "high": h, "low":  lo, "close": c,
                        "volume": v, "vwap": None, "transactions": None,
                        "source": SOURCE_TAG,
                    })
            except Exception as e:
                print(f"    {tk} parse error: {e}")
        # Upsert in 500-row sub-batches.
        for j in range(0, len(rows_to_upsert), 500):
            supabase_upsert("prices_eod", rows_to_upsert[j:j+500])
        total_upserted += len(rows_to_upsert)
        print(f"    upserted {len(rows_to_upsert)} rows from this batch")

    print(f"Done. Total rows upserted: {total_upserted}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
