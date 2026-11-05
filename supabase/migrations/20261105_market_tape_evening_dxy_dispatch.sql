-- 2026-11-05 (health sweep, bug #1278): the ICE dollar index (DXY tile, `usd`)
-- is written by fetch_history.py (INDICATOR-REFRESH), not by
-- MARKET-INDICATORS-EOD. Its settled close is only served by Yahoo between the
-- 17:00 ET settlement and the 18:00 ET reopen; after the reopen the bar is
-- folded into the new session (fetch_history._dxy_settled_only now drops it).
-- GitHub starts INDICATOR-REFRESH's 22:00Z cron hours late, so nothing read the
-- settled window. The 22:15Z pass now also dispatches INDICATOR-REFRESH when
-- `usd` is behind today's session. 22:15Z is 17:15 ET in winter; in summer
-- (18:15 EDT) it falls after the reopen, so the dispatch is gated on the New
-- York clock and summer evenings show DXY at the prior settlement.
create or replace function public.market_tape_evening_dispatch()
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  pat text;
  ny_now timestamp := (now() at time zone 'America/New_York');
  ny_today date := ny_now::date;
  dow int := extract(isodow from ny_now);
  oil_asof date; fx_asof date; usd_asof date;
  need_eod boolean; need_usd boolean;
  msg text := '';
begin
  if dow > 5 then return 'not needed: weekend in New York'; end if;
  select data_as_of::date into oil_asof from pipeline_health where indicator_id = 'cmdty_oil';
  select data_as_of::date into fx_asof  from pipeline_health where indicator_id = 'fx_eur';
  select data_as_of::date into usd_asof from pipeline_health where indicator_id = 'usd';
  need_eod := not (oil_asof >= ny_today and fx_asof >= ny_today);
  -- DXY settled window: 17:05-17:45 ET leaves the ~5 min run room before the reopen.
  need_usd := coalesce(usd_asof < ny_today, true)
              and ny_now::time >= time '17:05' and ny_now::time < time '17:45';
  if not need_eod and not need_usd then
    return format('not needed: cmdty_oil %s, fx_eur %s, usd %s', oil_asof, fx_asof, usd_asof);
  end if;
  select value into pat from ops_secrets where name = 'github_dispatch';
  if pat is null then
    raise warning 'market_tape_evening_dispatch: github_dispatch PAT missing from ops_secrets';
    return 'skipped: github_dispatch PAT missing';
  end if;
  if need_eod then
    perform net.http_post(
      url := 'https://api.github.com/repos/jmezzadri/market-dashboard/actions/workflows/MARKET-INDICATORS-EOD.yml/dispatches',
      headers := jsonb_build_object('Authorization', 'Bearer ' || pat, 'Accept', 'application/vnd.github+json',
        'User-Agent', 'macrotilt-market-tape-evening', 'Content-Type', 'application/json'),
      body := jsonb_build_object('ref', 'main'));
    msg := msg || 'dispatched MARKET-INDICATORS-EOD; ';
  end if;
  if need_usd then
    perform net.http_post(
      url := 'https://api.github.com/repos/jmezzadri/market-dashboard/actions/workflows/INDICATOR-REFRESH_7AM_WEEKDAYS.yml/dispatches',
      headers := jsonb_build_object('Authorization', 'Bearer ' || pat, 'Accept', 'application/vnd.github+json',
        'User-Agent', 'macrotilt-market-tape-evening', 'Content-Type', 'application/json'),
      body := jsonb_build_object('ref', 'main'));
    msg := msg || 'dispatched INDICATOR-REFRESH (DXY settled window); ';
  end if;
  return msg || format('cmdty_oil %s, fx_eur %s, usd %s, New York %s',
                coalesce(oil_asof::text,'none'), coalesce(fx_asof::text,'none'),
                coalesce(usd_asof::text,'none'), ny_now);
end $function$;
