# MacroTilt — Asset Allocation Tab

## Methodology v9.1 (current)

**Status:** v9.1 (current). Approved by Senior Quant + Lead Developer + UX
Designer council on 2026-04-25 and extended to all 25 GICS Industry
Groups in PR #171 (2026-04-27). Refinements ship as v9.2, v9.3, etc.,
with explicit back-test sign-off.

**Authors:** Senior Quant · Lead Developer · UX Designer

---

## What this strategy is, in one paragraph

A weekly tactical allocation tool that scores 25 GICS industry groups
across the 11 GICS sectors and selects the top 5 to hold in equal
weight, with optional leverage up to 1.5× in calm regimes and a
defensive overlay (cash, long Treasuries, gold, investment-grade bonds)
that activates in stress regimes. Each industry group's expected return
is forecast from a per-asset multivariate regression on theoretically
and empirically chosen macro factors. Industry groups are selected only
when BOTH the regression's expected return AND the trailing 6-month
price momentum agree they're above-median. When the Risk & Liquidity
composite drops sharply (regime change from stress to recovery),
momentum is overridden and selection falls back to indicator-only
ranking — addresses the documented "momentum crash" pattern at
V-bottoms.

---

## Universe (25 industry groups + 4 defensive)

The universe spans the 11 GICS sectors, decomposed into 25 industry
groups under the post-March-2023 GICS structure. Implementation uses
single-ETF proxies where one is available (13 of 25) and equal-weighted
baskets of the largest names where no clean ETF exists (12 of 25).

| Sector | Industry group | Proxy | Type |
|---|---|---|---|
| Energy | Energy | XLE | ETF |
| Materials | Materials | XLB | ETF |
| Industrials | Capital Goods | XLI | ETF |
| Industrials | Commercial & Professional Services | WM/RSG/CTAS basket | basket |
| Industrials | Transportation | IYT | ETF |
| Consumer Discretionary | Automobiles & Components | CARZ | ETF |
| Consumer Discretionary | Consumer Durables & Apparel | NKE/LULU/DECK basket | basket |
| Consumer Discretionary | Consumer Services | PEJ | ETF |
| Consumer Discretionary | Cons Disc Distribution & Retail | XRT | ETF |
| Consumer Staples | Cons Staples Distribution & Retail | WMT/COST/KR basket | basket |
| Consumer Staples | Food, Beverage & Tobacco | PBJ | ETF |
| Consumer Staples | Household & Personal Products | PG/CL/KMB basket | basket |
| Health Care | Health Care Equipment & Services | IHI | ETF |
| Health Care | Pharmaceuticals, Biotech & Life Sciences | XLV | ETF |
| Financials | Banks | XLF | ETF |
| Financials | Financial Services | IYG | ETF |
| Financials | Insurance | KIE | ETF |
| Information Technology | Software & Services | IGV | ETF |
| Information Technology | Tech Hardware & Equipment | AAPL/CSCO/HPQ basket | basket |
| Information Technology | Semiconductors & Semi Equipment | SOXX | ETF |
| Communication Services | Telecommunication Services | IYZ | ETF |
| Communication Services | Media & Entertainment | XLC | ETF |
| Utilities | Utilities | XLU | ETF |
| Real Estate | REITs | IYR | ETF |
| Real Estate | Real Estate Mgmt & Development | CBRE/JLL/SLG basket | basket |

**Defensive bucket:**

| Ticker | Description |
|---|---|
| BIL | SPDR 1-3 Month Treasury Bill ETF — cash proxy |
| TLT | iShares 20+ Year Treasury Bond ETF — long duration |
| GLD | SPDR Gold Shares — gold |
| LQD | iShares iBoxx Investment Grade Corporate Bond ETF |

---

## Inputs

1. **Daily prices for all 25 industry-group proxies + 4 defensive ETFs**
   from yfinance (single-ticker ETFs) or aggregated from constituent
   names (baskets, equal-weighted).
