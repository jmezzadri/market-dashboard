"""
Screener universe — rebuilt Trading Opportunities screener.

Locked spec (TRADING_OPPS_SCREENER_SPEC_2026-05-20.md, Section 2). A stock
is eligible to be scored if ALL of these hold:

  * US-listed Common Stock or ADR  (universe_master.type IN ('CS','ADRC'))
  * Last close >= $5
  * 90-trading-day average dollar volume >= $10,000,000

There is NO market-cap floor (the dollar-volume floor is the liquidity
gate) and NO trend / momentum / relative-strength pre-filter. This is the
"$10M/day dollar-volume floor" from Joe's Decision 1 — it replaces the
unbuildable bid-ask-spread filter from the model draft.

Expected size: ~2,000-2,500 names.

This is the single source of truth for "which tickers do the Phase 1
ingest pipelines pull?" Both darkpool_ingest.py and options_eod_ingest.py
import build_screener_universe() from here.

Auth: SUPABASE_URL + SUPABASE_ACCESS_TOKEN (Management API, read-only
query). Mirrors the pattern in signal_intelligence_v5/universe.py.
"""

from __future__ import annotations

import os
from typing import Any

import requests


# ── Universe gates — locked spec Section 2 ───────────────────────────────────
MIN_LAST_CLOSE_USD = 5.00            # last close must be >= $5
MIN_AVG_DOLLAR_VOL_USD = 10_000_000  # 90-day avg close*volume must be >= $10M
DOLLAR_VOL_LOOKBACK_TRADING_DAYS = 90
INCLUDED_ASSET_TYPES = ("CS", "ADRC")  # universe_master.type values


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
    Return the sorted, de-duped ticker list passing the locked spec gates.

    Per ticker, takes the most recent 90 trading rows in prices_eod, requires
    their average dollar volume (close * volume) to clear $10M and the latest
    close to clear $5, and requires universe_master to mark the ticker as an
    active Common Stock or ADR.
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
    HAVING AVG(r.close * r.volume) >= {MIN_AVG_DOLLAR_VOL_USD}
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
