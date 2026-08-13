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
    now = datetime.datetime.now(ET)
    today = now.strftime("%Y-%m-%d")
    # A brief only exists on trading days (2026-08-01). Off one, the site
    # correctly carries the last trading day's brief -- that is NOT stale, and
    # treating it as stale is how a safety net turns into a Saturday 2am email.
    # After 07:00 ET only, so the 06:15 writer gets its shot before we step in.
    if not bdb.is_trading_day(now.date()):
        print(f"{today} is not a trading day — the brief is not expected to be today's")
        return
    # ONE deadline, imported not duplicated (2026-08-13). This used to be a
    # hardcoded 7 while the writer's own constant was also 7, and both were
    # earlier than the generator's real arrival time — so this guard woke up
    # inside the delivery gap every weekday and turned a brief that was merely
    # 20 minutes away into a failed workflow run. LESSONS 4.28.
    deadline = bdb.BRIEF_EXPECTED_BY_HOUR_ET
    if now.hour < deadline:
        print(f"{now:%H:%M} ET is before the {deadline:02d}:00 ET brief deadline — not yet stale")
        return
    prev = live_date()
    if prev == today:
        print(f"brief current ({today}) — no action needed")
        return
    print(f"brief STALE (live={prev}, today={today}) — handing to the writer")
    status = bdb.main()   # may write public/daily_brief.json, or sys.exit(1) if it cannot
    # Only claim a self-heal when one actually happened. The old code alerted
    # unconditionally, so once metered generation was switched off (2026-08-06)
    # this could email Joe "the homepage was stale — auto-fixed" on a run that
    # regenerated precisely nothing. An alert that misreports what it did is
    # worse than no alert (LESSONS 0.1: fake green is forbidden — and so is a
    # fake fix).
    if status == "generated":
        alert(today, prev)
    else:
        print(f"writer returned '{status}' — nothing was regenerated, so no "
              f"'auto-fixed' email. The homepage is still showing {prev}.")


if __name__ == "__main__":
    main()
