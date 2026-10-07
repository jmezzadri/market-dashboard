-- 20261007_qt_nav_nasdaq_dow.sql
--
-- /paper's headline card becomes one table: Paper, S&P 500, Nasdaq 100 and Dow
-- across Day / YTD / Inception (Joe, 2026-10-07). qt_nav_daily already carries
-- the S&P mark (spy_close); this adds the same mark for the other two, written
-- by the same two producers in the same broker call (qt-live-sync every ten
-- minutes in market hours, QT-EOD-DAILY after the close) so all three
-- benchmarks share one clock with the book's own equity.
--
-- Backfill: every existing row takes the official close from prices_eod
-- (QQQ, DIA) for its date. Idempotent — only fills rows that are still null.

alter table public.qt_nav_daily
  add column if not exists qqq_close numeric,
  add column if not exists dia_close numeric;

comment on column public.qt_nav_daily.qqq_close is 'QQQ (Nasdaq 100 fund) latest trade at the mark; official close once QT-EOD-DAILY runs';
comment on column public.qt_nav_daily.dia_close is 'DIA (Dow fund) latest trade at the mark; official close once QT-EOD-DAILY runs';

update public.qt_nav_daily n
   set qqq_close = p.close
  from public.prices_eod p
 where p.ticker = 'QQQ' and p.trade_date = n.d and n.qqq_close is null;

update public.qt_nav_daily n
   set dia_close = p.close
  from public.prices_eod p
 where p.ticker = 'DIA' and p.trade_date = n.d and n.dia_close is null;
