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
             queued pre-open). Sizing is FIXED FRACTION: every new position
             is 10% of CURRENT account equity —
             floor((equity * 0.10) / previous close) WHOLE shares. There is
             no fixed name cap; entries stop when the available cash (broker
             cash plus the proceeds of the exits filling at the same opening
             auction) cannot fund the next full 10% position, so the book
             self-limits at ~10 names. One position per ticker; same-morning
             events are ranked by total dollar size (largest first) and any
             event the cash cannot fund is recorded 'skipped_full'. A HARD
             SAFETY CEILING of 13 concurrent positions (the maximum
             concurrency observed in the 239-event study) stops a data
             anomaly from opening an unbounded book — events beyond it are
             recorded 'skipped_full' too.
             (2026-08-11, Joe: replaced the fixed 8-slot / equity-over-8
             rule. Sizing is decided ONCE, at entry — positions opened under
             the old rule keep the share counts they were entered with.)

  EXIT       market sell at the open of the 21st trading day after entry,
             counting the entry day as day 1 — i.e. the 20th trading session
             strictly after the entry session (held 20 full trading days).
             NYSE trading-day calendar via the broker calendar (the same
             source freshness.is_trading_session uses). NO profit targets,
             and exactly ONE risk exit — the catastrophe stop below.

  STOP       per position, evaluated in the post-close phase against THAT
             DAY'S official close: when the close is 15% or more below the
             entry price, the exit is pulled forward to the NEXT open — the
             same market-on-open path scheduled exits take (the event's
             exit_due_date moves to the next trading session; the reason is
             written to gate_fail_reason only when that column is null, so
             no new column is needed). A position already due to exit at or
             before that open is left alone — never a double exit.
             NO tighter stop: across 239 historical events, stops at
             5/8/10/12% cut the per-event mean monotonically (+6.8% ->
             +2.9%) because ~50-55% of stopped names traded back above the
             stop price inside the original 20-day window; forgone upside on
             those (+18% to +32%) far exceeded the loss avoided on the
             genuinely bad ones (+8% to +14%). Insiders buy INTO weakness,
             so a post-entry dip is the thesis, not its refutation. The wide
             15% level binds 22 of 239 events, is ~return-neutral, and
             improved portfolio drawdown/Sharpe at the margin (best Sharpe
             cell in the study).

  KILL       pre-registered, in-engine — a MONITOR ONLY; it never stops
  SWITCH     trading. After each close the kill-check phase computes the
             book's return since the new inception vs SPY since inception,
             and the max drawdown from the book's peak, from
             public.paper_nav_daily. If (>= 40 trading days since inception
             AND the book trails SPY by >= 10 percentage points) OR
             (drawdown >= 15%): the trip is recorded in
             public.ce_kill_switch and a fresh trip emits a ::error::
             annotation and fails the job so WORKFLOW_FAILURE_ALERT emails
             Joe. ENTRIES ARE NEVER REFUSED — trading continues unaffected
             (2026-08-11, Joe: "no point freezing new buys just because
             existing names are losing"; loss control is per-position, via
             the catastrophe stop above). Tripped state LATCHES until a
             human resets the row.

BOOKKEEPING — the book lives in the existing paper_* tables in the SLEEVE B
slot (sleeve 'B', signal_source 'conviction_events'); sleeve_m allocation is
0 and no sleeve-M trades are ever created. mirror.py / intraday.py accounting
is reused untouched (the 87906a84 fixes carry over).

