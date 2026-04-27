-- ───────────────────────────────────────────────────────────────────────────
-- 023_portfolio_history.sql
-- ───────────────────────────────────────────────────────────────────────────
-- Per-user, per-account monthly NAV + flow + return history. Feeds the
-- Portfolio Insights tab's true period returns (1W / 1M / YTD / TTM) and
-- the home tile 04 summary. Aggregate-first TWR rollup (sum NAVs and flows
-- across accounts at each as_of, then chain) — see the implementation
-- discussion 2026-04-27 with Joe (we explicitly chose this over
-- weighted-average of per-account TWRs because of weight-shift bias).
--
-- Schema design notes:
--   • Keyed at the account level so multi-broker rollup works cleanly
--     (Chase + Fidelity + future brokers). Cross-account transfers net out
--     when we sum at the same as_of date.
--   • account_id is nullable so rows can be seeded for "external" accounts
--     not yet in public.accounts. account_label is always populated for
--     portability.
--   • nav: absolute portfolio value at end-of-period (Chase has this from
--     statements; Fidelity statements give returns instead).
--   • monthly_return: pre-computed TWR for the period if the broker
--     supplies it (Fidelity does). Stored as decimal (0.0628 = +6.28%).
--   • contributions / withdrawals: net flows during the period, used by
--     the TWR engine when nav is the input.
--   • source: provenance string for each row ('chase_2026_04', etc).
--
-- Two patterns the table supports:
--   1) NAV pattern — given nav, contributions, withdrawals each month, the
--      reader computes Modified Dietz / TWR.
--   2) RETURN pattern — given monthly_return directly, the reader chains
--      it. (Fidelity gives this for tax-advantaged accounts where
--      contribution timing is harder to establish month-to-month.)
--
-- Both patterns coexist; tile 04 uses whichever is present per row.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.portfolio_history (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  account_id       uuid        references public.accounts(id) on delete set null,
  account_label    text        not null,                 -- denorm for portability
  as_of            date        not null,                 -- typically month-end
  nav              numeric,                              -- absolute NAV at as_of
  contributions    numeric     not null default 0,       -- period inflows
  withdrawals      numeric     not null default 0,       -- period outflows
  monthly_return   numeric,                              -- pre-computed TWR (decimal)
  source           text        not null,                 -- provenance string
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, account_label, as_of)
);

create index if not exists portfolio_history_user_asof_idx
  on public.portfolio_history (user_id, as_of);

create index if not exists portfolio_history_user_account_idx
  on public.portfolio_history (user_id, account_id, as_of);

-- updated_at trigger
create or replace function public.touch_portfolio_history()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_portfolio_history_touch on public.portfolio_history;
create trigger trg_portfolio_history_touch
  before update on public.portfolio_history
  for each row execute function public.touch_portfolio_history();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.portfolio_history enable row level security;

drop policy if exists "portfolio_history user_select_own" on public.portfolio_history;
create policy "portfolio_history user_select_own"
  on public.portfolio_history for select
  using (auth.uid() = user_id);

drop policy if exists "portfolio_history user_insert_own" on public.portfolio_history;
create policy "portfolio_history user_insert_own"
  on public.portfolio_history for insert
  with check (auth.uid() = user_id);

drop policy if exists "portfolio_history user_update_own" on public.portfolio_history;
create policy "portfolio_history user_update_own"
  on public.portfolio_history for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "portfolio_history user_delete_own" on public.portfolio_history;
create policy "portfolio_history user_delete_own"
  on public.portfolio_history for delete
  using (auth.uid() = user_id);

comment on table public.portfolio_history is
  'Per-user per-account monthly NAV/flow/return history. See migration 023.';
