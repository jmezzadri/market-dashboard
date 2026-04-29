# MacroTilt Methodology — v10 (2026-04-28)

> **Source-of-truth document.** Per LESSONS rule #31, this page is rewritten in
> place when calibrations change. Not a changelog. If the page reads as a single
> coherent description of what the model does today, the document is correct.

## Table of Contents

1. [Framework](#1-framework)
2. [Page Architecture — Four Panels](#2-page-architecture--four-panels)
3. [Forward Warning System — 13 Validated Triggers](#3-forward-warning-system)
4. [Cycle Position / Long-Cycle Context](#4-cycle-position)
5. [Macro Regime Context](#5-macro-regime-context)
6. [Stress Confirmation](#6-stress-confirmation)
7. [Composites — How They're Built and What They Predict](#7-composites)
8. [Backtest Methodology](#8-backtest-methodology)
9. [Data Sources and Limitations](#9-data-sources-and-limitations)
10. [Indicators Removed from the Warning System](#10-indicators-removed-from-the-warning-system)

---

## 1. Framework

Every indicator on the page is classified across five dimensions:

- **Speed** — Fast (daily updates) or Slow (weekly/monthly/quarterly).
- **Dimension** — Market (priced indicator) or Macro (economic indicator).
- **Timing** — Leading (predicts future stress) or Coincident (describes current stress).
- **Horizon** — Near-term (0–3 months), Moderate (3–12 months), or Long-term (12+ months).
- **Calibration** — Nominal level threshold, Rate of Change at a specific window, or Both.

The framework matters because a single indicator can validate at one combination
and fail at another. VIX leveling at 30 doesn't predict drawdowns at 12 months,
but VIX *jumping* +15 in 30 days predicts a near-term drawdown with a 42% hit
rate. The framework forces every indicator to be tested at the calibration where
it actually carries forward information.

## 2. Page Architecture — Four Panels

The Macro Overview page is organized into four panels by what each indicator
type can credibly tell the user:

**Panel 1 — Forward Warning System.** The only triggering surface. Indicators
here have validated forward-drawdown signal at their stated horizons. When a
trigger fires, the page says "this indicator is in its top-decile state and
historically that has been followed by an X% drawdown over the next Y months
with Z% hit rate."

**Panel 2 — Cycle Position / Long-Cycle Context.** Slow-moving valuation,
complacency, and structural indicators. These don't predict timing — they
describe where we are in the cycle. CAPE at 34 doesn't tell you the market will
drop next month; it tells you valuations are at the top of the historical
distribution.

**Panel 3 — Macro Regime Context.** The Inflation & Rates composite reframed.
Tells the user *what kind* of stress is in play — growth-led, inflation-led,
or liquidity-led — without making forward predictions. A drawdown driven by
rate shocks looks different from one driven by growth rolling over, and
defensive positioning differs accordingly.

**Panel 4 — Stress Confirmation.** Coincident indicators. They describe what
is happening *now*, not what is coming. Useful for situational awareness during
a live stress event and for identifying recovery markers, but they do not fire
as forward triggers.

## 3. Forward Warning System

Thirteen validated triggers. Each has been backtested against forward S&P 500
maximum drawdown at its stated horizon. The "Spread" column is the difference
in mean forward drawdown between the indicator's top-decile state and its
baseline state. The "Hit Rate" column is the historical probability of a
15%-plus drawdown materializing within the horizon.

| Indicator | Speed | Calibration | Horizon | Spread | Hit Rate (15%+) |
|---|---|---|---|---|---|
| **Growth composite** | Slow | Nominal, > +30 | 3–12 months | −21% | **74%** |
| Risk & Liquidity composite | Slow | Nominal, > +30 | 0–3 months | −7% | 31% |
| Adjusted National FCI | Slow | Nominal, > +0.4 | 0–3 months | −10% | 39% |
| St Louis Financial Stress Index | Slow | Nominal, > 0 | 0–3 months | −9% | 38% |
| Corp Bond Market Distress | Slow | Nominal, > 0.5 | 3–12 months | −19% | **67%** |
| Commercial paper funding spread | Fast | Nominal, > 50bp | 3–12 months | −13% | 50% |
| Yield curve 10y−2y | Fast | Nominal, +0 to +75bp (de-inversion band) | 12+ months | −20% | **60%** |
| MOVE bond vol | Fast | Nominal, > 120 | 3–12 months | −11% | 47% |
| Dollar index (DXY) | Fast | Change, +5% in 60d | 0–3 months | −3% | 24% |
| Copper/gold ratio | Fast | Change, −5% in 60d | 3–12 months | −9% | 48% |
| BKX/SPX relative | Fast | Change, −5% in 60d | 3–12 months | −12% | 53% |
| Jobless claims | Slow | Change, top 5% jump in 6mo | 3–12 months | −8% | 41% |
| SLOOS C&I tightening | Slow | Nominal, > +20% | 12+ months | −9% | 50% |
| CFNAI / CFNAI 3-month | Slow | Nominal, < −0.35 | 3–12 months | −15% | 60% |

### 3.1 Growth Composite — the lead trigger

The Growth composite is the strongest forward signal in the entire panel. When
it elevates above +30, the historical 12-month forward maximum S&P drawdown
averages −29% with a 74% hit rate of seeing a 15%-plus drawdown. No individual
constituent matches this — the aggregation is genuinely additive. The composite
sits at the top of the page and is the primary "should we be defensive" signal.

### 3.2 Yield Curve — the De-Inversion Band

The Treasury curve does not predict drawdowns when deeply inverted. Once the
curve is at −50bp or below, the 12–24 month forward drawdown averages just
−4.7% — the warning has either fired or been delayed by Fed/fiscal action.
The actual recession warning fires in the **0 to +75bp transition band**, when
the curve is steepening back from inversion. From this band, the 18–24 month
forward drawdown averages −19.9% with a 56–60% hit rate of 15%-plus drawdowns.

This is the "de-inversion / steepening" phase. Today's value of +57bp puts the
curve squarely in this band.

### 3.3 Risk & Liquidity Constituents

The R&L composite at near horizon produces a −7% spread. Five of its individual
constituents — Adjusted National FCI, Corp Bond Market Distress, St Louis
Financial Stress, Commercial Paper Funding spread, and HYG/LQD ratio — each
individually produce stronger spreads (−9% to −10%). The page displays the
composite as a smoothed gauge but treats the four high-AUC constituents as
independent triggers. When three of the four fire simultaneously, the page
flags a constituent-override warning even if the composite itself has not
crossed its threshold.

## 4. Cycle Position

Long-cycle and complacency indicators. No triggers fire. Display only.

| Indicator | Speed | Read | Today |
|---|---|---|---|
| **High-yield credit spread** | Fast | Tight ≤350bp = Extreme Complacency / Cycle Peak | **286bp — firing** |
| **Shiller CAPE** | Slow | > 33 = Top valuation decile | **34.2 — firing** |
| 10y term premium | Fast | > 80bp = restrictive rates regime | 62bp — mid |
| 10y inflation breakeven | Fast | > 2.5% = inflation-expectations elevated | 2.44% — mid |
| Real 10y yield, TIPS | Fast | > 2.5% = restrictive real cost of capital | 1.89% — mid |
| SLOOS CRE tightening | Slow | > +20% = bank lending tightening | 0% — calm |
| Bank unrealized losses | Slow | > $25B = AOCI rate-risk pressure | $19.9B — mid |
| S&P Equal vs Mkt-Wt (RSP/SPY) | Fast | Falling = breadth narrowing | mid |

### 4.1 High-Yield Spread — Cycle Peak, Not Stress Trigger

The conventional financial-press framing treats wide HY spreads as a leading
warning of equity stress. The data — across 19 years including the 2008 GFC
via the HYG/LQD proxy — does not support this in the post-2008 monetary regime.
HY spread is **coincident** with equity stress, not leading. Wide HY = stress
is happening now. Tight HY = stress is not happening now.

The signal that *does* validate: tight HY spreads at cycle peaks. When HY is
≤350bp, the next 12-24 months has averaged a −12% forward drawdown with a 38%
hit rate of 15%-plus drawdowns. This is not because tight HY *causes* drawdowns;
it is because tight HY occurs at market peaks, and from a peak, forward outcomes
include drawdowns more often than continued rallies.

Today's HY at 286bp puts us firmly in the Cycle Peak zone. The page reads this
as "Extreme Complacency / Cycle Peak — credit market has stopped pricing risk,"
not as a stress trigger.

### 4.2 Shiller CAPE

Top decile of Shiller CAPE (>33) has historically been followed by a 24-month
forward drawdown averaging −10.8% with a 75% hit rate of 15%-plus drawdowns.
Today's reading of 34.2 is firing. Like HY, this is a long-cycle valuation
indicator — not a timing signal, but a structural read on how vulnerable the
market is when stress arrives.

## 5. Macro Regime Context

The Inflation & Rates composite is reframed as a regime classifier. It tells
the user *what kind* of stress is in play, not whether stress is coming.

When elevated, the composite reads:
- **Growth-led regime**: Growth composite elevated, I&R quiet. Stress driven
  by activity rolling over. Defensive trade: long duration (TLT), gold, defensive
  sectors (utilities, staples, healthcare).
- **Inflation & Rates-led regime**: I&R composite elevated, Growth quiet.
  Stress driven by rate shocks. Defensive trade: short duration, cash, energy,
  banks (in early phase).
- **Liquidity-led regime**: R&L composite elevated, Growth and I&R quiet.
  Stress driven by financial-system breakage. Defensive trade: cash, gold,
  systemically-protected names (megacaps with unimpeachable balance sheets).

Today: I&R at −17.7 (calm). No regime stress to classify.

## 6. Stress Confirmation

Coincident indicators. Tell the user what is happening now. No triggers.

| Indicator | Read |
|---|---|
| VIX | > 30 sustained = stress in progress |
| Equity-credit correlation | > 0.85 = unified risk-off |
| Leveraged loan spread | > 8% = leveraged-finance stress confirmed |
| HYG/LQD ratio | < 1.20 = HY underperforming IG, stress confirmed |
| Jobless claims (level) | > 350k = labor market deterioration in progress |
| Bank unrealized losses | > $25B = SVB-style rate-risk pressure realized |
| 3y IG credit yield | > 18% = funding-cost stress |
| RRP / Bank reserves / TGA / Fed BS / M2 | Liquidity plumbing reads |
| VVIX | > 130 = vol-of-vol elevated, hedging activity high |
| Global Supply Chain Index | > +1.5σ = real-economy stress |

## 7. Composites

Three composites, three different roles after this calibration:

**Risk & Liquidity composite** — kept as smoothed gauge in Forward Warning
panel. Constituents (ANFCI, CMDI, STLFSI, CPFF, HYG/LQD) each individually
beat the composite at near-horizon prediction; they are displayed alongside.
Composite-level trigger is at top decile (>+30); constituent-override fires
when 3 of 5 constituents are simultaneously in their top deciles.

**Growth composite** — primary lead trigger. Strongest forward signal in the
entire panel (74% hit rate at 15%-plus drawdown over 12 months when in top
decile). Aggregation captures cycle-stress signal that no constituent matches.

**Inflation & Rates composite** — reframed as Macro Regime Context tile.
Stripped of forward-trigger status. Term premium (which beats the composite
standalone at near horizon) is shown as the leading-indicator alternative
within the I&R panel, while the composite continues to drive the regime label.

### 7.1 Composite Weights (v9 weights retained)

| Composite | Constituents | Weights |
|---|---|---|
| Risk & Liquidity | ANFCI, VIX, STLFSI, CMDI | 0.260, 0.254, 0.243, 0.243 |
| Growth | Jobless, CFNAI 3mo, BKX/SPX | 0.343, 0.331, 0.327 |
| Inflation & Rates | MOVE, M2 YoY | 0.506, 0.494 |

Weights derived from EWMA z-score → logistic regression → DeLong 95% CI on
indicator AUC versus forward drawdown.

## 8. Backtest Methodology

Every band threshold and trigger calibration on this page derives from the same
backtest infrastructure:

1. **Sample window**: 2005-01-03 to 2026-04-28 (5,363 trading days). Includes
   2008 GFC, 2011 EU debt crisis, 2018 vol regime, 2020 COVID, 2022 rate shock.
2. **Forward outcome**: maximum forward S&P 500 drawdown over horizon-specific
   windows — 90 trading days for "near," 252 days for "moderate," 504 days for
   "long."
3. **Bucketing**: every historical day is classified into the indicator's
   calibration bucket (top decile vs rest, or top 5% / top 1% for sharper
   triggers).
4. **Statistics computed per bucket**: mean / median / p5 forward drawdown,
   hit rate at 5% / 10% / 15% / 20% drawdown thresholds, mean lead time to
   first 5%-plus drawdown.
5. **Validation criterion**: an indicator/calibration/horizon combination is
   "validated" when the spread between top-decile mean forward drawdown and
   baseline mean drawdown exceeds 3% in the expected direction. Spreads under
   1.5% are flagged as "marginal" and used for context only.

Backtest results are deterministic and reproducible from the source files
listed in section 9.

## 9. Data Sources and Limitations

All indicators sourced from FRED, Yahoo Finance, NY Fed, ICE BofA, CBOE, or
computed from these.

**Material limitations the user should know about:**

- **High-yield credit spread (BAMLH0A0HYM2)**: ICE BofA license restrictions
  trim public-FRED daily history to 2011 onward. The 2008 GFC peak (~2,000bp
  HY OAS) is *not in our dataset*. Backtest uses 2011-2026 plus HYG/LQD ratio
  as a proxy back to 2007 to capture GFC dynamics indirectly.
- **Fed Net Liquidity**: Treasury General Account and Reverse Repo facility
  only became material to the formula post-2020. Pre-2020 the calculation
  reduces to Fed balance sheet YoY. Useful sample: 5 years.
- **SLOOS surveys (C&I, CRE)**: quarterly cadence. Latest print is 2026-Q1;
  next refresh late July 2026. Triggers based on these indicators may sit on
  a stale value for up to 90 days.
- **JOLTS quits, ISM, CAPE**: monthly cadence with one-month lag.

## 10. Indicators Removed from the Warning System

The following indicators were tested at multiple windows and horizons and did
not produce a validated forward signal in our sample. They are kept on the
methodology page for transparency but do not fire as triggers on the live page:

- **High-yield credit spread (as widening trigger)** — failed at every window
  × horizon combination. Moved to Cycle Position panel as a tight-spread
  Complacency indicator.
- **Leveraged loan spread** — inverted relationship; high spread = panic
  already in price.
- **3y investment-grade credit yield** — coincident, not leading.
- **Equity-credit correlation** — coincident; high correlation = stress
  already realized.
- **Bank credit growth YoY** — coincident with recessions, not leading.
- **JOLTS quits rate** — coincident with labor cycles.
- **ISM Manufacturing PMI** — no separation across bands at 90d or 252d.
- **Reverse repo facility (RRP)** — structural decline post-2024 dominates.
- **Treasury General Account** — political-cycle driven, not stress driven.
- **M2 money supply YoY** — too smoothed at the level the model uses it.
- **Bank unrealized losses** — only 30 quarterly observations, insufficient
  power.
- **CBOE SKEW** — top decile produces only modest separation; weak signal.
- **VVIX (new)** — too correlated with VIX itself; no incremental signal.
- **Global Supply Chain Index (new)** — high readings happen *during* stress
  (2008, 2020, 2022), not before.

---

*Last updated: 2026-04-28. Next review: when sector-level calibrations
complete (Phase 2 of Asset Tilt rebuild).*
