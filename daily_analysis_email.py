#!/usr/bin/env python3
"""
After fetch_indicators updates App.jsx, optionally:
  1) Build the same prompt as the AI Analysis tab
  2) Call Anthropic for the narrative
  3) Compose a rich HTML email (with plain-text fallback) and send it

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
  SKIP_DAILY_EMAIL=1            — skip this script entirely
  EMAIL_PREVIEW_PATH=/tmp/x.html — write the HTML body to a file (useful for a local preview)
  GITHUB_TOKEN                  — for scheduled git push over HTTPS when ssh-agent is unavailable
"""
from __future__ import annotations

import html as _html
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


# ──────────────────────────────────────────────────────────────────────
# Parsing / data assembly
# ──────────────────────────────────────────────────────────────────────


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


# ──────────────────────────────────────────────────────────────────────
# Per-indicator stats & visual helpers
# ──────────────────────────────────────────────────────────────────────


def per_indicator_stats(
    now: dict[str, float],
    m1: dict[str, float],
) -> list[dict]:
    """Return one record per indicator sorted by current 0-100 stress descending."""
    rows: list[dict] = []
    for ind_id, val in now.items():
        s_now = sd_score(ind_id, val)
        s_prev = sd_score(ind_id, m1.get(ind_id, val))
        stress_now = sd_to_100(s_now) if s_now is not None else 0
        stress_prev = sd_to_100(s_prev) if s_prev is not None else stress_now
        name, _unit, _dec = IND_META.get(ind_id, (ind_id, "", 2))
        rows.append(
            {
                "id": ind_id,
                "name": name,
                "value": fmt_v(ind_id, val),
                "stress": stress_now,
                "delta": stress_now - stress_prev,
                "label": sd_label(s_now),
            }
        )
    rows.sort(key=lambda r: r["stress"], reverse=True)
    return rows


def regime_theme(comp_sd: float) -> dict[str, str]:
    """Return colors + label for a composite score (raw SD units).

    Thresholds match macro_compute.get_conv_label.
    """
    label = get_conv_label(comp_sd)
    themes = {
        "LOW": {
            "label": "LOW STRESS",
            "fg": "#065f46",
            "bg": "#d1fae5",
            "accent": "#10b981",
        },
        "NORMAL": {
            "label": "NORMAL",
            "fg": "#713f12",
            "bg": "#fef3c7",
            "accent": "#eab308",
        },
        "ELEVATED": {
            "label": "ELEVATED",
            "fg": "#7c2d12",
            "bg": "#ffedd5",
            "accent": "#f97316",
        },
        "EXTREME": {
            "label": "EXTREME",
            "fg": "#7f1d1d",
            "bg": "#fee2e2",
            "accent": "#ef4444",
        },
    }
    return themes[label]


def stress_bar_color(stress: int) -> str:
    if stress >= 75:
        return "#ef4444"  # red
    if stress >= 55:
        return "#f97316"  # orange
    if stress >= 35:
        return "#eab308"  # yellow
    return "#10b981"  # green


def trend_marker(delta: int | float) -> tuple[str, str, str]:
    """Return (arrow, absolute-delta-str, hex-color) for a 0-100 stress delta."""
    d = int(round(delta))
    if d >= 5:
        return ("▲", str(abs(d)), "#ef4444")
    if d <= -5:
        return ("▼", str(abs(d)), "#10b981")
    return ("→", str(abs(d)), "#6b7280")


# ──────────────────────────────────────────────────────────────────────
# Prompt
# ──────────────────────────────────────────────────────────────────────


def build_prompt(
    now: dict[str, float],
    m1: dict[str, float],
    m3: dict[str, float],
    as_of: dict[str, str],
) -> str:
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
        f'{IND_META.get(k, (k, "", 2))[0]}: {fmt_v(k, now[k])} '
        f'({sd_label(sd_score(k, now[k]))}, as of {as_of.get(k, "?")})'
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

