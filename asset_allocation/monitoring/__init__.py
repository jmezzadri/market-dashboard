"""
asset_allocation.monitoring — observability for the v10 backend.

  anomaly.py — flag suspicious allocation changes (huge weight swings,
               unexpected stance flips, leverage discontinuities)
  alerts.py  — send email alerts via Resend when runs fail or anomalies
               fire (Slack hook can be wired in later if needed)
  run_log.py — JSONL append-only run history reader
"""

__version__ = "0.1.0"
