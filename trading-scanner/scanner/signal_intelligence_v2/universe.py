"""
Universe Builder v2 — for the Signal Intelligence engine.

Replaces v1's 4-gate stack (liquidity + trend + relative-strength + RSI band)
with a clean two-filter universe:

    Market cap floor: ≥ $1,000,000,000  (drops microcaps per Joe 2026-05-08)
    Liquidity floor:  ≥ $10,000,000     20-day average daily dollar volume

No trend / RS / RSI pre-filter. The Signal Intelligence composite is the
only thing separating signal from noise — names surface on the strength
of the five Signals, not on top of a momentum funnel.

Expected universe size: ~3,000 names (vs ~400-600 under v1's 4-gate stack).
The producer scores all of them; band membership filters down.

This module exposes two functions:

    filter_universe_v2()              — pure function on pre-fetched candidates
    build_universe_v2_from_supabase() — high-level entry: fetch + filter
"""

from __future__ import annotations

from typing import Any, Iterable

# ─────────────────────────────────────────────────────────────────────────────
# Universe gates (Phase D may sweep these)
# ─────────────────────────────────────────────────────────────────────────────

UNIVERSE_MIN_MARKET_CAP_USD = 1_000_000_000      # $1B
UNIVERSE_MIN_ADV_USD = 10_000_000                # $10M
UNIVERSE_ADV_LOOKBACK_DAYS = 20

# Asset-class filters (US common equities only for v2)
EXCLUDED_ASSET_TYPES = {"etf", "etn", "fund", "trust", "warrant", "right", "unit"}
EXCLUDED_EXCHANGES = {"OTC", "OTCM", "PINK"}


def filter_universe_v2(
    candidates: Iterable[dict[str, Any]],
    min_market_cap: float = UNIVERSE_MIN_MARKET_CAP_USD,
    min_adv_usd: float = UNIVERSE_MIN_ADV_USD,
) -> list[str]:
    """
    Filter candidate tickers to the v2 universe.

    Args:
        candidates: Iterable of dicts; each MUST include:
            ticker                 (str)   — symbol
            market_cap             (float) — USD market cap
            avg_dollar_volume_20d  (float) — 20-day avg dollar volume
            asset_type             (str)   — 'common'/'etf'/'etn'/etc., optional
            exchange               (str)   — listing exchange, optional
        min_market_cap: market cap floor (default $1B).
        min_adv_usd: average daily dollar volume floor (default $10M).

    Returns:
        Sorted list of ticker symbols passing both gates AND asset-type
        filter.
    """
    survivors: list[str] = []
    for c in candidates:
        ticker = (c.get("ticker") or "").strip().upper()
        if not ticker:
            continue

        # Asset-class filter (skip ETFs, OTC, etc.)
        atype = (c.get("asset_type") or "").strip().lower()
        if atype and atype in EXCLUDED_ASSET_TYPES:
            continue
        exchange = (c.get("exchange") or "").strip().upper()
        if exchange and exchange in EXCLUDED_EXCHANGES:
            continue

        # Market cap floor
        mcap = c.get("market_cap")
        if mcap is None or float(mcap) < min_market_cap:
            continue

        # Liquidity floor
        adv = c.get("avg_dollar_volume_20d")
        if adv is None or float(adv) < min_adv_usd:
            continue

        survivors.append(ticker)

    # De-dup while preserving sort
    return sorted(set(survivors))


def build_universe_v2_from_supabase(
    supabase_client: Any,
    as_of_date: str | None = None,
    min_market_cap: float = UNIVERSE_MIN_MARKET_CAP_USD,
    min_adv_usd: float = UNIVERSE_MIN_ADV_USD,
) -> list[str]:
    """
    Fetch candidates from Supabase and filter to the v2 universe.

    Reads:
        ticker_reference   — for market_cap, asset_type, exchange
        prices_eod         — for 20-day rolling avg dollar volume

    Args:
        supabase_client: configured Supabase client (postgrest interface).
        as_of_date: 'YYYY-MM-DD' for point-in-time filtering. None = latest.
        min_market_cap, min_adv_usd: gate thresholds.

    Returns:
        Sorted list of universe ticker symbols.

    Note:
        This function pulls the candidate list from Supabase; the actual
        20-day rolling ADV is computed by a Supabase view or by a join in
        the SQL query (caller's choice). The expected shape returned by
        the client is the candidate dict format consumed by
        filter_universe_v2.
    """
    # Fetch is delegated to the client's view. The default v2 view name is
    # 'universe_candidates_v2' which joins ticker_reference + prices_eod and
    # exposes (ticker, market_cap, avg_dollar_volume_20d, asset_type, exchange).
    query = supabase_client.table("universe_candidates_v2").select(
        "ticker,market_cap,avg_dollar_volume_20d,asset_type,exchange"
    )
    if as_of_date is not None:
        query = query.eq("as_of_date", as_of_date)

    response = query.execute()
    rows = response.data if hasattr(response, "data") else response.get("data", [])
    return filter_universe_v2(rows, min_market_cap=min_market_cap, min_adv_usd=min_adv_usd)
