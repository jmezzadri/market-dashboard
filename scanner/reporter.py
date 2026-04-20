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
from scanner.signal_composite import (
    SCORE_BUY_ALERT_COMPOSITE,
    SCORE_WATCH_ALERT_COMPOSITE,
)
from scanner import unusual_whales as uw
from scanner.covered_calls import earnings_within_window, find_optimal_covered_call
from scanner.price_history import get_price_changes
from scanner.scorer import (
    get_insider_dollar_value,
    qualifying_insider_rows,
    signal_indicators,
    signal_narrative,
)
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
    """Email subject — daily consolidated macro + scanner summary."""
    parts: list[str] = []
    if buy_opps:
        tickers = ", ".join(o["ticker"] for o in buy_opps[:3])
        parts.append(f"{len(buy_opps)} Buy: {tickers}")
    if watch_opps:
        parts.append(f"{len(watch_opps)} Watch")
    high_alerts = [
        a
        for a in sell_alerts
        if a.get("urgency") == "high" and not a.get("is_informational")
    ]
    if high_alerts:
        tickers = ", ".join(a["ticker"] for a in high_alerts[:2])
        parts.append(f"Action: {tickers}")
    if not parts:
        parts = ["No alerts"]
    return f"Macro Dashboard & Trading Opportunity Scanner | {' | '.join(parts)} — {date_str}"


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
        return ""
    # Join all bullets — card layout uses a full-width row so no truncation needed
    text = " ".join(bullets).strip()
    if text == "Composite score from available signal data.":
        return ""
    return text


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


def _fmt_expiry_date(expiry_str: str | None) -> str:
    """Format '2026-04-17' → 'Apr 17' (cross-platform day, no leading zero)."""
    if not expiry_str:
        return ""
    try:
        dt = datetime.strptime(str(expiry_str).strip()[:10], "%Y-%m-%d")
        return f"{dt.strftime('%b')} {dt.day}"
    except ValueError:
        return str(expiry_str).strip()[:10]


def _pt_sl_compact_html(ptsl: dict[str, float] | None) -> str:
    if not ptsl:
        return "—"
    line = f"PT {_fmt_money(ptsl['pt'])} · SL {_fmt_money(ptsl['sl'])}"
    return _escape_html(line)


def _score_badge_html(score: Any) -> str:
    try:
        s = int(score)
    except (ValueError, TypeError):
        return _escape_html(str(score))
    if s >= 60:
        color = "#27ae60"
    elif s >= 35:
        color = "#2980b9"
    else:
        color = "#95a5a6"
    return (
        f'<span style="background:{color};color:#fff;padding:2px 8px;'
        f'border-radius:10px;font-size:11px;font-weight:600;">{s}</span>'
    )


def _composite_badge_html(composite: Any) -> str:
    """
    Bidirectional composite badge (−100..+100). Colored by tier band to match
    sectionComposites.js labelFromScore: STRONG BULL / BULLISH / TILT BULL /
    NEUTRAL / TILT BEAR / BEARISH / STRONG BEAR.
    """
    try:
        s = int(composite)
    except (ValueError, TypeError):
        return _escape_html(str(composite))
    if s >= 60:
        color, label = "#27ae60", "STRONG BULL"
    elif s >= 30:
        color, label = "#2980b9", "BULLISH"
    elif s >= 10:
        color, label = "#7fb0d5", "TILT BULL"
    elif s <= -60:
        color, label = "#c0392b", "STRONG BEAR"
    elif s <= -30:
        color, label = "#e67e22", "BEARISH"
    elif s <= -10:
        color, label = "#f1a86a", "TILT BEAR"
    else:
        color, label = "#95a5a6", "NEUTRAL"
    sign = "+" if s > 0 else ""
    return (
        f'<span style="background:{color};color:#fff;padding:2px 8px;'
        f'border-radius:10px;font-size:11px;font-weight:600;" title="{label}">'
        f'{sign}{s}</span>'
    )


def _pct_color_card(pct_str: str) -> str:
    if not pct_str or pct_str == "N/A":
        return "#888"
    try:
        v = float(pct_str.replace("%", "").replace("+", ""))
    except ValueError:
        return "#888"
    if v > 0:
        return "#27ae60"
    if v < 0:
        return "#e74c3c"
    return "#888"


def _perf_row_spans(w1: str, m1: str, ytd: str) -> str:
    parts: list[str] = []
    for lab, val in (("1W", w1), ("1M", m1), ("YTD", ytd)):
        c = _pct_color_card(val)
        parts.append(
            f'<span style="margin-right:16px;">{lab} <strong style="color:{c};">'
            f"{_escape_html(val)}</strong></span>"
        )
    return "".join(parts)


def _card_left_border_hex(section: str, action: str) -> str:
    if section == "portfolio":
        a = (action or "").strip()
        if a == "Sell":
            return "#e74c3c"
        if a == "Add":
            return "#8e44ad"
        return "#7f8c8d"
    if section == "triggered":
        return "#27ae60"
    if section == "watch":
        return "#2980b9"
    return "#7f8c8d"


def _pt_sl_row_triggered_watch(ptsl: dict[str, float] | None) -> str:
    if not ptsl:
        return ""
    return (
        f'<strong>PT</strong> {_escape_html(_fmt_money(ptsl["pt"]))} &nbsp;·&nbsp; '
        f'<strong>SL</strong> {_escape_html(_fmt_money(ptsl["sl"]))}'
    )


