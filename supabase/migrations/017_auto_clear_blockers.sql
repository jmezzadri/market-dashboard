-- ============================================================================
-- Migration 017 — Auto-clear resolved blockers from downstream bug_reports
-- ============================================================================
-- Purpose
-- -------
-- When bug A transitions into a resolved state ('deployed' or
-- 'verified_closed'), every downstream bug B that has A.id in its
-- blocked_by array should automatically have A removed from that array.
-- Before this migration, blocked_by references were stale — the
-- 2026-04-23 #1020 / #1018 incident saw #1018 deploy to production while
-- #1020 continued to carry #1018's uuid in blocked_by, and the
-- Admin · Bugs timeline kept surfacing a triage note referencing the
-- already-shipped fix.
--
-- Scope
-- -----
-- 'deployed' fires the auto-clear. We do NOT wait for 'verified_closed'
-- because that requires manual UAT by Joe and would leave downstream
-- rows blocked through the whole UAT window — slowing the shipping
-- cadence for no real safety benefit (if the deploy is bad, the
-- downstream row would need to be re-triaged anyway, now against a new
-- baseline).
--
-- 'verified_closed' ALSO fires, as a safety net for rows that skipped
-- the deployed stage (e.g. closed as a duplicate of something that
-- unlocked them).
--
-- Side-branches ('wontfix', 'duplicate', 'needs_info') do NOT auto-clear
-- — those states mean "this bug isn't getting fixed", so its downstream
-- dependants need a human to decide whether to drop the dependency or
-- go find an alternate fix. The DesyncChip + BlockerBanner in the UI
-- surface them.
--
-- Audit
-- -----
-- Every cleared reference writes an advisory row into bug_status_log
-- with to_status = old status (no real transition happens on B) and a
-- descriptive note. Keeps the activity feed honest.
-- ============================================================================

create or replace function public.bug_reports_auto_clear_blockers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  downstream record;
  newly_cleared uuid[];
begin
  -- Only fire on status transitions INTO 'deployed' or 'verified_closed'.
  if tg_op <> 'UPDATE' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('deployed', 'verified_closed') then return new; end if;

  -- Find every row still pointing at the resolved bug.
  for downstream in
    select id, report_number, status, blocked_by
      from public.bug_reports
     where new.id = any(blocked_by)
  loop
    -- array_remove returns a new array; null if the array is now empty.
    newly_cleared := array_remove(downstream.blocked_by, new.id);
    if array_length(newly_cleared, 1) is null then
      newly_cleared := null;  -- normalise empty-array → null for a cleaner UI
    end if;

    update public.bug_reports
       set blocked_by = newly_cleared
     where id = downstream.id;

    -- Advisory log entry. from_status == to_status (no real transition on B).
    insert into public.bug_status_log (bug_id, from_status, to_status, note)
    values (
      downstream.id,
      downstream.status,
      downstream.status,
      format(
        'Blocker #%s reached %s — removed from blocked_by automatically by migration 017 trigger.',
        new.report_number,
        new.status
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists bug_reports_auto_clear_blockers_t on public.bug_reports;
create trigger bug_reports_auto_clear_blockers_t
  after update on public.bug_reports
  for each row execute function public.bug_reports_auto_clear_blockers();

-- ── Backfill: sweep any currently-stale blocked_by references ─────────────
-- Runs once at migration time. Mirrors the trigger logic so operators
-- don't have to manually reconcile every pre-existing row.
do $$
declare
  resolved record;
  downstream record;
  newly_cleared uuid[];
begin
  for resolved in
    select id, report_number, status
      from public.bug_reports
     where status in ('deployed', 'verified_closed')
  loop
    for downstream in
      select id, report_number, status, blocked_by
        from public.bug_reports
       where resolved.id = any(blocked_by)
    loop
      newly_cleared := array_remove(downstream.blocked_by, resolved.id);
      if array_length(newly_cleared, 1) is null then
        newly_cleared := null;
      end if;
      update public.bug_reports
         set blocked_by = newly_cleared
       where id = downstream.id;

      insert into public.bug_status_log (bug_id, from_status, to_status, note)
      values (
        downstream.id,
        downstream.status,
        downstream.status,
        format(
          'Backfill (mig 017): blocker #%s was already in %s — removed from blocked_by.',
          resolved.report_number,
          resolved.status
        )
      );
    end loop;
  end loop;
end$$;

-- ── Sanity checks ──────────────────────────────────────────────────────────
-- After running:
--   select count(*) from public.bug_reports
--    where blocked_by is not null
--      and exists (
--        select 1 from unnest(blocked_by) as b(id)
--         join public.bug_reports r on r.id = b.id
--         where r.status in ('deployed','verified_closed')
--      );
--   -- Should be 0. If >0, the trigger / backfill missed something.
--
--   select count(*) from pg_trigger where tgname = 'bug_reports_auto_clear_blockers_t';
--   -- Should return 1.
