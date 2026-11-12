-- =============================================================================
-- Watchlist page (Joe, 2026-11-11)
--
--   1. qt_factor_scores(as_of)      the style-factor figures for EVERY scored
--                                   stock. The mathematics is lifted unchanged
--                                   out of qt_factor_exposure_build, which now
--                                   calls it and keeps only the book's rows —
--                                   one computation, two readers (LESSONS 4.5).
--   2. stock_facts                  one row per ticker, rebuilt after each
--                                   close by stock_facts_build(). The page
--                                   reads rows; nothing is computed from a
--                                   year of prices on load (LESSONS 9.28).
--   3. watchlists / watchlist_items / watchlist_settings
--                                   the signed-in user's own lists, notes,
--                                   tags, saved views and table layout.
--
-- Data Steward sign-off on grants (LESSONS 7.10):
--   earnings_calendar    anon + authenticated SELECT; service_role ALL.
--   stock_facts          anon + authenticated SELECT (a public reference
--                        table of market facts); service_role ALL.
--   watchlists, _items,  authenticated SELECT/INSERT/UPDATE/DELETE, every
--   _settings            policy scoped to auth.uid(); nothing for anon.
-- =============================================================================

-- 1) Style factors for the whole scored universe ------------------------------
create or replace function public.qt_factor_scores(as_of date)
returns table (symbol text, factor text, raw double precision, z double precision,
               bench_z double precision, base_n integer, base_mean double precision,
               base_sd double precision)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  drop table if exists _fx_days, _fx_px, _fx_fund, _fx_raw, _fx_base, _fx_long, _fx_stats;

  create temp table _fx_days on commit drop as
    select trade_date, row_number() over (order by trade_date desc) rn
    from (select distinct trade_date from prices_eod
          where ticker = 'SPY' and trade_date <= as_of) t;

  create temp table _fx_px on commit drop as
    select p.ticker,
      max(close) filter (where trade_date = (select trade_date from _fx_days where rn = 1))   c0,
      max(close) filter (where trade_date = (select trade_date from _fx_days where rn = 22))  c22,
      max(close) filter (where trade_date = (select trade_date from _fx_days where rn = 253)) c253
    from prices_eod p
    where trade_date in ((select trade_date from _fx_days where rn = 1),
                         (select trade_date from _fx_days where rn = 22),
                         (select trade_date from _fx_days where rn = 253))
    group by p.ticker;

  create temp table _fx_fund on commit drop as
    with ranked as (
      select symbol, tag, period_end, val, fp,
             row_number() over (partition by symbol, tag order by period_end desc) rn
      from qt_fundamentals
      where filed <= as_of
        and (tag in ('CommonStockSharesOutstanding',
                     'WeightedAverageNumberOfDilutedSharesOutstanding')
             or fp = 'FY')
    )
    select symbol,
      coalesce(max(val) filter (where tag = 'CommonStockSharesOutstanding' and rn = 1),
               max(val) filter (where tag = 'WeightedAverageNumberOfDilutedSharesOutstanding' and rn = 1)) sh,
      coalesce(max(val) filter (where tag = 'Revenues' and rn = 1),
               max(val) filter (where tag = 'RevenueFromContractWithCustomerExcludingAssessedTax' and rn = 1)) rev
    from ranked group by symbol;

  create temp table _fx_raw on commit drop as
    select u.ticker symbol,
      px.c22 / nullif(px.c253, 0) - 1                       momentum,
      q.gp_a                                                quality,
      q.iss                                                 buybacks,
      ln(nullif(f.sh * px.c0, 0))                           size,
      ln(nullif(f.rev, 0) / nullif(f.sh * px.c0, 0))        value,
      f.sh * px.c0                                          mktcap
    from universe_master u
    join _fx_px px on px.ticker = u.ticker
    left join _fx_fund f on f.symbol = u.ticker
    left join qt_quality(as_of) q on q.symbol = u.ticker
    where u.type = 'CS' and px.c0 > 0 and px.c22 > 0 and px.c253 > 0;

  create temp table _fx_base on commit drop as
    select * from _fx_raw where mktcap > 0 order by mktcap desc limit 500;

  create temp table _fx_long on commit drop as
    select symbol, mktcap, 'momentum' factor, momentum raw from _fx_raw where momentum is not null
    union all select symbol, mktcap, 'quality',  quality  from _fx_raw where quality  is not null and quality  = quality
    union all select symbol, mktcap, 'buybacks', buybacks from _fx_raw where buybacks is not null and buybacks = buybacks
    union all select symbol, mktcap, 'size',     size     from _fx_raw where size     is not null
    union all select symbol, mktcap, 'value',    value    from _fx_raw where value    is not null;

  create temp table _fx_stats on commit drop as
    with b as (
      select l.* from _fx_long l join _fx_base bs on bs.symbol = l.symbol
    ), bounds as (
      select factor,
        percentile_cont(0.025) within group (order by raw) lo,
        percentile_cont(0.975) within group (order by raw) hi
      from b group by factor
    ), w as (
      select b.factor, b.symbol, b.mktcap,
        least(greatest(b.raw, bo.lo), bo.hi) raw_w
      from b join bounds bo on bo.factor = b.factor
    ), s as (
      select factor, count(*) n, avg(raw_w) mean, stddev_samp(raw_w) sd
      from w group by factor
    )
    select s.factor, s.n, s.mean, s.sd, bo.lo, bo.hi,
      (select sum(w.mktcap * ((w.raw_w - s.mean) / nullif(s.sd, 0))) / sum(w.mktcap)
         from w where w.factor = s.factor) bench_z
    from s join bounds bo on bo.factor = s.factor;

  return query
    select l.symbol::text, l.factor::text, l.raw::double precision,
      ((least(greatest(l.raw, st.lo), st.hi) - st.mean) / nullif(st.sd, 0))::double precision,
      st.bench_z::double precision, st.n::integer, st.mean::double precision,
      st.sd::double precision
    from _fx_long l
    join _fx_stats st on st.factor = l.factor;
