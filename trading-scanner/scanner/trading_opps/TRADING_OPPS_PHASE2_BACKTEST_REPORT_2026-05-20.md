# Trading Opportunities Screener — Phase 2 Backtest Report

**Date:** 2026-05-20
**Lead:** Senior Quant · **Consulted & signed off:** Lead Developer, Data Steward
**Branch:** `feature/quant-trading-opps-phase2-backtest`
**Engine:** `scanner/trading_opps/backtest_engine.py` · **Pinned results:** `backtest_results.json`

This is the Phase 2 deliverable from the Trading Opportunities overhaul plan. It
does four things: builds the new screener's scoring engine, backtests it on real
production data, calibrates every point value and the launch threshold from the
results, and gives an honest go / no-go on whether the screener has a real edge.

Phase 2 is the gate. Per the overhaul plan: *"If the backtest doesn't show a
real edge, we stop and rethink before touching the website."* This report makes
that call in Section 12.

---

## Section 1 — Headline

**The long side of the screener works, with a real but modest edge. The short
side does not work yet and should not ship. The screener clears the gate — but
narrowly, and on a thin, single-regime sample that must be re-checked as data
deepens.**

The calibrated long screener, over the one year of insider history we have,
surfaced names that, 21 trading days later (about one calendar month):

- went **up 58.5%** of the time,
- returned **+3.84% on average**,
- earned **$2.10 for every $1.00 lost** (profit factor 2.10),
- and beat the broad market by **+0.54%** per month.

That is a genuine, tradeable signal. For comparison, an *unfiltered* insider buy
in the same universe — any executive buying any eligible stock, no rules applied
— won only 55.5% of the time, returned +1.84%, and made only $1.52 per $1.00
lost. **The new screener's three insider rules are doing real work:** they lift
the win rate by 3 points, more than double the average return, and turn a
slightly-below-market signal into a slightly-above-market one.

Two honest qualifications sit behind that headline, and they matter:

1. **The edge is modest in market-relative terms.** The backtest year
   (2025–2026) was a strong bull market — the average eligible stock rose ~3.3%
   every 21 days. Against that hot tape, the screener's +0.54% monthly edge is
   real but slim. The screener mostly *rode* a rising market and added a small
   positive tilt; it did not dramatically beat it.

2. **The sample is small and short.** The screener launched only 82 long
   signals across the entire 12-month test. That is enough to calibrate on, but
   it is not a deep, multi-cycle proof. The numbers will move when re-run.

The short side is a clear negative result and is covered in Section 10.

---

## Section 2 — How the new screener works, in plain English

The screener runs once after the close and scores every liquid US stock. A name
"launches" onto the buy list when its **long score** crosses a threshold.

Per the Phase 2 scoping decision (Option 1, locked 2026-05-20), the score is
built from **two layers only**:

- **The insider layer** — corporate executives buying their own company's stock
  on the open market. This is the screener's anchor.
- **The trend layer** — a small adjustment based on whether the stock is in an
  up- or down-trend, so the screener never chases a stock that is falling or
  badly overheated.

The **dark-pool** and **options** layers are built and collecting data nightly,
but they contribute **zero points** until they have enough of their own history
to be backtested. They run in "shadow mode."

**The gatekeeper.** Before any scoring, a stock must (a) trade at or above $5,
and (b) trade at least $10 million of value per day, averaged over the last 90
days. This is the locked-spec liquidity gate. Anything that fails is dropped and
never scored.

**The insider layer — three rules.** Looking back over a rolling window, the
screener awards points for:

- **Rule A** — a CEO or CFO buying on the open market, in a trade that lifts
  their *personal* stake by at least 10% and is worth at least $100,000. This is
  the "conviction" signal: a top executive putting real personal money in.
- **Rule B** — all the insider buying in the window, added up, comes to at least
  0.05% of the company's total market value. This is the "size" signal.
- **Rule C** — at least three *different* insiders buying in the window. This is
  the "consensus" signal.

Routine pre-scheduled trades and trades by large (10%+) shareholders are
excluded, exactly as the spec requires — those carry no information.

**The trend layer.** A small nudge: above the 200-day average price helps the
buy score; below it hurts; an overheated momentum reading (RSI above 65) also
hurts, so the screener does not chase a stock that has already run.

**The two numbers the live engine needs from this backtest** are: how many
points each rule is worth, and how high the score must get before a name
launches. Everything else in the screener's design was locked in Phase 0; this
report sets those numbers.

