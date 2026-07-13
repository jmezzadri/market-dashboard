#!/usr/bin/env python3
"""Unit tests for scripts/compute_divergences.py (pure math + detector).

Per the calculation-PR rule: the RSI expectations below were HAND-COMPUTED
from the definition (simple/Cutler RSI = SMA-14 of gains vs losses), not by
running the code:

  1) 16 straight up-closes            -> no losses -> RSI = 100 exactly.
  2) alternating +2/-1 (16 closes)    -> per 14-diff window: 7 gains of 2
     (avg 1.0) vs 7 losses of 1 (avg 0.5), RS = 2 -> RSI = 66.6667.
  3) classic 15-close set (44.00 ... 46.28): gains sum 3.68, losses sum 1.40
     -> avg 0.262857 / 0.100 -> RS 2.628571 -> RSI = 72.4409.

The synthetic bull-divergence series expectations (rsi1 = 0.0 exactly — the
14 diffs before the first pivot are all declines or flat; rsi2 = 30.19) were
likewise worked by hand from the diff table in comments below.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compute_divergences import rsi_simple, pivot_indices, detect_divergences  # noqa: E402

FAILURES = []


def check(label, cond):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        FAILURES.append(label)


def approx(a, b, tol=0.05):
    return a is not None and abs(a - b) <= tol


# 1) RSI: straight up -> 100
r = rsi_simple([100 + i for i in range(16)])
check("rsi all-up = 100", approx(r[14], 100.0, 1e-9) and approx(r[15], 100.0, 1e-9))
check("rsi warmup is None", all(v is None for v in r[:14]))

# 2) RSI: alternating +2/-1 -> 66.67 (hand: ag=1.0, al=0.5, RS=2)
closes = [100]
for _ in range(8):
    closes.append(closes[-1] + 2)
    closes.append(closes[-1] - 1)
closes = closes[:16]
r = rsi_simple(closes)
check("rsi alternating = 66.67", approx(r[14], 66.6667) and approx(r[15], 66.6667))

# 3) RSI: classic set -> 72.44 (hand: gains 3.68/14, losses 1.40/14)
classic = [44.00, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10,
           45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28]
r = rsi_simple(classic)
check("rsi classic = 72.44", approx(r[14], 72.44))

# 4) pivots: strict 5L/5R
lows = [10, 9, 8, 7, 6, 5, 4, 5, 6, 7, 8, 9, 10]
check("pivot low at index 6 only", pivot_indices(lows, "low") == [6])
check("pivot high none in V-shape", pivot_indices(lows, "high") == [])

# 5) detector: synthetic bull divergence
#    bars 0-19 flat 100; 20-25 fall to 88; 26-29 recover to 96;
#    30-34 gentle fall to 87.5; 35-39 recover to 94. lows = close-0.5.
#    Pivot lows at bar 25 (87.5) and bar 34 (87.0): price lower low.
#    Hand RSI: bar 25 diffs = 8 flat + 6 falls -> ag=0 -> RSI 0.0;
#    bar 34 diffs = -2*5, +3,+2,+2,+1, -1.5*4, -2.5 -> ag 8/14, al 18.5/14
#    -> RSI 30.19. bars_ago = 5, sep = 9, strong (rsi1 <= 30).
c = [100.0] * 20 + [98, 96, 94, 92, 90, 88] + [91, 93, 95, 96] + \
    [94.5, 93, 91.5, 90, 87.5] + [89, 91, 92, 93, 94]
lows = [x - 0.5 for x in c]
highs = [x + 0.5 for x in c]
res = detect_divergences(highs, lows, c)
check("exactly one divergence", len(res) == 1)
if res:
    d = res[0]
    check("direction bull", d["direction"] == "bull")
    check("px1 87.5 / px2 87.0", approx(d["px1"], 87.5, 1e-9) and approx(d["px2"], 87.0, 1e-9))
    check("rsi1 = 0.0 (hand)", approx(d["rsi1"], 0.0, 1e-9))
    check("rsi2 = 30.19 (hand)", approx(d["rsi2"], 30.19))
    check("bars_ago 5, sep 9", d["bars_ago"] == 5 and d["sep_bars"] == 9)
    check("strong flag set", d["strong"] is True)

# 6) sanity filter: pivot ratio / price band suppresses artifact
c2 = list(c)
c2[34] = 40.0  # fake split-like collapse at the newer pivot
lows2 = [x - 0.5 for x in c2]
highs2 = [x + 0.5 for x in c2]
check("split artifact suppressed", detect_divergences(highs2, lows2, c2) == [])

# 7) vwap disagreement drops the ticker
vw = [None] * len(c)
vw[-1] = c[-1] * 3.0  # 3x disagreement (real artifacts are ~10x)
check("vwap-vs-close disagreement drops ticker", detect_divergences(highs, lows, c, vw) == [])

# 8) bearish mirror: invert the bull series around 100
ci = [200 - x for x in c]
lows_i = [x - 0.5 for x in ci]
highs_i = [x + 0.5 for x in ci]
res = detect_divergences(highs_i, lows_i, ci)
check("mirror series yields one bearish", len(res) == 1 and res[0]["direction"] == "bear")
if res and res[0]["direction"] == "bear":
    check("bear higher high", res[0]["px2"] > res[0]["px1"])
    check("bear strong (rsi1 >= 70)", res[0]["strong"] is True)

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURES: {FAILURES}")
    sys.exit(1)
print("all tests pass")
