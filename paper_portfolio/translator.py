"""
paper_portfolio.translator — top-level orchestrator.

Run this module to translate the current Asset Tilt + Equity Scanner state
into a list of OrderIntent rows and persist them as paper_orders (status
='pending') plus one paper_signal_capture row.

  python -m paper_portfolio.translator                  # full run
  python -m paper_portfolio.translator --dry-run        # compute & log, no DB writes
  python -m paper_portfolio.translator --account PA3ENEE9XT8L
  python -m paper_portfolio.translator --asset-tilt-path public/v10_allocation.json
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
    load_asset_tilt_snapshot,
    load_equity_scanner_snapshot,
)
from paper_portfolio.sleeves import (
    SleeveTarget,
    build_sleeve_a_target,
    build_sleeve_b_target,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("paper_translator")


@dataclass
class TranslatorResult:
    sleeve_a_target: SleeveTarget
    sleeve_b_target: SleeveTarget
    intents: list[OrderIntent]
    signal_capture_id: str | None = None
    orders_written: int = 0
    dry_run: bool = False


def run(
    account_number: str | None = None,
    asset_tilt_path: str = "public/v10_allocation.json",
    scan_date: str | None = None,
    dry_run: bool = False,
    use_live_prices: bool = True,
    suppress_buys: bool = False,
) -> TranslatorResult:
    """Execute one full translator cycle.

    Steps (mapped to the Phase 2 spec):
      1. Read paper_accounts config row.
      2. Pull live Alpaca positions.
      3. Read Asset Tilt v10_allocation.json snapshot.
      4. Read latest signal_intel_v5_daily scan (or named scan_date).
      5. Build Sleeve A + Sleeve B targets.
      6. Diff target vs live → OrderIntent list.
      7. Write paper_signal_capture rows (one per signal source).
      8. Write paper_orders rows (status='pending').
    """
    # 1 — config
    cfg = load_active_paper_account(account_number)
    logger.info(
        "loaded paper account %s — sleeve A=$%s, B=$%s, max leverage=%sx",
        cfg.account_number, f"{cfg.sleeve_a_allocation:,.0f}",
        f"{cfg.sleeve_b_allocation:,.0f}", cfg.max_leverage_sleeve_b,
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

    # 3 — Asset Tilt
    asset_tilt = load_asset_tilt_snapshot(asset_tilt_path)
    logger.info(
        "asset tilt v%s as of %s — %d IGs, equity_pct=%.2f",
        asset_tilt.engine_version, asset_tilt.as_of,
        len(asset_tilt.industry_groups), asset_tilt.equity_pct,
    )

    # 4 — Equity Scanner
    scanner = load_equity_scanner_snapshot(scan_date=scan_date)
    logger.info(
        "scanner scan_date=%s — %d qualifying buy signals (of %d total rows)",
        scanner.scan_date, len(scanner.signals), scanner.all_count,
    )

    # 5 — sleeves
    sleeve_a = build_sleeve_a_target(asset_tilt, cfg.sleeve_a_allocation)
    sleeve_b = build_sleeve_b_target(
        scanner, cfg.sleeve_b_allocation,
        max_leverage=cfg.max_leverage_sleeve_b,
    )
    logger.info(
        "sleeve A: gross $%s, idle $%s, %d lines",
        f"{sleeve_a.gross_long:,.0f}",
        f"{sleeve_a.idle_cash:,.0f}", len(sleeve_a.lines),
    )
    logger.info(
        "sleeve B: gross $%s, leverage used $%s (%.2fx), idle $%s, %d lines",
        f"{sleeve_b.gross_long:,.0f}",
        f"{sleeve_b.leverage_used:,.0f}", sleeve_b.leverage_ratio,
        f"{sleeve_b.idle_cash:,.0f}", len(sleeve_b.lines),
    )

    # 6 — diff
    intents = build_order_intents(
        sleeve_a, sleeve_b, live_positions,
        alpaca=alpaca, asset_tilt_snapshot=asset_tilt,
        suppress_buys=suppress_buys,
    )
    logger.info("diff produced %d order intents", len(intents))

    # 7 + 8 — write
    capture_id: str | None = None
    orders_written = 0
    if not dry_run:
        payload = build_audit_payload(
            asset_tilt=asset_tilt,
            scanner=scanner,
            sleeve_a_summary={
                "capital_assigned": sleeve_a.capital_assigned,
                "gross_long": sleeve_a.gross_long,
                "idle_cash": sleeve_a.idle_cash,
                "leverage_used": sleeve_a.leverage_used,
                "lines_count": len(sleeve_a.lines),
            },
            sleeve_b_summary={
                "capital_assigned": sleeve_b.capital_assigned,
                "gross_long": sleeve_b.gross_long,
                "idle_cash": sleeve_b.idle_cash,
                "leverage_used": sleeve_b.leverage_used,
                "leverage_ratio": sleeve_b.leverage_ratio,
                "lines_count": len(sleeve_b.lines),
            },
        )
        # Per spec, one capture row per signal source. We persist one
        # row for asset_tilt and one for equity_scanner, each carrying
        # the full audit payload — easier replay than splitting.
        capture_id = write_signal_capture(
            signal_source="asset_tilt",
            signal_payload=payload,
            triggered_orders_count=sum(1 for i in intents if i.signal_source == "asset_tilt"),
        )
        write_signal_capture(
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
        sleeve_a_target=sleeve_a,
        sleeve_b_target=sleeve_b,
        intents=intents,
        signal_capture_id=capture_id,
        orders_written=orders_written,
        dry_run=dry_run,
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="MacroTilt paper-portfolio translator.")
    p.add_argument("--account", help="account_number override")
    p.add_argument("--asset-tilt-path", default="public/v10_allocation.json")
    p.add_argument("--scan-date", help="explicit scanner scan_date (YYYY-MM-DD)")
    p.add_argument("--dry-run", action="store_true",
                   help="compute everything; do not write to Supabase")
    p.add_argument("--print-intents", action="store_true",
                   help="dump OrderIntent list as JSON to stdout")
    args = p.parse_args(argv)

    res = run(
        account_number=args.account,
        asset_tilt_path=args.asset_tilt_path,
        scan_date=args.scan_date,
        dry_run=args.dry_run,
    )

    if args.print_intents:
        print(json.dumps([asdict(i) for i in res.intents], indent=2, default=str))

    print(
        f"DONE — sleeve A lines: {len(res.sleeve_a_target.lines)}, "
        f"sleeve B lines: {len(res.sleeve_b_target.lines)}, "
        f"order intents: {len(res.intents)}, "
        f"dry_run={res.dry_run}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
