"""
cb_decisions — what each central bank actually decided, read from the bank's
own statement, for the decision dates the release calendar carries.

Why (2026-10-29 audit): after the ECB announced at 8:15 AM, the homepage
still listed "ECB decision (Governing Council) · 8:15 AM" at 9 PM as if it
were still to come, with no outcome anywhere on the site. A calendar row
whose event has happened shows what happened.

One provider per source, and the provider is the central bank itself
(LESSONS 4.1) — the same banks whose published schedules already supply the
calendar's decision dates:

  Federal Reserve   federalreserve.gov monetary-policy press feed → the FOMC
                    statement: "decided to maintain|raise|lower the target
                    range for the federal funds rate at|to A to B percent"
  ECB               ecb.europa.eu press feed → "Monetary policy decisions":
                    the deposit facility rate, "unchanged at X%" or
                    "increased|decreased to X%"
  Bank of England   bankofengland.co.uk news feed → the Monetary Policy
                    Summary's own title: "Bank Rate maintained at X%"
  Bank of Japan     boj.or.jp statement for the meeting day (PDF): "encourage
                    the uncollateralized overnight call rate to remain at /
                    be at around X percent"

Every parser is best-effort and never fails the run: a statement that cannot
be read leaves that decision without an outcome (the row then says only
"Released"), and the reason goes in `problems`. Nothing is inferred — an
outcome is printed only when the bank's own sentence says it.
"""
from __future__ import annotations

import datetime as dt
import html
import io
import re
import urllib.request
from email.utils import parsedate_to_datetime

UA = "Mozilla/5.0 (MacroTilt econ calendar; +https://macrotilt.com)"
FED_FEED = "https://www.federalreserve.gov/feeds/press_monetary.xml"
ECB_FEED = "https://www.ecb.europa.eu/rss/press.html"
BOE_FEED = "https://www.bankofengland.co.uk/rss/news"
BOJ_LIST = "https://www.boj.or.jp/en/mopo/mpmdeci/state_{year}/index.htm"
BOJ_BASE = "https://www.boj.or.jp"

NAMES = {
    "fed": "Fed decision (FOMC)",
    "ecb": "ECB decision (Governing Council)",
    "boe": "Bank of England decision (MPC)",
    "boj": "Bank of Japan decision (MPM)",
}


def _get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _text(raw: bytes) -> str:
    t = raw.decode("utf-8", errors="replace")
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def _items(feed_xml: str):
    """(title, link, date) for each RSS item; date in the publisher's zone."""
    out = []
    for it in re.findall(r"<item[^>]*>(.*?)</item>", feed_xml, re.S):
        def g(tag):
            m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", it, re.S)
            v = (m.group(1) if m else "").strip()
            v = re.sub(r"^<!\[CDATA\[(.*)\]\]>$", r"\1", v, flags=re.S).strip()
            return html.unescape(v)
        title, link, pub = g("title"), g("link"), g("pubDate") or g("dc:date")
        try:
            d = parsedate_to_datetime(pub).date() if "," in pub else dt.date.fromisoformat(pub[:10])
        except Exception:  # noqa: BLE001 — an unparseable date just never matches
            d = None
        out.append((title, link.replace("//press/", "/press/"), d))
    return out


def _pct(s: str) -> float:
    """'3-3/4' → 3.75, '4' → 4.0, '2.50' → 2.5"""
    s = s.strip()
    m = re.fullmatch(r"(\d+)-(\d+)/(\d+)", s)
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    m = re.fullmatch(r"(\d+)/(\d+)", s)
    if m:
        return int(m.group(1)) / int(m.group(2))
    return float(s)


def _fmt(v: float) -> str:
    return f"{v:.2f}%"


VERB = {"maintain": "Held", "keep": "Held", "remain": "Held", "maintained": "Held",
        "raise": "Raised", "increase": "Raised", "increased": "Raised", "raised": "Raised",
        "lower": "Cut", "reduce": "Cut", "decrease": "Cut", "decreased": "Cut", "reduced": "Cut",
        "lowered": "Cut", "cut": "Cut"}


def parse_fomc(text: str) -> dict | None:
    m = re.search(r"decided to (maintain|raise|lower) the target range for the federal funds rate"
                  r"(?: by [\w/\- ]+? percentage points?)? (?:at|to) ([\d\-/]+) to ([\d\-/]+) percent", text)
    if not m:
        return None
    verb = VERB[m.group(1)]
    lo, hi = _pct(m.group(2)), _pct(m.group(3))
    rng = f"{lo:.2f}–{hi:.2f}%"
    return {"action": verb, "rate": rng,
            "label": f"{verb} at {rng}" if verb == "Held" else f"{verb} to {rng}"}


def parse_ecb(text: str) -> dict | None:
    m = re.search(r"decided to (keep|raise|lower|increase|reduce|decrease) the three key ECB interest rates", text)
    d = re.search(r"deposit facility[^.]*?(?:remain unchanged at|be (?:increased|decreased|reduced|raised|lowered) to) "
                  r"(\d+(?:\.\d+)?)\s?%", text)
    if not (m and d):
        return None
    verb = VERB[m.group(1)]
    rate = _fmt(float(d.group(1)))
    return {"action": verb, "rate": rate,
            "label": f"{verb} deposit rate at {rate}" if verb == "Held" else f"{verb} deposit rate to {rate}"}


