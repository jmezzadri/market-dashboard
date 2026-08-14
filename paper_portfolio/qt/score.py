"""
paper_portfolio.qt.score — the Quality Trend v3 scorer.

This is the production twin of the validated backtest. If this file and the
backtest ever disagree, the backtest number on the tin is fiction. Any change
here must be re-run through the full sweep and the both-halves test first
(see paper_portfolio/QUALITY_TREND_V3.md).

Score = 0.45 mom12 + 0.30 mom6 + 0.15 trend + 0.10 mdd      (price, rank-scored)
      + 0.15 gp_a  + 0.10 ocf_a + 0.20 iss                  (fundamentals)
      + 0.20 insider                                        (bonus, never a penalty)

Every price term is converted to a cross-sectional percentile rank before
weighting, so a single blown-up outlier cannot dominate the book.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..strategy_config import CONFIG, FUNDAMENTAL_WEIGHTS, INSIDER_WEIGHTS, PRICE_WEIGHTS

LOWER_IS_BETTER = {"vol", "mdd"}


def rank_score(s: pd.Series) -> pd.Series:
    """Cross-sectional percentile rank mapped to -1..+1."""
    return (s.rank(pct=True) - 0.5) * 2


def build_features(px: pd.DataFrame, vol_df: pd.DataFrame) -> pd.DataFrame:
    """Price features from a wide close panel (index=date, columns=symbol).

    Requires at least 253 sessions of history; anything shorter cannot produce
    a 12-month momentum figure and is dropped rather than back-filled.
    """
    if len(px) < 260:
        raise ValueError(f"need >=260 sessions of history, got {len(px)}")
    h = px
    last = h.iloc[-1]
    rets = h.pct_change()
    win = 126
    dollar = (px * vol_df).rolling(63, min_periods=40).mean().iloc[-1]

    f = pd.DataFrame({
        "price": last,
        "addv": dollar,
        "liq":   h.iloc[-win:].notna().mean(),
        "nz":    (rets.iloc[-win:].abs() > 1e-9).mean(),
        "mom12": h.iloc[-22] / h.iloc[-253] - 1,      # 12 months, skipping the last one
        "mom6":  h.iloc[-22] / h.iloc[-127] - 1,      # 6 months, skipping the last one
        "vol":   rets.iloc[-win:].std() * np.sqrt(252),
        "trend": (h.iloc[-win:] > h.iloc[-win:].mean()).mean(),
        "mdd":   (h.iloc[-252:] / h.iloc[-252:].cummax() - 1).min(),
    })
    return f


def eligible(f: pd.DataFrame, cfg=CONFIG) -> pd.DataFrame:
    """Investability gates. Nothing here is a return signal — these only make
    sure a $25,000 order can actually be filled without moving the stock."""
    ok = (
        (f.price >= cfg.MIN_PRICE)
        & (f.addv >= cfg.MIN_DOLLAR_VOLUME)
        & (f.liq >= cfg.MIN_TRADED_DAYS)
        & (f.nz >= cfg.MIN_NONSTALE_DAYS)
        & f.mom12.notna()
        & f.vol.notna()
        & (f.vol > 0)
        & (f.vol <= cfg.MAX_VOLATILITY)
    )
    return f[ok]


def score(f: pd.DataFrame, fund: pd.DataFrame | None = None,
          ins: pd.Series | None = None, cfg=CONFIG) -> pd.Series:
    """Combine price, fundamental and insider terms into one ranking."""
    if fund is not None and not fund.empty:
        # inner join: a company with no filed financials cannot be judged on
        # quality, and guessing is what produced the survivorship-biased build.
        f = f.join(fund, how="inner")

    sc = sum(
        w * rank_score(-f[k] if k in LOWER_IS_BETTER else f[k])
        for k, w in PRICE_WEIGHTS.items() if w
    )
    for k, w in FUNDAMENTAL_WEIGHTS.items():
        if w and k in f.columns:
            sc = sc + w * rank_score(f[k])

    if ins is not None and len(ins):
        v = ins.reindex(sc.index).fillna(0.0).clip(lower=0)
        mx = float(v.max())
        if mx > 0:
            for _, w in INSIDER_WEIGHTS.items():
                sc = sc + w * (v / mx)
    return sc.dropna().sort_values(ascending=False)


def target_book(sc: pd.Series, held: list[str] | None = None, cfg=CONFIG) -> list[str]:
    """Top N, with the trade band that roughly halves turnover.

    A name is bought when it enters the top N and is only sold once it falls
    out of the top EXIT_BAND (25%) of the ranked list — not the moment it slips
    to rank 41. Churning the tail costs more in spread than it gains in signal.
    """
    held = held or []
    n = cfg.POSITIONS
    cut = set(sc.index[:max(int(len(sc) * cfg.EXIT_BAND), n)])
    keep = [s for s in held if s in cut]
    new = [s for s in sc.index if s not in keep][:max(0, n - len(keep))]
    return (keep + new)[:n]
