#!/usr/bin/env python3
"""
backfill_ticker_reference.py — rolling backfill of public.ticker_reference
from Massive's /v3/reference/tickers/{ticker} endpoint.

Free-tier safe (5 calls/min via THROTTLE_SECONDS=13). Designed to be
run incrementally on a 4-hour cron until the ~12,500-ticker universe
is fully populated, then continues forever doing rolling refresh of
the stalest rows.

Per-run logic
-------------
  1. Read universe_master tickers + ticker_reference timestamps.
  2. Build target list: rows missing from ticker_reference first
     (NULL ingested_at), then rows older than REFRESH_DAYS_STALE,
     ordered oldest-first. Cap at MAX_PER_RUN.
  3. For each ticker, GET /v3/reference/tickers/{ticker}, sleep
     THROTTLE_SECONDS, accumulate rows.
  4. Upsert in 500-row chunks; updates pipeline_health on success.

Each run is bounded by GH Actions' 6-hour wall-clock limit. With
THROTTLE_SECONDS=13 and MAX_PER_RUN=1500, a full run is ~5h25m.

Resumable, idempotent. Safe to re-run if the workflow is killed.

Reads MASSIVE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from
environment OR from the repo's .env.local (sibling to this script's
parent).
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError

THROTTLE_SECONDS    = int(os.environ.get("THROTTLE_SECONDS", "13"))
MAX_PER_RUN         = int(os.environ.get("MAX_PER_RUN", "1500"))
REFRESH_DAYS_STALE  = int(os.environ.get("REFRESH_DAYS_STALE", "30"))
UPSERT_FLUSH_EVERY  = int(os.environ.get("UPSERT_FLUSH_EVERY", "100"))


def env(name, dotenv=None):
    if name in os.environ and os.environ[name]:
        return os.environ[name]
    if dotenv and name in dotenv:
        return dotenv[name]
    raise SystemExit(f"missing env var: {name}")


def load_dotenv():
    paths = [os.path.join(os.path.dirname(__file__), "..", ".env.local")]
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
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {"error": "non-json error body"}
    except URLError as e:
        return 0, {"error": str(e)}


def supabase_get_all(sb_url, sb_key, table, columns, page_size=1000):
    headers = {"apikey": sb_key, "Authorization": f"Bearer {sb_key}"}
    out = []
    offset = 0
    while True:
        params = {"select": columns, "limit": page_size, "offset": offset}
        url = f"{sb_url}/rest/v1/{table}?{urlencode(params)}"
        status, body = http_json(url, headers=headers, timeout=60)
        if status >= 300:
            raise SystemExit(f"select {table} offset {offset}: HTTP {status} {body}")
        if not body:
            break
        out.extend(body)
        if len(body) < page_size:
            break
        offset += page_size
    return out


def supabase_upsert(sb_url, sb_key, table, rows, on_conflict):
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
    patch = {"last_check_at": now_iso, "status": status, "last_error": error}
    if status == "green":
        patch["last_good_at"] = now_iso
    supabase_patch(sb_url, sb_key, "pipeline_health",
                   f"indicator_id=eq.{indicator_id}", patch)


def fetch_ticker_details(api_key, ticker):
    url = (f"https://api.polygon.io/v3/reference/tickers/"
           f"{ticker}?apiKey={api_key}")
    status, body = http_json(url, timeout=30)
    if status == 404:
        return None, "404 not found"
    if status == 429:
        return None, "429 rate limited"
    if status >= 300:
        return None, f"{status} {str(body)[:300]}"
    if not isinstance(body, dict):
        return None, "non-dict response"
    return body.get("results"), None


def map_to_row(ticker, payload):
    if not payload:
        return None
    branding = payload.get("branding") or {}
    addr = payload.get("address") or {}
    return {
        "ticker":                          ticker,
        "name":                            payload.get("name"),
        "description":                     payload.get("description"),
        "homepage_url":                    payload.get("homepage_url"),
        "logo_url":                        branding.get("logo_url"),
        "icon_url":                        branding.get("icon_url"),
        "branding_accent_color":           branding.get("accent_color"),
        "list_date":                       payload.get("list_date"),
        "market_cap":                      payload.get("market_cap"),
        "share_class_shares_outstanding":  payload.get("share_class_shares_outstanding"),
        "weighted_shares_outstanding":     payload.get("weighted_shares_outstanding"),
        "total_employees":                 payload.get("total_employees"),
        "sic_code":                        payload.get("sic_code"),
        "sic_description":                 payload.get("sic_description"),
        "ticker_root":                     payload.get("ticker_root"),
        "phone_number":                    payload.get("phone_number"),
        "address_city":                    addr.get("city"),
        "address_state":                   addr.get("state"),
        "address_country":                 addr.get("country"),
        "ingested_at":                     datetime.now(timezone.utc).isoformat(),
    }


# Mega-cap and household-name tickers that should be backfilled before the
# alphabetical long tail. Tickers users actually open in the modal land here.
# The priority list itself is augmented at runtime with the user's
# positions + watchlist + the daily Trading Opportunities board.
MEGA_CAP_PRIORITY = [
    "AAPL","MSFT","NVDA","GOOGL","GOOG","AMZN","META","TSLA","BRK.B","AVGO",
    "JPM","V","UNH","XOM","JNJ","WMT","MA","PG","LLY","HD","CVX","MRK",
    "ABBV","KO","PEP","BAC","COST","ORCL","ADBE","CSCO","CRM","NFLX","TMO",
    "AMD","INTC","ARM","QCOM","TXN","INTU","IBM","NOW","UBER","SHOP","PYPL",
    "DIS","NKE","MCD","SBUX","CAT","BA","DE","HON","GE","MMM","FDX","UPS",
    "SPY","QQQ","DIA","IWM","VTI","VOO","RSP","XLK","XLF","XLV","XLE","XLY","XLI","XLP","XLU","XLB","XLRE","XLC","SOXX","IBB","SMH","KRE","XBI",
]


def fetch_priority_overlay(sb_url, sb_key):
    """Pull tickers from positions + watchlist tables to seed the priority
    bucket at the front of the queue. Falls through silently if either
    table read fails — priority is a nice-to-have, not load-bearing."""
    out = set()
    for table in ("positions", "watchlist"):
        try:
            rows = supabase_get_all(sb_url, sb_key, table, "ticker", page_size=2000)
            for r in rows:
                t = (r.get("ticker") or "").strip().upper()
                if t and t != "CASH":
                    out.add(t)
        except Exception as e:
            print(f"[targets] couldn't pull {table} for priority overlay: {e}")
    return out


def pick_targets(sb_url, sb_key, max_per_run, stale_days):
    print(f"[targets] reading universe_master + ticker_reference...")
    um = supabase_get_all(sb_url, sb_key, "universe_master",
                          "ticker,active", page_size=2000)
    tr = supabase_get_all(sb_url, sb_key, "ticker_reference",
                          "ticker,ingested_at", page_size=2000)
    tr_by_ticker = {r["ticker"]: r["ingested_at"] for r in tr}

    universe_active = {r["ticker"] for r in um if r.get("active", True)}
    print(f"[targets] universe active={len(universe_active)} "
          f"reference={len(tr_by_ticker)}")

    # Build priority set: mega-caps + user holdings + user watchlist.
    user_holdings = fetch_priority_overlay(sb_url, sb_key)
    priority_set = set(MEGA_CAP_PRIORITY) | user_holdings
    print(f"[targets] priority bucket: {len(priority_set)} tickers "
          f"({len(user_holdings)} from user positions/watchlist)")

    # Missing tickers, with priority-set first, alphabetical inside each tier.
    all_missing = [t for t in universe_active if t not in tr_by_ticker]
    priority_missing = sorted([t for t in all_missing if t in priority_set])
    other_missing    = sorted([t for t in all_missing if t not in priority_set])
    missing = priority_missing + other_missing
    print(f"[targets] missing total={len(all_missing)} "
          f"(priority={len(priority_missing)} alphabetical={len(other_missing)})")

    if len(missing) >= max_per_run:
        return missing[:max_per_run]

    cutoff_dt = datetime.now(timezone.utc).timestamp() - (stale_days * 86400)
    stale = []
    for ticker, iso in tr_by_ticker.items():
        if ticker not in universe_active:
            continue
        try:
            ts = datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
        except Exception:
            ts = 0
        if ts < cutoff_dt:
            stale.append((ts, ticker))
    stale.sort()
    stale_tickers = [t for _, t in stale]
    print(f"[targets] stale (>{stale_days}d) candidates: {len(stale_tickers)}")

    return missing + stale_tickers[: max_per_run - len(missing)]


def main():
    dotenv = load_dotenv()
    KEY  = env("MASSIVE_API_KEY", dotenv)
    URL  = env("SUPABASE_URL", dotenv)
    SK   = env("SUPABASE_SERVICE_ROLE_KEY", dotenv)

    started = time.time()
    print(f"[backfill_ticker_reference] start "
          f"ts={datetime.now(timezone.utc).isoformat()} "
          f"max_per_run={MAX_PER_RUN} throttle={THROTTLE_SECONDS}s "
          f"stale_days={REFRESH_DAYS_STALE}")

    targets = pick_targets(URL, SK, MAX_PER_RUN, REFRESH_DAYS_STALE)
    if not targets:
        print("[backfill] nothing to do - universe fully fresh")
        update_health(URL, SK, "massive-ticker-details", "green")
        return 0

    print(f"[backfill] targets this run: {len(targets)} "
          f"(estimated wall-clock: "
          f"{round(len(targets) * THROTTLE_SECONDS / 60, 1)} min)")

    pending = []
    upserted = 0
    errors = 0
    error_samples = []
    not_found = 0

    for i, ticker in enumerate(targets, start=1):
        payload, err = fetch_ticker_details(KEY, ticker)

        if err == "429 rate limited":
            print(f"  [{i}/{len(targets)}] {ticker}: 429 - sleeping 60s")
            time.sleep(60)
            payload, err = fetch_ticker_details(KEY, ticker)

        if err:
            errors += 1
            if "not found" in (err or ""):
                not_found += 1
            elif len(error_samples) < 5:
                error_samples.append(f"{ticker}: {err}")
            if i % 25 == 0 or i <= 5:
                print(f"  [{i}/{len(targets)}] {ticker}: ERR {err}")
        elif payload:
            row = map_to_row(ticker, payload)
            if row:
                pending.append(row)
                if i % 50 == 0 or i <= 3:
                    nm = (payload.get('name') or '?')[:40]
                    print(f"  [{i}/{len(targets)}] {ticker}: ok ({nm})")

        if len(pending) >= UPSERT_FLUSH_EVERY:
            n = supabase_upsert(URL, SK, "ticker_reference",
                                 pending, "ticker")
            upserted += n
            pending = []
            print(f"  [flush] upserted batch; total upserted={upserted}")

        if i < len(targets):
            time.sleep(THROTTLE_SECONDS)

    if pending:
        n = supabase_upsert(URL, SK, "ticker_reference", pending, "ticker")
        upserted += n
        print(f"  [final flush] upserted batch; total upserted={upserted}")

    elapsed = time.time() - started
    print(f"\n[backfill] done in {round(elapsed/60,1)} min: "
          f"upserted={upserted} errors={errors} "
          f"(of which 404={not_found})")
    if error_samples:
        print(f"[backfill] error samples: {error_samples}")

    if upserted == 0 and errors == len(targets):
        update_health(URL, SK, "massive-ticker-details", "red",
                      f"all {len(targets)} calls failed; samples: {error_samples}")
        return 2

    update_health(URL, SK, "massive-ticker-details", "green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
