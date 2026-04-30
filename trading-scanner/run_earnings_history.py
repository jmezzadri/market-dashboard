"""Refresh public.earnings_history with last 4 quarters per tracked ticker.

Bug #1134 item 5. Modal Earnings & Events tile reads this table to render a
last-4-quarters beats/misses strip.

Source: yfinance Ticker.earnings_history — returns a small DataFrame with
EPS estimate, EPS actual, and surprise %. Free, no key, but rate-limited
client-side. We chunk and sleep to stay polite.

Universe: starts from public.universe_snapshots (latest day) so we cover
every ticker the dashboard might open. ~1,300 tickers × 4 quarters = ~5,200
rows total — fits comfortably in one batch upsert.

Run cadence: weekly (most companies report once a quarter — daily would
mostly write the same row over and over).

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
        python -m run_earnings_history
"""

from __future__ import annotations

import os
import sys
import time
from typing import List, Dict, Any

import requests
import yfinance as yf

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

BATCH = 100
SLEEP_BETWEEN_TICKERS = 0.3  # ~3 req/sec → polite to yfinance


def latest_universe() -> List[str]:
    """Return tickers from the most-recent universe_snapshots day."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/universe_snapshots?select=snapshot_ts&order=snapshot_ts.desc&limit=1",
        headers=HEADERS, timeout=30,
    )
    r.raise_for_status()
    j = r.json()
    if not j:
        print("[earnings] universe_snapshots empty — nothing to refresh.")
        return []
    latest_ts = j[0]["snapshot_ts"]
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/universe_snapshots"
        f"?select=ticker&snapshot_ts=eq.{latest_ts}",
        headers=HEADERS, timeout=60,
    )
    r.raise_for_status()
    return [row["ticker"] for row in r.json()]


def fetch_one(ticker: str) -> List[Dict[str, Any]]:
    """Return up-to-4 latest reported quarters from yfinance."""
    import pandas as pd  # local import keeps the top of the file lean
    try:
        eh = yf.Ticker(ticker).earnings_history
    except Exception as e:
        print(f"[earnings] {ticker}: yf error: {e}")
        return []
    if eh is None or eh.empty:
        return []
    rows: List[Dict[str, Any]] = []
    # yfinance returns a DataFrame indexed by quarter end date (Timestamp);
    # columns are epsActual, epsEstimate, epsDifference, surprisePercent.
    # surprisePercent is decimal (0.05 = +5%), so we multiply by 100 below.
    eh = eh.tail(4)
    for idx, row in eh.iterrows():
        try:
            report_date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
        except Exception:
            continue
        est = row.get("epsEstimate")
        act = row.get("epsActual")
        sp  = row.get("surprisePercent")
        beat = None
        if pd.notna(est) and pd.notna(act):
            try:
                beat = float(act) >= float(est)
            except Exception:
                beat = None
        rows.append({
            "ticker": ticker,
            "report_date": report_date_str,
            "fiscal_quarter": None,
            "eps_estimate": float(est) if pd.notna(est) else None,
            "eps_actual": float(act) if pd.notna(act) else None,
            "surprise_pct": (float(sp) * 100) if pd.notna(sp) else None,
            "beat": beat,
        })
    return rows


def upsert(rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/earnings_history",
        headers=HEADERS,
        json=rows,
        timeout=60,
    )
    if not r.ok:
        print(f"[earnings] upsert failed: {r.status_code} {r.text[:300]}")
        r.raise_for_status()


def main() -> int:
    tickers = latest_universe()
    print(f"[earnings] universe size: {len(tickers)}")
    total = 0
    buf: List[Dict[str, Any]] = []
    for i, t in enumerate(tickers):
        rows = fetch_one(t)
        buf.extend(rows)
        total += len(rows)
        if (i + 1) % 50 == 0:
            print(f"[earnings] {i+1}/{len(tickers)} processed — {total} rows so far")
        if len(buf) >= BATCH:
            upsert(buf)
            buf.clear()
        time.sleep(SLEEP_BETWEEN_TICKERS)
    if buf:
        upsert(buf)
    print(f"[earnings] done — wrote {total} rows for {len(tickers)} tickers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
