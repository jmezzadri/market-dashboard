# Trading Opportunities Screener — Phase 2 Backtest Report (Retail-Optimized)

**Date:** 2026-05-20
**Lead:** Senior Quant · **Consulted & signed off:** Lead Developer, Data Steward
**Branch:** `feature/quant-trading-opps-phase2-retail-recalibration`
**Engine:** `scanner/trading_opps/backtest_engine.py` · **Pinned results:** `backtest_results.json`

This is the Phase 2 deliverable from the Trading Opportunities overhaul — builds
the new screener's scoring engine, backtests it on real production data, and
calibrates every point value and the launch threshold from the results.

**Revision note.** The screener was first calibrated for an institutional-size
book on a $10M-per-day liquidity floor. On 2026-05-20 Joe re-scoped it for a
**retail account trading $10k–$30k positions** — at that size, running out of
daily volume or moving the price is not a concern. The liquidity floor was
therefore lowered, the screener re-calibrated, and **this report reflects the
retail-optimized run**. What the re-scope changed is called out throughout, and
summarized in Section 7.3.

---

## Section 1 — Headline

**The retail re-scope improved the screener materially. The long side has a
real and now-meaningfully-positive edge. The short side still does not work and
is held back.**

The calibrated long screener, over the one year of insider history we have,
surfaced names that — 21 trading days later (about one calendar month):

- went **up 59.1%** of the time,
- returned **+5.96% on average**,
- earned **$2.76 for every $1.00 lost** (profit factor 2.76),
- and beat the broad market by **+2.42%** per month.

For comparison, the same screener on the old institutional ($10M) liquidity
floor returned +3.84% with +0.54% market-beating edge. **Lowering the floor to
admit smaller stocks roughly quadrupled the market-relative edge** — exactly
what the first Phase 2 report predicted would happen (its caveat 11d noted the
insider edge is strongest in smaller, less-liquid names that the $10M floor was
screening out). The retail re-scope tested that prediction and confirmed it.

Two honest qualifications still stand:

1. **The sample is small and the window is short.** The screener launched 88
   long signals across a single 12-month, mostly-rising market. Enough to
   calibrate on; not a multi-cycle proof. Re-check as data deepens.

2. **The universe expanded only modestly** — 638 → 845 eligible insider-buy
   events. A great deal of insider buying happens at true micro-caps that trade
   below even $1.5M a day; the retail floor admits the small-but-tradeable
   names, not the genuinely tiny ones.

---

## Section 2 — How the new screener works, in plain English

The screener runs once after the close and scores every eligible US stock. A
name "launches" onto the buy list when its **long score** crosses a threshold.

Per the Phase 2 scoping decision (Option 1), the score is built from **two
layers**: the **insider layer** (executives buying their own stock — the
anchor) and the **trend layer** (a small adjustment so the screener never
chases a falling or badly overheated stock). The **dark-pool** and **options**
layers are built and collecting data nightly but contribute **zero points**
until they have enough of their own history to be backtested ("shadow mode").

**The gatekeeper.** Before any scoring, a stock must (a) trade at or above $5,
and (b) have a **90-day median daily dollar volume of at least $1.5 million**
(the retail liquidity floor — see Section 3). Anything failing either is dropped
and never scored.

**The insider layer — three rules**, scored over a rolling lookback window:

- **Rule A** — a CEO or CFO buying on the open market, in a trade that lifts
  their *personal* stake by at least 10% and is worth at least $100,000 (the
  "conviction" signal).
- **Rule B** — all insider buying in the window, added up, comes to at least
  0.05% of the company's market value (the "size" signal).
- **Rule C** — at least three *different* insiders buying in the window (the
  "consensus" signal).

Routine pre-scheduled trades and trades by 10%+ shareholders are excluded.

**The trend layer.** A small nudge: above the 200-day average price helps;
below it hurts; an overheated momentum reading (RSI above 65) hurts.

---

## Section 3 — The data, and its honest limits

Everything below was pulled live from the production database — no assumed
numbers.

