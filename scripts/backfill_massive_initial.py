#!/usr/bin/env python3
"""
backfill_massive_initial.py — one-shot initial population of the
Massive-sourced tables added by migration 032.

Usage:
    python3 scripts/backfill_massive_initial.py

What it does
------------
1. Reference Tickers (paginated, ~12 calls)  -> universe_master upsert
2. Daily Market Summary (1 call, most recent  -> prices_eod upsert
   trading day)
3. Dividends (last 90 days)                   -> dividends upsert
4. Splits   (last 365 days)                   -> splits upsert
5. Updates pipeline_health rows on success

Designed for the Massive Basic free tier — sleeps 13s between paginated
calls to stay under 5 calls/minute.

Reads MASSIVE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from
environment OR from the repo's .env.local (sibling to this script's
parent).
"""
import json
import os
import sys
import time
from datetime import date, timedelta, datetime, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError

THROTTLE_SECONDS = 13       # 60 / 5 calls per minute, with margin
PAGE_SIZE = 1000

def env(name, dotenv=None):
    """Read env var from os.environ or .env.local fallback."""
    if name in os.environ and os.environ[name]:
        return os.environ[name]
    if dotenv and name in dotenv:
        return dotenv[name]
    raise SystemExit(f"missing env var: {name}")

def load_dotenv():
    """Load /sessions/.../market-dashboard/.env.local if present."""
    paths = [
        "/sessions/blissful-wonderful-pasteur/mnt/macrotilt/market-dashboard/.env.local",
        os.path.join(os.path.dirname(__file__), "..", ".env.local"),
    ]
    out = {}
    for p in paths:
        if os.path.exists(p):
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip()
            break
    return out

def http_json(url, method="GET", headers=None, body=None, timeout=60):
    headers = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as r:
            payload = r.read()
            return r.status, json.loads(payload) if payload else None
    except HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
    except URLError as e:
        return 0, {"error": str(e)}

def supabase_upsert(sb_url, sb_key, table, rows, on_conflict):
    """Chunked upsert via PostgREST with on_conflict resolution."""
    if not rows:
        return 0
    headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    url = f"{sb_url}/rest/v1/{table}?on_conflict={on_conflict}"
    upserted = 0
    CHUNK = 500
    for i in range(0, len(rows), CHUNK):
        slice_ = rows[i:i + CHUNK]
        status, body = http_json(url, method="POST", headers=headers, body=slice_)
        if status >= 300:
            raise SystemExit(f"upsert {table} chunk {i}: HTTP {status} {body}")
        upserted += len(slice_)
    return upserted

def supabase_patch(sb_url, sb_key, table, filter_, patch):
    headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    url = f"{sb_url}/rest/v1/{table}?{filter_}"
    status, body = http_json(url, method="PATCH", headers=headers, body=patch)
    if status >= 300:
        raise SystemExit(f"patch {table}: HTTP {status} {body}")

def update_health(sb_url, sb_key, indicator_id, status, error=None):
    now_iso = datetime.now(timezone.utc).isoformat()
    patch = {
        "last_check_at": now_iso,
        "status": status,
        "last_error": error,
    }
    if status == "green":
        patch["last_good_at"] = now_iso
        patch["prev_status"] = "red"  # we know we started red
    supabase_patch(sb_url, sb_key, "pipeline_health",
                   f"indicator_id=eq.{indicator_id}", patch)

def fetch_paginated(base_url, params, key, throttle=True, label=""):
    """Generic paginated fetch for Massive (Polygon) v3 endpoints."""
    out = []
    params = dict(params)
    params["apiKey"] = key
    url = f"{base_url}?{urlencode(params)}"
    page = 0
    while url:
        page += 1
        status, body = http_json(url, timeout=60)
        if status >= 300:
            raise SystemExit(f"{label} page {page} HTTP {status}: {body}")
        results = body.get("results", []) if isinstance(body, dict) else []
        out.extend(results)
        next_url = body.get("next_url") if isinstance(body, dict) else None
        if next_url:
            sep = "&" if "?" in next_url else "?"
            url = f"{next_url}{sep}apiKey={key}"
        else:
            url = None
        print(f"  [{label}] page {page} +{len(results)} (cum {len(out)})")
        if url and throttle:
            time.sleep(THROTTLE_SECONDS)
    return out

# ─────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────

