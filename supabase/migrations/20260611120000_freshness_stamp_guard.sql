-- 2026-06-11 — Freshness-stamp guard (Joe-approved one-shot fix).
-- Root cause of the "Data as of June 10 · Last refreshed June 9" impossible
-- tooltips: producers DERIVED tracking timestamps from data dates (midnight
-- UTC, fake 4 PM closes) instead of recording real run times — some stamps
-- landed in the future. These guards make that class of lie impossible to
-- store.

-- Guard 1: pipeline_health — CLAMP future stamps (liveness preserved: the
-- write succeeds, the stamp is truthified to "now").
create or replace function public.clamp_health_stamps()
returns trigger language plpgsql as $$
declare cap timestamptz := now() + interval '5 minutes';
begin
  if new.last_good_at is not null and new.last_good_at > cap then
    new.last_good_at := now();
  end if;
  if new.last_check_at is not null and new.last_check_at > cap then
    new.last_check_at := now();
  end if;
  if new.data_as_of is not null and new.data_as_of > cap then
    -- date-only intent: clamp to today's date at midnight UTC
    new.data_as_of := date_trunc('day', now());
  end if;
  return new;
end $$;

drop trigger if exists trg_clamp_health_stamps on public.pipeline_health;
create trigger trg_clamp_health_stamps
  before insert or update on public.pipeline_health
  for each row execute function public.clamp_health_stamps();

-- Guard 2: prices_eod — REJECT forward-dated bars (data correctness beats
-- liveness in the price store; a bar for a session that has not completed
-- in New York must never land).
create or replace function public.reject_future_trade_date()
returns trigger language plpgsql as $$
begin
  if new.trade_date > (now() at time zone 'America/New_York')::date then
    raise exception 'prices_eod: forward-dated bar % (%) refused — ET session not closed',
      new.ticker, new.trade_date;
  end if;
  return new;
end $$;

drop trigger if exists trg_reject_future_trade_date on public.prices_eod;
create trigger trg_reject_future_trade_date
  before insert or update on public.prices_eod
  for each row execute function public.reject_future_trade_date();
