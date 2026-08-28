-- 20260828_retire_quality_trend.sql
--
-- Quality Trend was retired by Joe on 2026-08-26 (superseded by
-- paper_portfolio/TACTICAL_BOOK_SPEC.md, which is design-only). Its producers
-- were deleted from .github/workflows/ in the same change. This migration
-- removes what the producers left behind in the database, per LESSONS 0.10
-- ("retired means deleted, everywhere, same change").
--
-- Two things were still running on 2026-08-28, five days after the retirement:
--
-- 1. `pipeline_health.qt-nav-daily` sat RED with the plain-English reason
--    "between broker accounts ... new book starts 2026-09-01" — a hold written
--    on 2026-08-26, one day before the strategy that hold was protecting got
--    retired. The site header therefore read "1 feed stale" on every page.
--    A watcher whose subject no longer exists is retired, not chased.
--
-- 2. The pg_cron job `qt-live-sync-10min` was still calling the qt-live-sync
--    edge function every ten minutes of every session, snapshotting a
--    replacement paper account (PA30FE66XZSD) that was funded to $1,000,000 on
--    8/26 for a relaunch that never happened and never held a share. Those rows
--    are valid and harmless in the table, but /paper showed the NEWEST account,
--    so they became "the book" — and with the page's hardcoded Aug-17 inception
--    and Aug-15 SPY baseline printed over them, /paper published "0.00% since
--    inception, +0.76% vs the S&P" for a strategy that had been retired two days
--    earlier and whose real record was -6.45%. The page fix is data-keyed (show
--    the newest epoch that ever HELD something); this is the other half — stop
--    manufacturing epochs nobody will ever trade.
--
-- Deliberately NOT deleted: qt_nav_daily, qt_target_book and qt_orders. /paper
-- renders the closed Aug 17 - Aug 25 2026 book from them as a finished record,
-- and a retired strategy's track record is not a zombie feed.

-- 1 ── deregister both Quality Trend feeds ---------------------------------
delete from public.pipeline_health
 where indicator_id in ('qt-nav-daily', 'qt-target-book');

-- 2 ── stop the intraday sync -----------------------------------------------
-- unschedule is not idempotent on a missing job, so guard it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'qt-live-sync-10min') then
    perform cron.unschedule('qt-live-sync-10min');
  end if;
end $$;
