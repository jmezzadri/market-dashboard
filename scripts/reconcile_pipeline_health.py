#!/usr/bin/env python3
"""
reconcile_pipeline_health.py — make the freshness monitor tell the truth.

Background
──────────
Admin·Data reads the pipeline_health table. Almost every producer failed to keep
its row current, so 75 of 84 rows were "fake green" — green only because nothing
ever re-checked them. This job re-derives each feed's freshness from its ACTUAL
data (the served JSON the site renders, or the source table in Supabase),
computes a real status against an SLA, and writes it back with last_check_at=now.
A feed it cannot confidently resolve is marked "unknown" — never fake green.

Run nightly. --commit writes; default is a dry run that only prints.
"""
from __future__ import annotations
import os, sys, json, datetime as dt, urllib.request, urllib.error

BASE = "https://macrotilt.com"
NOW = dt.datetime.now(dt.timezone.utc)
TODAY = NOW.date()

# SLA in hours by series frequency. Generous enough that a normal release cadence
# never false-reds; trading-day awareness handles weekends for daily series.
SLA_BY_FREQ = {"D": 49, "W": 200, "M": 1200, "Q": 4800}
# Slow official data with long publication lags — explicit calendar budgets (h).
LONG_LAG = {
    "jolts_quits": 1920, "sloos_ci": 3600, "sloos_cre": 3600, "bank_credit": 480,
    "term_premium": 384, "cfnai": 2000, "cfnai_3ma": 2000, "m2_yoy": 2000,
    "unrate": 1200, "payrolls": 1200, "ism": 1200, "cape": 1320,
    "erp": 400, "real_fedfunds": 1200,
}
# File-backed feeds: ph id -> (served file, mode, sla_hours, daily?)
FILE_FEEDS = {
    "cycle_board":      ("cycle_v2.json",          "top",        49,  True),
    "sector_perf":      ("sector_perf.json",       "top",        49,  True),
    "v10_allocation":   ("v10_allocation.json",    "top",        200, False),
    "scenario_stress":  ("scenario_stress.json",   "top",        200, False),
    "scenarios":        ("scenario_stress.json",   "top",        200, False),
    "cftc-cot":         ("cot_positioning.json",   "top",        220, False),  # weekly COT
    "indicator_history":("indicator_history.json", "max_series", 49,  True),
}
# Table-backed feeds: ph id -> (table, [candidate ts columns], sla_hours, daily?)
TABLE_FEEDS = {
    "uw-universe-snapshots":     ("universe_snapshots", ["snapshot_ts", "as_of_date"],          49,  True),
    "massive-eod":               ("prices_eod",         ["trade_date"],                          49,  True),
    "massive-universe":          ("universe_master",    ["as_of", "updated_at", "created_at"],   400, False),
    "massive-ticker-details":    ("ticker_reference",   ["updated_at", "as_of", "created_at"],   400, False),
    "massive-corporate-actions": ("dividends",          ["ex_date", "updated_at", "created_at"], 600, False),
    "latest_scan":               ("trading_opps_signals", ["scan_date", "last_trade_ts"],        49,  True),
    "scanner-v5-daily":          ("trading_opps_signals", ["scan_date"],                         49,  True),
    "paper-positions-snapshot":  ("paper_positions",    ["snapshot_date", "last_updated"],       49,  True),
    "paper-nav-daily":           ("paper_nav_history",  ["nav_date", "as_of", "created_at"],     49,  True),
    "paper-orders-intent":       ("paper_orders",       ["created_at", "order_date"],            49,  True),
    "portfolio_history":         ("portfolio_history",  ["as_of", "date", "created_at"],         49,  True),
}

def parse_date(s):
    if s is None: return None
    s = str(s).replace("Z", "+00:00")
    for cand in (s, s[:10]):
        try:
            x = dt.datetime.fromisoformat(cand)
            return x.date() if isinstance(x, dt.datetime) else x
        except Exception:
            continue
    return None

def trading_sessions(d0, d1):
    if not d0 or d0 >= d1: return 0
    n, cur = 0, d0
    while cur < d1:
        cur += dt.timedelta(days=1)
        if cur.weekday() < 5: n += 1
    return n

def status_from_age(asof, sla_h, daily):
    """green / amber / red from a resolved as-of date."""
    if asof is None: return "unknown", None
    if daily:
        s = trading_sessions(asof, TODAY)
        budget = max(1, round(sla_h / 24) + 1)
        detail = f"{asof} · {s} sessions"
        if s <= budget: return "green", detail
        if s <= budget * 3: return "amber", detail
        return "red", detail
    age_h = (NOW - dt.datetime.combine(asof, dt.time(), dt.timezone.utc)).total_seconds() / 3600
    detail = f"{asof} · {round(age_h/24)}d"
    if age_h <= sla_h: return "green", detail
    if age_h <= sla_h * 2: return "amber", detail
    return "red", detail

