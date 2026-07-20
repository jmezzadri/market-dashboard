-- 084_split_retro_adjust.sql
-- Split retro-adjustment RPCs (bug found 2026-07-20: prices_eod held mixed
-- share bases across split events — e.g. CRWD 4:1 on 2026-07-01 left pre-split
-- rows at the old basis, so any return window crossing the seam computed a
-- fake -75% day. See LESSONS 4.20).
--
-- prices_eod doctrine: the whole series for a ticker is kept on the CURRENT
-- (post-split) share basis. When a split executes, all rows BEFORE the seam
-- date are renormalized: price columns x factor, volume / factor, where
-- factor = split_from / split_to (0.25 for a 1->4 forward split; 3 for a
-- 3->1 reverse split).
--
-- Called by scripts/adjust_splits_retroactive.py from MASSIVE-DAILY after the
-- day's ingest. service_role only.

create or replace function public.apply_split_adjustment(
  p_ticker text, p_seam date, p_factor numeric
) returns integer
language plpgsql security definer as $$
declare n integer;
begin
  if p_factor is null or p_factor <= 0 then
    raise exception 'bad factor %', p_factor;
  end if;
  update public.prices_eod
     set close  = close  * p_factor,
         open   = open   * p_factor,
         high   = high   * p_factor,
         low    = low    * p_factor,
         vwap   = vwap   * p_factor,
         volume = volume / p_factor
   where ticker = p_ticker and trade_date < p_seam;
  get diagnostics n = row_count;
  return n;
end $$;

-- Single-day variant: one row landed on the wrong basis while its neighbors
-- are fine (observed on HON 2026-06-26 — the vendor's grouped feed briefly
-- reported the pre-split price between two post-split days).
create or replace function public.apply_split_adjustment_day(
  p_ticker text, p_day date, p_factor numeric
) returns integer
language plpgsql security definer as $$
declare n integer;
begin
  if p_factor is null or p_factor <= 0 then
    raise exception 'bad factor %', p_factor;
  end if;
  update public.prices_eod
     set close  = close  * p_factor,
         open   = open   * p_factor,
         high   = high   * p_factor,
         low    = low    * p_factor,
         vwap   = vwap   * p_factor,
         volume = volume / p_factor
   where ticker = p_ticker and trade_date = p_day;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.apply_split_adjustment(text, date, numeric)
  from public, anon, authenticated;
revoke execute on function public.apply_split_adjustment_day(text, date, numeric)
  from public, anon, authenticated;
grant execute on function public.apply_split_adjustment(text, date, numeric) to service_role;
grant execute on function public.apply_split_adjustment_day(text, date, numeric) to service_role;
