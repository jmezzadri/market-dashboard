-- 2026-08-31 — an honest anchor for "how long has this been red".
--
-- The 7-day stuck-red escalation proxied the start of a red episode off
-- last_alerted_at, which is never cleared when a row recovers to green. A row
-- that went red, was alerted, published again, and went red a second time
-- inherited the FIRST episode's timestamp. On 2026-08-31 "Trade Idea notes"
-- produced two emails one second apart -- "last updated 5 days ago" and "still
-- not updating after 8 days" -- on the very run where it first went red.
--
-- red_since is stamped on entry into red, held for the life of the episode, and
-- set back to NULL on every recovery. Never backfill it: a NULL simply means
-- "this episode started on the next check", which delays an escalation by a
-- week and never invents one.
alter table public.pipeline_health
  add column if not exists red_since timestamptz;

comment on column public.pipeline_health.red_since is
  'When the CURRENT red episode began. NULL whenever the row is not red. Set by pipeline-health-check on the green->red transition and cleared on recovery; the 7-day stuck-red escalation measures from this and from nothing else.';
