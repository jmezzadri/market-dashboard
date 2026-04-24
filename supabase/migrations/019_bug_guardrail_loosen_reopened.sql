-- ============================================================================
-- Migration 019 — Loosen bug-workflow guardrail for reopened rows
-- ============================================================================
-- Why
-- ---
-- Migration 018 installed a BEFORE UPDATE trigger on bug_reports that
-- rejected any backward motion once `deployed_at` was stamped. That was
-- too strict: a row with status='reopened' needs to be able to re-enter
-- the pipeline (reopened → awaiting_approval → approved → merged →
-- deployed), otherwise the reopen is a dead-end.
--
-- Surfaced immediately after 018 deployed — #1019 was reopened with a
-- fresh A/B/C proposal, but trying to PATCH status='awaiting_approval'
-- hit the guardrail.
--
-- Fix: narrow the rejection rule to only block *direct* backward motion
-- from `deployed` or `verified_closed`. `reopened` is now treated as a
-- re-entry point — moves forward into any pipeline stage are allowed.
-- The "no overwriting fixed_pr/merged_pr post-deploy" half of the guard
-- is unchanged.
-- ============================================================================

create or replace function public.bug_reports_guard_transitions()
returns trigger language plpgsql as $$
declare
  pre_deploy_states  text[] := array['new','triaged','awaiting_approval','approved','merged'];
begin
  -- Reject DIRECT backward motion only from deployed or verified_closed.
  -- Reopened rows are allowed forward into the pipeline again.
  if old.status in ('deployed','verified_closed')
     and new.status is distinct from old.status
     and new.status = any (pre_deploy_states)
  then
    raise exception 'bug_reports guardrail: cannot move report #% from % directly to %. Use status=reopened first (with a note).',
      old.report_number, old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Reject overwriting fixed_pr / merged_pr after deploy — unchanged.
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

  return new;
end$$;

-- ── End of migration 019 ──────────────────────────────────────────────────
