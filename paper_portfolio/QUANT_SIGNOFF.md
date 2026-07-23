# Senior Quant Sign-off — Paper Translator v1

**Date:** 2026-05-26
**Reviewer:** Senior Quant (council)
**Consulted:** Lead Developer (orchestration), Data Steward (signal sources + audit), UX Designer (N/A this phase — no rendered surface).
**Status:** ✅ **APPROVED for Phase 3 backtest entry.**

---

## 1. Scope under review

`paper_portfolio/sleeves.py` + `paper_portfolio/diff.py` — the math layer
of the paper translator. Specifically:

- Sleeve A target builder (IG ETFs × Asset Tilt weights × sleeve A capital).
- Sleeve B target builder (3-tier sizing with overflow leverage and idle-cash semantics).
- Sleeve A / Sleeve B target vs. live Alpaca diff.
- Normalization function from raw `mt_score` (-100..+100) to a 0–10 buy-score.

## 2. Math walk — plain English

### Sleeve A — Asset Tilt IG ETFs
For each of the 24 industry groups in the live Asset Tilt engine output:

```
target_notional_for_ETF = ig_weight_pct × equity_pct × sleeve_a_capital
```

Two IGs that map to the same primary ETF get aggregated (the v10 file
doesn't currently do this, but the code defends against it). If the
engine carves out defensive (equity_pct < 1.0), Sleeve A's gross long
shrinks by exactly that fraction; the difference rests as cash.

**So-what:** Sleeve A perfectly mirrors what an Asset Tilt user would
see as "the recommended IG allocation." If the engine moves an IG from
6 % → 8 %, the next translator run buys $10K more of that IG's ETF.

### Sleeve B — Equity Scanner long-only with tier-fill overflow leverage

Step 1 — read every signal whose normalized `buy_score ≥ 5.0`.

Step 2 — bucket into tiers:
- Tier 1: 9.0 ≤ buy_score ≤ 10.0 → base size $50,000
- Tier 2: 7.0 ≤ buy_score < 9.0 → base size $40,000
- Tier 3: 5.0 ≤ buy_score < 7.0 → base size $30,000

Step 3 — sum tier_demand_at_full_sizing.

Step 4 — **if total demand ≤ $500K (the sleeve cap):**
Fill every name at full base size. Park the residual as literal idle
cash — no BIL/SHV/parking ETF (locked).

Step 5 — **if total demand > $500K:**
Compute `budget = min(total_demand, $1M)` — the levered cap is exactly
2× the sleeve cap, never exceeded. Then fill tier-by-tier:
- Tier 1 first at full $50K; if tier 1 alone exceeds budget, pro-rate
  within tier 1 only.
- Then tier 2 at full $40K; pro-rate within tier 2 if remaining budget
  doesn't cover everyone.
- Then tier 3 shares the residual evenly, each name capped at $30K.

**So-what:** When the scanner is screaming (lots of high-conviction
buys), Sleeve B leans into leverage up to 2× and never blows past that.
When the scanner is quiet, the sleeve sits in cash — no forced
deployment to fill the bucket.

### Diff layer
For each target line: `diff = target_notional − live_market_value`.
- diff > 0 → buy intent for that diff.
- diff < 0 → sell intent for that diff (negative notional).
- |diff| below max($250, 0.5 % of sleeve cap) → suppress; no
  intent generated (avoid round-trip churn on small drift).

Orphans (live position not in either target): attribute to Sleeve A if
the ticker appears anywhere in the snapshot's wider IG → tickers
universe; else Sleeve B. Sell at full live qty.

### Normalization
`buy_score = max(0, mt_score / 10)`.
- Long-only: negative mt_scores collapse to 0 (no short side in v1).
- mt_score 50 → buy_score 5 (the spec threshold).
- mt_score 100 → buy_score 10 (top of tier 1).
- mt_score 70 → buy_score 7 (top of tier 2).

## 3. Backtest readiness

- ✅ Functions are pure (no I/O inside `sleeves.py` or the math half of
  `diff.py`) — deterministic and replayable from historical inputs.
- ✅ 14 unit tests passing including the five required cases (overflow
  with leverage; idle cash with too few signals; tier-fill priority;
  sleeve isolation; exit on score drop below 5.0) plus 5 edge cases
  (zero signals; 100-name overflow; equity_pct < 1.0; score == 5.0
  boundary; tier3-pro-rate when tier1+tier2 saturate budget).
- ✅ Floating-point belt-and-braces guard in `build_sleeve_b_target` —
  if accumulated rounding pushes gross above the leverage cap, tier 3
  is shrunk proportionally to fit exactly.

## 4. Open items (parked for Phase 3 / Phase 4)

1. **Margin cost in backtest.** Phase 3 must subtract a modeled cost of
   borrowed margin (Joe specified 5–10 % annualized) when reporting
   real-world-adjusted return. Alpaca paper doesn't charge it — real
   life will.
2. **Order-shape granularity.** Phase 4 needs to decide whether
   market-on-open is fillable for low-ADV tier-3 names. May need a
   liquidity guardrail.
3. **Sleeve-attribution ledger.** Today's diff infers sleeve from
   ticker shape + IG universe membership. Phase 4 should write
   `sleeve` explicitly into `paper_orders.sleeve` at submit time
   and read attribution from the order ledger.

## 5. Sign-off

**Senior Quant:** Math is correct, deterministic, and tested. Approved.

**Lead Developer (consulted):** Module boundaries clean; orchestration
straightforward; CLI entrypoint behaves as expected on dry-run against
live Asset Tilt data.

**Data Steward (consulted):** Signal sources mapped to canonical
artifacts (`public/v10_allocation.json` for Sleeve A;
`signal_intel_v5_daily` table for Sleeve B). Audit trail in
`paper_signal_capture` carries the full IG list + top-25 scanner sample
per run, sufficient for replay. `data_manifest.json` v10 entries cover
all six paper portfolio tables.

## 2026-07-21 — Whole-share sizing, live-NAV base + 1% buffer, 2% cash tripwire

**Change (execution mechanics only — no signal, entry/exit, or cadence change):**
1. Order quantities floor to whole shares (was raw notional/price to 4dp).
2. Sleeve sizing base = latest sleeve NAV × 0.99 (was fixed $500K allocation).
3. Close phase files a P1 bug if |sleeve cash| > 2% of sleeve NAV.

**Why:** Fixed-allocation sizing overspends whenever the sleeve is below its
allocation (observed: Insider −$9.0K cash on $496K NAV = unintended margin,
1.8%), and overnight gap-ups add slippage on top (fixed share count × higher
open price). Both violate the no-leverage design assumption of the backtests.

**Impact bound (Policy A assessment — bound argument in lieu of re-run):**
- Whole-share flooring forgoes at most 1 share per name per rebalance:
  ≤ price/notional ≈ 0.03%–0.6% of a position (typ. $35K–$170K lines),
  direction-unbiased, second-order vs daily price moves.
- The 1% buffer is an ~1% cash allocation: expected drag ≈ 1% × sleeve
  excess return — basis points per year — and removes an unmodeled ~1–2%
  LEVERAGED exposure the backtest never had. Net effect brings live behavior
  CLOSER to the backtested 100%-invested assumption, not further.
- Self-correction: sizing re-anchors to live NAV each rebalance (daily for
  Insider, monthly for Momentum), so cash drift is mean-reverting by
  construction; the 2% tripwire catches any failure of that property.

**Backtest status:** Signals, hysteresis, cadence, and universe untouched —
the cleared strategy backtests (2026-07-07 Insider, 2026-07-14 Momentum)
remain the governing evidence. Senior Quant signs off on the bound argument.

## 2026-07-23 — Power Trend fire-window fix + industry cap (Senior Quant sign-off)

**Change:** `power_trend_scan()` (migration 084) now qualifies a name when its
breakout (new 10-day closing high on volume > 1.3x its 20-day average) occurred
on ANY of the trailing 21 sessions, with the trend (above 10/21/50/200 EMAs),
momentum (top-20% 3-mo ROC) and relative-strength (>=5 pts vs SPY) gates
evaluated as of the panel date. Producer selection is now
`cap_top15_industry` — roc_3m desc, max 3 names per 2-digit-SIC industry
group, next-ranked backfill, top 15, min-8 floor unchanged.

**Why:** the 2026-07-23 review found the deployed one-day-snapshot rule had
monthly-return correlation -0.05 vs the 7/15 validation study over 75 months —
the live rule was effectively unvalidated and returned ~10%/yr (zero-cost)
vs SPY 13.6%/yr over 2020-2026.

**Evidence (Momentum_Sleeve_Review_2026-07-23.xlsx, zero trading costs per
Joe's directive):** monthly fixed rule + industry cap 27.0%/yr, Sharpe 1.08,
MaxDD -24.1% vs SPY 13.6%/yr / QQQ 19.8%/yr, 2020-01 -> 2026-07-22.
Uncapped 25.3%/yr. Also tested and REJECTED (all worse): daily tactical
cadence with EMA exits (best 15.4%/yr), RVOL thresholds 1.5x/2.0x
(monotonically worse), bottoming entries (5.3%/yr, 31% win rate).
Caveats preserved: survivor-leaning cohort; a single half-month can lose
~20% (Jul 1-14 2026 in-sample).

**Worked example (industry cap):** 6 software names ranked 1-6 plus 12 other
industries ranked 7-18 -> selected = software ranks 1,2,3 + others ranks 7-18
(15 names, exactly 3 software). Unit-tested in test_power_trend_rules.py.

**Deployment:** one-off mid-month republish + rebalance at the 2026-07-24 open
(Joe's explicit call: not holding the defective list to Aug 1). Monthly
cadence unchanged thereafter.
