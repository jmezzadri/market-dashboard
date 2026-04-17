#!/usr/bin/env python3
"""Daily consolidated brief — dashboard regime + scanner signals in ONE email.

Runs in GitHub Actions after fetch_indicators.py has patched src/App.jsx and the
trading-scanner workflow has pushed a fresh public/latest_scan_data.json into this
repo. Reads both data sources, calls Claude for the narrative, builds a single
rich HTML email, and sends it via SMTP.

Configure via environment (mapped from GitHub Actions secrets in daily-brief.yml):

  ANTHROPIC_API_KEY
  EMAIL_TO            — recipient
  EMAIL_FROM          — default = EMAIL_TO
  SMTP_HOST           — default = smtp.gmail.com
  SMTP_PORT           — default = 587
  SMTP_USER           — default = EMAIL_FROM
  SMTP_PASSWORD       — Gmail app password (same value as GMAIL_APP_PASSWORD secret in trading-scanner)
  DASHBOARD_URL       — e.g. https://market-dashboard-git-main-joe-mezzadri.vercel.app
  SCANNER_REPORT_URL  — optional; link to the full scanner HTML report on Vercel
  CLAUDE_MODEL        — default = claude-sonnet-4-20250514
  SKIP_EMAIL=1        — compose but don't send (for local testing)
  EMAIL_PREVIEW_PATH  — write HTML body to a file for previewing
"""
from __future__ import annotations

import html as _html
import json
import os
import sys
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_JSX = os.path.join(BASE_DIR, "src", "App.jsx")
SCAN_JSON = os.path.join(BASE_DIR, "public", "latest_scan_data.json")

# Ensure local imports resolve
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from daily_analysis_email import (  # noqa: E402
    build_html_email as build_dashboard_html_email,
    build_plain_text_email as build_dashboard_plain,
    build_prompt,
    extract_as_of,
    parse_ind_lines,
    per_indicator_stats,
    regime_theme,
    run_claude,
    send_email,
    stress_bar_color,
    trend_marker,
)
from macro_compute import comp_score, sd_to_100  # noqa: E402


# ──────────────────────────────────────────────────────────────────────
# Scan data loading
# ──────────────────────────────────────────────────────────────────────


def load_scan_data(path: str = SCAN_JSON) -> dict:
    if not os.path.isfile(path):
        print(f"⚠ daily_brief: scan data not found at {path} — continuing without scanner section")
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"⚠ daily_brief: could not read scan data ({e}) — continuing without scanner section")
        return {}


def scan_freshness_label(scan: dict) -> str | None:
    """Return a human label noting staleness if the scan is more than 12h old."""
    ts = scan.get("scan_time")
    if not ts:
        return None
    try:
        # scan_time looks like "2026-04-16T18:02:00-04:00"
        dt = datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None
    now = datetime.now(dt.tzinfo or timezone.utc)
    age_h = (now - dt).total_seconds() / 3600
    if age_h > 12:
        return f"⚠ Scanner data is {int(age_h)}h old"
    return None


# ──────────────────────────────────────────────────────────────────────
# Scanner HTML sections
# ──────────────────────────────────────────────────────────────────────


def _signal_pill(score: int) -> tuple[str, str]:
    """Return (bg, fg) colors for a score pill."""
    if score >= 60:
        return ("#dcfce7", "#166534")  # green — Buy
    if score >= 35:
        return ("#fef3c7", "#854d0e")  # yellow — Watch
    return ("#f3f4f6", "#374151")  # gray


def _tier_label(score: int) -> str:
    if score >= 60:
        return "BUY"
    if score >= 35:
        return "WATCH"
    return ""


def _fmt_price(price) -> str:
    try:
        p = float(price)
    except (TypeError, ValueError):
        return "—"
    if p >= 1000:
        return f"${p:,.0f}"
    if p >= 10:
        return f"${p:.2f}"
    return f"${p:.2f}"


def _signal_row(sig: dict) -> str:
    ticker = sig.get("ticker", "—")
    score = int(sig.get("score", 0) or 0)
    price = _fmt_price(sig.get("current_price"))
    bg, fg = _signal_pill(score)
    tier = _tier_label(score)
    return (
        "<tr>"
        f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13.5px;font-weight:700;color:#0f172a;">{_html.escape(ticker)}</td>'
        f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f172a;text-align:right;">{_html.escape(price)}</td>'
        f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f172a;text-align:right;font-weight:700;">{score}</td>'
        f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;text-align:center;">'
        f'<span style="display:inline-block;padding:3px 10px;background:{bg};color:{fg};'
        f'border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.06em;'
        f'font-family:ui-sans-serif,system-ui,sans-serif;">{tier or "—"}</span></td>'
        "</tr>"
    )


