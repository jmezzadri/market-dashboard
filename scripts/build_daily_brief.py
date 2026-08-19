#!/usr/bin/env python3
"""
build_daily_brief.py — ONE cloud generator for the MacroTilt daily brief.

Runs in GitHub Actions every weekday pre-market (no laptop involved). It:
  1. Pulls the two live data feeds the brief is built on (brief-latest =
     indicator values; brief-positioning = COT extremes + single-name setups).
  2. Pulls the prior-session top movers from the scan table (Supabase REST).
  3. Asks the model to compose the brief as ONE JSON object in the site's
     daily_brief schema (the same shape the home page already reads).
  4. Writes public/daily_brief.json  -> the SITE reads this.
  5. Renders the SAME JSON into the branded HTML email and sends it -> the
     EMAIL. Because both outputs come from one JSON, the site and the email
     always carry the same messaging.

Safety: BRIEF_SEND_MODE=test (default) emails ONLY the SMTP user (Joe) so the
existing 7am email pipeline is never disturbed during rollout. Set
BRIEF_SEND_MODE=live to send to the full EMAIL_TO list.
Never crashes the commit on an email failure (email is best-effort, logged).
"""
from __future__ import annotations
import json, os, sys, datetime, smtplib, urllib.request, urllib.error
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
BASE = "https://yqaqqzseepebrocgibcw.supabase.co"
MODEL = os.environ.get("BRIEF_MODEL", "claude-sonnet-4-6")

# --- WHEN a brief may exist at all (2026-08-01) -------------------------------
# This writer is fired by cron AND by workflow_run on three other pipelines, one
# of which (MONITOR-RECONCILE) runs every 6h. While the writer only wrote a JSON
# file that was harmless. The moment it also became the emailer it started
# mailing Joe a "morning brief" at 2:00am ET -- including Saturday 2026-08-01,
# a day with no session to brief. A brief is a PRE-MARKET artifact: it may only
# be built on an NYSE trading day, inside the morning window, full stop.
NYSE_HOLIDAYS = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
}
BUILD_FROM_HOUR_ET = 5    # never build "today's" brief before 05:00 ET
EMAIL_UNTIL_HOUR_ET = 10  # never email a "morning" brief after 10:00 ET

# --- WHO generates the brief (2026-08-11) ------------------------------------
# Since 2026-08-06 the model runs inside the weekday "MacroTilt Morning Brief"
# scheduled Cowork session (Joe's subscription), which commits the brief to main
# ~06:10 ET. THIS pipeline is the emailer, not the generator (see
# scripts/brief_agent_playbook.md). But main() still fell through to the metered
# Anthropic API whenever it fired BEFORE that commit landed -- which it does 2-3
# times every morning via its workflow_run piggybacks -- and that call dies
# instantly (no credits / no key), exits 1, and mails Joe a "Workflow FAILED:
# DAILY-BRIEF-WRITER" alert. Joe got two of those every weekday, minutes before
# the brief itself arrived and proved nothing was actually wrong.
#
# "The agent's brief hasn't landed yet" is a NORMAL early-morning state, not a
# failure. Skip green before the deadline; fail loudly after it, so a brief that
# genuinely never arrives still screams (BRIEF-FRESHNESS-SELFHEAL reads the same
# constant, so the two eyes always grade against ONE deadline).
#
# 2026-08-13 — this was 7 and it manufactured a red every single weekday.
# The generator is the morning scheduled session, and its commit time is a
# SPREAD, not a point: 06:12 ET on 8/11, 07:20 ET on 8/12. A 07:00 deadline sat
# INSIDE that spread, so the ~07:03 self-heal run found no brief, hit the FATAL
# below, and mailed Joe "Workflow FAILED" minutes before the brief landed fine.
# A deadline must sit AFTER the observed arrival spread of the producer it
# grades, never on top of it. 09:00 ET keeps a full hour of margin before
# EMAIL_UNTIL_HOUR_ET (10) — a brief that misses 09:00 is genuinely late and
# still worth one loud email. LESSONS 4.28.
BRIEF_EXPECTED_BY_HOUR_ET = int(os.environ.get("BRIEF_EXPECTED_BY_HOUR_ET", "9"))

def _metered_generation_enabled():
    """The in-workflow Anthropic API generator is OFF by default (Joe directive
    2026-08-06: no metered API spend on top of the subscription). Set
    BRIEF_ALLOW_METERED_API=1 to re-arm it -- e.g. a deliberate backfill."""
    return os.environ.get("BRIEF_ALLOW_METERED_API", "").lower() in ("1", "true", "yes")

def is_trading_day(d):
    return d.weekday() < 5 and d.isoformat() not in NYSE_HOLIDAYS

def prev_trading_day(d):
    from datetime import timedelta
    p = d - timedelta(days=1)
    while not is_trading_day(p):
        p -= timedelta(days=1)
    return p

def _ignore_calendar():
    """Manual escape hatch for a dispatched backfill. Deliberately NOT the same
    flag as BRIEF_FORCE_REBUILD, which the self-heal sets on every run -- the
    self-heal must stay inside the calendar, or it re-opens this same hole."""
    return os.environ.get("BRIEF_IGNORE_CALENDAR", "").lower() in ("1", "true", "yes")

def _status(value):
    """Tell the workflow what happened so its verify step knows a skip from a failure."""
    print(f"brief status: {value}")
    try:
        with open("/tmp/brief_status.txt", "w") as f:
            f.write(value)
    except Exception:
        pass
    return value

