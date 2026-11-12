-- 2026-11-12 (health sweep, Joe asked about ONDS "Buybacks -284%") —
-- qt_quality(): one year of share-count change, measured like for like.
--
-- ONDS's -284% is real: diluted shares went from 128.0M (Q2 2025) to 491.3M
-- (Q2 2026). But the same check found ~130 companies whose figure was a data
-- fault, not a company: WAT read -164,611% (its Q2 2026 diluted count is stored
-- as 98.2bn, a thousand times too big; true change -65% after the BD merger),
-- TBLA -85,112% (true +7%), FUBO +91% (true -9%). Three faults:
--   1. units — some filings are stored in thousands, some multiplied by 1,000;
--   2. "five rows back" was not a year back, because annual (FY) rows and
--      duplicate period ends sit in the same series;
--   3. no split adjustment, so a reverse split read as a buyback.
-- Now: each value 300x off its own series' median is re-scaled by 1,000; the
-- newest period is compared with the period closest to 365 days before it, in
-- the same tag; the earlier count is split-adjusted from the splits table; and a
-- change beyond 10x either way is treated as a data fault (no figure).
-- Diluted weighted shares first, shares outstanding as the fallback.
-- gp_a and ocf_a are unchanged.
create or replace function public.qt_quality(as_of date)
 returns table(symbol text, gp_a double precision, ocf_a double precision, iss double precision)
 language sql
 stable
as $function$
  with ranked as (
    select symbol, tag, period_end, val,
           row_number() over (partition by symbol, tag order by period_end desc) as rn
    from qt_fundamentals
    where filed <= as_of
      and (
        tag in ('Assets',
                'WeightedAverageNumberOfDilutedSharesOutstanding',
                'CommonStockSharesOutstanding')
        or fp = 'FY'
      )
  ),
  cur as (
    select r.symbol,
      max(val) filter (where tag = 'GrossProfit')                                        as gp,
      max(val) filter (where tag = 'Revenues')                                           as rev1,
      max(val) filter (where tag = 'RevenueFromContractWithCustomerExcludingAssessedTax') as rev2,
      max(val) filter (where tag = 'CostOfRevenue')                                      as cost1,
      max(val) filter (where tag = 'CostOfGoodsAndServicesSold')                         as cost2,
      max(val) filter (where tag = 'Assets')                                             as assets,
      max(val) filter (where tag = 'NetCashProvidedByUsedInOperatingActivities')         as ocf
    from ranked r where rn = 1 group by r.symbol
  ),
  sh_raw as (
    select f.symbol, f.tag, f.period_end, f.filed, f.val::double precision as val
    from qt_fundamentals f
    where f.filed <= as_of and f.val > 0
      and f.tag in ('WeightedAverageNumberOfDilutedSharesOutstanding', 'CommonStockSharesOutstanding')
      and f.period_end > as_of - 1100
  ),
  sh_med as (
    select s.symbol, s.tag, percentile_cont(0.5) within group (order by s.val) as med
    from sh_raw s group by s.symbol, s.tag
  ),
  sh as (
    select r.symbol, r.tag, r.period_end,
      case when r.val > m.med * 300 then r.val / 1000
           when r.val < m.med / 300 then r.val * 1000
           else r.val end as val,
      row_number() over (partition by r.symbol, r.tag order by r.period_end desc, r.filed desc) as rn
    from sh_raw r join sh_med m on m.symbol = r.symbol and m.tag = r.tag
  ),
  sh_pair as (
    select c.symbol, c.tag, c.period_end as ce, c.val as cv, p.period_end as pe, p.val as pv,
      row_number() over (partition by c.symbol, c.tag order by abs((c.period_end - p.period_end) - 365)) as k
    from sh c join sh p on p.symbol = c.symbol and p.tag = c.tag
     and (c.period_end - p.period_end) between 330 and 400
    where c.rn = 1
  ),
  sh_split as (
    select sp.symbol, sp.tag,
      exp(sum(ln(nullif(s.split_to, 0)::double precision / nullif(s.split_from, 0)))) as f
    from sh_pair sp join splits s on s.ticker = sp.symbol
     and s.execution_date > sp.pe and s.execution_date <= sp.ce
    where sp.k = 1 group by sp.symbol, sp.tag
  ),
  iss_t as (
    select sp.symbol, sp.tag, sp.cv / nullif(sp.pv * coalesce(x.f, 1), 0) as ratio
    from sh_pair sp left join sh_split x on x.symbol = sp.symbol and x.tag = sp.tag
    where sp.k = 1
  ),
  iss_pick as (
    select t.symbol,
      coalesce(max(t.ratio) filter (where t.tag = 'WeightedAverageNumberOfDilutedSharesOutstanding' and t.ratio between 0.1 and 10),
               max(t.ratio) filter (where t.tag = 'CommonStockSharesOutstanding' and t.ratio between 0.1 and 10)) as ratio
    from iss_t t group by t.symbol
  )
  select
    c.symbol,
    coalesce(c.gp, coalesce(c.rev1, c.rev2) - coalesce(c.cost1, c.cost2))
      / nullif(c.assets, 0)                                     as gp_a,
    c.ocf / nullif(c.assets, 0)                                 as ocf_a,
    -(i.ratio - 1)                                              as iss
  from cur c left join iss_pick i on i.symbol = c.symbol;
$function$;

-- Re-measure the current month's factor read-out with the repaired figure, then
-- the Watchlist facts. The paper book's own holdings and weights are not touched.
select public.qt_factor_exposure_build('2026-11-02');
select public.stock_facts_build();
