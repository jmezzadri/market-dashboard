"""
paper_portfolio.diff — SIGNAL-ONLY rebalance engine.

(Rewritten 2026-06-02, Joe directive.)

DESIGN — trade on SIGNALS, never on price drift:
  * A name is BOUGHT when a signal first appears for it (we hold none).
  * A name is SOLD (fully) when its signal is gone (dropped from the target
    set — scanner score below threshold, or IG rotated out of Asset Tilt).
  * A held name RESIZES only when its SIGNAL changes the target enough — i.e.
    the target notional (computed from signal data) differs from what we paid
    (cost basis) by more than the rebalance band. A Sleeve-B tier move
    ($30K→$50K) or a Sleeve-A weight change trips this; a pure PRICE move never
    does, because we compare target-vs-COST-BASIS, and cost basis only changes
    when we actually trade.

PRICING — everything from the EOD feed (prices_eod / Polygon/Massive):
  * Targets come from signal data (already EOD-derived upstream).
  * Dollar→share conversion uses the EOD close (passed in `eod_prices`).
  * The ONLY things taken from Alpaca are account truth: the QUANTITY held and
    the COST BASIS (what trades actually executed at). No Alpaca prices, no
    Alpaca market_value — those drift intraday and are never used here.

Sleeve attribution: Alpaca doesn't tag positions by sleeve. Sleeve A = the IG
ETF set in the Asset Tilt snapshot (incl. the wider retired-ETF universe);
everything else held is Sleeve B.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from paper_portfolio.alpaca_client import AlpacaPosition, AlpacaPaperClient
from paper_portfolio.config import (
    SLEEVE_A_REBALANCE_DOLLAR_MIN,
    SLEEVE_A_REBALANCE_PCT_MIN,
    SLEEVE_B_REBALANCE_DOLLAR_MIN,
    SLEEVE_B_REBALANCE_PCT_MIN,
)
from paper_portfolio.signals import AssetTiltSnapshot
from paper_portfolio.sleeves import SleeveTarget, TargetLine


@dataclass(frozen=True)
class OrderIntent:
    sleeve: str               # 'A' or 'B'
    ticker: str
    side: str                 # 'buy' or 'sell'
    target_quantity: float | None    # shares — None when no EOD price available
    target_notional: float    # signed: + for buy, - for sell (dollar amount)
    signal_score: int | None  # integer score for Sleeve B; None for Sleeve A
    signal_source: str        # 'asset_tilt' or 'equity_scanner'
    rebalance_trigger_reason: str   # human-readable rationale


def _resize_exceeds_band(target_notional: float, held_basis: float, sleeve: str) -> bool:
    """A HELD name resizes only when its signal-driven target differs from the
    cost basis (what we paid) by more than max(dollar floor, pct × target).
    This is a SIGNAL test, not a price test: held_basis is cost basis, which
    moves only when we trade — so price drift can never trip it."""
    if sleeve == "A":
        dmin, pmin = SLEEVE_A_REBALANCE_DOLLAR_MIN, SLEEVE_A_REBALANCE_PCT_MIN
    else:
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
    sleeve_a_target: SleeveTarget,
    sleeve_b_target: SleeveTarget,
    live_positions: Iterable[AlpacaPosition],
    alpaca: AlpacaPaperClient | None = None,
    asset_tilt_snapshot: AssetTiltSnapshot | None = None,
    suppress_buys: bool = False,
    eod_prices: dict[str, float] | None = None,
    open_order_tickers: set[str] | None = None,
) -> list[OrderIntent]:
    """Signal-only diff. Trades on entry / exit / signal-driven resize only.

    `eod_prices` {TICKER: close} is the gold price source for share sizing.
    `alpaca` is used only as a fallback EOD price for tickers missing from the
    map (rare new listings); never for the rebalance decision itself.
    """
    eod_prices = eod_prices or {}

    # IDEMPOTENCY GUARD (2026-06-04 fix): a ticker that already has an order
    # working at the broker must NOT get a second order this run. The EOD job
    # fires many times each morning; without this, every fire re-bought every
    # name (orders queued-but-unfilled don't show as a held position yet), which
    # stacked single names to ~6x their target. We skip ANY new intent for a
    # ticker that already has a live order.
    open_order_tickers = {t.upper() for t in (open_order_tickers or set())}

    def _has_open_order(ticker: str) -> bool:
        return ticker.upper() in open_order_tickers

    def _eod_price(ticker: str) -> float | None:
        p = eod_prices.get(ticker.upper())
        if p and p > 0:
            return p
        # Fallback ONLY when the gold feed has no row for this ticker.
        return alpaca.get_last_trade_price(ticker) if alpaca else None

    a_targets: dict[str, TargetLine] = {l.ticker: l for l in sleeve_a_target.lines}
    b_targets: dict[str, TargetLine] = {l.ticker: l for l in sleeve_b_target.lines}

    a_etfs = set(a_targets.keys())
    a_etf_universe: set[str] = set(a_etfs)
    if asset_tilt_snapshot is not None:
        for ig_row in asset_tilt_snapshot.raw.get("industry_groups", []) or []:
            for t in (ig_row.get("tickers") or []):
                a_etf_universe.add(t)

    # Held positions: QUANTITY + COST BASIS only (account truth from Alpaca).
    live: dict[str, AlpacaPosition] = {p.ticker: p for p in live_positions}

    intents: list[OrderIntent] = []

    def _basis(ticker: str) -> float:
        pos = live.get(ticker)
        return pos.cost_basis if pos else 0.0

    # ── Sleeve A — Asset Tilt IG ETFs ──
    for ticker, line in a_targets.items():
        held = _basis(ticker)
        if held <= 0:
            # NEW signal — buy in.
            if suppress_buys or _has_open_order(ticker):
                continue
            qty = _qty_from_notional(line.notional, _eod_price(ticker))
            intents.append(OrderIntent(
                sleeve="A", ticker=ticker, side="buy",
                target_quantity=qty, target_notional=round(line.notional, 2),
                signal_score=None, signal_source="asset_tilt",
                rebalance_trigger_reason=f"New Asset Tilt signal — {line.rationale}",
            ))
            continue
        # HELD — resize ONLY if the signal moved the target past the band.
        if _has_open_order(ticker):
            continue
        if not _resize_exceeds_band(line.notional, held, "A"):
            continue
        diff = line.notional - held
        side = "buy" if diff > 0 else "sell"
        if suppress_buys and side == "buy":
            continue
        qty = _qty_from_notional(abs(diff), _eod_price(ticker))
        intents.append(OrderIntent(
            sleeve="A", ticker=ticker, side=side,
            target_quantity=qty, target_notional=round(diff, 2),
            signal_score=None, signal_source="asset_tilt",
            rebalance_trigger_reason=f"Asset Tilt weight changed — {line.rationale}",
        ))

    # ── Sleeve B — Scanner names ──
    for ticker, line in b_targets.items():
        held = _basis(ticker)
        score_int = int(round(line.score)) if line.score is not None else None
        if held <= 0:
            if suppress_buys or _has_open_order(ticker):
                continue
            qty = _qty_from_notional(line.notional, _eod_price(ticker))
            intents.append(OrderIntent(
                sleeve="B", ticker=ticker, side="buy",
                target_quantity=qty, target_notional=round(line.notional, 2),
                signal_score=score_int, signal_source="equity_scanner",
                rebalance_trigger_reason=f"New scanner buy signal — {line.rationale}",
            ))
            continue
        if _has_open_order(ticker):
            continue
        if not _resize_exceeds_band(line.notional, held, "B"):
            continue
        diff = line.notional - held
        side = "buy" if diff > 0 else "sell"
        if suppress_buys and side == "buy":
            continue
        qty = _qty_from_notional(abs(diff), _eod_price(ticker))
        intents.append(OrderIntent(
            sleeve="B", ticker=ticker, side=side,
            target_quantity=qty, target_notional=round(diff, 2),
            signal_score=score_int, signal_source="equity_scanner",
            rebalance_trigger_reason=f"Scanner tier changed — {line.rationale}",
        ))

    # ── EXITS — any held name whose signal is GONE (not in either target). ──
    for ticker, pos in live.items():
        if ticker in a_targets or ticker in b_targets:
            continue
        if pos.qty == 0:
            continue
        if _has_open_order(ticker):
            continue
        is_sleeve_a = ticker in a_etf_universe
        intents.append(OrderIntent(
            sleeve="A" if is_sleeve_a else "B",
            ticker=ticker, side="sell",
            target_quantity=pos.qty,                       # sell the WHOLE position (qty = account truth)
            target_notional=round(-pos.cost_basis, 2),     # report dollars at cost basis (not a live price)
            signal_score=None,
            signal_source="asset_tilt" if is_sleeve_a else "equity_scanner",
            rebalance_trigger_reason=(
                "IG no longer in Asset Tilt — exit"
                if is_sleeve_a
                else "Scanner signal gone — exit"
            ),
        ))

    return intents

