#!/usr/bin/env python3
"""
After fetch_indicators updates App.jsx, optionally:
  1) Build the same prompt as the AI Analysis tab
  2) Call Anthropic
  3) Email you with the text + dashboard link

Configure in ~/.config/market-dashboard.env (sourced by run-daily-fetch.sh):

  DASHBOARD_URL=https://YOUR-PROJECT.vercel.app
  ANTHROPIC_API_KEY=sk-ant-api03-...
  EMAIL_TO=you@gmail.com
  EMAIL_FROM=you@gmail.com
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=you@gmail.com
  SMTP_PASSWORD=your_gmail_app_password

Optional:
  CLAUDE_MODEL=claude-sonnet-4-20250514
  SKIP_DAILY_EMAIL=1   — skip this script entirely
  GITHUB_TOKEN         — for scheduled git push over HTTPS when ssh-agent is unavailable (see fetch_indicators.py)
"""
from __future__ import annotations

import os
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_JSX = os.path.join(BASE_DIR, "src", "App.jsx")

from dashboard_env import load_market_dashboard_env

from macro_compute import (
    IND_META,
    WEIGHTS,
    comp_score,
    fmt_v,
    get_conv_label,
    sd_label,
    sd_score,
    sd_to_100,
    trend_signal_velocity,
)


def parse_ind_lines(app_text: str) -> tuple[dict[str, tuple[float, ...]], bool]:
    """Return id -> (cur, 1m, 3m, 6m, 12m) from IND — data is on the first line of each entry."""
    out: dict[str, tuple[float, ...]] = {}
    for line in app_text.split("\n"):
        line = line.strip()
        if not re.match(r"^\w+:\[", line):
            continue
        if not re.search(r",(?:true|false),\s*$", line):
            continue
        rm = re.match(
            r'^(\w+):\["[^"]*","[^"]*","[^"]*",\d+,"[^"]*",\d+,((?:-?[\d.]+,){4}-?[\d.]+),(?:true|false),',
            line,
        )
        if not rm:
            continue
        ind_id = rm.group(1)
        nums = [float(x) for x in rm.group(2).split(",")]
        if len(nums) != 5:
            continue
        out[ind_id] = tuple(nums)
    return out, all(k in out for k in WEIGHTS)


def build_prompt(now: dict[str, float], m1: dict[str, float], m3: dict[str, float], as_of: dict[str, str]) -> str:
    snap = {k: now[k] for k in now}
    comp = comp_score(snap)
    comp100 = sd_to_100(comp)
    comp1m = comp_score({k: m1.get(k, now[k]) for k in snap})
    comp3m = comp_score({k: m3.get(k, now[k]) for k in snap})
    comp1m100 = sd_to_100(comp1m)
    comp3m100 = sd_to_100(comp3m)
    vel = comp - comp1m
    arr, tlab, _ = trend_signal_velocity(vel)
    conv = get_conv_label(comp)

    readings = "\n".join(
        f'{IND_META.get(k, (k, "", 2))[0]}: {fmt_v(k, now[k])} ({sd_label(sd_score(k, now[k]))}, as of {as_of.get(k, "?")})'
        for k in sorted(now.keys())
    )

    today = datetime.now().strftime("%A, %B %d, %Y")
    return f"""You are a senior macro strategist writing a concise market stress analysis for a personal investment dashboard. Today is {today}.

CURRENT COMPOSITE STRESS: {comp100}/100 — {conv} {arr} {tlab}
1-Month Prior: {comp1m100} | 3-Month Prior: {comp3m100}

LIVE INDICATOR READINGS:
{readings}

Write a structured macro analysis with these exact sections. Use ALL CAPS for section headers. Be specific, data-driven, and reference actual indicator values. Be concise — each section 2-4 sentences max.

REGIME SUMMARY
WHAT THE DATA IS SAYING
KEY RISKS TO WATCH
PORTFOLIO IMPLICATIONS

Do not use bullet points. Write in flowing prose. Do not add any preamble or closing remarks."""


