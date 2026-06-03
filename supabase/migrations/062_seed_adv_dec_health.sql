-- 062 (2026-06-03): Seed pipeline_health for adv_dec so its freshness chip is
-- genuinely tracked (the 30-min watchdog only updates existing rows; without a
-- seed it would render fake-green). Applied live via the Management API in the
-- BREADTH-REBUILD workflow; this file is the source-of-truth record.
INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES ('adv_dec', 'Market breadth (A/D)', 'computed', 'D', 1440, 'green')
ON CONFLICT (indicator_id) DO NOTHING;
