-- 074_seed_vxn_health.sql
-- Seed the pipeline_health row for VXN (CBOE Nasdaq-100 Volatility Index),
-- added 2026-06-23 as a new indicator mirroring VIX.
--
-- The 30-minute pipeline-health-check edge function ONLY updates rows that
-- already exist. VXN lives in public/indicator_history.json under the key
-- "vxn", so it falls into the edge function's GENERIC indicator branch
-- (indicators[row.indicator_id] -> rec.as_of) — no edge-function code change
-- is required, only this seed row. Without it the feed would render
-- "fake-green" (untracked -> green by default), which Hard Rule 0.1 forbids.
--
-- cadence codes: D=Daily. expected_cadence_minutes mirrors the existing seed
-- convention (daily = 1440). Source is Yahoo ^VXN (same provider as VIX's
-- producer). Seeded green; the watchdog recomputes real RAG off rec.as_of on
-- its next run.

INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES
  ('vxn', 'VXN', 'Yahoo ^VXN', 'D', 1440, 'green')
ON CONFLICT (indicator_id) DO NOTHING;
