-- ============================================================================
-- 043_import_transactions_rpc_dedup_v2.sql — fix dedup gap caught on 2026-05-04 UAT
-- ============================================================================
-- v1 (mig 042) deduped only when the existing ledger row had IDENTICAL side
-- and IDENTICAL account_id. Two real-world misses surfaced when Joe ran his
-- 4/29 Chase CSV through the new flow:
--
--   1) Close-side mismatch. Trades closed via the close_position RPC are
--      written with side='CLOSE' (and opens with 'OPEN'). The Chase
--      importer writes side='SELL' (and 'BUY') because that matches the
--      cash-flow direction the user sees on the Chase statement. The
--      dedup query missed every SELL-vs-CLOSE pair (4 stock sells +
--      1 NVDA put close + 1 assignment row = 6 dupes inserted).
--
--   2) Account-id mismatch. The importer auto-creates an account by the
--      Chase label ('Self-Directed'), but Joe's existing trades for the
--      same brokerage are filed under 'Taxable'. Dedup on account_id
--      missed every overlap. Two BUY-vs-BUY rows still slipped through.
--
-- Fix: dedup on (user_id, ticker, asset_class, abs(quantity),
-- executed_at::date) — same trade, regardless of which account name the
-- user happened to use, AND regardless of whether side reads BUY/OPEN
-- or SELL/CLOSE. Side equivalence: BUY <-> OPEN, SELL <-> CLOSE.
--
-- Also returns the account_label of the matched existing row when a
-- dupe is found, so the UI can show "Already in your 'Taxable'
-- ledger" instead of the silent skip.
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

    -- Cross-account dedup with side equivalence (BUY<->OPEN, SELL<->CLOSE).
    -- Match the trade by (user, ticker, asset_class, abs(qty), date) regardless
    -- of which account label the user happened to type. Side is matched as
    -- a *direction equivalence class* — buys and opens are both "money out",
    -- sells and closes are both "money in".
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
        'row_num', v_row_num,
        'ticker', v_ticker,
        'date', v_executed_date,
        'existing_account', v_existing_acct
      );
      continue;
    end if;

    -- No existing row anywhere. Resolve / auto-create the account.
    select id into v_account_id from public.accounts
      where user_id = v_caller and lower(label) = lower(v_account_label)
      limit 1;
    if v_account_id is null then
      insert into public.accounts (user_id, label, sub)
      values (v_caller, v_account_label, 'Brokerage')
      returning id into v_account_id;
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

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates, 'dup_details', v_dup_details, 'errors', v_errors);
end;
$$;

grant execute on function public.import_transactions(jsonb) to authenticated;
revoke execute on function public.import_transactions(jsonb) from anon, public;

comment on function public.import_transactions is
  'v2 (2026-05-04, mig 043). Cross-account, side-equivalent dedup: matches BUY<->OPEN and SELL<->CLOSE on same (user, ticker, asset_class, abs(qty), date) regardless of which account label the user typed. Returns dup_details so UI can show which existing account already has the row.';
