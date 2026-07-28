-- =============================================================================
-- 088 — LSE archive end-of-day implied vol for live-feed-uncovered names
-- -----------------------------------------------------------------------------
-- Joe approved 2026-07-28 (chat), following the skew-density study's coverage
-- sizing: the LSE research archive can supply previous-close ATM IV for names
-- the live options endpoint skips (KTOS/RCAT/HUT ~93-100% of days, PLSE 46%).
-- The skew SIGNAL itself was NO-GO (pre-registered backtest); this migration
-- carries ONLY the coverage plumbing — real archive-derived IV rows into the
-- existing lse_iv_term cache, clearly dated, replacing the CAPM fallback.
--
-- New producer: .github/workflows/LSE-ARCHIVE-IV.yml -> scripts/lse_archive_iv.py
-- (nightly 22:30 ET Mon-Fri). Edge function lse-live v8 preserves archive rows
-- when the live chain is empty (previously it overwrote them with an
-- uncovered marker on every cache expiry).
-- Data Steward sign-off: columns additive with safe defaults; existing grants
-- and RLS on lse_iv_term (087) unchanged and sufficient; health row seeded
-- red per Hard Rule 0.1 (honest stamp comes from the producer's first run).
-- =============================================================================

alter table public.lse_iv_term
    add column if not exists source text not null default 'live',
    add column if not exists as_of  date;

comment on column public.lse_iv_term.source is
  'live = vendor live chain via lse-live edge fn; archive = nightly research-archive derivation (previous close, scripts/lse_archive_iv.py)';
comment on column public.lse_iv_term.as_of is
  'For archive rows: the print date the IVs are computed from (previous close). NULL for live rows (fetched_at is their clock).';

insert into public.pipeline_health (indicator_id, label, source, cadence, expected_cadence_minutes, status, last_error)
values
  ('lse_archive_iv', 'Archive EOD implied vol (live-feed-uncovered names)', 'London Strategic Edge', 'D', 1440, 'red', 'seeded - first run pending')
on conflict (indicator_id) do nothing;
