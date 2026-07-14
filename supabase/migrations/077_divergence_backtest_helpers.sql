-- 077_divergence_backtest_helpers.sql
-- One-off RSI divergence BACKTEST helpers (full study approved 2026-07-13).
-- Read-only helpers for scripts/backtest_divergences.py, dispatched via
-- .github/workflows/DIVERGENCE-BACKTEST-ONEOFF.yml. No table writes, no
-- manifest element: the study emits a workflow artifact, not a feed.
--
-- Why migration 076's functions can't be reused as-is: they hardcode the
-- >=5000 panel-complete floor, which only holds after the broad-panel
-- cutover. prices_eod daily panel sizes, measured 2026-07-13:
--   through 2025-01:      ~585-612 tickers/day   -> floor 450
--   2025-02 .. 2026-04:   ~3,219-3,603           -> floor 2500
--   2026-05 onward:       ~12,100-12,440         -> floor 5000
-- A day is "panel-complete" under ITS OWN era's floor, so 45/70-day windows
-- that straddle an era cutover still fill; a single fixed floor would blank
-- them out. Junk weekend rows (bug #1230) sit far below every floor.

create or replace function public.divergence_bt_day_floor(d date)
returns int language sql immutable as $$
  select case when d >= '2026-05-01' then 5000
              when d >= '2025-02-01' then 2500
              else 450 end
$$;

-- Eligible trading-day calendar over a range (paged in SQL per LESSONS 4.18).
create or replace function public.divergence_bt_calendar(
  p_start date, p_end date, p_limit int default 1000, p_offset int default 0)
returns table(trade_date date, n_tickers int)
language sql stable as $$
  select trade_date, count(*)::int
  from public.prices_eod
  where trade_date between p_start and p_end
  group by trade_date
  having count(*) >= public.divergence_bt_day_floor(trade_date)
  order by trade_date
  limit p_limit offset p_offset
$$;

-- Liquid US common-stock universe for one HISTORICAL scan day. Filters are
-- IDENTICAL to production divergence_universe (076) — type CS + active,
-- close >= $2, 45-day ADV >= $50M and < $40B, >= 40 of 45 days present —
-- except the day window uses the era floor. universe_master flags are
-- TODAY'S applied backward (survivorship; documented in the study caveats).
create or replace function public.divergence_bt_universe(
  p_scan_date date, p_limit int default 1000, p_offset int default 0)
returns table(ticker text, adv_usd numeric, days_present int, last_close numeric)
language sql stable as $$
  with liq as (
    select trade_date from public.prices_eod
    where trade_date <= p_scan_date and trade_date > p_scan_date - 120
    group by trade_date
    having count(*) >= public.divergence_bt_day_floor(trade_date)
    order by trade_date desc limit 45
  )
  select p.ticker,
         avg(p.close * p.volume)    as adv_usd,
         count(*)::int              as days_present,
         max(p.close) filter (where p.trade_date = p_scan_date) as last_close
  from public.prices_eod p
  join liq on liq.trade_date = p.trade_date
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

-- Full-range OHLC arrays for a ticker batch over eligible days only.
-- One row per ticker; the caller batches <= 100 tickers per call, keeping
-- every response far under the REST row cap.
create or replace function public.divergence_bt_bars(
  p_start date, p_end date, p_tickers text[])
returns table(ticker text, dates date[], highs numeric[], lows numeric[], closes numeric[], vwaps numeric[])
language sql stable as $$
  with days as (
    select trade_date from public.prices_eod
    where trade_date between p_start and p_end
    group by trade_date
    having count(*) >= public.divergence_bt_day_floor(trade_date)
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

-- Study/backend use only (mirrors 076's grant pattern).
revoke execute on function public.divergence_bt_day_floor(date) from public, anon, authenticated;
revoke execute on function public.divergence_bt_calendar(date, date, int, int) from public, anon, authenticated;
revoke execute on function public.divergence_bt_universe(date, int, int) from public, anon, authenticated;
revoke execute on function public.divergence_bt_bars(date, date, text[]) from public, anon, authenticated;
grant execute on function public.divergence_bt_day_floor(date) to service_role;
grant execute on function public.divergence_bt_calendar(date, date, int, int) to service_role;
grant execute on function public.divergence_bt_universe(date, int, int) to service_role;
grant execute on function public.divergence_bt_bars(date, date, text[]) to service_role;
