"""
Build v41_backtest_universe_per_date.json - for each scan date, list tickers
where market_cap_on_that_date BETWEEN $300M and $25B AND type IN ('CS','ADRC').

For Mondays that are US market holidays (MLK Day, Presidents' Day, Memorial Day),
we use the most-recent prior trading day's market cap. This matches the harness
behavior: a scanner running pre-market on a holiday would use the prior close.
"""
from __future__ import annotations
import os
import json, requests

PROJECT_REF = "yqaqqzseepebrocgibcw"
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]

def q(sql):
    r = requests.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json={"query": sql}, timeout=120,
    )
    r.raise_for_status()
    return r.json()

def main():
    with open("/tmp/md-v4/backtest_artifacts/phase1/v41_backtest_scan_dates_2026.txt") as f:
        scan_dates = [line.strip() for line in f if line.strip()]
    print(f"loaded {len(scan_dates)} scan dates")

    # Resolve each scan_date to the most-recent trading day with data.
    # Then pull universe at that date.
    out = {}
    effective_dates = {}
    for d in scan_dates:
        sql = f"""
        WITH eligible AS (
          SELECT um.ticker FROM universe_master um
          WHERE um.active=true AND um.type IN ('CS','ADRC')
        ),
        effective AS (
          SELECT MAX(as_of_date) AS d
          FROM historical_marketcap
          WHERE as_of_date <= '{d}'
        )
        SELECT hm.ticker, (SELECT d FROM effective)::text AS eff_date
        FROM historical_marketcap hm
        JOIN eligible e USING (ticker)
        WHERE hm.as_of_date = (SELECT d FROM effective)
          AND hm.market_cap BETWEEN 300e6 AND 25e9
        ORDER BY hm.ticker;
        """
        rows = q(sql)
        if rows:
            eff = rows[0]["eff_date"]
        else:
            eff = None
        tickers = [r["ticker"] for r in rows]
        out[d] = tickers
        effective_dates[d] = eff
        marker = "" if eff == d else f"  -> using {eff}"
        print(f"  {d}: {len(tickers)} tickers{marker}")

    out_path = "/tmp/md-v4/backtest_artifacts/phase1/v41_backtest_universe_per_date.json"
    with open(out_path, "w") as f:
        json.dump({"scan_date_to_effective_date": effective_dates,
                   "universe_per_scan_date": out}, f, indent=1)
    print(f"\nwrote {out_path}")
    sizes = [len(v) for v in out.values()]
    print(f"universe size  min={min(sizes)}  max={max(sizes)}  avg={sum(sizes)//len(sizes)}")

if __name__ == "__main__":
    main()
