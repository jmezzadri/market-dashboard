"""
Options Flow ingest — UW /option-trades/flow-alerts -> options_flow_daily.

Daily snapshot pull. Aggregates the rolling 30-day window per ticker into
one row per (ticker, as_of_date). Window is bucketed by call vs put and
ask-side vs bid-side per UW alert metadata.

Resume-friendly via --max-seconds (default 1800 = 30 min). Idempotent
UPSERT on PK (ticker, as_of_date).
"""

from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterator

import requests


UW_BASE = "https://api.unusualwhales.com/api"
UW_FLOW_ALERTS = "/option-trades/flow-alerts"
TABLE = "options_flow_daily"
WINDOW_DAYS = 30


def _uw_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ['UNUSUAL_WHALES_API_KEY']}",
        "UW-CLIENT-API-ID": os.environ.get("UW_CLIENT_API_ID", "100001"),
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


def fetch_flow_alerts(limit: int = 200, max_pages: int = 50) -> Iterator[dict[str, Any]]:
    """Yield raw flow-alert events. UW returns most-recent-first."""
    headers = _uw_headers()
    page = 0
    while page < max_pages:
        r = requests.get(
            f"{UW_BASE}{UW_FLOW_ALERTS}",
            headers=headers,
            params={"limit": limit, "page": page},
            timeout=20,
        )
        if r.status_code != 200:
            return
        data = r.json().get("data") or []
        if not data:
            return
        for ev in data:
            yield ev
        if len(data) < limit:
            return
        page += 1


def _parse_dt(val: Any) -> datetime | None:
    if not val:
        return None
    s = str(val)
    try:
        if s.endswith("Z"):
            s = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def aggregate_by_ticker(events: Iterator[dict[str, Any]],
                       as_of: date,
                       window_days: int = WINDOW_DAYS) -> dict[str, dict[str, Any]]:
    """Group events into per-ticker daily rows."""
    cutoff = as_of - timedelta(days=window_days)
    agg: dict[str, dict[str, float | int]] = defaultdict(lambda: {
        "call_premium": 0.0, "put_premium": 0.0,
        "call_count": 0, "put_count": 0,
        "ask_side_premium": 0.0, "bid_side_premium": 0.0,
        "sweep_count": 0, "unusual_count": 0,
        "iv_skew_25d": 0.0,
    })
    samples: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for ev in events:
        ticker = (ev.get("ticker") or "").upper()
        if not ticker:
            continue
        dt = _parse_dt(ev.get("created_at") or ev.get("alert_at") or ev.get("executed_at"))
        if dt is None:
            continue
        if dt.date() < cutoff:
            continue

        otype = (ev.get("type") or "").lower()
        if otype == "call":
            agg[ticker]["call_count"] += 1
        elif otype == "put":
            agg[ticker]["put_count"] += 1

        try:
            premium = float(ev.get("total_premium") or ev.get("premium") or 0)
        except (TypeError, ValueError):
            premium = 0.0
        if otype == "call":
            agg[ticker]["call_premium"] += premium
        elif otype == "put":
            agg[ticker]["put_premium"] += premium

        # UW exposes pre-aggregated ask/bid premium per alert
        try:
            ask_p = float(ev.get("total_ask_side_prem") or 0)
            bid_p = float(ev.get("total_bid_side_prem") or 0)
        except (TypeError, ValueError):
            ask_p = 0.0
            bid_p = 0.0
        agg[ticker]["ask_side_premium"] += ask_p
        agg[ticker]["bid_side_premium"] += bid_p

        if ev.get("has_sweep"):
            agg[ticker]["sweep_count"] += 1
        # "Unusual" proxy: volume_oi_ratio > 5 OR ask-side dominant + sweep
        try:
            voi = float(ev.get("volume_oi_ratio") or 0)
        except (TypeError, ValueError):
            voi = 0.0
        if voi >= 5.0 or ev.get("has_sweep"):
            agg[ticker]["unusual_count"] += 1

        if len(samples[ticker]) < 5:
            samples[ticker].append({
                "ticker": ticker, "type": otype, "premium": premium,
                "ask_side_prem": ask_p, "bid_side_prem": bid_p,
                "voi_ratio": voi, "created_at": ev.get("created_at"),
            })

    rows = {}
    for ticker, data in agg.items():
        rows[ticker] = {
            "ticker": ticker,
            "as_of_date": as_of.isoformat(),
            "call_premium": round(data["call_premium"], 2),
            "put_premium": round(data["put_premium"], 2),
            "call_count": data["call_count"],
            "put_count": data["put_count"],
            "ask_side_premium": round(data["ask_side_premium"], 2),
            "bid_side_premium": round(data["bid_side_premium"], 2),
            "sweep_count": data["sweep_count"],
            "unusual_count": data["unusual_count"],
            "raw": {"window_days": window_days, "samples": samples[ticker]},
        }
    return rows


def upsert_rows(rows: list[dict[str, Any]], batch_size: int = 200) -> int:
    if not rows:
        return 0
    # Dedupe within the batch.
    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for r in rows:
        key = (r.get("ticker", ""), r.get("as_of_date", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    url = f"{_supa_url()}/rest/v1/{TABLE}?on_conflict=ticker,as_of_date"
    total = 0
    for i in range(0, len(deduped), batch_size):
        batch = deduped[i:i + batch_size]
        r = requests.post(url, headers=_supa_headers(), json=batch, timeout=30)
        if r.status_code >= 400:
            raise RuntimeError(f"UPSERT failed: HTTP {r.status_code} {r.text[:200]}")
        total += len(batch)
    return total


def pull_and_upsert(as_of: date | None = None,
                    max_seconds: float = 1800.0) -> dict[str, Any]:
    as_of = as_of or date.today()
    t0 = time.time()
    events_iter = fetch_flow_alerts()

    rows_by_ticker: dict[str, dict[str, Any]] = {}
    fetched = 0
    for ev in events_iter:
        if time.time() - t0 > max_seconds:
            break
        fetched += 1

    # Re-pull, since the iterator was exhausted above. Actually do the
    # aggregation inline this time.
    rows_by_ticker = aggregate_by_ticker(fetch_flow_alerts(), as_of)
    rows = list(rows_by_ticker.values())
    upserted = upsert_rows(rows)

    return {
        "as_of": as_of.isoformat(),
        "events_fetched_first_pass": fetched,
        "tickers_aggregated": len(rows_by_ticker),
        "rows_upserted": upserted,
        "elapsed_sec": round(time.time() - t0, 1),
    }


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--as-of", help="YYYY-MM-DD (default: today UTC)", default=None)
    p.add_argument("--max-seconds", type=float, default=1800.0)
    args = p.parse_args()
    as_of = date.fromisoformat(args.as_of) if args.as_of else None
    print(json.dumps(pull_and_upsert(as_of=as_of, max_seconds=args.max_seconds), indent=2))
