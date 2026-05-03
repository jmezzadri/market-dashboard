-- Migration 041 — 7-day stuck-red staleness alarm.
--
-- Background
-- ──────────
-- pipeline_health.last_alerted_at fires once on green→red transition,
-- debounced 24h. It does NOT escalate when a chip stays red for days —
-- the user gets one email then silence. Joe directive 2026-05-03:
-- "alarm me if a chip stays red for 7+ days." This adds a separate
-- column tracking the most recent 7-day-stuck escalation.
--
-- Behavior (implemented in pipeline-health-check edge fn)
-- ───────────────────────────────────────────────────────
-- For each row where status='red':
--   age = now - last_alerted_at  (proxies "how long has it been red")
--   if age >= 7d AND (last_7day_alert_at is null OR now - last_7day_alert_at >= 7d):
--     send escalation email
--     set last_7day_alert_at = now
-- Reset to NULL on every green→red transition (so the timer restarts
-- fresh after a recovery).

ALTER TABLE public.pipeline_health
  ADD COLUMN IF NOT EXISTS last_7day_alert_at timestamptz;

COMMENT ON COLUMN public.pipeline_health.last_7day_alert_at IS
  'Timestamp of the most recent 7-day stuck-red escalation email. '
  'Reset to NULL on each green→red transition.';