def claim_email_send(today):
    """Atomically claim the right to send TODAY's brief email. The table's primary
    key is the mutex: the concurrent run that loses gets a 409 and stays quiet.
    (2026-07-31: two runs 106 seconds apart each sent Joe the same brief.)"""
    url = os.environ.get("SUPABASE_URL", BASE).rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        print("WARN: no service key; cannot dedupe the send", file=sys.stderr)
        return True
    body = json.dumps({"brief_date": today,
                       "sent_by": os.environ.get("GITHUB_RUN_ID", "local")}).encode()
    req = urllib.request.Request(
        f"{url}/rest/v1/brief_email_log",
        data=body, method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    try:
        with urllib.request.urlopen(req, timeout=20):
            return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print(f"email for {today} already sent by another run — skipping send")
            return False
        print(f"WARN: send-lock insert failed ({e.code}); sending anyway", file=sys.stderr)
        return True
    except Exception as e:
        print(f"WARN: send-lock unreachable ({e}); sending anyway", file=sys.stderr)
        return True

def _supabase_rest(method, path, body=None):
    """Small PostgREST helper for the two claim-lifecycle calls below."""
    url = os.environ.get("SUPABASE_URL", BASE).rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        return None
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status

def _record_email_failure(today, detail):
    """Write WHY the send failed. Without this the failure is invisible: the send is
    best-effort so the workflow step stays green, and the only symptom is an email that
    never arrives (2026-08-13)."""
    try:
        _supabase_rest("POST", "brief_email_failures", {
            "brief_date": today, "error": detail[:2000],
            "run_id": os.environ.get("GITHUB_RUN_ID", "local")})
    except Exception as e:
        print(f"WARN: could not record the email failure ({e})", file=sys.stderr)

def _release_email_claim(today):
    """Give the day's send-once claim back after a failed send, so the next of the
    morning's many runs can try again. Keeping it would turn one transient SMTP error
    into a whole day with no brief email."""
    try:
        _supabase_rest("DELETE", f"brief_email_log?brief_date=eq.{today}")
        print(f"released the send-once claim for {today} — a later run will retry")
    except Exception as e:
        print(f"WARN: could not release the send claim ({e}); "
              f"today's brief email will not retry", file=sys.stderr)

# --- Banned-copy guard (Joe, 2026-06-26): never publish "washed out" / "crowded".
# Low COT percentile -> "extended short"; high -> "extended long". Deterministic
# backstop to the prompt rule, so a model slip can never reach the site or email.
def _scrub_text(s):
    if not isinstance(s, str):
        return s
    # --- Plumbing guard (2026-07-30): the hardened accuracy contract made the model
    # label every figure, and it began leaking its own bookkeeping into reader copy --
    # "(prior cash close, Jul 29 DATA)", "(is_new_this_week: true)". The prompt forbids
    # it; this is the deterministic backstop, same pattern as the banned-copy guard.
    import re as _re
    s = _re.sub(r",?\s*(?:as of\s*)?[A-Z][a-z]{2}\s+\d{1,2}\s+DATA\b", "", s)
    s = _re.sub(r",?\s*\bDATA\b(?=\s*[),])", "", s)
    s = _re.sub(r"\s*\((?:is_new_this_week|is_new_extreme|weeks_at_extreme|trading_days_at_extreme|pctile_3yr|spec_pctile|pctile_change_wow)\s*:\s*[^)]*\)", "", s)
    s = _re.sub(r"\(\s*,\s*", "(", s).replace("( ", "(").replace(" )", ")").replace("()", "")
    for a, b in (("crowded long", "extended long"), ("Crowded long", "Extended long"),
                 ("washed out", "extended short"), ("Washed out", "Extended short"),
                 ("washed-out", "extended short"), ("Washed-out", "Extended short"),
                 ("crowded", "extended"), ("Crowded", "Extended")):
        s = s.replace(a, b)
    return s
def scrub_banned(obj):
    if isinstance(obj, str):
        return _scrub_text(obj)
    if isinstance(obj, list):
        return [scrub_banned(x) for x in obj]
    if isinstance(obj, dict):
        return {k: scrub_banned(v) for k, v in obj.items()}
    return obj

def _get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode()

def fetch_feeds():
    feeds = {}
    for name in ("brief-latest", "brief-positioning"):
        try:
            feeds[name] = json.loads(_get(f"{BASE}/functions/v1/{name}"))
        except Exception as e:
            print(f"WARN: feed {name} unreachable: {e}", file=sys.stderr)
            feeds[name] = None
    return feeds

# The project's public (anon, RLS-scoped) API key — the same one shipped in the
# site's JS bundle. Public by design; grants read-only access under RLS.
PUBLIC_ANON_KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYXFxenNlZXBlYnJvY2dpYmN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NTk4NzEsImV4cCI6MjA5MjEzNTg3MX0.kFklzccOIgXQger8jKHnuH4m1I_CqVQytmVtqUST900")

def fetch_movers():
    """Top 5 prior-session movers by abs(change_pct) from the latest scan."""
    url = os.environ.get("SUPABASE_URL", BASE).rstrip("/")
    # Movers need only read access to the scan table, which the site's PUBLIC
    # anon key already has (it ships in every client bundle — not a secret).
    # Falling back to it lets the --prepare-file path (subscription-era brief,
    # run where no GH secrets exist) still attach real movers.
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or PUBLIC_ANON_KEY
    if not key:
        return []
    H = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        # latest scan_date
        d = json.loads(_get(f"{url}/rest/v1/trading_opps_signals?select=scan_date&order=scan_date.desc&limit=1", H))
        if not d:
            return []
        sd = d[0]["scan_date"]
        rows = json.loads(_get(
            f"{url}/rest/v1/trading_opps_signals?select=ticker,change_pct&scan_date=eq.{sd}&change_pct=not.is.null", H))
        rows = [r for r in rows if r.get("change_pct") is not None]
        rows.sort(key=lambda r: abs(r["change_pct"]), reverse=True)
        return [{"ticker": r["ticker"], "pct": round(r["change_pct"], 1), "link": True} for r in rows[:5]]
    except Exception as e:
        print(f"WARN: movers query failed: {e}", file=sys.stderr)
        return []

PROMPT = """You are MacroTilt's daily market-brief analyst. Today is {today} (ET). It is PRE-MARKET (~6am ET).

WHO READS THIS. Active traders, portfolio managers and allocators — Joe first. They know what MOVE, 2s10s, OAS, DXY, bid-to-cover, dealer takedown and term premium are. They are busy. They will not read a thousand words to find the picture.

THE ONE RULE THAT DECIDES EVERYTHING (Joe, 2026-08-19). The LEVELS AND CHANGES ARE ALREADY DONE. A market-snapshot table is attached to this brief automatically, from the feed, after you write: 2y, 10y, 2s10s, 10y real, 10y breakeven, term premium, MOVE, S&P, Nasdaq, Dow, VIX, VIX term structure, SKEW, CAPE, IG OAS, HY-IG, HYG/LQD, SOFR-OIS, CP spread, RRP, TGA, WTI, Brent, gold, copper, DXY, USD/JPY, EUR/USD. NEVER restate a row of that table in prose. Your entire job is the sentence AFTER the numbers — the so-what. If a move has no so-what, the table already said it and you say nothing.

  WRONG (62 words, and every number is already in the table):
    "The most important change since yesterday morning is that the long end
     stopped rising. The 30-year Treasury yield closed Tuesday at 5.28% against
     5.31% Monday, the 20-year at 5.28% from 5.30%, the 10-year at 4.71% from
     4.72%, and the 2-year was unchanged at 4.19%. The gap between the 10-year
     and the 2-year narrowed to 52 basis points from 53. The bond market's
     gauge of expected price swings eased to 75 from 75.6."
  RIGHT (a number NOT in the table, then the so-what, 34 words):
    "30y 5.28%, -3bp; 20y 5.28%, -2bp — first down day in a week, and it gets
     tested at 1pm: $16bn 20y auction into the same level. Dealer takedown, not
     the yield, is the tell (30y took 11.5% last week)."

WRITE FOR THE DESK, NOT FOR A BEGINNER (this REVERSES the old plain-English rule, Joe 2026-08-19). Use the market's own name for a thing and stop: "MOVE 75", never "the bond market's gauge of expected price swings"; "2s10s 52bp", never "the gap between the 10-year and the 2-year"; "HY OAS", "dealer takedown", "days to cover", "COT 91st %ile". NO appositive translations, NO glosses, NO "which is the price of insurance against...". Every explanatory clause you delete is a clause Joe does not have to read.

DATA LINES, THEN THE SO-WHAT. For any figure NOT in the snapshot table (30y, 20y, futures, a single stock, an overnight level, an economic release), write it as a data line, not a sentence: "Brent $91.54, +0.6% (~6am ET)". Then, only if there is one, one sentence of what it means. An observation is not a brief. If you cannot say why a PM should care, cut it.

HARD LENGTH CAPS — the prepare step REFUSES a brief that breaks any of these, listing every overage. Write to them the first time.
  headline <=140 chars · stance <=320 chars (2 sentences, the day in one breath)
  each section: <=3 bullets, each <=200 chars · positioning <=220 · single-name note <=200
  news: <=4 items, head <=70, body <=190 · implications: <=3, each <=200
  watch: <=4 items, head <=60, body <=170 · WHOLE BRIEF <=700 words
Silence is free and always allowed. "nothing material." is a correct section.

HARD ACCURACY CONTRACT (overrides every other instruction here. A wrong number or a fabricated event destroys the brief. An omitted figure is correct; a wrong one is a failure. Added 2026-07-30 after the brief claimed an AAPL/AMZN earnings beat and after-hours pop on a day both companies had NOT yet reported, and described the 30-year yield as having "eased back from 5.21%" while it was in fact printing a NEW high of 5.237% — see LESSONS.)
 1. SOURCED NUMBERS ONLY. Every figure must come from either (a) the DATA block below, or (b) a page you actually fetched THIS RUN whose publication timestamp you can see. Never a number from memory, from inference, or from a search snippet with no visible date. If you cannot source it, omit it.
 2. NO DIRECTION WITHOUT TWO SOURCED POINTS. "Eased back", "stabilized", "rebounded", "off its highs", "steady", "holding" are CLAIMS about a path. Write one ONLY when you hold two timestamped sourced levels and the later one actually supports it.
 3. NEVER call a level a high / record / ATH / "highest since X" unless you fetched a source saying so AND you hold no later sourced level that exceeds it. If the level you cite is a prior-session print, label it ("Tuesday's close").
 4. EARNINGS ARE EVENTS WITH DATES — CHECK THE DATE BEFORE YOU WRITE. If the report is TODAY or LATER, the ONLY permitted phrasing is "reports after today's close" / "reports before tomorrow's open". NEVER state results that have not been published.
 5. SINGLE-STOCK EXTENDED-HOURS MOVES: PERCENT, FROM A DATED STORY (last 6h), OR NOT AT ALL. Never a dollar level inferred from a close plus a move.
 6. SELF-CHECK BEFORE RETURNING. Name to yourself which fetch produced every number and direction word; delete anything that fails; check the output does not contradict itself; then check every cap above.

READER-FACING LABELS ONLY. NEVER print an internal field name, key, or the word DATA. NEVER name a publication, wire, network, index provider, vendor, feed or URL — "futures price ~42% odds", never "42% on CME FedWatch". NEVER write "as of this writing", "no results are available yet", or any phrase describing the state of your own research. NEVER narrate your own rules to the reader.

BANNED WORDS - never output these in ANY field: "washed out", "crowded". For a low COT percentile write "extended short"; for a high percentile write "extended long".

DATA (source of truth for current values + positioning). EVERY value in here is a PRIOR CASH CLOSE. The feed carries NO 30-year yield and NO equity-futures level, so any long-bond or futures figure is rule-1 material: source it this run with a timestamp or leave it out.
{data}

NOVELTY: fetch https://macrotilt.com/daily_brief.json — at your run time it holds the PRIOR session's brief. Treat its headline, news[], watch[], implications[] and every sections[].single_name.ticker as ALREADY SAID. Open "Macro & Rates" with the single most important thing that CHANGED. Novelty NEVER justifies an unsourced number.

Use web search for the last 12h of news, preferring stories with a visible timestamp. You MAY add an overnight / pre-market level for a fast mover (gold, oil, S&P, Nasdaq, Dow, 2Y/10Y/30Y, DXY, USD/JPY, EUR/USD) ONLY from a page you fetched this run showing that level with a publication timestamp inside the last 6 hours, labelled with that timing ("~6am ET").

OUTPUT: return ONLY a single JSON object (no prose, no markdown fence) with EXACTLY these keys:
{{
 "date": "{today}",
 "recap_session": "<prior session label e.g. 'Wed Jun 24'>",
 "eyebrow": "Morning Brief",
 "headline": "<one factual sentence, <=140 chars, no hype>",
 "stance": "<2 sentences, <=320 chars: what changed and what it means; may use <b>..</b>>",
 "news": [{{"head":"<short>","body":"<one sentence>"}}, ...],
 "implications": ["<sentence>", ...],
 "watch": [{{"head":"<short>","body":"<one sentence>"}}, ...],
 "sections": [
   {{"title":"Macro & Rates","bullets":["<=3, each <=200 chars"],"positioning":"<text or null>","single_name":null}},
   {{"title":"Equity Markets","bullets":["..."],"positioning":"<text or null>","single_name":{{"ticker":"XYZ","note":"plain reason, <=200 chars"}} or null}},
   {{"title":"Credit & Liquidity","bullets":["..."],"positioning":null,"single_name":null}}
 ],
 "movers": {movers}
}}
Do NOT emit "metrics" or "ideas" — the prepare step builds both from the feeds and will overwrite anything you put there.
Rules: a "single_name" only when a setups[] name fits that section's theme. You may wrap tickers as <a class="tklink" href="/ticker/SYM" data-route="/ticker/SYM">Name</a> and indicators as href="/indicators?ind=KEY". Return ONLY the JSON object — compact, strictly valid JSON: escape any double quotes inside string values, never put a raw newline inside a string, no trailing commas, no markdown fences, no text before or after."""

def call_model(feeds, movers, today):
    key = os.environ["ANTHROPIC_API_KEY"]
    data_str = json.dumps({k: v for k, v in feeds.items()}, ensure_ascii=False)[:14000]
    prompt = PROMPT.format(today=today, data=data_str, movers=json.dumps(movers))
    body = {
        "model": MODEL,
        "max_tokens": 4000,
        "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 6}],
        "messages": [{"role": "user", "content": prompt}],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        resp = json.loads(r.read().decode())
    text = "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text")
    obj = _extract_json(text)
    if obj is not None:
        return obj
    # one-shot repair: ask the model to return corrected, strictly-valid JSON only
    repaired = _repair_json(key, text)
    if repaired is not None:
        return repaired
    raise ValueError(f"Could not parse JSON from model output: {text[:400]}")


def _balanced_slice(text):
    """Return the first balanced {...} block, respecting strings/escapes."""
    start = text.find("{")
    if start == -1:
        return None
    depth, in_str, esc = 0, False, False
    for k in range(start, len(text)):
        c = text[k]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': in_str = False
        else:
            if c == '"': in_str = True
            elif c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return text[start:k + 1]
    return None


def _extract_json(text):
    for cand in (text, _balanced_slice(text)):
        if not cand:
            continue
        cand = cand.strip().lstrip("`")
        if cand.startswith("json"):
            cand = cand[4:]
        try:
            return json.loads(cand)
        except Exception:
            continue
    return None


def _repair_json(key, broken):
    body = {
        "model": MODEL,
        "max_tokens": 4000,
        "messages": [{"role": "user", "content":
            "The following should be a single valid JSON object but is malformed. "
            "Return ONLY the corrected, strictly-valid JSON object (no prose, no fences):\n\n" + broken[:16000]}],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read().decode())
        text = "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text")
        return _extract_json(text)
    except Exception as e:
        print(f"WARN: repair pass failed: {e}", file=sys.stderr)
        return None

