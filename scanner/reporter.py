"""Markdown + CSV + HTML report generation."""

from __future__ import annotations

import html as html_module
import logging
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from config import CC_MIN_IV_RANK, PROJECT_ROOT, SCORE_BUY_ALERT, SCORE_WATCH_ALERT
from scanner import unusual_whales as uw
from scanner.scorer import get_insider_dollar_value, qualifying_insider_rows, signal_narrative

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


def _build_email_subject(
    scan_type: str,
    buy_opportunities: list[dict[str, Any]],
    watch_items: list[dict[str, Any]],
    sell_alerts: list[dict[str, Any]],
) -> str:
    day_s = _email_day_parenthetical()
    st = scan_type.lower()
    actionable = [a for a in sell_alerts if not a.get("is_informational")]
    has_pf = bool(actionable)
    has_buy = bool(buy_opportunities)
    has_watch = bool(watch_items)

    if has_buy and has_pf:
        return f"🟢 BUY ALERT + ⚠️ Portfolio Actions — {day_s}"
    if has_watch and has_pf and not has_buy:
        return f"👀 Watch + ⚠️ Portfolio Actions — {day_s}"
    if has_pf and not has_buy and not has_watch:
        first = _sort_portfolio_alerts(actionable)[0]
        return f"⚠️ Portfolio Action Needed — {_portfolio_subject_snippet(first)} ({day_s})"
    if has_buy:
        first = buy_opportunities[0]
        tw = f" + {len(watch_items)} on Watch" if has_watch else ""
        return (
            f"🟢 BUY ALERT — {first['ticker']} ({first['score']}pts){tw} ({day_s})"
        )
    if has_watch:
        tickers = ", ".join(w["ticker"] for w in watch_items[:12])
        return f"👀 {len(watch_items)} Stocks on Watch — {tickers} ({day_s})"
    return f"Trading Scan — No alerts ({st}, {day_s})"


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


def _text_to_html_paras(lines: list[str]) -> str:
    """Wrap plain lines in simple HTML; blank line → paragraph break."""
    chunks: list[str] = []
    buf: list[str] = []
    for line in lines:
        if line == "":
            if buf:
                chunks.append("<p>" + "<br/>\n".join(_escape_html(x) for x in buf) + "</p>")
                buf = []
            continue
        buf.append(line)
    if buf:
        chunks.append("<p>" + "<br/>\n".join(_escape_html(x) for x in buf) + "</p>")
    return "\n".join(chunks)


