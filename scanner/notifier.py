"""Gmail SMTP alerts (Phase 2)."""

from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from config import (
    ALERT_EMAIL_FROM,
    ALERT_EMAIL_TO,
    ALERT_ON_BUY,
    ALERT_ON_WATCH,
    GMAIL_APP_PASSWORD,
)


def send_alert_email(subject: str, html_body: str, text_body: str) -> bool:
    """Send alert email via Gmail SMTP. Returns True if sent successfully."""
    if not GMAIL_APP_PASSWORD or not ALERT_EMAIL_FROM:
        print("Email not configured — skipping notification (set ALERT_EMAIL_FROM and GMAIL_APP_PASSWORD in .env)")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = ALERT_EMAIL_FROM
        msg["To"] = ALERT_EMAIL_TO
        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(ALERT_EMAIL_FROM, GMAIL_APP_PASSWORD)
            server.sendmail(ALERT_EMAIL_FROM, [ALERT_EMAIL_TO], msg.as_string())
        return True
    except Exception as e:
        print(f"Email send failed: {e}")
        return False


def should_send(
    buy_opps: list[Any],
    watch_opps: list[Any],
    sell_alerts: list[dict[str, Any]],
) -> bool:
    """Always send a daily scan email so you know the scanner ran successfully.
    Even on quiet days (no alerts), you get a 'No alerts' confirmation email.
    """
    return True
