-- Migration 038 — pipeline_fetch_log
-- Phase 4 PR #15. Lead Developer + Data Steward sign-off.
--
-- Adds an append-only history of every pipeline-health-check run (and every
-- aggregate-recompute run, via a Python helper). The existing
-- public.pipeline_health table holds only the LATEST status per element;
-- this table holds the trailing history that the upcoming pipeline panel
-- (PR #17) reads as "last 7 fetch attempts."
--
-- Why a separate table:
-- - pipeline_health rows are a small fixed set (one per element). Read by
--   every chip on the page → must stay tiny + fast.
-- - pipeline_fetch_log grows ~70 rows per 30-min run = ~3.4k/day = ~100k/mo.
--   Capped via a retention policy to "last 30 days OR last 1000 per
--   indicator, whichever is longer."

CREATE TABLE IF NOT EXISTS public.pipeline_fetch_log (
  id              BIGSERIAL PRIMARY KEY,
  indicator_id    TEXT NOT NULL,
  check_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT NOT NULL CHECK (status IN ('green','amber','red')),
  age_minutes     INTEGER,
  last_value      JSONB,
  error_message   TEXT,
  source          TEXT,
  -- "atomic" = vendor pull (covered by edge fn) | "aggregate" = recompute job (Python helper)
  run_kind        TEXT NOT NULL DEFAULT 'atomic' CHECK (run_kind IN ('atomic','aggregate')),
  run_duration_ms INTEGER,
  -- Optional context payload — recompute jobs can stash inputs hash, error stack trace, etc.
  meta            JSONB
);

-- One indexed read pattern: "last N rows for a given indicator, newest first."
-- This is what the pipeline panel will query when the user clicks a chip.
CREATE INDEX IF NOT EXISTS idx_pipeline_fetch_log_indicator_check_at
  ON public.pipeline_fetch_log (indicator_id, check_at DESC);

-- Coarse-grained scan for retention prune + monitoring dashboards.
CREATE INDEX IF NOT EXISTS idx_pipeline_fetch_log_check_at
  ON public.pipeline_fetch_log (check_at DESC);

-- ─── Retention helper ───────────────────────────────────────────────────────
-- Keeps "everything in the last 30 days" + "the most recent 1000 per indicator
-- regardless of age." Belt-and-suspenders so the panel always has at least 1000
-- attempts per element to graph if needed, and so a quiet element (quarterly)
-- doesn't lose all its history just because the wall-clock is far ahead.
CREATE OR REPLACE FUNCTION public.prune_pipeline_fetch_log()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  pruned INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY indicator_id ORDER BY check_at DESC) AS rn,
           check_at
      FROM public.pipeline_fetch_log
  )
  DELETE FROM public.pipeline_fetch_log
   WHERE id IN (
     SELECT id FROM ranked
      WHERE rn > 1000
        AND check_at < NOW() - INTERVAL '30 days'
   );
  GET DIAGNOSTICS pruned = ROW_COUNT;
  RETURN pruned;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_pipeline_fetch_log() TO service_role;

-- pg_cron: prune nightly at 06:15 ET (10:15 UTC standard, 11:15 UTC during DST).
-- Default UTC schedule is 11:15 — close enough for nightly pruning.
SELECT cron.schedule(
  'pipeline_fetch_log_prune_nightly',
  '15 11 * * *',
  $$SELECT public.prune_pipeline_fetch_log();$$
);

-- ─── RLS ───────────────────────────────────────────────────────────────────
-- Read: anon allowed (panel renders from anon session). Write: service_role only
-- (edge function + Python helper).
ALTER TABLE public.pipeline_fetch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read pipeline_fetch_log"
  ON public.pipeline_fetch_log FOR SELECT
  TO anon, authenticated
  USING (true);

-- Service-role bypasses RLS already; explicit policy not required for writes.
