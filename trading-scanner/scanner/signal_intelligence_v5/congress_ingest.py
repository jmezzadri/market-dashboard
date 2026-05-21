"""
Congress trades ingest — UW /congress/recent-trades -> congress_trades_daily.

Pulls recent congressional disclosures and persists them keyed by
(ticker, disclosure_id). Idempotent UPSERT. The endpoint returns the most
recent disclosures site-wide; we walk pagination until we've covered the
target lookback window.

Default lookback for daily refresh = 14 days (window covers cron drift +
late filings). Backfill mode walks 365 days for one-time history hydrate.

Party affiliation (bug #1098): the /congress/recent-trades rows carry a
politician_id but no party. UW exposes the party on a separate politician
roster at /congress/politicians. At the start of each run we pull that
roster once, build a {politician_id: party} map, and stamp `party` (and the
`politician_id` column) onto every row we write.
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
UW_POLITICIANS_PATH = "/congress/politicians"
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


def _uw_get(url: str, params: dict[str, Any] | None = None,
            retries: int = 4) -> requests.Response:
    """GET a UW endpoint with 429-aware retry.

    UW's per-minute rate-limit window is 60s, so a 429 has to wait the
    window out — short exponential backoff is not enough. We honour the
    x-uw-req-per-minute-reset header when UW sends it, else fall back to a
    45s sleep. Without this, a transient 429 makes the whole ingest bail
    and silently write nothing.
    """
    last: requests.Response | None = None
    for attempt in range(retries + 1):
        last = requests.get(url, headers=_uw_headers(), params=params or {},
                            timeout=20)
        if last.status_code == 429 and attempt < retries:
            reset = last.headers.get("x-uw-req-per-minute-reset")
            try:
                wait = int(reset) + 5
            except (TypeError, ValueError):
                wait = 45
            time.sleep(wait)
            continue
        return last
    return last  # type: ignore[return-value]


def fetch_politician_party_map() -> dict[str, str]:
    """Build a {politician_id: party} map from UW /congress/politicians.

    One bulk call. The roster carries politician_id, party, chamber and
    gender for every current member of Congress. Returns {} on any failure
    so a roster hiccup never blocks the trade ingest — affected rows simply
    go in with party = None and the daily run picks them up next time.
    """
    try:
        r = _uw_get(f"{UW_BASE}{UW_POLITICIANS_PATH}")
        if r.status_code != 200:
            return {}
        data = r.json().get("data") or []
    except Exception:
        return {}
    out: dict[str, str] = {}
    for p in data:
        if not isinstance(p, dict):
            continue
        pid = p.get("politician_id") or p.get("id")
        party = p.get("party")
        if pid and party:
            out[str(pid)] = str(party)
    return out


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
    page = 0
    while page < max_pages:
        params = {"limit": limit_per_page, "page": page}
        r = _uw_get(f"{UW_BASE}{UW_PATH}", params)
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


def _row_to_insert(ev: dict[str, Any],
                   party_map: dict[str, str] | None = None) -> dict[str, Any] | None:
    """Map UW disclosure event -> congress_trades_daily row.

    Real UW keys: name, ticker, txn_type, amounts, transaction_date,
    filed_at_date, politician_id, member_type, reporter, issuer.

    `party_map` is the {politician_id: party} roster from
    fetch_politician_party_map(); when present, the row's party is resolved
    from it via the event's politician_id.
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
    politician_id = ev.get("politician_id")
    party = None
    if politician_id and party_map:
        party = party_map.get(str(politician_id))
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
        "politician_id": str(politician_id) if politician_id else None,
        "party": party,
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
    party_map = fetch_politician_party_map()
    rows: list[dict[str, Any]] = []
    fetched = 0
    for ev in fetch_disclosures(days_back=days_back):
        if time.time() - t0 > max_seconds:
            break
        fetched += 1
        row = _row_to_insert(ev, party_map)
        if row:
            rows.append(row)
    upserted = upsert_rows(rows)
    rows_with_party = sum(1 for r in rows if r.get("party"))
    return {
        "events_fetched": fetched,
        "rows_prepared": len(rows),
        "rows_upserted": upserted,
        "politicians_in_roster": len(party_map),
        "rows_with_party": rows_with_party,
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
