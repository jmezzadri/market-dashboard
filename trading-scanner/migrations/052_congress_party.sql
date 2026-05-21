-- 052_congress_party.sql
-- Bug #1098 — congress_trades_daily had no party column, so the Scanner
-- "Congress activity" table had to fall back to a static bundled name
-- roster and showed a blank Party cell for any member not in that roster.
--
-- UW does not put party on the /congress/recent-trades rows, but it exposes
-- the party on a separate politician roster at /congress/politicians, keyed
-- by politician_id. The ingest (scanner/signal_intelligence_v5/congress_ingest.py)
-- now pulls that roster once per run and stamps party + politician_id onto
-- every row it writes.
--
-- ADD COLUMN inherits the table's existing grants and row-level security —
-- congress_trades_daily was granted in 051_v5_signal_intel_tables.sql, so no
-- new GRANT is required (per the 2026-05-13 LESSONS rule, which scopes the
-- mandatory GRANT block to *new* public tables).
--
-- Applied to production via the Supabase Management API on 2026-05-21; this
-- file is the version-controlled record so a fresh checkout reproduces it.

alter table public.congress_trades_daily
  add column if not exists politician_id text,
  add column if not exists party text;