def _signals_section(scan: dict) -> str:
    buys = scan.get("buy_opportunities") or []
    watches = scan.get("watch_items") or []
    sells = scan.get("sell_alerts") or []
    if not (buys or watches or sells):
        return (
            '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6b7280;'
            'text-transform:uppercase;margin:0 0 10px;">Trade Signals</div>'
            '<div style="padding:12px 14px;background:#f8fafc;border:1px dashed #cbd5e1;'
            'border-radius:6px;color:#475569;font-size:13px;">No buy/watch/sell signals triggered in today\u2019s scan.</div>'
        )

    parts: list[str] = []
    parts.append(
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6b7280;'
        'text-transform:uppercase;margin:0 0 10px;">Trade Signals</div>'
    )
    parts.append(
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        'style="border-collapse:collapse;">'
        "<thead><tr style=\"background:#f8fafc;\">"
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;'
        'font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Ticker</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;'
        'font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Price</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;'
        'font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Score</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:center;'
        'font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Tier</th>'
        "</tr></thead><tbody>"
    )
    # Highest-score first
    combined = sorted(list(buys) + list(watches) + list(sells),
                      key=lambda s: int(s.get("score", 0) or 0), reverse=True)
    for sig in combined[:15]:
        parts.append(_signal_row(sig))
    parts.append("</tbody></table>")
    if len(combined) > 15:
        parts.append(
            f'<div style="font-size:12px;color:#6b7280;margin:8px 0 0;">'
            f"Showing top 15 of {len(combined)} signals. See the full scanner report for the rest."
            "</div>"
        )
    return "".join(parts)


def _covered_calls_section(scan: dict) -> str:
    ccs = scan.get("portfolio_covered_calls") or []
    if not ccs:
        return ""

    parts: list[str] = []
    parts.append(
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6b7280;'
        'text-transform:uppercase;margin:16px 0 10px;">Covered Call Opportunities</div>'
    )
    parts.append(
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        'style="border-collapse:collapse;">'
        "<thead><tr style=\"background:#f8fafc;\">"
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Ticker</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Strike</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">DTE</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Ann. Yield</th>'
        "</tr></thead><tbody>"
    )
    for cc in ccs[:5]:
        ticker = cc.get("ticker", "—")
        strike = cc.get("strike") or cc.get("strike_price")
        dte = cc.get("dte") or cc.get("days_to_expiration")
        yld = cc.get("annualized_yield_pct") or cc.get("annualized_yield")
        parts.append(
            "<tr>"
            f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13.5px;font-weight:700;color:#0f172a;">{_html.escape(str(ticker))}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f172a;text-align:right;">{_fmt_price(strike) if strike else "—"}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f172a;text-align:right;">{int(dte) if dte is not None else "—"}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f172a;text-align:right;font-weight:700;">{f"{float(yld):.1f}%" if yld is not None else "—"}</td>'
            "</tr>"
        )
    parts.append("</tbody></table>")
    return "".join(parts)


def _portfolio_section(scan: dict) -> str:
    positions = scan.get("portfolio_positions") or []
    if not positions:
        return ""
    parts: list[str] = []
    parts.append(
        '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6b7280;'
        'text-transform:uppercase;margin:16px 0 10px;">Current Positions</div>'
    )
    parts.append(
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        'style="border-collapse:collapse;">'
        "<thead><tr style=\"background:#f8fafc;\">"
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Ticker</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Shares</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Avg Cost</th>'
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:11px;color:#6b7280;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Entry</th>'
        "</tr></thead><tbody>"
    )
    for p in positions:
        parts.append(
            "<tr>"
            f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13.5px;font-weight:700;color:#0f172a;">{_html.escape(str(p.get("ticker","—")))}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f172a;text-align:right;">{int(p.get("shares", 0)):,}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#0f172a;text-align:right;">{_fmt_price(p.get("avg_cost"))}</td>'
            f'<td style="padding:10px;border-bottom:1px solid #f1f5f9;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;color:#475569;">{_html.escape(str(p.get("entry_date","—")))}</td>'
            "</tr>"
        )
    parts.append("</tbody></table>")
    return "".join(parts)


# ──────────────────────────────────────────────────────────────────────
# Full consolidated HTML
# ──────────────────────────────────────────────────────────────────────


