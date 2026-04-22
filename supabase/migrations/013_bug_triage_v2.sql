-- ============================================================================
-- Migration 013 — Bug triage v2 (institutional-grade)
-- ============================================================================
-- Purpose
-- -------
-- Consolidate bug_reports into a clean status model + add the lifecycle
-- columns the Admin · Bugs dashboard needs. The existing schema carried
-- two overlapping vocabularies (004's received/investigating/... and 008's
-- new/triaged/...) — this migration unifies them and adds the workflow
-- fields (complexity, priority, proposed_solution, approved_at/by,
-- merged_at, deployed_at, verified_at/by) plus a status-change audit log.
--
-- Clean 11-state model
-- --------------------
-- Main pipeline (each transition logged in bug_status_log):
--   new → triaged → awaiting_approval → approved → merged → deployed
--     → verified_closed                                      ↑
--   ↖ reopened (from verified_closed) ───────────────────────┘
--
-- Side branches (terminal):
--   wontfix · duplicate · needs_info
--
-- Backward compatibility
-- ----------------------
-- Edge functions `resolve-bug-report`, `approve-bug-fix`, and
-- `nudge-stale-bugs` still write the legacy vocab. Rather than break them
-- mid-migration, the CHECK below is a UNION (legacy + new). Legacy rows are
-- remapped to new vocab below; the next migration (014) will tighten the
-- CHECK once edge functions are cut over to the new values.
--
-- RLS
-- ---
-- Existing policies hardcoded Joe's UUID. This migration replaces them
-- with public.is_admin() (migration 011) so the admin allowlist is the
-- single source of truth.
-- ============================================================================

-- ── 1. Drop the old status CHECK so the remap UPDATE can run ──────────────
-- (the CHECK is evaluated per-row on UPDATE, so we can't remap to new-vocab
--  values until the constraint no longer forbids them.)
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.bug_reports'::regclass
       and contype = 'c'
       and conname like '%status%'
  loop
    execute format('alter table public.bug_reports drop constraint %I', r.conname);
  end loop;
end$$;


-- ── 2. Data migration — remap legacy status values to v2 vocab ───────────
-- Skipped → new is "re-queue" in v2 semantics (stage-bug-triage's SKIP path
-- bumps resurface_at and the row re-enters the queue as 'new').
update public.bug_reports
   set status = case status
     when 'received'      then 'new'
     when 'investigating' then 'triaged'
     when 'fix-proposed'  then 'awaiting_approval'
     when 'skipped'       then 'new'
     when 'dismissed'     then 'wontfix'
     when 'wont-fix'      then 'wontfix'
     when 'needs-info'    then 'needs_info'
     when 'fixed'         then 'verified_closed'
     when 'resolved'      then 'verified_closed'
     else status
   end
 where status in ('received','investigating','fix-proposed','skipped',
                  'dismissed','wont-fix','needs-info','fixed','resolved');
-- (verified_at backfill happens after we add the column in step 4.)


-- ── 3. Install the new CHECK (clean vocab + legacy aliases) ───────────────
-- Legacy aliases are kept live so the three edge functions
-- (approve-bug-fix / resolve-bug-report / nudge-stale-bugs) don't break
-- mid-cutover. Migration 014 will tighten the CHECK once those are updated.
alter table public.bug_reports
  add constraint bug_reports_status_check
  check (status in (
    -- clean v2 vocab (the ONE true set going forward)
    'new','triaged','awaiting_approval','approved','merged','deployed',
    'verified_closed','reopened','wontfix','duplicate','needs_info',
    -- legacy aliases kept live until edge functions cut over (migration 014)
    'received','investigating','fix-proposed','skipped','dismissed',
    'wont-fix','needs-info','fixed','resolved'
  ));


