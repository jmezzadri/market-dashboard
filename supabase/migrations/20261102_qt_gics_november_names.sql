-- qt_gics — curated GICS labels for the five names the 2026-11-02 scoring run
-- brought into the book that had no label (the run printed them, as designed:
-- "qt_gics is missing 5 name(s)"); the Paper Portfolio page rendered them as
-- "Unclassified 25.3%" and RENDERED-DOM-SMOKE went red on it. Labels are the
-- standard GICS sector / industry for each company. The same statement
-- back-fills the 2026-11-02 book so the live page is whole without waiting
-- for the December run.
--
-- Applied to production via MCP on 2026-11-02; this file is the record.
insert into qt_gics (ticker, sector, industry, source) values
  ('ANF', 'Consumer Discretionary', 'Specialty Retail',   'curated 2026-11-02'),
  ('DBX', 'Information Technology', 'Software',           'curated 2026-11-02'),
  ('RNG', 'Information Technology', 'Software',           'curated 2026-11-02'),
  ('SN',  'Consumer Discretionary', 'Household Durables', 'curated 2026-11-02'),
  ('WSM', 'Consumer Discretionary', 'Specialty Retail',   'curated 2026-11-02')
on conflict (ticker) do update
  set sector = excluded.sector, industry = excluded.industry,
      source = excluded.source, updated_at = now();
update qt_target_book b
   set sector = g.sector, industry = g.industry
  from qt_gics g
 where g.ticker = b.symbol and b.rebalance_date = '2026-11-02'
   and (b.sector is null or b.industry is null);
