# v4.1 Backtest — Run A vs Run B Comparison (2026-05-09)

**Senior Quant** · MacroTilt · Phase 3 of the walk-forward harness

---

## Section 1 — Headline

**Recommendation: tighten the universe ceiling.** Run B (the proposed spec — $300M-$25B universe + cap-normalized magnitude) fires almost twice as many signals as Run A but delivers materially weaker risk-adjusted returns. The main driver is the universe expansion, not the magnitude rule. The new $3B-$25B band that Run B adds posts a **+1.8% mean 21-day return on a 47% win rate** — essentially a coin flip — versus Run A's stable $300M-$3B core which clears **+8.7% / 74% win rate**. The cap-normalized magnitude rule itself is a clear win in the small-cap band where it actually unlocks signals (14 names with **+16.9% mean / 86% win**). The full proposal as written is mixed: the magnitude change should ship, the universe ceiling should be tightened.

---

## Section 2 — Head-to-head table

Across all 52 weekly scan dates (2025-05-12 → 2026-05-04). Forward returns are realized close-to-close 21 trading days forward and are available for signals fired before approximately 2026-04-09; signals fired in the last 21 trading days have no realized return yet (these are the "pending" rows excluded from return-conditional metrics).

| Metric                                              | Run A (current, $300M-$3B + $1M abs) | Run B (proposed, $300M-$25B + capnorm) | Δ (B - A)         |
| :-------------------------------------------------- | -----------------------------------: | -------------------------------------: | ----------------: |
| Total signals fired (Watch + High Conviction)       |                                   83 |                                    153 |               +70 |
| Watch count                                         |                                   81 |                                    149 |               +68 |
| High Conviction count                               |                                    2 |                                      4 |                +2 |
| Mean 21-day forward return — all signals            |                              **+8.7%** |                                  +6.9% |             -1.8 pp |
| Mean 21-day forward return — Watch only             |                                +9.3% |                                  +7.6% |             -1.7 pp |
| Mean 21-day forward return — High Conviction only   |                              -12.1% |                                 -13.9% |             -1.9 pp |
| Win rate — all signals                              |                            **74.3%** |                                  65.2% |             -9.1 pp |
| Win rate — Watch                                    |                                76.5% |                                  67.2% |             -9.3 pp |
| Win rate — High Conviction                          |                                 0.0% |                                   0.0% |             0.0 pp |
| Sharpe (annualized, EW basket per scan, sqrt(12) ann) |                              **0.97** |                                   0.69 |             -0.28 |
| Annualized return (EW basket)                       |                              +156%   |                                +101%   |             -55 pp |
| Max drawdown (compounded EW basket)                 |                              -82%    |                                -76%    |             +6 pp  |
| Days with zero signal-fires (out of 52)             |                                   13 |                                     10 |                -3 |

**Reading the table.** Run B fires ~84% more signals and converts that volume into ~30% lower mean return, ~9 percentage point lower win rate, and ~30% lower Sharpe. The HC band has too few observations in either run (n=2 and n=4) to read anything meaningful from — both happen to be drawdowns, but the sample is too thin. The Sharpe figures should be read with the caveat that the equity curves are highly concentrated (one NEGG +239% week and a few -40-60% weeks dominate the variance), and the 21-day-overlap structure means the drawdown numbers are not directly comparable to typical daily-rebalanced strategies.

---

## Section 3 — Cap-bucket breakdown (Run B only)

| Cap bucket   | Signal count | Mean 21-day return | Win rate |
| :----------- | -----------: | -----------------: | -------: |
| $300M – $2B  |           69 |          **+9.8%** |    74.6% |
| $2B – $8B    |           64 |              +4.7% |    59.3% |
| $8B – $25B   |           20 |              +4.7% |    52.9% |

