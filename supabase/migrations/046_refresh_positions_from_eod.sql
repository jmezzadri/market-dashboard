-- ============================================================================
-- 046_refresh_positions_from_eod.sql — daily auto-sync positions.price from prices_eod
-- ============================================================================
-- Joe directive 2026-05-04 evening. The bug behind the "$109K vs Chase
-- $101K" mismatch tonight was that prices_eod gets fresh data from
-- MASSIVE-DAILY but NOTHING copies that into positions.price. Even when
-- the EOD ingest succeeded, position values stayed at whatever was last
-- written there (often months old, or NULL after a manual revert).
--
-- This function copies the latest prices_eod close into positions.price
-- and recomputes positions.value for every active stock position. Idempotent
-- — safe to call any number of times. Designed to be called as the final
-- step in MASSIVE-DAILY, right after prices_eod ingest completes.
--
-- Scope:
--   - asset_class = 'stock' only. Cash positions stay at price=1; option
--     pricing isn't in prices_eod (Massive doesn't publish option chains
--     on Basic tier — that's a separate vendor).
--   - closed_at IS NULL (active positions only).
--   - Updates value = quantity * close so the displayed dollar amount
--     reflects the new price immediately.
-- ============================================================================

create or replace function public.refresh_positions_from_eod()
returns table (
  rows_updated   int,
  prices_as_of   date,
  oldest_active  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_date date;
  v_updated  int;
begin
  select max(trade_date) into v_max_date from public.prices_eod;
  if v_max_date is null then
    return query select 0 as rows_updated, null::date as prices_as_of, null::timestamptz as oldest_active;
    return;
  end if;

  with latest as (
    select distinct on (ticker)
           ticker, close, trade_date
      from public.prices_eod
     where trade_date >= (v_max_date - interval '7 days')
     order by ticker, trade_date desc
  )
  update public.positions p
     set price = l.close,
         value = p.quantity * l.close,
         ingested_price = l.close,
         updated_at = now()
    from latest l
   where p.asset_class = 'stock'
     and p.closed_at is null
     and upper(p.ticker) = l.ticker;

  get diagnostics v_updated = row_count;

  return query
    select v_updated, v_max_date, (select min(updated_at) from public.positions where asset_class='stock' and closed_at is null);
end;
$$;

grant execute on function public.refresh_positions_from_eod() to service_role, authenticated;

comment on function public.refresh_positions_from_eod is
  'v1 (2026-05-04, mig 046). Copies prices_eod.max(trade_date) into positions.price + value for all active stock positions. Called as final step in MASSIVE-DAILY workflow. Idempotent. Returns {rows_updated, prices_as_of, oldest_active}.';