| Feed | Pulled | Real coverage |
|---|---|---|
| Daily prices (`prices_eod`) | 1,332,397 rows, 12,669 tickers | 2003 → 2026-05-20, **but** the broad universe begins only **2025-02-03** |
| Insider filings (`insider_history`) | 31,405 open-market buys & sells | filing dates **2025-05-12 → 2026-05-19** (~12 months) |

**The retail liquidity floor.** Joe's re-scope changed the gatekeeper's volume
rule in two ways:

- **The threshold** dropped from **$10M to $1.5M** per day.
- **The statistic** moved from a 90-day *average* to a 90-day **median**.
  Median is the more honest liquidity gauge — it ignores one-off volume spikes
  and reflects what the stock trades on a *typical* day.

Both the backtest engine and the live universe builder (`universe.py`) were
updated together, so the screener that runs in production uses exactly the
universe this backtest calibrated on.

**The two data-window realities (unchanged from the first run, restated
honestly):**

| Layer | True backtest window | Quality |
|---|---|---|
| Insider | ~12 months (signal dates May 2025 – Apr 2026 for the 1-month horizon) | Thin but usable |
| Trend | ~6 months (Nov 2025 – May 2026 — the 200-day average needs 200 days of history, and the broad price history only starts Feb 2025) | Preliminary — one market regime |

**Universe size.** Of 4,112 eligible insider buys, **845** (ticker, filing-date)
buy events occurred at stocks clearing the retail $1.5M floor, across 523
companies — up from 638 events / 406 companies on the old $10M floor. The
expansion is real but modest: most insider buying happens at companies too
small to trade even $1.5M a day.

---

## Section 4 — Lookahead audit (done before any results were trusted)

A prior calibration was once wrong because of "lookahead" — using information
that would not have been known on the signal date. Auditing for this is
non-negotiable and was done **before** any result here was read.

By construction, every signal is dated to the day its information became public;
the trade is entered on the **next** trading day; the forward return is measured
strictly from there; the decision day's own close is never in the return. The
engine runs four programmatic checks each run — all pass:

| Check | Result |
|---|---|
| The 200-day average uses only prices on or before the signal day | PASS |
| The forward return enters on the next bar and looks only forward | PASS |
| The decision day's own close is excluded from the return | PASS |
| No forward return is fabricated past the end of the data | PASS |

An independent hand-trace of one real signal also confirmed it. **The strong
long-horizon numbers (Section 9) are *not* a lookahead bug** — they are
single-regime sample overlap, explained in the caveats.

---

## Section 5 — The insider layer: per-rule results (retail universe)

Each rule measured on its own, 30-day lookback, 1-month (T+21) horizon. "Alpha"
= the return minus the average eligible stock on the same day.

| Rule | Signals (n) | Win rate | Avg return | Alpha vs market | Profit factor |
|---|---:|---:|---:|---:|---:|
| **Rule A** — CEO/CFO conviction buy | 55 | **67.3%** | +4.69% | +0.92% | **2.66** |
| **Rule B** — large buying vs company size | 90 | 56.7% | **+5.95%** | **+2.55%** | 2.46 |
| **Rule C** — 3+ insiders buying together | 54 | 53.7% | +2.63% | −0.02% | 1.91 |
| **Any rule** (A, B or C fires) | 157 | 57.3% | +4.40% | +1.20% | 2.36 |
| *Reference:* any eligible insider buy, **no rule** | 595 | 55.1% | +2.10% | −0.78% | 1.63 |

**What this shows:**

- A plain, unfiltered insider buy barely beats nothing (−0.78% alpha). The three
  rules together lift the win rate to 57.3% and the alpha to +1.2%. **The rule
  filter is the edge.**
- **Rule B** is the powerhouse — the highest average return and clearly the best
  alpha (+2.55%).
- **Rule A** is the most *reliable* — two of every three names rose, best profit
  factor.
- **Rule C is now clearly the weakest.** On the larger retail sample its win
  rate is just 53.7% — barely above a coin flip — and its alpha is essentially
  zero. This is the one finding that changed the calibration (Section 7).

---

## Section 6 — The trend layer: results

