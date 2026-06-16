-- 071 — READ-ONLY diagnostic (no schema change): why did the freshness watchdog
-- timer pipeline-health-check-30min drift? Returns the job config + last 12 fires.
SELECT jsonb_build_object(
  'job', (SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'active',active))
            FROM cron.job WHERE jobname = 'pipeline-health-check-30min'),
  'recent_fires', (SELECT jsonb_agg(r) FROM (
       SELECT status, left(coalesce(return_message,''),160) AS msg, start_time, end_time
         FROM cron.job_run_details
        WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'pipeline-health-check-30min')
        ORDER BY start_time DESC LIMIT 12) r)
) AS diag;
