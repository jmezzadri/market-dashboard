"""Markdown + CSV + HTML report generation."""

from __future__ import annotations

import html as html_module
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from config import CC_MIN_IV_RANK, PROJECT_ROOT, SCORE_BUY_ALERT, SCORE_WATCH_ALERT
from scanner import unusual_whales as uw
from scanner.covered_calls import earnings_within_window, find_optimal_covered_call
from scanner.price_history import get_price_changes
from scanner.scorer import get_insider_dollar_value, qualifying_insider_rows, signal_narrative
from scanner.sell_signals import calc_pt_sl

logger = logging.getLogger(__name__)

REPORTS_DIR = PROJECT_ROOT / "reports"

SCAN_LABELS = {
    "premarket": "Morning Pre-Market",
    "intraday": "Intraday",
    "postmarket": "Post-Market",
    "weekly": "Weekly Review",
}

NEXT_SCAN_BLURB = {
    "premarket": "later today (intraday / post-market)",
    "intraday": "post-market or next pre-market",
    "postmarket": "next pre-market",
    "weekly": "next scheduled weekly review",
}


def _email_day_parenthetical() -> str:
    n = datetime.now(ZoneInfo("America/New_York"))
    return n.strftime("%a %b ") + str(n.day)


def _portfolio_subject_snippet(a: dict[str, Any]) -> str:
    t = a.get("ticker") or "?"
    at = a.get("alert_type") or ""
    if at == "stop_loss":
        return f"{t} stop-loss triggered"
    if at == "insider_reversal":
        return f"{t} insider reversal"
    if at == "congress_reversal":
        return f"{t} congressional reversal"
    if at == "score_collapse":
        return f"{t} score collapse"
    if at == "add_to_position":
        return f"{t} add-to-position context"
    if at == "unrealized_gain":
        return f"{t} unrealized gain (informational)"
    if at == "cc_roll_early":
        return f"{t} covered call roll (profit)"
    if at == "cc_roll_up":
        return f"{t} covered call roll up"
    if at == "cc_roll_out":
        return f"{t} covered call roll out"
    if at == "buy_back_profit":
        return f"{t} covered call buyback"
    if at == "expired_worthless":
        return f"{t} expired covered call"
    return f"{t} portfolio alert"


