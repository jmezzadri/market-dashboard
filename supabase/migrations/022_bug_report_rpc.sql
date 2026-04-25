-- ============================================================================
-- Migration 022 — submit_bug_report RPC + RLS triage record
-- ============================================================================
-- Why
-- ---
-- 2026-04-25, a user (Joe) hit "Submission failed: new row violates
-- row-level security policy for table bug_reports" while filing a chart
-- bug from macrotilt.com/#overview. Reproduced from anon REST + from a
-- direct `SET LOCAL ROLE anon; INSERT ...` via the management SQL API.
--
-- Diagnostics that did NOT explain it:
--   • The single INSERT policy on bug_reports was permissive, applied to
--     PUBLIC, with WITH CHECK ((user_id IS NULL) OR (user_id = auth.uid()))
--     — should have passed for the (user_id IS NULL) anon path.
--   • Replaced WITH CHECK with literal `true` and explicit `to anon,
--     authenticated` roles. Still 42501.
--   • Repro on a freshly created test table with WITH CHECK (true) for
--     anon — also 42501. So the failure is NOT specific to bug_reports.
--   • Disabling RLS on the table allowed inserts. Re-enabling RLS
--     restored the failure.
--   • postgres event trigger `ensure_rls` (rls_auto_enable) auto-enables
--     RLS on every public-schema table created. Confirmed but doesn\'t
--     explain the WITH CHECK (true) denial.
--
-- Root cause TBD. Workaround: route the public Report-Bug form through a
-- SECURITY DEFINER RPC, which sidesteps RLS entirely. The function runs
-- as its owner (postgres, BYPASSRLS=true), validates inputs, and writes
-- user_id from auth.uid() so callers cannot spoof identity.
--
-- Original bug_reports insert policy is left in place (restored to the
-- v1 form with role targeting) so service-role / future direct inserts
-- still have a documented policy.
-- ============================================================================

-- Restore the original INSERT policy with explicit role targeting.
drop policy if exists "bug_reports — public insert" on public.bug_reports;
create policy "bug_reports — public insert"
  on public.bug_reports for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- The public submit RPC.
create or replace function public.submit_bug_report(
  p_reporter_email   text,
  p_description      text,
  p_title            text default null,
  p_url_hash         text default null,
  p_url_full         text default null,
  p_user_agent       text default null,
  p_viewport         text default null,
  p_build_sha        text default null,
  p_console_errors   jsonb default '[]'::jsonb,
  p_reporter_name    text default null
) returns table(id uuid, report_number bigint)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  new_id uuid;
  new_num bigint;
begin
  if p_reporter_email is null or length(trim(p_reporter_email)) = 0 then
    raise exception 'reporter_email is required';
  end if;
  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'description is required';
  end if;

  insert into public.bug_reports (
    user_id, reporter_email, reporter_name, title, description,
    url_hash, url_full, user_agent, viewport, build_sha, console_errors
  ) values (
    caller_uid,
    trim(p_reporter_email),
    p_reporter_name,
    nullif(trim(p_title), ''),
    trim(p_description),
    p_url_hash,
    p_url_full,
    p_user_agent,
    p_viewport,
    p_build_sha,
    coalesce(p_console_errors, '[]'::jsonb)
  )
  returning bug_reports.id, bug_reports.report_number into new_id, new_num;

  return query select new_id, new_num;
end$$;

grant execute on function public.submit_bug_report(text,text,text,text,text,text,text,text,jsonb,text)
  to anon, authenticated;

-- PostgREST cache reload — applied at apply-time, no-op in CI.
notify pgrst, 'reload schema';
