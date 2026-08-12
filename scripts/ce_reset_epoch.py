"""
scripts/ce_reset_epoch.py — Conviction Events epoch reset (cutover one-shot).

Modeled on the 2026-06-23 book reset (Sleeve A retirement: wipe the paper
book, re-anchor the inception, rewrite paper_accounts allocations). Run by
the lead at the Conviction Events cutover, AFTER migration 094 is applied.

What a live run does, in order:
  1. WIPES the paper bookkeeping tables (the retired two-sleeve history):
       paper_fills, paper_orders, paper_positions, paper_nav_daily,
       paper_signal_capture, paper_intraday_positions, paper_intraday_nav
     plus ce_events (a fresh epoch has no open Conviction positions — stale
     'entered' rows would occupy phantom slots). There is no kill-switch row
     to reset: the book-level alarm and its ce_kill_switch table were retired
     2026-08-12 (risk is the per-position 15% stop).
  2. SEEDS one inception paper_nav_daily row, dated the last completed
     trading session, at the account's CURRENT equity (Alpaca), with zero
     positions and the current SPY anchors (close / prev / inception / TTM
     all anchored to the same official close from prices_eod, so day-one
     book-vs-SPY reads 0). QQQ/DIA/IWM benchmark closes are seeded the same
     way so the Performance card's benchmark rows are real on day one.
  3. UPDATES paper_accounts allocations: the whole account is the Conviction
     book in the Sleeve B slot — sleeve_a_allocation = 0,
     sleeve_b_allocation = current equity, sleeve_m_allocation = 0 (no
     sleeve-M trades ever). mirror/intraday derive their sleeve cash bases
     from these allocations, so the NAV accounting re-anchors automatically.

SAFETY: the default run is a DRY RUN (prints row counts + the exact seed and
update statements, writes nothing). A live run requires --execute. --dry-run
is also accepted explicitly and always wins over --execute.

Usage:
  python -m scripts.ce_reset_epoch              # dry run (default)
  python -m scripts.ce_reset_epoch --dry-run    # dry run, explicit
  python -m scripts.ce_reset_epoch --execute    # LIVE — wipes and reseeds
"""

from __future__ import annotations

import argparse
import logging
import sys

from paper_portfolio.alpaca_client import AlpacaPaperClient
from paper_portfolio.mirror import _supabase_exec, _supabase_query

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ce_reset_epoch")

# Wipe order respects the FK: paper_fills references paper_orders
# (ON DELETE CASCADE would cover it, but the explicit order is self-evident).
WIPE_TABLES = [
    "paper_fills",
    "paper_orders",
    "paper_positions",
    "paper_nav_daily",
    "paper_signal_capture",
    "paper_intraday_positions",
    "paper_intraday_nav",
    "ce_events",
]

BENCH = ("SPY", "QQQ", "DIA", "IWM")