def main():
    dotenv = load_dotenv()
    KEY  = env("MASSIVE_API_KEY", dotenv)
    URL  = env("SUPABASE_URL", dotenv)
    SK   = env("SUPABASE_SERVICE_ROLE_KEY", dotenv)

    started = time.time()
    print(f"[backfill] start  ts={datetime.now(timezone.utc).isoformat()}")

    # 1) Universe Master
    print("\n[1/4] Universe Master (Reference Tickers, paginated)…")
    try:
        rows = fetch_paginated(
            "https://api.polygon.io/v3/reference/tickers",
            {"market": "stocks", "active": "true", "limit": PAGE_SIZE,
             "order": "asc", "sort": "ticker"},
            KEY, throttle=True, label="universe",
        )
        um_rows = [{
            "ticker":           t.get("ticker"),
            "name":             t.get("name"),
            "market":           t.get("market") or "stocks",
            "locale":           t.get("locale") or "us",
            "primary_exchange": t.get("primary_exchange"),
            "type":             t.get("type"),
            "active":           bool(t.get("active", True)),
            "currency_name":    t.get("currency_name") or "usd",
            "cik":              t.get("cik"),
            "composite_figi":   t.get("composite_figi"),
            "share_class_figi": t.get("share_class_figi"),
            "last_updated_utc": t.get("last_updated_utc"),
        } for t in rows if t.get("ticker")]
        n = supabase_upsert(URL, SK, "universe_master", um_rows, "ticker")
        print(f"  upserted {n} into universe_master")
        update_health(URL, SK, "massive-universe", "green")
    except Exception as e:
        update_health(URL, SK, "massive-universe", "red", str(e))
        raise

    # 2) Daily EOD Prices — most recent trading day.  We try T-1 first,
    #    fall back T-2, T-3, T-4 (covers weekends + market holidays).
    print("\n[2/4] Daily EOD Prices (Daily Market Summary, 1 call)…")
    try:
        eod_rows = []
        date_used = None
        for back in range(1, 6):
            d = (date.today() - timedelta(days=back)).isoformat()
            url = (f"https://api.polygon.io/v2/aggs/grouped/locale/us/"
                   f"market/stocks/{d}?adjusted=true&apiKey={KEY}")
            status, body = http_json(url, timeout=60)
            if status >= 300 or not isinstance(body, dict):
                print(f"  {d}: HTTP {status} {body}")
                continue
            results = body.get("results", []) or []
            if results:
                date_used = d
                eod_rows = [{
                    "ticker":       b.get("T"),
                    "trade_date":   d,
                    "open":         b.get("o"),
                    "high":         b.get("h"),
                    "low":          b.get("l"),
                    "close":        b.get("c"),
                    "volume":       b.get("v"),
                    "vwap":         b.get("vw"),
                    "transactions": b.get("n"),
                    "source":       "massive",
                } for b in results if b.get("T")]
                print(f"  {d}: {len(eod_rows)} bars")
                break
            else:
                print(f"  {d}: no bars (probably non-trading day)")
        if not eod_rows:
            raise RuntimeError("no trading day with bars in last 5 days")
        n = supabase_upsert(URL, SK, "prices_eod", eod_rows, "ticker,trade_date")
        print(f"  upserted {n} into prices_eod for {date_used}")
        update_health(URL, SK, "massive-eod", "green")
    except Exception as e:
        update_health(URL, SK, "massive-eod", "red", str(e))
        raise

    # 3) Dividends — last 90 days
    print("\n[3/4] Dividends (last 90 days)…")
    time.sleep(THROTTLE_SECONDS)
    try:
        cutoff = (date.today() - timedelta(days=90)).isoformat()
        rows = fetch_paginated(
            "https://api.polygon.io/v3/reference/dividends",
            {"ex_dividend_date.gte": cutoff, "limit": PAGE_SIZE,
             "order": "desc", "sort": "ex_dividend_date"},
            KEY, throttle=True, label="dividends",
        )
        div_rows = [{
            "ticker":           d.get("ticker"),
            "ex_dividend_date": d.get("ex_dividend_date"),
            "pay_date":         d.get("pay_date"),
            "record_date":      d.get("record_date"),
            "declaration_date": d.get("declaration_date"),
            "cash_amount":      d.get("cash_amount"),
            "currency":         d.get("currency") or "USD",
            "frequency":        d.get("frequency"),
            "dividend_type":    d.get("dividend_type"),
        } for d in rows if d.get("ticker") and d.get("ex_dividend_date")]
        n = supabase_upsert(URL, SK, "dividends", div_rows,
                            "ticker,ex_dividend_date,dividend_type")
        print(f"  upserted {n} into dividends")
        update_health(URL, SK, "massive-corporate-actions", "green")
    except Exception as e:
        update_health(URL, SK, "massive-corporate-actions", "red", str(e))
        raise

    # 4) Splits — last 365 days
    print("\n[4/4] Splits (last 365 days)…")
    time.sleep(THROTTLE_SECONDS)
    try:
        cutoff = (date.today() - timedelta(days=365)).isoformat()
        rows = fetch_paginated(
            "https://api.polygon.io/v3/reference/splits",
            {"execution_date.gte": cutoff, "limit": PAGE_SIZE,
             "order": "desc", "sort": "execution_date"},
            KEY, throttle=True, label="splits",
        )
        sp_rows = [{
            "ticker":         s.get("ticker"),
            "execution_date": s.get("execution_date"),
            "split_from":     s.get("split_from"),
            "split_to":       s.get("split_to"),
        } for s in rows if s.get("ticker") and s.get("execution_date")]
        n = supabase_upsert(URL, SK, "splits", sp_rows,
                            "ticker,execution_date")
        print(f"  upserted {n} into splits")
    except Exception as e:
        # Splits share the corporate-actions health row; only mark red
        # if we can prove dividends also failed.  For simplicity here,
        # we just log and continue.
        print(f"  splits backfill failed (non-fatal): {e}")

    elapsed = time.time() - started
    print(f"\n[backfill] done in {elapsed:.1f}s")

if __name__ == "__main__":
    main()
