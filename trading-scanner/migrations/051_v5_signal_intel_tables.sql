-- Migration: v5 Signal Intelligence — per-signal data caches + short interest.
-- Owner: Data Steward
-- Consumed by: scanner.signal_intelligence_v5.{options,congress,analyst,short_interest}_score
-- Producer: nightly ingest workflows (OPTIONS_FLOW_INGEST_DAILY, CONGRESS_INGEST_DAILY,
--           ANALYST_INGEST_DAILY, SHORT_INTEREST_INGEST_DAILY)

-- 1. options_flow_daily — per-ticker options flow snapshot (last 30 days)
CREATE TABLE IF NOT EXISTS public.options_flow_daily (
    ticker             TEXT NOT NULL,
    as_of_date         DATE NOT NULL,
    call_premium       NUMERIC,
    put_premium        NUMERIC,
    call_count         INTEGER,
    put_count          INTEGER,
    ask_side_premium   NUMERIC,
    bid_side_premium   NUMERIC,
    sweep_count        INTEGER,
    unusual_count      INTEGER,
    iv_skew_25d        NUMERIC,
    raw                JSONB,
    ingested_at        TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticker, as_of_date)
);
CREATE INDEX IF NOT EXISTS idx_options_flow_daily_ticker_date
    ON public.options_flow_daily (ticker, as_of_date DESC);

-- 2. congress_trades_daily — per-ticker congress disclosures (rolling)
CREATE TABLE IF NOT EXISTS public.congress_trades_daily (
    ticker            TEXT NOT NULL,
    transaction_date  DATE NOT NULL,
    disclosure_id     TEXT NOT NULL,
    member_name       TEXT,
    chamber           TEXT,
    transaction_type  TEXT,
    amount_bucket     TEXT,
    amount_min        NUMERIC,
    amount_max        NUMERIC,
    filing_date       DATE,
    raw               JSONB,
    ingested_at       TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticker, disclosure_id)
);
CREATE INDEX IF NOT EXISTS idx_congress_trades_daily_ticker_date
    ON public.congress_trades_daily (ticker, transaction_date DESC);

-- 3. analyst_ratings_daily — per-ticker analyst actions (rolling)
CREATE TABLE IF NOT EXISTS public.analyst_ratings_daily (
    ticker            TEXT NOT NULL,
    action_date       DATE NOT NULL,
    rating_id         TEXT NOT NULL,
    firm              TEXT,
    analyst_name      TEXT,
    action            TEXT,
    recommendation    TEXT,
    target_price      NUMERIC,
    prev_target       NUMERIC,
    broker_tier       TEXT,
    raw               JSONB,
    ingested_at       TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticker, rating_id)
);
CREATE INDEX IF NOT EXISTS idx_analyst_ratings_daily_ticker_date
    ON public.analyst_ratings_daily (ticker, action_date DESC);

-- 4a. short_interest — bi-monthly FINRA settlement
CREATE TABLE IF NOT EXISTS public.short_interest (
    ticker                    TEXT NOT NULL,
    as_of_date                DATE NOT NULL,
    source                    TEXT NOT NULL,
    short_interest_shares     BIGINT,
    short_interest_float_pct  NUMERIC(8,4),
    days_to_cover             NUMERIC(8,4),
    float_shares              BIGINT,
    shares_outstanding        BIGINT,
    avg_daily_volume          BIGINT,
    squeeze_score             NUMERIC(5,2),
    raw                       JSONB,
    ingested_at               TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticker, as_of_date, source)
);
CREATE INDEX IF NOT EXISTS idx_short_interest_ticker_date
    ON public.short_interest (ticker, as_of_date DESC);

-- 4b. short_interest_daily — UW continuous metrics
CREATE TABLE IF NOT EXISTS public.short_interest_daily (
    ticker                    TEXT NOT NULL,
    as_of_date                DATE NOT NULL,
    source                    TEXT NOT NULL,
    short_volume              BIGINT,
    total_volume              BIGINT,
    short_volume_ratio        NUMERIC(8,6),
    borrow_shares_available   BIGINT,
    cost_to_borrow_pct        NUMERIC(8,4),
    rebate_rate_pct           NUMERIC(8,4),
    ftd_quantity              BIGINT,
    ftd_price                 NUMERIC(12,4),
    raw                       JSONB,
    ingested_at               TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ticker, as_of_date, source)
);
CREATE INDEX IF NOT EXISTS idx_short_interest_daily_ticker_date
    ON public.short_interest_daily (ticker, as_of_date DESC);
