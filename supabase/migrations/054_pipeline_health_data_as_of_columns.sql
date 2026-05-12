-- 054_pipeline_health_data_as_of_columns.sql
--
-- Phase 1a of the Data Steward structural overhaul (2026-05-12).
--
-- The freshness UX has been lying for months because pipeline_health stores
-- "when did the cron last RUN" but the user-facing chips imply "what trading
-- day is the data FROM". Those are different things. A workflow can succeed
-- with an empty payload, or a back-fill can write today's ingested_at on a
-- row whose trade_date is six days ago, and pipeline_health says green
-- while the page renders stale data.
--
-- This migration adds three columns the producers will start writing:
--
--   data_as_of         The trading-day or as_of_date the data point
--                      represents. Anchored to the value, not the cron.
--                      For EOD prices, this is the trade_date. For FRED
--                      macro series, it's the observation date. For ad-hoc
--                      portfolio writes, it's the broker statement date.
--
--   expected_next_run  When the registry-configured next run is due. Lets
--                      the chip render "next refresh tomorrow 06:00 ET"
--                      and compute SLA breach time-to-go.
--
--   coverage_pct       For producers that span a universe (UW universe
--                      scrape covers ~16% of tickers; Polygon Massive
--                      covers 100%; FRED scrapes one series each), the
--                      ratio rows_written / rows_expected from the
--                      manifest. Lets us catch silent coverage failures
--                      (e.g. UW returning 2,000 of 12,500 expected) that
--                      look "green" on a row-count > 0 basis but are
--                      structurally broken.
--
-- All three are nullable so existing rows don't break. Producers will
-- backfill them on next run; legacy rows stay null until refreshed.

ALTER TABLE public.pipeline_health
  ADD COLUMN IF NOT EXISTS data_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS expected_next_run timestamptz,
  ADD COLUMN IF NOT EXISTS coverage_pct numeric(5,2);

COMMENT ON COLUMN public.pipeline_health.data_as_of IS
  'The trading-day / observation-date / as-of timestamp of the LATEST '
  'data point this pipeline produced. NOT when the cron ran. The freshness '
  'chip on every consumer surface should anchor to this column.';

COMMENT ON COLUMN public.pipeline_health.expected_next_run IS
  'When this pipeline is next due to refresh per pipeline_schedule.yml. '
  'Used to render countdown labels and SLA-breach logic.';

COMMENT ON COLUMN public.pipeline_health.coverage_pct IS
  'For universe-spanning producers, rows_written / rows_expected * 100. '
  'Catches silent coverage failures that look green on row-count basis.';

-- Add an index on data_as_of for the (frequent) freshness queries.
CREATE INDEX IF NOT EXISTS idx_pipeline_health_data_as_of
  ON public.pipeline_health (data_as_of DESC NULLS LAST);
