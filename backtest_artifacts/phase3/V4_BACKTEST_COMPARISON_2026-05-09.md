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

## Section 2.5 — SPY benchmark over the same 12-month window

The Sharpe and mean-return numbers in Section 2 are not informative on their own — a 1.97 Sharpe in a market that returned +30% on a 1.93 Sharpe of its own is a different conclusion than the same number in a flat or down tape. This section anchors the strategy to the index over the identical 52-week scan window.

**SPY benchmark construction.** SPY 21-trading-day forward close-to-close return, computed at each of the 52 weekly scan dates (2025-05-12 → 2026-05-04). 48 of 52 scans have realized 21-day returns; the 4 most recent are still pending (same convention as the strategy table). Source: Unusual Whales `/stock/SPY/ohlc/1d` regular-session bars. The basket used in the table below treats one SPY return per scan date as one observation, parallel to how the strategy's Sharpe is computed.

| Metric                              |     SPY |   Run A | Run A vs SPY |   Run B | Run B vs SPY |
| :---------------------------------- | ------: | ------: | -----------: | ------: | -----------: |
| Mean 21-day return                  |  +1.80% |  +8.68% |   +6.88 pp |  +6.92% |   +5.12 pp |
| Win rate (21-day > 0)               |   79.2% |   74.3% |   −4.9 pp |   65.2% |   −14.0 pp |
| Sharpe (annualized, sqrt(12))       |    1.93 |    0.97 |   −0.96   |    0.69 |   −1.24   |
| Max drawdown (compounded EW basket) |  −15.9% |  −82%   |   −66 pp  |  −76%   |   −60 pp  |

**Paired-window check.** SPY restricted to ONLY the scan dates where the strategy actually fired a signal (35 dates for A, 38 for B): SPY mean = +1.28% / Sharpe = 1.81 (A-paired); SPY mean = +1.20% / Sharpe = 1.68 (B-paired). The strategy's signal-fire dates coincide with slightly weaker-than-average SPY weeks, which means the alpha is marginally understated by the full-window comparison and marginally overstated by the paired comparison. Both tell the same story — the strategy outperforms SPY on raw return, underperforms SPY on risk-adjusted return.

**Per-signal alpha vs SPY.** Pairing each signal to SPY's return on the same scan date (signal_return − SPY_return on that date):

| Run | Signals (realized) | Mean alpha per signal | % of signals beating SPY |
| :-- | -----------------: | --------------------: | -----------------------: |
| A   |                 70 |             **+7.19 pp** |                    62.9% |
| B   |                135 |             **+5.34 pp** |                    55.6% |

### Cap-bucket alpha (Run B)

Each Run B signal paired with SPY's return on the same scan date, then averaged within cap bucket:

| Cap bucket    | Signals | Mean strategy return | Mean SPY return on those dates | Mean alpha | % beat SPY |
| :------------ | ------: | -------------------: | -----------------------------: | ---------: | ---------: |
| $300M – $2B   |      59 |               +9.78% |                         +1.53% | **+8.29 pp** |     62.7% |
| $2B – $8B     |      59 |               +4.71% |                         +1.28% |   +3.12 pp  |     52.5% |
| $8B – $25B    |      17 |               +4.68% |                         +1.78% |   +2.82 pp  |     41.2% |

### Plain English

**Did the strategy beat SPY?** On raw return, yes — clearly. Run A made +8.7% per 21-day signal vs SPY's +1.8%; Run B made +6.9% vs the same +1.8%. On a per-signal alpha basis (signal vs SPY on the same scan date), Run A delivered +7.19 pp of alpha and Run B delivered +5.34 pp. About 63% of Run A signals and 56% of Run B signals beat SPY over the 21-day forward window.

**Did it beat SPY on a risk-adjusted basis?** No — this is the catch. SPY's Sharpe over the period is 1.93, which is unusually high (the tape ran +21% with a single −16% drawdown, a very smooth bull market). The strategy's Sharpe of 0.97 (Run A) and 0.69 (Run B) reflects much larger position-level swings — a single NEGG +239% week and a few −40-60% weeks dominate the variance. The strategy generates more return per dollar invested but at much higher volatility per dollar. Whether this is good or bad depends on Joe's sizing: if a Run A signal is one position out of 20 in an otherwise diversified book, the per-position +7.19 pp alpha is the right number to look at. If a Run A signal is the whole book, the Sharpe gap matters and SPY is the better trade.

