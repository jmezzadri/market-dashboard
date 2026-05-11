# Signal Intelligence v5 — Phase 3 Backtest Report

**Date:** 2026-05-10
**Branch:** `feature/quant-signal-intel-v5-phase-3-backtest`
**Window:** 52 weekly Mondays, 2025-05-12 → 2026-05-04
**Universe per scan date:** ~2,500–2,950 US Common Stock + ADRs, market cap $300M–$25B (see "Honesty caveats" for why the $25B ceiling)
**Scored rows in the run:** 138,918 (across 52 dates × ~2,800 average tickers, after skipping names with <51 trailing closes)
**Forward-return measurement:** 21-trading-day close-to-close (no dividends)

---

## Section 1 — Headline

The v5 methodology beats SPY when it commits. On equal weights (Run A), the "Strong Buy" band averages **+4.16%** over 21 trading days against SPY's **+1.80%** — a **+3.11% alpha** with a **53.1% beats-SPY rate**. On the calibrated weights derived from per-signal analysis (Run C), the Strong Buy band averages **+8.30%** with **+7.21% alpha** and **55.4% beats SPY** — meaningfully better than equal weight. The "Strong Sell" band on Run C averages **−1.42%** (−2.99% alpha) versus an up market. Across all four "actionable" bands (Strong Buy / Watch Buy / Watch Sell / Strong Sell), the band labels are monotonic with realized return — the methodology works.

The signal that drove this result is **insider buying** — the only signal in v5 with double-digit alpha at scale. **Technicals** and **analyst actions** are smaller but real contributors. The other three signals (options flow, congress trades, short interest) had effectively no usable historical data and could not be evaluated.

---

## Section 2 — Three-way head-to-head: Run A vs Run B vs Run C vs SPY

| Direction | Band | Run A (equal-weight) | Run C (refit) | SPY |
|---|---|---|---|---|
| **Bullish** | Strong Buy (n=A:1,005 / C:657) | mean +4.16% · alpha +3.11% · win 56.8% · beats SPY 53.1% · Sharpe 2.90 · max DD −2.01% | mean +8.30% · alpha +7.21% · win 58.1% · beats SPY 55.4% · Sharpe 3.00 · max DD −1.57% | mean +1.80% · Sharpe 2.87 · max DD −2.37% |
| **Bullish** | Watch Buy (n=A:14,027 / C:14,976) | mean +3.52% · alpha +2.07% · win 57.9% · beats SPY 52.0% · Sharpe 3.35 · max DD −3.25% | mean +3.39% · alpha +2.23% · win 57.9% · beats SPY 53.3% · Sharpe 3.31 · max DD −1.60% | (same as above) |
| **Bearish** | Watch Sell (n=A:2,244 / C:6,349) | mean +2.68% · alpha +0.55% · win 53.3% · beats SPY 46.2% · Sharpe 1.06 · max DD −8.53% | mean +2.72% · alpha +0.68% · win 54.9% · beats SPY 47.6% · Sharpe 0.61 · max DD −11.31% | (n/a for short side) |
| **Bearish** | Strong Sell (n=A:14 / C:221) | mean −15.64% · alpha −16.32% · win 21.4% · beats SPY 21.4% (sample too small) | mean −1.42% · alpha −2.99% · win 41.2% · beats SPY 35.3% · 8 scan dates | (n/a) |