def validate(brief, today):
    # HARD keys: the home page genuinely cannot render a brief without these.
    for k in ("headline", "stance", "sections"):
        if not brief.get(k):
            raise ValueError(f"brief missing required key: {k}")
    if not isinstance(brief.get("sections"), list) or not brief["sections"]:
        raise ValueError("brief.sections empty")
    brief["date"] = today  # force correct date
    # The prior-session label is a calendar fact, not a judgement call: the model
    # labelled Friday 2026-07-31 as "Thu Jul 31" in the 8/1 brief. Compute it.
    _d = datetime.date.fromisoformat(today)
    brief["recap_session"] = prev_trading_day(_d).strftime("%a %b %-d")
    if not brief.get("eyebrow"):
        brief["eyebrow"] = "Morning Brief"
    # SOFT keys: a model response that omits ONE optional list must never freeze
    # the homepage. Default them to empty; main() backfills real movers from the
    # scan table. (2026-06-30: an omitted "movers" key crashed the whole publish
    # and froze the homepage a second day running -- see LESSONS.)
    for k in ("news", "implications", "watch", "movers"):
        if not isinstance(brief.get(k), list):
            brief[k] = []
    # single_name is OPTIONAL and the schema says null when absent -- but the composing
    # session wrote the *string* "None" on 2026-08-13, and a non-empty string is truthy,
    # so `if sec.get("single_name")` waved it through and both email renderers then
    # called .get() on a str. That one stringified null cost Joe his entire brief email
    # for the day. Normalise here so the committed artifact only ever holds a real
    # {ticker, note} dict or null -- the site reads this file too. LESSONS 4.29.
    for sec in brief["sections"]:
        if not isinstance(sec, dict):
            continue
        sn = sec.get("single_name")
        if not isinstance(sn, dict) or not str(sn.get("ticker") or "").strip():
            if sn not in (None, "", [], {}):
                print(f"WARN: dropping malformed single_name in "
                      f"'{sec.get('title','?')}': {sn!r}", file=sys.stderr)
            sec["single_name"] = None
    # Length is enforced HERE, not requested in a prompt (2026-08-19). Every
    # generator path -- the metered fallback and the morning session's
    # --prepare-file -- goes through validate(), so there is exactly one place
    # a brief can get long, and it refuses.
    if os.environ.get("BRIEF_SKIP_LENGTH_CAPS", "").lower() not in ("1", "true", "yes"):
        enforce_caps(brief)
    return brief

