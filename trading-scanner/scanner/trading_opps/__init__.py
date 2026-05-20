"""
trading_opps — the rebuilt Trading Opportunities screener.

Replaces the retired six-signal "Signal Intelligence v5" model with the
simpler dual-direction (long / short) screener specified in
TRADING_OPPS_SCREENER_SPEC_2026-05-20.md.

Phase 1 (this module, as shipped): the data foundation only —
    universe.py            screener universe (locked spec Section 2)
    darkpool_ingest.py     nightly off-exchange block-print ingest
    options_eod_ingest.py  nightly per-contract end-of-day options ingest

Phase 2 will add the scoring engine and the backtest harness alongside
these files. Nothing here scores or ranks anything yet.
"""
