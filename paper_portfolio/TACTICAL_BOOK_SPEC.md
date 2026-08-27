# MacroTilt Tactical — cross-asset book specification

**Status:** design, not built. Nothing trades on this yet.
**Author:** Lead Developer + Senior Quant, 2026-08-26.
**Supersedes:** Quality Trend (`paper_portfolio/qt/`), retired by Joe on 2026-08-26
before it ever traded on account PA30FE66XZSD.

---

## 0. Why Quality Trend is being replaced, honestly

Quality Trend is a good single-factor equity book: 40 US stocks, equal weight,
scored on momentum + gross profitability + buybacks + insider buying. It is also
**one bet expressed forty times**. Every name is a US-listed operating company;
`EXCLUDE_FUNDS = True` in `strategy_config.py` exists precisely to keep it that
way. Equal weight across forty correlated things does not diversify — it just
spreads the same beta thinly. In a drawdown driven by the market factor, all
forty go down together, and the 2022 backtest row (−6.7%) is what that looks
like in a mild version.

Joe's ask — high beta, blue-chip dividend, metals — is not a parameter change to
that engine. It is a different product: **allocate across assets that behave
differently, and let the differences do the work.**

### What is lost, and it should be said out loud

The published backtest (2017 → Aug 2026, ending $6,331,646 vs $3,915,646 for the
S&P) belongs to Quality Trend. It does **not** describe this book and must not be
shown next to it. This book starts with no track record at all. Anyone reading
the site should be told that plainly rather than being allowed to carry the old
number across.

---

## 1. The macro question this book is built around

Joe's framing question: *how to think about allocation during periods of high
inflation and high government debt.*

This is a genuinely contested area and reasonable people disagree. The framework
below is the one this book implements; it is not the only defensible one, and
the counter-arguments are stated so the design can be argued with.

**The core claim.** In a high-inflation, high-public-debt regime, the historical
stock/bond hedge weakens. Bonds stop reliably rallying when equities fall,
because the same force — inflation, and the fiscal response to it — hurts both.
The 2022 experience is the recent worked example: a 60/40 book lost on both legs
at once. If bonds are no longer the diversifier, something else has to be.

**What tends to be argued as the substitute:**

- **Real assets** (gold, silver, miners, broad commodities) — claims on things
  rather than on promises denominated in the currency being debased. Their
  correlation to equities is low and unstable, which is the point: a hedge that
  is reliably correlated is not a hedge.
- **Equity with pricing power** — businesses that can pass costs through.
  Inflation is not uniformly bad for equities; it is bad for margin-takers and
  fine for margin-setters. This is why "blue-chip dividend" is not the same as
  "defensive": a dividend payer with no pricing power is a bond substitute
  wearing an equity costume.
- **Short duration cash** — in a high-rate regime, T-bills pay you to wait. This
  is the least glamorous and often the highest risk-adjusted leg.

**The counter-case, which is real.** Gold pays no coupon and can spend a decade
going nowhere (1980–2000). Commodity exposure has historically been a poor
long-run compounder net of roll costs. "This time the stock/bond correlation has
permanently changed" has been claimed at every inflation scare and has usually
mean-reverted. A book built entirely on the regime thesis is itself a
concentrated macro bet — which is the thing this design is supposed to avoid.

**How the design resolves it.** The book does **not** take a view on whether the
regime thesis is right. It holds all four legs and lets the covariance matrix
decide the sizes. If metals and equities stop being uncorrelated, metals lose
weight automatically. The thesis informs *what is in the universe*; the math
decides *how much of each*. That distinction is the whole design.

---

## 2. Sleeves

Four sleeves. ETFs are permitted here — `EXCLUDE_FUNDS` must become sleeve-aware
rather than globally true, since the natural instruments for metals and duration
are funds.

| Sleeve | What it is | Instruments |
|---|---|---|
| **High beta / growth** | The return engine. Single names, momentum + quality scored. | 8–12 US single names, screened by the existing QT score |
| **Blue-chip dividend** | Cash-generative large caps with pricing power. NOT bond proxies. | 5–8 single names, dividend + FCF + pricing-power screen |
| **Metals & real assets** | The regime hedge. | Gold, silver, miners, broad commodity — ETFs |
| **Short duration** | Ballast and dry powder. Earns the front-end rate. | T-bill / floating-rate ETFs |

Target **20 total positions**, which is Joe's stated number and lands naturally:
roughly 10 + 6 + 3 + 1.

### Screening note on "blue-chip dividend"

Selecting on dividend yield alone reliably selects for **distress** — a high
yield is often a falling price, not a generous board. The screen must be
yield **plus** free-cash-flow cover plus a positive gross-margin trend, and
should exclude names whose payout ratio exceeds free cash flow. Otherwise this
sleeve becomes an accidental value trap and correlates hard to the thing it is
supposed to cushion.

---

## 3. Sizing — risk, not dollars

Per Joe, 2026-08-26: *"vol weighted or expected risk return weighted. Kind of
like the portfolio lab page. I want it to take into account cross asset
correlations as well."*

The math already exists and is unit-tested in `src/overhaul/lib/labMath.js`,
which the Portfolio Lab page uses. **Reuse it — do not write a second
implementation.** Two surfaces computing risk differently is how a site starts
contradicting itself. Available and directly relevant:

