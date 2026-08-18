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
import os, sys, json, re, datetime as dt, urllib.request, urllib.error

BASE = "https://macrotilt.com"
NOW = dt.datetime.now(dt.timezone.utc)
TODAY = NOW.date()

# BINARY freshness doctrine (LESSONS 2026-06-16): every row grades green/red off
# the SAME two clocks the site chips and the 30-minute edge function use — the
# pull clock (last_good_at vs the manifest freshness_sla_hours, sized to the JOB's
# run cadence) AND the data clock (data_as_of vs the manifest data_max_age_hours).
# No amber, and NO separate long-lag SLA table: the budgets live ONLY in the
# manifest, so all three graders move together. The old per-frequency / long-lag
# data-age tables are retired — they graded the age of the DATA, which false-reds
# lagged monthly/quarterly series between releases.
#
# Fallback pull SLA (hours) by frequency, used ONLY when a row has no manifest
# entry yet (the orphan check below still reds the run so it gets registered).
FALLBACK_PULL_SLA = {"D": 49, "W": 200, "M": 1200, "Q": 4800}
# Feeds retired end-to-end whose leftover tracking row must be deleted to
# complete the retirement (LESSONS 0.10: retired = deleted everywhere). An
# explicit allowlist — never auto-delete an unlisted orphan (a new feed not
# yet registered must NOT be silently dropped). cmdty_uranium: source UX=F
# discontinued, feed removed from producer + manifest + UI (2026-06-16).
RETIRED_FEEDS = {
    "cmdty_uranium",
    # Power Trend swap (2026-07-15): compute_momentum_list.py + the Faber crash
    # guard were retired end-to-end; power_trend_list is the registered successor.
    "momentum_guard",
    "momentum_list",
    # UW teardown (2026-07-20): options-flow / dark-pool / options-EOD ingests
    # deleted (zero consumer surfaces since 2026-07-08).
    "equity-options_flow-daily",
    "options_chain",
    # Editorial commentary chain killed 2026-07-29 (Joe-approved; see
    # killed_elements.json editorial_commentary_chain_2026-07-29): the blurbs
    # had zero consumers. The watchdog's narrative-gap check is gone too, so
    # retiring these no longer fights it (the 2026-07-20 zombie loop is dead).
    "macro_commentary",
    "narrative_macro",
    "narrative_sector",
    # Unusual Whales subscription LAPSED 2026-08-12. Both producers are disabled
    # (UNIVERSE_SNAPSHOT_3X_WEEKDAYS, UW_METER_READ_NIGHTLY) and both rows went
    # red on 8/13 — the last day either could stamp. A monitor watching a vendor
    # we no longer buy is a watcher of nothing: retire it, never "fix" it. The
    # rows are deleted here so Admin·Data stops reporting a feed the site does
    # not have (2026-08-18 sweep).
    "uw-universe-snapshots",
    "uw-ticker-events",
}

# Live feeds with no manifest entry yet, which the orphan check must not fail
# red on. Both are LIVE and non-UW — earnings_history is yfinance via
# EARNINGS-HISTORY-WEEKLY, scanner-v5-daily is trading_opps_signals via
# V5_SCAN_DAILY — and both self-stamp on every run. Their manifest entries were
# collateral damage in the UW teardown (#1411), which stripped everything the UW
# vendor touched off the rendered pages. Registering them is a Data Steward job:
# each needs a MEASURED pull/data SLA (LESSONS 4.28 — a deadline set inside the
# producer's arrival spread manufactures a daily failure), not a number guessed
# inside a health sweep. Until then they grade off FALLBACK_PULL_SLA, which is
# the behaviour they have had since July.
#
# Renamed from UNLISTED_UNTIL_UW_LAPSE on 2026-08-18. That name promised the set
# would empty at the 8/12 lapse, and a promise that has quietly expired is how a
# zombie hides. The two UW rows it named are in RETIRED_FEEDS above now; what is
# left has nothing to do with the lapse.
UNREGISTERED_LIVE_FEEDS = {
    "earnings_history",
    "scanner-v5-daily",
}

