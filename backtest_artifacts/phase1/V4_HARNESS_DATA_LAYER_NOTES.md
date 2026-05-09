# v4.1 Backtest Harness — Phase 1 Data Layer Notes

**Branch:** `feature/quant-v4-harness-phase-1-data-layer`
**Scope:** Phase 1 of 4. Builds the data inputs the v4.1 walk-forward harness will read on every (ticker, scan_date) lookup.

This document is the operating manual for Phases 2–4. Read it before calling
`score_ticker()` in a loop.

---

## 1. What was built

### 1a. New Supabase tables

| Table | Rows | Tickers | Purpose |
|---|---|---|---|
| `historical_marketcap` | 942,361 | 5,581 | Approx point-in-time market cap = close × latest_shares_outstanding. Powers the v4.1 Gate-1 magnitude check + the per-date universe filter. |
| `forward_returns_21d` | 861,852 | 3,035 | 21-trading-day forward total return (close-to-close). Powers the harness scoring outcome. |

Both tables are pre-computed (not views) for harness loop performance. Both
have `(ticker, as_of_date DESC)` indexes plus a date-only index for full-cross-sectional sweeps.

Migration file: `supabase/migrations/048_v4_harness_data_layer.sql`. Already
applied to production via the Supabase Management API.

### 1b. Backtest scan dates (52 weekly Mondays)

File: `v41_backtest_scan_dates_2026.txt`
Range: **2025-05-12 → 2026-05-04**
Format: one ISO date per line.

The harness should iterate these in order. Three of the 52 dates are US market
holidays (MLK Day 2026-01-19, Presidents' Day 2026-02-16, Memorial Day
2025-05-26-style); the universe-per-date file resolves these to the prior
trading day's market cap.

### 1c. Per-date universe

File: `v41_backtest_universe_per_date.json`
Schema:
```jsonc
{
  "scan_date_to_effective_date": {
    "2025-05-12": "2025-05-12",      // identity for trading days
    "2026-01-19": "2026-01-16",       // holiday Mondays → prior trading day
    ...
  },
  "universe_per_scan_date": {
    "2025-05-12": ["A", "AA", "AAP", ... ],   // ~2,500-2,950 tickers per date
    ...
  }
}
```

Universe sizes range 2,505 → 2,938 tickers per scan date.

### 1d. Price backfill (side-effect)

`prices_eod` was sparse before this work (avg 9 trading days per ticker for
the Massive/Polygon source — Basic-tier cap; see MEMORY 2026-04-30). I
backfilled via yfinance from 2025-02-01 to 2026-05-09 for the v4.1 universe.

