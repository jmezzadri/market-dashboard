-- ============================================================================
-- 029_add_position_rpc.sql — Phase 4 buy-side mirror of close_position
-- ============================================================================
-- Atomic SECURITY DEFINER RPC. In ONE transaction:
--   1. Writes a BUY (or SELL for short opens) row to public.transactions.
--   2. If p_pay_from_cash=true, debits/credits the chosen cash row by cost
--      basis (creating a cash row if none exists in target account).
--   3. Either UPDATES an existing position (merge mode — recomputes weighted
--      avg_cost) or INSERTS a new position row.
-- Returns the resulting positions row.
--
-- Storage convention (LESSONS rule 25): for options, p_avg_cost is
-- per-CONTRACT (already × multiplier). PositionEditor's option branch
-- multiplies entryPrem × multiplier before passing avg_cost; identical
-- pattern as close_position.
-- ============================================================================

create or replace function public.add_position(
  p_account_id          uuid,
  p_ticker              text,
  p_asset_class         text,
  p_quantity            numeric,                 -- signed: long > 0, short < 0
  p_avg_cost            numeric,                 -- per-contract for options
  p_current_price       numeric default null,    -- per-contract for options
  p_executed_at         timestamptz default now(),
  p_pay_from_cash       boolean default false,
  p_cash_account_id     uuid default null,       -- defaults to p_account_id
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
as $$
declare
  v_caller          uuid := auth.uid();
  v_target_cash     uuid;
  v_existing        public.positions%rowtype;
  v_resulting       public.positions%rowtype;
  v_cost_basis_pos  numeric;                     -- always positive
  v_signed_qty      numeric := p_quantity;
  v_multiplier      integer;
  v_side            text;
  v_cash_delta      numeric;                     -- +credit, -debit
  v_cash_row_id     uuid;
  v_cash_qty        numeric;
  v_position_id     uuid;
  v_old_qty         numeric;
  v_old_avg         numeric;
  v_new_qty         numeric;
  v_new_avg         numeric;
begin
  -- Auth + account ownership check
  if not exists (select 1 from public.accounts where id = p_account_id and user_id = v_caller) then
    raise exception 'add_position: account does not belong to caller';
  end if;

  -- Validate inputs
  if v_signed_qty = 0 then
    raise exception 'add_position: quantity cannot be zero';
  end if;
  if p_avg_cost is null or p_avg_cost < 0 then
    raise exception 'add_position: avg_cost must be non-negative';
  end if;
  if p_asset_class not in ('stock','cash','option','bond','crypto') then
    raise exception 'add_position: invalid asset_class %', p_asset_class;
  end if;

  -- Multiplier: required for options (LESSONS rule 25 guardrail)
  v_multiplier := coalesce(p_multiplier, case when p_asset_class = 'option' then 100 else 1 end);
  if p_asset_class = 'option' and v_multiplier is null then
    raise exception 'add_position: option positions must have multiplier set (default 100 for equity options)';
  end if;

  -- Cash math: cost_basis is always positive (qty × per-contract avg_cost)
  v_cost_basis_pos := abs(v_signed_qty) * p_avg_cost;
  v_side := case when v_signed_qty >= 0 then 'BUY' else 'SELL' end;
  -- Cash impact: long buy debits, short sell-to-open credits
  if v_signed_qty >= 0 then
    v_cash_delta := -v_cost_basis_pos;
  else
    v_cash_delta :=  v_cost_basis_pos;
  end if;
  -- Net of fees (long: fees add to debit; short: fees subtract from credit)
  v_cash_delta := v_cash_delta - p_fees;

  -- Resolve target cash account
  v_target_cash := coalesce(p_cash_account_id, p_account_id);
  if p_pay_from_cash and not exists (
    select 1 from public.accounts where id = v_target_cash and user_id = v_caller
  ) then
    raise exception 'add_position: cash account does not belong to caller';
  end if;

  -- ── Merge path: recompute weighted avg_cost on existing position ──
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
    -- Merge into existing position
    v_position_id := v_existing.id;
    v_old_qty := coalesce(v_existing.quantity, 0);
    v_old_avg := coalesce(v_existing.avg_cost, 0);
    v_new_qty := v_old_qty + v_signed_qty;
    if v_new_qty = 0 then
      raise exception 'add_position: merging would zero out the position — close it instead via close_position';
    end if;
    -- Weighted avg cost — only recompute when adding to same direction; if signs
    -- differ (partial unwind via add) preserve the side that remains
    if (v_old_qty >= 0 and v_signed_qty >= 0) or (v_old_qty < 0 and v_signed_qty < 0) then
      v_new_avg := (abs(v_old_qty) * v_old_avg + abs(v_signed_qty) * p_avg_cost) / abs(v_new_qty);
    else
      v_new_avg := v_old_avg;  -- partial unwind doesn't change avg of remaining lots
    end if;
    update public.positions
      set quantity   = v_new_qty,
          avg_cost   = round(v_new_avg, 4),
          price      = coalesce(p_current_price, price),
          value      = v_new_qty * coalesce(p_current_price, price, p_avg_cost),
          manual_price = coalesce(p_manual_price, manual_price),
          updated_at = now()
    where id = v_position_id
    returning * into v_resulting;
  else
    -- Insert new position
    insert into public.positions (
      user_id, account_id, ticker, name, asset_class, sector,
      quantity, price, avg_cost, value,
      contract_type, direction, strike, expiration, multiplier, manual_price,
      purchase_date, opened_at, sort_order
    ) values (
      v_caller, p_account_id,
      upper(trim(p_ticker)),
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
      v_multiplier,
      p_manual_price,
      p_purchase_date,
      coalesce(p_purchase_date::timestamptz, p_executed_at),
      9999
    )
    returning * into v_resulting;
  end if;

  -- Write BUY/SELL row to transactions ledger
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

  -- Cash debit/credit (if toggle on)
  if p_pay_from_cash then
    select id, coalesce(quantity, 0) into v_cash_row_id, v_cash_qty
      from public.positions
      where user_id = v_caller
        and account_id = v_target_cash
        and asset_class = 'cash'
        and closed_at is null
      order by updated_at desc
      limit 1;

    if v_cash_row_id is not null then
      v_cash_qty := v_cash_qty + v_cash_delta;
      update public.positions
        set quantity = v_cash_qty,
            value    = v_cash_qty,
            price    = 1, avg_cost = 1,
            updated_at = now()
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
$$;

grant execute on function public.add_position(
  uuid, text, text, numeric, numeric, numeric, timestamptz,
  boolean, uuid, numeric, text, text, numeric, date, integer,
  text, text, date, numeric, boolean, text
) to authenticated;
revoke execute on function public.add_position(
  uuid, text, text, numeric, numeric, numeric, timestamptz,
  boolean, uuid, numeric, text, text, numeric, date, integer,
  text, text, date, numeric, boolean, text
) from anon, public;

comment on function public.add_position is
  'Phase 4 mirror of close_position. Atomic — writes BUY/SELL transaction row, optionally debits/credits cash, merges into existing position OR inserts new. Storage convention: per-contract for options (LESSONS rule 25). Closes #1099 by giving the editor a path that handles cash + merge in one call.';
