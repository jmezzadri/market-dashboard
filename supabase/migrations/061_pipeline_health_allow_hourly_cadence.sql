-- 061_pipeline_health_allow_hourly_cadence.sql
-- Allow 'H' (hourly / intraday) cadence in pipeline_health so the live paper
-- feeds (paper-positions-intraday, paper-nav-intraday) can own real freshness
-- rows. Without this the cadence check rejected 'H' and the intraday stamp
-- failed silently (Joe directive 2026-06-23 — live intraday paper view).
ALTER TABLE public.pipeline_health DROP CONSTRAINT IF EXISTS pipeline_health_cadence_check;
ALTER TABLE public.pipeline_health ADD CONSTRAINT pipeline_health_cadence_check
  CHECK (cadence IN ('D','W','M','Q','H'));
