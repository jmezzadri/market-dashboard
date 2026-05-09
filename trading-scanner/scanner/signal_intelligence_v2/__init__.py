"""
Signal Intelligence v2 — academically-grounded trading scanner engine.

Replaces signal_composite.py v1 (eyeballed weights, asymmetric per-section
construction). v2 is rebuilt against peer-reviewed evidence per the canonical
spec at /Users/joemezzadri/Documents/market-dashboard/TRADING_OPPS_V2_SPEC.md.

Five Signals, each scored on the symmetric ±100 scale:
    Insider     — Lakonishok-Lee (2001), Cohen-Malloy-Pomorski (2012)
    Options     — Pan-Poteshman (2006), Cremers-Weinbaum (2010), Hu (2014)
    Analyst     — Womack (1996), Barber-Lehavy-McNichols-Trueman (2001)
    Congress    — Ziobrowski (2004, 2011), Eggers-Hainmueller (2013)
    Technicals  — Jegadeesh-Titman (1993), George-Hwang (2004), Asness-Moskowitz-Pedersen (2013)

Aggregation: Magnitude (weighted average) → Conviction (probability from
back-test calibration) → MacroTilt Score (Magnitude × (Conviction − 50) / 50).
Bands fire on MT Score per the 8-band scheme (Buy Signal / Strong Bullish /
Moderate Bullish / Weak Bullish / Weak Bearish / Moderate Bearish / Strong
Bearish / Sell Trigger).

PR 1 ships the Insider module. Subsequent PRs add Options, Analyst, Congress,
Technicals, then the rollup producer + back-test harness.
"""

from scanner.signal_intelligence_v2.insider import (
    compute_insider_signal,
    classify_routine,
    INSIDER_WINDOW_DAYS,
    INSIDER_MIN_DOLLAR,
    OFFICER_MULTIPLIER,
    OPPORTUNISTIC_SELL_WEIGHT,
    CLUSTER_SELL_THRESHOLD,
)
from scanner.signal_intelligence_v2.options import compute_options_signal
from scanner.signal_intelligence_v2.analyst import compute_analyst_signal
from scanner.signal_intelligence_v2.congress import compute_congress_signal
from scanner.signal_intelligence_v2.technicals import compute_technicals_signal
from scanner.signal_intelligence_v2.rollup import (
    compute_signal_intelligence,
    DEFAULT_WEIGHTS,
    BAND_CUTOFFS,
)

__all__ = [
    # Per-Signal entry points
    "compute_insider_signal",
    "compute_options_signal",
    "compute_analyst_signal",
    "compute_congress_signal",
    "compute_technicals_signal",
    # Rollup
    "compute_signal_intelligence",
    "DEFAULT_WEIGHTS",
    "BAND_CUTOFFS",
    # Insider helpers / constants
    "classify_routine",
    "INSIDER_WINDOW_DAYS",
    "INSIDER_MIN_DOLLAR",
    "OFFICER_MULTIPLIER",
    "OPPORTUNISTIC_SELL_WEIGHT",
    "CLUSTER_SELL_THRESHOLD",
]
