-- ============================================================================
-- 030_add_position_no_price_overwrite.sql — Phase 4 hotfix
-- ============================================================================
-- The original add_position RPC (mig 029) merge path did:
--     price = coalesce(p_current_price, price),
--     value = v_new_qty * coalesce(p_current_price, price, p_avg_cost),
-- When the form passed a buggy p_current_price (Joe's first ONDS test got
-- $62.69 from a misread screener field), it overwrote the position's
-- correct live mark and tanked the displayed value.
--
-- Fix: on merge, NEVER touch price. The existing live mark from the
-- screener pipeline is the source of truth. We only update quantity +
-- weighted avg_cost + recompute value against the EXISTING price.
-- On insert (new position), p_current_price still seeds price as before.
-- ============================================================================

create or replace function public.add_position(
  p_account_id          uuid,
  p_ticker              text,
  p_asset_class         text,
  p_quantity            numeric,
  p_avg_cost            numeric,
  p_current_price       numeric default null,
  p_executed_at         timestamptz default now(),
  p_pay_from_cash       boolean default false,
  p_cash_account_id     uuid default null,
  p_fees                numeric default 0,
  p_contract_type       text default null,
  p_direction           text default null,
  p_strike              numeric default null,
  p_expiration          date default null,
  p_multiplier          integer default null,
  p_sector              text default null,
  p_name                text default null,
  p_purchase_date       date default null,
  p_manual_price        numeric default null,
  p_merge_into_existing boolean default true,
  p_notes               text default null
) returns public.positions
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_caller          uuid := auth.uid();
  v_target_cash     uuid;
  v_existing        public.positions%rowtype;
  v_resulting       public.positions%rowtype;
  v_cost_basis_pos  numeric;
  v_signed_qty      numeric := p_quantity;
  v_multiplier      integer;
  v_side            text;
  v_cash_delta      numeric;
  v_cash_row_id     uuid;
  v_cash_qty        numeric;
  v_old_qty         numeric;
  v_old_avg         numeric;
  v_old_price       numeric;
  v_new_qty         numeric;
  v_new_avg         numeric;
