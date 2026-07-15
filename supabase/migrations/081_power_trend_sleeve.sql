-- 081_power_trend_sleeve.sql
-- Power Trend sleeve (replaces the Momentum sleeve's 12-1 momentum list and
-- retires the Faber crash guard). The paper engine's sleeve M now reads the
-- latest rebalance_date of public.power_trend_list; a CASH-only publish
-- (single sentinel row ticker='CASH', rank=0) means all-cash — no separate
-- guard table. momentum_list / momentum_guard are retired with their
-- producers (LESSON 0.10); their tables are left in place as history.
-- Producer: POWER-TREND-LIST-MONTHLY.yml -> scripts/compute_power_trend_list.py
-- Data Steward: manifest element equity-power_trend_list-monthly registered in
-- BOTH manifests (root + public) and pipeline_schedule.yml in this same PR.

-- 1) paper_intraday_positions: widen sleeve check to accept 'M' -------------
-- (the 080 engine PR widened paper_orders / paper_fills / paper_positions;
-- the intraday view table was missed — same widening, same default name.)
alter table public.paper_intraday_positions drop constraint if exists paper_intraday_positions_sleeve_check;
alter table public.paper_intraday_positions add constraint paper_intraday_positions_sleeve_check
  check (sleeve in ('A', 'B', 'M'));

-- 2) paper_nav_daily: per-sleeve columns for sleeve M -----------------------
-- Mirrors the existing sleeve A/B column set (cash/equity/nav numeric;
-- value/pnl double precision; positions integer). Additive only.
alter table public.paper_nav_daily add column if not exists sleeve_m_cash            numeric;
alter table public.paper_nav_daily add column if not exists sleeve_m_equity          numeric;
alter table public.paper_nav_daily add column if not exists sleeve_m_nav             numeric;
alter table public.paper_nav_daily add column if not exists sleeve_m_value           double precision;
alter table public.paper_nav_daily add column if not exists sleeve_m_unrealized_pnl  double precision;
alter table public.paper_nav_daily add column if not exists sleeve_m_realized_pnl    double precision;
alter table public.paper_nav_daily add column if not exists sleeve_m_positions       integer;
alter table public.paper_nav_daily add column if not exists sleeve_m_day_pnl         double precision;

-- 2b) paper_intraday_nav: live per-sleeve M columns (mirrors sleeve_a/b_value
-- + sleeve_a/b_equity written by the hourly intraday NAV writer). Additive.
alter table public.paper_intraday_nav add column if not exists sleeve_m_value  numeric;
alter table public.paper_intraday_nav add column if not exists sleeve_m_equity numeric;
alter table public.paper_intraday_nav add column if not exists sleeve_b_cash   numeric;
alter table public.paper_intraday_nav add column if not exists sleeve_m_cash   numeric;

-- 3) Monthly Power Trend list ------------------------------------------------
-- Append-only across rebalance_dates; delete+rewrite within a rebalance_date
-- (the momentum_list / divergence_scan pattern; every fire idempotent).
-- Zero-signal months publish a single sentinel row (ticker='CASH', rank=0);
-- the engine reads a CASH-only list as all-cash.
create table if not exists public.power_trend_list (
  rebalance_date      date        not null,  -- scan panel date (max prices_eod trade_date at publish)
  rank                integer     not null,  -- 1..N by roc_3m desc (0 = CASH sentinel)
  ticker              text        not null,
  name                text,
  roc_3m              numeric     not null,  -- 63-trading-day rate of change, percent points
  rs_vs_spx           numeric     not null,  -- roc_3m minus SPY's, percent points (gate: >= 5)
  breakout_volx       numeric,               -- breakout-day volume vs 20-day avg (gate: > 1.3x)
  adv_usd             numeric,               -- ~20-day avg dollar volume, DOLLARS (close * vol20)
  close               numeric,               -- close on the panel date
  next_rebalance_date date,                  -- 1st of the following month
  created_at          timestamptz not null default now(),
  primary key (rebalance_date, ticker)
);

create index if not exists idx_power_trend_list_date_rank
  on public.power_trend_list (rebalance_date desc, rank);

grant select on public.power_trend_list to anon, authenticated;
grant all    on public.power_trend_list to service_role;

