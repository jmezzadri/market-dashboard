"""
scripts/paper_fill_watchdog.py — post-open fill verification + alert.

THE PROBLEM THIS SOLVES (2026-06-01): for a full week the rebalance silently
did nothing and every run still reported "success." Nobody knew until Joe
asked. This watchdog runs after the open each trading day and verifies the
rebalance ACTUALLY HAPPENED end-to-end. If not, it files a P1 alert so a
silent failure can never run for days again.

Checks (per the ET session day):
  1. Did the engine run at all? (paper_signal_capture rows written today.)
  2. How many orders did it EXPECT to place (sum of triggered_orders_count)
     versus how many were actually written to paper_orders?
  3. Of those, how many actually FILLED at Alpaca?
  4. P1 alert only on a real gap. A day where the engine ran and expected
     zero orders is a SUCCESS, not a failure — see the 2026-07-30 note in
     main().

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

    # 0 — DID THE PRODUCER RUN, AND WHAT DID IT EXPECT TO TRADE? (2026-07-30)
    # The old watchdog treated "0 orders created" as failure. But the engine
    # legitimately produces ZERO orders on any day the target book already
    # matches the holdings — most days. That fired a false P1 on 6/15, 6/22,
    # 7/23 and 7/29 (on each of those the producer HAD run and correctly had
    # nothing to do), which is why the alert kept coming back after every
    # "fix": there was nothing to fix on the trading side.
    # public.paper_signal_capture is the oracle the old logic ignored: the
    # producer writes one row per signal each morning with the number of
    # orders that signal should trigger. Across 7/16-7/30 expected == actual
    # on every single day, including the 0/0 days. So:
    #   heartbeat rows == 0            -> producer never ran      (REAL P1)
    #   expected == 0 and created == 0 -> nothing to trade        (SUCCESS)
    #   expected  > 0 and created == 0 -> translator dropped them (REAL P1)
    #   created < expected             -> partial write           (REAL P1)
    heartbeat = _sb(
        "select count(*)::int as rows_, "
        "coalesce(sum(triggered_orders_count),0)::int as expected "
        "from public.paper_signal_capture "
        "where (captured_at at time zone 'America/New_York')::date "
        "    = (now() at time zone 'America/New_York')::date;"
    )
    n_heartbeat = heartbeat[0]["rows_"] if heartbeat else 0
    n_expected = heartbeat[0]["expected"] if heartbeat else 0

    # 1 — how many orders did today's morning run actually create?
    # Windowed on the ET SESSION DAY, not a rolling 12h UTC window (the old
    # window drifted across the run's own two DST timers).
    created = _sb(
        "select count(*)::int as n from public.paper_orders "
        "where (created_at at time zone 'America/New_York')::date "
        "    = (now() at time zone 'America/New_York')::date;"
    )
    n_created = created[0]["n"] if created else 0

    # 2 — of those, how many are 'submitted' and how many filled at Alpaca?
    submitted = _sb(
        "select count(*)::int as n from public.paper_orders "
        "where (created_at at time zone 'America/New_York')::date "
        "    = (now() at time zone 'America/New_York')::date "
        "  and status = 'submitted';"
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

    logger.info("watchdog: heartbeat=%d expected=%d created=%d submitted=%d "
                "filled_at_alpaca=%d",
                n_heartbeat, n_expected, n_created, n_submitted, n_filled)

    # 3 — alert conditions.
    # FILLS ARE THE SOURCE OF TRUTH (fixed 2026-06-01). The DB 'submitted'
    # status is an intermediate marker that some paths (e.g. the manual
    # fill-now route) set differently — judging success by it caused a
    # false "0 submitted" alarm on a day when 30 orders actually filled.
    # What matters to Joe is: did orders fill at the broker? So:
    #   - no engine trace at all                  -> producer failed
    #   - engine ran, expected 0, created 0       -> QUIET DAY, success (7/30)
    #   - expected>0 but created<expected         -> translator dropped orders
    #   - created>0 but 0 filled AND 0 submitted  -> nothing reached the broker
    #   - created>0, submitted>0, 0 filled        -> rejected at the open
    #   - filled>0                                -> SUCCESS, whatever the status string
    problems = []
    quiet_day = False
    if n_heartbeat == 0 and n_created == 0 and n_filled <= 0:
        problems.append("The morning engine run left no trace at all today "
                        "(no signal rows were written) — the producer did not "
                        "run. Check the pre-open workflow.")
    elif n_expected == 0 and n_created == 0 and n_filled <= 0:
        # Healthy no-trade day: the engine ran, compared the target book to the
        # holdings, and correctly had nothing to do. NOT a problem.
        quiet_day = True
    elif n_created == 0:
        problems.append(f"The engine computed {n_expected} order(s) this morning "
                        "but none were written to the order book — the "
                        "translator dropped them.")
    elif n_created < n_expected:
        problems.append(f"The engine computed {n_expected} order(s) but only "
                        f"{n_created} were written to the order book.")
    elif n_filled == 0 and n_submitted == 0:
        problems.append(f"{n_created} orders were computed but none reached the "
                        "broker (0 submitted, 0 filled) — submission was blocked "
                        "or failed (check the freshness gate and the opg window).")
    elif n_filled == 0:
        problems.append(f"{n_submitted} orders were submitted but 0 filled at the "
                        "broker — orders may have been rejected at the open.")
    # If n_filled > 0 we treat the day as a SUCCESS even if n_submitted reads 0,
    # because the orders demonstrably executed (e.g. via the manual fill path).

    # Email helper (best-effort) — used for BOTH the failure and the success path
    def _email(subject: str, body: str):
        # Once per ET day ("execution_report") — the watchdog runs on two
        # timers (DST coverage), which double-sent the confirmation email.
        try:
            from paper_portfolio.emailer import send_alert_email_once
            send_alert_email_once("execution_report", subject, body)
        except Exception as exc:  # noqa: BLE001
            logger.warning("watchdog email failed: %s", exc)

    # ── SINGLE EXECUTION-REPORT EMAIL (one outcome email per day) ──────────
    # Email #2 of the day (Email #1 is the morning "queued" summary from the
    # runner). This ALWAYS sends and reports both what executed and what
    # failed in one place, rather than separate success/failure emails. The
    # DB bug_reports row is still filed ONLY on a real problem — that's the
    # admin-surface record; the email is the thing that reaches Joe.
    n_not_filled = max(0, n_created - n_filled) if n_created >= 0 else 0

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
        subject = (f"[MacroTilt paper P1] Rebalance PROBLEM — "
                   f"{n_filled} filled, {n_not_filled} did NOT execute")
        body = ("ACTION MAY BE NEEDED — today's rebalance did not fully complete.\n\n"
                f"What failed: {msg}\n\n"
                f"Executed (filled at the open): {n_filled}\n"
                f"Did NOT execute:               {n_not_filled}\n"
                f"Orders computed this morning:  {n_created}\n\n"
                "Investigate the pipeline.")
    elif quiet_day:
        logger.info("watchdog OK — engine ran, no trades needed today")
        subject = "[MacroTilt paper] No trades needed today"
        body = ("The engine ran this morning and the book already matched its "
                "targets, so there was nothing to trade. Nothing needs your "
                "attention.\n\n"
                f"Signals checked:               {n_heartbeat}\n"
                "Orders required:               0\n"
                "Orders placed:                 0\n")
    else:
        logger.info("watchdog OK — rebalance completed end-to-end (%d filled)", n_filled)
        subject = f"[MacroTilt paper] Rebalance executed — {n_filled} filled, 0 failed"
        body = ("Today's rebalance completed. Nothing needs your attention.\n\n"
                f"Executed (filled at the open): {n_filled}\n"
                f"Failed:                        0\n"
                f"Orders computed this morning:  {n_created}\n\n"
                "Everything that was queued executed.")

    _email(subject, body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
