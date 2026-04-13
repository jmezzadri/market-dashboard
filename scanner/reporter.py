"""Markdown + CSV + HTML report generation."""

from __future__ import annotations

import html as html_module
import logging
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from config import PROJECT_ROOT, SCORE_BUY_ALERT, SCORE_WATCH_ALERT
from scanner.scorer import get_insider_dollar_value, qualifying_insider_rows

logger = logging.getLogger(__name__)

REPORTS_DIR = PROJECT_ROOT / "reports"

SCAN_LABELS = {
    "premarket": "Morning Pre-Market",
    "intraday": "Intraday",
    "postmarket": "Post-Market",
    "weekly": "Weekly Review",
}


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

    high_alerts = [a for a in sell_alerts if a.get("urgency") == "high"]
    other_alerts = [a for a in sell_alerts if a.get("urgency") in ("medium", "low")]

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
                f"- **{a.get('ticker', '?')}** — `{a.get('alert_type', '')}`: {a.get('message', '')}"
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
                f"{a.get('message', '')}"
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
            lines.append(
                "| Strike | Expiry | Days | OTM% | Premium | Ann. Yield |"
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
    buy_opportunities: list[dict[str, Any]],
    watch_items: list[dict[str, Any]],
    sell_alerts: list[dict[str, Any]],
) -> tuple[str, str, str]:
    """Subject, HTML body, plain text for notifier."""
    subs: list[str] = []
    if buy_opportunities:
        tickers = ", ".join(o["ticker"] for o in buy_opportunities[:8])
        subs.append(f"{len(buy_opportunities)} Buy — {tickers}")
    if watch_items:
        tickers = ", ".join(f"{w['ticker']} ({w['score']})" for w in watch_items[:8])
        subs.append(f"{len(watch_items)} Watch — {tickers}")
    high = [a for a in sell_alerts if a.get("urgency") == "high"]
    if high:
        subs.append(f"🚨 {len(high)} high portfolio alert(s)")
    subject = "Trading scanner — " + (" | ".join(subs) if subs else "no actionable signals")
    text_lines = [subject, "", "Buy tier:", *[f"  - {o['ticker']} ({o['score']})" for o in buy_opportunities], "", "Watch:", *[f"  - {w['ticker']} ({w['score']})" for w in watch_items], "", "Portfolio alerts:", *[f"  [{a.get('urgency')}] {a.get('ticker')} {a.get('alert_type')}: {a.get('message')}" for a in sell_alerts]]
    text = "\n".join(text_lines)
    html_body = "<html><body><pre>" + html_module.escape(text) + "</pre></body></html>"
    return subject[:900], html_body, text