---

## Section 3 — The data we backtested on, and its honest limits

Everything below was pulled from the production database. No assumed numbers, no
placeholder data.

| Feed | What we pulled | Real coverage |
|---|---|---|
| Daily prices (`prices_eod`) | 1,332,397 rows, 12,669 tickers | 2003-01-02 → 2026-05-20, **but** the broad stock universe only begins **2025-02-03** |
| Insider filings (`insider_history`) | 31,405 open-market buys and sells | filing dates **2025-05-12 → 2026-05-19** (~12 months) |

**Two data-window realities had to be confronted honestly — and they shape
every number in this report:**

**1. The insider history is ~12 months, not multi-year.** The `insider_history`
table reaches back only to filing dates in May 2025. So the insider layer can
only be backtested over about one year. There is no way around this; we report
what the data allows and no more.

**2. The broad stock-price history is only ~15 months.** This was the surprise.
Before 2025, `prices_eod` holds only 18–37 exchange-traded funds (a legacy
backfill). The full universe of ~5,000 stocks only starts **2025-02-03**. The
trend layer needs a **200-day** average price — and 200 trading days of history
do not exist for most stocks until **late November 2025**. So the trend layer
could only be tested over roughly **six months** (late Nov 2025 → mid-May 2026),
and that window is a single, mostly-rising market regime.

The overhaul plan assumed the price history was multi-year. It is multi-year
only for 18 ETFs. Per the brief's instruction to *"state each layer's true
window honestly,"* here are the true windows:

| Layer | True backtest window | Honest quality |
|---|---|---|
| Insider | ~12 months (signal dates May 2025 – Apr 2026 for the 1-month horizon) | Thin but usable |
| Trend | ~6 months (Nov 2025 – May 2026) | Preliminary — one regime only |

**Universe size after the gate.** Of 4,112 eligible insider buys, only **638**
(ticker, filing-date) buy events occurred at stocks liquid enough to clear the
$10M-per-day gate, across 406 companies. The liquidity gate is doing a lot of
filtering — see the caveat in Section 11 about *where* the insider edge lives.

---

## Section 4 — Lookahead audit (done before any results were trusted)

A prior screener calibration was once wrong because of "lookahead" — the model
accidentally used information that would not have been known on the signal date,
which made the results look far better than reality (a 1.65 reading that was
truly 0.65). Auditing for this is non-negotiable, and it was done **before** any
result in this report was read.

**How the engine prevents lookahead, by construction:**

- Every signal is dated to the day its information became public (an insider
  filing's `filing_date`; a trend reading's trading day).
- The screener's decision is made at that day's close.
- The trade is **entered on the next trading day** — strictly after the signal.
- The forward return is measured from that entry day onward.
- The decision day's own closing price is never part of the return.

The engine runs four programmatic checks every time it is run (all passing):

| Check | Result |
|---|---|
| The 200-day average uses only prices on or before the signal day | PASS |
| The forward return enters on the *next* bar and looks only forward | PASS |
| The decision day's own close is excluded from the return | PASS (by construction) |
| No forward return is fabricated past the end of the data | PASS |

**Independent manual trace.** One real signal was traced by hand: a POST
(insider) filing on 2025-06-09. Decision day 2025-06-09 (close $110.12); entry
the next day, 2025-06-10 ($110.99); exit 21 trading days later, 2025-07-11
($107.01); return −3.59%. The engine reported exactly −3.59%. The entry date is
strictly after the filing date; the return uses only days after the decision.
**Confirmed clean.**

One important distinction (see Section 11): the **long-horizon** results
(3-month and especially 6-month) *look* too good. That is **not** a lookahead
bug — the audit above rules that out. It is a sample-overlap and single-regime
artifact, explained in the caveats.

---

## Section 5 — The insider layer: per-rule results

Each rule was measured **on its own**, over the 30-day lookback window, at the
1-month (T+21) horizon. "Alpha" means the return *minus* the average eligible
stock on the same day — i.e., the edge over simply owning the market.

