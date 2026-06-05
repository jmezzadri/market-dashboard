-- 063 (2026-06-05): Seed pipeline_health for cmdty_brent (Brent crude, the global
-- oil benchmark) so its freshness chip is genuinely tracked. The watchdog only
-- updates existing rows; without a seed it would render fake-green. The
-- MARKET-INDICATORS-EOD fetch also upserts this row on each run.
INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES ('cmdty_brent', 'Brent crude', 'Yahoo Finance', 'D', 1440, 'green')
ON CONFLICT (indicator_id) DO NOTHING;
