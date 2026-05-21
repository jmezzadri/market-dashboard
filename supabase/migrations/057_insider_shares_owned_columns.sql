-- Migration 057: promote shares_owned_before / shares_owned_after to real
-- typed columns on insider_history.
-- Applied to production Supabase 2026-05-21 via Management API.
-- Source of truth — keep in sync with the live schema (see migration 047).
--
-- Why:
--   The Trading Opportunities screener's insider layer needs each insider's
--   share count before and after a trade to detect a buy that lifts the
--   insider's personal stake by 10% or more (Rule A). Those two numbers
--   were only available inside the raw JSONB blob, and
--   backtest_engine.pull_from_supabase dug them out on every run with
--   `raw->>shares_owned_before`. That works, but is fragile: if the vendor
--   blob's shape ever changes, the extraction silently returns null and
--   Rule A stops firing with no error. Promoting the two values to typed
--   columns makes the dependency explicit and a missing field loud.
--
-- Backfill: every existing row (136,938 at apply time; 133,795 carried a
--   non-null value, the remaining 3,143 had a null value in the blob) was
--   populated from the raw blob already stored on the row. No vendor API
--   calls — the blob is already in Supabase.
--
-- Owner: Data Steward
-- Consumed by:
--   scanner.signal_intelligence_v4.insider_ingest          (writes)
--   scanner.trading_opps.backtest_engine.pull_from_supabase (reads)

ALTER TABLE public.insider_history
    ADD COLUMN IF NOT EXISTS shares_owned_before BIGINT,
    ADD COLUMN IF NOT EXISTS shares_owned_after  BIGINT;

-- One-time backfill from the raw blob already stored on each row.
UPDATE public.insider_history
   SET shares_owned_before = (raw->>'shares_owned_before')::numeric::bigint,
       shares_owned_after  = (raw->>'shares_owned_after')::numeric::bigint
 WHERE raw ? 'shares_owned_before';
