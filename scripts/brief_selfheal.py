#!/usr/bin/env python3
"""
brief_selfheal.py — safety net for the homepage daily brief.

Run by the BRIEF-FRESHNESS-SELFHEAL workflow on weekday mornings, AFTER the
06:15 ET writer should have finished. It reads the brief that is actually
published on the live site (macrotilt.com/daily_brief.json). If that brief is
not dated today (ET) — because the writer was disabled, skipped by GitHub's
best-effort scheduler, or failed — it regenerates the brief with the same one
generator and emails Joe a heads-up.

This closes the exact hole that froze the homepage on 2026-06-29: a *disabled*
producer never runs, so a run-and-fail alert never fires. This guard checks the
OUTCOME on the live site, so it catches every cause (disabled / skipped / failed).
"""
from __future__ import annotations
import datetime, json, os, sys, smtplib, urllib.request
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

import build_daily_brief as bdb  # reuse the single brief generator

ET = ZoneInfo("America/New_York")
SITE = "https://macrotilt.com/daily_brief.json"


def live_date():
    """Date of the brief currently published on the live site, or None."""
    try:
        url = SITE + "?cb=" + datetime.datetime.now().strftime("%H%M%S")
        req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode()).get("date")
    except Exception as e:
        print(f"WARN: could not read live brief: {e}", file=sys.stderr)
        return None


def alert(today, prev):
    """Tell Joe the homepage was stale and was auto-fixed."""
    user, pw = os.environ.get("SMTP_USER", ""), os.environ.get("SMTP_PASSWORD", "")
    to = [x.strip() for x in os.environ.get("EMAIL_TO", user).split(",") if x.strip()] or [user]
    if not (user and pw):
        print("WARN: email not configured; cannot send self-heal alert", file=sys.stderr)
        return
    body = (f"The MacroTilt homepage brief was stale this morning.\n\n"
            f"  Showed:   {prev}\n  Expected: {today}\n\n"
            f"The safety net regenerated the brief, so the homepage is now current.\n"
            f"Please check the DAILY-BRIEF-WRITER workflow — it is likely disabled or failing.")
    msg = MIMEText(body)
    msg["Subject"] = f"[MacroTilt] Homepage brief was stale — auto-fixed ({today})"
    msg["From"] = os.environ.get("EMAIL_FROM", "") or user
    msg["To"] = ", ".join(to)
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(user, pw)
            s.sendmail(msg["From"], to, msg.as_string())
        print(f"self-heal alert emailed to {to}")
    except Exception as e:
        print(f"WARN: self-heal alert email failed (non-fatal): {e}", file=sys.stderr)


def main():
    today = datetime.datetime.now(ET).strftime("%Y-%m-%d")
    prev = live_date()
    if prev == today:
        print(f"brief current ({today}) — no action needed")
        return
    print(f"brief STALE (live={prev}, today={today}) — regenerating via the writer")
    bdb.main()        # writes public/daily_brief.json (+ sends the normal brief email)
    alert(today, prev)


if __name__ == "__main__":
    main()
