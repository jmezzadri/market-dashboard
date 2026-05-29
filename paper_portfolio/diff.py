"""
paper_portfolio.diff — diff target sleeve positions vs live Alpaca state.

Inputs:
  * Sleeve A SleeveTarget + Sleeve B SleeveTarget (notional, in dollars).
  * Live Alpaca positions (qty, market_value, avg_entry_price).
  * Last-trade price source — pull from Alpaca on demand.

Output: list of OrderIntent rows that, if executed, would move the
account from its current state to the combined target. Each OrderIntent
is tagged with sleeve ('A' or 'B'), side ('buy' or 'sell'), target
notional, and rationale.

Sleeve attribution rule: Alpaca does not natively tag positions by
sleeve. We derive sleeve from the ticker membership:
  * Sleeve A tickers = the set of primary ETFs in the Asset Tilt
                       snapshot (e.g. SOXX, IGV, KBE, …).
  * Sleeve B tickers = everything else held in Alpaca.

If the same ticker would appear in both sleeves (rare — equity scanner
shouldn't surface an ETF, but defensively): Sleeve A claims the share
of qty that matches its target notional; Sleeve B claims the remainder.
v1 logs a warning and treats the ticker as Sleeve A only — Senior Quant
flagged this as a degenerate edge case to revisit if it ever fires.
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
    target_quantity: float | None    # shares — None when price unknown at intent time
    target_notional: float    # signed: + for buy, - for sell on absolute side
    signal_score: int | None  # integer score for Sleeve B; None for Sleeve A
    signal_source: str        # 'asset_tilt' or 'equity_scanner'
    rebalance_trigger_reason: str   # human-readable rationale


def _below_tolerance(diff_abs: float, sleeve: str, sleeve_capital: float) -> bool:
    if sleeve == "A":
        dmin = SLEEVE_A_REBALANCE_DOLLAR_MIN
        pmin = SLEEVE_A_REBALANCE_PCT_MIN
    else:
        dmin = SLEEVE_B_REBALANCE_DOLLAR_MIN
        pmin = SLEEVE_B_REBALANCE_PCT_MIN
    return diff_abs < dmin and (
        diff_abs < (pmin * sleeve_capital) if sleeve_capital else True
    )


def _qty_from_notional(notional: float, last_price: float | None) -> float | None:
    if last_price is None or last_price <= 0:
        return None
    # Use whole-share quantities — Alpaca paper supports fractional but the
    # MOO order type does not (per Alpaca docs). Round to nearest whole share.
    return float(round(notional / last_price))


def build_order_intents(
    sleeve_a_target: SleeveTarget,
    sleeve_b_target: SleeveTarget,
    live_positions: Iterable[AlpacaPosition],
    alpaca: AlpacaPaperClient | None = None,
    asset_tilt_snapshot: AssetTiltSnapshot | None = None,
    suppress_buys: bool = False,
) -> list[OrderIntent]:
    """Compute the buy/sell intent list to move from `live_positions` to
    the combined target across both sleeves.

    `alpaca` is optional — if None, OrderIntent.target_quantity is left as
    None (the Phase 4 submit path can compute qty at submit time). Tests
    pass None to keep the function fully deterministic.

    `suppress_buys=True` (DEGRADED MODE) drops every buy/add intent while
    keeping all sells and orphan exits — used when a decision-moving input is
    stale, so the portfolio de-risks but never adds risk on bad data.

    `asset_tilt_snapshot` is optional but improves orphan-sleeve
    attribution: if a live position is not in either current target, we
    treat it as a Sleeve A exit iff it is anywhere in the snapshot's
    full IG → tickers universe (covers IGs that rotated out today as
    well as alternate ETFs an IG used to map to). Otherwise the orphan
    is exited as Sleeve B.
    """
    # Build target maps keyed by ticker
    a_targets: dict[str, TargetLine] = {l.ticker: l for l in sleeve_a_target.lines}
    b_targets: dict[str, TargetLine] = {l.ticker: l for l in sleeve_b_target.lines}

    # Sleeve A primary ETF set — for sleeve attribution of live positions
    a_etfs = set(a_targets.keys())

    # Wider Sleeve A ETF universe — every ETF that any IG in the snapshot
    # has ever listed as a candidate ticker. Used only for orphan attribution.
    a_etf_universe: set[str] = set(a_etfs)
    if asset_tilt_snapshot is not None:
        for ig_row in asset_tilt_snapshot.raw.get("industry_groups", []) or []:
            for t in (ig_row.get("tickers") or []):
                a_etf_universe.add(t)

    # Index live positions by ticker
    live: dict[str, AlpacaPosition] = {p.ticker: p for p in live_positions}

    intents: list[OrderIntent] = []

    # ── Sleeve A pass ──
    for ticker, line in a_targets.items():
        live_mv = live[ticker].market_value if ticker in live else 0.0
        diff = line.notional - live_mv  # positive → need to buy; negative → sell
        if _below_tolerance(abs(diff), "A", sleeve_a_target.capital_assigned):
            continue
        side = "buy" if diff > 0 else "sell"
        # DEGRADED MODE: suppress NEW BUYS / adds; exits (sells) still run.
        if suppress_buys and side == "buy":
            continue
        last_price = alpaca.get_last_trade_price(ticker) if alpaca else None
        qty = _qty_from_notional(abs(diff), last_price)
        intents.append(OrderIntent(
            sleeve="A",
            ticker=ticker,
            side=side,
            target_quantity=qty,
            target_notional=round(diff, 2),
            signal_score=None,
            signal_source="asset_tilt",
            rebalance_trigger_reason=line.rationale,
        ))

    # ── Orphans: any live position not in either target.
    #             Attribute to Sleeve A iff it's in the wider IG ETF universe
    #             (i.e. an IG-mapped ETF the engine retired today), else
    #             Sleeve B (scanner name that fell below the buy threshold).
    for ticker, pos in live.items():
        if ticker in a_targets or ticker in b_targets:
            continue
        if pos.market_value <= 0:
            continue
        is_sleeve_a = ticker in a_etf_universe
        intents.append(OrderIntent(
            sleeve="A" if is_sleeve_a else "B",
            ticker=ticker,
            side="sell",
            target_quantity=pos.qty,
            target_notional=round(-pos.market_value, 2),
            signal_score=None,
            signal_source="asset_tilt" if is_sleeve_a else "equity_scanner",
            rebalance_trigger_reason=(
                "IG retired from Asset Tilt — close position"
                if is_sleeve_a
                else "Scanner score fell below buy threshold — exit"
            ),
        ))

    # ── Sleeve B pass — buy / resize ──
    for ticker, line in b_targets.items():
        live_mv = live[ticker].market_value if ticker in live else 0.0
        diff = line.notional - live_mv
        if _below_tolerance(abs(diff), "B", sleeve_b_target.capital_assigned):
            continue
        side = "buy" if diff > 0 else "sell"
        # DEGRADED MODE: suppress NEW BUYS / adds; exits (sells) still run.
        if suppress_buys and side == "buy":
            continue
        last_price = alpaca.get_last_trade_price(ticker) if alpaca else None
        # Convert score to integer for the paper_orders.signal_score column
        # (its column type is integer; we round-half-up).
        score_int: int | None = (
            int(round(line.score)) if line.score is not None else None
        )
        qty = _qty_from_notional(abs(diff), last_price)
        intents.append(OrderIntent(
            sleeve="B",
            ticker=ticker,
            side=side,
            target_quantity=qty,
            target_notional=round(diff, 2),
            signal_score=score_int,
            signal_source="equity_scanner",
            rebalance_trigger_reason=line.rationale,
        ))

    return intents
