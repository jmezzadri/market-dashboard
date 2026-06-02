"""
scripts/paper_cancel_open.py — cancel today's still-open paper orders.

One-off (2026-06-02): the morning run queued dollar-drift rebalances under the
OLD logic. Joe is moving to signal-only rebalancing and wants today's pending
orders cancelled BEFORE the 9:30 open so they don't fill. This cancels every
Alpaca order still 'open'/'new'/'accepted' and marks the matching paper_orders
rows 'cancelled'. Read-then-cancel; safe to re-run.
"""
from __future__ import annotations
import logging, sys
from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.submitter import _supabase_exec, _sql_escape

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("paper_cancel_open")

OPEN_STATES = {"new", "accepted", "pending_new", "accepted_for_bidding", "held", "open"}

def main() -> int:
    apply = "--apply" in sys.argv
    c = AlpacaPaperClient()
    orders = c.list_orders(status="open", limit=200)
    log.info("Alpaca reports %d open orders", len(orders))
    cancelled = 0
    for o in orders:
        oid = o.get("id"); sym = o.get("symbol"); st = o.get("status")
        coid = o.get("client_order_id", "")
        log.info("  open: %s %s status=%s id=%s", o.get("side"), sym, st, oid)
        if not apply:
            continue
        try:
            c.cancel_order(oid)
            cancelled += 1
            # mark the paper_orders row (client_order_id may carry the row id, sometimes with -mkt)
            base = coid.replace("-mkt", "")
            if base:
                _supabase_exec(
                    "update public.paper_orders set status = 'cancelled' "
                    f"where id = '{base}' and status in ('submitted','pending');"
                )
            log.info("    cancelled %s (%s)", sym, oid)
        except Exception as exc:
            log.warning("    cancel failed for %s (%s): %s", sym, oid, exc)
    log.info("cancel-open done — cancelled=%d apply=%s", cancelled, apply)
    if not apply:
        log.info("DRY-RUN — re-run with --apply to cancel.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