2. **Macro factor panel** — ~32 factors back to 1998-2003 from FRED +
   Yahoo. Includes: yield curve, real rates, term premium, breakeven
   inflation, broad dollar, Chicago Fed Financial Conditions Index,
   St. Louis FSI, commercial paper risk, fed funds, Fed balance sheet,
   initial jobless claims, industrial production, capacity utilization,
   consumer sentiment, retail sales, PCE, durable goods orders, housing
   starts, mortgage rate, M2 money supply YoY, bank credit, WTI crude,
   natural gas, copper-gold ratio, VIX, SKEW, SLOOS lending standards
   (C&I and CRE).
3. **Macro composites** — Risk & Liquidity, Growth, Inflation & Rates
   from the existing `composite_history_daily.json` pipeline that drives
   Today's Macro.

---

## Per-asset factor maps (multivariate, conditional |t| > 2)

Determined by forward-stepwise multivariate regression on 1998-2026
monthly returns. Each industry group uses universal background factors
(10Y-2Y yield curve slope, Kim-Wright term premium) plus its
statistically-selected factors. The factor map is regenerated quarterly;
factors that lose statistical significance over time are dropped at the
next refresh.

The full per-bucket factor map ships in `compute_v9_allocation.py`. The
key intuitions:

- **Cyclicals** (Energy, Materials, Capital Goods, Transports,
  Automobiles) load on jobless claims, industrial production, copper-gold
  ratio, and oil prices.
- **Rate-sensitives** (Software, Biotech, Real Estate, Utilities,
  Mega-Cap Growth) load on real rates, term premium, and 10Y breakeven.
- **Financials** load on the yield curve slope, SLOOS C&I lending
  standards, and credit spreads.
- **Consumer-facing** (Retail, Consumer Services, Apparel) load on
  Michigan sentiment, real PCE, retail sales, and 30Y mortgage rate.
- **Defensives** (Staples, Health Care, Insurance) load on jobless
  claims and SLOOS C&I as recession indicators.

---

## Logic — what happens at the end of each week

**Step 1 — Forecast each industry group's next-month return.**
Per-asset OLS regression on factor panel (lagged 1 month). Last 60
months of asset return × shifted factors → coefficient estimates.
Forecast = α + β·X[T-1]. Shrink toward asset long-run mean by 50%
(Bayesian / James-Stein-lite). Output is a vector μ across all 25
industry groups.

**Step 2 — Compute trailing 6-month momentum** for each industry group
(strict prior 6 months, no current-month included — lookahead-safe).

**Step 3 — Detect regime flip.**
If R&L composite has dropped >15 points over the last 3 months AND is
now below +30, this is a stress-to-recovery regime change. Set
`regime_flip = True`.

**Step 4 — Select 5 industry-group picks:**

- **Normal mode (regime_flip = False):** confirmatory selection. Rank
  groups by indicator μ and by 6-month momentum. Eligible = both ranks
  above median. Pick top 5 by combined rank. Equal-weight 20% each
  (within the equity sleeve). Fallback: if fewer than 5 eligible, fill
  with indicator-positive only (NEVER momentum-positive only —
  indicators are forward-looking).
- **Regime-flip mode (regime_flip = True):** override momentum entirely.
  Rank by indicator μ alone. Pick top 5. Equal-weight 20% each. This
  catches V-bottoms where momentum is full of crash data and points the
  wrong way.

**Step 5 — Compute defensive sub-portfolio weights.**
Max-Sharpe across BIL/TLT/GLD/LQD with per-asset cap of 70%. Returns
4-vector.

**Step 6 — Equity-vs-defensive split (R&L composite):**

- R&L ≤ +20: equity weight = 100%
- R&L +20 to +30: scale 100% → 85% linearly
- R&L +30 to +50: scale 85% → 60% linearly
- R&L > +50: equity weight = 60% (max defensive — equity floor)

**Step 7 — Leverage decision (Inflation & Rates composite):**

