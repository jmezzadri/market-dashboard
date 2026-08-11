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
    from paper_portfolio._sbq import sb_query
    return sb_query(sql, token)


def _supabase_exec(sql: str) -> None:
    _ = _supabase_query(sql)


from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


def _et_today() -> date:
    """Today's date in US-Eastern — the trading-session calendar. Using the
    UTC date stamped evening EST runs (21:50 ET = 02:50 UTC next day) with
    TOMORROW's date; every session label must be ET."""
    return datetime.now(tz=_ET).date()


def _session_close_iso(d_str: str) -> str:
    """4:00 PM ET on the given YYYY-MM-DD, expressed as UTC ISO. Used to
    stamp data_as_of so a date-only snapshot renders as 'Jun 10, 4:00 PM EDT'
    instead of midnight-UTC (which displayed as 8:00 PM the PRIOR day in ET —
    the 'last refresh was June 9?!' confusion of 2026-06-10)."""
    d = date.fromisoformat(d_str)
    return datetime(d.year, d.month, d.day, 16, 0, tzinfo=_ET).astimezone(timezone.utc).isoformat()


def _sql_escape(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


# ─────────────────────────────────────────────────────────────────────────────
# Freshness stamping — every paper feed must own a real pipeline_health row.
# ─────────────────────────────────────────────────────────────────────────────
# The freshness chip (useFreshness) grades each surface against
# public.pipeline_health. The Supabase edge freshness-checker only refreshes
# VENDOR feeds; in-house producers like this paper runner must stamp their own
# rows or the chip lies. Two concrete failures this prevents:
#   * fake-green: a leaf chip surviving only on an on-page fallback timestamp
#     with no health row of its own (forbidden by the data rules).
#   * dependency red-out: paper-orders-intent depends on
#     paper-positions-snapshot; the dependency walk evaluates the dependency
#     WITHOUT the page fallback, so a missing positions health row reads
#     "never refreshed" and reds the Recent-rebalances chip even though orders
#     landed 3h ago. (Root cause of the red rebalance chip, 2026-06-05.)
# indicator_id MUST equal the manifest `name` the chip resolves to.
_PAPER_HEALTH = [
    ("paper-nav-daily",          "public.paper_nav_daily",  "snapshot_date",
     "Paper Portfolio · Daily NAV",            "Alpaca paper account"),
    ("paper-positions-snapshot", "public.paper_positions",  "snapshot_date",
     "Paper Portfolio · Positions snapshot",   "Alpaca + prices_eod"),
    ("paper-orders-intent",      "public.paper_orders",     "created_at",
     "Paper Portfolio · Order intents",        "Paper engine + Alpaca"),
]


def stamp_paper_pipeline_health(dry_run: bool = False) -> None:
    """Seed/refresh the pipeline_health rows for the three paper feeds.

    Idempotent (DELETE + INSERT scoped to these three ids — no reliance on a
    named conflict constraint). data_as_of anchors to the newest row actually
    present in each source table, so the chip can never read greener than the
    data. Never raises: a freshness-logging failure must not fail the run.
    """
    if dry_run:
        logger.info("[dry-run] would stamp paper pipeline_health rows")
        return
    rows_sql = []
    for ind_id, table, date_col, label, source in _PAPER_HEALTH:
        try:
            r = _supabase_query(f"select max({date_col})::text as d from {table};")
            d = (r[0].get("d") if r else None)
        except Exception as exc:
            logger.warning("pipeline_health: could not read %s (%s) — skip", table, exc)
            continue
        # An EMPTY source table is valid, not a failure: a freshly-reset cash
        # account holds no positions and has no queued orders, so paper_positions
        # / paper_orders are legitimately empty between the reset and the first
        # fill. Stamp the run time anyway — skipping here deleted the row and
        # false-red the Alpaca / Portfolio tile (Joe 2026-06-23: "Alpaca red,
        # but nothing on Alpaca is red"). When the table is empty, data_as_of =
        # the run time (the run confirmed zero rows). Date-only stamps anchor to
        # the 4:00 PM ET session close; full timestamps pass through.
        if d:
            as_of_sql = _sql_escape(_session_close_iso(d) if len(d) == 10 else d)
        else:
            as_of_sql = "now()"
        rows_sql.append(
            "(" + ", ".join([
                _sql_escape(ind_id), _sql_escape(label), _sql_escape(source),
                "'D'", "1440", "'green'", "now()", "now()",
                as_of_sql, "NULL", "now()",
            ]) + ")"
        )
    if not rows_sql:
        logger.warning("pipeline_health: no paper source dates found — nothing to stamp")
        return
    ids = ", ".join(_sql_escape(x[0]) for x in _PAPER_HEALTH)
    try:
        _supabase_exec(
            f"delete from public.pipeline_health where indicator_id in ({ids});"
        )
        _supabase_exec(
            "insert into public.pipeline_health "
            "(indicator_id, label, source, cadence, expected_cadence_minutes, status, "
            " last_good_at, last_check_at, data_as_of, last_error, updated_at) values "
            + ", ".join(rows_sql) + ";"
        )
        logger.info("stamped pipeline_health for %d paper feeds", len(rows_sql))
    except Exception as exc:
        logger.warning("pipeline_health stamp failed (%s)", exc)


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
      add column if not exists sleeve_a_day_pnl        double precision,
      add column if not exists sleeve_b_day_pnl        double precision,
      add column if not exists spy_prev_close          double precision,
      add column if not exists spy_inception_close     double precision,
      add column if not exists spy_ttm_close           double precision,
      add column if not exists qqq_close               double precision,
      add column if not exists qqq_prev_close          double precision,
      add column if not exists qqq_inception_close     double precision,
      add column if not exists dia_close               double precision,
      add column if not exists dia_prev_close          double precision,
      add column if not exists dia_inception_close     double precision,
      add column if not exists iwm_close               double precision,
      add column if not exists iwm_prev_close          double precision,
      add column if not exists iwm_inception_close     double precision;
    """
    _supabase_exec(ddl)
    logger.info("ensure_paper_schema: analytics columns present")


def _entry_dates_by_ticker() -> dict[str, str]:
    """Holding-period start date per ticker. Earliest of (first buy fill,
    first daily snapshot the ticker appears in). The snapshot fallback matters
    because the fills mirror was down during the book's first days, so some
    held positions have no buy fill on record — without the fallback their
    'Held' column renders blank."""
    out: dict[str, str] = {}
    try:
        for r in _supabase_query(
            "select ticker, min(filled_at)::date::text as d "
            "from public.paper_fills where lower(side) = 'buy' group by ticker;"
        ):
            if r.get("d"):
                out[r["ticker"]] = r["d"]
    except Exception as e:
        logger.warning("entry-date fill lookup failed (%s)", e)
    try:
        for r in _supabase_query(
            "select ticker, min(snapshot_date)::text as d "
            "from public.paper_positions group by ticker;"
        ):
            d = r.get("d")
            if d and (r["ticker"] not in out or d < out[r["ticker"]]):
                out[r["ticker"]] = d
    except Exception as e:
        logger.warning("entry-date snapshot lookup failed (%s)", e)
    return out


def _latest_scan_scores() -> dict[str, int]:
    """Current Equity Scanner buy score (0–10) per ticker from the LATEST
    trading_opps_signals scan — the SAME source and scale the Sleeve B engine
    trades on (signals.py). The engine switched sources on 2026-05-27 but this
    display helper was left on the retired v5 scanner, dividing its
    -100..+100 score by 10 — which painted every holding as a 1–3 (Joe caught
    it 2026-06-11). WATCHLIST rows count too: a held name that decayed below
    the buy gate shows its true current score rather than vanishing; names
    absent from the latest scan render as an em-dash."""
    try:
        latest = _supabase_query("select max(scan_date)::text as d from public.trading_opps_signals;")
        d = latest[0]["d"] if latest and latest[0].get("d") else None
        if not d:
            return {}
        rows = _supabase_query(
            "select ticker, max(score) as score from public.trading_opps_signals "
            f"where scan_date = '{d}' and direction = 'long' group by ticker;"
        )
        out: dict[str, int] = {}
        for r in rows:
            sc = r.get("score")
            if sc is None:
                continue
            out[r["ticker"]] = int(round(max(0.0, float(sc))))
        return out
    except Exception as e:
        logger.warning("scan-score lookup failed (%s); Score column will be blank", e)
        return {}


def _realized_pnl_by_sleeve() -> dict[str, float]:
    """Lifetime realized P&L per sleeve via average-cost lot accounting over
    paper_fills. Buys raise the cost base; sells realize (sell - avg_cost) x qty.
    Returns {'A': $, 'B': $}. These per-sleeve figures ARE the book's realized
    record: the writer's headline total_realized_pnl is their sum (2026-08-06
    deep-dive: the old NAV-minus-open-P&L plug absorbed any broker-NAV error)."""
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


def _sleeve_initial_capital() -> tuple[float, float]:
    """Initial capital (the sleeve cash BASE) for sleeves B and M, read from
    public.paper_accounts allocations.

    CONFIGURATION ONLY (Conviction Events cutover 2026-08-11): these were the
    hardcoded 500_000/500_000 constants from the two-sleeve era. The epoch
    reset (scripts/ce_reset_epoch.py) rewrites the allocations (whole account
    into the Sleeve B slot, sleeve_m_allocation 0), so the cash bases must
    follow the same config row — the accounting method is unchanged:
    sleeve cash = initial capital + net fill cash flow (2026-08-06 fix).

    Fail-loud: a NAV row must never be written against a guessed capital base
    (LESSONS 4.4/4.5) — if this read fails the write itself would fail on the
    same connection anyway."""
    rows = _supabase_query(
        "select sleeve_b_allocation, coalesce(sleeve_m_allocation, 0) as sleeve_m_allocation "
        "from public.paper_accounts where status = 'active' limit 1;")
    if not rows or rows[0].get("sleeve_b_allocation") is None:
        raise RuntimeError(
            "no active paper_accounts row — cannot derive sleeve capital bases "
            "(run migration 058 / the epoch reset first)")
    return (float(rows[0]["sleeve_b_allocation"]),
            float(rows[0].get("sleeve_m_allocation") or 0))


def _fill_cashflows_by_sleeve() -> dict[str, float]:
    """Net cash flow per sleeve from the ACTUAL fills ledger:
    sum(sell proceeds) - sum(buy costs). Sleeve cash is initial capital plus
    this number — one accounting method end-to-end. (2026-08-06 deep-dive:
    sleeve cash was rederived as capital - broker FIFO-lot basis + avg-cost
    realized, mixing two lot methods; on multi-lot partial sells the book cash
    drifted from fill-implied cash by exactly avg-cost minus FIFO realized.)"""
    try:
        rows = _supabase_query(
            "select sleeve, "
            "sum(case when lower(side) = 'sell' then quantity * price "
            "         when lower(side) = 'buy'  then -quantity * price "
            "         else 0 end) as net_cash "
            "from public.paper_fills group by 1;"
        )
    except Exception as e:
        logger.warning("fill-cashflow query failed (%s); defaulting to 0", e)
        return {}
    out: dict[str, float] = {}
    for r in rows:
        s = (r.get("sleeve") or "B").upper()
        out[s] = out.get(s, 0.0) + float(r.get("net_cash") or 0)
    return out


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


BENCHMARK_ETFS = ("SPY", "QQQ", "DIA", "IWM")  # S&P 500 / NASDAQ 100 / Dow 30 / Russell 2000


def _benchmark_anchor_closes(alpaca: AlpacaPaperClient) -> dict:
    """Fetch, for EVERY benchmark ETF, the closes needed to anchor its
    buy-and-hold row directly from Alpaca historical bars, so each benchmark
    row is meaningful on day one without waiting for a stored series.
    Returns {SYM: {prev, inception, ttm}}. (Generalized from the SPY-only
    fetch 2026-07-03 — Joe: compare the book to NASDAQ / Dow / Russell too.)

    - inception = close on/before the book's first NAV date
    - ttm       = close on/before (today - 365 days); stored for SPY only
    - prev      = the prior session's close
    """
    # Book inception date (one query, shared by all symbols).
    try:
        r = _supabase_query("select min(snapshot_date)::text as d from public.paper_nav_daily;")
        inception_date = (r and r[0].get("d")) or None
    except Exception:
        inception_date = None
    today = datetime.now(tz=timezone.utc).date()
    start = (today - timedelta(days=400)).isoformat()
    result: dict = {}
    for sym in BENCHMARK_ETFS:
        out = {"prev": None, "inception": None, "ttm": None}
        try:
            closes = alpaca.get_daily_closes(sym, start)  # [(date, close)] asc
        except Exception:
            logger.exception("benchmark anchor fetch failed for %s — row shows em-dash", sym)
            closes = []
        if closes:
            out["prev"] = closes[-2][1] if len(closes) >= 2 else None
            on_or_before = lambda tgt: next((c for d, c in reversed(closes) if d <= tgt), closes[0][1])
            # Window-match TTM to the book's life while it is younger than a
            # year (like-for-like); true trailing-12m once the book is older.
            ttm_cal = (today - timedelta(days=365)).isoformat()
            ttm_target = max(ttm_cal, inception_date) if inception_date else ttm_cal
            out["ttm"] = on_or_before(ttm_target)
            if inception_date:
                out["inception"] = on_or_before(inception_date)
        result[sym] = out
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve attribution from Asset Tilt snapshot
# ─────────────────────────────────────────────────────────────────────────────

def _build_sleeve_a_etf_universe(
    asset_tilt_path: str = "public/v10_allocation.json",
) -> set[str]:
    """Historical Sleeve-A (Asset Tilt) ETF universe, used only to label legacy
    held positions on the snapshot. Sleeve A was retired 2026-06-23 and the
    Asset Tilt engine output (v10_allocation.json) no longer exists, so this
    returns an empty set and every live position attributes to Sleeve B.

    Reads the JSON directly (the signals reader was removed with Sleeve A); if
    the file is ever restored, legacy ETFs would label as Sleeve A again."""
    try:
        with open(asset_tilt_path) as f:
            d = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return set()
    universe: set[str] = set()
    for ig in d.get("industry_groups", []) or []:
        for t in (ig.get("tickers") or []):
            universe.add(t)
    return universe


def _sleeve_for(ticker: str, sleeve_a_universe: set[str]) -> str:
    return "A" if ticker in sleeve_a_universe else "B"


# ─────────────────────────────────────────────────────────────────────────────
# Sleeve attribution by FILLS PROVENANCE (2026-07-15 fix)
#
# Root cause of the 7/15 commingling bug: positions and NAV bucketed sleeves
# by TICKER via _sleeve_for, which can only say A-or-B — all 49 Momentum
# names landed in the Insider bucket. The fills ledger is the provenance
# record (every fill carries its originating order's sleeve), so positions
# and NAV must bucket from it. _sleeve_for survives only as the last-resort
# fallback for names with no fills history.
# ─────────────────────────────────────────────────────────────────────────────

def _sleeve_share_map() -> dict[str, dict[str, float]]:
    """{TICKER: {sleeve: net_shares}} from paper_fills (buys − sells)."""
    try:
        rows = _supabase_query(
            "select sleeve, ticker, "
            "sum(case when side='buy' then quantity else -quantity end) as net "
            "from public.paper_fills group by 1, 2;")
    except Exception as exc:  # noqa: BLE001
        logger.warning("sleeve share-map query failed (%s) — everything attributes to B", exc)
        return {}
    out: dict[str, dict[str, float]] = {}
    for r in rows:
        q = float(r.get("net") or 0)
        s = (r.get("sleeve") or "B").upper()
        t = (r.get("ticker") or "").upper()
        if q > 0.0001 and t:
            out.setdefault(t, {})[s] = q
    return out


def _split_position(p, share_map: dict[str, dict[str, float]]):
    """Split one broker position across sleeves in proportion to the fills
    ledger's net share counts. Returns [(sleeve, scaled AlpacaPosition)].
    A name owned by one sleeve passes through unscaled (fraction = 1);
    a name with no fills history attributes whole to 'B' (legacy fallback).
    Dollar fields scale linearly; per-share prices and % fields are
    unchanged by an ownership split."""
    from dataclasses import replace
    net = share_map.get(p.ticker.upper())
    if not net:
        return [("B", p)]
    total = sum(net.values())
    if total <= 0:
        return [("B", p)]
    parts = []
    for s in sorted(net):
        f = net[s] / total
        if f <= 0.0001:
            continue
        parts.append((s, p if f > 0.9999 else replace(
            p,
            qty=p.qty * f,
            market_value=p.market_value * f,
            cost_basis=p.cost_basis * f,
            unrealized_pl=p.unrealized_pl * f,
            unrealized_intraday_pl=p.unrealized_intraday_pl * f,
        )))
    return parts or [("B", p)]


def _restore_missing_tracked_positions(
    positions: list[AlpacaPosition],
    share_map: dict[str, dict[str, float]],
) -> list[AlpacaPosition]:
    """Refuse to book a phantom close when the broker positions feed omits a
    tracked name. (2026-08-06 deep-dive: on 8/4 Alpaca's positions response
    was missing PBF — 436.7992 sh held since 7/16, no sell fills — and the
    sync closed the book position AT COST, crediting sleeve cash $25,945.87
    with zero realized P&L, then re-opened it 8/5 when the feed healed.)

    A ticker with net shares in the fills ledger (buys - sells > 0, i.e. no
    sell fill ever closed it) that is absent from the broker feed is a FEED
    ERROR, not a liquidation: only a sell FILL may close a position. Book
    nothing — emit a loud greppable ::error:: line so the job output is
    red/alertable, and carry the book position forward at its last known
    snapshot price (close mode then re-marks it at the official session close
    as usual). Returns the positions list with the missing names restored."""
    broker = {p.ticker.upper() for p in positions}
    missing = sorted(
        t for t, sleeves in share_map.items()
        if t not in broker and sum(sleeves.values()) > 0.0001
    )
    if not missing:
        return positions
    out = list(positions)
    for t in missing:
        msg = (f"PAPER-SYNC position {t} missing from broker feed — no sell "
               "fills — refusing phantom close; carrying book position at "
               "last known price")
        print(f"::error::{msg}", flush=True)  # GitHub Actions error annotation
        logger.error(msg)
        try:
            rows = _supabase_query(
                "select sum(quantity) as qty, sum(cost_basis) as cb, "
                "max(current_price) as px from public.paper_positions "
                f"where upper(ticker) = {_sql_escape(t)} and snapshot_date = "
                "(select max(snapshot_date) from public.paper_positions "
                f"where upper(ticker) = {_sql_escape(t)});"
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("PAPER-SYNC could not read last book row for %s (%s) "
                         "— position cannot be carried this run", t, exc)
            continue
        r = rows[0] if rows else {}
        qty = float(r.get("qty") or 0)
        cb = float(r.get("cb") or 0)
        px = float(r.get("px") or 0)
        if qty <= 0 or px <= 0:
            logger.error("PAPER-SYNC no usable prior book row for %s "
                         "(qty=%s px=%s) — position cannot be carried this run", t, qty, px)
            continue
        mv = qty * px
        out.append(AlpacaPosition(
            ticker=t, qty=qty,
            avg_entry_price=(cb / qty if qty else 0.0),
            market_value=mv, cost_basis=cb,
            unrealized_pl=mv - cb, side="long",
            unrealized_plpc=((mv - cb) / cb if cb else 0.0),
            unrealized_intraday_pl=0.0, unrealized_intraday_plpc=0.0,
            current_price=px, lastday_price=px,
        ))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Official-close pricing (close phase)
# ─────────────────────────────────────────────────────────────────────────────

def official_closes(alpaca: "AlpacaPaperClient", tickers, session_date: date) -> dict:
    """Official daily-bar closes for session_date plus the prior session's
    close, per ticker, from the market-data host. {TICKER: (close, prev)}.
    Tickers whose latest bar is NOT session_date are omitted (no bar = the
    session didn't trade, or the bar isn't published yet)."""
    out: dict[str, tuple] = {}
    start = (session_date - timedelta(days=15)).isoformat()
    tgt = session_date.isoformat()
    for t in tickers:
        bars = [(d, c) for d, c in alpaca.get_daily_closes(t, start) if d <= tgt]
        if not bars or bars[-1][0] != tgt:
            continue
        out[t.upper()] = (bars[-1][1], bars[-2][1] if len(bars) >= 2 else None)
    return out


def _reprice_positions_to_close(positions, closes: dict):
    """Re-mark broker position rows at official session closes so every value
    written downstream (positions snapshot AND the NAV row) is marked at the
    close — immune to after-hours drift when the run fires late. AlpacaPosition
    is a FROZEN dataclass, so this builds replacements rather than mutating
    (the 2026-06-10 first close run crashed on FrozenInstanceError). Returns
    (new_positions, n_repriced); names with no session bar keep broker marks."""
    from dataclasses import replace
    out, n = [], 0
    for p in positions:
        cp = closes.get(p.ticker.upper())
        if not cp:
            out.append(p)
            continue
        close, prev = cp
        mv = p.qty * close
        upl = mv - p.cost_basis
        kw = dict(
            current_price=close,
            market_value=mv,
            unrealized_pl=upl,
            unrealized_plpc=(upl / p.cost_basis) if p.cost_basis else 0.0,
        )
        if prev:
            kw.update(
                lastday_price=prev,
                unrealized_intraday_pl=p.qty * (close - prev),
                unrealized_intraday_plpc=(close / prev - 1.0),
            )
        out.append(replace(p, **kw))
        n += 1
    return out, n


# ─────────────────────────────────────────────────────────────────────────────
# 1) Positions mirror
# ─────────────────────────────────────────────────────────────────────────────

def mirror_positions(
    alpaca: AlpacaPaperClient | None = None,
    snapshot_date: date | None = None,
    dry_run: bool = False,
    price_mode: str = "live",
) -> int:
    """Rewrite today's paper_positions snapshot from live Alpaca state.

    Strategy: DELETE today's rows + INSERT current positions in one
    transaction so two parallel runs can't double-insert. PK is
    (snapshot_date, sleeve, ticker) — INSERT collides on rerun.
    """
    alpaca = alpaca or AlpacaPaperClient()
    snapshot_date = snapshot_date or _et_today()
    positions = alpaca.get_positions()
    share_map = _sleeve_share_map()
    # (2026-08-06 deep-dive: broker-feed omission was booked as a phantom
    # at-cost liquidation) — a tracked name missing from the feed stays on the
    # book; only a sell fill may close a position.
    positions = _restore_missing_tracked_positions(positions, share_map)
    if price_mode == "close":
        closes = official_closes(alpaca, sorted({p.ticker.upper() for p in positions}), snapshot_date)
        positions, n_re = _reprice_positions_to_close(positions, closes)
        logger.info("close mode: %d/%d positions repriced to official %s closes",
                    n_re, len(positions), snapshot_date)
    entry_dates = {} if dry_run else _entry_dates_by_ticker()
    scan_scores = {} if dry_run else _latest_scan_scores()

    split_rows = [(s, sp) for p in positions for (s, sp) in _split_position(p, share_map)]

    if dry_run:
        for sleeve, p in split_rows:
            logger.info("[dry-run] %s %s qty=%s mv=$%.2f day=%+.2f%% total=%+.2f%% sleeve=%s",
                        snapshot_date, p.ticker, p.qty, p.market_value,
                        p.unrealized_intraday_plpc * 100, p.unrealized_plpc * 100, sleeve)
        return len(positions)

    sql_lines = [
        "begin;",
        f"delete from public.paper_positions where snapshot_date = '{snapshot_date.isoformat()}';",
    ]
    for sleeve, p in split_rows:
        ed = entry_dates.get(p.ticker)
        # Score column applies to the Insider sleeve (B) only.
        sc = scan_scores.get(p.ticker)
        score_sql = "NULL" if (sleeve != "B" or sc is None) else str(int(sc))
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
            f"{score_sql}, "
            "now()"
            ");"
        )
    sql_lines.append("commit;")
    _supabase_exec("\n".join(sql_lines))
    logger.info("mirrored %d positions for %s", len(positions), snapshot_date)

    # ── SINGLE PRICE SOURCE (2026-06-01, Joe directive: every price on the
    #    site comes from ONE place) ──────────────────────────────────────────
    # Alpaca gives us QUANTITIES + cost basis (the account truth), but its last
    # price differs from prices_eod (Polygon/Massive) — the feed the entire
    # rest of the site uses (Ticker, Scanner, Portfolio, Asset Tilt). That gap
    # made AMR read $217.09 here and $215.37 on the ticker page. After the
    # insert COMMITS above, overwrite the displayed price fields from
    # prices_eod so the Paper page agrees with every other surface.
    #
    # PERF: this runs as its OWN statement (not inside the insert transaction)
    # and is SCOPED to only the tickers we hold (`pe.ticker = any(...)`), so the
    # 1.4M-row prices_eod table is index-probed for ~35 symbols, not scanned.
    # An earlier version inlined an unfiltered CTE in the insert txn and timed
    # out at 30s, rolling back the whole snapshot. Keep the ticker filter.
    if price_mode == "close":
        # Close phase writes the broker's official session closes; the next
        # morning's open phase certifies them against prices_eod once
        # Polygon's full T+1 panel lands (see certify_snapshot_prices).
        return len(positions)

    held = sorted({p.ticker.upper() for p in positions})
    if held:
        tickers_sql = ", ".join(_sql_escape(t) for t in held)
        price_sql = f"""
        with latest as (
          select distinct on (ticker) ticker, close, trade_date
            from public.prices_eod
           where ticker = any(array[{tickers_sql}])
           order by ticker, trade_date desc
        ),
        prior1 as (
          select distinct on (pe.ticker) pe.ticker, pe.close
            from public.prices_eod pe
            join latest l on l.ticker = pe.ticker and pe.trade_date < l.trade_date
           order by pe.ticker, pe.trade_date desc
        )
        update public.paper_positions p
           set current_price = l.close,
               lastday_price = coalesce(pr.close, p.lastday_price),
               market_value  = p.quantity * l.close,
               unrealized_pnl = (p.quantity * l.close) - p.cost_basis,
               unrealized_intraday_pl = case when pr.close is not null
                   then p.quantity * (l.close - pr.close) else p.unrealized_intraday_pl end,
               last_updated = now()
          from latest l
          left join prior1 pr on pr.ticker = l.ticker
         where p.snapshot_date = '{snapshot_date.isoformat()}'
           and upper(p.ticker) = l.ticker;
        """
        try:
            _supabase_exec(price_sql)
            logger.info("unified %d position prices from prices_eod for %s", len(held), snapshot_date)
        except Exception as exc:  # never let the price-unify undo a good snapshot
            logger.warning("price-unify step failed (%s) — positions kept Alpaca prices", exc)

    return len(positions)


def certify_snapshot_prices(snapshot_date: date | None = None) -> int:
    """Re-price an EXISTING paper_positions snapshot from prices_eod — the
    site's single canonical price source — without creating a new snapshot.
    Defaults to the newest snapshot on record. The morning open phase calls
    this after Polygon's full T+1 panel lands, certifying (and, in the rare
    disagreement, correcting) the broker closes written by the close phase.
    Returns the number of held tickers targeted; 0 when nothing to do."""
    if snapshot_date is None:
        try:
            r = _supabase_query("select max(snapshot_date)::text as d from public.paper_positions;")
            d = r[0].get("d") if r else None
        except Exception as exc:
            logger.warning("certify: could not read latest snapshot date (%s)", exc)
            return 0
        if not d:
            return 0
        snapshot_date = date.fromisoformat(d)
    try:
        rows = _supabase_query(
            "select distinct upper(ticker) as t from public.paper_positions "
            f"where snapshot_date = '{snapshot_date.isoformat()}';"
        )
    except Exception as exc:
        logger.warning("certify: held-tickers query failed (%s)", exc)
        return 0
    held = sorted(r["t"] for r in rows if r.get("t"))
    if not held:
        return 0
    tickers_sql = ", ".join(_sql_escape(t) for t in held)
    price_sql = f"""
    with latest as (
      select distinct on (ticker) ticker, close, trade_date
        from public.prices_eod
       where ticker = any(array[{tickers_sql}])
       order by ticker, trade_date desc
    ),
    prior1 as (
      select distinct on (pe.ticker) pe.ticker, pe.close
        from public.prices_eod pe
        join latest l on l.ticker = pe.ticker and pe.trade_date < l.trade_date
       order by pe.ticker, pe.trade_date desc
    )
    update public.paper_positions p
       set current_price = l.close,
           lastday_price = coalesce(pr.close, p.lastday_price),
           market_value  = p.quantity * l.close,
           unrealized_pnl = (p.quantity * l.close) - p.cost_basis,
           unrealized_intraday_pl = case when pr.close is not null
               then p.quantity * (l.close - pr.close) else p.unrealized_intraday_pl end,
           last_updated = now()
      from latest l
      left join prior1 pr on pr.ticker = l.ticker
     where p.snapshot_date = '{snapshot_date.isoformat()}'
       and upper(p.ticker) = l.ticker
       and l.trade_date = '{snapshot_date.isoformat()}';
    """
    try:
        _supabase_exec(price_sql)
        logger.info("certified %d position prices from prices_eod for %s", len(held), snapshot_date)
        return len(held)
    except Exception as exc:
        logger.warning("certify step failed (%s) — snapshot keeps broker closes", exc)
        return 0


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

    # Sleeve attribution (Two-Sleeve build PR-2): the ticker-based fallback
    # cannot tell Momentum from the scanner sleeve, so prefer the sleeve the
    # ORDER was written with — paper_orders carries it, keyed by the broker
    # order id the submitter stored.
    sleeve_by_order_id: dict[str, str] = {}
    try:
        _ids = sorted({o.get("id") for o in orders if o.get("id")})
        if _ids:
            _in = ", ".join(f"'{i}'" for i in _ids)
            for r in _supabase_query(
                "select alpaca_order_id, sleeve from public.paper_orders "
                f"where alpaca_order_id in ({_in});"
            ):
                if r.get("alpaca_order_id") and r.get("sleeve"):
                    sleeve_by_order_id[r["alpaca_order_id"]] = r["sleeve"]
    except Exception as exc:  # noqa: BLE001 — fall back to ticker heuristic
        logger.warning("order-id sleeve lookup failed (%s) — ticker fallback", exc)

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
        sleeve = sleeve_by_order_id.get(alpaca_order_id) or _sleeve_for(ticker, sleeve_a_etfs)
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

    # ── ORDER-STATUS RECONCILIATION (2026-07-15, bug: rows stuck on
    # 'submitted' forever while the fill sat in paper_fills). Close the loop:
    # every 'submitted' order whose broker order reached a terminal state gets
    # its status updated here, in the same run that mirrors the fills. ──
    if not dry_run:
        try:
            terminal: list[str] = []
            for o in orders:
                st = o.get("status")
                oid = o.get("id")
                if not oid:
                    continue
                if st in ("filled", "partially_filled"):
                    fa = o.get("filled_at")
                    terminal.append(
                        "update public.paper_orders set status='filled', "
                        f"filled_at = coalesce({_sql_escape(fa)}::timestamptz, filled_at, now()) "
                        f"where alpaca_order_id = {_sql_escape(oid)} and status = 'submitted';")
                elif st in ("canceled", "cancelled", "expired", "done_for_day"):
                    terminal.append(
                        "update public.paper_orders set status='cancelled', "
                        f"rejection_reason = {_sql_escape('broker: ' + str(st))} "
                        f"where alpaca_order_id = {_sql_escape(oid)} and status = 'submitted';")
                elif st == "rejected":
                    terminal.append(
                        "update public.paper_orders set status='rejected', "
                        f"rejection_reason = {_sql_escape('broker: rejected')} "
                        f"where alpaca_order_id = {_sql_escape(oid)} and status = 'submitted';")
            # Belt-and-braces: any 'submitted' order that already has a fills
            # row (e.g. mirrored by an earlier run) flips to 'filled' too.
            terminal.append(
                "update public.paper_orders o set status='filled', "
                "filled_at = coalesce(f.first_fill, o.filled_at, now()) "
                "from (select alpaca_order_id, min(filled_at) as first_fill "
                "      from public.paper_fills group by 1) f "
                "where o.alpaca_order_id = f.alpaca_order_id and o.status = 'submitted';")
            _supabase_exec("begin;\n" + "\n".join(terminal) + "\ncommit;")
            logger.info("order-status reconciliation ran (%d broker updates + fills sweep)",
                        len(terminal) - 1)
        except Exception as exc:  # noqa: BLE001 — reconciliation must not undo a good fills mirror
            logger.warning("order-status reconciliation failed (%s) — will retry next run", exc)

    logger.info("mirrored %d fills since %s", n_inserted, since_iso)
    return n_inserted


# ─────────────────────────────────────────────────────────────────────────────
# 3) NAV daily writer
# ─────────────────────────────────────────────────────────────────────────────

def _sleeve_day_pnl(
    alpaca: AlpacaPaperClient,
    positions,
    closes: dict,
    session_date: date,
    share_map: dict[str, dict[str, float]],
) -> dict:
    """EXACT per-sleeve session P&L, decomposed so it ties out three ways:
      * held-through shares earn (close − prior close)
      * shares BOUGHT today earn (close − fill price)
      * shares SOLD today earn (fill price − prior close)
    Cash earns nothing, so Sleeve A + Sleeve B == the book's NAV change
    (close-over-close) to the cent, AND on no-trade days each sleeve equals
    the sum of its table's Day P&L column. This is the number the page's
    Performance card displays; the net-equity delta (which silently moves
    idle-cash share between sleeves as their capacity gaps shift) is only
    the fallback. (Joe 2026-06-10: card said +$809 while the table said
    −$4,901 — never again.)"""
    out = {"A": 0.0, "B": 0.0, "M": 0.0}
    try:
        fills = _supabase_query(
            "select sleeve, ticker, side, quantity, price from public.paper_fills "
            f"where (filled_at at time zone 'America/New_York')::date = '{session_date.isoformat()}';"
        )
    except Exception as exc:
        logger.warning("day-pnl: fills query failed (%s) — using holdings-only attribution", exc)
        fills = []
    bought: dict[tuple, list] = {}   # (sleeve, ticker) → [qty, $]
    sold: dict[tuple, list] = {}
    for f in fills:
        t = (f.get("ticker") or "").upper()
        s = (f.get("sleeve") or "B").upper()
        q = float(f.get("quantity") or 0)
        px = float(f.get("price") or 0)
        if q <= 0 or px <= 0:
            continue
        side = (f.get("side") or "").lower()
        if side == "buy":
            agg = bought.setdefault((s, t), [0.0, 0.0]); agg[0] += q; agg[1] += q * px
        elif side == "sell":
            agg = sold.setdefault((s, t), [0.0, 0.0]); agg[0] += q; agg[1] += q * px

    # prior closes for names sold out today (not in the current position set)
    missing = sorted({t for (_s, t) in sold if t not in closes})
    if missing:
        closes = {**closes, **official_closes(alpaca, missing, session_date)}

    # Base = the SAME per-position day P&L the sleeve table sums (already
    # marked at official closes by the reprice step; names with no session
    # bar keep broker marks — table, NAV and this number then agree on the
    # same mark, which is the property that matters). Buys are corrected so
    # today's bought shares earn (close − fill) instead of the full
    # (close − prior close) the position-level number assumes.
    for p in positions:
        t = p.ticker.upper()
        for sleeve, sp in _split_position(p, share_map):
            out[sleeve] = out.get(sleeve, 0.0) + float(sp.unrealized_intraday_pl or 0.0)
            bq_all = bought.get((sleeve, t))
            if bq_all and bq_all[0] > 0:
                cp = closes.get(t)
                prev = cp[1] if (cp and cp[1]) else (p.lastday_price or None)
                if prev:
                    bq = min(bq_all[0], sp.qty)
                    avg_fill = bq_all[1] / bq_all[0]
                    out[sleeve] += bq * (prev - avg_fill)
    # Sells: sold shares earned (fill − prior close); they are absent from
    # the position rows, so add them here. The fill row carries its sleeve.
    for (sleeve, t), (sq, snotional) in sold.items():
        cp = closes.get(t)
        prev = cp[1] if cp else None
        if prev is None:
            logger.warning("day-pnl: no prior close for sold name %s — its sold-share P&L omitted", t)
            continue
        out[sleeve] = out.get(sleeve, 0.0) + sq * (snotional / sq - prev)
    return out


def write_nav_daily(
    alpaca: AlpacaPaperClient | None = None,
    snapshot_date: date | None = None,
    dry_run: bool = False,
    price_mode: str = "live",
) -> dict:
    """Compute today's sleeve A / sleeve B / total NAV and upsert one row
    into paper_nav_daily (PK on snapshot_date)."""
    alpaca = alpaca or AlpacaPaperClient()
    snapshot_date = snapshot_date or _et_today()

    account = alpaca.get_account()
    positions = alpaca.get_positions()
    share_map = _sleeve_share_map()
    # (2026-08-06 deep-dive: broker-feed omission was booked as a phantom
    # at-cost liquidation) — a tracked name missing from the feed stays on the
    # book; only a sell fill may close a position.
    positions = _restore_missing_tracked_positions(positions, share_map)
    nav_closes: dict = {}
    if price_mode == "close":
        nav_closes = official_closes(
            alpaca,
            sorted({p.ticker.upper() for p in positions} | {"SPY", "AGG", "QQQ", "DIA", "IWM"}),
            snapshot_date,
        )
        if "SPY" not in nav_closes:
            logger.warning("close mode: no SPY bar for %s — not a settled session; skipping NAV write",
                           snapshot_date)
            return {}
        positions, _ = _reprice_positions_to_close(positions, nav_closes)

    # Three-way bucketing by fills provenance (2026-07-15 fix): A is the
    # retired legacy sleeve (always zero), B = Insider Conviction, M =
    # Momentum / Power Trend. _split_position handles both-sleeve overlap.
    sleeve_a_equity = sleeve_b_equity = sleeve_m_equity = 0.0
    sleeve_a_unrl = sleeve_b_unrl = sleeve_m_unrl = 0.0
    sleeve_b_basis = 0.0     # still feeds sleeve_b_margin_used below
    sleeve_a_n = sleeve_b_n = sleeve_m_n = 0
    for p in positions:
        for sleeve, sp in _split_position(p, share_map):
            if sleeve == "A":
                sleeve_a_equity += sp.market_value; sleeve_a_unrl += sp.unrealized_pl; sleeve_a_n += 1
            elif sleeve == "M":
                sleeve_m_equity += sp.market_value; sleeve_m_unrl += sp.unrealized_pl; sleeve_m_n += 1
            else:
                sleeve_b_equity += sp.market_value; sleeve_b_unrl += sp.unrealized_pl; sleeve_b_n += 1
                sleeve_b_basis += sp.cost_basis

    # Cash — a sleeve's idle cash is its initial capital plus the NET CASH
    # FLOW of its actual fills (sum of sell proceeds minus sum of buy costs),
    # one accounting method end-to-end. (2026-08-06 deep-dive: the old
    # capital − broker FIFO-lot basis + avg-cost realized rederivation mixed
    # two lot methods and drifted from fill-implied cash by exactly avg-cost
    # minus FIFO realized on every multi-lot partial sell.) Signed, never
    # floored, so equity + cash always ties to the sleeve's true value.
    cap_a = 0.0        # Sleeve A retired 2026-06-23
    # B/M capital bases come from paper_accounts allocations (config, not
    # accounting): 500K/500K in the two-sleeve era; whole-account/0 after the
    # Conviction Events epoch reset.
    cap_b, cap_m = _sleeve_initial_capital()
    realized_by_sleeve = _realized_pnl_by_sleeve()
    fill_cash = _fill_cashflows_by_sleeve()
    sleeve_a_cash = 0.0
    sleeve_b_cash = cap_b + fill_cash.get("B", 0.0)
    sleeve_m_cash = cap_m + fill_cash.get("M", 0.0)
    sleeve_b_margin_used = max(0.0, sleeve_b_basis - cap_b)
    sleeve_a_nav = sleeve_a_cash + sleeve_a_equity
    sleeve_b_nav = sleeve_b_cash + sleeve_b_equity
    sleeve_m_nav = sleeve_m_cash + sleeve_m_equity
    # Close mode values the book at official session closes (cash is static
    # after hours, so cash + Σ qty×close IS closing equity, to the cent, and
    # ties exactly to the positions snapshot written the same run). Live mode
    # keeps broker-reported equity.
    if price_mode == "close":
        total_nav = float(account.cash) + sum(p.market_value for p in positions)
    else:
        total_nav = float(account.equity)

    # Benchmarks — store the RAW closing prices for the benchmark set. The
    # page normalizes each to a $1M capital-matched start (buy-and-hold), so
    # the comparison is apples-to-apples in dollars. 2026-07-03 (Joe): the
    # comparison set is SPY (S&P 500), QQQ (NASDAQ 100), DIA (Dow 30) and
    # IWM (Russell 2000); AGG remains for the legacy blend column.
    def _bench_close(sym: str):
        if price_mode == "close":
            return nav_closes[sym][0] if sym in nav_closes else alpaca.get_close_price(sym)
        return alpaca.get_close_price(sym)
    spy_close = _bench_close("SPY")
    agg_close = _bench_close("AGG")
    qqq_close = _bench_close("QQQ")
    dia_close = _bench_close("DIA")
    iwm_close = _bench_close("IWM")
    # Back-compat: keep the old 100-share anchor column populated.
    spy_value = spy_close * 100 if spy_close else None

    # P&L decomposition. Open (unrealized) P&L is exact from Alpaca per-position.
    # Realized = the SUM of the per-sleeve average-cost realized figures over
    # the fills ledger. (2026-08-06 deep-dive: total_realized_pnl was a plug —
    # total_nav − $1M − unrealized — so any broker-NAV error landed in the
    # realized column; the per-sleeve avg-cost figures are the record.)
    total_unrl = sleeve_a_unrl + sleeve_b_unrl + sleeve_m_unrl
    total_realized = (realized_by_sleeve.get("A", 0.0)
                      + realized_by_sleeve.get("B", 0.0)
                      + realized_by_sleeve.get("M", 0.0))
    beta = _portfolio_beta(snapshot_date)

    # Sleeve value = NET EQUITY: the sleeve's gross holdings minus its share of
    # the account's borrowing. Defined this way, sleeve_a_value + sleeve_b_value
    # == total_nav (Alpaca's reported account equity — the only true value),
    # so the page's Total always equals the sum of its sleeves.
    #
    # The earlier formula (500K + per-sleeve avg-cost realized + open P&L) used
    # realized_by_sleeve, an informational lot estimate that did NOT reconcile
    # to the account equity — it overstated the book by ~$33K and made the
    # sleeves fail to sum to the total. realized_by_sleeve is still stored below
    # for reference, but it must not drive the sleeve value.
    # Sleeve value = the sleeve's own equity + its own cash (basis-derived
    # above). Any residual against the broker's true account equity (lot-calc
    # rounding, fees, interest) is distributed pro-rata so the sleeves always
    # sum EXACTLY to total_nav — the page's Total must equal its parts.
    sleeve_a_value = sleeve_a_equity  # retired: no cash share
    _raw_b = sleeve_b_equity + sleeve_b_cash
    _raw_m = sleeve_m_equity + sleeve_m_cash
    _resid = total_nav - sleeve_a_value - _raw_b - _raw_m
    _wbase = abs(_raw_b) + abs(_raw_m)
    if _wbase > 0:
        sleeve_b_value = _raw_b + _resid * (abs(_raw_b) / _wbase)
        sleeve_m_value = _raw_m + _resid * (abs(_raw_m) / _wbase)
    else:
        sleeve_b_value = _raw_b + _resid / 2.0
        sleeve_m_value = _raw_m + _resid / 2.0
    sleeve_a_beta = _beta_for("sleeve_a_value")
    sleeve_b_beta = _beta_for("sleeve_b_value")

    # Exact per-sleeve session P&L (close mode only — needs official closes).
    day_pnl = {"A": None, "B": None, "M": None}
    if price_mode == "close":
        try:
            day_pnl = _sleeve_day_pnl(alpaca, positions, nav_closes, snapshot_date, share_map)
        except Exception:
            logger.exception("sleeve day-pnl computation failed — storing NULLs (page falls back)")
            day_pnl = {"A": None, "B": None, "M": None}

    # SPY benchmark anchors (inception / trailing-12m / prior close) so the
    # S&P 500 + Vs rows are real on day one. Page computes returns from these.
    bench_anchor = _benchmark_anchor_closes(alpaca)
    spy_anchor = bench_anchor.get("SPY", {})
    spy_prev_close = spy_anchor.get("prev")
    spy_inception_close = spy_anchor.get("inception")
    spy_ttm_close = spy_anchor.get("ttm")
    qqq_prev_close = bench_anchor.get("QQQ", {}).get("prev")
    qqq_inception_close = bench_anchor.get("QQQ", {}).get("inception")
    dia_prev_close = bench_anchor.get("DIA", {}).get("prev")
    dia_inception_close = bench_anchor.get("DIA", {}).get("inception")
    iwm_prev_close = bench_anchor.get("IWM", {}).get("prev")
    iwm_inception_close = bench_anchor.get("IWM", {}).get("inception")

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
            "qqq_close": qqq_close, "qqq_prev_close": qqq_prev_close, "qqq_inception_close": qqq_inception_close,
            "dia_close": dia_close, "dia_prev_close": dia_prev_close, "dia_inception_close": dia_inception_close,
            "iwm_close": iwm_close, "iwm_prev_close": iwm_prev_close, "iwm_inception_close": iwm_inception_close,
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
        " sleeve_a_day_pnl, sleeve_b_day_pnl, "
        " sleeve_m_cash, sleeve_m_equity, sleeve_m_nav, sleeve_m_value, "
        " sleeve_m_unrealized_pnl, sleeve_m_realized_pnl, sleeve_m_positions, "
        " sleeve_m_day_pnl, "
        " spy_prev_close, spy_inception_close, spy_ttm_close, "
        " qqq_close, qqq_prev_close, qqq_inception_close, "
        " dia_close, dia_prev_close, dia_inception_close, "
        " iwm_close, iwm_prev_close, iwm_inception_close, created_at) "
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
        f"{_num(day_pnl.get('A'))}, {_num(day_pnl.get('B'))}, "
        f"{sleeve_m_cash}, {sleeve_m_equity}, {sleeve_m_nav}, {sleeve_m_value}, "
        f"{sleeve_m_unrl}, {realized_by_sleeve.get('M', 0.0)}, {sleeve_m_n}, "
        f"{_num(day_pnl.get('M'))}, "
        f"{_num(spy_prev_close)}, {_num(spy_inception_close)}, {_num(spy_ttm_close)}, "
        f"{_num(qqq_close)}, {_num(qqq_prev_close)}, {_num(qqq_inception_close)}, "
        f"{_num(dia_close)}, {_num(dia_prev_close)}, {_num(dia_inception_close)}, "
        f"{_num(iwm_close)}, {_num(iwm_prev_close)}, {_num(iwm_inception_close)}, "
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
        "  sleeve_a_day_pnl = excluded.sleeve_a_day_pnl, "
        "  sleeve_b_day_pnl = excluded.sleeve_b_day_pnl, "
        "  sleeve_m_cash = excluded.sleeve_m_cash, "
        "  sleeve_m_equity = excluded.sleeve_m_equity, "
        "  sleeve_m_nav = excluded.sleeve_m_nav, "
        "  sleeve_m_value = excluded.sleeve_m_value, "
        "  sleeve_m_unrealized_pnl = excluded.sleeve_m_unrealized_pnl, "
        "  sleeve_m_realized_pnl = excluded.sleeve_m_realized_pnl, "
        "  sleeve_m_positions = excluded.sleeve_m_positions, "
        "  sleeve_m_day_pnl = excluded.sleeve_m_day_pnl, "
        "  spy_prev_close = excluded.spy_prev_close, "
        "  spy_inception_close = excluded.spy_inception_close, "
        "  spy_ttm_close = excluded.spy_ttm_close, "
        "  qqq_close = excluded.qqq_close, qqq_prev_close = excluded.qqq_prev_close, "
        "  qqq_inception_close = excluded.qqq_inception_close, "
        "  dia_close = excluded.dia_close, dia_prev_close = excluded.dia_prev_close, "
        "  dia_inception_close = excluded.dia_inception_close, "
        "  iwm_close = excluded.iwm_close, iwm_prev_close = excluded.iwm_prev_close, "
        "  iwm_inception_close = excluded.iwm_inception_close, "
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
        "sleeve_m_cash": sleeve_m_cash, "sleeve_m_equity": sleeve_m_equity, "sleeve_m_nav": sleeve_m_nav,
        "total_nav": total_nav, "benchmark_spy_value": spy_value,
        "spy_close": spy_close, "agg_close": agg_close,
        "total_unrealized_pnl": total_unrl, "total_realized_pnl": total_realized,
        "sleeve_a_positions": sleeve_a_n, "sleeve_b_positions": sleeve_b_n,
        "sleeve_m_positions": sleeve_m_n,
        "portfolio_beta": beta,
    }