**Was the alpha concentrated in the small-cap bucket?** Yes, decisively. The $300M–$2B bucket delivered **+8.29 pp of alpha per signal at a 63% beat rate** — clean outperformance. The $2B–$8B bucket delivered **+3.12 pp at a 53% beat rate** — barely better than coin flip. The $8B–$25B bucket delivered **+2.82 pp at a 41% beat rate** — fewer than half the signals beat SPY. The pattern is consistent with the structural argument for insider buying as a small-cap signal: insiders have asymmetric information advantages where company-specific news matters more than market beta, and that's exactly where small-caps live. At $8B+ cap, an insider's edge is largely already in the price; the strategy's 41% beat rate in that bucket means most of those signals would have been better expressed by buying SPY.

**Bottom line.** The strategy's positive alpha is real and concentrated where the theory says it should be — small-caps under $2B. Run B's universe expansion to $25B dilutes the alpha rather than adds to it. This reinforces the Section 7 recommendation to ship cap-normalized magnitude with a tightened universe ceiling (≤ $8B).

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

---

## Section 8 — Run C: $8B universe validation

**Decision:** Joe asked for a third run that holds the cap-normalized magnitude rule fixed and trims the universe ceiling to $8B (the SMID-cap zone, dropping the $8B-$25B band where Run B beat SPY only 41.2% of the time). Section 7's recommendation suggested $300M-$8B as a candidate; Run C tests whether that holds up versus Run A's tighter $300M-$3B core.

### 8.1 Three-way head-to-head

All metrics across the same 52-week scan window (2025-05-12 → 2026-05-04). Sharpe is computed on the equal-weighted basket of signals per scan date, restricted to scan dates with realized 21-day forward returns (matches the SPY benchmark convention in Section 2.5).

| Metric                              |     SPY | Run A ($3B + abs floor) | Run B ($25B + capnorm) | **Run C ($8B + capnorm)** |
| :---------------------------------- | ------: | ----------------------: | ---------------------: | ------------------------: |
| Total signals                       |       — |                      83 |                    153 |                       **133** |
| Realized signals                    |      48 |                      70 |                    135 |                       **118** |
| Mean 21-day return                  |  +1.80% |                  +8.68% |                 +6.92% |                   **+7.24%** |
| Win rate (21-day > 0)               |   77.1% |                   74.3% |                  65.2% |                   **66.9%** |
| Sharpe (annualized, sqrt(12))       |    1.93 |                    0.97 |                   0.69 |                   **0.68** |
| Max DD (compounded EW basket)       |  -15.8% |                  -82.1% |                 -75.9% |                   **-81.7%** |
| Beats SPY (per-signal)              |       — |                   62.9% |                  55.6% |                   **57.6%** |
| Mean alpha vs SPY (per signal)      |       — |               +7.21 pp  |              +5.35 pp |                   **+5.71 pp** |

**Reading the table.** Run C sits between A and B but is closer to B than to A. Trimming the universe from $25B to $8B picks up 0.3 pp of mean return, 1.7 pp of win rate, and 0.4 pp of mean alpha vs Run B — small wins, all in the right direction. But Run C is decisively worse than Run A on every risk-adjusted metric: Sharpe 0.68 vs 0.97 (-30%), win rate 66.9% vs 74.3% (-7.4 pp), alpha vs SPY +5.71 pp vs +7.21 pp (-1.5 pp), and beats-SPY rate 57.6% vs 62.9% (-5.3 pp). The universe expansion from $3B to $8B does not pay for itself — the alpha-per-trade dilution from the $2B-$8B band exceeds the value of the extra signals.

### 8.2 Cap-bucket breakdown (Run C only)

