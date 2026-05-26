"""
Screener universe + scoring-candidate universe.

Two helpers, used in different places in the pipeline:

  build_screener_universe()
    The single source of truth for "which tickers does the nightly
    screener score for launch?" ~3,200 names today: US Common Stock or
    ADR, last close >= $5, 90-day MEDIAN daily dollar volume >= $1.5M.
    Used by run_screener.py at scoring time. UNCHANGED.

  build_screener_candidate_universe()
    The single source of truth for "which tickers do the *enrichment*
    ingests (dark-pool prints, end-of-day options) need to pull each
    night?" The launch decision uses only insider rules + trend; the
    dark-pool and options layers add bonus points AFTER the launch is
    decided, so the ingests only need data for stocks that could
    plausibly launch in the next ~30 days. Practically: every name in
    the screener universe (above) that ALSO has an open-market insider
    purchase filing in the last 45 days OR appears on a recent
    trading_opps_signals snapshot. ~1,500-2,000 names today.

    Reduces the nightly ingest walk by an order of magnitude vs. walking
    the full ~3,200-stock screener universe. Same one-day-lag note as
    the cleanup plan: a stock that becomes insider-eligible after
    tonight'''s ingest runs will launch tomorrow without dark-pool or
    options bonus points; the next nightly ingest picks it up.

Auth: SUPABASE_URL + SUPABASE_ACCESS_TOKEN (Management API, read-only
query).
"""

from __future__ import annotations

import os
from typing import Any

import requests


# Universe gates
MIN_LAST_CLOSE_USD = 5.00                # last close must be >= $5
MIN_MEDIAN_DOLLAR_VOL_USD = 1_500_000    # 90-day median close*volume >= $1.5M
DOLLAR_VOL_LOOKBACK_TRADING_DAYS = 90
INCLUDED_ASSET_TYPES = ("CS", "ADRC")    # universe_master.type values

# Candidate-universe scope (used by the two evening enrichment ingests)
CANDIDATE_INSIDER_LOOKBACK_DAYS = 45     # 30-day rule window + 15-day buffer
CANDIDATE_RECENT_LAUNCH_DAYS = 7         # keep names launched in the last week


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


def build_screener_candidate_universe(
    insider_lookback_days: int = CANDIDATE_INSIDER_LOOKBACK_DAYS,
    recent_launch_days: int = CANDIDATE_RECENT_LAUNCH_DAYS,
) -> list[str]:
    """
    Return the sorted, de-duped list of names the dark-pool and options
    enrichment ingests need to walk tonight.

    Definition: every ticker in build_screener_universe() (so the price /
    dollar-volume / asset-type gates still apply) that ALSO satisfies at
    least one of:

      * has an open-market PURCHASE (transaction_code = 'P') filed in
        insider_history within the last `insider_lookback_days`; OR
      * appears on a trading_opps_signals snapshot in the last
        `recent_launch_days`.

    The launch decision in run_screener.py only uses insider rules +
    trend, so any name that could launch tonight has an insider purchase
    in the rule window. The 15-day buffer over the 30-day rule window
    covers names that pick up a second / third buy on subsequent days
    and flip into Rule B or Rule C eligibility. The recent-launch arm
    guards against a launched name'''s insider window rolling off while
    the page still ranks it.
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
    ),
    recent_buys AS (
        SELECT DISTINCT ticker
        FROM insider_history
        WHERE transaction_code = 'P'
          AND filing_date >= CURRENT_DATE - INTERVAL '{insider_lookback_days} days'
    ),
    recent_launches AS (
        SELECT DISTINCT ticker
        FROM trading_opps_signals
        WHERE scan_date >= CURRENT_DATE - INTERVAL '{recent_launch_days} days'
    ),
    gated AS (
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
    )
    SELECT g.ticker
    FROM gated g
    WHERE g.ticker IN (SELECT ticker FROM recent_buys)
       OR g.ticker IN (SELECT ticker FROM recent_launches)
    ORDER BY g.ticker
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
    candidates = build_screener_candidate_universe()
    print(json.dumps({
        "as_of": date.today().isoformat(),
        "screener_universe": {
            "count": len(universe),
            "first_10": universe[:10],
            "last_10": universe[-10:],
        },
        "candidate_universe": {
            "count": len(candidates),
            "first_10": candidates[:10],
            "last_10": candidates[-10:],
        },
    }, indent=2))
