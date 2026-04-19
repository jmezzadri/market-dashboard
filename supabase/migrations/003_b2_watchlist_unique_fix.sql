-- ============================================================================
-- Track B2 — Fix watchlist unique constraint for upsert onConflict target
-- ============================================================================
-- The onboarding panel does:
--   supabase.from("watchlist").upsert(rows, { onConflict: "user_id,ticker" })
-- which PostgREST translates into ON CONFLICT (user_id, ticker).
--
-- Migration 001 created the uniqueness guard as a FUNCTIONAL index on
-- (user_id, upper(ticker)). Postgres requires the ON CONFLICT target to match
-- a unique constraint or index EXACTLY, and a plain column list does not
-- match an expression index — so the upsert errors with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Fix: drop the expression index and replace it with a plain UNIQUE index on
-- (user_id, ticker). Client code already normalizes tickers to uppercase
-- before insert (OnboardingPanel.jsx parseTickerBlob -> toUpperCase), so the
-- upper() wrapper was redundant defense.
--
-- Safe to re-run.
-- ============================================================================

drop index if exists public.watchlist_user_ticker_uniq;

create unique index if not exists watchlist_user_ticker_uniq
  on public.watchlist (user_id, ticker);
