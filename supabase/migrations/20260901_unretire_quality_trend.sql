-- 20260901_unretire_quality_trend.sql
--
-- Reverses the database half of 20260828_retire_quality_trend.sql. Joe
-- reversed the retirement itself on 2026-08-28 ("run it"): Quality Trend
-- relaunches 2026-09-01 as 20 names + the crash brake. The Friday relaunch PR
-- (#1584) restored the workflows but missed what the retirement migration had
-- removed HERE — found on launch eve when the intraday sync had silently
-- written nothing for two trading days and the site header counted the
-- re-registered feeds as untracked.
--
-- Applied to production 2026-08-31/09-01 evening; recorded for git. Idempotent.

-- 1 ── re-register the feeds, honestly 'unknown' until their producers stamp
insert into public.pipeline_health (indicator_id, label, source, cadence, expected_cadence_minutes, last_good_at, last_check_at, status, last_error)
values
 ('qt-target-book','Quality Trend · Target book','MacroTilt engine (QT-REBALANCE)','M',43200,
   (select max(created_at) from public.qt_target_book), now(), 'unknown',
   'Relaunch pending: the first 20-name book scores 2026-09-01 09:00 ET. The 2026-08-14 stamp is the retired 40-name strategy''s last write.'),
 ('qt-nav-daily','Quality Trend · Close snapshot','Alpaca paper (QT-EOD-DAILY + qt-live-sync)','D',1440,
   (select max(created_at) from public.qt_nav_daily), now(), 'unknown',
   'Relaunch pending: the book is between accounts until 2026-09-01; daily marks resume with the first fills.'),
 ('qt-brake-state','Quality Trend · Crash brake','MacroTilt engine (QT-BRAKE-DAILY)','D',1440,
   null, now(), 'unknown',
   'Armed, never evaluated: first daily reading 2026-09-01 17:25 ET.')
on conflict (indicator_id) do nothing;

-- 2 ── restart the intraday sync (auth: anon JWT satisfies the gateway,
--      x-qt-sync-key carries the real shared secret; see qt-live-sync/index.ts)
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'qt-live-sync-10min') then
    perform cron.schedule(
      'qt-live-sync-10min',
      '*/10 13-21 * * 1-5',
      $j$
      select net.http_post(
        url := 'https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/qt-live-sync',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxYXFxenNlZXBlYnJvY2dpYmN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NTk4NzEsImV4cCI6MjA5MjEzNTg3MX0.kFklzccOIgXQger8jKHnuH4m1I_CqVQytmVtqUST900',
          'x-qt-sync-key', (select decrypted_secret from vault.decrypted_secrets where name='qt_sync_key' limit 1)
        ),
        body := '{}'::jsonb
      );
      $j$
    );
  end if;
end $$;