def _fmt_money(x: float | None) -> str:
    if x is None:
        return "—"
    return f"${x:,.2f}"


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
    safe = html_module.escape("\n".join(lines))
    latest.write_text(
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>Trading Signal Scan</title>"
        "<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:0 auto;padding:1rem;line-height:1.45;background:#fafafa;color:#111}"
        "pre{white-space:pre-wrap;word-break:break-word;background:#fff;padding:1rem;border:1px solid #ddd;border-radius:8px}</style>"
        f"</head><body><pre>{safe}</pre></body></html>",
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
) -> tuple[str, str, str]:
    """Subject, HTML body, plain text for notifier."""
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    label = SCAN_LABELS.get(scan_type, scan_type)
    header = f"TRADING SCAN — {label.upper()} | {now.strftime('%Y-%m-%d %I:%M %p %Z')}"
    sep = "════════════════════════════════════"
    sub = _build_email_subject(scan_type, buy_opportunities, watch_items, sell_alerts)

    text_lines: list[str] = [
        sep,
        header,
        sep,
        "",
    ]

    sorted_act, sorted_info = _partition_portfolio_alerts(sell_alerts)
    if sorted_act:
        text_lines.extend(
            [
                "⚠️ PORTFOLIO ACTIONS NEEDED",
                "─────────────────────────────",
                "",
            ]
        )
        for i, a in enumerate(sorted_act):
            text_lines.extend(_format_portfolio_alert_block(a))
            if i < len(sorted_act) - 1:
                text_lines.extend(["", "────────────────────────────────────", ""])
        text_lines.extend(["", sep, ""])

    if sorted_info:
        text_lines.extend(
            [
                "📈 PORTFOLIO NOTES (informational only)",
                "─────────────────────────────",
                "",
            ]
        )
        for i, a in enumerate(sorted_info):
            text_lines.extend(_format_portfolio_alert_block(a))
            if i < len(sorted_info) - 1:
                text_lines.extend(["", "────────────────────────────────────", ""])
        text_lines.extend(["", sep, ""])

    if buy_opportunities:
        text_lines.extend(
            [
                "🟢 BUY OPPORTUNITIES",
                "─────────────────────────────",
                "",
            ]
        )
        for opp in buy_opportunities:
            text_lines.extend(_format_buy_block(opp, signals))
            text_lines.extend(["", "────────────────────────────────────", ""])

    if watch_items:
        text_lines.extend(
            [
                f"👀 ON WATCH (score {SCORE_WATCH_ALERT}–{SCORE_BUY_ALERT - 1})",
                "─────────────────────────────",
                "These stocks have meaningful signals but haven't yet crossed the buy threshold.",
                "Monitor them — a new signal could push them into Buy territory.",
                "",
            ]
        )
        for i, w in enumerate(watch_items, start=1):
            text_lines.extend(_format_watch_item(w, i, signals))
            text_lines.append("")

    next_hint = NEXT_SCAN_BLURB.get(scan_type.lower(), "the next scheduled run")
    text_lines.extend(
        [
            sep,
            f"Scan complete | Unusual Whales data | Next scan: {next_hint}",
            "To update your portfolio holdings, edit portfolio/positions.csv on GitHub.",
            sep,
        ]
    )

    text = "\n".join(text_lines)
    subject = sub[:900]

    # HTML mirrors structure
    html_parts: list[str] = [
        "<!DOCTYPE html><html><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        "<title>Trading Scan</title>",
        "<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:42rem;margin:1rem auto;"
        "line-height:1.5;color:#111;background:#fafafa;padding:0 0.75rem}"
        ".bar{color:#444;font-weight:600;letter-spacing:0.02em}"
        "h2{font-size:1rem;margin:1.25rem 0 0.5rem}"
        ".rule{border:none;border-top:1px solid #ccc;margin:1rem 0}"
        "p{margin:0.35rem 0}</style></head><body>",
        f"<p class='bar'>{_escape_html(sep)}</p>",
        f"<p><strong>{_escape_html(header)}</strong></p>",
        f"<p class='bar'>{_escape_html(sep)}</p>",
    ]

    if sorted_act:
        html_parts.append("<h2>⚠️ PORTFOLIO ACTIONS NEEDED</h2>")
        for i, a in enumerate(sorted_act):
            block = _format_portfolio_alert_block(a)
            html_parts.append(_text_to_html_paras(block))
            if i < len(sorted_act) - 1:
                html_parts.append("<hr class='rule'/>")
        html_parts.append(f"<p class='bar'>{_escape_html(sep)}</p>")

    if sorted_info:
        html_parts.append("<h2>📈 PORTFOLIO NOTES (informational only)</h2>")
        for i, a in enumerate(sorted_info):
            block = _format_portfolio_alert_block(a)
            html_parts.append(_text_to_html_paras(block))
            if i < len(sorted_info) - 1:
                html_parts.append("<hr class='rule'/>")
        html_parts.append(f"<p class='bar'>{_escape_html(sep)}</p>")

    if buy_opportunities:
        html_parts.append("<h2>🟢 BUY OPPORTUNITIES</h2>")
        for opp in buy_opportunities:
            html_parts.append(_text_to_html_paras(_format_buy_block(opp, signals)))
            html_parts.append("<hr class='rule'/>")

    if watch_items:
        html_parts.append(
            f"<h2>👀 ON WATCH (score {SCORE_WATCH_ALERT}–{SCORE_BUY_ALERT - 1})</h2>"
            "<p>These stocks have meaningful signals but haven't yet crossed the buy threshold. "
            "Monitor them — a new signal could push them into Buy territory.</p>"
        )
        for i, w in enumerate(watch_items, start=1):
            html_parts.append(_text_to_html_paras(_format_watch_item(w, i, signals)))

    html_parts.extend(
        [
            f"<p class='bar'>{_escape_html(sep)}</p>",
            "<p><em>"
            + _escape_html(f"Scan complete | Unusual Whales data | Next scan: {next_hint}")
            + "</em></p>",
            "<p>"
            + _escape_html(
                "To update your portfolio holdings, edit portfolio/positions.csv on GitHub."
            )
            + "</p>",
            f"<p class='bar'>{_escape_html(sep)}</p>",
            "</body></html>",
        ]
    )
    html_body = "\n".join(html_parts)

    return subject, html_body, text
