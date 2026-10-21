-- 20261020 — qt_factor_exposure: the Paper Portfolio page's "Active style
-- factor loading" widget (Joe, 2026-10-20: cockpit redesign).
--
-- WHAT IT IS. For each name in a scored book, five characteristic z-scores
-- measured against a baseline of the 500 largest US common stocks by market
-- cap (the site holds no official S&P 500 constituent list — this is the
-- nearest honest proxy and the page says so). The widget shows the book's
-- weighted-average z minus the baseline's cap-weighted z: an ACTIVE loading,
-- the Barra-style "what does this book tilt toward that the index does not".
--
-- FACTORS (same definitions as the scorer where the scorer has one):
--   momentum  12-month price change skipping the last month  (score.py mom12)
--   quality   gross profit / total assets                     (qt_quality gp_a)
--   buybacks  minus the 1-year change in share count          (qt_quality iss)
--   size      ln(market cap)                                  (shares x close)
--   value     ln(fiscal-year revenue / market cap)            (sales yield)
--
-- METHOD. Baseline raw values are winsorised at the 2.5th/97.5th percentile
-- (a single blown-up outlier must not set the scale), then z = (x − mean)/sd
-- using the baseline's equal-weight mean and sd. A holding outside the
-- baseline is scored on the same scale after clipping to the same bounds.
-- bench_z is the baseline's cap-weighted mean z (not zero: the biggest names
-- pull it). Everything is as of the book's rebalance date: prices up to that
-- session, fundamentals FILED by then (point-in-time, like the scorer).
--
-- SOURCE. prices_eod (registered feed market.prices-eod-massive) and
-- qt_fundamentals via qt_quality(). One source for the whole widget —
-- holdings AND baseline — so a name's z and its neighbours' z are measured
-- the same way (LESSONS 4.1, 4.5).
--
-- PRODUCER. qt_factor_exposure_build(rebalance_date) is called by
-- QT-REBALANCE right after the book is written, and once by hand for the
-- 2026-10-01 book. Idempotent: it upserts that date's rows (applied 2026-10-20
-- through the SQL console; this file is the record).

create table if not exists public.qt_factor_exposure (
  rebalance_date date        not null,
  symbol         text        not null,
  factor         text        not null,
  raw            double precision,
  z              double precision,
  bench_z        double precision,
  base_n         integer,
  base_mean      double precision,
  base_sd        double precision,
  created_at     timestamptz not null default now(),
  primary key (rebalance_date, symbol, factor)
);
grant select on public.qt_factor_exposure to anon, authenticated;
alter table public.qt_factor_exposure enable row level security;
create policy qt_factor_exposure_public_read on public.qt_factor_exposure
  for select using (true);

create or replace function public.qt_factor_exposure_build(as_of date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n_written integer;
begin
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

  -- raw factor values for every common stock with a 12-month record
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

  insert into qt_factor_exposure
    (rebalance_date, symbol, factor, raw, z, bench_z, base_n, base_mean, base_sd, created_at)
  select as_of, l.symbol, l.factor, l.raw,
    (least(greatest(l.raw, st.lo), st.hi) - st.mean) / nullif(st.sd, 0),
    st.bench_z, st.n, st.mean, st.sd, now()
  from _fx_long l
  join _fx_stats st on st.factor = l.factor
  where l.symbol in (select symbol from qt_target_book where rebalance_date = as_of)
  on conflict (rebalance_date, symbol, factor) do update
    set raw = excluded.raw, z = excluded.z, bench_z = excluded.bench_z,
        base_n = excluded.base_n, base_mean = excluded.base_mean,
        base_sd = excluded.base_sd, created_at = excluded.created_at;

  get diagnostics n_written = row_count;
  return n_written;
end $$;

-- The page's one price call: {ticker: [[date, close], ...]} for the holdings,
-- the S&P 500 fund and the five style funds. Written as one index probe per
-- ticker — `ticker = any(...)` let the planner walk the date index across
-- 12,000 tickers and timed out on the first live call.
create or replace function public.qt_risk_prices_json(syms text[], since date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(s.ticker, pts), '{}'::jsonb)
  from unnest(syms[1:40]) s(ticker)
  cross join lateral (
    select jsonb_agg(jsonb_build_array(p.trade_date, p.close) order by p.trade_date) pts
    from prices_eod p
    where p.ticker = s.ticker and p.trade_date >= since and p.close > 0
  ) x
  where pts is not null;
$$;
grant execute on function public.qt_risk_prices_json(text[], date) to anon, authenticated;

-- Health row for the new feed (graded monthly like the book it rides on).
insert into pipeline_health (indicator_id, label, source, cadence, expected_cadence_minutes, status, last_check_at)
select 'qt-factor-exposure', 'Quality Trend · Style-factor exposures',
       'MacroTilt engine (QT-REBALANCE → qt_factor_exposure_build)', 'M', 43200, 'green', now()
where not exists (select 1 from pipeline_health where indicator_id = 'qt-factor-exposure');
