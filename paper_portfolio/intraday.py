"""
paper_portfolio.intraday — LIVE intraday mirror (Joe directive 2026-06-23).

The Paper page is close-anchored: the official record (paper_positions +
paper_nav_daily) is written once a day at the 16:50 ET close, valued at
official session closes. That record is the BOOK OF RECORD and is owned by
runner.run_close_phase — nothing here writes to it.

This module produces a TRANSIENT LIVE view, refreshed hourly during market
hours straight from live Alpaca marks, into two dedicated tables
(paper_intraday_positions, paper_intraday_nav). The page prefers this live
view while it is fresher than the official close snapshot, then flips back to
the close snapshot after the 16:50 run — so the close is the day's final,
authoritative update, exactly as Joe asked.

Key difference from mirror.mirror_positions("live"): that path overwrites the
broker marks with prices_eod (the site's single canonical price source), which
during market hours is yesterday's close (Polygon publishes T+1). For a true
intraday view we KEEP the live Alpaca marks here and never touch prices_eod.

Read-only against Alpaca; writes only to the two intraday tables. No order
submission, so no live-trading kill-switch is involved (same posture as the
close mirror).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.mirror import (
    _build_sleeve_a_etf_universe,
    _entry_dates_by_ticker,
    _latest_scan_scores,
    _sleeve_for,
    _sql_escape,
    _supabase_exec,
    _supabase_query,
    _et_today,
)

logger = logging.getLogger("paper_intraday")

# pipeline_health.indicator_id MUST equal the manifest `name` the chip resolves
# to (NOT the dotted id) — same convention as mirror._PAPER_HEALTH. Cadence 'H'
# (hourly) is allowed by pipeline_health_cadence_check as of migration 061.
_INTRADAY_HEALTH = [
    ("paper-positions-intraday", "public.paper_intraday_positions",
     "Paper Portfolio · Live positions (intraday)", "Alpaca (paper) — live marks"),
    ("paper-nav-intraday", "public.paper_intraday_nav",
     "Paper Portfolio · Live NAV (intraday)", "Alpaca (paper) — live equity"),
]


def ensure_intraday_schema() -> None:
    """Create the two intraday tables + RLS if they are not present yet.
    Idempotent (IF NOT EXISTS / catch-duplicate), so the hourly job is safe to
    run even before migration 060 is formally applied."""
    ddl = """
    create table if not exists public.paper_intraday_positions (
      sleeve text not null check (sleeve in ('A','B')),
      ticker text not null,
      quantity numeric not null,
      avg_cost numeric not null,
      market_value numeric not null,
      unrealized_pnl numeric,
      unrealized_plpc numeric,
      unrealized_intraday_pl numeric,
      unrealized_intraday_plpc numeric,
      current_price numeric,
      lastday_price numeric,
      cost_basis numeric,
      entry_date date,
      current_score integer,
      as_of_date date not null,
      updated_at timestamptz not null default now(),
      primary key (sleeve, ticker)
    );
    create table if not exists public.paper_intraday_nav (
      as_of_date date primary key,
      total_nav numeric not null,
      cash numeric,
      long_market_value numeric,
      sleeve_a_value numeric,
      sleeve_b_value numeric,
      sleeve_a_equity numeric,
      sleeve_b_equity numeric,
      day_pnl numeric,
      prior_close_nav numeric,
      spy_close numeric,
      spy_prev_close numeric,
      spy_inception_close numeric,
      portfolio_beta numeric,
      n_positions integer,
      updated_at timestamptz not null default now()
    );
    alter table public.paper_intraday_positions enable row level security;
    alter table public.paper_intraday_nav enable row level security;
    """
    _supabase_exec(ddl)
    # Policies can't use IF NOT EXISTS; create each and swallow "already exists".
    policies = [
        "create policy paper_intraday_positions_read on public.paper_intraday_positions for select to anon using (true);",
        "create policy paper_intraday_positions_read_auth on public.paper_intraday_positions for select to authenticated using (true);",
        "create policy paper_intraday_nav_read on public.paper_intraday_nav for select to anon using (true);",
        "create policy paper_intraday_nav_read_auth on public.paper_intraday_nav for select to authenticated using (true);",
    ]
    for p in policies:
        try:
            _supabase_exec(p)
        except Exception as exc:  # noqa: BLE001 — duplicate policy is expected on rerun
            logger.debug("policy create skipped (%s)", exc)
    logger.info("ensure_intraday_schema: intraday tables present")


def _prior_close_nav_row() -> dict[str, Any]:
    """The most recent OFFICIAL close NAV row — the baseline for live day-P&L
    and the carry source for the SPY anchors + beta the card needs."""
    try:
        rows = _supabase_query(
            "select total_nav, spy_close, spy_prev_close, spy_inception_close, "
            "portfolio_beta, snapshot_date::text as d "
            "from public.paper_nav_daily order by snapshot_date desc limit 1;"
        )
        return rows[0] if rows else {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("prior-close NAV lookup failed (%s)", exc)
        return {}


def mirror_positions_intraday(
    alpaca: AlpacaPaperClient | None = None,
    dry_run: bool = False,
) -> int:
    """Overwrite paper_intraday_positions with the LIVE Alpaca position list,
    keeping the broker's live marks. DELETE-all + INSERT in one transaction."""
    alpaca = alpaca or AlpacaPaperClient()
    positions = alpaca.get_positions()
    today = _et_today()
    sleeve_a_etfs = _build_sleeve_a_etf_universe()
    entry_dates = {} if dry_run else _entry_dates_by_ticker()
    scan_scores = {} if dry_run else _latest_scan_scores()

    if dry_run:
        for p in positions:
            sleeve = _sleeve_for(p.ticker, sleeve_a_etfs)
            logger.info("[dry-run] LIVE %s qty=%s last=$%.2f mv=$%.2f day=%+.2f%% sleeve=%s",
                        p.ticker, p.qty, p.current_price, p.market_value,
                        (p.unrealized_intraday_plpc or 0) * 100, sleeve)
        return len(positions)

    sql = ["begin;", "delete from public.paper_intraday_positions;"]
    for p in positions:
        sleeve = _sleeve_for(p.ticker, sleeve_a_etfs)
        ed = entry_dates.get(p.ticker)
        sc = scan_scores.get(p.ticker)
        score_sql = "NULL" if (sleeve != "B" or sc is None) else str(int(sc))
        sql.append(
            "insert into public.paper_intraday_positions "
            "(sleeve, ticker, quantity, avg_cost, market_value, unrealized_pnl, "
            " unrealized_plpc, unrealized_intraday_pl, unrealized_intraday_plpc, "
            " current_price, lastday_price, cost_basis, entry_date, current_score, "
            " as_of_date, updated_at) values ("
            f"{_sql_escape(sleeve)}, {_sql_escape(p.ticker)}, {p.qty}, "
            f"{p.avg_entry_price}, {p.market_value}, {p.unrealized_pl}, "
            f"{p.unrealized_plpc}, {p.unrealized_intraday_pl}, {p.unrealized_intraday_plpc}, "
            f"{p.current_price}, {p.lastday_price}, {p.cost_basis}, "
            f"{_sql_escape(ed)}, {score_sql}, '{today.isoformat()}', now());"
        )
    sql.append("commit;")
    _supabase_exec("\n".join(sql))
    logger.info("mirrored %d LIVE positions (intraday)", len(positions))
    return len(positions)


