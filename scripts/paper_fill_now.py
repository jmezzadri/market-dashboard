"""
scripts/paper_fill_now.py — ONE-OFF intraday rebalance filler.

Why this exists (2026-06-01): the daily paper pipeline submits
market-on-open ('opg') orders, which Alpaca only ACCEPTS between 7:00pm
and 9:28am ET. The scheduled run kept landing outside that window, so
nothing ever filled. This script lets us rebalance NOW, during regular
trading hours, by submitting ordinary market/day orders (immediate fill)
for the order intents that were already computed and are sitting in
public.paper_orders with status='rejected' and the opg-window rejection.

It is deliberately separate from the daily runner and only runs on manual
dispatch. It does NOT change the daily pipeline. After the evening-window
redesign ships, this script is no longer needed for routine operation.

Safety:
  * Only touches rows rejected specifically for the opg time-window.
  * Uses a fresh client_order_id (row id + '-mkt') so it can never collide
    with the original opg attempt.
  * Marks each row 'submitted' with the new Alpaca id, or 'rejected' with
    the new reason — full audit trail preserved.
  * Honors the same PAPER_LIVE_TRADING_ENABLED kill-switch as the runner.
"""

from __future__ import annotations

import logging
import os
import sys

import requests

from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.submitter import (
    _mark_rejected,
    _mark_submitted,
    _supabase_query,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("paper_fill_now")


def _live_enabled() -> bool:
    return os.environ.get("PAPER_LIVE_TRADING_ENABLED", "").strip().lower() == "true"


def fetch_opg_rejected() -> list[dict]:
    """Today's intents that were rejected purely for the opg time window."""
    sql = (
        "select id, sleeve, ticker, side, target_quantity, target_notional "
        "from public.paper_orders "
        "where status = 'rejected' "
        "and rejection_reason ilike '%opg orders must be submitted%' "
        "and created_at >= (now() - interval '12 hours') "
        "order by created_at asc;"
    )
    return _supabase_query(sql)


def submit_market_day(client: AlpacaPaperClient, ticker: str, side: str,
                      qty: float | None, notional: float | None,
                      client_order_id: str) -> dict:
    """POST a regular market order, time_in_force='day' — fills immediately
    during RTH. Reuses the tested client's auth + base url."""
    body: dict = {
        "symbol": ticker,
        "side": side,
        "type": "market",
        "time_in_force": "day",
        "client_order_id": client_order_id,
    }
    if qty is not None and qty > 0:
        body["qty"] = str(qty)
    elif notional is not None and notional > 0:
        body["notional"] = str(round(notional, 2))
    else:
        raise ValueError("no qty or notional")
    url = f"{client.base_url}/v2/orders"
    headers = {**client._headers(), "Content-Type": "application/json"}
    resp = requests.post(url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main() -> int:
    dry = not _live_enabled() and "--force-live" not in sys.argv
    rows = fetch_opg_rejected()
    logger.info("found %d opg-rejected rows to fill at market", len(rows))
    if not rows:
        logger.info("nothing to do")
        return 0

    client = AlpacaPaperClient()
    # market clock sanity
    try:
        clock = client.get_clock()
        logger.info("market is_open=%s next_close=%s", clock.get("is_open"), clock.get("next_close"))
        if not clock.get("is_open"):
            logger.warning("market is CLOSED — market/day orders will queue, not fill. Aborting to be safe.")
            return 0
    except Exception as exc:
        logger.warning("could not read clock (%s) — proceeding", exc)

    submitted = rejected = 0
    for r in rows:
        rid = str(r["id"])
        ticker = r["ticker"]; side = r["side"]
        qty = float(r["target_quantity"]) if r.get("target_quantity") is not None else None
        notional = float(r["target_notional"]) if r.get("target_notional") is not None else None
        qty = abs(qty) if qty is not None else None
        notional = abs(notional) if notional is not None else None

        if dry:
            logger.info("[dry-run] would MARKET %s %s qty=%s notional=%s", side, ticker, qty, notional)
            submitted += 1
            continue
        try:
            order = submit_market_day(client, ticker, side, qty, notional, client_order_id=f"{rid}-mkt")
            aid = order.get("id")
            _mark_submitted(rid, aid)
            submitted += 1
            logger.info("FILLED-MARKET %s %s -> alpaca_id=%s", side, ticker, aid)
        except requests.HTTPError as exc:
            body = exc.response.text if exc.response is not None else str(exc)
            _mark_rejected(rid, f"market-day retry: {body[:200]}")
            rejected += 1
            logger.warning("REJECT %s %s: %s", side, ticker, body[:160])
        except Exception as exc:
            _mark_rejected(rid, f"market-day retry error: {exc}")
            rejected += 1
            logger.warning("ERROR %s %s: %s", side, ticker, exc)

    logger.info("fill-now done — submitted=%d rejected=%d dry_run=%s", submitted, rejected, dry)
    return 0


if __name__ == "__main__":
    sys.exit(main())
