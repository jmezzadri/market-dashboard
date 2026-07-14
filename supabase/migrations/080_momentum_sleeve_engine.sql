-- 080_momentum_sleeve_engine.sql
-- Two-Sleeve build PR-2 (engine). Widens the paper-trading tables to accept
-- the Momentum sleeve marker 'M' and the 'momentum' signal source, and adds
-- the per-sleeve capital column for the Momentum sleeve (default 0 = dark;
-- the flag-on PR sets 500000/500000 per Joe's locked decision 2026-07-14).
-- Additive + widening only -- no data rewritten, fully reversible.

-- 1) paper_orders: sleeve 'M' + signal_source 'momentum'
alter table public.paper_orders drop constraint if exists paper_orders_sleeve_check;
alter table public.paper_orders add constraint paper_orders_sleeve_check
  check (sleeve in ('A', 'B', 'M'));
alter table public.paper_orders drop constraint if exists paper_orders_signal_source_check;
alter table public.paper_orders add constraint paper_orders_signal_source_check
  check (signal_source in ('asset_tilt', 'equity_scanner', 'momentum'));

-- 2) paper_fills: sleeve 'M'
alter table public.paper_fills drop constraint if exists paper_fills_sleeve_check;
alter table public.paper_fills add constraint paper_fills_sleeve_check
  check (sleeve in ('A', 'B', 'M'));

-- 3) paper_positions: sleeve 'M'
alter table public.paper_positions drop constraint if exists paper_positions_sleeve_check;
alter table public.paper_positions add constraint paper_positions_sleeve_check
  check (sleeve in ('A', 'B', 'M'));

-- 4) paper_signal_capture: 'momentum' source
alter table public.paper_signal_capture drop constraint if exists paper_signal_capture_signal_source_check;
alter table public.paper_signal_capture add constraint paper_signal_capture_signal_source_check
  check (signal_source in ('asset_tilt', 'equity_scanner', 'momentum'));

-- 5) paper_accounts: Momentum sleeve capital. 0 = sleeve dark (engine no-ops).
alter table public.paper_accounts
  add column if not exists sleeve_m_allocation numeric not null default 0;
