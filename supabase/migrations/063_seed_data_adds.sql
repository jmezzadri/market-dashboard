-- 063 (2026-06-05): Seed pipeline_health for the new data adds so each freshness
-- chip is genuinely tracked. The watchdog only updates EXISTING rows; without a
-- seed these would render fake-green. Brent crude (commodities) + 10Y/2Y nominal
-- Treasury yields (rates) + unemployment rate & nonfarm payrolls (economy).
INSERT INTO public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status)
VALUES
  ('cmdty_brent','Brent crude','Yahoo Finance','D',1440,'green'),
  ('ust_10y','10-year Treasury yield','U.S. Treasury','D',1440,'green'),
  ('ust_2y','2-year Treasury yield','U.S. Treasury','D',1440,'green'),
  ('unrate','Unemployment rate','FRED','M',44640,'green'),
  ('payrolls','Nonfarm payrolls','FRED','M',44640,'green')
ON CONFLICT (indicator_id) DO NOTHING;
