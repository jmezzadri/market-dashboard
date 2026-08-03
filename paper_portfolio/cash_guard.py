"""paper_portfolio.cash_guard — CASH-CONSERVATION CONSTRAINT for the long-only
sleeves (M = Momentum / Power Trend, B = Insider Conviction).

WHY THIS EXISTS (2026-08-03 incident)
-------------------------------------
Both sleeves are specified long-only, no leverage. Sizing anchors to the
sleeve's prior-day NAV times (1 - SIZING_CASH_BUFFER_PCT), and the diff layer
converts each dollar target into a WHOLE SHARE COUNT at the PRIOR EOD CLOSE.
Those orders then execute at the next morning's opening auction. The share
count is fixed; the fill price is not.

That leaves an exposure the NAV-anchored buffer does not cover, because the
exposure scales with TURNOVER, not with NAV. On 2026-08-03 sleeve M turned
over ~73% of its NAV in one rebalance:

    buy book  @ prior close  $346,284.92   filled  $348,764.78   (+0.72%)
    sell book @ prior close  $348,367.16   filled  $342,177.77   (-1.78%)

$8,669 of execution drag against a 1%-of-NAV buffer worth $4,782. Sleeve cash
went +$4,051.50 -> -$2,535.51: an unintended MARGIN DEBIT, i.e. a rule break.

WHAT THIS MODULE DOES
---------------------
Before the intents are written, the buy book is capped at the cash the sleeve
will actually have:

    expected_proceeds = SUM(sell qty x prior EOD close) x (1 - SELL_GAP_HAIRCUT_PCT)
    available         = sleeve cash (may be negative) + expected_proceeds
    buy_budget        = available x (1 - BUY_GAP_BUFFER_PCT)

If the requested buy notional exceeds the budget, EVERY buy is scaled pro rata
by budget / requested and its share count is re-floored to whole shares (which
only ever spends less). The scale factor and the dollars trimmed are logged.

HARD INVARIANT: if projected post-trade sleeve cash is still negative after
scaling, the buy book is NOT submitted — `CashConservationError` is raised with
the arithmetic in the message. The sell intents ride on the exception so the
caller can still run them: sells RAISE cash and are the repair, never the
cause. A book that would overdraw the sleeve must never be submitted quietly.

This module changes SIZING ONLY. It never decides whether a rebalance happens:
sleeve M still rebalances only on a new monthly power_trend_list publish or a
trend break, and sleeve B only on a scanner signal change. Nothing here can
create an intent, and with an empty intent list every function is a no-op.

Senior Quant owns the two constants (calibration is documented in config.py).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from math import floor

from paper_portfolio.config import BUY_GAP_BUFFER_PCT, SELL_GAP_HAIRCUT_PCT
from paper_portfolio.diff import OrderIntent

logger = logging.getLogger("paper_cash_guard")

SLEEVE_CASH_COLUMN = {"B": "sleeve_b_cash", "M": "sleeve_m_cash"}


@dataclass(frozen=True)
class CashGuardResult:
    """Audit record for one application of the constraint."""
    sleeve: str
    starting_cash: float
    sell_value_at_close: float
    expected_proceeds: float
    available: float
    buy_budget: float
    buy_notional_requested: float
    buy_notional_final: float
    scale_factor: float
    dollars_trimmed: float
    projected_cash: float
    dropped_tickers: list[str] = field(default_factory=list)

    @property
    def scaled(self) -> bool:
        return self.scale_factor < 1.0

    def as_payload(self) -> dict:
        """Compact dict for paper_signal_capture / logging."""
        return {
            "sleeve": self.sleeve,
            "starting_cash": round(self.starting_cash, 2),
            "sell_value_at_close": round(self.sell_value_at_close, 2),
            "expected_proceeds": round(self.expected_proceeds, 2),
            "buy_budget": round(self.buy_budget, 2),
            "buy_notional_requested": round(self.buy_notional_requested, 2),
            "buy_notional_final": round(self.buy_notional_final, 2),
            "scale_factor": round(self.scale_factor, 6),
            "dollars_trimmed": round(self.dollars_trimmed, 2),
            "projected_cash": round(self.projected_cash, 2),
            "dropped_tickers": list(self.dropped_tickers),
            "sell_gap_haircut_pct": SELL_GAP_HAIRCUT_PCT,
            "buy_gap_buffer_pct": BUY_GAP_BUFFER_PCT,
        }


class CashConservationError(RuntimeError):
    """The buy book cannot be sized without overdrawing the sleeve.

    Carries `sell_intents` so the caller can still submit the sells (they raise
    cash) while dropping every buy.
    """

    def __init__(self, message: str, sell_intents: list[OrderIntent],
                 result: CashGuardResult | None = None):
        super().__init__(message)
        self.sell_intents = sell_intents
        self.result = result


# ─────────────────────────────────────────────────────────────────────────────
# Valuation helpers — everything is priced at the PRIOR EOD CLOSE, the same
# price the share counts were built from (never a broker mark; LESSON 8.6).
# ─────────────────────────────────────────────────────────────────────────────

def _price(eod_prices: dict[str, float], ticker: str) -> float | None:
    p = eod_prices.get(ticker.upper())
    return float(p) if p and float(p) > 0 else None


def _sell_value(intent: OrderIntent, eod_prices: dict[str, float]) -> float:
    """Cash a SELL is expected to raise, at the prior close.

    Deliberately values from qty x close and NOT from target_notional: a
    sleeve-B exit carries COST BASIS in target_notional (diff.py), which is
    not what the sale will realise. A sell we cannot price contributes ZERO —
    unverifiable proceeds must never fund a buy.
    """
    px = _price(eod_prices, intent.ticker)
    if px is None or intent.target_quantity is None:
        return 0.0
    return abs(float(intent.target_quantity)) * px


def _buy_cost(intent: OrderIntent, eod_prices: dict[str, float]) -> float:
    """Cash a BUY consumes at the prior close — qty x close when the share
    count is known (that is what the broker will actually debit), else the
    dollar target."""
    px = _price(eod_prices, intent.ticker)
    if px is not None and intent.target_quantity is not None:
        return abs(float(intent.target_quantity)) * px
    return abs(float(intent.target_notional or 0.0))


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve cash reader
# ─────────────────────────────────────────────────────────────────────────────

def load_sleeve_cash(sleeve: str) -> float:
    """Latest paper_nav_daily cash for this sleeve. May be NEGATIVE — that is
    the condition this guard exists to unwind, so it is passed through, never
    clamped at zero.

    A read failure returns 0.0 (and warns): the guard stays armed on the
    proceeds leg rather than being disabled by a database hiccup.
    """
    col = SLEEVE_CASH_COLUMN.get(sleeve.upper())
    if col is None:
        raise ValueError(f"unknown sleeve {sleeve!r} — expected 'B' or 'M'")
    try:
        from paper_portfolio._sbq import sb_query
        rows = sb_query(
            f"select {col} as cash from public.paper_nav_daily "
            "order by snapshot_date desc limit 1;")
        if rows and rows[0].get("cash") is not None:
            return float(rows[0]["cash"])
        logger.warning("no paper_nav_daily row for %s — assuming $0 sleeve cash", col)
    except Exception as exc:  # noqa: BLE001 — sizing must never crash the run
        logger.warning("could not read %s (%s) — assuming $0 sleeve cash", col, exc)
    return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# The constraint
# ─────────────────────────────────────────────────────────────────────────────

def apply_cash_conservation(
    intents: list[OrderIntent],
    sleeve: str,
    sleeve_cash: float,
    eod_prices: dict[str, float],
    sell_haircut_pct: float = SELL_GAP_HAIRCUT_PCT,
    buy_buffer_pct: float = BUY_GAP_BUFFER_PCT,
) -> tuple[list[OrderIntent], CashGuardResult]:
    """Cap this sleeve's buy book at the cash the sleeve will actually have.

    Returns (intents, result). Sells are never modified. Buys are returned
    unchanged when they already fit inside the budget; otherwise every buy is
    scaled pro rata and re-floored to whole shares. Buys that floor below one
    share are dropped (their tickers are listed in `result.dropped_tickers`).

    Raises CashConservationError when the sleeve cannot fund ANY buy book
    without going into debit.

    Worked example (Senior Quant, hand-checked against the real 2026-08-03
    sleeve-M rebalance; see tests/test_cash_guard.py):
      cash $4,051.50; sells 6,540 shares worth $348,367.16 at the 7/31 closes;
      11 buy lines worth $346,284.92 at those same closes.
        expected_proceeds = 348,367.16 x 0.9860 = $343,490.02
        available         = 4,051.50 + 343,490.02 = $347,541.52
        buy_budget        = 347,541.52 x 0.9865 = $342,849.71
        342,849.71 < 346,284.92 -> scale 0.990080, trim $3,435.21
      After the whole-share re-floor the buy book is $341,985.58 at the prior
      closes, and projected post-trade cash is +$5,555.94 instead of the
      -$2,535.51 the account actually printed. Settled at the REAL 8/3 opening
      auction prices the sleeve ends at +$1,803.61 rather than -$2,535.51.
    """
    sleeve = sleeve.upper()
    eod_prices = {t.upper(): p for t, p in (eod_prices or {}).items()}
    sells = [i for i in intents if i.side == "sell"]
    buys = [i for i in intents if i.side == "buy"]
    others = [i for i in intents if i.side not in ("buy", "sell")]

    sell_value = sum(_sell_value(i, eod_prices) for i in sells)
    expected_proceeds = sell_value * (1.0 - sell_haircut_pct)
    available = float(sleeve_cash) + expected_proceeds
    buy_budget = max(0.0, available) * (1.0 - buy_buffer_pct)
    requested = sum(_buy_cost(i, eod_prices) for i in buys)

    def _result(final: float, scale: float, dropped: list[str]) -> CashGuardResult:
        return CashGuardResult(
            sleeve=sleeve,
            starting_cash=float(sleeve_cash),
            sell_value_at_close=sell_value,
            expected_proceeds=expected_proceeds,
            available=available,
            buy_budget=buy_budget,
            buy_notional_requested=requested,
            buy_notional_final=final,
            scale_factor=scale,
            dollars_trimmed=max(0.0, requested - final),
            projected_cash=float(sleeve_cash) + expected_proceeds - final,
            dropped_tickers=dropped,
        )

    # ── HARD INVARIANT, part 1: the sleeve cannot fund any buy at all. ──
    # Happens when cash is already negative and the expected proceeds do not
    # cover the hole. Submitting anything on the buy side here guarantees a
    # deeper debit.
    if buys and available <= 0.0:
        res = _result(0.0, 0.0, sorted(i.ticker.upper() for i in buys))
        # Distinguish "the sleeve is broke" from "we could not price the sells"
        # — both abort (fail-safe: never submit a book we cannot verify), but
        # they are different incidents to investigate.
        unpriced = [i.ticker.upper() for i in sells if _sell_value(i, eod_prices) <= 0]
        if unpriced:
            logger.error(
                "cash guard sleeve %s: %d of %d sells had no usable prior close "
                "(%s) — their proceeds were counted as zero. Check the EOD price "
                "map before treating this as a funding problem.",
                sleeve, len(unpriced), len(sells), ", ".join(sorted(unpriced)))
        msg = (
            f"CASH CONSERVATION ABORT — sleeve {sleeve}: buy book NOT submitted. "
            f"Sleeve cash ${sleeve_cash:,.2f} plus expected sale proceeds "
            f"${expected_proceeds:,.2f} (from ${sell_value:,.2f} at prior closes, "
            f"less a {sell_haircut_pct:.2%} gap haircut) leaves "
            f"${available:,.2f} available — not enough to buy anything without "
            f"going into margin debit. {len(buys)} buy order(s) worth "
            f"${requested:,.2f} were dropped; {len(sells)} sell order(s) still "
            f"run and raise cash. This sleeve is long-only, no leverage."
        )
        logger.error(msg)
        raise CashConservationError(msg, sell_intents=others + sells, result=res)

    # ── No scaling needed — the buy book already fits. ──
    if not buys or requested <= buy_budget:
        res = _result(requested, 1.0, [])
        logger.info(
            "cash guard sleeve %s: no scaling needed — buys $%s within budget $%s "
            "(cash $%s + expected proceeds $%s); projected post-trade cash $%s",
            sleeve, f"{requested:,.2f}", f"{buy_budget:,.2f}",
            f"{sleeve_cash:,.2f}", f"{expected_proceeds:,.2f}",
            f"{res.projected_cash:,.2f}")
        return list(intents), res

    # ── Scale every buy pro rata, then re-floor to whole shares. ──
    scale = buy_budget / requested
    scaled_buys: list[OrderIntent] = []
    dropped: list[str] = []
    final = 0.0
    for i in buys:
        px = _price(eod_prices, i.ticker)
        target = abs(float(i.target_notional or 0.0)) * scale
        if i.target_quantity is not None and px is not None:
            qty = float(floor(_buy_cost(i, eod_prices) * scale / px))
            if qty < 1:
                dropped.append(i.ticker.upper())
                continue
            cost = qty * px
        else:
            # No share count / no price: the submitter will size in dollars.
            qty = i.target_quantity
            cost = target
            if cost <= 0:
                dropped.append(i.ticker.upper())
                continue
        final += cost
        scaled_buys.append(OrderIntent(
            sleeve=i.sleeve, ticker=i.ticker, side=i.side,
            target_quantity=qty, target_notional=round(target, 2),
            signal_score=i.signal_score, signal_source=i.signal_source,
            rebalance_trigger_reason=(
                f"{i.rebalance_trigger_reason} [cash guard: scaled to "
                f"{scale:.4%} of target so the buy book cannot overdraw the "
                f"sleeve]"),
        ))

    res = _result(final, scale, sorted(dropped))
    logger.warning(
        "cash guard sleeve %s: SCALED buy book by %.6f — requested $%s, budget "
        "$%s, final $%s, TRIMMED $%s%s. Cash $%s + expected proceeds $%s "
        "(from $%s at prior closes, less a %.2f%% haircut); projected "
        "post-trade cash $%s.",
        sleeve, scale, f"{requested:,.2f}", f"{buy_budget:,.2f}",
        f"{final:,.2f}", f"{res.dollars_trimmed:,.2f}",
        f" (dropped under 1 share: {', '.join(res.dropped_tickers)})" if dropped else "",
        f"{sleeve_cash:,.2f}", f"{expected_proceeds:,.2f}", f"{sell_value:,.2f}",
        sell_haircut_pct * 100, f"{res.projected_cash:,.2f}")

    # ── HARD INVARIANT, part 2: never return a book that still overdraws. ──
    if res.projected_cash < 0:
        msg = (
            f"CASH CONSERVATION ABORT — sleeve {sleeve}: buy book NOT submitted. "
            f"Even after scaling to {scale:.4%}, projected post-trade cash is "
            f"${res.projected_cash:,.2f} (cash ${sleeve_cash:,.2f} + expected "
            f"proceeds ${expected_proceeds:,.2f} - buys ${final:,.2f}). "
            f"{len(buys)} buy order(s) dropped; {len(sells)} sell order(s) "
            f"still run. This sleeve is long-only, no leverage."
        )
        logger.error(msg)
        raise CashConservationError(msg, sell_intents=others + sells, result=res)

    return others + sells + scaled_buys, res
