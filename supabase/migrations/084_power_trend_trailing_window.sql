-- 084_power_trend_trailing_window.sql
-- Fix the fire-window defect found in the 2026-07-23 quant review, and add
-- the industry data the producer needs for the new max-3-per-industry cap.
--
--   DEFECT: power_trend_scan() only surfaced names whose breakout occurred
--   ON the exact panel day (a one-day snapshot). The validated backtest
--   behaved like a trailing-window rule (~fully invested monthly). A faithful
--   month-by-month rebuild of the one-day rule vs the validation workbook
--   showed correlation -0.05 over 75 months — the deployed rule was
--   effectively unvalidated, and it loses to SPY over 2020-2026.
--
--   FIX (re-validated 2020-01 -> 2026-07-22, zero-cost, monthly cadence):
--   a name qualifies when its breakout (new 10-day closing high on volume
--   > 1.3x its 20-day average) occurred on ANY of the trailing 21 sessions,
--   AND the trend (close above 10/21/50/200 EMAs), momentum (3-mo ROC in the
--   top 20% cross-sectionally) and relative-strength (>= 5 pts over SPY)
--   gates all hold AS OF the panel date. Result: 25.3%/yr uncapped,
--   27.0%/yr with the max-3-per-industry cap, Sharpe 1.08, MaxDD -24.1%
--   vs SPY 13.6%/yr. Evidence: Momentum_Sleeve_Review_2026-07-23.xlsx.
--
--   RVOL note: 1.5x and 2.0x volume thresholds were tested at Joe's request
--   and reduce returns monotonically; 1.3x stays (same workbook).
--
-- Adds sic2 (2-digit SIC industry group from ticker_reference; NULL when
-- unmapped) so the producer can apply the industry cap without a second
-- fetch. breakout_volx = the strongest qualifying fire-day's volume multiple
-- within the window (display).

drop function if exists public.power_trend_scan();

create or replace function public.power_trend_scan()
returns table(ticker text, close numeric, roc_3m numeric, rs_vs_spx numeric,
              breakout_volx numeric, adv_usd numeric, panel_date date, sic2 text)
language sql stable as $$
with d0 as (select public.power_trend_panel_date() d),
uni as (select u.ticker from strategy_bt_universe((select d from d0), 6000, 0) u),
spy as (select (select close from prices_eod where ticker='SPY' and trade_date <= (select d from d0) order by trade_date desc limit 1)
       /(select close from prices_eod where ticker='SPY' and trade_date <= (select d from d0) order by trade_date desc offset 63 limit 1)-1 sroc),
ranked as (select p.ticker,p.trade_date,p.close,p.volume,row_number() over (partition by p.ticker order by p.trade_date desc) rrev
           from prices_eod p join uni using(ticker)
           where p.trade_date <= (select d from d0)
             and p.trade_date >  (select d from d0) - 160),
recent as (select * from ranked where rrev<=95),
win as (select r.*,
        max(r.close) over (partition by r.ticker order by r.rrev rows between current row and 9 following) hi10f,
        avg(r.volume) over (partition by r.ticker order by r.rrev rows between current row and 19 following) vol20f
        from recent r),
brk as (select w.ticker,
        bool_or(w.rrev<=21 and w.close>=w.hi10f and w.volume>1.3*w.vol20f) fired,
        max(w.volume/nullif(w.vol20f,0)) filter (where w.rrev<=21 and w.close>=w.hi10f and w.volume>1.3*w.vol20f) volx
        from win w group by w.ticker),
agg as (select r.ticker,
        max(r.close) filter(where rrev=1) close,
        max(r.close) filter(where rrev=64) close_63,
        avg(r.volume) filter(where rrev<=20) vol20,
        max(r.trade_date) filter(where rrev=1) d0
        from recent r group by r.ticker),
roc as (select a.*, a.close/nullif(a.close_63,0)-1 r from agg a where a.close_63 is not null),
thr as (select percentile_cont(0.8) within group(order by r.r) t from roc r where r.r is not null),
cand as (select r.*, b.volx from roc r join brk b using(ticker)
         where r.d0=(select d from d0)
           and b.fired
           and r.r>=(select t from thr)
           and (r.r-(select sroc from spy))>=0.05)
select c.ticker, round(c.close,2), round((c.r*100)::numeric,1),
       round(((c.r-(select sroc from spy))*100)::numeric,1),
       round(c.volx::numeric,2),
       round((c.close*c.vol20)::numeric), c.d0,
       substring(tr.sic_code from 1 for 2)
from cand c
left join ticker_reference tr on tr.ticker=c.ticker
cross join lateral (
  select (2.0/11)*sum(dd.close*power(9.0/11,dd.k)) e10,
         (2.0/22)*sum(dd.close*power(20.0/22,dd.k)) e21,
         (2.0/51)*sum(dd.close*power(49.0/51,dd.k)) e50,
         (2.0/201)*sum(dd.close*power(199.0/201,dd.k)) e200,
         count(*) n
  from (select p2.close, row_number() over(order by p2.trade_date desc)-1 k
        from prices_eod p2 where p2.ticker=c.ticker and p2.trade_date<=c.d0
        order by p2.trade_date desc limit 720) dd
) e
where e.n>=250 and c.close>e.e10 and c.close>e.e21 and c.close>e.e50 and c.close>e.e200
order by 3 desc
$$;

revoke execute on function public.power_trend_scan() from public, anon, authenticated;
grant execute on function public.power_trend_scan() to service_role;
