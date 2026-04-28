-- ============================================================================
-- Migration 031 — Make pipeline-health-check cron durable (#1077, Option B)
-- ============================================================================
-- Why
-- ---
-- The 30-min freshness watchdog (`pipeline-health-check-30min`) was wired in
-- migration 021 to read the project URL and bearer token from the
-- `app.settings.supabase_url` / `app.settings.supabase_anon_key` GUCs that
-- Supabase Studio populates. Those GUCs went unset on or about
-- 2026-04-24 23:00 ET (cause unknown; possibly a cluster restart or a
-- project setting that got toggled), and every run since has handed the
-- HTTP call a NULL url and NULL bearer — 66 consecutive failures with
-- zero successes, freezing the freshness RAG dots site-wide.
--
-- This migration switches the watchdog to the same durable invocation
-- pattern the universe-snapshot-backup and scan-backup jobs use:
--   - The Supabase project URL is hardcoded (it's stable and public).
--   - The bearer is pulled from `vault.decrypted_secrets`, NOT from
--     `app.settings.*`. The vault persists across cluster restarts and
--     project-setting changes.
--
-- This is Option B from the bug report — mirroring the proven pattern the
-- other scheduled jobs already use, instead of patching the missing GUC
-- back into place (which could disappear again the same way).
--
-- pipeline-health-check itself does NOT validate the bearer, but we send
-- TRIAGE_WEBHOOK_TOKEN anyway for consistency with the other internal
-- cron-driven invocations and so the Studio invocation log shows a
-- consistent caller identity.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Drop the old job (the one that reads from app.settings).
DO $$
BEGIN
  PERFORM cron.unschedule('pipeline-health-check-30min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Re-schedule with the durable (hardcoded URL + vault-bearer) pattern.
SELECT cron.schedule(
  'pipeline-health-check-30min',
  '*/30 * * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/pipeline-health-check',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || (
                     SELECT decrypted_secret
                     FROM vault.decrypted_secrets
                     WHERE name = 'TRIAGE_WEBHOOK_TOKEN'
                     LIMIT 1
                   )
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 25000
    ) AS request_id;
  $cron$
);

COMMENT ON EXTENSION pg_cron IS
  'Scheduled jobs include: pipeline-health-check-30min (freshness RAG, '
  'durable invocation per migration 031), universe-snapshot-backup-* '
  '(GH cron backups), scan-backup-*, generate-commentary-daily-1130utc, '
  'and assorted retention sweeps.';