Phases (CLI):
  --phase open        pre-open (CONVICTION-OPEN-DAILY, ~12:45Z): reconcile
                      fills into ce_events, place exits due today FIRST
                      (scheduled 21st-day exits AND catastrophe stops pulled
                      forward last night), then build events, apply gates,
                      place entries; record the expected entry/exit counts in
                      paper_signal_capture (scripts/ce_capture.py,
                      LESSONS 8.20).
  --phase kill-check  post-close (CONVICTION-KILL-CHECK, 21:15Z): reconcile
                      fills, screen every held position against the -15%
                      catastrophe stop at today's official close, then
                      evaluate + record the kill-switch MONITOR.

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
from paper_portfolio.mirror import _et_today, _sql_escape, official_closes

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
POSITION_FRACTION = 0.10             # every new position = 10% of CURRENT equity
MAX_CONCURRENT_POSITIONS = 13        # HARD SAFETY CEILING (historical max concurrency),
                                     # not a target: the book self-limits on cash at ~10
HOLD_FULL_TRADING_DAYS = 20          # exit at open of 21st trading day (entry day = day 1)
CATASTROPHE_STOP_DROP = 0.15         # close <= 15% below entry -> sell at the NEXT open
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


def _append_reason(event: ConvictionEvent, text: str) -> None:
    """Semicolon-append to gate_fail_reason (the ledger's only free-text
    column — the ce_events column list is locked, so every 'why not' rides
    here)."""
    event.gate_fail_reason = (
        (event.gate_fail_reason + "; ") if event.gate_fail_reason else "") + text


def decide_actions(
    events: list[ConvictionEvent],
    cash_available: float,
    blocked_tickers: set[str],
    equity: float,
    prev_closes: dict[str, float | None],
    sessions: list["date"],
    session: "date",
    open_position_count: int = 0,
) -> list[ConvictionEvent]:
    """Assign the final action to every gated event and size the entries.
    PURE — this is the production decision path the open phase runs.

    Precedence per event: gate failure -> 'skipped_gate'; ticker already in
    the book (one position per ticker) -> 'skipped_dup'; then the survivors
    are ranked by total dollar size (largest first) and taken while the cash
    lasts.

    FIXED-FRACTION SIZING (2026-08-11): each entry is 10% of CURRENT account
    equity — floor((equity * 0.10) / prev close) WHOLE shares — and costs
    qty * prev close, which is deducted from `cash_available` as the book
    fills. There is no slot count: an event whose cost the remaining cash
    cannot cover records 'skipped_full' with "insufficient cash for a 10%
    position", which is what makes the book self-limit at ~10 names.
    MAX_CONCURRENT_POSITIONS is a hard safety ceiling on top of that (a data
    anomaly must not open an unbounded book), counted from
    `open_position_count` (positions already open that are NOT exiting at
    this morning's auction); events beyond it also record 'skipped_full'.
    An entry that sizes to 0 whole shares (price above the 10% target)
    cannot be taken and records 'skipped_gate' with the sizing reason
    appended. Entered events get entry_qty + exit_due_date (open of the 21st
    trading day, entry day = day 1). Returns the entered events in rank
    order."""
    survivors: list[ConvictionEvent] = []
    for e in events:
        if not e.passed_gates:
            e.action = "skipped_gate"
        elif e.ticker in blocked_tickers:
            e.action = "skipped_dup"          # one position per ticker
        else:
            survivors.append(e)

    cash = float(cash_available)
    held = int(open_position_count)
    entered: list[ConvictionEvent] = []
    for e in rank_same_morning(survivors):
        if held >= MAX_CONCURRENT_POSITIONS:
            e.action = "skipped_full"
            _append_reason(e, f"concurrent-position ceiling reached "
                              f"({MAX_CONCURRENT_POSITIONS} open)")
            continue
        prev_close = prev_closes.get(e.ticker)
        qty = size_entry(equity, prev_close)
        if qty < 1:
            e.action = "skipped_gate"
            _append_reason(e, f"cannot size: floor((equity x {POSITION_FRACTION:.0%})"
                              f"/prev close ${prev_close}) = 0 whole shares")
            continue
        cost = qty * float(prev_close)
        if cost > cash:
            e.action = "skipped_full"
            _append_reason(e, f"insufficient cash for a 10% position "
                              f"(needs ${cost:,.0f}, ${cash:,.0f} available)")
            continue
        e.action = "entered"
        e.entry_qty = qty
        due = exit_due_session(sessions, session)
        e.exit_due_date = due.isoformat() if due else None
        cash -= cost
        held += 1
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
    """FIXED FRACTION: floor((equity * 10%) / price) whole shares — 10% of
    CURRENT account equity per new position. 0 when unpriceable or when the
    price exceeds the 10% target (that event cannot be taken)."""
    if not price or price <= 0 or equity <= 0:
        return 0
    return int(math.floor((equity * POSITION_FRACTION) / price))


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
# Catastrophe stop — pure evaluation over the held book at today's close
#
# The ONLY risk exit. Aggressive stops are HARMFUL on this strategy (see the
# module docstring's STOP block: 5/8/10/12% stops cut the per-event mean
# monotonically because insiders buy INTO weakness). A WIDE 15% stop bound
# only 22 of 239 events, was ~return-neutral, and improved drawdown/Sharpe.
# ─────────────────────────────────────────────────────────────────────────────

