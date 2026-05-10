"""
Signal Intelligence v5 — Phase 1.

Six bidirectional signals scored per ticker on the v5 universe (US Common
Stock + ADR with market cap >= $300M and last close > $5). Each signal
returns a sub-score in [-100, +100] plus components + diagnostic.

This package is wired in parallel with v4.1 — v4.1 stays live until the
v5 composite, backtest, and UI rewrite ship in Phases 2-4.

Spec:
    Universe        scanner.signal_intelligence_v5.universe
    Insider         scanner.signal_intelligence_v5.insider_score
    Options Flow    scanner.signal_intelligence_v5.options_score
    Congress        scanner.signal_intelligence_v5.congress_score
    Technicals      scanner.signal_intelligence_v5.technicals_score
    Analyst         scanner.signal_intelligence_v5.analyst_score
    Short Interest  scanner.signal_intelligence_v5.short_interest_score

Each scorer exports `score(ticker, score_date) -> dict` with shape:
    {
        "sub_score":  int,             # -100..+100 (None if no data)
        "components": dict,            # named pieces of the score
        "diagnostic": dict,            # raw inputs used + lookback window
    }

The MT Score composite (weighted blend with insider cap-discount) and
band assignment land in Phase 2.
"""

__version__ = "5.0.0-phase1"
