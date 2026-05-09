"""
Insider Signal — v2 Signal Intelligence engine.

Symmetric construction (range −100 to +100) per spec A1. Replaces v1's
asymmetric "log buys minus log sells, all sells full weight" with an
academically-grounded design:

  Buys                           → full weight
  Opportunistic sells            → 1/2 weight
  Cluster sells (3+ unique
    opportunistic officer sells) → full weight
  Routine trades                 → excluded entirely

Routine vs opportunistic per Cohen, Malloy, Pomorski (2012) "Decoding Inside
Information," Journal of Finance: an insider trade is **routine** if the same
insider has executed a same-direction trade in the same calendar month for 3+
consecutive years (e.g. a CEO whose Form 4s show December sales every year is
liquidating compensation, not signaling). Routine trades earn 0% abnormal
return; opportunistic trades earn 8–9% annualized — the asymmetry is the
single most important refinement available.

Officer multiplier (1.5×) applies on either side per Lakonishok & Lee (2001)
"Are Insider Trades Informative?," Review of Financial Studies — CEO/CFO
trades are higher-information than director trades.

The cluster-sell trigger restores full weight when 3+ unique officer-sellers
fire in the same window: a coordinated insider exit IS informative (this is
what got Enron, WorldCom, etc. flagged in retrospect).

Lookback window default 30 days. Phase D will back-test 30 / 60 / 90.

Range: −100 to +100. Returns None if no opportunistic activity (so the
Signal is excluded from the Magnitude rollup denominator — fixes v1's
"returns 0 dilutes the average" bug).
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Constants — tunable in Phase D back-test
# ─────────────────────────────────────────────────────────────────────────────

INSIDER_WINDOW_DAYS = 30           # Phase D will test 30 / 60 / 90
INSIDER_MIN_DOLLAR = 25_000        # Row floor — small trades excluded
OFFICER_MULTIPLIER = 1.5           # CEO/CFO weighted higher (Lakonishok-Lee)
OPPORTUNISTIC_SELL_WEIGHT = 0.5    # Sells weighted less than buys (literature)
CLUSTER_SELL_THRESHOLD = 3         # 3+ unique officer-sellers = coordinated exit
CLUSTER_BUY_THRESHOLD_HIGH = 5     # 5+ unique buyers = high cluster bonus
CLUSTER_BUY_THRESHOLD_LOW = 3      # 3+ unique buyers = low cluster bonus
CLUSTER_BONUS_HIGH = 15
CLUSTER_BONUS_LOW = 8
RAW_SCALE = 30                     # Multiplier converting log-scaled net to ±100
ROUTINE_LOOKBACK_YEARS = 3         # Same calendar month for 3+ years = routine


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _row_dollar(row: dict[str, Any]) -> float:
    """Notional dollar value of a Form 4 row: |shares| × price."""
    try:
        amount = float(row.get("amount", 0) or 0)
        price = float(row.get("stock_price", 0) or 0)
    except (TypeError, ValueError):
        return 0.0
    return abs(amount) * price


def _normalized_name(row: dict[str, Any]) -> str:
    """Lowercased, whitespace-stripped insider name for clustering counts."""
    return (row.get("owner_name") or "").strip().lower()


# ─────────────────────────────────────────────────────────────────────────────
# Routine vs opportunistic classifier (Cohen-Malloy-Pomorski 2012)
# ─────────────────────────────────────────────────────────────────────────────

def classify_routine(
    insider_id: str,
    transaction_date: datetime,
    history: list[dict[str, Any]],
) -> bool:
    """
    Return True if a trade is routine (same calendar month for 3+ prior years),
    False if opportunistic.

    Args:
        insider_id: Unique insider identifier (caller's responsibility — typically
            lowercase name + ticker, used for cache key plumbing only).
        transaction_date: When this trade was executed (timezone-aware datetime).
        history: List of this insider's PRIOR trades in the same direction
            (buy or sell), each dict carrying a "transaction_date" key.

    Returns:
        True if 3+ DISTINCT prior years have a same-month trade by this insider.
    """
    target_month = transaction_date.month
    target_year = transaction_date.year
    years_with_same_month_trade: set[int] = set()
    for h in history:
        h_date = h.get("transaction_date")
        if not isinstance(h_date, datetime):
            continue
        if h_date.year < target_year and h_date.month == target_month:
            years_with_same_month_trade.add(h_date.year)
    return len(years_with_same_month_trade) >= ROUTINE_LOOKBACK_YEARS


# ─────────────────────────────────────────────────────────────────────────────
# Insider Signal
# ─────────────────────────────────────────────────────────────────────────────

def compute_insider_signal(
    buys: list[dict[str, Any]] | None,
    sells: list[dict[str, Any]] | None,
) -> int | None:
    """
    Compute the Insider Signal for one ticker.

    Args:
        buys: List of Form 4 BUY rows in the lookback window. Each row dict:
            amount       (int)   — share count
            stock_price  (float) — execution price
            owner_name   (str)   — insider name (used for clustering)
            is_officer   (bool)  — officer flag (CEO/CFO/etc.)
            is_routine   (bool)  — pre-classified per `classify_routine`
        sells: Same shape, SELL rows.

    Returns:
        Integer score in [−100, +100], or None if no opportunistic activity
        (Signal excluded from Magnitude rollup denominator).

    Construction:
        net = buy_contribution − sell_contribution
        buy_contribution  = log10(buy_total) − 5, ×1.5 if any officer-buyer
        sell_contribution = log10(sell_total) − 5, ×1.5 if any officer-seller,
                            ×0.5 unless cluster-sell trigger fires (then ×1.0)
        cluster_buy_bonus = +15 if 5+ unique buyers, +8 if 3+, else 0
        raw = net × 30 + cluster_buy_bonus
        score = clamp(round(raw), −100, 100)
    """
    buys = buys or []
    sells = sells or []

    # Filter to opportunistic + above the $25K floor
    opp_buys = [
        r for r in buys
        if not r.get("is_routine", False) and _row_dollar(r) >= INSIDER_MIN_DOLLAR
    ]
    opp_sells = [
        r for r in sells
        if not r.get("is_routine", False) and _row_dollar(r) >= INSIDER_MIN_DOLLAR
    ]

    # No opportunistic activity → Signal contributes nothing. Returns None
    # (NOT 0) so the Magnitude rollup excludes this Signal from the denominator.
    if not opp_buys and not opp_sells:
        return None

    # ── Buy side ──────────────────────────────────────────────────────────────
    buy_total = sum(_row_dollar(r) for r in opp_buys)
    buy_log = (math.log10(buy_total) - 5) if buy_total > 0 else 0.0
    has_officer_buy = any(r.get("is_officer") for r in opp_buys)
    buy_contribution = buy_log * (OFFICER_MULTIPLIER if has_officer_buy else 1.0)

    # ── Sell side ─────────────────────────────────────────────────────────────
    sell_total = sum(_row_dollar(r) for r in opp_sells)
    sell_log = (math.log10(sell_total) - 5) if sell_total > 0 else 0.0
    has_officer_sell = any(r.get("is_officer") for r in opp_sells)

    # Cluster-sell trigger: 3+ unique opportunistic officer sellers in window.
    # When it fires, sells regain full weight (coordinated exits ARE informative).
    unique_officer_sellers = len({
        _normalized_name(r) for r in opp_sells if r.get("is_officer")
    })
    cluster_sell_active = unique_officer_sellers >= CLUSTER_SELL_THRESHOLD

    sell_raw = sell_log * (OFFICER_MULTIPLIER if has_officer_sell else 1.0)
    sell_weight = 1.0 if cluster_sell_active else OPPORTUNISTIC_SELL_WEIGHT
    sell_contribution = sell_raw * sell_weight

    # ── Net + cluster-buy bonus + scale to ±100 ───────────────────────────────
    net = buy_contribution - sell_contribution

    unique_buyers = len({_normalized_name(r) for r in opp_buys})
    if unique_buyers >= CLUSTER_BUY_THRESHOLD_HIGH:
        cluster_bonus = CLUSTER_BONUS_HIGH
    elif unique_buyers >= CLUSTER_BUY_THRESHOLD_LOW:
        cluster_bonus = CLUSTER_BONUS_LOW
    else:
        cluster_bonus = 0

    raw = net * RAW_SCALE + cluster_bonus
    return int(round(_clamp(raw, -100.0, 100.0)))
