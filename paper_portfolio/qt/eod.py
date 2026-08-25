"""
paper_portfolio.qt.eod — close-of-day snapshot + fill sync. Read-only at the broker.

    python -m paper_portfolio.qt.eod

Two jobs, both idempotent:
  1. Snapshot the account (equity, cash, positions) into qt_nav_daily —
     one row per trading day, upserted, so the site can draw the live line.
  2. Sync fills: any qt_orders row still short of a terminal status gets its
     current Alpaca state pulled by client_order_id and written back.

After the snapshot it runs paper_portfolio.qt.reconcile, which fails this job
if any holding changed without a trade behind it.

This job NEVER submits, cancels or modifies an order. It reads the account
and writes two tables. Keeping it write-free at the broker is what lets it
run on a schedule without being a trading system.
"""
from __future__ import annotations

import sys
from datetime import date

import requests

from . import data as D

TERMINAL = {"filled", "canceled", "expired", "rejected", "dry_run"}


def snapshot() -> dict:
    H = D._alpaca_headers()
    acct = requests.get(f"{D.ALPACA_TRADE}/v2/account", headers=H, timeout=60).json()
    pos = requests.get(f"{D.ALPACA_TRADE}/v2/positions", headers=H, timeout=60).json()

    spy = None
    try:
        r = requests.get(f"{D.ALPACA_DATA}/v2/stocks/trades/latest", headers=H,
                         params={"symbols": "SPY", "feed": "delayed_sip"}, timeout=30)
        if r.status_code == 200:
            spy = float(r.json()["trades"]["SPY"]["p"])
    except Exception:
        pass

    row = {
        "d": date.today().isoformat(),
        "equity": float(acct["equity"]),
        "cash": float(acct["cash"]),
        "long_mv": float(acct.get("long_market_value") or 0),
        "n_positions": len(pos),
        "spy_close": spy,
        "positions": [
            {
                "symbol": p["symbol"],
                "qty": float(p["qty"]),
                "avg_entry": float(p["avg_entry_price"]),
                "price": float(p.get("current_price") or 0),
                "mv": float(p["market_value"]),
                "upl": float(p["unrealized_pl"]),
                "uplpc": float(p.get("unrealized_plpc") or 0),
            }
            for p in pos
        ],
    }
    h = dict(D._sb_headers()) | {"Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(f"{D.SB_URL}/rest/v1/qt_nav_daily?on_conflict=d",
                      headers=h, json=[row], timeout=60)
    r.raise_for_status()
    print(f"snapshot {row['d']}: equity ${row['equity']:,.0f}, "
          f"{row['n_positions']} positions", flush=True)
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
        row = snapshot()
    except Exception as e:
        print(f"EOD FAILED: {e}", file=sys.stderr)
        raise

    # Custody check (2026-08-25). Runs AFTER the snapshot is safely written, so
    # a failure here never costs us the day's row. It is deliberately allowed to
    # fail the job: WORKFLOW_FAILURE_ALERT lists QT-EOD-DAILY as VISIBLE, so a
    # failing run is what actually puts the alert in Joe's inbox. Nothing else
    # in the system compares one night's holdings to the next.
    from .reconcile import run as reconcile_run

    reconcile_run(row)
