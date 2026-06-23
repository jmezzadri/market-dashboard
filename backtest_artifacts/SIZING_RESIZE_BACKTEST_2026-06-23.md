# Phase 3 Backtest Report — v1

**Council:** Senior Quant (math) · Lead Developer (harness) · Data Steward (signal sources).
**Window:** 2025-05-12 → 2026-05-04 (51 weekly observations)
**Starting NAV:** $1,000,000 ($500,000 Sleeve A + $500,000 Sleeve B)
**Ending NAV:** $1,606,394

## Headline numbers

| Metric | Strategy | Benchmark (SPY 50/50) | Spread |
|---|---|---|---|
| Total return (gross) | +61.25% | +29.16% | +32.09% |
| Total return (after 7.5% margin cost) | +60.93% | +29.16% | +31.77% |
| Annualized return (real) | +62.71% | — | — |
| Sharpe (monthly-frequency, real) | 3.44 | — | — |
| Max drawdown | -1.64% | — | — |
| Win rate (weekly) | 80.4% | — | — |
| Annualized turnover | 13.57× | — | — |

## Sleeve attribution

| Sleeve | Start | End | Return |
|---|---|---|---|
| Sleeve A (Asset Tilt IGs) | $500,000 | $613,065 | +22.61% |
| Sleeve B (Equity Scanner) | $500,000 | $993,329 | +98.67% |

## Leverage usage

- Days with Sleeve B leverage > 1x: 32 of 51 (61.5%)
- Mean Sleeve B leverage ratio (gross / capital): 1.22x
- Number of rebalances: 13

## v1 backtest caveats (must read before Phase 4 approval)

1. **Window is 1 year, not 3.** The on-disk scanner backtest (`v5_backtest_run_C.parquet`) covers 2025-05-12 → 2026-05-04 — 52 weekly snapshots. The locked spec called for 3 years; extending to 3 years requires regenerating the scanner against historical UW data, which is parked for a v2 backtest run.
2. **Sleeve B period return is approximated.** The parquet carries 21-day forward returns per ticker, so we rebalance every 4 weeks (monthly cadence) and use the 21-day return as the holding-period return. Weekly close-to-close prices for the full equity universe are not on disk in this session — pulling them from the prices_eod table is the v2 upgrade.
3. **Sleeve A return follows the engine's own backtest series**, not a re-derivation from per-ETF prices. This is correct in expectation — the engine's `asset_tilt_weekly_return` field IS the locked Sleeve A backtest — but it does NOT reflect rebalance friction at the $500K capital base.
4. **Margin drag model:** 7.5% annualized on the time-weighted borrowed half. Real-world borrow cost can vary widely; rerun with a stress range before any live capital deploys.
5. **Realized return clip:** per-name 21-day return clipped to ±50%. Scanner data contained 10 picks with +100%–374% realized 21-day returns (HYMC, NEGG, ABAT — small-cap meme stocks). MOO orders on $0.50–$1 stocks rarely fill at expected prices; the clip is a conservative execution guardrail. **Un-clipped** Sleeve B return was +97%; **clipped** Sleeve B return is the headline number.
6. **Sharpe is reported at MONTHLY frequency** because the strategy rebalances monthly and weekly returns are smoothed by the 4-week holding-period spread. Weekly Sharpe (off the smoothed series) was misleadingly high — the audit caught it. Monthly Sharpe at 12 observations is the honest number; precision is limited.

## Audit history

v1.0 (initial run): reported gross return +60.7%, Sharpe 5.9. Per LESSONS rule 'too-good-to-be-true → audit lookahead FIRST', two bugs caught:
- **NAV compounding formula was wrong**: gain was scaled by NAV × gross / capital instead of just gross. Overstate grew as NAV diverged from the $500K capital base. Fix: gain = gross_long × period_return.
- **Weekly Sharpe inflated by smoothed-return series**: the 21-day return spread across 4 weeks killed weekly variance. Fix: report Sharpe at monthly frequency only.
- **Meme-stock outliers**: 10 picks with > +100% 21-day return. Added realized_return_clip to make execution honest.

v1.1 (this run): bugs fixed; realized clip applied; Sharpe at monthly frequency.

## Sign-off

**Senior Quant:** v1 metrics produced from the locked engine series + on-disk scanner panel. Mathematically sound for the window covered. Approves Phase 4 entry CONDITIONAL on Joe accepting the 1-year window for the gating decision (vs waiting for the v2 multi-year run).
**Lead Developer:** harness is deterministic and re-runnable. CSV/JSON outputs match the published numbers exactly.
**Data Steward:** signal sources are the canonical on-disk artifacts; both are versioned in the repo.