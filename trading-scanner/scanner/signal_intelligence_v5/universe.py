"""
Universe selection — v5 Signal Intelligence.

Spec (per the v5 methodology):

    All US-listed Common Stock + ADR with:
        market_cap >= $300,000,000  AND  last close > $5

    NO upper market-cap ceiling. NO trend / RS / RSI pre-filter — the
    six bidirectional signals do all the discrimination.

Expected universe size: ~3,500-4,000 names. As of 2026-05-10 the
production count was 3,549.

The `type` column lives on `universe_master` (per LESSONS), not on
`ticker_reference`. Common Stock = 'CS', ADR = 'ADRC'. Other types
(ETF, FUND, WARRANT, PFD, UNIT, RIGHT, ETN, etc.) are excluded.

Two entry points:

    build_universe_v5_from_supabase() — high-level: query Supabase + filter.
    filter_universe_v5(candidates)    — pure function on pre-fetched rows.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any, Iterable

import requests


# ─────────────────────────────────────────────────────────────────────────────
# Universe gates — v5 spec
# ─────────────────────────────────────────────────────────────────────────────

UNIVERSE_MIN_MARKET_CAP_USD = 300_000_000     # $300M
UNIVERSE_MIN_LAST_CLOSE_USD = 5.00            # > $5
INCLUDED_ASSET_TYPES = {"CS", "ADRC"}         # universe_master.type values
PRICE_LOOKBACK_DAYS = 14                      # accept any close within ~2 wks


# ─────────────────────────────────────────────────────────────────────────────
# Pure filter
# ─────────────────────────────────────────────────────────────────────────────

def filter_universe_v5(
    candidates: Iterable[dict[str, Any]],
    min_market_cap: float = UNIVERSE_MIN_MARKET_CAP_USD,
    min_last_close: float = UNIVERSE_MIN_LAST_CLOSE_USD,
) -> list[str]:
    """
    Pure filter from candidate dicts to ticker symbol list.

    Each candidate dict must include:
        ticker       (str)
        type         (str)   — universe_master.type ('CS'/'ADRC'/etc.)
        market_cap   (float) — ticker_reference.market_cap
        last_close   (float) — most recent prices_eod.close

    Returns sorted, de-duped list of ticker symbols passing all gates.
    """
    survivors: list[str] = []
    for c in candidates:
        ticker = (c.get("ticker") or "").strip().upper()
        if not ticker:
            continue

        atype = (c.get("type") or "").strip().upper()
        if atype not in INCLUDED_ASSET_TYPES:
            continue

        mcap = c.get("market_cap")
        if mcap is None:
            continue
        try:
            if float(mcap) < min_market_cap:
                continue
        except (TypeError, ValueError):
            continue

        last_close = c.get("last_close")
        if last_close is None:
            continue
        try:
            if float(last_close) <= min_last_close:
                continue
        except (TypeError, ValueError):
            continue

        survivors.append(ticker)

    return sorted(set(survivors))


# ─────────────────────────────────────────────────────────────────────────────
# Supabase Management-API-backed fetcher
# ─────────────────────────────────────────────────────────────────────────────

def _management_query(sql: str) -> list[dict[str, Any]]:
    """Run a SQL query through the Supabase Management API."""
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    url = os.environ.get("SUPABASE_URL", "")
    if not token or not url:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN and SUPABASE_URL must be set")
    project_ref = url.replace("https://", "").split(".")[0]
    api = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
    r = requests.post(
        api,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": sql},
        timeout=60,
    )
    r.raise_for_status()
    return r.json() if r.text else []


def build_universe_v5_from_supabase(
    as_of_date: date | None = None,
    min_market_cap: float = UNIVERSE_MIN_MARKET_CAP_USD,
    min_last_close: float = UNIVERSE_MIN_LAST_CLOSE_USD,
) -> list[str]:
    """
    Fetch universe candidates from production Supabase, filter to v5 spec.

    Joins universe_master (type column) -> ticker_reference (market_cap) ->
    prices_eod (most recent close within PRICE_LOOKBACK_DAYS).

    Args:
        as_of_date: cut-off for the price lookup. None = today.
        min_market_cap, min_last_close: override defaults if needed.

    Returns:
        Sorted ticker list passing the v5 gates.
    """
    as_of = as_of_date or date.today()
    cutoff_lo = as_of - timedelta(days=PRICE_LOOKBACK_DAYS)

    sql = f"""
    SELECT
        um.ticker      AS ticker,
        um.type        AS type,
        tr.market_cap  AS market_cap,
        (SELECT close FROM prices_eod p
          WHERE p.ticker = um.ticker
            AND p.trade_date BETWEEN '{cutoff_lo.isoformat()}'
                                 AND '{as_of.isoformat()}'
          ORDER BY p.trade_date DESC LIMIT 1) AS last_close
    FROM universe_master um
    JOIN ticker_reference tr ON tr.ticker = um.ticker
    WHERE um.active = true
      AND um.type IN ('CS','ADRC')
      AND tr.market_cap >= {int(min_market_cap)}
    """
    rows = _management_query(sql)
    return filter_universe_v5(
        rows,
        min_market_cap=min_market_cap,
        min_last_close=min_last_close,
    )


# CLI
if __name__ == "__main__":
    import json
    universe = build_universe_v5_from_supabase()
    print(json.dumps({
        "as_of": date.today().isoformat(),
        "count": len(universe),
        "first_10": universe[:10],
        "last_10": universe[-10:],
    }, indent=2))
