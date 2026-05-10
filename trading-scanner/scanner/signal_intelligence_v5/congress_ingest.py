"""
Congress trades ingest — UW /congress/recent-trades -> congress_trades_daily.

Pulls recent congressional disclosures and persists them keyed by
(ticker, disclosure_id). Idempotent UPSERT. The endpoint returns the most
recent disclosures site-wide; we walk pagination until we've covered the
target lookback window.

Default lookback for daily refresh = 14 days (window covers cron drift +
late filings). Backfill mode walks 365 days for one-time history hydrate.
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import date, datetime, timedelta
from typing import Any, Iterator

import requests


UW_BASE = "https://api.unusualwhales.com/api"
UW_PATH = "/congress/recent-trades"
TABLE = "congress_trades_daily"


# UW disclosure-bucket parsing (e.g. "$15,001 - $50,000")
BUCKET_RE = re.compile(r"\$([\d,]+)(?:\s*-\s*\$([\d,]+))?")


def _supa_url() -> str:
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _supa_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _uw_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ['UNUSUAL_WHALES_API_KEY']}",
        "UW-CLIENT-API-ID": os.environ.get("UW_CLIENT_API_ID", "100001"),
    }


def _parse_bucket(bucket: str | None) -> tuple[float | None, float | None]:
    if not bucket:
        return None, None
    m = BUCKET_RE.findall(bucket)
    if not m:
        return None, None
    nums = []
    for grp in m:
        for s in grp:
            if s:
                try:
                    nums.append(float(s.replace(",", "")))
                except ValueError:
                    pass
    if not nums:
        return None, None
    if len(nums) == 1:
        return nums[0], None
    return nums[0], nums[1]


def fetch_disclosures(days_back: int = 14, max_pages: int = 50,
                      limit_per_page: int = 200) -> Iterator[dict[str, Any]]:
    """Yield UW congress disclosures most-recent-first, until cutoff or empty page.

    Real UW response keys: name, ticker, txn_type ('Buy'/'Sell'), amounts,
    transaction_date (YYYY-MM-DD), filed_at_date, politician_id, member_type
    ('senate'/'house'), reporter, issuer, notes.
    """
    cutoff = (datetime.utcnow().date() - timedelta(days=days_back)).isoformat()
    headers = _uw_headers()
    page = 0
    while page < max_pages:
        params = {"limit": limit_per_page, "page": page}
        r = requests.get(f"{UW_BASE}{UW_PATH}", headers=headers,
                         params=params, timeout=20)
        if r.status_code != 200:
            return
        data = r.json().get("data") or []
        if not data:
            return
        any_in_window = False
        for ev in data:
            t = ev.get("transaction_date") or ev.get("trans_date") or ""
            if isinstance(t, str) and t and t[:10] >= cutoff:
                any_in_window = True
                yield ev
        if not any_in_window:
            return
        if len(data) < limit_per_page:
            return
        page += 1


def _row_to_insert(ev: dict[str, Any]) -> dict[str, Any] | None:
    """Map UW disclosure event -> congress_trades_daily row.

    Real UW keys: name, ticker, txn_type, amounts, transaction_date,
    filed_at_date, politician_id, member_type, reporter, issuer.
    """
    ticker = (ev.get("ticker") or "").upper()
    txn_date = ev.get("transaction_date") or ev.get("trans_date")
    if not ticker or not txn_date:
        return None
    bucket = (
        ev.get("amounts")
        or ev.get("amount")
        or ev.get("amount_bucket")
        or ev.get("amount_range")
    )
    amin, amax = _parse_bucket(bucket)
    member_name = (
        ev.get("name")
        or ev.get("member_name")
        or ev.get("reporter")
    )
    chamber = ev.get("member_type") or ev.get("chamber")
    txn_type = ev.get("txn_type") or ev.get("transaction_type")
    disclosure_id = (
        ev.get("id")
        or ev.get("transaction_id")
        or f"{ticker}-{txn_date}-{member_name or 'x'}-{txn_type or 'x'}-{bucket or 'x'}"
    )
    return {
        "ticker": ticker,
        "transaction_date": txn_date[:10] if isinstance(txn_date, str) else str(txn_date),
        "disclosure_id": str(disclosure_id),
        "member_name": member_name,
        "chamber": chamber,
        "transaction_type": txn_type,
        "amount_bucket": bucket,
        "amount_min": amin,
        "amount_max": amax,
        "filing_date": (ev.get("filed_at_date") or ev.get("filing_date") or "")[:10] or None,
        "raw": ev,
    }


def upsert_rows(rows: list[dict[str, Any]], batch_size: int = 500) -> int:
    if not rows:
        return 0
    # Dedupe within the batch on the conflict target — Postgres rejects
    # duplicates within a single ON CONFLICT statement.
    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for r in rows:
        key = (r.get("ticker", ""), r.get("disclosure_id", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    url = f"{_supa_url()}/rest/v1/{TABLE}?on_conflict=ticker,disclosure_id"
    total = 0
    for i in range(0, len(deduped), batch_size):
        batch = deduped[i:i + batch_size]
        r = requests.post(url, headers=_supa_headers(), json=batch, timeout=30)
        if r.status_code >= 400:
            raise RuntimeError(f"UPSERT failed: HTTP {r.status_code} {r.text[:200]}")
        total += len(batch)
    return total


def pull_and_upsert(days_back: int = 14, max_seconds: float = 1200.0) -> dict[str, Any]:
    t0 = time.time()
    rows: list[dict[str, Any]] = []
    fetched = 0
    for ev in fetch_disclosures(days_back=days_back):
        if time.time() - t0 > max_seconds:
            break
        fetched += 1
        row = _row_to_insert(ev)
        if row:
            rows.append(row)
    upserted = upsert_rows(rows)
    return {
        "events_fetched": fetched,
        "rows_prepared": len(rows),
        "rows_upserted": upserted,
        "days_back": days_back,
        "elapsed_sec": round(time.time() - t0, 1),
    }


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--days-back", type=int, default=14)
    p.add_argument("--max-seconds", type=float, default=1200.0)
    args = p.parse_args()
    print(json.dumps(pull_and_upsert(args.days_back, args.max_seconds), indent=2))
