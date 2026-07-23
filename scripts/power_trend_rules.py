#!/usr/bin/env python3
"""power_trend_rules.py — pure math for the Power Trend sleeve (unit-tested in
scripts/test_power_trend_rules.py). The screen itself lives in SQL
(public.power_trend_scan, migration 081 — validated logic); this module holds
only the sleeve's portfolio-construction rules. Do not change without a new
backtest (Policy A)."""

from datetime import timedelta

TOP_N = 15       # hold at most the 15 strongest names
MIN_NAMES = 8    # diversification floor for per-name sizing
INDUSTRY_CAP = 3  # max names per 2-digit-SIC industry group (2026-07-23 review)


def cap_top15(rows):
    """rows: list of dicts with at least 'ticker' and 'roc_3m'. Sort by
    roc_3m descending, ticker ascending on ties, and return the first 15.

    Worked example: 20 candidates with roc_3m 1..20 -> the 15 rows with
    roc_3m 20 down to 6; two rows tied at roc_3m=6 keep the alphabetically
    earlier ticker."""
    return sorted(rows, key=lambda r: (-float(r["roc_3m"]), r["ticker"]))[:TOP_N]


def cap_top15_industry(rows, cap=INDUSTRY_CAP):
    """Selection rule since 2026-07-23 (backtested: 27.0%/yr vs 25.3%
    uncapped, smaller drawdown — Momentum_Sleeve_Review_2026-07-23.xlsx).

    Walk candidates by roc_3m descending (ticker asc on ties). Take a name
    unless its industry group ('sic2', 2-digit SIC) already has `cap` names
    selected; skipped names are replaced by the next-ranked candidates from
    other industries. Names with no industry mapping (sic2 None/'' ) are
    never capped. Stop at 15.

    Worked example: 6 software names ranked 1-6 plus 12 others ranked 7-18 ->
    software ranks 1,2,3 selected, ranks 4,5,6 skipped, and the final list is
    ranks 1,2,3,7,8,...,18 (15 names, exactly 3 software)."""
    sel, counts = [], {}
    for r in sorted(rows, key=lambda r: (-float(r["roc_3m"]), r["ticker"])):
        grp = r.get("sic2") or None
        if grp is not None and counts.get(grp, 0) >= cap:
            continue
        sel.append(r)
        if grp is not None:
            counts[grp] = counts.get(grp, 0) + 1
        if len(sel) == TOP_N:
            break
    return sel


def per_name_notional(capital, n):
    """Fixed notional per name: 0.0 if n <= 0, else capital / max(n, 8).
    The min-8 diversification floor means fewer than 8 names never get
    oversized — the unfilled slots stay in cash.

    Worked examples (capital 500000):
      n=3  -> 62500.0 per name (500K/8; 3 x 62.5K = 187.5K gross,
              312.5K stays in cash)
      n=14 -> 35714.285714... (500K/14)
      n=20 -> apply cap_top15 FIRST so n is at most 15 (500K/15 = 33333.33)
      n=0  -> 0.0 (CASH-sentinel month: everything stays in cash)"""
    if n <= 0:
        return 0.0
    return capital / max(n, MIN_NAMES)


def next_first_of_month(d):
    """Date of the 1st of the month after d.

    Worked examples: date(2026, 7, 15) -> date(2026, 8, 1);
    date(2026, 12, 31) -> date(2027, 1, 1) (year rollover)."""
    return (d.replace(day=1) + timedelta(days=32)).replace(day=1)
