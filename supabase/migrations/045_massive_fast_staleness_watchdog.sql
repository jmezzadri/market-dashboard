-- ============================================================================
-- 045_massive_fast_staleness_watchdog.sql — fast-staleness alarm + auto re-dispatch
-- ============================================================================
-- Joe directive 2026-05-04 evening. The existing freshness alarm is the
-- 7-day-stuck-red rule (mig 041). That's too slow to catch a single
-- dropped GitHub schedule the same evening. The May 4 incident: GitHub
-- silently dropped the 22:00 UTC fire window for MASSIVE-DAILY; no other
-- alarm fired; Joe noticed the staleness himself when comparing his
-- Portfolio Insights tile against his Chase brokerage 4 hours later.
--
-- This watchdog runs on Supabase pg_cron every 30 minutes during weekday
-- business hours (US Mon-Fri 19:00-04:00 UTC, which covers 15:00 ET → 23:00
-- ET — i.e. just after market close through last cron backup window). For
-- each massive-* pipeline:
--   1. Read its last_run_at from pipeline_runs.
--   2. If older than 6 hours AND the workflow has not been auto-re-dispatched
--      in the last 6 hours, call GitHub's workflow_dispatch endpoint.
--   3. Insert a row into massive_watchdog_dispatches so the next loop iteration
--      knows we already nudged.
--   4. Also write a notification to bug_reports if 3+ consecutive dispatch
--      attempts happen without a successful run (i.e. the dispatch worked but
--      the workflow keeps failing).
--
-- Requires: pg_cron extension, pg_net extension (for outbound HTTP calls
-- from the database). Both are available on Supabase by default.
--
-- Setup steps NOT in this file:
--   - Set GITHUB_PAT secret in vault.secrets so the watchdog can call the
--     GitHub API. The PAT needs `actions:write` scope on the repo.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Track every dispatch the watchdog makes so we don't spam GitHub
create table if not exists public.massive_watchdog_dispatches (
  id              bigserial primary key,
  pipeline_name   text not null,
  dispatched_at   timestamptz not null default now(),
  http_status     int,
  http_response   text,
  notes           text
);

create index if not exists massive_watchdog_dispatches_pipeline_idx
  on public.massive_watchdog_dispatches (pipeline_name, dispatched_at desc);

-- The watchdog procedure
create or replace function public.massive_fast_staleness_watchdog()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_now             timestamptz := now();
  v_pipeline        text;
  v_last_run        timestamptz;
  v_last_dispatch   timestamptz;
  v_dispatch_resp   record;
  v_consecutive_fails int;
  v_pat             text;
  v_payload         jsonb;
begin
  -- Only operate on weekdays (Mon=1 ... Sun=7). 1-5 is Mon-Fri.
  if extract(isodow from v_now at time zone 'UTC') > 5 then
    return;
  end if;

  for v_pipeline in
    select unnest(array['massive-eod', 'massive-universe', 'massive-corporate-actions'])
  loop
    select last_run_at into v_last_run
      from public.pipeline_runs
      where pipeline_name = v_pipeline;
    if v_last_run is null then
      continue;
    end if;
    if v_now - v_last_run < interval '6 hours' then
      continue;
    end if;
    -- last_run > 6h ago — check whether we already dispatched in the last 6h
    select max(dispatched_at) into v_last_dispatch
      from public.massive_watchdog_dispatches
      where pipeline_name = v_pipeline;
    if v_last_dispatch is not null and v_now - v_last_dispatch < interval '6 hours' then
      continue;
    end if;

    -- Read the GitHub PAT from vault (set up via Dashboard -> Project Settings -> Vault)
    select decrypted_secret into v_pat
      from vault.decrypted_secrets
      where name = 'GITHUB_PAT_FOR_WATCHDOG'
      limit 1;
    if v_pat is null then
      raise notice 'massive_fast_staleness_watchdog: no GITHUB_PAT_FOR_WATCHDOG in vault — skipping dispatch';
      return;
    end if;

    -- Dispatch the MASSIVE-DAILY workflow on main
    select status, content
      into v_dispatch_resp
      from net.http_post(
        url := 'https://api.github.com/repos/jmezzadri/market-dashboard/actions/workflows/MASSIVE-DAILY.yml/dispatches',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_pat,
          'Accept', 'application/vnd.github+json',
          'Content-Type', 'application/json',
          'User-Agent', 'macrotilt-watchdog/1.0'
        ),
        body := '{"ref":"main"}'::jsonb,
        timeout_milliseconds := 10000
      );

    insert into public.massive_watchdog_dispatches (pipeline_name, http_status, http_response, notes)
    values (v_pipeline, v_dispatch_resp.status, left(coalesce(v_dispatch_resp.content::text, ''), 500),
            'Auto-dispatched after detecting last_run_at > 6h ago (' || v_last_run::text || ')');

    -- File a bug if 3+ consecutive dispatches without a successful run
    select count(*) into v_consecutive_fails
      from public.massive_watchdog_dispatches
      where pipeline_name = v_pipeline
        and dispatched_at > coalesce(v_last_run, '1970-01-01'::timestamptz);
    if v_consecutive_fails >= 3 then
      insert into public.bug_reports (
        reporter_email, title, description, url_full, status, priority
      ) values (
        'massive-watchdog@macrotilt.local',
        'MASSIVE pipeline ' || v_pipeline || ' has been re-dispatched ' || v_consecutive_fails || ' times without success',
        'The fast-staleness watchdog (mig 045) has auto-dispatched ' || v_pipeline ||
        ' workflow ' || v_consecutive_fails || ' times since the last successful run at ' ||
        v_last_run::text || '. Each dispatch either failed, crashed, or did not complete. ' ||
        'Manual investigation needed — likely a vendor outage or persistent bug in the script.',
        'https://github.com/jmezzadri/market-dashboard/actions/workflows/MASSIVE-DAILY.yml',
        'new', 'P0'
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.massive_fast_staleness_watchdog() to service_role;

-- Schedule pg_cron to run the watchdog every 30 min Mon-Fri 19:00-04:00 UTC
-- (covers 15:00 ET market hours through 23:00 ET last cron backup window).
-- pg_cron uses standard 5-field cron in UTC.
select cron.schedule(
  'massive-fast-staleness-watchdog',
  '*/30 19-23,0-4 * * 1-5',
  $$ select public.massive_fast_staleness_watchdog(); $$
);

comment on function public.massive_fast_staleness_watchdog is
  'v1 (2026-05-04, mig 045). Every 30 min Mon-Fri 19:00-04:00 UTC, checks each massive-* row in pipeline_runs. If last_run_at > 6h ago AND no dispatch in last 6h, auto-dispatches MASSIVE-DAILY workflow via GitHub API. Files a P0 bug if 3+ consecutive dispatches without a successful run. Catches dropped GitHub schedules within hours instead of waiting for Joe to notice.';