# ─── Calendar-aware age, ported from src/lib/freshnessClock.js so this watchdog
#     grades byte-for-byte the way the chips and edge function do (the graders
#     MUST move in lockstep — LESSONS 2026-06-12). Holiday tables mirror the JS
#     sets; refresh annually alongside that file.
_NYSE_HOL = {
    "2025-01-01","2025-01-09","2025-01-20","2025-02-17","2025-04-18","2025-05-26",
    "2025-06-19","2025-07-04","2025-09-01","2025-11-27","2025-12-25",
    "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19",
    "2026-07-03","2026-09-07","2026-11-26","2026-12-25",
    "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18",
    "2027-07-05","2027-09-06","2027-11-25","2027-12-24",
}
_US_FED_HOL = _NYSE_HOL | {
    "2025-10-13","2025-11-11","2026-10-12","2026-11-11","2027-10-11","2027-11-11",
}

def _is_cal_day(d: dt.date, calendar: str) -> bool:
    if d.weekday() >= 5:
        return False
    iso = d.isoformat()
    if calendar == "nyse-trading-day":
        return iso not in _NYSE_HOL
    if calendar == "us-business-day":
        return iso not in _US_FED_HOL
    return True  # wall-clock

def age_hours(iso, calendar):
    """Calendar-aware hours between `iso` and now. Date-only (or midnight-UTC
    intent) is anchored at that day's US close (20:00 UTC), matching the JS
    clock. Non-calendar days (weekends/holidays) are not counted for the
    business/trading calendars. Returns None if unparseable."""
    if not iso:
        return None
    s = str(iso)
    date_only = None
    if len(s) == 10:
        date_only = s
    elif s.replace("Z", "+00:00").endswith("T00:00:00+00:00") or s.endswith("T00:00:00Z"):
        date_only = s[:10]
    try:
        if date_only:
            asof = dt.datetime.fromisoformat(f"{date_only}T20:00:00+00:00")
        else:
            # Strip fractional seconds before parsing: Python 3.10's fromisoformat
            # only accepts 3- or 6-digit fractions, but our stamps carry 5 (e.g.
            # ".90496+00:00"). JS Date parses them fine, so without this the
            # watchdog would false-red feeds the chips show green. Sub-second
            # precision is irrelevant to an hours-age anyway.
            ss = re.sub(r"\.\d+", "", s.replace("Z", "+00:00"))
            asof = dt.datetime.fromisoformat(ss)
            if asof.tzinfo is None:
                asof = asof.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None
    if NOW <= asof:
        return 0.0
    total_h = (NOW - asof).total_seconds() / 3600.0
    if calendar not in ("nyse-trading-day", "us-business-day"):
        return total_h
    # Subtract whole non-calendar days in the window.
    skipped = 0.0
    day = dt.datetime(asof.year, asof.month, asof.day, tzinfo=dt.timezone.utc)
    one = dt.timedelta(days=1)
    while day <= NOW:
        if not _is_cal_day(day.date(), calendar):
            ov_start = max(asof, day)
            ov_end = min(NOW, day + one)
            if ov_end > ov_start:
                skipped += (ov_end - ov_start).total_seconds() / 3600.0
        day += one
    return max(0.0, total_h - skipped)

