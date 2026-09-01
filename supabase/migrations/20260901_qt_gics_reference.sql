-- qt_gics — curated GICS classification per ticker, read by the rebalance
-- writer so qt_target_book always carries sector/industry. Created 2026-09-01
-- after the relaunched engine wrote a fully NULL-classified book: the Aug 14
-- labels had been a one-off manual fill, not code (LESSONS 4.31). Seeded from
-- those same already-curated labels (newest label per symbol wins). A name the
-- engine scores that is missing here is written with NULL classification and
-- named in the scoring run's log for curation — never guessed from a lossy
-- SIC mapping: a wrong sector on a public page is worse than a blank one.
--
-- Applied to production via MCP on 2026-09-01; this file is the record.
create table if not exists qt_gics (
  ticker text primary key,
  sector text not null,
  industry text not null,
  source text not null default 'curated',
  updated_at timestamptz not null default now()
);
alter table qt_gics enable row level security;
insert into qt_gics (ticker, sector, industry)
  select distinct on (symbol) symbol, sector, industry
  from qt_target_book
  where sector is not null and industry is not null
  order by symbol, rebalance_date desc
on conflict (ticker) do nothing;
