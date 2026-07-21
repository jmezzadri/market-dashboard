"""
paper_portfolio.momentum — Momentum sleeve (sleeve 'M'), driven by the
POWER TREND signal (swapped in 2026-07-15, Joe decision; replaces the 12-1
momentum list + Faber crash guard; backtest record:
Power_Trend_Breakout_Simulation.xlsx — 2020–2026 portfolio simulation with
the 8-name floor: 18.2%/yr vs SPY 14.8%, Sharpe 1.26, MaxDD −19.7%; run on
a survivor cohort, so live results are expected to run below the backtest).

DESIGN (locked 2026-07-15):
  * The sleeve owns the CURRENT public.power_trend_list (published monthly
    on the 1st by POWER-TREND-LIST-MONTHLY; producer caps at 15 names),
    equal-weight with a MIN-8 floor: per-name = capital / max(N, 8) —
    fewer than 8 firing names leaves the unfilled slots in cash.
  * A publish containing only the CASH sentinel row (ticker='CASH', rank=0)
    means zero names fired — the sleeve target is ALL CASH.
  * The target is recomputed ONLY on a new monthly publish. No daily churn
    by design — on every other day the sleeve emits zero intents. Trigger
    state is read from the last 'momentum' paper_signal_capture row.
  * On a publish, held names still on the list are RESIZED to the new
    equal weight when they drift beyond the tolerance band; names that
    dropped off are sold; new names are bought.
  * Sleeve accounting: sleeve-M holdings are derived from paper_fills rows
    tagged sleeve='M' (net buys - sells per ticker). A name held by BOTH
    sleeves is an intended double position — the scanner sleeve's exit logic
    is told how many shares belong to Momentum and never sells them.

DARK FLAG: the translator only calls into this module when
MOMENTUM_SLEEVE_ENABLED == 'true' AND paper_accounts.sleeve_m_allocation > 0.

Senior Quant owns the sizing math (build_momentum_target lives in sleeves.py).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

from paper_portfolio.config import (
    SLEEVE_B_REBALANCE_DOLLAR_MIN,
    SLEEVE_B_REBALANCE_PCT_MIN,
    SLEEVE_M_MAX_NAMES,
)
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
class PowerTrendEntry:
    rank: int
    ticker: str
    roc_3m: float          # 3-month return, percent (e.g. 145.0)
    rs_vs_spx: float = 0.0 # points over the S&P 500's 3-month return


@dataclass(frozen=True)
class PowerTrendSnapshot:
    rebalance_date: str                 # publish the list belongs to
    next_rebalance_date: str | None
    entries: list[PowerTrendEntry]      # rank-ordered; empty when all_cash
    all_cash: bool                      # CASH-sentinel publish (zero names fired)

    @property
    def tickers(self) -> list[str]:
        return [e.ticker for e in self.entries]


# Back-compat alias (tests / older imports)
MomentumSnapshot = PowerTrendSnapshot


@dataclass(frozen=True)
class MomentumTriggerState:
    """What the LAST momentum run acted on (from paper_signal_capture)."""
    rebalance_date: str | None

    def differs_from(self, snap: PowerTrendSnapshot) -> tuple[bool, str]:
        if self.rebalance_date is None:
            return True, "first Power Trend run — building the initial book"
        if snap.rebalance_date != self.rebalance_date:
            return True, f"new monthly Power Trend publish ({snap.rebalance_date})"
        return False, "no new publish — hold"


# ─────────────────────────────────────────────────────────────────────────────
# Loaders (Supabase Management API, same retry path as signals.py)
# ─────────────────────────────────────────────────────────────────────────────

def _sb(sql: str) -> list[dict[str, Any]]:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN must be set to read power_trend_list.")
    from paper_portfolio._sbq import sb_query
    return sb_query(sql, token)


def load_momentum_snapshot() -> PowerTrendSnapshot:
    """Latest power_trend_list publish.

    Fail-loud: raises when the table is empty or the list exceeds the
    producer's 15-name cap — a malformed publish must never trade.
    A single CASH sentinel row (ticker='CASH', rank=0) = all-cash month.
    """
    rows = _sb(
        "select rebalance_date::text, rank, ticker, roc_3m, rs_vs_spx, "
        "next_rebalance_date::text from public.power_trend_list "
        "where rebalance_date = (select max(rebalance_date) from public.power_trend_list) "
        "order by rank;"
    )
    if not rows:
        raise RuntimeError("power_trend_list is empty — no publish to trade.")
    rebalance_date = rows[0]["rebalance_date"]
    next_date = rows[0].get("next_rebalance_date")
    real = [r for r in rows if (r["ticker"] or "").upper() != "CASH"]
    if not real:
        return PowerTrendSnapshot(rebalance_date=rebalance_date,
                                  next_rebalance_date=next_date,
                                  entries=[], all_cash=True)
    n = len(real)
    if n > SLEEVE_M_MAX_NAMES:
        raise RuntimeError(
            f"power_trend_list has {n} names for {rebalance_date} — above the "
            f"{SLEEVE_M_MAX_NAMES}-name cap; refusing to trade a malformed publish.")
    return PowerTrendSnapshot(
        rebalance_date=rebalance_date,
        next_rebalance_date=next_date,
        entries=[PowerTrendEntry(rank=int(r["rank"]), ticker=r["ticker"].upper(),
                                 roc_3m=float(r["roc_3m"] or 0),
                                 rs_vs_spx=float(r.get("rs_vs_spx") or 0))
                 for r in real],
        all_cash=False,
    )


def load_last_trigger_state() -> MomentumTriggerState:
    """Read what the last momentum run acted on. Missing row = never ran.
    (Pre-swap rows carry the old 12-1 list's rebalance_date — any Power Trend
    publish date differs from those, so the first post-swap run fires.)"""
    rows = _sb(
        "select signal_payload from public.paper_signal_capture "
        "where signal_source = 'momentum' order by captured_at desc limit 1;"
    )
    if not rows:
        return MomentumTriggerState(rebalance_date=None)
    payload = rows[0].get("signal_payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:  # noqa: BLE001
            payload = {}
    return MomentumTriggerState(rebalance_date=payload.get("rebalance_date"))


def load_trend_breaks(held_tickers: list[str]) -> set[str]:
    """Held names whose latest complete-panel close sits below ALL FOUR EMAs
    (10/21/50/200) — the daily trend-break stop (Joe decision 2026-07-15;
    backtested: cuts worst drawdown −40% → −30% for ~6.6 CAGR points, fires
    ~2×/month). Uses public.power_trend_trend_break (migration 083), the same
    EMA math as the scan. Empty input → empty set; a lookup failure raises so
    the caller can skip the check loudly rather than silently not stopping."""
    if not held_tickers:
        return set()
    arr = ",".join("'" + t.upper().replace("'", "''") + "'" for t in sorted(set(held_tickers)))
    rows = _sb(f"select ticker from public.power_trend_trend_break(array[{arr}]);")
    return {r["ticker"].upper() for r in rows}


def build_trend_break_intents(
    breaks: set[str],
    held_m: dict[str, float],
    eod_prices: dict[str, float],
) -> list[OrderIntent]:
    """SELL (full sleeve position) every held name on the break list. Proceeds
    rest in cash until the next monthly publish — no mid-month re-entry, per
    the backtested rule."""
    intents: list[OrderIntent] = []
    for ticker in sorted(breaks):
        qty = held_m.get(ticker.upper(), 0)
        if qty <= 0.0001:
            continue
        price = eod_prices.get(ticker.upper())
        notional = round(-(qty * price), 2) if price and price > 0 else 0.0
        intents.append(OrderIntent(
            sleeve="M", ticker=ticker.upper(), side="sell",
            target_quantity=qty, target_notional=notional,
            signal_score=None, signal_source="momentum",
            rebalance_trigger_reason=("Trend break — closed below all four moving "
                                      "averages (10/21/50/200-day); exit to cash "
                                      "until the next monthly list"),
        ))
    return intents


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
# Diff — sleeve-M orders (signal-only, monthly cadence)
# ─────────────────────────────────────────────────────────────────────────────

def build_momentum_intents(
    target: SleeveTarget,
    held_m: dict[str, float],
    eod_prices: dict[str, float],
) -> list[OrderIntent]:
    """Diff the Power Trend target vs the sleeve's OWN book.

      * BUY every target name the sleeve does not hold, at the equal-weight
        notional.
      * RESIZE a held target name to the new equal weight when its current
        value (shares × EOD close) differs from the target by more than the
        tolerance band — this only ever runs on a publish day, so it is the
        monthly rebalance, not price-chasing.
      * SELL (the sleeve's full share count) every held name absent from the
        target — a name that dropped off the monthly list, or everything
        on an all-cash publish.
    Only sleeve-M shares are ever sold: overlap with the scanner sleeve is an
    intended double position and the other sleeve's shares are untouchable.
    """
    held_m = {t.upper(): q for t, q in held_m.items()}
    targets = {l.ticker.upper(): l for l in target.lines}
    intents: list[OrderIntent] = []

    def _band(target_notional: float) -> float:
        return max(SLEEVE_B_REBALANCE_DOLLAR_MIN,
                   SLEEVE_B_REBALANCE_PCT_MIN * abs(target_notional))

    for ticker, line in targets.items():
        price = eod_prices.get(ticker)
        held_qty = held_m.get(ticker, 0)
        if held_qty > 0:
            if not price or price <= 0:
                continue  # no reliable mark — hold rather than mis-size
            current = held_qty * price
            delta = line.notional - current
            if abs(delta) <= _band(line.notional):
                continue  # inside the band — hold
            qty = float(int(abs(delta) // price))  # whole shares (2026-07-21)
            if qty < 1:
                continue  # resize smaller than one whole share — hold
            if delta < 0:
                qty = min(qty, held_qty)
            intents.append(OrderIntent(
                sleeve="M", ticker=ticker, side="buy" if delta > 0 else "sell",
                target_quantity=qty, target_notional=round(delta, 2),
                signal_score=None, signal_source="momentum",
                rebalance_trigger_reason=(
                    f"Monthly Power Trend rebalance — resize to equal weight "
                    f"(${line.notional:,.0f}; {line.rationale})"),
            ))
            continue
        qty = float(int(line.notional // price)) if price and price > 0 else None
        if qty is not None and qty < 1:
            continue  # entry smaller than one whole share — skip
        intents.append(OrderIntent(
            sleeve="M", ticker=ticker, side="buy",
            target_quantity=qty, target_notional=round(line.notional, 2),
            signal_score=None, signal_source="momentum",
            rebalance_trigger_reason=f"Power Trend entry — {line.rationale}",
        ))

    for ticker, qty in held_m.items():
        if ticker in targets:
            continue
        price = eod_prices.get(ticker)
        notional = round(-(qty * price), 2) if price and price > 0 else 0.0
        reason = ("All-cash Power Trend publish — exit whole sleeve to cash"
                  if not target.lines else
                  "Dropped from the monthly Power Trend list — exit to cash")
        intents.append(OrderIntent(
            sleeve="M", ticker=ticker, side="sell",
            target_quantity=qty, target_notional=notional,
            signal_score=None, signal_source="momentum",
            rebalance_trigger_reason=reason,
        ))

    return intents
