-- 2026-11-12 — a fourth stored health state, 'skipped': the producer ran inside its window, recorded
-- why it published nothing, and its content is therefore older than its normal budget. The site has
-- drawn this state since 2026-10-02 (freshnessClock.isDeliberateSkip); the stored column could only
-- say red, so the row for the Trade Idea notes read red for a fortnight while every page said
-- "All feeds current". pipeline-health-check and the six-hourly reconciler now write 'skipped' on the
-- same rule (a skip stamp newer than 1.5x the row's cadence, no error). Widening only: no row changes.
alter table public.pipeline_health drop constraint if exists pipeline_health_status_check;
alter table public.pipeline_health add constraint pipeline_health_status_check
  check (status = any (array['green','amber','red','unknown','skipped']));
alter table public.pipeline_health drop constraint if exists pipeline_health_prev_status_check;
alter table public.pipeline_health add constraint pipeline_health_prev_status_check
  check (prev_status = any (array['green','amber','red','unknown','skipped']));
alter table public.pipeline_fetch_log drop constraint if exists pipeline_fetch_log_status_check;
alter table public.pipeline_fetch_log add constraint pipeline_fetch_log_status_check
  check (status = any (array['green','amber','red','unknown','skipped']));
