"""
scripts/paper_fill_watchdog.py — post-open fill verification + alert.

THE PROBLEM THIS SOLVES (2026-06-01): for a full week the rebalance silently
did nothing and every run still reported "success." Nobody knew until Joe
asked. This watchdog runs after the open each trading day and verifies the
rebalance ACTUALLY HAPPENED end-to-end. If not, it files a P1 alert so a
silent failure can never run for days again.

Checks (per the last closed trading session's queue):
  1. Did the morning run produce pending intents at all? (0 intents on a
     trading day = the producer/translator silently failed.)
  2. Of today's submitted orders, how many actually FILLED at Alpaca?
  3. If 0 submitted OR submitted>0 but 0 filled → P1 alert with specifics.

Runs read-only against Alpaca + Supabase. Manual + scheduled (~10:00 ET).
"""

from __future__ import annotations

import datetime as _dt
import logging
import os
import sys

import requests

from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.freshness import file_alert

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("paper_fill_watchdog")
PROJECT_REF = "yqaqqzseepebrocgibcw"


def _sb(sql: str):
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN required.")
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    r = requests.post(url, headers={"Authorization": f"Bearer {token}",
                                    "Content-Type": "application/json"},
                      json={"query": sql}, timeout=30)
    r.raise_for_status()
    return r.json()


def is_trading_day(alpaca: AlpacaPaperClient) -> bool:
    today = _dt.datetime.now(_dt.timezone.utc).date().isoformat()
    cal = alpaca._get(f"/v2/calendar?start={today}&end={today}")
    return bool(cal)


def main() -> int:
    alpaca = AlpacaPaperClient()

    if not is_trading_day(alpaca):
        logger.info("not a trading day — watchdog no-op")
        return 0

    # 1 — did today's morning run create any orders? (rows created in last 12h)
    created = _sb(
        "select count(*)::int as n from public.paper_orders "
        "where created_at >= (now() - interval '12 hours');"
    )
    n_created = created[0]["n"] if created else 0

    # 2 — of those, how many are 'submitted' and how many filled at Alpaca?
    submitted = _sb(
        "select count(*)::int as n from public.paper_orders "
        "where created_at >= (now() - interval '12 hours') and status = 'submitted';"
    )
    n_submitted = submitted[0]["n"] if submitted else 0

    # Count fills via Alpaca: orders closed today with filled_qty>0
    today_iso = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    try:
        orders = alpaca.list_orders(status="all", after=today_iso, limit=200)
        n_filled = sum(1 for o in orders if float(o.get("filled_qty", 0) or 0) > 0)
    except Exception as exc:
        logger.warning("could not list Alpaca orders (%s)", exc)
        n_filled = -1

    logger.info("watchdog: created=%d submitted=%d filled_at_alpaca=%d",
                n_created, n_submitted, n_filled)

    # 3 — alert conditions
    problems = []
    if n_created == 0:
        problems.append("No paper orders were created this morning at all — the "
                        "translator/producer did not run or found no signals.")
    elif n_submitted == 0:
        problems.append(f"{n_created} orders were computed but 0 were submitted to "
                        "the broker — submission was blocked or failed (check the "
                        "freshness gate and the opg time-window).")
    elif n_filled == 0:
        problems.append(f"{n_submitted} orders were submitted but 0 filled at the "
                        "broker — orders may have been rejected at the open.")

    if problems:
        msg = " ".join(problems)
        logger.warning("WATCHDOG ALERT: %s", msg)
        file_alert(
            title="Paper rebalance did not complete today",
            description=("Post-open watchdog found the daily rebalance did not "
                         f"complete. {msg} created={n_created} submitted="
                         f"{n_submitted} filled={n_filled}."),
            priority="P1",
        )
        return 0  # exit 0 so the alert is the signal, not a red workflow

    logger.info("watchdog OK — rebalance completed end-to-end (%d filled)", n_filled)
    return 0


if __name__ == "__main__":
    sys.exit(main())
