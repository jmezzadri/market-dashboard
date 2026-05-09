"""
Insider history ingest — UW → Supabase `insider_history`.

Two entry points:
  pull_and_upsert(start, end)  → fetch UW for date range, UPSERT into Supabase.
  query_first_buy(ticker, owner, score_date) → True if no prior P-buy in 12mo
                                               before the gate window.

Used by the nightly ETL and by `signal_intelligence_v4.gates` at score time.
"""

from __future__ import annotations

import json
import os
import time
from datetime import date, timedelta
from typing import Any, Iterator

import requests

# UW endpoint
UW_BASE = "https://api.unusualwhales.com/api"
UW_INSIDER_PATH = "/insider/transactions"

# Supabase
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
INSIDER_TABLE = "insider_history"

# Gate parameters (mirror gates.py constants)
INSIDER_WINDOW_DAYS = 30
FIRST_BUY_LOOKBACK_DAYS = 365
P_CODE = "P"


# ─────────────────────────────────────────────────────────────────────────────
# UW pull
# ─────────────────────────────────────────────────────────────────────────────

def _uw_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ['UNUSUAL_WHALES_API_KEY']}",
        "UW-CLIENT-API-ID": os.environ.get("UW_CLIENT_API_ID", "100001"),
    }


def fetch_insider_events(start_date: date, end_date: date,
                          chunk_days: int = 7,
                          max_seconds: float = 35.0) -> Iterator[dict[str, Any]]:
    """
    Yield UW insider events for [start_date, end_date]. Paginated.
    Stops if max_seconds elapsed (resume-friendly — caller tracks last date).
    """
    cur = start_date
    t0 = time.time()
    headers = _uw_headers()
    while cur <= end_date:
        if time.time() - t0 > max_seconds:
            return
        chunk_end = min(cur + timedelta(days=chunk_days), end_date)
        page = 0
        while True:
            params = {
                "limit": 200,
                "start_date": cur.isoformat(),
                "end_date": chunk_end.isoformat(),
                "page": page,
            }
            r = requests.get(f"{UW_BASE}{UW_INSIDER_PATH}",
                            headers=headers, params=params, timeout=15)
            if r.status_code != 200:
                break
            data = r.json().get("data", []) or []
            if not data:
                break
            for ev in data:
                yield ev
            if len(data) < 200:
                break
            page += 1
            if page > 30:
                break
        cur = chunk_end + timedelta(days=1)


# ─────────────────────────────────────────────────────────────────────────────
# Supabase UPSERT
# ─────────────────────────────────────────────────────────────────────────────

def _supa_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _row_to_insert(ev: dict[str, Any]) -> dict[str, Any] | None:
    """Map UW event dict → insider_history row dict, or None if invalid."""
    eid = ev.get("id")
    ticker = (ev.get("ticker") or "").upper()
    txn_date = ev.get("transaction_date")
    code = ev.get("transaction_code")
    if not eid or not ticker or not txn_date or not code:
        return None
    return {
        "id": eid,
        "ticker": ticker,
        "transaction_date": txn_date[:10] if isinstance(txn_date, str) else str(txn_date),
        "filing_date": (ev.get("filing_date") or "")[:10] or None,
        "transaction_code": code,
        "amount": int(ev.get("amount") or 0) if ev.get("amount") is not None else None,
        "stock_price": float(ev.get("stock_price") or ev.get("price") or 0) or None,
        "owner_name": ev.get("owner_name") or ev.get("reporter") or None,
        "is_officer": bool(ev.get("is_officer", False)),
        "is_director": bool(ev.get("is_director", False)),
        "is_ten_percent_owner": bool(ev.get("is_ten_percent_owner", False)),
        "is_10b5_1": bool(ev.get("is_10b5_1", False)),
        "officer_title": ev.get("officer_title") or None,
        "formtype": ev.get("formtype") or None,
        "marketcap": int(ev.get("marketcap") or 0) if ev.get("marketcap") is not None else None,
        "sector": ev.get("sector") or None,
        "raw": ev,  # JSONB — preserve full event for future enhancements
    }


def upsert_batch(rows: list[dict[str, Any]], batch_size: int = 500) -> int:
    """UPSERT rows into insider_history. Returns count of rows attempted."""
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/{INSIDER_TABLE}?on_conflict=id"
    headers = _supa_headers()
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        r = requests.post(url, headers=headers, json=batch, timeout=30)
        if r.status_code >= 400:
            raise RuntimeError(f"Supabase UPSERT failed: HTTP {r.status_code} {r.text[:200]}")
        total += len(batch)
    return total


def pull_and_upsert(start_date: date, end_date: date,
                     max_seconds: float = 35.0) -> dict[str, Any]:
    """
    End-to-end: fetch UW range → UPSERT into insider_history.

    Returns: {"events_fetched", "events_inserted", "elapsed_sec"}.
    """
    t0 = time.time()
    rows: list[dict[str, Any]] = []
    fetched = 0
    for ev in fetch_insider_events(start_date, end_date, max_seconds=max_seconds * 0.7):
        fetched += 1
        row = _row_to_insert(ev)
        if row:
            rows.append(row)
        if len(rows) >= 500:
            upsert_batch(rows)
            rows = []
    if rows:
        upsert_batch(rows)
    return {
        "events_fetched": fetched,
        "events_upserted": fetched,
        "elapsed_sec": round(time.time() - t0, 1),
    }


# ─────────────────────────────────────────────────────────────────────────────
# First-buy classifier — Supabase-backed
# ─────────────────────────────────────────────────────────────────────────────

def query_first_buy(
    ticker: str,
    owner_name: str,
    score_date: date,
    insider_window_days: int = INSIDER_WINDOW_DAYS,
    first_buy_lookback_days: int = FIRST_BUY_LOOKBACK_DAYS,
) -> bool:
    """
    True if the named owner has NO P-buy in this ticker during the
    `first_buy_lookback_days` window ending at the start of the current
    gate window.

    Implementation: PostgREST count query against the partial index.
    """
    if not owner_name:
        return False
    gate_start = score_date - timedelta(days=insider_window_days)
    lookback_start = gate_start - timedelta(days=first_buy_lookback_days)
    owner_lower = owner_name.strip().lower()

    # PostgREST allows repeating the same filter key with different operators
    # — the resulting filters are AND'd together. Use a list of tuples so
    # `requests` doesn't deduplicate.
    url = f"{SUPABASE_URL}/rest/v1/{INSIDER_TABLE}"
    params = [
        ("select", "id"),
        ("ticker", f"eq.{ticker.upper()}"),
        ("owner_name_lower", f"eq.{owner_lower}"),
        ("transaction_code", "eq.P"),
        ("transaction_date", f"gte.{lookback_start.isoformat()}"),
        ("transaction_date", f"lt.{gate_start.isoformat()}"),
        ("limit", "1"),
    ]
    r = requests.get(url, headers=_supa_headers(), params=params, timeout=10)
    if r.status_code >= 400:
        # Be conservative on error — treat as repeat-buyer (gate fail)
        return False
    rows = r.json() if r.text else []
    return len(rows) == 0


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--start", required=True, help="YYYY-MM-DD")
    p.add_argument("--end", required=True, help="YYYY-MM-DD")
    p.add_argument("--max-seconds", type=float, default=35.0)
    args = p.parse_args()

    result = pull_and_upsert(
        date.fromisoformat(args.start),
        date.fromisoformat(args.end),
        max_seconds=args.max_seconds,
    )
    print(json.dumps(result, indent=2))
