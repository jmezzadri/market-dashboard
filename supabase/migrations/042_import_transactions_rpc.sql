-- ============================================================================
-- 042_import_transactions_rpc.sql — Chase broker CSV import (Joe 2026-05-04)
-- ============================================================================
-- Phase 1 of broker-transaction import flow. Adds a SECURITY DEFINER RPC
-- that takes a JSONB array of validated rows from the ImportTransactions UI
-- and inserts them into public.transactions, deduping against existing
-- ledger rows so re-uploading the same Chase export (or overlap with the
-- 4/28 YTD backfill) does not double-count.
--
-- Dedup key (matches client-side dedup_key in src/lib/chaseImporter.js):
--   account_label | ticker | executed_date (YYYY-MM-DD) | side |
--   asset_class | abs(quantity) (6 dp)
--
-- The function:
--   1. resolves account_id by matching the user's accounts.label
--      (case-insensitive). If no match, the row is reported as an error
--      with a plain-English reason and skipped.
--   2. computes the dedup key server-side and checks for an existing
--      transaction for this user with the same key (using the
--      executed_at::date AND side AND asset_class AND abs(quantity) AND
--      ticker AND account_id tuple). If found, it's reported as a
--      duplicate and skipped.
--   3. inserts every remaining row. is_long_term / realized_pnl /
--      cost_basis / holding_days come from the client only when Chase
--      filled them (year-end tax exports); otherwise NULL.
--
-- Returns:
--   { inserted: int, duplicates: int, errors: jsonb[] }
-- where errors is a list of { row_num, reason, account_label, ticker }.
--
-- Data Steward sign-off: this RPC is the one and only ingestion path for
-- broker transactions into public.transactions outside of the
-- close_position RPC. Register in data_manifest.json under
-- portfolio.transactions-broker-import.
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
  v_existing      uuid;
  v_inserted      int := 0;
  v_duplicates    int := 0;
  v_errors        jsonb := '[]'::jsonb;
  v_row_num       int;
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

    -- Resolve account_id by matching label (case-insensitive). If the user
    -- has no account by that name yet, create one.
    select id into v_account_id from public.accounts
      where user_id = v_caller and lower(label) = lower(v_account_label)
      limit 1;
    if v_account_id is null then
      insert into public.accounts (user_id, label, sub)
      values (v_caller, v_account_label, 'Brokerage')
      returning id into v_account_id;
    end if;

    -- Dedup against existing ledger rows for this user.
    select id into v_existing from public.transactions
      where user_id = v_caller
        and account_id = v_account_id
        and lower(ticker) = lower(v_ticker)
        and asset_class = v_asset_class
        and side = v_side
        and abs(quantity) = abs(v_quantity)
        and executed_at::date = v_executed_date
      limit 1;
    if v_existing is not null then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;

    insert into public.transactions (
      user_id, account_id, ticker, asset_class, side,
      quantity, price, multiplier, fees, gross_proceeds, net_proceeds,
      cost_basis, realized_pnl, holding_days, is_long_term,
      contract_type, direction, strike, expiration,
      notes, executed_at
    ) values (
      v_caller, v_account_id, upper(v_ticker), v_asset_class, v_side,
      v_quantity, v_price, v_multiplier, v_fees, v_gross, v_net,
      nullif(v_row->>'cost_basis', '')::numeric,
      nullif(v_row->>'realized_pnl', '')::numeric,
      nullif(v_row->>'holding_days', '')::int,
      case when v_row ? 'is_long_term' and (v_row->>'is_long_term') is not null
           then (v_row->>'is_long_term')::boolean else null end,
      nullif(v_row->>'contract_type', ''),
      nullif(v_row->>'direction', ''),
      nullif(v_row->>'strike', '')::numeric,
      nullif(v_row->>'expiration', '')::date,
      v_row->>'notes',
      v_executed_date::timestamptz
    );
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates, 'errors', v_errors);
end;
$$;

grant execute on function public.import_transactions(jsonb) to authenticated;
revoke execute on function public.import_transactions(jsonb) from anon, public;

comment on function public.import_transactions is
  'v1 (2026-05-04, mig 042). Batch-insert broker transactions from CSV import UI. Resolves account by label (case-insensitive, auto-creates if absent), dedups by (user_id, account_id, ticker, asset_class, side, abs(quantity), executed_at::date), returns {inserted, duplicates, errors}.';
