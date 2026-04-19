-- Migration 005: per-user scan supplement
--
-- Purpose
-- -------
-- The scanner's public artifact (latest_scan_data.json on github) is
-- intentionally limited to the base universe — watchlist tickers are stripped
-- so the repo doesn't leak what anyone has on their watchlist. But users need
-- the 6-section composite data for *their own* watchlist tickers, not just
-- the base universe.
--
-- Design
-- ------
-- The scanner, running with service_role credentials, reads the union of every
-- user's watchlist, computes technicals/screener/composite for those tickers,
-- and upserts one row per (user, ticker) into this table. The frontend, once
-- signed in, reads its own rows (RLS-scoped) and merges them into the public
-- signals object before rendering. Anon users and other signed-in users never
-- see any row that isn't theirs.
--
-- Row shape
-- ---------
-- One row per (user_id, ticker). technicals_json / screener_json /
-- composite_json are opaque JSON blobs — same shape as the equivalent entries
-- inside latest_scan_data.json's signals map. Merging on the client is
-- straightforward: Object.assign(publicTech, privateTech).
--
-- Lifecycle
-- ---------
-- The scanner runs 4–5x/day on GH Actions. Each run overwrites (upserts) the
-- rows for the user_id/ticker pairs it computed. If a user removes a ticker
-- from their watchlist, the stale row stays until it ages out — the scanner's
-- write_user_scan_rows() deletes stale rows for that user at the end of the
-- run based on the current watchlist membership.

create table if not exists public.user_scan_data (
  user_id           uuid        not null references auth.users(id) on delete cascade,
  ticker            text        not null,
  technicals_json   jsonb,
  screener_json     jsonb,
  composite_json    jsonb,
  scan_time         timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, ticker)
);

comment on table public.user_scan_data is
  'Per-user scan supplement. Scanner writes one row per (user, watchlist-ticker) each run; frontend merges into the public signals map client-side. RLS: owner-only read/write.';

comment on column public.user_scan_data.technicals_json is
  'Same shape as latest_scan_data.json signals.technicals[ticker]. Null if the scanner could not fetch OHLCV for this ticker.';
comment on column public.user_scan_data.screener_json is
  'Same shape as signals.screener[ticker]. Null if UW screener row was empty.';
comment on column public.user_scan_data.composite_json is
  'Output of sectionComposites.computeSectionComposites(ticker, signals). Pre-computed by the scanner so the client does not need to re-run the aggregation for every watchlist hit.';

create index if not exists user_scan_data_user_idx
  on public.user_scan_data (user_id);

-- Ticker-level index supports the scanner's "delete stale rows" pass.
create index if not exists user_scan_data_ticker_idx
  on public.user_scan_data (ticker);

-- updated_at touch trigger — mirrors the pattern used on other tables.
create or replace function public.user_scan_data_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_scan_data_touch_updated_at on public.user_scan_data;
create trigger user_scan_data_touch_updated_at
  before update on public.user_scan_data
  for each row execute function public.user_scan_data_touch_updated_at();

-- RLS — owner reads & writes their own rows. The scanner uses service_role,
-- which bypasses RLS, so the scanner's writes are unrestricted (as intended).
alter table public.user_scan_data enable row level security;

drop policy if exists "own scan data — select" on public.user_scan_data;
create policy "own scan data — select"
  on public.user_scan_data for select
  using (auth.uid() = user_id);

drop policy if exists "own scan data — write" on public.user_scan_data;
create policy "own scan data — write"
  on public.user_scan_data for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_scan_data to authenticated;
grant all on public.user_scan_data to service_role;
