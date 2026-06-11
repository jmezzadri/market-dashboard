-- Migration 064: api_usage_log source check — admit the six 2026-05 feed sources
-- ----------------------------------------------------------------------------
-- The Phase-1 enrichment feeds (dark pool prints, options EOD, options flow,
-- short interest, analyst ratings, congress trades) write one run-ledger row
-- per run to public.api_usage_log. The source check written in migration 011
-- predates those feeds, so EVERY one of their ledger writes has bounced with
-- 23514 since 2026-05-20 — silently, because the logging helper swallows
-- failures by design (a flaky logger must never fail a run).
--
-- This matters now because the run-slot gate shipped in PR #1096 dedups the
-- two DST cron lines against this ledger ("skip if a success row exists since
-- ET midnight"). Until the constraint admits these sources, the gate's ledger
-- check can never find a row and both cron lines will run the feed on summer
-- days when both land inside the window. Idempotent, but ~2x the API spend.
alter table public.api_usage_log
  drop constraint if exists api_usage_log_source_check;

alter table public.api_usage_log
  add constraint api_usage_log_source_check
  check (source in (
    -- original migration-011 sources
    'universe_snapshot', 'ticker_events', 'daily_scanner',
    'scan_on_add', 'indicator_refresh', 'ad_hoc',
    -- 2026-05 Phase-1 enrichment + v5 feed sources (PR #1096 run-slot gate)
    'darkpool_prints', 'options_eod', 'options_flow',
    'short_interest', 'analyst_ratings', 'congress_trades'
  ));
