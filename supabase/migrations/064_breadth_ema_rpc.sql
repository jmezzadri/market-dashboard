-- 064 (2026-06-04): Strategic breadth regime filters.
-- % of active US common stocks trading above their own 50-day and 200-day EMA.
-- EMA is recursive (each day depends on the prior), computed per ticker over a
-- 5-year window (1y warmup) and reported for the trailing 4 years. Own long
-- statement_timeout because the recursion walks ~1,250 trading days x ~5,300 names.
CREATE OR REPLACE FUNCTION public.compute_breadth_ema()
RETURNS TABLE (trade_date DATE, pct_above_50ema NUMERIC, pct_above_200ema NUMERIC)
LANGUAGE sql SECURITY DEFINER STABLE
SET statement_timeout TO '300000'
AS $$
  WITH RECURSIVE
  universe AS (SELECT ticker FROM public.universe_master WHERE active = TRUE AND type='CS'),
  px AS (
    SELECT p.ticker, p.trade_date, p.close::float8 AS close,
           ROW_NUMBER() OVER (PARTITION BY p.ticker ORDER BY p.trade_date) AS rn
    FROM public.prices_eod p JOIN universe u USING (ticker)
    WHERE p.trade_date >= (CURRENT_DATE - INTERVAL '5 years') AND p.close IS NOT NULL
  ),
  ema AS (
    SELECT ticker, trade_date, close, rn, close AS e50, close AS e200 FROM px WHERE rn = 1
    UNION ALL
    SELECT p.ticker, p.trade_date, p.close, p.rn,
           p.close*(2.0/51.0)  + e.e50*(1.0-2.0/51.0),
           p.close*(2.0/201.0) + e.e200*(1.0-2.0/201.0)
    FROM ema e JOIN px p ON p.ticker = e.ticker AND p.rn = e.rn + 1
  )
  SELECT trade_date,
         ROUND(100.0*AVG(((close > e50)::int))  FILTER (WHERE rn >= 50), 1),
         ROUND(100.0*AVG(((close > e200)::int)) FILTER (WHERE rn >= 200), 1)
  FROM ema
  WHERE trade_date >= (CURRENT_DATE - INTERVAL '4 years')
  GROUP BY trade_date
  HAVING COUNT(*) FILTER (WHERE rn >= 200) >= 100
  ORDER BY trade_date;
$$;
GRANT EXECUTE ON FUNCTION public.compute_breadth_ema() TO service_role;
