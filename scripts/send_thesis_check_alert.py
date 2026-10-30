#!/usr/bin/env python3
"""send_thesis_check_alert.py — email Joe when an open call's reason stops being true.

Reads public/thesis_checks.json (written by daily_thesis_check.py in the same
workflow run). For every tripped (call, reason) not already alerted, claims
the pair in thesis_check_alerts BEFORE sending — the primary key is the mutex,
so a concurrent or repeated run gets a 409 and stays quiet — then sends ONE
email covering every new trip. A failed send releases the claims so the next
run retries (a claim must never outlive the action it was claiming —
the morning brief's 2026-08-13 lesson).

Quiet days send nothing (Joe, 2026-10-30: email only when a call trips).

Environment: SMTP_USER, SMTP_PASSWORD, EMAIL_FROM (optional), SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, RUN_ID. DRY_RUN=true prints the email instead.
Exit 1 only if an email should have gone out and did not.
"""

from __future__ import annotations

import html
import json
import os
import smtplib
import sys
import urllib.error
import urllib.parse
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

CHECKS_PATH = "public/thesis_checks.json"
TABLE = "thesis_check_alerts"


def _rest(method: str, path: str, body=None) -> int:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}", data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


def claim(note_id: str, reason_key: str, as_of: str, run_id: str) -> bool:
    try:
        _rest("POST", TABLE, {"note_id": note_id, "reason_key": reason_key, "first_tripped": as_of, "sent_by": run_id})
        return True
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return False
        raise


def release(note_id: str, reason_key: str) -> None:
    try:
        _rest("DELETE", f"{TABLE}?note_id=eq.{urllib.parse.quote(note_id)}&reason_key=eq.{urllib.parse.quote(reason_key)}")
    except Exception as e:  # noqa: BLE001 — logging must never mask the real failure
        print(f"WARN: could not release claim {note_id}/{reason_key}: {e}", file=sys.stderr)


def render(calls: list[dict], as_of: str) -> tuple[str, str, str]:
    n = len(calls)
    subject = (f"Trade Idea check: {calls[0]['title']} no longer holds" if n == 1
               else f"Trade Idea check: {n} open calls no longer hold")
    text, parts = [], []
    for c in calls:
        reasons = "; ".join(r["text"] for r in c["new_reasons"])
        text += [c["title"], f"Published {c['date']}. What tripped: {reasons}.", ""]
        text += [f"  - {ln}" for ln in c["lines"]] + [""]
        parts.append(
            f"<h3 style='margin:18px 0 4px;font:600 16px sans-serif'>{html.escape(c['title'])}</h3>"
            f"<p style='margin:0 0 6px;font:14px sans-serif'>Published {html.escape(c['date'])}. "
            f"<b>What tripped:</b> {html.escape(reasons)}.</p><ul style='font:14px sans-serif;margin:0'>"
            + "".join(f"<li>{html.escape(ln)}</li>" for ln in c["lines"]) + "</ul>")
    foot = ("What happens next: the call stays open on the Scorecard until its stop prints or the thesis "
            "review rules on it. Tomorrow morning's Trade Idea run and Monday's review must each say whether "
            "the call stands, and why. You get this email once per trip, never daily.")
    text += [foot, f"(Readings as of {as_of}.)"]
    body = ("<div style='max-width:640px'>"
            f"<p style='font:14px sans-serif'>The daily check re-measured every open call after the close. "
            f"{'This call' if n == 1 else 'These calls'} no longer {'rests' if n == 1 else 'rest'} on what the note said.</p>"
            + "".join(parts) + f"<p style='font:13px sans-serif;color:#555;margin-top:18px'>{html.escape(foot)}<br>"
            f"Readings as of {html.escape(as_of)}.</p></div>")
    return subject, "\n".join(text), body


def main() -> int:
    with open(CHECKS_PATH, encoding="utf-8") as f:
        doc = json.load(f)
    as_of = doc.get("as_of") or ""
    dry = os.environ.get("DRY_RUN", "false").lower() == "true"
    run_id = os.environ.get("RUN_ID", "local")
    new, claimed = [], []
    for c in doc.get("calls") or []:
        if not c.get("tripped"):
            continue
        fresh = []
        for r in c.get("trip_reasons") or []:
            if dry or claim(c["id"], r["key"], as_of, run_id):
                fresh.append(r)
                claimed.append((c["id"], r["key"]))
        if fresh:
            new.append({**c, "new_reasons": fresh})
    if not new:
        print("no new trips — nothing to send")
        return 0
    subject, text, body = render(new, as_of)
    if dry:
        print(subject)
        print(text)
        return 0
    user, pw = os.environ.get("SMTP_USER", ""), os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("EMAIL_FROM") or user
    try:
        if not (user and pw):
            raise RuntimeError("SMTP_USER / SMTP_PASSWORD missing")
        msg = MIMEMultipart("alternative")
        msg["Subject"], msg["From"], msg["To"] = subject, sender, user
        msg.attach(MIMEText(text, "plain"))
        msg.attach(MIMEText(body, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(user, pw)
            s.sendmail(sender, [user], msg.as_string())
        print(f"alert sent: {subject}")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"alert send FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        for nid, key in claimed:
            release(nid, key)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
