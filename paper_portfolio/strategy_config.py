"""
MacroTilt Quality Trend v3 — production scorer.

Validated 2026-08-13 on survivorship-free data (14,632 US companies 2016-2026,
incl. 2,011 delisted). Feb 2017 - Aug 2026:
    CAGR 21.24% vs S&P 15.31% | Sharpe 0.97 vs 0.82 | Sortino 1.57 vs 1.18
    max drawdown -19.3% vs -23.9% | beat in 7 of 10 years | worst year -6.7% vs -18.2%
    Both halves beat independently (2017-21 Sharpe 1.17 vs 1.04; 2022-26 0.97 vs 0.68).
    Survives 40bp round-trip costs (Sharpe 0.87).

DO NOT change weights without re-running the full sweep + both-halves test.
Rejected on evidence (do not re-add): low-volatility as a return signal, dynamic
volatility targeting, market trend filters, distance-from-52w-high, short-term
reversal, low asset growth, low leverage, revenue growth, dollar-size insider floors.
"""
from dataclasses import dataclass, field

@dataclass(frozen=True)
class Config:
    # ---- price signals (z-scored cross-sectionally, higher = better) --------
    W_MOM12: float = 0.45      # 12-month return, skipping the most recent month
    W_MOM6:  float = 0.30      # 6-month return, skipping the most recent month
    W_TREND: float = 0.15      # fraction of last 126 days spent above own 126d mean
    W_MDD:   float = 0.10      # worst 1-year drawdown (less bad = better)

    # ---- fundamentals, POINT-IN-TIME by SEC filing date --------------------
    W_GROSS_PROFIT: float = 0.15   # gross profit / total assets
    W_CASHFLOW:     float = 0.10   # operating cash flow / total assets
    W_BUYBACK:      float = 0.20   # negative of share-count growth (buybacks good)

    # ---- insider conviction (bonus only, never a penalty) ------------------
    W_INSIDER: float = 0.20        # applied to ins180
    INSIDER_WINDOW_DAYS: int = 180
    # Meaningful-buy filter. The raw insider signal is NEGATIVE (-2.07% vs market
    # over 6m); these filters are what turn it positive.
    INSIDER_CODE: str = "P"        # open-market purchase only. Never A/M/F/G/S.
    INSIDER_EXCLUDE_10B5_1: bool = True
    INSIDER_REQUIRE_OFFICER_OR_DIRECTOR: bool = True   # a pure 10% owner NEVER counts
    INSIDER_STAKE_CAP: float = 5.0     # cap stake-increase ratio at 500%
    INSIDER_BIG_TICKET_USD: float = 250_000   # buys above this get HALF weight —
                                              # large dollar buys are a NEGATIVE signal
    INSIDER_CLUSTER_BONUS: float = 0.25       # per extra distinct insider, max 3

    # ---- eligibility -------------------------------------------------------
    MIN_DOLLAR_VOLUME: float = 100e6   # 60-day average
    MIN_PRICE: float = 5.0
    MAX_VOLATILITY: float = 0.70       # annualised, 126-day
    MIN_TRADED_DAYS: float = 0.95
    MIN_NONSTALE_DAYS: float = 0.90
    EXCLUDE_FUNDS: bool = True         # ETFs/trusts are not companies

    # ---- portfolio ---------------------------------------------------------
    # 2026-08-28, Joe ("run it"): the relaunched book holds 20 names, not 40.
    # Halving the count doubles single-name weight (5%): more concentration in
    # what the score likes, bigger drawdowns when it is wrong. The PUBLISHED
    # backtest was computed on the 40-name variant and the site must say so —
    # its figures are quoted verbatim, never re-derived for 20.
    POSITIONS: int = 20
    WEIGHTING: str = "equal"           # inverse-vol tested, no Sharpe gain
    EXIT_BAND: float = 0.25            # hold until the name leaves the top 25%
    REBALANCE: str = "monthly"
    GROSS_EXPOSURE: float = 1.00       # NO leverage, NO strategic cash
    MAX_POSITION: float = 0.05

    # ---- crash brake (Joe approved 2026-08-28) ----------------------------
    # Evaluated daily after the close by QT-BRAKE-DAILY. Composite stress =
    # mean of VIX 3y percentile and HYG 63-day-drawdown 3y percentile.
    # ON above 0.80, OFF below 0.65 (hysteresis so it cannot flap).
    # ON  => scale the book to 50% (sell half of every position into cash).
    # OFF => restore to full weights from the latest target book.
    # The brake ONLY scales. It never picks stocks, never shorts, never levers.
    BRAKE_ON: float = 0.80
    BRAKE_OFF: float = 0.65
    BRAKE_SCALE: float = 0.50

CONFIG = Config()

PRICE_WEIGHTS = {"mom12": CONFIG.W_MOM12, "mom6": CONFIG.W_MOM6,
                 "trend": CONFIG.W_TREND, "mdd": CONFIG.W_MDD}
FUNDAMENTAL_WEIGHTS = {"gp_a": CONFIG.W_GROSS_PROFIT, "ocf_a": CONFIG.W_CASHFLOW,
                       "iss": CONFIG.W_BUYBACK}
INSIDER_WEIGHTS = {"ins180": CONFIG.W_INSIDER}
LOWER_IS_BETTER = {"vol", "vol21", "rev1", "ath", "mdd"}
