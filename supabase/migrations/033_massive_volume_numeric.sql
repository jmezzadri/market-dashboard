-- ============================================================================
-- Migration 033 — widen prices_eod.volume + transactions to numeric
-- ============================================================================
-- Why
-- ---
-- Migration 032 declared volume as bigint, but Massive's Daily Market
-- Summary returns fractional aggregate volumes (e.g. "35182.90423") for
-- some tickers — this happens when the underlying minute bars include
-- fractional-share trades, and the daily aggregate is the sum of those
-- minute volumes.  The first ingest run failed on PostgreSQL error 22P02
-- "invalid input syntax for type bigint: '35182.90423'".
--
-- Fix: widen both volume and transactions to numeric, which is
-- non-destructive (any bigint value is also a valid numeric value) and
-- additive in PostgREST terms.
-- ============================================================================

ALTER TABLE public.prices_eod
  ALTER COLUMN volume TYPE numeric USING volume::numeric;

ALTER TABLE public.prices_eod
  ALTER COLUMN transactions TYPE numeric USING transactions::numeric;
