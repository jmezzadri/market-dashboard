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
    """Return (ok, details).

    ok is True iff BOTH sleeves the translator actually consumes are current
    for `required_date` (the most recent COMPLETED trading day):

      Sleeve A (Asset Tilt)  -> public/v10_allocation.json `as_of`.
          This is the DAILY allocator the translator reads. It uses the
          latest-available read of every macro input (forward-filled), so a
          single feed that publishes a day late (e.g. ICE BofA HY/IG OAS,
          which lags Treasuries by ~1 day) does NOT make the allocation stale.
      Sleeve B (Scanner)     -> max(scan_date) in public.trading_opps_signals.

    The weekly 2-axis regime model (public/macrotilt_engine.json, surfaced
    inside v10_allocation.json as `engine_as_of`) is NOT a daily gate: it
    refreshes on Fridays, so requiring it to equal a daily trading date would
    correctly block trading 4 days out of 5. We only flag it if it has gone
    stale beyond a generous 10-day weekly tolerance, which would mean the
    weekly refresh itself has broken.
    """
    import os, json
    import datetime as _dt
    import requests as _rq
    from pathlib import Path as _P

    details = {"required": required_date.isoformat()}

    def _parse(s):
        if not s:
            return None
        try:
            return _dt.date.fromisoformat(str(s)[:10])
        except Exception:
            return None

    # Sleeve A: the daily allocator the translator consumes.
    alloc_date_str = None
    regime_date_str = None
    alloc_path = _P("public/v10_allocation.json")
    if alloc_path.exists():
        try:
            _a = json.loads(alloc_path.read_text())
            alloc_date_str = _a.get("as_of")
            regime_date_str = _a.get("engine_as_of")
        except Exception:
            pass
    details["v10_allocation.as_of"] = alloc_date_str
    details["v10_allocation.engine_as_of(weekly)"] = regime_date_str

    # Sleeve B: the scanner the translator consumes.
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    scanner_date_str = None
    if not token:
        details["error"] = "SUPABASE_ACCESS_TOKEN missing"
    else:
        try:
            r = _rq.post(
                "https://api.supabase.com/v1/projects/yqaqqzseepebrocgibcw/database/query",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"query": "select max(scan_date)::text as d from public.trading_opps_signals;"},
                timeout=30,
            )
            rows = r.json()
            scanner_date_str = rows[0]["d"] if isinstance(rows, list) and rows and rows[0].get("d") else None
        except Exception as e:
            details["error"] = f"scanner query failed: {e}"
    details["trading_opps_signals.max(scan_date)"] = scanner_date_str

    alloc_date = _parse(alloc_date_str)
    scanner_date = _parse(scanner_date_str)
    regime_date = _parse(regime_date_str)

    sleeve_a_ok = bool(alloc_date and alloc_date >= required_date)
    sleeve_b_ok = bool(scanner_date and scanner_date >= required_date)
    # Weekly regime: a problem only if stale well beyond a normal week.
    regime_ok = bool(regime_date and (required_date - regime_date).days <= 10)

    details["sleeve_a_ok"] = sleeve_a_ok
    details["sleeve_b_ok"] = sleeve_b_ok
    details["regime_ok"] = regime_ok

    stale = []
    if not sleeve_a_ok:
        stale.append(
            f"Asset Tilt allocation (v10_allocation.json as_of={alloc_date_str}, "
            f"need >= {required_date.isoformat()})"
        )
    if not sleeve_b_ok:
        stale.append(
            f"Equity scanner (trading_opps_signals max scan_date={scanner_date_str}, "
            f"need >= {required_date.isoformat()})"
        )
    if not regime_ok:
        stale.append(
            f"Weekly regime engine (macrotilt engine_as_of={regime_date_str}, "
            f">10d old — the weekly Friday refresh may be broken)"
        )
    details["stale_inputs"] = stale

    return (sleeve_a_ok and sleeve_b_ok and regime_ok), details


# ── Per-input critical freshness (decision-mover registry) ────────────────
#
# Joe directive 2026-05-28: a stale input must NOT freeze the portfolio —
# freezing blocks exits, which can be riskier than trading. So we treat the
# inputs that can actually swing the equity/defensive split or turn on
# leverage as "decision-movers" and judge each against its OWN publish rhythm
# (in trading days). When a decision-mover is stale we enter DEGRADED MODE:
# block new buys + added leverage, but still run every exit / de-risking sell.
# Non-critical inputs (breadth, sentiment, slow macro) may lag freely.
#
# Tolerance = max trading days the latest reading may sit behind the required
# session before the input counts as stale. Tuned to each series' real lag:
#   live market / Treasuries / MOVE  -> publish T+0..T+1, tolerance 2
#   ICE BofA HY-IG credit            -> publishes T+1..T+2, tolerance 3
CRITICAL_INPUTS = {
    "move":        ("MOVE — rate volatility (stress axis of the equity/defensive split)", 2),
    "vix":         ("VIX — equity volatility (stress axis)", 2),
    "real_rates":  ("10Y real yield (yield-regime axis)", 2),
    "yield_curve": ("Yield curve 10Y-3M (yield-regime axis)", 2),
    "hy_ig":       ("HY-IG credit spread (credit / risk-on-off mechanism)", 3),
}


