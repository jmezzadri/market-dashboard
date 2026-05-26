"""
Short Interest ingest — UW + Nasdaq/FINRA -> short_interest + short_interest_daily.

Per SHORT_INTEREST_DATA_FEED_DESIGN.md:

  FINRA bi-monthly settlements (gold standard SI level)
    Source: api.nasdaq.com/api/quote/{ticker}/short-interest?type=monthly
    -> short_interest table

  UW continuous metrics (CTB / borrow availability / FTDs / SVR)
    /api/shorts/{ticker}/data
    /api/shorts/{ticker}/volume-and-ratio
    /api/shorts/{ticker}/ftds
    -> short_interest_daily table

  IMPORTANT: do NOT use /api/shorts/{ticker}/interest-float — proven
  stale 2026-05-10 (anchored to 2021 data for all tickers tested).
"""

from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests
import uuid
from scanner.api_usage_helper import log_run_summary


UW_BASE = "https://api.unusualwhales.com/api"
NASDAQ_BASE = "https://api.nasdaq.com/api"

TABLE_FINRA = "short_interest"
TABLE_DAILY = "short_interest_daily"


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


# v5.4: FINRA Reg SHO files don't carry shares outstanding -- pull it
# from ticker_reference so the SI table doesn't leave float_shares NULL
# and silently zero-score every name. Cached for the lifetime of this
# process.
_SHARES_CACHE: dict[str, float | None] = {}
def _fetch_shares_outstanding(ticker: str) -> float | None:
    t = ticker.upper()
    if t in _SHARES_CACHE:
        return _SHARES_CACHE[t]
    url = f"{_supa_url()}/rest/v1/ticker_reference"
    params = [
        ("select", "share_class_shares_outstanding,weighted_shares_outstanding"),
        ("ticker", f"eq.{t}"),
        ("limit", "1"),
    ]
    try:
        r = requests.get(url, headers={**_supa_headers(), "Prefer": ""},
                         params=params, timeout=10)
        if r.status_code >= 400:
            _SHARES_CACHE[t] = None
            return None
        rows = r.json()
        if not rows:
            _SHARES_CACHE[t] = None
            return None
        v = rows[0].get("share_class_shares_outstanding") or rows[0].get("weighted_shares_outstanding")
        v = float(v) if v else None
        _SHARES_CACHE[t] = v
        return v
    except Exception:
        _SHARES_CACHE[t] = None
        return None


def _uw_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.environ['UNUSUAL_WHALES_API_KEY']}",
        "UW-CLIENT-API-ID": os.environ.get("UW_CLIENT_API_ID", "100001"),
    }


def _nasdaq_headers() -> dict[str, str]:
    # Nasdaq's public JSON endpoint rejects non-browser UAs (HTTP 000 / blocked).
    # A standard Mozilla UA with Accept: application/json works reliably.
    return {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.nasdaq.com/",
    }


# ─────────────────────────────────────────────────────────────────────────────
# FINRA / Nasdaq SI history
# ─────────────────────────────────────────────────────────────────────────────

def fetch_finra(ticker: str) -> list[dict[str, Any]]:
    """Pull bi-monthly FINRA settlements via Nasdaq's free endpoint."""
    sym = ticker.strip().upper()
    url = f"{NASDAQ_BASE}/quote/{sym}/short-interest?type=monthly"
    try:
        r = requests.get(url, headers=_nasdaq_headers(), timeout=20)
        if r.status_code != 200:
            return []
        body = r.json() or {}
    except Exception:
        return []
    rows = ((body.get("data") or {}).get("shortInterestTable") or {}).get("rows") or []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        # Nasdaq column names: settlementDate, interest, avgDailyShareVolume,
        # daysToCover (string format with commas)
        try:
            settlement = row.get("settlementDate") or row.get("settlement_date")
            if not settlement:
                continue
            try:
                d = datetime.strptime(settlement, "%m/%d/%Y").date()
            except ValueError:
                d = datetime.strptime(settlement[:10], "%Y-%m-%d").date()
            shares = int(str(row.get("interest") or "0").replace(",", "") or "0")
            adv = int(str(row.get("avgDailyShareVolume") or "0").replace(",", "") or "0")
            d2c = float(str(row.get("daysToCover") or "0").replace(",", "") or "0")
            out.append({
                "as_of_date": d.isoformat(),
                "short_interest_shares": shares,
                "avg_daily_volume": adv,
                "days_to_cover": d2c,
                "raw": row,
            })
        except Exception:
            continue
    return out


