-- 035_earnings_history.sql — last-4-quarters earnings beats/misses store.
-- Bug #1134 item 5. Frontend modal renders this as a stack of pills under
-- the Earnings & Events tile. Source: yfinance; ingest weekly via
-- trading-scanner/run_earnings_history.py.

create table if not exists public.earnings_history (
  ticker         text         not null,
  report_date    date         not null,
  fiscal_quarter text,
  eps_estimate   numeric,
  eps_actual     numeric,
  surprise_pct   numeric,
  beat           boolean,
  updated_at     timestamptz  not null default now(),
  primary key (ticker, report_date)
);

create index if not exists earnings_history_ticker_date
  on public.earnings_history (ticker, report_date desc);

-- Read from anon (public dashboard); writes via service-role only.
alter table public.earnings_history enable row level security;

drop policy if exists earnings_history_select_anon on public.earnings_history;
create policy earnings_history_select_anon
  on public.earnings_history
  for select
  to anon, authenticated
  using (true);

comment on table public.earnings_history is
  'Per-ticker last-N-quarters EPS estimate vs actual + surprise %. Refreshed weekly by trading-scanner/run_earnings_history.py. Used by the modal Earnings & Events tile.';
