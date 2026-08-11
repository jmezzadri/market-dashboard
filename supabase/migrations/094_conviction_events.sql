-- 094_conviction_events.sql
-- Conviction Events paper-trading engine — data layer.
--
-- One book replacing the two retired sleeves (Insider Conviction + Momentum,
-- both frozen 2026-08-10 pending the full strategy reset). The Conviction
-- Events engine (paper_portfolio/conviction.py) trades aggregated open-market
-- insider-buy events (Form 4 code P, >= $250K per ticker+filing_date, 10b5-1
-- excluded) and stores its book in the existing paper_* tables under the
-- Sleeve B slot. This migration adds ONLY the two engine-owned tables plus
-- the constraint widening the shared paper tables need to accept the new
-- signal source.
--
-- DO NOT APPLY from a feature branch — the lead applies this at cutover,
-- together with scripts/ce_reset_epoch.py (see the cutover runbook).
--
-- Data contract (UI builds against this — column list is locked):
--   ce_events       one row per scanned (ticker, filing_date) event with the
--                   gate verdict, the action taken, and the trade lifecycle.
--   ce_kill_switch  single-row pre-registered kill-switch state.

BEGIN;

-- 1) ce_events ---------------------------------------------------------------
create table if not exists public.ce_events (
  id                bigserial primary key,
  filing_date       date not null,
  ticker            text not null,
  total_usd         numeric,
  insider_names     text,
  n_insiders        int,
  is_edgar_sourced  boolean,
  passed_gates      boolean,
  gate_fail_reason  text,
  above_sma50       boolean,
  action            text check (action in
                      ('entered', 'skipped_full', 'skipped_gate',
                       'skipped_dup', 'blocked_kill_switch')),
  entered_at        timestamptz,
  entry_qty         numeric,
  entry_price       numeric,
  exit_due_date     date,
  exited_at         timestamptz,
  exit_price        numeric,
  trade_return      numeric,
  created_at        timestamptz default now()
);

-- An EVENT is defined per (ticker, filing_date) — one row each, ever. The
-- unique index is what makes redundant morning fires idempotent (insert ...
-- on conflict do nothing).
create unique index if not exists ux_ce_events_ticker_filing
  on public.ce_events (ticker, filing_date);

-- Open-position lookups (slot counting + exits due) and the UI's event feed.
create index if not exists idx_ce_events_open
  on public.ce_events (exit_due_date)
  where action = 'entered' and exited_at is null;
create index if not exists idx_ce_events_filing_date
  on public.ce_events (filing_date desc);

-- GRANTS (template pattern A — public read like the scan tables; writes via
-- service_role only). LESSONS 6.10: explicit grants on every new public table.
grant select on public.ce_events to anon, authenticated;
grant all    on public.ce_events to service_role;

alter table public.ce_events enable row level security;
drop policy if exists ce_events_read on public.ce_events;
create policy ce_events_read on public.ce_events
  for select using (true);
-- writes: service_role only (bypasses RLS); no insert/update policies.

-- 2) ce_kill_switch ----------------------------------------------------------
-- Pre-registered, in-engine kill switch. SINGLE-ROW state (id locked to 1).
-- After each close the kill-check phase recomputes book-vs-SPY since the new
-- inception and max drawdown from the book's peak, and upserts this row.
-- Trip condition (evaluated in paper_portfolio/conviction.py):
--   (>= 40 trading days since inception AND book trails SPY by >= 10 pts)
--   OR (drawdown from peak >= 15%).
-- Tripped state LATCHES — only a human resets it (update tripped = false).
create table if not exists public.ce_kill_switch (
  id            integer primary key default 1 check (id = 1),
  tripped       boolean not null default false,
  tripped_at    timestamptz,
  reason        text,
  book_return   numeric,
  spy_return    numeric,
  max_drawdown  numeric,
  checked_at    timestamptz
);

insert into public.ce_kill_switch (id, tripped)
values (1, false)
on conflict (id) do nothing;

grant select on public.ce_kill_switch to anon, authenticated;
grant all    on public.ce_kill_switch to service_role;

alter table public.ce_kill_switch enable row level security;
drop policy if exists ce_kill_switch_read on public.ce_kill_switch;
create policy ce_kill_switch_read on public.ce_kill_switch
  for select using (true);
-- writes: service_role only (bypasses RLS); no insert/update policies.

-- 3) Shared paper tables: accept the new signal source -----------------------
-- The Conviction book reuses paper_orders / paper_signal_capture (Sleeve B
-- slot); their signal_source CHECKs must accept 'conviction_events'.
-- Widening only — no data rewritten (same pattern as migration 080).
alter table public.paper_orders
  drop constraint if exists paper_orders_signal_source_check;
alter table public.paper_orders
  add constraint paper_orders_signal_source_check
  check (signal_source in
         ('asset_tilt', 'equity_scanner', 'momentum', 'conviction_events'));

alter table public.paper_signal_capture
  drop constraint if exists paper_signal_capture_signal_source_check;
alter table public.paper_signal_capture
  add constraint paper_signal_capture_signal_source_check
  check (signal_source in
         ('asset_tilt', 'equity_scanner', 'momentum', 'conviction_events'));

COMMIT;
