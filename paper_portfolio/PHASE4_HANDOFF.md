# Phase 4 — Execution Layer

**Date:** 2026-05-26
**Status:** ✅ Code complete; awaiting first live submission (Joe approval).
**Council:** Lead Developer (submitter / mirror / runner / workflow), Senior Quant (NAV math), Data Steward (pipeline naming + manifest registration).

## What this layer does

The translator (Phase 2) writes `pending` rows into `paper_orders`. The
backtest (Phase 3) validated the alpha. Phase 4 is what actually turns a
`pending` row into a live Alpaca order, then mirrors fills + positions
+ NAV back into Supabase so the Paper Portfolio tab (Phase 5) has
something to read.

### New files

```
paper_portfolio/
├── submitter.py     ← pending paper_orders → Alpaca MOO submissions
├── mirror.py        ← Alpaca state → paper_positions / paper_fills / paper_nav_daily
├── runner.py        ← nightly orchestrator (CLI)
└── tests/
    ├── test_submitter.py    (7 tests — idempotency, rejection, dry-run, …)
    └── test_mirror.py       (5 tests — positions, fills filter, NAV with leverage)
```

### New workflows

```
.github/workflows/PAPER-PORTFOLIO-EOD-DAILY.yml    ← 16:30 ET weekdays
.github/workflows/PAPER-PORTFOLIO-OPEN-DAILY.yml   ← 09:45 ET weekdays
```

## How idempotency works

If a workflow runs twice (network glitch, manual rerun), we cannot afford
to submit the same order to Alpaca twice.

The submitter sets `client_order_id = paper_orders.id` (a UUID) on every
POST. Alpaca enforces that client_order_id is unique per account. The
second submission of the same row therefore returns HTTP 422 with
"client_order_id already used"; the submitter recognises this, looks up
the existing order, and repairs the row's state to `submitted` with the
correct `alpaca_order_id`. No double-fire is possible.

Atomic narrowing on the SQL side is the second belt: every UPDATE has
`WHERE status='pending'`, so two parallel runners cannot both write
`status='submitted'` for the same row.

## What hasn't happened yet

1. **First live submission has not run.** This is by design — Phase 4
   only ships the code path. Joe approves the first run.

2. **A small safe live test is recommended before the first full
   rebalance.** Suggested protocol:
     - Manually insert a single test row into `paper_orders`: BUY 1
       share of SPY, sleeve A, signal_source 'asset_tilt'.
     - Trigger `PAPER-PORTFOLIO-EOD-DAILY.yml` manually from the Actions
       tab in dry-run mode first; verify the log shows the intended
       submission.
     - Run it again without dry-run. Alpaca submits 1 share of SPY MOO.
     - Trigger `PAPER-PORTFOLIO-OPEN-DAILY.yml` the next morning;
       verify the SPY fill arrives in `paper_fills`, the position in
       `paper_positions`, and a row in `paper_nav_daily`.
     - If all four artefacts look right, the full Sleeve A + Sleeve B
       rebalance is safe to release.

## Manifest registration

`data_manifest.json` bumped to v11. All six `portfolio.paper-*` entries
now carry pipeline_name + schedule_et + refresh_trigger pointing at the
two new workflows. Freshness chips on the Paper Portfolio tab (Phase 5)
will read from these entries.
