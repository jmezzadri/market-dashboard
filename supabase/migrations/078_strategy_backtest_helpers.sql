-- 078_strategy_backtest_helpers.sql
-- One-off S&P-beating strategy study helpers (approved via popup 2026-07-13).
-- Read-only; used by scripts/backtest_strategies.py (STRATEGY-BACKTEST-ONEOFF).
-- Extends the divergence-study era floors one tier deeper: the daily panel is
-- ~403 names in 2003 rising to ~542 by 2019, so pre-2010 days need a 350 floor.
-- Applied to the database 2026-07-13 via the Supabase migration API; this file
-- is the repo record.

create or replace function public.strategy_bt_day_floor(d date)
returns int language sql immutable as $$
  select case when d >= '2026-05-01' then 5000
              when d >= '2025-02-01' then 2500
              when d >= '2010-01-01' then 450
              else 350 end
$$;

create or replace function public.strategy_bt_calendar(
  p_start date, p_end date, p_limit int default 1000, p_offset int default 0)
returns table(trade_date date, n_tickers int)
language sql stable as $$
  select trade_date, count(*)::int
  from public.prices_eod
  where trade_date between p_start and p_end
  group by trade_date
  having count(*) >= public.strategy_bt_day_floor(trade_date)
  order by trade_date
  limit p_limit offset p_offset
$$;

-- Same liquidity screen as the divergence universe (CS + active, >= $2,
-- 45-day ADV >= $50M and < $40B, >= 40/45 days present), deep-era floors.
create or replace function public.strategy_bt_universe(
  p_scan_date date, p_limit int default 1000, p_offset int default 0)
returns table(ticker text, adv_usd numeric, days_present int, last_close numeric)
language sql stable as $$
  with liq as (
    select trade_date from public.prices_eod
    where trade_date <= p_scan_date and trade_date > p_scan_date - 120
    group by trade_date
    having count(*) >= public.strategy_bt_day_floor(trade_date)
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

create or replace function public.strategy_bt_bars(
  p_start date, p_end date, p_tickers text[])
returns table(ticker text, dates date[], closes numeric[])
language sql stable as $$
  with days as (
    select trade_date from public.prices_eod
    where trade_date between p_start and p_end
    group by trade_date
    having count(*) >= public.strategy_bt_day_floor(trade_date)
  )
  select p.ticker,
         array_agg(p.trade_date order by p.trade_date),
         array_agg(p.close      order by p.trade_date)
  from public.prices_eod p
  join days d on d.trade_date = p.trade_date
  where p.ticker = any(p_tickers) and p.close is not null
  group by p.ticker
$$;

-- Open-market insider BUY events, aggregated per ticker/filing-day/buyer.
-- filing_date is the information-available date (no lookahead).
create or replace function public.strategy_bt_insider_buys(
  p_limit int default 1000, p_offset int default 0)
returns table(ticker text, filing_date date, buyer text, buy_usd numeric)
language sql stable as $$
  select ticker, filing_date, owner_name_lower,
         sum(amount * stock_price) as buy_usd
  from public.insider_history
  where transaction_code = 'P'
    and (is_officer or is_director)
    and not coalesce(is_10b5_1, false)
    and amount is not null and stock_price is not null and filing_date is not null
  group by 1, 2, 3
  order by 1, 2, 3
  limit p_limit offset p_offset
$$;

revoke execute on function public.strategy_bt_day_floor(date) from public, anon, authenticated;
revoke execute on function public.strategy_bt_calendar(date, date, int, int) from public, anon, authenticated;
revoke execute on function public.strategy_bt_universe(date, int, int) from public, anon, authenticated;
revoke execute on function public.strategy_bt_bars(date, date, text[]) from public, anon, authenticated;
revoke execute on function public.strategy_bt_insider_buys(int, int) from public, anon, authenticated;
grant execute on function public.strategy_bt_day_floor(date) to service_role;
grant execute on function public.strategy_bt_calendar(date, date, int, int) to service_role;
grant execute on function public.strategy_bt_universe(date, int, int) to service_role;
grant execute on function public.strategy_bt_bars(date, date, text[]) to service_role;
grant execute on function public.strategy_bt_insider_buys(int, int) to service_role;
