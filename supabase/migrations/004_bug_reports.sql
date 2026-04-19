-- ============================================================================
-- Track B3 — Bug reports + screenshot storage
-- ============================================================================
-- Public bug-report surface for the MacroTilt dashboard:
--   • Any visitor (auth'd or anonymous) can INSERT a row via the Report Bug
--     button. Screenshots are uploaded to the `bug-screenshots` storage bucket.
--   • No one except Joe (hard-coded admin user_id) can SELECT/UPDATE reports.
--     The triage workflow (Cowork scheduled task) runs against the service_role
--     key, which bypasses RLS entirely.
--
-- Status lifecycle:
--   received → investigating → fix-proposed → resolved
--                              └→ needs-info ─┘
--                              └→ wontfix
--                              └→ duplicate
--
-- Safe to re-run: IF NOT EXISTS everywhere, DROP POLICY IF EXISTS before
-- CREATE, bucket upsert uses on conflict do nothing.
-- ============================================================================

-- ── Admin user_id (single source of truth) ─────────────────────────────────
-- Used by RLS policies below. If we ever add more admins, extend to a table.
-- Joe's auth.users id: 83cd9e76-eb35-4581-864e-9517e13e9be0
-- (see migrations/002_b2_seed_joe.sql)

-- ── bug_reports table ──────────────────────────────────────────────────────
create table if not exists public.bug_reports (
  id             uuid primary key default gen_random_uuid(),
  -- Short human-readable ticket id (auto-increment via sequence below).
  report_number  bigint unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Reporter identity. user_id is nullable because anonymous visitors can file.
  user_id        uuid references auth.users(id) on delete set null,
  reporter_email text not null,
  reporter_name  text,

  -- Report content
  title          text,
  description    text not null,

  -- Context auto-captured client-side (helps Claude reproduce).
  url_hash       text,              -- e.g. "#portopps"
  url_full       text,              -- full URL incl. query params
  user_agent     text,
  viewport       text,              -- e.g. "1440x900"
  build_sha      text,              -- VITE_BUILD_SHA if available
  console_errors jsonb default '[]'::jsonb,  -- last N console.error messages

  -- Screenshot in bug-screenshots bucket. Path format:
  --   {report_id}/{timestamp}.png
  screenshot_path text,

  -- Triage state
  status         text not null default 'received'
    check (status in ('received','investigating','fix-proposed','resolved','wontfix','needs-info','duplicate')),
  triage_notes   text,
  branch_name    text,              -- bugfix/<slug>-<report_number>
  resolved_at    timestamptz,
  ack_email_sent_at      timestamptz,
  nudge_email_sent_at    timestamptz,
  resolution_email_sent_at timestamptz
);

create index if not exists bug_reports_status_idx     on public.bug_reports (status);
create index if not exists bug_reports_created_at_idx on public.bug_reports (created_at desc);
create index if not exists bug_reports_user_id_idx    on public.bug_reports (user_id);

-- Auto-increment human-friendly report_number (1001, 1002, ...).
create sequence if not exists public.bug_reports_number_seq
  start with 1001 increment by 1;

create or replace function public.assign_bug_report_number()
  returns trigger language plpgsql as $$
  begin
    if new.report_number is null then
      new.report_number := nextval('public.bug_reports_number_seq');
    end if;
    return new;
  end $$;

drop trigger if exists bug_reports_assign_number on public.bug_reports;
create trigger bug_reports_assign_number
  before insert on public.bug_reports
  for each row execute function public.assign_bug_report_number();

-- updated_at trigger (reuses touch_updated_at() from migration 001).
drop trigger if exists bug_reports_touch_updated_at on public.bug_reports;
create trigger bug_reports_touch_updated_at
  before update on public.bug_reports
  for each row execute function public.touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.bug_reports enable row level security;

-- INSERT: anyone, authenticated or anonymous. Client-supplied user_id must
-- either be null (anon) or match auth.uid() (so no one spoofs someone else's
-- submission). reporter_email is always user-provided (they may file on behalf
-- of someone else — no need to tie it to auth email).
drop policy if exists "bug_reports — public insert" on public.bug_reports;
create policy "bug_reports — public insert"
  on public.bug_reports for insert
  with check (user_id is null or user_id = auth.uid());

-- SELECT: admin (Joe) only. Service role bypasses RLS so the scheduled task
-- using the service key sees everything regardless of this policy.
drop policy if exists "bug_reports — admin select" on public.bug_reports;
create policy "bug_reports — admin select"
  on public.bug_reports for select
  using (auth.uid() = '83cd9e76-eb35-4581-864e-9517e13e9be0'::uuid);

-- UPDATE: admin only.
drop policy if exists "bug_reports — admin update" on public.bug_reports;
create policy "bug_reports — admin update"
  on public.bug_reports for update
  using      (auth.uid() = '83cd9e76-eb35-4581-864e-9517e13e9be0'::uuid)
  with check (auth.uid() = '83cd9e76-eb35-4581-864e-9517e13e9be0'::uuid);

-- (No DELETE policy → nobody can delete via PostgREST. Service role still can.)

-- ── Storage bucket for screenshots ─────────────────────────────────────────
-- Public = false: screenshots are private; admin pulls them via signed URL.
-- File size limit: 5 MB (generous; html2canvas PNGs are usually under 500 KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-screenshots', 'bug-screenshots', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS: anyone can INSERT into bug-screenshots; only admin can SELECT.
drop policy if exists "bug-screenshots — public upload" on storage.objects;
create policy "bug-screenshots — public upload"
  on storage.objects for insert
  with check (bucket_id = 'bug-screenshots');

drop policy if exists "bug-screenshots — admin select" on storage.objects;
create policy "bug-screenshots — admin select"
  on storage.objects for select
  using (
    bucket_id = 'bug-screenshots'
    and auth.uid() = '83cd9e76-eb35-4581-864e-9517e13e9be0'::uuid
  );

-- ── sanity check ───────────────────────────────────────────────────────────
-- After running, verify:
--   select tablename, rowsecurity from pg_tables
--    where schemaname='public' and tablename='bug_reports';
--   -- rowsecurity should be true.
--
--   select id, public, file_size_limit from storage.buckets
--    where id='bug-screenshots';
--   -- public=false, file_size_limit=5242880.
