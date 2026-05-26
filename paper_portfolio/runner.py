"""
paper_portfolio.runner — nightly orchestrator.

Two ET phases per trading day:

  PHASE EOD (default --phase eod, runs ~16:30 ET after the close):
    1. translator.run(...)  — Asset Tilt + Scanner → pending paper_orders rows.
    2. submitter.submit_pending_orders(...) — submit MOO orders for tomorrow's open.

  PHASE OPEN (--phase open, runs ~09:45 ET after the opening auction settles):
    3. mirror.mirror_fills(...)    — pull last 24h of Alpaca fills.
    4. mirror.mirror_positions(...) — overwrite today's snapshot.
    5. mirror.write_nav_daily(...) — write paper_nav_daily.

  PHASE ALL (--phase all): runs both EOD and OPEN sequentially. Useful for
  smoke-testing or one-off rebalance after market hours when MOO routes
  to next session.

  --dry-run: every step prints what it would do but writes nothing.

LIVE-TRADING KILL-SWITCH
------------------------
By default this runner runs in DRY-RUN mode UNLESS the environment
variable PAPER_LIVE_TRADING_ENABLED is set to the literal string 'true'.

This is a belt-and-braces guard so the scheduled GitHub workflow cannot
accidentally fire live submissions before Joe explicitly enables them.

To enable live trading:
  GitHub repo → Settings → Secrets and variables → Actions → New secret
    Name:  PAPER_LIVE_TRADING_ENABLED
    Value: true
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date
from typing import Any


def _live_trading_enabled() -> bool:
    """Read the live-trading kill-switch from the environment. Returns
    True only if PAPER_LIVE_TRADING_ENABLED == 'true' (case-insensitive).
    Any other value (including unset) returns False — i.e. dry-run."""
    return os.environ.get("PAPER_LIVE_TRADING_ENABLED", "").strip().lower() == "true"

from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.mirror import (
    mirror_fills,
    mirror_positions,
    write_nav_daily,
)
from paper_portfolio.submitter import submit_pending_orders
from paper_portfolio.translator import run as run_translator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("paper_runner")


def run_eod_phase(
    account_number: str | None = None,
    asset_tilt_path: str = "public/v10_allocation.json",
    scan_date: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Translator + Submitter."""
    logger.info("=" * 60)
    logger.info("PHASE EOD — signal capture + MOO submission")
    logger.info("=" * 60)
    t_result = run_translator(
        account_number=account_number,
        asset_tilt_path=asset_tilt_path,
        scan_date=scan_date,
        dry_run=dry_run,
    )
    logger.info("translator: %d order intents, dry_run=%s", len(t_result.intents), dry_run)

    s_result = submit_pending_orders(dry_run=dry_run)
    logger.info("submitter: submitted=%d rejected=%d duplicates=%d",
                s_result.submitted, s_result.rejected, s_result.duplicates)
    if s_result.errors:
        for e in s_result.errors[:5]:
            logger.warning("submit error: %s", e)
    return {"translator": t_result, "submitter": s_result}


def run_open_phase(
    snapshot_date: date | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Fills + positions + NAV mirror."""
    logger.info("=" * 60)
    logger.info("PHASE OPEN — fill + position + NAV mirror")
    logger.info("=" * 60)
    alpaca = AlpacaPaperClient()
    n_fills = mirror_fills(alpaca=alpaca, dry_run=dry_run)
    n_pos = mirror_positions(alpaca=alpaca, snapshot_date=snapshot_date, dry_run=dry_run)
    nav = write_nav_daily(alpaca=alpaca, snapshot_date=snapshot_date, dry_run=dry_run)
    return {"fills": n_fills, "positions": n_pos, "nav": nav}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="MacroTilt paper-portfolio nightly runner.")
    p.add_argument("--phase", choices=["eod", "open", "all"], default="eod")
    p.add_argument("--account", help="paper account_number override")
    p.add_argument("--asset-tilt-path", default="public/v10_allocation.json")
    p.add_argument("--scan-date", help="explicit scanner scan_date (YYYY-MM-DD)")
    p.add_argument("--dry-run", action="store_true",
                   help="compute and log; no Supabase writes, no Alpaca submission")
    p.add_argument("--force-live", action="store_true",
                   help="OVERRIDE the PAPER_LIVE_TRADING_ENABLED env-var guard. "
                        "Required to fire live orders from a workflow_dispatch run.")
    args = p.parse_args(argv)

    # Kill-switch: if --dry-run is set we honour it; otherwise we require
    # the env-var (or --force-live) to be set, else we silently downgrade
    # to dry-run.
    effective_dry_run = args.dry_run
    if not effective_dry_run:
        if not (_live_trading_enabled() or args.force_live):
            logger.warning(
                "LIVE TRADING NOT ENABLED — PAPER_LIVE_TRADING_ENABLED is not 'true' "
                "and --force-live was not passed. Downgrading to dry-run."
            )
            effective_dry_run = True
        else:
            logger.warning("LIVE TRADING ENABLED — orders will be submitted to Alpaca.")

    if args.phase in ("eod", "all"):
        run_eod_phase(
            account_number=args.account,
            asset_tilt_path=args.asset_tilt_path,
            scan_date=args.scan_date,
            dry_run=effective_dry_run,
        )
    if args.phase in ("open", "all"):
        run_open_phase(dry_run=effective_dry_run)
    logger.info("runner done — phase=%s dry_run=%s", args.phase, effective_dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
