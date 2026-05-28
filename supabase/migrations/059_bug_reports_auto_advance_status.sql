-- ============================================================================
-- Migration 059 — Auto-advance bug_reports.status when lifecycle stamps land
-- ============================================================================
-- Why
-- ---
-- The bot (and humans) write the lifecycle stamps (merged_at, deployed_at,
-- verified_at) directly via PostgREST without also updating status. Result:
-- status='approved' rows with merged_sha set and deployed_sha set for 30+
-- days (see the 2026-05-27 sweep of #1079, #1098, #1157, #1194, #1195, #1202).
--
-- The 018 guardrail trigger correctly blocks BACKWARD motion. This migration
-- adds the missing FORWARD motion: when a higher-water-mark stamp lands,
-- status auto-promotes to match. Forward-only — never overrides a status
-- that's already further along.
--
-- Promotion chain (each fires only when status is at the prior step or
-- earlier, never demotes):
--   merged_at    null → set  ⇒  status approved        → merged
--   deployed_at  null → set  ⇒  status merged/approved → deployed
--   verified_at  null → set  ⇒  status deployed/merged/approved → verified_closed
--
-- The trigger name starts with "advance" which is alphabetically BEFORE
-- "guard_transitions" (018), so PostgreSQL fires this one first. The new
-- forward status mutation then passes through the guardrail without issue
-- (guardrail only blocks backward motion).
-- ============================================================================

create or replace function public.bug_reports_advance_status()
returns trigger language plpgsql as $$
begin
  -- 1) verified_at set ⇒ promote anything pre-verified to verified_closed.
  if new.verified_at is not null
     and old.verified_at is null
     and new.status in ('approved','merged','deployed')
  then
    new.status := 'verified_closed';
  end if;

  -- 2) deployed_at set ⇒ promote approved/merged to deployed.
  if new.deployed_at is not null
     and old.deployed_at is null
     and new.status in ('approved','merged')
  then
    new.status := 'deployed';
  end if;

  -- 3) merged_at set ⇒ promote approved to merged.
  if new.merged_at is not null
     and old.merged_at is null
     and new.status = 'approved'
  then
    new.status := 'merged';
  end if;

  return new;
end$$;

drop trigger if exists bug_reports_advance_status on public.bug_reports;
create trigger bug_reports_advance_status
  before update on public.bug_reports
  for each row execute function public.bug_reports_advance_status();

-- End of migration 059
