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

# Cap-normalized magnitude thresholds (v4.1.1, 2026-05-09)
# Gate 1 magnitude: insider P-buy aggregate in 30-day window must clear
# the LARGER of 2 basis points of market cap OR a $500k absolute floor.
# This makes a $5M buy at a $300M co (160 bps) and a $50M buy at a $25B
# co (20 bps) both readable as "insiders putting real money to work,"
# while the $500k floor stops random rounding-error trades from passing
# at the small-cap end.
MAGNITUDE_BPS = 0.0002              # 2 bps of market cap
MAGNITUDE_FLOOR_DOLLARS = 500_000   # $500k absolute floor

# High-Conviction sizing tiebreaker — score >= 45 requires this stricter
# threshold to land in the High Conviction band (else falls to Watch).
HC_MAGNITUDE_BPS = 0.0005           # 5 bps of market cap
HC_MAGNITUDE_FLOOR_DOLLARS = 5_000_000  # $5M absolute floor

HEDGE_TICKERS = frozenset({         # Gate 3: anti-hedge exclusions
    "SPY", "QQQ", "IWM", "DIA", "VTI",
})

# Transaction codes for the Insider Gate filter
P_CODE = "P"  # Open Market Purchase — the only code Gate 1 counts
S_CODE = "S"  # Open Market Sale — used for exit rules


def magnitude_threshold(market_cap_dollars: float) -> float:
    """
    Cap-normalized Gate 1 magnitude threshold.

    Returns the dollar amount of insider P-buy aggregate (across the 30-day
    window) required to clear Gate 1 for a company of size `market_cap_dollars`.

    Threshold = max(2 bps of market cap, $500k floor).

    Examples:
        $500M cap   → max($100k,  $500k)    = $500k    (floor binds)
        $5B cap     → max($1M,    $500k)    = $1M
        $25B cap    → max($5M,    $500k)    = $5M
        $500B cap   → max($100M,  $500k)    = $100M
        $4T cap     → max($800M,  $500k)    = $800M
    """
    if market_cap_dollars is None or market_cap_dollars <= 0:
        return MAGNITUDE_FLOOR_DOLLARS
    return max(MAGNITUDE_BPS * float(market_cap_dollars), MAGNITUDE_FLOOR_DOLLARS)


def hc_magnitude_threshold(market_cap_dollars: float) -> float:
    """
    Cap-normalized High-Conviction sizing tiebreaker.

    A name with score >= HIGH_CONVICTION_THRESHOLD lands in High Conviction
    only if its insider P-buy aggregate also clears this stricter threshold.
    Names that score >= 45 but fall short here are demoted to Watch.

    Threshold = max(5 bps of market cap, $5M floor).

    Examples:
        $500M cap   → max($250k,  $5M)      = $5M       (floor binds)
        $5B cap     → max($2.5M,  $5M)      = $5M       (floor binds)
        $25B cap    → max($12.5M, $5M)      = $12.5M
        $500B cap   → max($250M,  $5M)      = $250M
        $4T cap     → max($2B,    $5M)      = $2B
    """
    if market_cap_dollars is None or market_cap_dollars <= 0:
        return HC_MAGNITUDE_FLOOR_DOLLARS
    return max(HC_MAGNITUDE_BPS * float(market_cap_dollars), HC_MAGNITUDE_FLOOR_DOLLARS)


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
    market_cap: float | None = None,
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
        market_cap: company market capitalization in dollars. When provided,
            the gate also requires insider P-buy aggregate ≥
            magnitude_threshold(market_cap). When None, the magnitude check
            is skipped (legacy behavior).

    Returns:
        {
            "passes": bool,
            "p_buys_in_window": int,
            "unique_p_buyers": int,
            "first_buyers": list[str],
            "total_dollar": float,
            "magnitude_passes": bool,        # True when market_cap is None OR
                                              # total_dollar ≥ magnitude_threshold.
            "magnitude_threshold": float,    # threshold used; floor when no cap.
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
        first_buy_passes = len(first_buyers) >= 1
    else:
        first_buy_passes = len(unique_owners) >= 1

    total_dollar = sum(
        abs(float(e.get("amount") or 0)) * float(e.get("stock_price") or 0)
        for e in p_buys_in_window
    )

    # Cap-normalized magnitude check. When no cap supplied, skip (legacy).
    if market_cap is None:
        threshold_used = MAGNITUDE_FLOOR_DOLLARS
        magnitude_passes = True
    else:
        threshold_used = magnitude_threshold(market_cap)
        magnitude_passes = total_dollar >= threshold_used

    passes = first_buy_passes and magnitude_passes

    return {
        "passes": passes,
        "p_buys_in_window": len(p_buys_in_window),
        "unique_p_buyers": len(unique_owners),
        "first_buyers": first_buyers,
        "total_dollar": total_dollar,
        "magnitude_passes": magnitude_passes,
        "magnitude_threshold": threshold_used,
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
    market_cap: float | None = None,
) -> dict[str, Any]:
    """
    Apply all three gates. Returns full diagnostic.

    A name is actionable IFF all three gates return passes=True.

    Args:
        data_source: "memory" (default — used by tests + local backtests)
                     or "supabase" (production — first-buy check via
                     query_first_buy() against insider_history table).
        market_cap:  company market capitalization in dollars. When provided,
                     Gate 1 also enforces the cap-normalized magnitude
                     threshold (max(2 bps × cap, $500k)). When None, the
                     magnitude check is skipped (legacy behavior).
    """
    g2 = liquidity_gate_passes(today_close, avg_volume_22d)
    g3 = anti_hedge_gate_passes(ticker)
    g1 = insider_gate_passes(
        score_date=score_date,
        insider_history=insider_history,
        require_first_buy=require_first_buy,
        ticker=ticker,
        data_source=data_source,
        market_cap=market_cap,
    )
    all_pass = g1["passes"] and g2 and g3
    return {
        "ticker": ticker.upper(),
        "score_date": score_date.isoformat(),
        "all_pass": all_pass,
        "gate_1_insider": g1,
        "gate_2_liquidity": g2,
        "gate_3_anti_hedge": g3,
        "market_cap": market_cap,
        "data_source": data_source,
    }
