-- =============================================================================
-- 087 — London Strategic Edge (LSE) live-data integration
-- -----------------------------------------------------------------------------
-- Joe approved the full LSE build 2026-07-27 after the day-1 shadow trial
-- (close parity 0.0–1.4 bps on SPY/QQQ/IWM/DIA, ~10 s bar lag, sane ATM IV).
-- Three server-side cache tables + a vault accessor for the lse-live edge
-- function, plus seeded pipeline_health rows (Hard Rule 0.1 — seeded here,
-- honestly stamped by the function's first real run; grader shows red
-- "no successful refresh" until then, never fake green).
--
-- Feeds:
--   lse_intraday  — 1-minute-bar live quotes (on-demand, market hours)
--   lse_atm_iv    — ATM implied-vol term structure (on-demand, Portfolio Lab)
--   lse_iv_scan   — daily ATM IV + cross-sectional vol rank for scanner names
--                   (pg_cron 21:50 UTC weekdays -> lse-live mode=scan_iv)
-- Data Steward sign-off: grants per template pattern below; RLS enabled.
-- =============================================================================

-- 1) Live 1m-bar quote cache (shared across all viewers; the edge function
--    is the only writer). covered=false rows are a negative cache so the
--    ~8,600 names LSE does not carry are probed at most once a day.
create table if not exists public.lse_live_quotes (
    symbol      text primary key,
    price       numeric,
    bar_ts      timestamptz,
    covered     boolean not null default true,
    fetched_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- 2) ATM implied-vol term structure cache (per underlying, one row per expiry).
create table if not exists public.lse_iv_term (
    symbol           text not null,
    expiry           date not null,
    dte              integer,
    iv               numeric,
    strike           numeric,
    underlying_price numeric,
    contract_updated_at timestamptz,
    fetched_at       timestamptz not null default now(),
    primary key (symbol, expiry)
);

-- 3) Daily scanner IV + volatility rank (written once per trading day by the
--    scan_iv cron; the Scanner table reads the latest trade_date).
create table if not exists public.lse_iv_daily (
    ticker      text not null,
    trade_date  date not null,
    atm_iv      numeric,
    dte         integer,
    expiry      date,
    strike      numeric,
    vol_rank    numeric,          -- percentile 0-100 of atm_iv across the day's covered scan names
    fetched_at  timestamptz not null default now(),
    primary key (ticker, trade_date)
);
create index if not exists ix_lse_iv_daily_date on public.lse_iv_daily(trade_date);

-- GRANTS — Pattern A for the two tables front-end reads directly
-- (lse_iv_daily: Scanner vol-rank column; lse_live_quotes: read-only fallback),
-- service-only writes everywhere (the edge function is the sole writer).
grant select on public.lse_live_quotes to anon, authenticated;
grant select on public.lse_iv_term     to anon, authenticated;
grant select on public.lse_iv_daily    to anon, authenticated;
grant all    on public.lse_live_quotes to service_role;
grant all    on public.lse_iv_term     to service_role;
grant all    on public.lse_iv_daily    to service_role;

alter table public.lse_live_quotes enable row level security;
alter table public.lse_iv_term     enable row level security;
alter table public.lse_iv_daily    enable row level security;

drop policy if exists lse_live_quotes_read on public.lse_live_quotes;
create policy lse_live_quotes_read on public.lse_live_quotes for select using (true);
drop policy if exists lse_iv_term_read on public.lse_iv_term;
create policy lse_iv_term_read on public.lse_iv_term for select using (true);
drop policy if exists lse_iv_daily_read on public.lse_iv_daily;
create policy lse_iv_daily_read on public.lse_iv_daily for select using (true);

-- 4) Vault accessor — lets the lse-live edge function (service role) read the
--    LSE API key without the key ever reaching a client or the repo.
--    Callable by service_role ONLY.
create or replace function public.get_lse_api_key()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'lse_api_key' limit 1;
$$;
revoke all on function public.get_lse_api_key() from public;
revoke all on function public.get_lse_api_key() from anon;
revoke all on function public.get_lse_api_key() from authenticated;
grant execute on function public.get_lse_api_key() to service_role;

-- 5) pipeline_health seed rows (Hard Rule 0.1 + 2026-07-21 cutover checklist).
--    last_good_at stays NULL here — the lse-live function stamps the real
--    first-run time (honest-stamp rule 4.2); until then the chip reads red
--    "no successful refresh on record", which is the truth.
--    Table checks: cadence in (D/W/M/Q/H), status in (green/amber/red).
insert into public.pipeline_health (indicator_id, label, source, cadence, expected_cadence_minutes, status, last_error)
values
  ('lse_intraday', 'Live intraday price (1-minute bars)', 'London Strategic Edge', 'H', 1,    'red', 'seeded - first run pending'),
  ('lse_atm_iv',   'ATM implied-vol term structure',      'London Strategic Edge', 'H', 30,   'red', 'seeded - first run pending'),
  ('lse_iv_scan',  'Scanner ATM IV + volatility rank',    'London Strategic Edge', 'D', 1440, 'red', 'seeded - first run pending')
on conflict (indicator_id) do nothing;
