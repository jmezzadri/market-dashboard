-- Migration 009: universe_snapshots
-- ================================================================
-- Purpose: 3x-daily snapshot of the full US equity universe (>= $1B
--   market cap, Common Stock + ADR + ETF) from UW /api/screener/stocks.
--
-- Cadence: 10:00 / 13:00 / 15:45 America/New_York, weekdays.
-- Retention: 30 days (nightly prune via pg_cron, see bottom of file).
-- Expected row count: ~2,845 tickers * 3 runs * ~22 trading days / mo
--   = ~188k rows in warm set, ~215k with prune slack. Trivial.
--
-- Primary key (ticker, snapshot_ts) — one row per ticker per run.
-- ================================================================

create table if not exists public.universe_snapshots (
  -- identity & timing
  ticker                   text           not null,
  snapshot_ts              timestamptz    not null,
  as_of_date               date,
  full_name                text,
  sector                   text,
  issue_type               text,
  is_index                 boolean,

  -- price / volume (stock)
  marketcap                numeric,
  close                    numeric,
  prev_close               numeric,
  perc_change              numeric,
  high                     numeric,
  low                      numeric,
  stock_volume             bigint,
  avg30_volume             numeric,
  relative_volume          numeric,
  week_52_high             numeric,
  week_52_low              numeric,

  -- IV / volatility term structure
  iv30d                    numeric,
  iv30d_1d                 numeric,
  iv30d_1w                 numeric,
  iv30d_1m                 numeric,
  iv_rank                  numeric,
  volatility               numeric,
  volatility_7             numeric,
  volatility_30            numeric,
  realized_volatility      numeric,
  variance_risk_premium    numeric,
  rv_1d_last_12q           numeric,

  -- implied moves (next expiry + 7d/30d tenors)
  implied_move             numeric,
  implied_move_perc        numeric,
  implied_move_7           numeric,
  implied_move_perc_7      numeric,
  implied_move_30          numeric,
  implied_move_perc_30     numeric,

  -- options volume
  call_volume              bigint,
  put_volume               bigint,
  put_call_ratio           numeric,
  call_volume_ask_side     bigint,
  call_volume_bid_side     bigint,
  put_volume_ask_side      bigint,
  put_volume_bid_side      bigint,
  avg_3_day_call_volume    numeric,
  avg_3_day_put_volume     numeric,
  avg_7_day_call_volume    numeric,
  avg_7_day_put_volume     numeric,
  avg_30_day_call_volume   numeric,
  avg_30_day_put_volume    numeric,

  -- options premium (dollar flow)
  call_premium             numeric,
  put_premium              numeric,
  net_call_premium         numeric,
  net_put_premium          numeric,
  bullish_premium          numeric,
  bearish_premium          numeric,

  -- options open interest
  call_open_interest       bigint,
  put_open_interest        bigint,
  total_open_interest      bigint,
  avg_30_day_call_oi       numeric,
  avg_30_day_put_oi        numeric,

  -- day-over-day OI / volume (for delta calcs, no self-compute needed)
  prev_call_oi             bigint,
  prev_put_oi              bigint,
  prev_call_volume         bigint,
  prev_put_volume          bigint,

  -- cumulative directional Greeks
  cum_dir_delta            numeric,
  cum_dir_gamma            numeric,
  cum_dir_vega             numeric,

  -- gamma exposure
  gex_net_change           numeric,
  gex_perc_change          numeric,
  gex_ratio                numeric,

  -- calendar events
  next_earnings_date       date,
  er_time                  text,
  next_dividend_date       date,

  -- safety net: any new UW fields we haven't typed yet land here so
  -- we never silently drop data. ETFs haven't been sampled yet — any
  -- ETF-specific fields will show up here until we promote them.
  raw_extras               jsonb,

  -- bookkeeping
  fetched_at               timestamptz    not null default now(),

  constraint universe_snapshots_pkey primary key (ticker, snapshot_ts)
);

-- Indexes
create index if not exists universe_snapshots_snapshot_ts_idx
  on public.universe_snapshots (snapshot_ts desc);

create index if not exists universe_snapshots_ticker_ts_idx
  on public.universe_snapshots (ticker, snapshot_ts desc);

create index if not exists universe_snapshots_sector_ts_idx
  on public.universe_snapshots (sector, snapshot_ts desc);

create index if not exists universe_snapshots_issue_type_ts_idx
  on public.universe_snapshots (issue_type, snapshot_ts desc);

-- Row-level security: public read for authenticated users, writes
-- restricted to service_role (the scanner). No per-user scoping —
-- universe-wide data, not user-owned.
alter table public.universe_snapshots enable row level security;

drop policy if exists universe_snapshots_read on public.universe_snapshots;
create policy universe_snapshots_read
  on public.universe_snapshots
  for select
  to authenticated
  using (true);

-- service_role bypasses RLS automatically; no insert policy needed.

-- 30-day retention prune. Runs nightly at 02:15 UTC (off-peak, after
-- any late 3:45pm ET backfill). pg_cron job naming matches the
-- pattern used by existing MacroTilt cron entries.
select
  cron.schedule(
    'universe_snapshots_prune_30d',
    '15 2 * * *',
    $$ delete from public.universe_snapshots
       where snapshot_ts < now() - interval '30 days'; $$
  );

comment on table public.universe_snapshots is
  '3x-daily snapshot of US equity universe (>= $1B mcap, Common+ADR+ETF) from UW /api/screener/stocks. 30-day retention. See migration 009.';
