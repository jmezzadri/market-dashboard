"""Load configuration from environment and define strategy constants."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Project root (directory containing this file)
PROJECT_ROOT = Path(__file__).resolve().parent

load_dotenv(PROJECT_ROOT / ".env")

UNUSUAL_WHALES_API_KEY = os.getenv("UNUSUAL_WHALES_API_KEY", "").strip()
if not UNUSUAL_WHALES_API_KEY:
    raise OSError(
        "UNUSUAL_WHALES_API_KEY is not set. Add it to .env locally or GitHub Actions secrets."
    )

SCHWAB_APP_KEY = os.getenv("SCHWAB_APP_KEY", "").strip()
SCHWAB_APP_SECRET = os.getenv("SCHWAB_APP_SECRET", "").strip()
SCHWAB_REDIRECT_URI = os.getenv("SCHWAB_REDIRECT_URI", "https://127.0.0.1").strip()

# Signal scoring thresholds (overridable via env for CI / GitHub Actions)
SCORE_BUY_ALERT = int(os.getenv("SCORE_BUY_ALERT", "60"))
SCORE_WATCH_ALERT = int(os.getenv("SCORE_WATCH_ALERT", "35"))
MIN_SCORE_TO_ALERT = SCORE_BUY_ALERT  # legacy alias

CONGRESS_CLUSTER_DAYS = 30
INSIDER_CLUSTER_DAYS = 30
INSIDER_CLUSTER_MIN = 3  # legacy; insider score now uses total notional + unique buyers
# Minimum |shares| × stock_price for a row to count in insider notional totals
INSIDER_MIN_DOLLAR_FOR_SCORE = 25_000

# Per disclosure amount range → points; summed per ticker then capped (see CONGRESS_SCORE_CAP)
CONGRESS_AMOUNT_SCORES: dict[str, int] = {
    "$1,001 - $15,000": 5,
    "$15,001 - $50,000": 10,
    "$50,001 - $100,000": 15,
    "$100,001 - $250,000": 20,
    "$250,001 - $500,000": 25,
    "$500,001 - $1,000,000": 30,
    "$1,000,001 +": 35,
}
CONGRESS_SCORE_CAP = 40

# Covered call strategy parameters
CC_MIN_OTM_PCT = 0.10
CC_MAX_OTM_PCT = 0.20
CC_MIN_EXPIRY_DAYS = 28
CC_MAX_EXPIRY_DAYS = 42
CC_MIN_ANNUALIZED_YIELD = 0.15

# Unusual options activity thresholds
MIN_VOLUME_OI_RATIO = 0.5
MIN_PREMIUM_UNUSUAL = 50_000

# Stock filters
MIN_STOCK_PRICE = 5.00
MIN_MARKET_CAP = 500_000_000
# Portfolio sizing is manual; keep a loose ceiling so liquid names (e.g. GS) are not dropped.
MAX_STOCK_PRICE = 1000.00

# Data lookback windows (separate per source — disclosure lag and signal cadence differ)
CONGRESS_LOOKBACK_DAYS = 45  # Disclosures can lag trades by up to ~45 days
INSIDER_LOOKBACK_DAYS = 14  # Form 4 timing + buffer
FLOW_LOOKBACK_DAYS = 1  # Flow is meaningful intraday / very recent only
DARKPOOL_LOOKBACK_DAYS = 1  # Same as flow for large prints

# Unusual Whales REST API
UW_BASE_URL = "https://api.unusualwhales.com"

# Optional client header (see Unusual Whales API documentation)
UW_CLIENT_API_ID = os.getenv("UW_CLIENT_API_ID", "100001")

# Covered call — Greeks and quality gates (Phase 2)
CC_MIN_IV_RANK = 30
CC_MIN_DELTA = 0.15
CC_MAX_DELTA = 0.35
CC_MAX_SPREAD_PCT = 0.10
# Optimal new short-call selection (triggers spec §4.1) — tighter delta band
CC_SELECT_MIN_DELTA = float(os.getenv("CC_SELECT_MIN_DELTA", "0.20"))
CC_SELECT_MAX_DELTA = float(os.getenv("CC_SELECT_MAX_DELTA", "0.30"))
# Roll-up search band (triggers spec §4.2 trigger 2)
CC_ROLL_UP_MIN_DELTA = float(os.getenv("CC_ROLL_UP_MIN_DELTA", "0.15"))
CC_ROLL_UP_MAX_DELTA = float(os.getenv("CC_ROLL_UP_MAX_DELTA", "0.25"))
# Note when spread is 5–10% of mid (still under CC_MAX_SPREAD_PCT)
CC_SPREAD_WIDE_NOTE_MIN_PCT = 0.05

# Portfolio / sell triggers (CURSOR_TRIGGERS_SPEC)
STOP_LOSS_PCT = float(os.getenv("STOP_LOSS_PCT", "0.15"))
# Profit target for PT line in emails/reports (default 20%)
PROFIT_TARGET_PCT = float(os.getenv("PROFIT_TARGET_PCT", "0.20"))
SCORE_COLLAPSE_THRESHOLD = int(os.getenv("SCORE_COLLAPSE_THRESHOLD", "15"))
SCORE_COLLAPSE_PRIOR_MIN = int(os.getenv("SCORE_COLLAPSE_PRIOR_MIN", "35"))
INSIDER_REVERSAL_LOOKBACK = int(os.getenv("INSIDER_REVERSAL_LOOKBACK", "90"))
ROLL_PROFIT_THRESHOLD = float(os.getenv("ROLL_PROFIT_THRESHOLD", "0.80"))
ROLL_STRIKE_PROXIMITY = float(os.getenv("ROLL_STRIKE_PROXIMITY", "0.03"))
ROLL_EXPIRY_DAYS = int(os.getenv("ROLL_EXPIRY_DAYS", "7"))

# Email alerts (Phase 2) — set in .env
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "josephmezzadri@gmail.com").strip()
ALERT_EMAIL_FROM = os.getenv("ALERT_EMAIL_FROM", "").strip()
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "").strip()
ALERT_ON_WATCH = os.getenv("ALERT_ON_WATCH", "true").lower() in ("1", "true", "yes")
ALERT_ON_BUY = os.getenv("ALERT_ON_BUY", "true").lower() in ("1", "true", "yes")
