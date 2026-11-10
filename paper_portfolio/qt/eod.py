"""
paper_portfolio.qt.eod — close-of-day snapshot + fill sync. Read-only at the broker.

    python -m paper_portfolio.qt.eod

Two jobs, both idempotent:
  1. Snapshot the account (equity, cash, positions) into qt_nav_daily —
     one row per trading day, upserted, so the site can draw the live line.
  2. Sync fills: any qt_orders row still short of a terminal status gets its
     current Alpaca state pulled by client_order_id and written back.

The custody check (paper_portfolio.qt.reconcile) runs as its OWN workflow step
after this one, deliberately AFTER the freshness stamp: a holding that vanished
is not the same thing as data being stale, and it must not paint the site's
freshness chip red.

This job NEVER submits, cancels or modifies an order. It reads the account
and writes two tables. Keeping it write-free at the broker is what lets it
run on a schedule without being a trading system.
"""
from __future__ import annotations

import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from . import data as D

TERMINAL = {"filled", "canceled", "expired", "rejected", "dry_run"}

ET = ZoneInfo("America/New_York")


def _today_et() -> str:
    """The trading date this snapshot belongs to — the ET calendar date.

    The cron fires 21:10 UTC, where UTC and ET agree on the date, but a manual
    dispatch can happen any time; after 00:00 UTC, date.today() on the runner
    is ET's *tomorrow* and would file the mark under a day that hasn't traded.
    """
    return datetime.now(ET).date().isoformat()


def is_trading_day(day: str) -> bool:
    """True iff `day` (YYYY-MM-DD) is an exchange session per Alpaca's calendar.

    2026-09-08 (LESSONS 5.26): the 21:10 UTC weekday cron fired on Labor Day
    and snapshot() wrote a qt_nav_daily row for a session that never happened —
    /paper then rendered a "Mon, Sep 7 session" P&L against an S&P "close" that
    was never printed. A `1-5` cron field is a weekday filter, not a market
    calendar (LESSONS 5.6); a job whose output is "one row per trading day"
    asks the exchange calendar first. Calendar unreachable → raise: better a
    red run than a fabricated session (same fail-safe direction as 5.6).
    """
    r = requests.get(f"{D.ALPACA_TRADE}/v2/calendar",
                     headers=D._alpaca_headers(),
                     params={"start": day, "end": day}, timeout=30)
    r.raise_for_status()
    return any(c.get("date") == day for c in r.json())


# Observed 2026-11: the broker's intraday P&L still ran from the prior close
# at 21:52 ET and from the same day's close by 22:27 ET. 21:30 keeps a margin.
SESSION_PL_CUTOFF_ET = "21:30"


def _existing_after_close(day: str) -> str | None:
    """HH:MM ET of an after-close (>= 16:00 ET, same day) snapshot already on
    file for `day`, else None. Intraday sync rows (before 16:00) do not count —
    the close snapshot is meant to overwrite those."""
    r = requests.get(f"{D.SB_URL}/rest/v1/qt_nav_daily", headers=D._sb_headers(),
                     params={"select": "created_at", "d": f"eq.{day}"}, timeout=30)
    r.raise_for_status()
    rows = r.json()
    if not rows or not rows[0].get("created_at"):
        return None
    ts = datetime.fromisoformat(str(rows[0]["created_at"]).replace("Z", "+00:00")).astimezone(ET)
    if ts.date().isoformat() == day and ts.strftime("%H:%M") >= "16:00":
        return ts.strftime("%H:%M")
    return None


