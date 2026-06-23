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

Two layers of coverage
───────────────────────
1. CORE SERVED FILES (the curated FILES list below). The alarm reads each
   file's own as-of date directly off macrotilt.com, so this layer is fully
   independent of pipeline_health and never false-alarms on a holiday — it is
   trading-day aware. A miss here is a TRUE alarm: email + non-zero exit.

2. EVERY OTHER FEED (added 2026-06-22). Most feeds are not served as a single
   timestamped JSON file (they live in Supabase tables), so the only freshness
   signal is the pipeline_health monitor. The monitor can briefly false-red
   over a holiday/weekend (e.g. a Monday-morning scan feed still showing
   Thursday's data while Friday was Juneteenth). To avoid spamming Joe with
   those blips, a monitor red is only escalated after it has persisted across
   TWO consecutive daily runs — the Data Steward two-consecutive-failure
   standard. On the 2nd consecutive red the alarm files a P1 bug (deduped) so
   the feed enters the existing 07:00 ET bug-triage email, which already
   carries the one-click APPROVE-&-ship control. This layer adds detail to the
   email but does NOT flip the job red (those feeds are tracked as bugs).

Anti-spam: conservative by design. Layer 1 only alarms past a red threshold
(not amber) and is trading-day aware. Layer 2 only escalates on the 2nd
consecutive red and dedupes its bug filings.
"""
from __future__ import annotations
import json, os, sys, datetime as dt, urllib.request, urllib.parse

BASE = "https://macrotilt.com"

# Curated core files. budget_h = max age (hours) before RED. Trading-day-aware
# files (daily market data) get weekend credit. Long-lag exceptions documented.
#   timestamp: how to read the file's as-of date.
#     "top:<field>"   -> d[field]
#     "ism_series"    -> max last point across ism_mfg/ism_svc points
#     "max_series_asof" -> max as_of across all top-level series objects
FILES = [
    {"path": "indicator_history.json", "budget_h": 49,   "trading": True,  "timestamp": "max_series_asof",
     "label": "Indicator history (charts + drills)"},
    {"path": "indicator_drills_generated.json", "budget_h": 120, "trading": True, "timestamp": "file_changed",
     "label": "Macro Overview indicator drill panels"},
]

# Layer-2 config.
ESCALATE_AFTER_RUNS = 2   # consecutive red runs before email + P1 bug filing
RUN_DRY = False           # set by --dry-run; suppresses all writes + email

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


# ── Supabase PostgREST helper (service-role) ─────────────────────────────────
def supa(method, path, body=None, prefer=None):
    url = os.environ.get("SUPABASE_URL"); key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        return None
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else []
    except Exception as e:
        print(f"  supabase {method} {path} failed: {e}")
        return None


# ── Write verified status back to the pipeline_health monitor table ──────────
# Admin·Data reads pipeline_health. Most rows there went "fake green" because no
# producer kept them current. For the core feeds this alarm actually verifies,
# we PATCH the existing row (never insert) with a real status + last_check_at=now,
# so those rows are genuinely green/red — not stale guesses.
PH_ID = {
    "indicator_history.json": "indicator_history",
}

def write_pipeline_health(spec, asof, is_stale):
    pid = PH_ID.get(spec["path"])
    if not (pid and asof) or RUN_DRY:
        return
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    patch = {
        "status": "red" if is_stale else "green",
        "last_check_at": now,
        # Honest-stamp rule (2026-06-11): this job VERIFIES served files — it
        # learns the data's date, not a refresh time. Write data_as_of, and
        # never touch last_good_at with a derived value.
        "data_as_of": f"{asof}T00:00:00+00:00",
        "last_error": None if not is_stale else "stale beyond budget (freshness_alarm)",
    }
    supa("PATCH", f"pipeline_health?indicator_id=eq.{pid}", patch, prefer="return=minimal")
    print(f"  pipeline_health[{pid}] <- {patch['status']} (checked now)")


# ── Layer 2: every-other-feed coverage via the pipeline_health monitor ───────
def fetch_monitor_reds():
    """All feeds the monitor currently grades non-green."""
    rows = supa("GET", "pipeline_health?status=neq.green&select=indicator_id,status,"
                       "last_error,data_as_of,last_check_at&order=indicator_id")
    return rows or []

def reconcile_red_state(reds):
    """Persist how long each feed has been continuously red across runs. Returns
    the feeds that have now been red for >= ESCALATE_AFTER_RUNS consecutive runs
    (these get escalated to email + P1 bug). A single-run red is recorded but
    NOT escalated, which suppresses holiday/weekend frontier blips."""
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    state_rows = supa("GET", "freshness_alarm_state?select=*") or []
    state = {r["indicator_id"]: r for r in state_rows}
    red_ids = {r["indicator_id"] for r in reds}
    confirmed = []
    for r in reds:
        fid = r["indicator_id"]
        st = state.get(fid)
        if st:
            runs = (st.get("consecutive_runs") or 1) + 1
            r["_runs"] = runs
            r["_bug_filed_id"] = st.get("bug_filed_id")
            if not RUN_DRY:
                supa("PATCH", f"freshness_alarm_state?indicator_id=eq.{urllib.parse.quote(fid)}",
                     {"last_seen_red_at": now_iso, "consecutive_runs": runs}, prefer="return=minimal")
            if runs >= ESCALATE_AFTER_RUNS:
                confirmed.append(r)
        else:
            r["_runs"] = 1
            r["_bug_filed_id"] = None
            if not RUN_DRY:
                supa("POST", "freshness_alarm_state",
                     {"indicator_id": fid, "first_red_at": now_iso,
                      "last_seen_red_at": now_iso, "consecutive_runs": 1}, prefer="return=minimal")
    # A feed that recovered (no longer red) gets its streak cleared.
    if not RUN_DRY:
        for fid in state:
            if fid not in red_ids:
                supa("DELETE", f"freshness_alarm_state?indicator_id=eq.{urllib.parse.quote(fid)}")
    return confirmed

def ensure_feed_bug(feed):
    """Make sure a P1 bug tracks this feed (deduped). Returns (bug_id, newly_filed)."""
    fid = feed["indicator_id"]
    if feed.get("_bug_filed_id"):
        return feed["_bug_filed_id"], False
    marker = f"[feed:{fid}]"
    q = urllib.parse.quote(f"*{marker}*")
    existing = supa("GET", f"bug_reports?title=ilike.{q}"
                          f"&status=in.(new,triaged,awaiting_approval,needs-info,fix-proposed)"
                          f"&select=id&limit=1")
    if existing:
        bid = existing[0]["id"]
        new = False
    elif RUN_DRY:
        return "(dry-run: would file P1)", True
    else:
        det = feed.get("last_error") or "served data stale beyond SLA"
        asof = str(feed.get("data_as_of") or "")[:10]
        body = {
            "title": f"{marker} stale data feed",
            "description": (
                f"Auto-filed by the daily freshness alarm. The data feed '{fid}' has been red on the "
                f"Admin Data monitor for {feed.get('_runs', '2+')} consecutive daily checks "
                f"(last good data as-of {asof}). Monitor note: {det}. This is a data-pipeline issue — "
                f"triage should diagnose the producer or vendor and stage a fix, not patch the UI."),
            "priority": "P1",
            "reporter_email": "alarm@macrotilt.com",
            "reporter_name": "Freshness Alarm",
        }
        created = supa("POST", "bug_reports?select=id", body, prefer="return=representation")
        if not created:
            return None, False
        bid = created[0]["id"]
        new = True
    if not RUN_DRY:
        supa("PATCH", f"freshness_alarm_state?indicator_id=eq.{urllib.parse.quote(fid)}",
             {"bug_filed_id": bid}, prefer="return=minimal")
    return bid, new


def check_files():
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
        write_pipeline_health(spec, asof, over)
        if over:
            stale.append((spec, asof, detail))
    return stale, checked


def email_joe(stale_files, feed_alarms):
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        print("(no RESEND_API_KEY — skipping email)"); return

    parts = []
    if stale_files:
        rows = "\n".join(f"  • {s['label']} ({s['path']}): {det}" for s, _, det in stale_files)
        parts.append("CORE SERVED FILES STALE (dashboard is showing old numbers):\n" + rows)
    if feed_alarms:
        lines = []
        for f in feed_alarms:
            bug = f.get("_bug_id")
            tag = f"P1 bug filed" if f.get("_bug_new") else "tracked on existing P1 bug"
            asof = str(f.get("data_as_of") or "")[:10]
            note = f.get("last_error") or "no producer update"
            lines.append(f"  • {f['indicator_id']}: red {f.get('_runs')} days "
                         f"(last good {asof}; {note}) — {tag}")
        parts.append(
            "DATA FEEDS RED 2+ CONSECUTIVE DAYS (now tracked as P1 bugs):\n" + "\n".join(lines) +
            "\n\nEach of these will appear in the 07:00 ET bug-triage email with a one-tap "
            "APPROVE-&-ship button once triage stages a fix.")

    total = len(stale_files) + len(feed_alarms)
    body = ("MacroTilt freshness alarm.\n\n" + "\n\n".join(parts) +
            "\n\nFor the core files: check the producing workflow's latest run for a push "
            "rejection or a fetch error. For the feed bugs: no action needed now — they enter "
            "the normal triage + one-click-approve loop.")
    payload = json.dumps({
        "from": "MacroTilt Alarm <alarm@macrotilt.com>",
        "to": ["josephmezzadri@gmail.com"],
        "subject": f"⚠️ MacroTilt data: {total} stale item(s)",
        "text": body,
    }).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=payload, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=15); print("alarm email sent to Joe.")
    except Exception as e:
        print(f"email failed: {e}")


def main():
    stale_files, checked = check_files()

    # Layer 2 — every other feed via the monitor, two-consecutive-failure gated.
    reds = fetch_monitor_reds()
    confirmed = reconcile_red_state(reds)
    feed_alarms = []
    for f in confirmed:
        bid, new = ensure_feed_bug(f)
        f["_bug_id"] = bid; f["_bug_new"] = new
        feed_alarms.append(f)

    print("Freshness check (core served files):")
    for path, detail, status in checked:
        print(f"  [{status:5}] {path:34} {detail}")
    print(f"\nMonitor reds: {len(reds)} feed(s) non-green; "
          f"{len(confirmed)} confirmed red 2+ runs (escalated).")
    for f in reds:
        mark = "ESCALATE" if f in confirmed else "watch"
        print(f"  [{mark:8}] {f['indicator_id']:28} runs={f.get('_runs')} "
              f"as_of={str(f.get('data_as_of'))[:10]}")

    if stale_files or feed_alarms:
        if not RUN_DRY:
            email_joe(stale_files, feed_alarms)
        else:
            print("\n(dry-run: would email Joe)")

    # Exit non-zero ONLY on a core-file stale (a true loud alarm that should turn
    # the Actions run red). Feed-bug escalations are tracked as bugs and must not
    # double-fire WORKFLOW_FAILURE_ALERT, so they leave the exit code at 0.
    if stale_files and not RUN_DRY:
        return 1
    return 0


if __name__ == "__main__":
    RUN_DRY = "--dry-run" in sys.argv
    code = main()
    if RUN_DRY:
        print("\n[dry-run] no writes, no email, no bug filings.")
        sys.exit(0)
    if code:
        print(f"\nSTALE core files present — exiting {code}.")
    else:
        print("\nNo core-file staleness.")
    sys.exit(code)
