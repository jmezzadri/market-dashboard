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

PROMPT = """You are MacroTilt's daily market-brief analyst. Today is {today} (ET). Write a concise, decision-oriented market brief for the last 24h, weighted to the NY overnight and pre-market (~6am ET). It is PRE-MARKET: for every equity/index/yield/FX/commodity figure state whether it is a PRIOR CASH CLOSE or an OVERNIGHT/PRE-MARKET level — never a bare "up X% today" before the US open.

HARD ACCURACY CONTRACT (read first; overrides every other instruction here. A wrong number or a fabricated event destroys the brief. An omitted figure is correct; a wrong one is a failure. Added 2026-07-30 after the brief claimed an AAPL/AMZN earnings beat and after-hours pop on a day both companies had NOT yet reported, and described the 30-year yield as having "eased back from 5.21%" while it was in fact printing a NEW high of 5.237% — see LESSONS.)
 1. SOURCED NUMBERS ONLY. Every figure must come from either (a) the DATA block below, or (b) a page you actually fetched THIS RUN whose publication timestamp you can see. Never a number from memory, from inference, or from a search snippet with no visible date. If you cannot source it, omit it.
 2. NO DIRECTION WITHOUT TWO SOURCED POINTS. "Eased back", "stabilized", "rebounded", "pulled back from", "off its highs", "little changed", "steady", "holding" are CLAIMS about a path, not levels. Write one ONLY when you hold two timestamped sourced levels and the later one actually supports it. Otherwise state the level, label its timestamp, and stop.
 3. NEVER call a level a high / record / ATH / "highest since X" unless you fetched a source saying so AND you hold no later sourced level that exceeds it. If the level you cite is a prior-session print, say so ("Wednesday's close") — never phrase it so a reader thinks it is where the market is now. If a later sourced level is HIGHER than the one you were about to call a peak, the story is that it made a NEW high, not that it eased.
 4. EARNINGS ARE EVENTS WITH DATES — CHECK THE DATE BEFORE YOU WRITE. Before writing anything about any company's results, confirm the scheduled report date from a source you fetch this run. If the report is TODAY or LATER, the ONLY permitted phrasing is "reports after today's close" / "reports before tomorrow's open". NEVER state or imply that a company topped, missed, guided, or moved on results that have not been published. If a company genuinely reported in the last 18h, you must have fetched the release itself or a story published AFTER that report.
 5. SINGLE-STOCK EXTENDED-HOURS MOVES: PERCENT, FROM A DATED STORY, OR NOT AT ALL. No feed here carries an extended-hours quote, so you may cite a pre-market or after-hours move for one stock ONLY when a story you fetched this run, published within the last 6 hours, states it — then give the percent and label the timing ("~+8% pre-market"). Never a dollar price, never a level you inferred from a close plus a move, and never for a company whose results are not yet out.
 6. SELF-CHECK BEFORE RETURNING. Re-read every number and every direction word and name to yourself which fetch produced it and what time it is stamped; delete anything that fails. Then check the output does not contradict itself (a company cannot both have beaten after Wednesday's close and report today).
READER-FACING LABELS ONLY. The contract above governs how you think; it must never show in the copy. Label a figure in the words a reader uses — "Wednesday's close", "overnight (~6am ET)", "pre-market" — and NEVER print an internal field name, key, or the word DATA (no "(prior cash close, Jul 29 DATA)", no "(is_new_this_week: true)", no "pctile_3yr"). NEVER name a publication, wire, network, exchange data product, index provider, vendor, feed or URL — write "reported as the highest since 2007", never "CNBC reported", and "futures pricing implies roughly 42% odds", never "42% on CME FedWatch". NEVER write "as of this writing", "no results are available yet", or any phrase describing the state of your own research — say what IS true ("Apple and Amazon report after today's close") and stop. NEVER narrate your own rules to the reader ("no pre-market claims are made here", "per confirmed earnings calendars") — just state the fact ("Apple and Amazon report after today's close"). NEVER name a data source, feed, URL, or vendor anywhere in the output.

PLAIN ENGLISH for a smart non-trader. Translate jargon every time: short interest/days-to-cover -> "shorts are heavy ... squeeze risk"; insider rules -> "company insiders have been buying"; COT low percentile -> "speculators have almost no bullish bets left - a contrarian floor"; COT high percentile -> "speculators are piled into longs - a contrarian warning".

BANNED WORDS - never output these in ANY field: "washed out", "crowded". For a low COT percentile write "extended short" (or "speculators have almost no bullish bets left - a contrarian floor"); for a high percentile write "extended long" (or "speculators are heavily positioned - a contrarian warning").

DATA (source of truth for current values + positioning). EVERY value in here is a PRIOR CASH CLOSE — read each as_of and label it as such. The feed carries NO 30-year yield and NO equity-futures level, so any long-bond or futures figure is rule-1 material: source it this run with a timestamp or leave it out.
{data}

NOVELTY: fetch https://macrotilt.com/daily_brief.json — at your run time it still holds the PRIOR session's brief. Treat its headline, news[], watch[], implications[] and every sections[].single_name.ticker as ALREADY SAID; advance those themes (what moved overnight, what got confirmed or refuted) rather than restating them. Open "Macro & Rates" with the single most important thing that CHANGED since that brief. Novelty NEVER justifies an unsourced number or an unconfirmed event — if the only new angle you have is unsourced, run the section short.

Use web search for the last 12h of news, preferring stories with a visible timestamp (a story you cannot date is not usable for a level or an event claim). You MAY add an overnight / pre-market level for a fast mover (gold, oil, S&P, Nasdaq, Dow, 2Y/10Y/30Y, DXY, USD/JPY, EUR/USD) ONLY from a page you fetched this run showing that level with a publication timestamp inside the last 6 hours, and you must label it with that timing ("~6am ET"). Otherwise give the labelled prior close and say nothing about where it is now.

OUTPUT: return ONLY a single JSON object (no prose, no markdown fence) with EXACTLY these keys:
{{
 "date": "{today}",
 "recap_session": "<prior session label e.g. 'Wed Jun 24'>",
 "eyebrow": "Morning Brief",
 "headline": "<one factual sentence, no hype>",
 "stance": "<2-3 sentences; may use <b>..</b>; you MAY note the engine reads its state if supported>",
 "news": [{{"head":"<short>","body":"<sentence>"}}, ...],            // from 'Key News & Events'
 "implications": ["<sentence>", ...],                                  // include any Positioning line as "<b>Positioning:</b> ..."
 "watch": [{{"head":"<short>","body":"<sentence>"}}, ...],
 "sections": [
   {{"title":"Macro & Rates","bullets":["<sentence>", ...],"positioning":"<text or null>","single_name":null}},
   {{"title":"Equity Markets","bullets":["..."],"positioning":"<text or null>","single_name":{{"ticker":"XYZ","note":"(what it is) - plain reason"}} or null}},
   {{"title":"Credit & Liquidity","bullets":["..."],"positioning":null,"single_name":null}}
 ],
 "movers": {movers}
}}
Rules: bullets are short factual sentences. A "single_name" only when a setups[] name fits that section's theme (energy name for oil, lender for credit/rates). You may wrap tickers as <a class="tklink" href="/ticker/SYM" data-route="/ticker/SYM">Name</a> and indicators as href="/indicators?ind=KEY". Keep it tight. Return ONLY the JSON object — compact, strictly valid JSON: escape any double quotes inside string values, never put a raw newline inside a string, no trailing commas, no markdown fences, no text before or after."""

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
    return brief