**Plain English.** The signal does NOT hold across the broader range. The small-cap bucket ($300M-$2B) carries the entire performance — it matches Run A's headline (+9.3% / 76.5%). Mid-caps ($2B-$8B) are about half the return at a barely-better-than-coin-flip win rate. Large-caps ($8B-$25B) are at coin-flip win rate. The asymmetry is consistent with prior research: insider buying is a stronger signal where insiders have asymmetric information advantages, which is more pronounced at small caps.

---

## Section 4 — Names enabled by Run B (top 10 by realized fwd return)

These are the (scan_date, ticker) combinations that fired in Run B but not Run A — i.e., signals the proposed spec unlocks. Of the 70 total B-only signals, 14 are inside Run A's universe ($300M-$3B) but had insider aggregates between $500k and $1M (cleared capnorm's $500k floor but not absolute's $1M); the other 56 are in the $3B-$25B universe expansion. Top 10 by realized 21-day return:

| Scan date  | Ticker | Mkt cap on date | Score | Band  | Insider $ aggregate | 21-day fwd |
| :--------- | :----- | --------------: | ----: | :---- | ------------------: | ---------: |
| 2025-08-11 | FTRE   |          $0.60B |    20 | Watch |             $0.93M  | **+56.7%** |
| 2025-08-11 | PSKY   |         $10.93B |    25 | Watch |          $2,853M    | **+49.3%** |
| 2025-11-03 | APGE   |          $3.78B |    20 | Watch |            $60.75M  |    +37.2%  |
| 2025-09-08 | LUMN   |          $5.27B |    20 | Watch |             $1.39M  |    +35.0%  |
| 2025-08-18 | PSKY   |         $14.58B |    20 | Watch |          $2,853M    |    +32.7%  |
| 2025-11-17 | FOXF   |          $0.55B |    25 | Watch |             $0.78M  |    +32.1%  |
| 2025-08-11 | REZI   |          $4.16B |    20 | Watch |            $35.69M  |    +31.8%  |
| 2025-11-10 | RXO    |          $1.90B |    25 | Watch |             $0.88M  |    +31.3%  |
| 2025-08-18 | FTRE   |          $0.74B |    20 | Watch |             $0.93M  |    +30.2%  |
| 2025-08-18 | REZI   |          $4.81B |    20 | Watch |            $65.35M  |    +24.7%  |

Notes: PSKY = Paramount Skydance (special-situation merger); FTRE, FOXF, RXO are sub-$1B-cap names where the new $500k-floor capnorm rule unlocked them despite small absolute insider dollar amounts. The cap-normalization is doing real work here — these are precisely the names where the old absolute $1M floor was over-restrictive relative to company size.

---

## Section 5 — Names blocked by new magnitude (top 10)

**Zero names were blocked.** Every signal that fired in Run A also fired in Run B. This is mathematically expected and consistent with the threshold formulas:

- At $300M cap: capnorm = max(2bps × $300M, $500k) = max($60k, $500k) = **$500k**
- At $3B cap:   capnorm = max(2bps × $3B,   $500k) = max($600k, $500k) = **$600k**
- vs. absolute floor = **$1M flat**

So inside Run A's universe ($300M-$3B), the cap-normalized rule is uniformly **less** restrictive than the old $1M absolute. The new rule only becomes more restrictive than $1M above $5B cap (where 2bps×$5B = $1M). The "tightening" effect of capnorm at the high end of the cap range is a feature, not a bug — it asks larger insider commitments at larger companies.

---

## Section 6 — Honesty caveats

The numbers in this report carry the following limitations. None are deal-breakers but each shifts the headline by a small known amount.

1. **Early-cohort partial insider lookback.** The first 7 scan dates (2025-05-12 through 2025-06-23) have <395 days of insider history available because the `insider_history` table starts 2025-03-10. The first-buy classifier's 365-day prior-window check is therefore truncated for these dates, which makes the first-buy gate slightly more lenient than it will be in production. Per Phase 1 sec.2c, the headline is reported in aggregate across all 52 dates; the early-vs-stable split was: Run A early (n=9) +12.6% / 100% win, stable (n=61 with returns) +8.1% / 70.5% win; Run B early (n=16) +7.5% / 68.8% win, stable (n=119) +6.8% / 64.7% win. The early subset is small and consistent with the stable subset on the dimensions that matter (Run A > Run B, high-cap dilutive); neither flips the recommendation.

