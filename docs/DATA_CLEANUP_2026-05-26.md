# Data Cleanup — Phases 1 + 2

**Shipped:** 2026-05-26
**Goal:** Bring Unusual Whales request load from a designed-load estimate
of ~82,000 requests/day down to roughly ~14,000/day (well under the
20,000/day account ceiling) without changing any number that feeds the
MacroTilt Score or the Trading Opportunities screener launch decision,
and without losing any user-visible column.

## What shipped

### Phase 1 — cleanup

* **1a + 1b — right-size the two evening enrichment feeds.** Dark-Pool
  Prints (`darkpool_ingest.py`) and End-of-Day Options
  (`options_eod_ingest.py`) now walk
  `build_screener_candidate_universe()` (~1,500-2,000 stocks) instead of
  `build_screener_universe()` (~3,200 stocks). Both workflow YAMLs now
  carry a DST-aware idempotency gate so they run once a night instead
  of twice. Estimated saving: ~47,000 requests/day from right-sizing +
  the same number again from no longer double-running.

* **1c — Short Interest cut to one UW request per ticker.** The worker
  no longer calls `fetch_uw_volume_ratio` or `fetch_uw_ftds`; only
  `fetch_uw_data` (cost-to-borrow snapshot) remains on the UW side.
  FINRA bi-monthly settlement pull is untouched. Same DST guard added
  to `SHORT_INTEREST_INGEST_DAILY.yml`. **Trade-off, recorded:** the
  back-test harness reads `short_volume_ratio` and `ftd_quantity` from
  `short_interest_daily` for future calibration. Historical rows are
  preserved; new rows stop accumulating those values until the back-
  test is run and the decision is re-visited. Saving: ~17,500
  requests/day.

* **1d — DST guards on Analyst, Options Flow, Congress.** Same gate
  pattern. Saving: ~3,600 requests/day combined.

* **1e — Options Flow within-run double-pull fixed.**
  `options_ingest.pull_and_upsert` was calling `fetch_flow_alerts()`
  twice per run (once into a count-only loop, then again inside the
  aggregator). Now streams the events once through a budget-aware
  generator. Saving: ~100 requests/day.

### Phase 2 — structural hygiene

* **2a — morning feeds staggered.** Short Interest 06:00 ET, Analyst
  06:20 ET, Options Flow 06:40 ET, Congress 07:00 ET. Eliminates the
  per-minute rate-limit collision the four feeds previously created
  at 06:00.

* **2b — meter-read job.** Reviewed the May 23 day-idempotency fix in
  `scanner/uw_meter_read.py`. The job is correctly structured to
  record one end-of-day row per ET day even if the GitHub cron fires
  late. No code change shipped. The first end-of-day row will land
  tonight if the fix holds.

* **2c — legacy afternoon scan.** Reconciled: `SCAN_330PM_WEEKDAYS.yml`
  writes `public/latest_scan_data.json`, which is still consumed by
  `App.jsx` and `Scanner.jsx`. The vendor ledger description
  "back-compat only" is misleading; the scan is active. No retirement
  shipped.

* **2d — data registry update.** The live JavaScript registry
  `src/data/dataRegistry.js` is not imported by any reachable code
  path (verified by grep) — updating it has no user-visible effect.
  The vendor ledger lives in user-side notes (outside this repo) and
  is not modified here.

## Re-expansion guardrail (Phase 2e)

`build_screener_candidate_universe()` exists to keep the two evening
enrichment ingests under budget. The launch decision in
`run_screener.py` is unchanged and does not depend on whether
dark-pool or options data was ingested for a given ticker — those
two layers only add bonus points after the launch is decided.

**The candidate universe may not be re-expanded back toward the full
screener universe without both of the following:**

1. A resume-from-where-it-left-off cursor in the affected ingest
   worker, so a timed-out run does not silently restart from the top
   of the list and never finish.
2. A scope sign-off from the Senior Quant / Joe documenting why the
   wider scope is needed and what the additional request budget cost
   is.

The current scope (45-day insider-purchase window + 7-day recent-
launch arm) was chosen to cover any name that could plausibly launch
in the next ~30 days while leaving a 15-day buffer for names that
pick up Rule B or C eligibility on subsequent days. Same-night
genuinely-new insider filings continue to accept a one-day enrichment
lag rather than blow the budget.

## Expected outcome

| Measure                                 | Before          | After            |
|-----------------------------------------|-----------------|------------------|
| Designed UW requests/day                | ~82,000         | ~14,000          |
| Against the 20,000/day ceiling          | ~400%           | ~70%             |
| Morning feeds finishing each run        | No (~21% on SI) | Yes              |
| Evening feeds finishing each run        | No (~50-70%)    | Yes              |
| Feeds running twice a day for no reason | 6               | 0                |
| Per-minute rate-limit collisions        | Frequent        | Eliminated       |
| Numbers feeding the MacroTilt Score     | —               | Unchanged        |
| Anything the user sees                  | —               | Unchanged        |

The 82,000 figure is a designed-load estimate, not a measured number.
The first end-of-day meter reading (Phase 2b) will confirm it or
revise it.
