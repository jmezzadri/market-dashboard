-- 060_paper_intraday_tables.sql
-- Paper Portfolio — LIVE INTRADAY snapshot (Joe directive 2026-06-23).
--
-- The Paper page is close-anchored: the official record (paper_positions +
-- paper_nav_daily) is written ONCE per day at the 16:50 ET close, valued at
-- official session closes and certified next morning against prices_eod. That
-- record is the BOOK OF RECORD for performance/history and is NOT touched here.
--
-- These two tables hold a transient LIVE view, refreshed hourly during market
-- hours from live Alpaca marks, so the page can show "as of 1:00 PM ET"
-- positions and P&L that match the broker intraday. They are deliberately
-- SEPARATE from the official tables so live marks can never contaminate the
-- daily NAV history (and the close run remains the day's final, authoritative
-- update).
--
-- Council: Lead Dev (schema) + Senior Quant (P&L fields) + Data Steward (feed).

BEGIN;

-- Live per-name holdings (single current set, overwritten each hourly run).
CREATE TABLE IF NOT EXISTS public.paper_intraday_positions (
  sleeve text NOT NULL CHECK (sleeve IN ('A', 'B')),
  ticker text NOT NULL,
  quantity numeric NOT NULL,
  avg_cost numeric NOT NULL,
  market_value numeric NOT NULL,
  unrealized_pnl numeric,
  unrealized_plpc numeric,
  unrealized_intraday_pl numeric,
  unrealized_intraday_plpc numeric,
  current_price numeric,
  lastday_price numeric,
  cost_basis numeric,
  entry_date date,
  current_score integer,
  as_of_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sleeve, ticker)
);

-- Live NAV / P&L (single current row, overwritten each hourly run). Column
-- names mirror paper_nav_daily where the page reads them, so the page can feed
-- this row through the same Performance-card math.
CREATE TABLE IF NOT EXISTS public.paper_intraday_nav (
  as_of_date date PRIMARY KEY,
  total_nav numeric NOT NULL,
  cash numeric,
  long_market_value numeric,
  sleeve_a_value numeric,
  sleeve_b_value numeric,
  sleeve_a_equity numeric,
  sleeve_b_equity numeric,
  day_pnl numeric,                 -- live NAV minus the prior OFFICIAL close NAV
  prior_close_nav numeric,
  spy_close numeric,               -- live SPY mark
  spy_prev_close numeric,          -- carried from the prior close NAV row
  spy_inception_close numeric,     -- carried from the prior close NAV row
  portfolio_beta numeric,          -- carried (close-anchored) so the card is stable
  n_positions integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: same single-tenant read model as every other paper_* table (anon AND
-- authenticated SELECT — see migration 059 for why both roles are required).
ALTER TABLE public.paper_intraday_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_intraday_nav ENABLE ROW LEVEL SECURITY;

CREATE POLICY paper_intraday_positions_read      ON public.paper_intraday_positions FOR SELECT TO anon          USING (true);
CREATE POLICY paper_intraday_positions_read_auth ON public.paper_intraday_positions FOR SELECT TO authenticated USING (true);
CREATE POLICY paper_intraday_nav_read            ON public.paper_intraday_nav       FOR SELECT TO anon          USING (true);
CREATE POLICY paper_intraday_nav_read_auth       ON public.paper_intraday_nav       FOR SELECT TO authenticated USING (true);

COMMIT;
