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

# --- Banned-copy guard (Joe, 2026-06-26): never publish "washed out" / "crowded".
# Low COT percentile -> "extended short"; high -> "extended long". Deterministic
# backstop to the prompt rule, so a model slip can never reach the site or email.
def _scrub_text(s):
    if not isinstance(s, str):
        return s
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

def fetch_movers():
    """Top 5 prior-session movers by abs(change_pct) from the latest scan."""
    url = os.environ.get("SUPABASE_URL", BASE).rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
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

ACCURACY: Use ONLY numbers from the DATA below or that you verify via web search. Never invent a figure; omit anything unverified. NEVER name a data source, feed, URL, or vendor anywhere in the output.

PLAIN ENGLISH for a smart non-trader. Translate jargon every time: short interest/days-to-cover -> "shorts are heavy ... squeeze risk"; insider rules -> "company insiders have been buying"; COT low percentile -> "speculators have almost no bullish bets left - a contrarian floor"; COT high percentile -> "speculators are piled into longs - a contrarian warning".

BANNED WORDS - never output these in ANY field: "washed out", "crowded". For a low COT percentile write "extended short" (or "speculators have almost no bullish bets left - a contrarian floor"); for a high percentile write "extended long" (or "speculators are heavily positioned - a contrarian warning").

DATA (source of truth for current values + positioning):
{data}

Use web search for the last 12h of news and for today's live fast-mover levels (gold, oil, S&P, Nasdaq, Dow, 10Y/2Y, DXY, USD/JPY, EUR/USD).

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
        out.append(f'<div style="{style}">{n}. {sec.get("title", title)}</div>')
        for bl in (sec.get("bullets") or ([sec["prose"]] if sec.get("prose") else [])):
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
        L.append(f"{i+1}. {sec.get('title', t)}")
        for bl in (sec.get("bullets") or ([sec.get("prose")] if sec.get("prose") else [])):
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
        print(f"WARN: email send failed (non-fatal): {e}", file=sys.stderr); return False

def main():
    today = datetime.datetime.now(ET).strftime("%Y-%m-%d")
    out = os.path.join(os.path.dirname(__file__), "..", "public", "daily_brief.json")
    # Idempotency: if the committed brief is already today's, do nothing -- no model
    # call, no commit, no email. Any number of runs/day (the dual EDT/EST writer cron,
    # the dense self-heal, a manual dispatch) thus collapse to ONE generation. Set
    # BRIEF_FORCE_REBUILD=1 to override (the self-heal does -- it has already confirmed
    # the LIVE site is stale).
    if os.environ.get("BRIEF_FORCE_REBUILD", "").lower() not in ("1", "true", "yes"):
        try:
            if json.load(open(out, encoding="utf-8")).get("date") == today:
                print(f"brief already current ({today}); nothing to do")
                return
        except Exception:
            pass
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
            print(f"WARN: brief build attempt {attempt} failed: {e}", file=sys.stderr)
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
    send_email(brief, today)

if __name__ == "__main__":
    main()