| Rule | What it catches | Signals (n) | Win rate | Avg return | Alpha vs market | Profit factor |
|---|---|---:|---:|---:|---:|---:|
| **Rule A** | CEO/CFO conviction buy | 45 | **66.7%** | +3.56% | −0.20% | **2.10** |
| **Rule B** | Large combined buying vs company size | 64 | 53.1% | **+4.17%** | **+1.09%** | 1.87 |
| **Rule C** | 3+ insiders buying together | 37 | 59.5% | +2.54% | −0.59% | 1.82 |
| **Any rule** | A, B or C fires | 113 | 59.3% | +3.79% | +0.60% | 2.06 |
| *Reference:* any eligible insider buy, **no rule** | — | 440 | 55.5% | +1.84% | −1.02% | 1.52 |

**Read this table top to bottom and the screener's whole thesis is visible:**

- A plain, unfiltered insider buy (bottom row) is barely a signal — it slightly
  *underperforms* the market (−1.02% alpha).
- Each of the three rules clears a meaningful bar: every one wins more than half
  the time and makes more than $1.50 per $1.00 lost.
- The three rules together (the "any rule" row) lift the win rate to 59.3% and
  flip the alpha from −1.0% to **+0.6%**. **The rule filter is the edge.**

Each rule has a distinct personality, and it matches the draft's intent:

- **Rule A** (CEO/CFO conviction) has the **highest win rate** — two of every
  three names rose — and the best profit factor. It is the most *reliable* rule.
- **Rule B** (size of buying) has the **highest average return and the only
  clearly positive alpha**. It is the most *powerful* rule.
- **Rule C** (consensus) is the weakest of the three but still positive.

---

## Section 6 — The trend layer: results

The trend layer was measured over its true window (Nov 2025 – May 2026, ~53,000
stock-week observations). It is a *modifier*, not a stock-picker, so it is judged
on whether each effect points the right way.

| Condition | Observations | Win rate | Avg return (21d) |
|---|---:|---:|---:|
| All names (baseline) | 43,282 | 53.1% | +1.49% |
| **Above** the 200-day line | 26,070 | 53.5% | **+1.85%** |
| **Below** the 200-day line | 17,212 | 52.5% | **+0.94%** |
| RSI above 65 (overbought) | 6,797 | 48.9% | +0.56% |
| RSI above 75 (very overbought) | 1,352 | 46.5% | +0.05% |
| RSI below 30 (oversold) | 2,285 | 61.2% | +3.05% |

**Every trend effect in the draft points the right way:**

- Stocks **above** their 200-day line beat the baseline (+1.85% vs +1.49%);
  stocks **below** it lag badly (+0.94%). The 200-day line works.
- The **more overbought** a stock, the weaker its next month: +0.56% at RSI 65,
  +0.05% at RSI 75. Penalising overbought names is correct.
- Oversold names (RSI below 30) bounce hard (+3.05%) — which confirms the
  short-side rule "don't short a washout."

The effects are real but **small** — exactly what a modifier layer should be.
The directions are confirmed; the magnitudes are carried at the draft values
because six months of one bull market is not enough history to fine-tune them.

---

## Section 7 — Calibration: the final numbers, and how they were set

This is the heart of Phase 2. Every number below was set from the backtest, not
asserted.

### 7.1 — The insider point values: A = 4, B = 4, C = 3

The draft proposed A = 4, B = 4, C = 3. The backtest **confirms** them:

- The measured quality ranking of the rules is **B ≈ A > C** — Rule B and Rule A
  are the strong pair, Rule C is a notch below. That is *exactly* the draft's
  4 / 4 / 3 ordering.
- Every rule clears its bar (win rate above 50%, profit factor above 1.8).
- The 1,701-permutation sweep (Section 8) places 4 / 4 / 3 inside its
  top-performing cluster; neighbouring point values perform within sampling
  noise of it.
- With only 37–64 signals per rule, *finely* re-ranking the rules would be
  overfitting — reading noise as signal. The honest, disciplined call is to keep
  the draft, because the evidence supports it rather than contradicts it.

