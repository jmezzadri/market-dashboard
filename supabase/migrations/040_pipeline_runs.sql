-- Migration 040 — pipeline_runs table.
--
-- Background
-- ──────────
-- pipeline_health.massive-* rows compute freshness from
-- max(ingested_at) on the corresponding data tables. That works as
-- long as new rows arrive every day. When a daily refresh runs and
-- finds nothing has changed (e.g. universe_master is stable), the
-- ingestion uses ON CONFLICT DO NOTHING and no row updates — so
-- max(ingested_at) goes stale and the freshness chip flips to red
-- even though the pipeline ran successfully.
--
-- Fix
-- ───
-- Track a "last successful run" timestamp in a tiny separate table.
-- The pipeline-health-check edge fn reads from this for massive-*
-- rows instead of max(ingested_at). Producers (the daily refresh
-- scripts) write here on success.
--
-- Authority
-- ─────────
-- Data Steward sign-off: this is the canonical "pipeline run" registry.
-- Lead Developer sign-off: edge fn + script wiring follow.

CREATE TABLE IF NOT EXISTS public.pipeline_runs (
    pipeline_name      text PRIMARY KEY,
    last_run_at        timestamptz NOT NULL,
    last_run_status    text NOT NULL CHECK (last_run_status IN ('success','failure')),
    last_error         text,
    rows_processed     integer,
    duration_seconds   numeric(10,2),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pipeline_runs IS
    'Last-successful-run registry per producer pipeline. Read by '
    'pipeline-health-check for chips whose freshness should reflect '
    '"did the pipeline run today" rather than "did new rows land today".';

-- Seed rows so the chip gets accurate values from the very next
-- pipeline-health-check run, before the first refresh-cron writes here.
-- Timestamps mirror the current max(ingested_at) values in the
-- corresponding data tables, so the chip transitions match user
-- expectations.
INSERT INTO public.pipeline_runs (pipeline_name, last_run_at, last_run_status)
VALUES
    ('massive-universe',          (SELECT max(ingested_at) FROM public.universe_master),    'success'),
    ('massive-eod',               (SELECT max(ingested_at) FROM public.prices_eod),         'success'),
    ('massive-corporate-actions', (SELECT max(ingested_at) FROM public.dividends),          'success'),
    ('massive-ticker-details',    (SELECT max(ingested_at) FROM public.ticker_reference),   'success')
ON CONFLICT (pipeline_name) DO NOTHING;

-- Service role can read/write; anon can read (so the Pipeline Panel UI
-- can show "last run" alongside the chip).
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipeline_runs_anon_read ON public.pipeline_runs
    FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY pipeline_runs_service_write ON public.pipeline_runs
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);
