"""
paper_portfolio.config — paper-account configuration loader.

Reads the active paper_accounts row from Supabase (one row per Alpaca paper
account; seeded by migration 058). Single source of truth for sleeve caps
and leverage cap — never hard-code these inside the translator.

Sleeve B sizing tiers and the buy/exit thresholds are encoded here because
they are Senior Quant constants for v1 of the translator (not config-driven).
If/when a future Quant decision changes them, edit this file and the matching
unit tests in the same PR.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import requests

PROJECT_REF = "yqaqqzseepebrocgibcw"


# ─────────────────────────────────────────────────────────────────────────────
# Senior Quant constants — v1 paper translator
# ─────────────────────────────────────────────────────────────────────────────

# Buy / exit score cutoff on the normalized 0–10 buy-side scale.
# (See signals.py for the v5 mt_score → 0–10 normalization.)
SLEEVE_B_BUY_THRESHOLD = 5.0   # buy when normalized buy-score >= 5
SLEEVE_B_EXIT_THRESHOLD = 5.0  # exit when normalized buy-score < 5

# Sleeve B per-name sizing on the normalized 0–10 buy-score: notional = score
# × $10K, stepped by integer score (Joe directive 2026-06-23, replacing the old
# 3-tier $50K/$40K/$30K scheme). Score 5 → $100K, 6 → $120K, … 10 → $200K (Score × $20K).
# Bands are half-open [lo, hi); listed largest-first = fill priority order.
SLEEVE_B_TIER_BANDS = [
    ("s10", 10.0, 10.01, 200_000.0),  # [10, 10.01)
    ("s9",   9.0, 10.0,  180_000.0),  # [9, 10)
    ("s8",   8.0,  9.0,  160_000.0),  # [8, 9)
    ("s7",   7.0,  8.0,  140_000.0),  # [7, 8)
    ("s6",   6.0,  7.0,  120_000.0),  # [6, 7)
    ("s5",   5.0,  6.0,  100_000.0),  # [5, 6)
]

# Tolerance band — a holding only rebalances when it has drifted from its
# target by MORE than max(dollar floor, pct × the position's own target).
# Widened 2026-06-02 (Joe: "not so sensitive a $0.10 move triggers a
# rebalance"). pct is now measured against the POSITION's target (see
# diff._below_tolerance), so 3% of a $30K Sleeve-B name = ~$900 of drift
# before it trades; the $500 floor covers small Sleeve-A lines. Combined with
# prices pinned to the daily EOD close, intraday wiggle never triggers a trade
# and day-over-day only a real ~3%+ drift does.
SLEEVE_A_REBALANCE_DOLLAR_MIN = 500.0     # dollar floor (small lines)
SLEEVE_A_REBALANCE_PCT_MIN    = 0.03      # 3% of THIS position's target

SLEEVE_B_REBALANCE_DOLLAR_MIN = 500.0
SLEEVE_B_REBALANCE_PCT_MIN    = 0.03

# Order type defaults — never changed in v1.
ORDER_TYPE_DEFAULT = "market_on_open"


# ─────────────────────────────────────────────────────────────────────────────
# DB-backed config dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PaperAccountConfig:
    account_number: str
    broker: str
    starting_capital: float
    sleeve_a_allocation: float
    sleeve_b_allocation: float
    max_leverage_sleeve_b: float
    status: str

    @property
    def sleeve_b_max_gross(self) -> float:
        """Maximum gross long Sleeve B can hold, in dollars."""
        return self.sleeve_b_allocation * self.max_leverage_sleeve_b


def _supabase_query(sql: str) -> list[dict[str, Any]]:
    """Run a SQL query through the Supabase Management API.

    Reads SUPABASE_ACCESS_TOKEN from the environment. Raises if missing.
    """
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise RuntimeError(
            "SUPABASE_ACCESS_TOKEN is not set. The paper-portfolio translator "
            "needs read access to public.paper_accounts."
        )
    from paper_portfolio._sbq import sb_query
    return sb_query(sql, token)


def load_active_paper_account(account_number: str | None = None) -> PaperAccountConfig:
    """Load the active paper account config row from Supabase.

    If `account_number` is None, returns the single 'active' row. If multiple
    active rows exist (multi-account future), pass account_number explicitly.
    """
    if account_number is not None:
        sql = (
            "select account_number, broker, starting_capital, sleeve_a_allocation, "
            "sleeve_b_allocation, max_leverage_sleeve_b, status "
            "from public.paper_accounts "
            f"where account_number = '{account_number}' "
            "limit 1;"
        )
    else:
        sql = (
            "select account_number, broker, starting_capital, sleeve_a_allocation, "
            "sleeve_b_allocation, max_leverage_sleeve_b, status "
            "from public.paper_accounts where status = 'active' limit 1;"
        )
    rows = _supabase_query(sql)
    if not rows:
        raise RuntimeError(
            "No active paper_accounts row found. Run migration 058 first."
        )
    r = rows[0]
    return PaperAccountConfig(
        account_number=r["account_number"],
        broker=r["broker"],
        starting_capital=float(r["starting_capital"]),
        sleeve_a_allocation=float(r["sleeve_a_allocation"]),
        sleeve_b_allocation=float(r["sleeve_b_allocation"]),
        max_leverage_sleeve_b=float(r["max_leverage_sleeve_b"]),
        status=r["status"],
    )
