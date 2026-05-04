-- ============================================================================
-- 044_import_transactions_applies_positions.sql — fix bug Joe caught 2026-05-04
-- ============================================================================
-- v1 / v2 (mig 042 / 043) of import_transactions only wrote ledger rows.
-- The positions table never moved. Joe imported his Apr 29 Chase sells of
-- MP / OXY / RCAT and the Trade History showed them but the Positions
-- table still showed those tickers as held + the cash row still showed a
-- $45K margin debit that should have been paid down by the sale proceeds.
-- One-off SQL fix already applied for the historical rows (closed those 3
-- positions, moved CASH from -$45,688 to +$35,153, set realized_pnl on
-- the SELLs).
--
-- v3 fix: every import now applies position deltas in the SAME transaction
-- as the ledger insert. Mirrors the close_position RPC pattern (mig 027).
--
--   STOCK BUY  → if ticker already exists active in same account: increase
--                quantity, recompute weighted avg_cost. Else: create new
--                position with avg_cost = trade price.
--   STOCK SELL → reduce quantity. If goes to zero (or near-zero), set
--                closed_at = NOW. Recompute realized_pnl = (price - avg_cost)
--                × qty_sold ; is_long_term from holding_days from opened_at.
--                Inserted row gets realized_pnl + cost_basis populated.
--   CASH       → adjust the account's cash position by gross_proceeds with
--                proper sign (BUY = -, SELL = +). If no cash position
--                exists, create one with value = delta.
--
-- Skipped for v3 (filed as follow-ups):
--   • OPTION OPEN/CLOSE — needs more careful direction (long/short)
--     position tracking. For now option trades are still ledger-only and
--     log a notice in the response (the user is told to manually adjust
--     option positions).
--   • Option assignments (the underlying-stock leg of an exercised
--     option) — ledger only.
--
-- Backwards-compatible: signature unchanged from v2. Returns a slightly
-- richer JSONB { inserted, duplicates, dup_details, errors,
-- positions_touched, options_warnings }.
-- ============================================================================