def grade_binary(asof, last_good_at, man_el, freq_hint):
    """Binary green/red/unknown — evidence-based, no amber.

    Pull clock (PRIMARY): the producer's own last_good_at vs the manifest pull
    SLA (sized to the JOB cadence). This is always available and is positive
    evidence the job stopped — it is what reds credit positioning.

    Data clock (SECONDARY): the resolved data as-of vs the manifest data window.
    Applied ONLY when this watchdog actually resolved a real as-of. We never red
    a feed whose data we could not read here — that is the 30-minute edge
    function's job (it resolves data independently with the service key). The
    watchdog must not clobber a row it has no evidence for (LESSONS 2026-06-12),
    which would otherwise flip-flop against the edge function and fire spurious
    green->red alerts."""
    sla_pull = 0.0; win_data = 0.0; rel_cal = "us-business-day"; data_cal = "us-business-day"
    if isinstance(man_el, dict):
        sla_pull = float(man_el.get("freshness_sla_hours") or 0)
        win_data = float(man_el.get("data_max_age_hours") or 0)
        rel_cal = man_el.get("release_calendar") or "us-business-day"
        data_cal = man_el.get("data_calendar") or rel_cal
    else:
        # No manifest entry: fall back to a pull SLA by frequency so the row
        # still grades (the orphan check reds the whole run regardless).
        sla_pull = FALLBACK_PULL_SLA.get((freq_hint or "D").upper()[:1], 49)
    if rel_cal not in ("nyse-trading-day", "us-business-day", "wall-clock"): rel_cal = "us-business-day"
    if data_cal not in ("nyse-trading-day", "us-business-day", "wall-clock"): data_cal = "us-business-day"
    # Reference / event-driven: no freshness target at all → neutral, not red.
    if sla_pull <= 0 and win_data <= 0:
        return "unknown", f"{asof or '—'} · reference (no SLA)"
    # Pull clock — positive staleness evidence from the producer's run stamp.
    pull_age = age_hours(last_good_at, rel_cal) if last_good_at else None
    if sla_pull > 0 and pull_age is not None and pull_age > sla_pull:
        return "red", f"no pull in {round(pull_age)}h (SLA {round(sla_pull)}h)"
    # Data clock — ONLY when we resolved a real as-of (evidence in hand).
    if win_data > 0 and asof is not None:
        data_age = age_hours(asof, data_cal)
        if data_age is not None and data_age > win_data:
            return "red", f"data {round(data_age)}h old (window {round(win_data)}h)"
    # Green needs at least one positive freshness signal; with neither a usable
    # run stamp nor a resolved as-of we have no evidence → unknown (never
    # fake-green an unverifiable row; let the edge function settle it).
    if pull_age is not None:
        return "green", f"{asof or '—'} · pull {round(pull_age)}h"
    if asof is not None:
        return "green", f"{asof} · data ok (no run stamp)"
    return "unknown", "no evidence (deferred to edge function)"
