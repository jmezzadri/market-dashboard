-- ───────────────────────────────────────────────────────────────────────────
-- 012_asset_class.sql
-- ───────────────────────────────────────────────────────────────────────────
-- Task #41 — asset-type-aware positions. Adds columns so the editor can
-- distinguish Stock/ETF from Cash, Option (long/short call/put), Bond,
-- and Crypto, and carry class-specific metadata (strike, expiration, etc).
--
-- Cash is already handled in the editor via ticker='CASH' shortcutting;
-- this migration back-populates asset_class='cash' for those existing rows
-- so the new class-switcher UI picks them up cleanly. Everything else
-- defaults to 'stock'.
--
-- manual_price is a free-form current-price override. For stocks it's
-- normally null (scanner fills price). For options/bonds/crypto in V1
-- (pending a dedicated pricing feed), it's the user's manually-entered
-- current mark; the editor pipes it into positions.price so existing
-- value = quantity × price math keeps working.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.positions
  add column if not exists asset_class text not null default 'stock'
    check (asset_class in ('stock','cash','option','bond','crypto')),
  add column if not exists contract_type text
    check (contract_type is null or contract_type in ('call','put')),
  add column if not exists direction text
    check (direction is null or direction in ('long','short')),
  add column if not exists strike numeric,
  add column if not exists expiration date,
  add column if not exists multiplier integer,
  add column if not exists manual_price numeric;

-- Back-heal existing CASH rows so the new class-switcher opens them in Cash
-- mode (instead of the default Stock mode).
update public.positions
  set asset_class = 'cash'
  where upper(trim(coalesce(ticker,''))) = 'CASH'
    and asset_class = 'stock';

comment on column public.positions.asset_class is
  'One of stock/cash/option/bond/crypto. Drives editor fields + valuation semantics.';
comment on column public.positions.contract_type is
  'Options only: call | put.';
comment on column public.positions.direction is
  'Options only: long | short.';
comment on column public.positions.strike is
  'Options only: strike price per share.';
comment on column public.positions.expiration is
  'Options only: contract expiration date.';
comment on column public.positions.multiplier is
  'Options only: contract multiplier (default 100 for equity options).';
comment on column public.positions.manual_price is
  'Free-form current-price override for classes without a live scanner feed (options/bonds; crypto fallback). Stored alongside price so the display can show either.';
