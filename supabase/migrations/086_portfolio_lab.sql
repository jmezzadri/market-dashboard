-- 086_portfolio_lab.sql — saved portfolios for the Portfolio Lab page.
-- APPLIED to production 2026-07-27 via the Supabase migration API.
-- User-owned rows (Pattern B per 000_TEMPLATE.sql). Data Steward sign-off:
-- authenticated users get row-level CRUD on their OWN rows only; service_role
-- full access; no anon access (page is signed-in only).

create table if not exists public.portfolio_lab_portfolios (
    id          bigserial primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    name        text not null,
    -- holdings: [{ticker, weight, method, scenarios:{bull:{price,prob},base:{...},bear:{...}}}]
    holdings    jsonb not null default '[]'::jsonb,
    horizon     text not null default '1y',
    benchmark   text not null default 'SPY',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (user_id, name)
);

create index if not exists ix_portfolio_lab_portfolios_user
    on public.portfolio_lab_portfolios(user_id);

-- Grants (Pattern B: user-owned rows)
grant select, insert, update, delete on public.portfolio_lab_portfolios to authenticated;
grant usage, select on sequence public.portfolio_lab_portfolios_id_seq to authenticated;
grant all on public.portfolio_lab_portfolios to service_role;

-- Row Level Security: owner-only
alter table public.portfolio_lab_portfolios enable row level security;

create policy "lab_portfolios_select_own" on public.portfolio_lab_portfolios
    for select to authenticated using (auth.uid() = user_id);
create policy "lab_portfolios_insert_own" on public.portfolio_lab_portfolios
    for insert to authenticated with check (auth.uid() = user_id);
create policy "lab_portfolios_update_own" on public.portfolio_lab_portfolios
    for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "lab_portfolios_delete_own" on public.portfolio_lab_portfolios
    for delete to authenticated using (auth.uid() = user_id);
