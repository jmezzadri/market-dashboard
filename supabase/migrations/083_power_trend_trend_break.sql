-- 083_power_trend_trend_break.sql
-- Daily trend-break stop for held Power Trend names (Joe decision 2026-07-15
-- late; Senior Quant backtest in MacroTilt/Power_Trend_Cadence_Study_2026-07-15.xlsx,
-- "Daily-stop variants" sheet): monthly entries unchanged; SELL any day a held
-- name closes below ALL FOUR EMAs (10/21/50/200) — the symmetric inverse of the
-- entry's trend test — with proceeds resting in cash until the next monthly
-- publish. Zero-cost backtest 2020–2026: 30.4% CAGR / Sharpe 1.14 / MaxDD −30.0%
-- vs no-stop 37.0% / 1.24 / −39.9% — trades ~6.6 CAGR points for ~10 points of
-- drawdown relief; ~23 stop-outs/yr. Tighter stops (21/50-day) tested worse on
-- every measure and were rejected.
-- Same truncated weighted-sum EMA math and complete-panel anchor as the scan.
create or replace function public.power_trend_trend_break(p_tickers text[])
returns table(ticker text)
language sql stable security definer as $$
with d0 as (select public.power_trend_panel_date() d),
px as (
  select p.ticker, p.close
  from prices_eod p, d0
  where p.ticker = any(p_tickers) and p.trade_date = d0.d
)
select px.ticker
from px, d0
cross join lateral (
  select (2.0/11)*sum(close*power(9.0/11,k)) e10,
         (2.0/22)*sum(close*power(20.0/22,k)) e21,
         (2.0/51)*sum(close*power(49.0/51,k)) e50,
         (2.0/201)*sum(close*power(199.0/201,k)) e200
  from (select close, row_number() over (order by trade_date desc)-1 k
        from prices_eod where prices_eod.ticker=px.ticker and trade_date <= d0.d
        order by trade_date desc limit 720) dd
) e
where px.close < e.e10 and px.close < e.e21 and px.close < e.e50 and px.close < e.e200
$$;
revoke execute on function public.power_trend_trend_break(text[]) from public, anon, authenticated;
grant execute on function public.power_trend_trend_break(text[]) to service_role;
