-- ============================================================================
-- 027_close_position_rpc_v2.sql — fix unit-convention bug (#1100)
-- ============================================================================
-- v1 of close_position (mig 026) treated p_close_price as per-share and
-- multiplied by `multiplier` to compute gross_proceeds. But the rest of the
-- codebase (PositionEditor.jsx) stores positions.price and positions.avg_cost
-- as PER-CONTRACT (already × multiplier). The mismatch produced 100x-wrong
-- realized P&L on Joe's first NVDA put close on 2026-04-27.
--
-- v2 fix: align with the existing storage convention. p_close_price is
-- expected to be PER-CONTRACT. Math is qty × price directly. The CloseModal
-- (Phase 3 UI, updated in this same PR) does the per-share → per-contract
-- conversion before calling the RPC, mirroring how PositionEditor converts
-- on save (avg_cost = entryPrem × multiplier).
--
-- Guardrail: any option position with multiplier IS NULL raises an exception.
-- The mig 028 backfill brings every option's multiplier to 100 first so this
-- guardrail can never block a legit close on existing data.
-- ============================================================================

create or replace function public.close_position(
  p_position_id      uuid,
  p_close_price      numeric,
  p_close_qty        numeric,
  p_executed_at      timestamptz default now(),
  p_cash_account_id  uuid    default null,
  p_fees             numeric default 0,
  p_notes            text    default null
) returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos              public.positions%rowtype;
  v_target_account   uuid;
  v_multiplier       integer;
  v_qty_signed       numeric;
  v_close_qty_abs    numeric;
  v_remaining_abs    numeric;
  v_gross_proceeds   numeric;
  v_net_proceeds     numeric;
  v_cost_amount      numeric;
  v_realized_pnl     numeric;
  v_holding_days     integer;
  v_is_long_term     boolean;
  v_cash_row_id      uuid;
  v_new_cash_qty     numeric;
  v_tx               public.transactions%rowtype;
  v_caller           uuid := auth.uid();
begin
  select * into v_pos from public.positions where id = p_position_id for update;
  if not found then raise exception 'close_position: position % not found', p_position_id; end if;
  if v_pos.user_id <> v_caller then raise exception 'close_position: not your position'; end if;
  if v_pos.closed_at is not null then
    raise exception 'close_position: position % already closed (closed_at=%)', p_position_id, v_pos.closed_at;
  end if;

  v_target_account := coalesce(p_cash_account_id, v_pos.account_id);
  if not exists (select 1 from public.accounts where id = v_target_account and user_id = v_caller) then
    raise exception 'close_position: target cash account does not belong to caller';
  end if;

  -- Multiplier guardrail (#1100). Options must have multiplier set.
  -- Mig 028 backfills NULLs to 100 before this RPC v2 ships so existing
  -- data can't trip this on legit closes.
  if v_pos.asset_class = 'option' and v_pos.multiplier is null then
    raise exception 'close_position: option position % has no multiplier set — fix the position row before closing (expected 100 for equity options)', p_position_id;
  end if;
  v_multiplier := coalesce(v_pos.multiplier, 1);

  v_qty_signed    := coalesce(v_pos.quantity, 0);
  v_close_qty_abs := abs(p_close_qty);
  if v_close_qty_abs <= 0 then
    raise exception 'close_position: close quantity must be positive (got %)', p_close_qty;
  end if;
  if v_close_qty_abs > abs(v_qty_signed) then
    raise exception 'close_position: close qty % exceeds open position qty %', v_close_qty_abs, abs(v_qty_signed);
  end if;

  -- Per-contract math (consistent with how PositionEditor stores prices).
  -- p_close_price is per-contract; CloseModal does the per-share conversion
  -- before calling. Multiplier is metadata on the transaction row, not in
  -- the math.
  v_gross_proceeds := v_close_qty_abs * p_close_price;
  v_net_proceeds   := v_gross_proceeds - p_fees;
  v_cost_amount    := v_close_qty_abs * coalesce(v_pos.avg_cost, 0);
  if v_qty_signed >= 0 then
    v_realized_pnl := v_gross_proceeds - v_cost_amount - p_fees;
  else
    v_realized_pnl := v_cost_amount - v_gross_proceeds - p_fees;
  end if;

  v_holding_days := greatest(0, floor(extract(epoch from (p_executed_at - coalesce(v_pos.opened_at, v_pos.created_at))) / 86400)::int);
  v_is_long_term := (v_holding_days > 365);

  insert into public.transactions (
    user_id, account_id, position_id, ticker, asset_class, side,
    quantity, price, multiplier, fees, gross_proceeds, net_proceeds,
    opened_at, cost_basis, realized_pnl, holding_days, is_long_term,
    contract_type, direction, strike, expiration,
    notes, executed_at
  ) values (
    v_pos.user_id, v_pos.account_id, v_pos.id, v_pos.ticker, v_pos.asset_class, 'CLOSE',
    v_close_qty_abs, p_close_price, v_multiplier, p_fees, v_gross_proceeds, v_net_proceeds,
    coalesce(v_pos.opened_at, v_pos.created_at), coalesce(v_pos.avg_cost, 0),
    v_realized_pnl, v_holding_days, v_is_long_term,
    v_pos.contract_type, v_pos.direction, v_pos.strike, v_pos.expiration,
    p_notes, p_executed_at
  ) returning * into v_tx;

  -- Credit cash row in target account (long close: +net; short close: -net)
  declare v_cash_delta numeric;
  begin
    if v_qty_signed >= 0 then v_cash_delta := v_net_proceeds;
    else                       v_cash_delta := -v_net_proceeds;
    end if;

    select id, coalesce(quantity, 0) into v_cash_row_id, v_new_cash_qty
      from public.positions
      where user_id = v_pos.user_id and account_id = v_target_account
        and asset_class = 'cash' and closed_at is null
      order by updated_at desc limit 1;

    if v_cash_row_id is not null then
      v_new_cash_qty := v_new_cash_qty + v_cash_delta;
      update public.positions
        set quantity = v_new_cash_qty, value = v_new_cash_qty,
            price = 1, avg_cost = 1, updated_at = now()
      where id = v_cash_row_id;
    else
      insert into public.positions (
        user_id, account_id, ticker, name, asset_class, sector,
        quantity, price, avg_cost, value, sort_order, opened_at
      ) values (
        v_pos.user_id, v_target_account, 'CASH', 'CASH', 'cash', 'Cash',
        v_cash_delta, 1, 1, v_cash_delta, 9999, p_executed_at
      );
    end if;
  end;

  -- Soft-archive (full close) or reduce qty (partial close)
  v_remaining_abs := abs(v_qty_signed) - v_close_qty_abs;
  if v_remaining_abs <= 0.0000001 then
    update public.positions set closed_at = p_executed_at, updated_at = now() where id = p_position_id;
  else
    update public.positions
      set quantity = sign(v_qty_signed) * v_remaining_abs,
          value = sign(v_qty_signed) * v_remaining_abs * coalesce(v_pos.price, p_close_price),
          updated_at = now()
    where id = p_position_id;
  end if;

  return v_tx;
end;
$$;

grant execute on function public.close_position(uuid, numeric, numeric, timestamptz, uuid, numeric, text) to authenticated;
revoke execute on function public.close_position(uuid, numeric, numeric, timestamptz, uuid, numeric, text) from anon, public;

comment on function public.close_position is
  'v2 (2026-04-27, mig 027). Atomic close — math is qty * price directly with NO multiplier (positions store per-contract). CloseModal converts per-share user input to per-contract before calling. Tax-lot: average cost (Joe 2026-04-27).';
