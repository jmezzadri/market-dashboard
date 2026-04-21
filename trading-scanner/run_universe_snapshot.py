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

from scanner.universe_snapshot import run_universe_snapshot


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

    try:
        summary = run_universe_snapshot(dry_run=args.dry_run)
        print(json.dumps(summary, indent=2, default=str))
        return 0
    except Exception:
        logging.exception("universe_snapshot run failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
