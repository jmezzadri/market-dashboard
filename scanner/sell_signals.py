"""Portfolio sell signals and covered-call management alerts (Phase 2)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import numpy as np

from scanner import unusual_whales as uw


def _price_for_ticker(ticker: str, screener: dict[str, Any]) -> float | None:
    row = screener.get(ticker.upper()) if isinstance(screener, dict) else None
    if not row:
        return None
    for k in ("prev_close", "close"):
        try:
            v = float(row.get(k) or 0)
            if v > 0:
                return v
        except (TypeError, ValueError):
            continue
    return None


def _trading_days_since(entry: date) -> int:
    return int(np.busday_count(entry, date.today()))


def check_position_alerts(
    positions: list[dict[str, Any]],
    signals: dict[str, Any],
    screener: dict[str, Any],
    buy_scores: dict[str, int] | None = None,
    watch_scores: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """
    Alerts for open stock positions from portfolio/positions.csv.
    """
    buy_scores = buy_scores or {}
    watch_scores = watch_scores or {}
    insider_buys = signals.get("insider_buys") or []
    insider_sales = signals.get("insider_sales") or []

    alerts: list[dict[str, Any]] = []

    for pos in positions:
        sym = (pos.get("ticker") or "").upper()
        if not sym:
            continue
        avg = pos.get("avg_cost")
        entry = pos.get("entry_date")
        if avg is None or avg <= 0:
            continue

        px = _price_for_ticker(sym, screener)
        if px is None:
            continue

        if px <= avg * 0.85:
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "stop_loss",
                    "message": f"Price {_fmt(px)} ≤ 15% below avg cost {_fmt(avg)}",
                    "urgency": "high",
                }
            )
        if px >= avg * 1.20:
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "profit_target",
                    "message": f"Price {_fmt(px)} ≥ 20% above avg cost {_fmt(avg)}",
                    "urgency": "medium",
                }
            )

        if entry and isinstance(entry, date):
            if _trading_days_since(entry) >= 50:
                alerts.append(
                    {
                        "ticker": sym,
                        "alert_type": "time_stop",
                        "message": f"Held ~{_trading_days_since(entry)} trading days since {entry}",
                        "urgency": "low",
                    }
                )

        p_names = {
            (r.get("owner_name") or "").strip().lower()
            for r in insider_buys
            if (r.get("ticker") or "").upper() == sym
        }
        thesis_done = False
        for srow in insider_sales:
            if thesis_done:
                break
            if (srow.get("ticker") or "").upper() != sym:
                continue
            owner = (srow.get("owner_name") or "").strip().lower()
            if owner and owner in p_names:
                alerts.append(
                    {
                        "ticker": sym,
                        "alert_type": "thesis_reversal",
                        "message": f"Insider sale (S) by {srow.get('owner_name')} after prior open-market buy signal",
                        "urgency": "high",
                    }
                )
                thesis_done = True

        if sym in buy_scores or sym in watch_scores:
            sc = buy_scores.get(sym) or watch_scores.get(sym)
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "new_signal",
                    "message": f"Scanner also flagged {sym} (score {sc}) — confirmation vs existing position",
                    "urgency": "low",
                }
            )

    return alerts


def _fmt(x: float) -> str:
    return f"${x:,.2f}"


def _find_contract_quote(
    ticker: str, strike: float, expiry: str
) -> tuple[float | None, float | None]:
    """Return (nbbo_bid, nbbo_ask) for matching call contract."""
    try:
        chain = uw.get_options_chain(ticker)
    except Exception:
        return None, None
    exp_s = expiry.strip()[:10]
    for c in chain:
        try:
            k = float(c.get("strike") or 0)
        except (TypeError, ValueError):
            continue
        if abs(k - strike) > 0.02:
            continue
        if str(c.get("expiry") or "")[:10] != exp_s:
            continue
        bid = c.get("nbbo_bid")
        ask = c.get("nbbo_ask") or c.get("ask")
        try:
            b = float(bid) if bid is not None else None
        except (TypeError, ValueError):
            b = None
        try:
            a = float(ask) if ask is not None else None
        except (TypeError, ValueError):
            a = None
        return b, a
    return None, None


def check_covered_call_alerts(
    covered_calls: list[dict[str, Any]],
    screener: dict[str, Any],
) -> list[dict[str, Any]]:
    """Management alerts for open short calls from portfolio/covered_calls.csv."""
    alerts: list[dict[str, Any]] = []
    today = date.today()

    for cc in covered_calls:
        sym = (cc.get("ticker") or "").upper()
        if not sym:
            continue
        strike = float(cc.get("strike") or 0)
        expiry_s = str(cc.get("expiry") or "")[:10]
        prem_in = float(cc.get("premium_received") or 0)
        if not expiry_s:
            continue

        try:
            exp_d = datetime.strptime(expiry_s, "%Y-%m-%d").date()
        except ValueError:
            continue

        px = _price_for_ticker(sym, screener)
        if px is None:
            continue

        bid, ask = _find_contract_quote(sym, strike, expiry_s)
        current_call = ask if ask is not None else None

        if exp_d < today:
            if px < strike:
                alerts.append(
                    {
                        "ticker": sym,
                        "alert_type": "expired_worthless",
                        "message": f"{sym} ${strike} call expired OTM — confirm max profit",
                        "urgency": "low",
                    }
                )
            continue

        dte = (exp_d - today).days
        if current_call is not None and prem_in > 0 and current_call <= prem_in * 0.20:
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "buy_back_profit",
                    "message": f"Call mark ~{_fmt(current_call)} vs premium received {_fmt(prem_in)} — consider buyback",
                    "urgency": "medium",
                }
            )

        if dte <= 7 and px < strike:
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "expiry_approaching",
                    "message": f"{dte} DTE, stock below strike — consider roll",
                    "urgency": "low",
                }
            )

        if px >= strike * 0.98:
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "assignment_risk",
                    "message": f"Spot {_fmt(px)} within 2% of strike {_fmt(strike)}",
                    "urgency": "high",
                }
            )

        if px >= strike * 1.05:
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "deep_itm",
                    "message": f"Stock {_fmt(px)} ≥5% above strike {_fmt(strike)}",
                    "urgency": "high",
                }
            )

    return alerts

