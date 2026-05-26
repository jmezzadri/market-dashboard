"""
paper_portfolio — MacroTilt paper trading translator.

Reads Asset Tilt and Equity Scanner signals, computes Sleeve A + Sleeve B
target positions, diffs against the live Alpaca paper account, and writes
the resulting buy/sell intent rows to public.paper_orders in 'pending'
status.

Phase 2 scope (this module): intent generation only — NO submission to
Alpaca, NO real fills, NO live position writes. Phase 4 wires execution.

Council:
  * Lead Developer — orchestration + Alpaca client + Supabase IO.
  * Senior Quant   — sleeve math, tier-fill, leverage cap.
  * Data Steward   — signal source paths + audit trail in paper_signal_capture.
  * UX Designer    — N/A this phase (no user-visible surface).
"""

__version__ = "0.1.0"
