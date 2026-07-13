-- 076_divergence_scan.sql
-- RSI Divergence scanner (scanner page, "RSI Divergences" section).
-- Adds: results table + three server-side helper functions used by the
-- nightly producer (DIVERGENCE_SCAN_DAILY.yml -> scripts/compute_divergences.py)
-- + pipeline_health seed row for the freshness chip.
-- Data Steward sign-off: manifest element equity-rsi_divergences-daily,
-- registered in data_manifest.json + pipeline_schedule.yml in the same PR.

-- 1) Results table -----------------------------------------------------------
-- Append-only across scan_dates (like trading_opps_signals); idempotent
-- within a scan_date (producer deletes+rewrites the day's rows on re-run).
create table if not exists public.divergence_scan (
  scan_date   date        not null,
  ticker      text        not null,
  name        text,
  direction   text        not null check (direction in ('bull','bear')),
  px1         numeric     not null,  -- price at older pivot
  rsi1        numeric     not null,  -- RSI(14, simple-average) at older pivot
  px2         numeric     not null,  -- price at newer pivot
  rsi2        numeric     not null,  -- RSI at newer pivot
  cur_close   numeric,
  cur_rsi     numeric,
  bars_ago    integer     not null,  -- trading bars since the newer pivot
  sep_bars    integer     not null,  -- bars between the two pivots
  adv_usd     numeric,               -- avg daily dollar volume, 45-day window
  rsi_gap     numeric,               -- |rsi2 - rsi1|
  strong      boolean     not null default false, -- older pivot at an RSI extreme (<=30 bull / >=70 bear)
  created_at  timestamptz not null default now(),
  primary key (scan_date, ticker, direction)
);

create index if not exists idx_divergence_scan_date_dir
  on public.divergence_scan (scan_date desc, direction);

-- 2) GRANTS (template pattern A: front-end reads directly) --------------------
grant select on public.divergence_scan to anon, authenticated;
grant all    on public.divergence_scan to service_role;

-- 3) RLS ----------------------------------------------------------------------
alter table public.divergence_scan enable row level security;
drop policy if exists divergence_scan_read on public.divergence_scan;
create policy divergence_scan_read on public.divergence_scan
  for select using (true);
-- writes: service_role only (bypasses RLS); no insert/update policies.

-- 4) Producer helper functions ------------------------------------------------
-- (a) Latest trading day whose EOD panel is complete enough to scan.
create or replace function public.divergence_latest_complete_day(p_min_rows int default 5000)
returns date
language sql stable as $$
  select trade_date
  from public.prices_eod
  where trade_date > current_date - 15
  group by trade_date
  having count(*) >= p_min_rows
  order by trade_date desc
  limit 1
$$;

-- (b) Liquid US common-stock universe for one scan day.
--     type = CS only (ETFs/ETNs/funds/ADRs excluded), price >= $2,
--     45-trading-day avg dollar volume >= $50M, >= 40 of the 45 days present,
--     traded on the scan day itself. ADV cap $40B guards vendor bad-price
--     rows (real single names do not print $40B/day averages).
create or replace function public.divergence_universe(p_scan_date date, p_limit int default 1000, p_offset int default 0)
returns table(ticker text, name text, adv_usd numeric, days_present int, last_close numeric)
language sql stable as $$
  -- day window = panel-complete trading days only (>=5000 tickers), bounded
  -- by calendar date so the group-by never walks the full 2003+ history.
  with liq as (
    select trade_date from public.prices_eod
    where trade_date <= p_scan_date and trade_date > p_scan_date - 120
    group by trade_date
    having count(*) >= 5000
    order by trade_date desc limit 45
  )
  select p.ticker,
         max(u.name)                as name,
         avg(p.close * p.volume)    as adv_usd,
         count(*)::int              as days_present,
         max(p.close) filter (where p.trade_date = p_scan_date) as last_close
  from public.prices_eod p
  join liq              on liq.trade_date = p.trade_date
  join public.universe_master u on u.ticker = p.ticker
  where u.type = 'CS' and u.active
    and p.close is not null and p.volume is not null
  group by p.ticker
  having count(*) >= 40
     and avg(p.close * p.volume) >= 50e6
     and avg(p.close * p.volume) <  40e9
     and max(p.close) filter (where p.trade_date = p_scan_date) >= 2
  order by p.ticker
  limit p_limit offset p_offset
$$;

-- (c) Per-ticker OHLC bar arrays (ascending by date) for a ticker batch.
--     p_days trading days ending at p_scan_date. Arrays are aligned; rows
--     with a null close/high/low are excluded before aggregation.
create or replace function public.divergence_bars(p_scan_date date, p_tickers text[], p_days int default 70)
returns table(ticker text, dates date[], highs numeric[], lows numeric[], closes numeric[], vwaps numeric[])
language sql stable as $$
  with days as (
    select trade_date from public.prices_eod
    where trade_date <= p_scan_date
      and trade_date > p_scan_date - (p_days * 2 + 30)
    group by trade_date
    having count(*) >= 5000
    order by trade_date desc limit p_days
  )
  select p.ticker,
         array_agg(p.trade_date order by p.trade_date),
         array_agg(p.high       order by p.trade_date),
         array_agg(p.low        order by p.trade_date),
         array_agg(p.close      order by p.trade_date),
         array_agg(p.vwap       order by p.trade_date)
  from public.prices_eod p
  join days d on d.trade_date = p.trade_date
  where p.ticker = any(p_tickers)
    and p.close is not null and p.high is not null and p.low is not null
  group by p.ticker
$$;

-- Helper functions are for the backend producer only.
revoke execute on function public.divergence_latest_complete_day(int) from public, anon, authenticated;
revoke execute on function public.divergence_universe(date, int, int) from public, anon, authenticated;
revoke execute on function public.divergence_bars(date, text[], int) from public, anon, authenticated;
grant  execute on function public.divergence_latest_complete_day(int) to service_role;
grant  execute on function public.divergence_universe(date, int, int) to service_role;
grant  execute on function public.divergence_bars(date, text[], int) to service_role;

-- 5) pipeline_health seed row (freshness chip; checker only updates EXISTING
--    rows). Seeded red-honest: no successful run exists yet; the first
--    producer run stamps it green after publish (stamp-after-publish rule).
insert into public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status, last_error)
values
  ('rsi_divergences', 'RSI divergence scan', 'divergence_scan', 'D', 1440, 'red', 'awaiting first producer run')
on conflict (indicator_id) do nothing;