STOP_REASON_PREFIX = "catastrophe stop"


@dataclass(frozen=True)
class StopHit:
    """One held position whose close breached the catastrophe stop."""
    event_id: int
    ticker: str
    entry_price: float
    close_price: float
    close_date: str
    drop: float                 # signed return vs entry (-0.163 = -16.3%)
    already_due: bool           # already exiting at/before the next open


def stop_triggered(entry_price: float | None, close_price: float | None,
                   drop: float = CATASTROPHE_STOP_DROP) -> bool:
    """True when `close_price` is `drop` or more BELOW `entry_price`.

    Boundary is inclusive: at a $100 entry, a $85.00 close (-15.0%) triggers
    and a $85.10 close (-14.9%) does not. The 1e-12 slack absorbs binary
    representation error on the ratio only — it is ~1e-10 of a percentage
    point, far below any price tick."""
    if not entry_price or float(entry_price) <= 0 or close_price is None:
        return False
    return (float(close_price) / float(entry_price) - 1.0) <= -abs(drop) + 1e-12


def stop_reason_text(entry_price: float, close_price: float, close_date: str,
                     drop: float = CATASTROPHE_STOP_DROP) -> str:
    """The ledger/log line for a stop. Written to gate_fail_reason ONLY when
    that column is null (the ce_events column list is locked)."""
    ret = float(close_price) / float(entry_price) - 1.0
    return (f"{STOP_REASON_PREFIX} — {close_date} close ${float(close_price):,.2f} is "
            f"{ret:+.1%} vs the ${float(entry_price):,.2f} entry (limit "
            f"-{abs(drop):.0%}); selling at the next open")