Do not use bullet points. Write in flowing prose. Do not add any preamble or closing remarks. Do not include an indicator table — it will be rendered separately."""


# ──────────────────────────────────────────────────────────────────────
# Narrative parsing
# ──────────────────────────────────────────────────────────────────────


NARRATIVE_SECTIONS = [
    "REGIME SUMMARY",
    "WHAT THE DATA IS SAYING",
    "KEY RISKS TO WATCH",
    "PORTFOLIO IMPLICATIONS",
]


def parse_sections(narrative: str) -> list[tuple[str, str]]:
    """Split the AI narrative into (header, body) tuples by ALL CAPS section headers.

    Falls back to a single ("EXECUTIVE SUMMARY", text) pair if no known header is present.
    """
    text = narrative.strip()
    # Build a regex that matches any of the known headers at line start.
    pattern = re.compile(
        r"^(" + "|".join(re.escape(h) for h in NARRATIVE_SECTIONS) + r")\s*$",
        re.MULTILINE,
    )
    matches = list(pattern.finditer(text))
    if not matches:
        return [("EXECUTIVE SUMMARY", text)]

    sections: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        header = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        sections.append((header, body))
    return sections


# ──────────────────────────────────────────────────────────────────────
# HTML email
# ──────────────────────────────────────────────────────────────────────


def _html_narrative(sections: list[tuple[str, str]]) -> str:
    chunks: list[str] = []
    for header, body in sections:
        # Render each paragraph as its own <p>
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", body) if p.strip()]
        if not paragraphs:
            continue
        para_html = "".join(
            f'<p style="margin:0 0 12px;line-height:1.65;color:#1f2937;font-size:14.5px;">'
            f"{_html.escape(p)}</p>"
            for p in paragraphs
        )
        chunks.append(
            f'<div style="margin:0 0 20px;">'
            f'<div style="font-family:ui-sans-serif,system-ui,-apple-system,\'Segoe UI\',sans-serif;'
            f"font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6b7280;"
            f'text-transform:uppercase;margin:0 0 8px;">{_html.escape(header)}</div>'
            f"{para_html}"
            f"</div>"
        )
    return "".join(chunks)


def _html_indicator_row(r: dict) -> str:
    bar_color = stress_bar_color(r["stress"])
    bar_width = max(2, int(r["stress"]))  # keep a minimum sliver so empty bars still render
    arrow, delta, tcolor = trend_marker(r["delta"])
    return (
        "<tr>"
        f'<td style="padding:10px 10px;border-bottom:1px solid #f1f5f9;'
        f'font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:13.5px;color:#111827;">'
        f'{_html.escape(r["name"])}'
        f"</td>"
        f'<td style="padding:10px 10px;border-bottom:1px solid #f1f5f9;'
        f'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#111827;'
        f'text-align:right;white-space:nowrap;">{_html.escape(r["value"])}</td>'
        f'<td style="padding:10px 10px;border-bottom:1px solid #f1f5f9;width:180px;">'
        # Bar uses a two-cell table for Outlook compatibility
        f'<table role="presentation" cellspacing="0" cellpadding="0" border="0" '
        f'style="width:100%;border-collapse:collapse;background:#f1f5f9;border-radius:4px;">'
        f"<tr>"
        f'<td style="width:{bar_width}%;height:8px;background:{bar_color};border-radius:4px 0 0 4px;line-height:8px;font-size:0;">&nbsp;</td>'
        f'<td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>'
        f"</tr></table>"
        f"</td>"
        f'<td style="padding:10px 10px;border-bottom:1px solid #f1f5f9;'
        f'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;font-weight:700;'
        f'color:{bar_color};text-align:right;white-space:nowrap;">{r["stress"]}</td>'
        f'<td style="padding:10px 10px;border-bottom:1px solid #f1f5f9;'
        f'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:{tcolor};'
        f'text-align:center;white-space:nowrap;">{arrow}&nbsp;{delta}</td>'
        "</tr>"
    )


def build_html_email(
    *,
    narrative: str,
    comp100: int,
    comp_sd: float,
    comp1m100: int,
    comp3m100: int,
    rows: list[dict],
    dashboard_url: str,
    analysis_url: str,
    as_of_date: str,
) -> str:
    theme = regime_theme(comp_sd)
    vel = comp100 - comp1m100
    if vel > 2:
        vel_text = f"+{vel} vs 1-month prior"
        vel_color = "#ef4444"
    elif vel < -2:
        vel_text = f"{vel} vs 1-month prior"
        vel_color = "#10b981"
    else:
        vel_text = f"{'±0' if vel == 0 else ('+' + str(vel) if vel > 0 else str(vel))} vs 1-month prior"
        vel_color = "#6b7280"

    sections = parse_sections(narrative)
    narrative_html = _html_narrative(sections)

    indicator_rows = "".join(_html_indicator_row(r) for r in rows)

    today_long = datetime.now().strftime("%A, %B %d, %Y")

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Market Stress — {_html.escape(today_long)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<div style="display:none;max-height:0;overflow:hidden;">Composite stress {comp100}/100 — {_html.escape(theme['label'])}. {_html.escape(vel_text)}.</div>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">

<!-- Regime banner -->
<tr>
<td style="background:{theme['accent']};padding:20px 28px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>
<td style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;opacity:0.9;">Market Stress Dashboard</td>
<td align="right" style="color:#ffffff;font-size:12px;opacity:0.9;">{_html.escape(today_long)}</td>
</tr>
<tr>
<td colspan="2" style="padding-top:6px;">
<div style="color:#ffffff;font-size:26px;font-weight:800;letter-spacing:0.02em;">{_html.escape(theme['label'])}</div>
<div style="color:#ffffff;opacity:0.92;font-size:13px;margin-top:4px;">Composite stress {comp100}/100 · <span style="font-weight:600;">{vel_text}</span></div>
</td>
</tr>
</table>
</td>
</tr>

<!-- Score strip -->
<tr>
<td style="padding:18px 28px 4px;background:#ffffff;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>
<td style="text-align:center;padding:10px;border-right:1px solid #e5e7eb;">
<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Today</div>
<div style="font-size:28px;color:{theme['accent']};font-weight:800;font-family:ui-monospace,Menlo,Consolas,monospace;">{comp100}</div>
</td>
<td style="text-align:center;padding:10px;border-right:1px solid #e5e7eb;">
<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">1-Month Prior</div>
<div style="font-size:28px;color:#0f172a;font-weight:800;font-family:ui-monospace,Menlo,Consolas,monospace;">{comp1m100}</div>
</td>
<td style="text-align:center;padding:10px;">
<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">3-Month Prior</div>
<div style="font-size:28px;color:#0f172a;font-weight:800;font-family:ui-monospace,Menlo,Consolas,monospace;">{comp3m100}</div>
</td>
</tr>
</table>
</td>
</tr>

<!-- CTA -->
<tr>
<td style="padding:16px 28px 4px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
<tr>
<td style="background:#0f172a;border-radius:8px;">
<a href="{_html.escape(dashboard_url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:0.02em;">Open full dashboard →</a>
</td>
</tr>
</table>
</td>
</tr>

<!-- Narrative -->
<tr>
<td style="padding:24px 28px 8px;">
{narrative_html}
</td>
</tr>

<!-- Indicator table -->
<tr>
<td style="padding:12px 28px 24px;">
<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6b7280;text-transform:uppercase;margin:0 0 10px;">All 25 Indicators · sorted by stress</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
<thead>
<tr style="background:#f8fafc;">
<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Indicator</th>
<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Value</th>
<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Stress</th>
<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Score</th>
<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Δ 1M</th>
</tr>
</thead>
<tbody>
{indicator_rows}
</tbody>
</table>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:18px 28px 24px;background:#f8fafc;border-top:1px solid #e5e7eb;">
<div style="font-size:12px;color:#6b7280;line-height:1.6;">
Data fetched {_html.escape(as_of_date)}. Composite score is a weighted average across all 25 indicators (0 = no stress, 100 = crisis). Thresholds: LOW &lt; 31 · NORMAL 31–46 · ELEVATED 47–64 · EXTREME 65+.
</div>
<div style="font-size:12px;color:#6b7280;margin-top:10px;">
<a href="{_html.escape(dashboard_url)}" style="color:#2563eb;text-decoration:none;font-weight:600;">Open dashboard</a>
</div>
</td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>
"""


