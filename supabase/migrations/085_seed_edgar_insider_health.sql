-- 085_seed_edgar_insider_health.sql
-- Seed the pipeline_health row for the SEC EDGAR insider feed
-- (insider_history_edgar — the manifest short name the freshness hook
-- resolves), missed at the 2026-07-20 UW→EDGAR cutover. LESSONS 0.1: every
-- new feed needs a seed row + manifest entry in the SAME change; the cutover
-- shipped the manifest entry only, so Admin·Data showed a red vendor-card
-- dot, a grey "Not yet tracked" row, and an "All feeds current" header pill
-- simultaneously (Joe 2026-07-21).
-- Honest stamp: last_good_at is the REAL completion time of the 2026-07-21
-- morning ingest (verified max(edgar_ingested_at)); data_as_of is the latest
-- transaction_date that run landed. The workflow stamps this row itself from
-- now on (green after publish, red on failure).
-- Applied to production via Management API 2026-07-21; kept here as the
-- migration of record.
INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status,
   last_good_at, last_check_at, data_as_of, expected_next_run)
VALUES
  ('insider_history_edgar',
   'Insider transactions (SEC EDGAR)',
   'sec-edgar', 'D', 1440, 'green',
   '2026-07-21 11:53:01+00', '2026-07-21 11:53:01+00',
   '2026-07-20 00:00:00+00', '2026-07-22 10:00:00+00')
ON CONFLICT (indicator_id) DO NOTHING;