def evaluate_catastrophe_stops(
    open_events: list[dict],
    closes: dict[str, float],
    next_session: "date | None",
    close_date: str,
    drop: float = CATASTROPHE_STOP_DROP,
) -> tuple[list[StopHit], list[str]]:
    """PURE — the production stop decision. Returns (hits, unevaluated).

    `open_events` are load_open_events() rows (action='entered', not exited);
    `closes` maps TICKER -> that session's official close. A position whose
    entry_price or close is missing cannot be judged and is returned in
    `unevaluated` (the caller logs it — silence would be the fake-green
    failure mode).

    A hit whose exit_due_date is already at or before `next_session` is
    flagged already_due=True: it is exiting at that same open anyway, so the
    caller must NOT touch it (no double exit)."""
    hits: list[StopHit] = []
    unevaluated: list[str] = []
    nxt = next_session.isoformat() if next_session else None
    for row in open_events:
        ticker = (row.get("ticker") or "").upper()
        entry = row.get("entry_price")
        close = closes.get(ticker)
        if entry is None or close is None:
            unevaluated.append(ticker)
            continue
        if not stop_triggered(entry, close, drop):
            continue
        due = row.get("exit_due_date")
        hits.append(StopHit(
            event_id=int(row["id"]), ticker=ticker,
            entry_price=float(entry), close_price=float(close),
            close_date=close_date,
            drop=float(close) / float(entry) - 1.0,
            already_due=bool(nxt and due and str(due) <= nxt),
        ))
    return hits, unevaluated


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
    """ce_events rows that are OPEN positions (entered, not exited).
    gate_fail_reason rides along because a catastrophe stop records its
    reason there (locked column list — no new column); the open phase reads
    it to label the exit order."""
    return _supabase_query(
        "select id, ticker, filing_date::text as filing_date, entered_at::text as entered_at, "
        "entry_qty, entry_price, exit_due_date::text as exit_due_date, gate_fail_reason "
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
    """The single ce_kill_switch row. Raises when unreadable — the kill-check
    phase MUST read the prior state before it writes (the latch depends on
    it). The open phase reads through _kill_switch_monitor_state() instead:
    since 2026-08-11 the switch gates nothing, so an unreadable row must
    never block trading."""
    rows = _supabase_query(
        "select tripped, tripped_at::text as tripped_at, reason, book_return, "
        "spy_return, max_drawdown, checked_at::text as checked_at "
        "from public.ce_kill_switch where id = 1;")
    if not rows:
        raise RuntimeError("ce_kill_switch has no state row — apply migration 094.")
    return rows[0]


def _kill_switch_monitor_state() -> dict | None:
    """MONITOR read for the open phase. The kill switch no longer gates
    anything (2026-08-11), so an unreadable row logs and returns None rather
    than blocking the morning's trading. Never use this in the kill-check
    phase — the latch needs the real prior state."""
    try:
        return load_kill_switch()
    except Exception as exc:  # noqa: BLE001 — monitor read, must not block trading
        logger.warning("ce_kill_switch unreadable (%s) — monitor state unknown; "
                       "trading is unaffected either way", exc)
        return None


def write_stop_exit_scheduled(event_id: int, exit_due_date: str, reason: str) -> None:
    """Pull a position's exit forward to `exit_due_date` (the next trading
    session) because the catastrophe stop tripped, and record WHY.

    The ce_events column list is LOCKED, so the reason rides in the existing
    gate_fail_reason column — and only when that column is null, which
    `coalesce` does atomically (an event that carries a real gate note keeps
    it; the log line below is the belt-and-braces record either way)."""
    _supabase_exec(
        "update public.ce_events set "
        f"exit_due_date = '{exit_due_date}', "
        f"gate_fail_reason = coalesce(gate_fail_reason, {_sql_escape(reason)}) "
        f"where id = {int(event_id)} and exited_at is null;")


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
    (client_order_id idempotency + open-order ticker guard live there; the
    submitter no longer refuses anything on the kill switch — 2026-08-11)."""
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

    # broker truth: held book + account equity + settled cash. Equity sizes
    # each new position (10% of CURRENT equity); cash is what the book can
    # actually fund this morning, and it is what limits the name count now
    # that the fixed 8 slots are gone. Both read directly — an account object
    # missing either field is a broken client, not a reason to trade blind.
    positions = {p.ticker.upper(): p for p in alpaca.get_positions()}
    account = alpaca.get_account()
    equity = float(account.equity)
    cash = float(account.cash)
    logger.info("account equity $%s, cash $%s, broker positions: %d",
                f"{equity:,.0f}", f"{cash:,.0f}", len(positions))

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
        # A stop pulled forward last night carries its reason in
        # gate_fail_reason (locked column list); label the order honestly so
        # the ledger and the morning email say WHY this name is being sold.
        note = str(e.get("gate_fail_reason") or "")
        if note.startswith(STOP_REASON_PREFIX):
            trigger = f"Conviction exit — {note} (entered off the {e['filing_date']} filing)"
        else:
            trigger = (f"Conviction exit — 21st trading day (entered off the "
                       f"{e['filing_date']} filing; due {e['exit_due_date']})")
        exit_intents.append(OrderIntent(
            sleeve=SLEEVE, ticker=t, side="sell",
            target_quantity=qty, target_notional=0.0,
            signal_score=None, signal_source=SIGNAL_SOURCE,
            rebalance_trigger_reason=trigger,
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

    # ── 4) KILL-SWITCH MONITOR + fundable cash + one-per-ticker + ranking ──
    # The kill switch is a MONITOR ONLY (2026-08-11, Joe): it is read here for
    # the morning summary and never gates a single order. Loss control is
    # per-position, via the catastrophe stop in the post-close phase.
    kill = _kill_switch_monitor_state()
    tripped = bool(kill.get("tripped")) if kill is not None else None
    if tripped:
        logger.warning("KILL-SWITCH MONITOR is TRIPPED (%s) — recorded for review; "
                       "trading continues unaffected",
                       kill.get("reason") or "see ce_kill_switch")

    held_or_open = ({t for t in positions}
                    | {(e["ticker"] or "").upper() for e in open_events})
    due_exit_tickers = {(e["ticker"] or "").upper() for e in exits_due}
    # Exits due today free their CAPITAL for this morning's entries (exits are
    # placed first; both legs fill at the same opening auction) — but the
    # exiting TICKER itself stays blocked for the day: submitting an opposing
    # buy for a symbol we are selling at the same auction would violate
    # one-position-per-ticker mid-auction (and brokers reject opposite-side
    # working orders on one symbol).
    open_after_exits = len(
        {(e["ticker"] or "").upper() for e in open_events} - due_exit_tickers)

    # sizing at the previous close (prices_eod — the gold source; LESSONS 8.6)
    def _prev_close(t: str) -> float | None:
        hist = [b for b in histories.get(t, []) if b.trade_date < session_iso]
        return hist[-1].close if hist else None

    prev_closes = {e.ticker: _prev_close(e.ticker) for e in events}

    # Cash the book can actually deploy at this auction = settled cash plus
    # the proceeds of the exits queued above, valued at the previous close
    # (prices_eod, same source as entry sizing). A name whose close we cannot
    # read contributes $0 — that under-invests by one name at worst, where
    # over-counting would buy stock the account cannot pay for.
    exit_proceeds = 0.0
    if exit_intents:
        exit_closes = load_price_histories([i.ticker for i in exit_intents],
                                           session_iso, n_rows=1)
        for i in exit_intents:
            bars = exit_closes.get(i.ticker.upper()) or []
            if bars:
                exit_proceeds += float(i.target_quantity) * bars[-1].close
            else:
                logger.warning("no previous close for exiting %s — counting $0 of "
                               "proceeds toward this morning's cash", i.ticker)
    cash_available = cash + exit_proceeds
    logger.info("book: %d open after today's exits (ceiling %d); fundable cash "
                "$%s = $%s settled + $%s exit proceeds; 10%% position = $%s",
                open_after_exits, MAX_CONCURRENT_POSITIONS, f"{cash_available:,.0f}",
                f"{cash:,.0f}", f"{exit_proceeds:,.0f}",
                f"{equity * POSITION_FRACTION:,.0f}")

    if exit_due_session(sessions, session) is None:
        # calendar window too short (long shutdown?) — extend rather than
        # enter positions with no tracked exit date
        sessions = load_trading_sessions(alpaca, cal_start, session + timedelta(days=120))
    entered = decide_actions(
        events=events, cash_available=cash_available,
        blocked_tickers=held_or_open, equity=equity,
        prev_closes=prev_closes, sessions=sessions, session=session,
        open_position_count=open_after_exits)
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
            "kill_switch_tripped": tripped,   # MONITOR only — never blocks a trade
            "open_positions_after_exits": open_after_exits,
            "position_ceiling": MAX_CONCURRENT_POSITIONS,
            "cash_available": cash_available,
            "position_target_usd": equity * POSITION_FRACTION,
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
                f"Exits (held 20 full trading days, or stopped out): {len(exit_intents)}",
                *(f"  SELL {i.ticker} x{i.target_quantity:g}  ({i.rebalance_trigger_reason})"
                  for i in exit_intents),
                f"Entries: {len(entry_intents)}",
                *(f"  BUY  {i.ticker} x{i.target_quantity:g}  ({i.rebalance_trigger_reason})"
                  for i in entry_intents),
            ]
            skipped = [e for e in events if e.action and e.action != "entered"]
            if skipped:
                lines += ["", "Events not entered:"]
                lines += [f"  {e.ticker} ({e.filing_date}) — {e.action}"
                          + (f": {e.gate_fail_reason}" if e.gate_fail_reason else "")
                          for e in skipped]
            if tripped:
                lines += ["", "Kill-switch monitor: TRIPPED "
                          f"({kill.get('reason') or 'see the kill-switch row'}). "
                          "This is a monitor only — trading continues as normal."]
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
        "kill_switch_tripped": tripped,   # MONITOR only — never blocks a trade
        "cash_available": cash_available,
        "open_positions_after_exits": open_after_exits,
        "exit_result": exit_result, "entry_result": entry_result,
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST-CLOSE phase — catastrophe stops (an ACTION) + kill-switch MONITOR
# ─────────────────────────────────────────────────────────────────────────────

def run_catastrophe_stop_check(alpaca: AlpacaPaperClient | None = None,
                               session_date: date | None = None,
                               dry_run: bool = False) -> dict[str, Any]:
    """Screen every held position against the -15% catastrophe stop at TODAY'S
    official close and pull the breached ones forward to the NEXT open.

    Price source: mirror.official_closes — the market-data daily bar for the
    session, i.e. the SAME official close the close snapshot in this workflow
    just marked the book at (LESSONS 2026-06-12b: one concept, one shared
    computation). prices_eod is NOT usable here: its complete panel only
    lands in the next-morning batch (MASSIVE-DAILY), so at 21:15Z it still
    carries the PRIOR session and the stop would run a day late.

    Mechanism: the breached event's exit_due_date moves to the next trading
    session, so the open phase sells it market-on-open down the SAME path as
    a scheduled 21st-day exit. No new column, no second order path. A
    position already due at or before that open is left untouched (never a
    double exit)."""
    session = session_date or _et_today()
    session_iso = session.isoformat()

    # Read the book BEFORE touching the broker: an empty book needs no client,
    # no calendar call and no market-data call.
    open_events = load_open_events()
    if not open_events:
        logger.info("catastrophe stop: no open positions to screen")
        return {"screened": 0, "stopped": 0, "already_due": 0, "unevaluated": []}

    alpaca = alpaca or AlpacaPaperClient()

    # Trading-day gate (LESSONS 4.16): there is no close to screen against on
    # a weekday holiday, and warning about every held name would be a false
    # alarm on a healthy day (LESSONS 4.25).
    if not is_trading_session(alpaca, session):
        logger.info("catastrophe stop: %s is not a trading session — nothing to screen",
                    session_iso)
        return {"skipped": "market-closed", "screened": 0, "stopped": 0,
                "already_due": 0, "unevaluated": []}

    tickers = sorted({(e["ticker"] or "").upper() for e in open_events})
    closes = {t: c for t, (c, _prev) in
              official_closes(alpaca, tickers, session).items()}
    sessions = load_trading_sessions(alpaca, session, session + timedelta(days=30))
    nxt = next_session_after(sessions, session)
    if nxt is None:
        raise RuntimeError(
            f"catastrophe stop: no trading session after {session_iso} in the "
            "broker calendar — cannot schedule a stop exit")

    hits, unevaluated = evaluate_catastrophe_stops(
        open_events, closes, nxt, close_date=session_iso)

    if unevaluated:
        # Never silent: a held name with no close or no reconciled entry price
        # was NOT screened tonight, and saying so is the difference between a
        # monitor and fake green (LESSONS 0.1 / 4.5).
        print("::warning::CONVICTION catastrophe stop could not screen "
              f"{len(unevaluated)} held position(s) tonight (no official "
              f"{session_iso} close or no reconciled entry price): "
              f"{', '.join(unevaluated)}", flush=True)

    stopped = 0
    for h in hits:
        if h.already_due:
            logger.info("catastrophe stop: %s is %.1f%% below entry but already "
                        "exits at/before %s — leaving its exit as scheduled",
                        h.ticker, h.drop * 100, nxt.isoformat())
            continue
        reason = stop_reason_text(h.entry_price, h.close_price, h.close_date)
        msg = (f"CONVICTION CATASTROPHE STOP — {h.ticker}: {h.close_date} close "
               f"${h.close_price:,.2f} is {h.drop:+.1%} vs the ${h.entry_price:,.2f} "
               f"entry (limit -{CATASTROPHE_STOP_DROP:.0%}). Selling at the "
               f"{nxt.isoformat()} open (market-on-open, the same path as a "
               f"scheduled exit).")
        logger.warning(msg)
        print(f"::notice::{msg}", flush=True)
        if not dry_run:
            write_stop_exit_scheduled(h.event_id, nxt.isoformat(), reason)
        stopped += 1

    logger.info("catastrophe stop: screened %d position(s) at the %s close — "
                "%d stopped, %d already exiting, %d unevaluated",
                len(open_events), session_iso, stopped,
                sum(1 for h in hits if h.already_due), len(unevaluated))
    return {"screened": len(open_events), "stopped": stopped,
            "already_due": sum(1 for h in hits if h.already_due),
            "unevaluated": unevaluated, "next_open": nxt.isoformat()}


def run_kill_check(dry_run: bool = False) -> int:
    """Post-close phase: catastrophe stops FIRST (they place tomorrow's
    exits), then the kill-switch MONITOR.

    The kill switch recomputes its metrics from paper_nav_daily since the new
    inception, upserts ce_kill_switch, and FAILS the job (nonzero exit) on a
    fresh trip so WORKFLOW_FAILURE_ALERT emails Joe. It does NOT stop trading
    — entries and exits run untouched while tripped (2026-08-11, Joe). An
    already-tripped switch stays loud in the log (::error:: line) but exits 0
    — the failure email fires once per trip, not daily (LESSONS 4.12).

    A failing stop screen also fails the job (held positions went unscreened,
    which is exactly the silent-staleness failure mode), but it never stops
    the monitor from stamping its metrics for the evening."""
    logger.info("=" * 60)
    logger.info("CONVICTION EVENTS — POST-CLOSE phase (stops, then kill monitor)")
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
        logger.exception("fill reconciliation failed — continuing to the stop screen")

    # ── catastrophe stops (the only risk exit) ─────────────────────────────
    stop_failed = False
    try:
        run_catastrophe_stop_check(dry_run=dry_run)
    except Exception as exc:  # noqa: BLE001 — must not cost the evening's monitor
        stop_failed = True
        msg = (f"CONVICTION catastrophe-stop screen FAILED ({exc}) — held "
               "positions were NOT checked against the -15% stop tonight.")
        print(f"::error::{msg}", flush=True)
        logger.exception(msg)

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
        return 1 if stop_failed else 0
    state = load_kill_switch()
    if fresh_trip:
        msg = (f"CONVICTION KILL SWITCH TRIPPED — {decision.reason}. This is a "
               "MONITOR: trading continues unaffected (entries and exits both "
               "run). The state latches until a human resets the row.")
        print(f"::error::{msg}", flush=True)
        logger.error(msg)
        file_alert(title="Conviction Events kill switch TRIPPED",
                   description=msg, priority="P1")
        return 1
    if bool(state.get("tripped")):
        print("::error::CONVICTION kill switch remains TRIPPED "
              f"({state.get('reason') or 'see ce_kill_switch'}) — monitor only; "
              "trading continues", flush=True)
    else:
        logger.info("kill-switch monitor clear")
    return 1 if stop_failed else 0


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
