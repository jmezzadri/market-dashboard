-- 061 (2026-06-03): Fix compute_advance_decline_50d — the 039 version scanned
-- ALL of prices_eod (~12.8k tickers incl. ETFs/funds, full history) with window
-- functions and timed out (error 57014). Fix: restrict to ACTIVE COMMON STOCKS
-- (universe_master.type='CS', ~5,358 names), floor the window to the trailing 4
-- years, and give the function its own 180s statement_timeout so the PostgREST
-- producer call (short default timeout) doesn't cancel the ~37s computation.
CREATE OR REPLACE FUNCTION public.compute_advance_decline_50d()
RETURNS TABLE (trade_date DATE, net_50d INTEGER)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET statement_timeout TO '180000'
AS $$
  WITH universe AS (
    SELECT ticker FROM public.universe_master
    WHERE active = TRUE AND type = 'CS'
  ),
  px AS (
    SELECT p.ticker, p.trade_date, p.close
    FROM public.prices_eod p
    JOIN universe u USING (ticker)
    WHERE p.trade_date >= (CURRENT_DATE - INTERVAL '4 years')
      AND p.close IS NOT NULL
  ),
  daily AS (
    SELECT trade_date, ticker, close,
           LAG(close) OVER (PARTITION BY ticker ORDER BY trade_date) AS prev_close
    FROM px
  ),
  ad_per_day AS (
    SELECT trade_date,
           SUM(CASE WHEN close > prev_close THEN 1
                    WHEN close < prev_close THEN -1 ELSE 0 END) AS net
    FROM daily
    WHERE prev_close IS NOT NULL
    GROUP BY trade_date
  )
  SELECT trade_date,
         SUM(net) OVER (ORDER BY trade_date
                        ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)::INTEGER AS net_50d
  FROM ad_per_day
  ORDER BY trade_date;
$$;
GRANT EXECUTE ON FUNCTION public.compute_advance_decline_50d() TO service_role;
