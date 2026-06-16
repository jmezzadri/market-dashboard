-- 072 — READ-ONLY diagnostic: did the cron's HTTP calls to pipeline-health-check
-- actually reach the function? Check pg_net responses + pending queue.
SELECT jsonb_build_object(
  'recent_responses', (SELECT jsonb_agg(r) FROM (
       SELECT id, status_code, timed_out, left(coalesce(error_msg,''),140) AS error_msg, created
         FROM net._http_response ORDER BY created DESC LIMIT 8) r),
  'pending_in_queue', (SELECT count(*) FROM net.http_request_queue)
) AS diag;