def _sort_portfolio_alerts(alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    order = {"high": 0, "medium": 1, "low": 2}

    def key(a: dict[str, Any]) -> tuple[int, str]:
        return (order.get(str(a.get("urgency") or "").lower(), 9), str(a.get("ticker") or ""))

    return sorted(alerts, key=key)


def _partition_portfolio_alerts(
    alerts: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Actionable vs informational (e.g. unrealized gain note)."""
    act = [a for a in alerts if not a.get("is_informational")]
    info = [a for a in alerts if a.get("is_informational")]
    return _sort_portfolio_alerts(act), sorted(info, key=lambda a: str(a.get("ticker") or ""))


def build_subject(
    buy_opps: list[dict[str, Any]],
    watch_opps: list[dict[str, Any]],
    sell_alerts: list[dict[str, Any]],
    scan_type: str,
    date_str: str,
) -> str:
    """Email subject per CURSOR_EMAIL_REDESIGN_SPEC §7."""
    parts: list[str] = []
    if buy_opps:
        tickers = ", ".join(o["ticker"] for o in buy_opps[:3])
        parts.append(f"🟢 {len(buy_opps)} Buy: {tickers}")
    if watch_opps:
        parts.append(f"👀 {len(watch_opps)} Watch")
    high_alerts = [
        a
        for a in sell_alerts
        if a.get("urgency") == "high" and not a.get("is_informational")
    ]
    if high_alerts:
        tickers = ", ".join(a["ticker"] for a in high_alerts[:2])
        parts.append(f"⚠️ Action: {tickers}")
    if not parts:
        parts = ["No alerts"]
    return f"[Trading Scanner] {' | '.join(parts)} — {scan_type.title()} {date_str}"


def _parse_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _analysis_two_sentences(ticker: str, signals: dict[str, Any]) -> str:
    bullets = signal_narrative(ticker, signals)
    if not bullets:
        return "Composite score from available signal data."
    text = " ".join(bullets)
    sents = re.split(r"(?<=[.!?])\s+", text.strip())
    sents = [s for s in sents if s]
    if len(sents) <= 2:
        return text.strip()
    return " ".join(sents[:2]).strip()


def _earnings_blocks_typical_cc(next_earnings_date: str | None) -> bool:
    if not next_earnings_date:
        return False
    try:
        today = datetime.now(ZoneInfo("America/New_York")).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        rep = (today + timedelta(days=35)).date()
        return earnings_within_window(next_earnings_date, rep)
    except (ValueError, TypeError, OSError):
        return False


def _fmt_earnings_short(next_earnings_date: str | None) -> str:
    if not next_earnings_date:
        return ""
    try:
        d = datetime.strptime(str(next_earnings_date).strip()[:10], "%Y-%m-%d")
        return d.strftime("%b %d").lstrip("0").replace(" 0", " ")
    except ValueError:
        return str(next_earnings_date).strip()[:10]


def _html_cc_action_from_contract(cc: dict[str, Any]) -> str:
    exp_s = str(cc.get("expiry") or "")[:10]
    try:
        d = datetime.strptime(exp_s, "%Y-%m-%d")
        exp_label = d.strftime("%b %d").replace(" 0", " ")
    except ValueError:
        exp_label = exp_s
    try:
        strike = float(cc.get("strike") or 0)
    except (TypeError, ValueError):
        strike = 0.0
    bid = cc.get("bid")
    ask = cc.get("ask")
    mid = cc.get("mid")
    sp = cc.get("spread_pct")
    yld = cc.get("annualized_yield")
    lines = [
        f"Sell {exp_label} ${_escape_html(f'{strike:,.2f}')} Call",
        (
            f"Bid: {_escape_html(_fmt_money(bid))} | Ask: {_escape_html(_fmt_money(ask))} | "
            f"Mid: {_escape_html(_fmt_money(mid))} | Spread: {_escape_html(str(sp))}%"
        ),
        f"Yield: {_escape_html(str(yld))}% annualized",
    ]
    return "<br/>".join(lines)


def _resolve_cc_columns(
    ticker: str,
    price: float | None,
    signals: dict[str, Any],
    *,
    precomputed_cc: dict[str, Any] | None = None,
    precomputed_cc_note: str | None = None,
) -> tuple[str, str]:
    """
    Returns (cc_opportunity_cell_html, cc_action_cell_html).
    """
    sym = ticker.upper()
    sc_row = (signals.get("screener") or {}).get(sym) if isinstance(signals.get("screener"), dict) else None
    sc_row = sc_row or {}
    ivr = _parse_float(sc_row.get("iv_rank"))
    earn_raw = sc_row.get("next_earnings_date")
    earn_s = str(earn_raw).strip()[:10] if earn_raw is not None and str(earn_raw).strip() else None

    yes_style = "color:#27ae60;font-weight:bold;"
    warn_style = "color:#e67e22;font-weight:bold;"
    sub_muted = "color:#555;font-size:11px;"

    if precomputed_cc:
        return (
            f'<span style="{yes_style}">Yes</span>',
            _html_cc_action_from_contract(precomputed_cc),
        )

    if price is None or price <= 0:
        return (
            f'<span style="{sub_muted}">No</span><br/><span style="{sub_muted}">No price</span>',
            "N/A",
        )

    chain: list[dict[str, Any]] = []
    try:
        chain = uw.get_options_chain(ticker)
    except Exception as e:
        logger.debug("options chain for %s: %s", ticker, e)

    opt = None
    if chain:
        opt = find_optimal_covered_call(
            sym,
            float(price),
            chain,
            iv_rank=ivr,
            next_earnings_date=earn_s,
        )

    if opt:
        return (
            f'<span style="{yes_style}">Yes</span>',
            _html_cc_action_from_contract(opt),
        )

    if ivr is not None and ivr < CC_MIN_IV_RANK:
        return (
            f'No<br/><span style="{sub_muted}">IVR too low</span>',
            "N/A",
        )

    if earn_s and _earnings_blocks_typical_cc(earn_s):
        el = _fmt_earnings_short(earn_s)
        return (
            f'<span style="{warn_style}">⚠️ Earnings {el}</span>',
            f"Wait — earnings {_escape_html(el)}.",
        )

    if not chain:
        return (
            f'No<br/><span style="{sub_muted}">No chain</span>',
            "N/A",
        )

    return (
        f'No<br/><span style="{sub_muted}">No liquid strikes</span>',
        "N/A",
    )


def _pct_cell_html(s: str) -> str:
    if s == "N/A" or not s:
        return _escape_html(s or "N/A")
    try:
        v = float(s.replace("%", "").replace("+", ""))
    except ValueError:
        return _escape_html(s)
    col = "#27ae60" if v >= 0 else "#e74c3c"
    return f'<span style="color:{col};font-weight:600;">{_escape_html(s)}</span>'


def _action_pill_html(action: str) -> str:
    a = (action or "").strip()
    styles = {
        "Buy": "background:#27ae60;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;",
        "Watch": "background:#2980b9;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;",
        "Sell": "background:#e74c3c;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;",
        "Hold": "background:#95a5a6;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;",
        "Add": "background:#8e44ad;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;",
    }
    st = styles.get(a, styles["Hold"])
    return f'<span style="{st}">{_escape_html(a)}</span>'


def _portfolio_action_for_ticker(
    sym: str,
    sell_alerts: list[dict[str, Any]],
    score: int | None,
) -> str:
    actionable = [
        a
        for a in sell_alerts
        if not a.get("is_informational") and (a.get("ticker") or "").upper() == sym
    ]
    for a in actionable:
        at = str(a.get("alert_type") or "")
        if at == "stop_loss":
            return "Sell"
        if at in ("score_collapse", "insider_reversal", "congress_reversal"):
            return "Sell"
        if a.get("urgency") == "high":
            return "Sell"
    for a in actionable:
        if str(a.get("alert_type") or "") == "add_to_position":
            return "Add"
    if score is not None and score >= SCORE_WATCH_ALERT:
        return "Add"
    return "Hold"


def _portfolio_analysis_cell(sym: str, action: str, signals: dict[str, Any], sell_alerts: list[dict[str, Any]]) -> str:
    actionable = [
        a
        for a in sell_alerts
        if not a.get("is_informational") and (a.get("ticker") or "").upper() == sym
    ]
    if actionable:
        a = actionable[0]
        d = (a.get("detail") or a.get("message") or "").strip()
        h = (a.get("headline") or "").strip()
        chunk = f"{h} {d}".strip()
        sents = re.split(r"(?<=[.!?])\s+", chunk)
        sents = [s for s in sents if s]
        return " ".join(sents[:2]).strip() if sents else chunk
    if action == "Add":
        return _analysis_two_sentences(sym, signals)
    base = _analysis_two_sentences(sym, signals)
    if action == "Hold":
        return f"No active sell triggers. {base}" if base else "No active sell triggers."
    return base


def _row_left_border(section: str, action: str) -> str:
    if action == "Sell":
        return "border-left:4px solid #e74c3c;"
    if section == "triggered":
        return "border-left:4px solid #27ae60;"
    if section == "watch":
        return "border-left:4px solid #2980b9;"
    return "border-left:4px solid #7f8c8d;"


def _build_data_table_html(
    section: str,
    header_score_or_pnl: str,
    rows: list[dict[str, Any]],
) -> str:
    """rows: each dict has keys matching column builder output (pre-escaped inner HTML where needed)."""
    th = 'style="background:#2e86c1;color:#fff;font-size:12px;padding:6px 8px;text-align:left;border:1px solid #1f5f85;"'
    td = 'style="padding:6px 8px;font-size:12px;border-bottom:1px solid #ddd;vertical-align:top;"'
    tbl = 'style="border-collapse:collapse;width:100%;"'
    hdr = (
        f"<tr>"
        f'<th {th}>Ticker</th><th {th}>Company</th><th {th}>Price</th>'
        f'<th {th}>{_escape_html(header_score_or_pnl)}</th>'
        f'<th {th}>1W</th><th {th}>1M</th><th {th}>YTD</th>'
        f'<th {th}>Action</th><th {th}>Analysis</th>'
        f'<th {th}>CC Opportunity</th><th {th}>CC Action</th><th {th}>PT / SL</th>'
        f"</tr>"
    )
    if not rows:
        empty_td = (
            'style="padding:10px 8px;color:#777;font-style:italic;'
            'border-bottom:1px solid #ddd;font-size:12px;"'
        )
        empty = f'<tr><td colspan="12" {empty_td}>No entries this scan.</td></tr>'
        return f"<table {tbl}><thead>{hdr}</thead><tbody>{empty}</tbody></table>"

    body_lines: list[str] = []
    for i, r in enumerate(rows):
        bg = "background:#f2f3f4;" if i % 2 == 0 else ""
        lb = _row_left_border(section, r.get("action") or "")
        tr_style = f"{lb}{bg}"
        body_lines.append(
            f'<tr style="{tr_style}">'
            f'<td {td}><strong>{r["ticker"]}</strong></td>'
            f'<td {td}>{r["company"]}</td>'
            f'<td {td}>{r["price"]}</td>'
            f'<td {td}>{r["score_or_pnl"]}</td>'
            f'<td {td}>{r["w1"]}</td>'
            f'<td {td}>{r["m1"]}</td>'
            f'<td {td}>{r["ytd"]}</td>'
            f'<td {td}>{r["action_html"]}</td>'
            f'<td {td}>{r["analysis"]}</td>'
            f'<td {td}>{r["cc_opp"]}</td>'
            f'<td {td}>{r["cc_action"]}</td>'
            f'<td {td}>{r["pt_sl"]}</td>'
            f"</tr>"
        )
    return f"<table {tbl}><thead>{hdr}</thead><tbody>{''.join(body_lines)}</tbody></table>"


def _section_header_html(title: str) -> str:
    return (
        f'<div style="background:#1a5276;color:#fff;padding:8px 12px;font-weight:bold;'
        f'font-family:Arial,sans-serif;margin-top:16px;">{_escape_html(title)}</div>'
    )


def _fmt_money(x: float | None) -> str:
    if x is None:
        return "—"
    try:
        return f"${float(x):,.2f}"
    except (TypeError, ValueError):
        return "—"


def build_scan_report_body_html(
    scan_type: str,
    buy_opportunities: list[dict[str, Any]],
    watch_items: list[dict[str, Any]],
    sell_alerts: list[dict[str, Any]],
    signals: dict[str, Any],
    *,
    portfolio_positions: list[dict[str, Any]] | None = None,
) -> str:
    """
    Three structured HTML tables (inline CSS). Same content as redesigned email body.
    """
    portfolio_positions = portfolio_positions or []
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    score_map: dict[str, int] = signals.get("_score_by_ticker") or {}

    triggered_rows: list[dict[str, Any]] = []
    for opp in buy_opportunities:
        t = opp["ticker"]
        sym = t.upper()
        price = opp.get("current_price")
        pc = get_price_changes(t)
        ptsl = calc_pt_sl(float(price)) if price is not None and price > 0 else None
        pt_sl_s = (
            f"PT: {_escape_html(_fmt_money(ptsl['pt']))}<br/>SL: {_escape_html(_fmt_money(ptsl['sl']))}"
            if ptsl
            else "—"
        )
        cc_o, cc_a = _resolve_cc_columns(
            t,
            _parse_float(price),
            signals,
            precomputed_cc=opp.get("covered_call"),
            precomputed_cc_note=opp.get("cc_note"),
        )
        triggered_rows.append(
            {
                "ticker": _escape_html(sym),
                "company": _escape_html(uw.get_company_name(t).title()),
                "price": _escape_html(_fmt_money(price)),
                "score_or_pnl": _escape_html(str(opp.get("score", ""))),
                "w1": _pct_cell_html(pc.get("1w", "N/A")),
                "m1": _pct_cell_html(pc.get("1m", "N/A")),
                "ytd": _pct_cell_html(pc.get("ytd", "N/A")),
                "action_html": _action_pill_html("Buy"),
                "analysis": _escape_html(_analysis_two_sentences(t, signals)).replace("\n", "<br/>"),
                "cc_opp": cc_o,
                "cc_action": cc_a,
                "pt_sl": pt_sl_s,
                "action": "Buy",
            }
        )

    watch_rows: list[dict[str, Any]] = []
    for w in watch_items:
        t = w["ticker"]
        sym = t.upper()
        price = w.get("current_price")
        pc = get_price_changes(t)
        ptsl = calc_pt_sl(float(price)) if price is not None and price > 0 else None
        pt_sl_s = (
            f"PT: {_escape_html(_fmt_money(ptsl['pt']))}<br/>SL: {_escape_html(_fmt_money(ptsl['sl']))}"
            if ptsl
            else "—"
        )
        cc_o, cc_a = _resolve_cc_columns(t, _parse_float(price), signals)
        watch_rows.append(
            {
                "ticker": _escape_html(sym),
                "company": _escape_html(uw.get_company_name(t).title()),
                "price": _escape_html(_fmt_money(price)),
                "score_or_pnl": _escape_html(str(w.get("score", ""))),
                "w1": _pct_cell_html(pc.get("1w", "N/A")),
                "m1": _pct_cell_html(pc.get("1m", "N/A")),
                "ytd": _pct_cell_html(pc.get("ytd", "N/A")),
                "action_html": _action_pill_html("Watch"),
                "analysis": _escape_html(_analysis_two_sentences(t, signals)).replace("\n", "<br/>"),
                "cc_opp": cc_o,
                "cc_action": cc_a,
                "pt_sl": pt_sl_s,
                "action": "Watch",
            }
        )

    portfolio_rows: list[dict[str, Any]] = []
    screener = signals.get("screener") or {}
    for pos in portfolio_positions:
        sym = (pos.get("ticker") or "").upper()
        if not sym:
            continue
        avg = _parse_float(pos.get("avg_cost"))
        price = uw.get_current_price(sym, signals)
        if price is None and isinstance(screener, dict) and sym in screener:
            price = _parse_float((screener[sym] or {}).get("prev_close") or (screener[sym] or {}).get("close"))
        pc = get_price_changes(sym)
        pnl_html = "—"
        if avg is not None and avg > 0 and price is not None:
            pnl = (float(price) - avg) / avg * 100.0
            pnl_s = f"{pnl:+.1f}%"
            pnl_html = _pct_cell_html(pnl_s)
        sc = score_map.get(sym)
        act = _portfolio_action_for_ticker(sym, sell_alerts, sc)
        ptsl = calc_pt_sl(float(avg)) if avg is not None and avg > 0 else None
        pt_sl_s = (
            f"PT: {_escape_html(_fmt_money(ptsl['pt']))}<br/>SL: {_escape_html(_fmt_money(ptsl['sl']))}"
            if ptsl
            else "—"
        )
        cc_o, cc_a = _resolve_cc_columns(sym, _parse_float(price), signals)
        portfolio_rows.append(
            {
                "ticker": _escape_html(sym),
                "company": _escape_html(uw.get_company_name(sym).title()),
                "price": _escape_html(_fmt_money(price)),
                "score_or_pnl": pnl_html,
                "w1": _pct_cell_html(pc.get("1w", "N/A")),
                "m1": _pct_cell_html(pc.get("1m", "N/A")),
                "ytd": _pct_cell_html(pc.get("ytd", "N/A")),
                "action_html": _action_pill_html(act),
                "analysis": _escape_html(_portfolio_analysis_cell(sym, act, signals, sell_alerts)).replace(
                    "\n", "<br/>"
                ),
                "cc_opp": cc_o,
                "cc_action": cc_a,
                "pt_sl": pt_sl_s,
                "action": act,
            }
        )

    parts: list[str] = [
        '<div style="font-family:Arial,sans-serif;max-width:900px;margin:auto;">',
        _section_header_html("🟢 RECOMMENDATIONS (Triggered)"),
        _build_data_table_html("triggered", "Score", triggered_rows),
        _section_header_html("👀 WATCHLIST (Near Trigger)"),
        _build_data_table_html("watch", "Score", watch_rows),
        _section_header_html("📋 CURRENT PORTFOLIO"),
        _build_data_table_html("portfolio", "P&L", portfolio_rows),
        "</div>",
    ]

    next_hint = NEXT_SCAN_BLURB.get(scan_type.lower(), "the next scheduled run")
    parts.append(
        f'<p style="margin:16px 0 8px 0;font-size:13px;color:#555;font-family:Arial,sans-serif;">'
        f"<em>Scan complete | {now.strftime('%a %b ') + str(now.day)} {now.strftime('%I:%M %p %Z')} | "
        f"Unusual Whales data</em><br/>"
        f"<em>Next scan: {_escape_html(next_hint)}</em><br/>"
        f'<a href="https://github.com/jmezzadri/trading-scanner/blob/main/portfolio/positions.csv" '
        f'style="color:#1a5276;">Update your portfolio: positions.csv on GitHub</a>'
        f"</p>"
    )
    return "\n".join(parts)


def _strip_inline_html(s: str) -> str:
    t = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    return " ".join(t.split())


def build_plain_text_email(
    buy_opportunities: list[dict[str, Any]],
    watch_items: list[dict[str, Any]],
    sell_alerts: list[dict[str, Any]],
    signals: dict[str, Any],
    portfolio_positions: list[dict[str, Any]],
) -> str:
    """Three sections, tab-separated rows (no color)."""
    score_map: dict[str, int] = signals.get("_score_by_ticker") or {}
    screener = signals.get("screener") or {}

    def row_line(cols: list[str]) -> str:
        return "\t".join(cols)

    hdr_score = [
        "Ticker",
        "Company",
        "Price",
        "Score",
        "1W",
        "1M",
        "YTD",
        "Action",
        "Analysis",
        "CC Opportunity",
        "CC Action",
        "PT / SL",
    ]
    hdr_pnl = [
        "Ticker",
        "Company",
        "Price",
        "P&L",
        "1W",
        "1M",
        "YTD",
        "Action",
        "Analysis",
        "CC Opportunity",
        "CC Action",
        "PT / SL",
    ]

    lines: list[str] = [
        "════════════════════════════════════",
        "§1 RECOMMENDATIONS (Triggered)",
        "════════════════════════════════════",
        row_line(hdr_score),
    ]

    if not buy_opportunities:
        lines.append("(No entries this scan.)")
    for opp in buy_opportunities:
        t = opp["ticker"]
        sym = t.upper()
        price = opp.get("current_price")
        pc = get_price_changes(t)
        ptsl = calc_pt_sl(float(price)) if price is not None and price > 0 else None
        pt_sl = (
            f"PT: {_fmt_money(ptsl['pt'])} / SL: {_fmt_money(ptsl['sl'])}"
            if ptsl
            else "—"
        )
        cc_o, cc_a = _resolve_cc_columns(
            t,
            _parse_float(price),
            signals,
            precomputed_cc=opp.get("covered_call"),
            precomputed_cc_note=opp.get("cc_note"),
        )
        lines.append(
            row_line(
                [
                    sym,
                    uw.get_company_name(t),
                    _fmt_money(_parse_float(price)),
                    str(opp.get("score", "")),
                    pc.get("1w", "N/A"),
                    pc.get("1m", "N/A"),
                    pc.get("ytd", "N/A"),
                    "Buy",
                    _analysis_two_sentences(t, signals),
                    _strip_inline_html(cc_o),
                    _strip_inline_html(cc_a),
                    pt_sl,
                ]
            )
        )

    lines.extend(
        [
            "",
            "════════════════════════════════════",
            "§2 WATCHLIST (Near Trigger)",
            "════════════════════════════════════",
            row_line(hdr_score),
        ]
    )
    if not watch_items:
        lines.append("(No entries this scan.)")
    for w in watch_items:
        t = w["ticker"]
        sym = t.upper()
        price = w.get("current_price")
        pc = get_price_changes(t)
        ptsl = calc_pt_sl(float(price)) if price is not None and price > 0 else None
        pt_sl = (
            f"PT: {_fmt_money(ptsl['pt'])} / SL: {_fmt_money(ptsl['sl'])}"
            if ptsl
            else "—"
        )
        cc_o, cc_a = _resolve_cc_columns(t, _parse_float(price), signals)
        lines.append(
            row_line(
                [
                    sym,
                    uw.get_company_name(t),
                    _fmt_money(_parse_float(price)),
                    str(w.get("score", "")),
                    pc.get("1w", "N/A"),
                    pc.get("1m", "N/A"),
                    pc.get("ytd", "N/A"),
                    "Watch",
                    _analysis_two_sentences(t, signals),
                    _strip_inline_html(cc_o),
                    _strip_inline_html(cc_a),
                    pt_sl,
                ]
            )
        )

    lines.extend(
        [
            "",
            "════════════════════════════════════",
            "§3 CURRENT PORTFOLIO",
            "════════════════════════════════════",
            row_line(hdr_pnl),
        ]
    )
    if not portfolio_positions:
        lines.append("(No entries this scan.)")
    for pos in portfolio_positions:
        sym = (pos.get("ticker") or "").upper()
        if not sym:
            continue
        avg = _parse_float(pos.get("avg_cost"))
        price = uw.get_current_price(sym, signals)
        if price is None and isinstance(screener, dict) and sym in screener:
            price = _parse_float(
                (screener[sym] or {}).get("prev_close") or (screener[sym] or {}).get("close")
            )
        pc = get_price_changes(sym)
        pnl_s = "—"
        if avg is not None and avg > 0 and price is not None:
            pnl = (float(price) - avg) / avg * 100.0
            pnl_s = f"{pnl:+.1f}%"
        sc = score_map.get(sym)
        act = _portfolio_action_for_ticker(sym, sell_alerts, sc)
        ptsl = calc_pt_sl(float(avg)) if avg is not None and avg > 0 else None
        pt_sl = (
            f"PT: {_fmt_money(ptsl['pt'])} / SL: {_fmt_money(ptsl['sl'])}"
            if ptsl
            else "—"
        )
        cc_o, cc_a = _resolve_cc_columns(sym, _parse_float(price), signals)
        lines.append(
            row_line(
                [
                    sym,
                    uw.get_company_name(sym),
                    _fmt_money(_parse_float(price)),
                    pnl_s,
                    pc.get("1w", "N/A"),
                    pc.get("1m", "N/A"),
                    pc.get("ytd", "N/A"),
                    act,
                    _portfolio_analysis_cell(sym, act, signals, sell_alerts),
                    _strip_inline_html(cc_o),
                    _strip_inline_html(cc_a),
                    pt_sl,
                ]
            )
        )

    return "\n".join(lines)


def _watch_cc_note(ticker: str, signals: dict[str, Any]) -> str | None:
    sym = ticker.upper()
    sc = signals.get("screener") or {}
    if not isinstance(sc, dict):
        return None
    row = sc.get(sym) or {}
    try:
        ivr = float(row.get("iv_rank") or 0)
    except (TypeError, ValueError):
        return None
    if ivr <= 0 or ivr >= CC_MIN_IV_RANK:
        return None
    return (
        f"Covered call note: IV Rank is below {CC_MIN_IV_RANK:.0f} — premiums are too cheap right now "
        f"to make selling a covered call worthwhile. Wait for a volatility spike."
    )


def _format_portfolio_alert_block(a: dict[str, Any]) -> list[str]:
    sym = a.get("ticker") or "?"
    headline = a.get("headline") or f"{sym} — {a.get('alert_type', 'alert')}"
    urg = str(a.get("urgency") or "").lower()
    title = f"{headline}  [{urg}]" if urg else headline
    cname = a.get("company") or uw.get_company_name(sym)
    sh = a.get("shares")
    sub = f"{cname} ({sh} shares)" if sh else cname
    detail = a.get("detail") or a.get("message") or ""
    action = (a.get("action") or "").strip()
    lines = [
        title,
        sub,
        "───",
        detail,
        "",
    ]
    if action:
        label = "Note" if a.get("is_informational") else "What to do"
        lines.append(f"{label}: {action}")
    return lines


def _format_buy_block(opp: dict[str, Any], signals: dict[str, Any]) -> list[str]:
    t = opp["ticker"]
    sym = t.upper()
    sc = opp["score"]
    price = opp.get("current_price")
    company = uw.get_company_name(t)
    lines = [
        f"{t} — {company}  [Score: {sc}/100]",
        f"Current price: {_fmt_money(price)}",
        "───",
        "Why it qualifies for Buy:",
    ]
    narr = signal_narrative(t, signals)
    if not narr:
        narr = ["Composite score from available signal data."]
    for b in narr:
        lines.append(f"• {b}")
    cc = opp.get("covered_call")
    if cc:
        bid_ask = ""
        if cc.get("bid") is not None and cc.get("ask") is not None:
            bid_ask = (
                f"  Bid / Ask / Mid: {_fmt_money(float(cc['bid']))} / {_fmt_money(float(cc['ask']))} / "
                f"{_fmt_money(cc.get('mid'))} · Spread {cc.get('spread_pct', '—')}%\n"
            )
        note = (cc.get("liquidity_note") or "").strip()
        lines.extend(
            [
                "",
                "Covered call (income at bid):",
                bid_ask
                + f"  Strike {_fmt_money(float(cc['strike']))} · Exp {cc.get('expiry')} · "
                f"{cc.get('days_to_expiry')} DTE · OTM {cc.get('otm_pct')}% · "
                f"Premium (bid) {_fmt_money(cc.get('premium'))} · Ann. yield {cc.get('annualized_yield')}%",
            ]
        )
        if note:
            lines.append(f"  {note}")
    elif opp.get("cc_note"):
        lines.extend(["", f"Covered call: {opp['cc_note']}"])
    else:
        lines.append("")
        lines.append("Covered call: None meeting strategy thresholds.")
    return lines


def _format_watch_item(
    w: dict[str, Any],
    idx: int,
    signals: dict[str, Any],
) -> list[str]:
    t = w["ticker"]
    sc = w["score"]
    company = uw.get_company_name(t)
    price = w.get("current_price")
    lines = [
        f"{idx}. {t} — {company}  [Score: {sc}/100]",
        f"   Current price: {_fmt_money(price)}",
        "   ───",
        "   Why it's on watch:",
    ]
    narr = signal_narrative(t, signals)
    if not narr:
        narr = [
            "Composite score from available data — see the full report for category breakdown."
        ]
    for b in narr:
        lines.append(f"   • {b}")
    note = _watch_cc_note(t, signals)
    if note:
        lines.extend(["", f"   {note}"])
    return lines


def _escape_html(s: str) -> str:
    return html_module.escape(s, quote=True)


# Inline CSS only (no external stylesheets; no <style> block in documents).
_P = 'style="margin:0.35rem 0;line-height:1.5;"'
_BAR = 'style="color:#444;font-weight:600;letter-spacing:0.02em;margin:0.5rem 0;"'
_H2 = 'style="font-size:1.05rem;margin:1.25rem 0 0.5rem;color:#111;"'
_RULE = 'style="border:none;border-top:1px solid #ccc;margin:1rem 0;height:0;"'
_EM_FOOT = 'style="color:#555;font-size:0.95rem;"'


def _text_to_html_paras(lines: list[str]) -> str:
    """Wrap plain lines in simple HTML; blank line → paragraph break. Inline-styled <p>."""
    chunks: list[str] = []
    buf: list[str] = []
    for line in lines:
        if line == "":
            if buf:
                chunks.append(
                    f"<p {_P}>"
                    + "<br/>\n".join(_escape_html(x) for x in buf)
                    + "</p>"
                )
                buf = []
            continue
        buf.append(line)
    if buf:
        chunks.append(
            f"<p {_P}>"
            + "<br/>\n".join(_escape_html(x) for x in buf)
            + "</p>"
        )
    return "\n".join(chunks)


def _alert_accent_style(a: dict[str, Any]) -> str:
    """Left border color by urgency / informational."""
    if a.get("is_informational"):
        return "border-left:4px solid #7e57c2;background:#fafafa;padding:10px 12px;margin:0.75rem 0;border-radius:0 6px 6px 0;"
    u = str(a.get("urgency") or "").lower()
    if u == "high":
        return "border-left:4px solid #c62828;background:#fff8f8;padding:10px 12px;margin:0.75rem 0;border-radius:0 6px 6px 0;"
    if u == "medium":
        return "border-left:4px solid #ef6c00;background:#fffaf5;padding:10px 12px;margin:0.75rem 0;border-radius:0 6px 6px 0;"
    return "border-left:4px solid #546e7a;background:#f8fafc;padding:10px 12px;margin:0.75rem 0;border-radius:0 6px 6px 0;"


def _tier_box_style(tier: str) -> str:
    if tier == "buy":
        return "border-left:4px solid #2e7d32;background:#f4fff6;padding:12px 14px;margin:0.75rem 0;border-radius:0 8px 8px 0;"
    if tier == "watch":
        return "border-left:4px solid #1565c0;background:#f5f9ff;padding:12px 14px;margin:0.75rem 0;border-radius:0 8px 8px 0;"
    return "padding:12px 14px;margin:0.75rem 0;"


def wrap_html_document(title: str, inner_html: str) -> str:
    """Full HTML5 page; typography on outer wrapper (inline CSS only)."""
    wrap = (
        "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
        "max-width:42rem;margin:0 auto;padding:1rem 1rem 2rem;line-height:1.5;color:#111;"
        "background:#fafafa;min-height:100vh;box-sizing:border-box;"
    )
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '<meta charset="utf-8"/>\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1"/>\n'
        f"<title>{_escape_html(title)}</title>\n"
        "</head>\n"
        f'<body style="margin:0;background:#e8e8e8;">\n'
        f'<div style="{wrap}">\n'
        f"{inner_html}\n"
        "</div>\n"
        "</body>\n"
        "</html>\n"
    )


def build_latest_report_html(
    scan_type: str,
    buy_opportunities: list[dict[str, Any]],
    watch_items: list[dict[str, Any]],
    sell_alerts: list[dict[str, Any]],
    signals: dict[str, Any],
    *,
    date_str: str,
    label: str,
    stocks_scanned: int,
    n_flagged: int,
    n_buy: int,
    n_watch: int,
    portfolio_positions: list[dict[str, Any]],
    portfolio_covered_calls: list[dict[str, Any]],
) -> str:
    """
    Full static page: dashboard header + email-equivalent body + CSV position tables (Phase 2 §5).
    Inline CSS only.
    """
    body = build_scan_report_body_html(
        scan_type,
        buy_opportunities,
        watch_items,
        sell_alerts,
        signals,
        portfolio_positions=portfolio_positions,
    )

    dash = (
        f'<div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px 14px;margin-bottom:1.25rem;">'
        f'<p style="margin:0 0 8px 0;font-size:0.9rem;color:#333;"><strong style="font-weight:700;">Trading Signal Scan</strong> · {_escape_html(label)}</p>'
        f'<p style="margin:0;font-size:0.85rem;color:#555;">{_escape_html(date_str)}</p>'
        f'<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:0.88rem;">'
        f'<tr style="border-bottom:1px solid #eee;">'
        f'<td style="padding:6px 8px 6px 0;color:#666;">Stocks scanned</td><td style="padding:6px 0;text-align:right;font-weight:600;">{stocks_scanned}</td></tr>'
        f'<tr style="border-bottom:1px solid #eee;">'
        f'<td style="padding:6px 8px 6px 0;color:#666;">Signals ≥{SCORE_WATCH_ALERT} (watch + buy)</td>'
        f'<td style="padding:6px 0;text-align:right;font-weight:600;">{n_flagged}</td></tr>'
        f'<tr style="border-bottom:1px solid #eee;">'
        f'<td style="padding:6px 8px 6px 0;color:#666;">Buy tier (≥{SCORE_BUY_ALERT})</td>'
        f'<td style="padding:6px 0;text-align:right;font-weight:600;">{n_buy}</td></tr>'
        f'<tr>'
        f'<td style="padding:6px 8px 6px 0;color:#666;">Watch tier ({SCORE_WATCH_ALERT}–{SCORE_BUY_ALERT - 1})</td>'
        f'<td style="padding:6px 0;text-align:right;font-weight:600;">{n_watch}</td></tr>'
        f"</table></div>"
    )

    pos_rows = ""
    if portfolio_positions:
        for r in portfolio_positions:
            ac = r.get("avg_cost")
            acs = _fmt_money(ac) if ac is not None else "—"
            ed = r.get("entry_date")
            eds = str(ed) if ed else "—"
            pos_rows += (
                "<tr>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;'>{_escape_html(str(r.get('ticker', '')))}</td>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;text-align:right;'>{_escape_html(str(r.get('shares', '')))}</td>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;text-align:right;'>{_escape_html(acs)}</td>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;'>{_escape_html(eds)}</td>"
                f"<td style='padding:8px;border-bottom:1px solid #eee;font-size:0.88rem;'>{_escape_html(str(r.get('notes', '')))}</td>"
                "</tr>"
            )
    else:
        pos_rows = (
            f"<tr><td colspan='5' style='padding:10px;color:#666;'>"
            f"No rows in portfolio/positions.csv (or file missing).</td></tr>"
        )

    pos_section = (
        f'<h2 {_H2}>📋 Current positions (portfolio CSV)</h2>'
        f'<div style="overflow-x:auto;margin-bottom:1rem;">'
        f'<table style="width:100%;border-collapse:collapse;font-size:0.88rem;background:#fff;border:1px solid #ddd;border-radius:8px;">'
        f'<thead><tr style="background:#f0f0f0;">'
        f"<th style='text-align:left;padding:8px;border-bottom:1px solid #ccc;'>Ticker</th>"
        f"<th style='text-align:right;padding:8px;border-bottom:1px solid #ccc;'>Shares</th>"
        f"<th style='text-align:right;padding:8px;border-bottom:1px solid #ccc;'>Avg cost</th>"
        f"<th style='text-align:left;padding:8px;border-bottom:1px solid #ccc;'>Entry</th>"
        f"<th style='text-align:left;padding:8px;border-bottom:1px solid #ccc;'>Notes</th>"
        f"</tr></thead><tbody>{pos_rows}</tbody></table></div>"
    )

    cc_lines = ""
    if portfolio_covered_calls:
        for c in portfolio_covered_calls:
            try:
                stf = float(c.get("strike") or 0)
            except (TypeError, ValueError):
                stf = 0.0
            cc_lines += (
                f'<p {_P} style="margin:0.35rem 0 0.35rem 1rem;">'
                f"{_escape_html(str(c.get('ticker')))} "
                f"{_escape_html(str(c.get('contracts')))}× "
                f"${stf:.2f} exp {_escape_html(str(c.get('expiry')))} "
                f"(prem received {_fmt_money(c.get('premium_received'))}/sh)"
                f"</p>"
            )
        cc_section = (
            f'<h2 {_H2}>📋 Open covered calls (portfolio CSV)</h2>'
            f'<div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 12px;">{cc_lines}</div>'
        )
    else:
        cc_section = ""

    footer = (
        f'<p style="margin-top:1.5rem;font-size:0.82rem;color:#888;border-top:1px solid #ddd;padding-top:12px;">'
        f"Generated by Trading Signal Scanner · Unusual Whales API · {_escape_html(date_str)}"
        f"</p>"
    )

    inner = dash + body + pos_section + cc_section + footer
    return wrap_html_document("Trading Signal Scan", inner)


def _fmt_pct(x: float | None) -> str:
    if x is None:
        return "—"
    return f"{x:.1f}%"


def _signal_bullets(ticker: str, signals: dict[str, Any]) -> list[str]:
    sym = ticker.upper()
    lines: list[str] = []

    cb = [r for r in (signals.get("congress_buys") or []) if (r.get("ticker") or "").upper() == sym]
    if cb:
        parts = []
        for r in cb[:5]:
            parts.append(
                f"{r.get('name', 'Member')} ({r.get('amounts', '')}) on {r.get('transaction_date', '')}"
            )
        extra = f" (+{len(cb) - 5} more)" if len(cb) > 5 else ""
        lines.append(
            f"✅ {len(cb)} congressional buy(s) in lookback window: {', '.join(parts)}{extra}"
        )

    ins = [r for r in (signals.get("insider_buys") or []) if (r.get("ticker") or "").upper() == sym]
    if ins:
        for r in ins[:3]:
            role = "officer" if r.get("is_officer") else "insider"
            amt = r.get("amount")
            try:
                amt_s = f"${float(amt):,.0f}" if amt is not None else ""
            except (TypeError, ValueError):
                amt_s = str(amt)
            lines.append(
                f"✅ Insider buy ({role}): {r.get('owner_name', 'Unknown')} — {amt_s} on {r.get('transaction_date', '')}"
            )
        if len(ins) > 3:
            lines.append(f"✅ … +{len(ins) - 3} additional insider purchase(s)")

    fl = [r for r in (signals.get("flow_alerts") or []) if (r.get("ticker") or "").upper() == sym]
    if fl:
        sweeps = sum(1 for r in fl if r.get("has_sweep"))
        ex = fl[0]
        lines.append(
            f"✅ Unusual call flow: {len(fl)} alert(s), {sweeps} sweep(s); "
            f"example {ex.get('expiry', '')} ${ex.get('strike', '')} strike, "
            f"${float(ex.get('total_premium') or 0):,.0f} premium"
        )

    dp = [r for r in (signals.get("darkpool") or []) if (r.get("ticker") or "").upper() == sym]
    if dp:
        tot = sum(float(r.get("premium") or 0) for r in dp)
        lines.append(
            f"✅ Dark pool: {len(dp)} large print(s), ~{_fmt_money(tot)} total premium"
        )

    sc = (signals.get("screener") or {}).get(sym) if isinstance(signals.get("screener"), dict) else None
    if sc:
        try:
            rv = float(sc.get("relative_volume") or 0)
        except (TypeError, ValueError):
            rv = 0.0
        if rv >= 2.0:
            lines.append(f"✅ Volume: relative volume {rv:.2f}x vs 30-day average")

    if not lines:
        lines.append("— No detailed signal rows matched (score driven by overlapping data).")

    return lines


def watch_one_line_summary(ticker: str, score: int, signals: dict[str, Any]) -> str:
    """Single-line summary for Watch tier (35–59); no covered-call math."""
    sym = ticker.upper()
    bits: list[str] = []

    cb = [r for r in (signals.get("congress_buys") or []) if (r.get("ticker") or "").upper() == sym]
    if cb:
        bits.append(f"{len(cb)} congressional disclosure(s)")

    ib = [t for t in (signals.get("insider_buys") or []) if (t.get("ticker") or "").upper() == sym]
    q = qualifying_insider_rows(ib)
    if q:
        tot = sum(get_insider_dollar_value(r) for r in q)
        bits.append(f"~${tot:,.0f} qualifying insider notional")

    fl = [r for r in (signals.get("flow_alerts") or []) if (r.get("ticker") or "").upper() == sym]
    if fl:
        sw = any(r.get("has_sweep") for r in fl)
        bits.append(
            "unusual call flow" + (" with sweep(s)" if sw else f" ({len(fl)} alert(s))")
        )

    dp = [r for r in (signals.get("darkpool") or []) if (r.get("ticker") or "").upper() == sym]
    if dp:
        bits.append("dark pool activity")

    sc = (signals.get("screener") or {}).get(sym) if isinstance(signals.get("screener"), dict) else None
    if sc:
        try:
            rv = float(sc.get("relative_volume") or 0)
        except (TypeError, ValueError):
            rv = 0.0
        if rv >= 2.0:
            bits.append(f"elevated volume ({rv:.1f}× rel. vol.)")

    if not bits:
        bits.append("composite signals (see full scan)")
    return f"{ticker} — {score}pts: " + "; ".join(bits)


def _max_profit_per_share(strike: float, stock: float, premium: float) -> tuple[float, float]:
    """Covered call: max profit if assigned = (strike - stock) + premium; return (dollars, pct of stock)."""
    cap = (strike - stock) + premium
    pct = (cap / stock * 100) if stock else 0.0
    return cap, pct


def generate_report(
    scan_type: str,
    buy_opportunities: list[dict[str, Any]],
    watch_items: list[dict[str, Any]],
    positions: list,
    cash: float,
    open_calls: list,
    signals: dict[str, Any],
    *,
    portfolio_positions: list[dict[str, Any]] | None = None,
    portfolio_covered_calls: list[dict[str, Any]] | None = None,
    sell_alerts: list[dict[str, Any]] | None = None,
) -> Path:
    """
    Writes reports/scan_YYYYMMDD_HHMMSS.md, .csv, and reports/latest_report.html.
    Buy tier (≥ SCORE_BUY_ALERT): full write-up + covered call when available.
    Watch tier (SCORE_WATCH_ALERT .. SCORE_BUY_ALERT-1): one-line summary only.
    Returns path to the markdown file.
    """
    portfolio_positions = portfolio_positions or []
    portfolio_covered_calls = portfolio_covered_calls or []
    sell_alerts = sell_alerts or []
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    ts = now.strftime("%Y%m%d_%H%M%S")
    label = SCAN_LABELS.get(scan_type, scan_type)
    date_str = now.strftime("%Y-%m-%d %I:%M %p %Z")

    md_path = REPORTS_DIR / f"scan_{ts}.md"
    csv_path = REPORTS_DIR / f"scan_{ts}.csv"

    stocks_scanned = signals.get("_stocks_scanned_count")
    if stocks_scanned is None:
        stocks_scanned = len(signals.get("_filtered_tickers") or [])

    n_buy = len(buy_opportunities)
    n_watch = len(watch_items)
    n_flagged = n_buy + n_watch

    actionable = [a for a in sell_alerts if not a.get("is_informational")]
    informational = [a for a in sell_alerts if a.get("is_informational")]
    high_alerts = [a for a in actionable if a.get("urgency") == "high"]
    other_alerts = [
        a for a in actionable if a.get("urgency") in ("medium", "low")
    ]

    lines: list[str] = [
        "# Trading Signal Scan Report",
        f"**Date:** {date_str}  ",
        f"**Scan type:** {label}  ",
        f"**Stocks scanned:** {stocks_scanned}  ",
        f"**Signals ≥{SCORE_WATCH_ALERT} (watch + buy):** {n_flagged}  ",
        f"**Buy tier (≥{SCORE_BUY_ALERT}):** {n_buy}  ",
        f"**Watch tier ({SCORE_WATCH_ALERT}–{SCORE_BUY_ALERT - 1}):** {n_watch}  ",
        "",
        "---",
        "",
        "## 🚨 Portfolio alerts (high urgency)",
        "",
    ]
    if high_alerts:
        for a in high_alerts:
            lines.append(
                f"- **{a.get('ticker', '?')}** — `{a.get('alert_type', '')}`: "
                f"{a.get('headline', a.get('message', ''))}"
            )
    else:
        lines.append("*None.*")
    lines.append("")
    lines.append("## ⚠️ Portfolio alerts (medium / low)")
    lines.append("")
    if other_alerts:
        for a in other_alerts:
            lines.append(
                f"- **{a.get('ticker', '?')}** — `{a.get('alert_type', '')}` ({a.get('urgency')}): "
                f"{a.get('headline', a.get('message', ''))}"
            )
    else:
        lines.append("*None.*")
    lines.append("")
    lines.append("## 📈 Portfolio notes (informational only)")
    lines.append("")
    if informational:
        for a in informational:
            lines.append(
                f"- **{a.get('ticker', '?')}** — `{a.get('alert_type', '')}`: "
                f"{a.get('headline', a.get('message', ''))}"
            )
    else:
        lines.append("*None.*")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.extend(
        [
        "## 🟢 BUY OPPORTUNITIES",
        f"*(Score ≥ {SCORE_BUY_ALERT} — full write-up with covered call analysis)*",
        "",
        ]
    )

    if not buy_opportunities:
        lines.append(f"*No buy-tier signals (score ≥ {SCORE_BUY_ALERT}) on this run.*")
        lines.append("")

    for i, opp in enumerate(buy_opportunities, start=1):
        t = opp["ticker"]
        sc = opp["score"]
        cc = opp.get("covered_call")
        price = opp.get("current_price")

        lines.append(f"### {i}. {t} — Signal Score: {sc}/100")
        lines.append("")
        lines.append(f"**Current Price:** {_fmt_money(price)}  ")
        lines.append("**Signals detected:**")
        for b in _signal_bullets(t, signals):
            lines.append(f"- {b}")
        lines.append("")

        if cc:
            lines.append("**Covered Call Opportunity:**")
            if cc.get("bid") is not None and cc.get("ask") is not None:
                lines.append(
                    f"**Quote (per share):** bid {_fmt_money(float(cc['bid']))} · ask {_fmt_money(float(cc['ask']))} · "
                    f"mid {_fmt_money(float(cc.get('mid') or 0))} — spread {cc.get('spread_pct')}% of mid. "
                    "Income uses **bid** (conservative)."
                )
            lines.append(
                "| Strike | Expiry | Days | OTM% | Premium (bid) | Ann. Yield |"
            )
            lines.append("|--------|--------|------|------|---------|------------|")
            lines.append(
                f"| {_fmt_money(cc['strike'])} | {cc['expiry']} | {cc['days_to_expiry']} | "
                f"{cc['otm_pct']}% | {_fmt_money(cc.get('premium'))} | {cc['annualized_yield']}% |"
            )
            lines.append("")
            cap, pct = _max_profit_per_share(
                float(cc["strike"]), float(cc["current_price"]), float(cc["premium"])
            )
            net_cap = float(cc["current_price"]) * 100 - float(cc["premium"]) * 100
            lines.append(
                f"**Recommended action:** Buy 100 shares at ~{_fmt_money(price)}, "
                f"sell 1x {cc['expiry']} {_fmt_money(cc['strike'])} call at {_fmt_money(cc['premium'])}  "
            )
            lines.append(
                f"**Max profit:** {_fmt_money(cap)}/share ({pct:.1f}%) if stock closes above "
                f"{_fmt_money(cc['strike'])} at expiry  "
            )
            lines.append(
                f"**Capital required:** ~{_fmt_money(float(cc['current_price']) * 100)} "
                f"minus {_fmt_money(float(cc['premium']) * 100)} call premium "
                f"= ~{_fmt_money(net_cap)} net  "
            )
        elif opp.get("cc_note"):
            lines.append(f"**Covered call:** {opp['cc_note']}")
            lines.append("")
        else:
            lines.append("**Covered Call Opportunity:** None meeting strategy thresholds (delta, IV rank, DTE, yield, spread).")
            lines.append("")

        lines.append("---")
        lines.append("")

    lines.append(f"## 👀 ON WATCH")
    lines.append(
        f"*(Score {SCORE_WATCH_ALERT}–{SCORE_BUY_ALERT - 1} — one-line summary; no covered call math)*"
    )
    lines.append("")

    if not watch_items:
        lines.append(
            f"*No watch-tier signals ({SCORE_WATCH_ALERT}–{SCORE_BUY_ALERT - 1}) on this run.*"
        )
        lines.append("")
    else:
        for w in watch_items:
            t = w["ticker"]
            sc = w["score"]
            lines.append(f"- {watch_one_line_summary(t, sc, signals)}")
        lines.append("")

    if n_flagged == 0:
        lines.append(
            f"*No signals above watch threshold ({SCORE_WATCH_ALERT}) today — nothing to flag for monitoring or buy-tier review.*"
        )
        lines.append("")

    lines.append("## 📋 Current positions (portfolio CSV)")
    lines.append("")
    if portfolio_positions:
        lines.append("| Ticker | Shares | Avg cost | Entry | Notes |")
        lines.append("|--------|--------|----------|-------|-------|")
        for r in portfolio_positions:
            ac = r.get("avg_cost")
            acs = _fmt_money(ac) if ac is not None else "—"
            ed = r.get("entry_date")
            eds = str(ed) if ed else "—"
            lines.append(
                f"| {r.get('ticker', '')} | {r.get('shares', '')} | {acs} | {eds} | {r.get('notes', '')} |"
            )
        lines.append("")
    else:
        lines.append("*No rows in portfolio/positions.csv (or file missing).*")
        lines.append("")

    if portfolio_covered_calls:
        lines.append("**Open covered calls (CSV):**")
        for c in portfolio_covered_calls:
            lines.append(
                f"- {c.get('ticker')} {c.get('contracts')}x ${c.get('strike')} exp {c.get('expiry')} "
                f"(prem received {_fmt_money(c.get('premium_received'))}/sh)"
            )
        lines.append("")

    lines.append("## 📋 Schwab / API portfolio (future)")
    if positions or (cash and cash > 0):
        lines.append(f"- **Cash (available):** {_fmt_money(cash)}")
        lines.append(f"- **Positions:** {len(positions)} open stock position(s) reported.")
    else:
        lines.append("*(Available when Schwab API connected)*")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## ⚠️ POSITIONS NEEDING ATTENTION")
    if open_calls:
        lines.append(f"- {len(open_calls)} open option leg(s) reported.")
    else:
        lines.append("*(Available when Schwab API connected)*")
    lines.append("")
    lines.append("---")
    lines.append("*Generated by Trading Signal Scanner | Unusual Whales API*")
    lines.append("")

    md_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("Wrote %s", md_path)

    cols = [
        "tier",
        "ticker",
        "score",
        "current_price",
        "cc_strike",
        "cc_expiry",
        "cc_days",
        "cc_otm_pct",
        "cc_premium",
        "cc_ann_yield_pct",
    ]
    rows = []
    for opp in buy_opportunities:
        cc = opp.get("covered_call") or {}
        rows.append(
            {
                "tier": "buy",
                "ticker": opp["ticker"],
                "score": opp["score"],
                "current_price": opp.get("current_price"),
                "cc_strike": cc.get("strike"),
                "cc_expiry": cc.get("expiry"),
                "cc_days": cc.get("days_to_expiry"),
                "cc_otm_pct": cc.get("otm_pct"),
                "cc_premium": cc.get("premium"),
                "cc_ann_yield_pct": cc.get("annualized_yield"),
            }
        )
    for w in watch_items:
        rows.append(
            {
                "tier": "watch",
                "ticker": w["ticker"],
                "score": w["score"],
                "current_price": w.get("current_price"),
                "cc_strike": None,
                "cc_expiry": None,
                "cc_days": None,
                "cc_otm_pct": None,
                "cc_premium": None,
                "cc_ann_yield_pct": None,
            }
        )
    df = pd.DataFrame(rows, columns=cols)
    df.to_csv(csv_path, index=False)
    logger.info("Wrote %s", csv_path)

    latest = REPORTS_DIR / "latest_report.html"
    latest.write_text(
        build_latest_report_html(
            scan_type,
            buy_opportunities,
            watch_items,
            sell_alerts,
            signals,
            date_str=date_str,
            label=label,
            stocks_scanned=int(stocks_scanned),
            n_flagged=n_flagged,
            n_buy=n_buy,
            n_watch=n_watch,
            portfolio_positions=portfolio_positions,
            portfolio_covered_calls=portfolio_covered_calls,
        ),
        encoding="utf-8",
    )
    logger.info("Wrote %s", latest)

    return md_path


def build_email_content(
    scan_type: str,
    buy_opportunities: list[dict[str, Any]],
    watch_items: list[dict[str, Any]],
    sell_alerts: list[dict[str, Any]],
    signals: dict[str, Any],
    *,
    portfolio_positions: list[dict[str, Any]] | None = None,
) -> tuple[str, str, str]:
    """Subject, HTML body, plain text for notifier. HTML = three table sections per spec."""
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    portfolio_positions = portfolio_positions or []
    date_str = _email_day_parenthetical()
    st = scan_type.lower()
    label = SCAN_LABELS.get(st, scan_type)
    sub = build_subject(
        buy_opportunities,
        watch_items,
        sell_alerts,
        scan_type,
        date_str,
    )

    text = build_plain_text_email(
        buy_opportunities,
        watch_items,
        sell_alerts,
        signals,
        portfolio_positions,
    )
    next_hint = NEXT_SCAN_BLURB.get(st, "the next scheduled run")
    text = (
        text
        + "\n\n"
        + f"Scan complete | {now.strftime('%Y-%m-%d %I:%M %p %Z')} | Unusual Whales data\n"
        + f"Next scan: {next_hint}\n"
        + "Update portfolio: https://github.com/jmezzadri/trading-scanner/blob/main/portfolio/positions.csv\n"
    )

    body_html = build_scan_report_body_html(
        scan_type,
        buy_opportunities,
        watch_items,
        sell_alerts,
        signals,
        portfolio_positions=portfolio_positions,
    )
    html_body = wrap_html_document(f"{label} — Trading Scanner", body_html)

    return sub[:900], html_body, text
