"""
MacroTilt Asset Allocation v10 — industrialized backend.

See asset-allocation-v10-architecture.md for full architecture spec.

Six layers:
  L1 — Data acquisition  (acquisition.py)
  L2 — Validation        (validation.py)
  L3 — Compute           (compute.py)         [Phase 2]
  L4 — State management  (state.py)            [Phase 3]
  L5 — Output            (output.py)           [Phase 3]
  L6 — Monitoring        (monitoring.py)       [Phase 5]

Each layer has its own tests under tests/.
"""

__version__ = "0.1.0"  # Phase 1