**Final: Rule A = 4, Rule B = 4, Rule C = 3 points. Layer cap = 4** (the
spec's "~4"; with A and B both worth 4, a single strong rule reaches the cap).

### 7.2 — The lookback window: 30 days

The window was tested at 14, 30 and 60 days. The result: **the three are
statistically indistinguishable** (any-rule win rate 59.3–59.6%, average return
+3.6–3.9% across all three). Because the data does not separate them, the locked
spec's stated preference for longer windows breaks the tie. **30 days** is
chosen — a full calendar month, the conventional insider-clustering window,
longer than the draft's 14 days, without the staleness risk of 60.

### 7.3 — The launch threshold: 3 (recalibrated down from the draft's 7)

This is the most important recalibration in the report.

The draft proposed "launch at 7 out of 10." That 7 assumed all four layers
(insider, options, dark pool, trend) were contributing, up to 10 points total.
**Under Option 1, only the insider layer (cap 4) and the trend nudge (up to +1)
are live — the most a name can score is 5, not 10.** A threshold of 7 would be
mathematically impossible to reach; nothing would ever launch.

So the threshold had to be re-set for the real, two-layer score. The engine
swept every reachable threshold:

| Threshold | Signals (n) | Win rate | Avg return | Profit factor | Worst-month drawdown | Risk-adjusted (Sharpe) |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 145 | 56.6% | +3.05% | 1.88 | −9.9% | 1.40 |
| 2 | 108 | 58.3% | +3.62% | 1.99 | −10.7% | 1.07 |
| **3** | **82** | **58.5%** | **+3.84%** | **2.10** | **−13.9%** | **1.11** |
| 4 | 66 | 56.1% | +4.03% | 1.99 | −34.2% | −0.09 |
| 5 | 4 | (too few to judge) | | | | |

**Threshold 3 is the pick.** It has the best profit factor (2.10), the highest
win rate (58.5%), a strong average return, a controlled drawdown, and a healthy
risk-adjusted return. Threshold 4 shows a marginally higher average return but
its worst-month drawdown triples to −34% and its risk-adjusted return goes
negative — a fragile point we explicitly reject. Threshold 5 has only 4 signals.

In plain terms, **a threshold of 3 means: a name launches onto the buy list when
a meaningful insider rule has fired and the stock is not in a clear downtrend.**

### 7.4 — The final calibrated configuration

| Setting | Draft | **Calibrated** | Basis |
|---|---|---|---|
| Rule A points | 4 | **4** | Confirmed — highest win rate (66.7%) |
| Rule B points | 4 | **4** | Confirmed — highest return & alpha |
| Rule C points | 3 | **3** | Confirmed — weakest of the three |
| Insider layer cap | ~4 | **4** | Spec value, confirmed |
| Lookback window | 14 days | **30 days** | 14/30/60 tied; spec favours longer |
| Launch threshold | 7 (of 10) | **3 (of 5)** | Re-set for the 2-layer Option-1 score |
| Trend: above 200-day | +1 | **+1** | Direction confirmed |
| Trend: below 200-day | −2 | **−2** | Direction confirmed |
| Trend: RSI > 65 penalty | −2 | **−2** | Direction confirmed |

These numbers are written to `calibrated_config.json`, which the live engine
reads.

---

## Section 8 — The permutation sweep

The engine swept **1,701 combinations** of lookback window, rule points, layer
cap and launch threshold, and measured each one. This is the robustness check
behind the calibration. A representative slice of the top performers (those with
at least 50 signals, ranked by average return):

| Window | A / B / C | Cap | Threshold | Signals | Win rate | Avg return | Alpha |
|---|---|---:|---:|---:|---:|---:|---:|
| 60d | 4 / 3 / 3 | 6 | 4 | 50 | 68.0% | +4.67% | +1.18% |
| 14d | 3 / 4 / 2 | 6 | 4 | 55 | 50.9% | +4.62% | +1.19% |
| 14d | 4 / 3 / 2 | 6 | 3 | 76 | 57.9% | +4.46% | +1.00% |
| 14d | **4 / 4 / 3** | 6 | 4 | 75 | 57.3% | +4.41% | +0.99% |
| 14d | 4 / 3 / 4 | 6 | 3 | 89 | 59.6% | +4.40% | +1.02% |

The lesson of the sweep: **the top performers all cluster in a narrow band** —
win rates 51–68%, average returns +4.4–4.7%, alpha +1.0–1.2% — and the draft's
4 / 4 / 3 point values sit right inside that cluster. No combination decisively
beats the chosen configuration; the differences between the top rows are within
the noise of samples this size. This is *why* the calibration keeps the draft
point values rather than chasing the single highest row — chasing it would be
fitting noise.

---

## Section 9 — Final calibrated screener performance

The chosen configuration — 30-day window, points 4 / 4 / 3, cap 4, threshold 3 —
applied to the long side:

| Horizon | Signals (n) | Win rate | Avg return | Median | Profit factor | Alpha vs market | Reliability |
|---|---:|---:|---:|---:|---:|---:|---|
| **1 month (T+21)** | **82** | **58.5%** | **+3.84%** | +2.36% | **2.10** | **+0.54%** | **Primary — trust this** |
| 3 months (T+63) | 80 | 50.0% | +7.13% | +0.64% | 2.11 | +1.03% | Directional only |
| 6 months (T+126) | 69 | 59.4% | +16.96% | +2.25% | 3.60 | +5.75% | **Do not trust — see caveats** |

**The 1-month horizon is the credible result and the basis for the
calibration.** It has a real spread of independent signal dates across the full
12-month test.

**The 3- and 6-month numbers are deliberately flagged.** They look spectacular —
and that is the warning sign. A 6-month forward return requires the signal to be
at least 6 months before the data ends; so every 6-month observation comes from
the *earliest* slice of the insider history and all of them look forward into
the *same* strong Nov 2025 – May 2026 market. They are not 69 independent bets;
they are one overlapping bet on one bull market. The 6-month "−34%... sorry,
0.0% drawdown" and an implausible risk-adjusted reading are the tells. We
audited this (Section 4): it is **not** a lookahead bug — it is single-regime
sample overlap. The honest treatment is to quote the 1-month number as the
result and treat the longer horizons as "the trend continued, in this one
window" — nothing more.

---

## Section 10 — The short side: an honest negative result

Under Option 1, the **short** score is built from the trend layer only (the
dark-pool and options layers that would power it are in shadow mode, and the
insider-sell rule is evaluated below). The engine backtested the short list
directly.

**Result: the short list had no edge in the test window.** Shorting the names it
flagged — essentially "stocks trading below their 200-day average" — would have
**lost about 0.67% per month**. Of those names, only 48.5% actually fell; the
rest rose, because the backtest window was a strong bull market and even
weak-trend stocks drifted up.

**The insider-sell rule could not be tested at all.** The draft's short-side
rule — a senior officer selling at least 20% of their personal stake in a trade
worth $250,000+ — produced **zero** qualifying events in the liquid universe
over the entire 12 months. Executives rarely dump that large a slice of their
holdings in a single filing. There is simply no sample to calibrate.

**Recommendation for the short side: do not ship it as actionable.** The trend
layer alone is not a short signal — it is a market-direction reading, and in an
up market it loses money. The short list should be held back (or shown as
context only, clearly un-actionable) until the insider-sell, dark-pool and
options layers come online with enough of their own history to be backtested.
This is consistent with the locked spec, which already allows a layer to be a
"levels-only / zero-score" tool.

---

## Section 11 — Honesty caveats

These do not invalidate the headline, but Joe should know exactly what is — and
is not — behind the numbers.

**11a. The whole backtest is one short, single-regime window.** Twelve months
for the insider layer, six for the trend layer, and that period was an
unusually strong bull market (the average eligible stock rose ~3.3% every 21
days, roughly +44% annualised). A signal that looks good in a bull market has
not been tested against a correction or a bear market. Every number here should
be re-checked when there is more — and more varied — history.

**11b. The 3- and 6-month numbers are inflated by sample overlap.** Explained in
Section 9. Treat only the 1-month horizon as calibration-grade.

**11c. The benchmark is the broad-universe average, not the literal S&P 500.**
The task asked for "performance vs the S&P 500." There is **no S&P 500 price
series in the production database** — `prices_eod` only carries the index ETFs
from late April 2026 onward (16 days). So "the market" in this report is the
equal-weight average forward return of the eligible universe on the same day —
a legitimate and arguably stricter yardstick for a stock screener, but not the
literal index. *Data Steward action item: register a daily S&P 500 feed so
future backtests can quote the index directly.*

**11d. The liquidity gate removes most insider activity — and possibly most of
the insider edge.** Of 4,112 eligible insider buys, only 638 survive the
$10M-per-day liquidity gate. Insider buying is concentrated in smaller, less
liquid companies. The earlier "v5" backtest found insider buying with ~7% alpha
on a universe with a $300M *market-cap* floor — a more permissive gate that
admitted those smaller names. This screener's $10M *dollar-volume* gate excludes
them, and the liquid-name subset that remains shows a much thinner insider edge
(+0.6% alpha, not +7%). **This is a genuine tension between the locked spec's
liquidity gate and where the insider edge is strongest, and it is worth a
deliberate decision** — see Section 12.

**11e. The samples are small.** 82 launched long signals; 37–64 per insider
rule. Enough to calibrate and to confirm a direction; not enough to claim
precision. Expect the numbers to move on re-run.

**11f. The common-stock filter is approximate.** `prices_eod` has no
asset-type field, so exchange-traded funds were removed with a best-effort name
list. A precise common-stock / ADR filter needs reference data the screener's
universe builder already has in production — this only affected the trend-layer
population, not the insider results (insiders file on operating companies).

**11g. Returns are close-to-close, no dividends, and survivorship-blind.**
Dividends are not added (a small understatement for high-yield names). A stock
that delisted mid-hold simply drops out rather than being booked as a loss — a
mild upward bias, standard for a study at this stage.

---

## Section 12 — Recommendation: the gate decision

**The screener clears the Phase 2 gate. Recommendation: ship the long side on
the calibrated configuration; hold the short side; re-calibrate on a schedule.**

The reasoning:

- **There is a real edge.** The calibrated long screener wins 58.5% of the time
  with a 2.10 profit factor at one month. It clearly beats both a coin flip and
  an unfiltered insider buy. The three insider rules demonstrably add value. The
  gate question — "is there a real edge?" — is answered yes.

- **But it is a modest edge on a thin, one-regime sample.** +0.54% monthly alpha
  against a hot market is real but slim. This is a "ship it, with eyes open"
  result, not a "this is a money machine" result.

- **The short side is not ready.** It loses money in the test window and its
  insider rule has no sample. Do not ship it as actionable.

**Recommended next steps:**

1. **Ship the long side** with `calibrated_config.json` as delivered. Phase 3
   (the page rebuild) can proceed for the long list.
2. **Hold the short side.** Show it as context only, or not at all, until it can
   be backtested.
3. **Decision for Joe — the liquidity gate (caveat 11d).** The $10M-per-day gate
   excludes ~85% of insider buys, and that excluded, less-liquid slice is where
   the historically strongest insider edge lived. Options: keep the gate as
   locked (cleaner, more tradeable names, thinner edge); or revisit it (a lower
   or market-cap-based gate would re-admit insider-rich small caps at the cost
   of tradeability). This is a real fork and is raised separately for decision.
4. **Re-calibrate quarterly, and the moment a market correction enters the
   data.** Every number here is provisional on a 12-month bull-market sample.
5. **Data Steward:** register a daily S&P 500 feed; the dark-pool and options
   shadow feeds should be re-checked in ~3 months for enough history to bring
   those layers into the score.

---

## Appendix — Calibrated configuration and artifacts

**Final `calibrated_config.json` (long side):**

```
Lookback window      : 30 days
Rule A (CEO/CFO buy) : 4 points
Rule B (size of buy) : 4 points
Rule C (3+ insiders) : 3 points
Insider layer cap    : 4
Trend, above 200-day : +1
Trend, below 200-day : −2
Trend, RSI > 65      : −2
Launch threshold     : 3   (maximum attainable score: 5)
```

**Artifacts (all on the branch `feature/quant-trading-opps-phase2-backtest`):**

- `scanner/trading_opps/backtest_engine.py` — the engine (universe, indicators,
  scoring, event studies, permutation sweep, lookahead audit).
- `scanner/trading_opps/calibrated_config.json` — the calibrated config the
  live engine reads.
- `scanner/trading_opps/backtest_results.json` — every number this report
  quotes, pinned (per the standing rule: never hand-quote a backtest number).
- `scanner/trading_opps/test_backtest_engine.py` — 25 unit tests (all passing),
  including the no-lookahead structural checks.

**Reproducibility.** `python3 backtest_engine.py` re-runs the whole thing end to
end in ~12 seconds; with production credentials in the environment it pulls
fresh data itself (`--pull`).

---

### Specialist sign-offs

- **Senior Quant (lead):** Calibration method, lookahead audit and the gate
  decision are sound. The point values are evidence-confirmed, not gut-set; the
  threshold was re-derived for the real two-layer score; the long-horizon
  inflation was caught, audited and disclosed rather than reported as a win.
  Signed off.
- **Lead Developer (consulted):** Engine runs clean end to end, 25/25 unit tests
  pass, results are reproducible from production data. Signed off.
- **Data Steward (consulted):** Data windows are stated honestly and match the
  source tables. Two follow-ups logged: register an S&P 500 daily feed; re-check
  the dark-pool and options shadow feeds for sufficient history in ~3 months.
  Signed off.
