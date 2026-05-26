# Phase 6 — Self-UAT Checklist

**Status:** Code-complete and statically validated. Visual UAT pending deploy.

What's already verified in this session (no deploy needed):
- ✅ All 33 unit tests passing (sleeves, diff, mirror, submitter, backtest metrics).
- ✅ Paper Portfolio page parses cleanly through esbuild — no JSX syntax errors.
- ✅ Every Supabase table + column the page reads exists in migration 058.
- ✅ Every freshness-chip elementId matches a registered entry in data_manifest v11.
- ✅ Sleeve A allocation matches engine output ($500,050 across 24 ETFs in dry-run).
- ✅ Sleeve B math walked through council; Senior Quant signed off.
- ✅ Live-trading kill-switch — runner downgrades to dry-run unless
  `PAPER_LIVE_TRADING_ENABLED=true` env var is set.
- ✅ Idempotency proven by unit test — duplicate submission of the same
  client_order_id is repaired, not re-fired.
- ✅ Brand-guard sweep on page — no emojis, no TODO/FIXME, no console.log,
  no placeholders, no lorem ipsum.
- ✅ Banned-token sweep clean per the 2026-05-07 LESSONS rule.

What's pending post-deploy (Joe's first session after merge):

## Visual UAT — Lead Dev + UX Designer

After the deploy lands on macrotilt.com:

1. **Page loads** — visit `https://macrotilt.com/#paper`. Confirm:
   - Sidebar shows "Paper Portfolio" entry with the radar icon between
     Portfolio Insights and Scenario Analysis.
   - Page renders without a blank screen / React error.
2. **Initial empty state** — before any nightly run, the page should show:
   - NAV hero with "No NAV history yet" message.
   - Sleeve A + Sleeve B panels both showing "No positions yet" / "Awaiting
     first rebalance" text.
   - Rebalance log section showing "No orders yet" message.
   - All four freshness chips render in their amber/red state (since no
     pipeline has run yet).
3. **Light-mode brand check** — confirm:
   - Page background matches the rest of the dashboard.
   - KPI cells use the same border/surface variables.
   - Sort arrows work on every column.
   - No console errors in browser devtools.
4. **First post-cycle render** — after the first scheduled EOD run:
   - Rebalance log shows today's date with a count of orders.
   - Status chip on each order row shows "pending" (orders not yet
     submitted — kill-switch still off).

## Manual live-submission readiness gate

Before flipping the live-trading kill-switch, Joe should:

1. Go to GitHub → Actions tab → "PAPER-PORTFOLIO-EOD-DAILY" → "Run
   workflow" → set `dry_run` to `true` → click Run.
2. Open the workflow log. Confirm:
   - Translator prints sane counts (~24 Sleeve A intents, some number of
     Sleeve B intents based on current scanner output).
   - Submitter prints "submitted=0" lines for every intent (dry-run path).
   - No exception traces.
3. If the dry-run log looks right, flip the kill-switch:
   - GitHub → Settings → Secrets and variables → Actions → New repository
     secret →
     - Name: `PAPER_LIVE_TRADING_ENABLED`
     - Value: `true`
4. The next scheduled 16:30 ET tick will submit live MOO orders for the
   following morning's opening auction.

## Safe first-trade test (recommended)

Before letting the full $1M of intent fire, do a single 1-share SPY test:

1. Manually `INSERT INTO public.paper_orders` one row: BUY 1 share of SPY,
   sleeve = 'A', signal_source = 'asset_tilt', status = 'pending'. (One
   `INSERT` statement; the Data Steward can hand it over.)
2. Go to GitHub → Actions → "PAPER-PORTFOLIO-EOD-DAILY" → Run workflow
   (live, no dry-run).
3. Check the workflow log shows the SPY submission.
4. Next morning, the OPEN workflow fires at 09:45 ET. Confirm:
   - 1 row in `paper_fills` for SPY.
   - 1 row in `paper_positions` for today's date, sleeve='A'.
   - 1 row in `paper_nav_daily` for today's date.
   - Paper Portfolio page on macrotilt.com shows the SPY position.
5. If all four checks pass, the full Sleeve A + Sleeve B rebalance is
   safe to release.

## Roll-back path

If anything looks wrong post-deploy:
- **Cosmetic page issue:** Joe pings UX Designer; non-blocking; we
  iterate in a follow-up PR.
- **Wrong submissions on the page:** flip `PAPER_LIVE_TRADING_ENABLED`
  off (delete the secret); the runner instantly downgrades back to dry-run.
- **Money moved by mistake** (paper account only — no real capital):
  Alpaca paper account can be reset from the Alpaca dashboard. Sleeve
  attribution from `paper_orders` audit log makes it easy to identify
  which orders fired.
