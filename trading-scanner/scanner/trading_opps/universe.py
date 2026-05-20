"""
Screener universe — rebuilt Trading Opportunities screener.

A stock is eligible to be scored if ALL of these hold:

  * US-listed Common Stock or ADR  (universe_master.type IN ('CS','ADRC'))
  * Last close >= $5
  * 90-trading-day MEDIAN daily dollar volume >= $1,500,000

There is NO market-cap floor (the dollar-volume floor is the liquidity
gate) and NO trend / momentum / relative-strength pre-filter.

2026-05-20 RETAIL RE-SCOPE (Joe): the original spec set a $10M *average*
dollar-volume floor sized for an institutional book. The screener is now
optimised for a retail account trading $10k-$30k positions, where running
out of daily volume / causing slippage is not a concern. The floor is
lowered to $1.5M and the statistic is the MEDIAN daily dollar volume
(median is robust to one-off volume spikes — a truer liquidity read).
This keeps the live universe identical to the universe the Phase 2
backtest calibrated on.

This is the single source of truth for "which tickers do the Phase 1
ingest pipelines pull?" Both darkpool_ingest.py and options_eod_ingest.py
import build_screener_universe() from here.

Auth: SUPABASE_URL + SUPABASE_ACCESS_TOKEN (Management API, read-only
query).
"""

from __future__ import annotations

import os
from typing import Any

import requests


# ── Universe gates ───────────────────────────────────────────────────────────
MIN_LAST_CLOSE_USD = 5.00                # last close must be >= $5
MIN_MEDIAN_DOLLAR_VOL_USD = 1_500_000    # 90-day median close*volume >= $1.5M
DOLLAR_VOL_LOOKBACK_TRADING_DAYS = 90
INCLUDED_ASSET_TYPES = ("CS", "ADRC")    # universe_master.type values


def _management_query(sql: str) -> list[dict[str, Any]]:
    """Run a read-only SQL query through the Supabase Management API."""
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
        timeout=90,
    )
    r.raise_for_status()
    return r.json() if r.text else []


def build_screener_universe() -> list[str]:
    """
    Return the sorted, de-duped ticker list passing the universe gates.

    Per ticker, takes the most recent 90 trading rows in prices_eod, requires
    the MEDIAN of their daily dollar volume (close * volume) to clear $1.5M and
    the latest close to clear $5, and requires universe_master to mark the
    ticker as an active Common Stock or ADR.
    """
    sql = f"""
    WITH recent AS (
        SELECT
            ticker,
            close,
            volume,
            trade_date,
            row_number() OVER (PARTITION BY ticker ORDER BY trade_date DESC) AS rn
        FROM prices_eod
        WHERE trade_date >= CURRENT_DATE - INTERVAL '160 days'
    )
    SELECT r.ticker AS ticker
    FROM recent r
    JOIN universe_master um
      ON um.ticker = r.ticker
     AND um.active = true
     AND um.type IN {INCLUDED_ASSET_TYPES!r}
    WHERE r.rn <= {DOLLAR_VOL_LOOKBACK_TRADING_DAYS}
    GROUP BY r.ticker
    HAVING percentile_cont(0.5) WITHIN GROUP (ORDER BY r.close * r.volume)
               >= {MIN_MEDIAN_DOLLAR_VOL_USD}
       AND MAX(CASE WHEN r.rn = 1 THEN r.close END) >= {MIN_LAST_CLOSE_USD}
    ORDER BY r.ticker
    """
    rows = _management_query(sql)
    out: list[str] = []
    for row in rows:
        t = (row.get("ticker") or "").strip().upper()
        if t:
            out.append(t)
    return sorted(set(out))


if __name__ == "__main__":
    import json
    from datetime import date

    universe = build_screener_universe()
    print(json.dumps({
        "as_of": date.today().isoformat(),
        "count": len(universe),
        "first_10": universe[:10],
        "last_10": universe[-10:],
    }, indent=2))