def _pt_sl_row_portfolio(avg: float | None, ptsl: dict[str, float] | None) -> str:
    chunks: list[str] = []
    if avg is not None and avg > 0:
        chunks.append(f'<strong>Avg cost</strong> {_escape_html(_fmt_money(avg))}')
    if ptsl:
        chunks.append(
            f'<strong>PT</strong> {_escape_html(_fmt_money(ptsl["pt"]))} &nbsp;·&nbsp; '
            f'<strong>SL</strong> {_escape_html(_fmt_money(ptsl["sl"]))}'
        )
    return " &nbsp;·&nbsp; ".join(chunks)


def _cc_row_suffix_html(cc_plain: str) -> str:
    esc = _escape_html(cc_plain)
    if cc_plain.startswith("⚠️") or (
        "Earnings" in cc_plain and "wait" in cc_plain.lower()
    ):
        return f'<span style="color:#e67e22;font-weight:bold;">CC: {esc}</span>'
    if cc_plain.startswith("Sell ") and " | " in cc_plain:
        return f'<span style="color:#444;">CC: {esc}</span>'
    return f'<span style="color:#999;">CC: {esc}</span>'


_DIRECTION_STYLE: dict[str, tuple[str, str]] = {
    "bullish": ("#27ae60", "Bullish"),
    "bearish": ("#e74c3c", "Bearish"),
    "mixed": ("#e67e22", "Mixed"),
    "neutral": ("#95a5a6", "Neutral"),
}


def _signal_indicator_table_html(indicators: dict[str, Any]) -> str:
    """4-column signal indicator table for the card analysis row."""
    cols = [
        ("Congress", indicators.get("congress") or {}),
        ("Insider", indicators.get("insider") or {}),
        ("Options Flow", indicators.get("options") or {}),
        ("Technical", indicators.get("technical") or {}),
    ]
    cells: list[str] = []
    for i, (label, ind) in enumerate(cols):
        direction = ind.get("direction") or "neutral"
        conviction = ind.get("conviction") or ""
        color, dir_label = _DIRECTION_STYLE.get(direction, ("#95a5a6", "Neutral"))
        detail_lines = ind.get("detail") or []
        detail_html = "<br/>".join(_escape_html(d) for d in detail_lines)
        border = "" if i == len(cols) - 1 else "border-right:1px solid #eee;"
        conviction_html = ""
        if conviction:
            conviction_html = (
                f'<div style="font-size:10px;color:#888;margin-bottom:3px;">'
                f"{_escape_html(conviction)}</div>"
            )
        cells.append(
            f'<td style="padding:7px 10px;width:25%;vertical-align:top;{border}">'
            f'<div style="font-size:10px;font-weight:700;color:#888;'
            f'text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">'
            f"{_escape_html(label)}</div>"
            f'<div style="margin-bottom:2px;">'
            f'<span style="color:{color};font-size:12px;">&#9679;</span>'
            f'<span style="font-size:11px;font-weight:700;color:#333;margin-left:4px;">'
            f"{dir_label}</span>"
            f"</div>"
            f"{conviction_html}"
            f'<div style="font-size:11px;color:#555;line-height:1.5;">{detail_html}</div>'
            f"</td>"
        )
    return (
        '<table style="border-collapse:collapse;width:100%;'
        'border-top:1px solid #eee;background:#fafafa;">'
        f'<tr>{"".join(cells)}</tr>'
        "</table>"
    )


def _stock_card_html(row: dict[str, Any], section: str, signals: dict[str, Any]) -> str:
    """One stock card for Triggered / Watchlist (score badge, no P&L row)."""
    left = _card_left_border_hex(section, row.get("action") or "")
    tbl = (
        f'border-collapse:collapse;width:100%;margin-bottom:10px;'
        f'border:1px solid #ddd;border-left:4px solid {left};'
    )
    tw = row.get("pc_1w", "N/A")
    tm = row.get("pc_1m", "N/A")
    ty = row.get("pc_ytd", "N/A")
    perf = _perf_row_spans(str(tw), str(tm), str(ty))
    cc_bit = _cc_row_suffix_html(row.get("cc_plain") or "")
    raw_t = str(row.get("ticker_raw") or "").strip()
    indicators = signal_indicators(raw_t, signals)
    indicator_html = _signal_indicator_table_html(indicators)
    analysis_row = f'<tr><td colspan="2" style="padding:0;">{indicator_html}</td></tr>'

    row1_right = (
        f'<strong style="font-size:14px;">{row["price"]}</strong>&nbsp;{row.get("score_badge_html") or ""}'
    )
    pt_block = _pt_sl_row_triggered_watch(row.get("ptsl"))

    row3_inner = pt_block
    if pt_block and cc_bit:
        row3_inner = f"{pt_block}&nbsp;&nbsp;|&nbsp;&nbsp;{cc_bit}"
    elif not pt_block and cc_bit:
        row3_inner = cc_bit
    elif pt_block and not cc_bit:
        row3_inner = pt_block

    return (
        f'<table style="{tbl}">'
        f'<tr style="background:#f0f3f6;">'
        f'<td style="padding:10px 14px;width:65%;">'
        f'<strong style="font-size:14px;letter-spacing:0.3px;">{row["ticker"]}</strong>'
        f'<span style="color:#555;font-size:12px;margin-left:8px;">{row["company"]}</span>'
        f"</td>"
        f'<td style="padding:10px 14px;text-align:right;width:35%;white-space:nowrap;">{row1_right}</td>'
        f"</tr>"
        f'<tr style="background:#fff;">'
        f'<td colspan="2" style="padding:6px 14px;font-size:12px;border-top:1px solid #eee;">{perf}</td>'
        f"</tr>"
        f'<tr style="background:#fff;">'
        f'<td colspan="2" style="padding:4px 14px 8px 14px;font-size:12px;'
        f'border-top:1px solid #eee;color:#444;">{row3_inner}</td>'
        f"</tr>"
        f"{analysis_row}"
        f"</table>"
    )


