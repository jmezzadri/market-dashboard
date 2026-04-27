-- ============================================================================
-- 025_transactions_ledger.sql — Phase 1 of Close Position + ledger build
-- ============================================================================

-- transactions ledger
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  position_id     uuid references public.positions(id) on delete set null,
  ticker          text not null,
  asset_class     text not null
                  check (asset_class in ('stock','cash','option','bond','crypto')),
  side            text not null
                  check (side in ('BUY','SELL','OPEN','CLOSE','TRANSFER','ADJUST')),
  quantity        numeric not null,
  price           numeric not null,
  multiplier      integer not null default 1,
  fees            numeric not null default 0,
  gross_proceeds  numeric not null,
  net_proceeds    numeric not null,
  opened_at       timestamptz,
  cost_basis      numeric,
  realized_pnl    numeric,
  holding_days    integer,
  is_long_term    boolean,
  contract_type   text check (contract_type is null or contract_type in ('call','put')),
  direction       text check (direction is null or direction in ('long','short')),
  strike          numeric,
  expiration      date,
  notes           text,
  executed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_account_id_idx on public.transactions (account_id);
create index if not exists transactions_ticker_idx on public.transactions (user_id, ticker);
create index if not exists transactions_executed_at_idx on public.transactions (user_id, executed_at desc);
create index if not exists transactions_position_id_idx on public.transactions (position_id) where position_id is not null;

alter table public.transactions enable row level security;

drop policy if exists "own transactions select" on public.transactions;
create policy "own transactions select"
  on public.transactions for select using (auth.uid() = user_id);

drop policy if exists "own transactions insert" on public.transactions;
create policy "own transactions insert"
  on public.transactions for insert with check (auth.uid() = user_id);

drop policy if exists "own transactions update" on public.transactions;
create policy "own transactions update"
  on public.transactions for update using (auth.uid() = user_id);

-- positions: closed_at + opened_at for soft-archive + tax-lot
alter table public.positions
  add column if not exists closed_at timestamptz,
  add column if not exists opened_at timestamptz;

update public.positions
  set opened_at = coalesce(purchase_date::timestamptz, created_at)
  where opened_at is null;

create index if not exists positions_active_idx
  on public.positions (user_id, account_id)
  where closed_at is null;

-- Backfill BUY/OPEN rows from existing positions
insert into public.transactions (
  user_id, account_id, position_id, ticker, asset_class, side,
  quantity, price, multiplier, fees, gross_proceeds, net_proceeds,
  opened_at, cost_basis,
  contract_type, direction, strike, expiration,
  executed_at, notes
)
select
  p.user_id,
  p.account_id,
  p.id,
  p.ticker,
  p.asset_class,
  case when p.asset_class = 'cash' then 'OPEN' else 'BUY' end,
  abs(coalesce(p.quantity, 0)),
  coalesce(p.avg_cost, p.price, 1),
  coalesce(p.multiplier, case when p.asset_class = 'option' then 100 else 1 end),
  0,
  abs(coalesce(p.quantity, 0))
    * coalesce(p.avg_cost, p.price, 1)
    * coalesce(p.multiplier, case when p.asset_class = 'option' then 100 else 1 end),
  abs(coalesce(p.quantity, 0))
    * coalesce(p.avg_cost, p.price, 1)
    * coalesce(p.multiplier, case when p.asset_class = 'option' then 100 else 1 end),
  coalesce(p.opened_at, p.purchase_date::timestamptz, p.created_at),
  coalesce(p.avg_cost, p.price, 1),
  p.contract_type,
  p.direction,
  p.strike,
  p.expiration,
  coalesce(p.opened_at, p.purchase_date::timestamptz, p.created_at),
  'Backfilled from positions on ledger introduction (mig 025)'
from public.positions p
where not exists (
  select 1 from public.transactions t where t.position_id = p.id
);

-- Comments
comment on table public.transactions is
  'Trade ledger - every BUY/SELL/CLOSE/OPEN/ADJUST. Foundation for realized P&L + tax-lot tracking.';
comment on column public.positions.closed_at is
  'Set when position is closed via close_position RPC. Soft-archive - row stays for history.';
comment on column public.positions.opened_at is
  'Position open date. Holding-period anchor for tax-lot calculations on close.';
