"""
v4.1 Top-level scoring entry point.

Combines gates + pillars into a single per-ticker scoring call.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Sequence

from scanner.signal_intelligence_v4.gates import apply_gates
from scanner.signal_intelligence_v4.pillars import score_pillars


class Band(str, Enum):
    """Surface bands. Below 20 = not surfaced."""
    HIGH_CONVICTION = "High Conviction"   # ≥ 45
    WATCH = "Watch"                        # 20-44
    NOT_SURFACED = "Not Surfaced"          # < 20 OR gate fail


HIGH_CONVICTION_THRESHOLD = 45
WATCH_THRESHOLD = 20


@dataclass
class SignalResult:
    ticker: str
    score_date: str
    gate_pass: bool
    gate_diagnostic: dict[str, Any]
    pillar_diagnostic: dict[str, Any]
    score: int
    band: Band
    insider_dollar_tiebreaker: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "score_date": self.score_date,
            "gate_pass": self.gate_pass,
            "score": self.score,
            "band": self.band.value,
            "insider_dollar_tiebreaker": self.insider_dollar_tiebreaker,
            "gate_diagnostic": self.gate_diagnostic,
            "pillar_diagnostic": self.pillar_diagnostic,
        }


def _band(score: int, gate_pass: bool) -> Band:
    if not gate_pass:
        return Band.NOT_SURFACED
    if score >= HIGH_CONVICTION_THRESHOLD:
        return Band.HIGH_CONVICTION
    if score >= WATCH_THRESHOLD:
        return Band.WATCH
    return Band.NOT_SURFACED


def score_ticker(
    ticker: str,
    score_date: date,
    today_close: float,
    volume_today: float,
    avg_volume_22d: float,
    closes_for_indicators: Sequence[float],
    insider_history: list[dict[str, Any]],
    require_first_buy: bool = True,
) -> SignalResult:
    """
    Score one ticker on one date through the full v4.1 pipeline.

    Args:
        ticker: symbol.
        score_date: today.
        today_close: today's close.
        volume_today: today's share volume.
        avg_volume_22d: 22-day avg volume (caller computes from prices_eod).
        closes_for_indicators: at least 51 trailing closes ENDING with today's
            close. Used for 50-SMA + RSI(14) + Bollinger(20).
        insider_history: full insider event history for this ticker covering
            at least the last (insider_window_days + first_buy_lookback_days)
            = 30 + 365 = 395 days. Each event:
                {"date": date, "owner": str, "transaction_code": str,
                 "amount": int, "stock_price": float, "is_officer": bool}
        require_first_buy: v4.1 default True. Set False to fall back to v4.0.

    Returns:
        SignalResult with full diagnostic.
    """
    # Gates
    gate_diag = apply_gates(
        ticker=ticker,
        score_date=score_date,
        today_close=today_close,
        avg_volume_22d=avg_volume_22d,
        insider_history=insider_history,
        require_first_buy=require_first_buy,
    )
    gate_pass = gate_diag["all_pass"]

    # Pillars (always computed for diagnostic; only count if gate passes)
    pillar_diag = score_pillars(
        volume_today=volume_today,
        avg_volume_22d=avg_volume_22d,
        closes=closes_for_indicators,
    )
    score = pillar_diag["score_final"] if gate_pass else 0
    band = _band(score, gate_pass)

    return SignalResult(
        ticker=ticker.upper(),
        score_date=score_date.isoformat(),
        gate_pass=gate_pass,
        gate_diagnostic=gate_diag,
        pillar_diagnostic=pillar_diag,
        score=score,
        band=band,
        insider_dollar_tiebreaker=gate_diag["gate_1_insider"]["total_dollar"],
    )
