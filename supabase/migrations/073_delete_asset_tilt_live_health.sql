-- 073: retire the shelved new-model Asset Tilt live feed.
-- Decision (Joe, 2026-06-16): the reworked engine underperformed the current
-- MOVE-based engine in the head-to-head, so the current engine is kept and the
-- new-model live feed (asset_tilt_live) is retired. Delete its tracking row so
-- it stops flagging on the freshness monitor (orphan row = defect per LESSONS 0.10/4.1).
delete from public.pipeline_health where indicator_id = 'asset_tilt_live';
select 'asset_tilt_live rows remaining' as label, count(*) from public.pipeline_health where indicator_id = 'asset_tilt_live';