def _trading_days_between(d0: "date", d1: "date") -> int:
    """Count trading days strictly after d0 up to and including d1 (0 if d0>=d1)."""
    import datetime as _dt
    if d0 >= d1:
        return 0
    n = 0
    d = d0
    while d < d1:
        d = d + _dt.timedelta(days=1)
        if d.weekday() < 5 and d.isoformat() not in _NYSE_HOLIDAYS_2026:
            n += 1
    return n


def check_critical_inputs(required_date: "date",
                          indicator_path: str = "public/indicator_history.json"
                          ) -> "tuple[bool, list, dict]":
    """Return (degraded, stale_inputs, ages).

    degraded is True iff at least one decision-mover's latest reading is older
    than its tolerance (in trading days) relative to required_date. stale_inputs
    is a list of human-readable strings naming each stale decision-mover.
    """
    import json
    import datetime as _dt
    from pathlib import Path as _P

    ages: dict = {}
    stale: list = []
    p = _P(indicator_path)
    if not p.exists():
        # Cannot prove freshness -> fail safe (treat as degraded so we don't
        # add risk blindly; exits still run).
        return True, ["indicator history file missing — cannot verify inputs"], {"error": "missing"}
    try:
        data = json.loads(p.read_text())
    except Exception as e:
        return True, [f"indicator history unreadable ({e}) — cannot verify inputs"], {"error": str(e)}

    for key, (name, tol) in CRITICAL_INPUTS.items():
        node = data.get(key) or {}
        pts = node.get("points") or []
        last = pts[-1][0] if pts else None
        try:
            ld = _dt.date.fromisoformat(str(last)[:10]) if last else None
        except Exception:
            ld = None
        if ld is None:
            stale.append(f"{name}: no data found")
            ages[key] = None
            continue
        age = _trading_days_between(ld, required_date)
        ages[key] = {"last": last, "trading_days_old": age, "tolerance": tol}
        if age > tol:
            stale.append(f"{name}: last {last}, {age} trading days old (limit {tol})")
    return (len(stale) > 0), stale, ages


def _send_alert(subject: str, lines: "list[str]") -> None:
    """Best-effort email alert to Joe. Reuses the repo-root SMTP helper.
    Never raises — a failed alert must not break the trade run."""
    try:
        from daily_analysis_email import send_email  # repo root, on sys.path
        send_email(subject=subject, body_plain="\n".join(lines))
        logger.info("alert email sent: %s", subject)
    except Exception as e:  # pragma: no cover
        logger.warning("alert email NOT sent (%s): %s", subject, e)


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
        logger.info(
            "freshness gate: required=%s | sleeveA alloc as_of=%s | "
            "sleeveB scanner scan_date=%s | weekly regime as_of=%s",
            details.get("required"),
            details.get("v10_allocation.as_of"),
            details.get("trading_opps_signals.max(scan_date)"),
            details.get("v10_allocation.engine_as_of(weekly)"),
        )
        if not ok:
            logger.warning(
                "FRESHNESS GATE BLOCKED submission. Stale input(s): %s. "
                "Will retry on the next morning run.",
                " | ".join(details.get("stale_inputs") or ["unknown"]),
            )
            return {"freshness_gate": "skipped", "details": details}

        # ── Per-input critical freshness → asymmetric degraded mode ───────
        # A stale decision-mover blocks NEW BUYS / added leverage but never
        # blocks exits or de-risking sells (Joe directive 2026-05-28).
        degraded, stale_inputs, ages = check_critical_inputs(required)
        if degraded:
            logger.warning(
                "DEGRADED MODE — stale decision-mover(s): %s. Suppressing NEW "
                "BUYS and added leverage; exits / de-risking sells still run.",
                " | ".join(stale_inputs),
            )
        else:
            logger.info(
                "decision-movers fresh: %s",
                {k: (v.get("trading_days_old") if isinstance(v, dict) else v)
                 for k, v in ages.items()},
            )
    else:
        degraded, stale_inputs = False, []

    t_result = run_translator(
        account_number=account_number,
        asset_tilt_path=asset_tilt_path,
        scan_date=scan_date,
        dry_run=dry_run,
        suppress_buys=degraded,
    )
    logger.info("translator: %d order intents (suppress_buys=%s), dry_run=%s",
                len(t_result.intents), degraded, dry_run)

    # ── Alerts: (a) degraded mode suppressed buys, (b) score-collapse exits ─
    collapse_exits = [
        i for i in t_result.intents
        if i.side == "sell" and "fell below buy threshold" in (i.rebalance_trigger_reason or "")
    ]
    if not dry_run:
        if degraded:
            _send_alert(
                "MacroTilt paper — DEGRADED MODE: new buys suppressed",
                ["A decision-moving input went stale, so NEW BUYS and added "
                 "leverage were suppressed for this run. Exits / de-risking "
                 "still executed normally.", "", "Stale input(s):"] + stale_inputs,
            )
        if collapse_exits:
            _send_alert(
                f"MacroTilt paper — {len(collapse_exits)} risk EXIT(s): score collapsed",
                ["The following holding(s) were sold because their score fell "
                 "below the buy threshold:", ""]
                + [f"  {i.ticker} — {i.rebalance_trigger_reason}" for i in collapse_exits],
            )

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
