-- 096 — Retire the UNIVERSE_SNAPSHOT_3X_WEEKDAYS backup cron jobs (2026-08-25)
--
-- UNIVERSE_SNAPSHOT_3X_WEEKDAYS was disabled on 2026-08-14: the Unusual Whales
-- subscription lapsed on 2026-08-12 and that workflow calls the UW screener, so
-- it can never succeed again. The workflow's own schedule was removed at the
-- time, but its six pg_cron backup dispatchers were missed and kept firing every
-- weekday, each one starting a guaranteed-red run.
--
-- This is the same treatment already applied to the conviction and paper-intraday
-- backups when automated trading was halted: the job definition is kept but made
-- inactive, so it can be re-armed in one statement if the subscription ever comes
-- back. Nothing here drops data or changes a schema.
--
-- The other half of this retirement (removing universe_snapshots from
-- PIPELINE-FRESHNESS-WATCHDOG, which was re-dispatching the same dead workflow
-- every ten minutes) ships in the same change.

do $$
declare j record;
begin
  for j in
    select jobid, jobname from cron.job
     where jobname like 'universe-snapshot-backup-%' and active
  loop
    perform cron.alter_job(job_id := j.jobid, active := false);
    raise notice 'deactivated %', j.jobname;
  end loop;
end $$;
