#!/usr/bin/env python3
"""momentum_rules.py — pure math for the Momentum sleeve (unit-tested in
scripts/test_momentum_rules.py). Mirrors scripts/backtest_strategies.py
(the cleared 22-year study) exactly — do not change without a new backtest
(Policy A)."""


def pick_rebalance_day(cal, today):
    """Last panel-complete day of the month BEFORE `today`'s month.
    `cal` is an ascending list of eligible trading days."""
    cutoff = today.replace(day=1)
    prior = [d for d in cal if d < cutoff]
    return prior[-1] if prior else None


def ret_12_1(series, lb=252, skip=21):
    """12-1 momentum on a calendar-aligned close series of length lb+1
    (index 0 = t-lb, index lb = t). Total return t-lb -> t-skip.
    Returns None if either endpoint is missing."""
    if len(series) != lb + 1:
        return None
    p0, p1 = series[0], series[lb - skip]
    if p0 is None or p1 is None or p0 <= 0:
        return None
    return p1 / p0 - 1.0


def momentum_ranks(closes, lb=252, skip=21):
    """closes: {ticker: aligned series}. Returns [(ticker, ret)] sorted by
    return descending, ticker ascending on ties; names lacking either
    endpoint are excluded."""
    out = []
    for t, s in closes.items():
        r = ret_12_1(s, lb, skip)
        if r is not None:
            out.append((t, r))
    out.sort(key=lambda x: (-x[1], x[0]))
    return out


def quintile_clamp(n_universe, n_min=20, n_max=50):
    """Top-quintile size clamped to [n_min, n_max]."""
    return max(n_min, min(n_max, n_universe // 5))


def guard_invested(spy_closes):
    """Faber (2007) crash guard: invested iff the latest SPY close is at or
    above the simple average of the closes provided (expects 200)."""
    return spy_closes[-1] >= sum(spy_closes) / len(spy_closes)
