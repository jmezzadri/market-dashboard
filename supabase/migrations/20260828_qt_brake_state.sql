-- Crash-brake state for the Quality Trend book (Joe approved 2026-08-28).
-- One row per evaluation day. Hysteresis reads the newest row; acting twice in
-- a day is prevented by the primary key.
create table if not exists public.qt_brake_state (
  d          date primary key,
  composite  numeric not null,
  stress_on  boolean not null,
  action     text not null default 'none',   -- none | halved | restored
  created_at timestamptz not null default now()
);
comment on table public.qt_brake_state is
  'Daily stress-composite evaluations for the QT crash brake. The brake only ever scales the book (half/full); it never selects symbols.';

-- The one account the brake (and every QT job) is allowed to touch.
insert into public.ops_secrets (name, value, note)
values ('alpaca_paper_account', 'PA30FE66XZSD',
        'Identity check for QT jobs: refuse to act when GET /v2/account returns any other account_number. Set 2026-08-28 at relaunch.')
on conflict (name) do update set value = excluded.value, note = excluded.note;