def write_nav_intraday(
    alpaca: AlpacaPaperClient | None = None,
    dry_run: bool = False,
) -> dict:
    """Upsert the single live NAV row from Alpaca's reported account equity.
    day_pnl is measured against the prior OFFICIAL close NAV so the live figure
    is on the same baseline the close-anchored card uses."""
    alpaca = alpaca or AlpacaPaperClient()
    account = alpaca.get_account()
    positions = alpaca.get_positions()
    today = _et_today()
    sleeve_a_etfs = _build_sleeve_a_etf_universe()

    SLEEVE_CAP = 1_000_000.0  # single $1M book (Sleeve A retired)
    a_eq = b_eq = 0.0
    a_n = b_n = 0
    for p in positions:
        if _sleeve_for(p.ticker, sleeve_a_etfs) == "A":
            a_eq += p.market_value; a_n += 1
        else:
            b_eq += p.market_value; b_n += 1
    total_nav = float(account.equity)
    gross = a_eq + b_eq
    margin = gross - total_nav
    a_bor = max(0.0, a_eq - SLEEVE_CAP)
    b_bor = max(0.0, b_eq - SLEEVE_CAP)
    bor_base = a_bor + b_bor
    if bor_base > 0:
        a_val = a_eq - margin * (a_bor / bor_base)
        b_val = b_eq - margin * (b_bor / bor_base)
    else:
        idle = total_nav - gross
        a_val = a_eq + idle / 2.0
        b_val = b_eq + idle / 2.0

    prior = _prior_close_nav_row()
    prior_nav = float(prior["total_nav"]) if prior.get("total_nav") is not None else None
    day_pnl = (total_nav - prior_nav) if prior_nav is not None else None
    spy_live = alpaca.get_close_price("SPY")

    if dry_run:
        logger.info("[dry-run] LIVE NAV=$%.2f day=%+.2f vs prior close $%s; SPY=%s; %d positions",
                    total_nav, (day_pnl or 0.0), prior_nav, spy_live, b_n + a_n)
        return {"total_nav": total_nav, "day_pnl": day_pnl}

    def num(v):
        return "NULL" if v is None else repr(float(v))

    _supabase_exec(
        "insert into public.paper_intraday_nav "
        "(as_of_date, total_nav, cash, long_market_value, sleeve_a_value, sleeve_b_value, "
        " sleeve_a_equity, sleeve_b_equity, day_pnl, prior_close_nav, spy_close, "
        " spy_prev_close, spy_inception_close, portfolio_beta, n_positions, updated_at) values ("
        f"'{today.isoformat()}', {num(total_nav)}, {num(account.cash)}, {num(account.long_market_value)}, "
        f"{num(a_val)}, {num(b_val)}, {num(a_eq)}, {num(b_eq)}, {num(day_pnl)}, {num(prior_nav)}, "
        f"{num(spy_live)}, {num(prior.get('spy_prev_close'))}, {num(prior.get('spy_inception_close'))}, "
        f"{num(prior.get('portfolio_beta'))}, {b_n + a_n}, now()) "
        "on conflict (as_of_date) do update set "
        "total_nav=excluded.total_nav, cash=excluded.cash, long_market_value=excluded.long_market_value, "
        "sleeve_a_value=excluded.sleeve_a_value, sleeve_b_value=excluded.sleeve_b_value, "
        "sleeve_a_equity=excluded.sleeve_a_equity, sleeve_b_equity=excluded.sleeve_b_equity, "
        "day_pnl=excluded.day_pnl, prior_close_nav=excluded.prior_close_nav, spy_close=excluded.spy_close, "
        "spy_prev_close=excluded.spy_prev_close, spy_inception_close=excluded.spy_inception_close, "
        "portfolio_beta=excluded.portfolio_beta, n_positions=excluded.n_positions, updated_at=now();"
    )
    logger.info("wrote LIVE NAV row: $%.2f (day %+.2f), %d positions", total_nav, (day_pnl or 0.0), b_n + a_n)
    return {"total_nav": total_nav, "day_pnl": day_pnl, "n_positions": b_n + a_n}