# ──────────────────────────────────────────────────────────────────────
# Plain-text fallback (improved)
# ──────────────────────────────────────────────────────────────────────


def build_plain_text_email(
    *,
    narrative: str,
    comp100: int,
    comp_sd: float,
    comp1m100: int,
    comp3m100: int,
    rows: list[dict],
    dashboard_url: str,
    analysis_url: str,
    as_of_date: str,
) -> str:
    theme_label = regime_theme(comp_sd)["label"]
    today = datetime.now().strftime("%A, %B %d, %Y")

    lines: list[str] = []
    lines.append(f"Market Stress Dashboard — {today}")
    lines.append("=" * 64)
    lines.append(f"Regime: {theme_label}   Composite: {comp100}/100")
    lines.append(f"1-Month Prior: {comp1m100}    3-Month Prior: {comp3m100}")
    lines.append("")
    lines.append(f"Open dashboard: {dashboard_url}")
    lines.append("")
    lines.append("-" * 64)
    lines.append(narrative.strip())
    lines.append("")
    lines.append("-" * 64)
    lines.append("All 25 indicators (sorted by stress, high → low)")
    lines.append("")
    header = f"{'Indicator':<22}{'Value':>10}  {'Score':>6}  {'Δ 1M':>7}"
    lines.append(header)
    lines.append("-" * len(header))
    for r in rows:
        arrow, delta, _ = trend_marker(r["delta"])
        lines.append(
            f"{r['name']:<22}{r['value']:>10}  {r['stress']:>5}  {arrow} {delta:>4}"
        )
    lines.append("")
    lines.append(f"Data fetched {as_of_date}.")
    return "\n".join(lines) + "\n"


