-- 2026-11-12 health sweep — stock_facts: market cap at the newest close, and a
-- 52-week range for stocks listed inside the year.
--
-- (1) ticker_reference.market_cap is weighted_shares_outstanding x the vendor's
--     close on the day the record was fetched (400 of 400 sampled rows match
--     exactly), and the records refresh on a slow rotation: 13,762 of 14,123
--     were more than a week old. The Watchlist showed NVDA at $5.20T beside a
--     $173.73 close — its Oct 28 price. Market cap is now the same share count
--     priced at the close the row shows; the stored figure is the fallback.
-- (2) A stock listed less than a year ago (SPCX, Jun 12) has every session of
--     its life inside the 52-week window, so its high and low since listing ARE
--     its 52-week high and low. It printed "—" because the rule demanded 200
--     sessions; the rule now also accepts a listing date inside the window.
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
  select max(trade_date) into d0 from (select trade_date from prices_eod where trade_date > current_date - 15 group by trade_date having count(*) >= 5000) full_days;
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
  select p.ticker, coalesce(u.name, r.name), u.type, r.sic_description,
    coalesce(case when r.weighted_shares_outstanding > 0 then r.weighted_shares_outstanding * p.c0 end, r.market_cap),
    d0, p.c0,
    p.c0 / nullif(p.c1, 0) - 1,
    p.c0 / nullif(p.c5, 0) - 1, p.c0 / nullif(p.c21, 0) - 1, p.c0 / nullif(p.c63, 0) - 1,
    p.c0 / nullif(p.cy, 0) - 1, p.c0 / nullif(p.c252, 0) - 1,
    case when p.n252 >= 200 or (r.list_date > d252 and p.n252 >= 5) then p.hi end,
    case when p.n252 >= 200 or (r.list_date > d252 and p.n252 >= 5) then p.lo end,
    case when p.n252 >= 200 or (r.list_date > d252 and p.n252 >= 5) then p.c0 / nullif(p.hi, 0) - 1 end,
    case when p.n252 >= 200 or (r.list_date > d252 and p.n252 >= 5) then p.c0 / nullif(p.lo, 0) - 1 end,
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

-- Rebuild once now so the pages show the corrected figures before tonight's run.
select public.stock_facts_build();