def _stock_card_html_portfolio(row: dict[str, Any], signals: dict[str, Any]) -> str:
    """Portfolio card: Row 1 uses 60/40 and P&L + action badge; Row 3 includes avg cost."""
    left = _card_left_border_hex("portfolio", row.get("action") or "")
    tbl = (
        f'border-collapse:collapse;width:100%;margin-bottom:10px;'
        f'border:1px solid #ddd;border-left:4px solid {left};'
    )
    tw, tm, ty = row.get("pc_1w", "N/A"), row.get("pc_1m", "N/A"), row.get("pc_ytd", "N/A")
    perf = _perf_row_spans(str(tw), str(tm), str(ty))
    cc_bit = _cc_row_suffix_html(row.get("cc_plain") or "")
    raw_t = str(row.get("ticker_raw") or "").strip()
    indicators = signal_indicators(raw_t, signals)
    indicator_html = _signal_indicator_table_html(indicators)
    analysis_row = f'<tr><td colspan="2" style="padding:0;">{indicator_html}</td></tr>'
    pnl_raw = row.get("pnl_raw") or "—"
    pnl_c = _pct_color_card(pnl_raw) if pnl_raw != "—" else "#888"
    row1_right = (
        f'<strong style="font-size:14px;">{row["price"]}</strong>&nbsp;'
        f'<span style="color:{pnl_c};font-size:12px;font-weight:600;">{_escape_html(pnl_raw)}</span>&nbsp;'
        f'{row.get("action_badge_html") or ""}'
    )
    pt_block = _pt_sl_row_portfolio(row.get("avg_cost"), row.get("ptsl"))
    if pt_block and cc_bit:
        row3_inner = f"{pt_block}&nbsp;&nbsp;|&nbsp;&nbsp;{cc_bit}"
    elif not pt_block and cc_bit:
        row3_inner = cc_bit
    else:
        row3_inner = pt_block or cc_bit
    return (
        f'<table style="{tbl}">'
        f'<tr style="background:#f0f3f6;">'
        f'<td style="padding:10px 14px;width:60%;">'
        f'<strong style="font-size:14px;">{row["ticker"]}</strong>'
        f'<span style="color:#555;font-size:12px;margin-left:8px;">{row["company"]}</span>'
        f"</td>"
        f'<td style="padding:10px 14px;text-align:right;width:40%;white-space:nowrap;">{row1_right}</td>'
        f"</tr>"
        f'<tr style="background:#fff;">'
        f'<td colspan="2" style="padding:6px 14px;font-size:12px;border-top:1px solid #eee;">{perf}</td>'
        f"</tr>"
        f'<tr style="background:#fff;">'
        f'<td colspan="2" style="padding:4px 14px 8px 14px;font-size:12px;'
        f'border-top:1px solid #eee;color:#444;">{row3_inner}</td>'
        f"</tr>"
        f"{analysis_row}"
        f"</table>"
    )


def _build_section_html(
    full_title: str,
    section: str,
    rows: list[dict[str, Any]],
    signals: dict[str, Any],
) -> str:
    """Section header table + stock cards or empty state."""
    header = (
        '<table style="border-collapse:collapse;width:100%;margin-bottom:6px;">'
        "<tr>"
        '<td style="background:#1a5276;color:#fff;padding:10px 14px;'
        'font-size:13px;font-weight:bold;border-radius:4px 4px 0 0;">'
        f"{_escape_html(full_title)}</td>"
        "</tr></table>"
    )
    if not rows:
        return (
            header
            + '<table style="border-collapse:collapse;width:100%;margin-bottom:20px;">'
            + '<tr><td style="padding:12px 14px;font-size:12px;color:#888;font-style:italic;'
            + 'border:1px solid #ddd;border-top:none;">No entries this scan.</td></tr></table>'
        )
    cards: list[str] = []
    for r in rows:
        if section == "portfolio":
            cards.append(_stock_card_html_portfolio(r, signals))
        else:
            cards.append(_stock_card_html(r, section, signals))
    return header + "".join(cards) + '<div style="margin-bottom:24px;"></div>'


