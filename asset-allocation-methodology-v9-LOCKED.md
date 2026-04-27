# MacroTilt — Asset Allocation Tab

## Methodology v9 — LOCKED 2026-04-25

**Status:** LOCKED. Supersedes v1 through v8. This is the spec the production
strategy implements. Refinements happen as v9.1, v9.2, etc., with explicit
back-test sign-off.

**Authors:** Senior Quant · Lead Developer · UX Designer (council)

---

## What this strategy is, in one paragraph

A monthly tactical asset allocation tool that selects 5 industry-group / sector
ETFs to hold in equal weight, with optional leverage up to 1.5x in calm regimes
and a defensive overlay (cash, long Treasuries, gold, investment-grade bonds)
that activates in stress regimes. Each industry/sector's expected return is
forecast from a per-asset multivariate regression on theoretically and
empirically chosen macro factors. Sectors are selected only when BOTH the
regression's expected return AND the trailing 6-month price momentum agree
they're above-median. When the Risk & Liquidity composite drops sharply
(regime change from stress to recovery), momentum is overridden and selection
falls back to indicator-only ranking — addresses the documented "momentum
crash" pattern at V-bottoms.

---

## Universe (14 equity buckets + 4 defensive)

**Equity buckets:**

| Ticker | Description | Holdings |
|---|---|---|
| IGV | iShares Software ETF | Microsoft, Salesforce, Oracle, Adobe |
| SOXX | iShares Semiconductor ETF | Nvidia, Broadcom, AMD, Taiwan Semi |
| IBB | iShares Biotechnology ETF | Amgen, Vertex, Gilead, Regeneron |
| XLF | SPDR Financials Select Sector | JPMorgan, BofA, Berkshire, Visa |
| XLV | SPDR Health Care Select Sector | UnitedHealth, JNJ, Eli Lilly, Pfizer |
| XLI | SPDR Industrials Select Sector | GE, Caterpillar, RTX, Boeing |
| XLE | SPDR Energy Select Sector | ExxonMobil, Chevron, ConocoPhillips |
| XLY | SPDR Consumer Discretionary Select Sector | Amazon, Tesla, Home Depot, McDonald's |
| XLP | SPDR Consumer Staples Select Sector | Procter & Gamble, Costco, Walmart, Coca-Cola |
| XLU | SPDR Utilities Select Sector | NextEra, Southern, Duke, Constellation |
| XLB | SPDR Materials Select Sector | Linde, Sherwin-Williams, Air Products |
| IYR | iShares US Real Estate ETF | Prologis, American Tower, Equinix, Welltower |
| IYZ | iShares US Telecommunications ETF | Verizon, T-Mobile, AT&T |
| MGK | Vanguard Mega-Cap Growth ETF | Apple, Microsoft, Nvidia, Amazon, Meta, Alphabet, Tesla |

**Defensive bucket:**
| Ticker | Description |
|---|---|
| BIL | SPDR 1-3 Month Treasury Bill ETF — cash proxy |
| TLT | iShares 20+ Year Treasury Bond ETF — long duration |
| GLD | SPDR Gold Shares — gold |
| LQD | iShares iBoxx Investment Grade Corporate Bond ETF |

---

## Inputs

1. **Daily prices for all 18 ETFs** (yfinance).
2. **Macro factor panel** — 32 factors back to 2001-2003 from FRED + Yahoo.
   Includes: yield curve, real rates, term premium, breakeven inflation,
   broad dollar, Chicago Fed Financial Conditions Index, St. Louis FSI,
   commercial paper risk, fed funds, Fed balance sheet, initial jobless
   claims, industrial production, capacity utilization, consumer sentiment,
   retail sales, PCE, durable goods orders, housing starts, mortgage rate,
   M2 money supply YoY, bank credit, WTI crude, natural gas, copper-gold
   ratio, VIX, SKEW, SLOOS lending standards (C&I and CRE).
3. **Macro composites** — Risk & Liquidity, Growth, Inflation & Rates from
   the existing `composite_history_daily.json` pipeline.

---

## Per-asset factor maps (multivariate, conditional t > 2)

Determined by forward-stepwise multivariate regression on 1998-2026 monthly
returns. Each asset uses universal background (yield_curve, term_premium)
plus its statistically-selected factors:

| Asset | Selected factors |
|---|---|
| Software (IGV) | jobless, m2_yoy, industrial_prod |
| Semiconductors (SOXX) | copper_gold |
| Biotech (IBB) | jobless |
| Financials (XLF) | anfci, capacity_util |
| Health Care (XLV) | jobless, sloos_ci |
| Industrials (XLI) | jobless, stlfsi, vix, breakeven_10y |
| Energy (XLE) | jobless, sloos_cre |
| Cons Disc (XLY) | jobless, natgas_henry |
| Cons Staples (XLP) | sloos_ci, jobless |
| Utilities (XLU) | sloos_ci |
| Materials (XLB) | jobless, stlfsi, vix, breakeven_10y, skew |
| Real Estate (IYR) | anfci, capacity_util |
| Comm Services (IYZ) | sloos_ci, vix, capacity_util, real_rates, anfci, cpff |
| Mega-Cap Growth (MGK) | jobless, real_rates, breakeven_10y, vix |

Factor map regenerated quarterly via `multivariate_factor_map.py`. If a factor
loses statistical significance over time, the per-asset list updates at the
quarterly refresh.

---

## Logic — what happens at the end of each month

