-- 048_v4_harness_data_layer.sql
-- Phase 1 of the v4.1 walk-forward backtest harness: data layer.
--
-- Creates two materialized tables that the harness loop will read from
-- millions of times during a 12-month walk-forward over ~3,000 tickers x
-- 52 weekly Mondays. Both tables are pre-computed for speed; views were
-- considered and rejected because the joins are heavy and the harness
-- would re-execute them on every (ticker, scan_date) lookup.
--
-- IMPORTANT - Approximations & known limitations:
--
--   1. historical_marketcap is computed as
--          close_on_date * latest_share_class_shares_outstanding
--      using the SINGLE most-recent share-count snapshot from
--      ticker_reference. This ignores buybacks / issuances over the
--      12-month backtest window. For a single ticker the within-window
--      drift is typically <2-5% (ex-mega-buyback names like AAPL/META
--      can be ~5-8% over a year). This is documented in
--      V4_HARNESS_DATA_LAYER_NOTES.md alongside the impact on
--      $300M-$25B universe band membership at the edges.
--
--   2. forward_returns_21d uses 21 TRADING days (~1 calendar month), which
--      matches the v4.1 holding period. Rows where the 21-day forward
--      window has not yet completed (i.e. as_of_date is within the last
--      ~30 calendar days) are intentionally absent - the harness must
--      filter them out.
--
--   3. Both tables are filtered to tickers in
--      universe_master.type IN ('CS','ADRC') (Polygon issue codes for
--      "Common Stock" and "ADR Common"). Other types (PFD, ETF, WARRANT,
--      RIGHT, FUND, UNIT, SP, ETS, ETV, ETN) are excluded - they are not
--      eligible for the v4.1 score per the spec.

-- -----------------------------------------------------------------------------
-- historical_marketcap
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.historical_marketcap (
    ticker      TEXT    NOT NULL,
    as_of_date  DATE    NOT NULL,
    close       NUMERIC NOT NULL,
    shares      NUMERIC NOT NULL,
    market_cap  NUMERIC NOT NULL,
    source      TEXT    NOT NULL DEFAULT 'close_x_latest_shares',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, as_of_date)
);

COMMENT ON TABLE public.historical_marketcap IS
    'Approximate point-in-time market cap = close x latest_shares_outstanding. Used as the v4.1 backtest harness Gate 1 magnitude input. Approximation impact documented in V4_HARNESS_DATA_LAYER_NOTES.md.';

CREATE INDEX IF NOT EXISTS historical_marketcap_ticker_date_desc_idx
    ON public.historical_marketcap (ticker, as_of_date DESC);

CREATE INDEX IF NOT EXISTS historical_marketcap_date_idx
    ON public.historical_marketcap (as_of_date);

-- -----------------------------------------------------------------------------
-- forward_returns_21d
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.forward_returns_21d (
    ticker          TEXT    NOT NULL,
    as_of_date      DATE    NOT NULL,
    today_close     NUMERIC NOT NULL,
    fwd_close_date  DATE    NOT NULL,
    fwd_close_price NUMERIC NOT NULL,
    fwd_return_21d  NUMERIC NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, as_of_date)
);

COMMENT ON TABLE public.forward_returns_21d IS
    '21-trading-day forward total return (close-to-close) per (ticker, as_of_date). Used as the harness scoring outcome metric. Rows are absent when the forward window has not yet completed.';

CREATE INDEX IF NOT EXISTS forward_returns_21d_ticker_date_desc_idx
    ON public.forward_returns_21d (ticker, as_of_date DESC);

CREATE INDEX IF NOT EXISTS forward_returns_21d_date_idx
    ON public.forward_returns_21d (as_of_date);
