"""
paper_portfolio — MacroTilt paper trading translator.

Reads Equity Scanner signals, computes the Sleeve B (Equity Scanner) target
positions, diffs against the live Alpaca paper account, and writes the
resulting buy/sell intent rows to public.paper_orders in 'pending' status.

The paper portfolio is Sleeve B (Equity Scanner) ONLY. Sleeve A (the Asset
Tilt industry-group ETF sleeve) was retired 2026-06-23 when the Asset Tilt
engine was removed; any held Sleeve-A ETF is exited to cash on the next
rebalance (every held name absent from the Sleeve B target is sold).

Phase 2 scope (this module): intent generation only — NO submission to
Alpaca, NO real fills, NO live position writes. Phase 4 wires execution.

Council:
  * Lead Developer — orchestration + Alpaca client + Supabase IO.
  * Senior Quant   — sleeve math, tier-fill, leverage cap.
  * Data Steward   — signal source paths + audit trail in paper_signal_capture.
  * UX Designer    — N/A this phase (no user-visible surface).
"""

__version__ = "0.1.0"
