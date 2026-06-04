-- 063 (2026-06-04): Standard Advance-Decline Line.
-- Replaces the 50-day rolling cumulative (compute_advance_decline_50d) with the
-- classic ever-running cumulative A/D line. Same universe filter (active common
-- stocks) and 4-year window, own 180s timeout so the PostgREST producer call
-- doesn't cancel. Output: cumulative running sum of daily (advancers - decliners).
CREATE OR REPLACE FUNCTION public.compute_ad_line()
RETURNS TABLE (trade_date DATE, ad_line BIGINT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET statement_timeout TO '180000'
AS $$
  WITH universe AS (
    SELECT ticker FROM public.universe_master WHERE active = TRUE AND type = 'CS'
  ),
  px AS (
    SELECT p.ticker, p.trade_date, p.close
    FROM public.prices_eod p JOIN universe u USING (ticker)
    WHERE p.trade_date >= (CURRENT_DATE - INTERVAL '4 years') AND p.close IS NOT NULL
  ),
  daily AS (
    SELECT trade_date, ticker, close,
           LAG(close) OVER (PARTITION BY ticker ORDER BY trade_date) AS prev_close
    FROM px
  ),
  ad_per_day AS (
    SELECT trade_date,
           SUM(CASE WHEN close > prev_close THEN 1 WHEN close < prev_close THEN -1 ELSE 0 END) AS net
    FROM daily WHERE prev_close IS NOT NULL GROUP BY trade_date
  )
  SELECT trade_date,
         SUM(net) OVER (ORDER BY trade_date ROWS UNBOUNDED PRECEDING)::BIGINT AS ad_line
  FROM ad_per_day ORDER BY trade_date;
$$;
GRANT EXECUTE ON FUNCTION public.compute_ad_line() TO service_role;
