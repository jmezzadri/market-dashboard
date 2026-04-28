-- ============================================================================
-- 028_options_multiplier_backfill.sql — set multiplier=100 on options where NULL
-- ============================================================================
-- Pre-emptive cleanup so the close_position RPC v2 (mig 027) guardrail
-- "options must have multiplier set" can never trip on existing data.
--
-- Equity options have multiplier 100 by definition; this is the safe default.
-- Index options or future option types with different multipliers must be
-- entered via PositionEditor with the correct multiplier explicitly. None
-- exist in the dataset today.
-- ============================================================================

update public.positions
  set multiplier = 100,
      updated_at = now()
where asset_class = 'option' and multiplier is null;

-- Audit: report any option still in suspicious shape (per-contract avg_cost
-- typically 5..50000; flag rows outside that range for manual review)
do $$
declare
  r record;
  cnt int := 0;
begin
  for r in
    select id, ticker, avg_cost, multiplier
    from public.positions
    where asset_class = 'option' and closed_at is null
      and (avg_cost < 5 or avg_cost > 50000)
  loop
    cnt := cnt + 1;
    raise notice 'AUDIT-FLAG option position % (%) avg_cost=% mult=%',
      r.id, r.ticker, r.avg_cost, r.multiplier;
  end loop;
  if cnt = 0 then
    raise notice 'AUDIT-CLEAN — all open option positions have avg_cost in expected per-contract range $5–$50,000';
  else
    raise notice 'AUDIT — flagged % option position(s) for manual review', cnt;
  end if;
end $$;
