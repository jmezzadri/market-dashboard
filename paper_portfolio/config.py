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

# Sleeve B per-name sizing by tier on the normalized 0–10 scale.
# Tier 1 (9–10) → $50,000; Tier 2 (7–<9) → $40,000; Tier 3 (5–<7) → $30,000.
SLEEVE_B_TIER_BANDS = [
    ("tier1", 9.0, 10.01, 50_000.0),  # half-open [9, 10.01) — captures any score == 10
    ("tier2", 7.0,  9.0,  40_000.0),  # [7, 9)
    ("tier3", 5.0,  7.0,  30_000.0),  # [5, 7)
]

# Tolerance band for Sleeve A — only rebalance an IG ETF if the dollar diff
# is large enough to be worth a round-trip. Two checks; OR.
SLEEVE_A_REBALANCE_DOLLAR_MIN = 250.0     # min absolute notional diff
SLEEVE_A_REBALANCE_PCT_MIN    = 0.005     # 0.5 % of sleeve A capital

# Sleeve B per-name tolerance — same shape.
SLEEVE_B_REBALANCE_DOLLAR_MIN = 250.0
SLEEVE_B_REBALANCE_PCT_MIN    = 0.005

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
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"query": sql},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


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
