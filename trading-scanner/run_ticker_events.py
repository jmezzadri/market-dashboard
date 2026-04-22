#!/usr/bin/env python3
"""ticker_events entry point.

Invoked by:
  - GitHub Actions workflow TICKER_EVENTS_3X_WEEKDAYS.yml (prod cadence)
  - Supabase trigger-workflow edge fn via pg_cron (backup cadence)
  - Manual CLI for ad-hoc runs / UAT

Usage:
    python run_ticker_events.py                # live run
    python run_ticker_events.py --dry-run      # fetch only, no DB write

Exits 0 on success, 1 on any uncaught error.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from scanner.ticker_events import run_ticker_events


def main() -> int:
    parser = argparse.ArgumentParser(description="3x-daily ticker_events ingestion")
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

    try:
        summary = run_ticker_events(dry_run=args.dry_run)
        print(json.dumps(summary, indent=2, default=str))
        return 0
    except Exception:
        logging.exception("ticker_events run failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
