-- 079_momentum_sleeve.sql
-- Momentum sleeve data layer (Two-Sleeve build PR-1; spec approved 2026-07-14,
-- MOMENTUM_SLEEVE_BUILD_SPEC.md). Adds: momentum_list (monthly ranked list),
-- momentum_guard (daily SPY vs 200-day crash-guard status), red-honest
-- pipeline_health seed rows.
-- Producers: MOMENTUM-LIST-MONTHLY.yml -> scripts/compute_momentum_list.py
--            DIVERGENCE_SCAN_DAILY.yml (guard step) -> scripts/update_momentum_guard.py
-- Data Steward: manifest elements equity-momentum_list-monthly +
-- market-momentum_guard-daily registered in BOTH manifests (root + public)
-- and pipeline_schedule.yml in this same PR.

-- 1) Monthly ranked list ------------------------------------------------------
-- Append-only across rebalance_dates; delete+rewrite within a rebalance_date
-- (the divergence_scan pattern; every fire idempotent).
create table if not exists public.momentum_list (
  rebalance_date      date        not null,  -- panel-complete day the ranks were computed on
  rank                integer     not null,
  ticker              text        not null,
  name                text,
  ret_12_1            numeric     not null,  -- total return t-252 -> t-21 trading days (12-1 momentum)
  adv_usd             numeric,               -- 45-day avg dollar volume at rebalance
  guard_exposed       boolean     not null,  -- SPY close >= 200-day avg at rebalance (same for all rows of a date)
  insider_badge       boolean     not null default false, -- >=1 officer/director open-market buyer, trailing 90d, filing-date basis; display info only
  next_rebalance_date date,                  -- expected next monthly publish
  created_at          timestamptz not null default now(),
  primary key (rebalance_date, ticker)
);

create index if not exists idx_momentum_list_date_rank
  on public.momentum_list (rebalance_date desc, rank);

grant select on public.momentum_list to anon, authenticated;
grant all    on public.momentum_list to service_role;

alter table public.momentum_list enable row level security;
drop policy if exists momentum_list_read on public.momentum_list;
create policy momentum_list_read on public.momentum_list
  for select using (true);
-- writes: service_role only (bypasses RLS); no insert/update policies.

-- 2) Daily crash-guard status --------------------------------------------------
-- One row per evaluated trading day. The list is monthly but the
-- cash/invested flag must never be a month stale (spec: guard refreshes daily).
create table if not exists public.momentum_guard (
  as_of      date        not null primary key,  -- SPY close date evaluated
  spy_close  numeric     not null,
  sma_200    numeric     not null,              -- 200-day simple average of SPY closes
  invested   boolean     not null,              -- spy_close >= sma_200
  flipped    boolean     not null default false, -- state changed vs previous row
  created_at timestamptz not null default now()
);

grant select on public.momentum_guard to anon, authenticated;
grant all    on public.momentum_guard to service_role;

alter table public.momentum_guard enable row level security;
drop policy if exists momentum_guard_read on public.momentum_guard;
create policy momentum_guard_read on public.momentum_guard
  for select using (true);

-- 3) SPY close series helper (producer-only) -----------------------------------
-- Last p_n SPY closes up to p_as_of, oldest-first. Used by both producers for
-- the 200-day guard; avoids pulling bars through the generic paged path.
create or replace function public.momentum_spy_closes(p_as_of date, p_n int default 200)
returns table(trade_date date, close numeric)
language sql stable as $$
  select trade_date, close from (
    select trade_date, close
    from public.prices_eod
    where ticker = 'SPY' and trade_date <= p_as_of and close is not null
    order by trade_date desc
    limit p_n
  ) t order by trade_date
$$;

revoke execute on function public.momentum_spy_closes(date, int) from public, anon, authenticated;
grant execute on function public.momentum_spy_closes(date, int) to service_role;

-- 4) pipeline_health seed rows (red-honest; checker only updates EXISTING rows;
--    first verified publish stamps green — stamp-after-publish rule).
insert into public.pipeline_health
  (indicator_id, label, source, cadence, expected_cadence_minutes, status, last_error)
values
  ('momentum_list',  'Momentum sleeve list',        'momentum_list',  'M', 44640, 'red', 'awaiting first producer run'),
  ('momentum_guard', 'Momentum crash guard (SPY)',  'momentum_guard', 'D', 1440,  'red', 'awaiting first producer run')
on conflict (indicator_id) do nothing;