Measured over its true window (Nov 2025 – May 2026, ~67,000 stock-week
observations). The trend layer is a *modifier*, judged on whether each effect
points the right way.

| Condition | Observations | Win rate | Avg return (21d) |
|---|---:|---:|---:|
| All names (baseline) | 55,117 | 54.2% | +1.76% |
| Above the 200-day line | 33,847 | 54.5% | +2.03% |
| Below the 200-day line | 21,270 | 53.8% | +1.32% |
| RSI above 65 (overbought) | 8,691 | 49.0% | +0.73% |
| RSI above 75 (very overbought) | 1,671 | 46.6% | +0.31% |
| RSI below 30 (oversold) | 2,648 | 63.0% | +3.57% |

Every trend effect points the right way: above the 200-day line beats the
baseline, below it lags, and the more overbought a stock the weaker its next
month. The effects are small — exactly what a modifier layer should be. The
directions are confirmed; the magnitudes are carried at the draft values
because six months of one bull market is not enough to fine-tune them.

---

## Section 7 — Calibration: the final retail-optimized numbers

### 7.1 — Insider point values: A = 4, B = 4, **C = 2**

Point values are set proportional to each rule's measured edge — the V5 method,
never gut-set. The quality score is win-rate × average-return (the screener's
two objectives), scaled so the strongest rule sits at the spec's ~4-point cap:

| Rule | Quality score | → Points |
|---|---:|---:|
| Rule B | 0.0337 | 4 |
| Rule A | 0.0316 | 4 |
| Rule C | 0.0141 | **2** |

Rules A and B both measure as strong and round to 4. **Rule C, on the larger
retail sample, measures materially weaker and drops from the draft's 3 to 2
points.** That is the single point-value change the re-scope produced — and it
is well-founded: Rule C's win rate is 53.7% and its alpha is zero.

In practice, C = 2 means **a "3+ insiders buying" signal on its own no longer
launches a name** — it now needs an uptrend (the +1 from the 200-day line) to
clear the launch threshold. The weakest rule must be confirmed before it acts.

### 7.2 — Lookback window: 30 days, and launch threshold: 3

The lookback window was tested at 14, 30 and 60 days — **statistically
indistinguishable** (any-rule win rate 57.3–57.8%, average return +4.2–4.6%).
The locked spec's preference for longer windows breaks the tie at **30 days**.

The launch threshold was swept across every reachable value:

| Threshold | Signals (n) | Win rate | Avg return | Profit factor | Worst-month drawdown | Risk-adjusted (Sharpe) |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 187 | 55.6% | +3.74% | 2.15 | −6.1% | 1.76 |
| 2 | 146 | 58.2% | +4.56% | 2.39 | −22.8% | 0.68 |
| **3** | **88** | **59.1%** | **+5.96%** | **2.76** | **−17.8%** | **1.48** |
| 4 | 82 | 57.3% | +4.46% | 2.26 | −27.5% | 0.70 |
| 5 | 5 | (too few to judge) | | | | |

**Threshold 3 is the pick** — the best win rate, the best average return, the
best profit factor, and a healthy risk-adjusted return. (Threshold 7, from the
original draft, assumed all four scoring layers were live; with only insider
and trend live the most a name can score is 5, so the threshold was re-set for
the real two-layer score.)

### 7.3 — What the retail re-scope changed

| Setting | Institutional ($10M) | **Retail ($1.5M median)** |
|---|---|---|
| Liquidity floor | $10M avg daily $-volume | **$1.5M median daily $-volume** |
| Rule A / Rule B points | 4 / 4 | 4 / 4 *(unchanged)* |
| **Rule C points** | 3 | **2** *(weakest rule, larger sample)* |
| Layer cap | 4 | 4 *(unchanged)* |
| Lookback window | 30 days | 30 days *(unchanged)* |
| Launch threshold | 3 | 3 *(unchanged)* |
| Trend points | +1 / −2 / −2 | +1 / −2 / −2 *(unchanged)* |

**Bottom line for Joe's question — "did the optimal settings change?":** Only
one number moved — **Rule C, from 3 points to 2** — because the larger universe
gave a big enough sample to see that the "3+ insiders" rule is the weakest of
the three. The lookback window, the launch threshold, the layer cap, and Rules
A and B all stayed exactly where they were. The headline change from the
re-scope is not the *settings* — it is the *performance* (Section 9).

