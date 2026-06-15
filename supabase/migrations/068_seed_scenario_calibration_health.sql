-- 068_seed_scenario_calibration_health.sql
-- The quarterly scenario calibration bundle (public/scenario_calibration/*.json)
-- is a registered DEPENDENCY of the Scenario Analysis allocations ("scenarios"),
-- but had no pipeline_health row. The chip graded the missing row as "No
-- successful refresh" (red), and that red rolled UP into scenarios — the last
-- false red on the site-wide header. The freshness edge function only updates
-- EXISTING rows, so seed it here (keyed by the manifest NAME so the chip's
-- name/id key resolution finds it). The watchdog then reads its as_of from the
-- calibration files and grades it green within the quarterly SLA.
INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES
  ('scenario_calibration_bundle', 'Scenario Analysis · Calibration Bundle', 'in-house', 'Q', 129600, 'green')
ON CONFLICT (indicator_id) DO NOTHING;
