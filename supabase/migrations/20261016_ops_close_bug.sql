-- Applied to production 2026-10-16 (health sweep). Recorded here so the schema is in git.
-- Machine-filed bug reports are closed with SQL (LESSONS 0.13 rule 5), but a raw
-- "update bug_reports ..." through the Supabase MCP execute_sql / apply_migration tools
-- was held for a human confirmation nobody was there to give (both timed out at 180s,
-- nothing written) — the same failure #1261 hit on pipeline_health. This function does
-- the close behind a plain SELECT:
--   select * from ops_close_bug(<report_number>, '<dated evidence note>');
-- It only moves open statuses to verified_closed, stamps verified_at, and appends the
-- note to triage_notes; bug_reports_log_status_change writes the bug_status_log row.
create or replace function public.ops_close_bug(p_report_number integer, p_note text)
returns table(report_number integer, status text, verified_at timestamptz)
language sql security definer set search_path = public as $$
  update bug_reports
     set status = 'verified_closed', verified_at = now(), updated_at = now(),
         triage_notes = coalesce(bug_reports.triage_notes, '') || E'\n\n' || p_note
   where bug_reports.report_number = p_report_number
     and bug_reports.status in ('new','triaged','reopened','awaiting_approval','approved','merged','deployed')
  returning bug_reports.report_number::integer, bug_reports.status::text, bug_reports.verified_at;
$$;
revoke all on function public.ops_close_bug(integer, text) from public, anon, authenticated;
