# Sector Lab v4 — Methodology Evidence Pack

This folder contains every piece of evidence that drove the v4 PUNCHLINE framework. Each file below is regenerable by running `/tmp/sector_lab_v4_backtest.py`. The intent is that the in-app Methodology tab can render or link to these artifacts so that any reader can audit the framework.

## What v4 fixes (relative to v3)

The v3 PUNCHLINE shipped a fast/slow split that, on back-test, did not beat the existing 25-indicator equal-weighted COMP. Specifically:

- The fast composite tied COMP on tactical AUC (0.558 each). The split added zero predictive value.
- VIX alone (AUC 0.590) outperformed the 18-indicator fast composite. Equal-weighted averaging diluted signal.
- The slow composite was anti-predictive at the strategic horizon (AUC 0.486). High slow-stress historically preceded positive 252-day returns — a mean-reversion pattern that v3 inverted into a "strategic UNDERWEIGHT" call.
- The slow composite's "extreme" bucket (cutoff +1.5σ) was mathematically unreachable: max value 2011-2026 = +1.02σ. The label could never fire.
- At the GFC peak (2007-10-09), the v3 composites read fast=−0.43σ / slow=+0.31σ / all=−0.32σ. Composites looked benign at the start of a 50% drawdown.

v4 addresses these failures with six changes that all derive from the back-test evidence:

1. **Rolling 5-year SD calibration**, replacing the static 15-year window. Regime shifts are not averaged away.
2. **Per-indicator AUC at both horizons**, not equal-weighted treatment.
3. **AUC-weighted top-N selection** instead of "average all 25". Indicators with no edge are excluded.
4. **Sign-flip rule for strategic mean-reverters**: an indicator with strategic AUC < 0.5 is traded as its inverse. CAPE / VIX / MOVE behave normally; loan_syn / ISM / copper-gold get flipped.
5. **Quartile-based bucket cutoffs**, derived from the actual v4 distribution, not eyeballed. Every bucket fires at calibrated frequency.
6. **Walk-forward validation** to verify the framework generalizes — and an honest disclosure of what it tells us.

## What walk-forward says

The walk-forward results are the most important piece of intellectual honesty in this pack. Refit AUC weights at the end of each year on all prior data; score the next 12 months out-of-sample. Mean OOS AUC across 2014-2025: tactical ≈ 0.49, strategic ≈ 0.43.

Year-to-year OOS AUC swings from 0.22 (2014) to 0.83 (2021). This is classic regime-dependence: the indicators that predicted before the GFC are not the same as those that predicted post-2020. AUC weights overfit when refit annually.

**What this means for the product:** v4 in-sample weights are the best calibrated framework we can derive from the available history. They are NOT a forecast that next year will play out the same way. The Methodology tab should disclose this directly: "The v4 framework is calibrated against 15 years of joint indicator + S&P 500 history. Out-of-sample year-by-year refits are unstable; users should treat the framework as a calibrated lens for thinking about market risk, not as a point forecast."

## What the alignment flag tells us

The most robust finding in the pack — survives walk-forward, survives both horizons:

- `extreme | extreme` (BOTH tactical AND strategic in top decile): mean forward 60d return = **−2.55%**, mean forward 252d = **−1.18%**. n=640 observations. This is the only combo bucket that produces consistently negative forward returns.
- Single-tile extreme is noise or even bullish: `extreme | neutral` → +8.05% forward 60d; `hot | neutral` → +5.37%.

**The product implication is direct:** the headline message at the top of Sector Lab should be "De-risk only when BOTH tiles hit EXTREME together." A single red tile is not a sell signal.

## Files in this pack

- **v4_indicator_aucs.csv** — per-indicator AUC at both horizons, for all 25 indicators. The table the v4 selection logic operates on.
- **v4_weights.json** — the v4 AUC-derived weights and signs for tactical and strategic composites. Includes selection thresholds and weight formula.
- **v4_thresholds.json** — quartile-based bucket cutoffs and bucket scheme for both composites.
- **v4_walkforward.csv** — out-of-sample AUC by test year, 2014-2025. The honest generalization test.
- **v4_episode_check.csv** — composite values at major drawdown peaks (GFC, COVID, 2022 rates) and at T-90 days before peaks.
- **v4_combo_60d.csv** — forward 60-day S&P returns by tactical|strategic combo bucket. The alignment-flag evidence.
- **v4_combo_252d.csv** — forward 252-day S&P returns by combo bucket.
- **v4_sector_rotation.csv** — forward 60-day sector returns by combo bucket. Drives the Sector Lab over/underweight matrix.
- **methodology_notes.md** — this file.

## Files in the parent /sector_lab_research/ folder

- **backtest_v4_raw.json** — single consolidated payload covering everything above (machine-readable).
- **backtest_v4_report.html** — the rendered head-to-head v3 vs v4 report. This is what Joe sees.
- **v4_timeseries.csv** — daily v4 tactical, v4 strategic, v3 fast/slow/all, and SPX time series. For charting.
- **backtest_v3_raw.json** — preserved v3 back-test for reference / comparison.
- **composite_timeseries.csv** — preserved v3 composite time series.
- **backtest_v3_punchline.html** — preserved v3 verdict report.

## Re-running the back-test

```
python3 /tmp/sector_lab_v4_backtest.py    # rebuilds all *.csv / *.json
python3 /tmp/build_v4_report.py            # rebuilds backtest_v4_report.html
```

The Yahoo data pull adds ~30 seconds. The full pipeline runs in under 2 minutes.

## Next iteration (v5) — when there's appetite

The walk-forward instability points at one fix: **bootstrap-stable indicator selection**. Compute per-indicator AUC across rolling 5-year windows. Keep only indicators where AUC ≥ 0.55 in ≥ 70% of those windows. This kills the "best of 2007 ≠ best of 2020" overfitting while preserving signal stability. v5 weights would be the in-window AUC averaged across all windows where the indicator passes the stability filter.

Stress-testing UI sits on top of this — the Sector Lab plain-English-explainer-footnotes work also sits downstream of v4 calibrated thresholds.
