#!/usr/bin/env python3
"""send_thesis_review_email.py — email the weekly thesis review to Joe, once.

Sends the HTML that scripts/thesis_review.py rendered from the COMMITTED
public/thesis_reviews.json (never from a session's working copy), to the SMTP
user only. One email per review date: the send is claimed in
thesis_review_email_log before it happens — the primary key is the mutex, a
concurrent run gets a 409 and stays quiet — and a failed send releases the
claim so the next run can retry (the morning brief's 2026-08-13 lesson: a
claim must never outlive the action it was claiming).

Environment: SMTP_USER, SMTP_PASSWORD, EMAIL_FROM (optional), SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, RESEND=true to re-send an already-sent review
(workflow_dispatch), RUN_ID for the log.

Exit 1 if the email should have gone out and did not.
"""

from __future__ import annotations

import json
import os
import smtplib
import sys
import urllib.error
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

REVIEWS_PATH = "public/thesis_reviews.json"
HTML_PATH = "/tmp/review.html"
TEXT_PATH = "/tmp/review.txt"
LOG_TABLE = "thesis_review_email_log"


def _rest(method: str, path: str, body=None, prefer="return=minimal") -> int:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}", data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": prefer})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


def claim(review_date: str, run_id: str) -> bool:
    try:
        _rest("POST", LOG_TABLE, {"review_date": review_date, "sent_by": run_id})
        return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            print(f"review {review_date} already emailed — nothing to send")
            return False
        raise


def release(review_date: str, detail: str) -> None:
    try:
        _rest("DELETE", f"{LOG_TABLE}?review_date=eq.{review_date}")
        _rest("POST", f"{LOG_TABLE}_failures", {"review_date": review_date, "detail": detail[:500]})
    except Exception as e:  # noqa: BLE001 — logging must never mask the real failure
        print(f"WARN: could not release/record claim: {e}", file=sys.stderr)


def main() -> int:
    with open(REVIEWS_PATH, encoding="utf-8") as f:
        doc = json.load(f)
    L = doc.get("latest") or {}
    review_date = L.get("review_date")
    if not review_date:
        print("no latest.review_date in the review file", file=sys.stderr)
        return 1
    user, pw = os.environ.get("SMTP_USER", ""), os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("EMAIL_FROM") or user
    if not (user and pw):
        print("SMTP_USER / SMTP_PASSWORD missing", file=sys.stderr)
        return 1
    run_id = os.environ.get("RUN_ID", "local")
    resend = os.environ.get("RESEND", "false").lower() == "true"
    if resend:
        try:
            _rest("DELETE", f"{LOG_TABLE}?review_date=eq.{review_date}")
        except Exception as e:  # noqa: BLE001
            print(f"WARN: could not clear prior claim for resend: {e}", file=sys.stderr)
    if not claim(review_date, run_id):
        return 0
    try:
        c = L.get("counts") or {}
        msg = MIMEMultipart("alternative")
        msg["Subject"] = (f"Thesis Review — {review_date} · {c.get('intact', 0)} intact, "
                          f"{c.get('weakened', 0)} weakened, {c.get('broken', 0)} broken")
        msg["From"] = sender
        msg["To"] = user
        msg.attach(MIMEText(open(TEXT_PATH, encoding="utf-8").read(), "plain"))
        msg.attach(MIMEText(open(HTML_PATH, encoding="utf-8").read(), "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(user, pw)
            s.sendmail(sender, [user], msg.as_string())
        print(f"review email {review_date} sent to {user}")
        return 0
    except Exception as e:  # noqa: BLE001
        detail = f"{type(e).__name__}: {e}"
        print(f"email send FAILED: {detail}", file=sys.stderr)
        release(review_date, detail)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
