"""Portfolio triggers and covered-call management (CURSOR_TRIGGERS_SPEC)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from config import (
    INSIDER_REVERSAL_LOOKBACK,
    PROFIT_TARGET_PCT,
    ROLL_EXPIRY_DAYS,
    ROLL_PROFIT_THRESHOLD,
    ROLL_STRIKE_PROXIMITY,
    SCORE_COLLAPSE_PRIOR_MIN,
    SCORE_COLLAPSE_THRESHOLD,
    STOP_LOSS_PCT,
)
from scanner import unusual_whales as uw
from scanner.covered_calls import (
    find_optimal_covered_call,
)
from scanner.scorer import get_insider_dollar_value, signal_narrative


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


def _fmt(x: float) -> str:
    return f"${x:,.2f}"


def calc_pt_sl(
    entry_price: float,
    stop_pct: float | None = None,
    target_pct: float | None = None,
) -> dict[str, float]:
    """
    Profit target and stop loss for a given entry.
    Defaults: STOP_LOSS_PCT / PROFIT_TARGET_PCT from config (15% / 20%).
    """
    sp = STOP_LOSS_PCT if stop_pct is None else stop_pct
    tp = PROFIT_TARGET_PCT if target_pct is None else target_pct
    e = float(entry_price)
    return {
        "entry": round(e, 2),
        "pt": round(e * (1 + tp), 2),
        "sl": round(e * (1 - sp), 2),
    }


def _norm_name(n: str) -> str:
    return " ".join((n or "").lower().split())


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


def check_position_alerts(
    positions: list[dict[str, Any]],
    signals: dict[str, Any],
    screener: dict[str, Any],
    buy_scores: dict[str, int] | None = None,
    watch_scores: dict[str, int] | None = None,
    *,
    prev_scores: dict[str, int] | None = None,
    current_scores: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """
    Event-driven stock alerts for portfolio/positions.csv.
    Informational gain notes use is_informational=True (not sell signals).
    """
    buy_scores = buy_scores or {}
    watch_scores = watch_scores or {}
    prev_scores = prev_scores or {}
    current_scores = current_scores or {}

    insider_buys = signals.get("insider_buys") or []
    insider_buys_90 = signals.get("insider_buys_90d") or insider_buys
    insider_sales = signals.get("insider_sales") or []
    congress_buys = signals.get("congress_buys") or []
    congress_sells = signals.get("congress_sells") or []

    alerts: list[dict[str, Any]] = []

    congress_buy_keys: dict[tuple[str, str], dict[str, Any]] = {}
    for brow in congress_buys:
        t = (brow.get("ticker") or "").upper()
        nm = _norm_name(str(brow.get("name") or ""))
        if not t or not nm:
            continue
        key = (nm, t)
        if key not in congress_buy_keys:
            congress_buy_keys[key] = dict(brow)

    for pos in positions:
        sym = (pos.get("ticker") or "").upper()
        if not sym:
            continue
        avg = pos.get("avg_cost")
        if avg is None or avg <= 0:
            continue

        px = _price_for_ticker(sym, screener)
        if px is None:
            continue

        try:
            sh = float(pos.get("shares") or 0)
        except (TypeError, ValueError):
            sh = 0.0
        company = uw.get_company_name(sym)
        floor = 1.0 - STOP_LOSS_PCT

        if px <= avg * floor:
            pct_down = (avg - px) / avg * 100.0
            loss_dollars = max(0.0, (avg - px) * sh)
            sh_note = int(sh) if sh else None
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "stop_loss",
                    "urgency": "high",
                    "is_informational": False,
                    "shares": sh_note,
                    "company": company,
                    "headline": f"{sym} — Stop-Loss Triggered",
                    "detail": (
                        f"{company} is down {pct_down:.1f}% from your average cost of ${avg:.2f}. "
                        f"Current price: ${px:.2f}. "
                        f"Your {sh_note or '—'} shares have lost ~${loss_dollars:,.0f} in value. "
                        f"Your stop-loss threshold is −{STOP_LOSS_PCT * 100:.0f}%. "
                        f"The position is no longer within acceptable risk parameters."
                    ),
                    "action": "Review position immediately. Consider selling to limit further losses.",
                    "message": f"Price {_fmt(px)} ≤ {STOP_LOSS_PCT:.0%} below avg cost {_fmt(avg)}",
                }
            )

        if px >= avg * 1.20:
            pct_gain = (px - avg) / avg * 100.0
            current_value = px * sh
            gain_dollars = (px - avg) * sh
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "unrealized_gain",
                    "urgency": None,
                    "is_informational": True,
                    "shares": int(sh) if sh else None,
                    "company": company,
                    "headline": f"📈 {sym} — Unrealized Gain: +{pct_gain:.1f}%",
                    "detail": (
                        f"{int(sh) if sh else '—'} shares at avg cost ${avg:.2f} | Current price: ${px:.2f}\n"
                        f"Unrealized gain: ~${gain_dollars:,.0f} (position value ${current_value:,.0f})."
                    ),
                    "action": "No action required. Informational only.",
                    "message": f"Gain {pct_gain:.1f}% vs avg cost",
                }
            )

        cur_sc = current_scores.get(sym)
        prev_sc = prev_scores.get(sym)
        if (
            cur_sc is not None
            and prev_sc is not None
            and prev_sc >= SCORE_COLLAPSE_PRIOR_MIN
            and cur_sc < SCORE_COLLAPSE_THRESHOLD
        ):
            why = "; ".join(signal_narrative(sym, signals)[:3]) or "signals have faded vs prior scan."
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "score_collapse",
                    "urgency": "medium",
                    "is_informational": False,
                    "shares": int(sh) if sh else None,
                    "company": company,
                    "headline": f"{sym} — Scanner Score Collapsed",
                    "detail": (
                        f"The signals that justified {sym} have dissipated. Previous score: {prev_sc}. "
                        f"Current score: {cur_sc}. {why} "
                        f"The thesis no longer has strong support from current scan data."
                    ),
                    "action": "Review whether to reduce or exit; the setup that flagged the name has weakened.",
                    "message": f"Score {prev_sc} → {cur_sc}",
                }
            )

        owners_with_buy: dict[str, list[dict[str, Any]]] = {}
        for r in insider_buys_90:
            if (r.get("ticker") or "").upper() != sym:
                continue
            if (r.get("transaction_code") or "").strip().upper() != "P":
                continue
            owner = (r.get("owner_name") or "").strip().lower()
            if not owner:
                continue
            owners_with_buy.setdefault(owner, []).append(r)

        insider_done = False
        for srow in insider_sales:
            if insider_done:
                break
            if (srow.get("ticker") or "").upper() != sym:
                continue
            owner = (srow.get("owner_name") or "").strip().lower()
            if not owner or owner not in owners_with_buy:
                continue
            buys = sorted(
                owners_with_buy[owner],
                key=lambda x: str(x.get("transaction_date") or ""),
                reverse=True,
            )
            last_buy = buys[0] if buys else {}
            buy_date = str(last_buy.get("transaction_date") or "")[:10] or "unknown"
            sale_notional = get_insider_dollar_value(srow)
            try:
                sale_shares = abs(float(srow.get("amount") or 0))
            except (TypeError, ValueError):
                sale_shares = 0.0
            sale_date = str(srow.get("transaction_date") or "")[:10] or "unknown date"
            seller_name = (srow.get("owner_name") or "Unknown").strip()
            orig_story = "; ".join(signal_narrative(sym, signals)[:2]) or "prior insider and market activity."
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "insider_reversal",
                    "urgency": "high",
                    "is_informational": False,
                    "shares": int(sh) if sh else None,
                    "company": company,
                    "headline": f"{sym} — Insider Reversal",
                    "detail": (
                        f"An insider who was buying {sym} as recently as {buy_date} has now sold "
                        f"~{sale_shares:,.0f} shares worth ~${sale_notional:,.0f} on {sale_date}. "
                        f"When the person with the best information changes direction, it's worth paying attention. "
                        f"Rationale for original interest included: {orig_story}"
                    ),
                    "action": "Re-evaluate the position; insider selling after open-market buys can weaken the thesis.",
                    "message": f"Insider sale by {seller_name}",
                }
            )
            insider_done = True

        congress_done = False
        for srow in congress_sells:
            if congress_done:
                break
            t = (srow.get("ticker") or "").upper()
            if t != sym:
                continue
            nm = _norm_name(str(srow.get("name") or ""))
            if not nm:
                continue
            key = (nm, t)
            if key not in congress_buy_keys:
                continue
            brow = congress_buy_keys[key]
            buy_amt = brow.get("amounts", "unknown amount")
            buy_date = str(brow.get("transaction_date") or "")[:10] or "unknown"
            sell_date = str(srow.get("transaction_date") or "")[:10] or "unknown"
            pol = brow.get("name") or srow.get("name") or "Member"
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "congress_reversal",
                    "urgency": "high",
                    "is_informational": False,
                    "shares": int(sh) if sh else None,
                    "company": company,
                    "headline": f"{sym} — Congressional Reversal",
                    "detail": (
                        f"{pol} disclosed a sale of {sym} on {sell_date} after buying {buy_amt} on {buy_date}. "
                        f"Congressional sellers are disclosing a reversal in their own conviction."
                    ),
                    "action": "Factor this into your thesis; the disclosure chain shows buy-then-sell on this symbol.",
                    "message": f"Congress sale after buy: {pol}",
                }
            )
            congress_done = True

        if sym in buy_scores or sym in watch_scores:
            sc = buy_scores.get(sym) or watch_scores.get(sym)
            new_bits = "; ".join(signal_narrative(sym, signals)[:3]) or "updated flow and disclosure data."
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "add_to_position",
                    "urgency": "low",
                    "is_informational": False,
                    "shares": int(sh) if sh else None,
                    "company": company,
                    "headline": f"{sym} — Add-to-Position Context (score {sc})",
                    "detail": (
                        f"New signals are reinforcing the thesis for {company}. {new_bits} "
                        f"The original case for owning this stock may be getting stronger."
                    ),
                    "action": "Only add if sizing and risk limits still fit your plan.",
                    "message": f"Scanner score {sc} while position open",
                }
            )

    return alerts


def check_covered_call_alerts(
    covered_calls: list[dict[str, Any]],
    signals: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Covered-call roll / buyback triggers. Uses bid/ask/mid rules; never recommends net-debit rolls.
    """
    from config import (
        CC_ROLL_UP_MAX_DELTA,
        CC_ROLL_UP_MIN_DELTA,
        CC_SELECT_MAX_DELTA,
        CC_SELECT_MIN_DELTA,
        ROLL_EXPIRY_DAYS,
        ROLL_PROFIT_THRESHOLD,
        ROLL_STRIKE_PROXIMITY,
    )

    screener = signals.get("screener") or {}
    if not isinstance(screener, dict):
        screener = {}

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

        row = screener.get(sym) or {}
        try:
            ivr = float(row.get("iv_rank") or 0)
        except (TypeError, ValueError):
            ivr = 0.0
        earn = row.get("next_earnings_date")
        earn_s = str(earn).strip()[:10] if earn is not None and str(earn).strip() else None

        company = uw.get_company_name(sym)
        bid_q, ask_q = _find_contract_quote(sym, strike, expiry_s)
        if ask_q is None or ask_q <= 0:
            continue
        if bid_q is None:
            bid_q = 0.0
        mid_q = (bid_q + ask_q) / 2 if bid_q and ask_q else ask_q
        spread_frac = (ask_q - bid_q) / mid_q if mid_q and mid_q > 0 else 0.0

        dte = (exp_d - today).days
        current_ask = ask_q
        profit_pct = (
            (prem_in - current_ask) / prem_in * 100.0 if prem_in > 0 else 0.0
        )

        if exp_d < today and px < strike:
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "expired_worthless",
                    "urgency": "low",
                    "is_informational": False,
                    "company": company,
                    "headline": f"{sym} — Covered Call Expired Out-of-the-Money",
                    "detail": (
                        f"Your {sym} ${strike:.2f} call expiring {expiry_s} expired with the stock "
                        f"below the strike. Confirm with your broker that the contracts expired worthless."
                    ),
                    "action": "If confirmed, you can sell a new call when IV and liquidity look good.",
                    "message": "Expired OTM",
                }
            )
            continue

        if exp_d < today:
            continue

        chain: list[dict[str, Any]] = []
        try:
            chain = uw.get_options_chain(sym)
        except Exception:
            chain = []

        exclude = (strike, expiry_s)
        new_std = find_optimal_covered_call(
            sym,
            px,
            chain,
            iv_rank=ivr if ivr > 0 else None,
            next_earnings_date=earn_s,
            min_delta=CC_SELECT_MIN_DELTA,
            max_delta=CC_SELECT_MAX_DELTA,
            exclude_strike_expiry=exclude,
        )
        new_roll_up = find_optimal_covered_call(
            sym,
            px,
            chain,
            iv_rank=ivr if ivr > 0 else None,
            next_earnings_date=earn_s,
            min_delta=CC_ROLL_UP_MIN_DELTA,
            max_delta=CC_ROLL_UP_MAX_DELTA,
            min_strike=strike + 0.01,
            exclude_strike_expiry=exclude,
        )

        net_std = (new_std["bid"] - current_ask) if new_std else -1.0
        net_roll_up = (new_roll_up["bid"] - current_ask) if new_roll_up else -1.0

        if profit_pct >= ROLL_PROFIT_THRESHOLD * 100.0 and prem_in > 0:
            if new_std is not None and net_std > 0:
                locked = (prem_in - current_ask) * 100.0
                nb = new_std
                note = nb.get("liquidity_note") or ""
                alerts.append(
                    {
                        "ticker": sym,
                        "alert_type": "cc_roll_early",
                        "urgency": "medium",
                        "is_informational": False,
                        "company": company,
                        "headline": f"{sym} — Roll After {profit_pct:.0f}% Premium Captured",
                        "detail": (
                            f"You sold this call for {_fmt(prem_in)} per share; it now costs {_fmt(current_ask)} "
                            f"(ask) to close — ~{profit_pct:.0f}% of max profit captured with {dte} DTE left.\n"
                            f"Buy back: ~{_fmt(current_ask * 100)} per contract. "
                            f"New: sell {sym} ${float(nb['strike']):.2f} call exp {nb['expiry']} at bid {_fmt(nb['bid'])} "
                            f"(bid/ask/mid {_fmt(nb['bid'])}/{_fmt(nb['ask'])}/{_fmt(nb['mid'])}, spread {nb['spread_pct']:.1f}%).\n"
                            f"Net credit: {_fmt(net_std * 100)} per contract (bid new − ask old). {note}"
                        ),
                        "action": (
                            "If you want to stay in the position, execute the roll for a net credit; "
                            "otherwise buy back only to lock gains."
                        ),
                        "message": "Early profit roll",
                    }
                )
                continue
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "buy_back_profit",
                    "urgency": "medium",
                    "is_informational": False,
                    "company": company,
                    "headline": f"{sym} — Covered Call: Lock In Gain",
                    "detail": (
                        f"Premium captured ~{profit_pct:.0f}%. Closing at ask {_fmt(current_ask)} per share "
                        f"({_fmt(current_ask * 100)} per contract). No attractive net-credit roll was found."
                    ),
                    "action": "Consider buying back to lock the gain; revisit a new short call when IV improves.",
                    "message": "High capture, no roll",
                }
            )
            continue

        prox = (strike - px) / px if px > 0 else 999.0
        if prox <= ROLL_STRIKE_PROXIMITY and new_roll_up is not None and net_roll_up >= 0:
            nb = new_roll_up
            note = nb.get("liquidity_note") or ""
            bre = "breakeven" if net_roll_up == 0 else f"net credit {_fmt(net_roll_up * 100)} per contract"
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "cc_roll_up",
                    "urgency": "high",
                    "is_informational": False,
                    "company": company,
                    "headline": f"{sym} — Roll Up (Strike Threatened)",
                    "detail": (
                        f"{company} is at {_fmt(px)}, only {prox * 100:.1f}% below your ${strike:.2f} strike. "
                        f"Close short leg at ask {_fmt(current_ask)}; open {_fmt(nb['strike'])} strike exp {nb['expiry']} "
                        f"at bid {_fmt(nb['bid'])}. {bre}. {note}"
                    ),
                    "action": "Roll up only if the net meets your target; assignment risk rises near the strike.",
                    "message": "Roll up",
                }
            )
            continue

        if (
            dte <= ROLL_EXPIRY_DAYS
            and px < strike
            and new_std is not None
            and net_std > 0
        ):
            nb = new_std
            alerts.append(
                {
                    "ticker": sym,
                    "alert_type": "cc_roll_out",
                    "urgency": "medium",
                    "is_informational": False,
                    "company": company,
                    "headline": f"{sym} — Roll Out Before Expiry",
                    "detail": (
                        f"Expires in {dte} days; stock {_fmt(px)} vs strike {_fmt(strike)}. "
                        f"Close at ask {_fmt(current_ask)}, sell {_fmt(nb['strike'])} {nb['expiry']} at bid {_fmt(nb['bid'])}. "
                        f"Net credit {_fmt(net_std * 100)} per contract."
                    ),
                    "action": "Extends premium collection if you still like the name.",
                    "message": "Roll out",
                }
            )
            continue

    return alerts
