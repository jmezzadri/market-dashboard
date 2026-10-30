-- 2026-10-30 (LESSONS 6.28): once-per-trip mutex for the daily thesis check alert.
-- Applied via the Supabase MCP the same day; committed here so the schema lives with the code.
create table if not exists public.thesis_check_alerts (
  note_id text not null,
  reason_key text not null,
  first_tripped date not null,
  sent_by text,
  created_at timestamptz not null default now(),
  primary key (note_id, reason_key)
);
alter table public.thesis_check_alerts enable row level security;
-- Service role only: RLS is on with no policies, so anon and authenticated read nothing.
grant select, insert, update, delete on public.thesis_check_alerts to service_role;
comment on table public.thesis_check_alerts is 'One row per (Trade Idea note, tripped reason) already emailed by scripts/send_thesis_check_alert.py — the primary key makes the alert once-per-trip. Service role only (RLS on, no policies). LESSONS 6.28.';
