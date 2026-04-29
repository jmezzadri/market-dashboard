-- ============================================================================
-- Migration 032 — Massive (Polygon) integration: universe, reference, EOD,
--                 dividends, splits.  Phase 1 of the data revamp.
-- ============================================================================
-- Why
-- ---
-- Today the dashboard's "universe master" is the UW screener (~1,500
-- tickers) and daily prices come from a per-ticker yfinance loop.  Two
-- structural problems:
--   1. UW caps coverage at ~1,500 — anything outside that lights up
--      ticker-only on stock modals (no company name, no description).
--   2. yfinance is unofficial and rate-limits at scale.
--
-- This migration adds five additive tables that Massive (Polygon) will
-- write to:
--   - universe_master       — canonical list of every US-listed ticker
--   - ticker_reference      — rich metadata per ticker (description,
--                              logo, list date, market cap, SIC, etc.)
--   - prices_eod            — daily OHLCV + VWAP (Massive Daily Market
--                              Summary endpoint, 1 call/day for ALL
--                              US stocks)
--   - dividends             — corporate actions, ex/pay/record/declared
--                              dates + cash amount + frequency
--   - splits                — corporate actions, execution date +
--                              from/to ratio
--
-- Plus four pipeline_health rows so the existing FreshnessDot machinery
-- picks up the new ingest jobs site-wide.
--
-- ALL ADDITIVE.  No drops, no renames.  Safe to roll forward; rollback
-- is a follow-up migration that DROPs these tables.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- universe_master  — canonical list of every US-listed ticker
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.universe_master (
  ticker              text        PRIMARY KEY,
  name                text,
  market              text        DEFAULT 'stocks',  -- stocks/otc/indices/fx/crypto
  locale              text        DEFAULT 'us',
  primary_exchange    text,                          -- XNAS, XNYS, ARCX, …
  type                text,                          -- CS, ETF, ADR, FUND, …
  active              boolean     DEFAULT true,
  currency_name       text        DEFAULT 'usd',
  cik                 text,
  composite_figi      text,
  share_class_figi    text,
  last_updated_utc    timestamptz,
  ingested_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_universe_master_active
  ON public.universe_master (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_universe_master_type
  ON public.universe_master (type);

COMMENT ON TABLE public.universe_master IS
  'Canonical ticker list, sourced daily from Massive Reference Tickers. '
  'This replaces the UW screener as the universe master.';

-- ─────────────────────────────────────────────────────────────────────────
-- ticker_reference  — rich metadata per ticker (the "company overview" data)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticker_reference (
  ticker                          text        PRIMARY KEY
                                              REFERENCES public.universe_master(ticker)
                                              ON DELETE CASCADE,
  name                            text,
  description                     text,
  homepage_url                    text,
  logo_url                        text,
  icon_url                        text,
  branding_accent_color           text,
  list_date                       date,
  market_cap                      numeric,
  share_class_shares_outstanding  bigint,
  weighted_shares_outstanding     bigint,
  total_employees                 integer,
  sic_code                        text,
  sic_description                 text,
  ticker_root                     text,
  phone_number                    text,
  address_city                    text,
  address_state                   text,
  address_country                 text,
  refresh_priority                integer     DEFAULT 100,  -- lower = higher priority
  ingested_at                     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticker_reference_priority
  ON public.ticker_reference (refresh_priority, ingested_at);
CREATE INDEX IF NOT EXISTS idx_ticker_reference_sic
  ON public.ticker_reference (sic_code);

COMMENT ON TABLE public.ticker_reference IS
  'Per-ticker reference + branding + corporate metadata, sourced from '
  'Massive Ticker Details.  This is what fixes the missing company name '
  'and description on stock modals.';

-- ─────────────────────────────────────────────────────────────────────────
-- prices_eod  — daily OHLCV + VWAP, 1 call/day for ALL US stocks
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prices_eod (
  ticker          text        NOT NULL,
  trade_date      date        NOT NULL,
  open            numeric,
  high            numeric,
  low             numeric,
  close           numeric,
  volume          bigint,
  vwap            numeric,
  transactions    integer,
  source          text        DEFAULT 'massive',   -- 'massive' | 'yfinance' (legacy)
  ingested_at     timestamptz DEFAULT now(),
  PRIMARY KEY (ticker, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_prices_eod_date
  ON public.prices_eod (trade_date DESC);

COMMENT ON TABLE public.prices_eod IS
  'Daily OHLCV.  Sourced from Massive Daily Market Summary (1 API call '
  'returns every US stock for a given trading date).  source column '
  'distinguishes Massive going forward from existing yfinance backfill.';

-- ─────────────────────────────────────────────────────────────────────────
-- dividends + splits — corporate actions
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dividends (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker              text        NOT NULL,
  ex_dividend_date    date        NOT NULL,
  pay_date            date,
  record_date         date,
  declaration_date    date,
  cash_amount         numeric,
  currency            text        DEFAULT 'USD',
  frequency           integer,                 -- 0=one-time, 1=ann, 2=semi, 4=qtr, 12=mo
  dividend_type       text,                    -- CD/SC/ST/LT
  ingested_at         timestamptz DEFAULT now(),
  UNIQUE (ticker, ex_dividend_date, dividend_type)
);

CREATE INDEX IF NOT EXISTS idx_dividends_ticker_ex
  ON public.dividends (ticker, ex_dividend_date DESC);
CREATE INDEX IF NOT EXISTS idx_dividends_ex
  ON public.dividends (ex_dividend_date DESC);

CREATE TABLE IF NOT EXISTS public.splits (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker            text        NOT NULL,
  execution_date    date        NOT NULL,
  split_from        numeric     NOT NULL,
  split_to          numeric     NOT NULL,
  ingested_at       timestamptz DEFAULT now(),
  UNIQUE (ticker, execution_date)
);

CREATE INDEX IF NOT EXISTS idx_splits_ticker_exec
  ON public.splits (ticker, execution_date DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- pipeline_health rows — wires the four new ingest jobs into FreshnessDot
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES
  ('massive-universe',          'Massive · Universe Master',
   'massive', 'D', 60*24,        'red'),
  ('massive-eod',               'Massive · Daily EOD Prices',
   'massive', 'D', 60*24,        'red'),
  ('massive-ticker-details',    'Massive · Ticker Reference (rolling)',
   'massive', 'D', 60*24*7,      'red'),
  ('massive-corporate-actions', 'Massive · Corporate Actions',
   'massive', 'D', 60*24,        'red')
ON CONFLICT (indicator_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — read-public, write via service_role only
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.universe_master   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticker_reference  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prices_eod        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividends         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.splits            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "universe_master_read"   ON public.universe_master   FOR SELECT USING (true);
CREATE POLICY "ticker_reference_read"  ON public.ticker_reference  FOR SELECT USING (true);
CREATE POLICY "prices_eod_read"        ON public.prices_eod        FOR SELECT USING (true);
CREATE POLICY "dividends_read"         ON public.dividends         FOR SELECT USING (true);
CREATE POLICY "splits_read"            ON public.splits            FOR SELECT USING (true);
