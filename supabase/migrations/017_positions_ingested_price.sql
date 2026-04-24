-- 017_positions_ingested_price.sql
--
-- Adds public.positions.ingested_price — a stable "as uploaded" price that
-- survives manual overrides and live scanner updates. Used by the Position
-- Editor's "Revert to uploaded price" button so the user can undo a
-- mis-typed manual NAV (bug #1025 sibling issue, Joe's FXAIX test 2026-04-24)
-- without remembering what the original CSV value was.
--
-- Semantics:
--   • Written ONCE at CSV bulk-import / OAuth broker import / first-time
--     manual add — value = cost_per_share (which on fresh seed also equals
--     price, before any scanner overlay).
--   • Never mutated by the scanner. Never mutated by manual edits (the
--     editor preserves the prior value on save).
--   • Cleared only if the user deletes the row and re-adds it.
--
-- Fallback at display time: when ingested_price IS NULL (rows pre-dating
-- this column), the UI falls back to avg_cost. For mutual-fund / untracked
-- rows — the primary use case — avg_cost ≈ original upload value so the
-- fallback is informative. For scanner-covered stocks held for long
-- periods avg_cost will be the cost basis rather than the last scanner
-- price, which is the documented behaviour of the revert button (revert
-- = "undo my manual override, show what I had before I typed").
--
-- Backfill: seed ingested_price = avg_cost for every existing row so the
-- revert button works immediately on any in-flight manual override
-- (including Joe's FXAIX #1025 test).

alter table public.positions
  add column if not exists ingested_price numeric;

-- Backfill: use avg_cost as the best available proxy for the original
-- ingested price. For fresh imports these were equal; for scanner-aged
-- rows avg_cost is at worst the cost basis, which is still a more useful
-- revert target than "no value at all".
update public.positions
   set ingested_price = avg_cost
 where ingested_price is null
   and avg_cost is not null;

comment on column public.positions.ingested_price is
  'Price at initial bulk/manual import, preserved across scanner updates and manual overrides. Used by the editor''s Revert button to undo manual NAV entries. See migration 017.';
