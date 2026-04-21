-- ───────────────────────────────────────────────────────────────────────────
-- 010_rename_shares_to_quantity.sql
-- ───────────────────────────────────────────────────────────────────────────
-- Rename positions.shares → positions.quantity for asset-type-agnostic naming.
-- Aligns with forthcoming asset-type-aware editor (Task #41) where "shares"
-- is accurate for equities but misleading for bonds (face value), crypto
-- (units), and cash (dollars). "quantity" is the generic unit-agnostic name.
--
-- Metadata-only operation in PostgreSQL — O(1), no table rewrite, no data
-- loss. Safe to run in production.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.positions rename column shares to quantity;

comment on column public.positions.quantity is
  'Unit-agnostic amount. For equities: share count. For cash: dollar balance. For bonds/other: asset-type-appropriate quantity.';

comment on column public.positions.value is
  'Denormalized: quantity × price (for equities) or quantity (for cash-denominated assets).';