def _diagnose_cc_failure(chain: list[dict[str, Any]], price: float) -> str:
    """
    Scan the options chain and return a human-readable reason why no contract
    passed the covered call filters. Gives the user specific, actionable info
    instead of the opaque 'No liquid strikes'.
    """
    import math
    from config import CC_MIN_ANNUALIZED_YIELD, CC_OTM_IV_MULTIPLIER, CC_MIN_EXPIRY_DAYS, CC_MAX_EXPIRY_DAYS
    from scanner.covered_calls import _iv_decimal, parse_option_symbol

    if not chain or price <= 0:
        return "No options data"

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    min_exp = today + timedelta(days=CC_MIN_EXPIRY_DAYS)
    max_exp = today + timedelta(days=CC_MAX_EXPIRY_DAYS)

    in_dte, has_bid, best_yield, spread_kills, otm_kills = 0, 0, 0.0, 0, 0

    for contract in chain:
        opt_sym = str(contract.get("option_symbol") or "")
        parsed = parse_option_symbol(opt_sym) if opt_sym else None
        if parsed:
            exp = parsed["expiry"]
            strike = float(parsed["strike"])
        else:
            try:
                strike = float(contract.get("strike") or 0)
            except (TypeError, ValueError):
                continue
            exp_s = str(contract.get("expiry") or "")[:10]
            try:
                exp = datetime.strptime(exp_s, "%Y-%m-%d")
            except ValueError:
                continue

        if not (min_exp <= exp <= max_exp):
            continue
        in_dte += 1

        bid = float(contract.get("nbbo_bid") or 0)
        ask = float(contract.get("nbbo_ask") or contract.get("ask") or 0)
        if bid <= 0:
            continue
        has_bid += 1

        if ask > 0:
            mid = (bid + ask) / 2
            spread_frac = (ask - bid) / mid if mid > 0 else 1.0
            if spread_frac > 0.10:
                spread_kills += 1
                continue

        iv_raw = contract.get("implied_volatility") or contract.get("iv")
        try:
            iv = float(iv_raw or 0)
        except (TypeError, ValueError):
            iv = 0.0
        if iv > 1.25:
            iv /= 100.0
        if iv <= 0:
            continue

        dte = max((exp - today).days, 1)
        min_otm = CC_OTM_IV_MULTIPLIER * iv * math.sqrt(dte / 365.0)
        otm_frac = (strike - price) / price
        if otm_frac < min_otm:
            otm_kills += 1
            continue

        ann_yield = (bid / price) * (365 / dte)
        best_yield = max(best_yield, ann_yield)

    if in_dte == 0:
        return f"No contracts in {CC_MIN_EXPIRY_DAYS}–{CC_MAX_EXPIRY_DAYS} DTE window"
    if has_bid == 0:
        return "All bids $0 — market closed or after-hours"
    if spread_kills > 0 and has_bid - spread_kills == 0:
        return f"Spreads too wide (>{int(0.10 * 100)}% of mid) on all contracts with bids"
    if otm_kills > 0 and best_yield == 0.0:
        return "All strikes too close to money (1σ OTM rule)"
    if best_yield > 0:
        return f"Best yield {best_yield * 100:.0f}% — target ≥ {int(CC_MIN_ANNUALIZED_YIELD * 100)}% annualized"
    return "No strikes met OTM + yield criteria"


