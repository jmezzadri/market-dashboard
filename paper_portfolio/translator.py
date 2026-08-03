"""
paper_portfolio.translator — top-level orchestrator.

Run this module to translate the current Equity Scanner state
into a list of OrderIntent rows and persist them as paper_orders (status
='pending') plus one paper_signal_capture row.

  python -m paper_portfolio.translator                  # full run
  python -m paper_portfolio.translator --dry-run        # compute & log, no DB writes
  python -m paper_portfolio.translator --account PA3ENEE9XT8L
  python -m paper_portfolio.translator --scan-date 2026-05-22

Phase 2 contract: NO Alpaca order submission. Phase 4 wires that.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import asdict, dataclass

from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.audit import (
    build_audit_payload,
    write_order_intents,
    write_signal_capture,
)
from paper_portfolio.config import load_active_paper_account
from paper_portfolio.diff import OrderIntent, build_order_intents
from paper_portfolio.signals import (
    load_equity_scanner_snapshot,
    load_eod_price_map,
)
from paper_portfolio.sleeves import (
    SleeveTarget,
    build_momentum_target,
    build_sleeve_b_target,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("paper_translator")


@dataclass
class TranslatorResult:
    sleeve_b_target: SleeveTarget
    intents: list[OrderIntent]
    sleeve_m_target: SleeveTarget | None = None
    momentum_action: str = ""      # '' = sleeve dark; else the trigger reason or 'hold'
    signal_capture_id: str | None = None
    orders_written: int = 0
    dry_run: bool = False
    scanner_scan_date: str = ""      # stock-sleeve signal date (for freshness gate)


def run(
    account_number: str | None = None,
    scan_date: str | None = None,
    dry_run: bool = False,
    use_live_prices: bool = True,
    suppress_buys: bool = False,
) -> TranslatorResult:
    """Execute one full translator cycle.

    Steps:
      1. Read paper_accounts config row.
      2. Pull live Alpaca positions.
      3. Read latest scanner scan (or named scan_date).
      4. Build the Sleeve B (Equity Scanner) target.
      5. Diff target vs live → OrderIntent list (incl. exits for every held
         name not in the target — covers the retired Sleeve-A ETFs).
      6. Write paper_signal_capture row.
      7. Write paper_orders rows (status='pending').
    """
    # 1 — config
    cfg = load_active_paper_account(account_number)
    logger.info(
        "loaded paper account %s — sleeve B=$%s, max leverage=%sx "
        "(Sleeve A retired 2026-06-23 — Equity Scanner only)",
        cfg.account_number, f"{cfg.sleeve_b_allocation:,.0f}",
        cfg.max_leverage_sleeve_b,
    )

    # 2 — live Alpaca state
    alpaca: AlpacaPaperClient | None
    if use_live_prices or not dry_run:
        alpaca = AlpacaPaperClient()
        live_positions = alpaca.get_positions()
        logger.info("alpaca live positions: %d", len(live_positions))
    else:
        alpaca = None
        live_positions = []
        logger.info("dry-run with live_prices=False — using empty Alpaca state")

    # Open orders working at the broker. A ticker with a live (unfilled) order
    # must not get a second order this run — this is what stops the EOD job's
    # many morning fires from stacking the same name 6x (2026-06-04 fix).
    open_order_tickers: set[str] = set()
    if alpaca is not None:
        try:
            _open = alpaca.list_orders(status="open", limit=500)
            open_order_tickers = {o.get("symbol", "").upper() for o in _open if o.get("symbol")}
            logger.info("alpaca open orders: %d (tickers: %s)",
                        len(_open), ", ".join(sorted(open_order_tickers)) or "none")
        except Exception as exc:  # never crash the run on this read
            logger.warning("could not list open orders (%s) — proceeding without open-order guard", exc)

    # 3 — Equity Scanner
    scanner = load_equity_scanner_snapshot(scan_date=scan_date)
    logger.info(
        "scanner scan_date=%s — %d qualifying buy signals (of %d total rows)",
        scanner.scan_date, len(scanner.signals), scanner.all_count,
    )

    # 4 — sleeve B (Insider Conviction), equal-weight full-capital.
    # The Momentum sleeve's share map is needed FIRST so held-name counting
    # excludes shares that belong to sleeve M (overlap = intended double
    # position, each sleeve reasons only about its own shares).
    from paper_portfolio import momentum as momentum_mod
    sleeve_m_held: dict[str, float] = {}
    try:
        sleeve_m_held = momentum_mod.load_sleeve_m_holdings()
    except Exception as exc:  # noqa: BLE001 — missing map must not stop the sleeve
        logger.warning("sleeve-M holdings map unavailable (%s) — assuming none", exc)

    held_b_tickers = {
        p.ticker.upper() for p in live_positions
        if (p.qty - sleeve_m_held.get(p.ticker.upper(), 0.0)) > 0.0001
    }
    sleeve_b = build_sleeve_b_target(
        scanner, _sleeve_sizing_capital(cfg.sleeve_b_allocation, "sleeve_b_nav"),
        held_tickers=held_b_tickers,
    )
    logger.info(
        "sleeve B: gross $%s, leverage used $%s (%.2fx), idle $%s, %d lines",
        f"{sleeve_b.gross_long:,.0f}",
        f"{sleeve_b.leverage_used:,.0f}", sleeve_b.leverage_ratio,
        f"{sleeve_b.idle_cash:,.0f}", len(sleeve_b.lines),
    )

    # 5 — diff (signal-only). Load the EOD price map (gold source) for every
    # ticker we either hold or target, so share sizing uses prices_eod, never
    # Alpaca. Alpaca supplies only held qty + cost basis inside the engine.
    price_tickers = (
        [l.ticker for l in sleeve_b.lines]
        + [p.ticker for p in live_positions]
    )
    try:
        eod_prices = load_eod_price_map(price_tickers)
        logger.info("loaded %d EOD prices (gold source) for sizing", len(eod_prices))
    except Exception as exc:
        logger.warning("EOD price map load failed (%s) — sizing falls back per-ticker", exc)
        eod_prices = {}

    # ── Momentum sleeve — POWER TREND signal (2026-07-15 swap) ──
    # Runs only when MOMENTUM_SLEEVE_ENABLED='true' AND the account has
    # momentum capital assigned. Target recomputes ONLY on a new monthly
    # publish; every other day it emits nothing.
    sleeve_m = None
    momentum_action = ""
    m_intents: list[OrderIntent] = []
    if momentum_mod.momentum_enabled() and cfg.sleeve_m_allocation > 0:
        try:
            m_snap = momentum_mod.load_momentum_snapshot()
            # Publish staleness: a monthly list older than ~40 days means the
            # producer has missed a publish — do not keep trading it silently.
            from datetime import date as _date
            _pub = _date.fromisoformat(m_snap.rebalance_date)
            _scan = _date.fromisoformat(scanner.scan_date)
            if (_scan - _pub).days > 40:
                raise RuntimeError(
                    f"power_trend_list publish {m_snap.rebalance_date} is more than "
                    f"40 days behind the scanner session {scanner.scan_date} — "
                    "the monthly producer looks dead; momentum skipped this run.")
            trigger = momentum_mod.load_last_trigger_state()
            fire, why = trigger.differs_from(m_snap)
            sleeve_m = build_momentum_target(
                m_snap, _sleeve_sizing_capital(cfg.sleeve_m_allocation, "sleeve_m_nav"))
            if fire:
                momentum_action = why
                m_prices = load_eod_price_map(
                    sorted({l.ticker for l in sleeve_m.lines} | set(sleeve_m_held)))
                m_intents = momentum_mod.build_momentum_intents(
                    sleeve_m, sleeve_m_held, m_prices)
                logger.info("momentum FIRED (%s): %d intents, %d lines, idle $%s",
                            why, len(m_intents), len(sleeve_m.lines),
                            f"{sleeve_m.idle_cash:,.0f}")
                # CASH-CONSERVATION CONSTRAINT (2026-08-03 incident). Sizing
                # is anchored to NAV; the overnight execution exposure scales
                # with TURNOVER. Cap the buy book at the cash the sleeve will
                # actually have. Sizing only — this cannot create an intent.
                m_intents, m_guard = _guard_sleeve_cash(m_intents, "M", m_prices)
                if m_guard.get("aborted"):
                    momentum_action += " — buy orders held back to protect cash"
                elif m_guard.get("scale_factor", 1.0) < 1.0:
                    momentum_action += (
                        f" — buys trimmed ${m_guard['dollars_trimmed']:,.0f} "
                        f"to stay inside the sleeve's cash")
                if not dry_run:
                    write_signal_capture(
                        signal_source="momentum",
                        signal_payload={
                            "rebalance_date": m_snap.rebalance_date,
                            "signal": "power_trend",
                            "all_cash": m_snap.all_cash,
                            "list_size": len(m_snap.entries),
                            "trigger": why,
                            "cash_guard": m_guard,
                        },
                        # Written AFTER the guard so the watchdog's
                        # expected-vs-actual check (LESSON 8.20) compares
                        # against the orders that are really submitted.
                        triggered_orders_count=len(m_intents),
                    )
            else:
                # No new publish — run the DAILY TREND-BREAK stop (Joe decision
                # 2026-07-15, backtested): sell any held name that closed below
                # all four EMAs; cash rests until the next monthly publish.
                # Publish days skip this — a broken name can't be on the new
                # list (the list requires price above all four EMAs), so the
                # monthly diff already sells it.
                m_breaks = momentum_mod.load_trend_breaks(sorted(sleeve_m_held))
                if m_breaks:
                    momentum_action = "trend-break exit: " + ", ".join(sorted(m_breaks))
                    b_prices = load_eod_price_map(sorted(m_breaks))
                    m_intents = momentum_mod.build_trend_break_intents(
                        m_breaks, sleeve_m_held, b_prices)
                    logger.info("momentum TREND BREAK — selling %s (publish %s unchanged)",
                                ", ".join(sorted(m_breaks)), m_snap.rebalance_date)
                    if not dry_run:
                        write_signal_capture(
                            signal_source="momentum",
                            signal_payload={
                                # SAME rebalance_date — the monthly trigger state
                                # must not change on a stop-out day.
                                "rebalance_date": m_snap.rebalance_date,
                                "signal": "power_trend",
                                "trigger": "trend_break",
                                "sold": sorted(m_breaks),
                            },
                            triggered_orders_count=len(m_intents),
                        )
                else:
                    momentum_action = "hold"
                    logger.info("momentum HOLD — %s (publish %s, %d names)",
                                why, m_snap.rebalance_date, len(m_snap.entries))
        except Exception as exc:  # noqa: BLE001 — momentum must never break the scanner sleeve
            momentum_action = f"skipped: {exc}"
            logger.warning("momentum sleeve skipped this run — %s", exc)
            try:
                if not dry_run:
                    from paper_portfolio.freshness import file_alert
                    file_alert(
                        title="Momentum sleeve skipped — data problem",
                        description=(
                            "The Momentum sleeve could not run this morning and was "
                            f"skipped (the Insider Conviction sleeve ran normally). Reason: {exc}. "
                            "The sleeve holds its prior positions until the data recovers."),
                        priority="P1",
                    )
            except Exception:  # noqa: BLE001
                logger.warning("momentum skip alert failed to file")

    intents = build_order_intents(
        sleeve_b, live_positions,
        held_scores=scanner.scores_by_ticker,   # hysteresis: keep held names still on the scan
        alpaca=alpaca,
        suppress_buys=suppress_buys,
        eod_prices=eod_prices,
        open_order_tickers=open_order_tickers,
        sleeve_m_qty=sleeve_m_held,   # scanner never touches Momentum's shares
    )
    # Same cash-conservation constraint on the scanner sleeve: it carries the
    # identical exposure (whole-share counts fixed at the prior close, filled
    # at the next open) and is equally specified long-only, no leverage.
    intents, _b_guard = _guard_sleeve_cash(intents, "B", eod_prices)
    intents = intents + [i for i in m_intents
                         if not (i.ticker.upper() in open_order_tickers)]
    logger.info("diff produced %d order intents", len(intents))

    # 6 + 7 — write
    capture_id: str | None = None
    orders_written = 0
    if not dry_run:
        payload = build_audit_payload(
            scanner=scanner,
            sleeve_b_summary={
                "capital_assigned": sleeve_b.capital_assigned,
                "gross_long": sleeve_b.gross_long,
                "idle_cash": sleeve_b.idle_cash,
                "leverage_used": sleeve_b.leverage_used,
                "leverage_ratio": sleeve_b.leverage_ratio,
                "lines_count": len(sleeve_b.lines),
            },
        )
        # One capture row for the equity_scanner signal source.
        capture_id = write_signal_capture(
            signal_source="equity_scanner",
            signal_payload=payload,
            triggered_orders_count=sum(1 for i in intents if i.signal_source == "equity_scanner"),
        )
        orders_written = write_order_intents(intents)
        logger.info(
            "wrote signal capture %s and %d paper_orders rows (status=pending)",
            capture_id, orders_written,
        )
    else:
        logger.info("dry-run — no DB writes")

    return TranslatorResult(
        sleeve_b_target=sleeve_b,
        intents=intents,
        signal_capture_id=capture_id,
        orders_written=orders_written,
        dry_run=dry_run,
        scanner_scan_date=scanner.scan_date,
        sleeve_m_target=sleeve_m,
        momentum_action=momentum_action,
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="MacroTilt paper-portfolio translator.")
    p.add_argument("--account", help="account_number override")
    p.add_argument("--scan-date", help="explicit scanner scan_date (YYYY-MM-DD)")
    p.add_argument("--dry-run", action="store_true",
                   help="compute everything; do not write to Supabase")
    p.add_argument("--print-intents", action="store_true",
                   help="dump OrderIntent list as JSON to stdout")
    args = p.parse_args(argv)

    res = run(
        account_number=args.account,
        scan_date=args.scan_date,
        dry_run=args.dry_run,
    )

    if args.print_intents:
        print(json.dumps([asdict(i) for i in res.intents], indent=2, default=str))

    print(
        f"DONE — sleeve B lines: {len(res.sleeve_b_target.lines)}, "
        f"order intents: {len(res.intents)}, "
        f"dry_run={res.dry_run}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())


def _guard_sleeve_cash(
    intents: list[OrderIntent],
    sleeve: str,
    eod_prices: dict[str, float],
) -> tuple[list[OrderIntent], dict]:
    """Apply the cash-conservation constraint to one sleeve's intents.

    SIZING ONLY. It can shrink or drop buys; it can never add an order and
    never decides whether a rebalance happens. With no buy intents it is a
    no-op, so on the ~95% of mornings that produce no trades nothing changes.

    On the hard-invariant abort the buy book is dropped, the SELLS are kept
    (they raise cash — they are the repair, not the cause) and a P1 bug is
    filed so a sleeve that cannot fund itself is never silent.
    """
    from paper_portfolio.cash_guard import (
        CashConservationError,
        apply_cash_conservation,
        load_sleeve_cash,
    )
    if not intents:
        return intents, {}
    cash = load_sleeve_cash(sleeve)
    try:
        kept, res = apply_cash_conservation(
            intents, sleeve=sleeve, sleeve_cash=cash, eod_prices=eod_prices)
        return kept, res.as_payload()
    except CashConservationError as exc:
        # The full arithmetic goes to the RUN LOG. The alert Joe reads is
        # plain English with no internal names (LESSON 0.4).
        logger.error("sleeve %s buy book aborted by the cash guard: %s", sleeve, exc)
        name = "Momentum" if sleeve == "M" else "Insider Conviction"
        r = exc.result
        try:
            from paper_portfolio.freshness import file_alert
            detail = ""
            if r is not None:
                detail = (
                    f"The sleeve was holding ${r.starting_cash:,.0f} in cash and its "
                    f"sales were expected to bring in about ${r.expected_proceeds:,.0f}, "
                    f"against ${r.buy_notional_requested:,.0f} of buying. ")
            file_alert(
                title=f"Paper {name} sleeve — buy orders held back to protect cash",
                description=(
                    f"This morning's buy orders for the {name} sleeve were not placed. "
                    + detail +
                    "There was not enough cash to pay for them without borrowing, and "
                    "this sleeve is not allowed to borrow. The sell orders still went "
                    "ahead, which puts cash back in, and the sleeve keeps everything "
                    "else it already owns. Nothing needs to be done before the market "
                    "opens; the next rebalance will size itself against the cash that "
                    "is actually there."),
                priority="P1")
        except Exception:  # noqa: BLE001 — alerting must not break the run
            logger.warning("cash-guard abort alert failed to file")
        payload = exc.result.as_payload() if exc.result else {}
        payload["aborted"] = True
        return exc.sell_intents, payload


def _sleeve_sizing_capital(allocation: float, nav_col: str) -> float:
    """Dollar base for sleeve sizing (2026-07-21, Joe directive; Senior Quant
    sign-off). Uses the sleeve's latest daily NAV — holdings plus cash,
    including negative cash — times (1 - SIZING_CASH_BUFFER_PCT), instead of
    the fixed allocation. Two properties Joe asked for:
      1. No unintended margin: sizing 1% under NAV absorbs normal overnight
         gap-ups, so buys can no longer overdraw the sleeve's cash.
      2. Self-correcting, no cash build-up: every rebalance re-anchors to
         that day's NAV, so gap-down surplus cash is redeployed at the next
         re-split rather than accumulating.
    Falls back to the fixed allocation when the NAV row is missing (inception
    day) or fails a sanity band vs the allocation (blast-radius guard: a bad
    NAV read must not size a 2x order book)."""
    from paper_portfolio._sbq import sb_query
    from paper_portfolio.config import SIZING_CASH_BUFFER_PCT, SIZING_NAV_SANITY_BAND
    base = float(allocation)
    try:
        rows = sb_query(
            f"select {nav_col} as nav from public.paper_nav_daily "
            "order by snapshot_date desc limit 1;")
        nav = float(rows[0]["nav"]) if rows and rows[0].get("nav") is not None else 0.0
        lo, hi = SIZING_NAV_SANITY_BAND
        if allocation * lo <= nav <= allocation * hi:
            base = nav
        else:
            logger.warning(
                "sleeve NAV %s=%.2f outside sanity band [%.0f, %.0f] — sizing "
                "falls back to fixed allocation %.0f",
                nav_col, nav, allocation * lo, allocation * hi, allocation)
    except Exception as exc:  # noqa: BLE001 — sizing must never crash the run
        logger.warning("could not read %s for sizing (%s) — using fixed allocation", nav_col, exc)
    capital = round(base * (1.0 - SIZING_CASH_BUFFER_PCT), 2)
    logger.info("sizing capital for %s: $%.2f (base $%.2f, buffer %.1f%%)",
                nav_col, capital, base, SIZING_CASH_BUFFER_PCT * 100)
    return capital
