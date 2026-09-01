-- QT scheduled-run backup (2026-09-01). GitHub silently skips scheduled runs
-- of newly-(re)added workflows (repo LESSONS 4.13): it ate QT-REBALANCE's
-- 13:00 launch-morning fire, QT-EOD-DAILY's 8/28 and 8/31 close snapshots,
-- and QT-BRAKE-DAILY has never fired at all. A GitHub-cron backup for a
-- GitHub-cron primary is not redundancy (LESSONS 5.2), so the backup rides
-- pg_cron and dispatches the workflow over the GitHub API — the same
-- net.http_post + github_dispatch PAT path that saved the Sept 1 launch,
-- now automatic so October 1 depends on nobody being awake.
--
-- Every dispatch is guarded by the DATA the primary should have produced —
-- never by "did a run happen": if the close snapshot is stamped, the brake
-- row written, the month's book scored, the backup stays quiet. Duplicate
-- runs are safe anyway (EOD is a snapshot upsert; the brake enforces one
-- action per day internally; rebalance upserts on (rebalance_date,symbol))
-- but the guards keep the log honest. QT-PLACE-ORDERS is deliberately NOT
-- here: it is manual-dispatch-only with a typed GO by design.
-- If primary AND backup both fail, the existing pipeline-health watchdog is
-- the alarm: qt-nav-daily / qt-brake-state stay red and the alert email says
-- so in plain English.
--
-- Applied to production via MCP on 2026-09-01; this file is the record.
create or replace function qt_backup_dispatch(job text) returns void
language plpgsql security definer set search_path = public as $$
declare
  pat text;
  need boolean := false;
  wf text;
  today_et date := (now() at time zone 'America/New_York')::date;
begin
  if job = 'eod' then
    wf := 'QT-EOD-DAILY.yml';
    need := coalesce((select max(data_as_of) from pipeline_health
                      where indicator_id = 'qt-nav-daily'), '-infinity'::timestamptz)
            < now() - interval '70 minutes';
  elsif job = 'brake' then
    wf := 'QT-BRAKE-DAILY.yml';
    need := not exists (select 1 from qt_brake_state where d = today_et);
  elsif job = 'rebalance' then
    wf := 'QT-REBALANCE.yml';
    need := not exists (select 1 from qt_target_book
                        where rebalance_date >= date_trunc('month', today_et)::date);
  else
    raise exception 'qt_backup_dispatch: unknown job %', job;
  end if;

  if not need then return; end if;

  select value into pat from ops_secrets where name = 'github_dispatch';
  if pat is null then
    raise warning 'qt_backup_dispatch(%): github_dispatch PAT missing from ops_secrets', job;
    return;
  end if;

  perform net.http_post(
    url := 'https://api.github.com/repos/jmezzadri/market-dashboard/actions/workflows/'
           || wf || '/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || pat,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'macrotilt-qt-backup',
      'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main')
  );
end $$;

-- Primaries run at 21:10 / 21:25 UTC weekdays and 13:00 UTC on the 1st-4th;
-- each backup checks 30-45 minutes later, long enough for the primary to
-- finish stamping, same UTC anchoring so DST never splits them.
select cron.schedule('qt-backup-eod',       '40 21 * * 1-5', $$select qt_backup_dispatch('eod')$$);
select cron.schedule('qt-backup-brake',     '55 21 * * 1-5', $$select qt_backup_dispatch('brake')$$);
select cron.schedule('qt-backup-rebalance', '45 13 1-4 * *', $$select qt_backup_dispatch('rebalance')$$);
