-- Migration 011: ticker_events + admin_users + api_usage_log
-- ================================================================
-- Purpose
-- -------
-- Three companion tables to extend MacroTilt's data freshness story:
--
--   1. public.ticker_events — 3x-weekday ingestion of per-ticker news,
--      insider trades, congressional trades, and dark pool prints.
--      Fills the credibility gap where these fields previously only
--      refreshed 1x/day from the daily scanner.
--
--   2. public.admin_users — small allowlist of user_ids with privileged
--      read access to ops tables (api_usage_log, future admin surfaces).
--      Not tied to any Supabase role — simple user-id membership check.
--
--   3. public.api_usage_log — one row per scheduled scanner run,
--      capturing UW rate-limit headers + per-endpoint call counts.
--      Drives the /admin/usage page and answers "am I at risk of
--      hitting UW limits?" without speculation.
--
-- Cadence & retention
-- -------------------
-- ticker_events writes 3x/weekday (10:00 / 13:00 / 15:45 ET), same as
-- universe_snapshots. 30-day prune via pg_cron.
-- api_usage_log writes once per scheduled run (~10-15 rows/day across all
-- scanners). 90-day retention — we want enough history for trend lines.
--
-- Deduplication strategy for ticker_events
-- ----------------------------------------
-- UW firehose endpoints re-surface the same event across multiple polls
-- (e.g. a dark-pool print shows up in /darkpool/recent for several hours
-- after it fires). We compute a stable dedup_key per (source, event_ts,
-- tick_fingerprint) at ingest time and enforce uniqueness on it, so
-- re-runs are idempotent and don't double-count.
-- ================================================================

-- ========================================================
-- 1. ticker_events
-- ========================================================
create table if not exists public.ticker_events (
  id              bigserial       primary key,
  ticker          text            not null,
  source          text            not null,
  event_ts        timestamptz     not null,
  ingested_ts     timestamptz     not null default now(),
  run_id          uuid,
  dedup_key       text            not null,
  payload         jsonb           not null,
  raw_extras      jsonb,

  constraint ticker_events_source_check
    check (source in ('news', 'insider', 'congress', 'darkpool')),
  constraint ticker_events_dedup_unique
    unique (source, dedup_key)
);

create index if not exists ticker_events_ticker_source_ts_idx
  on public.ticker_events (ticker, source, event_ts desc);

create index if not exists ticker_events_source_ts_idx
  on public.ticker_events (source, event_ts desc);

create index if not exists ticker_events_ingested_ts_idx
  on public.ticker_events (ingested_ts desc);

comment on table public.ticker_events is
  '3x-weekday per-ticker events (news/insider/congress/darkpool) from UW firehose endpoints. 30-day retention. See migration 011.';

-- RLS: authenticated read, service_role write. Same shape as universe_snapshots.
alter table public.ticker_events enable row level security;

drop policy if exists ticker_events_read on public.ticker_events;
create policy ticker_events_read
  on public.ticker_events
  for select
  to authenticated
  using (true);

-- 30-day retention prune, nightly at 02:20 UTC (5 min after universe prune).
select
  cron.schedule(
    'ticker_events_prune_30d',
    '20 2 * * *',
    $$ delete from public.ticker_events
       where ingested_ts < now() - interval '30 days'; $$
  );


-- ========================================================
-- 2. admin_users
-- ========================================================
create table if not exists public.admin_users (
  user_id      uuid           primary key references auth.users(id) on delete cascade,
  email        text           not null,
  granted_at   timestamptz    not null default now(),
  granted_by   uuid,
  notes        text
);

comment on table public.admin_users is
  'Allowlist for privileged read access to ops tables (api_usage_log, etc). Checked via public.is_admin(). See migration 011.';

-- RLS: nobody reads directly through PostgREST — all access goes through
-- the is_admin() function. service_role bypasses RLS for writes.
alter table public.admin_users enable row level security;

drop policy if exists admin_users_self_read on public.admin_users;
create policy admin_users_self_read
  on public.admin_users
  for select
  to authenticated
  using (user_id = auth.uid());

-- Seed Joe as the first admin. Email-based lookup so we don't need to
-- hardcode his user_id (which varies between environments).
insert into public.admin_users (user_id, email, notes)
select id, email, 'initial seed — app owner'
  from auth.users
 where email = 'josephmezzadri@gmail.com'
on conflict (user_id) do nothing;


-- ========================================================
-- 3. is_admin() helper function
-- ========================================================
-- SECURITY DEFINER so RLS on admin_users doesn't block the lookup when
-- called from a regular authenticated session. Returns false (not null)
-- when the caller isn't in the allowlist — safe default.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
  );
$$;

-- Allow authenticated users to call it (the function itself does the gating).
grant execute on function public.is_admin() to authenticated;

comment on function public.is_admin() is
  'Returns true iff the calling auth.uid() is in public.admin_users. Use in RLS policies on ops tables.';


-- ========================================================
-- 4. api_usage_log
-- ========================================================
create table if not exists public.api_usage_log (
  id                bigserial       primary key,
  run_id            uuid            not null,
  source            text            not null,
  endpoint          text,
  calls_made        integer         not null default 0,
  remaining_daily   integer,
  limit_daily       integer,
  peak_rpm          numeric,
  started_at        timestamptz     not null,
  completed_at      timestamptz     not null,
  duration_seconds  numeric,
  status            text            not null default 'success',
  notes             jsonb,

  constraint api_usage_log_source_check
    check (source in ('universe_snapshot', 'ticker_events', 'daily_scanner',
                      'scan_on_add', 'indicator_refresh', 'ad_hoc')),
  constraint api_usage_log_status_check
    check (status in ('success', 'partial', 'failed'))
);

create index if not exists api_usage_log_started_at_idx
  on public.api_usage_log (started_at desc);

create index if not exists api_usage_log_source_started_at_idx
  on public.api_usage_log (source, started_at desc);

create index if not exists api_usage_log_run_id_idx
  on public.api_usage_log (run_id);

comment on table public.api_usage_log is
  'Per-run UW API usage log: calls made, rate-limit headers at completion, peak RPM. Drives /admin/usage. 90-day retention.';

-- RLS: read gated on is_admin(). service_role writes (bypasses RLS).
alter table public.api_usage_log enable row level security;

drop policy if exists api_usage_log_admin_read on public.api_usage_log;
create policy api_usage_log_admin_read
  on public.api_usage_log
  for select
  to authenticated
  using (public.is_admin());

-- 90-day retention prune, nightly at 02:25 UTC.
select
  cron.schedule(
    'api_usage_log_prune_90d',
    '25 2 * * *',
    $$ delete from public.api_usage_log
       where started_at < now() - interval '90 days'; $$
  );