create or replace function public.import_transactions(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller        uuid := auth.uid();
  v_row           jsonb;
  v_account_id    uuid;
  v_account_label text;
  v_ticker        text;
  v_asset_class   text;
  v_side          text;
  v_quantity      numeric;
  v_price         numeric;
  v_multiplier    integer;
  v_fees          numeric;
  v_gross         numeric;
  v_net           numeric;
  v_executed_date date;
  v_existing_id   uuid;
  v_existing_acct text;
  v_inserted      int := 0;
  v_duplicates    int := 0;
  v_dup_details   jsonb := '[]'::jsonb;
  v_errors        jsonb := '[]'::jsonb;
  v_positions_touched int := 0;
  v_options_warnings  int := 0;
  v_row_num       int;

  -- per-row position-mutation locals
  v_pos_id        uuid;
  v_pos_qty       numeric;
  v_pos_avgcost   numeric;
  v_pos_opened    timestamptz;
  v_new_qty       numeric;
  v_new_avgcost   numeric;
  v_realized_pnl  numeric;
  v_cost_basis    numeric;
  v_holding_days  int;
  v_is_long_term  boolean;
  v_cash_id       uuid;
  v_cash_qty      numeric;
  v_cash_delta    numeric;
  v_tx_id         uuid;
begin
  if v_caller is null then
    raise exception 'import_transactions: not authenticated';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_transactions: p_rows must be a JSON array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_row_num := coalesce((v_row->>'row_num')::int, 0);
    v_account_label := coalesce(v_row->>'account_label', '');
    v_ticker := coalesce(v_row->>'ticker', '');
    v_asset_class := coalesce(v_row->>'asset_class', '');
    v_side := coalesce(v_row->>'side', '');
    v_quantity := nullif(v_row->>'quantity', '')::numeric;
    v_price := nullif(v_row->>'price', '')::numeric;
    v_multiplier := coalesce(nullif(v_row->>'multiplier', '')::int, 1);
    v_fees := coalesce(nullif(v_row->>'fees', '')::numeric, 0);
    v_gross := nullif(v_row->>'gross_proceeds', '')::numeric;
    v_net := nullif(v_row->>'net_proceeds', '')::numeric;
    v_executed_date := nullif(v_row->>'executed_at', '')::date;

    if v_account_label = '' or v_ticker = '' or v_asset_class = '' or v_side = '' or v_quantity is null or v_executed_date is null then
      v_errors := v_errors || jsonb_build_object(
        'row_num', v_row_num,
        'reason', 'Missing required field (account, ticker, asset_class, side, quantity, or executed_at).',
        'account_label', v_account_label, 'ticker', v_ticker
      );
      continue;
    end if;

    -- Cross-account dedup with side equivalence (v2 behavior preserved)
    select t.id, a.label into v_existing_id, v_existing_acct
      from public.transactions t
      join public.accounts a on a.id = t.account_id
      where t.user_id = v_caller
        and lower(t.ticker) = lower(v_ticker)
        and t.asset_class = v_asset_class
        and abs(t.quantity) = abs(v_quantity)
        and t.executed_at::date = v_executed_date
        and (
          (v_side in ('BUY','OPEN')   and t.side in ('BUY','OPEN'))
          or
          (v_side in ('SELL','CLOSE') and t.side in ('SELL','CLOSE'))
        )
      order by t.created_at asc
      limit 1;
    if v_existing_id is not null then
      v_duplicates := v_duplicates + 1;
      v_dup_details := v_dup_details || jsonb_build_object(
        'row_num', v_row_num, 'ticker', v_ticker,
        'date', v_executed_date, 'existing_account', v_existing_acct
      );
      continue;
    end if;

    -- Resolve / auto-create the account
    select id into v_account_id from public.accounts
      where user_id = v_caller and lower(label) = lower(v_account_label)
      limit 1;
    if v_account_id is null then
      insert into public.accounts (user_id, label, sub)
      values (v_caller, v_account_label, 'Brokerage')
      returning id into v_account_id;
    end if;

    -- ─── STOCK side: apply to positions table + compute realized_pnl ────
    v_realized_pnl := nullif(v_row->>'realized_pnl', '')::numeric;
    v_cost_basis := nullif(v_row->>'cost_basis', '')::numeric;
    v_holding_days := nullif(v_row->>'holding_days', '')::int;
    v_is_long_term := case when v_row ? 'is_long_term' and (v_row->>'is_long_term') is not null
                          then (v_row->>'is_long_term')::boolean else null end;

    if v_asset_class = 'stock' and v_side = 'BUY' then
      -- find an active position for the same ticker in the resolved account
      select id, quantity, coalesce(avg_cost, price, 0), opened_at
        into v_pos_id, v_pos_qty, v_pos_avgcost, v_pos_opened
        from public.positions
        where account_id = v_account_id and upper(ticker) = upper(v_ticker)
          and asset_class = 'stock' and closed_at is null
        for update
        limit 1;
      if v_pos_id is not null then
        v_new_qty := v_pos_qty + v_quantity;
        v_new_avgcost := ((v_pos_qty * v_pos_avgcost) + (v_quantity * v_price)) / nullif(v_new_qty, 0);
        update public.positions
          set quantity = v_new_qty,
              avg_cost = v_new_avgcost,
              value = v_new_qty * coalesce(price, v_price)
          where id = v_pos_id;
      else
        -- new position
        insert into public.positions (
          user_id, account_id, ticker, name, asset_class, quantity, price,
          avg_cost, value, sort_order, opened_at, purchase_date
        ) values (
          v_caller, v_account_id, upper(v_ticker), upper(v_ticker), 'stock', v_quantity, v_price,
          v_price, v_quantity * v_price, 9999, v_executed_date::timestamptz, v_executed_date
        );
      end if;
      v_cash_delta := -coalesce(v_gross, v_quantity * v_price);
      v_positions_touched := v_positions_touched + 1;

    elsif v_asset_class = 'stock' and v_side = 'SELL' then
      select id, quantity, coalesce(avg_cost, price, 0), opened_at
        into v_pos_id, v_pos_qty, v_pos_avgcost, v_pos_opened
        from public.positions
        where account_id = v_account_id and upper(ticker) = upper(v_ticker)
          and asset_class = 'stock' and closed_at is null
        for update
        limit 1;
      if v_pos_id is not null then
        -- compute realized P&L from existing avg_cost
        if v_realized_pnl is null then
          v_realized_pnl := (v_price - v_pos_avgcost) * v_quantity;
          v_cost_basis := v_pos_avgcost * v_quantity;
        end if;
        if v_holding_days is null and v_pos_opened is not null then
          v_holding_days := greatest(0, (v_executed_date - v_pos_opened::date));
          v_is_long_term := v_holding_days > 365;
        end if;
        v_new_qty := v_pos_qty - v_quantity;
        if v_new_qty <= 0.0000001 then
          update public.positions set closed_at = v_executed_date::timestamptz where id = v_pos_id;
        else
          update public.positions
            set quantity = v_new_qty,
                value = v_new_qty * coalesce(price, v_price)
            where id = v_pos_id;
        end if;
      end if;
      v_cash_delta := coalesce(v_gross, v_quantity * v_price);
      v_positions_touched := v_positions_touched + 1;

    elsif v_asset_class = 'option' then
      -- Option open/close not yet auto-applied (filed as follow-up). Ledger
      -- row still inserts; cash still moves; user has to adjust option
      -- positions manually for now.
      if v_side in ('BUY','OPEN') then
        v_cash_delta := -coalesce(v_gross, v_quantity * v_price);
      else
        v_cash_delta := coalesce(v_gross, v_quantity * v_price);
      end if;
      v_options_warnings := v_options_warnings + 1;

    else
      -- unknown asset class — only ledger insert + cash move
      if v_side in ('BUY','OPEN') then
        v_cash_delta := -coalesce(v_gross, v_quantity * v_price);
      else
        v_cash_delta := coalesce(v_gross, v_quantity * v_price);
      end if;
    end if;

    -- ─── CASH side: move the account's cash row ──────────────────────────
    if v_cash_delta is not null and v_cash_delta <> 0 then
      select id, quantity into v_cash_id, v_cash_qty
        from public.positions
        where account_id = v_account_id and asset_class = 'cash'
          and closed_at is null
        for update
        limit 1;
      if v_cash_id is not null then
        update public.positions
          set quantity = v_cash_qty + v_cash_delta,
              value = (v_cash_qty + v_cash_delta) * 1
          where id = v_cash_id;
      else
        insert into public.positions (
          user_id, account_id, ticker, name, asset_class, sector,
          quantity, price, avg_cost, value, sort_order, opened_at
        ) values (
          v_caller, v_account_id, 'CASH', 'CASH', 'cash', 'Cash',
          v_cash_delta, 1, 1, v_cash_delta, 9999, v_executed_date::timestamptz
        );
      end if;
    end if;

    -- ─── LEDGER insert (this happens AFTER position math so realized_pnl
    --     can come from the position's avg_cost) ───────────────────────────
    insert into public.transactions (
      user_id, account_id, ticker, asset_class, side,
      quantity, price, multiplier, fees, gross_proceeds, net_proceeds,
      cost_basis, realized_pnl, holding_days, is_long_term,
      contract_type, direction, strike, expiration,
      notes, executed_at
    ) values (
      v_caller, v_account_id, upper(v_ticker), v_asset_class, v_side,
      v_quantity, v_price, v_multiplier, v_fees, v_gross, v_net,
      v_cost_basis, v_realized_pnl, v_holding_days, v_is_long_term,
      nullif(v_row->>'contract_type', ''),
      nullif(v_row->>'direction', ''),
      nullif(v_row->>'strike', '')::numeric,
      nullif(v_row->>'expiration', '')::date,
      v_row->>'notes',
      v_executed_date::timestamptz
    ) returning id into v_tx_id;
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'dup_details', v_dup_details,
    'errors', v_errors,
    'positions_touched', v_positions_touched,
    'options_warnings', v_options_warnings
  );
end;
$$;

grant execute on function public.import_transactions(jsonb) to authenticated;
revoke execute on function public.import_transactions(jsonb) from anon, public;

comment on function public.import_transactions is
  'v3 (2026-05-04, mig 044). Stock BUY/SELL now atomically applies the position delta + moves cash + computes realized_pnl from existing avg_cost (matching close_position RPC behavior). Option trades still ledger-only (filed as follow-up). Returns {inserted, duplicates, dup_details, errors, positions_touched, options_warnings}.';
