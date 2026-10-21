-- 20261021_ops_bug_transition.sql
--
-- LESSONS 0.13 (2026-10-16 addendum): a raw `update bug_reports` from a cloud
-- sweep hangs in the MCP confirmation hold and writes nothing; closing goes
-- through ops_close_bug(). The same hold caught the 2026-10-21 sweep moving
-- #1274 to `deployed` (fix shipped and seen on the site, evening path not yet
-- observed in a scheduled run — honest status, not closed). This is the
-- general form: one SECURITY DEFINER function for every lifecycle step short
-- of verified_closed, stamping the matching columns and appending the dated
-- evidence to triage_notes. bug_status_log is written by the existing
-- trigger on the status change, as for every other transition.

create or replace function public.ops_bug_transition(
  p_report_number integer,
  p_status        text,
  p_note          text,
  p_pr            integer default null,
  p_sha           text    default null
)
returns table(report_number integer, status text, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_status not in ('triaged','awaiting_approval','approved','merged','deployed','reopened','wontfix') then
    raise exception 'ops_bug_transition: % is not a lifecycle status this function sets (use ops_close_bug for verified_closed)', p_status;
  end if;
  return query
  update bug_reports b
     set status          = p_status,
         updated_at      = now(),
         last_triaged_at = now(),
         triaged_at      = coalesce(b.triaged_at, now()),
         awaiting_approval_at = case when p_status = 'awaiting_approval' then now() else b.awaiting_approval_at end,
         approved_at     = case when p_status = 'approved' then now() else b.approved_at end,
         fixed_at        = case when p_status in ('merged','deployed') then coalesce(b.fixed_at, now()) else b.fixed_at end,
         fixed_pr        = case when p_status in ('merged','deployed') then coalesce(p_pr, b.fixed_pr) else b.fixed_pr end,
         fixed_sha       = case when p_status in ('merged','deployed') then coalesce(p_sha, b.fixed_sha) else b.fixed_sha end,
         merged_at       = case when p_status in ('merged','deployed') then coalesce(b.merged_at, now()) else b.merged_at end,
         merged_pr       = case when p_status in ('merged','deployed') then coalesce(p_pr, b.merged_pr) else b.merged_pr end,
         merged_sha      = case when p_status in ('merged','deployed') then coalesce(p_sha, b.merged_sha) else b.merged_sha end,
         deployed_at     = case when p_status = 'deployed' then now() else b.deployed_at end,
         deployed_sha    = case when p_status = 'deployed' then coalesce(p_sha, b.deployed_sha) else b.deployed_sha end,
         resolved_at     = case when p_status = 'wontfix' then now() else b.resolved_at end,
         triage_notes    = coalesce(b.triage_notes, '') || E'\n\n' || p_note
   where b.report_number = p_report_number
   returning b.report_number::integer, b.status::text, b.updated_at;
end;
$$;

revoke all on function public.ops_bug_transition(integer, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.ops_bug_transition(integer, text, text, integer, text) to service_role, postgres;

comment on function public.ops_bug_transition(integer, text, text, integer, text) is
  'Lifecycle step for a bug report short of verified_closed (LESSONS 0.13): sets status, stamps the matching *_at / *_pr / *_sha columns, appends dated evidence to triage_notes. Closing stays with ops_close_bug.';
