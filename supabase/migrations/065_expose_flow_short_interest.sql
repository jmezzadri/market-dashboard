-- Migration 065 — expose options-flow + short-interest context
-- Data Steward (lead) · consulted Senior Quant, Lead Developer, UX Designer.
--
-- Joe's 2026-06-11 ask: surface the options-flow and short-interest feeds on
-- the Trading Opportunities page (columns + drill rows) and the ticker page.
-- Three parts:
--
-- 1. CONTEXT COLUMNS on trading_opps_signals. The nightly producer copies
--    the freshest reading for each launched name out of the feed tables.
--    These are INFORMATIONAL ONLY — they never enter the score (Senior
--    Quant condition: any scored use requires a backtest first).
--
-- 2. READ EXPOSURE for the three aggregate feed tables. They were created
--    service-only; the ticker page needs per-ticker reads for ANY symbol,
--    not just launched names. These are derived per-(ticker, day) AGGREGATES
--    — same exposure class as universe_snapshots, which is already public.
--    darkpool_prints (raw vendor prints) deliberately stays service-only.
--
-- 3. PIPELINE-HEALTH SEED ROWS for the two feeds, so their freshness chips
--    are genuinely tracked from day one (the checker only updates existing
--    rows; producers upsert from this commit onward).

-- ── 1. snapshot context columns ────────────────────────────────────────────
alter table public.trading_opps_signals
  add column if not exists si_float_pct           numeric,
  add column if not exists si_days_to_cover       numeric,
  add column if not exists si_short_vol_ratio     numeric,
  add column if not exists si_cost_to_borrow_pct  numeric,
  add column if not exists si_as_of               date,
  add column if not exists flow_net_call_prem_usd numeric,
  add column if not exists flow_ask_side_share    numeric,
  add column if not exists flow_sweep_count       integer,
  add column if not exists flow_unusual_count     integer,
  add column if not exists flow_as_of             date;

comment on column public.trading_opps_signals.si_float_pct is
  'FINRA short interest as a percent of shares outstanding, 0-100 scale (e.g. 12.34 = 12.34%). Informational; not scored.';
comment on column public.trading_opps_signals.si_days_to_cover is
  'FINRA days-to-cover (short interest / avg daily volume) at the same settlement date as si_float_pct.';
comment on column public.trading_opps_signals.si_short_vol_ratio is
  'UW daily short-volume ratio, 0-1 scale (short volume / total volume on the most recent day within 7 calendar days).';
comment on column public.trading_opps_signals.si_cost_to_borrow_pct is
  'UW annualized cost-to-borrow percent at the most recent daily reading.';
comment on column public.trading_opps_signals.si_as_of is
  'as_of_date of the freshest short-interest reading used for this row (the daily table when present, else the FINRA settlement date).';
comment on column public.trading_opps_signals.flow_net_call_prem_usd is
  'Options flow-alert aggregates over the trailing-30-day window: call premium minus put premium, in dollars. Informational; not scored.';
comment on column public.trading_opps_signals.flow_ask_side_share is
  'Share of flow-alert premium that printed at the ask, 0-1 scale (ask / (ask + bid)).';
comment on column public.trading_opps_signals.flow_sweep_count is
  'Number of sweep alerts in the 30-day flow window.';
comment on column public.trading_opps_signals.flow_unusual_count is
  'Number of unusual-activity alerts in the 30-day flow window.';
comment on column public.trading_opps_signals.flow_as_of is
  'as_of_date of the options_flow_daily row used for this snapshot row.';

-- ── 2. read exposure on the aggregate feed tables ──────────────────────────
-- Grants are idempotent; policies are recreated. RLS stays ENABLED — the
-- policy allows read-only SELECT for the site keys. No write path changes.
grant select on public.options_flow_daily   to anon, authenticated;
grant select on public.short_interest       to anon, authenticated;
grant select on public.short_interest_daily to anon, authenticated;

drop policy if exists options_flow_daily_public_read on public.options_flow_daily;
create policy options_flow_daily_public_read
  on public.options_flow_daily for select
  to anon, authenticated
  using (true);

drop policy if exists short_interest_public_read on public.short_interest;
create policy short_interest_public_read
  on public.short_interest for select
  to anon, authenticated
  using (true);

drop policy if exists short_interest_daily_public_read on public.short_interest_daily;
create policy short_interest_daily_public_read
  on public.short_interest_daily for select
  to anon, authenticated
  using (true);

-- ── 3. pipeline-health seed rows (chips need an existing row) ──────────────
insert into public.pipeline_health
    (indicator_id, label, source, cadence, expected_cadence_minutes, status,
     last_good_at, last_check_at)
values
    ('equity-options_flow-daily',   'Options flow alerts (30-day window)',
     'Unusual Whales', 'D', 1440, 'green', now(), now()),
    ('equity-short_interest-daily', 'Short interest (FINRA + daily short volume)',
     'Unusual Whales', 'D', 1440, 'green', now(), now())
on conflict (indicator_id) do nothing;
