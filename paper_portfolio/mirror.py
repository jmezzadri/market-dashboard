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
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

from paper_portfolio.alpaca_client import AlpacaPaperClient, AlpacaPosition
from paper_portfolio.signals import load_asset_tilt_snapshot

logger = logging.getLogger("paper_mirror")
PROJECT_REF = "yqaqqzseepebrocgibcw"


def _to_rfc3339_utc(ts: str) -> str:
    """Normalize a timestamp string into the RFC-3339 UTC form Alpaca's REST
    API accepts on the `after` parameter (e.g. "2026-05-27T13:38:48Z").

    Handles both Python isoformat ("...+00:00") and Postgres ::text
    ("2026-05-27 13:38:48.556838+00", space separator + bare "+00" offset).
    """
    s = ts.strip().replace(" ", "T")
    # Accept a trailing "Z" (some callers / future schema changes emit it).
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    # Pad a bare two-digit trailing offset ("+00" / "-05") to "+00:00".
    s = re.sub(r"([+-]\d{2})$", r"\1:00", s)
    try:
        d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        # Last resort: hand Alpaca a clearly-valid lookback rather than crash.
        logger.warning("could not parse since_iso %r; falling back to 7-day lookback", ts)
        return (datetime.now(tz=timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")


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
# Schema self-migration (idempotent — safe to run every cycle)
# ─────────────────────────────────────────────────────────────────────────────

def ensure_paper_schema() -> None:
    """Add the richer analytics columns if they don't exist yet. Runs through
    the Supabase Management API (same path as every other write). IF NOT
    EXISTS makes this a no-op once applied, so it's cheap to call each run and
    means a fresh column never requires a manual migration step."""
    ddl = """
    alter table public.paper_positions
      add column if not exists unrealized_plpc          double precision,
      add column if not exists unrealized_intraday_pl   double precision,
      add column if not exists unrealized_intraday_plpc double precision,
      add column if not exists current_price            double precision,
      add column if not exists lastday_price            double precision,
      add column if not exists cost_basis               double precision,
      add column if not exists entry_date               date;

    alter table public.paper_nav_daily
      add column if not exists spy_close               double precision,
      add column if not exists agg_close               double precision,
      add column if not exists total_unrealized_pnl    double precision,
      add column if not exists total_realized_pnl      double precision,
      add column if not exists sleeve_a_unrealized_pnl double precision,
      add column if not exists sleeve_b_unrealized_pnl double precision,
      add column if not exists sleeve_a_realized_pnl   double precision,
      add column if not exists sleeve_b_realized_pnl   double precision,
      add column if not exists sleeve_a_positions      integer,
      add column if not exists sleeve_b_positions      integer,
      add column if not exists portfolio_beta          double precision,
      add column if not exists sleeve_a_value          double precision,
      add column if not exists sleeve_b_value          double precision,
      add column if not exists sleeve_a_beta           double precision,
      add column if not exists sleeve_b_beta           double precision,
      add column if not exists spy_prev_close          double precision,
      add column if not exists spy_inception_close     double precision,
      add column if not exists spy_ttm_close           double precision;
    """
    _supabase_exec(ddl)
    logger.info("ensure_paper_schema: analytics columns present")


def _entry_dates_by_ticker() -> dict[str, str]:
    """First buy date per ticker (the lot open date), used for holding period.
    Average-cost book, so we treat the earliest buy fill as the open date."""
    rows = _supabase_query(
        "select ticker, min(filled_at)::date::text as entry_date "
        "from public.paper_fills where lower(side) = 'buy' group by ticker;"
    )
    return {r["ticker"]: r["entry_date"] for r in rows if r.get("entry_date")}


def _realized_pnl_by_sleeve() -> dict[str, float]:
    """Lifetime realized P&L per sleeve via average-cost lot accounting over
    paper_fills. Buys raise the cost base; sells realize (sell - avg_cost) x qty.
    Returns {'A': $, 'B': $}. Informational per-sleeve split; the headline
    realized number is derived exactly from NAV minus open P&L in the writer."""
    try:
        rows = _supabase_query(
            "select sleeve, ticker, side, quantity, price, filled_at "
            "from public.paper_fills order by filled_at asc;"
        )
    except Exception as e:
        logger.warning("realized-P&L query failed (%s); defaulting to 0", e)
        return {"A": 0.0, "B": 0.0}
    # per (sleeve,ticker): running avg cost + qty
    lots: dict[tuple, dict] = {}
    realized = {"A": 0.0, "B": 0.0}
    for r in rows:
        sleeve = r.get("sleeve") or "B"
        key = (sleeve, r["ticker"])
        lot = lots.setdefault(key, {"qty": 0.0, "avg": 0.0})
        qty = float(r.get("quantity") or 0)
        price = float(r.get("price") or 0)
        side = (r.get("side") or "").lower()
        if side == "buy":
            new_qty = lot["qty"] + qty
            if new_qty > 0:
                lot["avg"] = (lot["avg"] * lot["qty"] + price * qty) / new_qty
            lot["qty"] = new_qty
        elif side == "sell":
            realized[sleeve] = realized.get(sleeve, 0.0) + qty * (price - lot["avg"])
            lot["qty"] = max(0.0, lot["qty"] - qty)
    return realized


def _beta_for(value_col: str) -> float | None:
    """Trailing beta of a value series (total_nav / sleeve_a_value /
    sleeve_b_value) vs SPY. beta = cov(ret, spy_ret) / var(spy_ret). Returns
    None until >= 20 daily return pairs exist so the page shows 'building'
    instead of a noisy number."""
    if value_col not in ("total_nav", "sleeve_a_value", "sleeve_b_value"):
        return None
    try:
        rows = _supabase_query(
            f"select {value_col} as v, spy_close from public.paper_nav_daily "
            f"where spy_close is not null and {value_col} is not null "
            "order by snapshot_date asc;"
        )
    except Exception as e:
        logger.warning("beta query failed for %s (%s); returning None", value_col, e)
        return None
    vals = [float(r["v"]) for r in rows]
    spys = [float(r["spy_close"]) for r in rows]

    def rets(series):
        return [(series[i] / series[i - 1] - 1.0) for i in range(1, len(series)) if series[i - 1]]

    br, sr = rets(vals), rets(spys)
    n = min(len(br), len(sr))
    if n < 20:
        return None
    br, sr = br[-n:], sr[-n:]
    mean_s, mean_b = sum(sr) / n, sum(br) / n
    var_s = sum((s - mean_s) ** 2 for s in sr) / n
    if var_s == 0:
        return None
    cov = sum((br[i] - mean_b) * (sr[i] - mean_s) for i in range(n)) / n
    return cov / var_s


def _portfolio_beta(snapshot_date: date) -> float | None:
    return _beta_for("total_nav")


def _spy_anchor_closes(alpaca: AlpacaPaperClient) -> dict:
    """Fetch the SPY closes needed to anchor benchmark returns directly from
    Alpaca historical bars, so the S&P 500 row is meaningful on day one without
    waiting for a stored series. Returns {prev, inception, ttm} closes.

    - inception = SPY close on/before the book's first NAV date
    - ttm       = SPY close on/before (today - 365 days)
    - prev      = the prior session's SPY close
    """
    out = {"prev": None, "inception": None, "ttm": None}
    # Book inception date.
    try:
        r = _supabase_query("select min(snapshot_date)::text as d from public.paper_nav_daily;")
        inception_date = (r and r[0].get("d")) or None
    except Exception:
        inception_date = None
    today = datetime.now(tz=timezone.utc).date()
    start = (today - timedelta(days=400)).isoformat()
    closes = alpaca.get_daily_closes("SPY", start)  # [(date, close)] asc
    if not closes:
        return out
    out["prev"] = closes[-2][1] if len(closes) >= 2 else None
    ttm_target = (today - timedelta(days=365)).isoformat()
    on_or_before = lambda tgt: next((c for d, c in reversed(closes) if d <= tgt), closes[0][1])
    out["ttm"] = on_or_before(ttm_target)
    if inception_date:
        out["inception"] = on_or_before(inception_date)
    return out


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
    entry_dates = {} if dry_run else _entry_dates_by_ticker()

    if dry_run:
        for p in positions:
            sleeve = _sleeve_for(p.ticker, sleeve_a_etfs)
            logger.info("[dry-run] %s %s qty=%s mv=$%.2f day=%+.2f%% total=%+.2f%% sleeve=%s",
                        snapshot_date, p.ticker, p.qty, p.market_value,
                        p.unrealized_intraday_plpc * 100, p.unrealized_plpc * 100, sleeve)
        return len(positions)

    sql_lines = [
        "begin;",
        f"delete from public.paper_positions where snapshot_date = '{snapshot_date.isoformat()}';",
    ]
    for p in positions:
        sleeve = _sleeve_for(p.ticker, sleeve_a_etfs)
        ed = entry_dates.get(p.ticker)
        sql_lines.append(
            "insert into public.paper_positions "
            "(snapshot_date, sleeve, ticker, quantity, avg_cost, market_value, "
            " unrealized_pnl, unrealized_plpc, unrealized_intraday_pl, "
            " unrealized_intraday_plpc, current_price, lastday_price, cost_basis, "
            " entry_date, current_score, last_updated) values ("
            f"'{snapshot_date.isoformat()}', "
            f"{_sql_escape(sleeve)}, "
            f"{_sql_escape(p.ticker)}, "
            f"{p.qty}, "
            f"{p.avg_entry_price}, "
            f"{p.market_value}, "
            f"{p.unrealized_pl}, "
            f"{p.unrealized_plpc}, "
            f"{p.unrealized_intraday_pl}, "
            f"{p.unrealized_intraday_plpc}, "
            f"{p.current_price}, "
            f"{p.lastday_price}, "
            f"{p.cost_basis}, "
            f"{_sql_escape(ed)}, "
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

    # Alpaca's REST `after` parameter requires strict RFC-3339 (a `T`
    # separator and a full/`Z` timezone). The value here can arrive in two
    # shapes: Python isoformat ("2026-05-27T13:38:48.556838+00:00") or
    # Postgres `::text` ("2026-05-27 13:38:48.556838+00" — note the SPACE
    # separator and the bare two-digit "+00" offset). The old guard only
    # handled the "+00:00" case, so the Postgres form sailed through and
    # Alpaca rejected it with HTTP 422, crashing the whole open phase.
    # Normalize any of these into "YYYY-MM-DDTHH:MM:SSZ".
    since_iso = _to_rfc3339_utc(since_iso)

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

    STARTING_CAPITAL = 1_000_000.0

    sleeve_a_equity = sleeve_b_equity = 0.0
    sleeve_a_unrl = sleeve_b_unrl = 0.0
    sleeve_a_n = sleeve_b_n = 0
    for p in positions:
        sleeve = _sleeve_for(p.ticker, sleeve_a_etfs)
        if sleeve == "A":
            sleeve_a_equity += p.market_value
            sleeve_a_unrl += p.unrealized_pl
            sleeve_a_n += 1
        else:
            sleeve_b_equity += p.market_value
            sleeve_b_unrl += p.unrealized_pl
            sleeve_b_n += 1

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

    # Benchmarks — store the RAW closing prices for SPY and AGG. The page
    # normalizes both to a $1M capital-matched start (SPY buy-and-hold and a
    # 60/40 SPY/AGG blend), so the comparison is apples-to-apples in dollars.
    spy_close = alpaca.get_close_price("SPY")
    agg_close = alpaca.get_close_price("AGG")
    # Back-compat: keep the old 100-share anchor column populated.
    spy_value = spy_close * 100 if spy_close else None

    # P&L decomposition. Open (unrealized) P&L is exact from Alpaca per-position.
    # Realized = total book P&L minus what's still open (captures closed-trade
    # gains, fees, and any cash interest). Per-sleeve realized is the avg-cost
    # lot calc over fills (informational split).
    total_unrl = sleeve_a_unrl + sleeve_b_unrl
    total_realized = (total_nav - STARTING_CAPITAL) - total_unrl
    realized_by_sleeve = _realized_pnl_by_sleeve()
    beta = _portfolio_beta(snapshot_date)

    # Mark each sleeve to market: value = $500K start + its realized + open P&L.
    # (sleeve_*_nav is a cash-plug pinned to $500K and must NOT be used here.)
    SLEEVE_CAP = 500_000.0
    sleeve_a_value = SLEEVE_CAP + realized_by_sleeve.get("A", 0.0) + sleeve_a_unrl
    sleeve_b_value = SLEEVE_CAP + realized_by_sleeve.get("B", 0.0) + sleeve_b_unrl
    sleeve_a_beta = _beta_for("sleeve_a_value")
    sleeve_b_beta = _beta_for("sleeve_b_value")

    # SPY benchmark anchors (inception / trailing-12m / prior close) so the
    # S&P 500 + Vs rows are real on day one. Page computes returns from these.
    spy_anchor = _spy_anchor_closes(alpaca)
    spy_prev_close = spy_anchor.get("prev")
    spy_inception_close = spy_anchor.get("inception")
    spy_ttm_close = spy_anchor.get("ttm")

    if dry_run:
        logger.info(
            "[dry-run] NAV %s: total=$%.0f (real=$%.0f unrl=$%.0f) | A nav=$%.0f unrl=$%.0f n=%d | "
            "B nav=$%.0f unrl=$%.0f n=%d | SPY=%.2f AGG=%.2f beta=%s",
            snapshot_date, total_nav, total_realized, total_unrl,
            sleeve_a_nav, sleeve_a_unrl, sleeve_a_n,
            sleeve_b_nav, sleeve_b_unrl, sleeve_b_n,
            spy_close or -1, agg_close or -1,
            f"{beta:.2f}" if beta is not None else "building",
        )
        logger.info(
            "[dry-run]   sleeve values: A=$%.0f B=$%.0f | SPY anchors prev=%s incep=%s ttm=%s",
            sleeve_a_value, sleeve_b_value,
            spy_prev_close, spy_inception_close, spy_ttm_close,
        )
        return {
            "snapshot_date": str(snapshot_date), "total_nav": total_nav,
            "total_realized_pnl": total_realized, "total_unrealized_pnl": total_unrl,
            "sleeve_a_value": sleeve_a_value, "sleeve_b_value": sleeve_b_value,
            "sleeve_a_positions": sleeve_a_n, "sleeve_b_positions": sleeve_b_n,
            "spy_close": spy_close, "spy_prev_close": spy_prev_close,
            "spy_inception_close": spy_inception_close, "spy_ttm_close": spy_ttm_close,
            "portfolio_beta": beta,
        }

    def _num(v):
        return "NULL" if v is None else str(v)

    sql = (
        "insert into public.paper_nav_daily "
        "(snapshot_date, sleeve_a_cash, sleeve_a_equity, sleeve_a_nav, "
        " sleeve_b_cash, sleeve_b_equity, sleeve_b_margin_used, sleeve_b_nav, "
        " total_nav, benchmark_spy_value, spy_close, agg_close, "
        " total_unrealized_pnl, total_realized_pnl, "
        " sleeve_a_unrealized_pnl, sleeve_b_unrealized_pnl, "
        " sleeve_a_realized_pnl, sleeve_b_realized_pnl, "
        " sleeve_a_positions, sleeve_b_positions, portfolio_beta, "
        " sleeve_a_value, sleeve_b_value, sleeve_a_beta, sleeve_b_beta, "
        " spy_prev_close, spy_inception_close, spy_ttm_close, created_at) "
        "values ("
        f"'{snapshot_date.isoformat()}', "
        f"{sleeve_a_cash}, {sleeve_a_equity}, {sleeve_a_nav}, "
        f"{sleeve_b_cash}, {sleeve_b_equity}, {sleeve_b_margin_used}, {sleeve_b_nav}, "
        f"{total_nav}, {_num(spy_value)}, {_num(spy_close)}, {_num(agg_close)}, "
        f"{total_unrl}, {total_realized}, "
        f"{sleeve_a_unrl}, {sleeve_b_unrl}, "
        f"{realized_by_sleeve.get('A', 0.0)}, {realized_by_sleeve.get('B', 0.0)}, "
        f"{sleeve_a_n}, {sleeve_b_n}, {_num(beta)}, "
        f"{sleeve_a_value}, {sleeve_b_value}, {_num(sleeve_a_beta)}, {_num(sleeve_b_beta)}, "
        f"{_num(spy_prev_close)}, {_num(spy_inception_close)}, {_num(spy_ttm_close)}, "
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
        "  spy_close = excluded.spy_close, "
        "  agg_close = excluded.agg_close, "
        "  total_unrealized_pnl = excluded.total_unrealized_pnl, "
        "  total_realized_pnl = excluded.total_realized_pnl, "
        "  sleeve_a_unrealized_pnl = excluded.sleeve_a_unrealized_pnl, "
        "  sleeve_b_unrealized_pnl = excluded.sleeve_b_unrealized_pnl, "
        "  sleeve_a_realized_pnl = excluded.sleeve_a_realized_pnl, "
        "  sleeve_b_realized_pnl = excluded.sleeve_b_realized_pnl, "
        "  sleeve_a_positions = excluded.sleeve_a_positions, "
        "  sleeve_b_positions = excluded.sleeve_b_positions, "
        "  portfolio_beta = excluded.portfolio_beta, "
        "  sleeve_a_value = excluded.sleeve_a_value, "
        "  sleeve_b_value = excluded.sleeve_b_value, "
        "  sleeve_a_beta = excluded.sleeve_a_beta, "
        "  sleeve_b_beta = excluded.sleeve_b_beta, "
        "  spy_prev_close = excluded.spy_prev_close, "
        "  spy_inception_close = excluded.spy_inception_close, "
        "  spy_ttm_close = excluded.spy_ttm_close, "
        "  created_at = now();"
    )
    _supabase_exec(sql)
    logger.info(
        "wrote paper_nav_daily for %s: NAV=$%.0f (real=$%.0f unrl=$%.0f) A=$%.0f(%d) B=$%.0f(%d) SPY=%s AGG=%s beta=%s",
        snapshot_date, total_nav, total_realized, total_unrl,
        sleeve_a_nav, sleeve_a_n, sleeve_b_nav, sleeve_b_n,
        spy_close, agg_close, f"{beta:.2f}" if beta is not None else "building",
    )
    return {
        "snapshot_date": str(snapshot_date),
        "sleeve_a_cash": sleeve_a_cash, "sleeve_a_equity": sleeve_a_equity, "sleeve_a_nav": sleeve_a_nav,
        "sleeve_b_cash": sleeve_b_cash, "sleeve_b_equity": sleeve_b_equity, "sleeve_b_nav": sleeve_b_nav,
        "sleeve_b_margin_used": sleeve_b_margin_used,
        "total_nav": total_nav, "benchmark_spy_value": spy_value,
        "spy_close": spy_close, "agg_close": agg_close,
        "total_unrealized_pnl": total_unrl, "total_realized_pnl": total_realized,
        "sleeve_a_positions": sleeve_a_n, "sleeve_b_positions": sleeve_b_n,
        "portfolio_beta": beta,
    }
