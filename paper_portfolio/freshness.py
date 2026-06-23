"""
paper_portfolio.freshness — pre-submit freshness gate.

THE PROBLEM THIS SOLVES (2026-06-01): the runner had NO freshness check.
It read max(scan_date) / as_of and traded on whatever it found — fresh or
days stale. Combined with the opg time-window bug, the system either no-op'd
or would have silently rebalanced on stale signals. The workflow comments
CLAIMED a freshness gate existed; it did not. This module is that gate.

Contract: before any live submission, the scanner signal must be current for
the most recent CLOSED trading session (per Alpaca's own calendar — not a
naive weekday/holiday guess). If it is behind, the gate FAILS: the runner
skips submission and an alert row is filed. No stale trade ever fires.
(Sleeve A retired 2026-06-23 — the paper portfolio runs the Equity Scanner
sleeve only, so only the scanner date is gated.)

Why "last closed session" and not "today": the daily rebalance runs in the
early morning to queue at-the-open orders for TODAY's open. The freshest
signals available at that hour reflect the PRIOR trading day's close (the
overnight price batch). So the bar is: scanner == last_closed_session.
"""

from __future__ import annotations

import datetime as _dt
import logging
import os
from dataclasses import dataclass

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("paper_freshness")

PROJECT_REF = "yqaqqzseepebrocgibcw"


def file_alert(title: str, description: str, priority: str = "P1") -> None:
    """Insert a row into public.bug_reports so a silent pipeline failure is
    visible on the admin bug surface. Best-effort: never raises into the
    caller (an alert failing must not crash the runner). Idempotent-ish:
    skips if an open row with the same title already exists today."""
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        logger.warning("cannot file alert — SUPABASE_ACCESS_TOKEN unset: %s", title)
        return
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

    def q(sql: str):
        from paper_portfolio._sbq import sb_query
        return sb_query(sql, token)

    safe_title = title.replace("'", "''")
    safe_desc = description.replace("'", "''")
    try:
        existing = q(
            "select id from public.bug_reports "
            f"where title = '{safe_title}' and status not in ('resolved','wontfix') "
            "and created_at >= (now() - interval '20 hours') limit 1;"
        )
        if existing:
            logger.info("alert already open today — not duplicating: %s", title)
            return
        q(
            "insert into public.bug_reports (reporter_email, title, description, priority, status) "
            f"values ('paper-pipeline@macrotilt.internal', '{safe_title}', '{safe_desc}', '{priority}', 'new');"
        )
        logger.warning("filed %s alert: %s", priority, title)
    except Exception as exc:  # noqa: BLE001 — alerting must never crash the runner
        logger.warning("failed to file alert (%s): %s", title, exc)

    # The DB row alone does NOT reach Joe (nothing emails on a direct insert).
    # Send a real email via the existing Gmail-SMTP secrets so the alert lands
    # in his inbox. Best-effort; import is local so a missing emailer never
    # breaks the run.
    try:
        from paper_portfolio.emailer import send_alert_email
        send_alert_email(f"[MacroTilt paper {priority}] {title}", description)
    except Exception as exc:  # noqa: BLE001
        logger.warning("alert email hop failed (%s): %s", title, exc)


@dataclass(frozen=True)
class FreshnessResult:
    fresh: bool
    last_closed_session: str          # YYYY-MM-DD per Alpaca calendar
    sleeve_b_scan_date: str
    reasons: list[str]                # human-readable, empty when fresh


def last_closed_trading_session(alpaca, now_utc: _dt.datetime | None = None) -> str:
    """Most recent trading session whose close has already passed, per
    Alpaca's calendar. Returns 'YYYY-MM-DD'.

    Uses the broker calendar so market holidays and early closes are handled
    by the source of truth, not a hand-maintained list. We ask for a window
    ending today and walk back to the last session whose close (in ET) is
    strictly before 'now'."""
    now_utc = now_utc or _dt.datetime.now(_dt.timezone.utc)
    today = now_utc.date()
    start = (today - _dt.timedelta(days=10)).isoformat()
    end = today.isoformat()
    # AlpacaPaperClient is trading-host; the calendar endpoint lives there.
    cal = alpaca._get(f"/v2/calendar?start={start}&end={end}")  # list of {date, open, close}
    # Each entry: date 'YYYY-MM-DD', close 'HH:MM' ET. Build close datetime in ET.
    last = None
    for entry in cal:
        d = entry.get("date")
        close_hm = entry.get("close", "16:00")
        try:
            hh, mm = (int(x) for x in close_hm.split(":"))
        except Exception:
            hh, mm = 16, 0
        # ET offset: EDT (Mar-Nov) = -4, EST = -5. Use -4 in summer; for a
        # close comparison the 1-hour ambiguity is immaterial (we compare to
        # 'now', and sessions days in the past are unambiguous). Use -4.
        close_utc = _dt.datetime.fromisoformat(d).replace(
            hour=hh, minute=mm, tzinfo=_dt.timezone(_dt.timedelta(hours=-4))
        ).astimezone(_dt.timezone.utc)
        if close_utc < now_utc:
            last = d
    if last is None:
        # Degenerate (e.g. very long holiday run) — fall back to the latest
        # calendar entry strictly before today.
        prior = [e["date"] for e in cal if e.get("date", "") < today.isoformat()]
        last = prior[-1] if prior else (today - _dt.timedelta(days=1)).isoformat()
    return last


def check_freshness(scanner_scan_date: str, alpaca,
                    now_utc: _dt.datetime | None = None) -> FreshnessResult:
    """Return a FreshnessResult. fresh=True only if the scanner scan date is
    >= the last closed trading session. (>= rather than == so that if the
    scanner is somehow AHEAD — e.g. a same-day partial — we don't false-fail;
    behind is the only failure that matters for stale-trade protection.)"""
    lcs = last_closed_trading_session(alpaca, now_utc=now_utc)
    reasons: list[str] = []
    b = (scanner_scan_date or "").strip()
    if not b:
        reasons.append("Stock sleeve (Scanner) has no scan date.")
    elif b < lcs:
        reasons.append(f"Stock sleeve is stale: scan {b}, last closed session {lcs}.")
    fresh = not reasons
    return FreshnessResult(
        fresh=fresh, last_closed_session=lcs,
        sleeve_b_scan_date=b, reasons=reasons,
    )
