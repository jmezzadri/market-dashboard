#!/usr/bin/env python3
"""SPY sector cap-weights entry point.

Bug #1087 Phase 1 INGEST. Pulls the SSGA SPY holdings file, aggregates
weights by GICS sector, and writes one row per (date, sector) into
public.spy_sector_weights.

Invoked by:
  - GitHub Actions workflow SPY_SECTOR_WEIGHTS_DAILY.yml (prod cadence,
    weekday 06:00 ET)
  - Manual CLI for ad-hoc runs / UAT

Usage:
    python ingest_spy_sector_weights.py                # live run
    python ingest_spy_sector_weights.py --dry-run      # fetch + parse only

Pipeline name: market-spy_sector_weights-daily
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from scanner.spy_sector_weights import run_spy_sector_weights


def main() -> int:
    parser = argparse.ArgumentParser(description="Daily SPY sector weights ingest")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch + parse only; do not write to Supabase",
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
        summary = run_spy_sector_weights(dry_run=args.dry_run)
        print(json.dumps(summary, indent=2, default=str))
        return 0
    except Exception:
        logging.exception("spy_sector_weights run failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
