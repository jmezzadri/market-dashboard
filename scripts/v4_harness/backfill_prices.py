"""
Backfill prices_eod via yfinance for the v4.1 backtest universe.
v2: handle dot-tickers (LEN.B -> LEN-B for yfinance), allow partial coverage.
"""
from __future__ import annotations
import os, sys, json, time, math, argparse
from datetime import date, datetime, timedelta
import requests
import pandas as pd
import yfinance as yf

SUPABASE_URL = "https://yqaqqzseepebrocgibcw.supabase.co"
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PROJECT_REF = "yqaqqzseepebrocgibcw"

START = "2025-02-01"
END   = "2026-05-09"
BATCH = 50

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

def mgmt_query(sql):
    r = requests.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {SUPABASE_TOKEN}", "Content-Type": "application/json"},
        json={"query": sql},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()

def get_universe():
    sql = """
        SELECT tr.ticker
        FROM ticker_reference tr
        JOIN universe_master um USING (ticker)
        WHERE um.active = true
          AND um.type IN ('CS','ADRC')
          AND tr.market_cap BETWEEN 300e6 AND 25e9
          AND COALESCE(tr.share_class_shares_outstanding, tr.weighted_shares_outstanding) IS NOT NULL
        ORDER BY tr.ticker;
    """
    rows = mgmt_query(sql)
    return [r["ticker"] for r in rows]

def get_attempted_tickers():
    """Tickers that already have ANY rows from the v4 backfill - skip these."""
    sql = """
        SELECT DISTINCT ticker FROM prices_eod
        WHERE source IN ('yfinance-v4-backfill','yfinance-v4-attempted')
        AND trade_date >= '2025-02-01';
    """
    rows = mgmt_query(sql)
    return set(r["ticker"] for r in rows)

def yf_symbol(t):
    """ticker_reference uses dots; yfinance uses dashes for share-class suffixes."""
    return t.replace(".", "-")

def upsert_prices(rows):
    if not rows: return 0
    url = f"{SUPABASE_URL}/rest/v1/prices_eod?on_conflict=ticker,trade_date"
    chunk = 1000
    total = 0
    for i in range(0, len(rows), chunk):
        sub = rows[i:i+chunk]
        r = requests.post(url, headers=HEADERS, data=json.dumps(sub), timeout=120)
        if r.status_code >= 300:
            print(f"  ! upsert fail {r.status_code}: {r.text[:300]}")
            return total
        total += len(sub)
    return total

def to_rows(canonical_ticker, df):
    if df is None or df.empty: return []
    out = []
    for ts, row in df.iterrows():
        try:
            close = float(row["Close"])
            if math.isnan(close): continue
            out.append({
                "ticker": canonical_ticker,  # always store canonical (with dots)
                "trade_date": ts.date().isoformat() if hasattr(ts, "date") else str(ts)[:10],
                "open": None if math.isnan(float(row["Open"])) else float(row["Open"]),
                "high": None if math.isnan(float(row["High"])) else float(row["High"]),
                "low":  None if math.isnan(float(row["Low"]))  else float(row["Low"]),
                "close": close,
                "volume": 0 if math.isnan(float(row["Volume"])) else float(row["Volume"]),
                "vwap": None,
                "transactions": None,
                "source": "yfinance-v4-backfill",
            })
        except Exception:
            continue
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-batch", type=int, default=0)
    ap.add_argument("--end-batch", type=int, default=10**9)
    args = ap.parse_args()

    print(f"[{datetime.now().isoformat(timespec='seconds')}] fetching universe...")
    universe = get_universe()
    attempted = get_attempted_tickers()
    todo = [t for t in universe if t not in attempted]
    n_batches = (len(todo) + BATCH - 1) // BATCH
    print(f"  universe={len(universe)} attempted={len(attempted)} todo={len(todo)} batches={n_batches}")
    print(f"  running batches [{args.start_batch}, {min(args.end_batch, n_batches)})")

    total_rows = 0
    failures = []
    t0 = time.time()
    for b in range(args.start_batch, min(args.end_batch, n_batches)):
        i = b * BATCH
        batch = todo[i:i+BATCH]
        if not batch: continue
        elapsed = int(time.time() - t0)
        print(f"  [{elapsed:>5d}s] batch {b+1}/{n_batches}  ({batch[0]}..{batch[-1]})", flush=True)
        # Map to yfinance symbols
        yf_to_canonical = {yf_symbol(t): t for t in batch}
        yf_syms = list(yf_to_canonical.keys())
        try:
            data = yf.download(
                tickers=" ".join(yf_syms),
                start=START, end=END,
                progress=False, group_by="ticker",
                auto_adjust=False, threads=True, timeout=30,
            )
        except Exception as e:
            print(f"    download failed: {e}")
            failures.extend(batch)
            continue

        rows = []
        attempted_marker_rows = []
        if isinstance(data.columns, pd.MultiIndex):
            level0 = set(data.columns.get_level_values(0))
            for yfs, canon in yf_to_canonical.items():
                if yfs in level0:
                    df = data[yfs].dropna(subset=["Close"])
                    rows.extend(to_rows(canon, df))
                else:
                    failures.append(canon)
        else:
            # single ticker
            yfs = yf_syms[0]
            canon = yf_to_canonical[yfs]
            if not data.empty:
                rows.extend(to_rows(canon, data.dropna(subset=["Close"])))
            else:
                failures.append(canon)

        # Mark every attempted ticker so we don't re-try (use a sentinel row).
        # Simpler: just upsert what we have. The skip filter checks for ANY row.
        n = upsert_prices(rows)
        total_rows += n
        # For tickers with zero rows, write a sentinel so we don't re-try forever.
        zero_tickers = [canon for yfs, canon in yf_to_canonical.items()
                        if not any(r["ticker"] == canon for r in rows)]
        if zero_tickers:
            sentinels = [{
                "ticker": t,
                "trade_date": "1970-01-01",
                "open": None, "high": None, "low": None,
                "close": 0, "volume": 0, "vwap": None, "transactions": None,
                "source": "yfinance-v4-attempted",
            } for t in zero_tickers]
            upsert_prices(sentinels)
        print(f"    upserted {n} rows  ({len(zero_tickers)} no-data tickers, sentinel'd)")

    print(f"\n[done] total rows upserted: {total_rows}")
    print(f"failures: {len(failures)}")

if __name__ == "__main__":
    main()
