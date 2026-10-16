-- Applied to production 2026-10-16 (health sweep, bug #1272). Recorded here so the schema is in git.
-- trade_ideas.consecutive_skips read 8 on Oct 16 although a note went live Oct 9 (last_good_at
-- 2026-10-09 13:02) and another was queued Oct 14: neither session called ops_record_publish, so the
-- counter kept climbing past SKIP_ESCALATE_AFTER = 7 on a week working as designed.
-- Fix: the reset no longer depends on a session remembering a call. A skip recorded after a
-- successful publish (last_good_at newer than the previous skip) starts a fresh streak at 1.
-- ops_record_publish still exists and still resets to 0 (queued-but-not-yet-approved notes).
create or replace function public.ops_record_skip(p_indicator text, p_reason text)
returns table(indicator_id text, consecutive_skips integer, last_skip_at timestamptz)
language sql security definer set search_path = public as $$
  update pipeline_health
     set consecutive_skips = case
           when pipeline_health.last_good_at is not null
            and pipeline_health.last_skip_at is not null
            and pipeline_health.last_good_at > pipeline_health.last_skip_at then 1
           else coalesce(pipeline_health.consecutive_skips, 0) + 1 end,
         last_skip_at = now(), last_skip_reason = p_reason, last_check_at = now()
   where pipeline_health.indicator_id = p_indicator
  returning pipeline_health.indicator_id, pipeline_health.consecutive_skips, pipeline_health.last_skip_at;
$$;
revoke all on function public.ops_record_skip(text, text) from public, anon, authenticated;

-- One-off correction. Playbook definition (trade_idea_playbook.md step 5g): a day a note was
-- QUEUED resets the counter. Last queued note: 2026-10-14 (x_pending_posts 899caee7). Skips since:
-- Oct 15, Oct 16 = 2. Guarded on the observed value so a concurrent write is never clobbered.
update pipeline_health set consecutive_skips = 2
 where indicator_id = 'trade_ideas' and consecutive_skips = 8;
