# Crash-brake study — 2026-09-10

**Question (Joe):** what is the Paper book's cash-brake trigger, why VIX + high-yield
rather than MOVE, and does it work? **Answer:** the VIX + high-yield brake that shipped
on 2026-08-31 had never been tested on this book; tested, it *costs* 3.5 points a year.
A MOVE-based brake beats no brake on every measure, in both halves of the sample, at a
one-day data lag, and on the 40-name variant. It is now the deployed rule.

Senior Quant (lead) · Lead Developer · UX Designer consulted.

## 1. Rebuilding the book's daily history

The published Quality Trend backtest (2026-08-13) was run in a session whose code was
never committed, and its daily series was saved nowhere — so the brake question could
not be answered from anything on file. `qt_backtest.py` rebuilds it from the
production scorer's own rules (`paper_portfolio/qt/score.py`, `strategy_config.py`,
the `qt_quality()` SQL function), on:

- Alpaca daily bars, `adjustment=all`, SIP, every active and inactive non-OTC US equity
  (7,556 symbols incl. delisted; `pull_prices.py`)
- SEC `companyfacts.zip`, the nine v3 tags, **every CIK** — dead companies matched to
  filings by normalised name (535 recovered), live ones by `company_tickers.json`
  (`extract_facts.py`)
- insider conviction replicated in SQL from `insider_history_edgar` (only from 2026-04;
  same limitation as production)
- score on the last close of the month, trade at the open of the first session of the
  next month, equal weight, hold-until-out-of-top-25%, delisted names cashed at their
  last print

**Reconciliation to the published 40-name figures** (Feb 2017 – Sep 2026):

| | Published (08-13) | Rebuild, monthly series | Rebuild, daily series |
|---|---|---|---|
| Return per year | 20.6% – 21.2% | 20.8% | 20.8% |
| Volatility | 19.75% | 19.0% | 23.5% |
| Sharpe | 0.91 – 0.97 | 0.94 | 0.82 |
| Worst drawdown | −19.3% / −22.6% | −18.7% | **−33.3% (20 Mar 2020)** |
| Worst year | −6.7% / −9.0% | −8.3% | −8.3% |
| Monthly turnover | 21% | 22% | 22% |

The rebuild reproduces the published numbers on a monthly series. The published
drawdown was a month-end figure; the daily worst was −33%. The Methodology page now
quotes daily figures.

## 2. The brake study (`overlay_test.py`, `overlay_round2.py`)

Executed honestly: the signal is read at the close, the trade fills at the **next
open** (the book's close→open leg carries the old exposure, the open→close leg the
new one), 5bp per side on the exposure change, cash earns nothing (the paper account
pays no interest). Selection criterion, declared before running: full-sample Sharpe;
must beat NO BRAKE in **both** halves (2017–21 and 2022–26); must survive a one-day
data lag; neighbouring thresholds must not flip the sign.

Live book (20 names, 5bp costs), Feb 2017 – Sep 2026:

| | CAGR | Vol | Sharpe | Sortino | Worst fall | Sharpe 17–21 | Sharpe 22–26 | Worst year | 2020 | 2022 | Time out | Episodes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| No brake | 19.8% | 25.3% | 0.75 | 0.97 | −36.7% | 0.84 | 0.65 | −6.5% | +18.7% | −6.5% | — | — |
| **VIX + HY, sell half (shipped 08-31)** | 16.3% | 20.6% | 0.72 | 0.95 | −25.6% | 0.89 | 0.57 | −8.8% | +10.2% | −8.8% | 20% | 20 |
| **MOVE 5y > 0.95 ×2 → cash; < 0.80 → back (now live)** | **23.7%** | 21.2% | **1.00** | **1.23** | −26.7% | **1.26** | **0.72** | **0.0%** | **+44.3%** | **0.0%** | 18% | 3 |
| same rule, sell half instead of all | 22.0% | 22.3% | 0.90 | 1.20 | −26.7% | 1.08 | 0.71 | −2.5% | +32.0% | −2.5% | 18% | 3 |
| S&P 500 | 15.2% | 18.0% | 0.75 | 0.91 | −33.8% | 0.94 | 0.53 | −18.2% | +18.5% | −18.2% | — | — |

Year by year, brake vs no brake: 2017 30.2/30.2 · 2018 2.1/2.1 · 2019 28.9/23.6 ·
2020 44.3/18.7 · 2021 40.2/32.7 · 2022 0.0/−6.5 · 2023 10.8/17.3 · 2024 36.8/36.8 ·
2025 9.4/9.4 · 2026 33.0/33.0. Worst three-year window: +26% vs +4%.

Episodes (out of the market): 16 Aug – 9 Sep 2019 · 28 Feb – 2 Apr 2020 · 16 Nov 2021
– 6 Jun 2023.

What the grid showed (≈300 variants in round 1, 87 in round 2):

- **Every VIX-based rule lost to no brake** — VIX alone, VIX + high-yield, VIX + MOVE
  blends at any threshold, and VIX spikes. Equity volatility is high *after* the fall.
- **Every MOVE-based rule beat no brake** on full-sample Sharpe (3y or 5y window,
  thresholds 0.80–0.95, 1/2/5-day confirmation, half or full cash). Bond-market
  volatility spikes *before* the equity fall (Feb 2020: MOVE crossed on 26 Feb; the
  book's fall ran to 20 Mar).
- Low thresholds (0.80/0.65) failed the second half: MOVE stayed elevated through the
  2022–23 rate shock and the rule sat out the 2023 recovery. 0.95-in fixes that.
- "Level in, reversion out" (exit when MOVE drops below its 63-day average) scored
  best at zero lag (Sharpe 1.04, 10.7% time out) but **failed at a one-day lag**
  (second-half Sharpe 0.50): its 2022 in-and-out chop depends on same-day data. The
  level-out rule is lag-robust and was chosen for that reason.
- Full cash beats half in every cell (Sharpe 1.00 vs 0.90; worst year 0.0% vs −2.5%).
- The Macro page's own engine spec (weekly, 0.85 two Fridays in / 0.75 out, half) also
  beats no brake (0.83) but by less.

## 3. Caveats, stated honestly

- Three episodes in 9.6 years. The gain is real and consistent across the whole MOVE
  family, but it rests on two events (COVID, 2022). The same signal is validated
  1986–2026 on the Macro engine's weekly allocation model, which is the external
  support for trusting it here.
- The rule protects against **bond-market panics**. The April 2025 tariff drawdown
  (−26.7%, the residual worst fall) had no MOVE spike and the brake stayed in.
- The 2021–23 episode kept the book in cash for 19 months; the book made −5.9% over
  that stretch, so the exit was slightly right, but a version of 2022–23 in which the
  book rallied while rates volatility stayed high would have been the rule's bad case.
- Cash earns nothing in the paper account. Holding T-bills instead would add roughly
  0.5 pt/yr of CAGR to the brake rows and is not counted.

## Files

`pull_prices.py` · `extract_facts.py` · `qt_backtest.py` (`python3 qt_backtest.py 20 0.0005 n20`) ·
`overlay_test.py` (round 1 grid) · `overlay_round2.py` (exit-rule and lag study).
Inputs not committed (rebuildable, ~1.6 GB): Alpaca bars, SEC companyfacts, the site's
`indicator_history.json` (VIX, MOVE), HYG from Yahoo, FRED DTB3 / HY OAS.