def build_consolidated_html(
    *,
    dashboard_html: str,
    scan: dict,
    dashboard_url: str,
    scanner_report_url: str,
) -> str:
    """Splice scanner sections into the dashboard email HTML.

    We take the already-rendered dashboard email body and inject scanner content
    before the footer. This reuses all the dashboard email styling.
    """
    signals_html = _signals_section(scan)
    ccs_html = _covered_calls_section(scan)
    portfolio_html = _portfolio_section(scan)
    freshness = scan_freshness_label(scan)
    freshness_html = (
        f'<div style="margin:0 0 12px;padding:8px 12px;background:#fef3c7;'
        f'border-left:3px solid #eab308;color:#854d0e;font-size:12.5px;border-radius:4px;">'
        f'{_html.escape(freshness)}</div>'
        if freshness else ""
    )

    scanner_cta = ""
    if scanner_report_url:
        scanner_cta = (
            '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:12px 0 0;">'
            '<tr><td style="background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;">'
            f'<a href="{_html.escape(scanner_report_url)}" style="display:inline-block;padding:10px 18px;color:#0f172a;font-size:13px;font-weight:600;text-decoration:none;">Open full scanner report →</a>'
            "</td></tr></table>"
        )

    scanner_block = (
        '<tr><td style="padding:0 28px 8px;">'
        '<div style="border-top:1px solid #e5e7eb;margin:4px 0 20px;"></div>'
        f"{freshness_html}"
        f"{signals_html}"
        f"{ccs_html}"
        f"{portfolio_html}"
        f"{scanner_cta}"
        "</td></tr>"
    )

    # Inject scanner block right before the footer row (first match of the footer tr).
    footer_anchor = '<!-- Footer -->'
    if footer_anchor in dashboard_html:
        return dashboard_html.replace(footer_anchor, scanner_block + footer_anchor, 1)
    # Fallback: append before </table></td></tr></table></body>
    return dashboard_html.replace("</table>\n</td></tr>\n</table>\n</body>",
                                  scanner_block + "</table>\n</td></tr>\n</table>\n</body>", 1)


# ──────────────────────────────────────────────────────────────────────
# Plain-text composition (appends scanner sections to dashboard plain text)
# ──────────────────────────────────────────────────────────────────────


def build_consolidated_plain(dashboard_plain: str, scan: dict) -> str:
    lines: list[str] = [dashboard_plain.rstrip(), "", "=" * 64]

    buys = scan.get("buy_opportunities") or []
    watches = scan.get("watch_items") or []
    sells = scan.get("sell_alerts") or []
    all_signals = sorted(list(buys) + list(watches) + list(sells),
                         key=lambda s: int(s.get("score", 0) or 0), reverse=True)

    lines.append("TRADE SIGNALS")
    if not all_signals:
        lines.append("  (no buy/watch/sell signals today)")
    else:
        lines.append(f"  {'Ticker':<8}{'Price':>10}{'Score':>8}  Tier")
        for s in all_signals[:15]:
            tier = _tier_label(int(s.get("score", 0) or 0))
            lines.append(
                f"  {s.get('ticker','—'):<8}"
                f"{_fmt_price(s.get('current_price')):>10}"
                f"{int(s.get('score', 0) or 0):>8}  {tier}"
            )

    ccs = scan.get("portfolio_covered_calls") or []
    if ccs:
        lines.append("")
        lines.append("COVERED CALL OPPORTUNITIES")
        lines.append(f"  {'Ticker':<8}{'Strike':>10}{'DTE':>6}{'Ann.Yld':>9}")
        for cc in ccs[:5]:
            yld = cc.get("annualized_yield_pct") or cc.get("annualized_yield")
            lines.append(
                f"  {cc.get('ticker','—'):<8}"
                f"{_fmt_price(cc.get('strike') or cc.get('strike_price')):>10}"
                f"{int(cc.get('dte') or cc.get('days_to_expiration') or 0):>6}"
                f"{(f'{float(yld):.1f}%' if yld is not None else '—'):>9}"
            )

    positions = scan.get("portfolio_positions") or []
    if positions:
        lines.append("")
        lines.append("CURRENT POSITIONS")
        for p in positions:
            lines.append(
                f"  {p.get('ticker','—'):<8} {int(p.get('shares',0)):>6} sh "
                f"@ {_fmt_price(p.get('avg_cost'))}  (entry {p.get('entry_date','—')})"
            )

    freshness = scan_freshness_label(scan)
    if freshness:
        lines.append("")
        lines.append(freshness)

    return "\n".join(lines) + "\n"


# ──────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────