# ---- deterministic market snapshot (2026-08-19) ------------------------------
# Joe, 2026-08-19: "30y down 3bps to 5.28% ... And if there is a so what - we can
# say what the so what is. You write so much in so much jargon, 'the bond
# market's gauge of expected price swings' — just say MOVE."
#
# Levels and changes are DATA. Prose is the worst container ever invented for
# them: the 8/19 brief spent 62 words saying what six table rows say exactly,
# and the translation layer ("the bond market's gauge of expected price swings")
# was pure cost to the only readers this brief has — Joe and active managers.
# So the numbers are now built HERE, from the feed, and the writer is forbidden
# from restating any row. The writer's whole job is the sentence after the
# table. See LESSONS 4.34.
IH_URL = "https://macrotilt.com/indicator_history.json"

# (key, display label, format). Format decides BOTH the level and the change:
#   yld  -> "4.71%"      change in basis points      ("-1bp")
#   bp   -> "270bp"      change in basis points      ("+3bp")
#   pts  -> "15.84"      change in points            ("+0.65")
#   idx  -> "7,691.76"   change in percent           ("-0.69%")
#   px   -> "$91.54"     change in percent           ("+0.57%")
#   fx   -> "1.0842"     change in percent           ("-0.20%")
#   bn   -> "$964bn"     change in billions          ("+12bn")
METRIC_GROUPS = [
    ("Rates", [
        ("ust_2y",        "2y",        "yld"),
        ("ust_10y",       "10y",       "yld"),
        ("yield_curve",   "2s10s",     "bp"),
        ("real_rates",    "10y real",  "yld"),
        ("breakeven_10y", "10y B/E",   "yld"),
        ("term_premium",  "Term prem", "bp"),
        ("move",          "MOVE",      "pts"),
    ]),
    ("Equities & vol", [
        ("spx_index",  "S&P 500",  "idx"),
        ("ndx_index",  "Nasdaq",   "idx"),
        ("dji_index",  "Dow",      "idx"),
        ("vix",        "VIX",      "pts"),
        ("vix_ts",     "VIX 1m/3m","rat"),
        ("skew",       "SKEW",     "pts"),
        ("cape",       "CAPE",     "pts"),
    ]),
    ("Credit & liquidity", [
        ("ig_oas",        "IG OAS",   "bp"),
        ("hy_ig",         "HY-IG",    "bp"),
        ("hy_ig_etf",     "HYG/LQD",  "rat"),
        ("sofr_ois",      "SOFR-OIS", "bp"),
        ("cpff",          "CP spread","bp"),
        ("rrp",           "RRP",      "bn"),
        ("tga",           "TGA",      "bn"),
    ]),
    ("Commodities & FX", [
        ("cmdty_oil",    "WTI",     "px"),
        ("cmdty_brent",  "Brent",   "px"),
        ("cmdty_gold",   "Gold",    "px"),
        ("cmdty_copper", "Copper",  "px"),
        ("usd",          "DXY",     "fx"),
        ("fx_jpy",       "USD/JPY", "fx"),
        ("fx_eur",       "EUR/USD", "fx"),
    ]),
]

def _fetch_indicator_history():
    """One read a day, at prepare time; the result is baked into the brief.

    Repo copy FIRST. Every caller of this script already holds a checkout (the
    workflow, and the morning session's `git clone --depth 1 /tmp/md`), the file
    is committed, and reading it costs nothing. The HTTP path is the fallback,
    not the default: on 2026-08-19 urllib could not complete the TLS handshake
    to macrotilt.com from a cloud sandbox that curl reached fine, which would
    have silently produced an empty snapshot -- the one thing this table exists
    to prevent."""
    local = os.path.join(os.path.dirname(__file__), "..", "public",
                         "indicator_history.json")
    try:
        with open(local, encoding="utf-8") as f:
            h = json.load(f)
        if h:
            return h
    except Exception as e:
        print(f"note: no local indicator_history ({e}); trying the site",
              file=sys.stderr)
    try:
        req = urllib.request.Request(IH_URL, headers={"User-Agent": "macrotilt-brief"})
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"WARN: indicator_history unreachable ({e})", file=sys.stderr)
    return _history_from_brief_latest()

def _history_from_brief_latest():
    """Last resort: levels with NO changes, from the feed the brief already uses.

    A snapshot with levels and blank changes is degraded but true. A snapshot
    with no rows is a silent regression to prose. Shape-matched to
    indicator_history so build_metrics needs no special case."""
    try:
        data = json.loads(_get(f"{BASE}/functions/v1/brief-latest"))
        out = {}
        for k, v in (data.get("indicators") or {}).items():
            if v.get("value") is None:
                continue
            out[k] = {"freq": "D", "unit": v.get("unit") or "",
                      "points": [[v.get("as_of"), v["value"]]]}
        print(f"WARN: snapshot degraded to levels-only ({len(out)} rows) — "
              f"indicator_history was unreadable", file=sys.stderr)
        return out
    except Exception as e:
        print(f"WARN: brief-latest fallback also failed ({e}); snapshot empty",
              file=sys.stderr)
        return {}

def _fmt_row(label, fmt, cur, prev):
    """Return {label, level, chg, dir} or None. `dir` drives colour only."""
    if cur is None:
        return None
    d = None if prev is None else cur - prev
    if fmt == "yld":
        level = f"{cur:.2f}%"
        chg = None if d is None else ("unch" if abs(d) < 0.005 else f"{d*100:+.0f}bp")
    elif fmt == "bp":
        level = f"{cur:,.0f}bp"
        chg = None if d is None else ("unch" if abs(d) < 0.5 else f"{d:+,.0f}bp")
    elif fmt == "pts":
        level = f"{cur:,.2f}"
        chg = None if d is None else ("unch" if abs(d) < 0.005 else f"{d:+,.2f}")
    elif fmt == "rat":
        level = f"{cur:,.3f}"
        chg = None if d is None else ("unch" if abs(d) < 0.0005 else f"{d:+,.3f}")
    elif fmt == "bn":
        level = f"${cur:,.1f}bn" if abs(cur) < 10 else f"${cur:,.0f}bn"
        chg = None if d is None else ("unch" if abs(d) < 0.5 else f"{d:+,.0f}bn")
    elif fmt in ("idx", "px", "fx"):
        level = (f"{cur:,.2f}" if fmt == "idx"
                 else f"${cur:,.2f}" if fmt == "px"
                 else (f"{cur:,.4f}" if cur < 10 else f"{cur:,.2f}"))
        if d is None or not prev:
            chg = None
        else:
            pct = d / prev * 100.0
            chg = "unch" if abs(pct) < 0.005 else f"{pct:+.2f}%"
    else:
        return None
    direction = "flat" if (d is None or chg == "unch") else ("up" if d > 0 else "down")
    return {"label": label, "level": level, "chg": chg, "dir": direction}

_HOLES = []

