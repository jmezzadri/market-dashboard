"""
Smoke test for the Phase 1 data layer. Pick 1 random scan date + 5 random
tickers. For each, verify all 5 inputs needed by score_ticker():
  - market cap on scan_date in [$300M, $25B]
  - 51+ trailing closes available (ending at or before scan_date)
  - 22-day avg volume computable
  - 395-day insider history window available (or no events = valid)
  - 21-day forward return computable
"""
from __future__ import annotations
import os
import json, random, requests
from datetime import date, datetime, timedelta

PROJECT_REF = "yqaqqzseepebrocgibcw"
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]

def q(sql):
    r = requests.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json={"query": sql}, timeout=60,
    )
    r.raise_for_status()
    return r.json()

def main():
    with open("/tmp/md-v4/backtest_artifacts/phase1/v41_backtest_universe_per_date.json") as f:
        data = json.load(f)
    universe = data["universe_per_scan_date"]

    # Pick a scan date with a complete forward window (today=2026-05-09 minus 30 days).
    today = date(2026, 5, 9)
    cutoff = today - timedelta(days=30)
    eligible_dates = [d for d in universe if datetime.strptime(d, "%Y-%m-%d").date() <= cutoff]
    random.seed(42)
    scan_date = random.choice(eligible_dates)
    tickers_sample = random.sample(universe[scan_date], 5)
    print(f"=== Smoke Test ===")
    print(f"Scan date: {scan_date}  (universe size: {len(universe[scan_date])})")
    print(f"Tickers:   {tickers_sample}")
    print()

    results = []
    for tk in tickers_sample:
        print(f"--- {tk} ---")
        # 1. Market cap on scan_date
        rows = q(f"""
            SELECT close, shares, market_cap, as_of_date
            FROM historical_marketcap
            WHERE ticker='{tk}' AND as_of_date <= '{scan_date}'
            ORDER BY as_of_date DESC LIMIT 1;
        """)
        if rows:
            r = rows[0]
            mc_pass = 300e6 <= float(r["market_cap"]) <= 25e9
            print(f"  market_cap: ${float(r['market_cap'])/1e6:,.1f}M  on {r['as_of_date']}  -> {'PASS' if mc_pass else 'FAIL'}")
        else:
            mc_pass = False
            print(f"  market_cap: NO DATA -> FAIL")

        # 2. 51 trailing closes
        rows = q(f"""
            SELECT COUNT(*) AS n, MIN(trade_date) AS oldest, MAX(trade_date) AS newest
            FROM prices_eod
            WHERE ticker='{tk}' AND trade_date <= '{scan_date}'
              AND source IN ('massive','yfinance-v4-backfill','yfinance-bootstrap');
        """)
        n_closes = int(rows[0]["n"])
        closes_pass = n_closes >= 51
        print(f"  trailing closes: {n_closes}  (oldest {rows[0]['oldest']})  -> {'PASS' if closes_pass else 'FAIL'}")

        # 3. 22-day avg volume
        rows = q(f"""
            SELECT AVG(volume)::numeric(20,2) AS avg_vol, COUNT(*) AS n
            FROM (
              SELECT volume FROM prices_eod
              WHERE ticker='{tk}' AND trade_date <= '{scan_date}'
                AND source IN ('massive','yfinance-v4-backfill','yfinance-bootstrap')
              ORDER BY trade_date DESC LIMIT 22
            ) sub;
        """)
        avg_vol = rows[0]["avg_vol"]
        vol_pass = avg_vol is not None and int(rows[0]["n"]) >= 22
        print(f"  22d avg vol: {float(avg_vol):,.0f}" if avg_vol else "  22d avg vol: NULL")
        print(f"    -> {'PASS' if vol_pass else 'FAIL'}")

        # 4. 395-day insider window
        scan_d = datetime.strptime(scan_date, "%Y-%m-%d").date()
        win_start = scan_d - timedelta(days=395)
        rows = q(f"""
            SELECT COUNT(*) AS n,
                   MIN(transaction_date) AS oldest,
                   MAX(transaction_date) AS newest
            FROM insider_history
            WHERE ticker='{tk}'
              AND transaction_date BETWEEN '{win_start}' AND '{scan_date}';
        """)
        n_ev = int(rows[0]["n"])
        # Check whether the table itself has data old enough to cover this window
        rows2 = q(f"SELECT MIN(transaction_date) AS m FROM insider_history;")
        global_min = rows2[0]["m"]
        coverage_ok = global_min is not None and global_min <= win_start.isoformat()
        if n_ev > 0:
            print(f"  insider 395d window: {n_ev} events ({rows[0]['oldest']} -> {rows[0]['newest']}) -> PASS")
            ins_pass = True
        elif coverage_ok:
            print(f"  insider 395d window: 0 events (table covers {global_min} which is before {win_start}, so legitimate no-events) -> PASS")
            ins_pass = True
        else:
            print(f"  insider 395d window: 0 events, table only covers from {global_min} which is AFTER {win_start} -> INCOMPLETE COVERAGE")
            ins_pass = False

        # 5. 21-day forward return
        rows = q(f"""
            SELECT fwd_return_21d, fwd_close_date, fwd_close_price
            FROM forward_returns_21d
            WHERE ticker='{tk}' AND as_of_date='{scan_date}'
            LIMIT 1;
        """)
        # Allow scan_date to be a holiday — check effective date
        if not rows:
            eff = data["scan_date_to_effective_date"].get(scan_date)
            if eff and eff != scan_date:
                rows = q(f"""
                    SELECT fwd_return_21d, fwd_close_date, fwd_close_price
                    FROM forward_returns_21d
                    WHERE ticker='{tk}' AND as_of_date='{eff}' LIMIT 1;
                """)
        if rows:
            r = rows[0]
            print(f"  21d fwd return: {float(r['fwd_return_21d'])*100:+.2f}%  (close {r['fwd_close_date']} = ${float(r['fwd_close_price']):.2f}) -> PASS")
            fwd_pass = True
        else:
            print(f"  21d fwd return: NO DATA -> FAIL")
            fwd_pass = False

        all_pass = mc_pass and closes_pass and vol_pass and ins_pass and fwd_pass
        print(f"  OVERALL: {'PASS' if all_pass else 'FAIL'}")
        results.append((tk, all_pass, mc_pass, closes_pass, vol_pass, ins_pass, fwd_pass))
        print()

    print("=== Summary ===")
    print(f"{'Ticker':8} {'Cap':>5} {'51c':>5} {'Vol':>5} {'Ins':>5} {'Fwd':>5} {'All':>5}")
    for tk, all_pass, mc, c, v, i, f in results:
        print(f"{tk:8} {'PASS' if mc else 'FAIL':>5} {'PASS' if c else 'FAIL':>5} {'PASS' if v else 'FAIL':>5} {'PASS' if i else 'FAIL':>5} {'PASS' if f else 'FAIL':>5} {'PASS' if all_pass else 'FAIL':>5}")

if __name__ == "__main__":
    main()
