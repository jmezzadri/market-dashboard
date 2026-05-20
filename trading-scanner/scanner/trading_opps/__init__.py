"""
trading_opps — the rebuilt Trading Opportunities screener.

Replaces the retired six-signal "Signal Intelligence v5" model with the
simpler dual-direction (long / short) screener specified in
TRADING_OPPS_SCREENER_SPEC_2026-05-20.md.

Phase 1 — the data foundation:
    universe.py            screener universe (locked spec Section 2)
    darkpool_ingest.py     nightly off-exchange block-print ingest
    options_eod_ingest.py  nightly per-contract end-of-day options ingest

Phase 2 — the scoring engine and its backtest:
    backtest_engine.py      universe gate, indicators (200-day SMA, Wilder RSI),
                            insider + trend scoring, forward returns, per-rule
                            event studies, permutation sweep, lookahead audit
    calibrated_config.json  backtest-calibrated point values, layer cap,
                            lookback window and launch threshold — the live
                            engine reads this file
    backtest_results.json   pinned backtest output (every reported number)
    test_backtest_engine.py unit tests, incl. the no-lookahead structural checks

Scoring runs in Option 1 mode: Insider + Trend layers only. The dark-pool and
options layers ingest nightly but contribute zero score (shadow mode) until
they have enough of their own history to be backtested.
"""