_cache = {}
def fetch_json(path):
    if path in _cache: return _cache[path]
    try:
        req = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "reconcile"})
        d = json.loads(urllib.request.urlopen(req, timeout=25).read().decode())
    except Exception:
        d = None
    _cache[path] = d
    return d

def supabase_max(table, cols):
    url = os.environ.get("SUPABASE_URL"); key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key): return None
    for col in cols:
        try:
            ep = f"{url}/rest/v1/{table}?select={col}&order={col}.desc&limit=1"
            req = urllib.request.Request(ep, headers={"apikey": key, "Authorization": f"Bearer {key}"})
            rows = json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
            if rows and rows[0].get(col) is not None:
                return parse_date(rows[0][col])
        except Exception:
            continue
    return None

def resolve(indicator_id, ih):
    # 1) indicator_history series
    if indicator_id in ih and isinstance(ih[indicator_id], dict):
        s = ih[indicator_id]
        asof = parse_date(s.get("as_of"))
        freq = (s.get("freq") or "D").upper()[:1]
        sla = LONG_LAG.get(indicator_id, SLA_BY_FREQ.get(freq, 49))
        return status_from_age(asof, sla, daily=(freq == "D" and indicator_id not in LONG_LAG)) + (asof,)
    # 2) file-backed
    if indicator_id in FILE_FEEDS:
        fn, mode, sla, daily = FILE_FEEDS[indicator_id]
        d = fetch_json(fn)
        if d is None: return ("unknown", "fetch failed", None)
        if mode == "max_series":
            best = None
            for v in d.values():
                if isinstance(v, dict) and v.get("as_of"):
                    dd = parse_date(v["as_of"])
                    if dd and (best is None or dd > best): best = dd
            asof = best
        else:
            asof = parse_date(d.get("as_of") or d.get("generated_at_et") or d.get("generated_at"))
        return status_from_age(asof, sla, daily) + (asof,)
    # 3) table-backed
    if indicator_id in TABLE_FEEDS:
        table, cols, sla, daily = TABLE_FEEDS[indicator_id]
        asof = supabase_max(table, cols)
        if asof is None: return ("unknown", "table unresolved", None)
        return status_from_age(asof, sla, daily) + (asof,)
    return ("unknown", "no source mapping", None)

def load_ph():
    url = os.environ.get("SUPABASE_URL")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("SUPABASE_ANON_KEY")
           or "sb_publishable__q_l32rEdPZlC4Bxs6dFnA__NqouiGk")
    base = url or "https://yqaqqzseepebrocgibcw.supabase.co"
    ep = f"{base}/rest/v1/pipeline_health?select=indicator_id,status,last_check_at&limit=500"
    req = urllib.request.Request(ep, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read().decode())

def patch(indicator_id, status, asof):
    url = os.environ.get("SUPABASE_URL"); key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key): return False
    body = {"status": status, "last_check_at": NOW.isoformat()}
    if asof is not None:
        body["last_good_at"] = f"{asof}T00:00:00+00:00"
    if status in ("green", "amber"):
        body["last_error"] = None
    ep = f"{url}/rest/v1/pipeline_health?indicator_id=eq.{urllib.parse.quote(indicator_id)}"
    req = urllib.request.Request(ep, data=json.dumps(body).encode(), method="PATCH",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    try:
        urllib.request.urlopen(req, timeout=15); return True
    except Exception as e:
        print(f"  PATCH failed {indicator_id}: {e}"); return False

def main():
    import urllib.parse  # noqa
    commit = "--commit" in sys.argv
    ih = fetch_json("indicator_history.json") or {}
    rows = load_ph()
    from collections import Counter
    tally = Counter(); wrote = 0
    print(f"Reconciling {len(rows)} pipeline_health rows ({'COMMIT' if commit else 'dry-run'}):\n")
    for r in sorted(rows, key=lambda x: x["indicator_id"]):
        iid = r["indicator_id"]
        status, detail, asof = resolve(iid, ih)
        tally[status] += 1
        print(f"  {status:9} {iid:28} {detail}")
        if commit:
            if patch(iid, status, asof): wrote += 1
    print(f"\nResult: {dict(tally)}")
    if commit: print(f"Wrote {wrote} rows.")
    # Honest failure signal: if everything came back unknown, something is wrong.
    if tally.get("unknown", 0) > len(rows) * 0.5:
        print("WARNING: more than half unresolved — check source mappings.")
    return 0

if __name__ == "__main__":
    import urllib.parse
    sys.exit(main())
