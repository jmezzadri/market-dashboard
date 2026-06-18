#!/usr/bin/env python3
"""
repair_health_stamps.py — ONE-SHOT repair of every pipeline_health row
(2026-06-11, Joe-approved "fix them all in one shot").

What it fixes
─────────────
For weeks, producers wrote FABRICATED timestamps into pipeline_health:
  • last_good_at derived from the DATA's date — either midnight UTC (renders
    as 8:00 PM the previous evening in ET → "Data as of Jun 10, last refresh
    Jun 9", the impossible pair Joe caught) or a fake "T20:00:00Z" 4 PM close
    (a FUTURE stamp whenever the job ran intraday).
  • data_as_of never updated by the nightly reconciler, so eight rows froze
    in late May while their feeds kept refreshing (false-stale).

This script rewrites every row with honest values:
  • data_as_of   = the business date the data actually represents, recomputed
    from the served file / source table via reconcile_pipeline_health.resolve.
    Stored at midnight UTC = "date-only intent"; the UI renders it as a plain
    date plus the official cutoff time from the manifest.
  • last_good_at = real run evidence (the data table's own ingest/write
    timestamps, or the indicator file's build stamp). Where a row's existing
    last_good_at is honest (not fabrication-shaped) it is left alone. Where
    no evidence exists, the repair run's own verification time is used.
  • status       = recomputed from the data's true age (green/amber/red),
    never fake-green.
Also deletes forward-dated phantom rows from prices_eod (a bar whose
trade_date is after the last completed ET session, e.g. the SPAXX money-market
quirk), and prints a full before/after table.

Dry run by default; --commit writes.
"""
from __future__ import annotations
import os, sys, json, re, datetime as dt, urllib.request, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reconcile_pipeline_health import resolve, fetch_json  # noqa: E402

NOW = dt.datetime.now(dt.timezone.utc)
URL = os.environ.get("SUPABASE_URL", "https://yqaqqzseepebrocgibcw.supabase.co")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")

# Real-run-time evidence per row: (table, timestamp column).
EVIDENCE = {
    "massive-eod":               ("prices_eod",           "ingested_at"),
    "uw-universe-snapshots":     ("universe_snapshots",   "fetched_at"),
    "latest_scan":               ("trading_opps_signals", "scan_run_ts"),
    "paper-positions-snapshot":  ("paper_positions",      "last_updated"),
    "paper-nav-daily":           ("paper_nav_daily",      "created_at"),
    "paper-orders-intent":       ("paper_orders",         "created_at"),
    "massive-ticker-details":    ("ticker_reference",     "updated_at"),
    "massive-universe":          ("universe_master",      "updated_at"),
    "massive-corporate-actions": ("dividends",            "updated_at"),
}

FABRICATED_TIME = re.compile(r"T(00:00:00|20:00:00|06:00:00)(\.0+)?(\+00:00|Z)$")


def _req(path, method="GET", body=None):
    req = urllib.request.Request(
        f"{URL}/rest/v1/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None


def table_max_ts(table, col):
    try:
        rows = _req(f"{table}?select={col}&order={col}.desc&limit=1")
        v = rows[0].get(col) if rows else None
        if not v:
            return None
        ts = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=dt.timezone.utc)
        return min(ts, NOW)
    except Exception:
        return None


def parse_ts(v):
    if not v:
        return None
    try:
        ts = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return ts if ts.tzinfo else ts.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None


def fabrication_shaped(lg_raw, da_raw):
    """True when last_good_at looks manufactured rather than recorded."""
    if not lg_raw:
        return True
    lg = parse_ts(lg_raw)
    if lg and lg > NOW + dt.timedelta(minutes=5):
        return True                                  # future stamp
    if da_raw and str(lg_raw) == str(da_raw):
        return True                                  # refresh == data date
    if FABRICATED_TIME.search(str(lg_raw)):
        return True                                  # midnight / fake-close / 6 AM patterns
    return False


def last_completed_et_session():
    from zoneinfo import ZoneInfo
    now_et = NOW.astimezone(ZoneInfo("America/New_York"))
    d = now_et.date()
    if now_et.hour < 16 or (now_et.hour == 16 and now_et.minute < 5):
        d -= dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


def main():
    commit = "--commit" in sys.argv
    if not KEY:
        sys.exit("SUPABASE key missing from env")
    ih = fetch_json("indicator_history.json") or {}
    gen = parse_ts((ih.get("__meta__") or {}).get("generated_at_utc"))
    # 0) forward-dated phantom price bars FIRST — row repair below reads
    #    max(trade_date) from this table and must not see them.
    cutoff = last_completed_et_session().isoformat()
    bad = _req(f"prices_eod?select=ticker,trade_date,source&trade_date=gt.{cutoff}&limit=50") or []
    print(f"phantom forward-dated price bars (trade_date > {cutoff}): {len(bad)}")
    for b in bad:
        print(f"  {b['ticker']} {b['trade_date']} ({b.get('source')})")
    if bad and commit:
        _req(f"prices_eod?trade_date=gt.{cutoff}", "DELETE")
        print("  deleted.")
    print()
    # 0b) retire tracking rows for feeds killed on 2026-06-10 ("Kill phantom
    #     feeds" commit): the producers are gone, the rows only resurrect
    #     governance for dead elements (the 2026-06-11 registration mistake).
    for dead in ("put_call", "buffett", "bank_unreal", "adv_dec", "naaim"):
        if commit:
            _req(f"pipeline_health?indicator_id=eq.{urllib.parse.quote(dead)}", "DELETE")
        print(f"  retired tracking row: {dead}{'' if commit else ' (dry)'}")
    print()
    rows = _req("pipeline_health?select=indicator_id,label,last_good_at,data_as_of,status,last_error&limit=500&order=indicator_id")
    print(f"{'COMMIT' if commit else 'DRY RUN'} — {len(rows)} rows · now={NOW.isoformat()}\n")
    fixed_lg = fixed_da = fixed_status = 0
    for r in rows:
        iid = r["indicator_id"]
        status, detail, asof = resolve(iid, ih)
        patch = {}
        # 1) data_as_of — the truth from the data itself (date-only intent).
        if asof is not None:
            want_da = f"{asof}T00:00:00+00:00"
            if str(r.get("data_as_of") or "") != want_da:
                patch["data_as_of"] = want_da
        # 2) last_good_at — only replace fabrication-shaped values.
        if fabrication_shaped(r.get("last_good_at"), r.get("data_as_of")):
            ev = None
            if iid in EVIDENCE:
                ev = table_max_ts(*EVIDENCE[iid])
            elif iid in ih and isinstance(ih.get(iid), dict):
                ev = gen                              # file-backed series: real build time
            patch["last_good_at"] = (ev or NOW).isoformat()
        # 3) status — recomputed from true data age; never degrade to unknown.
        if status != "unknown" and status != r.get("status"):
            patch["status"] = status
            if status in ("green", "amber"):
                patch["last_error"] = None
        if patch:
            fixed_lg += 1 if "last_good_at" in patch else 0
            fixed_da += 1 if "data_as_of" in patch else 0
            fixed_status += 1 if "status" in patch else 0
            print(f"  {iid:28} {','.join(patch.keys()):44} ({detail})")
            if commit:
                _req(f"pipeline_health?indicator_id=eq.{urllib.parse.quote(iid)}", "PATCH", patch)
    print(f"\nstamps repaired: last_good_at={fixed_lg} data_as_of={fixed_da} status={fixed_status}")
    print("\ndone.")


if __name__ == "__main__":
    main()
