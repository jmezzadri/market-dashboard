-- Market-tape EVENING dispatch (2026-11-02, Joe: "all the commodities we get
-- from Yahoo still have Friday's close!?" at 6:30 PM ET Monday).
--
-- WHY: the evening close pass of MARKET-INDICATORS-EOD is a GitHub cron at
-- 20:45 UTC, and this repo's GitHub crons start 2-7 hours late (LESSONS 4.41,
-- 5.2). On Mon 11-02 it had not started by 23:36Z, so every Yahoo-sourced tile
-- (commodities, Russell 2000, FX) showed Friday all evening while the US
-- indices (other producers) showed Monday. Fri 10-30's evening pass ran at
-- 00:05Z Sat. Same fix as the morning pass (20261023/20261026): pg_cron
-- dispatches the workflow over the GitHub API; the GitHub cron stays as the
-- backup.
--
-- SCHEDULE: 22:15 UTC Mon-Fri (after the 17:05 ET settlement cutoff in EST;
-- 18:15 ET in EDT) and 00:30 UTC Tue-Sat (after London midnight, when Yahoo's
-- FX daily bar for the New York day is complete - daily_bars() drops the
-- still-live London-dated FX bar before that). Guard: no-op once both
-- cmdty_oil and fx_eur carry today's New York date.
-- Applied to production via MCP 2026-11-02 23:40Z; this file is the record.

create or replace function public.market_tape_evening_dispatch()
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare
  pat text;
  ny_today date := (now() at time zone 'America/New_York')::date;
  dow int := extract(isodow from (now() at time zone 'America/New_York'));
  oil_asof date; fx_asof date;
begin
  if dow > 5 then return 'not needed: weekend in New York'; end if;
  select data_as_of::date into oil_asof from pipeline_health where indicator_id = 'cmdty_oil';
  select data_as_of::date into fx_asof  from pipeline_health where indicator_id = 'fx_eur';
  if oil_asof >= ny_today and fx_asof >= ny_today then
    return format('not needed: cmdty_oil %s, fx_eur %s', oil_asof, fx_asof);
  end if;
  select value into pat from ops_secrets where name = 'github_dispatch';
  if pat is null then
    raise warning 'market_tape_evening_dispatch: github_dispatch PAT missing from ops_secrets';
    return 'skipped: github_dispatch PAT missing';
  end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/jmezzadri/market-dashboard/actions/workflows/MARKET-INDICATORS-EOD.yml/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || pat, 'Accept', 'application/vnd.github+json',
      'User-Agent', 'macrotilt-market-tape-evening', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main'));
  return format('dispatched MARKET-INDICATORS-EOD: cmdty_oil %s, fx_eur %s, New York today %s',
                coalesce(oil_asof::text,'none'), coalesce(fx_asof::text,'none'), ny_today);
end $function$;
revoke execute on function public.market_tape_evening_dispatch() from public, anon, authenticated;

select cron.schedule('market-tape-evening-2215utc', '15 22 * * 1-5', $$select market_tape_evening_dispatch()$$);
select cron.schedule('market-tape-evening-0030utc', '30 0 * * 2-6', $$select market_tape_evening_dispatch()$$);
