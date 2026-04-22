-- ============================================================================
-- Migration 014 — Workflow timeline + auto-UAT classification
-- ============================================================================
-- Purpose
-- -------
-- Adds the columns the Admin · Bugs workflow timeline needs to render SLAs,
-- approval conditions, blocker chains, and the auto-UAT classification
-- emitted by the triage agent.
--
-- The timeline UI (src/components/WorkflowTimeline.jsx) reads these columns
-- directly; denormalizing triaged_at / awaiting_approval_at rather than
-- deriving them from bug_status_log keeps the UI fast without a join.
--
-- New columns
-- -----------
--   approval_notes        text  — Joe's optional feedback when approving a
--                                 proposed fix ("Feedback / conditions").
--                                 Rendered on the Approved stage of the
--                                 timeline as a blockquote.
--
--   uat_mode              text  — 'auto' | 'manual'. Default 'manual'.
--                                 Triage agent classifies 'auto' only for
--                                 CSS-only / copy / simple-UI fixes at
--                                 complexity=L. Anything touching data,
--                                 schema, auth, scanner, or new behavior
--                                 stays 'manual' and waits for Joe.
--
--   auto_uat_checklist    text  — 1-3 bullet items the triage agent writes
--                                 for the Claude-in-Chrome UAT runner,
--                                 e.g. "Navigate to /#portopps on 430px
--                                 viewport, confirm KPI row wraps to 3x2".
--
--   auto_uat_attempted_at timestamptz — stamped when the auto-UAT runner
--                                       last tried. null = never tried.
--
--   auto_uat_failed       bool  — last auto-UAT attempt failed; timeline
--                                 surfaces a manual override + emails Joe.
--
--   blocked_by            uuid[] — array of bug_reports.id values that must
--                                  resolve before this bug can start. Used
--                                  by the MBI-10 → 11 → 12 chain.
--
--   triaged_at            timestamptz — backfilled trigger-maintained stamp
--                                       of when row entered 'triaged' state
--                                       (SLA clock for awaiting-approval).
--
--   awaiting_approval_at  timestamptz — when row entered awaiting_approval
--                                       (SLA clock for approval).
--
-- Trigger
-- -------
-- bug_reports_touch_lifecycle() fires on every status change and stamps the
-- matching *_at column. Same shape as the existing bug_reports_log_status
-- trigger in migration 013. Denormalized columns stay in sync automatically.
-- ============================================================================

-- ── 1. Columns ─────────────────────────────────────────────────────────────
alter table public.bug_reports
  add column if not exists approval_notes        text,
  add column if not exists uat_mode              text    not null default 'manual',
  add column if not exists auto_uat_checklist    text,
  add column if not exists auto_uat_attempted_at timestamptz,
  add column if not exists auto_uat_failed       boolean not null default false,
  add column if not exists blocked_by            uuid[],
  add column if not exists triaged_at            timestamptz,
  add column if not exists awaiting_approval_at  timestamptz;

-- CHECK constraint on uat_mode (create idempotently)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bug_reports_uat_mode_check'
  ) then
    alter table public.bug_reports
      add constraint bug_reports_uat_mode_check
      check (uat_mode in ('auto','manual'));
  end if;
end$$;

-- ── 2. Backfill lifecycle stamps from bug_status_log ───────────────────────
-- Rows that historically passed through 'triaged' or 'awaiting_approval' get
-- their timestamps pulled from the audit log written by migration 013.
update public.bug_reports b
   set triaged_at = l.changed_at
  from public.bug_status_log l
 where l.bug_id = b.id
   and l.to_status = 'triaged'
   and b.triaged_at is null
   and l.changed_at = (
     select min(changed_at) from public.bug_status_log
      where bug_id = b.id and to_status = 'triaged'
   );

update public.bug_reports b
   set awaiting_approval_at = l.changed_at
  from public.bug_status_log l
 where l.bug_id = b.id
   and l.to_status = 'awaiting_approval'
   and b.awaiting_approval_at is null
   and l.changed_at = (
     select min(changed_at) from public.bug_status_log
      where bug_id = b.id and to_status = 'awaiting_approval'
   );

-- ── 3. Trigger to keep lifecycle stamps in sync on future transitions ─────
create or replace function public.bug_reports_touch_lifecycle()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'triaged' and new.triaged_at is null then
      new.triaged_at := now();
    end if;
    if new.status = 'awaiting_approval' and new.awaiting_approval_at is null then
      new.awaiting_approval_at := now();
    end if;
    -- Reopening clears the closed-side timestamps so the SLA clock restarts.
    if new.status = 'reopened' then
      new.verified_at := null;
      new.auto_uat_attempted_at := null;
      new.auto_uat_failed := false;
    end if;
  end if;
  return new;
end$$;

drop trigger if exists bug_reports_touch_lifecycle_t on public.bug_reports;
create trigger bug_reports_touch_lifecycle_t
  before update on public.bug_reports
  for each row execute function public.bug_reports_touch_lifecycle();

-- ── 4. Helpful indexes for the timeline UI ────────────────────────────────
-- /#bugs queries heavily on status + awaiting_approval_at (sort by oldest
-- waiting). blocked_by GIN index supports the blocker-chain render.
create index if not exists bug_reports_awaiting_approval_at_idx
  on public.bug_reports (awaiting_approval_at)
  where status = 'awaiting_approval';

create index if not exists bug_reports_triaged_at_idx
  on public.bug_reports (triaged_at)
  where status in ('triaged','awaiting_approval');

create index if not exists bug_reports_uat_mode_deployed_idx
  on public.bug_reports (uat_mode, status)
  where status = 'deployed';

create index if not exists bug_reports_blocked_by_gin_idx
  on public.bug_reports using gin (blocked_by);

-- ── 5. Sanity checks ──────────────────────────────────────────────────────
-- After running:
--   select count(*) filter (where triaged_at is null and status <> 'new') from public.bug_reports;
--   -- Should be 0 for rows that actually went through triaged.
--
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_name = 'bug_reports'
--      and column_name in ('approval_notes','uat_mode','auto_uat_checklist',
--                          'auto_uat_attempted_at','auto_uat_failed','blocked_by',
--                          'triaged_at','awaiting_approval_at');
--   -- Should show all 8 new columns.
--
--   select conname from pg_constraint where conname = 'bug_reports_uat_mode_check';
--   -- Should return 1 row.
