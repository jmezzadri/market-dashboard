-- Retire the RSI-divergence scan end to end (Joe 2026-10-13: the scanner
-- concept is dead; the ticker page was the scan's only reader and no longer
-- shows it). Drops the stored scans, the seven helper functions the daily job
-- and its one-off backtest called, and the feed's health row. See
-- killed_elements.json: equity-rsi_divergences-daily. LESSONS 0.10.
drop function if exists public.divergence_bars(date, text[], integer);
drop function if exists public.divergence_latest_complete_day(integer);
drop function if exists public.divergence_universe(date, integer, integer);
drop function if exists public.divergence_bt_day_floor(date);
drop function if exists public.divergence_bt_calendar(date, date, integer, integer);
drop function if exists public.divergence_bt_universe(date, integer, integer);
drop function if exists public.divergence_bt_bars(date, date, text[]);
drop table if exists public.divergence_scan;
delete from public.pipeline_health where indicator_id in ('rsi_divergences', 'equity-rsi_divergences-daily');