def main() -> int:
    # Required env
    missing = [k for k in ("EMAIL_TO", "SMTP_PASSWORD") if not os.environ.get(k)]
    if missing and os.environ.get("SKIP_EMAIL") != "1":
        print(f"✗ daily_brief: missing required env: {', '.join(missing)}")
        return 2

    if not os.path.isfile(APP_JSX):
        print(f"✗ daily_brief: {APP_JSX} not found")
        return 2

    with open(APP_JSX, "r", encoding="utf-8") as f:
        app_text = f.read()

    series, ok = parse_ind_lines(app_text)
    if not ok or not series:
        print("✗ daily_brief: could not parse IND from App.jsx")
        return 2

    as_of = extract_as_of(app_text)
    now = {k: series[k][0] for k in series}
    m1 = {k: series[k][1] for k in series}
    m3 = {k: series[k][2] for k in series}

    # AI narrative — soft fail if ANTHROPIC_API_KEY missing
    narrative = ""
    if os.environ.get("ANTHROPIC_API_KEY"):
        print("→ Calling Claude for narrative…")
        try:
            narrative = run_claude(build_prompt(now, m1, m3, as_of))
        except Exception as e:
            print(f"⚠ Narrative generation failed ({e}) — continuing without narrative")
            narrative = (
                "REGIME SUMMARY\n"
                "Narrative generation was unavailable for this run. "
                "See the dashboard for the latest regime read.\n"
            )
    else:
        print("⚠ ANTHROPIC_API_KEY not set — skipping narrative")
        narrative = (
            "REGIME SUMMARY\n"
            "Narrative disabled (ANTHROPIC_API_KEY not set).\n"
        )

    # Compute composite + dashboard sections
    comp_sd = comp_score(now)
    comp100 = sd_to_100(comp_sd)
    comp1m100 = sd_to_100(comp_score({k: m1.get(k, now[k]) for k in now}))
    comp3m100 = sd_to_100(comp_score({k: m3.get(k, now[k]) for k in now}))
    rows = per_indicator_stats(now, m1)

    dashboard_url = os.environ.get("DASHBOARD_URL",
                                   "https://market-dashboard-git-main-joe-mezzadri.vercel.app"
                                   ).rstrip("/")
    analysis_url = dashboard_url  # AI Analysis tab was removed; kept for back-compat with email helpers.
    scanner_report_url = os.environ.get("SCANNER_REPORT_URL", "").strip()

    as_of_date = sorted([v for v in as_of.values() if v], reverse=True)
    as_of_label = as_of_date[0] if as_of_date else datetime.now().strftime("%Y-%m-%d")

    dashboard_html = build_dashboard_html_email(
        narrative=narrative, comp100=comp100, comp_sd=comp_sd,
        comp1m100=comp1m100, comp3m100=comp3m100, rows=rows,
        dashboard_url=dashboard_url, analysis_url=analysis_url,
        as_of_date=as_of_label,
    )
    dashboard_plain = build_dashboard_plain(
        narrative=narrative, comp100=comp100, comp_sd=comp_sd,
        comp1m100=comp1m100, comp3m100=comp3m100, rows=rows,
        dashboard_url=dashboard_url, analysis_url=analysis_url,
        as_of_date=as_of_label,
    )

    # Splice in scanner sections
    scan = load_scan_data()
    consolidated_html = build_consolidated_html(
        dashboard_html=dashboard_html,
        scan=scan,
        dashboard_url=dashboard_url,
        scanner_report_url=scanner_report_url,
    )
    consolidated_plain = build_consolidated_plain(dashboard_plain, scan)

    theme_label = regime_theme(comp_sd)["label"]
    n_signals = len((scan.get("buy_opportunities") or [])) + \
                len((scan.get("watch_items") or [])) + \
                len((scan.get("sell_alerts") or []))
    signal_frag = f" · {n_signals} signal{'s' if n_signals != 1 else ''}" if n_signals else ""
    subject = (
        f"Daily brief — {datetime.now():%b %d, %Y} · "
        f"{theme_label} {comp100}/100{signal_frag}"
    )

    # Optional HTML preview to disk
    preview = os.environ.get("EMAIL_PREVIEW_PATH", "").strip()
    if preview:
        try:
            with open(preview, "w", encoding="utf-8") as f:
                f.write(consolidated_html)
            print(f"✓ Wrote HTML preview → {preview}")
        except OSError as e:
            print(f"⚠ Preview write failed: {e}")

    if os.environ.get("SKIP_EMAIL") == "1":
        print("SKIP_EMAIL=1 — composed but did not send")
        print(f"  subject: {subject}")
        return 0

    send_email(subject, consolidated_plain, consolidated_html)
    print(f"✓ Sent daily brief → {os.environ.get('EMAIL_TO')}  (subject: {subject})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
