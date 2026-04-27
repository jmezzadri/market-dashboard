-- ───────────────────────────────────────────────────────────────────────────
-- 024_daily_nav_snapshot.sql
-- ───────────────────────────────────────────────────────────────────────────
-- Daily NAV snapshot infrastructure for portfolio_history.
--
-- Two write paths, same destination:
--
--   1. Cron path — `snapshot_portfolios_today()` runs nightly at 21:00 UTC
--      on weekdays (after US market close). Aggregates each user's
--      positions into per-account NAV rows in portfolio_history. Service-
--      role only.
--
--   2. On-visit path — `snapshot_my_portfolio_today()` is callable by any
--      authenticated user via PostgREST RPC. Writes only the caller's
--      rows (uses auth.uid()). Idempotent — ON CONFLICT update keeps the
--      latest of either path. Backstop in case cron misses a day.
--
-- Both paths source from public.positions (which the scanner / snapshot
-- pipeline keeps current). NAV = SUM(positions.value) per account, where
-- value is the denormalized quantity × price.
--
-- Calendar:
--   • snapshot_portfolios_today() writes as_of = CURRENT_DATE
--   • Weekend writes are allowed (so a Saturday visit captures Friday's
--     close); idempotency on (user_id, account_label, as_of) makes
--     repeats safe.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1) Cron-side snapshot function (service-role only) ─────────────────────
-- Runs as security DEFINER so pg_cron can write across all users without
-- needing a per-user JWT. The function body itself enumerates positions
-- by user_id directly, so the RLS-bypass is intentional.
create or replace function public.snapshot_portfolios_today()
returns table(rows_written int)
language plpgsql
security definer
set search_path = public
as $$
declare
  written int := 0;
begin
  with agg as (
    select
      p.user_id,
      p.account_id,
      a.label as account_label,
      current_date as as_of,
      sum(coalesce(p.value, 0))::numeric as nav
    from public.positions p
    join public.accounts a on a.id = p.account_id
    where coalesce(p.value, 0) <> 0
    group by p.user_id, p.account_id, a.label
  )
  insert into public.portfolio_history
    (user_id, account_id, account_label, as_of, nav, source)
  select user_id, account_id, account_label, as_of, nav, 'cron_snapshot'
  from agg
  on conflict (user_id, account_label, as_of) do update
    set nav    = excluded.nav,
        source = case
          -- Manual statement seeds (e.g. chase_statement_*, fidelity_apr27_anchor)
          -- always win over the cron snapshot — they're the user's source of truth.
          when public.portfolio_history.source like 'chase_%'
            or public.portfolio_history.source like 'fidelity_%'
            then public.portfolio_history.source
          else excluded.source
        end;

  get diagnostics written = row_count;
  return query select written;
end;
$$;

revoke all on function public.snapshot_portfolios_today() from public;
grant execute on function public.snapshot_portfolios_today() to service_role;

comment on function public.snapshot_portfolios_today() is
  'Service-role nightly cron: snapshots every user''s per-account NAV into portfolio_history. Manual statement seeds always win.';


-- ── 2) Per-user RPC (callable by authenticated users) ──────────────────────
-- Backstop in case cron misses a day. Only writes the caller's own rows
-- (auth.uid()). Authenticated visitor → React hook calls this on mount;
-- if today's row exists, ON CONFLICT keeps the more authoritative source.
create or replace function public.snapshot_my_portfolio_today()
returns table(rows_written int)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  written int := 0;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  with agg as (
    select
      p.user_id,
      p.account_id,
      a.label as account_label,
      current_date as as_of,
      sum(coalesce(p.value, 0))::numeric as nav
    from public.positions p
    join public.accounts a on a.id = p.account_id
    where p.user_id = uid
      and coalesce(p.value, 0) <> 0
    group by p.user_id, p.account_id, a.label
  )
  insert into public.portfolio_history
    (user_id, account_id, account_label, as_of, nav, source)
  select user_id, account_id, account_label, as_of, nav, 'visit_snapshot'
  from agg
  on conflict (user_id, account_label, as_of) do update
    set nav    = excluded.nav,
        source = case
          when public.portfolio_history.source like 'chase_%'
            or public.portfolio_history.source like 'fidelity_%'
            or public.portfolio_history.source = 'cron_snapshot'
            then public.portfolio_history.source
          else excluded.source
        end;

  get diagnostics written = row_count;
  return query select written;
end;
$$;

revoke all on function public.snapshot_my_portfolio_today() from public;
grant execute on function public.snapshot_my_portfolio_today() to authenticated;

comment on function public.snapshot_my_portfolio_today() is
  'Auth-only RPC: snapshots the caller''s per-account NAV into portfolio_history. On-visit backstop for the cron path.';


-- ── 3) pg_cron schedule — daily 21:00 UTC weekdays (after US market close) ─
select cron.schedule(
  'snapshot-portfolios-daily-2100utc',
  '0 21 * * 1-5',
  $$
    select public.snapshot_portfolios_today()
  $$
);
