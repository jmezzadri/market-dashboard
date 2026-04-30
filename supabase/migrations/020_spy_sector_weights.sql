-- 020_spy_sector_weights.sql
-- ----------------------------------------------------------------------------
-- Bug #1087 Phase 1 INGEST: live SPY sector cap-weights.
--
-- Source: State Street SPDR S&P 500 ETF (SPY) holdings file (free, daily-
-- refreshed, official). Replaces the hardcoded SPY_WEIGHTS map currently
-- embedded in src/AssetAllocation/DrillDownPanel.jsx + SideTable. Phase 2
-- (frontend wire-up) and Phase 3 (freshness chip + LESSONS rule) ship as
-- separate bug rows under the SPY-weights umbrella.
--
-- Pipeline name: market-spy_sector_weights-daily
-- Cadence: weekday daily, 06:00 ET
-- Owner: Data Steward
-- Consumer: Asset Allocation tab (DrillDownPanel SPY weight column).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spy_sector_weights (
  date          date          NOT NULL,
  sector        text          NOT NULL,
  weight_pct    numeric(8, 5) NOT NULL CHECK (weight_pct >= 0 AND weight_pct <= 1),
  source        text          NOT NULL DEFAULT 'ssga_spdr_spy_holdings',
  inserted_at   timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (date, sector)
);

CREATE INDEX IF NOT EXISTS spy_sector_weights_date_idx
  ON public.spy_sector_weights (date DESC);

COMMENT ON TABLE  public.spy_sector_weights IS
  'Daily SPY sector cap-weights (GICS sectors). Source: SSGA SPY holdings file. Bug #1087 Phase 1.';
COMMENT ON COLUMN public.spy_sector_weights.weight_pct IS
  'Decimal weight (0.0 to 1.0) of the sector in the SPY ETF as of `date`. Sectors should sum to ~1.0 per `date`.';

-- RLS: public read, service-role write. Frontend reads via anon role through
-- a dedicated SELECT policy; ingest writes via service role (bypasses RLS).
ALTER TABLE public.spy_sector_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spy_sector_weights_public_read" ON public.spy_sector_weights;
CREATE POLICY "spy_sector_weights_public_read"
  ON public.spy_sector_weights
  FOR SELECT
  TO anon, authenticated
  USING (true);
