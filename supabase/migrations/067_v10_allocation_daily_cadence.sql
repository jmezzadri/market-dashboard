-- 067 — v10_allocation health row carried a WEEKLY cadence (10080 min) on a
-- DAILY element, so the overdue checker would not flag a missed daily run for
-- a week. One of three reasons the Asset Tilt chip stayed green while the
-- sector sleeve sat 2 sessions stale (Joe, 2026-06-12). Idempotent.
update public.pipeline_health
   set expected_cadence_minutes = 1440,
       updated_at = now()
 where indicator_id = 'v10_allocation'
   and expected_cadence_minutes is distinct from 1440;
