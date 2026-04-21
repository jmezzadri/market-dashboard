-- 008_bug_triage_columns.sql
-- Adds the columns the approve-bug-fix edge function + bug-triage-daily
-- scheduled task expect on bug_reports. Safe/idempotent — uses IF NOT EXISTS.

ALTER TABLE IF EXISTS public.bug_reports
  ADD COLUMN IF NOT EXISTS status        text        NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS resurface_at  timestamptz,
  ADD COLUMN IF NOT EXISTS fixed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS fixed_pr      integer,
  ADD COLUMN IF NOT EXISTS fixed_sha     text,
  ADD COLUMN IF NOT EXISTS triage_branch text,
  ADD COLUMN IF NOT EXISTS last_triaged_at timestamptz;

-- Allowed status values: 'new' (fresh), 'triaged' (in email queue),
-- 'skipped' (deferred, will resurface), 'fixed' (merged), 'dismissed' (manual).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bug_reports_status_check'
  ) THEN
    ALTER TABLE public.bug_reports
      ADD CONSTRAINT bug_reports_status_check
      CHECK (status IN ('new','triaged','skipped','fixed','dismissed'));
  END IF;
END$$;

-- The daily task queries for work via this view:
--   status='new' OR (status='skipped' AND resurface_at <= now())
-- Index accelerates both the query and the nightly resurface scan.
CREATE INDEX IF NOT EXISTS bug_reports_triage_queue_idx
  ON public.bug_reports (status, resurface_at)
  WHERE status IN ('new','skipped');