def parse_boe_title(title: str) -> dict | None:
    m = re.search(r"Bank Rate (maintained|reduced|increased|cut|raised|lowered) (?:at|to) (\d+(?:\.\d+)?)\s?%", title, re.I)
    if not m:
        return None
    verb = VERB[m.group(1).lower()]
    rate = _fmt(float(m.group(2)))
    return {"action": verb, "rate": rate,
            "label": f"{verb} at {rate}" if verb == "Held" else f"{verb} to {rate}"}


def parse_boj(text: str) -> dict | None:
    m = re.search(r"overnight call rate to (remain at|be at) around ([\d.]+)\s*percent", text)
    if not m:
        return None
    rate = _fmt(float(m.group(2)))
    # The BoJ titles a statement that moves policy "Change in the Guideline
    # for Money Market Operations"; only a statement without that title and
    # with "remain at" is a hold.
    if m.group(1) == "remain at" and "Change in the Guideline" not in text:
        return {"action": "Held", "rate": rate, "label": f"Held at {rate}"}
    return {"action": "Changed", "rate": rate, "label": f"Policy rate set at {rate}"}


def _pdf_text(raw: bytes) -> str:
    from pypdf import PdfReader  # installed by the workflow; imported lazily
    reader = PdfReader(io.BytesIO(raw))
    return re.sub(r"\s+", " ", " ".join((p.extract_text() or "") for p in reader.pages[:2]))


def fetch_fed(date: str):
    for title, link, d in _items(_get(FED_FEED).decode("utf-8", "replace")):
        if d and d.isoformat() == date and "FOMC statement" in title:
            out = parse_fomc(_text(_get(link)))
            return (dict(out, source="Federal Reserve, FOMC statement", url=link) if out
                    else None), (None if out else f"FOMC statement {date} found but not parsed")
    return None, f"no FOMC statement dated {date} in the Fed's feed yet"


def fetch_ecb(date: str):
    for title, link, d in _items(_get(ECB_FEED).decode("utf-8", "replace")):
        if d and d.isoformat() == date and title.strip().lower() == "monetary policy decisions":
            out = parse_ecb(_text(_get(link)))
            return (dict(out, source="ECB press release, Monetary policy decisions", url=link) if out
                    else None), (None if out else f"ECB decision {date} found but not parsed")
    return None, f"no ECB 'Monetary policy decisions' release dated {date} in the ECB's feed yet"


def fetch_boe(date: str):
    for title, link, d in _items(_get(BOE_FEED).decode("utf-8", "replace")):
        if d and d.isoformat() == date and "Monetary Policy Summary" in title:
            out = parse_boe_title(title)
            return (dict(out, source="Bank of England, Monetary Policy Summary", url=link) if out
                    else None), (None if out else f"BoE summary {date} found but not parsed")
    return None, f"no Monetary Policy Summary dated {date} in the Bank of England's feed yet"


def fetch_boj(date: str):
    d = dt.date.fromisoformat(date)
    page = _get(BOJ_LIST.format(year=d.year)).decode("utf-8", "replace")
    stamp = d.strftime("%y%m%d")
    links = re.findall(rf'href="([^"]*/k{stamp}a\.(?:pdf|htm))"', page)
    if not links:
        return None, f"no BoJ statement dated {date} on the BoJ's {d.year} page yet"
    url = BOJ_BASE + links[0] if links[0].startswith("/") else links[0]
    raw = _get(url)
    text = _pdf_text(raw) if url.endswith(".pdf") else _text(raw)
    out = parse_boj(text)
    return (dict(out, source="Bank of Japan, statement on monetary policy", url=url) if out
            else None), (None if out else f"BoJ statement {date} found but not parsed")


FETCHERS = {NAMES["fed"]: fetch_fed, NAMES["ecb"]: fetch_ecb, NAMES["boe"]: fetch_boe, NAMES["boj"]: fetch_boj}


def decisions(events: list, today: dt.date, lookback_days: int = 10):
    """Outcomes for every central-bank decision in the calendar dated within
    the last `lookback_days` up to today. Returns ({"<name>|<date>": {...}},
    problems)."""
    out, problems = {}, []
    lo = (today - dt.timedelta(days=lookback_days)).isoformat()
    for e in events:
        name, date = e.get("name"), e.get("date")
        fn = FETCHERS.get(name)
        if not fn or not date or date < lo or date > today.isoformat():
            continue
        try:
            res, why = fn(date)
        except Exception as exc:  # noqa: BLE001 — never fail the run on one bank
            res, why = None, f"{name} {date}: {type(exc).__name__}: {exc}"
        if res:
            out[f"{name}|{date}"] = dict(res, date=date)
        elif why:
            problems.append(why)
    return out, problems