def build_metrics(hist, recap_date=None):
    """Levels + one-print changes, straight from indicator_history.json.

    A row whose newest print predates the session being recapped carries its own
    date, so a weekly credit series can never masquerade as last night's move.
    A key with no data is DROPPED — an absent row is correct, a stale one lies.
    """
    groups = []
    del _HOLES[:]
    for gname, spec in METRIC_GROUPS:
        rows = []
        for key, label, fmt in spec:
            pts = ((hist.get(key) or {}).get("points") or [])
            pts = [p for p in pts if isinstance(p, (list, tuple)) and len(p) == 2
                   and p[1] is not None]
            if not pts:
                continue
            cur_d, cur = pts[-1][0], float(pts[-1][1])
            # A "change" is only a change if the two prints are ADJACENT.
            # indicator_history carries holes -- MOVE jumped 2026-07-17 -> 08-18
            # in the file used to build this, so a naive last-two diff would have
            # printed "MOVE +4.10" for a one-day move that was actually -0.60.
            # The daily freshness gate cannot see an interior hole: it only reads
            # the newest point. So gate the DELTA on adjacency and show the level
            # alone when the gap is wrong. A missing change is correct; an
            # invented one is the failure mode this whole rewrite exists to kill.
            freq = str((hist.get(key) or {}).get("freq") or "D").upper()
            max_gap = {"D": 5, "W": 10}.get(freq)   # M/Q -> no daily change
            prev = None
            if len(pts) > 1 and max_gap:
                try:
                    gap = (datetime.date.fromisoformat(str(cur_d))
                           - datetime.date.fromisoformat(str(pts[-2][0]))).days
                except Exception:
                    gap = 999
                if 0 < gap <= max_gap:
                    prev = float(pts[-2][1])
                elif freq == "D":
                    # Surface it. A daily series whose last two prints are not
                    # adjacent has an interior hole, and the freshness chip
                    # CANNOT see it -- the chip only reads the newest point, so
                    # `move` sat with a 32-day gap (2026-07-17 -> 08-18) behind
                    # a green chip. The brief refuses to print a fabricated
                    # change; this line is how anyone finds out why. LESSONS 4.46.
                    _HOLES.append(f"{key} ({pts[-2][0]} -> {cur_d}, {gap}d)")
            unit = str((hist.get(key) or {}).get("unit") or "").lower()
            if fmt == "yld" and unit in ("bps", "bp"):
                fmt = "bp"      # never render a basis-point series as a percent
            row = _fmt_row(label, fmt, cur, prev)
            if not row:
                continue
            if recap_date and str(cur_d) < str(recap_date):
                try:
                    row["as_of"] = datetime.date.fromisoformat(str(cur_d)).strftime("%b %-d")
                except Exception:
                    row["as_of"] = str(cur_d)
            rows.append(row)
        if rows:
            groups.append({"group": gname, "rows": rows})
    if _HOLES:
        print("WARN: daily series with a hole behind the newest print — change "
              "suppressed, and the freshness chip cannot see this: "
              + ", ".join(_HOLES), file=sys.stderr)
    return groups

# ---- MacroTilt calls: open marks + track record ------------------------------
# Joe, 2026-08-19: "start including our trade ideas from MacroTilt homepage and
# where our current calls stand in terms of performance."
# Every number here comes from public/trade_idea_scores.json, which the scorer
# writes from closing prices. NOTHING in this block is written by the model, and
# no hit rate is shown until the scorer itself stops withholding one.
SCORES_URL = "https://macrotilt.com/trade_idea_scores.json"