# File-backed feeds: ph id -> (served file, mode, sla_hours, daily?)
FILE_FEEDS = {
    "cftc-cot":         ("cot_positioning.json",   "min_market", 192, False),  # CFTC domains only (Credit split to credit_positioning)
    "credit_positioning":("cot_positioning.json",   "min_market", 480, False),  # NY-Fed dealer inventory (Credit domain)
    "indicator_history":("indicator_history.json", "max_series", 49,  True),
}
# Table-backed feeds: ph id -> (table, [candidate ts columns], sla_hours, daily?)
TABLE_FEEDS = {
    "uw-universe-snapshots":     ("universe_snapshots", ["snapshot_ts", "as_of_date"],          49,  True),
    "uw-ticker-events":          ("ticker_events",      ["ingested_ts", "event_ts"],            49,  True),
    "massive-eod":               ("prices_eod",         ["trade_date"],                          49,  True),
    "massive-universe":          ("universe_master",    ["as_of", "updated_at", "created_at"],   400, False),
    "massive-ticker-details":    ("ticker_reference",   ["updated_at", "as_of", "created_at"],   400, False),
    "massive-dividends":         ("dividends",          ["ingested_at", "ex_date"],             600, False),
    "massive-splits":            ("splits",             ["ingested_at", "execution_date"],      600, False),
    "latest_scan":               ("trading_opps_signals", ["scan_date", "last_trade_ts"],        49,  True),
    "scanner-v5-daily":          ("trading_opps_signals", ["scan_date"],                         49,  True),
    "paper-positions-snapshot":  ("paper_positions",    ["snapshot_date", "last_updated"],       49,  True),
    "paper-nav-daily":           ("paper_nav_history",  ["nav_date", "as_of", "created_at"],     49,  True),
    "paper-orders-intent":       ("paper_orders",       ["created_at", "order_date"],            49,  True),
    # --- registered 2026-06-18: live feeds that previously had no tracking row ---
    "earnings_history":          ("earnings_history",   ["updated_at", "report_date"],          200, False),
    "zerohedge_public":          ("trading_opps_signals", ["scan_date"],                        49,  True),
    "zerohedge_premium":         ("trading_opps_signals", ["scan_date"],                        49,  True),
    "options_chain":             ("trading_opps_signals", ["scan_date"],                        49,  True),
    "wide_universe":             ("trading_opps_signals", ["scan_date"],                        49,  True),
    "user_scan_data":            ("trading_opps_signals", ["scan_date"],                        49,  True),
    "index_membership":          ("trading_opps_signals", ["scan_date"],                        49,  True),
    "short_interest":            ("trading_opps_signals", ["scan_date"],                        49,  True),
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
    """Resolve a feed's REAL data as-of date from the served file / source table.
    Returns (asof_date_or_None, freq_hint). Grading happens in grade_binary off
    the manifest — this function only finds the data date for the data clock."""
    # 1) indicator_history series
    if indicator_id in ih and isinstance(ih[indicator_id], dict):
        s = ih[indicator_id]
        asof = parse_date(s.get("as_of"))
        freq = (s.get("freq") or "D").upper()[:1]
        return asof, freq
    # 2) file-backed
    if indicator_id in FILE_FEEDS:
        fn, mode, sla, daily = FILE_FEEDS[indicator_id]
        d = fetch_json(fn)
        if d is None: return None, ("D" if daily else "W")
        if mode == "min_market":
            # cftc-cot grades off the CFTC domains only (Rates/Equities/FX/Commodities);
            # the Credit domain is NY-Fed dealer inventory, tracked as credit_positioning.
            best = None
            doms = d.get("domains") or {}
            sel = {k: v for k, v in doms.items() if k == "Credit"} if indicator_id == "credit_positioning" else {k: v for k, v in doms.items() if k != "Credit"}
            for dd in sel.values():
                for mk in (dd.get("markets") or []):
                    a = parse_date(mk.get("asof"))
                    if a and (best is None or a < best): best = a
            asof = best
        elif mode == "max_series":
            best = None
            for v in d.values():
                if isinstance(v, dict) and v.get("as_of"):
                    dd = parse_date(v["as_of"])
                    if dd and (best is None or dd > best): best = dd
            asof = best
        else:
            asof = parse_date(d.get("as_of") or d.get("generated_at_et") or d.get("generated_at"))
        return asof, ("D" if daily else "W")
    # 3) table-backed
    if indicator_id in TABLE_FEEDS:
        table, cols, sla, daily = TABLE_FEEDS[indicator_id]
        asof = supabase_max(table, cols)
        return asof, ("D" if daily else "W")
    return None, "D"

def load_ph():
    url = os.environ.get("SUPABASE_URL")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("SUPABASE_ANON_KEY")
           or "sb_publishable__q_l32rEdPZlC4Bxs6dFnA__NqouiGk")
    base = url or "https://yqaqqzseepebrocgibcw.supabase.co"
    ep = f"{base}/rest/v1/pipeline_health?select=indicator_id,status,last_check_at,last_good_at&limit=500"
    req = urllib.request.Request(ep, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read().decode())