-- ── 3. New lifecycle columns ───────────────────────────────────────────────
alter table public.bug_reports
  add column if not exists complexity        text,
  add column if not exists priority          text,
  add column if not exists proposed_solution text,
  add column if not exists approved_at       timestamptz,
  add column if not exists approved_by       uuid references auth.users(id) on delete set null,
  add column if not exists merged_at         timestamptz,
  add column if not exists merged_pr         integer,
  add column if not exists merged_sha        text,
  add column if not exists deployed_at       timestamptz,
  add column if not exists deployed_sha      text,
  add column if not exists verified_at       timestamptz,
  add column if not exists verified_by       uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bug_reports_complexity_check'
  ) then
    alter table public.bug_reports
      add constraint bug_reports_complexity_check
      check (complexity is null or complexity in ('H','M','L'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'bug_reports_priority_check'
  ) then
    alter table public.bug_reports
      add constraint bug_reports_priority_check
      check (priority is null or priority in ('P0','P1','P2','P3'));
  end if;
end$$;

-- Backfill merged_at from the legacy fixed_at (approve-bug-fix used fixed_at
-- to mean "PR merged"). Only set if it's still null.
update public.bug_reports
   set merged_at  = fixed_at,
       merged_pr  = fixed_pr,
       merged_sha = fixed_sha
 where fixed_at is not null and merged_at is null;

-- Backfill verified_at for rows promoted to verified_closed in step 2.
update public.bug_reports
   set verified_at = coalesce(fixed_at, resolved_at, updated_at)
 where status = 'verified_closed' and verified_at is null;


-- ── 4. Audit log: bug_status_log ───────────────────────────────────────────
create table if not exists public.bug_status_log (
  id            bigserial primary key,
  bug_id        uuid        not null references public.bug_reports(id) on delete cascade,
  from_status   text,
  to_status     text        not null,
  changed_by    uuid        references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now(),
  note          text
);

create index if not exists bug_status_log_bug_id_idx
  on public.bug_status_log (bug_id, changed_at desc);

alter table public.bug_status_log enable row level security;

drop policy if exists "bug_status_log — admin select" on public.bug_status_log;
create policy "bug_status_log — admin select"
  on public.bug_status_log for select
  to authenticated
  using (public.is_admin());

-- Auto-log every status change on bug_reports.
create or replace function public.bug_reports_log_status_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.bug_status_log (bug_id, from_status, to_status, changed_by, note)
    values (new.id, null, new.status, new.user_id,
            'report filed via submit-bug-report');
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.bug_status_log (bug_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end$$;

drop trigger if exists bug_reports_log_status on public.bug_reports;
create trigger bug_reports_log_status
  after insert or update on public.bug_reports
  for each row execute function public.bug_reports_log_status_change();

-- Seed audit log with the current state of every existing row, so the
-- dashboard's activity feed isn't empty on day one.
insert into public.bug_status_log (bug_id, from_status, to_status, changed_at, note)
select id, null, status, coalesce(updated_at, created_at),
       'backfilled from migration 013'
  from public.bug_reports
 where not exists (
   select 1 from public.bug_status_log l where l.bug_id = bug_reports.id
 );


-- ── 5. Switch RLS on bug_reports from hardcoded UUID to is_admin() ────────
drop policy if exists "bug_reports — admin select" on public.bug_reports;
create policy "bug_reports — admin select"
  on public.bug_reports for select
  to authenticated
  using (public.is_admin());

drop policy if exists "bug_reports — admin update" on public.bug_reports;
create policy "bug_reports — admin update"
  on public.bug_reports for update
  to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- Storage bucket policy for screenshots — same cutover.
drop policy if exists "bug-screenshots — admin select" on storage.objects;
create policy "bug-screenshots — admin select"
  on storage.objects for select
  using (
    bucket_id = 'bug-screenshots'
    and public.is_admin()
  );


-- ── 6. Indexes for the admin dashboard ────────────────────────────────────
create index if not exists bug_reports_priority_idx     on public.bug_reports (priority);
create index if not exists bug_reports_complexity_idx   on public.bug_reports (complexity);
create index if not exists bug_reports_status_created_idx
  on public.bug_reports (status, created_at desc);


-- ── 7. Sanity check ────────────────────────────────────────────────────────
-- After running:
--   select status, count(*) from public.bug_reports group by status;
--   -- All rows should use the v2 vocab (new/triaged/.../verified_closed/...)
--
--   select count(*) from public.bug_status_log;
--   -- Should equal the row count in bug_reports (backfilled).
--
--   select polname, qual from pg_policies
--    where tablename='bug_reports' and polname like '%admin%';
--   -- qual should reference public.is_admin(), not the hardcoded uuid.
