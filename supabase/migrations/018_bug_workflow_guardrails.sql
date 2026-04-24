-- ============================================================================
-- Migration 018 — Bug-workflow guardrails
-- ============================================================================
-- Why
-- ---
-- Bug #1019 turned into a mess because three workflow holes stacked:
--   1. The reopen button shipped before the reopen-with-note textbox, so
--      Joe's 13:23 reopen on 2026-04-24 captured no repro detail.
--   2. PR #109 (manual-price revert + ingested_price column) landed against
--      #1019 even though that scope wasn't in the row's proposed_solution —
--      a second shipped fix for the same bug, inflating scope.
--   3. A triage sweep later the same day moved #1019 from 'reopened' all
--      the way back to 'triaged', erasing the fact that it had ALREADY
--      cleared the deployed stage.
--
-- This migration adds DB-level guardrails so those classes of mistakes
-- can't happen again regardless of which client / script writes to the
-- table. Three protections:
--
--   A. Reopen-note is mandatory — `bug_status_log` CHECK constraint
--      rejects to_status='reopened' rows with null / empty note.
--   B. Status-transition sanity — BEFORE UPDATE trigger on `bug_reports`
--      refuses to move a row backwards in the lifecycle (to 'triaged' /
--      'new' / 'awaiting_approval' after deployed_at is stamped, or
--      to 'approved' / 'merged' / 'deployed' from a terminal closed state).
--      Forward motion and the legitimate 'deployed → reopened' /
--      'verified_closed → reopened' paths stay allowed.
--   C. One-fix-per-deploy — same trigger rejects re-writing fixed_pr /
--      merged_pr after deployed_at is stamped. A second fix for the
--      same report must file as a new bug number.
--
-- Plus one helper — RPC `reopen_bug(bug_id, note)` — so callers can do
-- the UPDATE + log-row-with-note in a single atomic step that honors the
-- new CHECK. useBugActions.reopen() migrates to this RPC in the same PR.
-- ============================================================================

-- ── A. Reopen-note CHECK on bug_status_log ────────────────────────────────
-- Remove the existing unconditional trigger insert for reopened transitions
-- first (otherwise the CHECK would fire on the trigger's null-note row).
-- Replace the trigger body so it skips reopened transitions entirely —
-- those rows are written by the reopen_bug RPC below, which includes the
-- note inline.
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
    -- Skip 'reopened' — the reopen_bug RPC handles its own log row so the
    -- note can be written inline (required by the new CHECK constraint).
    if new.status = 'reopened' then
      return new;
    end if;
    insert into public.bug_status_log (bug_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end$$;

-- Now install the CHECK. It's declared NOT VALID first so any pre-existing
-- rows don't block creation, then validated separately.
alter table public.bug_status_log
  drop constraint if exists bug_status_log_reopen_requires_note;

alter table public.bug_status_log
  add constraint bug_status_log_reopen_requires_note
  check (to_status <> 'reopened' or (note is not null and length(trim(note)) > 0))
  not valid;

-- Backfill a placeholder note on any historical null-note reopen rows so we
-- can mark the constraint VALID (future rows must have a real note).
update public.bug_status_log
   set note = '(reopened before note-requirement shipped; repro not captured)'
 where to_status = 'reopened'
   and (note is null or length(trim(note)) = 0);

alter table public.bug_status_log
  validate constraint bug_status_log_reopen_requires_note;

-- ── B + C. Status-transition + one-fix-per-deploy guard ───────────────────
-- BEFORE UPDATE trigger. Rejects:
--   - rolling back from deployed / verified_closed / reopened to any
--     pre-deploy stage (new / triaged / awaiting_approval / approved /
--     merged). Use 'reopened' if the fix didn't work; don't time-travel.
--   - overwriting fixed_pr / merged_pr after deployed_at is set — a second
--     shipped fix needs a new bug number.
create or replace function public.bug_reports_guard_transitions()
returns trigger language plpgsql as $$
declare
  pre_deploy_states  text[] := array['new','triaged','awaiting_approval','approved','merged'];
  post_deploy_states text[] := array['deployed','verified_closed','reopened'];
begin
  -- Reject backward motion once deployed_at is stamped.
  if old.deployed_at is not null
     and new.status is distinct from old.status
     and new.status = any (pre_deploy_states)
  then
    raise exception 'bug_reports guardrail: cannot move report #% back to % after it reached deployed (%). Use status=reopened (with a note) or keep current status.',
      old.report_number, new.status, old.deployed_at
      using errcode = 'check_violation';
  end if;

  -- Reject re-stamping fixed_pr / merged_pr after deployed. A second fix
  -- needs a fresh bug number so the audit trail stays clean.
  if old.deployed_at is not null
     and (
       (new.fixed_pr is distinct from old.fixed_pr and old.fixed_pr is not null)
       or
       (new.merged_pr is distinct from old.merged_pr and old.merged_pr is not null)
     )
  then
    raise exception 'bug_reports guardrail: cannot overwrite fixed_pr/merged_pr on report #% after deploy. File a new bug for the follow-up fix.',
      old.report_number
      using errcode = 'check_violation';
  end if;

  -- Sanity: if status is one of the post-deploy states but deployed_at is
  -- somehow null, allow the UPDATE but don't let it re-transition back to
  -- a pre-deploy state — catches the rare case of a manual fix-up.
  if old.status = any (post_deploy_states)
     and new.status is distinct from old.status
     and new.status = any (pre_deploy_states)
  then
    raise exception 'bug_reports guardrail: cannot move report #% from % back to %. Use reopened.',
      old.report_number, old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end$$;

drop trigger if exists bug_reports_guard_transitions on public.bug_reports;
create trigger bug_reports_guard_transitions
  before update on public.bug_reports
  for each row execute function public.bug_reports_guard_transitions();

-- ── RPC: reopen_bug(bug_id, note) ─────────────────────────────────────────
-- Atomic reopen path: validates the note, updates bug_reports.status →
-- 'reopened', inserts the bug_status_log row with the note inline so the
-- CHECK from section A is satisfied.
create or replace function public.reopen_bug(p_bug_id uuid, p_note text)
returns public.bug_reports
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_note     text := coalesce(trim(p_note), '');
  v_prev     text;
  v_row      public.bug_reports;
begin
  if length(v_note) = 0 then
    raise exception 'reopen_bug: note is required (length > 0). Tell the fix-builder what is still broken.'
      using errcode = 'check_violation';
  end if;

  -- Current status (for the audit log from_status).
  select status into v_prev from public.bug_reports where id = p_bug_id for update;
  if v_prev is null then
    raise exception 'reopen_bug: no bug_reports row with id %', p_bug_id
      using errcode = 'no_data_found';
  end if;

  -- Update status (trigger B will log auth.uid() but skip the log-row
  -- insert for reopened so we can write it with the note ourselves).
  update public.bug_reports
     set status = 'reopened'
   where id = p_bug_id
   returning * into v_row;

  insert into public.bug_status_log (bug_id, from_status, to_status, changed_by, note)
  values (p_bug_id, v_prev, 'reopened', auth.uid(), v_note);

  return v_row;
end$$;

grant execute on function public.reopen_bug(uuid, text) to authenticated;

-- ── End of migration 018 ──────────────────────────────────────────────────
