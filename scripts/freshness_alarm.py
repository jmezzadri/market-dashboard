#!/usr/bin/env python3
"""
freshness_alarm.py — the single LOUD alarm over actually-served data.

Why this exists
───────────────
Data froze on the site repeatedly while every dashboard showed green, because:
  • bots reported "success" even when their push to main was rejected, and
  • the admin freshness table (pipeline_health) was itself frozen / fake-green.
WORKFLOW_FAILURE_ALERT only fires on a workflow *failure* — it cannot catch a
feed that is stale while its job is green. This script checks the THING JOE
SEES: the served JSON files on macrotilt.com. It reads each file's own
timestamp, computes a trading-day-aware age, and — if anything exceeds its
budget — emails Joe once and exits non-zero (so it also shows red in Actions).

Anti-spam: this is conservative by design. It only alarms on files it can
confidently timestamp, only past a red threshold (not amber), and is
trading-day aware so a normal weekend never pages anyone.
"""
from __future__ import annotations
import json, os, sys, datetime as dt, urllib.request

BASE = "https://macrotilt.com"

# Curated core files. budget_h = max age (hours) before RED. Trading-day-aware
# files (daily market data) get weekend credit. Long-lag exceptions documented.
#   timestamp: how to read the file's as-of date.
#     "top:<field>"   -> d[field]
#     "ism_series"    -> max last point across ism_mfg/ism_svc points
#     "max_series_asof" -> max as_of across all top-level series objects
FILES = [
    {"path": "cycle_v2.json",          "budget_h": 49,   "trading": True,  "timestamp": "top:as_of",
     "label": "Macro Overview cycle board"},
    {"path": "cycle_v2_history.json",  "budget_h": 200,  "trading": False, "timestamp": "top:as_of",
     "label": "Cycle / sub-composite history charts"},
    {"path": "indicator_history.json", "budget_h": 49,   "trading": True,  "timestamp": "max_series_asof",
     "label": "Indicator history (charts + drills)"},
    {"path": "indicator_drills_generated.json", "budget_h": 120, "trading": True, "timestamp": "file_changed",
     "label": "Macro Overview indicator drill panels"},
]

def fetch(path):
    req = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "macrotilt-freshness-alarm"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())

def parse_date(s):
    s = str(s).replace("Z", "+00:00")
    for cut in (s, s[:10]):
        try:
            x = dt.datetime.fromisoformat(cut)
            return x.date() if isinstance(x, dt.datetime) else x
        except Exception:
            continue
    return None

def trading_days_between(d0, d1):
    """Whole NYSE-ish trading sessions from d0 to d1 (weekends excluded; holidays
    ignored — conservative, errs toward NOT alarming)."""
    if d0 >= d1:
        return 0
    n = 0; cur = d0
    while cur < d1:
        cur += dt.timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n

def file_asof(spec, data):
    mode = spec["timestamp"]
    if mode.startswith("top:"):
        return parse_date(data.get(mode.split(":", 1)[1]))
    if mode == "max_series_asof":
        best = None
        for v in data.values():
            if isinstance(v, dict) and "as_of" in v:
                d = parse_date(v["as_of"])
                if d and (best is None or d > best):
                    best = d
        return best
    if mode == "file_changed":
        # no internal date; fall back to any generated/last_updated field
        for k in ("generated_at_et", "generated_at", "as_of", "last_updated"):
            if k in data:
                return parse_date(data[k])
        return None
    return None

def main():
    today = dt.date.today()
    stale = []
    checked = []
    for spec in FILES:
        try:
            data = fetch(spec["path"])
        except Exception as e:
            stale.append((spec, None, f"could not fetch ({e})"))
            continue
        asof = file_asof(spec, data)
        if asof is None:
            # cannot confidently timestamp -> do NOT alarm (anti-spam); just note.
            checked.append((spec["path"], "no-timestamp", "skipped"))
            continue
        age_days = (today - asof).days
        if spec["trading"]:
            sessions = trading_days_between(asof, today)
            over = sessions > max(1, round(spec["budget_h"] / 24) + 1)
            detail = f"as_of {asof} · {sessions} trading sessions old"
        else:
            over = age_days > round(spec["budget_h"] / 24)
            detail = f"as_of {asof} · {age_days} days old"
        checked.append((spec["path"], detail, "RED" if over else "ok"))
        if over:
            stale.append((spec, asof, detail))
    return stale, checked

def email_joe(stale):
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        print("(no RESEND_API_KEY — skipping email)"); return
    rows = "\n".join(f"• {s['label']} ({s['path']}): {det}" for s, _, det in stale)
    body = ("MacroTilt freshness alarm — one or more served data files are stale "
            "beyond their budget:\n\n" + rows +
            "\n\nThis means the dashboard is showing old numbers. Check the producing "
            "workflow's latest run for a push rejection or a fetch error.")
    payload = json.dumps({
        "from": "MacroTilt Alarm <alarm@macrotilt.com>",
        "to": ["josephmezzadri@gmail.com"],
        "subject": f"⚠️ MacroTilt data stale: {len(stale)} feed(s)",
        "text": body,
    }).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=payload, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=15); print("alarm email sent to Joe.")
    except Exception as e:
        print(f"email failed: {e}")

if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    stale, checked = main()
    print("Freshness check:")
    for path, detail, status in checked:
        print(f"  [{status:5}] {path:34} {detail}")
    if stale:
        print(f"\nSTALE: {len(stale)} file(s) over budget.")
        if not dry:
            email_joe(stale)
        sys.exit(0 if dry else 1)
    print("\nAll core served data files are fresh.")
    sys.exit(0)
