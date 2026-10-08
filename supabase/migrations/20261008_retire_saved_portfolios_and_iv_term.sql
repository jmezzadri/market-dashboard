-- 2026-10-08 (Joe: "delete"): the saved-portfolios page was retired outright
-- with the two implied-volatility feeds it alone read (killed_elements.json).
-- This removes what they still held in the database: both health rows, the
-- saved-portfolios table and the implied-vol term-structure cache. The backup
-- timer was already unscheduled the same day.

delete from public.pipeline_health where indicator_id in ('lse_atm_iv', 'lse_archive_iv');
drop table if exists public.portfolio_lab_portfolios cascade;
drop table if exists public.lse_iv_term cascade;