---

## Section 8 — The permutation sweep

The engine swept **1,701 combinations** of window, rule points, cap and
threshold. The top performers cluster tightly and consistently want **Rule B
weighted highest and Rule C weighted lowest** — the same ranking the
calibration landed on. A representative slice (signals ≥ 60, by average return):

| Window | A / B / C | Cap | Threshold | Signals | Win rate | Avg return | Alpha |
|---|---|---:|---:|---:|---:|---:|---:|
| 30d | 3 / 5 / 2 | 6 | 4 | 74 | 56.8% | +7.16% | +3.47% |
| 60d | 3 / 5 / 2 | 6 | 4 | 77 | 58.4% | +6.97% | +3.37% |
| 14d | 4 / 5 / 2 | 6 | 4 | 95 | 60.0% | +6.44% | +2.83% |
| 14d | 4 / 3 / 2 | 6 | 4 | 54 | 70.4% | +6.36% | +2.77% |

The sweep's top rows all push Rule C down to 2 and never reward it above the
other two — independent confirmation of the Section 7 calibration. The chosen
configuration sits inside this top cluster; chasing the single highest row
would be fitting noise on samples this size.

---

## Section 9 — Final calibrated screener performance (retail)

Configuration: 30-day window, points **4 / 4 / 2**, cap 4, threshold 3.

| Horizon | Signals (n) | Win rate | Avg return | Median | Profit factor | Alpha vs market | Reliability |
|---|---:|---:|---:|---:|---:|---:|---|
| **1 month (T+21)** | **88** | **59.1%** | **+5.96%** | +3.01% | **2.76** | **+2.42%** | **Primary — trust this** |
| 3 months (T+63) | 86 | 51.2% | +11.4% | +0.73% | 2.70 | +4.76% | Directional only |
| 6 months (T+126) | 72 | 61.1% | +18.5% | +8.20% | 4.01 | +5.99% | **Do not trust — see caveats** |

**The 1-month horizon is the credible result and the basis for the
calibration.** Side by side with the institutional run:

| | Institutional ($10M) | Retail ($1.5M) |
|---|---:|---:|
| Signals | 82 | 88 |
| Win rate | 58.5% | **59.1%** |
| Average return | +3.84% | **+5.96%** |
| Alpha vs market | +0.54% | **+2.42%** |
| Profit factor | 2.10 | **2.76** |

Every metric improved. The re-scope worked.

**The 3- and 6-month numbers are deliberately flagged.** A 6-month forward
return requires the signal to be at least 6 months before the data ends, so all
of those observations come from the *earliest* slice of the insider history and
look forward into the *same* strong market. They are not independent bets — they
are one overlapping bet on one bull run. (The 6-month "0.0% drawdown" is the
tell.) This was audited: it is single-regime overlap, **not** a lookahead bug.
Quote the 1-month number; treat the longer horizons as "the trend continued, in
this one window."

---

## Section 10 — The short side: still an honest negative

Under Option 1 the short score is trend-only. Backtested directly on the retail
universe, the short list still has **no edge**: shorting the names it flagged
would have lost about **1.05% per month** (only 47% of them fell — the rest rose
in a bull market). The draft's insider-sell rule again produced **zero**
qualifying events.

**Recommendation unchanged: do not ship the short side as actionable.** Hold it
until the insider-sell, dark-pool and options layers come online with enough of
their own history to be backtested.

---

## Section 11 — Honesty caveats

- **11a. One short, single-regime window.** ~12 months of insider data, ~6 of
  trend data, all in a strong bull market (the average eligible stock rose ~3.5%
  every 21 days). A bull-market result is not a tested-through-a-correction
  result. Re-check when more — and more varied — history exists.
- **11b. The 3- and 6-month numbers are inflated by sample overlap** (Section 9).
  Only the 1-month horizon is calibration-grade.