- IR > +30: leverage = 1.0×
- IR 0 to +30: scale 1.0× → 1.10× linearly
- IR -10 to 0: scale 1.10× → 1.25× linearly
- IR -10 to -50: scale 1.25× → 1.50× linearly (capped at 1.5× per Joe's
  2026-04-25 directive)
- Override: leverage = 1.0× whenever R&L > +20 (don't lever in stress)

**Step 8 — Apply leverage and financing cost.**
If alpha > 1.0, financing drag = (alpha - 1.0) × (RF + 0.5%/12).
Subtract from realized portfolio return.

**Step 9 — Final weights:**

- Each of the 5 selected equity picks: weight = 20% × equity_share × leverage
- Each defensive bucket: weight = (proportion of defensive
  sub-portfolio) × (1 - equity_share)
- If levered: defensive = 0%, equity > 100%, financing drag applies

---

## Back-test summary

**Window:** Jan 2008 → Apr 2026, 220 months ≈ 18.3 years (includes GFC).

| Metric | v9.1 strategy | S&P 500 (SPY) | 60/40 (60% SPY + 40% AGG bonds) |
|---|---|---|---|
| CAGR (compounded annual) | **13.88%** | 11.06% | 8.02% |
| Sharpe ratio (3-mo T-bill RF) | **0.610** | 0.495 | 0.422 |
| Max drawdown | **−23.64%** | −46.32% | — |
| Cumulative return ($1 → $X) | **$10.84** | $6.84 | $4.12 |
| Calendar years winning vs S&P | 10 of 19 | — | — |

**v9.1 beats S&P 500 by:**

- +2.82 percentage points per year compounded
- +0.115 Sharpe
- 22.7 percentage points better max drawdown (cut roughly in half)

**Where v9.1 wins (regime-change years):** 2008 GFC (+22pp), 2010
(+10pp), 2013 (+17pp), 2020 (+2pp), 2022 (+4pp), 2026 YTD (+18pp).

**Where v9.1 lags (mega-cap-concentration years):** 2021 (-12pp), 2024
(-9pp), 2009 recovery (-6pp).

---

## Production deployment

- `compute_v9_allocation.py` runs weekly via the
  `V9-ALLOCATION-WEEKLY` workflow on Saturday morning UTC.
- A daily `v9 allocation auto-refresh` job re-publishes the latest
  rebalance with current prices for intra-week dashboard freshness.
- Writes `public/v9_allocation.json` with current state: 5 picks,
  weights, equity share, leverage, defensive composition,
  `all_industry_groups` (25-row scoring), regime_flip flag, composite
  values, last-rebalance date.
- React component in `src/pages/AssetAllocation.jsx` reads the JSON and
  renders the current allocation.
- No live trading; this is allocation guidance only.

---

## What's NOT in v9.1 (parked for future iterations)

- Scenario panel (interactive sliders for macro factors)
- Historical allocation playback / "what was I holding in 2020?"
- Style-factor overlay (value/momentum/quality/low-vol)
- International equity exposure (EAFE, EM)
- Anything above 1.5× leverage
- Continuous weighting (variable conviction across the top N picks
  rather than equal-weight 5)

---

## Refinement plan

Refinements ship as v9.2, v9.3, etc. Each refinement requires:

1. Back-test on the same 2008-2026 window
2. Comparison table vs v9.1 baseline (CAGR, Sharpe, max DD, calendar
   wins)
3. Senior Quant sign-off
4. UX Designer sign-off if UI changes
5. Lead Developer ships PR

Decisions that should NOT change without explicit re-approval:

- 1.5× leverage cap (Joe's call 2026-04-25)
- Industry-group level allocation (no cap dimension — Joe's call)
- Confirmatory selection rule (both indicator + momentum agree)
- 6-month momentum window (Joe's hunch validated 2026-04-25)
- Per-asset multivariate factor maps
- Top-5 equal-weighted selection
