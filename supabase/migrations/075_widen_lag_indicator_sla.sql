-- Migration 075: Widen expected_cadence_minutes for indicators with known publication lag
--
-- Problem: three indicators were showing red despite having the most current
-- available data from their upstream sources:
--
--   stlfsi      (FRED STLFSI4): weekly, releases on Thursdays for prior week.
--               Data labeled Jun-19 was PUBLISHED Jun-26 — 4 days before this
--               migration. Prior window was 9d (10080+2880), already exceeded
--               after 11 days. Fix: widen to 14-day expected_cadence → 16d window.
--
--   term_premium (FRED THREEFYTP10): daily Kim-Wright series, well-documented
--               5-8 trading-day publication lag (bumped in fetch_history.py
--               DAILY_FRESHNESS_SLA 2026-06-15). Prior window was 9d; data was
--               12 calendar days old. Fix: widen to 14-day expected_cadence → 16d window.
--
--   jolts_quits (FRED JTSQUR): monthly, published with a ~2-month lag (April
--               data released June-3). FRED stores dates as the 1st of the
--               reference month (Apr-01), making data appear 90 days old while
--               still being the most recent available. Prior 30-day SLA window
--               of 40d was far too tight. Fix: widen to 90-day expected_cadence
--               → 100-day window, sized so the chip stays green until May data
--               arrives (expected early July 2026, ~100 days from Apr-01).

UPDATE public.pipeline_health
SET expected_cadence_minutes = 20160   -- 14 days (was 10080 = 7 days)
WHERE indicator_id IN ('stlfsi', 'term_premium');

UPDATE public.pipeline_health
SET expected_cadence_minutes = 129600  -- 90 days (was 43200 = 30 days)
WHERE indicator_id = 'jolts_quits';

