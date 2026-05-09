-- Migration 047: insider_history table for v4.1 first-buy classifier.
-- Applied to production Supabase 2026-05-09 via Management API.
-- Source of truth — keep this file in sync with the live schema.
--
-- Purpose:
--   Persist UW /insider/transactions events with full field set so the
--   v4.1 Gate 1.1 (first-buy) classifier can run as a fast indexed query
--   instead of pulling fresh from UW per scoring call.
--
-- Owner: Data Steward
-- Consumed by:
--   scanner.signal_intelligence_v4.insider_ingest  (writes + reads)
--   scanner.signal_intelligence_v4.gates           (reads via query_first_buy)

CREATE TABLE IF NOT EXISTS public.insider_history (
    id                   UUID PRIMARY KEY,
    ticker               TEXT NOT NULL,
    transaction_date     DATE NOT NULL,
    filing_date          DATE,
    transaction_code     TEXT NOT NULL,
    amount               BIGINT,
    stock_price          NUMERIC,
    owner_name           TEXT,
    owner_name_lower     TEXT GENERATED ALWAYS AS (lower(trim(owner_name))) STORED,
    is_officer           BOOLEAN DEFAULT FALSE,
    is_director          BOOLEAN DEFAULT FALSE,
    is_ten_percent_owner BOOLEAN DEFAULT FALSE,
    is_10b5_1            BOOLEAN DEFAULT FALSE,
    officer_title        TEXT,
    formtype             TEXT,
    marketcap            BIGINT,
    sector               TEXT,
    raw                  JSONB,
    ingested_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insider_history_ticker_date
    ON public.insider_history (ticker, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_insider_history_owner_p_lookup
    ON public.insider_history (ticker, owner_name_lower, transaction_date DESC)
    WHERE transaction_code = 'P';

CREATE INDEX IF NOT EXISTS idx_insider_history_ticker_p_date
    ON public.insider_history (ticker, transaction_date DESC)
    WHERE transaction_code = 'P';
