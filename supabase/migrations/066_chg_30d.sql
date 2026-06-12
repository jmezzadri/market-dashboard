-- Migration 066 — trading_opps_signals.chg_30d_pct
-- UX Designer (lead) · Senior Quant sign-off on the definition.
--
-- The scanner table replaces the 16-close sparkline with a 30-day percent
-- change column (Joe 2026-06-11: magnitude was unreadable off the spark).
-- Definition (Senior Quant): latest close vs the close 21 TRADING days
-- earlier (~30 calendar days, the standard 1-month window). Computed by the
-- nightly producer from the same price history that builds every other
-- informational column. Display-only; not part of the score.
alter table public.trading_opps_signals
  add column if not exists chg_30d_pct numeric;

comment on column public.trading_opps_signals.chg_30d_pct is
  'Percent change: latest close vs the close 21 trading days (~30 calendar days) earlier. Display-only.';
