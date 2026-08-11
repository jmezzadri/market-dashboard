"""
paper_portfolio.runner — nightly orchestrator.

Two ET phases per trading day:

  PHASE EOD (default --phase eod, pre-open submit window):
    0. trading-day gate — the broker calendar must say TODAY is a session,
       else the whole phase no-ops (weekday crons fire on weekday market
       holidays; 2026-07-03 proved it).
    1. translator.run(...)  — Equity Scanner → pending paper_orders rows.
    2. submitter.submit_pending_orders(...) — submit MOO orders for today's open.

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
from paper_portfolio.freshness import check_freshness, file_alert, is_trading_session
from paper_portfolio.mirror import (
    certify_snapshot_prices,
    official_closes,
    _et_today,
    ensure_paper_schema,
    mirror_fills,
    mirror_positions,
    stamp_paper_pipeline_health,
    write_nav_daily,
)
from paper_portfolio.intraday import run_intraday
from paper_portfolio.submitter import submit_pending_orders
from paper_portfolio.translator import run as run_translator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("paper_runner")


def run_eod_phase(
    account_number: str | None = None,
    scan_date: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Trading-day gate + Translator + Submitter."""
    logger.info("=" * 60)
    logger.info("PHASE EOD — signal capture + MOO submission")
    logger.info("=" * 60)

    # ── TRADING-DAY GATE (added 2026-07-03) ────────────────────────────────
    # The workflow's crons fire Mon-Fri and its only guard was a time-of-day
    # window, so a market holiday that lands on a weekday (2026-07-03,
    # Independence Day observed) sailed straight through: prior-session
    # signals were "fresh", the window was valid, and 11 at-the-open orders
    # were queued at the broker on a day with no session — parking them for
    # the NEXT open and emailing a rebalance summary on a holiday. Ask the
    # broker calendar whether TODAY (ET) is a session before doing ANYTHING —
    # before the translator, so no pending rows, signal captures, or emails
    # are produced on non-trading days. Holiday/weekend → quiet no-op (INFO);
    # calendar ERROR → block + P1, the same fail-safe direction as the
    # freshness gate below. The CLOSE and INTRADAY phases have had equivalent
    # market-closed guards all along; this brings the one phase that SUBMITS
    # ORDERS up to the same standard.
    session_date = _et_today()
    try:
        session_today = is_trading_session(AlpacaPaperClient(), session_date)
    except Exception as exc:  # noqa: BLE001 — calendar fetch must not crash the run
        logger.warning("trading-day check errored (%s) — BLOCKING run to be safe", exc)
        if not dry_run:
            file_alert(
                title="Paper rebalance blocked — trading-day check failed",
                description=(
                    "The pre-open paper rebalance could not confirm whether today "
                    "is a trading session (broker calendar unreachable) and was "
                    "blocked as a precaution. No orders were placed; the account "
                    "holds its prior positions. If today IS a trading day, "
                    "re-run the morning paper workflow once the calendar recovers."
                ),
                priority="P1",
            )
        return {"translator": None, "submitter": None,
                "blocked": True, "reason": "trading-day check errored"}
    if not session_today:
        logger.info(
            "TRADING-DAY GATE — %s is not a trading session (market holiday or "
            "weekend); skipping the rebalance entirely: no intents, no orders, "
            "no email.", session_date,
        )
        return {"translator": None, "submitter": None,
                "skipped": "market-closed", "date": str(session_date)}

    t_result = run_translator(
        account_number=account_number,
        scan_date=scan_date,
        dry_run=dry_run,
    )
    logger.info("translator: %d order intents, dry_run=%s", len(t_result.intents), dry_run)
    for _i in t_result.intents:
        if _i.target_quantity is not None:
            _sz = f"{_i.target_quantity:g} sh"
        elif _i.target_notional is not None:
            _sz = f"${_i.target_notional:,.0f}"
        else:
            _sz = "n/a"
        logger.info("  INTENT | sleeve %s | %s %s | %s | src=%s | %s",
                    _i.sleeve, _i.side, _i.ticker, _sz, _i.signal_source,
                    _i.rebalance_trigger_reason or "")

    # ── FRESHNESS GATE (added 2026-06-01) ──────────────────────────────────
    # Before submitting, require BOTH sleeve signals to be current for the
    # last closed trading session (per Alpaca's calendar). If either is
    # stale, SKIP submission and file a P1 alert. This is the guard the old
    # workflow comments falsely claimed existed. It runs in live mode only;
    # a dry-run still reports what it WOULD have done.
    b_scan_date = t_result.scanner_scan_date
    try:
        fr = check_freshness(b_scan_date, AlpacaPaperClient())
    except Exception as exc:  # calendar fetch must not crash the run
        logger.warning("freshness check errored (%s) — BLOCKING submit to be safe", exc)
        fr = None

    if fr is None or not fr.fresh:
        reasons = "; ".join(fr.reasons) if fr else "freshness check could not run"
        logger.warning("FRESHNESS GATE BLOCKED submission — %s", reasons)
        if not dry_run:
            file_alert(
                title="Paper rebalance skipped — stale signals",
                description=(
                    "The morning paper rebalance did NOT submit because signal "
                    f"data was not current. {reasons}. Last closed session: "
                    f"{getattr(fr, 'last_closed_session', 'unknown')}. "
                    "No orders were placed; the account holds its prior positions. "
                    "Investigate the upstream price/screener pipeline."
                ),
                priority="P1",
            )
        return {"translator": t_result, "submitter": None,
                "blocked": True, "freshness": fr}

    logger.info("FRESHNESS GATE PASSED — both sleeves current as of %s",
                fr.last_closed_session)

    s_result = submit_pending_orders(dry_run=dry_run)
    logger.info("submitter: submitted=%d rejected=%d duplicates=%d",
                s_result.submitted, s_result.rejected, s_result.duplicates)
    if s_result.errors:
        for e in s_result.errors[:5]:
            logger.warning("submit error: %s", e)

    # ── QUEUED-CONFIRMATION EMAIL (added 2026-06-01) ───────────────────────
    # On a real (non-dry) run, email Joe a plain-English summary of what was
    # queued for the open. Silence had hidden a week of failure; a positive
    # "here's what's queued" every morning makes a MISSING email itself a
    # red flag. Best-effort; never crash the run.
    if not dry_run:
        try:
            from paper_portfolio.emailer import send_alert_email_once
            buys = [i for i in t_result.intents if i.side == "buy"]
            sells = [i for i in t_result.intents if i.side == "sell"]
            def _notional(i):
                if i.target_notional is not None:
                    return abs(float(i.target_notional))
                return 0.0
            buy_val = sum(_notional(i) for i in buys)
            sell_val = sum(_notional(i) for i in sells)
            lines = [
                f"Paper rebalance queued for the next open ({fr.last_closed_session} signals).",
                "",
                f"Orders submitted to broker: {s_result.submitted}"
                f" (rejected {s_result.rejected}, duplicates {s_result.duplicates})",
                f"Buys: {len(buys)}  (~${buy_val:,.0f})    Sells: {len(sells)}  (~${sell_val:,.0f})",
            ]
            # ONE combined email, a section per sleeve (Two-Sleeve build PR-2).
            SLEEVE_NAMES = {"B": "Conviction Events", "M": "Momentum (retired)", "A": "Asset Tilt (retired)"}
            def _fmt(i):
                if i.target_quantity is not None:
                    sz = f"{i.target_quantity:g} sh"
                elif i.target_notional is not None:
                    sz = f"${abs(i.target_notional):,.0f}"
                else:
                    sz = "n/a"
                return f"  {i.side.upper():4} {i.ticker:6} {sz:>10}"
            for skey in ("B", "M", "A"):
                s_ints = [i for i in t_result.intents if i.sleeve == skey]
                if skey == "M" and not s_ints and not getattr(t_result, "momentum_action", ""):
                    continue  # sleeve dark — no section
                if skey == "A" and not s_ints:
                    continue
                lines += ["", f"— {SLEEVE_NAMES[skey]} —"]
                if s_ints:
                    lines += [_fmt(i) for i in s_ints]
                elif skey == "M":
                    lines.append(f"  No trades ({t_result.momentum_action}).")
                else:
                    lines.append("  No trades today.")
            if s_result.errors:
                lines += ["", "Submit errors:"] + [f"  {e}" for e in s_result.errors[:8]]
            lines += ["", "These execute at the 9:30am ET opening auction. "
                          "A separate confirmation follows after the open."]
            # Subject must not read like a failure on a healthy quiet day
            # (2026-07-30). Zero intents = the book already matches its
            # targets, which is normal and most common. Only intents that
            # were computed and then NOT submitted are a problem.
            if s_result.submitted:
                status = "queued"
            elif not t_result.intents:
                status = "nothing to trade"
            else:
                status = "NO ORDERS submitted"
            # Once per ET day: the workflow fires redundantly on purpose
            # (cron-lateness insurance) and reruns are no-op duplicates of
            # the same decision, so only the first run of the day emails.
            send_alert_email_once(
                "morning_summary",
                f"[MacroTilt paper] Morning rebalance {status} — "
                f"{s_result.submitted} orders for the open"
                if status != "nothing to trade" else
                "[MacroTilt paper] Morning rebalance — nothing to trade today",
                "\n".join(lines),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("queued-confirmation email failed: %s", exc)

    # Stamp the paper feeds' freshness rows for the intents this phase just
    # produced. Without this, the Recent-activity chip reds every morning
    # between the pre-open submit (~04:00 ET) and the 09:45 open phase: the
    # page shows orders created this morning while pipeline_health still
    # carries yesterday evening's run as the last successful pull — tripping
    # the data-after-pull invariant (an honest red, but a producer stamp gap,
    # not a data problem). The open and close phases already stamp; this
    # brings the one phase that CREATES the orders up to the same standard.
    # (Joe 2026-07-16: red chips on the Paper page pre-open.)
    stamp_paper_pipeline_health(dry_run=dry_run)

    return {"translator": t_result, "submitter": s_result}


def run_open_phase(
    dry_run: bool = False,
) -> dict[str, Any]:
    """Morning (post-open) phase — fills mirror + close-price certification.

    Changed 2026-06-10 (Joe directive: the page shows close-of-business marks
    only). This phase no longer creates a positions snapshot or NAV row — the
    CLOSE phase owns those. The old behavior rewrote the display snapshot at
    whatever clock time GitHub delivered the cron (12:49 PM on 2026-06-10),
    which read as a midday intraday refresh. Now the morning run only:
      1. mirrors overnight/opening fills (rebalance log + emails), and
      2. certifies the latest close snapshot against prices_eod — Polygon's
         full T+1 panel lands overnight, so by ~09:45 ET the canonical feed
         can confirm (or correct) the broker closes written yesterday 16:50.
    """
    logger.info("=" * 60)
    logger.info("PHASE OPEN — fills mirror + close-price certification")
    logger.info("=" * 60)
    if not dry_run:
        ensure_paper_schema()
    alpaca = AlpacaPaperClient()
    try:
        n_fills = mirror_fills(alpaca=alpaca, dry_run=dry_run)
    except Exception:
        logger.exception("mirror_fills failed — continuing to certification")
        n_fills = -1
    if dry_run:
        logger.info("[dry-run] would certify latest snapshot prices from prices_eod")
        n_cert = 0
    else:
        n_cert = certify_snapshot_prices()
    stamp_paper_pipeline_health(dry_run=dry_run)
    return {"fills": n_fills, "certified": n_cert}


def run_close_phase(
    snapshot_date: date | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Close-of-business snapshot — THE daily record the page displays.

    Runs ~16:50 ET. Values every holding, both sleeve tables, and the NAV row
    at the session's OFFICIAL closing prices (daily bars), so a late cron
    cannot contaminate the record with after-hours marks. Skips cleanly on
    holidays/weekends (no SPY session bar = no session)."""
    logger.info("=" * 60)
    logger.info("PHASE CLOSE — official-close positions + NAV snapshot")
    logger.info("=" * 60)
    if not dry_run:
        ensure_paper_schema()
    alpaca = AlpacaPaperClient()
    session = snapshot_date or _et_today()
    if not official_closes(alpaca, ["SPY"], session):
        logger.info("no SPY session bar for %s — market closed or bar not yet published; skipping", session)
        return {"skipped": str(session)}
    try:
        n_fills = mirror_fills(alpaca=alpaca, dry_run=dry_run)
    except Exception:
        logger.exception("mirror_fills failed — continuing to positions + NAV snapshot")
        n_fills = -1
    n_pos = mirror_positions(alpaca=alpaca, snapshot_date=session, dry_run=dry_run, price_mode="close")
    nav = write_nav_daily(alpaca=alpaca, snapshot_date=session, dry_run=dry_run, price_mode="close")
    # Stamp each paper feed's freshness row so the chips read real (not
    # fake-green) status and the rebalance chip's positions dependency resolves.
    stamp_paper_pipeline_health(dry_run=dry_run)
    if not dry_run:
        _check_sleeve_cash_drift()
    return {"fills": n_fills, "positions": n_pos, "nav": nav}


def _check_sleeve_cash_drift() -> None:
    """Cash-band tripwire (2026-07-21, Joe directive): a sleeve's idle cash
    is allowed to float within +/- CASH_DRIFT_ALERT_PCT of its NAV (the 1%
    sizing buffer normally keeps it well inside). Beyond the band, file a P1
    bug so drift can never build silently. Best-effort: never crashes the
    close snapshot."""
    try:
        from paper_portfolio._sbq import sb_query
        from paper_portfolio.config import CASH_DRIFT_ALERT_PCT
        from paper_portfolio.freshness import file_alert
        rows = sb_query(
            "select snapshot_date::text as d, sleeve_b_cash, sleeve_b_nav, "
            "sleeve_m_cash, sleeve_m_nav from public.paper_nav_daily "
            "order by snapshot_date desc limit 1;")
        if not rows:
            return
        r = rows[0]
        for label, cash_key, nav_key in (
                ("Conviction Events", "sleeve_b_cash", "sleeve_b_nav"),
                ("Momentum (retired)", "sleeve_m_cash", "sleeve_m_nav")):
            cash = float(r.get(cash_key) or 0.0)
            nav_v = float(r.get(nav_key) or 0.0)
            if nav_v <= 0:
                continue
            frac = cash / nav_v
            if abs(frac) > CASH_DRIFT_ALERT_PCT:
                file_alert(
                    title=(f"Paper {label} sleeve cash {frac:+.1%} of NAV — "
                           f"outside the 2% band ({r['d']})"),
                    description=(
                        f"Sleeve cash ${cash:,.0f} vs NAV ${nav_v:,.0f}. "
                        "Negative = unintended margin; positive = cash "
                        "building instead of being redeployed. Sizing is "
                        "meant to re-anchor to live NAV with a 1% buffer "
                        "each rebalance — investigate why it drifted."),
                    priority="P1")
                logger.warning("cash drift tripwire fired: %s %.2f%%", label, frac * 100)
    except Exception:  # noqa: BLE001
        logger.exception("cash-drift tripwire failed (non-fatal)")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="MacroTilt paper-portfolio nightly runner.")
    p.add_argument("--phase", choices=["eod", "open", "close", "intraday", "all"], default="eod",
                   help="eod=order intent (pre-open submit window); "
                        "open=morning fills mirror + close-price certification (09:45 ET); "
                        "close=official-close positions + NAV snapshot (16:50 ET) — "
                        "the daily record the page displays; all=eod+close.")
    p.add_argument("--account", help="paper account_number override")
    p.add_argument("--scan-date", help="explicit scanner scan_date (YYYY-MM-DD)")
    p.add_argument("--dry-run", action="store_true",
                   help="compute and log; no Supabase writes, no Alpaca submission")
    p.add_argument("--force-live", action="store_true",
                   help="OVERRIDE the PAPER_LIVE_TRADING_ENABLED env-var guard. "
                        "Required to fire live orders from a workflow_dispatch run.")
    args = p.parse_args(argv)

    # Intraday is a READ/mirror phase (live positions + live NAV) — it never
    # submits orders, so it routes around the live-trading kill-switch and
    # honours only --dry-run.
    if args.phase == "intraday":
        run_intraday(dry_run=args.dry_run)
        logger.info("runner done — phase=intraday dry_run=%s", args.dry_run)
        return 0

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
            scan_date=args.scan_date,
            dry_run=effective_dry_run,
        )
    if args.phase == "open":
        run_open_phase(dry_run=effective_dry_run)
    if args.phase in ("close", "all"):
        run_close_phase(dry_run=effective_dry_run)
    logger.info("runner done — phase=%s dry_run=%s", args.phase, effective_dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
