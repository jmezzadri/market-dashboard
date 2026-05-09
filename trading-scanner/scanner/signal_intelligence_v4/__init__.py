"""
Signal Intelligence v4.1 — production blueprint.

Long-only equity scanner for small/mid-cap names ($300M-$3B mkt cap) where
information asymmetry between insiders/whales and retail price action is
statistically meaningful.

Validated by 12-month backtest, 197 small-caps, 40,442 observations:
  Watch ≥20:    62.5% win rate, +5.68% mean 21d return, ~2.7 trades/wk
  High ≥45:     70.0% win rate, +14.34% mean 21d return, ~0.4 trades/wk

Spec: /Users/joemezzadri/Documents/market-dashboard/SIGNAL_INTELLIGENCE_V4_LOCKED.md
"""

from scanner.signal_intelligence_v4.gates import (
    apply_gates,
    insider_gate_passes,
    is_first_buy,
    magnitude_threshold,
    hc_magnitude_threshold,
    HEDGE_TICKERS,
)
from scanner.signal_intelligence_v4.pillars import (
    aggression_pillar,
    squeeze_pillar,
    momentum_pillar,
    overbought_red_flag,
    score_pillars,
)
from scanner.signal_intelligence_v4.exits import (
    check_exit_rules,
    ExitDecision,
)
from scanner.signal_intelligence_v4.score import (
    score_ticker,
    SignalResult,
    Band,
)

__all__ = [
    # Gates
    "apply_gates", "insider_gate_passes", "is_first_buy",
    "magnitude_threshold", "hc_magnitude_threshold",
    "HEDGE_TICKERS",
    # Pillars
    "aggression_pillar", "squeeze_pillar", "momentum_pillar",
    "overbought_red_flag", "score_pillars",
    # Exits
    "check_exit_rules", "ExitDecision",
    # Top-level scoring
    "score_ticker", "SignalResult", "Band",
]

__version__ = "4.1.0"
