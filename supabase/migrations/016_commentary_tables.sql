-- 016_commentary_tables.sql
--
-- Adds two thin tables used by the Home page Macro Overview and Sector
-- Outlook tiles to surface a threshold-gated editorial blurb. The engine
-- (supabase/functions/generate-commentary) runs nightly, detects whether
-- any indicator or sector has moved materially, and writes ONE row per
-- table per day. If nothing material happened, `short_term` /
-- `medium_term` / `headline` are written as NULL and the frontend renders
-- nothing in those slots.
--
-- Design rules baked into the schema:
--   • One row per day max — enforced via `UNIQUE(generated_date)`.
--   • Word-cap hints exist only as soft constraints (length ≤ 400 chars
--     ≈ 25–30 words) to keep blurbs terse even if a later prompt drifts.
--   • Public read via RLS; writes restricted to service_role (the engine
--     writes with the service key; no signed-in user ever writes here).

set check_function_bodies = off;

-- ── macro_commentary ───────────────────────────────────────────────────
create table if not exists public.macro_commentary (
  id                bigint generated always as identity primary key,
  generated_date    date not null default (now() at time zone 'utc')::date,
  generated_at      timestamptz not null default now(),
  short_term        text,
  medium_term       text,
  -- Book-keeping so we can tell why nothing was written.
  short_term_reason text,
  medium_term_reason text,
  -- JSON of the move that triggered the blurb (indicator id, delta, SD).
  evidence          jsonb,
  constraint macro_commentary_short_len check (short_term is null or length(short_term) <= 400),
  constraint macro_commentary_medium_len check (medium_term is null or length(medium_term) <= 400),
  constraint macro_commentary_daily_unique unique (generated_date)
);

create index if not exists idx_macro_commentary_generated_at
  on public.macro_commentary (generated_at desc);

alter table public.macro_commentary enable row level security;

drop policy if exists macro_commentary_read_all on public.macro_commentary;
create policy macro_commentary_read_all
  on public.macro_commentary
  for select
  using (true);

-- Writes: service-role only. Authenticated users MAY NOT write. We omit
-- a permissive write policy on purpose — the service role bypasses RLS
-- so no policy is needed for the engine.
revoke all on public.macro_commentary from anon, authenticated;
grant select on public.macro_commentary to anon, authenticated;

-- ── sector_commentary ──────────────────────────────────────────────────
create table if not exists public.sector_commentary (
  id                bigint generated always as identity primary key,
  generated_date    date not null default (now() at time zone 'utc')::date,
  generated_at      timestamptz not null default now(),
  -- ONE sentence summary for the Home Sector Outlook tile. Null-allowed.
  headline          text,
  -- Optional longer note per-sector (jsonb: { [sector_id]: "text" }).
  per_sector        jsonb,
  reason            text,
  evidence          jsonb,
  constraint sector_commentary_headline_len check (headline is null or length(headline) <= 400),
  constraint sector_commentary_daily_unique unique (generated_date)
);

create index if not exists idx_sector_commentary_generated_at
  on public.sector_commentary (generated_at desc);

alter table public.sector_commentary enable row level security;

drop policy if exists sector_commentary_read_all on public.sector_commentary;
create policy sector_commentary_read_all
  on public.sector_commentary
  for select
  using (true);

revoke all on public.sector_commentary from anon, authenticated;
grant select on public.sector_commentary to anon, authenticated;

-- Convenience comment.
comment on table public.macro_commentary is
  'Home Macro Overview tile editorial blurb (short-term + medium-term). '
  'One row per UTC day. NULL = nothing material; UI renders nothing.';

comment on table public.sector_commentary is
  'Home Sector Outlook tile editorial blurb (single headline). '
  'One row per UTC day. NULL = nothing material; UI renders nothing.';