def _load_scores():
    local = os.path.join(os.path.dirname(__file__), "..", "public", "trade_idea_scores.json")
    try:
        return json.load(open(local, encoding="utf-8"))
    except Exception:
        pass
    try:
        req = urllib.request.Request(SCORES_URL, headers={"User-Agent": "macrotilt-brief"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"WARN: trade_idea_scores unreachable: {e}", file=sys.stderr)
        return {}

def _pp(v, unit="%"):
    return None if v is None else f"{float(v):+.2f}{unit}"

def build_ideas(scores):
    """{open:[...], closed:[...], line:'...'} — compact enough for one email band."""
    if not scores:
        return None
    summ = scores.get("summary") or {}
    out_open, out_closed = [], []
    for s in (scores.get("scores") or []):
        row = {
            "trade": s.get("trade_label") or s.get("instrument") or s.get("title", "")[:60],
            "date": s.get("date"),
            "kind": s.get("kind"),
            "held": s.get("sessions_held"),
            "pnl": _pp(s.get("mark") if s.get("mark") is not None else s.get("position_pct")),
            "vs": None,
            "bench": (s.get("benchmark") or {}).get("label"),
            "horizon": s.get("horizon_months"),
        }
        bm = s.get("benchmark") or {}
        if bm.get("difference") is not None:
            row["vs"] = f"{float(bm['difference']):+.2f}pp"
        if (s.get("status") or "").lower() == "closed" or s.get("result"):
            row["result"] = s.get("result")
            out_closed.append(row)
        else:
            out_open.append(row)
    out_open.sort(key=lambda r: r.get("date") or "", reverse=True)
    out_closed.sort(key=lambda r: r.get("date") or "", reverse=True)
    n_open, n_closed = len(out_open), len(out_closed)
    if summ.get("stats_withheld"):
        need = summ.get("min_closed_for_stats", 10)
        record = (f"{n_closed} closed — no hit rate until {need} "
                  f"(too few to mean anything)")
    else:
        record = summ.get("headline") or f"{n_closed} closed"
    return {"open": out_open, "closed": out_closed[:3],
            "as_of": scores.get("as_of"),
            "line": f"{n_open} open · {record}"}

# ---- hard length caps (2026-08-19) ------------------------------------------
# Joe, 2026-08-19: "I am very busy and dont have time to read thousands of words
# to get the picture." The 8/19 brief ran ~4,500 words. Style guidance in a
# prompt does not hold a length — three separate prompts already said "concise",
# "keep it tight" and "under 500 words", and every one of them was ignored the
# moment the writer had something to say. A limit that is not enforced in code
# is a suggestion. These are enforced, and the prepare step REFUSES a brief that
# breaks them. LESSONS 4.34.
#   (field, max items, max chars per item, label)
CAPS = {
    "headline":     {"chars": 140},
    "stance":       {"chars": 320},
    "bullets":      {"items": 3, "chars": 175},   # per section
    "positioning":  {"chars": 200},
    "single_note":  {"chars": 180},
    "news":         {"items": 4, "head": 60,  "chars": 155},
    "implications": {"items": 2, "chars": 190},
    "watch":        {"items": 4, "head": 55,  "chars": 155},
}
BRIEF_MAX_WORDS = int(os.environ.get("BRIEF_MAX_WORDS", "700"))

def _plain(s):
    """Length is what the READER sees: markup and entities are not words."""
    import re as _re
    s = _re.sub(r"<[^>]+>", "", str(s or ""))
    return _re.sub(r"&[a-zA-Z#0-9]+;", " ", s).strip()


def _shingles(text, n=8):
    w = [x.lower().strip(".,;:—-()'\"") for x in _plain(text).split()]
    w = [x for x in w if x]
    return {" ".join(w[i:i + n]) for i in range(max(0, len(w) - n + 1))}


def count_words(brief):
    """What the READER reads: prose fields only, no JSON keys, no markup."""
    prose = [brief.get("headline"), brief.get("stance")]
    for sec in (brief.get("sections") or []):
        if not isinstance(sec, dict):
            continue
        prose += list(sec.get("bullets") or [])
        prose.append(sec.get("positioning"))
        sn = sec.get("single_name")
        if isinstance(sn, dict):
            prose.append(sn.get("note"))
    prose += [str(x) for x in (brief.get("implications") or [])]
    for key in ("news", "watch"):
        for it in (brief.get(key) or []):
            if isinstance(it, dict):
                prose += [it.get("head"), it.get("body")]
    return sum(len(_plain(x).split()) for x in prose if x)

def check_duplication(brief):
    """The 8/19 brief told the $3tn AI story FOUR times -- stance, an Equity
    Markets bullet, a news item and an implication -- which is how 4,500 words
    happen without anyone deciding to write 4,500 words. Six blocks are six
    ANGLES on the day, not six chances to say the same sentence. An eight-word
    run repeated across blocks is copy-paste, not emphasis. (2026-08-19)"""
    blocks = []
    for i, sec in enumerate(brief.get("sections") or []):
        if isinstance(sec, dict):
            for b in (sec.get("bullets") or []):
                blocks.append((f"{sec.get('title', 'section')} bullet", b))
    for it in (brief.get("news") or []):
        if isinstance(it, dict):
            blocks.append(("news", f"{it.get('head','')} {it.get('body','')}"))
    for t in (brief.get("implications") or []):
        blocks.append(("implications", t))
    for it in (brief.get("watch") or []):
        if isinstance(it, dict):
            blocks.append(("watch", it.get("body", "")))
    dupes = []
    seen = []
    for label, text in blocks:
        sh = _shingles(text)
        for plabel, psh in seen:
            common = sh & psh
            if common and plabel != label:
                dupes.append(f'{plabel} and {label} repeat: "{sorted(common)[0]}..."')
                break
        seen.append((label, sh))
    if dupes:
        raise ValueError("the same sentence appears in more than one block — "
                         "say it once, in the block where it belongs:\n  - "
                         + "\n  - ".join(dupes[:6]))
    return brief

def enforce_caps(brief):
    """Raise with EVERY overage at once, so one rewrite fixes the whole brief."""
    bad = []
    def chk(where, text, limit):
        n = len(_plain(text))
        if n > limit:
            bad.append(f"{where}: {n} chars (max {limit}) — cut {n - limit}")
    chk("headline", brief.get("headline"), CAPS["headline"]["chars"])
    chk("stance", brief.get("stance"), CAPS["stance"]["chars"])
    for i, sec in enumerate(brief.get("sections") or []):
        if not isinstance(sec, dict):
            continue
        t = sec.get("title") or f"section {i+1}"
        bl = sec.get("bullets") or []
        if len(bl) > CAPS["bullets"]["items"]:
            bad.append(f"{t}: {len(bl)} bullets (max {CAPS['bullets']['items']})")
        for j, b in enumerate(bl):
            chk(f"{t} bullet {j+1}", b, CAPS["bullets"]["chars"])
        if sec.get("positioning"):
            chk(f"{t} positioning", sec["positioning"], CAPS["positioning"]["chars"])
        sn = sec.get("single_name")
        if isinstance(sn, dict) and sn.get("note"):
            chk(f"{t} single name", sn["note"], CAPS["single_note"]["chars"])
    for key in ("news", "watch"):
        items = brief.get(key) or []
        if len(items) > CAPS[key]["items"]:
            bad.append(f"{key}: {len(items)} items (max {CAPS[key]['items']})")
        for j, it in enumerate(items):
            if not isinstance(it, dict):
                continue
            chk(f"{key}[{j+1}].head", it.get("head"), CAPS[key]["head"])
            chk(f"{key}[{j+1}].body", it.get("body"), CAPS[key]["chars"])
    imps = brief.get("implications") or []
    if len(imps) > CAPS["implications"]["items"]:
        bad.append(f"implications: {len(imps)} items (max {CAPS['implications']['items']})")
    for j, it in enumerate(imps):
        chk(f"implications[{j+1}]", it, CAPS["implications"]["chars"])
    words = count_words(brief)
    if words > BRIEF_MAX_WORDS:
        bad.append(f"whole brief: ~{words} words (max {BRIEF_MAX_WORDS}) — cut {words - BRIEF_MAX_WORDS}")
    if bad:
        raise ValueError("brief is too long — every item below must be cut:\n  - "
                         + "\n  - ".join(bad))
    check_duplication(brief)
    return brief

# ---- email rendering (replicates the existing branded template) ----
BLUE, INK, BODY, MUTE = "#1D4ED8", "#15181D", "#2A2F37", "#9AA1AB"
UP, DOWN, RULE = "#2F9D6A", "#C84658", "rgba(20,23,28,0.12)"
SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
SERIF = "Georgia,'Times New Roman',serif"
MONO = "SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

def _bullet(html):
    return (f'<div style="margin:2px 0;padding-left:15px;text-indent:-12px;font-family:{SANS};'
            f'font-size:13px;line-height:1.5;color:{BODY}"><span style="color:{BLUE}">&#8227;</span> {html}</div>')

def _spacer():
    return '<div style="font-size:8px;line-height:8px">&#160;</div>'

def _band(title, note=""):
    n = (f'<span style="font-family:{SANS};font-size:10px;font-weight:400;'
         f'letter-spacing:0;color:{MUTE}"> &#183; {note}</span>') if note else ""
    return (f'<div style="margin:18px 0 7px 0;font-family:{SANS};font-size:10px;'
            f'font-weight:700;letter-spacing:.14em;color:{BLUE}">{title.upper()}{n}</div>')

def _metric_cell(g):
    """One group card: label rows left, level + change right, monospaced."""
    h = [f'<div style="font-family:{SANS};font-size:10px;font-weight:700;'
         f'letter-spacing:.08em;color:{MUTE};padding-bottom:4px">{g["group"].upper()}</div>',
         '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">']
    for r in g["rows"]:
        chg = r.get("chg")
        col = UP if r.get("dir") == "up" else DOWN if r.get("dir") == "down" else MUTE
        stale = (f'<span style="color:{MUTE};font-family:{SANS};font-size:10px"> '
                 f'{r["as_of"]}</span>') if r.get("as_of") else ""
        h.append(
            f'<tr><td style="font-family:{SANS};font-size:12px;color:{BODY};'
            f'padding:1px 6px 1px 0;white-space:nowrap">{r["label"]}</td>'
            f'<td align="right" style="font-family:{MONO};font-size:12px;color:{INK};'
            f'padding:1px 8px 1px 0;white-space:nowrap">{r["level"]}{stale}</td>'
            f'<td align="right" style="font-family:{MONO};font-size:12px;color:{col};'
            f'padding:1px 0;white-space:nowrap">{chg or "&#8212;"}</td></tr>')
    h.append('</table>')
    return "".join(h)

def render_metrics_html(groups, recap):
    if not groups:
        return ""
    out = [_band("Market snapshot", f"{recap} close" if recap else "")]
    out.append('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">')
    for i in range(0, len(groups), 2):
        pair = groups[i:i + 2]
        out.append('<tr>')
        for j, g in enumerate(pair):
            pad = "0 14px 12px 0" if j == 0 else "0 0 12px 14px"
            out.append(f'<td width="50%" valign="top" style="padding:{pad}">{_metric_cell(g)}</td>')
        if len(pair) == 1:
            out.append('<td width="50%">&#160;</td>')
        out.append('</tr>')
    out.append('</table>')
    return "".join(out)

def render_ideas_html(ideas):
    if not ideas or not (ideas.get("open") or ideas.get("closed")):
        return ""
    out = [_band("MacroTilt calls", ideas.get("line", ""))]
    out.append('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">')
    def row(r, closed=False):
        col = UP if (r.get("pnl") or "").startswith("+") else DOWN if (r.get("pnl") or "").startswith("-") else MUTE
        vs = (f'<span style="font-family:{SANS};font-size:11px;color:{MUTE}"> vs '
              f'{r.get("bench") or "benchmark"} {r["vs"]}</span>') if r.get("vs") else ""
        held = f'{r["held"]}d' if r.get("held") is not None else ""
        tail = r.get("result") if closed else held
        return (f'<tr><td style="font-family:{SANS};font-size:12px;color:{BODY};'
                f'padding:2px 6px 2px 0">{r["trade"]}{vs}</td>'
                f'<td align="right" style="font-family:{MONO};font-size:12px;font-weight:700;'
                f'color:{col};padding:2px 8px 2px 0;white-space:nowrap">{r.get("pnl") or "&#8212;"}</td>'
                f'<td align="right" style="font-family:{SANS};font-size:11px;color:{MUTE};'
                f'padding:2px 0;white-space:nowrap">{tail}</td></tr>')
    for r in ideas.get("open", []):
        out.append(row(r))
    for r in ideas.get("closed", []):
        out.append(row(r, closed=True))
    out.append('</table>')
    out.append(f'<div style="margin-top:5px;font-family:{SANS};font-size:10px;color:{MUTE}">'
               f'Marked from the close that existed when each note published; price only, no costs. '
               f'Full notes at macrotilt.com.</div>')
    return "".join(out)

def render_email_html(b):
    out = []
    out.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAF7"><tr><td align="center" style="padding:24px 12px">')
    out.append(f'<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid {RULE};border-radius:12px"><tr><td style="padding:24px 28px">')
    out.append(f'<div style="margin-bottom:12px"><span style="font-family:{SERIF};font-size:20px;font-weight:700;color:{INK}">Macro</span><span style="font-family:{SERIF};font-size:20px;font-weight:700;font-style:italic;color:{BLUE}">Tilt</span><span style="font-family:{SANS};font-size:11px;font-weight:600;letter-spacing:.16em;color:{MUTE}">&#160;&#160;MARKET BRIEF</span></div>')
    # The call, then the numbers, then the reasoning. A reader who stops after
    # the snapshot has still had the whole morning's data. (2026-08-19)
    if b.get("headline"):
        out.append(f'<div style="font-family:{SERIF};font-size:19px;line-height:1.32;color:{INK};margin:2px 0 6px 0">{b["headline"]}</div>')
    if b.get("stance"):
        out.append(f'<div style="font-family:{SANS};font-size:13px;line-height:1.5;color:{BODY}">{b["stance"]}</div>')
    out.append(render_metrics_html(b.get("metrics") or [], b.get("recap_session")))
    out.append(render_ideas_html(b.get("ideas")))
    # numbered sections 1-3 (from sections[]), 4 News, 5 Implications, 6 Watch
    secs = b.get("sections", [])
    titles = ["Macro & Rates", "Equity Markets", "Credit & Liquidity"]
    n = 0
    for i, title in enumerate(titles):
        sec = secs[i] if i < len(secs) else {}
        n += 1
        # Fixed headers. The model occasionally renames slot 3 ("Movers"), which silently
        # drops Credit & Liquidity from the email and duplicates the movers data field.
        # Sections 1-3 are a contract with the reader, not the model's choice. (2026-07-30)
        out.append(f'<div style="margin:16px 0 5px 0;font-family:{SANS};font-size:13px;font-weight:700;color:{BLUE}">{n}. {title}</div>')
        _bl = (sec.get("bullets") or ([sec["prose"]] if sec.get("prose") else []))
        # A numbered header with nothing under it reads as a broken email. The prompt
        # says to write "nothing material." for a quiet section; back it deterministically
        # so the reader always sees an answer. (2026-07-30)
        if not _bl and not sec.get("positioning") and not sec.get("single_name"):
            _bl = ["nothing material."]
        for bl in _bl:
            out.append(_bullet(bl))
        if sec.get("positioning"):
            out.append(_bullet(f'<strong style="color:{INK}">Positioning:</strong> {sec["positioning"]}'))
        # Defensive: validate() normalises single_name, but the email is rendered from
        # the COMMITTED file, which can predate that normalisation. A stringified null
        # ("None") is truthy, and calling .get() on it cost Joe his entire brief email
        # on 2026-08-13. One optional field must never take down the whole email.
        # LESSONS 4.29.
        sn = sec.get("single_name")
        if isinstance(sn, dict) and str(sn.get("ticker") or "").strip():
            out.append(_bullet(f'<strong style="color:{INK}">Single name:</strong> {sn.get("ticker","")} {sn.get("note","")}'))
        out.append(_spacer())
    def block(num, title, items, kind):
        out.append(f'<div style="margin:16px 0 5px 0;font-family:{SANS};font-size:13px;font-weight:700;color:{BLUE}">{num}. {title}</div>')
        for it in items:
            if kind == "hb":
                out.append(_bullet(f'<strong style="color:{INK}">{it.get("head","")}</strong> — {it.get("body","")}'))
            else:
                out.append(_bullet(it))
        out.append(_spacer())
    block(4, "Key News & Events", b.get("news", []), "hb")
    block(5, "Implications", b.get("implications", []), "s")
    block(6, "What to Watch Today", b.get("watch", []), "hb")
    out.append(f'<div style="margin-top:16px;border-top:1px solid {RULE};padding-top:12px;font-family:{SANS};font-size:11px;color:{MUTE}">Generated by MacroTilt &#183; macrotilt.com</div>')
    out.append('</td></tr></table></td></tr></table>')
    return "".join(out)

def render_email_text(b):
    L = []
    if b.get("headline"): L.append(str(b["headline"]))
    if b.get("stance"):   L.append(str(b["stance"]))
    for g in (b.get("metrics") or []):
        L.append("")
        L.append(g["group"].upper())
        for r in g["rows"]:
            stale = f"  ({r['as_of']})" if r.get("as_of") else ""
            L.append(f"  {r['label']:<10} {r['level']:>11} {(r.get('chg') or '-'):>9}{stale}")
    ideas = b.get("ideas")
    if ideas and (ideas.get("open") or ideas.get("closed")):
        L.append("")
        L.append(f"MACROTILT CALLS — {ideas.get('line','')}")
        for r in ideas.get("open", []) + ideas.get("closed", []):
            vs = f" vs {r.get('bench') or 'benchmark'} {r['vs']}" if r.get("vs") else ""
            tail = r.get("result") or (f"{r['held']}d" if r.get("held") is not None else "")
            L.append(f"  {r['trade']}: {r.get('pnl') or '-'}{vs}  {tail}")
    L.append("")
    titles = ["Macro & Rates", "Equity Markets", "Credit & Liquidity"]
    for i, t in enumerate(titles):
        sec = b["sections"][i] if i < len(b.get("sections", [])) else {}
        L.append(f"{i+1}. {t}")   # fixed headers — see render_email_html
        _bl = (sec.get("bullets") or ([sec.get("prose")] if sec.get("prose") else []))
        if not _bl and not sec.get("positioning") and not sec.get("single_name"):
            _bl = ["nothing material."]
        for bl in _bl:
            L.append(f"- {bl}")
        if sec.get("positioning"): L.append(f"- Positioning: {sec['positioning']}")
        sn = sec.get("single_name")   # same guard as the HTML renderer above
        if isinstance(sn, dict) and str(sn.get("ticker") or "").strip():
            L.append(f"- Single name: {sn.get('ticker','')} {sn.get('note','')}")
        L.append("")
    L.append("4. Key News & Events")
    for it in b.get("news", []): L.append(f"- {it.get('head','')}: {it.get('body','')}")
    L.append("\n5. Implications")
    for it in b.get("implications", []): L.append(f"- {it}")
    L.append("\n6. What to Watch Today")
    for it in b.get("watch", []): L.append(f"- {it.get('head','')}: {it.get('body','')}")
    import re
    return re.sub("<[^>]+>", "", "\n".join(L))

def send_email(b, today):
    # EMAIL-OFF by default. Joe's single daily brief email is owned by the LEGACY routine
    # (gmail + EY, ~06:45 ET). This homepage writer must not send a second, duplicate email
    # -- its job is the homepage file only. Flip BRIEF_SEND_EMAIL=true ONLY if this writer is
    # ever made the sole emailer (and the legacy routine retired in the same change).
    if os.environ.get("BRIEF_SEND_EMAIL", "").lower() not in ("1", "true", "yes"):
        print("email disabled (BRIEF_SEND_EMAIL unset) -- homepage-only; legacy routine owns Joe's daily email")
        return False
    user = os.environ.get("SMTP_USER", ""); pw = os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("EMAIL_FROM", "") or user
    mode = os.environ.get("BRIEF_SEND_MODE", "test").lower()
    if mode == "live":
        to = [x.strip() for x in os.environ.get("EMAIL_TO", user).split(",") if x.strip()]
    else:
        to = [user]  # rollout-safe: Joe only
    if not (user and pw and to):
        print("WARN: email not configured; skipping send", file=sys.stderr); return False
    # Morning window + trading-day gate, checked again here so no future caller can
    # route around it, and a send-once claim so concurrent runs can't double-mail.
    now = datetime.datetime.now(ET)
    if not _ignore_calendar():
        if not is_trading_day(now.date()):
            print(f"not a trading day ({now:%Y-%m-%d %a}) — no email"); return False
        if not (BUILD_FROM_HOUR_ET <= now.hour < EMAIL_UNTIL_HOUR_ET):
            print(f"outside the morning email window ({now:%H:%M} ET) — no email"); return False
    if not claim_email_send(today):
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Market Brief — {today}" + (" [test]" if mode != "live" else "")
        msg["From"] = sender; msg["To"] = ", ".join(to)
        msg.attach(MIMEText(render_email_text(b), "plain"))
        msg.attach(MIMEText(render_email_html(b), "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(user, pw); s.sendmail(sender, to, msg.as_string())
        print(f"email sent ({mode}) to {to}")
        return True
    except Exception as e:
        # 2026-08-13: the claim is taken BEFORE the send and the send is deliberately
        # best-effort (it must never fail the commit) -- so a failed send left a claim
        # row that permanently suppressed every retry for the rest of the morning. Joe
        # got NO brief email at all, the step was green, and nothing recorded why.
        # A claim must never outlive the action it was claiming: record the reason,
        # then RELEASE it so the morning's remaining runs retry. LESSONS 4.29.
        detail = f"{type(e).__name__}: {e}"
        print(f"WARN: email send failed (non-fatal): {detail}", file=sys.stderr)
        _record_email_failure(today, detail)
        _release_email_claim(today)
        return False


def attach_data_blocks(brief, today):
    """Bolt the DETERMINISTIC halves of the brief on: the market snapshot and the
    live marks on MacroTilt's own calls. Neither is written by the model, and
    both are refreshed on every prepare -- so a stale generator can never ship a
    stale number, and the writer can never restate a table row as a paragraph.
    (2026-08-19)"""
    recap_iso = prev_trading_day(datetime.date.fromisoformat(today)).isoformat()
    brief["metrics"] = build_metrics(_fetch_indicator_history(), recap_iso)
    brief["ideas"] = build_ideas(_load_scores())
    return brief

def main():
    now = datetime.datetime.now(ET)
    today = now.strftime("%Y-%m-%d")
    out = os.path.join(os.path.dirname(__file__), "..", "public", "daily_brief.json")
    # A brief is a pre-market artifact. Off a trading day there is no session to
    # brief, and before 05:00 ET there is no overnight to summarise -- the site
    # correctly keeps the last trading day's brief in both cases.
    if not _ignore_calendar():
        if not is_trading_day(now.date()):
            return _status("skipped_not_trading_day")
        if now.hour < BUILD_FROM_HOUR_ET:
            return _status("skipped_too_early")
    # Idempotency: if the committed brief is already today's, do nothing -- no model
    # call, no commit, no email. Any number of runs/day (the dual EDT/EST writer cron,
    # the dense self-heal, a manual dispatch) thus collapse to ONE generation. Set
    # BRIEF_FORCE_REBUILD=1 to override (the self-heal does -- it has already confirmed
    # the LIVE site is stale).
    if os.environ.get("BRIEF_FORCE_REBUILD", "").lower() not in ("1", "true", "yes"):
        try:
            committed = json.load(open(out, encoding="utf-8"))
            if committed.get("date") == today:
                print(f"brief already current ({today}); no model call")
                # Subscription-era delivery (2026-08-06, Joe: no metered-API
                # spend): the brief may have been generated by the morning
                # scheduled Cowork session (runs on Joe's plan) and committed
                # via agent-write BEFORE this workflow fires. The emailer is
                # still THIS pipeline — same template, same trading-day +
                # morning-window gates inside send_email, same atomic
                # send-once claim — so the many daily trigger fires still
                # produce at most one email, now with zero API usage.
                send_email(committed, today)
                return _status("already_current")
        except Exception:
            pass
    # Generation belongs to the morning scheduled session, not to this workflow.
    # Placed AFTER the idempotency block but BEFORE any feed/model work so it also
    # covers the self-heal's BRIEF_FORCE_REBUILD=1 path (which skips that block).
    if not _metered_generation_enabled():
        try:
            committed = json.load(open(out, encoding="utf-8"))
        except Exception:
            committed = {}
        if committed.get("date") == today:
            # Force-rebuild path: the file is already today's, so there is nothing
            # to regenerate without the metered API. Email (send-once claim applies)
            # and finish green rather than burning a red on a healthy brief.
            print(f"brief already current ({today}); metered generator disabled — emailing only")
            send_email(committed, today)
            return _status("already_current")
        if now.hour < BRIEF_EXPECTED_BY_HOUR_ET:
            print(f"today's brief is not committed yet ({now:%H:%M} ET); the morning "
                  f"session owns generation until {BRIEF_EXPECTED_BY_HOUR_ET:02d}:00 ET — nothing to do")
            return _status("skipped_awaiting_agent_brief")
        print(f"FATAL: no brief for {today} committed by {BRIEF_EXPECTED_BY_HOUR_ET:02d}:00 ET and the "
              f"metered generator is disabled — the morning session did not deliver", file=sys.stderr)
        sys.exit(1)
    feeds = fetch_feeds()
    if not any(feeds.values()):
        print("FATAL: both feeds unreachable; refusing to publish", file=sys.stderr); sys.exit(1)
    movers = fetch_movers()
    brief = None
    for attempt in (1, 2):  # one retry guards against a transient malformed model response
        try:
            brief = validate(call_model(feeds, movers, today), today)
            break
        except Exception as e:
            # Diagnosability (2026-08-06): urllib's HTTPError repr is just
            # "HTTP Error 400: Bad Request" — the API's actual error body
            # (credits exhausted / bad model id / bad tool spec) was being
            # swallowed, which hid a 3-day outage. Always print the body.
            detail = ""
            if isinstance(e, urllib.error.HTTPError):
                try:
                    detail = " — body: " + e.read().decode(errors="replace")[:500]
                except Exception:
                    pass
            print(f"WARN: brief build attempt {attempt} failed: {e}{detail}", file=sys.stderr)
    if brief is None:
        print("FATAL: brief failed to build/validate after retry; refusing to publish", file=sys.stderr)
        sys.exit(1)
    brief = scrub_banned(brief)  # enforce banned-copy guard before write + email
    # Movers are DATA, not prose: always take the scan-table list (real
    # change_pct), never the model's echo of the prompt (which carries no
    # percentages -- that null-pct echo is why the homepage movers tile sat
    # permanently empty; the page correctly refuses pct-less movers).
    brief["movers"] = movers
    brief = attach_data_blocks(brief, today)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(brief, f, ensure_ascii=False, indent=2)
    print(f"wrote public/daily_brief.json — {today}: {brief['headline']}")
    _status("generated")
    send_email(brief, today)
    # Return the outcome so callers can tell "I regenerated the brief" from
    # "I decided there was nothing to do". brief_selfheal.py only claims it
    # healed the homepage when this says "generated" (LESSONS 4.28).
    return "generated"

def prepare_file(path):
    """Normalize + validate an externally-generated brief, in place.

    Subscription-era path (2026-08-06, Joe: no metered-API spend): the model
    now runs inside a morning scheduled Cowork session on Joe's existing plan
    (see scripts/brief_agent_playbook.md), not on the metered Anthropic API.
    LESSONS 4.21 ("one generator, in version control") still holds because
    THIS file remains the reviewable contract: the same validate(), the same
    banned-copy scrub, the same forced date/recap_session, and the same
    movers-are-data rule run here before anything is committed. A brief that
    fails here must not be submitted.
    """
    now = datetime.datetime.now(ET)
    today = now.strftime("%Y-%m-%d")
    if not _ignore_calendar() and not is_trading_day(now.date()):
        print(f"not a trading day ({now:%Y-%m-%d %a}) — refusing to prepare a brief", file=sys.stderr)
        sys.exit(2)
    brief = json.load(open(path, encoding="utf-8"))
    brief = validate(brief, today)
    brief = scrub_banned(brief)
    brief["movers"] = fetch_movers()
    brief = attach_data_blocks(brief, today)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(brief, f, ensure_ascii=False, indent=2)
    _rows = sum(len(g["rows"]) for g in brief.get("metrics") or [])
    _open = len((brief.get("ideas") or {}).get("open") or [])
    print(f"prepared OK — {today} · recap {brief['recap_session']} · "
          f"~{count_words(brief)} words · {_rows} snapshot rows · "
          f"{_open} open calls · {len(brief['sections'])} sections · "
          f"{len(brief['news'])} news · {len(brief['movers'])} movers\n"
          f"headline: {brief['headline']}")

if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--prepare-file":
        prepare_file(sys.argv[2])
    else:
        main()