def _resolve_cc_cell(
    ticker: str,
    price: float | None,
    signals: dict[str, Any],
    *,
    precomputed_cc: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Single Covered Call column: returns {'html': ..., 'plain': ...}."""
    sym = ticker.upper()
    sc_row = (signals.get("screener") or {}).get(sym) if isinstance(signals.get("screener"), dict) else None
    sc_row = sc_row or {}
    ivr = _parse_float(sc_row.get("iv_rank"))
    earn_raw = sc_row.get("next_earnings_date")
    earn_s = str(earn_raw).strip()[:10] if earn_raw is not None and str(earn_raw).strip() else None
    ivr_floor = int(CC_MIN_IV_RANK)

    def contract_pair(cc: dict[str, Any]) -> tuple[str, str]:
        el = _fmt_expiry_date(str(cc.get("expiry") or "")[:10])
        try:
            strike = float(cc.get("strike") or 0)
        except (TypeError, ValueError):
            strike = 0.0
        bid = cc.get("bid")
        mid = cc.get("mid")
        yld = cc.get("annualized_yield")
        line1 = f"Sell {el} {_fmt_money(strike)} Call"
        line2 = f"Bid {_fmt_money(bid)} · Mid {_fmt_money(mid)} · Yield {yld}%"
        html = (
            f"{_escape_html(line1)}<br/>"
            f'<span style="color:#555;font-size:11px;">{_escape_html(line2)}</span>'
        )
        plain = f"{line1} | {line2}"
        return html, plain

    if precomputed_cc:
        h, p = contract_pair(precomputed_cc)
        return {"html": h, "plain": p}

    if price is None or price <= 0:
        msg = "No — Price unavailable"
        return {
            "html": f'<span style="color:#999">{_escape_html(msg)}</span>',
            "plain": msg,
        }

    # Use pre-fetched cache from main.py scan run; fall back to live call only
    # if cache is absent (e.g. standalone reporter invocation).
    _cache = signals.get("_chain_cache")
    chain: list[dict[str, Any]] = []
    if _cache is not None and sym in _cache:
        chain = _cache[sym] or []
    else:
        try:
            chain = uw.get_options_chain(ticker)
            if _cache is not None:
                _cache[sym] = chain
        except Exception as e:
            logger.warning("options chain for %s: %s", ticker, e)

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
        h, p = contract_pair(opt)
        return {"html": h, "plain": p}

    if ivr is not None and ivr < CC_MIN_IV_RANK:
        msg = f"IVR {ivr:.0f} — target ≥ {ivr_floor}"
        return {
            "html": f'<span style="color:#999">{_escape_html(msg)}</span>',
            "plain": msg,
        }

    if earn_s and _earnings_blocks_typical_cc(earn_s):
        el = _fmt_expiry_date(earn_s)
        msg = f"⚠️ Earnings {el} — wait"
        return {
            "html": f'<span style="color:#e67e22;font-weight:bold;">{_escape_html(msg)}</span>',
            "plain": msg,
        }

    if not chain:
        msg = "No options data from API"
        return {
            "html": f'<span style="color:#999">{_escape_html(msg)}</span>',
            "plain": msg,
        }

    # Diagnose why no contract passed — give the user a specific reason
    msg = _diagnose_cc_failure(chain, float(price) if price else 0.0)
    return {
        "html": f'<span style="color:#999">{_escape_html(msg)}</span>',
        "plain": msg,
    }


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
        if base and base.strip():
            return f"No active sell triggers. {base}"
        return "No active sell triggers. Original thesis intact — monitor for new signals."
    return base


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
    Card-based HTML (inline CSS) for email width ~580px — one card per ticker per section.
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
        cc_cell = _resolve_cc_cell(
            t,
            _parse_float(price),
            signals,
            precomputed_cc=opp.get("covered_call"),
        )
        triggered_rows.append(
            {
                "ticker_raw": sym,
                "ticker": _escape_html(sym),
                "company": _escape_html(uw.get_company_name(t)),
                "price": _escape_html(_fmt_money(price)),
                "pc_1w": pc.get("1w", "N/A"),
                "pc_1m": pc.get("1m", "N/A"),
                "pc_ytd": pc.get("ytd", "N/A"),
                # Badge displays the composite score that drove the tier
                # assignment (STRONG BULL ≥60). Legacy 0–100 score still flows
                # through opp["score"] for downstream sort/filter callers.
                "score_badge_html": _composite_badge_html(opp.get("composite", "")),
                "cc_plain": cc_cell["plain"],
                "ptsl": ptsl,
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
        cc_cell = _resolve_cc_cell(t, _parse_float(price), signals)
        watch_rows.append(
            {
                "ticker_raw": sym,
                "ticker": _escape_html(sym),
                "company": _escape_html(uw.get_company_name(t)),
                "price": _escape_html(_fmt_money(price)),
                "pc_1w": pc.get("1w", "N/A"),
                "pc_1m": pc.get("1m", "N/A"),
                "pc_ytd": pc.get("ytd", "N/A"),
                "score_badge_html": _composite_badge_html(w.get("composite", "")),
                "cc_plain": cc_cell["plain"],
                "ptsl": ptsl,
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
        pnl_raw = "—"
        if avg is not None and avg > 0 and price is not None:
            pnl = (float(price) - avg) / avg * 100.0
            pnl_raw = f"{pnl:+.1f}%"
        sc = score_map.get(sym)
        act = _portfolio_action_for_ticker(sym, sell_alerts, sc)
        ptsl = calc_pt_sl(float(avg)) if avg is not None and avg > 0 else None
        cc_cell = _resolve_cc_cell(sym, _parse_float(price), signals)
        portfolio_rows.append(
            {
                "ticker_raw": sym,
                "ticker": _escape_html(sym),
                "company": _escape_html(uw.get_company_name(sym)),
                "price": _escape_html(_fmt_money(price)),
                "pc_1w": pc.get("1w", "N/A"),
                "pc_1m": pc.get("1m", "N/A"),
                "pc_ytd": pc.get("ytd", "N/A"),
                "pnl_raw": pnl_raw,
                "action_badge_html": _action_pill_html(act),
                "cc_plain": cc_cell["plain"],
                "ptsl": ptsl,
                "avg_cost": avg,
                "action": act,
            }
        )

    parts: list[str] = [
        '<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222;">',
        _build_section_html("RECOMMENDATIONS (Triggered)", "triggered", triggered_rows, signals),
        _build_section_html("WATCHLIST (Near Trigger)", "watch", watch_rows, signals),
        _build_section_html("CURRENT PORTFOLIO", "portfolio", portfolio_rows, signals),
        "</div>",
    ]

    parts.append(
        '<div style="font-size:11px;color:#888;margin-top:20px;padding-top:12px;border-top:1px solid #eee;">'
        f"Scan complete | {now.strftime('%a %b ') + str(now.day)} {now.strftime('%I:%M %p %Z %Y')} (market COB)<br/>"
        f"Data: Unusual Whales (options flow, dark pool) · SEC EDGAR/Congress.gov (insider &amp; congressional trades) · Yahoo Finance (technicals)<br/>"
        f'<a href="https://market-dashboard-git-main-joe-mezzadri.vercel.app/#overview" '
        f'style="color:#1a5276;font-weight:bold;">Open Macro Dashboard & Trading Scanner</a>'
        f"</div>"
    )
    return "\n".join(parts)


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

    hdr_tw = [
        "Ticker",
        "Company",
        "Price",
        "Composite",
        "1W",
        "1M",
        "YTD",
        "Covered Call",
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
        "Covered Call",
        "PT / SL",
    ]

    lines: list[str] = [
        "════════════════════════════════════",
        "§1 RECOMMENDATIONS (Triggered)",
        "════════════════════════════════════",
        row_line(hdr_tw),
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
            f"PT {_fmt_money(ptsl['pt'])} · SL {_fmt_money(ptsl['sl'])}"
            if ptsl
            else "—"
        )
        cc_cell = _resolve_cc_cell(
            t,
            _parse_float(price),
            signals,
            precomputed_cc=opp.get("covered_call"),
        )
        narr = _analysis_two_sentences(t, signals)
        _comp = opp.get("composite")
        _comp_str = f"{_comp:+d}" if isinstance(_comp, (int, float)) else ""
        lines.append(
            row_line(
                [
                    sym,
                    uw.get_company_name(t),
                    _fmt_money(_parse_float(price)),
                    _comp_str,
                    pc.get("1w", "N/A"),
                    pc.get("1m", "N/A"),
                    pc.get("ytd", "N/A"),
                    cc_cell["plain"],
                    pt_sl,
                ]
            )
        )
        if narr:
            lines.append(f"  Analysis: {narr}")

    lines.extend(
        [
            "",
            "════════════════════════════════════",
            "§2 WATCHLIST (Near Trigger)",
            "════════════════════════════════════",
            row_line(hdr_tw),
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
            f"PT {_fmt_money(ptsl['pt'])} · SL {_fmt_money(ptsl['sl'])}"
            if ptsl
            else "—"
        )
        cc_cell = _resolve_cc_cell(t, _parse_float(price), signals)
        narr = _analysis_two_sentences(t, signals)
        _comp = w.get("composite")
        _comp_str = f"{_comp:+d}" if isinstance(_comp, (int, float)) else ""
        lines.append(
            row_line(
                [
                    sym,
                    uw.get_company_name(t),
                    _fmt_money(_parse_float(price)),
                    _comp_str,
                    pc.get("1w", "N/A"),
                    pc.get("1m", "N/A"),
                    pc.get("ytd", "N/A"),
                    cc_cell["plain"],
                    pt_sl,
                ]
            )
        )
        if narr:
            lines.append(f"  Analysis: {narr}")

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
            f"PT {_fmt_money(ptsl['pt'])} · SL {_fmt_money(ptsl['sl'])}"
            if ptsl
            else "—"
        )
        cc_cell = _resolve_cc_cell(sym, _parse_float(price), signals)
        pan = _portfolio_analysis_cell(sym, act, signals, sell_alerts)
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
                    cc_cell["plain"],
                    pt_sl,
                ]
            )
        )
        if pan:
            lines.append(f"  Analysis: {pan}")

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
    comp = opp.get("composite")
    price = opp.get("current_price")
    company = uw.get_company_name(t)
    comp_str = f"{comp:+d}" if isinstance(comp, (int, float)) else "—"
    lines = [
        f"{t} — {company}  [Composite: {comp_str} · STRONG BULL]",
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
    comp = w.get("composite")
    company = uw.get_company_name(t)
    price = w.get("current_price")
    comp_str = f"{comp:+d}" if isinstance(comp, (int, float)) else "—"
    lines = [
        f"{idx}. {t} — {company}  [Composite: {comp_str} · BULLISH]",
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
        f'<td style="padding:6px 8px 6px 0;color:#666;">Composite ≥{SCORE_WATCH_ALERT_COMPOSITE} (BULLISH + STRONG BULL)</td>'
        f'<td style="padding:6px 0;text-align:right;font-weight:600;">{n_flagged}</td></tr>'
        f'<tr style="border-bottom:1px solid #eee;">'
        f'<td style="padding:6px 8px 6px 0;color:#666;">Buy Alert — STRONG BULL (≥{SCORE_BUY_ALERT_COMPOSITE})</td>'
        f'<td style="padding:6px 0;text-align:right;font-weight:600;">{n_buy}</td></tr>'
        f'<tr>'
        f'<td style="padding:6px 8px 6px 0;color:#666;">Near Trigger — BULLISH ({SCORE_WATCH_ALERT_COMPOSITE}–{SCORE_BUY_ALERT_COMPOSITE - 1})</td>'
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
        f"Trading Signal Scanner · {_escape_html(date_str)} (market COB) · "
        f"Data: Unusual Whales · SEC EDGAR/Congress.gov · Yahoo Finance"
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
    # `score` here is the COMPOSITE value (−100..+100) passed in from the
    # markdown renderer; render with explicit sign so the direction is clear.
    score_str = f"{score:+d}" if isinstance(score, int) else str(score)
    return f"{ticker} — composite {score_str}: " + "; ".join(bits)


def _max_profit_per_share(strike: float, stock: float, premium: float) -> tuple[float, float]:
    """Covered call: max profit if assigned = (strike - stock) + premium; return (dollars, pct of stock)."""
    cap = (strike - stock) + premium
    pct = (cap / stock * 100) if stock else 0.0
    return cap, pct


def _safe(obj: Any) -> Any:
    """Recursively convert non-JSON-serializable types."""
    import math as _math
    if obj is None or isinstance(obj, (bool, int, str)):
        return obj
    if isinstance(obj, float):
        return None if (_math.isnan(obj) or _math.isinf(obj)) else round(obj, 6)
    if isinstance(obj, dict):
        return {k: _safe(v) for k, v in obj.items() if not str(k).startswith("_")}
    if isinstance(obj, (list, tuple)):
        return [_safe(v) for v in obj]
    return str(obj)


def _write_json_data(
    scan_type: str,
    date_str: str,
    buy_opportunities: list[dict[str, Any]],
    watch_items: list[dict[str, Any]],
    sell_alerts: list[dict[str, Any]],
    signals: dict[str, Any],
    portfolio_positions: list[dict[str, Any]],
    portfolio_covered_calls: list[dict[str, Any]],
) -> None:
    """
    Write reports/latest_scan_data.json — the PUBLIC data feed consumed by the
    Vercel dashboard. Identical for every visitor, signed in or out.

    Contains ONLY:
      - Buy / Watch tier picks scored from public signals (congress, insider,
        flow, dark pool)
      - Per-ticker scored data (score, screener row, technicals w/ composite,
        modal info/news/analyst ratings) for the scannable universe

    Does NOT contain:
      - Joe's portfolio positions or watchlist (these live in Supabase per-user
        and are overlaid by the frontend via useUserPortfolio)
      - Any `_personal_*` keys, which stay in-process for the email renderer

    Anyone who fetches this JSON from the public repo sees only market signal
    data — not any user's book.
    """
    import json as _json
    from zoneinfo import ZoneInfo as _ZI

    et = _ZI("America/New_York")
    now = datetime.now(et)

    # Public-universe tickers — anything that ended up scored from the signal
    # sources. This is the only set of tickers allowed into the public artifact.
    # Personal/watchlist tickers that were force-included for the email renderer
    # are intentionally excluded here.
    filtered_universe = {
        (t or "").upper() for t in (signals.get("_filtered_tickers") or [])
    }
    # Wide-universe survivors also qualify as public — they were scanned from
    # public index constituents (S&P 500, Nasdaq 100, Dow, optional R2000) and
    # contain no personal data. Each carries a direction tag (long/short) for
    # the Technicals tab filter.
    wide_universe = signals.get("_wide_universe") or {}
    wide_universe_tickers = {
        (t or "").upper() for t in (wide_universe.get("long") or [])
    } | {
        (t or "").upper() for t in (wide_universe.get("short") or [])
    }
    relevant_tickers = (
        {(o.get("ticker") or "").upper() for o in buy_opportunities}
        | {(w.get("ticker") or "").upper() for w in watch_items}
        | filtered_universe
        | wide_universe_tickers
    )

    screener_slim = {
        t: v for t, v in (signals.get("screener") or {}).items()
        if t in relevant_tickers
    }

    # Technicals keyed by ticker — also restricted to the public universe. This
    # is where the composite score rides along with the raw indicator data.
    technicals_slim = {
        t: v for t, v in (signals.get("_technicals") or {}).items()
        if t in relevant_tickers
    }

    # Score by ticker — restricted to public-universe tickers. The old
    # artifact leaked scores for Joe's watchlist/portfolio here; stripped.
    score_by_ticker_full = signals.get("_score_by_ticker") or {}
    score_by_ticker_slim = {
        t: s for t, s in score_by_ticker_full.items() if t in relevant_tickers
    }
    # Signal composite by ticker — the bidirectional (−100..+100) score that
    # drives Buy Alert / Near Trigger tiering. Exposed on the artifact so the
    # dashboard can render coherent composite badges alongside the legacy
    # score. Keyed by upper-case ticker (matches _composite_by_ticker shape).
    composite_by_ticker_full = signals.get("_composite_by_ticker") or {}
    composite_by_ticker_slim = {
        t: s for t, s in composite_by_ticker_full.items() if t in relevant_tickers
    }

    payload = {
        "scan_time": now.isoformat(),
        "scan_type": scan_type,
        "date_label": date_str,
        "buy_opportunities": _safe(buy_opportunities),
        "watch_items": _safe(watch_items),
        # Sell alerts and portfolio_covered_calls are PERSONAL data — they
        # reference Joe's actual positions. These stay in the email output
        # only; the public artifact gets empty lists so the dashboard's
        # sell_alerts surface renders a clean "sign in to see yours" state.
        "sell_alerts": [],
        "portfolio_positions": [],
        "portfolio_covered_calls": [],
        "watchlist": [],
        # Slimmed score map so the dashboard only sees public-universe scores.
        "score_by_ticker": _safe(score_by_ticker_slim),
        # Composite (−100..+100) map — source of truth for tiering and modal.
        "composite_by_ticker": _safe(composite_by_ticker_slim),
        # Wide-universe direction tags — drives the Technicals tab's Long/Short
        # filter. Tickers without a direction tag came from UW signals and
        # render under "All".
        "wide_universe": {
            "long": sorted(wide_universe.get("long") or []),
            "short": sorted(wide_universe.get("short") or []),
            "direction_by_ticker": _safe(wide_universe.get("direction_by_ticker") or {}),
        },
        "signals": {
            "congress_buys": _safe(signals.get("congress_buys") or []),
            "congress_sells": _safe(signals.get("congress_sells") or []),
            "insider_buys": _safe(signals.get("insider_buys") or []),
            "insider_sales": _safe(signals.get("insider_sales") or []),
            "flow_alerts": _safe(signals.get("flow_alerts") or []),
            "put_flow_alerts": _safe(signals.get("put_flow_alerts") or []),
            "darkpool": _safe(signals.get("darkpool") or []),
            "screener": _safe(screener_slim),
            "technicals": _safe(technicals_slim),
            # Modal enrichment — keyed by ticker, slimmed to relevant_tickers.
            # Missing/empty keys are fine; dashboard renders gracefully.
            "info": _safe({
                t: v for t, v in (signals.get("_info") or {}).items()
                if t in relevant_tickers and v
            }),
            "news": _safe({
                t: v for t, v in (signals.get("_news") or {}).items()
                if t in relevant_tickers and v
            }),
            "analyst_ratings": _safe({
                t: v for t, v in (signals.get("_analyst_ratings") or {}).items()
                if t in relevant_tickers and v
            }),
            # Market-wide news (non-ticker-specific). Only `*_public` entries
            # ship in the public artifact — premium content stays out by
            # policy. Frontend reads signals.market_news.* to render the
            # Market News section on the dashboard.
            "market_news": _safe({
                "zerohedge_public": (signals.get("_market_news") or {}).get("zerohedge_public") or [],
            }),
        },
        "config": {
            "score_buy_alert": SCORE_BUY_ALERT,
            "score_watch_alert": SCORE_WATCH_ALERT,
            # Composite tier thresholds (source of truth for Buy Alert /
            # Near Trigger). Dashboard can read these to stay in sync if we
            # ever retune the bands.
            "composite_buy_alert": SCORE_BUY_ALERT_COMPOSITE,
            "composite_watch_alert": SCORE_WATCH_ALERT_COMPOSITE,
            "cc_min_iv_rank": CC_MIN_IV_RANK,
            "cc_min_annualized_yield_pct": 25,
            "cc_otm_iv_multiplier": 1.0,
            "cc_min_dte": 14,
            "cc_max_dte": 42,
            "profit_target_pct": 20,
            "stop_loss_pct": 15,
        },
    }

    json_path = REPORTS_DIR / "latest_scan_data.json"
    json_path.write_text(_json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Wrote %s (public artifact — no user data)", json_path)


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
        f"**Composite ≥{SCORE_WATCH_ALERT_COMPOSITE} (BULLISH + STRONG BULL):** {n_flagged}  ",
        f"**Buy Alert — STRONG BULL (composite ≥{SCORE_BUY_ALERT_COMPOSITE}):** {n_buy}  ",
        f"**Near Trigger — BULLISH (composite {SCORE_WATCH_ALERT_COMPOSITE}–{SCORE_BUY_ALERT_COMPOSITE - 1}):** {n_watch}  ",
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
        f"*(Composite ≥ {SCORE_BUY_ALERT_COMPOSITE} / STRONG BULL — full write-up with covered call analysis)*",
        "",
        ]
    )

    if not buy_opportunities:
        lines.append(
            f"*No Buy Alert signals (composite ≥ {SCORE_BUY_ALERT_COMPOSITE}) on this run.*"
        )
        lines.append("")

    for i, opp in enumerate(buy_opportunities, start=1):
        t = opp["ticker"]
        comp = opp.get("composite")
        cc = opp.get("covered_call")
        price = opp.get("current_price")
        comp_str = f"{comp:+d}" if isinstance(comp, (int, float)) else "—"

        lines.append(f"### {i}. {t} — Composite: {comp_str} (STRONG BULL)")
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
        f"*(Composite {SCORE_WATCH_ALERT_COMPOSITE}–{SCORE_BUY_ALERT_COMPOSITE - 1} / BULLISH — one-line summary; no covered call math)*"
    )
    lines.append("")

    if not watch_items:
        lines.append(
            f"*No Near Trigger signals (composite {SCORE_WATCH_ALERT_COMPOSITE}–{SCORE_BUY_ALERT_COMPOSITE - 1}) on this run.*"
        )
        lines.append("")
    else:
        for w in watch_items:
            t = w["ticker"]
            comp = w.get("composite", 0)
            lines.append(f"- {watch_one_line_summary(t, int(comp), signals)}")
        lines.append("")

    if n_flagged == 0:
        lines.append(
            f"*No signals above BULLISH threshold (composite ≥ {SCORE_WATCH_ALERT_COMPOSITE}) today — nothing to flag for monitoring or Buy Alert review.*"
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
    lines.append("*Trading Signal Scanner · Data: Unusual Whales · SEC EDGAR/Congress.gov · Yahoo Finance*")
    lines.append("")

    md_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("Wrote %s", md_path)

    cols = [
        "tier",
        "ticker",
        "score",
        "composite",
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
                "score": opp.get("score"),
                "composite": opp.get("composite"),
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
                "score": w.get("score"),
                "composite": w.get("composite"),
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

    # Write JSON data feed for the interactive dashboard (non-fatal if it fails)
    try:
        _write_json_data(
            scan_type, date_str, buy_opportunities, watch_items, sell_alerts,
            signals, portfolio_positions, portfolio_covered_calls,
        )
    except Exception as _e:
        logger.warning("_write_json_data failed (non-fatal): %s", _e)

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
    text = (
        text
        + "\n\n"
        + f"Scan complete | {now.strftime('%Y-%m-%d %I:%M %p %Z')} (market COB)\n"
        + "Data: Unusual Whales · SEC EDGAR/Congress.gov · Yahoo Finance\n"
        + "Dashboard: https://market-dashboard-git-main-joe-mezzadri.vercel.app/\n"
    )

    body_html = build_scan_report_body_html(
        scan_type,
        buy_opportunities,
        watch_items,
        sell_alerts,
        signals,
        portfolio_positions=portfolio_positions,
    )
    html_body = wrap_html_document("Macro Dashboard & Trading Opportunity Scanner", body_html)

    return sub[:900], html_body, text
