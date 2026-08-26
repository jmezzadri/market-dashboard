-- Applied to production 2026-08-26. Recorded here so the schema is in git.
-- A producer that runs, looks, and publishes nothing is HEALTHY. Until now that
-- was indistinguishable from a producer that died -- both are silence -- and the
-- alarm emailed Joe either way. The Trade Idea writer skipped one Wednesday
-- (2026-08-19) and that alone produced the 8/22 and 8/23 "Data stale" emails.
alter table public.pipeline_health
  add column if not exists last_skip_at      timestamptz,
  add column if not exists last_skip_reason  text,
  add column if not exists consecutive_skips integer not null default 0;

comment on column public.pipeline_health.last_skip_at is
  'When the producer last ran and deliberately published nothing. Never set this to fake freshness -- it suppresses alerts, it does not make data current.';
comment on column public.pipeline_health.consecutive_skips is
  'Deliberate skips since the last real publish. Reset to 0 on every publish. At 3 the alarm fires with skip-aware wording instead of staying quiet.';
