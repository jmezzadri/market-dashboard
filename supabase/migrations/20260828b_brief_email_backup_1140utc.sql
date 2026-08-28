-- 20260828b_brief_email_backup_1140utc.sql
--
-- 2026-08-28 health sweep — a third, EARLIER brief-email backup slot.
--
-- Today the brief email did not go out, and nothing was red. DAILY-BRIEF-WRITER's
-- own 10:15 UTC cron was dropped by GitHub again (4.13/4.17), and every one of the
-- five workflow_run triggers that DID fire completed between 04:31 and 08:38 UTC —
-- before 05:00 ET — so all five returned `skipped_too_early`. That "reliable path"
-- was structurally incapable of ever sending the email: every workflow in its
-- trigger list finishes before the send window opens. (Fixed in the same change:
-- the trigger list now carries INDICATOR-REFRESH_7AM_WEEKDAYS, which completes
-- inside the window.)
--
-- The 4.54 backups at 12:20/13:20 UTC would have caught it, but at 08:20 ET rather
-- than the usual ~07:10. The morning session's brief commit spread over the last
-- fourteen weekdays is 10:12-11:20 UTC (max 11:20 on 8/12), so 11:40 sits after the
-- observed maximum with margin (4.28 rule 1) and inside send_email's 05:00-09:59 ET
-- window under BOTH offsets (07:40 ET in EDT, 06:40 ET in EST). A fire before the
-- brief is committed is harmless — the writer returns skipped_awaiting_agent_brief
-- and the later slots still cover it — and claim_email_send() makes a double
-- dispatch physically unable to double-mail.

select cron.schedule(
  'brief-email-backup-1140utc',
  '40 11 * * 1-5',
  $job$
  select case when not exists (
      select 1 from public.brief_email_log
       where brief_date = (now() at time zone 'America/New_York')::date)
    then net.http_post(
      url := 'https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/ops-code-commit',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (select value from public.ops_secrets where name = 'gh_push_token' limit 1)
      ),
      body := '{"dispatch":"DAILY-BRIEF-WRITER.yml"}'::jsonb
    ) end
  $job$
);