def upsert_finra(ticker: str, settlements: list[dict[str, Any]]) -> int:
    if not settlements:
        return 0
    # v5.4: Resolve shares outstanding once per ticker call so each row
    # can carry both float_shares AND the derived short_interest_float_pct.
    shares_out = _fetch_shares_outstanding(ticker)
    rows = []
    for s in settlements:
        shares = s.get("short_interest_shares")
        pct = None
        if shares is not None and shares_out and shares_out > 0:
            try:
                pct = round((float(shares) / float(shares_out)) * 100.0, 4)
            except (TypeError, ValueError):
                pct = None
        rows.append({
            "ticker": ticker.upper(),
            "as_of_date": s["as_of_date"],
            "source": "finra",
            "short_interest_shares": shares,
            "short_interest_float_pct": pct,
            "days_to_cover": s.get("days_to_cover"),
            "float_shares": shares_out,
            "shares_outstanding": shares_out,
            "avg_daily_volume": s.get("avg_daily_volume"),
            "squeeze_score": None,
            "raw": s.get("raw"),
        })
    url = f"{_supa_url()}/rest/v1/{TABLE_FINRA}?on_conflict=ticker,as_of_date,source"
    r = requests.post(url, headers=_supa_headers(), json=rows, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"FINRA UPSERT failed: HTTP {r.status_code} {r.text[:200]}")
    return len(rows)


# ─────────────────────────────────────────────────────────────────────────────
# UW continuous metrics
# ─────────────────────────────────────────────────────────────────────────────

def fetch_uw_data(ticker: str) -> dict[str, Any]:
    """GET /api/shorts/{ticker}/data — borrow / CTB snapshot."""
    sym = ticker.strip().upper()
    try:
        r = requests.get(f"{UW_BASE}/shorts/{sym}/data",
                         headers=_uw_headers(), timeout=15)
        if r.status_code != 200:
            return {}
        body = r.json() or {}
    except Exception:
        return {}
    data = body.get("data") or {}
    if isinstance(data, list):
        data = data[0] if data else {}
    return data if isinstance(data, dict) else {}


def fetch_uw_volume_ratio(ticker: str) -> list[dict[str, Any]]:
    """GET /api/shorts/{ticker}/volume-and-ratio — daily SVR series."""
    sym = ticker.strip().upper()
    try:
        r = requests.get(f"{UW_BASE}/shorts/{sym}/volume-and-ratio",
                         headers=_uw_headers(), timeout=15)
        if r.status_code != 200:
            return []
        body = r.json() or {}
    except Exception:
        return []
    return body.get("data") or []


def fetch_uw_ftds(ticker: str) -> list[dict[str, Any]]:
    """GET /api/shorts/{ticker}/ftds — settled failure-to-deliver records."""
    sym = ticker.strip().upper()
    try:
        r = requests.get(f"{UW_BASE}/shorts/{sym}/ftds",
                         headers=_uw_headers(), timeout=15)
        if r.status_code != 200:
            return []
        body = r.json() or {}
    except Exception:
        return []
    return body.get("data") or []


def upsert_daily(ticker: str,
                 data_snap: dict[str, Any],
                 svr_rows: list[dict[str, Any]],
                 ftd_rows: list[dict[str, Any]],
                 today: date) -> int:
    """One row per (ticker, as_of_date); merge SVR + FTD + snapshot day."""
    by_date: dict[str, dict[str, Any]] = {}

    # SVR series
    for row in svr_rows:
        if not isinstance(row, dict):
            continue
        d = row.get("date") or row.get("as_of_date")
        if not d:
            continue
        d = str(d)[:10]
        by_date.setdefault(d, {"as_of_date": d})
        try:
            sv = int(row.get("short_volume") or 0) or None
            tv = int(row.get("total_volume") or 0) or None
            ratio = (sv / tv) if (sv and tv) else None
        except Exception:
            sv = tv = ratio = None
        by_date[d]["short_volume"] = sv
        by_date[d]["total_volume"] = tv
        by_date[d]["short_volume_ratio"] = ratio

    # FTD series
    for row in ftd_rows:
        if not isinstance(row, dict):
            continue
        d = row.get("settlement_date") or row.get("date")
        if not d:
            continue
        d = str(d)[:10]
        by_date.setdefault(d, {"as_of_date": d})
        try:
            qty = int(row.get("quantity") or 0) or None
            price = float(row.get("price") or 0) or None
        except Exception:
            qty = price = None
        by_date[d]["ftd_quantity"] = qty
        by_date[d]["ftd_price"] = price

    # CTB / borrow snapshot — applied to today only
    today_iso = today.isoformat()
    by_date.setdefault(today_iso, {"as_of_date": today_iso})
    try:
        ctb = float(data_snap.get("cost_to_borrow") or data_snap.get("fee_rate") or 0) or None
    except Exception:
        ctb = None
    try:
        borrow = int(data_snap.get("borrow_shares_available")
                     or data_snap.get("available") or 0) or None
    except Exception:
        borrow = None
    try:
        rebate = float(data_snap.get("rebate_rate") or 0) or None
    except Exception:
        rebate = None
    by_date[today_iso]["cost_to_borrow_pct"] = ctb
    by_date[today_iso]["borrow_shares_available"] = borrow
    by_date[today_iso]["rebate_rate_pct"] = rebate

    rows = []
    for d, vals in by_date.items():
        rows.append({
            "ticker": ticker.upper(),
            "as_of_date": d,
            "source": "uw",
            "short_volume": vals.get("short_volume"),
            "total_volume": vals.get("total_volume"),
            "short_volume_ratio": vals.get("short_volume_ratio"),
            "borrow_shares_available": vals.get("borrow_shares_available"),
            "cost_to_borrow_pct": vals.get("cost_to_borrow_pct"),
            "rebate_rate_pct": vals.get("rebate_rate_pct"),
            "ftd_quantity": vals.get("ftd_quantity"),
            "ftd_price": vals.get("ftd_price"),
            "raw": None,
        })

    if not rows:
        return 0
    url = f"{_supa_url()}/rest/v1/{TABLE_DAILY}?on_conflict=ticker,as_of_date,source"
    # Batch the upserts for resilience
    total = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        r = requests.post(url, headers=_supa_headers(), json=batch, timeout=30)
        if r.status_code >= 400:
            raise RuntimeError(f"UW daily UPSERT failed: HTTP {r.status_code} {r.text[:200]}")
        total += len(batch)
    return total


