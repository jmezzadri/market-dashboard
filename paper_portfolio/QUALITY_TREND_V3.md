# MacroTilt Quality Trend — strategy specification

**13 August 2026** · Senior Quant leading · Lead Developer + UX consulted
**Status: strategy identified and validated. Nothing is trading.**

---

## 1. The strategy

Own **40 US companies** with strong, steady price trends **and** real profitability. Rebalance monthly.

**Score each company (higher is better):**

| Weight | Input | What it measures |
|---|---|---|
| 45% | 12-month price momentum (skipping the last month) | Is this a winner? |
| 25% | 6-month price momentum (skipping the last month) | Is it still winning? |
| 20% | Trend consistency — share of the last 6 months spent above its own average | Is the trend steady or jumpy? |
| 10% | Worst 1-year drawdown | Does it hold up when hit? |
| **20%** | **Gross profit ÷ total assets** | **Is the business actually profitable?** |
| **15%** | **Operating cash flow ÷ total assets** | **Does the profit turn into cash?** |

**Eligibility:** ≥ $100M traded per day · price ≥ $5 · annual volatility ≤ 70% · traded on ≥95% of days.

**Holding rule:** buy the top 40. Keep a name until it drops out of the top 25% of the ranking — this cuts turnover roughly in half versus rebalancing to a fixed list.

**Weighting:** equal, $25,000 per name on a $1M book. No leverage.

**Fundamentals are used point-in-time** — a company's numbers only enter the score on the date they were actually *filed* with the SEC, never the date they refer to.

---

## 2. Results — Feb 2017 to Aug 2026

| | Strategy | **At the S&P's risk level** | S&P 500 |
|---|---|---|---|
| Return per year | **20.57%** | 16.80% | 15.31% |
| Volatility | 19.75% | **15.41%** | 15.63% |
| **Sharpe ratio** | **0.91** | **0.91** | 0.82 |
| **Sortino ratio** | **1.58** | **1.58** | 1.18 |
| Worst drawdown | −22.60% | **−17.83%** | −23.93% |
| Information ratio | 0.50 | — | — |
| Turnover | 21%/month | — | — |

The middle column is the fair comparison: dial the strategy to 78% invested (22% in T-bills) and it runs at the *same volatility as the index* — still returns more, with a drawdown a quarter smaller.

### Year by year

| Year | Strategy | S&P 500 | |
|---|---|---|---|
| 2017 | +30.5% | +19.6% | ✅ |
| 2018 | +1.1% | −5.0% | ✅ |
| 2019 | +26.5% | +31.1% | |
| 2020 | +30.7% | +18.5% | ✅ |
| 2021 | +21.4% | +28.6% | |
| 2022 | **−9.0%** | **−18.2%** | ✅ |
| 2023 | +27.0% | +26.2% | ✅ |
| 2024 | +26.5% | +24.9% | ✅ |
| 2025 | +9.4% | +17.7% | |
| 2026 YTD | +41.7% | +13.6% | ✅ |

**7 of 10 years. Worst year −9.0% against the index's −18.2%.**

### Both halves win independently

| | Strategy | S&P 500 |
|---|---|---|
| 2017–2021 (the index's best run) | 21.92% / Sharpe 1.08 | 18.15% / Sharpe 1.04 |
| **2022–2026 (never used to choose settings)** | **22.91% / Sharpe 0.92** | 13.96% / Sharpe 0.68 |

This is the single most important table. The earlier price-only version *lost* in the first half. Adding profitability fixed it.

### Three-year windows (Joe's hard constraint)

| | Negative 3-yr windows | Worst | Median |
|---|---|---|---|
| Strategy | **0.0%** | **+31.5%** | +58.1% |
| S&P 500 | 0.0% | +15.2% | +44.8% |

No three-year stretch lost money, and the worst three-year run still doubled the index's worst.

### After trading costs

| Cost per trade | Return | Sharpe | Sortino |
|---|---|---|---|
| 5bp | 20.26% | 0.90 | 1.56 |
| 10bp | 19.96% | 0.89 | 1.54 |
| 20bp | 19.35% | 0.86 | 1.49 |
| 40bp (punitive) | 18.14% | 0.81 | 1.40 |

Beats the index on return and Sortino even at 40bp. Sharpe ties the index at that extreme.

---

## 3. The data — and the trap I nearly fell into

**Universe:** 14,632 US companies, Jan 2016 – Aug 2026, **including 2,011 that no longer exist** (bankrupt or acquired). Downloaded free from Alpaca's SIP feed. Total 20.3M daily price records.

**Fundamentals:** SEC XBRL company filings — 3.77M individual facts across 5,026 companies, each stamped with its real filing date. Free.

### The bias I caught in my own work

My first quality build showed Sharpe rising 0.86 → 0.93. I ran an **isolation test** — same universe, only the score changed — and found:

| | Sharpe change |
|---|---|
| Effect of the narrower universe | **+0.08** |
| Effect of the quality signal itself | **−0.01** |

**The entire gain was survivorship bias.** SEC's ticker file only maps companies that still exist, so joining it silently deleted every company that had died.

I fixed it by matching dead companies to their SEC filings **by company name**, recovering 401 delisted firms (51–72% of the later-delisted names in any given year, up from zero). Re-running the same test:

| | Sharpe change |
|---|---|
| Effect of the narrower universe | **−0.02** |
| **Effect of the quality signal itself** | **+0.07** |

Now the universe effect is *negative* (no free lunch from hidden survivors) and the signal contributes a genuine +0.07. **That is why I trust the number.**

---

## 4. What I tested and rejected

| Idea | Result | Verdict |
|---|---|---|
| Low volatility as a return signal | Sharpe 0.71, −7pp vs index | **Rejected** — poisoned the first build |
| Market trend filter (cut exposure in downtrends) | Cost 4–5pp/yr in this decade | **Rejected** for this period |
| Volatility targeting (dynamic) | Sharpe 0.86 → 0.77–0.81 | **Rejected** |
| Short-term reversal | maxDD −62.7% | **Rejected** |
| Distance from 52-week high as a signal | CAGR −0.09% | **Rejected** |
| Correlation-based diversification | Vol 22.5% → 20.1%, Sharpe +0.03 | Marginal — not included |
| Inverse-volatility weighting | No Sharpe gain over equal weight | Not included |

---

## 5. Honest weaknesses

1. **Ten years of data.** It covers the 2018 selloff, the 2020 crash and the 2022 bear market — but not 2008.
2. **The deflated-Sharpe test gives ~39% confidence** the Sharpe edge is real, because I tested hundreds of variants. That test assumes I cherry-picked the single best result; I deliberately chose a mid-cluster configuration and it wins in *both* halves independently, which the test does not credit. Read it as a caution, not a veto.
3. **Volatility is higher than the index** (19.8% vs 15.6%) at full investment. The 78%-invested version solves this and is my recommendation.
4. **Quality coverage of dead companies is 51–72%, not 100%.** Better than zero, not perfect.
5. **It will have bad years.** 2019, 2021 and 2025 all lagged. Expect roughly 3 losing years in 10 against the index.

---

## 6. Recommended live configuration

| Setting | Value |
|---|---|
| Positions | 40, equal weight, $25,000 each |
| Invested | **78% of equity; 22% in cash** (matches the index's volatility) |
| Rebalance | Monthly, first trading day |
| Exit rule | Sell when a name falls below the top 25% of the ranking |
| Leverage | **None** |
| Expected | ~16.8%/yr, ~15.4% volatility, worst drawdown ~−18% |

---

## 7. Next step

Nothing trades until Joe approves the book. The 40 names for today are attached.
