# MacroTilt Tactical — cross-asset allocation engine

**v2, 2026-08-28. Supersedes the v1 "sleeves" spec entirely — Joe: "I don't want
sleeves. I want a market-leading asset allocation engine that rebalances
regularly."** Status: BUILT and backtested; not yet trading. Launch is Joe's call.

## What it is

One flat universe — 14 ETFs spanning US/intl/EM equities, dividend blue chips,
treasuries, TIPS, high-yield credit, gold, silver, commodities, REITs — plus
T-bills as the cash leg. No groups, no labels. Every asset answers the same two
questions each month:

1. **Is it trending up, net of cash?** Momentum = average of 1/3/6/12-month
   returns minus the same for T-bills. Positive or you're out this month.
2. **What does it add to the book's risk?** A shrunk covariance matrix sizes
   positions by risk budgeting: each holding contributes its budgeted share of
   book risk, budgets tilted 1x..2x by momentum rank. Diversifiers get MORE
   dollars than their volatility suggests precisely because they diversify.

One throttle on top: **10% annualised vol target** (no leverage; unused risk sits
in T-bills earning the front-end rate), halved to 5% when the stress composite
(VIX percentile + high-yield drawdown percentile, 3y windows, with hysteresis) is
on. Monthly rebalance, weekly stress check. Caps: 25% max per asset, 2% minimum,
long-only.

## Backtest, 2008 → Aug 2026, net of 5bp costs, signals lag execution by a day

|                    | CAGR | Vol | Sharpe | Max fall | 2022 |
|--------------------|------|-----|--------|----------|------|
| **Tactical engine**| 5.9% | 6.9% | **0.68** | **-13.2%** | **-8.0%** |
| same, overlay off  | 5.8% | 7.6% | 0.61 | -16.2% | -9.1% |
| S&P 500            | 11.4% | 19.8% | 0.58 | -51.9% | -18.2% |
| 60/40              | 8.6% | 11.4% | 0.67 | -30.8% | -16.4% |

GFC 2008 top-to-bottom: engine -0.3% while the S&P halved. COVID crash: -9.3% vs
-33.7%. What it costs: the engine compounds well behind stocks in long bulls
(since 2023: +49% vs +112%). This is a defensive allocator — return per unit of
worst-case pain is where it wins (0.45 vs 0.28 for 60/40, 0.22 for the S&P).
The overlay's contribution is honest and visible: +0.07 Sharpe, 3pp less max
drawdown. **The dial that trades pain for return is the vol target; leverage is
off. Both are one-line changes that belong to Joe, not the engine.**

## Disclosed without being asked

- Two real bugs were found and fixed during the build, each caught by a check
  that now lives in `test_engine.py`: (1) the first weight solver silently
  zeroed gold, silver, commodities and SCHD — the exact assets the engine exists
  to hold (naive risk-parity iteration oscillates; replaced with cyclical
  coordinate descent, risk contributions now match budgets to machine
  precision); (2) the position-cap logic re-violated its own 25% cap after
  renormalising (a 90% weight "capped" to 47%; replaced with proper
  redistribution).
- Parameters were written down before the first backtest run and not tuned
  after. The numbers above are the first honest run of the fixed code.
- The backtest's credit-stress input proxies HY spreads with HYG's own drawdown
  (the OAS series on file starts 2011); live, the overlay reads the site's real
  VIX / HY-OAS feeds.
- SCHD does not exist before late 2012 and simply isn't in the early backtest.
- Quality Trend's published 2017-2026 backtest describes a retired strategy and
  must never appear next to this engine's record.

## Files

`paper_portfolio/tactical/`: `engine.py` (signals, covariance, solver, caps,
overlay), `fetch_data.py` (reproduces the dataset), `backtest.py` (driver),
`test_engine.py` (guard rails — the solver test is the one that matters).
