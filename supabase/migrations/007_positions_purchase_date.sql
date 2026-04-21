-- Migration 007 — positions.purchase_date
--
-- Adds an optional purchase_date column to positions so the user can record
-- when they acquired each lot. Not enforced (nullable), not used for any
-- calculation yet — it's surfaced in PositionEditor + BulkImport so the data
-- gets captured going forward. Downstream analytics (hold-period weighting,
-- tax-lot display, realized vs. unrealized) can read it later without another
-- migration.
--
-- Safe to re-run: `add column if not exists` is idempotent in Postgres 12+.

alter table public.positions
  add column if not exists purchase_date date;

-- No index: we never filter or sort by this column at scale. If that changes,
-- add a per-user (user_id, purchase_date) index.

-- No default backfill: existing rows stay NULL until the user edits them.
