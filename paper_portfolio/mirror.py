"""
paper_portfolio.mirror — Alpaca state → Supabase snapshot tables.

Three responsibilities, run nightly:

  1. mirror_positions  — overwrite today's snapshot in paper_positions
                          with the live Alpaca position list. Sleeve
                          attribution: ticker is in the Asset Tilt IG
                          universe → Sleeve A; else Sleeve B (matches
                          the diff layer's rule from Phase 2).

  2. mirror_fills      — pull recent Alpaca fills (orders that closed
                          since the last successful mirror run) and
                          INSERT one row per fill into paper_fills. The
                          alpaca_fill_id column is UNIQUE so duplicate
                          inserts are no-ops.

  3. write_nav         — compute today's sleeve A / sleeve B / total NAV
                          plus benchmark SPY MV, write one row to
                          paper_nav_daily (PK on snapshot_date — idempotent
                          upsert).

All writers idempotent — safe to re-run the same day.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timezone
from typing import Any

import requests

from paper_portfolio.alpaca_client import AlpacaPaperClient, AlpacaPosition
from paper_portfolio.signals import load_asset_tilt_snapshot

logger = logging.getLogger("paper_mirror")
PROJECT_REF = "yqaqqzseepebrocgibcw"


# ─────────────────────────────────────────────────────────────────────────────
# Supabase helpers
# ─────────────────────────────────────────────────────────────────────────────

def _supabase_query(sql: str) -> list[dict[str, Any]]:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN required.")
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": sql},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _supabase_exec(sql: str) -> None:
    _ = _supabase_query(sql)


def _sql_escape(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve attribution from Asset Tilt snapshot
# ─────────────────────────────────────────────────────────────────────────────

def _build_sleeve_a_etf_universe(
    asset_tilt_path: str = "public/v10_allocation.json",
) -> set[str]:
    """Return the set of all tickers that appear anywhere in any IG's
    `tickers` list in today's Asset Tilt snapshot. Used to classify live
    Alpaca positions as Sleeve A vs Sleeve B."""
    try:
        snap = load_asset_tilt_snapshot(asset_tilt_path)
    except FileNotFoundError:
        logger.warning("asset tilt snapshot not found at %s — using empty Sleeve A universe", asset_tilt_path)
        return set()
    universe: set[str] = set()
    for ig in snap.raw.get("industry_groups", []) or []:
        for t in (ig.get("tickers") or []):
            universe.add(t)
    return universe


def _sleeve_for(ticker: str, sleeve_a_universe: set[str]) -> str:
    return "A" if ticker in sleeve_a_universe else "B"


# ─────────────────────────────────────────────────────────────────────────────
# 1) Positions mirror
# ─────────────────────────────────────────────────────────────────────────────

def mirror_positions(
    alpaca: AlpacaPaperClient | None = None,
    snapshot_date: date | None = None,
    dry_run: bool = False,
) -> int:
    """Rewrite today's paper_positions snapshot from live Alpaca state.

    Strategy: DELETE today's rows + INSERT current positions in one
    transaction so two parallel runs can't double-insert. PK is
    (snapshot_date, sleeve, ticker) — INSERT collides on rerun.
    """
    alpaca = alpaca or AlpacaPaperClient()
    snapshot_date = snapshot_date or date.today()
    positions = alpaca.get_positions()
    sleeve_a_etfs = _build_sleeve_a_etf_universe()

    if dry_run:
        for p in positions:
            sleeve = _sleeve_for(p.ticker, sleeve_a_etfs)
            logger.info("[dry-run] %s %s qty=%s mv=$%.2f sleeve=%s",
                        snapshot_date, p.ticker, p.qty, p.market_value, sleeve)
        return len(positions)

    sql_lines = [
        "begin;",
        f"delete from public.paper_positions where snapshot_date = '{snapshot_date.isoformat()}';",
    ]
    for p in positions:
        sleeve = _sleeve_for(p.ticker, sleeve_a_etfs)
        sql_lines.append(
            "insert into public.paper_positions "
            "(snapshot_date, sleeve, ticker, quantity, avg_cost, market_value, "
            " unrealized_pnl, current_score, last_updated) values ("
            f"'{snapshot_date.isoformat()}', "
            f"{_sql_escape(sleeve)}, "
            f"{_sql_escape(p.ticker)}, "
            f"{p.qty}, "
            f"{p.avg_entry_price}, "
            f"{p.market_value}, "
            f"{p.unrealized_pl}, "
            f"NULL, "
            "now()"
            ");"
        )
    sql_lines.append("commit;")
    _supabase_exec("\n".join(sql_lines))
    logger.info("mirrored %d positions for %s", len(positions), snapshot_date)
    return len(positions)


# ─────────────────────────────────────────────────────────────────────────────
# 2) Fills mirror
# ─────────────────────────────────────────────────────────────────────────────

def mirror_fills(
    alpaca: AlpacaPaperClient | None = None,
    since_iso: str | None = None,
    dry_run: bool = False,
) -> int:
    """Pull recent Alpaca orders and insert one paper_fills row per filled
    leg. Idempotent via UNIQUE(alpaca_fill_id) — ON CONFLICT DO NOTHING.

    since_iso: ISO timestamp; defaults to the most recent filled_at in
    paper_fills minus 1 hour (safe overlap), else 7 days ago for the very
    first run.
    """
    alpaca = alpaca or AlpacaPaperClient()
    sleeve_a_etfs = _build_sleeve_a_etf_universe()

    if since_iso is None:
        latest = _supabase_query(
            "select max(filled_at)::text as max_t from public.paper_fills;"
        )
        if latest and latest[0].get("max_t"):
            since_iso = latest[0]["max_t"]
        else:
            # First-time run — 7-day lookback.
            from datetime import timedelta
            since_iso = (datetime.now(tz=timezone.utc) - timedelta(days=7)).isoformat()

    # Alpaca's REST API rejects `+00:00` timezone offsets on the `after` query
    # parameter with HTTP 422. Normalize to the `Z` suffix it does accept.
    if since_iso.endswith("+00:00"):
        since_iso = since_iso[:-6] + "Z"

    orders = alpaca.list_orders(status="closed", after=since_iso, limit=500)
    n_inserted = 0
    inserts: list[str] = []
    for o in orders:
        if o.get("status") not in ("filled", "partially_filled"):
            continue
        filled_qty = float(o.get("filled_qty") or 0)
        if filled_qty <= 0:
            continue
        ticker = o.get("symbol")
        side = o.get("side")
        avg_price = float(o.get("filled_avg_price") or 0)
        filled_at = o.get("filled_at")
        alpaca_order_id = o.get("id")
        # Alpaca's fill object is reached via the legs; for paper, the
        # simple proxy is "use order id as both alpaca_order_id and
        # alpaca_fill_id-suffix" — we use alpaca_order_id + status as the
        # unique key on paper side.
        fill_id = f"{alpaca_order_id}:{o.get('status')}"
        sleeve = _sleeve_for(ticker, sleeve_a_etfs)
        gross = filled_qty * avg_price
        if dry_run:
            logger.info("[dry-run] fill %s %s qty=%s @ $%.4f sleeve=%s",
                        side, ticker, filled_qty, avg_price, sleeve)
            n_inserted += 1
            continue
        inserts.append(
            "insert into public.paper_fills "
            "(id, alpaca_order_id, alpaca_fill_id, sleeve, ticker, side, "
            " quantity, price, gross_amount, fees, filled_at, created_at) "
            "values ("
            "gen_random_uuid(), "
            f"{_sql_escape(alpaca_order_id)}, "
            f"{_sql_escape(fill_id)}, "
            f"{_sql_escape(sleeve)}, "
            f"{_sql_escape(ticker)}, "
            f"{_sql_escape(side)}, "
            f"{filled_qty}, {avg_price}, {gross}, 0, "
            f"{_sql_escape(filled_at)}, now()"
            ") on conflict (alpaca_fill_id) do nothing;"
        )

    if inserts and not dry_run:
        _supabase_exec("begin;\n" + "\n".join(inserts) + "\ncommit;")
        n_inserted = len(inserts)

    logger.info("mirrored %d fills since %s", n_inserted, since_iso)
    return n_inserted


# ─────────────────────────────────────────────────────────────────────────────
# 3) NAV daily writer
# ─────────────────────────────────────────────────────────────────────────────

def write_nav_daily(
    alpaca: AlpacaPaperClient | None = None,
    snapshot_date: date | None = None,
    dry_run: bool = False,
) -> dict:
    """Compute today's sleeve A / sleeve B / total NAV and upsert one row
    into paper_nav_daily (PK on snapshot_date)."""
    alpaca = alpaca or AlpacaPaperClient()
    snapshot_date = snapshot_date or date.today()

    account = alpaca.get_account()
    positions = alpaca.get_positions()
    sleeve_a_etfs = _build_sleeve_a_etf_universe()

    sleeve_a_equity = 0.0
    sleeve_b_equity = 0.0
    for p in positions:
        sleeve = _sleeve_for(p.ticker, sleeve_a_etfs)
        if sleeve == "A":
            sleeve_a_equity += p.market_value
        else:
            sleeve_b_equity += p.market_value

    # Cash split — proportional to the equity split; sleeves share Alpaca's
    # single cash pool. Where one sleeve is 100 % cash we attribute by capital cap.
    cap_a = 500_000.0
    cap_b = 500_000.0
    sleeve_a_cash = max(0.0, cap_a - sleeve_a_equity)
    sleeve_b_cash = max(0.0, cap_b - sleeve_b_equity)
    sleeve_b_margin_used = max(0.0, sleeve_b_equity - cap_b)
    sleeve_a_nav = sleeve_a_cash + sleeve_a_equity
    sleeve_b_nav = sleeve_b_cash + sleeve_b_equity - sleeve_b_margin_used
    total_nav = float(account.equity)
    spy_price = alpaca.get_last_trade_price("SPY")
    spy_value = spy_price * 100 if spy_price else None  # arbitrary 100-sh anchor; UI normalizes

    if dry_run:
        logger.info(
            "[dry-run] NAV %s: A_eq=$%.0f B_eq=$%.0f cash_pool=$%.0f total_NAV=$%.0f leverage_b=$%.0f",
            snapshot_date, sleeve_a_equity, sleeve_b_equity, float(account.cash),
            total_nav, sleeve_b_margin_used,
        )
        return {
            "snapshot_date": str(snapshot_date), "total_nav": total_nav,
            "sleeve_a_equity": sleeve_a_equity, "sleeve_b_equity": sleeve_b_equity,
            "sleeve_b_margin_used": sleeve_b_margin_used,
        }

    sql = (
        "insert into public.paper_nav_daily "
        "(snapshot_date, sleeve_a_cash, sleeve_a_equity, sleeve_a_nav, "
        " sleeve_b_cash, sleeve_b_equity, sleeve_b_margin_used, sleeve_b_nav, "
        " total_nav, benchmark_spy_value, created_at) "
        "values ("
        f"'{snapshot_date.isoformat()}', "
        f"{sleeve_a_cash}, {sleeve_a_equity}, {sleeve_a_nav}, "
        f"{sleeve_b_cash}, {sleeve_b_equity}, {sleeve_b_margin_used}, {sleeve_b_nav}, "
        f"{total_nav}, "
        f"{spy_value if spy_value is not None else 'NULL'}, "
        "now() "
        ") on conflict (snapshot_date) do update set "
        "  sleeve_a_cash = excluded.sleeve_a_cash, "
        "  sleeve_a_equity = excluded.sleeve_a_equity, "
        "  sleeve_a_nav = excluded.sleeve_a_nav, "
        "  sleeve_b_cash = excluded.sleeve_b_cash, "
        "  sleeve_b_equity = excluded.sleeve_b_equity, "
        "  sleeve_b_margin_used = excluded.sleeve_b_margin_used, "
        "  sleeve_b_nav = excluded.sleeve_b_nav, "
        "  total_nav = excluded.total_nav, "
        "  benchmark_spy_value = excluded.benchmark_spy_value, "
        "  created_at = now();"
    )
    _supabase_exec(sql)
    logger.info(
        "wrote paper_nav_daily for %s: NAV=$%.0f sleeve A=$%.0f sleeve B=$%.0f",
        snapshot_date, total_nav, sleeve_a_nav, sleeve_b_nav,
    )
    return {
        "snapshot_date": str(snapshot_date),
        "sleeve_a_cash": sleeve_a_cash, "sleeve_a_equity": sleeve_a_equity, "sleeve_a_nav": sleeve_a_nav,
        "sleeve_b_cash": sleeve_b_cash, "sleeve_b_equity": sleeve_b_equity, "sleeve_b_nav": sleeve_b_nav,
        "sleeve_b_margin_used": sleeve_b_margin_used,
        "total_nav": total_nav, "benchmark_spy_value": spy_value,
    }
