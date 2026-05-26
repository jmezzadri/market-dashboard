"""
paper_portfolio.backtest.fills — simulate market-on-open fills.

Every OrderIntent generated on date D is assumed to fill at the OPEN
price on date D+1 (next business day). Sim is intentionally conservative:
  * no slippage modeling beyond using OPEN (already a worse fill than
    intraday mid for the buyer in a typical uptrend).
  * fractional shares allowed in sim (cleaner sleeve isolation).
  * if the OPEN price is missing for ticker T on D+1, the order is
    treated as REJECTED (counts toward rejection_rate but does not
    alter position).
  * dividends and splits are applied via prices_eod's existing
    adjusted-price treatment (we read adj_open/adj_close).

This module is pure given a prices_eod DataFrame slice — no live
network calls. The harness pre-fetches prices for the full universe +
window once and passes the panel in.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from paper_portfolio.diff import OrderIntent


@dataclass(frozen=True)
class SimFill:
    sleeve: str
    ticker: str
    side: str           # 'buy' / 'sell'
    fill_date: pd.Timestamp
    fill_price: float
    qty: float
    notional: float     # signed: + for buy, - for sell
    rejected: bool = False
    rejection_reason: str = ""


def simulate_fills(
    intents: list[OrderIntent],
    fill_date: pd.Timestamp,
    open_prices: pd.Series,
) -> list[SimFill]:
    """Convert OrderIntents to SimFills at the named fill_date's open.

    open_prices: Series indexed by ticker with that date's adj_open.
    Missing tickers → rejected fills.
    """
    out: list[SimFill] = []
    for intent in intents:
        px = open_prices.get(intent.ticker)
        if px is None or pd.isna(px) or px <= 0:
            out.append(SimFill(
                sleeve=intent.sleeve,
                ticker=intent.ticker,
                side=intent.side,
                fill_date=fill_date,
                fill_price=0.0,
                qty=0.0,
                notional=0.0,
                rejected=True,
                rejection_reason=f"no open price for {intent.ticker} on {fill_date.date()}",
            ))
            continue
        notional_abs = abs(intent.target_notional)
        qty = notional_abs / float(px)
        signed_notional = notional_abs if intent.side == "buy" else -notional_abs
        out.append(SimFill(
            sleeve=intent.sleeve,
            ticker=intent.ticker,
            side=intent.side,
            fill_date=fill_date,
            fill_price=float(px),
            qty=qty if intent.side == "buy" else -qty,
            notional=signed_notional,
        ))
    return out


def apply_fills_to_positions(
    positions: dict[str, dict],
    fills: list[SimFill],
) -> dict[str, dict]:
    """Apply a list of SimFills to a positions dict.

    positions schema:
      { ticker: { 'sleeve': 'A'|'B', 'qty': float, 'cost_basis': float } }

    Returns the mutated dict (in-place mutation + return for chaining).
    """
    for f in fills:
        if f.rejected:
            continue
        slot = positions.setdefault(f.ticker, {
            "sleeve": f.sleeve, "qty": 0.0, "cost_basis": 0.0,
        })
        slot["qty"] += f.qty                     # qty already signed in SimFill
        slot["cost_basis"] += f.notional         # notional already signed
        # Update sleeve tag if a position is being re-opened on the other
        # sleeve (shouldn't happen in practice — defensive).
        if abs(slot["qty"]) < 1e-9:
            # Position closed — drop the row to keep the dict tidy.
            positions.pop(f.ticker, None)
        else:
            slot["sleeve"] = f.sleeve
    return positions


def mark_to_market(
    positions: dict[str, dict],
    close_prices: pd.Series,
) -> dict[str, float]:
    """Return {ticker: market_value} for each open position using close prices.

    Missing close prices fall back to last known cost basis / qty estimate
    (zero gain), which is a conservative choice for backtest reporting.
    """
    out: dict[str, float] = {}
    for ticker, slot in positions.items():
        px = close_prices.get(ticker)
        if px is None or pd.isna(px) or px <= 0:
            # Fall back: pretend MTM equals cost basis (zero gain that day).
            px_est = (slot["cost_basis"] / slot["qty"]) if slot["qty"] else 0.0
            out[ticker] = float(slot["qty"] * px_est)
        else:
            out[ticker] = float(slot["qty"] * float(px))
    return out