def stamp_intraday_pipeline_health(dry_run: bool = False) -> None:
    """Seed/refresh the two intraday feeds' pipeline_health rows so their chips
    grade real (hourly cadence = 60 min). Never raises."""
    if dry_run:
        logger.info("[dry-run] would stamp intraday pipeline_health rows")
        return
    rows_sql = []
    for ind_id, table, label, source in _INTRADAY_HEALTH:
        try:
            r = _supabase_query(f"select max(updated_at)::text as d from {table};")
            d = (r[0].get("d") if r else None)
        except Exception as exc:  # noqa: BLE001
            logger.warning("intraday health: could not read %s (%s) — skip", table, exc)
            continue
        if not d:
            continue
        rows_sql.append(
            "(" + ", ".join([
                _sql_escape(ind_id), _sql_escape(label), _sql_escape(source),
                "'H'", "60", "'green'", "now()", "now()", _sql_escape(d), "NULL", "now()",
            ]) + ")"
        )
    if not rows_sql:
        return
    ids = ", ".join(_sql_escape(x[0]) for x in _INTRADAY_HEALTH)
    try:
        _supabase_exec(f"delete from public.pipeline_health where indicator_id in ({ids});")
        _supabase_exec(
            "insert into public.pipeline_health "
            "(indicator_id, label, source, cadence, expected_cadence_minutes, status, "
            " last_good_at, last_check_at, data_as_of, last_error, updated_at) values "
            + ", ".join(rows_sql) + ";"
        )
        logger.info("stamped pipeline_health for %d intraday feeds", len(rows_sql))
    except Exception as exc:  # noqa: BLE001
        logger.warning("intraday pipeline_health stamp failed (%s)", exc)


def run_intraday(dry_run: bool = False) -> dict:
    """Hourly market-hours phase: live positions + live NAV + freshness stamp.
    Self-skips when the market is closed (Alpaca clock), so weekend/holiday
    crons are cheap no-ops and the close run stays the day's final update."""
    logger.info("=" * 60)
    logger.info("PHASE INTRADAY — live positions + live NAV (hourly)")
    logger.info("=" * 60)
    alpaca = AlpacaPaperClient()
    try:
        clock = alpaca.get_clock()
        if not clock.get("is_open", False):
            logger.info("market closed (Alpaca clock) — skipping intraday refresh")
            return {"skipped": "market_closed"}
    except Exception as exc:  # noqa: BLE001 — if the clock fails, proceed (marks are still live)
        logger.warning("clock check failed (%s) — proceeding", exc)
    if not dry_run:
        ensure_intraday_schema()
    n_pos = mirror_positions_intraday(alpaca=alpaca, dry_run=dry_run)
    nav = write_nav_intraday(alpaca=alpaca, dry_run=dry_run)
    stamp_intraday_pipeline_health(dry_run=dry_run)
    return {"positions": n_pos, "nav": nav}
