"""
Analyst ratings ingest — UW /screener/analysts -> analyst_ratings_daily.

Walks the active v5 universe and pulls last ~90 days of analyst actions
per ticker. Idempotent UPSERT keyed on (ticker, rating_id) where
rating_id = "{timestamp}-{firm}-{action}".
"""

from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests


UW_BASE = "https://api.unusualwhales.com/api"
UW_PATH = "/screener/analysts"
TABLE = "analyst_ratings_daily"


# Static broker tier table — Loh-Stulz (2011) "top broker" anchors plus
# practitioner-known major sell-side. Anything else falls to "other".
BROKER_TIER: dict[str, str] = {
    "goldman sachs": "top",
    "morgan stanley": "top",
    "j.p. morgan": "top",
    "jpmorgan": "top",
    "bank of america": "top",
    "merrill": "top",
    "barclays": "top",
    "ubs": "top",
    "citi": "top",
    "citigroup": "top",
    "wells fargo": "top",
    "deutsche bank": "top",
    "credit suisse": "top",
    "evercore": "top",
    "evercore isi": "top",
    "jefferies": "major",
    "piper sandler": "major",
    "raymond james": "major",
    "rbc": "major",
    "rbc capital": "major",
    "stifel": "major",
    "wedbush": "major",
    "william blair": "major",
    "oppenheimer": "major",
    "bmo": "major",
    "td cowen": "major",
    "needham": "major",
    "cantor fitzgerald": "major",
    "guggenheim": "major",
    "mizuho": "major",
    "truist": "major",
    "keybanc": "major",
    "kbw": "major",
    "bernstein": "major",
}


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


def _broker_tier(firm: str | None) -> str:
    f = (firm or "").strip().lower()
    if not f:
        return "other"
    for key, tier in BROKER_TIER.items():
        if key in f:
            return tier
    return "other"


def _parse_dt(s: Any) -> datetime | None:
    if not s:
        return None
    try:
        ss = str(s)
        if ss.endswith("Z"):
            ss = ss.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ss)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def fetch_for_ticker(ticker: str, limit: int = 50) -> list[dict[str, Any]]:
    sym = ticker.strip().upper()
    if not sym:
        return []
    try:
        r = requests.get(
            f"{UW_BASE}{UW_PATH}",
            headers=_uw_headers(),
            params={"ticker": sym, "limit": min(max(int(limit), 1), 100)},
            timeout=15,
        )
        if r.status_code != 200:
            return []
        rows = (r.json() or {}).get("data") or []
    except Exception:
        return []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        rt = str(row.get("ticker") or "").upper()
        if rt and rt != sym:
            continue
        out.append(row)
    return out


def _row_to_insert(ticker: str, ev: dict[str, Any]) -> dict[str, Any] | None:
    ts = ev.get("timestamp") or ev.get("date") or ev.get("created_at")
    dt = _parse_dt(ts)
    action_date = (dt.date().isoformat() if dt else None) or (str(ts)[:10] if ts else None)
    if not action_date:
        return None
    firm = ev.get("firm") or ev.get("analyst_firm")
    rid = f"{ts}-{firm}-{ev.get('action') or ''}-{ev.get('recommendation') or ''}"
    target = ev.get("target")
    try:
        target = float(target) if target is not None else None
    except (TypeError, ValueError):
        target = None
    return {
        "ticker": ticker.upper(),
        "action_date": action_date,
        "rating_id": rid,
        "firm": firm,
        "analyst_name": ev.get("analyst_name"),
        "action": ev.get("action"),
        "recommendation": ev.get("recommendation"),
        "target_price": target,
        "prev_target": None,
        "broker_tier": _broker_tier(firm),
        "raw": ev,
    }


def upsert_rows(rows: list[dict[str, Any]], batch_size: int = 500) -> int:
    if not rows:
        return 0
    # Dedupe within the batch on the conflict target.
    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for r in rows:
        key = (r.get("ticker", ""), r.get("rating_id", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    url = f"{_supa_url()}/rest/v1/{TABLE}?on_conflict=ticker,rating_id"
    total = 0
    for i in range(0, len(deduped), batch_size):
        batch = deduped[i:i + batch_size]
        r = requests.post(url, headers=_supa_headers(), json=batch, timeout=30)
        if r.status_code >= 400:
            raise RuntimeError(f"UPSERT failed: HTTP {r.status_code} {r.text[:200]}")
        total += len(batch)
    return total


def pull_and_upsert(tickers: list[str],
                    max_seconds: float = 1800.0,
                    sleep_per_call: float = 0.35) -> dict[str, Any]:
    t0 = time.time()
    rows: list[dict[str, Any]] = []
    tickers_done = 0
    tickers_with_data = 0

    for sym in tickers:
        if time.time() - t0 > max_seconds:
            break
        events = fetch_for_ticker(sym, limit=50)
        tickers_done += 1
        if events:
            tickers_with_data += 1
        for ev in events:
            row = _row_to_insert(sym, ev)
            if row:
                rows.append(row)
        if len(rows) >= 500:
            upsert_rows(rows)
            rows = []
        time.sleep(sleep_per_call)

    upserted = 0
    if rows:
        upserted = upsert_rows(rows)

    return {
        "tickers_done": tickers_done,
        "tickers_with_data": tickers_with_data,
        "rows_in_final_batch": len(rows),
        "rows_upserted_final_batch": upserted,
        "elapsed_sec": round(time.time() - t0, 1),
    }


if __name__ == "__main__":
    import argparse
    from scanner.signal_intelligence_v5.universe import build_universe_v5_from_supabase

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--max-seconds", type=float, default=1800.0)
    p.add_argument("--limit", type=int, default=None,
                   help="Only ingest first N tickers (testing)")
    p.add_argument("--tickers", help="Comma-separated explicit ticker list")
    args = p.parse_args()

    if args.tickers:
        ts = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    else:
        ts = build_universe_v5_from_supabase()
        if args.limit:
            ts = ts[:args.limit]

    print(json.dumps(pull_and_upsert(ts, max_seconds=args.max_seconds), indent=2))
