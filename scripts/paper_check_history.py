"""
scripts/paper_check_history.py — READ-ONLY audit of ALL historical 'rejected'
paper_orders against real Alpaca state. Reports, per row, whether the order
actually filled (under its own id OR a '-mkt' retry id) or genuinely failed.
Writes nothing. Use to decide which old rows (e.g. May 27 "36 rejected") are
mislabeled before any correction.
"""
from __future__ import annotations
import logging, sys
from collections import defaultdict
from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.submitter import _supabase_query

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("paper_check_history")

def main() -> int:
    rows = _supabase_query(
        "select id, ticker, side, status, created_at::date as d "
        "from public.paper_orders where status = 'rejected' order by created_at asc;"
    )
    log.info("total rejected rows (all time): %d", len(rows))
    by_day = defaultdict(lambda: {"rejected":0,"actually_filled":0,"truly_failed":0})
    c = AlpacaPaperClient()
    filled_ids = []
    for r in rows:
        rid = str(r["id"]); day = str(r["d"])
        by_day[day]["rejected"] += 1
        found = None
        for coid in (rid, f"{rid}-mkt"):
            try:
                o = c.get_order_by_client_id(coid)
            except Exception:
                o = None
            if o and (float(o.get("filled_qty",0) or 0) > 0 or o.get("status")=="filled"):
                found = o; break
        if found:
            by_day[day]["actually_filled"] += 1
            filled_ids.append((rid, r["ticker"], day))
        else:
            by_day[day]["truly_failed"] += 1
    log.info("=== per-day breakdown of 'rejected' rows ===")
    for day in sorted(by_day):
        d = by_day[day]
        log.info("  %s: rejected=%d | actually FILLED=%d | truly failed=%d",
                 day, d["rejected"], d["actually_filled"], d["truly_failed"])
    log.info("=== rows that are mislabeled (filled but marked rejected) ===")
    for rid, tk, day in filled_ids:
        log.info("  %s %s %s", day, tk, rid)
    return 0

if __name__ == "__main__":
    sys.exit(main())
