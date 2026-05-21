-- Migration 056 — trading_opps_signals
-- Data Steward · consulted Lead Developer.
--
-- The nightly results table for the rebuilt Trading Opportunities screener
-- (Phase 2 dual-direction engine). One row per (scan_date, ticker). Rows are
-- DATED DAILY SNAPSHOTS — appended every night, NEVER overwritten — so the
-- page can show "Score 1W / Score 1M" by reading the same ticker on an
-- earlier scan_date, and so a bad night can never erase good history.
--
-- Producer: trading-scanner/scanner/trading_opps/run_screener.py
-- Pipeline name: screener-trading-opps-daily
-- Consumer surfaces: Trading Opportunities page results table + hero tile.
--
-- GRANTs are explicit per the 2026-05-13 LESSONS rule (public-schema tables
-- are no longer auto-exposed to the Data API). The page reads this table
-- from the browser as the anonymous role; the producer writes as service.

create table if not exists public.trading_opps_signals (
  scan_date            date        not null,
  ticker               text        not null,
  direction            text        not null default 'long',

  -- ── core ──────────────────────────────────────────────────────────────
  last_trade_ts        timestamptz,
  signal               text,                 -- 'BUY · LONG' / 'SELL · SHORT' / 'WATCHLIST'
  score                numeric,              -- integrated screener score (launches at 3, max 5)
  score_1w             numeric,              -- this ticker's score 1 week ago (null = not listed then)
  score_1m             numeric,              -- this ticker's score 1 month ago
  win_rate             numeric,              -- empirical hit-rate of this setup, from the backtest

  -- ── scoring inputs (the 5 shaded score-driving columns) ───────────────
  insider_rules        jsonb,                -- array of fired rule tags, e.g. ["A","B"]
  insider_age_days     integer,              -- age of the freshest qualifying buy
  insider_pts          numeric,              -- decayed insider-layer points
  dark_pool_anchor     numeric,              -- institutional anchor price (null until live)
  dark_pool_status     text default 'shadow',
  options_vol_shock    numeric,              -- options volume-shock points (null until live)
  options_shock_status text default 'shadow',
  sma200_pct           numeric,              -- price distance above/below the 200-day line, %
  sma200_pts           numeric,              -- trend-layer points from the 200-day line
  rsi                  numeric,              -- 14-day Wilder RSI
  rsi_pts              numeric,              -- trend-layer points from RSI

  -- ── stock context ─────────────────────────────────────────────────────
  price                numeric,
  change_pct           numeric,
  change_usd           numeric,
  volume               numeric,              -- session share volume
  rel_volume           numeric,              -- volume vs the 90-day norm
  week_52_low          numeric,
  week_52_high         numeric,
  market_cap           numeric,
  spark                jsonb,                -- recent closes for the sparkline

  -- ── options (informational) ───────────────────────────────────────────
  pc_ratio             numeric,
  net_premium          numeric,
  iv                   numeric,
  iv_rank              numeric,
  implied_7d_pct       numeric,
  implied_7d_usd       numeric,
  implied_30d_pct      numeric,
  implied_30d_usd      numeric,

  -- ── statistics ────────────────────────────────────────────────────────
  realized_vol         numeric,
  mean_return          numeric,
  std_dev              numeric,
  daily_sigma_pct      numeric,

  -- ── technicals (informational) ────────────────────────────────────────
  ema9                 numeric,
  ema21                numeric,
  sma50                numeric,

  -- ── info ──────────────────────────────────────────────────────────────
  company_name         text,
  sector               text,
  earnings_date        date,

  -- ── trade levels (carried for the Phase 4 modal rebuild) ──────────────
  entry                numeric,
  stop                 numeric,
  target               numeric,
  so_what              text,

  -- ── scan-level funnel counts (denormalized — same on every row of a
  --    scan_date — so the hero "Today's Scan Results" tile reads them
  --    without a second query) ──────────────────────────────────────────
  universe_scanned     integer,
  gate_cleared         integer,

  scan_run_ts          timestamptz not null default now(),

  primary key (scan_date, ticker)
);

create index if not exists trading_opps_signals_scan_date_idx
  on public.trading_opps_signals (scan_date desc);
create index if not exists trading_opps_signals_score_idx
  on public.trading_opps_signals (scan_date desc, score desc);

comment on table public.trading_opps_signals is
  'Nightly Trading Opportunities screener results — dated daily snapshots, append-only. Producer: screener-trading-opps-daily.';

-- ── grants (explicit, per LESSONS 2026-05-13) ────────────────────────────
grant select                         on public.trading_opps_signals to anon;
grant select                         on public.trading_opps_signals to authenticated;
grant all                            on public.trading_opps_signals to service_role;

alter table public.trading_opps_signals enable row level security;

drop policy if exists "trading_opps_signals public read"
  on public.trading_opps_signals;
create policy "trading_opps_signals public read"
  on public.trading_opps_signals for select
  to anon, authenticated
  using (true);