# ---- email rendering (replicates the existing branded template) ----
BLUE, INK, BODY, MUTE = "#1D4ED8", "#15181D", "#2A2F37", "#9AA1AB"
SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
SERIF = "Georgia,'Times New Roman',serif"

def _bullet(html):
    return (f'<div style="margin:2px 0;padding-left:15px;text-indent:-12px;font-family:{SANS};'
            f'font-size:13px;line-height:1.5;color:{BODY}"><span style="color:{BLUE}">&#8227;</span> {html}</div>')

def _spacer():
    return '<div style="font-size:8px;line-height:8px">&#160;</div>'

def render_email_html(b):
    out = []
    out.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAF7"><tr><td align="center" style="padding:24px 12px">')
    out.append(f'<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid rgba(20,23,28,0.12);border-radius:12px"><tr><td style="padding:24px 28px">')
    out.append(f'<div style="margin-bottom:12px"><span style="font-family:{SERIF};font-size:20px;font-weight:700;color:{INK}">Macro</span><span style="font-family:{SERIF};font-size:20px;font-weight:700;font-style:italic;color:{BLUE}">Tilt</span><span style="font-family:{SANS};font-size:11px;font-weight:600;letter-spacing:.16em;color:{MUTE}">&#160;&#160;MARKET BRIEF</span></div>')
    # numbered sections 1-3 (from sections[]), 4 News, 5 Implications, 6 Watch
    secs = b.get("sections", [])
    titles = ["Macro & Rates", "Equity Markets", "Credit & Liquidity"]
    n = 0
    for i, title in enumerate(titles):
        sec = secs[i] if i < len(secs) else {}
        n += 1
        style = (f'font-family:{SERIF};font-size:26px;color:{INK};margin-bottom:10px' if n == 1
                 else f'margin:16px 0 5px 0;font-family:{SANS};font-size:13px;font-weight:700;color:{BLUE}')
        # Fixed headers. The model occasionally renames slot 3 ("Movers"), which silently
        # drops Credit & Liquidity from the email and duplicates the movers data field.
        # Sections 1-3 are a contract with the reader, not the model's choice. (2026-07-30)
        out.append(f'<div style="{style}">{n}. {title}</div>')
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
        if sec.get("single_name"):
            sn = sec["single_name"]
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
    out.append(f'<div style="margin-top:16px;border-top:1px solid rgba(20,23,28,0.12);padding-top:12px;font-family:{SANS};font-size:11px;color:{MUTE}">Generated by MacroTilt &#183; macrotilt.com</div>')
    out.append('</td></tr></table></td></tr></table>')
    return "".join(out)

def render_email_text(b):
    L = []
    titles = ["Macro & Rates", "Equity Markets", "Credit & Liquidity"]
    for i, t in enumerate(titles):
        sec = b["sections"][i] if i < len(b["sections"]) else {}
        L.append(f"{i+1}. {t}")   # fixed headers — see render_email_html
        _bl = (sec.get("bullets") or ([sec.get("prose")] if sec.get("prose") else []))
        if not _bl and not sec.get("positioning") and not sec.get("single_name"):
            _bl = ["nothing material."]
        for bl in _bl:
            L.append(f"- {bl}")
        if sec.get("positioning"): L.append(f"- Positioning: {sec['positioning']}")
        if sec.get("single_name"):
            sn = sec["single_name"]; L.append(f"- Single name: {sn.get('ticker','')} {sn.get('note','')}")
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
    with open(path, "w", encoding="utf-8") as f:
        json.dump(brief, f, ensure_ascii=False, indent=2)
    print(f"prepared OK — {today} · recap {brief['recap_session']} · "
          f"{len(brief['sections'])} sections · {len(brief['news'])} news · "
          f"{len(brief['movers'])} movers · headline: {brief['headline'][:90]}")

if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--prepare-file":
        prepare_file(sys.argv[2])
    else:
        main()
