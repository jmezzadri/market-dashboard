-- ============================================================================
-- Migration 034 — pg_cron schedule for MASSIVE-DAILY workflow (Phase 2)
-- ============================================================================
-- Why
-- ---
-- The MASSIVE-DAILY GitHub Actions workflow runs nightly on its own cron
-- (22:00 UTC weekdays).  GitHub's scheduler is occasionally flaky — the
-- existing INDICATOR-REFRESH and SCAN workflows have backup pg_cron
-- triggers for exactly this reason (see cron jobs scan-backup-* and
-- indicator-refresh-backup-1105utc).
--
-- This migration adds the same belt-and-suspenders pattern for MASSIVE-
-- DAILY.  The pg_cron job calls the trigger-workflow Edge Function 30
-- minutes after the GH cron's expected fire time; trigger-workflow's
-- 90-minute dedupe guard ensures we don't double-run if GH already
-- fired the workflow.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Unschedule prior incarnation if someone re-runs this migration.
DO $$
BEGIN
  PERFORM cron.unschedule('massive-daily-backup-2230utc');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Backup pg_cron call: runs at 22:30 UTC weekdays (30 min after the GH
-- Actions schedule at 22:00 UTC).  The 90-minute dedupe in
-- trigger-workflow makes this a no-op when GH cron already succeeded.
SELECT cron.schedule(
  'massive-daily-backup-2230utc',
  '30 22 * * 1-5',
  $cron$
  SELECT net.http_post(
    url := 'https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/trigger-workflow',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'TRIAGE_WEBHOOK_TOKEN'
         LIMIT 1
      )
    ),
    body := '{"workflow":"MASSIVE-DAILY.yml"}'::jsonb,
    timeout_milliseconds := 25000
  ) AS request_id;
  $cron$
);
