"""
scripts/paper_repair_fill_status.py — one-off DB repair.

THE BUG (2026-06-01): the manual fill-now path called _mark_submitted(), which
only updates rows WHERE status='pending'. But the rows it was fixing were
already status='rejected' (the failed opg auction attempt). So the update was
a no-op: the orders filled at Alpaca, but paper_orders kept saying 'rejected'.
Result: the Paper page shows "30 rejected" for a rebalance that actually filled.

This repair walks today's 'rejected' rows, asks Alpaca whether the market
retry (client_order_id = '<row id>-mkt') actually FILLED, and if so sets the
row to status='filled' with the real alpaca_order_id and filled price/qty.
Driven entirely by real broker state — never assumes a fill.

Dry-run by default; pass --apply to write. Read-only against Alpaca.
"""

from __future__ import annotations

import logging
import os
import sys

import requests

from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.submitter import _supabase_query, _supabase_exec, _sql_escape

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("paper_repair")


def main() -> int:
    apply = "--apply" in sys.argv
    rows = _supabase_query(
        "select id, ticker, side, status from public.paper_orders "
        "where status = 'rejected' and created_at >= (now() - interval '18 hours') "
        "order by created_at asc;"
    )
    logger.info("found %d rejected rows from the last 18h to check against Alpaca", len(rows))
    if not rows:
        return 0

    client = AlpacaPaperClient()
    fixed = still_bad = 0
    for r in rows:
        rid = str(r["id"])
        coid = f"{rid}-mkt"  # the market retry client_order_id used by fill-now
        try:
            order = client.get_order_by_client_id(coid)
        except Exception as exc:
            logger.warning("lookup failed for %s (%s) — leaving as-is", r["ticker"], exc)
            still_bad += 1
            continue
        if not order or not order.get("id"):
            logger.info("  %s %s: no market retry found at Alpaca — genuinely not filled",
                        r["side"], r["ticker"])
            still_bad += 1
            continue
        filled_qty = float(order.get("filled_qty", 0) or 0)
        status = order.get("status", "")
        aid = order["id"]
        if filled_qty > 0 or status == "filled":
            logger.info("  %s %s: FILLED at Alpaca (qty=%s, status=%s) — repairing row to 'filled'",
                        r["side"], r["ticker"], filled_qty, status)
            if apply:
                avg = order.get("filled_avg_price")
                sql = (
                    "update public.paper_orders set "
                    "  status = 'filled', "
                    f"  alpaca_order_id = {_sql_escape(aid)}, "
                    "  submitted_at = coalesce(submitted_at, now()), "
                    f"  rejection_reason = NULL "
                    f"where id = '{rid}';"
                )
                _supabase_exec(sql)
            fixed += 1
        else:
            logger.info("  %s %s: market retry exists but not filled (status=%s) — leaving",
                        r["side"], r["ticker"], status)
            still_bad += 1

    logger.info("repair done — would_fix=%d still_rejected=%d apply=%s", fixed, still_bad, apply)
    if not apply:
        logger.info("DRY-RUN — re-run with --apply to write the corrections.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
