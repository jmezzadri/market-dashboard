"""
End-of-day UW account meter read — bug #1197 Phase 1b.

The admin "Unusual Whales" usage page reads public.api_usage_log. The only
job that samples UW's account-wide rate-limit headers (x-uw-daily-req-count
/ x-uw-token-req-limit) is ticker_events, whose last weekday run is ~6 PM ET
— before the heavy evening per-stock ingests. So the page never captures the
true end-of-day total (~15,000 of the 20,000/day budget); it caps at the
~6 PM reading.

This script makes ONE cheap UW call late at night (after the 11 PM insider
ingest), reads the account rate-limit headers off that response, and writes
a single 'ad_hoc' row to api_usage_log carrying remaining_daily /
limit_daily. That row is the true end-of-day reading.

Run via .github/workflows/UW_METER_READ_NIGHTLY.yml at ~11:45 PM ET on
weekdays. The workflow carries one cron per US daylight-savings half, so it
fires twice. GitHub Actions often delivers a scheduled cron hours late, so
instead of a fixed time-of-night guard the job is idempotent per ET day:
whichever fire lands first does the read, and any later fire that finds
today's end-of-day row already written no-ops. Pass --force (or set
METER_FORCE=true) to force a read even when today's row already exists.

429 handling: UW's per-minute rate-limit window is 60s, so a transient 429
has to be waited out, not retried with short backoff. read_meter() honours
the x-uw-req-per-minute-reset header and retries across the window.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

from scanner.api_usage_helper import log_run_summary

UW_BASE = "https://api.unusualwhales.com"
# A cheap, single-row UW endpoint. The point of the call is to read the
# account rate-limit response headers, not the body. It counts as one
# request against the daily budget.
METER_ENDPOINT = "/api/congress/recent-trades"
METER_PARAMS = {"limit": 1}
MAX_ATTEMPTS = 5


def _uw_headers() -> dict[str, str]:
    key = os.environ.get("UNUSUAL_WHALES_API_KEY")
    if not key:
        raise RuntimeError("UNUSUAL_WHALES_API_KEY not set")
    return {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "UW-CLIENT-API-ID": os.environ.get("UW_CLIENT_API_ID", "100001"),
    }


def _int_header(value: str | None) -> int | None:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def read_meter() -> tuple[int | None, int | None, int]:
    """Make the cheap UW call and read the account meter off the headers.

    Returns (limit_daily, daily_count, calls_made). On a 429 (per-minute
    rate limit) it waits out the window — using x-uw-req-per-minute-reset
    when present — and retries. Returns (None, None, calls_made) if no
    attempt yields the daily headers.
    """
    headers = _uw_headers()
    calls = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            resp = requests.get(f"{UW_BASE}{METER_ENDPOINT}", headers=headers,
                                params=METER_PARAMS, timeout=60)
            calls += 1
        except requests.RequestException as exc:
            print(f"uw_meter_read: attempt {attempt} network error: {exc}")
            if attempt < MAX_ATTEMPTS:
                time.sleep(15)
            continue
        limit = _int_header(resp.headers.get("x-uw-token-req-limit"))
        count = _int_header(resp.headers.get("x-uw-daily-req-count"))
        if resp.status_code == 200 and limit is not None and count is not None:
            return limit, count, calls
        reset = _int_header(resp.headers.get("x-uw-req-per-minute-reset"))
        wait = (reset + 5) if reset else 45
        print(f"uw_meter_read: attempt {attempt} status={resp.status_code} "
              f"limit={limit} count={count} — retrying in {wait}s")
        if attempt < MAX_ATTEMPTS:
            time.sleep(wait)
    return None, None, calls


def _already_read_today(now_et: datetime) -> bool:
    """True if an end-of-day meter row already exists for today (ET).

    GitHub Actions delivers the scheduled cron hours late and the workflow
    fires twice (one cron per DST half), so a fixed time-of-night guard made
    the job no-op every night (#1197). Instead we record once per ET day:
    whichever fire lands first writes the row, any later fire finds it here
    and skips. If the check itself cannot run, return False so the meter
    read still proceeds rather than being silently skipped.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("uw_meter_read: SUPABASE env not set — skipping idempotency "
              "check, proceeding with the read.")
        return False
    et_day_start = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
    since_utc = et_day_start.astimezone(timezone.utc).isoformat()
    try:
        # params= so requests URL-encodes the "+" in since_utc — a raw "+"
        # in a PostgREST query decodes to a space and breaks the filter.
        resp = requests.get(
            f"{url.rstrip('/')}/rest/v1/api_usage_log",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            params={
                "select": "id",
                "source": "eq.ad_hoc",
                "notes->>meter_read": "eq.end_of_day",
                "started_at": f"gte.{since_utc}",
                "limit": "1",
            },
            timeout=30,
        )
        resp.raise_for_status()
        return len(resp.json()) > 0
    except requests.RequestException as exc:
        print(f"uw_meter_read: idempotency check failed ({exc}) — "
              f"proceeding with the read.")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force", action="store_true",
        help="Run the meter read even outside the 11 PM ET window.",
    )
    args = parser.parse_args()
    forced = args.force or os.environ.get("METER_FORCE", "").lower() in (
        "true", "1", "yes",
    )

    now_et = datetime.now(ZoneInfo("America/New_York"))
    # Record once per ET day. The workflow has two crons (one per DST half)
    # and GitHub Actions delivers them hours late, so a fixed "11 PM ET
    # hour" guard made the job no-op every night (#1197). Now whichever
    # fire lands first does the read; a later fire finds today's row and
    # no-ops here.
    if not forced and _already_read_today(now_et):
        print(
            f"uw_meter_read: an end-of-day reading already exists for "
            f"{now_et.date().isoformat()} (ET) — skipping this cron fire."
        )
        return 0

    started = datetime.now(timezone.utc)
    limit, count, calls = read_meter()
    if limit is None or count is None:
        print("uw_meter_read: could not read the UW account meter after "
              f"{calls} call(s) — no row written.")
        return 1

    remaining = max(limit - count, 0)
    ok = log_run_summary(
        source="ad_hoc",
        endpoint=METER_ENDPOINT,
        calls_made=calls,
        started_at=started,
        completed_at=datetime.now(timezone.utc),
        status="success",
        limit_daily=limit,
        remaining_daily=remaining,
        notes={"daily_count": count, "meter_read": "end_of_day"},
    )
    print(
        f"uw_meter_read: account meter {count}/{limit} used "
        f"({remaining} remaining) at {now_et.isoformat()} — "
        f"logged={ok} (forced={forced})."
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
