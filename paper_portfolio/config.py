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
SLEEVE_B_BUY_THRESHOLD = 4.0   # buy at score >= 4 (MAX is 5). 4 = high-conviction insider (insider_pts=4) not in a downtrend; recalibrated 2026-07-08 when the ceiling dropped 10->5 (dark-pool/options shelved).
SLEEVE_B_EXIT_THRESHOLD = 3.0  # HYSTERESIS (2026-07-07): buy>=5, but HOLD until score<3 — stops flap-churn

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


# ── Sizing discipline (2026-07-21, Joe directive; Senior Quant sign-off) ──
# Size each rebalance off the sleeve's LIVE NAV, not the fixed allocation,
# with a small cash buffer so overnight gap-ups cannot overdraw cash (no
# unintended margin). Because sizing re-anchors to NAV every rebalance, the
# buffer is self-correcting and cash cannot build over time.
SIZING_CASH_BUFFER_PCT = 0.01      # deploy 99% of live sleeve NAV
CASH_DRIFT_ALERT_PCT = 0.02        # |sleeve cash| > 2% of NAV files a P1 bug
SIZING_NAV_SANITY_BAND = (0.5, 1.5)  # NAV outside band vs allocation -> fall back

SLEEVE_B_REBALANCE_DOLLAR_MIN = 500.0
SLEEVE_B_REBALANCE_PCT_MIN    = 0.03

# Order type defaults — never changed in v1.
ORDER_TYPE_DEFAULT = "market_on_open"

# ─────────────────────────────────────────────────────────────────────────────
# EQUAL-WEIGHT / FULL-CAPITAL rebuild 2026-07-15 (Joe decision).
# The old "$100K fixed per name, max 5" was mathematically impossible against
# the $500K sleeve on a typical day (~8–10 qualifying names, max seen 17).
# New rule: always deploy 100% of the sleeve; per-name = capital ÷ N where
# N = qualifying names (enter ≥4, held ≥3). 1 name → $500K; 17 → ~$29K each.
# No leverage; long-only; resize decisions live in diff.py behind the band.
# ─────────────────────────────────────────────────────────────────────────────
SLEEVE_B_USE_LEVERAGE   = False       # no borrowing, ever
SLEEVE_B_MIN_HOLD_DAYS  = 21          # documented target hold; hysteresis enforces the spirit in diff.py

# Sleeve M (Momentum / Power Trend, 2026-07-15 swap): the producer caps the
# monthly list at 15 names; sizing divides by max(N, 8) so fewer than 8
# qualifying names leaves the unfilled slots in cash (diversification floor).
SLEEVE_M_MIN_NAMES_FLOOR = 8
SLEEVE_M_MAX_NAMES       = 15


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
    sleeve_m_allocation: float = 0.0  # Momentum sleeve capital (0 = sleeve dark)

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
            "sleeve_b_allocation, max_leverage_sleeve_b, status, "
            "coalesce(sleeve_m_allocation, 0) as sleeve_m_allocation "
            "from public.paper_accounts "
            f"where account_number = '{account_number}' "
            "limit 1;"
        )
    else:
        sql = (
            "select account_number, broker, starting_capital, sleeve_a_allocation, "
            "sleeve_b_allocation, max_leverage_sleeve_b, status, "
            "coalesce(sleeve_m_allocation, 0) as sleeve_m_allocation "
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
        sleeve_m_allocation=float(r.get("sleeve_m_allocation") or 0),
    )
