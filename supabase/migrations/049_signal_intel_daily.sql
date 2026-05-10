-- 049_signal_intel_daily.sql
-- Production daily output table for the v4.1 Signal Intelligence scanner.
--
-- The nightly scan writes one row per (ticker, scan_date) covering the
-- FULL US-listed Common Stock + ADR universe (~5,800 names). Every row
-- carries the score and full diagnostic, plus a `surfacing_zone` boolean
-- that flags whether the ticker's market cap is inside the validated
-- $300M-$3B band where the academic / backtest evidence supports the
-- Watch / High Conviction tags.
--
-- The Trading Opportunities React page reads from this table directly.
-- Tickers above $3B that fire signals are still scored and displayed,
-- but the UI tags them "Outside surfacing zone" and the Watch/HC bands
-- only apply inside the validated zone.
--
-- Index design: (scan_date DESC, score DESC) supports the leaderboard
-- query "give me today's top N by score" in milliseconds without a
-- table scan. The PRIMARY KEY (scan_date, ticker) supports per-ticker
-- history lookups (used by the dossier modal sparkline).

CREATE TABLE IF NOT EXISTS public.signal_intel_daily (
    scan_date                DATE        NOT NULL,
    ticker                   TEXT        NOT NULL,
    market_cap               NUMERIC,
    score                    INT         NOT NULL DEFAULT 0,
    band                     TEXT        NOT NULL,
    gate_pass                BOOLEAN     NOT NULL DEFAULT FALSE,
    hc_eligible              BOOLEAN     NOT NULL DEFAULT FALSE,
    surfacing_zone           BOOLEAN     NOT NULL DEFAULT FALSE,
    insider_dollar_30d       NUMERIC     NOT NULL DEFAULT 0,
    gate_diagnostic          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    pillar_diagnostic        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    short_interest_pct       NUMERIC,           -- placeholder, fills in sprint 2 (#1177)
    short_interest_as_of     DATE,              -- placeholder, fills in sprint 2 (#1177)
    ingested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scan_date, ticker)
);

COMMENT ON TABLE  public.signal_intel_daily IS
    'v4.1 Signal Intelligence daily output. One row per (scan_date, ticker) for the full US-listed CS+ADR universe. UI reads from here.';
COMMENT ON COLUMN public.signal_intel_daily.surfacing_zone IS
    'TRUE when 300M <= market_cap <= 3B. Outside that range the score is informational only (UI tags "Outside surfacing zone").';
COMMENT ON COLUMN public.signal_intel_daily.short_interest_pct IS
    'Short interest % of float. NULL until sprint 2 (#1177) wires the UW endpoint.';

-- Leaderboard / "today's top N" query support.
CREATE INDEX IF NOT EXISTS idx_signal_intel_daily_date_score
    ON public.signal_intel_daily (scan_date DESC, score DESC);

-- Surfacing-zone leaderboard (the React page's default sort within the validated band).
CREATE INDEX IF NOT EXISTS idx_signal_intel_daily_zone
    ON public.signal_intel_daily (scan_date DESC, surfacing_zone, score DESC);

-- Per-ticker history (dossier modal sparkline / score history).
CREATE INDEX IF NOT EXISTS idx_signal_intel_daily_ticker
    ON public.signal_intel_daily (ticker, scan_date DESC);

-- RLS: read-only public, write via service role only (matches the rest of
-- the scanner output tables — see migration 047_insider_history.sql).
ALTER TABLE public.signal_intel_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signal_intel_daily_read_all" ON public.signal_intel_daily;
CREATE POLICY "signal_intel_daily_read_all"
    ON public.signal_intel_daily
    FOR SELECT
    USING (true);

-- Service role bypasses RLS; no INSERT/UPDATE/DELETE policies for anon or
-- authenticated. The nightly scan runs with SUPABASE_SERVICE_ROLE_KEY.

GRANT SELECT ON public.signal_intel_daily TO anon, authenticated;