alter table public.power_trend_list enable row level security;
drop policy if exists power_trend_list_read on public.power_trend_list;
create policy power_trend_list_read on public.power_trend_list
  for select using (true);
-- writes: service_role only (bypasses RLS); no insert/update policies.

-- 4) Power Trend scan (producer-only) -----------------------------------------
-- Validated logic — do not alter the math without a new backtest (Policy A).
--   * Universe: liquid US common stock via strategy_bt_universe (migration
--     078: CS + active, close >= $2, 45-day ADV $50M–$40B) on the latest
--     prices_eod day.
--   * 3-mo ROC = 63 trading days; keep the top 20% cross-sectionally.
--   * RS gate: ROC must beat SPY's 63-day ROC by >= 5 percentage points.
--   * Breakout: new 10-day closing high on > 1.3x the 20-day avg volume.
--   * Trend: close above the 10/21/50/200 EMAs. EMAs are computed as a
--     TRUNCATED WEIGHTED SUM over <= 720 rows (>= 250 rows required) —
--     deliberate: the recursive per-row EMA times out at this panel width.
--   * adv_usd output is in DOLLARS (close * 20-day avg volume), not $M.
create or replace function public.power_trend_scan()
returns table(ticker text, close numeric, roc_3m numeric, rs_vs_spx numeric,
              breakout_volx numeric, adv_usd numeric, panel_date date)
language sql stable as $$
with d0 as (select max(trade_date) d from prices_eod),
uni as (select u.ticker from strategy_bt_universe((select d from d0), 6000, 0) u),
spy as (select (select close from prices_eod where ticker='SPY' order by trade_date desc limit 1)
       /(select close from prices_eod where ticker='SPY' order by trade_date desc offset 63 limit 1)-1 sroc),
ranked as (select p.ticker,p.trade_date,p.close,p.volume,row_number() over (partition by p.ticker order by p.trade_date desc) rrev
           from prices_eod p join uni using(ticker)),
recent as (select * from ranked where rrev<=70),
agg as (select ticker,
        max(close) filter(where rrev=1) close,
        max(volume) filter(where rrev=1) vol0,
        max(close) filter(where rrev=64) close_63,
        avg(volume) filter(where rrev<=20) vol20,
        max(close) filter(where rrev<=10) hc10,
        max(trade_date) filter(where rrev=1) d0
        from recent group by ticker),
roc as (select a.*, close/nullif(close_63,0)-1 r from agg a where close_63 is not null),
thr as (select percentile_cont(0.8) within group(order by r) t from roc where r is not null),
cand as (select r.* from roc r
         where r.d0=(select d from d0)
           and r.r>=(select t from thr)
           and r.close>=r.hc10
           and r.vol0>1.3*r.vol20
           and (r.r-(select sroc from spy))>=0.05)
select c.ticker, round(c.close,2), round((c.r*100)::numeric,1), round(((c.r-(select sroc from spy))*100)::numeric,1),
       round((c.vol0/nullif(c.vol20,0))::numeric,2), round((c.close*c.vol20)::numeric), c.d0
from cand c
cross join lateral (
  select (2.0/11)*sum(close*power(9.0/11,k)) e10,
         (2.0/22)*sum(close*power(20.0/22,k)) e21,
         (2.0/51)*sum(close*power(49.0/51,k)) e50,
         (2.0/201)*sum(close*power(199.0/201,k)) e200,
         count(*) n
  from (select close, row_number() over(order by trade_date desc)-1 k
        from prices_eod where ticker=c.ticker and trade_date<=c.d0
        order by trade_date desc limit 720) dd
) e
where e.n>=250 and c.close>e.e10 and c.close>e.e21 and c.close>e.e50 and c.close>e.e200
order by 3 desc
$$;

revoke execute on function public.power_trend_scan() from public, anon, authenticated;
grant execute on function public.power_trend_scan() to service_role;

-- 5) pipeline_health seed row (red-honest; the checker only updates EXISTING
--    rows; the first verified publish stamps green — stamp-after-publish rule).
insert into public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status, last_error)
values
  ('power_trend_list', 'Power Trend sleeve list', 'power_trend_list', 'M', 44640, 'red', 'awaiting first producer run')
on conflict (indicator_id) do nothing;
