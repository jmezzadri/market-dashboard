"""
Short Interest ingest — UW + FINRA -> short_interest + short_interest_daily.

Per SHORT_INTEREST_DATA_FEED_DESIGN.md:

  FINRA bi-monthly settlements (gold standard SI level)
    Source: FINRA Query API (official, free, no credentials) — one bulk
    POST api.finra.org/data/group/otcMarket/name/consolidatedShortInterest
    per run, windowed on settlementDate, filtered to the scan universe.
    (Until 2026-06-11 this arm scraped api.nasdaq.com once per ticker;
    Nasdaq's bot protection blocks GitHub-hosted runners, so it silently
    returned zero rows after the 2026-04-15 settlement.)
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
FINRA_API_URL = ("https://api.finra.org/data/group/otcMarket/"
                 "name/consolidatedShortInterest")

TABLE_FINRA = "short_interest"
TABLE_DAILY = "short_interest_daily"



def _pipeline_health_upsert(indicator_id: str, label: str,
                            data_as_of: str | None) -> None:
    """Mark this feed green in public.pipeline_health (chip source of truth).

    Producers must upsert their own health row — the freshness checker only
    UPDATES existing rows, and a chip with no row behind it is fake-green
    (hard data rule, 2026-06-02). Never raises.
    """
    try:
        from datetime import datetime as _dt, timezone as _tz
        now = _dt.now(_tz.utc).isoformat()
        row = {"indicator_id": indicator_id, "label": label,
               "source": "Unusual Whales", "cadence": "D",
               "expected_cadence_minutes": 1440, "status": "green",
               "last_good_at": now, "last_check_at": now}
        if data_as_of:
            row["data_as_of"] = f"{data_as_of}T00:00:00+00:00"
        r = requests.post(
            f"{_supa_url()}/rest/v1/pipeline_health?on_conflict=indicator_id",
            headers={**_supa_headers(),
                     "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=[row], timeout=30)
        if r.status_code >= 400:
            print(f"pipeline_health upsert failed: {r.status_code} {r.text[:200]}")
    except Exception as exc:                           # noqa: BLE001
        print(f"pipeline_health upsert failed: {exc}")

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


# ─────────────────────────────────────────────────────────────────────────────
# FINRA SI history — official FINRA Query API, one bulk pull per run
# ─────────────────────────────────────────────────────────────────────────────

def fetch_finra_bulk(since_iso: str, universe: set[str]
                     ) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    """Pull every consolidated short-interest settlement on/after `since_iso`
    from FINRA's official Query API in pages of 5,000 and return
    ({TICKER: [settlement dicts]}, meta).

    Failures are LOUD: any HTTP/parse problem lands in meta["error"] and in
    the run summary — never a silent empty list (the failure mode that hid
    the dead Nasdaq scrape for two months).
    """
    meta: dict[str, Any] = {"rows_total_market": 0, "pages": 0,
                            "settlement_dates": [], "error": None}
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    offset = 0
    try:
        while True:
            body = {
                "limit": 5000,
                "offset": offset,
                "compareFilters": [{
                    "compareType": "GTE",
                    "fieldName": "settlementDate",
                    "fieldValue": since_iso,
                }],
            }
            r = requests.post(
                FINRA_API_URL,
                headers={"Content-Type": "application/json",
                         "Accept": "application/json"},
                json=body, timeout=60,
            )
            if r.status_code != 200:
                meta["error"] = f"HTTP {r.status_code}: {r.text[:200]}"
                break
            rows = r.json() or []
            meta["pages"] += 1
            meta["rows_total_market"] += len(rows)
            for row in rows:
                if not isinstance(row, dict):
                    continue
                sym = str(row.get("symbolCode") or "").strip().upper()
                settlement = str(row.get("settlementDate") or "")[:10]
                if not sym or not settlement or sym not in universe:
                    continue
                # One row per (ticker, settlement): revised rows overwrite, and
                # in-batch duplicates would make the Postgres upsert error out.
                seen[(sym, settlement)] = {
                    "as_of_date": settlement,
                    "short_interest_shares": int(row.get("currentShortPositionQuantity") or 0),
                    "avg_daily_volume": int(row.get("averageDailyVolumeQuantity") or 0),
                    "days_to_cover": float(row.get("daysToCoverQuantity") or 0),
                    "raw": row,
                }
            if len(rows) < 5000:
                break
            offset += 5000
            time.sleep(0.5)
    except Exception as exc:
        meta["error"] = f"{type(exc).__name__}: {exc}"

    out: dict[str, list[dict[str, Any]]] = {}
    dates: set[str] = set()
    for (sym, settlement), srow in seen.items():
        out.setdefault(sym, []).append(srow)
        dates.add(settlement)
    meta["settlement_dates"] = sorted(dates)
    return out, meta


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
            # bigint columns — a float like 14687356000.0 is rejected by
            # Postgres (22P02 invalid input syntax for type bigint), so cast.
            "float_shares": int(shares_out) if shares_out else None,
            "shares_outstanding": int(shares_out) if shares_out else None,
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
                    sleep_per_call: float = 0.35,
                    finra_since_days: int = 45) -> dict[str, Any]:
    today = today or date.today()
    t0 = time.time()
    finra_rows = 0
    daily_rows = 0
    tickers_done = 0
    tickers_finra = 0
    tickers_uw = 0

    # FINRA — one bulk pull from the official API, then per-ticker upserts
    # inside the loop (no per-ticker network call against FINRA/Nasdaq).
    since_iso = (today - timedelta(days=finra_since_days)).isoformat()
    finra_map, finra_meta = fetch_finra_bulk(
        since_iso, {t.strip().upper() for t in tickers})
    if finra_meta.get("error"):
        print(f"[finra] BULK FETCH FAILED ({finra_meta['error']}) — "
              f"FINRA arm upserts 0 rows this run; UW arm continues.")
    else:
        print(f"[finra] {finra_meta['rows_total_market']} market-wide rows in "
              f"{finra_meta['pages']} pages; settlements "
              f"{finra_meta['settlement_dates']}; matched "
              f"{len(finra_map)} of {len(tickers)} universe tickers")

    for sym in tickers:
        if time.time() - t0 > max_seconds:
            break

        # FINRA (from the bulk map — local lookup, no network fetch)
        try:
            sets = finra_map.get(sym.strip().upper()) or []
            if sets:
                finra_rows += upsert_finra(sym, sets)
                tickers_finra += 1
        except Exception as exc:
            print(f"[finra] upsert failed for {sym}: {exc}")

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
        "finra_settlement_dates": finra_meta.get("settlement_dates"),
        "finra_error": finra_meta.get("error"),
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
        from datetime import date as _d_today
        _pipeline_health_upsert(
            "equity-short_interest-daily",
            "Short interest (FINRA + daily short volume)",
            _d_today.today().isoformat())
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
                "finra_rows_upserted": _result.get("finra_rows_upserted"),
                "finra_error": _result.get("finra_error"),
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
