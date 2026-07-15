-- 082_power_trend_scan_complete_panel.sql
-- Fix two defects found on the first production run of power_trend_scan():
--   1. PANEL DATE: "max(trade_date)" picked up a PARTIAL same-day panel (the
--      evening ingest / Yahoo same-day fallback had written ~500 of ~12,400
--      names for 2026-07-15), which emptied the universe (strategy_bt_universe
--      needs a complete panel). The scan now anchors to the last COMPLETE
--      panel day: the newest trade_date whose row count clears
--      strategy_bt_day_floor(date) — the same complete-panel doctrine the
--      divergence and momentum producers used.
--   2. STATEMENT TIMEOUT over REST: the ranking window scanned the whole
--      prices_eod table (~5.1M rows) and blew the PostgREST statement timeout
--      (57014). The window is now pre-filtered to the trailing 130 calendar
--      days (only 70 sessions are used), which brings the scan to a few
--      seconds. The math is unchanged — validated against the 2026-07-14
--      panel: identical 14-name list, identical roc/rs/volx values.
-- Also adds power_trend_panel_date() so the producer resolves the SAME
-- complete-panel date the scan uses (no second source of truth).

create or replace function public.power_trend_panel_date()
returns date
language sql stable as $$
  select max(trade_date)
  from (select trade_date, count(*) n from public.prices_eod
        where trade_date > current_date - 21 group by 1) x
  where x.n >= public.strategy_bt_day_floor(x.trade_date)
$$;

revoke execute on function public.power_trend_panel_date() from public, anon, authenticated;
grant execute on function public.power_trend_panel_date() to service_role;

create or replace function public.power_trend_scan()
returns table(ticker text, close numeric, roc_3m numeric, rs_vs_spx numeric,
              breakout_volx numeric, adv_usd numeric, panel_date date)
language sql stable as $$
with d0 as (select public.power_trend_panel_date() d),
uni as (select u.ticker from strategy_bt_universe((select d from d0), 6000, 0) u),
spy as (select (select close from prices_eod where ticker='SPY' and trade_date <= (select d from d0) order by trade_date desc limit 1)
       /(select close from prices_eod where ticker='SPY' and trade_date <= (select d from d0) order by trade_date desc offset 63 limit 1)-1 sroc),
ranked as (select p.ticker,p.trade_date,p.close,p.volume,row_number() over (partition by p.ticker order by p.trade_date desc) rrev
           from prices_eod p join uni using(ticker)
           where p.trade_date <= (select d from d0)
             and p.trade_date >  (select d from d0) - 130),
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
