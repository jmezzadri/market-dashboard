#!/usr/bin/env python3
"""
reconcile_technicals.py — Senior Quant gate for Phase 4.5 expansion.

Runs the legacy in-house indicators (RSI / MACD / ADX / SMA) and the
five new ones (Bollinger / ATR / OBV / Stochastic / Ichimoku) side-by-side
on a synthetic OHLCV dataset. Prints all values; asserts plausible ranges.

Used as a non-CI sanity check before merging the technicals expansion. The
new indicators are pure additions — none feed the existing tech_score —
so live-ticker backtesting was not required (Senior Quant gate). A live
yfinance reconciliation can be added as a follow-up if the consumer
surfaces want one.

Run:
    python3 trading-scanner/scripts/reconcile_technicals.py
"""
import os, sys, types
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Stub price_history.get_ohlcv so we can import without yfinance / network.
ph = types.ModuleType("scanner.price_history")
ph.get_ohlcv = lambda t: None
sys.modules["scanner.price_history"] = ph

from scanner.technicals import (  # noqa: E402
    _calc_rsi, _calc_macd_cross, _calc_adx,
    _calc_bollinger_bands, _calc_atr, _calc_obv,
    _calc_stochastic, _calc_ichimoku,
)


def synthetic_ohlcv(seed, n=200):
    rng = np.random.default_rng(seed)
    drift = 0.05 * rng.normal(0.5, 1.0)
    close = pd.Series(100 + np.cumsum(rng.normal(drift, 0.8, n)))
    high = close + np.abs(rng.normal(0, 0.6, n))
    low = close - np.abs(rng.normal(0, 0.6, n))
    volume = pd.Series(rng.integers(500_000, 2_500_000, n).astype(float))
    return close, high, low, volume


def reconcile_one(label, seed):
    close, high, low, volume = synthetic_ohlcv(seed)
    print(f"\n-- {label} (seed={seed}, last close={float(close.iloc[-1]):.2f}) --")

    rsi = _calc_rsi(close, 14)
    macd = _calc_macd_cross(close)
    adx = _calc_adx(high, low, close, 14)
    sma50 = float(close.rolling(50).mean().iloc[-1])
    sma200 = float(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None
    print(f"  legacy   RSI14={rsi:.1f}  MACD={macd}  ADX14={adx:.1f}"
          f"  SMA50={sma50:.2f}" + (f"  SMA200={sma200:.2f}" if sma200 else ""))

    bb = _calc_bollinger_bands(close, 20, 2.0)
    atr = _calc_atr(high, low, close, 14)
    obv = _calc_obv(close, volume)
    stoch = _calc_stochastic(high, low, close, 14, 3)
    ichi = _calc_ichimoku(high, low, close)

    print(f"  bollinger upper={bb[0]:.2f}  mid={bb[1]:.2f}  lower={bb[2]:.2f}"
          f"  %B={bb[3]:.3f}  bandwidth={bb[4]:.3f}")
    print(f"  ATR14    {atr:.3f}")
    print(f"  OBV      {obv:,.0f}")
    print(f"  stoch    %K={stoch[0]:.1f}  %D={stoch[1]:.1f}")
    print(f"  ichimoku tenkan={ichi[0]:.2f}  kijun={ichi[1]:.2f}"
          f"  senkouA={ichi[2]:.2f}  senkouB={ichi[3]:.2f}  chikou={ichi[4]:.2f}")

    assert 0 <= rsi <= 100, f"RSI out of range: {rsi}"
    assert macd in {"bullish", "bearish", "neutral"}, f"MACD label unknown: {macd}"
    assert adx >= 0, f"ADX negative: {adx}"
    assert bb[0] > bb[1] > bb[2], f"BB ordering: {bb[:3]}"
    assert 0 <= stoch[0] <= 100, f"%K out of [0,100]: {stoch[0]}"
    assert 0 <= stoch[1] <= 100, f"%D out of [0,100]: {stoch[1]}"
    assert atr > 0, f"ATR not positive: {atr}"
    mn, mx = float(low.min()), float(high.max())
    for nm, v in zip(["tenkan","kijun","sA","sB","chikou"], ichi):
        assert mn - 1 <= v <= mx + 1, f"{nm} out of [low_min,high_max]: {v}"


if __name__ == "__main__":
    print("Phase 4.5 -- Senior Quant reconciliation gate")
    print("=" * 60)
    for label, seed in [
        ("uptrend",    42),
        ("downtrend",  7),
        ("sideways",   123),
        ("high vol",   999),
    ]:
        reconcile_one(label, seed)
    print("\n" + "=" * 60)
    print("All reconciliation assertions PASSED")
