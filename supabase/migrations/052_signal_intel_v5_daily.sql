-- 052_signal_intel_v5_daily.sql
-- v5 Signal Intelligence — production daily output table.
--
-- One row per (scan_date, ticker) covering the v5 universe (US Common
-- Stock + ADR with mcap >= $300M and last close > $5, ~3,300 names).
-- Replaces v4.1's `signal_intel_daily` once Phase 4 swaps the UI; until
-- then both tables run in parallel and v4.1's table stays the live source.
--
-- Schema mirrors the dict returned by
-- scanner.signal_intelligence_v5.composite.compute_mt_score(...).
-- Sub-scores + weights + scorer components/diagnostics travel as JSONB
-- so the per-ticker dossier can render the full breakdown without a
-- second round-trip.
--
-- Index design:
--   * (scan_date DESC, mt_score DESC)   leaderboard / "today's top N by score"
--   * (scan_date DESC, band)            band-filtered counts and lists
--   * (ticker, scan_date DESC)          per-ticker history (dossier)

CREATE TABLE IF NOT EXISTS public.signal_intel_v5_daily (
    scan_date       DATE        NOT NULL,
    ticker          TEXT        NOT NULL,
    market_cap      NUMERIC,
    mt_score        NUMERIC,                                   -- -100..+100, NULL if all subs None
    band            TEXT        NOT NULL DEFAULT 'No Data',    -- Strong Sell / Watch Sell / Neutral / Watch Buy / Strong Buy / No Data
    sub_scores      JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- {insider:..., options:..., ...}
    weights_used    JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- per-signal weight after cap-discount
    cap_discount    NUMERIC,                                   -- insider-weight haircut in [0.25, 1.0]
    so_what         TEXT,                                      -- plain-English 1-2 sentence summary
    diagnostic      JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- scorer components + raw diagnostics
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scan_date, ticker)
);

COMMENT ON TABLE  public.signal_intel_v5_daily IS
    'v5 Signal Intelligence daily output. One row per (scan_date, ticker) for the v5 universe (mcap >= $300M, close > $5, CS+ADR). UI swaps to this table in Phase 4.';
COMMENT ON COLUMN public.signal_intel_v5_daily.mt_score IS
    'Composite MT Score, range -100 to +100. NULL when every sub-signal returned None.';
COMMENT ON COLUMN public.signal_intel_v5_daily.band IS
    '5-band bidirectional classifier: Strong Sell / Watch Sell / Neutral / Watch Buy / Strong Buy. "No Data" when mt_score is NULL.';
COMMENT ON COLUMN public.signal_intel_v5_daily.cap_discount IS
    'Insider-weight cap-discount factor. 1.00 at <=$500M, 0.50 at $50B, 0.25 at >=$500B (linear in log10).';
COMMENT ON COLUMN public.signal_intel_v5_daily.so_what IS
    'Plain-English 1-2 sentence summary derived deterministically from the most-extreme sub-scores.';

-- Leaderboard: today's top N by MT Score.
CREATE INDEX IF NOT EXISTS idx_signal_intel_v5_daily_date_score
    ON public.signal_intel_v5_daily (scan_date DESC, mt_score DESC);

-- Band-filtered counts/lists (e.g. "today's Strong Buys").
CREATE INDEX IF NOT EXISTS idx_signal_intel_v5_daily_date_band
    ON public.signal_intel_v5_daily (scan_date DESC, band);

-- Per-ticker history (dossier sparkline).
CREATE INDEX IF NOT EXISTS idx_signal_intel_v5_daily_ticker
    ON public.signal_intel_v5_daily (ticker, scan_date DESC);

-- RLS: read-only public, write via service role only (matches v4.1).
ALTER TABLE public.signal_intel_v5_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signal_intel_v5_daily_read_all" ON public.signal_intel_v5_daily;
CREATE POLICY "signal_intel_v5_daily_read_all"
    ON public.signal_intel_v5_daily
    FOR SELECT
    USING (true);

GRANT SELECT ON public.signal_intel_v5_daily TO anon, authenticated;
