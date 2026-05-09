"""
Backtest harness for Signal Intelligence v2.

Computes the three calibration outputs the producer reads:

  1. Magnitude → average historical 21-day excess return vs SPY
  2. (Magnitude bucket × Agreement bucket) → empirical hit rate
  3. MT Score → 8-band cutoff stats (population %, hit rate per band)

Plus performance metrics:

  Information Ratio (annualized), hit rate, max drawdown, avg basket size,
  per-Signal ablation, walk-forward train/hold-out validation.

This module is the framework. The caller provides historical data as a
list of HistoricalDay records. The companion script
`scripts/run_backtest_v2.py` (next PR) wires up real data from Supabase
and writes the calibration JSONs to `public/calibration_v2_*.json`.

Per LESSONS rule (2026-04-30): every back-test number that ships in the
methodology page comes from this script's pinned JSON output, never
hand-quoted.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from typing import Any

from scanner.signal_intelligence_v2.rollup import (
    BAND_CUTOFFS,
    DEFAULT_WEIGHTS,
    SIGNAL_KEYS,
    compute_signal_intelligence,
)

# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class HistoricalDay:
    """One scan-day's worth of historical data."""
    date: str                                                   # 'YYYY-MM-DD'
    signals_by_ticker: dict[str, dict[str, int | None]]        # ticker → {insider, options, analyst, congress, technicals}
    universe: list[str]                                         # tickers eligible that day
    forward_21d_returns: dict[str, float]                       # ticker → 21-day total return (decimal, e.g. 0.025 for +2.5%)
    spy_forward_21d_return: float                               # SPY's 21-day forward return that day


@dataclass
class TickerOutcome:
    """One (day, ticker) scoring outcome paired with its forward outcome."""
    date: str
    ticker: str
    magnitude: int
    agreement_pct: float
    conviction_pct: float
    mt_score: int
    band: str
    forward_21d_excess: float                                   # ticker_return − spy_return (decimal)


# ─────────────────────────────────────────────────────────────────────────────
# Outcome computation
# ─────────────────────────────────────────────────────────────────────────────


def compute_ticker_outcomes(
    days: list[HistoricalDay],
    weights: dict[str, float] | None = None,
    conviction_table: dict | None = None,
    excess_return_curve: list[tuple[int, float]] | None = None,
) -> list[TickerOutcome]:
    """For each (day, ticker), score Signal Intelligence + record forward excess."""
    weights = weights or DEFAULT_WEIGHTS
    outcomes: list[TickerOutcome] = []
    for day in days:
        spy_ret = day.spy_forward_21d_return
        for ticker in day.universe:
            signals = day.signals_by_ticker.get(ticker, {})
            fwd_ret = day.forward_21d_returns.get(ticker)
            if fwd_ret is None:
                continue

            si = compute_signal_intelligence(
                insider=signals.get("insider"),
                options=signals.get("options"),
                analyst=signals.get("analyst"),
                congress=signals.get("congress"),
                technicals=signals.get("technicals"),
                weights=weights,
                conviction_table=conviction_table,
                excess_return_curve=excess_return_curve,
            )
            if si["magnitude"] is None:
                continue

            outcomes.append(TickerOutcome(
                date=day.date,
                ticker=ticker,
                magnitude=si["magnitude"],
                agreement_pct=si["agreement_pct"],
                conviction_pct=si["conviction_pct"],
                mt_score=si["mt_score"],
                band=si["band"],
                forward_21d_excess=fwd_ret - spy_ret,
            ))
    return outcomes


# ─────────────────────────────────────────────────────────────────────────────
# Calibration outputs (the three JSONs the producer reads)
# ─────────────────────────────────────────────────────────────────────────────


MIN_OBS_PER_BUCKET = 5  # require ≥5 historical observations for a stable estimate


