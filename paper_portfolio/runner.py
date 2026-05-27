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


# ── Freshness gate ────────────────────────────────────────────────────────
#
# Joe directive 2026-05-27 evening: EOD trades MUST NOT fire until both the
# Trading Opps scanner and the Asset Tilt engine have ingested the most
# recent prior trading day's close. Without this, the workflow can compute
# a diff against stale signals (saw this same evening: bought Fri 5/22
# picks at 9:30 ET, then 5/26 close caught up at 18:00 ET, then 19:30 ET
# EOD would have churned the portfolio against 5/26 data while it should
# have been waiting for 5/27).
#
# Rule:
#   * trading_opps_signals.max(scan_date) >= most-recent prior trading day
#   * macrotilt_engine.json.as_of           >= same date
# If either fails, exit cleanly without submitting.

# US NYSE holidays for 2026 (date-only, in the calendar order they occur).
# Hard-coded for now; replace with pandas_market_calendars when added to deps.
_NYSE_HOLIDAYS_2026 = {
    "2026-01-01",  # New Year's Day
    "2026-01-19",  # MLK Day
    "2026-02-16",  # Presidents Day
    "2026-04-03",  # Good Friday
    "2026-05-25",  # Memorial Day
    "2026-06-19",  # Juneteenth
    "2026-07-03",  # Independence Day (observed)
    "2026-09-07",  # Labor Day
    "2026-11-26",  # Thanksgiving
    "2026-12-25",  # Christmas
}


def most_recent_prior_trading_day(now_et: "datetime") -> "date":
    """Return the most recent COMPLETED US trading day.

    'Completed' means market closed at 16:00 ET. If called pre-16:00 ET
    on a trading day, returns the PREVIOUS trading day. If called on a
    weekend or holiday, walks back to the last trading day."""
    import datetime as _dt
    d = now_et.date()
    # If it's before 16:00 ET today, today's close hasn't happened yet → start from yesterday.
    if now_et.hour < 16:
        d = d - _dt.timedelta(days=1)
    # Walk back over weekends + NYSE holidays.
    while d.weekday() >= 5 or d.isoformat() in _NYSE_HOLIDAYS_2026:
        d = d - _dt.timedelta(days=1)
    return d


def check_engine_freshness(required_date: "date") -> "tuple[bool, dict]":
    """Return (ok, details) where ok is True iff both engines are at >= required_date."""
    import os, json
    import requests as _rq
    from pathlib import Path as _P

    details = {"required": required_date.isoformat()}

    # 1) Trading Opps — Supabase Management API
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        return False, {"required": required_date.isoformat(), "error": "SUPABASE_ACCESS_TOKEN missing"}
    r = _rq.post(
        "https://api.supabase.com/v1/projects/yqaqqzseepebrocgibcw/database/query",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": "select max(scan_date)::text as d from public.trading_opps_signals;"},
        timeout=30,
    )
    rows = r.json()
    scanner_date_str = rows[0]["d"] if isinstance(rows, list) and rows and rows[0].get("d") else None
    details["trading_opps_signals.max(scan_date)"] = scanner_date_str

    # 2) Asset Tilt — read the in-repo macrotilt_engine.json (workflow checks out main)
    engine_path = _P("public/macrotilt_engine.json")
    engine_date_str = None
    if engine_path.exists():
        try:
            engine_date_str = json.loads(engine_path.read_text()).get("as_of")
        except Exception:
            engine_date_str = None
    details["macrotilt_engine.as_of"] = engine_date_str

    # Compare
    import datetime as _dt
    def _parse(s):
        try:
            return _dt.date.fromisoformat(s) if s else None
        except Exception:
            return None
    scanner_date = _parse(scanner_date_str)
    engine_date = _parse(engine_date_str)

    scanner_ok = bool(scanner_date and scanner_date >= required_date)
    engine_ok = bool(engine_date and engine_date >= required_date)
    details["scanner_ok"] = scanner_ok
    details["engine_ok"] = engine_ok

    return scanner_ok and engine_ok, details


def _now_eastern():
    """Best-effort ET clock; works in workflow (TZ=UTC) by manual offset."""
    import datetime as _dt
    try:
        from zoneinfo import ZoneInfo
        return _dt.datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        # Fallback: UTC - 4 (EDT) — close enough for the date-bucket math.
        return _dt.datetime.utcnow() - _dt.timedelta(hours=4)




def run_eod_phase(
    account_number: str | None = None,
    asset_tilt_path: str = "public/v10_allocation.json",
    scan_date: str | None = None,
    dry_run: bool = False,
    skip_freshness_gate: bool = False,
) -> dict[str, Any]:
    """Translator + Submitter."""
    logger.info("=" * 60)
    logger.info("PHASE EOD — signal capture + MOO submission")
    logger.info("=" * 60)

    # ── Freshness gate (Joe directive 2026-05-27) ─────────────────────────
    if not skip_freshness_gate:
        now_et = _now_eastern()
        required = most_recent_prior_trading_day(now_et)
        ok, details = check_engine_freshness(required)
        logger.info("freshness gate: required=%s scanner=%s engine=%s",
                    details.get("required"),
                    details.get("trading_opps_signals.max(scan_date)"),
                    details.get("macrotilt_engine.as_of"))
        if not ok:
            logger.warning(
                "ENGINES NOT FRESH (required %s, scanner_ok=%s, engine_ok=%s) — "
                "skipping EOD submission. Will retry on next workflow run.",
                details.get("required"), details.get("scanner_ok"), details.get("engine_ok")
            )
            return {"freshness_gate": "skipped", "details": details}
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