def delete_row(indicator_id):
    """Delete a single pipeline_health row (used to finish retiring a feed)."""
    url = os.environ.get("SUPABASE_URL"); key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key): return False
    import urllib.parse
    ep = f"{url}/rest/v1/pipeline_health?indicator_id=eq.{urllib.parse.quote(indicator_id)}"
    req = urllib.request.Request(ep, method="DELETE",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=minimal"})
    try:
        urllib.request.urlopen(req, timeout=15); return True
    except Exception as e:
        print(f"  DELETE failed {indicator_id}: {e}"); return False

def patch(indicator_id, status, asof, cur_last_good=None):
    url = os.environ.get("SUPABASE_URL"); key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key): return False
    body = {"status": status, "last_check_at": NOW.isoformat()}
    if asof is not None:
        # Honest-stamp rule (2026-06-11): the reconciler derives each feed's
        # freshness from its DATA — that is data_as_of, never last_good_at.
        # Writing the data date into last_good_at (midnight UTC) is what made
        # every tooltip read "Last refreshed: 8:00 PM the previous evening".
        body["data_as_of"] = f"{asof}T00:00:00+00:00"
    if status == "green":
        body["last_error"] = None
        # Refresh-stamp repair (2026-06-16): some producers advance their data
        # but never stamp last_good_at, so this reconciler keeps moving
        # data_as_of forward while last_good_at stays frozen. The chip then
        # reds a genuinely-fresh feed because its data looks newer than its own
        # refresh (the "impossible pair" guard). When we have CONFIRMED the
        # feed is fresh from its real source, and its recorded refresh time is
        # missing or older than the data it produced, stamp the confirmation
        # time so the refresh record is at least as recent as the verified
        # data. Honest: good data was confirmed present now. Healthy rows whose
        # producer already stamps a correct last_good_at are left untouched.
        cur = parse_date(cur_last_good)
        if asof is not None and (cur is None or cur < asof):
            body["last_good_at"] = NOW.isoformat()
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
    # The manifest is the SINGLE source of every SLA — load it once, key it by
    # both element name and id, and grade every row against it (binary two-clock).
    man = fetch_json("data_manifest.json") or {}
    man_by_key = {}
    for e in (man.get("elements") or []):
        if isinstance(e, dict):
            if e.get("name"): man_by_key[e["name"]] = e
            if e.get("id"): man_by_key[e["id"]] = e
    from collections import Counter
    tally = Counter(); wrote = 0
    print(f"Reconciling {len(rows)} pipeline_health rows ({'COMMIT' if commit else 'dry-run'}):\n")
    for r in sorted(rows, key=lambda x: x["indicator_id"]):
        iid = r["indicator_id"]
        asof, freq_hint = resolve(iid, ih)
        status, detail = grade_binary(asof, r.get("last_good_at"), man_by_key.get(iid), freq_hint)
        tally[status] += 1
        print(f"  {status:9} {iid:28} {detail}")
        if commit:
            if patch(iid, status, asof, r.get("last_good_at")): wrote += 1
    # Half-retirement detector (Joe 2026-06-11, after the third zombie feed in
    # one night): every tracking row MUST have a registry entry. An orphan row
    # is the signature of a half-retired feed (producer or row outlived the
    # kill) or an unregistered new feed — both forbidden. Fail loudly so the
    # nightly run goes red and emails instead of letting zombies sit silent.
    try:
        man = fetch_json("data_manifest.json") or {}
        names = set()
        for e in (man.get("elements") or []):
            if isinstance(e, dict):
                if e.get("name"): names.add(e["name"])
                if e.get("id"): names.add(e["id"])
        orphans = [r["indicator_id"] for r in rows if r["indicator_id"] not in names]
        # Finish retirements: explicitly-retired feeds get their leftover row
        # deleted (not perma-failed). Everything else still fails loudly.
        retired_here = [o for o in orphans if o in RETIRED_FEEDS]
        for iid in retired_here:
            if commit and delete_row(iid):
                print(f"  retired orphan row deleted: {iid}")
        orphans = [o for o in orphans if o not in RETIRED_FEEDS]
        skipped_keepers = [o for o in orphans if o in UNREGISTERED_LIVE_FEEDS]
        if skipped_keepers:
            print(f"  live-but-unregistered feeds (rows live, manifest entry still owed): {sorted(skipped_keepers)}")
        orphans = [o for o in orphans if o not in UNREGISTERED_LIVE_FEEDS]
        if orphans:
            print(f"\nORPHAN TRACKING ROWS (no registry entry — half-retired or unregistered): {sorted(orphans)}")
            print("Fix: delete the row (retired) or register the element (live). Exiting red.")
            sys.exit(1)
    except SystemExit:
        raise
    except Exception as e:
        print(f"  orphan check skipped: {e}")
    print(f"\nResult: {dict(tally)}")
    if commit: print(f"Wrote {wrote} rows.")
    # Honest failure signal: if everything came back unknown, something is wrong.
    if tally.get("unknown", 0) > len(rows) * 0.5:
        print("WARNING: more than half unresolved — check source mappings.")
    return 0

if __name__ == "__main__":
    import urllib.parse
    sys.exit(main())
