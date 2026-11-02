-- 20261102_prices_eod_autovacuum.sql  (health sweep, 2026-11-02)
--
-- POWER-TREND-LIST-MONTHLY failed both Nov 1 fires (and the second Oct 1 fire):
-- rpc power_trend_scan -> 57014 statement timeout (service_role cap 120s), so the
-- November Power Trend list never published (latest rebalance_date 2026-09-30).
--
-- Cause, read from pg_stat_user_tables at 11:08Z: prices_eod (6.3M rows, 1.2 GB)
-- had NEVER been autovacuumed or analyzed since the stats counters last reset
-- (last_autovacuum / last_autoanalyze null, n_dead_tup 398k, n_mod_since_analyze
-- 586k). With the default scale factor (0.2) the dead-tuple trigger is ~1.26M rows,
-- which the daily upserts take months to reach; meanwhile the visibility map goes
-- stale, so the date-index "index-only" scan inside strategy_bt_universe() did
-- 920,972 heap fetches. Measured: universe 45.7s before / 24.8s after a manual
-- VACUUM (ANALYZE); full power_trend_scan >120s (timeout) before / 74s after.
--
-- Fix: vacuum and analyze prices_eod on a ~1% change, not 20%, so the table never
-- again drifts months without maintenance. (Manual VACUUM (ANALYZE) already run
-- on production 2026-11-02 11:11Z; this makes it permanent.)

alter table public.prices_eod set (
  autovacuum_vacuum_scale_factor        = 0.01,
  autovacuum_vacuum_threshold           = 5000,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_vacuum_insert_threshold    = 5000,
  autovacuum_analyze_scale_factor       = 0.01,
  autovacuum_analyze_threshold          = 5000
);
