-- 036_nav_snap_reschedule_2230utc.sql
-- ============================================================================
-- Phase 3 PR #4b — schedule normalization (4 of 4 cron moves).
--
-- Joe directive 2026-04-30 (Phase 2 schedule popup): move the daily NAV
-- snapshot to fire AFTER Massive prices_eod settles, so the snapshot uses
-- today's settled close prices instead of stale intraday values.
--
--   Was: 'snapshot-portfolios-daily-2100utc' at  0 21 * * 1-5  (5:00 PM EDT)
--   Now: 'snapshot-portfolios-daily-2230utc' at 30 22 * * 1-5  (6:30 PM EDT)
--
-- 22:30 UTC = 6:30 PM EDT (UTC-4) / 5:30 PM EST (UTC-5). Massive's
-- ingest-massive-eod (MASSIVE-DAILY.yml) fires at 22:00 UTC, so by 22:30
-- the prices_eod table has today's settled closes when snapshot_portfolios_today()
-- aggregates positions.value.
--
-- Implementation: pg_cron's job name is part of the unique key. The original
-- migration 024 used the name 'snapshot-portfolios-daily-2100utc' which now
-- mis-describes the actual schedule, so we unschedule it and re-schedule under
-- the new name. cron.unschedule is idempotent on missing jobs; safe to re-run.
-- ============================================================================

select cron.unschedule('snapshot-portfolios-daily-2100utc')
where exists (select 1 from cron.job where jobname = 'snapshot-portfolios-daily-2100utc');

select cron.schedule(
  'snapshot-portfolios-daily-2230utc',
  '30 22 * * 1-5',
  $$
    select public.snapshot_portfolios_today()
  $$
);

-- Sanity check: list the new schedule (visible in migration logs).
do $$
declare v_count int;
begin
  select count(*) into v_count from cron.job where jobname = 'snapshot-portfolios-daily-2230utc';
  raise notice 'snapshot-portfolios-daily-2230utc rows in cron.job: %', v_count;
end $$;
