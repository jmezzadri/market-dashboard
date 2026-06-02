#!/usr/bin/env python3
"""
backfill_benchmarks.py — pull FULL multi-year daily history for benchmark
indices, sector/commodity/bond ETFs, and mega-caps into prices_eod, so the
ticker-detail chart can compare against and overlay them over real timeframes.

Why
---
The benchmark ETFs (SPY/QQQ/IWM/DIA) only had ~24 days in prices_eod (the
Massive daily ingest started 2026-04-27 and these were never backfilled), so
"compare to S&P 500" on the ticker page could only draw ~1 month and the
indexed rebasing anchored to a recent date — i.e. broken (Joe 2026-06-02).
The scanner's own names get a deep backfill when they launch; benchmarks and
overlay candidates didn't. This one-shot yfinance pull fixes that and seeds a
broad overlay universe.

Idempotent: re-runs overwrite the same (ticker, trade_date) rows.
Run via the BENCHMARK-PRICES-BACKFILL workflow (workflow_dispatch).
"""
import json, os, sys
from datetime import date, timedelta
from urllib.request import Request, urlopen

YEARS_BACK = 6
SOURCE_TAG = "yfinance-benchmark-backfill"
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SR_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Broad overlay universe: indices, sectors, commodities, bonds, mega-caps.
TICKERS = [
    # Broad-market / index ETFs
    "SPY", "QQQ", "IWM", "DIA", "VTI", "EFA", "EEM", "VEA", "VWO",
    # GICS sector ETFs
    "XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
    # Commodities / currency
    "GLD", "SLV", "USO", "UNG", "DBC", "UUP", "DBA", "PDBC",
    # Bonds / rates / credit
    "TLT", "IEF", "SHY", "AGG", "BND", "HYG", "LQD", "TIP",
    # Volatility proxy
    "VIXY",
    # Mega-caps (common overlay references)
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
    "BRK-B", "JPM", "XOM", "UNH", "V", "WMT", "AVGO", "LLY",
]


def supabase_upsert(rows):
    if not rows:
        return
    body = json.dumps(rows, default=str).encode()
    req = Request(
        f"{SUPABASE_URL}/rest/v1/prices_eod",
        data=body,
        headers={
            "apikey": SR_KEY, "Authorization": f"Bearer {SR_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }, method="POST")
    urlopen(req).read()


def fetch_scanner_universe():
    """Distinct tickers that have appeared in the scanner over the last ~90
    days — the names a user can actually land on at /ticker/<sym>. The scanner
    backfills a name ~16 months deep when it first launches; this deepens them
    to the full 6-year window so the chart's 5Y / Max presets are real, not a
    16-month stub. Self-maintaining: whatever the scanner has surfaced recently
    gets deepened, no static list to keep in sync."""
    since = (date.today() - timedelta(days=90)).isoformat()
    url = (f"{SUPABASE_URL}/rest/v1/trading_opps_signals"
           f"?select=ticker&scan_date=gte.{since}&limit=20000")
    req = Request(url, headers={"apikey": SR_KEY, "Authorization": f"Bearer {SR_KEY}"})
    try:
        data = json.loads(urlopen(req).read())
        names = sorted({r["ticker"] for r in data if r.get("ticker")})
        print(f"Scanner universe: {len(names)} distinct names from the last 90 days")
        return names
    except Exception as e:
        print(f"  scanner-universe fetch failed (continuing with overlay list only): {e}")
        return []


def main():
    import yfinance as yf
    end = date.today()
    start = end - timedelta(days=YEARS_BACK * 366)
    tickers = sorted(set(TICKERS) | set(fetch_scanner_universe()))
    print(f"Backfilling {len(tickers)} tickers (overlay universe + scanner names), {start} → {end} …")

    BATCH = 25
    total = 0
    for i in range(0, len(tickers), BATCH):
        batch = tickers[i:i + BATCH]
        print(f"  batch {i//BATCH + 1}: {batch}")
        try:
            df = yf.download(
                tickers=" ".join(batch),
                start=start.isoformat(),
                end=(end + timedelta(days=1)).isoformat(),
                group_by="ticker", auto_adjust=False, progress=False, threads=True,
            )
        except Exception as e:
            print(f"    yfinance error: {e}")
            continue
        rows = []
        for tk in batch:
            try:
                d = df[tk] if tk in df else None
                if d is None or d.empty:
                    print(f"    {tk}: no data")
                    continue
                n = 0
                for trade_date, r in d.iterrows():
                    c = float(r["Close"]) if r["Close"] == r["Close"] else None
                    if c is None:
                        continue
                    g = lambda k: (float(r[k]) if r[k] == r[k] else None)
                    rows.append({
                        "ticker": tk,
                        "trade_date": trade_date.date().isoformat() if hasattr(trade_date, "date") else str(trade_date)[:10],
                        "open": g("Open"), "high": g("High"), "low": g("Low"), "close": c,
                        "volume": int(r["Volume"]) if r["Volume"] == r["Volume"] else 0,
                        "vwap": None, "transactions": None, "source": SOURCE_TAG,
                    })
                    n += 1
                print(f"    {tk}: {n} closes")
            except Exception as e:
                print(f"    {tk} parse error: {e}")
        for j in range(0, len(rows), 500):
            supabase_upsert(rows[j:j + 500])
        total += len(rows)

    print(f"Done. Total rows upserted: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
