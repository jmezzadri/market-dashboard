"""
End-of-day UW account meter read — bug #1197 Phase 1b.

The admin "Unusual Whales" usage page reads public.api_usage_log. The only
job that samples UW's account-wide rate-limit headers (x-uw-daily-req-count
/ x-uw-token-req-limit) is ticker_events, whose last weekday run is ~6 PM ET
— before the heavy evening per-stock ingests. So the page never captures the
true end-of-day total (~15,000 of the 20,000/day budget); it caps at the
~6 PM reading.

This script makes ONE cheap UW call late at night (after the 11 PM insider
ingest), reads the account headers off that response via UWUsageLogger, and
writes a single 'ad_hoc' row to api_usage_log carrying remaining_daily /
limit_daily. That row is the true end-of-day reading.

Run via .github/workflows/UW_METER_READ_NIGHTLY.yml at ~11:45 PM ET on
weekdays. The workflow carries one cron per US daylight-savings half, so it
fires twice; the ET-hour guard below makes the off-season fire a no-op, so
exactly one real meter read lands per weekday night. Pass --force (or set
METER_FORCE=true) to bypass the guard for a manual verification run.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from scanner.uw_usage_logger import UWUsageLogger

# A cheap, single-row UW endpoint. The point of the call is to read the
# account rate-limit response headers, not the body. It counts as exactly
# one request against the daily budget.
METER_ENDPOINT = "/api/congress/recent-trades"
METER_PARAMS = {"limit": 1}


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
    # The workflow has two crons so it reaches 11:45 PM ET in both DST
    # halves. Only the fire that lands in the 11 PM ET hour is the real
    # end-of-day read; the other is a no-op so we don't append a
    # near-midnight (~0) reading that would mislabel the headline KPI.
    if now_et.hour != 23 and not forced:
        print(
            f"uw_meter_read: ET hour is {now_et.hour}, not 23 — skipping "
            f"this off-season cron fire."
        )
        return 0

    with UWUsageLogger(source="ad_hoc") as ulog:
        resp = ulog.get(METER_ENDPOINT, params=METER_PARAMS)
        resp.raise_for_status()

    print(
        f"uw_meter_read: end-of-day meter read complete at "
        f"{now_et.isoformat()} (forced={forced})."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
