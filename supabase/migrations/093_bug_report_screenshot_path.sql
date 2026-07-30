-- ============================================================================
-- Migration 093 — submit_bug_report accepts the screenshot path
-- ============================================================================
-- Why
-- ---
-- 2026-07-30. The Report-a-bug widget shipped today. The reporter's screenshot
-- is uploaded to the private `bug-screenshots` bucket by the browser BEFORE the
-- row is written (the client mints the folder id, so no round-trip is needed),
-- and the resulting object path has to land on the row in the same call.
--
-- It cannot be written afterwards: RLS on bug_reports grants UPDATE to admins
-- only (013 §5), so a reporter patching their own row would 42501. And the row
-- insert itself has to stay inside the SECURITY DEFINER RPC (see 022 — a direct
-- anon INSERT reproducibly fails RLS for reasons still unexplained).
--
-- So: one extra parameter on the RPC. The old 10-argument signature is DROPPED
-- rather than left in place — an added defaulted parameter would make the two
-- overloads ambiguous for any 10-argument PostgREST call.
--
-- The path is validated, not trusted: it must look like `<uuid>/<file>.png|jpg`
-- and is stored verbatim otherwise. Reading it still requires admin (the bucket
-- is private and the admin page mints a 5-minute signed URL).
-- ============================================================================

drop function if exists public.submit_bug_report(text,text,text,text,text,text,text,text,jsonb,text);

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
  p_reporter_name    text default null,
  p_screenshot_path  text default null
) returns table(id uuid, report_number bigint)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  clean_shot text := nullif(trim(coalesce(p_screenshot_path, '')), '');
  new_id uuid;
  new_num bigint;
begin
  if p_reporter_email is null or length(trim(p_reporter_email)) = 0 then
    raise exception 'reporter_email is required';
  end if;
  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'description is required';
  end if;

  -- Shape check only. A malformed path is dropped rather than raised: a bad
  -- screenshot must never cost us the bug report itself.
  if clean_shot is not null
     and clean_shot !~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp)$' then
    clean_shot := null;
  end if;

  insert into public.bug_reports (
    user_id, reporter_email, reporter_name, title, description,
    url_hash, url_full, user_agent, viewport, build_sha, console_errors,
    screenshot_path
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
    nullif(trim(coalesce(p_build_sha, '')), ''),
    coalesce(p_console_errors, '[]'::jsonb),
    clean_shot
  )
  returning bug_reports.id, bug_reports.report_number into new_id, new_num;

  return query select new_id, new_num;
end$$;

grant execute on function public.submit_bug_report(text,text,text,text,text,text,text,text,jsonb,text,text)
  to anon, authenticated;

-- PostgREST cache reload — applied at apply-time, no-op in CI.
notify pgrst, 'reload schema';
