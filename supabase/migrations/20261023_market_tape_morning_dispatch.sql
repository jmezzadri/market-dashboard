-- Market-tape morning dispatch (2026-10-23, health sweep, bug #1274, third
-- pre-open in a row with the Nikkei tile one session behind).
--
-- WHY
-- ---
-- MARKET-INDICATORS-EOD is what lands Tokyo's close on the home-page tape.
-- Its morning passes are GitHub crons (06:45Z and 09:30Z Tue-Sat), and this
-- repo's GitHub crons start 2-7 hours after the schedule line, every cron,
-- every day (LESSONS 4.41). On 2026-10-23 the 06:45Z cron had not fired by
-- 11:20Z; on 10-21 and 10-22 the 09:30Z cron fired after the US open. Each
-- morning the sweep dispatched the workflow by hand to heal the tile.
-- A GitHub-cron backup for a GitHub-cron primary is not redundancy
-- (LESSONS 5.2), so the pre-open pass now rides pg_cron and dispatches the
-- workflow over the GitHub API — the same net.http_post + github_dispatch PAT
-- path qt_backup_dispatch() has used daily since 2026-09-01. A workflow_dispatch
-- starts within seconds; only `schedule:` events are delayed.
--
-- GUARD
-- -----
-- Dispatch only when the data says Tokyo's finished session is not on the
-- site yet: pipeline_health.n225_index.data_as_of (re-stamped from the points
-- actually published, LESSONS 4.36) is older than today's date in Asia/Tokyo.
-- On a Tokyo holiday the guard stays true and the fetcher runs anyway — it
-- merges and commits only if the file changed, so the cost is one idle run,
-- and the log says "not needed" versus "dispatched" (LESSONS 5.7).
--
-- SCHEDULE
-- --------
-- Tokyo's regular session ends 15:30 JST = 06:30 UTC (no DST in Japan). The
-- first attempt is 06:40Z, after the close; the second at 08:40Z is the
-- retry if the vendor had not served the close yet. Both Tue-Sat because the
-- Friday session lands on Saturday morning UTC — harmless, idempotent.
-- The GitHub cron lines in MARKET-INDICATORS-EOD.yml stay as they are: when
-- they do fire, the fetcher merges the same file.
--
-- Applied to production via MCP on 2026-10-23; this file is the record.

create or replace function market_tape_morning_dispatch() returns text
language plpgsql security definer set search_path = public as $$
declare
  pat text;
  tokyo_today date := (now() at time zone 'Asia/Tokyo')::date;
  site_asof date;
begin
  select data_as_of::date into site_asof
    from pipeline_health where indicator_id = 'n225_index';

  if site_asof is not null and site_asof >= tokyo_today then
    return format('not needed: n225_index already at %s', site_asof);
  end if;

  select value into pat from ops_secrets where name = 'github_dispatch';
  if pat is null then
    raise warning 'market_tape_morning_dispatch: github_dispatch PAT missing from ops_secrets';
    return 'skipped: github_dispatch PAT missing';
  end if;

  perform net.http_post(
    url := 'https://api.github.com/repos/jmezzadri/market-dashboard/actions/workflows/'
           || 'MARKET-INDICATORS-EOD.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || pat,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'macrotilt-market-tape-morning',
      'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main')
  );
  return format('dispatched MARKET-INDICATORS-EOD: n225_index at %s, Tokyo today %s',
                coalesce(site_asof::text, 'none'), tokyo_today);
end $$;

select cron.unschedule(jobname) from cron.job
 where jobname in ('market-tape-morning-0640utc', 'market-tape-morning-0840utc');
select cron.schedule('market-tape-morning-0640utc', '40 6 * * 2-6', $$select market_tape_morning_dispatch()$$);
select cron.schedule('market-tape-morning-0840utc', '40 8 * * 2-6', $$select market_tape_morning_dispatch()$$);
