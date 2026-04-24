#!/usr/bin/env python3
"""Universe snapshot entry point.

Invoked by:
  - GitHub Actions workflow UNIVERSE_SNAPSHOT_3X_WEEKDAYS.yml (prod cadence)
  - Supabase trigger-workflow edge fn via pg_cron (backup cadence)
  - Manual CLI for ad-hoc runs / UAT

Usage:
    python run_universe_snapshot.py                # live run
    python run_universe_snapshot.py --dry-run      # fetch only, no DB write

Exits 0 on success, 1 on any uncaught error (so GH Actions shows red).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid
from datetime import datetime, timezone

from scanner.universe_snapshot import run_universe_snapshot
from scanner.api_usage_helper import log_run_summary


def main() -> int:
    parser = argparse.ArgumentParser(description="3x-daily universe snapshot")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch from UW but skip DB write (prints row count + summary)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s] %(name)s :: %(message)s",
    )

    run_id = uuid.uuid4()
    started_at = datetime.now(timezone.utc)
    try:
        summary = run_universe_snapshot(dry_run=args.dry_run)
        print(json.dumps(summary, indent=2, default=str))
        if not args.dry_run:
            # Bug #1032: write one row per successful run into api_usage_log
            # so the Admin API Usage bar chart has historical per-day data
            # for this workflow source.
            log_run_summary(
                source="universe_snapshot",
                run_id=run_id,
                started_at=started_at,
                completed_at=datetime.now(timezone.utc),
                calls_made=int(summary.get("api_calls") or 0) or None,
                status="success",
                notes={
                    "rows_fetched": summary.get("rows_fetched"),
                    "rows_upserted": summary.get("rows_upserted"),
                    "supplemental_added": summary.get("supplemental_added"),
                },
            )
        return 0
    except Exception as exc:
        logging.exception("universe_snapshot run failed")
        log_run_summary(
            source="universe_snapshot",
            run_id=run_id,
            started_at=started_at,
            completed_at=datetime.now(timezone.utc),
            status="failed",
            notes={"error": str(exc)[:500]},
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