def extract_as_of(app_text: str) -> dict[str, str]:
    m = re.search(r"const AS_OF=\{([\s\S]*?)\n\};", app_text)
    if not m:
        return {}
    out = {}
    for part in m.group(1).split(","):
        part = part.strip()
        if not part or ":" not in part:
            continue
        k, v = part.split(":", 1)
        k = k.strip()
        v = v.strip().strip('"')
        if k:
            out[k] = v
    return out


def send_email(subject: str, body_plain: str) -> None:
    to_addr = os.environ.get("EMAIL_TO", "").strip()
    from_addr = os.environ.get("EMAIL_FROM", to_addr).strip()
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", from_addr).strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    if not to_addr or not password:
        raise RuntimeError("EMAIL_TO and SMTP_PASSWORD are required to send mail")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(body_plain, "plain", "utf-8"))
    with smtplib.SMTP(host, port, timeout=60) as s:
        s.starttls()
        s.login(user, password)
        s.sendmail(from_addr, [to_addr], msg.as_string())


def run_claude(prompt: str) -> str:
    try:
        import anthropic
    except ImportError:
        import sys

        raise RuntimeError(
            f"anthropic is not installed for {sys.executable!r} — run: "
            f"{sys.executable} -m pip install anthropic"
        ) from None

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    block = msg.content[0]
    if block.type != "text":
        return str(block)
    return block.text


def run_if_configured(results: dict) -> None:
    load_market_dashboard_env()

    if os.environ.get("SKIP_DAILY_EMAIL") == "1":
        print("\n── Daily email ─────────────────────────────────────────")
        print("SKIP_DAILY_EMAIL=1 — skipping AI email")
        return

    if not os.path.isfile(APP_JSX):
        print("\n⚠ daily_analysis_email: src/App.jsx not found")
        return

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("\n── Daily email ─────────────────────────────────────────")
        print("ANTHROPIC_API_KEY not set — skipping AI email (set in ~/.config/market-dashboard.env)")
        return

    if not os.environ.get("EMAIL_TO"):
        print("\n── Daily email ─────────────────────────────────────────")
        print("EMAIL_TO not set — skipping send (add to ~/.config/market-dashboard.env)")
        return

    with open(APP_JSX, "r", encoding="utf-8") as f:
        app_text = f.read()

    series, ok = parse_ind_lines(app_text)
    if not ok or not series:
        print("\n⚠ daily_analysis_email: could not parse IND from App.jsx")
        return

    as_of = extract_as_of(app_text)
    now = {k: series[k][0] for k in series}
    m1 = {k: series[k][1] for k in series}
    m3 = {k: series[k][2] for k in series}

    # Prefer freshly fetched results for "now" when present
    for k, (v, d) in results.items():
        if k in now:
            now[k] = float(v)

    prompt = build_prompt(now, m1, m3, as_of)
    print("\n── Daily email ─────────────────────────────────────────")
    print("Calling Claude for AI narrative…")
    text = run_claude(prompt)

    url = os.environ.get("DASHBOARD_URL", "http://localhost:5173").rstrip("/")
    analysis_url = f"{url}/#analysis"
    body = (
        f"Market Stress Dashboard — AI Analysis ({datetime.now():%Y-%m-%d})\n\n"
        f"Open AI Analysis tab: {analysis_url}\n"
        f"(Full dashboard: {url}/)\n\n"
        f"---\n\n{text}\n"
    )

    subj = f"Market stress — {datetime.now():%b %d, %Y} (AI analysis)"
    send_email(subj, body)
    print(f"✓ Emailed {os.environ.get('EMAIL_TO')} — subject: {subj}")


if __name__ == "__main__":
    print("Run via fetch_indicators.py after a successful fetch, or set up env and import run_if_configured(results).")
