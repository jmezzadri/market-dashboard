"""
paper_portfolio.emailer — real email alerts for the paper pipeline.

Reuses the SAME Gmail-SMTP mechanism the scanner notifier already uses in
production (smtp.gmail.com:465, SSL). Reads the repo's existing secrets:
  SMTP_USER     — the Gmail address that authenticates + sends (the From)
  SMTP_PASSWORD — the Gmail app password
  EMAIL_TO      — recipient (Joe's inbox)
  EMAIL_FROM    — optional override for the From header (defaults to SMTP_USER)

This exists because the bug_reports row alone does NOT reach Joe — nothing
emails on a direct DB insert. The watchdog/freshness gate call this so a
failure actually lands in his inbox, not just an admin table.

Best-effort: never raises into the caller. Returns True if sent.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger("paper_emailer")


def send_alert_email(subject: str, body_text: str) -> bool:
    user = os.environ.get("SMTP_USER", "")
    pw = os.environ.get("SMTP_PASSWORD", "")
    to = os.environ.get("EMAIL_TO", "")
    sender = os.environ.get("EMAIL_FROM", "") or user
    if not (user and pw and to):
        logger.warning("email not configured (SMTP_USER/SMTP_PASSWORD/EMAIL_TO) — "
                       "cannot send alert: %s", subject)
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = sender
        msg["To"] = to
        html = ("<div style='font-family:system-ui,Arial,sans-serif;font-size:14px'>"
                + body_text.replace("\n", "<br>") + "</div>")
        msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(user, pw)
            server.sendmail(sender, [to], msg.as_string())
        logger.info("alert email sent to %s — %s", to, subject)
        return True
    except Exception as exc:  # noqa: BLE001 — alerting must never crash the caller
        logger.warning("alert email send failed (%s): %s", subject, exc)
        return False


# ── Once-per-day guard (added 2026-06-09) ───────────────────────────────────
# WHY: the morning submit workflow deliberately fires many times (GitHub cron
# delivery is unreliable, so redundant fires are the insurance that one lands
# in the pre-open window) and the post-open watchdog runs on two timers for
# DST coverage. Order submission is rerun-safe; the EMAILS were not — Joe got
# 7 rebalance emails on 2026-06-09 instead of 2. This guard records each email
# type sent per ET calendar day in public.paper_email_log; only the first
# caller of the day actually sends. Fail-OPEN: if the dedupe check itself
# errors, send anyway — a rare duplicate beats a silent miss.

_PROJECT_REF = "yqaqqzseepebrocgibcw"


def _sb_query(sql: str):
    import requests  # lazy — keep module import dependency-free
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN required for email dedupe")
    url = f"https://api.supabase.com/v1/projects/{_PROJECT_REF}/database/query"
    r = requests.post(url, headers={"Authorization": f"Bearer {token}",
                                    "Content-Type": "application/json"},
                      json={"query": sql}, timeout=30)
    r.raise_for_status()
    return r.json()


def _claim_daily_email_slot(email_type: str) -> bool:
    """True if this process is the FIRST to send `email_type` today (ET)."""
    import datetime as _dt
    try:
        from zoneinfo import ZoneInfo
        d = _dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:  # noqa: BLE001
        d = _dt.datetime.utcnow().date().isoformat()
    try:
        _sb_query(
            "create table if not exists public.paper_email_log ("
            " d date not null, email_type text not null,"
            " sent_at timestamptz not null default now(),"
            " primary key (d, email_type));"
        )
        rows = _sb_query(
            "insert into public.paper_email_log (d, email_type) "
            f"values ('{d}', '{email_type}') "
            "on conflict (d, email_type) do nothing returning d;"
        )
        if rows:
            return True
        logger.info("daily email '%s' already sent for %s — suppressing duplicate",
                    email_type, d)
        return False
    except Exception as exc:  # noqa: BLE001 — fail-open
        logger.warning("email dedupe check failed (%s) — sending anyway", exc)
        return True


def send_alert_email_once(email_type: str, subject: str, body_text: str) -> bool:
    """Send at most ONE email of this type per ET calendar day.

    Use for the two scheduled daily emails (morning queued summary,
    post-open execution report) whose workflows fire redundantly on
    purpose. One-off/P0 alerts should keep using send_alert_email.
    """
    if not _claim_daily_email_slot(email_type):
        return False
    return send_alert_email(subject, body_text)
