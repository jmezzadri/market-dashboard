-- 095 — Send-once ledger for WORKFLOW_FAILURE_ALERT (LESSONS 4.12 / 4.28).
--
-- Several watched workflows fire many times a morning ON PURPOSE, as redundancy
-- against GitHub's best-effort scheduler (BRIEF-FRESHNESS-SELFHEAL runs every
-- 30 minutes, 06:00-11:30 ET). When the thing they watch is genuinely broken,
-- every one of those runs fails — and before this table every one of them sent
-- its own "Workflow FAILED" email. Redundant timers are for reliability; they
-- must never multiply notifications.
--
-- The primary key is the mutex. The first run of the ET day INSERTs and emails;
-- every later run gets a 409 and stays quiet. Atomic, not check-then-act
-- (LESSONS 4.22d) — the 30-minute runs can and do overlap.
create table if not exists public.workflow_alert_log (
  workflow_name text        not null,
  alert_date    date        not null,
  run_id        bigint,
  sent_at       timestamptz not null default now(),
  primary key (workflow_name, alert_date)
);

alter table public.workflow_alert_log enable row level security;
-- No policies on purpose: service-role only (the alert workflow writes it).
-- Nothing user-facing reads this table.

comment on table public.workflow_alert_log is
  'Send-once ledger: one WORKFLOW_FAILURE_ALERT email per workflow per ET day (LESSONS 4.12/4.28).';