- `covMatrix(retsByTicker, order)` / `corrMatrix(...)` — the cross-asset
  correlations Joe asked for
- `portfolioVol(weights, S)` — book-level volatility
- `riskContribution(weights, S)` — how much of the risk each position actually
  contributes, which is the number that matters and is nothing like its dollar
  weight
- `minVarianceForTarget(S, mu, target, P, iters)` — constrained optimiser
- `projectSimplex(v)` — enforces long-only, fully-invested
- `capmAnnualER`, `riskCompensationER` — expected-return inputs
- `efficientFrontier(S, mu, rf)` — for the page, so Joe can see where the book
  sits versus the frontier

### The procedure, each rebalance

1. **Estimate.** 252 trading days of daily returns for every candidate. Build the
   covariance matrix. Shrink it — a raw sample covariance on ~20 assets and 252
   observations is badly conditioned and the optimiser will happily concentrate
   into whichever asset has the most estimation error. Ledoit–Wolf shrinkage
   toward a constant-correlation target is the standard fix and is not optional.
2. **Expected returns.** Deliberately weak inputs. Mean-variance optimisation is
   notoriously sensitive to expected returns and will produce absurd corner
   solutions if fed confident forecasts. Use risk-compensation ER (return
   proportional to risk taken) rather than any attempt at forecasting, and let
   the covariance do the real work.
3. **Allocate across sleeves by equal risk contribution.** Each sleeve
   contributes ~25% of total book variance. This is where correlations earn
   their keep: metals get a *larger dollar* weight than their volatility alone
   would suggest, precisely because they diversify. If that correlation
   disappears, so does the weight — automatically, with no judgement call.
4. **Allocate within a sleeve** by inverse-vol, tilted by the sleeve's own score.
5. **Constrain**: long-only, no leverage, gross ≤ 100%. Max 8% in any single
   position, max 40% in any sleeve. Minimum position 1.5% — below that it is
   noise and costs more in spread than it contributes.
6. **Vol target.** Scale the whole book toward 12% annualised. If the optimised
   book runs hotter, the residual goes to the short-duration sleeve rather than
   being levered down. Cash is a position, not a failure.

### The honest limitation

Covariance estimated from trailing returns is backward-looking, and correlations
go to 1 in a crisis — exactly when the diversification is most needed. This book
will not be saved by its correlation matrix in a genuine liquidity event. What
it buys is better behaviour in the other 95% of the time, and a much clearer
account of *why* it holds what it holds.

---

## 4. Rebalance and risk controls

- **Monthly**, first trading day, same cadence as QT.
- **Drift band**: no trade unless a position is more than 25% off its target
  weight in relative terms. Prevents churning on noise.
- **Vol-target check** runs monthly with the rebalance, not continuously —
  daily vol targeting is a well-known way to sell every bottom.
- **No discretionary override.** If the model says reduce, it reduces.

### On the stop-loss / trend-filter question in Joe's Gemini notes

The notes argue for a mechanical exit trigger over a discretionary feeling, and
that part is sound. The specific caution worth adding: a trailing stop or moving
average filter on a **risk-balanced multi-asset book** behaves very differently
from one on a concentrated momentum book. Applied at the book level it mostly
converts a diversified portfolio into an expensive market-timing strategy, with
the whipsaw costs the notes themselves describe. If a trend filter is wanted, it
belongs **inside the high-beta sleeve only** — where trend-following has an
actual evidence base — and not across the whole book. That is a design decision
Joe should make explicitly rather than inherit.

---

## 5. What this spec deliberately does not cover

Joe's Gemini notes are about his **personal** situation — a 1–2 year capital
requirement, a possible property purchase, a taxable account, and whether to stay
in momentum. Nothing here addresses that, and this document should not be read as
doing so. This is a specification for a **paper research book** published on
macrotilt.com. Position sizes are notional, there are no tax consequences, and no
personal cash need is being funded.

Those personal questions turn on facts a strategy spec cannot see — the actual
horizon, how firm the property plan is, the tax basis in existing positions, and
how much of a drawdown is genuinely survivable versus merely uncomfortable. They
are worth putting to a licensed advisor who can see the whole balance sheet. I am
not one, and a paper book's sleeve weights are not an answer to them.

---

## 6. Build order

1. `paper_portfolio/tactical/universe.py` — sleeve definitions, eligibility per
   sleeve, ETF allowance
2. `paper_portfolio/tactical/risk.py` — covariance with Ledoit–Wolf shrinkage,
   risk contribution, the constrained optimiser. **Port from `labMath.js` and
   test the two against each other on identical inputs** — if the Python and the
   page disagree, the site contradicts itself.
3. `paper_portfolio/tactical/rebalance.py` — target book writer
4. Backtest the whole thing before a dollar of paper money moves. QT's backtest
   does not transfer.
5. Site: retire the Quality Trend framing on `/paper`, or the public page keeps
   claiming a strategy that no longer exists.

Steps 1–4 are the real work. Step 5 is not optional and is not cosmetic: the
page is public and currently presents Quality Trend as the house book.