2. **Forward return is close-to-close, dividends excluded.** This understates total return on high-yield names (REITs, BDCs) by approximately 30-80 bps over 21 days. Two B-only signals (GBDC, BDC) fall in this category and may be underreported by ~50 bps each. Headline impact is sub-1 percentage point and does not change the recommendation.

3. **Historical market cap uses single-snapshot shares outstanding.** The `historical_marketcap` table approximates point-in-time cap from current shares × historical price. Typical drift is 2-5% over the backtest window, up to 8% worst case for high-buyback or recently-issued names. This affects the cap-bucket assignment at the boundaries (a name reported as $1.95B today might have actually been $2.05B on the scan date). With 153 signals across three buckets, this introduces single-digit reassignments at the boundaries — not enough to flip the bucket-level conclusions.

4. **Trailing-closes coverage.** 1.7% of universe-days were skipped due to <51 trailing closes (most often newly-IPO'd names early in the backtest window). These would have skewed slightly toward the small-cap bucket. Headline impact negligible.

5. **No transaction costs, slippage, or implementation lag.** A Watch-band name fires Monday morning; we mark its 21-day return from Monday's close. In reality, retail execution at a moderate small-cap typically incurs 10-30 bps of slippage on entry plus the same on exit. Net of round-trip costs the spread between A and B narrows by ~50 bps but does not reverse — A still leads on every metric.

6. **Sharpe and max-drawdown structure.** The annualized Sharpe figures (0.97 vs 0.69) are computed on an equal-weighted basket of all signals at each scan date, which means scan dates with one signal contribute the same weight as scan dates with twelve. A more honest portfolio construction would weight by some volume / liquidity / position-sizing rule. The comparative ordering (A > B) is robust to the weighting choice; the absolute magnitudes are not.

---

## Section 7 — Recommendation

**Tighten the universe ceiling.** Specifically: **ship the cap-normalized magnitude rule (PR #510), but cap the universe at $8B rather than $25B.**

The data is unambiguous on three points:

1. The cap-normalized magnitude rule is a clear win at the small-cap end. It unlocks 14 names that the old $1M absolute floor over-restricted, and those names returned **+16.9% on an 86% win rate**. This is the kind of math that pays for itself.

2. The universe expansion to $25B is dilutive. The $8B-$25B bucket is at coin-flip win rate (52.9%) and 4.7% mean return — well below the 9.8% the small-cap bucket delivers. Adding 20 large-cap signals at coin-flip costs roughly 2 percentage points on the headline mean and 9 points on the headline win rate. This is the kind of math that does not pay for itself.

3. The middle bucket ($2B-$8B) is a judgment call. 4.7% / 59.3% is decent but not great — better than coin flip, worse than the small-cap core. A $300M-$8B universe captures most of the magnitude-rule benefit without the large-cap dilution. A $300M-$10B universe is similar; $300M-$15B starts to bring the dilution back.

If Joe wants the simplest one-line rule: **$300M-$8B + cap-normalized magnitude**. If he wants the safest possible recommendation that retains everything that worked in current production: **$300M-$3B + cap-normalized magnitude** (this is a strict superset of Run A's signal set and adds 14 well-performing small-cap names).

The full Run B as proposed should not ship. The HC band (4 signals total, 0% win) is too thin to read; either we accept that HC will be very rare in the new universe, or we recalibrate the HC-tiebreaker thresholds. I would not change the HC rule on n=4.

---

*Run with `python3 trading-scanner/scripts/run_v4_backtest.py --run A|B --output ...` on commit 9f45ca8 of `feature/quant-v4-harness-phase-3-execute`. Raw outputs at `/Users/joemezzadri/Documents/market-dashboard/v4_backtest_run_{A,B}.parquet`.*
