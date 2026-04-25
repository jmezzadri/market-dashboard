-- ============================================================================
-- Migration 021 — Schedule pipeline-health-check every 30 minutes
-- ============================================================================
-- Why
-- ---
-- Drives the RAG dots on every indicator/composite/tile. We re-compute
-- freshness twice an hour so the site never lies about staleness.
--
-- This follows the same pg_cron + pg_net pattern as migration 015's MBI
-- backfill and the trigger-workflow scheduler.
-- ============================================================================

-- Required extensions (safe to re-run; Supabase typically has these enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Unschedule prior incarnations if someone re-runs this.
DO $$
BEGIN
  PERFORM cron.unschedule('pipeline-health-check-30min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule the edge function every 30 minutes.
-- The URL pattern mirrors `trigger-workflow` — Supabase serves all functions
-- under <project>.functions.supabase.co. Pulls the project URL + anon key
-- from the `app.settings.supabase_url` / `app.settings.supabase_anon_key`
-- GUCs (set by Supabase Studio when edge functions are enabled).
SELECT cron.schedule(
  'pipeline-health-check-30min',
  '*/30 * * * *',
  $cron$
  SELECT net.http_post(
    url     := (current_setting('app.settings.supabase_url', true) || '/functions/v1/pipeline-health-check'),
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key', true),
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

-- Self-documenting row in pipeline_health so operators can confirm the
-- scheduler is wired. The first real invocation overwrites this.
COMMENT ON EXTENSION pg_cron IS 'Scheduled jobs: pipeline-health-check-30min (freshness RAG), plus existing MBI/triage/workflow jobs.';
