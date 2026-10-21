# Risk cockpit calibration check — 2026-10-20

Book as of 2026-10-20: 20 names, equity $1,077,494. Daily returns 2025-06-26 → 2026-10-19 (329 sessions shared by every series).

## 1. Today's figures, re-derived in Python

| Figure | Value |
|---|---|
| Annualized volatility | 18.54% |
| 1-day 99% VaR, historical simulation | 2.92% |
| 1-day 99% VaR, normal (cross-check) | 2.72% |
| 10-day 99% VaR (√10 scaling) | 9.24% = $99,608 |
| Σ w·MCTR − σ (must be 0) | 2.78e-17 |
| Σ risk share (must be 1) | 1.000000 |

Risk share by name (page column 'Risk %'):

| Name | Weight | Risk share | Ratio |
|---|---|---|---|
| CORT | 5.0% | 10.1% | 2.04× |
| LSCC | 4.2% | 7.4% | 1.77× |
| HNGE | 5.4% | 7.0% | 1.29× |
| CRWD | 4.2% | 6.9% | 1.65× |
| KLAC | 3.9% | 5.9% | 1.49× |
| RAL | 4.7% | 5.9% | 1.26× |
| ETSY | 5.9% | 5.7% | 0.97× |
| NTAP | 4.8% | 5.7% | 1.19× |
| QLYS | 5.0% | 5.6% | 1.12× |
| ILMN | 5.0% | 5.4% | 1.08× |
| FTNT | 4.7% | 5.3% | 1.14× |
| M | 5.1% | 4.9% | 0.96× |
| STLD | 5.3% | 4.4% | 0.84× |
| EXEL | 5.5% | 3.8% | 0.70× |
| UNH | 5.7% | 3.6% | 0.64× |
| CROX | 5.0% | 3.5% | 0.71× |
| WST | 5.2% | 3.5% | 0.67× |
| LNTH | 5.0% | 3.1% | 0.62× |
| AAPL | 5.1% | 1.3% | 0.26× |
| DINO | 5.5% | 0.9% | 0.17× |

## 2. Variance decomposition

β to the S&P 500 fund (1y daily): **1.03**. Market 49.9% · style 8.1% · stock-specific 42.0% · sum 1.0000 (must be 1 up to the intercept term).

Style-fund loadings (fund minus S&P, on the market residual): momentum -0.03, quality +0.34, buybacks +0.13, size +0.30, value +0.13.

## 3. VaR backtest (Kupiec proportion-of-failures)

Rolling 252-session window at today's weights, one-day-ahead, 77 out-of-sample days (2026-07-01 → 2026-10-19). Expected exceptions 0.8; observed **0**. LR = 1.55, p = 0.213. **PASS — the 99% VaR is not rejected at the 5% level.**

Caveat: the window is short because four holdings listed in 2025; power to reject is low. Re-run monthly as the record lengthens. The √10 horizon scaling is a convention, not a test — ten-day overlapping losses are too few to test a 1% tail honestly.

## 4. Shock scenarios (β-scaled)

| Episode | S&P 500 fund | Book at β |
|---|---|---|
| 2008 financial crisis | -56.5% | -58.1% |
| 2000–02 tech bust | -49.1% | -50.6% |
| 2020 COVID crash | -34.1% | -35.1% |
| 2022 rate shock | -25.4% | -26.1% |

VIX elasticity: S&P fund daily return on Δln(VIX), 5230 days since 2006-01-03: slope -0.116 (R² 0.54). VIX 18.44 → 40 in one session implies the fund -9.0%, the book -9.3%.

## Verdict

All identities hold to machine precision; the VaR backtest is reported with its (low) power; the shock figures are projections scaled by a measured beta and are labelled as such on the page. Fit for publication.
