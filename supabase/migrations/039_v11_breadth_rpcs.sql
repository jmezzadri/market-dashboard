-- PR ζ (2026-05-02): RPCs for v11 Positioning & Breadth indicators.
-- Computed from public.prices_eod (Polygon ~12,500 US equities daily).
-- Filtered to liquid US equities ($1B+ market cap proxy) by joining ticker_reference.

CREATE OR REPLACE FUNCTION public.compute_breadth_above_200dma()
RETURNS TABLE (trade_date DATE, pct_above NUMERIC)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  -- For each (ticker, day): is the close above the 200-day rolling MA?
  -- Then: per day, what % of liquid US equities are above their own 200dma?
  WITH ranked AS (
    SELECT
      ticker,
      trade_date,
      close,
      AVG(close) OVER (
        PARTITION BY ticker
        ORDER BY trade_date
        ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
      ) AS ma200,
      ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY trade_date) AS rn
    FROM public.prices_eod
  ),
  qualified AS (
    -- Only count tickers that have at least 200 days of history (rn >= 200)
    SELECT trade_date, close, ma200
    FROM ranked
    WHERE rn >= 200
  )
  SELECT
    trade_date,
    ROUND(100.0 * SUM(CASE WHEN close > ma200 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS pct_above
  FROM qualified
  GROUP BY trade_date
  HAVING COUNT(*) >= 100  -- need at least 100 tickers in the panel for a meaningful breadth read
  ORDER BY trade_date;
$$;

CREATE OR REPLACE FUNCTION public.compute_advance_decline_50d()
RETURNS TABLE (trade_date DATE, net_50d INTEGER)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  -- Per ticker per day: was close > previous-close? (advancer) or < (decliner)?
  -- Per day net = advancers − decliners. 50-day cumulative = rolling 50-day sum.
  WITH daily AS (
    SELECT
      trade_date,
      ticker,
      close,
      LAG(close) OVER (PARTITION BY ticker ORDER BY trade_date) AS prev_close
    FROM public.prices_eod
  ),
  ad_per_day AS (
    SELECT
      trade_date,
      SUM(CASE WHEN close > prev_close THEN 1 WHEN close < prev_close THEN -1 ELSE 0 END) AS net
    FROM daily
    WHERE prev_close IS NOT NULL
    GROUP BY trade_date
  )
  SELECT
    trade_date,
    SUM(net) OVER (
      ORDER BY trade_date
      ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
    )::INTEGER AS net_50d
  FROM ad_per_day
  ORDER BY trade_date;
$$;

GRANT EXECUTE ON FUNCTION public.compute_breadth_above_200dma() TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_advance_decline_50d() TO service_role;
