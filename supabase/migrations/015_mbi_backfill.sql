-- ============================================================================
-- Migration 015 — Master Bug Inventory backfill (7 open items)
-- ============================================================================
-- Source: MASTER_BUG_INVENTORY_2026-04-22.md
--
-- Imports the items that the MBI still has marked as OPEN / UAT-pending / or
-- BLOCKED so everything lives on /#bugs and we can stop juggling two
-- sources of truth. One-shot, idempotent — rerunning is a no-op.
--
-- Breakdown
-- ---------
--   UAT-pending (status=deployed, awaiting Joe's eyeball):
--     #1014/1015 → bar charts on negatives (gross/net split)
--     MBI-5b     → tile mini-chart native cadence (VIX/ANFCI/CAPE/SLOOS)
--     MBI-15     → #1004 duplicate-ticker price identity
--
--   Blocked chain (status=triaged, all 3 blocked by MBI-10):
--     MBI-10     → 20y historical data backfill (static JSON vs Supabase)
--     MBI-11     → TradingView Lightweight Charts swap (blocked_by 10)
--     MBI-12     → crosshair hover / real data points (blocked_by 10 + 11)
--
--   Housekeeping:
--     MBI-32     → unpushed local-main commits — probably already resolved
-- ============================================================================

do $$
declare
  n_existing int;
  id_10 uuid;
  id_11 uuid;
  id_12 uuid;
begin
  -- ── Guard: don't rerun ─────────────────────────────────────────────────
  select count(*) into n_existing
    from public.bug_reports
   where reporter_email = 'mbi-backfill@macrotilt.internal';
  if n_existing > 0 then
    raise notice 'MBI backfill already run (% rows exist). Skipping.', n_existing;
    return;
  end if;

  -- ── UAT-pending items (status=deployed) ────────────────────────────────

  -- #1014 / #1015 — bar charts on negatives (already shipped, awaiting UAT)
  insert into public.bug_reports (
    reporter_email, reporter_name, title, description,
    triage_notes, proposed_solution,
    status, complexity, priority,
    triaged_at, awaiting_approval_at, approved_at,
    merged_at, merged_pr, merged_sha,
    deployed_at, deployed_sha,
    uat_mode, auto_uat_checklist,
    url_hash
  ) values (
    'mbi-backfill@macrotilt.internal', 'MBI Import',
    'Stacked bars break when portfolio has negative value (margin debit)',
    'The stacked-bar visualizations on /#portopps (WEALTH BY ACCOUNT, ASSET CLASS MIX) produce transparent or empty slices when any account holds a negative-value position such as a margin debit or short. The AcctCard per-account mini bars also render invisible slices on the brokerage account that contains the -$40k cash row. Symptom was first reported as bugs #1014 and #1015.',
    'Root cause: the renderer used `flex: value / total` weighting, which silently collapses to zero when any value is negative — the denominator is skewed and the visual breaks. Fix: renderBar2 now splits gross vs net denominators and the WEALTH BY ACCOUNT header reads "6 accounts · $517K" while ASSET CLASS MIX reads "6 classes · $554K gross · $517K net" when there is a margin liability. ACCT_PALETTE fallback covers accounts with null account colors. See feedback_negative_values_break_flex_bars.md.',
    'Shipped via PR #59 (renderBar2 gross/net split) + PR #60 (ACCT_PALETTE fallback for null account colors) + PR #61 (margin debt split into its own bucket so Gross − Net = $40K exactly).',
    'deployed', 'M', 'P1',
    now(), now(), now(),
    now(), 59, 'f50484f',
    now(), 'c18fb23',
    'manual',
    'Navigate to /#portopps and confirm: (1) WEALTH BY ACCOUNT bar renders 6 colored slices matching the legend; (2) ASSET CLASS MIX header reads two distinct numbers (e.g. "6 classes · $554K gross · $517K net"); (3) AcctCard mini-bar on the brokerage account with the -$40k cash row shows a visible slice.',
    '#portopps'
  );

  -- MBI-5b — tile mini-chart native cadence
  insert into public.bug_reports (
    reporter_email, reporter_name, title, description,
    triage_notes, proposed_solution,
    status, complexity, priority,
    triaged_at, approved_at, merged_at, deployed_at,
    uat_mode, auto_uat_checklist,
    url_hash
  ) values (
    'mbi-backfill@macrotilt.internal', 'MBI Import',
    'Tile mini-chart cadence mismatch (should be native frequency per indicator)',
    'The indicator tile mini-charts on the dashboard landing view render a smoothed quarterly line for every indicator, rather than the native release cadence. VIX ticks daily, ANFCI ticks weekly, CAPE ticks monthly, SLOOS ticks quarterly — but all four tiles currently render a synthetic quarterly line. This hides real volatility in the high-frequency series and makes the dashboard feel less live than it actually is.',
    'Root cause: during the PR #14 minichart refactor, the tile mini-chart reduced every indicator series to quarterly bins by default to keep the sparkline compact, and the native-cadence code path that PR #15 introduced was not wired to the tile. Fix: tile mini-chart should read IND_FREQ[id] and render at native cadence (daily/weekly/monthly/quarterly) so each tile matches the cadence already used on the indicator detail modal.',
    'Follow-on fix to PR #14 and PR #15; wire useHistReady output into the tile mini-chart renderer at native cadence rather than collapsing to quarterly bins.',
    'deployed', 'M', 'P2',
    now(), now(), now(), now(),
    'manual',
    'Navigate to the main dashboard. Confirm the VIX tile mini-chart shows daily ticks, ANFCI weekly, CAPE monthly, SLOOS quarterly. Compare each tile against the corresponding indicator detail modal — cadence should match.',
    '#home'
  );

  -- MBI-15 — #1004 duplicate-ticker price identity
  insert into public.bug_reports (
    reporter_email, reporter_name, title, description,
    triage_notes, proposed_solution,
    status, complexity, priority,
    triaged_at, approved_at, merged_at, deployed_at,
    uat_mode, auto_uat_checklist,
    url_hash
  ) values (
    'mbi-backfill@macrotilt.internal', 'MBI Import',
    'Duplicate-ticker lots show different CURRENT MARKET PRICE on positions table',
    'When a position has two lots of the same ticker (e.g. two buys of AAPL at different purchase dates), the Positions table on /#portopps shows different CURRENT MARKET PRICE values for each row. They should be identical — the live price for a ticker is unique by definition.',
    'Root cause suspected: the positions hydration logic may be seeding last_price per-lot from cost_basis during the initial fetch before the universe snapshot overlays the live price, and if one of the lots scanned at a different moment it never got the second-pass overlay. Fix direction: enforce a single price-per-ticker reduce step after the universe_snapshot mergeInto so all rows for the same ticker settle to the same live price.',
    'Under investigation — verify symptom on live first, then instrument the hydration path to confirm where the two lots diverge.',
    'deployed', 'L', 'P2',
    now(), now(), now(), now(),
    'manual',
    'Navigate to /#portopps. Find any ticker with two lots (different purchase dates). Confirm the CURRENT MARKET PRICE column shows the identical value on both rows.',
    '#portopps'
  );

  -- ── Blocked chain (status=triaged) ─────────────────────────────────────

  -- MBI-10 — 20y historical backfill (blocker for 11 + 12)
  insert into public.bug_reports (
    reporter_email, reporter_name, title, description,
    triage_notes, proposed_solution,
    status, complexity, priority,
    triaged_at,
    uat_mode
  ) values (
    'mbi-backfill@macrotilt.internal', 'MBI Import',
    'Composite Stress History — 20-year historical data backfill',
    'The Composite Stress History chart on the landing view should extend back at least 20 years so the user can see prior crisis regimes (2008 GFC, 2020 COVID, 2022 inflation). Currently the series only extends back to the indicator refresh cutoff which gives maybe 2-3 years of coverage. Extending back gives the composite score real comparative context.',
    'Root cause: indicator_history.json is populated from the per-indicator refresh workflow which only reaches back as far as the upstream data source (e.g. FRED/UW) returns in a single fetch call. For 20-year coverage we need a different ingestion strategy.',
    'Decision pending from Joe: option A — static JSON in repo (recommended — no runtime cost, one-time script pulls 20y history per indicator and checks in to repo); option B — Supabase indicator_history_long table populated via a separate weekly workflow. I recommend A for simplicity. This bug blocks MBI-11 and MBI-12.',
    'triaged', 'H', 'P1',
    now(),
    'manual'
  ) returning id into id_10;

  -- MBI-11 — TradingView Lightweight Charts swap (blocked by 10)
  insert into public.bug_reports (
    reporter_email, reporter_name, title, description,
    triage_notes, proposed_solution,
    status, complexity, priority,
    triaged_at, blocked_by,
    uat_mode
  ) values (
    'mbi-backfill@macrotilt.internal', 'MBI Import',
    'Swap Composite Stress History chart library to TradingView Lightweight Charts',
    'Replace the current Recharts-based Composite Stress History chart with TradingView Lightweight Charts. This gives us crosshair hover, zoom/pan, and a more polished interaction model that matches the rest of the institutional-data-vendor aesthetic we are heading toward. Blocked until MBI-10 resolves because the swap requires real 20-year data to be worth the effort.',
    'Root cause: Recharts struggles at the density we want (20y of daily-native data for VIX, etc) and does not ship a performant crosshair. TradingView Lightweight is purpose-built for financial time series.',
    'Add tradingview-lightweight-charts dependency, port the CompHistChart component, wire the same pill timeframe selector (1Y/3Y/5Y/10Y/MAX) that PR #63 landed, keep the crisis-marker overlays. Blocked by MBI-10 — decision on data source must come first.',
    'triaged', 'H', 'P2',
    now(), array[id_10],
    'manual'
  ) returning id into id_11;

  -- MBI-12 — crosshair hover / real data points (blocked by 10 + 11)
  insert into public.bug_reports (
    reporter_email, reporter_name, title, description,
    triage_notes, proposed_solution,
    status, complexity, priority,
    triaged_at, blocked_by,
    uat_mode
  ) values (
    'mbi-backfill@macrotilt.internal', 'MBI Import',
    'Chart hover shows real data points (crosshair readout)',
    'Users hovering the Composite Stress History chart should see a crosshair showing the exact date and value at the cursor position, not just the nearest rounded data point. This is a standard Bloomberg-terminal interaction the current chart does not support. Blocked by MBI-11 (needs the library swap) which is blocked by MBI-10 (needs the 20y data).',
    'Root cause: Recharts hover renders a tooltip but no crosshair and snaps to the nearest rendered point rather than the cursor x-position. A proper crosshair needs a library built for it.',
    'Once MBI-11 lands TradingView Lightweight, the crosshair-readout is a configuration flag on the chart instance — not a separate build. Blocked by MBI-11 (which is blocked by MBI-10).',
    'triaged', 'M', 'P2',
    now(), array[id_10, id_11],
    'manual'
  ) returning id into id_12;

  -- ── Housekeeping — MBI-32 ──────────────────────────────────────────────
  insert into public.bug_reports (
    reporter_email, reporter_name, title, description,
    triage_notes, proposed_solution,
    status, complexity, priority,
    triaged_at,
    uat_mode
  ) values (
    'mbi-backfill@macrotilt.internal', 'MBI Import',
    'Unpushed local-main commits dbf66d3 and b4b8d91',
    'The 2026-04-21 PM inventory flagged two local-main commits (dbf66d3 and b4b8d91) that may not have reached origin. Per the 2026-04-21 PM note the PR #30 push-log actually showed local main behind origin/main, so these commits may not exist on local main at all. Housekeeping check to confirm before the memory grows stale.',
    'Root cause: routine drift between Mac local main and origin/main during heavy ship cadence. Not a bug per se — a verification task.',
    'Run on the Mac: git log origin/main..main --oneline. If empty, this row closes as duplicate/needs_info. If non-empty, inspect each commit and decide land/discard/redo case by case.',
    'triaged', 'L', 'P3',
    now(),
    'manual'
  );

  raise notice 'MBI backfill complete — 7 rows inserted.';
end$$;