**Step 1 — Forecast each asset's next-month return.**
Per-asset OLS regression on factor panel (lagged 1 month). Last 60 months of
asset return × shifted factors → coefficient estimates. Forecast = α + β·X[T-1].
Shrink toward asset long-run mean by 50% (Bayesian / James-Stein-lite). Output
is a vector μ across all 18 assets.

**Step 2 — Compute trailing 6-month momentum** for each equity bucket
(strict prior 6 months, no current-month included — lookahead-safe).

**Step 3 — Detect regime flip.**
If R&L composite has dropped > 15 points over the last 3 months AND is now
below +30, this is a stress-to-recovery regime change. Set `regime_flip = True`.

**Step 4 — Select 5 equity buckets:**
- **Normal mode (regime_flip = False):** confirmatory selection. Rank buckets
  by indicator μ and by 6-month momentum. Eligible = both ranks above
  median. Pick top 5 by combined rank. Equal-weight 20% each. Fallback:
  if fewer than 5 eligible, fill with indicator-positive only (NEVER
  momentum-positive only — indicators are forward-looking).
- **Regime-flip mode (regime_flip = True):** override momentum entirely.
  Rank by indicator μ alone. Pick top 5. Equal-weight 20% each. This catches
  V-bottoms where momentum is full of crash data and points the wrong way.

**Step 5 — Compute defensive sub-portfolio weights.**
Max-Sharpe across BIL/TLT/GLD/LQD with per-asset cap of 70%. Returns 4-vector.

**Step 6 — Equity-vs-defensive split (R&L composite):**
- R&L ≤ +20: equity weight = 100%
- R&L +20 to +30: scale 100% → 85% linearly
- R&L +30 to +50: scale 85% → 60% linearly
- R&L > +50: equity weight = 60% (max defensive)

**Step 7 — Leverage decision (Inflation & Rates composite):**
- IR > +30: leverage = 1.0x
- IR 0 to +30: scale 1.0x → 1.10x linearly
- IR -10 to 0: scale 1.10x → 1.25x linearly
- IR -10 to -50: scale 1.25x → 1.50x linearly (capped per Joe's 2026-04-25 lock)
- Override: leverage = 1.0x whenever R&L > +20 (don't lever in stress)

**Step 8 — Apply leverage and financing cost.**
If alpha > 1.0, financing drag = (alpha - 1.0) × (RF + 0.5%/12). Subtract from
realized portfolio return.

**Step 9 — Final weights:**
- Each of the 5 selected equity buckets: weight = 20% × equity_share × leverage
- Each defensive bucket: weight = (proportion of defensive sub-portfolio) × (1 - equity_share)
- If levered: defensive = 0%, equity > 100%, financing drag applies

---

## Back-test summary (locked)

**Window:** Jan 2008 → Apr 2026, 220 months ≈ 18.3 years (includes GFC).

| Metric | v9 strategy | S&P 500 (SPY) | 60/40 (60% SPY + 40% AGG bonds) |
|---|---|---|---|
| CAGR (compounded annual) | **13.88%** | 11.06% | 8.02% |
| Sharpe ratio | **0.610** | 0.495 | 0.422 |
| Max drawdown | **-23.64%** | -46.32% | — |
| Cumulative return ($1 → $X) | **$10.84** | $6.84 | $4.12 |
| Calendar years winning vs S&P | 10 of 19 | — | — |

**v9 beats S&P 500 by:**
- +2.82 percentage points per year compounded
- +0.115 Sharpe
- 22.7 percentage points better max drawdown (cut roughly in half)

**Where v9 wins (regime-change years):** 2008 GFC (+22pp), 2010 (+10pp),
2013 (+17pp), 2020 (+2pp), 2022 (+4pp), 2026 YTD (+18pp).

**Where v9 lags (mega-cap-concentration years):** 2021 (-12pp), 2024 (-9pp),
2009 recovery (-6pp).

---

## Production deployment

- `compute_v9_allocation.py` runs nightly via the existing
  `INDICATOR-REFRESH_7AM_WEEKDAYS` workflow.
- Writes `public/v9_allocation.json` with current state: 5 picks, weights,
  equity share, leverage, defensive composition, regime_flip flag,
  composite values, last-rebalance date.
- React component in `src/pages/AssetAllocation.jsx` reads the JSON and
  renders the current allocation.
- No live trading; this is allocation guidance only.

---

## What's NOT in v9 (parked for future iterations)

- Scenario panel (interactive sliders for macro factors)
- Historical allocation playback / "what was I holding in 2020?"
- Industry Group drill-down (chips vs software within Tech, etc.)
- Style-factor overlay (value/momentum/quality/low-vol)
- International equity exposure (EAFE, EM)
- Anything above 1.5x leverage

---

## Refinement plan

Refinements ship as v9.1, v9.2, etc. Each refinement requires:
1. Back-test on the same 2008-2026 window
2. Comparison table vs v9 baseline (CAGR, Sharpe, max DD, calendar wins)
3. Senior Quant sign-off
4. UX Designer sign-off if UI changes
5. Lead Developer ships PR

Locked decisions that should NOT change without explicit re-approval:
- 1.5x leverage cap (Joe's call 2026-04-25)
- Sector-level allocation (no cap dimension — Joe's call)
- Confirmatory selection rule (both indicator + momentum agree)
- 6-month momentum window (Joe's hunch validated 2026-04-25)
- Per-asset multivariate factor maps
