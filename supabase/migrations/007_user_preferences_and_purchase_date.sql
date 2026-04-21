-- Migration 007: user_preferences + positions.purchase_date
--
-- Purpose
-- -------
-- Item 36: users can now reorder columns and show/hide columns on every
-- table on the portopps page. Their preferences persist per user across
-- devices and sign-outs. Also adds an optional purchase_date field to
-- positions to power the Purchase Date, Holding Period, and (future)
-- Annualized PnL columns.
--
-- Adds
-- ----
-- 1. public.positions.purchase_date DATE NULL
--    Optional — existing rows stay NULL, new rows populate it from the
--    PositionEditor if the user typed one.
-- 2. public.user_preferences table
--    One row per auth user, keyed by user_id. `preferences` is a JSONB
--    blob shaped like:
--      {
--        "positions":      { "order": [...], "visible": [...] },
--        "watchlist_buy":  { "order": [...], "visible": [...] },
--        "watchlist_near": { "order": [...], "visible": [...] },
--        "watchlist_other":{ "order": [...], "visible": [...] }
--      }
--    Client-side code merges this with defaults, so new columns we add
--    later auto-appear for existing users.
-- RLS: owner-only read/write, same pattern as user_scan_data.
--
-- Safe to re-run: all CREATEs / ALTERs use IF NOT EXISTS.

-- ── positions.purchase_date ─────────────────────────────────────────────────
alter table public.positions
  add column if not exists purchase_date date;

comment on column public.positions.purchase_date is
  'Optional. Date the position was acquired. Used for Holding Period and Annualized PnL computations. NULL for legacy positions added before Item 36.';

-- ── user_preferences ────────────────────────────────────────────────────────
create table if not exists public.user_preferences (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.user_preferences is
  'Per-user UI preferences — table column order/visibility, etc. One row per user. Client reads on sign-in, writes debounced on change.';

comment on column public.user_preferences.preferences is
  'Opaque JSONB blob. Current shape: { <table_key>: { order: [colId...], visible: [colId...] } } where table_key is one of positions | watchlist_buy | watchlist_near | watchlist_other.';

-- ── updated_at trigger ──────────────────────────────────────────────────────
create or replace function public.user_preferences_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_preferences_touch_updated_at on public.user_preferences;
create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row execute function public.user_preferences_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.user_preferences enable row level security;

drop policy if exists "own preferences — select" on public.user_preferences;
create policy "own preferences — select"
  on public.user_preferences for select
  using (auth.uid() = user_id);

drop policy if exists "own preferences — write" on public.user_preferences;
create policy "own preferences — write"
  on public.user_preferences for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
