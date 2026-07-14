"""
paper_portfolio.momentum — Momentum sleeve (sleeve 'M') data loaders, trigger
logic, and order diff. PR-2 of the Two-Sleeve build (spec:
MOMENTUM_SLEEVE_BUILD_SPEC.md; backtest: Strategy_Backtest_2026-07-14.xlsx,
survivorship-controlled +4.7%/yr, Policy A satisfied).

DESIGN (locked 2026-07-14):
  * The sleeve owns the CURRENT public.momentum_list (published monthly by
    the momentum pipeline), equal-weight: capital / list size.
  * Faber crash guard (public.momentum_guard, refreshed daily): when SPY is
    below its 200-day average the sleeve target is ALL CASH.
  * The target is recomputed ONLY on (a) a new monthly publish, or (b) a
    guard flip. No daily churn by design — on every other day the sleeve
    emits zero intents. Trigger state is read from the last 'momentum'
    paper_signal_capture row.
  * Sleeve accounting: sleeve-M holdings are derived from paper_fills rows
    tagged sleeve='M' (net buys - sells per ticker). A name held by BOTH
    sleeves is an intended double position — the scanner sleeve's exit logic
    is told how many shares belong to Momentum and never sells them.

DARK FLAG: the translator only calls into this module when
MOMENTUM_SLEEVE_ENABLED == 'true' AND paper_accounts.sleeve_m_allocation > 0.
Both default off — this code ships dark.

Senior Quant owns the sizing math (build_momentum_target lives in sleeves.py).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from paper_portfolio.diff import OrderIntent
from paper_portfolio.sleeves import SleeveTarget

logger = logging.getLogger("paper_momentum")


def momentum_enabled() -> bool:
    """Dark-flag gate. True only when MOMENTUM_SLEEVE_ENABLED == 'true'."""
    return os.environ.get("MOMENTUM_SLEEVE_ENABLED", "").strip().lower() == "true"


# ─────────────────────────────────────────────────────────────────────────────
# Snapshot dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class MomentumEntry:
    rank: int
    ticker: str
    ret_12_1: float
    insider_badge: bool = False


@dataclass(frozen=True)
class MomentumSnapshot:
    rebalance_date: str                 # publish the list belongs to
    next_rebalance_date: str | None
    entries: list[MomentumEntry]        # rank-ordered
    guard_as_of: str                    # SPY close date the guard evaluated
    guard_invested: bool                # True = own the list; False = all cash
    guard_spy_close: float
    guard_sma_200: float

    @property
    def tickers(self) -> list[str]:
        return [e.ticker for e in self.entries]


@dataclass(frozen=True)
class MomentumTriggerState:
    """What the LAST momentum run acted on (from paper_signal_capture)."""
    rebalance_date: str | None
    guard_invested: bool | None

    def differs_from(self, snap: MomentumSnapshot) -> tuple[bool, str]:
        if self.rebalance_date is None:
            return True, "first momentum run — building the initial book"
        if snap.rebalance_date != self.rebalance_date:
            return True, f"new monthly publish ({snap.rebalance_date})"
        if snap.guard_invested != self.guard_invested:
            state = "INVESTED" if snap.guard_invested else "IN CASH"
            return True, f"crash-guard flip -> {state} (SPY {snap.guard_spy_close:,.2f} vs 200-day {snap.guard_sma_200:,.2f})"
        return False, "no new publish, no guard flip — hold"


# ─────────────────────────────────────────────────────────────────────────────
# Loaders (Supabase Management API, same retry path as signals.py)
# ─────────────────────────────────────────────────────────────────────────────

def _sb(sql: str) -> list[dict[str, Any]]:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN must be set to read momentum tables.")
    from paper_portfolio._sbq import sb_query
    return sb_query(sql, token)


def load_momentum_snapshot() -> MomentumSnapshot:
    """Latest momentum_list publish + latest momentum_guard row.

    Fail-loud: raises when either table is empty or the list is outside the
    spec's 20-50 clamp — a malformed publish must never trade.
    """
    rows = _sb(
        "select rebalance_date::text, rank, ticker, ret_12_1, insider_badge, "
        "next_rebalance_date::text from public.momentum_list "
        "where rebalance_date = (select max(rebalance_date) from public.momentum_list) "
        "order by rank;"
    )
    if not rows:
        raise RuntimeError("momentum_list is empty — no publish to trade.")
    n = len(rows)
    if not (20 <= n <= 50):
        raise RuntimeError(f"momentum_list has {n} names for {rows[0]['rebalance_date']} "
                           "— outside the 20-50 clamp; refusing to trade a malformed publish.")
    guard = _sb(
        "select as_of::text, spy_close, sma_200, invested from public.momentum_guard "
        "order by as_of desc limit 1;"
    )
    if not guard:
        raise RuntimeError("momentum_guard is empty — cannot evaluate the crash guard.")
    g = guard[0]
    return MomentumSnapshot(
        rebalance_date=rows[0]["rebalance_date"],
        next_rebalance_date=rows[0].get("next_rebalance_date"),
        entries=[MomentumEntry(rank=int(r["rank"]), ticker=r["ticker"].upper(),
                               ret_12_1=float(r["ret_12_1"]),
                               insider_badge=bool(r.get("insider_badge")))
                 for r in rows],
        guard_as_of=g["as_of"],
        guard_invested=bool(g["invested"]),
        guard_spy_close=float(g["spy_close"]),
        guard_sma_200=float(g["sma_200"]),
    )


def load_last_trigger_state() -> MomentumTriggerState:
    """Read what the last momentum run acted on. Missing row = never ran."""
    rows = _sb(
        "select signal_payload from public.paper_signal_capture "
        "where signal_source = 'momentum' order by captured_at desc limit 1;"
    )
    if not rows:
        return MomentumTriggerState(rebalance_date=None, guard_invested=None)
    payload = rows[0].get("signal_payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:  # noqa: BLE001
            payload = {}
    return MomentumTriggerState(
        rebalance_date=payload.get("rebalance_date"),
        guard_invested=payload.get("guard_invested"),
    )


def load_sleeve_m_holdings() -> dict[str, float]:
    """{TICKER: net shares} owned by the Momentum sleeve, from paper_fills
    tagged sleeve='M' (buys - sells). Zero/negative nets are dropped."""
    rows = _sb(
        "select ticker, "
        "sum(case when side='buy' then quantity else -quantity end) as net_qty "
        "from public.paper_fills where sleeve = 'M' group by ticker;"
    )
    out: dict[str, float] = {}
    for r in rows:
        q = float(r["net_qty"] or 0)
        if q > 0.0001:
            out[r["ticker"].upper()] = q
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Diff — sleeve-M orders (signal-only, monthly/flip cadence)
# ─────────────────────────────────────────────────────────────────────────────

def build_momentum_intents(
    target: SleeveTarget,
    held_m: dict[str, float],
    eod_prices: dict[str, float],
) -> list[OrderIntent]:
    """Diff the Momentum target vs the sleeve's OWN book.

      * BUY every target name the sleeve does not hold, at the equal-weight
        notional. One entry per publish; no top-ups between publishes.
      * SELL (the sleeve's full share count) every held name absent from the
        target — a name that dropped off the monthly list, or everything
        when the guard target is all-cash.
      * A held target name is a HOLD — never resized on price drift.
    Only sleeve-M shares are ever sold: overlap with the scanner sleeve is an
    intended double position and the other sleeve's shares are untouchable.
    """
    held_m = {t.upper(): q for t, q in held_m.items()}
    targets = {l.ticker.upper(): l for l in target.lines}
    intents: list[OrderIntent] = []

    for ticker, line in targets.items():
        if held_m.get(ticker, 0) > 0:
            continue  # already owned by the sleeve — hold
        price = eod_prices.get(ticker)
        qty = round(line.notional / price, 4) if price and price > 0 else None
        intents.append(OrderIntent(
            sleeve="M", ticker=ticker, side="buy",
            target_quantity=qty, target_notional=round(line.notional, 2),
            signal_score=None, signal_source="momentum",
            rebalance_trigger_reason=f"Momentum entry — {line.rationale}",
        ))

    for ticker, qty in held_m.items():
        if ticker in targets:
            continue
        price = eod_prices.get(ticker)
        notional = round(-(qty * price), 2) if price and price > 0 else 0.0
        reason = ("Crash guard IN CASH — exit whole sleeve to cash"
                  if not target.lines else
                  "Dropped from the monthly momentum list — exit to cash")
        intents.append(OrderIntent(
            sleeve="M", ticker=ticker, side="sell",
            target_quantity=qty, target_notional=notional,
            signal_score=None, signal_source="momentum",
            rebalance_trigger_reason=reason,
        ))

    return intents
