"""
paper_portfolio.diff — SIGNAL-ONLY rebalance engine.

(Rewritten 2026-06-02, Joe directive. Sleeve A retired 2026-06-23 — the
paper portfolio now runs the Equity Scanner sleeve only.)

DESIGN — trade on SIGNALS, never on price drift:
  * A name is BOUGHT when a signal first appears for it (we hold none).
  * A name is SOLD (fully) when its signal is gone (dropped from the target
    set — scanner score below threshold).
  * A held name RESIZES only when its SIGNAL changes the target enough — i.e.
    the target notional (computed from signal data) differs from what we paid
    (cost basis) by more than the rebalance band. A Sleeve-B tier move
    ($30K→$50K) trips this; a pure PRICE move never does, because we compare
    target-vs-COST-BASIS, and cost basis only changes when we actually trade.

PRICING — everything from the EOD feed (prices_eod / Polygon/Massive):
  * Targets come from signal data (already EOD-derived upstream).
  * Dollar→share conversion uses the EOD close (passed in `eod_prices`).
  * The ONLY things taken from Alpaca are account truth: the QUANTITY held and
    the COST BASIS (what trades actually executed at). No Alpaca prices, no
    Alpaca market_value — those drift intraday and are never used here.

EXITS — every held name not in the Sleeve B target is sold to cash. This is
how formerly-Sleeve-A holdings (the retired Asset Tilt industry-group ETFs)
get fully exited on the next run: the Sleeve-A target no longer exists, so
those ETFs are absent from the (only) target and are emitted as exits. No
held position is silently orphaned.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from paper_portfolio.alpaca_client import AlpacaPosition, AlpacaPaperClient
from paper_portfolio.config import (
    SLEEVE_B_REBALANCE_DOLLAR_MIN,  # kept for import-compat (unused: no price/tier resize)
    SLEEVE_B_REBALANCE_PCT_MIN,
    SLEEVE_B_EXIT_THRESHOLD,
)
from paper_portfolio.sleeves import SleeveTarget, TargetLine


@dataclass(frozen=True)
class OrderIntent:
    sleeve: str               # 'B' (Sleeve A retired 2026-06-23)
    ticker: str
    side: str                 # 'buy' or 'sell'
    target_quantity: float | None    # shares — None when no EOD price available
    target_notional: float    # signed: + for buy, - for sell (dollar amount)
    signal_score: int | None  # integer score for Sleeve B
    signal_source: str        # 'equity_scanner'
    rebalance_trigger_reason: str   # human-readable rationale


def _resize_exceeds_band(target_notional: float, held_basis: float) -> bool:
    """A HELD name resizes only when its signal-driven target differs from the
    cost basis (what we paid) by more than max(dollar floor, pct × target).
    This is a SIGNAL test, not a price test: held_basis is cost basis, which
    moves only when we trade — so price drift can never trip it."""
    dmin, pmin = SLEEVE_B_REBALANCE_DOLLAR_MIN, SLEEVE_B_REBALANCE_PCT_MIN
    band = max(dmin, pmin * abs(target_notional))
    return abs(target_notional - held_basis) > band


def _qty_from_notional(notional: float, eod_price: float | None) -> float | None:
    """Convert a dollar trade into shares at the EOD close. Fractional shares
    are allowed (the book is dollar-sized and orders are market/day)."""
    if eod_price is None or eod_price <= 0:
        return None
    return float(round(notional / eod_price, 4))


def build_order_intents(
    sleeve_b_target: SleeveTarget,
    live_positions: Iterable[AlpacaPosition],
    held_scores: dict[str, float] | None = None,
    exit_threshold: float = SLEEVE_B_EXIT_THRESHOLD,
    alpaca: AlpacaPaperClient | None = None,
    suppress_buys: bool = False,
    eod_prices: dict[str, float] | None = None,
    open_order_tickers: set[str] | None = None,
    sleeve_m_qty: dict[str, float] | None = None,
) -> list[OrderIntent]:
    """SIGNAL-ONLY diff with HYSTERESIS + EQUAL-WEIGHT sizing (2026-07-15 rebuild).

      * BUY a target name (buy_score >= buy threshold) not yet held, at the
        equal-weight target size ($500K ÷ N).
      * RESIZE a held target name only when the equal-weight target differs
        from the sleeve's cost basis in it by more than the tolerance band —
        i.e. only when N changed enough to matter; price drift never trades.
      * HOLD a held name that slipped just below the buy line but is still
        >= exit_threshold — this HYSTERESIS is the churn fix: a name bought at
        5 that dips to 4 is held, not dumped-and-rebought the next session.
      * EXIT (sell whole position) only when a held name's score decays below
        exit_threshold, or it leaves the scan entirely (score unknown).
    `held_scores` = {TICKER: current buy_score} for scanned names at/above the
    exit floor. Missing ⇒ off-scan ⇒ decayed ⇒ exit.

    `sleeve_m_qty` = {TICKER: shares owned by the Momentum sleeve} (Two-Sleeve
    build PR-2). The scanner sleeve reasons only about ITS OWN shares:
    Momentum-owned shares are invisible here — never sold by a scanner exit,
    and a name held only by Momentum still gets its scanner entry (overlap =
    intended double position).
    """
    eod_prices = eod_prices or {}
    sleeve_m_qty = {t.upper(): q for t, q in (sleeve_m_qty or {}).items()}
    held_scores = {t.upper(): v for t, v in (held_scores or {}).items()}
    open_order_tickers = {t.upper() for t in (open_order_tickers or set())}

    def _has_open_order(ticker: str) -> bool:
        return ticker.upper() in open_order_tickers

    def _eod_price(ticker: str):
        p = eod_prices.get(ticker.upper())
        if p and p > 0:
            return p
        return alpaca.get_last_trade_price(ticker) if alpaca else None

    b_targets: dict[str, TargetLine] = {l.ticker: l for l in sleeve_b_target.lines}
    live: dict[str, AlpacaPosition] = {p.ticker: p for p in live_positions}
    intents: list[OrderIntent] = []

    def _qty_held(ticker: str) -> float:
        """Shares the SCANNER sleeve owns = broker position minus the
        Momentum sleeve's shares in the same name."""
        pos = live.get(ticker)
        if not pos:
            return 0.0
        return max(0.0, pos.qty - sleeve_m_qty.get(ticker.upper(), 0.0))

    # ── ENTRIES + RESIZES (equal-weight rebuild 2026-07-15) ──
    # A target name not held is BOUGHT at the equal-weight notional. A HELD
    # target name is RESIZED toward the new equal-weight notional only when
    # its target differs from the sleeve's COST BASIS in the name by more
    # than the band (max($500, 3% of target)). Comparing against cost basis
    # keeps this signal-only: the target moves only when N (the qualifying
    # count) changes, and basis moves only when we trade — price drift alone
    # can never trip a trade.
    for ticker, line in b_targets.items():
        held_qty = _qty_held(ticker)
        if held_qty > 0:
            pos = live.get(ticker)
            own_basis = (pos.cost_basis * (held_qty / pos.qty)) if (pos and pos.qty) else 0.0
            if not _resize_exceeds_band(line.notional, own_basis):
                continue  # inside the band — HOLD, no churn
            if _has_open_order(ticker):
                continue
            delta = line.notional - own_basis
            if delta > 0 and suppress_buys:
                continue
            qty = _qty_from_notional(abs(delta), _eod_price(ticker))
            if delta < 0 and qty is not None:
                qty = min(qty, held_qty)  # never sell more than the sleeve owns
            score_int = int(round(line.score)) if line.score is not None else None
            intents.append(OrderIntent(
                sleeve="B", ticker=ticker, side="buy" if delta > 0 else "sell",
                target_quantity=qty, target_notional=round(delta, 2),
                signal_score=score_int, signal_source="equity_scanner",
                rebalance_trigger_reason=(
                    f"Equal-weight re-split — resize from ${own_basis:,.0f} invested "
                    f"to ${line.notional:,.0f} ({line.rationale})"),
            ))
            continue
        if suppress_buys or _has_open_order(ticker):
            continue
        qty = _qty_from_notional(line.notional, _eod_price(ticker))
        score_int = int(round(line.score)) if line.score is not None else None
        intents.append(OrderIntent(
            sleeve="B", ticker=ticker, side="buy",
            target_quantity=qty, target_notional=round(line.notional, 2),
            signal_score=score_int, signal_source="equity_scanner",
            rebalance_trigger_reason=f"New scanner buy signal — {line.rationale}",
        ))

    # ── EXITS with HYSTERESIS — held names not in the buy target. ──
    for ticker, pos in live.items():
        if ticker in b_targets:
            continue
        own_qty = max(0.0, pos.qty - sleeve_m_qty.get(ticker.upper(), 0.0))
        if own_qty <= 0.0001 or _has_open_order(ticker):
            continue  # nothing of ours to sell (position is Momentum's)
        cur = held_scores.get(ticker.upper())
        if cur is not None and cur >= exit_threshold:
            continue  # still above the exit floor — HOLD through the wobble (no churn)
        reason = ("Signal decayed below exit floor — exit to cash"
                  if cur is not None else "Signal gone from scan — exit to cash")
        own_basis = pos.cost_basis * (own_qty / pos.qty) if pos.qty else 0.0
        intents.append(OrderIntent(
            sleeve="B", ticker=ticker, side="sell",
            target_quantity=own_qty,
            target_notional=round(-own_basis, 2),
            signal_score=None, signal_source="equity_scanner",
            rebalance_trigger_reason=reason,
        ))

    return intents
