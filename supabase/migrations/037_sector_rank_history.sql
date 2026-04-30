-- 037_sector_rank_history.sql
-- ----------------------------------------------------------------------------
-- Phase 3 PR #7 — fix the broken Sector Outlook tile on Home.
--
-- generate-commentary edge fn currently writes null with reason
-- 'sector_rank_history_not_wired' (line 292) because the upstream table
-- this PR creates didn't exist. After this migration + the daily compute
-- script (scripts/compute_sector_ranks.py) ship, the tile renders a daily
-- AI-written sector blurb.
--
-- Pipeline name: equity-sector_rank-daily
-- Cadence: weekday daily, after SCAN_330PM (15:30 ET) completes
-- Owner: Lead Dev (writer) + Senior Quant (rank methodology)
-- Consumer: supabase/functions/generate-commentary (writes
--           public.sector_commentary daily blurb)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sector_rank_history (
  as_of            date          NOT NULL,
  sector           text          NOT NULL,
  composite_score  numeric       NOT NULL,   -- avg of per-ticker composites in sector (-100..+100)
  rank_today       int           NOT NULL,   -- 1 = strongest, 11 = weakest (11 GICS sectors)
  ticker_count     int           NOT NULL,
  inserted_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (as_of, sector)
);

CREATE INDEX IF NOT EXISTS sector_rank_history_as_of_idx
  ON public.sector_rank_history (as_of DESC);

COMMENT ON TABLE  public.sector_rank_history IS
  'Daily per-sector composite scores + ranks aggregated from latest_scan_data per-ticker technicals. Source for the Sector Outlook commentary tile (Phase 3 PR #7).';
COMMENT ON COLUMN public.sector_rank_history.composite_score IS
  'Average bidirectional composite (-100..+100) of all tickers in the sector for that date. Higher = stronger sector.';
COMMENT ON COLUMN public.sector_rank_history.rank_today IS
  '1 = strongest sector, N = weakest. Recomputed daily.';

-- RLS: public read (commentary edge fn reads via service-role anyway,
-- but consumer surfaces may want direct access later).
ALTER TABLE public.sector_rank_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sector_rank_history_public_read" ON public.sector_rank_history;
CREATE POLICY "sector_rank_history_public_read"
  ON public.sector_rank_history
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 90-day retention prune (matches universe_snapshots prune cadence).
SELECT cron.schedule(
  'sector_rank_history_prune_90d',
  '30 2 * * *',
  $$
    DELETE FROM public.sector_rank_history
    WHERE as_of < (current_date - INTERVAL '90 days')
  $$
);
