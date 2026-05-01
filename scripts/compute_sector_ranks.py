#!/usr/bin/env python3
"""
compute_sector_ranks.py — aggregates per-ticker composites in latest_scan_data.json
into per-sector composite scores + ranks, upserts to public.sector_rank_history.

Phase 3 PR #7 — the missing upstream that powers the Sector Outlook
commentary tile. Edge function generate-commentary reads this table and
asks Claude Haiku to write a one-sentence sector blurb.

Methodology
-----------
1. Read public/latest_scan_data.json (already produced by trading-scanner main.py).
2. For each (ticker, sector) pair in signals.screener[T].sector, group by sector.
3. Sector composite = average of signals.technicals[T].composite across tickers in
   the sector (bidirectional -100..+100 SCTR-style score). Ignores tickers
   without a composite.
4. Rank sectors 1..N by composite_score DESC (1 = strongest, N = weakest).
5. Upsert one row per (as_of, sector) into public.sector_rank_history.

Trigger: Invoked by SCAN_330PM workflow's post-scan step.
Reads: public/latest_scan_data.json (committed by the scanner).
Writes: public.sector_rank_history (one row per sector per day).

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY required.
"""
import json
import os
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError


def env(name):
    v = os.environ.get(name, "").strip()
    if not v:
        raise SystemExit(f"missing env var: {name}")
    return v


def supabase_upsert(url, key, table, rows, on_conflict):
    if not rows:
        return 0
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}?{urlencode({'on_conflict': on_conflict})}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    body = json.dumps(rows).encode("utf-8")
    req = Request(endpoint, data=body, method="POST")
    for h, v in headers.items():
        req.add_header(h, v)
    try:
        with urlopen(req, timeout=60) as r:
            if r.status >= 300:
                raise RuntimeError(f"upsert HTTP {r.status}")
            return len(rows)
    except HTTPError as e:
        try:
            body_str = e.read().decode("utf-8")
        except Exception:
            body_str = str(e)
        raise RuntimeError(f"upsert HTTP {e.code}: {body_str[:300]}")


def main():
    # Read latest_scan_data.json from disk (script runs in checked-out repo).
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scan_path = os.path.join(repo_root, "public", "latest_scan_data.json")
    if not os.path.exists(scan_path):
        raise SystemExit(f"missing {scan_path} — run the scanner first")

    with open(scan_path) as f:
        data = json.load(f)

    screener = (data.get("signals") or {}).get("screener") or {}
    technicals = (data.get("signals") or {}).get("technicals") or {}
    if not screener or not technicals:
        raise SystemExit("scan data missing signals.screener or signals.technicals")

    # Aggregate per sector.
    by_sector = {}  # sector -> {composites: [...], ticker_count: int}
    for ticker, scr in screener.items():
        sector = (scr or {}).get("sector")
        if not sector:
            continue
        tech = technicals.get(ticker) or {}
        comp_obj = tech.get("composite") or {}
        comp = comp_obj.get("score") if isinstance(comp_obj, dict) else None
        # Some tickers have technicals: { composite: { score: N, ... } }, others have technicals.composite as a number.
        if comp is None:
            comp = tech.get("composite") if isinstance(tech.get("composite"), (int, float)) else None
        if comp is None:
            continue
        try:
            f_comp = float(comp)
        except Exception:
            continue
        if sector not in by_sector:
            by_sector[sector] = {"composites": [], "ticker_count": 0}
        by_sector[sector]["composites"].append(f_comp)
        by_sector[sector]["ticker_count"] += 1

    if not by_sector:
        raise SystemExit("no sector composites computed — scan data may be empty")

    # Compute averages + sort to assign ranks.
    rows = []
    aggregated = sorted(
        [(s, sum(v["composites"]) / len(v["composites"]), v["ticker_count"])
         for s, v in by_sector.items()],
        key=lambda x: -x[1],   # highest composite first
    )
    as_of = data.get("date_label") or data.get("scan_time") or datetime.now(timezone.utc).date().isoformat()
    # Normalize as_of to YYYY-MM-DD if scan_time is ISO timestamp.
    as_of = as_of[:10] if as_of and len(as_of) >= 10 else datetime.now(timezone.utc).date().isoformat()

    for rank, (sector, score, count) in enumerate(aggregated, start=1):
        rows.append({
            "as_of":           as_of,
            "sector":          sector,
            "composite_score": round(score, 2),
            "rank_today":      rank,
            "ticker_count":    count,
        })

    print(f"Computing sector ranks for {as_of} — {len(rows)} sectors")
    for r in rows:
        print(f"  #{r['rank_today']:2}  {r['sector']:25}  score={r['composite_score']:+6.1f}  n={r['ticker_count']}")

    URL = env("SUPABASE_URL")
    SK = env("SUPABASE_SERVICE_ROLE_KEY")
    n = supabase_upsert(URL, SK, "sector_rank_history", rows, "as_of,sector")
    print(f"Upserted {n} rows into sector_rank_history")


if __name__ == "__main__":
    main()