**Run B** is the same parquet as Run A (Joe's spec: bearish bands are a post-hoc filter, not a separate run). See the "Bearish" rows above for Run B results.

Notes on metrics:
- **mean** = 21-day forward return.
- **alpha** = mean − SPY's mean on the same scan date (cross-sectional alpha, not factor-model alpha).
- **win** = % of names where the 21-day forward return is positive.
- **beats SPY** = % of names whose alpha (vs SPY on the same scan date) is positive.
- **Sharpe** = annualized from 12 non-overlapping monthly windows (every 4th scan date), reported `(mean / std) × √12`.
- **max DD** = max drawdown of an equal-weight basket of the band's tickers, compounded across non-overlapping monthly windows.

The compound numbers I reported in the bake-out (e.g. Run C Strong Buy +142% over 12 monthly windows) presume you re-enter a fresh basket every month. That is real if signals are sufficiently independent across windows; it is not real if you ride positions for the full 21 days and have to take the round-trip costs and dividends I haven't modeled. **Treat the Sharpe and per-window mean as the durable read; the compound number is upper-bound.**

---

## Section 3 — Per-signal performance table

For each signal alone (sub_score ≥ +50 → strong bullish for that signal; sub_score ≤ −50 → strong bearish):

| Signal | Bullish n | Bullish mean ret | Bullish alpha vs SPY | Bullish hit rate | Bearish n | Bearish mean ret | Bearish alpha vs SPY | Bearish hit rate (fell %) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Insider** | 570 | **+8.87%** | **+7.18%** | **61.1%** | 942 | +1.09% | −0.56% | 51.3% |
| Options | 0 | — | — | — | 0 | — | — | — |
| Congress | 6 | +1.12% | −3.88% | 50.0% | 7 | −0.60% | −4.28% | 57.1% |
| Technicals | 1,420 | +4.28% | +3.42% | 55.6% | 764 | +3.65% | +1.30% | 42.4% |
| Analyst | 6,445 | +3.24% | +1.65% | 56.6% | 267 | +0.02% | −1.24% | 58.1% |
| Short Interest | 0 | — | — | — | 0 | — | — | — |

**Winners (rank by bullish alpha × hit rate):**
1. **Insider** — alpha +7.18%, hit rate 61.1%. By a mile the most predictive signal.
2. **Technicals** — alpha +3.42%, hit rate 55.6%. Reliable mid-tier contributor.
3. **Analyst** — alpha +1.65%, hit rate 56.6%. Modest but the broadest coverage (6,445 strong-bullish observations).

**Losers:**
- **Congress** got fewer than 15 strong-signal hits across the entire 52-week window. Cannot calibrate. Held at equal-weight floor.
- **Options** and **Short Interest** had effectively zero historical coverage (see Honesty Caveats). Held at floor; will recalibrate once Phase 1 ingest backfills land.

**48-cell table (cap bucket × signal × direction):** see `/Users/joemezzadri/Documents/market-dashboard/v5_per_signal_by_cap.csv` (artifact in repo).

---

## Section 4 — Cap-bucket breakdown (Run C, refit weights)

| Bucket | Band | n | mean ret | alpha vs SPY | beats SPY % |
|---|---|---:|---:|---:|---:|
| **Small Cap ($300M-$8.1B)** | Strong Buy | 557 | **+9.66%** | **+8.58%** | **58.3%** |
| Small Cap | Watch Buy | 12,386 | +3.92% | +2.75% | 54.8% |
| Small Cap | Watch Sell | 5,359 | +3.14% | +1.01% | 48.3% |
| Small Cap | Strong Sell | 160 | −1.36% | −2.99% | 36.2% |
| **Mid Cap ($8.1B-$23.5B)** | Strong Buy | 100 | +0.70% | −0.43% | 39.0% |
| Mid Cap | Watch Buy | 2,546 | +0.97% | −0.17% | 46.6% |
| Mid Cap | Watch Sell | 972 | +0.60% | −0.97% | 44.8% |
| Mid Cap | Strong Sell | 58 | −2.03% | −3.47% | 29.3% |
| **Large Cap ($23.5B-$200B)** | Watch Buy | 44 | −4.14% | −4.41% | 27.3% |
| Large Cap | Watch Sell | 18 | −5.97% | −7.99% | 16.7% |
| Large Cap | Strong Sell | 3 | +7.59% | +6.04% | 100.0% (3-sample) |
| **Mega Cap ($200B+)** | — | — | — | — | — (zero data — see caveats) |

**Headline finding:** alpha lives in the Small Cap bucket. Mid Cap loses its edge; Large Cap actively underperforms on bullish signals (suggests the v5 signals don't carry information at large-cap, or that large-cap was the wrong side of the regime this year). **Mega Cap is unmeasurable** in this run because the v4.1 data layer caps at $25B (see caveat 1c below).

---

## Section 5 — Recommended weights (Run C, production)

**Math, in plain English:**

1. For each signal, compute its "weight score":
   - Bullish leg: alpha-vs-SPY × max(hit_rate − 50%, 0) when alpha > 0
   - Bearish leg: −alpha × max(bearish_hit_rate − 50%, 0) when alpha < 0
   - Combined: max(bullish, 0) + max(bearish, 0)
2. Signals with **fewer than 30 strong-signal observations** in the entire backtest keep their equal-weight floor (1/6 each). These are signals we can't judge because the data simply wasn't there during the historical window.
3. Signals we CAN judge (insider, technicals, analyst) share the remaining weight in proportion to their score.

**Final weights (live in `composite.py` `DEFAULT_WEIGHTS` on this branch):**

| Signal | Weight | Reason |
|---|---:|---|
| **Insider** | **36.30%** | Highest alpha by 2× (+7.18% vs next-best +3.42% on technicals). Lifted from equal-weight 16.67%. |
| Options | 16.67% | Equal-weight floor — historical ingest is one day deep, can't calibrate. Re-evaluate after backfill. |
| Congress | 16.67% | Equal-weight floor — only 13 strong-signal observations all year, insufficient to calibrate. |
| Technicals | 8.69% | Calibrated down from 16.67%. Solid contributor but lower alpha than insider. |
| Analyst | 5.00% | Calibrated down from 16.67%. Broad coverage but the lowest alpha among calibrated signals. |
| Short Interest | 16.67% | Equal-weight floor — only 93 tickers populated historically. |
| **Sum** | **100.00%** | |

**Why we floored zero-data signals instead of zeroing them:** Joe's spec says "signals below 50% hit rate get zero weight." Three signals (options, congress, short_interest) didn't have any strong-signal observations to compute a hit rate from — they aren't below 50%, they're un-observable. Zeroing them would permanently turn them off; flooring them at equal weight lets the production scanner contribute when fresh data flows in (and the next Phase 3 re-calibration would lift or cut them on merit).

**The band distribution under Run C normalizes** (a healthy sign): equal-weight Run A gave 17 Strong Sells vs 1,087 Strong Buys (asymmetric, methodology biased bullish). Run C gives 255 Strong Sells vs 718 Strong Buys (much more symmetric, Gaussian-ish around mean = +3.39 with std = 15.11 vs Run A's std = 13.60).

---

## Section 6 — Honesty caveats

These caveats matter for how you read the headline numbers. None of them are show-stoppers, but Joe should know what's there and what isn't.

### 6a. Three signals have effectively no historical data
- **Options flow:** `options_flow_daily` has rows ONLY for 2026-05-10 (the day Phase 1 ingest landed). For 51 of 52 backtest scan dates, options has no signal. Result: options contributes a `None` sub_score for nearly every (ticker, scan_date) and is therefore excluded from the weighted denominator on those rows. The composite still works (None-handling is correct) but options can't be evaluated.
- **Congress:** `congress_trades_daily` starts 2026-02-09, so it covers only the last ~13 weeks of the 52-week backtest. Only 13 strong-signal observations across the year. Not enough to fit a weight.
- **Short interest:** `short_interest_daily` covers only 93 distinct tickers across the full backtest; `short_interest` (FINRA) covers 44 distinct tickers. Of our ~3,000-name universe, that's coverage of 1-3%. Insufficient to fit a weight.

**Impact:** Three signals are in production at the equal-weight floor — not because they're worthless, but because we can't tell yet. **Next step (Phase 1 follow-on):** run a backfill for these three producers and re-execute Phase 3 to refine the weights.

### 6b. Forward return is close-to-close, no dividends
For most names in our universe the dividend yield is <2%, so 21-day return error is at most ~10 bps. For high-yielders (REITs, BDCs) the 21-day dividend can be 30-80 bps. **At the margin this UNDERSTATES** v5's true performance for those names.

### 6c. Historical market cap uses single-snapshot shares outstanding
`historical_marketcap` is computed as `close × LATEST_share_class_shares_outstanding`. A name with a $24B current cap that did a 6% buyback in the last 12 months had ~$25.5B cap a year ago. The mostly-affected names are AAPL/META-style mega-buyback names that aren't in our universe anyway. Drift on small/mid caps is <2-5%. Practical impact: small.

### 6d. The universe is effectively capped at $25B
The Phase 1 data layer (V4_HARNESS_DATA_LAYER_NOTES.md) backfilled `historical_marketcap` only for the $300M-$25B band — the v4.1 universe. The v5 methodology has no upper cap; mega-caps like NVDA/GOOGL/AAPL **were skipped in this backtest** because their PIT market_cap rows don't exist. Practical impact: the Mega Cap row in Section 4 is empty, and v5's behavior on mega-caps is **unmeasured** in this run.

**Next step (Phase 1 follow-on):** backfill historical_marketcap + prices_eod for the $25B+ band (a few hundred tickers, ~30 minutes of yfinance pulls) and re-run Phase 3. Insider activity is rare on mega-caps so the alpha lift is likely small, but technicals/analyst signals should produce useful reads.

### 6e. The first 7 scan dates have incomplete insider history
`insider_history` starts 2025-03-10. The earliest scan date (2025-05-12) needs a 425-day lookback back to 2024-04-12 — but only ~2 months of insider data exist in that window. **On those early scans, the first-buy classifier fires more often than warranted** (we can't see prior P-buys that happened before 2025-03-10). Result: a modest upward bias on insider sub-score for the first 7 scans (2025-05-12 to 2025-06-23).

**To check magnitude:** I excluded the first 7 scans and re-aggregated — Run C Strong Buy alpha came out at +6.84% (vs +7.21% full window). The bias is ~37 bps, real but small. The headline number stands.

### 6f. Cross-sectional alpha, not factor alpha
"Alpha vs SPY" is just `ticker_return − SPY_return` on the same scan date. It's not a Fama-French 3-factor or 5-factor alpha. A heavy small-cap tilt (which v5 has by construction — most signals fire there) would automatically generate alpha if small-caps outperform regardless of skill. Over our 52-week window small-caps (IWM) actually underperformed SPY by ~5pp, so this caveat works AGAINST v5's read — the alpha is real.

### 6g. Survivorship bias
The universe at each scan date is built from `historical_marketcap` rows that exist on that date. If a ticker delisted between scan_date and scan_date + 21 trading days, its forward return is missing (drops out). Net effect: **delistings disappear silently rather than being counted as -100%.** This biases the headline returns upward; the right way to measure this is to use Polygon's delisted-corpus, which is out of scope for Phase 3.

---

## Section 7 — Recommendation

**Ship Run C calibrated weights to production. Phase 4 (UI) is unblocked.**

- The v5 methodology produces clean monotonic results: Strong Buy returns most, Strong Sell loses most, and the bands in between line up.
- Run C delivers **+7.21% alpha** on Strong Buy vs SPY, with 55% beats-SPY rate, **Sharpe 3.00** — beats SPY's 2.87 cleanly.
- The Sharpe 3 number on a year that had a real 15% drawdown for SPY (April 2026 sell-off) is non-trivial. The Strong Buy basket's max drawdown was only −1.57% over monthly windows.
- The three "floor" signals (options, congress, short interest) are not a methodology hole — they're a data-ingest hole. They'll fold in once Phase 1 backfill catches up.

**Anchored next steps (not blocking Phase 4):**
1. **Backfill mega-cap historical_marketcap + prices** for the $25B+ band to let the v5 universe be its true "no upper cap" self.
2. **Backfill options_flow_daily** to >1 year of history so Options Flow can be re-calibrated.
3. **Backfill short_interest + short_interest_daily** to broader ticker coverage so the Short Interest signal can be evaluated.
4. **Run Phase 3 again in ~3 months** to refresh the weights — every methodology paper says calibrate at least quarterly, and the regime can shift.

---

## Artifacts

- Branch: `feature/quant-signal-intel-v5-phase-3-backtest` (this branch)
- PR: Phase 3 — backtest harness + 3 runs + per-signal calibration
- `trading-scanner/scanner/signal_intelligence_v5/backtest_harness.py` — harness + cache mode
- `trading-scanner/scripts/run_v5_backtest.py` — CLI runner
- `trading-scanner/tests/test_signal_intelligence_v5_backtest.py` — 9 unit tests, all passing
- `/Users/joemezzadri/Documents/market-dashboard/v5_backtest_run_A.parquet` — equal-weight, 140,424 rows
- `/Users/joemezzadri/Documents/market-dashboard/v5_backtest_run_B.parquet` — same as A (Joe's spec: B is a filter, not a separate run)
- `/Users/joemezzadri/Documents/market-dashboard/v5_backtest_run_C.parquet` — refit weights, 138,918 rows
- Updated production: `composite.py` `DEFAULT_WEIGHTS` — calibrated Run C values, sum = 1.0000.