# ─────────────────────────────────────────────────────────────────────────────
# Driver
# ─────────────────────────────────────────────────────────────────────────────

def pull_and_upsert(tickers: list[str],
                    today: date | None = None,
                    max_seconds: float = 1800.0,
                    sleep_per_call: float = 0.35) -> dict[str, Any]:
    today = today or date.today()
    t0 = time.time()
    finra_rows = 0
    daily_rows = 0
    tickers_done = 0
    tickers_finra = 0
    tickers_uw = 0

    for sym in tickers:
        if time.time() - t0 > max_seconds:
            break

        # FINRA
        try:
            sets = fetch_finra(sym)
            if sets:
                finra_rows += upsert_finra(sym, sets)
                tickers_finra += 1
        except Exception:
            pass
        time.sleep(sleep_per_call)

        # UW continuous — Phase 1 (2026-05-26 Joe-approved): only cost-to-borrow
        # has a live reader. SVR (volume-and-ratio) and FTDs (fails-to-deliver)
        # were dropped from the nightly ingest to halve the per-ticker request
        # count from 3 to 1. The back-test harness still expects those columns
        # to exist in short_interest_daily; historical rows are preserved, only
        # new rows stop accumulating SVR/FTD values. Re-enable here if a
        # future back-test needs fresh data.
        try:
            d_snap = fetch_uw_data(sym)
            if d_snap:
                daily_rows += upsert_daily(sym, d_snap, [], [], today)
                tickers_uw += 1
        except Exception:
            pass
        time.sleep(sleep_per_call)
        tickers_done += 1

    return {
        "tickers_done": tickers_done,
        "tickers_finra": tickers_finra,
        "tickers_uw": tickers_uw,
        "finra_rows_upserted": finra_rows,
        "daily_rows_upserted": daily_rows,
        "elapsed_sec": round(time.time() - t0, 1),
    }


if __name__ == "__main__":
    import argparse
    from scanner.signal_intelligence_v5.universe import build_universe_v5_from_supabase

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--max-seconds", type=float, default=1800.0)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--tickers", help="Comma-separated explicit ticker list")
    args = p.parse_args()

    if args.tickers:
        ts = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    else:
        ts = build_universe_v5_from_supabase()
        if args.limit:
            ts = ts[:args.limit]

    # Bug #1032 follow-up: write one row per run to api_usage_log so the
    # Admin API Usage bar chart shows this pipeline's daily UW call volume.
    _run_id = uuid.uuid4()
    _started_at = datetime.now(timezone.utc)
    try:
        _result = pull_and_upsert(ts, max_seconds=args.max_seconds)
        print(json.dumps(_result, indent=2))
        # Estimate UW calls: 3 endpoints per UW-touched ticker
        # (shorts/data, shorts/volume-and-ratio, shorts/ftds). FINRA hits
        # are not Unusual Whales and don't count toward the budget.
        _calls = int((_result.get("tickers_uw") or 0) * 3)
        log_run_summary(
            source="short_interest",
            run_id=_run_id,
            started_at=_started_at,
            completed_at=datetime.now(timezone.utc),
            calls_made=_calls,
            status="success",
            notes={
                "tickers_done": _result.get("tickers_done"),
                "tickers_finra": _result.get("tickers_finra"),
                "tickers_uw": _result.get("tickers_uw"),
                "daily_rows_upserted": _result.get("daily_rows_upserted"),
            },
        )
    except Exception as _exc:
        log_run_summary(
            source="short_interest",
            run_id=_run_id,
            started_at=_started_at,
            completed_at=datetime.now(timezone.utc),
            status="failed",
            notes={"error": str(_exc)[:500]},
        )
        raise
