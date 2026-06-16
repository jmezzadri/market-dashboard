-- 070 — Delete 6 orphan pipeline_health tracking rows for already-killed feeds.
-- adv_dec, buffett, bank_unreal, naaim, fx_dollar, hy_ig_ratio are all listed in
-- killed_elements.json, absent from indicator_history.json (no store residue),
-- and written by no producer (the only FX producer writes fx_eur/jpy/gbp). Their
-- tracking rows are monitoring-only; the freshness watchdog graded them red
-- ("indicator not present in indicator_history.json"). Deleting the rows changes
-- no computed score and clears the 6 red dots. Companion to LESSONS 0.10 / 4.1.
DELETE FROM public.pipeline_health
 WHERE indicator_id IN ('adv_dec','buffett','bank_unreal','naaim','fx_dollar','hy_ig_ratio');

SELECT count(*) AS remaining_orphans
  FROM public.pipeline_health
 WHERE indicator_id IN ('adv_dec','buffett','bank_unreal','naaim','fx_dollar','hy_ig_ratio');