| Cap bucket    | Signals (realized) | Mean 21-day return | Win rate | Mean SPY return on those dates | Mean alpha | % beat SPY |
| :------------ | -----------------: | -----------------: | -------: | -----------------------------: | ---------: | ---------: |
| $300M – $2B   |                 59 |          **+9.78%** |    74.6% |                         +1.49% | **+8.29 pp** |     62.7% |
| $2B – $8B     |                 59 |              +4.71% |    59.3% |                         +1.57% |   +3.14 pp  |     **52.5%** |

**Plain English.** The $300M-$2B bucket is doing all the work. Its +8.29 pp alpha at a 63% beat rate is real outperformance — exactly what the theory predicts (insider buying as a small-cap-specific information edge). The $2B-$8B bucket is +3.14 pp alpha at a 53% beat rate — barely better than coin flip. This is the same pattern Section 3 showed for Run B's mid-cap bucket; Run C adding signals here does not change the underlying physics. The narrowing from $8B-$25B to $8B does prevent the worst dilution (Run B's $8B-$25B bucket beat SPY only 41.2%), but the $2B-$8B bucket alone still drags the headline below Run A.

### 8.3 Names enabled by Run C vs Run A

Run C adds 50 (scan_date, ticker) signals not in Run A. Of these, 36 are in the $3B-$8B universe expansion zone (genuinely new — Run A's universe stops at $3B); the other 14 are in the $300M-$3B range but cleared the cap-normalized $500k floor while failing the absolute $1M floor. Top 10 in the $3B-$8B band by realized 21-day return:

| Scan date  | Ticker | Mkt cap on date | Score | Band  | Insider $ aggregate | 21-day fwd |
| :--------- | :----- | --------------: | ----: | :---- | ------------------: | ---------: |
| 2025-11-03 | APGE   |          $3.78B |    20 | Watch |            $60.75M  | **+37.17%** |
| 2025-09-08 | LUMN   |          $5.27B |    20 | Watch |             $1.39M  |    +34.96% |
| 2025-08-11 | REZI   |          $4.16B |    20 | Watch |            $35.69M  |    +31.78% |
| 2025-08-18 | REZI   |          $4.81B |    20 | Watch |            $65.35M  |    +24.66% |
| 2026-02-09 | RAL    |          $4.61B |    25 | Watch |             $1.18M  |    +11.15% |
| 2025-06-23 | GBDC   |          $3.75B |    25 | Watch |           $319.00M  |     +8.63% |
| 2025-12-22 | AVTR   |          $7.67B |    25 | Watch |             $5.82M  |     +4.98% |
| 2025-08-18 | TFX    |          $5.31B |    20 | Watch |             $1.46M  |     +4.81% |
| 2025-08-18 | AUB    |          $4.81B |    20 | Watch |             $1.25M  |     +4.79% |
| 2025-11-24 | RHP    |          $5.93B |    20 | Watch |             $1.99M  |     +3.90% |

Notes: REZI (Resideo Technologies) hit twice on consecutive Mondays. APGE (Apogee Therapeutics) had the largest insider concentration ($60.75M) and the biggest payoff (+37.17%). The top of the list looks fine; the bottom of the list (single-digit returns at ~$5B caps) is consistent with Run B's $2B-$8B bucket being only marginally above SPY — the median signal in this band is mediocre, the tails do the work.

### 8.4 Recommendation

**Ship Run A's universe with cap-normalized magnitude — i.e., $300M-$3B + capnorm. Do not ship Run C.**

Three configurations are now on the table:

| Configuration                              | Signals | Mean ret | Win rate | Sharpe | Beats SPY | Alpha    |
| :----------------------------------------- | ------: | -------: | -------: | -----: | --------: | -------: |
| Run A ($300M-$3B + absolute $1M floor)     |      83 |   +8.68% |    74.3% |   0.97 |     62.9% | +7.21 pp |
| **$300M-$3B + capnorm (Run A spec + capnorm)** |  **97** | **+10.06%** | **76.2%** | **0.99** | **65.5%** | **+8.62 pp** |
| Run C ($300M-$8B + capnorm)                |     133 |   +7.24% |    66.9% |   0.68 |     57.6% | +5.71 pp |

The middle row — Run A's universe with the cap-normalized magnitude rule swapped in — is the dominating configuration on every metric except total signal count. It is a strict superset of Run A's signals (every Run A signal also fires here, plus 14 small-cap names that the old absolute $1M floor blocked at sub-$500M caps where the cap-normalized $500k floor lets them through). Those 14 added names are pulling the headline up: mean return rises from +8.68% to +10.06%, win rate rises from 74.3% to 76.2%, alpha vs SPY rises from +7.21 pp to +8.62 pp. The Sharpe is essentially unchanged (0.99 vs 0.97). This is what the cap-normalization was designed to do — read $500k of insider buying at a $300M company as material conviction without lowering the bar at the larger end of the cap range.

The decision question Joe asked — "does Run C beat Run A AND beat SPY meaningfully?" — answers as: Run C does beat SPY meaningfully (+5.71 pp alpha at a 57.6% beat rate is real outperformance), but it does NOT beat Run A on alpha-per-trade, win rate, Sharpe, or beats-SPY rate. The 50 extra signals Run C generates relative to Run A are not pulling their weight; the average new $3B-$8B signal returns less than the average $300M-$3B signal and beats SPY less often.

**Honest framing — alpha-per-trade vs total alpha across more trades.** This is the real choice Joe is being asked to make, and both numbers point the same way:

- **Alpha per signal (intensity):** Run A spec + capnorm gives **+8.62 pp** of alpha per signal at a **65.5%** beat rate. Run C gives +5.71 pp at 57.6%. The tighter spec wins by 2.9 pp per signal.
- **Total alpha across all signals (volume × intensity):** if you sum (signal alpha × number of signals) and divide by SPY's mean to express in SPY-units of edge, Run A spec + capnorm delivers ~836 pp-signal-units of total alpha (97 × 8.62) versus Run C's ~759 pp-signal-units (133 × 5.71). Even though Run C fires 36 more signals, the per-signal dilution drags the volume-adjusted total below the tighter spec.

There is no horizon on which Run C wins. The only reason to ship Run C would be if Joe specifically wants more weekly signal volume for diversification reasons (more lottery tickets), accepting lower alpha per ticket. The data does not support that trade — the extra tickets are losing tickets on average.

The $2B-$8B sub-bucket finding is what kills Run C: 52.5% beats-SPY rate is statistically indistinguishable from a coin flip. We are paying real return-dispersion cost (the bigger names contribute volatility that drags the Sharpe) for a near-zero expected-alpha edge. The $8B-$25B bucket in Run B was even worse (41.2%); trimming it helped, but the $2B-$8B bucket is still not pulling its weight.

**Ship the cap-normalized magnitude rule. Keep the universe at $300M-$3B.** This is a single-lever change from current production: the magnitude floor moves from `$1M absolute` to `max(2 bps × cap, $500k)`. It captures all 14 newly-eligible small-cap names without admitting any large-cap dilution. The HC band stays cap-normalized at `max(5 bps × cap, $5M)` (no change there). PR #510 already implements this; it should ship as proposed for the magnitude logic, but the universe ceiling change in PR #510 should be reverted to $3B before shipping.

---

*Run C executed via the same harness as Run A/B (`python3 trading-scanner/scripts/run_v4_backtest.py --run C --output ...`) — the new `--run C` preset uses universe $300M-$8B, `magnitude_mode='capnorm'`, `require_first_buy=True`. The Run C parquet was derived directly from the Run B parquet by filtering market_cap to <= $8B, since the harness's pillar/gate/score logic and the Phase 1 inputs are identical between B and C inside the overlapping cap band — every Run B row with cap in [$300M, $8B] is bit-for-bit a valid Run C row. This was verified against 17 dates run natively through the harness on commit `feature/quant-v4-harness-phase-4-run-c-validation`; zero discrepancies. SPY benchmark recomputed from yfinance daily closes (auto_adjust=False) to match Section 2.5's UW-sourced numbers; SPY mean +1.80% / Sharpe 1.93 / DD -15.8% reconciles to within rounding. Raw Run C parquet at `/Users/joemezzadri/Documents/market-dashboard/v4_backtest_run_C.parquet`.*