end $function$;

revoke all on function public.qt_factor_scores(date) from public, anon, authenticated;
grant execute on function public.qt_factor_scores(date) to service_role;

-- 2) Whole-universe style figures, stored at each monthly scoring -------------
create table if not exists public.qt_factor_universe (
  rebalance_date date not null,
  symbol text not null,
  factor text not null,
  raw double precision,
  z double precision,
  created_at timestamptz not null default now(),
  primary key (symbol, factor)
);
grant select on public.qt_factor_universe to anon, authenticated;
grant all on public.qt_factor_universe to service_role;
alter table public.qt_factor_universe enable row level security;
drop policy if exists "anyone can read qt_factor_universe" on public.qt_factor_universe;
create policy "anyone can read qt_factor_universe" on public.qt_factor_universe
  for select to anon, authenticated using (true);

create or replace function public.qt_factor_exposure_build(as_of date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n_written integer;
begin
  drop table if exists _fx_scores;
  create temp table _fx_scores on commit drop as select * from qt_factor_scores(as_of);

  insert into qt_factor_exposure
    (rebalance_date, symbol, factor, raw, z, bench_z, base_n, base_mean, base_sd, created_at)
  select as_of, s.symbol, s.factor, s.raw, s.z, s.bench_z, s.base_n, s.base_mean, s.base_sd, now()
  from _fx_scores s
  where s.symbol in (select symbol from qt_target_book where rebalance_date = as_of)
  on conflict (rebalance_date, symbol, factor) do update
    set raw = excluded.raw, z = excluded.z, bench_z = excluded.bench_z,
        base_n = excluded.base_n, base_mean = excluded.base_mean,
        base_sd = excluded.base_sd, created_at = excluded.created_at;
  get diagnostics n_written = row_count;

  -- The same scores for every scored stock, latest month only (Watchlist page).
  if n_written > 0 then
    delete from qt_factor_universe where true;
    insert into qt_factor_universe (rebalance_date, symbol, factor, raw, z)
    select as_of, s.symbol, s.factor, s.raw, s.z from _fx_scores s;
  end if;
  return n_written;
end $function$;

-- November 2026 was scored before this table existed. The 2026-11-02 book was
-- built before that day's close, i.e. on prices through 2026-10-30; scoring
-- "as of 2026-11-01" reproduces the stored book rows to 1e-8 (checked
-- 2026-11-11), so the universe rows are seeded on the same inputs.
insert into public.qt_factor_universe (rebalance_date, symbol, factor, raw, z)
select date '2026-11-02', s.symbol, s.factor, s.raw, s.z
from public.qt_factor_scores(date '2026-11-01') s
where not exists (select 1 from public.qt_factor_universe)
on conflict do nothing;

-- 2b) Next earnings date per ticker (EARNINGS-CALENDAR-DAILY, Alpha Vantage's
--     free earnings calendar; one row per ticker = its earliest upcoming date).
create table if not exists public.earnings_calendar (
  ticker text primary key,
  report_date date not null,
  report_time text,
  fiscal_period_end date,
  eps_estimate numeric,
  source text not null default 'alphavantage',
  fetched_at timestamptz not null default now()
);
grant select on public.earnings_calendar to anon, authenticated;
grant all on public.earnings_calendar to service_role;
alter table public.earnings_calendar enable row level security;
drop policy if exists "anyone can read earnings_calendar" on public.earnings_calendar;
create policy "anyone can read earnings_calendar" on public.earnings_calendar
  for select to anon, authenticated using (true);

