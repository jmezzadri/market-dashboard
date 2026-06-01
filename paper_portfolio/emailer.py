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