| Source | Rows | Tickers | Date range |
|---|---|---|---|
| `massive` (Polygon) | 90,474 | 9,513 | 2024-04-30 → 2026-05-08 |
| `yfinance-bootstrap` | 93,751 | 18 | 2003-01-02 → 2024-04-26 |
| `yfinance-v4-backfill` (NEW) | 920,093 | 3,034 | 2025-02-03 → 2026-05-08 |
| `yfinance-v4-attempted` (NEW, sentinels) | ~80 | ~80 | 1970-01-01 (placeholder so we don't re-attempt failed downloads) |

**Of the 3,031-ticker v4.1 universe (CS/ADRC, $300M-$25B at latest snapshot,
shares outstanding present):**
- 2,810 (92.7%) have ≥250 trading days
- 125 (4.1%) have 100-249 days
- 44 (1.5%) have 51-99 days (just enough for the 51-trailing-close requirement)
- 52 (1.7%) have <51 days or no data — these are recent IPOs, dual-class
  share quirks yfinance can't fetch, or true delistings

The harness MUST filter out tickers with <51 trailing closes on a given scan
date (skip the row, do not call `score_ticker()`).

---

## 2. Approximations & Known Limitations

### 2a. `historical_marketcap` uses a single shares snapshot

Cap is computed as `close_on_date × LATEST_share_class_shares_outstanding`,
not a point-in-time share count. `ticker_reference` only stores the most-recent
share count. For the 12-month backtest window:

- Typical drift: <2-5% per ticker over 12 months
- Worst case: AAPL/META-style mega-buyback names can drift ~5-8%
- Practical impact: **a small number of names at the $300M / $25B band edges
  may be misclassified.** A name with current cap of $24B that had a 6%
  buyback in the last 12 months would have had ~$25.5B cap a year ago —
  technically out-of-band. Using the latest shares understates this drift.

This is acceptable for v4.1 because the gate is a soft filter (cap-normalized
magnitude threshold), not a strict band. For v5+ we should snapshot
`shares_outstanding` weekly and use point-in-time values.

### 2b. `forward_returns_21d` is close-to-close, no dividends/splits

Uses raw close from `prices_eod`. Splits ARE handled correctly because we
mostly back-filled with `auto_adjust=False` from yfinance — splits are
already adjusted in the close series we pulled. Dividends are NOT included.
For most names in our universe (mostly growth-tilted small/mid-caps) the
dividend yield is <2%, so the 21-day return error is at most ~10 bps.

### 2c. Insider history is 14 months deep, harness needs ~17

`insider_history` first event: 2025-03-10. The earliest scan date is
2025-05-12, which needs the 395-day insider lookback going back to 2024-04-12.
**For the first 7 weekly scans (2025-05-12 through 2025-06-23), the
395-day insider window is INCOMPLETE.** Specifically:

| Scan date | Window start needed | Window start available | Coverage |
|---|---|---|---|
| 2025-05-12 | 2024-04-12 | 2025-03-10 | partial (~2 months of 395) |
| 2025-06-23 | 2025-05-24 | 2025-03-10 | full from this point on |

Harness behavior on these dates: the `is_first_buy()` check may return
TRUE more often than warranted (because we can't see prior P-buys that
happened before 2025-03-10). Result: the earliest 7 scans will have a
modest upward bias on Gate 1 pass count. Phase 4 of the harness build
should report Run A vs Run B separately for "early" (2025-05-12 to
2025-06-23) and "stable" (2025-06-30 onward) cohorts, OR drop the early
cohort. The smoke test in this PR landed on 2026-02-16 (post-stable) and
saw clean insider data.

### 2d. Holiday Mondays

3 of the 52 scan dates fall on US market holidays (MLK Day, Presidents'
Day, Memorial Day). The universe JSON resolves these to the prior trading
day. The harness should:
1. Read `scan_date_to_effective_date[scan_date]` to get the actual trading
   day.
2. Use the EFFECTIVE date for all data lookups (closes, market_cap, fwd
   return).
3. Use the SCAN date as the canonical label in scan output.

---

## 3. How to query each input from Python

```python
import requests

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

# 1. Market cap on a scan date (point-in-time, holidays-safe)
rows = q(f"""
    SELECT close, shares, market_cap
    FROM historical_marketcap
    WHERE ticker='{ticker}' AND as_of_date <= '{scan_date}'
    ORDER BY as_of_date DESC LIMIT 1;
""")
market_cap = float(rows[0]["market_cap"])

# 2. 51 trailing closes ENDING with scan_date (note: rev-order, then reverse)
rows = q(f"""
    SELECT close FROM prices_eod
    WHERE ticker='{ticker}' AND trade_date <= '{scan_date}'
      AND source IN ('massive','yfinance-v4-backfill','yfinance-bootstrap')
    ORDER BY trade_date DESC LIMIT 51;
""")
closes_for_indicators = [float(r["close"]) for r in reversed(rows)]
today_close = closes_for_indicators[-1]

# 3. 22-day avg volume
rows = q(f"""
    SELECT AVG(volume) AS avg22
    FROM (
      SELECT volume FROM prices_eod
      WHERE ticker='{ticker}' AND trade_date <= '{scan_date}'
        AND source IN ('massive','yfinance-v4-backfill','yfinance-bootstrap')
      ORDER BY trade_date DESC LIMIT 22
    ) sub;
""")
avg_volume_22d = float(rows[0]["avg22"])
volume_today = ...  # SELECT volume FROM prices_eod WHERE ticker=X AND trade_date=scan_date

# 4. Insider history covering scan_date (395-day window + the 30-day gate window)
from datetime import datetime, timedelta
scan_d = datetime.strptime(scan_date, "%Y-%m-%d").date()
win_start = scan_d - timedelta(days=425)  # 30 + 395 + buffer
rows = q(f"""
    SELECT transaction_date AS date, owner_name AS owner, transaction_code,
           amount, stock_price, is_officer
    FROM insider_history
    WHERE ticker='{ticker}'
      AND transaction_date BETWEEN '{win_start}' AND '{scan_date}';
""")
insider_history = [
    {"date": datetime.strptime(r["date"], "%Y-%m-%d").date(),
     "owner": r["owner"], "transaction_code": r["transaction_code"],
     "amount": int(r["amount"] or 0), "stock_price": float(r["stock_price"] or 0),
     "is_officer": bool(r["is_officer"])}
    for r in rows
]

# 5. Forward 21d return (for the harness scoring outcome)
rows = q(f"""
    SELECT fwd_return_21d FROM forward_returns_21d
    WHERE ticker='{ticker}' AND as_of_date='{scan_date}' LIMIT 1;
""")
fwd_return_21d = float(rows[0]["fwd_return_21d"]) if rows else None
# If None: forward window not yet completed (skip this row in Phase 3 analysis).
```

---

## 4. How Phase 2 (harness scaffold) should join this together

```python
# Pseudocode for the harness outer loop
import json
from scanner.signal_intelligence_v4.score import score_ticker

with open("v41_backtest_scan_dates_2026.txt") as f:
    scan_dates = [d.strip() for d in f if d.strip()]
with open("v41_backtest_universe_per_date.json") as f:
    bundle = json.load(f)

results = []
for scan_date in scan_dates:
    eff_date = bundle["scan_date_to_effective_date"][scan_date]
    universe = bundle["universe_per_scan_date"][scan_date]
    for ticker in universe:
        try:
            inputs = fetch_inputs(ticker, eff_date)  # the 5 queries above
            if len(inputs.closes_for_indicators) < 51:
                continue   # not enough history; skip
            sr = score_ticker(
                ticker=ticker,
                score_date=eff_date,
                today_close=inputs.today_close,
                volume_today=inputs.volume_today,
                avg_volume_22d=inputs.avg_volume_22d,
                closes_for_indicators=inputs.closes_for_indicators,
                insider_history=inputs.insider_history,
                require_first_buy=True,           # Run A
                market_cap=inputs.market_cap,
            )
            outcome = inputs.fwd_return_21d  # may be None if not yet realized
            results.append({"scan_date": scan_date, "ticker": ticker, "score": sr.score,
                            "band": sr.band.value, "fwd_return_21d": outcome})
        except Exception as e:
            log_and_continue(ticker, scan_date, e)

# Phase 3: aggregate score x band x fwd_return distribution.
# Phase 4: re-run with require_first_buy=False (Run B) and compare.
```

For Phase 2 efficiency, batch the inputs query: pull ALL closes for a ticker
once into memory, then walk the 52 scan dates per ticker rather than 52 ×
universe-size SQL round-trips per outer loop.

---

## 5. Gaps & Phase-2 Blockers

1. **Insider history coverage is 14 months, harness wants ~17.** Mitigation:
   drop the first 7 scan dates from the comparison report, OR caveat them.
   Decision deferred to Phase 4 (Joe's call).

2. **52 of 3,031 universe tickers have <51 trailing closes.** These will be
   silently skipped by the harness. Documented for transparency.

3. **No `issue_type` column on `ticker_reference`.** Spec says
   `issue_type IN ('Common Stock','ADR')`. We're using
   `universe_master.type IN ('CS','ADRC')` instead — same semantic, different
   column. PR #510 introduced `market_cap` on score_ticker but did not add
   issue_type to ticker_reference; if the v4.1 spec intended a stricter
   filter (e.g., excluding ADR Preferred 'ADRP' which doesn't exist in our
   data), we'd need to discuss.

4. **Dividend yield is not in the forward return.** For most names in our
   universe the impact is <10 bps over 21 days. For high-yield names
   (REITs, BDCs like FSK in the smoke test sample which yields ~10%) the
   21-day dividend can be 30-80 bps and could matter at the margin. Phase 4
   should flag this caveat in the comparison report.

5. **No `volume_today` field is pre-loaded** — but it's just `prices_eod.volume`
   on `eff_date`. Harness can grab it inline.

---

## 6. Reproduce / Re-run

To rebuild this layer from scratch (e.g., after another month of prices
arrive):

```bash
# 1. Apply migration (idempotent)
psql ... -f supabase/migrations/048_v4_harness_data_layer.sql

# 2. Backfill prices for any new universe members (idempotent, sentinel-aware)
python3 scripts/v4_harness/backfill_prices.py --start-batch 0 --end-batch 100

# 3. Re-populate historical_marketcap (idempotent — UPSERT)
# (run the INSERT...SELECT shown in supabase/migrations/049_v4_harness_repopulate.sql
#  if/when we add it; for now, run the Mgmt-API queries in this PR)

# 4. Re-populate forward_returns_21d (idempotent — UPSERT)
# (same pattern)

# 5. Regenerate per-date universe + scan dates files
python3 scripts/v4_harness/build_universe_per_date.py
```

---

## 7. Phase-2 owner: read this first, then read score.py

Before writing the harness loop, re-read:
- `/Users/joemezzadri/Developer/macrotilt/trading-scanner/scanner/signal_intelligence_v4/score.py`
- `/Users/joemezzadri/Developer/macrotilt/trading-scanner/scanner/signal_intelligence_v4/gates.py`
- `/Users/joemezzadri/Developer/macrotilt/trading-scanner/scanner/signal_intelligence_v4/pillars.py`

This data layer exposes EXACTLY the inputs those modules consume — no more,
no less. If Phase 2 finds itself needing additional data not surfaced here,
that's a signal to update this Phase 1 doc and back-fill, not to layer
ad-hoc queries inside the loop.
