"""
paper_portfolio.conviction — the Conviction Events paper-trading engine.

ONE book replacing the two retired sleeves (Insider Conviction + Momentum,
frozen 2026-08-10). Strategy is the validated spec, implemented exactly:

  EVENT      per (ticker, filing_date): aggregated open-market insider BUYS
             (Form 4 transaction code 'P'), excluding 10b5-1 rows, whose
             deduped dollar total is >= $250,000. Source rows are the UNION of
             public.insider_history (vendor — dies with the 2026-08-12
             subscription lapse) and public.insider_history_edgar (SEC shadow,
             primary going forward). Dedup runs in two stages:
               1. exact-duplicate rows (same ticker/filing/transaction date,
                  owner, shares, price, shares-owned-after — the vendor and
                  EDGAR copies of the same row collapse to one; the EDGAR
                  copy is kept);
               2. joint-filer lot collapse on (ticker, transaction_date,
                  amount, price, shares_owned_after) — an LP + its GP + fund
                  entities reporting the SAME lot count it once.

  GATES      at scan time, all from the site's canonical stores, window
             ending at the PREVIOUS close (no look-ahead):
               * universe_master active with type in ('CS', 'ADRC');
               * previous close >= $5;
               * 21-day average dollar volume (close x volume) >= $2M;
               * previous close > 50-day SMA (prices_eod).

  ENTRY      at the next market open after filing (market-on-open order
             queued pre-open). Sizing: floor((equity / 8) / previous close)
             WHOLE shares — 1/8 of current account equity per position.
             Max 8 concurrent positions, one position per ticker; when the
             book is full, same-morning events are ranked by total dollar
             size and the overflow is skipped.

  EXIT       market sell at the open of the 21st trading day after entry,
             counting the entry day as day 1 — i.e. the 20th trading session
             strictly after the entry session (held 20 full trading days).
             NYSE trading-day calendar via the broker calendar (the same
             source freshness.is_trading_session uses). NO stops, NO profit
             targets.

  KILL       pre-registered, in-engine. After each close the kill-check
  SWITCH     phase computes the book's return since the new inception vs SPY
             since inception, and the max drawdown from the book's peak,
             from public.paper_nav_daily. If (>= 40 trading days since
             inception AND the book trails SPY by >= 10 percentage points)
             OR (drawdown >= 15%): the trip is recorded in
             public.ce_kill_switch and the submitter refuses ALL new entries
             while tripped (exits still execute). A fresh trip emits a
             ::error:: annotation and fails the job so WORKFLOW_FAILURE_ALERT
             emails. Tripped state LATCHES until a human resets the row.

BOOKKEEPING — the book lives in the existing paper_* tables in the SLEEVE B
slot (sleeve 'B', signal_source 'conviction_events'); sleeve_m allocation is
0 and no sleeve-M trades are ever created. mirror.py / intraday.py accounting
is reused untouched (the 87906a84 fixes carry over).

Phases (CLI):
  --phase open        pre-open (CONVICTION-OPEN-DAILY, ~12:45Z): reconcile
                      fills into ce_events, place exits due today FIRST, then
                      build events, apply gates, place entries; record the
                      expected entry/exit counts in paper_signal_capture
                      (scripts/ce_capture.py, LESSONS 8.20).
  --phase kill-check  post-close (CONVICTION-KILL-CHECK, 21:15Z): reconcile
                      fills, evaluate + record the kill switch.

Honors PAPER_LIVE_TRADING_ENABLED exactly like paper_portfolio.runner: unless
the env var is the literal 'true' (or --force-live is passed), a non-dry-run
invocation downgrades to dry-run. The flag is FROZEN 'false' until cutover.
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.diff import OrderIntent
from paper_portfolio.freshness import file_alert, is_trading_session
from paper_portfolio.mirror import _et_today, _sql_escape

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("paper_conviction")

# ─────────────────────────────────────────────────────────────────────────────
# Locked strategy constants (validated spec — any change needs Senior Quant
# sign-off + a backtest re-run in the same PR).
# ─────────────────────────────────────────────────────────────────────────────

MIN_EVENT_USD = 250_000.0            # aggregated deduped buys per (ticker, filing_date)
MIN_PREV_CLOSE_USD = 5.0             # gate: previous close >= $5
MIN_AVG_DOLLAR_VOLUME_USD = 2_000_000.0   # gate: 21-day AVG close*volume >= $2M
DOLLAR_VOLUME_WINDOW_DAYS = 21       # trading rows, window ending at prev close
SMA_WINDOW_DAYS = 50                 # gate: prev close > 50-day SMA (no look-ahead)
MAX_CONCURRENT_POSITIONS = 8         # book capacity
SLOT_FRACTION = 1.0 / 8.0            # 1/8 of current account equity per position
HOLD_FULL_TRADING_DAYS = 20          # exit at open of 21st trading day (entry day = day 1)
KILL_MIN_TRADING_DAYS = 40           # underperformance arm needs >= 40 trading days
KILL_TRAIL_SPY_PTS = 0.10            # book trails SPY by >= 10 percentage points
KILL_MAX_DRAWDOWN = 0.15             # drawdown from the book's peak >= 15%
INCLUDED_ASSET_TYPES = ("CS", "ADRC")  # universe_master.type (same as scanner universe)

SLEEVE = "B"                         # the Conviction book lives in the Sleeve B slot
SIGNAL_SOURCE = "conviction_events"
FILING_LOOKBACK_CALENDAR_DAYS = 7    # covers long weekends when mapping filing -> next open


def _live_trading_enabled() -> bool:
    """Same kill-switch contract as paper_portfolio.runner: live only when
    PAPER_LIVE_TRADING_ENABLED == 'true' (case-insensitive)."""
    return os.environ.get("PAPER_LIVE_TRADING_ENABLED", "").strip().lower() == "true"


# ─────────────────────────────────────────────────────────────────────────────
# Supabase access (module-level so tests monkeypatch, same as mirror.py)
# ─────────────────────────────────────────────────────────────────────────────

def _supabase_query(sql: str) -> list[dict[str, Any]]:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN required.")
    from paper_portfolio._sbq import sb_query
    return sb_query(sql, token)


def _supabase_exec(sql: str) -> None:
    _ = _supabase_query(sql)


def _num_sql(v) -> str:
    return "NULL" if v is None else repr(float(v))


# ─────────────────────────────────────────────────────────────────────────────
# Event building — pure functions (unit-tested directly; production uses the
# SAME code path on rows fetched below, so test math == live math)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class InsiderRow:
    """One normalized purchase row from either insider table.
    `shares` is the share count (both tables store it in `amount`);
    dollar value = shares x price."""
    ticker: str
    filing_date: str            # YYYY-MM-DD
    transaction_date: str       # YYYY-MM-DD
    owner_name: str
    shares: float | None
    price: float | None
    shares_owned_after: float | None
    is_10b5_1: bool
    transaction_code: str
    source: str                 # 'vendor' | 'edgar'


@dataclass
class ConvictionEvent:
    ticker: str
    filing_date: str
    total_usd: float
    insider_names: list[str]
    n_insiders: int
    is_edgar_sourced: bool
    # gate verdict (filled by apply_gates)
    passed_gates: bool | None = None
    gate_fail_reason: str | None = None
    above_sma50: bool | None = None
    # decision (filled by the open phase)
    action: str | None = None
    entry_qty: int | None = None
    exit_due_date: str | None = None


def _owner_key(name: str) -> str:
    return (name or "").strip().lower()


def dedup_exact(rows: Iterable[InsiderRow]) -> list[InsiderRow]:
    """Dedup stage 1 — exact-duplicate rows. The vendor and EDGAR feeds carry
    the same filing; a row identical on (ticker, filing_date, transaction_date,
    owner, shares, price, shares_owned_after) collapses to ONE. The EDGAR copy
    is preferred (SEC shadow is primary going forward), so the event's
    is_edgar_sourced flag reflects EDGAR coverage honestly."""
    best: dict[tuple, InsiderRow] = {}
    order: list[tuple] = []
    for r in rows:
        key = (r.ticker.upper(), r.filing_date, r.transaction_date,
               _owner_key(r.owner_name), r.shares, r.price, r.shares_owned_after)
        if key not in best:
            best[key] = r
            order.append(key)
        elif best[key].source != "edgar" and r.source == "edgar":
            best[key] = r
    return [best[k] for k in order]


def collapse_joint_lots(rows: Iterable[InsiderRow]) -> list[InsiderRow]:
    """Dedup stage 2 — joint-filer lot collapse on (ticker, transaction_date,
    amount, price, shares_owned_after). A group filing (an LP + its GP + its
    fund entities) reports the SAME shares once per affiliated owner; the lot
    counts ONCE toward the event total. The kept row is the first-seen owner
    (the lead filer — mirrors the EDGAR ingest's lead-owner convention).
    Any surviving EDGAR provenance in the group is preserved on the kept row."""
    kept: dict[tuple, InsiderRow] = {}
    order: list[tuple] = []
    for r in rows:
        key = (r.ticker.upper(), r.transaction_date,
               r.shares, r.price, r.shares_owned_after)
        if key not in kept:
            kept[key] = r
            order.append(key)
        elif kept[key].source != "edgar" and r.source == "edgar":
            # same lot, later row carries EDGAR provenance — keep the lead
            # filer's name but mark the lot EDGAR-sourced
            lead = kept[key]
            kept[key] = InsiderRow(
                ticker=lead.ticker, filing_date=lead.filing_date,
                transaction_date=lead.transaction_date,
                owner_name=lead.owner_name, shares=lead.shares,
                price=lead.price, shares_owned_after=lead.shares_owned_after,
                is_10b5_1=lead.is_10b5_1,
                transaction_code=lead.transaction_code, source="edgar",
            )
    return [kept[k] for k in order]


def aggregate_events(rows: Iterable[InsiderRow]) -> list[ConvictionEvent]:
    """Build events per (ticker, filing_date) from raw insider rows.

    Filters: transaction_code == 'P' (open-market purchase) and NOT 10b5-1.
    Then dedup stage 1 (exact duplicates across the vendor/EDGAR union) and
    stage 2 (joint-filer lot collapse). An event exists only when the deduped
    dollar total (shares x price) reaches MIN_EVENT_USD. Rows missing shares
    or price cannot be valued and contribute $0."""
    eligible = [r for r in rows
                if (r.transaction_code or "").upper() == "P" and not r.is_10b5_1]
    lots = collapse_joint_lots(dedup_exact(eligible))

    grouped: dict[tuple[str, str], list[InsiderRow]] = {}
    for lot in lots:
        grouped.setdefault((lot.ticker.upper(), lot.filing_date), []).append(lot)

    events: list[ConvictionEvent] = []
    for (ticker, filing_date), group in sorted(grouped.items()):
        total = 0.0
        names: list[str] = []
        seen_names: set[str] = set()
        edgar = False
        for lot in group:
            if lot.shares is not None and lot.price is not None:
                total += float(lot.shares) * float(lot.price)
            ok = _owner_key(lot.owner_name)
            if ok and ok not in seen_names:
                seen_names.add(ok)
                names.append(lot.owner_name.strip())
            if lot.source == "edgar":
                edgar = True
        if total >= MIN_EVENT_USD:
            events.append(ConvictionEvent(
                ticker=ticker, filing_date=filing_date, total_usd=total,
                insider_names=sorted(names), n_insiders=len(seen_names),
                is_edgar_sourced=edgar,
            ))
    return events


def rank_same_morning(events: list[ConvictionEvent]) -> list[ConvictionEvent]:
    """Same-morning ranking when the book cannot take every event: biggest
    total dollar size first; ticker asc breaks ties deterministically."""
    return sorted(events, key=lambda e: (-e.total_usd, e.ticker))


def decide_actions(
    events: list[ConvictionEvent],
    free_slots: int,
    kill_switch_tripped: bool,
    blocked_tickers: set[str],
    equity: float,
    prev_closes: dict[str, float | None],
    sessions: list["date"],
    session: "date",
) -> list[ConvictionEvent]:
    """Assign the final action to every gated event and size the entries.
    PURE — this is the production decision path the open phase runs.

    Precedence per event: gate failure -> 'skipped_gate'; ticker already in
    the book (one position per ticker) -> 'skipped_dup'; kill switch tripped
    -> 'blocked_kill_switch'; then the survivors are ranked by total dollar
    size and fill the free slots — overflow -> 'skipped_full'. An entry that
    sizes to 0 whole shares (floor((equity/8)/prev close)) cannot be taken
    and records 'skipped_gate' with the sizing reason appended. Entered
    events get entry_qty + exit_due_date (open of the 21st trading day,
    entry day = day 1). Returns the entered events in rank order."""
    survivors: list[ConvictionEvent] = []
    for e in events:
        if not e.passed_gates:
            e.action = "skipped_gate"
        elif e.ticker in blocked_tickers:
            e.action = "skipped_dup"          # one position per ticker
        elif kill_switch_tripped:
            e.action = "blocked_kill_switch"
        else:
            survivors.append(e)

    entered: list[ConvictionEvent] = []
    for e in rank_same_morning(survivors):
        if len(entered) >= free_slots:
            e.action = "skipped_full"
            continue
        prev_close = prev_closes.get(e.ticker)
        qty = size_entry(equity, prev_close)
        if qty < 1:
            e.action = "skipped_gate"
            e.gate_fail_reason = ((e.gate_fail_reason + "; ") if e.gate_fail_reason else "") + (
                f"cannot size: floor((equity/8)/prev close ${prev_close}) = 0 whole shares")
            continue
        e.action = "entered"
        e.entry_qty = qty
        due = exit_due_session(sessions, session)
        e.exit_due_date = due.isoformat() if due else None
        entered.append(e)
    return entered


# ─────────────────────────────────────────────────────────────────────────────
# Gates — pure function over price history rows (window MUST end at the
# previous close; the function re-asserts no-look-ahead by dropping any row
# dated on/after the session being traded)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PriceBar:
    trade_date: str     # YYYY-MM-DD
    close: float
    volume: float


def apply_gates(
    event: ConvictionEvent,
    session_date: str,
    universe_row: dict | None,
    history: list[PriceBar],
) -> ConvictionEvent:
    """Fill passed_gates / gate_fail_reason / above_sma50 on the event.

    `history` is ascending daily bars for the ticker. NO LOOK-AHEAD: every bar
    dated on/after `session_date` is discarded before any window is computed —
    the SMA / dollar-volume / previous-close windows all END at the previous
    close. All gate failures are reported (semicolon-joined), not just the
    first."""
    hist = sorted((b for b in history if b.trade_date < session_date),
                  key=lambda b: b.trade_date)
    reasons: list[str] = []

    utype = (universe_row or {}).get("type")
    active = bool((universe_row or {}).get("active"))
    if universe_row is None:
        reasons.append("not in universe_master")
    elif not active or utype not in INCLUDED_ASSET_TYPES:
        reasons.append(f"universe type/active fails (type={utype}, active={active})")

    prev_close = hist[-1].close if hist else None
    if prev_close is None:
        reasons.append("no prices_eod history before the session")
    else:
        if prev_close < MIN_PREV_CLOSE_USD:
            reasons.append(f"previous close ${prev_close:,.2f} < ${MIN_PREV_CLOSE_USD:g}")
        vol_window = hist[-DOLLAR_VOLUME_WINDOW_DAYS:]
        adv = (sum(b.close * b.volume for b in vol_window) / len(vol_window)
               if vol_window else 0.0)
        if adv < MIN_AVG_DOLLAR_VOLUME_USD:
            reasons.append(
                f"21-day avg dollar volume ${adv:,.0f} < ${MIN_AVG_DOLLAR_VOLUME_USD:,.0f}")

    above = None
    if prev_close is not None:
        sma_window = hist[-SMA_WINDOW_DAYS:]
        if len(sma_window) < SMA_WINDOW_DAYS:
            reasons.append(
                f"only {len(sma_window)} trading days of history — cannot compute 50-day SMA")
        else:
            sma50 = sum(b.close for b in sma_window) / SMA_WINDOW_DAYS
            above = prev_close > sma50
            if not above:
                reasons.append(
                    f"previous close ${prev_close:,.2f} <= 50-day SMA ${sma50:,.2f}")

    event.above_sma50 = above
    event.passed_gates = not reasons
    event.gate_fail_reason = "; ".join(reasons) if reasons else None
    return event


# ─────────────────────────────────────────────────────────────────────────────
# Sizing + calendar math — pure
# ─────────────────────────────────────────────────────────────────────────────

def size_entry(equity: float, price: float | None) -> int:
    """floor((equity / 8) / price) whole shares. 0 when unpriceable."""
    if not price or price <= 0 or equity <= 0:
        return 0
    return int(math.floor((equity * SLOT_FRACTION) / price))


def next_session_after(sessions: list[date], d: date) -> date | None:
    """First trading session strictly after calendar date d."""
    for s in sessions:
        if s > d:
            return s
    return None


def exit_due_session(sessions: list[date], entry: date,
                     held_days: int = HOLD_FULL_TRADING_DAYS) -> date | None:
    """The session whose OPEN is the exit: the `held_days`-th trading session
    strictly after the entry session. Counting the entry day as trading day 1,
    that is the open of the 21st trading day — the position is held through 20
    full trading sessions. Weekends/holidays are simply absent from
    `sessions`, so they never count."""
    later = [s for s in sessions if s > entry]
    if len(later) < held_days:
        return None
    return later[held_days - 1]


def load_trading_sessions(alpaca: AlpacaPaperClient,
                          start: date, end: date) -> list[date]:
    """NYSE trading sessions in [start, end] from the broker calendar — the
    same source of truth freshness.is_trading_session uses (LESSONS 4.16: a
    weekday cron is NOT a trading-day calendar)."""
    cal = alpaca._get(f"/v2/calendar?start={start.isoformat()}&end={end.isoformat()}")
    out: list[date] = []
    for e in cal or []:
        try:
            out.append(date.fromisoformat(e["date"]))
        except (KeyError, ValueError, TypeError):
            continue
    return sorted(set(out))


# ─────────────────────────────────────────────────────────────────────────────
# Kill switch — pure evaluation over the NAV history
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class KillDecision:
    should_trip: bool
    reason: str | None
    book_return: float | None
    spy_return: float | None
    max_drawdown: float | None
    trading_days: int


def evaluate_kill_switch(
    nav_rows: list[dict],
    min_trading_days: int = KILL_MIN_TRADING_DAYS,
    trail_pts: float = KILL_TRAIL_SPY_PTS,
    dd_limit: float = KILL_MAX_DRAWDOWN,
) -> KillDecision:
    """Evaluate both arms over paper_nav_daily rows since the new inception.

    `nav_rows` ascending by snapshot_date, each {snapshot_date, total_nav,
    spy_close}. Row 0 is the seeded inception anchor (day 0), so trading days
    since inception = len(rows) - 1 (one close row per completed session).

    Arm 1 (guarded): >= `min_trading_days` trading days since inception AND
      book return trails SPY return by >= `trail_pts` (percentage points).
    Arm 2 (unguarded): max drawdown from the book's peak >= `dd_limit`.
    """
    rows = [r for r in nav_rows if r.get("total_nav") is not None]
    if len(rows) < 1:
        return KillDecision(False, None, None, None, None, 0)
    days = len(rows) - 1
    first_nav = float(rows[0]["total_nav"])
    last_nav = float(rows[-1]["total_nav"])
    book_return = (last_nav / first_nav - 1.0) if first_nav > 0 else None

    spy_first = rows[0].get("spy_close")
    spy_last = rows[-1].get("spy_close")
    spy_return = None
    if spy_first and spy_last and float(spy_first) > 0:
        spy_return = float(spy_last) / float(spy_first) - 1.0

    peak = float("-inf")
    max_dd = 0.0
    for r in rows:
        nav = float(r["total_nav"])
        peak = max(peak, nav)
        if peak > 0:
            max_dd = max(max_dd, (peak - nav) / peak)

    reasons: list[str] = []
    if (days >= min_trading_days and book_return is not None
            and spy_return is not None
            and (spy_return - book_return) >= trail_pts):
        reasons.append(
            f"book {book_return:+.2%} trails SPY {spy_return:+.2%} by "
            f"{(spy_return - book_return):.2%} (>= {trail_pts:.0%}) over "
            f"{days} trading days (>= {min_trading_days})")
    if max_dd >= dd_limit:
        reasons.append(
            f"drawdown from peak {max_dd:.2%} >= {dd_limit:.0%}")

    return KillDecision(
        should_trip=bool(reasons),
        reason="; ".join(reasons) if reasons else None,
        book_return=book_return, spy_return=spy_return,
        max_drawdown=max_dd, trading_days=days,
    )


# ─────────────────────────────────────────────────────────────────────────────
# DB readers/writers (thin; monkeypatched in tests via _supabase_query/_exec)
# ─────────────────────────────────────────────────────────────────────────────

def load_insider_rows(filing_dates: list[str]) -> list[InsiderRow]:
    """UNION of the vendor table and the SEC EDGAR shadow for the given
    filing dates. Code-P filter is applied in SQL (both tables are indexed on
    it); the 10b5-1 exclusion and both dedup stages run in aggregate_events so
    the tested pure path is the production path."""
    if not filing_dates:
        return []
    in_list = ", ".join("'" + d.replace("'", "''") + "'" for d in filing_dates)
    sql = (
        "select ticker, filing_date::text as filing_date, "
        "       transaction_date::text as transaction_date, owner_name, "
        "       amount, stock_price, shares_owned_after, "
        "       coalesce(is_10b5_1, false) as is_10b5_1, transaction_code, "
        "       'vendor' as source "
        "from public.insider_history "
        f"where filing_date in ({in_list}) and transaction_code = 'P' "
        "union all "
        "select ticker, filing_date::text, transaction_date::text, owner_name, "
        "       amount, stock_price, shares_owned_after, "
        "       coalesce(is_10b5_1, false), transaction_code, 'edgar' "
        "from public.insider_history_edgar "
        f"where filing_date in ({in_list}) and transaction_code = 'P';"
    )
    rows = _supabase_query(sql)
    out: list[InsiderRow] = []
    for r in rows:
        out.append(InsiderRow(
            ticker=(r.get("ticker") or "").upper(),
            filing_date=r.get("filing_date") or "",
            transaction_date=r.get("transaction_date") or "",
            owner_name=r.get("owner_name") or "",
            shares=float(r["amount"]) if r.get("amount") is not None else None,
            price=float(r["stock_price"]) if r.get("stock_price") is not None else None,
            shares_owned_after=(float(r["shares_owned_after"])
                                if r.get("shares_owned_after") is not None else None),
            is_10b5_1=bool(r.get("is_10b5_1")),
            transaction_code=(r.get("transaction_code") or "").upper(),
            source=r.get("source") or "vendor",
        ))
    return out


def load_universe_rows(tickers: list[str]) -> dict[str, dict]:
    if not tickers:
        return {}
    in_list = ", ".join(_sql_escape(t.upper()) for t in tickers)
    rows = _supabase_query(
        "select ticker, type, active from public.universe_master "
        f"where ticker in ({in_list});")
    return {(r.get("ticker") or "").upper(): r for r in rows}


def load_price_histories(tickers: list[str], session_date: str,
                         n_rows: int = 60) -> dict[str, list[PriceBar]]:
    """Last `n_rows` daily bars per ticker with trade_date STRICTLY BEFORE the
    session being traded (no look-ahead — the SQL window ends at the previous
    close, and apply_gates re-asserts it). Chunked to keep responses small."""
    out: dict[str, list[PriceBar]] = {}
    uniq = sorted({t.upper() for t in tickers if t})
    for i in range(0, len(uniq), 25):
        chunk = uniq[i:i + 25]
        in_list = ", ".join(_sql_escape(t) for t in chunk)
        rows = _supabase_query(
            "select ticker, trade_date::text as trade_date, close, volume from ("
            "  select ticker, trade_date, close, volume, "
            "         row_number() over (partition by ticker order by trade_date desc) as rn "
            "  from public.prices_eod "
            f"  where ticker in ({in_list}) and trade_date < '{session_date}' "
            f") h where rn <= {int(n_rows)} order by ticker, trade_date;")
        for r in rows:
            try:
                out.setdefault((r["ticker"] or "").upper(), []).append(PriceBar(
                    trade_date=r["trade_date"],
                    close=float(r["close"]),
                    volume=float(r.get("volume") or 0.0),
                ))
            except (KeyError, TypeError, ValueError):
                continue
    return out


def load_open_events() -> list[dict]:
    """ce_events rows that are OPEN positions (entered, not exited)."""
    return _supabase_query(
        "select id, ticker, filing_date::text as filing_date, entered_at::text as entered_at, "
        "entry_qty, entry_price, exit_due_date::text as exit_due_date "
        "from public.ce_events "
        "where action = 'entered' and exited_at is null "
        "order by exit_due_date, ticker;")


def load_recorded_event_keys(filing_dates: list[str]) -> set[tuple[str, str]]:
    """(ticker, filing_date) pairs already recorded — idempotency across
    redundant morning fires."""
    if not filing_dates:
        return set()
    in_list = ", ".join("'" + d.replace("'", "''") + "'" for d in filing_dates)
    rows = _supabase_query(
        "select ticker, filing_date::text as filing_date from public.ce_events "
        f"where filing_date in ({in_list});")
    return {((r.get("ticker") or "").upper(), r.get("filing_date") or "") for r in rows}


def _ce_schema_present() -> bool:
    """True when migration 094's tables exist. Both phases probe this first:
    a DRY-RUN (the frozen pre-cutover state) skips quietly when the schema is
    absent, so an out-of-order merge cannot fail the scheduled jobs daily; a
    LIVE run without the schema is a misconfigured cutover and fails loud."""
    try:
        _supabase_query("select 1 from public.ce_kill_switch limit 1;")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("ce_kill_switch probe failed (%s) — migration 094 not applied?", exc)
        return False


def load_kill_switch() -> dict:
    """The single ce_kill_switch row. Raises when unreadable — the open phase
    must not guess whether entries are allowed (fail-safe: no read, no entry)."""
    rows = _supabase_query(
        "select tripped, tripped_at::text as tripped_at, reason, book_return, "
        "spy_return, max_drawdown, checked_at::text as checked_at "
        "from public.ce_kill_switch where id = 1;")
    if not rows:
        raise RuntimeError("ce_kill_switch has no state row — apply migration 094.")
    return rows[0]


def write_event_row(ev: ConvictionEvent, entered_at_sql: str = "NULL") -> None:
    """Insert one ce_events row; ON CONFLICT (ticker, filing_date) DO NOTHING
    so redundant fires never double-record an event."""
    _supabase_exec(
        "insert into public.ce_events "
        "(filing_date, ticker, total_usd, insider_names, n_insiders, "
        " is_edgar_sourced, passed_gates, gate_fail_reason, above_sma50, "
        " action, entered_at, entry_qty, entry_price, exit_due_date) values ("
        f"'{ev.filing_date}', {_sql_escape(ev.ticker)}, {_num_sql(ev.total_usd)}, "
        f"{_sql_escape(', '.join(ev.insider_names) if ev.insider_names else None)}, "
        f"{int(ev.n_insiders)}, {'true' if ev.is_edgar_sourced else 'false'}, "
        f"{'NULL' if ev.passed_gates is None else str(bool(ev.passed_gates)).lower()}, "
        f"{_sql_escape(ev.gate_fail_reason)}, "
        f"{'NULL' if ev.above_sma50 is None else str(bool(ev.above_sma50)).lower()}, "
        f"{_sql_escape(ev.action)}, {entered_at_sql}, "
        f"{'NULL' if ev.entry_qty is None else int(ev.entry_qty)}, NULL, "
        f"{_sql_escape(ev.exit_due_date)}"
        ") on conflict (ticker, filing_date) do nothing;")


def write_exit_marked(event_id: int, exited_at_iso: str,
                      exit_price: float | None, trade_return: float | None) -> None:
    _supabase_exec(
        "update public.ce_events set "
        f"exited_at = '{exited_at_iso}', exit_price = {_num_sql(exit_price)}, "
        f"trade_return = {_num_sql(trade_return)} "
        f"where id = {int(event_id)} and exited_at is null;")


def upsert_kill_switch(decision: KillDecision, dry_run: bool = False) -> bool:
    """Write the state row. Returns True when this call FRESHLY tripped the
    switch. Latching: once tripped, tripped/tripped_at/reason never revert
    here — only a human resets the row."""
    prior = load_kill_switch()
    already = bool(prior.get("tripped"))
    fresh_trip = decision.should_trip and not already
    if dry_run:
        logger.info("[dry-run] kill-switch: tripped(prior)=%s should_trip=%s reason=%s",
                    already, decision.should_trip, decision.reason)
        return False
    if fresh_trip:
        _supabase_exec(
            "update public.ce_kill_switch set "
            "tripped = true, tripped_at = now(), "
            f"reason = {_sql_escape(decision.reason)}, "
            f"book_return = {_num_sql(decision.book_return)}, "
            f"spy_return = {_num_sql(decision.spy_return)}, "
            f"max_drawdown = {_num_sql(decision.max_drawdown)}, "
            "checked_at = now() where id = 1;")
    else:
        _supabase_exec(
            "update public.ce_kill_switch set "
            f"book_return = {_num_sql(decision.book_return)}, "
            f"spy_return = {_num_sql(decision.spy_return)}, "
            f"max_drawdown = {_num_sql(decision.max_drawdown)}, "
            "checked_at = now() where id = 1;")
    return fresh_trip


# ─────────────────────────────────────────────────────────────────────────────
# Fill reconciliation — backfill entry/exit prices from the fills ledger
# ─────────────────────────────────────────────────────────────────────────────

def reconcile_fills(dry_run: bool = False) -> int:
    """Backfill ce_events entry_price / exited_at / exit_price / trade_return
    from public.paper_fills (the provenance ledger mirror.py maintains).
    One position per ticker at a time makes (ticker, side, filled_at >
    entered_at) unambiguous. Idempotent; returns rows updated."""
    updated = 0
    rows = _supabase_query(
        "select id, ticker, entered_at::text as entered_at, entry_price, "
        "exit_due_date::text as exit_due_date, exited_at::text as exited_at "
        "from public.ce_events "
        "where action = 'entered' and entered_at is not null "
        "and (entry_price is null or exited_at is null) "
        "order by entered_at;")
    for r in rows:
        tid = int(r["id"])
        ticker = (r["ticker"] or "").upper()
        entered_at = r.get("entered_at")
        if not entered_at:
            continue
        if r.get("entry_price") is None:
            f = _supabase_query(
                "select sum(gross_amount) as g, sum(quantity) as q "
                "from public.paper_fills "
                f"where upper(ticker) = {_sql_escape(ticker)} and lower(side) = 'buy' "
                f"and filled_at >= '{entered_at}';")
            g = float(f[0].get("g") or 0) if f else 0.0
            q = float(f[0].get("q") or 0) if f else 0.0
            if q > 0:
                px = g / q
                if not dry_run:
                    _supabase_exec(
                        f"update public.ce_events set entry_price = {px!r} "
                        f"where id = {tid} and entry_price is null;")
                updated += 1
                logger.info("reconciled ENTRY %s @ %.4f (event id=%d)", ticker, px, tid)
        if r.get("exited_at") is None:
            f = _supabase_query(
                "select sum(gross_amount) as g, sum(quantity) as q, "
                "max(filled_at)::text as t from public.paper_fills "
                f"where upper(ticker) = {_sql_escape(ticker)} and lower(side) = 'sell' "
                f"and filled_at >= '{entered_at}';")
            g = float(f[0].get("g") or 0) if f else 0.0
            q = float(f[0].get("q") or 0) if f else 0.0
            t = (f[0].get("t") if f else None)
            if q > 0 and t:
                exit_px = g / q
                entry_px = None
                e = _supabase_query(
                    f"select entry_price from public.ce_events where id = {tid};")
                if e and e[0].get("entry_price") is not None:
                    entry_px = float(e[0]["entry_price"])
                ret = (exit_px / entry_px - 1.0) if entry_px else None
                if not dry_run:
                    write_exit_marked(tid, t, exit_px, ret)
                updated += 1
                logger.info("reconciled EXIT %s @ %.4f ret=%s (event id=%d)",
                            ticker, exit_px,
                            f"{ret:+.2%}" if ret is not None else "n/a", tid)
    return updated


# ─────────────────────────────────────────────────────────────────────────────
# Order plumbing (reuses audit.write_order_intents + submitter)
# ─────────────────────────────────────────────────────────────────────────────

def _order_exists_today(ticker: str, side: str) -> bool:
    rows = _supabase_query(
        "select 1 from public.paper_orders "
        f"where upper(ticker) = {_sql_escape(ticker.upper())} and side = '{side}' "
        f"and signal_source = '{SIGNAL_SOURCE}' "
        "and (created_at at time zone 'America/New_York')::date = "
        "    (now() at time zone 'America/New_York')::date "
        "and status in ('pending', 'submitted', 'filled', 'partially_filled') "
        "limit 1;")
    return bool(rows)


def _write_and_submit(intents: list[OrderIntent], dry_run: bool) -> dict:
    """Write pending paper_orders rows then hand them to the shared submitter
    (client_order_id idempotency + open-order ticker guard + kill-switch entry
    refusal all live there)."""
    from paper_portfolio.audit import write_order_intents
    from paper_portfolio.submitter import submit_pending_orders
    if not intents:
        return {"written": 0, "submitted": 0, "rejected": 0, "duplicates": 0}
    if dry_run:
        for i in intents:
            logger.info("[dry-run] intent: %s %s x%s (%s)", i.side.upper(),
                        i.ticker, f"{i.target_quantity:g}" if i.target_quantity else "?",
                        i.rebalance_trigger_reason)
        return {"written": 0, "submitted": len(intents), "rejected": 0, "duplicates": 0,
                "dry_run": True}
    n = write_order_intents(intents)
    res = submit_pending_orders(dry_run=False)
    return {"written": n, "submitted": res.submitted, "rejected": res.rejected,
            "duplicates": res.duplicates, "errors": res.errors}


# ─────────────────────────────────────────────────────────────────────────────
# OPEN phase — exits due today FIRST, then events → gates → entries
# ─────────────────────────────────────────────────────────────────────────────

def run_open_phase(dry_run: bool = False,
                   session_date: date | None = None) -> dict[str, Any]:
    logger.info("=" * 60)
    logger.info("CONVICTION EVENTS — OPEN phase (exits first, then entries)")
    logger.info("=" * 60)
    alpaca = AlpacaPaperClient()
    session = session_date or _et_today()

    # ── trading-day gate (LESSONS 4.16) ────────────────────────────────────
    try:
        if not is_trading_session(alpaca, session):
            logger.info("TRADING-DAY GATE — %s is not a trading session; quiet no-op.", session)
            return {"skipped": "market-closed", "date": str(session)}
    except Exception as exc:  # noqa: BLE001 — calendar error blocks, fail-safe
        logger.warning("trading-day check errored (%s) — BLOCKING run", exc)
        if not dry_run:
            file_alert(
                title="Conviction Events open run blocked — trading-day check failed",
                description=("The pre-open Conviction Events run could not confirm "
                             "whether today is a trading session (broker calendar "
                             "unreachable) and was blocked as a precaution. No orders "
                             "were placed. Re-run CONVICTION-OPEN-DAILY once the "
                             "calendar recovers."),
                priority="P1")
        return {"blocked": True, "reason": "trading-day check errored"}

    # ── schema probe (migration 094) ───────────────────────────────────────
    if not _ce_schema_present():
        if dry_run:
            logger.warning("migration 094 not applied — dry run skips quietly "
                           "(the frozen pre-cutover state)")
            return {"skipped": "migration-094-not-applied"}
        msg = ("CONVICTION engine cannot run live — migration 094 "
               "(ce_events/ce_kill_switch) is not applied; cutover is misordered")
        print(f"::error::{msg}", flush=True)
        raise RuntimeError(msg)

    # ── backfill any prices the fills ledger has produced since last run ───
    try:
        reconcile_fills(dry_run=dry_run)
    except Exception:  # noqa: BLE001 — reconciliation lag must not block trading
        logger.exception("fill reconciliation failed — continuing")

    # broker truth: held book + account equity
    positions = {p.ticker.upper(): p for p in alpaca.get_positions()}
    equity = float(alpaca.get_account().equity)
    logger.info("account equity $%s, broker positions: %d",
                f"{equity:,.0f}", len(positions))

    open_events = load_open_events()
    session_iso = session.isoformat()

    # ── 1) EXITS DUE TODAY — placed FIRST ──────────────────────────────────
    exits_due = [e for e in open_events
                 if e.get("exit_due_date") and e["exit_due_date"] <= session_iso]
    exit_intents: list[OrderIntent] = []
    for e in exits_due:
        t = (e["ticker"] or "").upper()
        if not dry_run and _order_exists_today(t, "sell"):
            logger.info("exit %s already ordered today — idempotent skip", t)
            continue
        pos = positions.get(t)
        qty = float(pos.qty) if pos is not None else float(e.get("entry_qty") or 0)
        if pos is None:
            msg = (f"CONVICTION exit due for {t} but the broker holds no position "
                   "— entry never filled or the position vanished; marking the "
                   "event closed with no exit fill")
            print(f"::error::{msg}", flush=True)
            logger.error(msg)
            if not dry_run:
                write_exit_marked(int(e["id"]),
                                  datetime.now(tz=timezone.utc).isoformat(), None, None)
            continue
        exit_intents.append(OrderIntent(
            sleeve=SLEEVE, ticker=t, side="sell",
            target_quantity=qty, target_notional=0.0,
            signal_score=None, signal_source=SIGNAL_SOURCE,
            rebalance_trigger_reason=(
                f"Conviction exit — 21st trading day (entered off the "
                f"{e['filing_date']} filing; due {e['exit_due_date']})"),
        ))
    exit_result = _write_and_submit(exit_intents, dry_run)
    logger.info("exits due today: %d (orders queued: %d)",
                len(exits_due), len(exit_intents))

    # ── 2) BUILD EVENTS whose entry open is TODAY ──────────────────────────
    # A filing on day F enters at the NEXT market open after F. Today is that
    # open for every F with next_session_after(F) == today.
    cal_start = session - timedelta(days=FILING_LOOKBACK_CALENDAR_DAYS + 3)
    cal_end = session + timedelta(days=60)   # also serves exit-due math below
    sessions = load_trading_sessions(alpaca, cal_start, cal_end)
    candidate_filing_dates = [
        (session - timedelta(days=k)).isoformat()
        for k in range(1, FILING_LOOKBACK_CALENDAR_DAYS + 1)
        if next_session_after(sessions, session - timedelta(days=k)) == session
    ]
    logger.info("filing dates entering at today's open: %s",
                ", ".join(candidate_filing_dates) or "none")

    raw_rows = load_insider_rows(candidate_filing_dates)
    all_events = aggregate_events(raw_rows)
    already = load_recorded_event_keys(candidate_filing_dates)
    events = [e for e in all_events if (e.ticker, e.filing_date) not in already]
    logger.info("insider rows: %d -> qualifying events: %d (new: %d, already recorded: %d)",
                len(raw_rows), len(all_events), len(events),
                len(all_events) - len(events))

    # ── 3) GATES (windows end at the previous close — no look-ahead) ───────
    tickers = [e.ticker for e in events]
    universe = load_universe_rows(tickers) if tickers else {}
    histories = load_price_histories(tickers, session_iso) if tickers else {}
    for e in events:
        apply_gates(e, session_iso, universe.get(e.ticker), histories.get(e.ticker, []))

    # ── 4) KILL SWITCH + slots + one-per-ticker + ranking ──────────────────
    kill = load_kill_switch()
    tripped = bool(kill.get("tripped"))
    if tripped:
        print("::error::CONVICTION kill switch is TRIPPED "
              f"({kill.get('reason') or 'see ce_kill_switch'}) — refusing all "
              "new entries; exits still execute", flush=True)

    held_or_open = ({t for t in positions}
                    | {(e["ticker"] or "").upper() for e in open_events})
    due_exit_tickers = {(e["ticker"] or "").upper() for e in exits_due}
    # Exits due today free their slot CAPACITY for this morning's entries
    # (exits are placed first; both legs fill at the same opening auction) —
    # but the exiting TICKER itself stays blocked for the day: submitting an
    # opposing buy for a symbol we are selling at the same auction would
    # violate one-position-per-ticker mid-auction (and brokers reject
    # opposite-side working orders on one symbol).
    occupied = len({(e["ticker"] or "").upper() for e in open_events} - due_exit_tickers)
    free_slots = max(0, MAX_CONCURRENT_POSITIONS - occupied)
    logger.info("book: %d occupied after today's exits, %d free slot(s)%s",
                occupied, free_slots, " — KILL SWITCH TRIPPED" if tripped else "")

    # sizing at the previous close (prices_eod — the gold source; LESSONS 8.6)
    def _prev_close(t: str) -> float | None:
        hist = [b for b in histories.get(t, []) if b.trade_date < session_iso]
        return hist[-1].close if hist else None

    prev_closes = {e.ticker: _prev_close(e.ticker) for e in events}
    if exit_due_session(sessions, session) is None:
        # calendar window too short (long shutdown?) — extend rather than
        # enter positions with no tracked exit date
        sessions = load_trading_sessions(alpaca, cal_start, session + timedelta(days=120))
    entered = decide_actions(
        events=events, free_slots=free_slots, kill_switch_tripped=tripped,
        blocked_tickers=held_or_open, equity=equity,
        prev_closes=prev_closes, sessions=sessions, session=session)
    entry_intents: list[OrderIntent] = []
    for e in entered:
        entry_intents.append(OrderIntent(
            sleeve=SLEEVE, ticker=e.ticker, side="buy",
            target_quantity=float(e.entry_qty),
            target_notional=float(e.entry_qty * (prev_closes.get(e.ticker) or 0.0)),
            signal_score=None, signal_source=SIGNAL_SOURCE,
            rebalance_trigger_reason=(
                f"Conviction event — ${e.total_usd:,.0f} insider buys filed "
                f"{e.filing_date} ({e.n_insiders} insider(s)); exit due {e.exit_due_date}"),
        ))

    # record every scanned event (idempotent on the unique key)
    if not dry_run:
        for e in events:
            write_event_row(e, entered_at_sql="now()" if e.action == "entered" else "NULL")
    else:
        for e in events:
            logger.info("[dry-run] event %s %s $%s -> %s (%s)",
                        e.ticker, e.filing_date, f"{e.total_usd:,.0f}",
                        e.action, e.gate_fail_reason or "gates ok")

    entry_result = _write_and_submit(entry_intents, dry_run)

    # ── 5) expected-vs-actual capture (scripts/ce_capture.py, LESSONS 8.20) ─
    from scripts.ce_capture import write_conviction_capture
    write_conviction_capture(
        session_date=session_iso,
        expected_entries=len(entry_intents),
        expected_exits=len(exit_intents),
        payload={
            "session_date": session_iso,
            "filing_dates": candidate_filing_dates,
            "events_scanned": len(events),
            "entries": [e.ticker for e in entered],
            "exits": [i.ticker for i in exit_intents],
            "skipped_gate": [e.ticker for e in events if e.action == "skipped_gate"],
            "skipped_full": [e.ticker for e in events if e.action == "skipped_full"],
            "skipped_dup": [e.ticker for e in events if e.action == "skipped_dup"],
            "blocked_kill_switch": [e.ticker for e in events
                                    if e.action == "blocked_kill_switch"],
            "kill_switch_tripped": tripped,
            "free_slots": free_slots,
            "equity": equity,
        },
        dry_run=dry_run,
    )

    # ── morning summary email (one per ET day; same channel as the old book) ─
    if not dry_run:
        try:
            from paper_portfolio.emailer import send_alert_email_once
            lines = [
                f"Conviction Events — orders queued for today's open ({session_iso}).", "",
                f"Exits due (21st trading day): {len(exit_intents)}",
                *(f"  SELL {i.ticker} x{i.target_quantity:g}" for i in exit_intents),
                f"Entries: {len(entry_intents)}"
                + (" — BLOCKED: kill switch tripped" if tripped else ""),
                *(f"  BUY  {i.ticker} x{i.target_quantity:g}  ({i.rebalance_trigger_reason})"
                  for i in entry_intents),
            ]
            skipped = [e for e in events if e.action and e.action != "entered"]
            if skipped:
                lines += ["", "Events not entered:"]
                lines += [f"  {e.ticker} ({e.filing_date}) — {e.action}" for e in skipped]
            lines += ["", "Orders execute at the 9:30am ET opening auction."]
            n_orders = len(exit_intents) + len(entry_intents)
            subject = (f"[MacroTilt paper] Conviction Events — {n_orders} order(s) "
                       "queued for the open" if n_orders else
                       "[MacroTilt paper] Conviction Events — nothing to trade today")
            send_alert_email_once("morning_summary", subject, "\n".join(lines))
        except Exception as exc:  # noqa: BLE001
            logger.warning("morning summary email failed: %s", exc)

    return {
        "session": session_iso,
        "exits_due": len(exits_due), "exit_orders": len(exit_intents),
        "events": len(events), "entries": len(entry_intents),
        "kill_switch_tripped": tripped,
        "exit_result": exit_result, "entry_result": entry_result,
    }


# ─────────────────────────────────────────────────────────────────────────────
# KILL-CHECK phase (post-close)
# ─────────────────────────────────────────────────────────────────────────────

def run_kill_check(dry_run: bool = False) -> int:
    """Recompute the kill metrics from paper_nav_daily since the new
    inception, upsert ce_kill_switch, and FAIL the job (nonzero exit) on a
    fresh trip so WORKFLOW_FAILURE_ALERT emails. An already-tripped switch
    stays loud in the log (::error:: line) but exits 0 — the failure email
    fires once per trip, not daily (LESSONS 4.12)."""
    logger.info("=" * 60)
    logger.info("CONVICTION EVENTS — KILL-CHECK phase")
    logger.info("=" * 60)
    if not _ce_schema_present():
        if dry_run:
            logger.warning("migration 094 not applied — dry run skips quietly "
                           "(the frozen pre-cutover state)")
            return 0
        msg = ("CONVICTION kill-check cannot run live — migration 094 "
               "(ce_events/ce_kill_switch) is not applied; cutover is misordered")
        print(f"::error::{msg}", flush=True)
        raise RuntimeError(msg)
    try:
        reconcile_fills(dry_run=dry_run)
    except Exception:  # noqa: BLE001
        logger.exception("fill reconciliation failed — continuing to kill check")

    nav_rows = _supabase_query(
        "select snapshot_date::text as snapshot_date, total_nav, spy_close "
        "from public.paper_nav_daily order by snapshot_date;")
    decision = evaluate_kill_switch(nav_rows)
    logger.info(
        "kill metrics: %d trading day(s) since inception, book %s vs SPY %s, "
        "max drawdown %s",
        decision.trading_days,
        f"{decision.book_return:+.2%}" if decision.book_return is not None else "n/a",
        f"{decision.spy_return:+.2%}" if decision.spy_return is not None else "n/a",
        f"{decision.max_drawdown:.2%}" if decision.max_drawdown is not None else "n/a")

    fresh_trip = upsert_kill_switch(decision, dry_run=dry_run)
    if dry_run:
        logger.info("[dry-run] kill-check complete — state not written "
                    "(should_trip=%s%s)", decision.should_trip,
                    f": {decision.reason}" if decision.reason else "")
        return 0
    state = load_kill_switch()
    if fresh_trip:
        msg = (f"CONVICTION KILL SWITCH TRIPPED — {decision.reason}. New entries "
               "are refused until the switch is manually reset; exits still execute.")
        print(f"::error::{msg}", flush=True)
        logger.error(msg)
        file_alert(title="Conviction Events kill switch TRIPPED",
                   description=msg, priority="P1")
        return 1
    if bool(state.get("tripped")):
        print("::error::CONVICTION kill switch remains TRIPPED "
              f"({state.get('reason') or 'see ce_kill_switch'}) — entries refused",
              flush=True)
    else:
        logger.info("kill switch clear — entries allowed")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="MacroTilt Conviction Events engine.")
    p.add_argument("--phase", choices=["open", "kill-check"], default="open")
    p.add_argument("--session-date", help="override the ET session date (YYYY-MM-DD)")
    p.add_argument("--dry-run", action="store_true",
                   help="compute and log; no Supabase writes, no Alpaca submission")
    p.add_argument("--force-live", action="store_true",
                   help="OVERRIDE the PAPER_LIVE_TRADING_ENABLED env-var guard.")
    args = p.parse_args(argv)

    # Same belt-and-braces guard as paper_portfolio.runner: without the env
    # flag (or --force-live) a live invocation downgrades to dry-run. The flag
    # is FROZEN 'false' until the Conviction Events cutover.
    effective_dry_run = args.dry_run
    if not effective_dry_run:
        if not (_live_trading_enabled() or args.force_live):
            logger.warning(
                "LIVE TRADING NOT ENABLED — PAPER_LIVE_TRADING_ENABLED is not "
                "'true' and --force-live was not passed. Downgrading to dry-run.")
            effective_dry_run = True
        else:
            logger.warning("LIVE TRADING ENABLED — orders will be submitted to Alpaca.")

    if args.phase == "kill-check":
        return run_kill_check(dry_run=effective_dry_run)

    sd = date.fromisoformat(args.session_date) if args.session_date else None
    run_open_phase(dry_run=effective_dry_run, session_date=sd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
