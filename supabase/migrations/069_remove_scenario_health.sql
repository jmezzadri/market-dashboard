-- 069 — Remove Scenario Analysis freshness rows.
-- The Scenario Analysis page and its entire data/code/backtest tree were
-- purged (page, libs, scripts, workflows, manifest entries, served JSON).
-- These pipeline_health rows are now orphans — no manifest entry, no producer,
-- no served file — which the nightly reconciler flags red. Delete them so no
-- scenario row remains anywhere. 'ticker-betas' is included because its only
-- consumer was the Scenario page; its producer + output were removed in the
-- same change. Idempotent.
delete from public.pipeline_health
 where indicator_id in (
   'scenario_stress',
   'scenarios',
   'scenario_calibration_bundle',
   'ticker-betas',
   'ticker_betas'
 );