def _latest_close(ticker: str) -> tuple[str | None, float | None, float | None]:
    """(trade_date, close, prev_close) for the latest completed session in
    prices_eod — the site's canonical price source (LESSONS 8.6)."""
    rows = _supabase_query(
        "select trade_date::text as d, close from public.prices_eod "
        f"where ticker = '{ticker}' order by trade_date desc limit 2;")
    if not rows:
        return None, None, None
    d = rows[0]["d"]
    close = float(rows[0]["close"])
    prev = float(rows[1]["close"]) if len(rows) > 1 else None
    return d, close, prev


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Conviction Events epoch reset (one-shot).")
    p.add_argument("--dry-run", action="store_true",
                   help="print what would happen; write nothing (DEFAULT behavior)")
    p.add_argument("--execute", action="store_true",
                   help="actually wipe + reseed (required for a live run)")
    args = p.parse_args(argv)
    dry_run = args.dry_run or not args.execute
    if dry_run:
        logger.info("DRY RUN — nothing will be written (pass --execute for a live run)")

    # ── current account equity (the new book's inception value) ────────────
    alpaca = AlpacaPaperClient()
    account = alpaca.get_account()
    equity = float(account.equity)
    logger.info("Alpaca paper account %s — current equity $%s",
                account.account_number, f"{equity:,.2f}")
    if equity <= 0:
        logger.error("account equity is not positive — refusing to seed")
        return 1
    open_positions = alpaca.get_positions()
    if open_positions:
        logger.warning(
            "broker still holds %d position(s): %s — the inception row seeds "
            "0 positions; liquidate (or reset the Alpaca paper account) "
            "BEFORE a live run so the book truly starts flat",
            len(open_positions), ", ".join(p.ticker for p in open_positions))
        if not dry_run:
            logger.error("refusing --execute while broker positions are open")
            return 1

    # ── benchmark anchors from prices_eod ──────────────────────────────────
    anchors: dict[str, tuple[str | None, float | None, float | None]] = {}
    for sym in BENCH:
        anchors[sym] = _latest_close(sym)
        d, c, prev = anchors[sym]
        logger.info("%s anchor: close %s on %s (prev %s)", sym, c, d, prev)
    spy_date, spy_close, spy_prev = anchors["SPY"]
    if not spy_date or not spy_close:
        logger.error("no SPY close in prices_eod — cannot anchor the inception row")
        return 1
    inception_date = spy_date   # the last completed session — same close the
    #                             equity anchor is measured against, no look-ahead

    # ── 1) wipe ────────────────────────────────────────────────────────────
    for t in WIPE_TABLES:
        try:
            rows = _supabase_query(f"select count(*)::int as n from public.{t};")
            n = rows[0]["n"] if rows else 0
        except Exception as exc:  # noqa: BLE001 — ce_events missing pre-migration
            logger.warning("could not count public.%s (%s) — is migration 094 applied?", t, exc)
            n = None
        if dry_run:
            logger.info("[dry-run] would wipe public.%s (%s rows)", t,
                        n if n is not None else "?")
        else:
            _supabase_exec(f"delete from public.{t};")
            logger.info("wiped public.%s (%s rows)", t, n if n is not None else "?")

    # No kill-switch row to reset — the book-level alarm and its table were
    # retired 2026-08-12. Resetting a dropped table would fail this script.

    # ── 2) seed the inception NAV row ──────────────────────────────────────
    def num(v):
        return "NULL" if v is None else repr(float(v))
    _, qqq_close, qqq_prev = anchors["QQQ"]
    _, dia_close, dia_prev = anchors["DIA"]
    _, iwm_close, iwm_prev = anchors["IWM"]
    seed_sql = (
        "insert into public.paper_nav_daily "
        "(snapshot_date, sleeve_a_cash, sleeve_a_equity, sleeve_a_nav, "
        " sleeve_b_cash, sleeve_b_equity, sleeve_b_margin_used, sleeve_b_nav, "
        " total_nav, benchmark_spy_value, spy_close, "
        " total_unrealized_pnl, total_realized_pnl, "
        " sleeve_a_unrealized_pnl, sleeve_b_unrealized_pnl, "
        " sleeve_a_realized_pnl, sleeve_b_realized_pnl, "
        " sleeve_a_positions, sleeve_b_positions, "
        " sleeve_a_value, sleeve_b_value, "
        " sleeve_m_cash, sleeve_m_equity, sleeve_m_nav, sleeve_m_value, "
        " sleeve_m_unrealized_pnl, sleeve_m_realized_pnl, sleeve_m_positions, "
        " spy_prev_close, spy_inception_close, spy_ttm_close, "
        " qqq_close, qqq_prev_close, qqq_inception_close, "
        " dia_close, dia_prev_close, dia_inception_close, "
        " iwm_close, iwm_prev_close, iwm_inception_close, created_at) values ("
        f"'{inception_date}', 0, 0, 0, "
        f"{equity!r}, 0, 0, {equity!r}, "
        f"{equity!r}, {num(spy_close * 100)}, {num(spy_close)}, "
        "0, 0, 0, 0, 0, 0, 0, 0, "
        f"0, {equity!r}, "
        "0, 0, 0, 0, 0, 0, 0, "
        f"{num(spy_prev)}, {num(spy_close)}, {num(spy_close)}, "
        f"{num(qqq_close)}, {num(qqq_prev)}, {num(qqq_close)}, "
        f"{num(dia_close)}, {num(dia_prev)}, {num(dia_close)}, "
        f"{num(iwm_close)}, {num(iwm_prev)}, {num(iwm_close)}, now());")
    if dry_run:
        logger.info("[dry-run] would seed inception NAV row (%s, $%s):\n%s",
                    inception_date, f"{equity:,.2f}", seed_sql)
    else:
        _supabase_exec(seed_sql)
        logger.info("seeded inception paper_nav_daily row: %s at $%s, 0 positions",
                    inception_date, f"{equity:,.2f}")

    # ── 3) paper_accounts allocations (2026-06-23 reset model) ─────────────
    notes = (
        f"Conviction Events epoch — reset {inception_date}: one book in the "
        "Sleeve B slot (insider-buy events >= $250K, positions sized at 6.67% "
        "of current equity under a 1.5x gross-exposure limit, 20-trading-day "
        "holds, and a -15% per-position catastrophe stop selling at the next "
        "open — the only risk exit; there is no book-level alarm). "
        "Sleeves A and M retired; sleeve_m_allocation 0, no sleeve-M trades ever."
    ).replace("'", "''")
    acct_sql = (
        "update public.paper_accounts set "
        "sleeve_a_allocation = 0, "
        f"sleeve_b_allocation = {equity!r}, "
        "sleeve_m_allocation = 0, "
        f"notes = '{notes}', "
        "updated_at = now() "
        "where status = 'active';")
    if dry_run:
        logger.info("[dry-run] would update paper_accounts allocations:\n%s", acct_sql)
    else:
        _supabase_exec(acct_sql)
        logger.info("paper_accounts allocations updated: A=0, B=$%s, M=0",
                    f"{equity:,.2f}")

    logger.info("%s — Conviction Events epoch %s",
                "DRY RUN complete (nothing written)" if dry_run else "RESET COMPLETE",
                inception_date)
    return 0


if __name__ == "__main__":
    sys.exit(main())