- **11c. The benchmark is the broad-universe average, not the literal S&P 500.**
  There is no S&P 500 price series in the production database. "The market"
  here is the equal-weight average forward return of the eligible universe — a
  fair, arguably stricter yardstick. *Data Steward action item: register a daily
  S&P 500 feed.*
- **11d. Small samples.** 88 launched long signals; 54–90 per insider rule.
  Enough to calibrate and confirm a direction; not enough for precision. Expect
  the numbers to move on re-run.
- **11e. The universe expanded only modestly.** Insider buying concentrates in
  true micro-caps that trade below even $1.5M/day; those remain excluded. The
  retail floor admits the small-but-genuinely-tradeable tier, which is the right
  outcome for a $10k–$30k book.
- **11f. The common-stock filter is approximate** (an ETF name-list, since
  `prices_eod` has no asset-type field) — affects only the trend population,
  not the insider results.
- **11g. Returns are close-to-close, no dividends, survivorship-blind** — a mild
  upward bias, standard at this stage.

---

## Section 12 — Recommendation

**The screener clears the Phase 2 gate. Ship the long side on the
retail-calibrated configuration; hold the short side; re-calibrate on a
schedule.**

- **There is a real, improved edge.** 59.1% win rate, 2.76 profit factor, and
  +2.42% market-beating return per month — up sharply from the institutional
  calibration. The retail re-scope was the right call and the numbers prove it.
- **It remains a one-regime, small-sample result.** Ship it with eyes open; this
  is a calibrated, evidence-based config, not a multi-cycle proof.
- **The short side is not ready** — do not ship it as actionable.

**Next steps:**

1. **Ship the long side** with `calibrated_config.json` as delivered. Phase 3
   (the page rebuild) is unblocked.
2. **Hold the short side** until it can be backtested.
3. **Re-calibrate quarterly, and the moment a market correction enters the
   data.** Every number here rests on a 12-month bull-market sample.
4. **Data Steward:** register a daily S&P 500 feed; re-check the dark-pool and
   options shadow feeds in ~3 months for enough history to bring those layers
   into the score.

---

## Appendix — Calibrated configuration and artifacts

**Final `calibrated_config.json` (long side):**

```
Liquidity floor      : 90-day median daily dollar volume >= $1.5M
Price floor          : $5
Lookback window      : 30 days
Rule A (CEO/CFO buy) : 4 points
Rule B (size of buy) : 4 points
Rule C (3+ insiders) : 2 points    <- changed from 3 (retail re-scope)
Insider layer cap    : 4
Trend, above 200-day : +1
Trend, below 200-day : -2
Trend, RSI > 65      : -2
Launch threshold     : 3   (maximum attainable score: 5)
```

**Artifacts** (branch `feature/quant-trading-opps-phase2-retail-recalibration`):

- `scanner/trading_opps/backtest_engine.py` — the engine.
- `scanner/trading_opps/universe.py` — live universe builder, updated to the
  $1.5M median floor so production matches this backtest.
- `scanner/trading_opps/calibrated_config.json` — the retail-calibrated config
  the live engine reads.
- `scanner/trading_opps/backtest_results.json` — every number this report
  quotes, pinned.
- `scanner/trading_opps/test_backtest_engine.py` — 27 unit tests, all passing.

**Reproducibility.** `python3 backtest_engine.py` re-runs end to end in ~12
seconds; with production credentials in the environment it pulls fresh data
itself.

---

### Specialist sign-offs

- **Senior Quant (lead):** The retail re-scope is sound. Point values are
  re-derived from the larger sample by the same edge-proportional method;
  only Rule C moved, and the move is well-supported. Lookahead audit clean;
  long-horizon inflation caught and disclosed. Signed off.
- **Lead Developer (consulted):** Engine and live universe builder updated
  together so production matches the backtest; 27/27 unit tests pass; results
  reproducible. Signed off.
- **Data Steward (consulted):** Liquidity floor changed in both the engine and
  `universe.py`; the median statistic is the more robust liquidity gauge. Data
  windows stated honestly. Two follow-ups logged: register an S&P 500 daily
  feed; re-check the dark-pool/options shadow feeds in ~3 months. Signed off.
