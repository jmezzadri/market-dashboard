-- ============================================================================
-- 026_close_position_rpc.sql — Phase 2 of Close Position + ledger build
-- ============================================================================
-- Atomic SECURITY DEFINER function. In ONE transaction:
--   1. Compute realized P&L using the position's avg_cost (weighted average,
--      per Joe's decision 2026-04-27 via AskUserQuestion).
--   2. Write a CLOSE row to public.transactions with full tax-lot context.
--   3. Credit (or debit, for buy-to-close on shorts) the chosen cash row in
--      the target account. Creates a cash row if none exists in that account.
--   4. Soft-archive (full close) or reduce quantity (partial close) the
--      source position.
-- Returns the new transactions row.
-- Pattern mirrors submit_bug_report SECURITY DEFINER from PR #125.
-- ============================================================================

create or replace function public.close_position(
  p_position_id      uuid,
  p_close_price      numeric,                 -- per share / contract
  p_close_qty        numeric,                 -- positive; = full position qty for full close
  p_executed_at      timestamptz default now(),
  p_cash_account_id  uuid    default null,    -- defaults to position's account
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
  v_qty_signed       numeric;                 -- signed: long > 0, short < 0
  v_close_qty_abs    numeric;                 -- always positive
  v_remaining_abs    numeric;                 -- abs(qty) after partial close
  v_gross_proceeds   numeric;                 -- positive on SELL of long, positive on BUY-to-close of short
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
  -- Lock + read the position; ensure caller owns it
  select * into v_pos from public.positions where id = p_position_id for update;
  if not found then
    raise exception 'close_position: position % not found', p_position_id;
  end if;
  if v_pos.user_id <> v_caller then
    raise exception 'close_position: not your position';
  end if;
  if v_pos.closed_at is not null then
    raise exception 'close_position: position % is already closed (closed_at=%)', p_position_id, v_pos.closed_at;
  end if;

  -- Resolve target cash account (default = same account as the position)
  v_target_account := coalesce(p_cash_account_id, v_pos.account_id);

  -- Sanity: target account must belong to caller
  if not exists (
    select 1 from public.accounts
    where id = v_target_account and user_id = v_caller
  ) then
    raise exception 'close_position: target cash account does not belong to caller';
  end if;

  -- Multiplier defaults: 100 for options, 1 otherwise
  v_multiplier   := coalesce(v_pos.multiplier, case when v_pos.asset_class = 'option' then 100 else 1 end);
  v_qty_signed   := coalesce(v_pos.quantity, 0);
  v_close_qty_abs := abs(p_close_qty);

  if v_close_qty_abs <= 0 then
    raise exception 'close_position: close quantity must be positive (got %)', p_close_qty;
  end if;
  if v_close_qty_abs > abs(v_qty_signed) then
    raise exception 'close_position: close qty % exceeds open position qty %', v_close_qty_abs, abs(v_qty_signed);
  end if;

  -- Trade economics
  -- For LONG: SELL at close_price; gross = qty * close_price * mult; cost = qty * avg_cost * mult; PnL = gross - cost - fees
  -- For SHORT (qty_signed < 0): BUY-to-close at close_price; cost paid = qty * close_price * mult; PnL = (avg_cost - close_price) * qty * mult - fees
  v_gross_proceeds := v_close_qty_abs * p_close_price * v_multiplier;
  v_net_proceeds   := v_gross_proceeds - p_fees;
  v_cost_amount    := v_close_qty_abs * coalesce(v_pos.avg_cost, 0) * v_multiplier;
  if v_qty_signed >= 0 then
    -- Long close: sell-to-close, realized = sale - cost - fees
    v_realized_pnl := v_gross_proceeds - v_cost_amount - p_fees;
  else
    -- Short close: buy-to-close, realized = (entry cost - buy back) * qty - fees
    v_realized_pnl := v_cost_amount - v_gross_proceeds - p_fees;
  end if;

  -- Holding period (anchored to opened_at, falling back to created_at)
  v_holding_days := greatest(0, floor(extract(epoch from (p_executed_at - coalesce(v_pos.opened_at, v_pos.created_at))) / 86400)::int);
  v_is_long_term := (v_holding_days > 365);

  -- Write CLOSE row to transactions (denormalize option specifics for history)
  insert into public.transactions (
    user_id, account_id, position_id, ticker, asset_class, side,
    quantity, price, multiplier, fees, gross_proceeds, net_proceeds,
    opened_at, cost_basis, realized_pnl, holding_days, is_long_term,
    contract_type, direction, strike, expiration,
    notes, executed_at
  ) values (
    v_pos.user_id,
    v_pos.account_id,
    v_pos.id,
    v_pos.ticker,
    v_pos.asset_class,
    'CLOSE',
    v_close_qty_abs,
    p_close_price,
    v_multiplier,
    p_fees,
    v_gross_proceeds,
    v_net_proceeds,
    coalesce(v_pos.opened_at, v_pos.created_at),
    coalesce(v_pos.avg_cost, 0),
    v_realized_pnl,
    v_holding_days,
    v_is_long_term,
    v_pos.contract_type,
    v_pos.direction,
    v_pos.strike,
    v_pos.expiration,
    p_notes,
    p_executed_at
  ) returning * into v_tx;

  -- Credit/debit the cash row in the target account
  -- Net cash impact: long close adds net_proceeds; short close subtracts net cost paid
  -- For both, "cash delta" = (sign-adjusted) v_net_proceeds for long, -v_net_proceeds for short
  declare
    v_cash_delta numeric;
  begin
    if v_qty_signed >= 0 then
      v_cash_delta := v_net_proceeds;       -- long close: cash in
    else
      v_cash_delta := -v_net_proceeds;      -- short close: cash out (paid to buy back)
    end if;

    -- Find existing cash row in target account (use most recently updated)
    select id, coalesce(quantity, 0) into v_cash_row_id, v_new_cash_qty
    from public.positions
    where user_id    = v_pos.user_id
      and account_id = v_target_account
      and asset_class = 'cash'
      and closed_at is null
    order by updated_at desc
    limit 1;

    if v_cash_row_id is not null then
      -- Update existing cash row: quantity = amount, value = amount, price = 1
      v_new_cash_qty := v_new_cash_qty + v_cash_delta;
      update public.positions
        set quantity   = v_new_cash_qty,
            value      = v_new_cash_qty,
            price      = 1,
            avg_cost   = 1,
            updated_at = now()
      where id = v_cash_row_id;
    else
      -- Create new cash row
      insert into public.positions (
        user_id, account_id, ticker, name, asset_class, sector,
        quantity, price, avg_cost, value, sort_order, opened_at
      ) values (
        v_pos.user_id, v_target_account, 'CASH', 'CASH', 'cash', 'Cash',
        v_cash_delta, 1, 1, v_cash_delta, 9999, p_executed_at
      );
    end if;
  end;

  -- Soft-archive (full close) or reduce quantity (partial close) on the source position
  v_remaining_abs := abs(v_qty_signed) - v_close_qty_abs;
  if v_remaining_abs <= 0.0000001 then
    -- Full close
    update public.positions
      set closed_at  = p_executed_at,
          updated_at = now()
    where id = p_position_id;
  else
    -- Partial close — preserve sign on the remaining qty
    update public.positions
      set quantity   = sign(v_qty_signed) * v_remaining_abs,
          value      = sign(v_qty_signed) * v_remaining_abs * coalesce(v_pos.price, p_close_price) * v_multiplier,
          updated_at = now()
    where id = p_position_id;
  end if;

  return v_tx;
end;
$$;

-- Allow authenticated users to call the function
grant execute on function public.close_position(uuid, numeric, numeric, timestamptz, uuid, numeric, text) to authenticated;
revoke execute on function public.close_position(uuid, numeric, numeric, timestamptz, uuid, numeric, text) from anon, public;

comment on function public.close_position is
  'Phase 2 of close-position build. Atomic close: writes CLOSE row to transactions, credits/debits cash, soft-archives (full) or reduces qty (partial) on the source position. SECURITY DEFINER + auth.uid() check. Tax-lot: average cost (Joe 2026-04-27).';
