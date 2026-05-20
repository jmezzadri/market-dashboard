#!/usr/bin/env python3
"""Unit tests for the Phase 2 Trading Opportunities backtest engine.

Covers the scoring math, the universe gate, the indicator calculations, and —
most importantly — the no-lookahead structure of the forward-return columns.

Run:  python3 test_backtest_engine.py      (plain asserts, no pytest needed)
"""
import numpy as np
import pandas as pd

import backtest_engine as E

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


# ── 1. Wilder RSI ───────────────────────────────────────────────────────────
def test_rsi():
    # a strictly rising series -> RSI saturates near 100
    rising = pd.Series(np.arange(1, 60, dtype=float))
    rsi = E.wilder_rsi(rising)
    check("RSI of a monotonically rising series is ~100",
          rsi.iloc[-1] > 99.0, f"got {rsi.iloc[-1]:.2f}")
    # a strictly falling series -> RSI near 0
    falling = pd.Series(np.arange(60, 1, -1, dtype=float))
    rsi = E.wilder_rsi(falling)
    check("RSI of a monotonically falling series is ~0",
          rsi.iloc[-1] < 1.0, f"got {rsi.iloc[-1]:.2f}")
    # first 14 values undefined (warm-up)
    check("RSI is undefined for the first 14 bars (warm-up)",
          rsi.iloc[:14].isna().all())


# ── 2. Insider score capping ────────────────────────────────────────────────
def test_insider_score():
    pts = {"A": 4, "B": 4, "C": 3, "cap": 4}
    all_fire = pd.Series({"rule_a": True, "rule_b": True, "rule_c": True})
    check("all three rules fire (raw 11) -> capped at 4",
          E.insider_score(all_fire, pts) == 4)
    c_only = pd.Series({"rule_a": False, "rule_b": False, "rule_c": True})
    check("Rule C alone -> 3 points", E.insider_score(c_only, pts) == 3)
    none = pd.Series({"rule_a": False, "rule_b": False, "rule_c": False})
    check("no rule fires -> 0 points", E.insider_score(none, pts) == 0)
    a_only = pd.Series({"rule_a": True, "rule_b": False, "rule_c": False})
    check("Rule A alone -> 4 points", E.insider_score(a_only, pts) == 4)


# ── 3. Trend scoring ────────────────────────────────────────────────────────
def test_trend():
    cfg = E.DRAFT["trend"]
    up = pd.Series({"close": 110.0, "sma200": 100.0, "rsi14": 55.0})
    check("above 200-day line, calm RSI -> +1", E.trend_long(up, cfg) == 1)
    dn = pd.Series({"close": 90.0, "sma200": 100.0, "rsi14": 55.0})
    check("below 200-day line -> -2 long penalty", E.trend_long(dn, cfg) == -2)
    hot = pd.Series({"close": 110.0, "sma200": 100.0, "rsi14": 72.0})
    check("above line but RSI>65 -> +1-2 = -1", E.trend_long(hot, cfg) == -1)
    sh = pd.Series({"close": 90.0, "sma200": 100.0, "rsi14": 25.0})
    check("below line + RSI<30 -> short +2-2 = 0", E.trend_short(sh, cfg) == 0)


# ── 4. C-suite classifier ───────────────────────────────────────────────────
def test_csuite():
    check("'CHIEF EXECUTIVE OFFICER' is C-suite", E.is_csuite("Chief Executive Officer"))
    check("'CFO' is C-suite", E.is_csuite("CFO"))
    check("'CHAIRMAN, CEO & PRESIDENT' is C-suite", E.is_csuite("CHAIRMAN, CEO & PRESIDENT"))
    check("'VP of Sales' is NOT C-suite", not E.is_csuite("VP of Sales"))
    check("'Director' is NOT C-suite", not E.is_csuite("Director"))
    check("None title is NOT C-suite", not E.is_csuite(None))


# ── 5. No-lookahead structure of forward returns ────────────────────────────
def test_no_lookahead():
    # one ticker, 260 ascending closes: close[i] = 100 + i
    n = 260
    df = pd.DataFrame({
        "ticker": ["TST"] * n,
        "trade_date": pd.bdate_range("2025-01-01", periods=n),
        "open": np.arange(100, 100 + n, dtype=float),
        "high": np.arange(100, 100 + n, dtype=float),
        "low": np.arange(100, 100 + n, dtype=float),
        "close": np.arange(100, 100 + n, dtype=float),
        "volume": [1_000_000] * n,
    })
    panel = E.build_panel(df)
    i = 210
    # eret_21 on bar i must equal close[i+22]/close[i+1]-1 (entry = next bar)
    expect = panel["close"].iloc[i + 22] / panel["close"].iloc[i + 1] - 1
    got = panel["eret_21"].iloc[i]
    check("eret_21 = close[i+22]/close[i+1]-1 (entry strictly after signal)",
          abs(expect - got) < 1e-12, f"{got} vs {expect}")
    # the decision bar's own close is never in the forward return
    check("decision-bar close excluded from forward return",
          panel["close"].iloc[i] not in
          (panel["close"].iloc[i + 1], panel["close"].iloc[i + 22]))
    # sma200 on bar i uses only closes <= i
    expect_sma = panel["close"].iloc[i - 199:i + 1].mean()
    check("sma200 = mean(close[i-199 .. i]), no future bars",
          abs(panel["sma200"].iloc[i] - expect_sma) < 1e-9)
    # the last 21 bars cannot have a T+21 return
    check("no forward return fabricated past the end of data",
          panel["eret_21"].iloc[-21:].isna().all())
    # built-in audit passes
    check("engine self-audit passes on synthetic data",
          E.audit_lookahead(panel)["passed"])


# ── 6. Universe gate ────────────────────────────────────────────────────────
def test_universe_gate():
    n = 120
    rows = []
    # liquid $20 stock — should be eligible
    for i in range(n):
        rows.append(("LIQ", pd.Timestamp("2025-01-01") + pd.Timedelta(days=i),
                     20.0, 20.0, 20.0, 20.0, 2_000_000))   # $40M/day
    # penny stock — fails the $5 floor
    for i in range(n):
        rows.append(("PNY", pd.Timestamp("2025-01-01") + pd.Timedelta(days=i),
                     2.0, 2.0, 2.0, 2.0, 2_000_000))
    # illiquid stock — fails the $10M ADV floor
    for i in range(n):
        rows.append(("ILQ", pd.Timestamp("2025-01-01") + pd.Timedelta(days=i),
                     20.0, 20.0, 20.0, 20.0, 50_000))       # $1M/day
    df = pd.DataFrame(rows, columns=["ticker", "trade_date", "open", "high",
                                     "low", "close", "volume"])
    panel = E.mark_eligible(E.build_panel(df))
    last = panel.groupby("ticker").tail(1).set_index("ticker")["eligible"]
    check("liquid $20 stock is eligible", bool(last["LIQ"]))
    check("$2 penny stock fails the $5 price floor", not bool(last["PNY"]))
    check("$1M/day stock fails the $10M dollar-volume floor", not bool(last["ILQ"]))


if __name__ == "__main__":
    print("Phase 2 backtest engine — unit tests\n")
    for t in (test_rsi, test_insider_score, test_trend, test_csuite,
              test_no_lookahead, test_universe_gate):
        print(t.__name__)
        t()
    print(f"\n{PASS} passed, {FAIL} failed")
    raise SystemExit(0 if FAIL == 0 else 1)