-- 3) One row of stored facts per ticker ---------------------------------------
create table if not exists public.stock_facts (
  ticker text primary key,
  name text,
  security_type text,
  industry text,
  market_cap numeric,
  price_date date not null,
  close numeric,
  chg_1d numeric,
  ret_1w numeric, ret_1m numeric, ret_3m numeric, ret_ytd numeric, ret_1y numeric,
  high_52w numeric, low_52w numeric,
  pct_from_high numeric, pct_from_low numeric,
  pct_vs_ma50 numeric, pct_vs_ma200 numeric,
  volume numeric, vol_vs_avg numeric, avg_dollar_vol numeric,
  next_ex_div date, div_yield numeric,
  si_pct_float numeric, days_to_cover numeric, si_date date,
  insider_buy_90d numeric, insider_buyers_90d integer,
  factor_date date,
  trend_1y numeric, profitability numeric, buybacks numeric,
  z_momentum double precision, z_quality double precision, z_buybacks double precision,
  z_size double precision, z_value double precision,
  built_at timestamptz not null default now(),
  next_earnings date,
  earnings_time text
);
grant select on public.stock_facts to anon, authenticated;
grant all on public.stock_facts to service_role;
alter table public.stock_facts enable row level security;
drop policy if exists "anyone can read stock_facts" on public.stock_facts;
create policy "anyone can read stock_facts" on public.stock_facts
  for select to anon, authenticated using (true);

create or replace function public.stock_facts_build()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d0 date; d1 date; d5 date; d21 date; d50 date; d63 date; d64 date; d200 date; d252 date; dprev date; dy date;
  today date := (now() at time zone 'America/New_York')::date;
  n integer;