def build_excess_return_curve(
    outcomes: list[TickerOutcome],
    bucket_size: int = 5,
) -> list[dict[str, Any]]:
    """
    Bucket outcomes by Magnitude, compute mean forward 21-day excess vs SPY.

    Returns:
        List of {"magnitude_center": int, "mean_excess_pct": float, "n_obs": int}
        sorted by magnitude_center ascending.
    """
    buckets: dict[int, list[float]] = {}
    for o in outcomes:
        center = (o.magnitude // bucket_size) * bucket_size
        buckets.setdefault(center, []).append(o.forward_21d_excess)

    rows: list[dict[str, Any]] = []
    for center in sorted(buckets.keys()):
        vals = buckets[center]
        if len(vals) < MIN_OBS_PER_BUCKET:
            continue
        rows.append({
            "magnitude_center": center,
            "mean_excess_pct": round(statistics.mean(vals) * 100, 4),  # convert decimal→%
            "n_obs": len(vals),
        })
    return rows


def build_conviction_table(
    outcomes: list[TickerOutcome],
    agreement_buckets: tuple[int, ...] = (20, 40, 60, 80, 100),
    magnitude_bucket_size: int = 25,
) -> dict[int, list[dict[str, Any]]]:
    """
    For each agreement bucket, build a (|magnitude| → hit_rate%) curve.

    A "hit" is defined directionally:
      - magnitude > 0 → hit if forward_21d_excess > 0
      - magnitude < 0 → hit if forward_21d_excess < 0

    Returns:
        {agreement_bucket_pct: [{"abs_magnitude": int, "hit_rate_pct": float, "n_obs": int}, ...]}
    """
    bucketed: dict[int, dict[int, list[bool]]] = {b: {} for b in agreement_buckets}

    for o in outcomes:
        nearest_agr = min(agreement_buckets, key=lambda b: abs(b - o.agreement_pct))
        abs_mag = (abs(o.magnitude) // magnitude_bucket_size) * magnitude_bucket_size

        if o.magnitude > 0:
            hit = o.forward_21d_excess > 0
        elif o.magnitude < 0:
            hit = o.forward_21d_excess < 0
        else:
            hit = abs(o.forward_21d_excess) < 1e-9

        bucketed[nearest_agr].setdefault(abs_mag, []).append(hit)

    table: dict[int, list[dict[str, Any]]] = {}
    for agr, mag_dict in bucketed.items():
        rows = []
        for mag in sorted(mag_dict.keys()):
            hits = mag_dict[mag]
            if len(hits) < MIN_OBS_PER_BUCKET:
                continue
            rows.append({
                "abs_magnitude": mag,
                "hit_rate_pct": round(100.0 * sum(hits) / len(hits), 2),
                "n_obs": len(hits),
            })
        if rows:
            table[agr] = rows
    return table


def build_band_stats(
    outcomes: list[TickerOutcome],
) -> list[dict[str, Any]]:
    """
    Per-band performance: population %, mean excess return, hit rate, ranges.

    Used for Phase E to validate the 8-band cutoffs against the data.
    Returns one row per band (label, mt_score range, n_obs, mean_excess_pct, hit_rate_pct).
    """
    band_outcomes: dict[str, list[TickerOutcome]] = {}
    for o in outcomes:
        band_outcomes.setdefault(o.band, []).append(o)

    n_total = sum(len(v) for v in band_outcomes.values())
    band_order = [label for _, label in BAND_CUTOFFS] + ["No Data"]

    rows: list[dict[str, Any]] = []
    for label in band_order:
        if label not in band_outcomes:
            continue
        vals = band_outcomes[label]
        excesses = [o.forward_21d_excess for o in vals]
        hits = [
            (o.forward_21d_excess > 0 if o.mt_score > 0 else o.forward_21d_excess < 0)
            for o in vals
        ]
        rows.append({
            "band": label,
            "n_obs": len(vals),
            "population_pct": round(100.0 * len(vals) / n_total, 2) if n_total else 0.0,
            "mean_excess_pct": round(statistics.mean(excesses) * 100, 4),
            "hit_rate_pct": round(100.0 * sum(hits) / len(hits), 2),
        })
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Performance metrics
# ─────────────────────────────────────────────────────────────────────────────


PERIODS_PER_YEAR = 12.0  # ~21-trading-day rebalance ≈ 12 periods/year


def compute_basket_performance(
    outcomes: list[TickerOutcome],
    buy_threshold: float = 50.0,
    use_mt_score: bool = True,
) -> dict[str, Any]:
    """
    Equal-weighted Buy basket = tickers with MT Score (or Magnitude) ≥ threshold.

    Returns: {n_periods, info_ratio, hit_rate_pct, max_drawdown, avg_basket_size,
              mean_excess_pct}.
    """
    by_date: dict[str, list[TickerOutcome]] = {}
    for o in outcomes:
        by_date.setdefault(o.date, []).append(o)

    score_fn = (lambda o: o.mt_score) if use_mt_score else (lambda o: o.magnitude)

    daily_basket_excess: list[float] = []
    daily_basket_size: list[int] = []
    for date in sorted(by_date.keys()):
        day = by_date[date]
        basket = [o for o in day if score_fn(o) >= buy_threshold]
        if not basket:
            continue
        basket_excess = statistics.mean(o.forward_21d_excess for o in basket)
        daily_basket_excess.append(basket_excess)
        daily_basket_size.append(len(basket))

    if not daily_basket_excess:
        return {
            "n_periods": 0, "info_ratio": None, "hit_rate_pct": None,
            "max_drawdown": None, "avg_basket_size": 0, "mean_excess_pct": None,
        }

    n = len(daily_basket_excess)
    mean_excess = statistics.mean(daily_basket_excess)
    sd_excess = statistics.stdev(daily_basket_excess) if n > 1 else 0.0
    info_ratio = (mean_excess / sd_excess * math.sqrt(PERIODS_PER_YEAR)) if sd_excess > 0 else 0.0
    hit_rate = 100.0 * sum(1 for e in daily_basket_excess if e > 0) / n

    # Compounded equity curve and max drawdown
    cumulative = 1.0
    peak = 1.0
    max_dd = 0.0
    for e in daily_basket_excess:
        cumulative *= (1.0 + e)
        peak = max(peak, cumulative)
        dd = (peak - cumulative) / peak
        max_dd = max(max_dd, dd)

    return {
        "n_periods": n,
        "info_ratio": round(info_ratio, 3),
        "hit_rate_pct": round(hit_rate, 2),
        "max_drawdown": round(max_dd, 4),
        "avg_basket_size": round(statistics.mean(daily_basket_size), 1),
        "mean_excess_pct": round(mean_excess * 100, 4),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Signal ablation (which Signals are doing real work?)
# ─────────────────────────────────────────────────────────────────────────────


def signal_ablation(
    days: list[HistoricalDay],
    weights: dict[str, float] | None = None,
    buy_threshold: float = 50.0,
) -> dict[str, dict[str, Any]]:
    """
    Run the back-test once with all Signals, then once for each Signal turned off.
    Compare performance — Signals that contribute real alpha will degrade the
    basket when ablated.

    Returns: {"__baseline__": perf, "insider": perf, "options": perf, ...}
    """
    weights = weights or DEFAULT_WEIGHTS
    results: dict[str, dict[str, Any]] = {}

    # Baseline (all Signals)
    baseline = compute_ticker_outcomes(days, weights)
    results["__baseline__"] = compute_basket_performance(baseline, buy_threshold)

    # Ablate one Signal at a time
    for sig_key in SIGNAL_KEYS:
        ablated_days = [
            HistoricalDay(
                date=d.date,
                signals_by_ticker={
                    t: {**s, sig_key: None} for t, s in d.signals_by_ticker.items()
                },
                universe=d.universe,
                forward_21d_returns=d.forward_21d_returns,
                spy_forward_21d_return=d.spy_forward_21d_return,
            )
            for d in days
        ]
        ablated = compute_ticker_outcomes(ablated_days, weights)
        results[sig_key] = compute_basket_performance(ablated, buy_threshold)

    return results


# ─────────────────────────────────────────────────────────────────────────────
# Walk-forward (train calibration on history, evaluate on hold-out)
# ─────────────────────────────────────────────────────────────────────────────


def walk_forward(
    all_days: list[HistoricalDay],
    train_until: str,
    weights: dict[str, float] | None = None,
    buy_threshold: float = 50.0,
) -> dict[str, Any]:
    """
    Walk-forward back-test: train calibration on days ≤ train_until,
    evaluate the trained calibration on days > train_until.

    Returns:
        {
            "train_period": {start, end, n_days},
            "holdout_period": {start, end, n_days},
            "calibration": {n_excess_buckets, n_conviction_agr_buckets},
            "holdout_performance": {... compute_basket_performance ...},
        }
    """
    weights = weights or DEFAULT_WEIGHTS
    train = [d for d in all_days if d.date <= train_until]
    holdout = [d for d in all_days if d.date > train_until]

    if not train:
        return {"error": "no train data"}
    if not holdout:
        return {"error": "no hold-out data"}

    # Train: build calibration tables from training outcomes
    train_outcomes = compute_ticker_outcomes(train, weights)
    excess_curve_rows = build_excess_return_curve(train_outcomes)
    conviction_table_rows = build_conviction_table(train_outcomes)

    # Convert calibration outputs to producer-consumable shapes
    cv_table_for_producer: dict[int, list[tuple[int, float]]] = {
        agr: [(row["abs_magnitude"], row["hit_rate_pct"]) for row in curve]
        for agr, curve in conviction_table_rows.items()
        if curve
    }
    excess_curve_for_producer: list[tuple[int, float]] = [
        (row["magnitude_center"], row["mean_excess_pct"])
        for row in excess_curve_rows
    ]

    holdout_outcomes = compute_ticker_outcomes(
        holdout,
        weights,
        conviction_table=cv_table_for_producer or None,
        excess_return_curve=excess_curve_for_producer or None,
    )
    perf = compute_basket_performance(holdout_outcomes, buy_threshold)

    return {
        "train_period": {
            "start": train[0].date,
            "end": train[-1].date,
            "n_days": len(train),
        },
        "holdout_period": {
            "start": holdout[0].date,
            "end": holdout[-1].date,
            "n_days": len(holdout),
        },
        "calibration": {
            "n_excess_buckets": len(excess_curve_rows),
            "n_conviction_agr_buckets": len(conviction_table_rows),
        },
        "holdout_performance": perf,
    }
