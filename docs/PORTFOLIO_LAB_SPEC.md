# Portfolio Lab — Build Spec
**Date:** 2026-07-27 · **Status:** SHIPPED — Phases 1–2 live 2026-07-27 (day), Phase 3 (Implied vol) live 2026-07-27 (evening) on the London Strategic Edge free feed
**Council:** Senior Quant (lead — methods & optimizer) · UX Designer (layout sign-off) · Lead Developer (data & build sign-off) · Data Steward (consulted — feeds & freshness)

---

## 1 · What this is

A new logged-in page, **Portfolio Lab** at `/portfolio-lab`, added to the site nav.
Users calculate expected return (ER) for single stocks, build portfolios, optimize
weights, and compare against benchmarks. A single stock is just a portfolio of one —
one workspace, no tabs.

Joe's locked decisions (popup, 2026-07-27):

| Decision | Choice |
|---|---|
| Layout | One workspace |
| ER methods at launch | CAPM · Weighted Scenarios · Implied Options Vol |
| Optimizer | Efficient frontier (click a point to load weights) |
| Persistence | Save/load named portfolios per user (Supabase, RLS) |
| Benchmarks | SPY / QQQ / IWM / DIA + sector-ETF blend |
| Stats | Core set (ER, vol, Sharpe, beta, max drawdown, correlation matrix, risk contribution) |
| Universe | Any US ticker Polygon covers (on-demand fetch → prices_eod) |
| Access | Logged-in only |
| Horizon | 1-year default, toggle 3m / 6m / 1y / 3y |
| Frontier ER input | User's active method per holding (mixable); covariance always historical |
| Scenarios UI | Fixed Bull / Base / Bear — target price + probability, must sum to 100% |

---

## 2 · Page layout (UX Designer)

Top to bottom, one column on phone (390px check binding per LESSONS 8.10):

1. **Header row** — page title, saved-portfolio picker (load/save/rename/delete),
   horizon toggle, global ER-method switcher (sets default for all holdings).
2. **Holdings table** — the centerpiece. Columns: Ticker · Last price · Weight ·
   ER method (per-row override) · Expected return · Expected range · row actions.
   Add-ticker input with typeahead against ticker_reference. Removing a row
   re-normalizes weights with a visible "weights sum to X%" tally; a Rebalance-to-100
   button appears when the sum drifts.
   - Weighted Scenarios rows expand an inline drawer: Bull/Base/Bear target price +
     probability inputs; validation blocks save until probabilities sum to 100%.
3. **Efficient frontier card** — risk (x) vs expected return (y). Curve computed
   long-only, weights sum to 100%, per-stock cap default 100% (no cap). Current
   portfolio plotted as a dot; benchmarks plotted as reference dots. Click any point
   on the curve → those weights load into the table (with an Undo).
   Preset markers on the curve: Max Sharpe · Min Volatility · Equal Weight.
4. **Statistics card** — the core set, portfolio vs. selected benchmark side by side:
   expected return (from active methods), historical volatility, Sharpe, beta vs SPY,
   max drawdown (simulated: current weights held over the lookback), tracking
   difference vs benchmark. Correlation matrix as a compact heat grid. Contribution-
   to-risk bar per holding.
5. **Benchmark comparison card** — growth-of-$10K line: portfolio (current weights,
   historical, rebalanced monthly) vs chosen benchmarks. Benchmark picker: SPY, QQQ,
   IWM, DIA, and "Sector mix" (the portfolio's sector weights mapped to SPDR sector
   ETFs — the honest like-for-like comparison).

Brand: light-mode-first, existing theme tokens only (LESSONS 6.4), one accent surface
max, all tooltips instant via the Tip component (6.13), responsive.css extended in the
same PR (8.7/8.10), both themes screenshot-verified (3.1.5).

---

## 3 · The three ER methods (Senior Quant)

All math ships with hand-computed paper checks in the PR body (LESSONS 3.4).
Methodology page gets a Portfolio Lab section in plain academic English (8.4)
sourced from the production code (8.3).

### 3.1 CAPM
`ER = risk-free + beta × equity risk premium`, scaled to the selected horizon.
- **Beta:** regression of the stock's daily returns on SPY daily returns over the
  full overlap available in prices_eod (min 1 year required; else the row shows an
  em-dash + "insufficient history" — never a fabricated value, LESSONS 4.4).
- **Risk-free:** live 3-month Treasury yield from our existing Treasury.gov feed
  (matched to horizon via the curve we already store: 3m/6m/1y/3y).
- **Equity risk premium:** a single site-wide constant, sourced from Damodaran's
  published current implied ERP, stored in a calibration JSON (the spec IS the file,
  8.2), shown in the method tooltip, reviewed quarterly. Never hardcoded in UI (4.11).

### 3.2 Weighted Scenarios
`ER = Σ probability × (target ÷ last price − 1)`. Pure user input + arithmetic; no new
data. Expected range shown = worst/best scenario. Scenario inputs are saved with the
portfolio.