begin
  -- The session calendar is the S&P 500 fund's own trading days. Row 1 is the
  -- latest close; a window of N sessions back is row N+1.
  -- The newest date that at least 5,000 tickers have a price for. Not simply
  -- the S&P 500 fund's newest date: on the evening of a trading day a few
  -- hundred same-day tickers carry that date before the full close file loads,
  -- and anchoring on it kept only those (505 rows on 2026-11-11; LESSONS 4.50).
  select max(trade_date) into d0
    from (select trade_date from prices_eod where trade_date > current_date - 15
          group by trade_date having count(*) >= 5000) full_days;
  select max(trade_date) filter (where rn = 2),   max(trade_date) filter (where rn = 6),
         max(trade_date) filter (where rn = 22),  max(trade_date) filter (where rn = 50),
         max(trade_date) filter (where rn = 63),  max(trade_date) filter (where rn = 64),
         max(trade_date) filter (where rn = 200), max(trade_date) filter (where rn = 252),
         max(trade_date) filter (where rn = 253)
    into d1, d5, d21, d50, d63, d64, d200, d252, dprev
  from (select trade_date, row_number() over (order by trade_date desc) rn
        from prices_eod where ticker = 'SPY' and trade_date > d0 - 420 and trade_date <= d0) t;
  select max(trade_date) into dy from prices_eod
   where ticker = 'SPY' and trade_date < date_trunc('year', d0)::date and trade_date > d0 - 420;
  if d0 is null or dprev is null then
    raise exception 'stock_facts_build: fewer than 253 sessions of SPY prices on file';
  end if;

  drop table if exists _sf_px, _sf_div, _sf_si, _sf_ins, _sf_fx;
  create temp table _sf_px on commit drop as
    select ticker,
      max(close)  filter (where trade_date = d0)    c0,
      max(volume) filter (where trade_date = d0)    v0,
      max(close)  filter (where trade_date = d1)    c1,
      max(close)  filter (where trade_date = d5)    c5,
      max(close)  filter (where trade_date = d21)   c21,
      max(close)  filter (where trade_date = d64)   c63,
      max(close)  filter (where trade_date = dprev) c252,
      max(close)  filter (where trade_date = dy)    cy,
      max(coalesce(high, close)) filter (where trade_date >= d252) hi,
      min(nullif(coalesce(low, close), 0)) filter (where trade_date >= d252) lo,
      count(close) filter (where trade_date >= d252) n252,
      avg(close) filter (where trade_date >= d50)  ma50,  count(close) filter (where trade_date >= d50)  n50,
      avg(close) filter (where trade_date >= d200) ma200, count(close) filter (where trade_date >= d200) n200,
      avg(volume) filter (where trade_date >= d63) av63,
      avg(close * volume) filter (where trade_date >= d63) adv63,
      count(volume) filter (where trade_date >= d63) n63
    from prices_eod
    where trade_date >= dprev and trade_date <= d0
    group by ticker
    having max(close) filter (where trade_date = d0) > 0;

  -- Dividend yield: the ticker page's rule (latest regular cash dividend x its
  -- declared frequency, else the trailing-year sum; nothing if the last one
  -- is over 400 days old).
  create temp table _sf_div on commit drop as
    with reg as (
      select ticker, ex_dividend_date, cash_amount, frequency,
             row_number() over (partition by ticker order by ex_dividend_date desc) rn
      from dividends
      where cash_amount is not null and (dividend_type is null or dividend_type = 'CD')
        and ex_dividend_date > today - 800
    ), t12 as (
      select ticker, sum(cash_amount) s from reg where ex_dividend_date >= today - 366 group by ticker
    ), nx as (
      select ticker, min(ex_dividend_date) next_ex from dividends
      where ex_dividend_date >= today group by ticker
    )
    select coalesce(r.ticker, nx.ticker) ticker, nx.next_ex,
      case when r.ticker is null or r.ex_dividend_date < today - 400 then null
           when r.frequency > 0 then r.cash_amount * r.frequency
           else nullif(t.s, 0) end annual
    from (select * from reg where rn = 1) r
    full join nx on nx.ticker = r.ticker
    left join t12 t on t.ticker = r.ticker;

  create temp table _sf_si on commit drop as
    select distinct on (ticker) ticker, as_of_date, short_interest_float_pct, days_to_cover
    from short_interest where as_of_date > today - 60
    order by ticker, as_of_date desc;

  create temp table _sf_ins on commit drop as
    select ticker, sum(amount::numeric * stock_price) dollars,
           count(distinct owner_name_lower)::int buyers
    from insider_history_edgar
    where transaction_code = 'P' and transaction_date >= today - 90 and transaction_date <= today
      and amount > 0 and stock_price > 0
    group by ticker;

  create temp table _sf_fx on commit drop as
    select symbol, max(rebalance_date) rebalance_date,
      max(raw) filter (where factor = 'momentum') mom, max(raw) filter (where factor = 'quality') qual,
      max(raw) filter (where factor = 'buybacks') bb,
      max(z) filter (where factor = 'momentum') zm, max(z) filter (where factor = 'quality') zq,
      max(z) filter (where factor = 'buybacks') zb, max(z) filter (where factor = 'size') zs,
      max(z) filter (where factor = 'value') zv
    from qt_factor_universe group by symbol;

  delete from stock_facts where true;
  insert into stock_facts
  select p.ticker, coalesce(u.name, r.name), u.type, r.sic_description, r.market_cap,
    d0, p.c0,
    p.c0 / nullif(p.c1, 0) - 1,
    p.c0 / nullif(p.c5, 0) - 1, p.c0 / nullif(p.c21, 0) - 1, p.c0 / nullif(p.c63, 0) - 1,
    p.c0 / nullif(p.cy, 0) - 1, p.c0 / nullif(p.c252, 0) - 1,
    case when p.n252 >= 200 then p.hi end, case when p.n252 >= 200 then p.lo end,
    case when p.n252 >= 200 then p.c0 / nullif(p.hi, 0) - 1 end,
    case when p.n252 >= 200 then p.c0 / nullif(p.lo, 0) - 1 end,
    case when p.n50 >= 45 then p.c0 / nullif(p.ma50, 0) - 1 end,
    case when p.n200 >= 180 then p.c0 / nullif(p.ma200, 0) - 1 end,
    p.v0, case when p.n63 >= 40 then p.v0 / nullif(p.av63, 0) end,
    case when p.n63 >= 40 then p.adv63 end,
    dv.next_ex, dv.annual / p.c0,
    si.short_interest_float_pct, si.days_to_cover, si.as_of_date,
    ins.dollars, ins.buyers,
    fx.rebalance_date,
    -- A stock held in the paper book shows the book's own stored figures, so
    -- the two pages can never disagree about the same stock (LESSONS 4.5).
    coalesce(tb.mom12, fx.mom), coalesce(tb.gp_a, fx.qual), coalesce(tb.iss, fx.bb),
    fx.zm, fx.zq, fx.zb, fx.zs, fx.zv, now(),
    ec.report_date, ec.report_time
  from _sf_px p
  left join universe_master u on u.ticker = p.ticker
  left join ticker_reference r on r.ticker = p.ticker
  left join _sf_div dv on dv.ticker = p.ticker
  left join _sf_si si on si.ticker = p.ticker
  left join _sf_ins ins on ins.ticker = p.ticker
  left join _sf_fx fx on fx.symbol = p.ticker
  left join earnings_calendar ec on ec.ticker = p.ticker and ec.report_date >= today
  left join qt_target_book tb on tb.symbol = p.ticker
       and tb.rebalance_date = (select max(rebalance_date) from qt_target_book);
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.stock_facts_build() from public, anon, authenticated;
grant execute on function public.stock_facts_build() to service_role;

