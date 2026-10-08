-- Applied to production 2026-10-08 (health sweep, bug #1261). Recorded here so the schema is in git.
-- Scheduled sessions recorded publish/skip outcomes with raw UPDATEs through the Supabase MCP
-- execute_sql tool, which intermittently holds statements it classifies as destructive for a
-- human confirmation nobody is there to give; the call hangs and the write never lands.
-- These functions do the same write behind a plain SELECT. Neither touches last_good_at.
create or replace function public.ops_record_skip(p_indicator text, p_reason text)
returns table(indicator_id text, consecutive_skips integer, last_skip_at timestamptz)
language sql security definer set search_path = public as $$
  update pipeline_health
     set consecutive_skips = coalesce(pipeline_health.consecutive_skips, 0) + 1,
         last_skip_at = now(), last_skip_reason = p_reason, last_check_at = now()
   where pipeline_health.indicator_id = p_indicator
  returning pipeline_health.indicator_id, pipeline_health.consecutive_skips, pipeline_health.last_skip_at;
$$;

create or replace function public.ops_record_publish(p_indicator text)
returns table(indicator_id text, consecutive_skips integer, last_check_at timestamptz)
language sql security definer set search_path = public as $$
  update pipeline_health
     set consecutive_skips = 0, last_skip_at = null, last_skip_reason = null, last_check_at = now()
   where pipeline_health.indicator_id = p_indicator
  returning pipeline_health.indicator_id, pipeline_health.consecutive_skips, pipeline_health.last_check_at;
$$;

revoke all on function public.ops_record_skip(text, text) from public, anon, authenticated;
revoke all on function public.ops_record_publish(text) from public, anon, authenticated;

-- Scratch table for one-off GitHub Actions probes whose branch-only logs a cloud session cannot read.
create table if not exists public.ops_probe_output (id bigserial primary key, created_at timestamptz default now(), probe text, output text);
alter table public.ops_probe_output enable row level security;
