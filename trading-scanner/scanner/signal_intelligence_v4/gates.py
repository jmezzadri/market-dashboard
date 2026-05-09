"""
v4.1 Gates — Insider, Liquidity, Anti-Hedge.

All three gates must PASS for a name to be considered actionable.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

INSIDER_LOOKBACK_DAYS = 30          # Gate 1: 30-day window for insider P-buys
FIRST_BUY_LOOKBACK_DAYS = 365       # Gate 1.1: 12 months prior with no P-buy
LIQUIDITY_PRICE_FLOOR = 5.0         # Gate 2: price > $5
LIQUIDITY_AVG_VOLUME_FLOOR = 500_000  # Gate 2: 22-day avg volume > 500k

HEDGE_TICKERS = frozenset({         # Gate 3: anti-hedge exclusions
    "SPY", "QQQ", "IWM", "DIA", "VTI",
})

# Transaction codes for the Insider Gate filter
P_CODE = "P"  # Open Market Purchase — the only code Gate 1 counts
S_CODE = "S"  # Open Market Sale — used for exit rules


def is_first_buy(
    owner_name: str,
    score_date: date,
    history: list[dict[str, Any]],
    insider_window_days: int = INSIDER_LOOKBACK_DAYS,
    first_buy_lookback_days: int = FIRST_BUY_LOOKBACK_DAYS,
) -> bool:
    """
    True if the owner has NO P-buy in the `first_buy_lookback_days` window
    that ENDS at the start of the current insider gate window.

    Args:
        owner_name: insider's normalized name (lowercased, stripped).
        score_date: today's score date.
        history: full P-buy history of THIS ticker (any owner). Each row:
            {"date": date, "owner": str (normalized), "transaction_code": "P"}
        insider_window_days: gate 1 lookback (default 30).
        first_buy_lookback_days: prior period to check (default 365 = 12 months).

    Returns:
        True if no prior P-buy by this owner in the lookback period
        BEFORE the gate window's cutoff. False otherwise.
    """
    gate_window_start = score_date - timedelta(days=insider_window_days)
    lookback_start = gate_window_start - timedelta(days=first_buy_lookback_days)
    target = (owner_name or "").strip().lower()
    if not target:
        return False  # unknown owner — can't classify, treat as repeat to be safe
    for row in history:
        if (row.get("owner") or "").strip().lower() != target:
            continue
        d = row.get("date")
        if not isinstance(d, date):
            continue
        if lookback_start <= d < gate_window_start:
            return False  # found a prior P-buy → not a first-buy
    return True


def insider_gate_passes(
    score_date: date,
    insider_history: list[dict[str, Any]],
    require_first_buy: bool = True,
    insider_window_days: int = INSIDER_LOOKBACK_DAYS,
    first_buy_lookback_days: int = FIRST_BUY_LOOKBACK_DAYS,
    *,
    ticker: str | None = None,
    data_source: str = "memory",
) -> dict[str, Any]:
    """
    Apply Gate 1 + Gate 1.1 (first-buy filter) to one ticker on one score date.

    Args:
        score_date: the date we're scoring.
        insider_history: insider events for this ticker covering AT LEAST the
            30-day gate window. In "memory" mode, the list MUST also span the
            12-month lookback for the first-buy check. In "supabase" mode,
            only the 30-day window is needed — the 12-month lookback is run
            as a Supabase query against `insider_history` table.
        require_first_buy: if True (v4.1 default), require ≥1 first-buyer.
        insider_window_days: gate 1 window (default 30).
        first_buy_lookback_days: gate 1.1 prior period (default 365).
        ticker: required when data_source="supabase" — used by query_first_buy.
        data_source: "memory" (test/local) or "supabase" (production).
            "memory" runs the 12-month first-buy check against `insider_history`.
            "supabase" calls `insider_ingest.query_first_buy()` per buyer —
            requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.

    Returns:
        {
            "passes": bool,
            "p_buys_in_window": int,
            "unique_p_buyers": int,
            "first_buyers": list[str],
            "total_dollar": float,
            "data_source": str,
        }
    """
    if data_source == "supabase" and not ticker:
        raise ValueError("data_source='supabase' requires ticker=...")

    cutoff = score_date - timedelta(days=insider_window_days)
    p_buys_in_window = [
        e for e in insider_history
        if isinstance(e.get("date"), date)
        and cutoff <= e["date"] <= score_date
        and (e.get("transaction_code") or "").upper() == P_CODE
    ]
    unique_owners = {(e.get("owner") or "").strip().lower() for e in p_buys_in_window}
    unique_owners.discard("")

    first_buyers: list[str] = []
    if require_first_buy:
        if data_source == "supabase":
            # Production path — Supabase-backed first-buy lookup.
            from scanner.signal_intelligence_v4.insider_ingest import query_first_buy
            for owner in unique_owners:
                if query_first_buy(
                    ticker=ticker,
                    owner_name=owner,
                    score_date=score_date,
                    insider_window_days=insider_window_days,
                    first_buy_lookback_days=first_buy_lookback_days,
                ):
                    first_buyers.append(owner)
        else:
            # In-memory path (used by tests + local backtests).
            for owner in unique_owners:
                if is_first_buy(
                    owner_name=owner,
                    score_date=score_date,
                    history=[e for e in insider_history
                             if (e.get("transaction_code") or "").upper() == P_CODE],
                    insider_window_days=insider_window_days,
                    first_buy_lookback_days=first_buy_lookback_days,
                ):
                    first_buyers.append(owner)

    if require_first_buy:
        passes = len(first_buyers) >= 1
    else:
        passes = len(unique_owners) >= 1

    total_dollar = sum(
        abs(float(e.get("amount") or 0)) * float(e.get("stock_price") or 0)
        for e in p_buys_in_window
    )

    return {
        "passes": passes,
        "p_buys_in_window": len(p_buys_in_window),
        "unique_p_buyers": len(unique_owners),
        "first_buyers": first_buyers,
        "total_dollar": total_dollar,
        "data_source": data_source,
    }


def liquidity_gate_passes(
    today_close: float,
    avg_volume_22d: float,
    price_floor: float = LIQUIDITY_PRICE_FLOOR,
    volume_floor: float = LIQUIDITY_AVG_VOLUME_FLOOR,
) -> bool:
    """Gate 2: price > $5 AND 22-day avg volume > 500k."""
    if today_close is None or avg_volume_22d is None:
        return False
    return today_close > price_floor and avg_volume_22d > volume_floor


def anti_hedge_gate_passes(ticker: str) -> bool:
    """Gate 3: ticker not in HEDGE_TICKERS."""
    return (ticker or "").upper() not in HEDGE_TICKERS


def apply_gates(
    ticker: str,
    score_date: date,
    today_close: float,
    avg_volume_22d: float,
    insider_history: list[dict[str, Any]],
    require_first_buy: bool = True,
    data_source: str = "memory",
) -> dict[str, Any]:
    """
    Apply all three gates. Returns full diagnostic.

    A name is actionable IFF all three gates return passes=True.

    Args:
        data_source: "memory" (default — used by tests + local backtests)
                     or "supabase" (production — first-buy check via
                     query_first_buy() against insider_history table).
    """
    g2 = liquidity_gate_passes(today_close, avg_volume_22d)
    g3 = anti_hedge_gate_passes(ticker)
    g1 = insider_gate_passes(
        score_date=score_date,
        insider_history=insider_history,
        require_first_buy=require_first_buy,
        ticker=ticker,
        data_source=data_source,
    )
    all_pass = g1["passes"] and g2 and g3
    return {
        "ticker": ticker.upper(),
        "score_date": score_date.isoformat(),
        "all_pass": all_pass,
        "gate_1_insider": g1,
        "gate_2_liquidity": g2,
        "gate_3_anti_hedge": g3,
        "data_source": data_source,
    }