-- 4) The signed-in user's lists ----------------------------------------------
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ix_watchlists_user on public.watchlists(user_id, position);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null check (char_length(ticker) between 1 and 12),
  position integer not null default 0,
  added_at timestamptz not null default now(),
  added_price numeric,
  added_price_date date,
  note text check (note is null or char_length(note) <= 500),
  tag text check (tag is null or char_length(tag) <= 40),
  unique (watchlist_id, ticker)
);
create index if not exists ix_watchlist_items_user on public.watchlist_items(user_id);

create table if not exists public.watchlist_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.watchlists to authenticated;
grant select, insert, update, delete on public.watchlist_items to authenticated;
grant select, insert, update, delete on public.watchlist_settings to authenticated;
grant all on public.watchlists to service_role;
grant all on public.watchlist_items to service_role;
grant all on public.watchlist_settings to service_role;
revoke all on public.watchlists from anon;
revoke all on public.watchlist_items from anon;
revoke all on public.watchlist_settings from anon;

alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.watchlist_settings enable row level security;

drop policy if exists "own watchlists" on public.watchlists;
create policy "own watchlists" on public.watchlists for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own watchlist items" on public.watchlist_items;
create policy "own watchlist items" on public.watchlist_items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.watchlists w
                          where w.id = watchlist_id and w.user_id = (select auth.uid())));
drop policy if exists "own watchlist settings" on public.watchlist_settings;
create policy "own watchlist settings" on public.watchlist_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 5) Health row for the nightly build (stamped by MASSIVE-DAILY) --------------
insert into public.pipeline_health (indicator_id, label, source, cadence, expected_cadence_minutes, status)
values ('stock-facts', 'Watchlist · Stock facts',
        'MacroTilt engine (MASSIVE-DAILY → stock_facts_build)', 'D', 1440, 'amber')
on conflict (indicator_id) do nothing;

insert into public.pipeline_health (indicator_id, label, source, cadence, expected_cadence_minutes, status)
values ('earnings-calendar', 'Watchlist · Next earnings dates',
        'Alpha Vantage earnings calendar (EARNINGS-CALENDAR-DAILY)', 'D', 1440, 'amber')
on conflict (indicator_id) do nothing;

-- First build, so the page has rows the moment it is published.
select public.stock_facts_build();
update public.pipeline_health
   set status = 'green', last_good_at = now(), last_check_at = now(),
       data_as_of = (select max(built_at) from public.stock_facts), last_error = null
 where indicator_id = 'stock-facts' and exists (select 1 from public.stock_facts);
