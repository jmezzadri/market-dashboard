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

    # 4 — sleeve B (Equity Scanner) — the only sleeve
    sleeve_b = build_sleeve_b_target(
        scanner, cfg.sleeve_b_allocation,
        max_leverage=cfg.max_leverage_sleeve_b,
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

    intents = build_order_intents(
        sleeve_b, live_positions,
        held_scores=scanner.scores_by_ticker,   # hysteresis: keep held names still on the scan
        alpaca=alpaca,
        suppress_buys=suppress_buys,
        eod_prices=eod_prices,
        open_order_tickers=open_order_tickers,
    )
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

