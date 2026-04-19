-- ============================================================================
-- Track B2 — Per-user portfolio tables + RLS
-- ============================================================================
-- Creates accounts, positions, watchlist tables. All rows owned by a single
-- auth.users row (user_id). Row-Level Security enforces strict tenant
-- isolation at the Postgres layer — an anon or wrong-user JWT gets an empty
-- result set, independent of app code.
--
-- Safe to re-run: all CREATEs use IF NOT EXISTS. Policies use DROP IF EXISTS
-- before CREATE so re-running the file refreshes them in place.
--
-- Run once in the Supabase SQL editor for project yqaqqzseepebrocgibcw.
-- ============================================================================

-- ── accounts ────────────────────────────────────────────────────────────────
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null,
  sub         text,
  color       text,
  tactical    boolean not null default false,
  note        text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists accounts_user_id_idx
  on public.accounts (user_id, sort_order);

-- ── positions ───────────────────────────────────────────────────────────────
create table if not exists public.positions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  ticker      text not null,
  name        text,
  shares      numeric,
  price       numeric,
  avg_cost    numeric,
  value       numeric,          -- denormalized: shares * price
  sector      text,
  beta        numeric,
  analysis    text,             -- qualitative note per holding
  color       text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists positions_user_id_idx
  on public.positions (user_id);

create index if not exists positions_account_id_idx
  on public.positions (account_id, sort_order);

-- ── watchlist ───────────────────────────────────────────────────────────────
-- Ticker-only rows for "I want to track this name but don't own it yet."
create table if not exists public.watchlist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ticker      text not null,
  name        text,
  theme       text,
  note        text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists watchlist_user_id_idx
  on public.watchlist (user_id, sort_order);

-- Prevent duplicate ticker watchlist rows per user.
create unique index if not exists watchlist_user_ticker_uniq
  on public.watchlist (user_id, upper(ticker));

-- ── updated_at triggers ─────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
  returns trigger language plpgsql as $$
  begin
    new.updated_at = now();
    return new;
  end $$;

drop trigger if exists accounts_touch_updated_at on public.accounts;
create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function public.touch_updated_at();

drop trigger if exists positions_touch_updated_at on public.positions;
create trigger positions_touch_updated_at
  before update on public.positions
  for each row execute function public.touch_updated_at();

drop trigger if exists watchlist_touch_updated_at on public.watchlist;
create trigger watchlist_touch_updated_at
  before update on public.watchlist
  for each row execute function public.touch_updated_at();

-- ── RLS — one user, one book ────────────────────────────────────────────────
alter table public.accounts  enable row level security;
alter table public.positions enable row level security;
alter table public.watchlist enable row level security;

-- accounts policies
drop policy if exists "own accounts — select" on public.accounts;
create policy "own accounts — select"
  on public.accounts for select
  using (auth.uid() = user_id);

drop policy if exists "own accounts — write" on public.accounts;
create policy "own accounts — write"
  on public.accounts for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- positions policies
drop policy if exists "own positions — select" on public.positions;
create policy "own positions — select"
  on public.positions for select
  using (auth.uid() = user_id);

drop policy if exists "own positions — write" on public.positions;
create policy "own positions — write"
  on public.positions for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- watchlist policies
drop policy if exists "own watchlist — select" on public.watchlist;
create policy "own watchlist — select"
  on public.watchlist for select
  using (auth.uid() = user_id);

drop policy if exists "own watchlist — write" on public.watchlist;
create policy "own watchlist — write"
  on public.watchlist for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── sanity check ────────────────────────────────────────────────────────────
-- After running, verify RLS is enforced:
--   select tablename, rowsecurity
--     from pg_tables
--    where schemaname = 'public'
--      and tablename in ('accounts','positions','watchlist');
-- Each row should have rowsecurity = true.