begin
  if not exists (select 1 from public.accounts where id = p_account_id and user_id = v_caller) then
    raise exception 'add_position: account does not belong to caller';
  end if;
  if v_signed_qty = 0 then raise exception 'add_position: quantity cannot be zero'; end if;
  if p_avg_cost is null or p_avg_cost < 0 then raise exception 'add_position: avg_cost must be non-negative'; end if;
  if p_asset_class not in ('stock','cash','option','bond','crypto') then
    raise exception 'add_position: invalid asset_class %', p_asset_class;
  end if;
  v_multiplier := coalesce(p_multiplier, case when p_asset_class = 'option' then 100 else 1 end);
  if p_asset_class = 'option' and v_multiplier is null then
    raise exception 'add_position: option positions must have multiplier set';
  end if;

  v_cost_basis_pos := abs(v_signed_qty) * p_avg_cost;
  v_side := case when v_signed_qty >= 0 then 'BUY' else 'SELL' end;
  if v_signed_qty >= 0 then
    v_cash_delta := -v_cost_basis_pos;
  else
    v_cash_delta :=  v_cost_basis_pos;
  end if;
  v_cash_delta := v_cash_delta - p_fees;

  v_target_cash := coalesce(p_cash_account_id, p_account_id);
  if p_pay_from_cash and not exists (
    select 1 from public.accounts where id = v_target_cash and user_id = v_caller
  ) then
    raise exception 'add_position: cash account does not belong to caller';
  end if;

  if p_merge_into_existing and p_asset_class <> 'cash' then
    select * into v_existing
      from public.positions
      where user_id = v_caller
        and account_id = p_account_id
        and upper(trim(ticker)) = upper(trim(p_ticker))
        and asset_class = p_asset_class
        and closed_at is null
        and (p_asset_class <> 'option'
             or (contract_type is not distinct from p_contract_type
                 and direction is not distinct from p_direction
                 and strike is not distinct from p_strike
                 and expiration is not distinct from p_expiration))
      for update
      limit 1;
  end if;

  if v_existing.id is not null then
    -- ── MERGE: never touch price (existing live mark is source of truth) ──
    v_old_qty   := coalesce(v_existing.quantity, 0);
    v_old_avg   := coalesce(v_existing.avg_cost, 0);
    v_old_price := v_existing.price;
    v_new_qty   := v_old_qty + v_signed_qty;
    if v_new_qty = 0 then
      raise exception 'add_position: merging would zero out the position - close via close_position';
    end if;
    if (v_old_qty >= 0 and v_signed_qty >= 0) or (v_old_qty < 0 and v_signed_qty < 0) then
      v_new_avg := (abs(v_old_qty) * v_old_avg + abs(v_signed_qty) * p_avg_cost) / abs(v_new_qty);
    else
      v_new_avg := v_old_avg;
    end if;
    update public.positions
      set quantity   = v_new_qty,
          avg_cost   = round(v_new_avg, 4),
          -- price intentionally NOT updated - existing v_old_price is the live mark
          value      = v_new_qty * coalesce(v_old_price, p_avg_cost),
          updated_at = now()
    where id = v_existing.id
    returning * into v_resulting;
  else
    insert into public.positions (
      user_id, account_id, ticker, name, asset_class, sector,
      quantity, price, avg_cost, value,
      contract_type, direction, strike, expiration, multiplier, manual_price,
      purchase_date, opened_at, sort_order
    ) values (
      v_caller, p_account_id, upper(trim(p_ticker)),
      coalesce(p_name, upper(trim(p_ticker))),
      p_asset_class,
      coalesce(p_sector, case
        when p_asset_class = 'cash'   then 'Cash'
        when p_asset_class = 'option' then 'Options'
        when p_asset_class = 'bond'   then 'Bonds'
        when p_asset_class = 'crypto' then 'Crypto'
        else null end),
      v_signed_qty,
      coalesce(p_current_price, p_avg_cost),
      p_avg_cost,
      v_signed_qty * coalesce(p_current_price, p_avg_cost),
      p_contract_type, p_direction, p_strike, p_expiration,
      v_multiplier, p_manual_price, p_purchase_date,
      coalesce(p_purchase_date::timestamptz, p_executed_at), 9999
    )
    returning * into v_resulting;
  end if;

  insert into public.transactions (
    user_id, account_id, position_id, ticker, asset_class, side,
    quantity, price, multiplier, fees, gross_proceeds, net_proceeds,
    opened_at, cost_basis,
    contract_type, direction, strike, expiration,
    notes, executed_at
  ) values (
    v_caller, p_account_id, v_resulting.id,
    upper(trim(p_ticker)), p_asset_class, v_side,
    abs(v_signed_qty), p_avg_cost, v_multiplier, p_fees,
    v_cost_basis_pos, v_cost_basis_pos - p_fees,
    coalesce(p_purchase_date::timestamptz, p_executed_at), p_avg_cost,
    p_contract_type, p_direction, p_strike, p_expiration,
    p_notes, p_executed_at
  );

  if p_pay_from_cash then
    select id, coalesce(quantity, 0) into v_cash_row_id, v_cash_qty
      from public.positions
      where user_id = v_caller and account_id = v_target_cash
        and asset_class = 'cash' and closed_at is null
      order by updated_at desc limit 1;
    if v_cash_row_id is not null then
      v_cash_qty := v_cash_qty + v_cash_delta;
      update public.positions
        set quantity = v_cash_qty, value = v_cash_qty,
            price = 1, avg_cost = 1, updated_at = now()
      where id = v_cash_row_id;
    else
      insert into public.positions (
        user_id, account_id, ticker, name, asset_class, sector,
        quantity, price, avg_cost, value, sort_order, opened_at
      ) values (
        v_caller, v_target_cash, 'CASH', 'CASH', 'cash', 'Cash',
        v_cash_delta, 1, 1, v_cash_delta, 9999, p_executed_at
      );
    end if;
  end if;
  return v_resulting;
end;
$func$;

comment on function public.add_position is
  'v2 (mig 030, 2026-04-28). MERGE path no longer overwrites price - existing live mark from screener pipeline stays intact. Form-side bugs (buggy p_current_price) cannot corrupt mark on existing positions any more.';
