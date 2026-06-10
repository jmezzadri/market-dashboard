"""One-off restatement: re-mark the paper book's HISTORY at official closes.

Why (2026-06-10, Joe): every paper_nav_daily / paper_positions row written
before the close-anchoring cutover was stamped at whatever clock time GitHub
delivered the old morning cron — 9:38 AM one day, 12:21 PM the next, 8:29 PM
another. The Performance card computes Daily P&L against the PRIOR row, so
"yesterday" was a random midday mark: on 2026-06-10 that flipped Sleeve A's
daily to +$809 while the sleeve table (true close-over-close) showed −$4,901.

What this does, per historical session date D (all dates BEFORE today ET):
  1. Weekend rows (the Sat 2026-05-30 artifact) — DELETE the nav row; there
     was no session. Positions snapshots are left in place (harmless; entry-
     date fallback unaffected because the prior Friday snapshot exists).
  2. Re-price the date-D positions snapshot to date-D closes from prices_eod
     (the site's canonical feed). Tickers with no D bar keep their old mark
     and are logged.
  3. Rebuild the date-D NAV row from those certified closes:
       cash_D       = old_total_nav − old_gross   (same-moment identity —
                      cash has no intraday price, so it's timing-clean)
       new_total    = cash_D + Σ certified market value
       sleeve equities/values re-derived; SPY close/prev re-anchored to the
       canonical D / D−1 bars.
     created_at and the informational realized/unrealized split columns are
     left untouched (provenance; nothing user-facing reads them).

Today's row is NOT touched — it was written by the close phase at official
bars and is certified against prices_eod by the next morning's open phase.

Run via the PAPER-PORTFOLIO-RESTATE workflow (workflow_dispatch only).
Idempotent: re-running re-derives the same closes.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

from paper_portfolio.mirror import _supabase_exec, _supabase_query

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("paper_restate")

ET = ZoneInfo("America/New_York")
SLEEVE_CAP = 500_000.0


def _spy_closes(d: str) -> tuple[float | None, float | None]:
    r = _supabase_query(
        f"select close from public.prices_eod where ticker = 'SPY' and trade_date = '{d}';"
    )
    spy_c = float(r[0]["close"]) if r else None
    r = _supabase_query(
        "select close from public.prices_eod where ticker = 'SPY' "
        f"and trade_date < '{d}' order by trade_date desc limit 1;"
    )
    spy_p = float(r[0]["close"]) if r else None
    return spy_c, spy_p


def restate_date(d: str) -> None:
    wd = date.fromisoformat(d).weekday()
    if wd >= 5:
        _supabase_exec(f"delete from public.paper_nav_daily where snapshot_date = '{d}';")
        logger.info("%s: weekend row — nav row DELETED (no session)", d)
        return

    spy_c, spy_p = _spy_closes(d)
    if spy_c is None:
        logger.warning("%s: weekday but no SPY bar in prices_eod — SKIPPING (investigate)", d)
        return

    # 1) re-price the positions snapshot at date-D closes (date-pinned).
    _supabase_exec(f"""
    with px as (
      select distinct on (ticker) ticker, close, trade_date
        from public.prices_eod
       where trade_date <= '{d}'
         and ticker in (select distinct upper(ticker) from public.paper_positions
                         where snapshot_date = '{d}')
       order by ticker, trade_date desc
    ),
    prior as (
      select distinct on (pe.ticker) pe.ticker, pe.close
        from public.prices_eod pe
        join px on px.ticker = pe.ticker and pe.trade_date < px.trade_date
       order by pe.ticker, pe.trade_date desc
    )
    update public.paper_positions p
       set current_price = px.close,
           lastday_price = coalesce(prior.close, p.lastday_price),
           market_value  = p.quantity * px.close,
           unrealized_pnl = (p.quantity * px.close) - p.cost_basis,
           unrealized_intraday_pl = case when prior.close is not null
               then p.quantity * (px.close - prior.close)
               else p.unrealized_intraday_pl end,
           last_updated = now()
      from px
      left join prior on prior.ticker = px.ticker
     where p.snapshot_date = '{d}'
       and upper(p.ticker) = px.ticker
       and px.trade_date = '{d}';
    """)

    cov = _supabase_query(f"""
      select count(*) as held,
             count(*) filter (where exists (
               select 1 from public.prices_eod pe
                where pe.ticker = upper(p.ticker) and pe.trade_date = '{d}')) as repriced
        from public.paper_positions p where p.snapshot_date = '{d}';
    """)
    held, repriced = int(cov[0]["held"]), int(cov[0]["repriced"])

    # 2) rebuild the NAV row from the certified snapshot + preserved cash.
    old = _supabase_query(
        "select total_nav, sleeve_a_equity, sleeve_b_equity "
        f"from public.paper_nav_daily where snapshot_date = '{d}';"
    )
    if not old:
        logger.info("%s: no nav row — positions repriced (%d/%d), nothing else to do", d, repriced, held)
        return
    o = old[0]
    if o["total_nav"] is None or o["sleeve_a_equity"] is None or o["sleeve_b_equity"] is None:
        logger.warning("%s: nav row missing old equities — leaving nav row as-is", d)
        return
    cash = float(o["total_nav"]) - float(o["sleeve_a_equity"]) - float(o["sleeve_b_equity"])

    agg = _supabase_query(f"""
      select coalesce(sum(market_value) filter (where sleeve = 'A'), 0) as a_eq,
             coalesce(sum(market_value) filter (where sleeve = 'B'), 0) as b_eq
        from public.paper_positions where snapshot_date = '{d}';
    """)
    a_eq, b_eq = float(agg[0]["a_eq"]), float(agg[0]["b_eq"])
    total = cash + a_eq + b_eq

    # Sleeve net-equity values (same formula as the nightly writer): borrowing
    # is charged to the over-cap sleeve(s); idle cash splits evenly.
    gross = a_eq + b_eq
    margin = gross - total
    a_bor, b_bor = max(0.0, a_eq - SLEEVE_CAP), max(0.0, b_eq - SLEEVE_CAP)
    if (a_bor + b_bor) > 0:
        a_val = a_eq - margin * (a_bor / (a_bor + b_bor))
        b_val = b_eq - margin * (b_bor / (a_bor + b_bor))
    else:
        idle = total - gross
        a_val, b_val = a_eq + idle / 2.0, b_eq + idle / 2.0

    spy_prev_sql = str(spy_p) if spy_p is not None else "spy_prev_close"
    _supabase_exec(f"""
      update public.paper_nav_daily set
        sleeve_a_equity = {a_eq},
        sleeve_b_equity = {b_eq},
        total_nav       = {total},
        sleeve_a_value  = {a_val},
        sleeve_b_value  = {b_val},
        spy_close       = {spy_c},
        spy_prev_close  = {spy_prev_sql},
        benchmark_spy_value = {spy_c * 100}
      where snapshot_date = '{d}';
    """)
    logger.info("%s: nav restated — total=$%.0f (was $%.0f) | A=$%.0f B=$%.0f cash=$%.0f | "
                "SPY %.2f/prev %.2f | repriced %d/%d names",
                d, total, float(o["total_nav"]), a_eq, b_eq, cash,
                spy_c, spy_p or -1, repriced, held)


def main() -> int:
    today_et = datetime.now(tz=ET).date().isoformat()
    dates = [r["d"] for r in _supabase_query(
        "select snapshot_date::text as d from public.paper_nav_daily "
        f"where snapshot_date < '{today_et}' order by snapshot_date asc;"
    )]
    logger.info("restating %d historical session rows (today %s untouched)", len(dates), today_et)
    for d in dates:
        restate_date(d)
    logger.info("restatement complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