### 3.3 Implied Options Vol — honest framing (quant decision, made silently per LESSONS 1.3)
Options prices give the market's expected RANGE, not a directional expected return
(risk-neutral drift ≈ risk-free — useless for ranking). So this method is framed as
what it is:
- **Displayed per stock:** the options-implied expected move for the horizon
  (from ATM implied vol at the nearest listed expiries, interpolated), rendered as
  "market-implied range: ±X%" plus the implied 1-year vol.
- **In the optimizer under this method:** drift comes from CAPM; the stock's
  volatility input swaps from historical to implied (correlations stay historical,
  diagonal rescaled). This is a standard practitioner blend and will be stated
  plainly in Methodology.
- **Data dependency:** currently the per-contract options feed (Unusual Whales) —
  **lapses 2026-08-12.** See Decision 1. No IV data for a name → method unavailable
  for that row, em-dash + reason, selector falls back to CAPM.

### 3.4 Optimizer
Mean-variance frontier, long-only, fully-invested. Covariance from daily returns over
the trailing lookback (default 2 years — the guaranteed depth for on-demand names per
LESSONS 7.2), annualized, then horizon-scaled. ER vector = each holding's active
method. Computed client-side (quadratic programming over ~50 grid points of target
return; portfolios capped at 30 names, so it's milliseconds). Paper check before
merge: a hand-computed 2-asset and 3-asset frontier must match to rounding.

**Backtest/validation note (non-negotiable rule, scoped honestly):** this page makes
no trade signals, so there is no strategy backtest. Validation = (a) paper-check
harness on every formula, (b) beta/vol/Sharpe parity check for 10 well-known names
against an independent source (TOS columns — the standing UAT tool per 4.20d),
(c) frontier sanity: min-vol portfolio vol ≤ every single-asset vol.

---

## 4 · Data & plumbing (Lead Developer + Data Steward)

- **Prices:** prices_eod (current post-split basis, 4.20). On-demand tickers fetched
  from Polygon (~2-year cap, 7.2) via the existing screener cold-pull pattern, paged
  per 4.18. New-name fetch happens on add, with a loading state.
- **Risk-free / curve:** existing Treasury.gov daily feeds. No new feed.
- **Options IV:** existing options_eod table while UW lives; see Decision 1.
- **Freshness chips (Hard Rule 0.1):** every data-driven value (last price, beta,
  risk-free, IV) carries the standard 5-field chip reading the EXISTING pipeline_health
  rows of its producing feed (massive-daily prices, treasury daily, UW options). User
  inputs (weights, scenarios) carry no chip — they are not feed data.
- **Saved portfolios:** new table `portfolio_lab_portfolios`
  (id, user_id, name, holdings jsonb [ticker, weight, method, scenarios], horizon,
  benchmark, created_at, updated_at). RLS: owner-only. Migration from the grant
  template (6.10). This is user content, NOT a data feed — no manifest entry needed;
  the manifest/chips cover only the feed-derived values above.
- **No new producers, no new schedules** in Phase 1–2. Impact map (0.2) still ships
  in the PR: consumers = this page only + Methodology section + nav (desktop sidebar
  AND mobile TopNav, 8.7).

---

## 5 · Build phases

| Phase | Contents | Notes |
|---|---|---|
| 1 | Page shell + nav + auth gate · holdings table · CAPM + Weighted Scenarios · stats card · benchmark chart · save/load | Ships alone; page is useful day 1 |
| 2 | Efficient frontier card + presets + click-to-load | Math paper-checked pre-merge |
| 3 | Implied Options Vol method | SHIPPED 2026-07-27 eve — source: London Strategic Edge ATM implied vol (free), per §3.3's honest framing; names without listed options fall back to CAPM with an em-dash note |

Each phase: separate PR off main (6.9), self-UAT on the live rendered page in both
themes + 390px (3.1, 8.10), specialist sign-offs in the PR description, agent merges
its own work (8.8).

---

## 6 · Open decision for Joe — RESOLVED 2026-07-27

**Decision 1 — options data after August 12.** RESOLVED: Joe approved the free London
Strategic Edge feed as the options/implied-vol source (augment at $0; no paid tier).
The implied-vol method shipped the same evening; the Aug 10 automated health review
covers the feed before the Unusual Whales lapse on Aug 12. Original options were: The implied-vol method's only data
source is the Unusual Whales subscription ($150/mo), which we're paid through
2026-08-12 and are otherwise replacing with free SEC EDGAR (which has no options
data). Paths:
- **(a) Keep UW** solely for options data — $150/mo continues.
- **(b) Add Polygon's options plan** (Starter tier ≈ $29/mo, includes per-contract
  quotes/greeks — Lead Dev verifies exact tier + fields before commitment).
- **(c) Ship Phases 1–2 now, hold the IV method** until a source is chosen.

Recommendation: **(c) now + (b) evaluated** — don't let a $150/mo renewal ride on one
page feature; Phases 1–2 don't need options data at all.