def snapshot() -> dict | None:
    day = _today_et()
    if not is_trading_day(day):
        print(f"snapshot {day}: not a trading session (holiday/weekend) — "
              f"no row written; qt_nav_daily is one row per TRADING day", flush=True)
        return None
    # 2026-11-10 (health sweep): ONE after-close snapshot per session — the
    # first. This job runs twice a weekday: the pg_cron dispatch at 21:40 UTC
    # (4:40 PM ET in winter) and GitHub's own 21:10 UTC schedule, which GitHub
    # routinely starts hours late (00:51Z, 01:29Z, 03:27Z on Nov 6/7/10). The
    # late run overwrote the close-adjacent row with marks read deep into the
    # evening — and after ~10 PM ET the broker has rolled its "previous close"
    # to today's close, so every position's session P&L became the
    # close-to-evening drift. /paper then printed "MON, NOV 9 SESSION" movers
    # with LSCC at -2.1bp on a day it rose 8.5% (+51bp). An after-close row
    # that already exists is the session's snapshot; a later run leaves it.
    existing = _existing_after_close(day)
    if existing:
        print(f"snapshot {day}: after-close snapshot already taken at {existing} ET — "
              f"leaving it (a later read carries evening drift, not the session)", flush=True)
        return None
    H = D._alpaca_headers()
    acct = requests.get(f"{D.ALPACA_TRADE}/v2/account", headers=H, timeout=60).json()
    pos = requests.get(f"{D.ALPACA_TRADE}/v2/positions", headers=H, timeout=60).json()

    # Benchmark marks — S&P 500 (SPY), Nasdaq 100 (QQQ), Dow (DIA) — in one
    # call so the three index rows on /paper share a clock (2026-10-07). A mark
    # that fails to load is left out of the upsert, never written as null:
    # merge-duplicates would wipe the value the intraday sync already stored.
    bench: dict[str, float] = {}
    try:
        r = requests.get(f"{D.ALPACA_DATA}/v2/stocks/trades/latest", headers=H,
                         params={"symbols": "SPY,QQQ,DIA", "feed": "delayed_sip"}, timeout=30)
        if r.status_code == 200:
            trades = r.json().get("trades") or {}
            for sym, col in (("SPY", "spy_close"), ("QQQ", "qqq_close"), ("DIA", "dia_close")):
                px = float((trades.get(sym) or {}).get("p") or 0)
                if px > 0:
                    bench[col] = px
    except Exception:
        pass

    session_pl_ok = datetime.now(ET).strftime("%H:%M") < SESSION_PL_CUTOFF_ET
    if not session_pl_ok:
        print(f"snapshot {day}: taken after {SESSION_PL_CUTOFF_ET} ET — session P&L per "
              f"position left unknown (broker has rolled its prior close)", flush=True)
    row = {
        "d": day,
        # "Marked at" — the moment these numbers were read. The 10-minute live
        # sync stamps its own pulls; the close snapshot overwrites their values,
        # so it must overwrite the stamp too. Without it the page read the
        # closing marks as "live prices · 3:50 PM ET" all evening (2026-10-29),
        # and the custody check's fill cutoff sat 80 minutes before the
        # holdings it was comparing.
        "created_at": datetime.now(ET).astimezone(ZoneInfo("UTC")).isoformat(),
        # Which broker account this snapshot came from. The book is one
        # continuous series only within a single account_number — the site
        # charts a single epoch and reconcile never compares across a change.
        "account_number": acct.get("account_number"),
        "equity": float(acct["equity"]),
        "cash": float(acct["cash"]),
        "long_mv": float(acct.get("long_market_value") or 0),
        "n_positions": len(pos),
        **bench,
        "positions": [
            {
                "symbol": p["symbol"],
                "qty": float(p["qty"]),
                "avg_entry": float(p["avg_entry_price"]),
                "price": float(p.get("current_price") or 0),
                "mv": float(p["market_value"]),
                "upl": float(p["unrealized_pl"]),
                "uplpc": float(p.get("unrealized_plpc") or 0),
                # Session P&L too — the 10-minute live sync writes it and this
                # snapshot upserts over the same row; without it the page's
                # session movers vanished at the close (2026-10-21).
                # Past SESSION_PL_CUTOFF_ET the broker's intraday figures run
                # from TODAY's close, not the prior one — write unknown rather
                # than a wrong session number (the page then shows since-entry
                # movers only, with its own note). Only reached when the
                # close-adjacent run never happened.
                "upl_day": (float(p["unrealized_intraday_pl"])
                            if p.get("unrealized_intraday_pl") is not None and session_pl_ok else None),
                "upl_day_pc": (float(p["unrealized_intraday_plpc"])
                               if p.get("unrealized_intraday_plpc") is not None and session_pl_ok else None),
            }
            for p in pos
        ],
    }
    h = dict(D._sb_headers()) | {"Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(f"{D.SB_URL}/rest/v1/qt_nav_daily?on_conflict=d",
                      headers=h, json=[row], timeout=60)
    r.raise_for_status()
    print(f"snapshot {row['d']}: equity ${row['equity']:,.0f}, "
          f"{row['n_positions']} positions, account {row['account_number']}", flush=True)
    return row


def sync_fills() -> int:
    """Pull current state for every non-terminal logged order."""
    open_rows = requests.get(
        f"{D.SB_URL}/rest/v1/qt_orders",
        headers=D._sb_headers(),
        params={"select": "id,client_order_id,status",
                "status": f"not.in.({','.join(sorted(TERMINAL))})"},
        timeout=60,
    ).json()
    if not open_rows:
        print("fills: nothing to sync", flush=True)
        return 0

    H = D._alpaca_headers()
    n = 0
    for row in open_rows:
        coid = row.get("client_order_id")
        if not coid:
            continue
        r = requests.get(f"{D.ALPACA_TRADE}/v2/orders:by_client_order_id",
                         headers=H, params={"client_order_id": coid}, timeout=30)
        if r.status_code != 200:
            continue
        o = r.json()
        patch = {
            "alpaca_order_id": o["id"],
            "status": o["status"],
            "filled_qty": float(o.get("filled_qty") or 0),
            "filled_avg_price": float(o["filled_avg_price"]) if o.get("filled_avg_price") else None,
        }
        h = dict(D._sb_headers()) | {"Prefer": "return=minimal"}
        requests.patch(f"{D.SB_URL}/rest/v1/qt_orders",
                       headers=h, params={"id": f"eq.{row['id']}"},
                       json=patch, timeout=30)
        n += 1
    print(f"fills: synced {n}/{len(open_rows)} open orders", flush=True)
    return n


if __name__ == "__main__":
    try:
        sync_fills()
        snapshot()
    except Exception as e:
        print(f"EOD FAILED: {e}", file=sys.stderr)
        raise
