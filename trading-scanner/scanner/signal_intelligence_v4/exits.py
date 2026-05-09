"""
v4.1 Exit Rules.

Applied nightly to open positions. First rule that fires wins.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date
from typing import Any, Sequence

# Constants
EXIT_TIME_LIMIT_DAYS = 21
EXIT_DEAD_MONEY_PCT = 0.05
EXIT_SMA_PERIOD = 20


@dataclass
class ExitDecision:
    should_exit: bool
    reason: str | None  # "tech_break" | "insider_sale" | "dead_money" | "time_limit" | None
    days_held: int
    max_gain_pct: float


def _sma(values: Sequence[float]) -> float:
    return sum(values) / len(values)


def check_exit_rules(
    entry_date: date,
    entry_price: float,
    today_date: date,
    closes_since_entry: Sequence[float],
    closes_pre_entry_for_sma: Sequence[float],
    insider_history_since_entry: list[dict[str, Any]],
) -> ExitDecision:
    """
    Apply v4.1 exit rules to one open position.

    Args:
        entry_date: when the position was opened.
        entry_price: entry close price.
        today_date: today.
        closes_since_entry: list of daily closes from entry to today (inclusive).
        closes_pre_entry_for_sma: closes from at least 20 days before entry,
            used for the rolling 20-SMA exit check.
        insider_history_since_entry: insider events between entry_date and
            today_date for this ticker. Each row {"date", "transaction_code",
            "is_officer"}.

    Returns:
        ExitDecision with should_exit + reason + days_held + max_gain_pct.

    Order of evaluation (first rule that fires wins):
        1. Technical break (close < 20-SMA)
        2. Insider sale (any 'S' code from a whitelisted insider)
        3. Time limit (21 trading days held)
        4. Dead money (21 days, no +5% peak gain)
    """
    days_held = len(closes_since_entry) - 1  # -1 because entry day is index 0
    if days_held < 0:
        return ExitDecision(False, None, 0, 0.0)

    today_close = closes_since_entry[-1]

    # Max gain since entry
    max_close = max(closes_since_entry) if closes_since_entry else entry_price
    max_gain_pct = (max_close / entry_price - 1) * 100 if entry_price > 0 else 0.0

    # Rule 1: Technical break — today's close below the 20-SMA computed
    # from the last 20 days. Requires at least 20 closes available counting
    # backwards from today (using pre-entry buffer if needed).
    full_history = list(closes_pre_entry_for_sma) + list(closes_since_entry)
    if len(full_history) >= EXIT_SMA_PERIOD + 1:
        sma_20 = _sma(full_history[-EXIT_SMA_PERIOD - 1:-1])
        if today_close < sma_20:
            return ExitDecision(True, "tech_break", days_held, max_gain_pct)

    # Rule 2: Insider sale — any officer 'S' code in window
    for e in insider_history_since_entry:
        ed = e.get("date")
        if not isinstance(ed, date):
            continue
        if not (entry_date <= ed <= today_date):
            continue
        code = (e.get("transaction_code") or "").upper()
        if code == "S":
            return ExitDecision(True, "insider_sale", days_held, max_gain_pct)

    # Rule 3 & 4: Time-based exits at day 21
    if days_held >= EXIT_TIME_LIMIT_DAYS:
        if max_gain_pct < EXIT_DEAD_MONEY_PCT * 100:
            return ExitDecision(True, "dead_money", days_held, max_gain_pct)
        return ExitDecision(True, "time_limit", days_held, max_gain_pct)

    return ExitDecision(False, None, days_held, max_gain_pct)