# ──────────────────────────────────────────────────────────────────────
# Email send
# ──────────────────────────────────────────────────────────────────────


def send_email(subject: str, body_plain: str, body_html: str | None = None) -> None:
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
    # Per RFC 2046, attach plain text first and HTML last; clients prefer the last usable part.
    msg.attach(MIMEText(body_plain, "plain", "utf-8"))
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))
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


# ──────────────────────────────────────────────────────────────────────
# Orchestration
# ──────────────────────────────────────────────────────────────────────


def _compose_from_series(
    now: dict[str, float],
    m1: dict[str, float],
    m3: dict[str, float],
    as_of: dict[str, str],
    narrative: str,
) -> tuple[str, str, str]:
    """Return (subject, plain_text, html) composed from the given data + narrative."""
    comp_sd = comp_score(now)
    comp100 = sd_to_100(comp_sd)
    comp1m100 = sd_to_100(comp_score({k: m1.get(k, now[k]) for k in now}))
    comp3m100 = sd_to_100(comp_score({k: m3.get(k, now[k]) for k in now}))
    rows = per_indicator_stats(now, m1)

    url = os.environ.get("DASHBOARD_URL", "http://localhost:5173").rstrip("/")
    analysis_url = url  # AI Analysis tab was removed; kept as param for back-compat.

    # Use the freshest as_of date we have as the "fetched on" label
    as_of_date = sorted([v for v in as_of.values() if v], reverse=True)
    as_of_label = as_of_date[0] if as_of_date else datetime.now().strftime("%Y-%m-%d")

    theme_label = regime_theme(comp_sd)["label"]
    subject = (
        f"Market stress — {datetime.now():%b %d, %Y} · "
        f"{theme_label} · {comp100}/100"
    )
    plain = build_plain_text_email(
        narrative=narrative,
        comp100=comp100,
        comp_sd=comp_sd,
        comp1m100=comp1m100,
        comp3m100=comp3m100,
        rows=rows,
        dashboard_url=url,
        analysis_url=analysis_url,
        as_of_date=as_of_label,
    )
    html = build_html_email(
        narrative=narrative,
        comp100=comp100,
        comp_sd=comp_sd,
        comp1m100=comp1m100,
        comp3m100=comp3m100,
        rows=rows,
        dashboard_url=url,
        analysis_url=analysis_url,
        as_of_date=as_of_label,
    )
    return subject, plain, html


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
    narrative = run_claude(prompt)

    subject, plain, html = _compose_from_series(now, m1, m3, as_of, narrative)

    preview_path = os.environ.get("EMAIL_PREVIEW_PATH", "").strip()
    if preview_path:
        try:
            with open(preview_path, "w", encoding="utf-8") as f:
                f.write(html)
            print(f"✓ Wrote HTML preview to {preview_path}")
        except OSError as e:
            print(f"⚠ Could not write preview: {e}")

    send_email(subject, plain, html)
    print(f"✓ Emailed {os.environ.get('EMAIL_TO')} — subject: {subject}")


if __name__ == "__main__":
    print(
        "Run via fetch_indicators.py after a successful fetch, or set up env and import run_if_configured(results)."
    )
