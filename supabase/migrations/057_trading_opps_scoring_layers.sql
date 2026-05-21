-- Migration 057 — trading_opps_signals: dark-pool + options scoring layers
-- Senior Quant (lead) · consulted Lead Developer, Data Steward, UX Designer.
--
-- Activates the two dormant scoring layers of the Trading Opportunities
-- screener. The raw data (darkpool_prints, options_eod_daily) was already
-- ingested nightly; this migration adds the columns the producer needs to
-- publish their per-layer point contributions, plus the columns that make
-- a scoring-method change visible on the page.
--
--   dark_pool_pts           — points the dark-pool layer contributed (0/1/2)
--   options_pts             — points the options layer contributed (0/3/4)
--   scoring_version         — the scoring version this row was computed under;
--                             lets the page flag score history that straddles
--                             a scoring change as not like-for-like
--   score_1w_like_for_like  — true when the 1-week-ago score was computed
--                             under the SAME scoring version as this row
--   score_1m_like_for_like  — same, for the 1-month-ago score
--
-- All columns are nullable with no default, so this is a metadata-only
-- change (no table rewrite). Existing rows keep NULLs — correct, they were
-- scored under the previous 5-point method. The table-level GRANT SELECT to
-- anon/authenticated already covers columns added later.

alter table public.trading_opps_signals
  add column if not exists dark_pool_pts          numeric,
  add column if not exists options_pts            numeric,
  add column if not exists scoring_version        text,
  add column if not exists score_1w_like_for_like boolean,
  add column if not exists score_1m_like_for_like boolean;

comment on column public.trading_opps_signals.dark_pool_pts is
  'Points contributed by the dark-pool layer (0/1/2). Live since 2026-05-21.';
comment on column public.trading_opps_signals.options_pts is
  'Points contributed by the options layer (0/3/4). Live since 2026-05-21.';
comment on column public.trading_opps_signals.scoring_version is
  'Scoring version this snapshot was computed under (calibrated_config.json scoring_version).';
comment on column public.trading_opps_signals.score_1w_like_for_like is
  'True when score_1w was computed under the same scoring_version as this row.';
comment on column public.trading_opps_signals.score_1m_like_for_like is
  'True when score_1m was computed under the same scoring_version as this row.';

comment on table public.trading_opps_signals is
  'Nightly Trading Opportunities screener results — dated daily snapshots, append-only. Score is out of 10 (insider + trend + dark-pool + options); launches when the insider+trend gate reaches 3. Producer: screener-trading-opps-daily.';
