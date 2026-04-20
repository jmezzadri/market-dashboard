# Indicator Model QC — 2026-04-20

Scope: audit of all 25 indicators in `src/App.jsx` (`IND` table, `SD` calibration, `WEIGHTS`, trend-pill rendering, chart axis labels). Triggered by bug report #1005 ("12M says 0.92 while NOW reads 0.92" — confirmed as a misread of the NOW badge adjacent to the 2026 axis label; the real underlying bug is the ambiguous axis label).

## Summary

- **25 indicators audited.** Trajectory direction, SD z-score, and narrative consistency checked for each.
- **1 confirmed rendering bug** (the original #1005): axis label `"2026"` immediately left of `"Now"` looked like a 12M legend matching the NOW value. **Fixed in this commit** → relabeled to `"Q1 2026"` so the quarter is explicit.
- **3 semantic/calibration issues** flagged for follow-up, none breaking:
  1. **Quarterly indicators labeled "1M"** in the trend-pill strip (SLOOS_CI, SLOOS_CRE, BANK_UNREAL, CREDIT_3Y). The `d[7]` slot is the prior release, which for a quarterly series is ~3 months ago, not 1. Propose renaming trend-pill labels by frequency (Q = "Last Q" instead of "1M").
  2. **`credit_3y` direction tag is `hw`** but the narrative describes both high-growth (bubble) AND low-growth (tight credit) as concerning. Scoring a low value as "Low stress" is inconsistent with the narrative. Propose either (a) a non-linear scoring function or (b) flip the direction to match the current-regime concern (tight credit).
  3. **`copper_gold` SD is `sd=0.03`** — very tight. At NOW 0.126 vs. mean 0.20, z = -2.47 → EXTREME, but narrative describes the deviation as "~37% below mean" (moderate). Either widen the sd (e.g., 0.05) or rewrite the narrative to acknowledge it as extreme. Rec: widen to 0.05 based on 2016-2026 FRED history, where ratio has ranged 0.10-0.25 routinely.
- **4 narrative polish items** — not bugs, opportunities for more precise copy. Listed below.

## Axis label fix (this commit)

`src/App.jsx:549`:

```diff
- out.push(["2026", clampHistValue(id, piecewiseYearValue(2026.0, kf))]);
+ out.push(["Q1 2026", clampHistValue(id, piecewiseYearValue(2026.0, kf))]);
```

The chart x-axis shows bare year (`2005`..`2025`) for Q1 points and `Qn YYYY` otherwise. The final bucket before `Now` is Q1 2026 — with the old label the user saw `... 2026 | Now` and read it as the 12-month-prior badge. The quarterly prefix eliminates the ambiguity.

## Full indicator inventory

Columns: NOW · 1M · 3M · 6M · 12M · SD z-score · narrative direction · flag.

| Indicator | Cat | Now | 1M | 3M | 6M | 12M | z | Regime | Narrative check |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| vix | equity | 17.9 | 23.9 | 17.2 | 19.5 | 15.0 | -0.08 | Normal | ✓ "stress fading" matches 23.9→17.9 |
| hy_ig | credit | 205 | 268 | 245 | 280 | 220 | -0.16 | Low | ✓ "tightened ~55bps" vs. actual 63 — close |
| eq_cr_corr | equity | 0.92 | 0.61 | 0.55 | 0.50 | 0.40 | **+2.45** | **Extreme** | ✓ "sharp jump" — but note discordance with calm VIX/spreads (feature, not bug) |
| yield_curve | rates | 54 | 52 | 35 | 15 | -20 | -0.27 | Low | ✓ monotonic steepening |
| move | rates | 66 | 98 | 95 | 90 | 85 | -0.21 | Low | ✓ "eased substantially" matches |
| anfci | fincond | -0.47 | 0.08 | 0.06 | 0.04 | -0.05 | -1.24 | Low | ✓ "loosened sharply" matches |
| stlfsi | fincond | -0.65 | 0.22 | 0.18 | 0.12 | -0.10 | -0.72 | Low | ✓ "below-average stress" matches |
| real_rates | rates | 1.9 | 1.90 | 1.75 | 1.85 | 1.50 | +1.20 | Elevated | ⚠ narrative cites "avg ~0.5%", SD uses 0.7 — pick one |
| sloos_ci | bank | 5.3 | 9.8 | 8.0 | 6.0 | 2.0 | -0.17 | Low | ⚠ "1M" label misleading (quarterly series) |
| cape | equity | 34.2 | 35.1 | 33.8 | 31.5 | 29.8 | +1.74 | Elevated→Extreme | ✓ "only 1929 and dot-com" accurate |
| ism | labor(growth) | 52.7 | 52.4 | 52.6 | 49.8 | 47.9 | -0.13 | Low | ✓ "inflecting higher" matches |
| copper_gold | labor(growth) | 0.126 | 0.098 | 0.108 | 0.112 | 0.152 | **+2.47** | **Extreme** | ⚠ narrative says "moderate (~37% below)" — SD too tight OR narrative understated |
| bkx_spx | bank | 0.09 | 0.086 | 0.103 | 0.097 | 0.090 | +1.33 | Elevated | ✓ "30% below mean" accurate |
| bank_unreal | bank | 19.9 | 19.5 | 20.8 | 22.1 | 18.5 | +1.86 | Extreme | ⚠ "near recent highs" misleading — actually down from 22.1 |
| credit_3y | bank | 4.5 | 11.8 | 12.5 | 13.2 | 12.8 | -0.50 | Low | ⚠ **direction tag wrong for current regime** — low value = "tight credit" per narrative, but scored as Low stress |
| term_premium | rates | 65 | 55 | 45 | 35 | 20 | +0.36 | Normal | ✓ "risen steadily" matches |
| cmdi | credit | 0.03 | 0.38 | 0.30 | 0.25 | 0.12 | -0.20 | Low | ✓ "sharp improvement" matches |
| loan_syn | credit | 6.74 | 7.45 | 7.0 | 6.5 | 6.2 | +0.22 | Low | ✓ "easing but elevated" matches |
| usd | fincond | 98.3 | 101.0 | 102.5 | 101.8 | 101.0 | -0.10 | Low | ✓ "~3% weaker in a month" accurate (2.7%) |
| cpff | fincond | 18 | 14 | 12 | 10 | 8 | +0.29 | Normal | ⚠ narrative "functioning normally" omits monotonic widening 8→18 over 12M |
| skew | equity | 141 | 141 | 138 | 135 | 130 | +1.08 | Elevated | ✓ "mildly elevated" matches |
| sloos_cre | bank | 8.9 | 18.3 | 15.0 | 12.0 | 8.0 | +0.20 | Low | ⚠ "1M" label misleading (quarterly series) |
| bank_credit | fincond(?) | 6.7 | 3.4 | 3.8 | 4.2 | 5.0 | -0.06 | Low | ⚠ 3.4→6.7 in 1M on a YoY series is extreme — verify not a scan artifact |
| jobless | labor(growth) | 207 | 224 | 215 | 210 | 208 | -0.72 | Low | ⚠ SD mean 340 pulled up by crisis spikes — metric reads "Low" until ~400K |
| jolts_quits | labor(growth) | 1.9 | 2.3 | 2.35 | 2.45 | 2.55 | +0.48 | Normal | ✓ "down sharply from post-COVID high of 3.0" accurate |

## Proposed follow-up fixes (for Joe to approve in a separate batch)

### P1 — semantic

**1. Quarterly trend-pill labels** (`src/App.jsx:1045-1047`)

Currently:
```js
const rows=[["1M",d[7]],["3M",d[8]],["6M",d[9]],["12M",d[10]]];
```

For `IND_FREQ[id]==="Q"` (sloos_ci, sloos_cre, bank_unreal, credit_3y), the `d[7]` value is actually the prior quarterly release, not a monthly snapshot. Propose:

```js
const isQ = IND_FREQ[id]==="Q";
const rows=[
  [isQ?"Last Q":"1M", d[7]],
  [isQ?"Prev Q":"3M", d[8]],
  [isQ?"6M":"6M",     d[9]],  // 2 quarters back = ~6M for quarterly
  [isQ?"1Y":"12M",    d[10]],
];
```

Or simpler: leave the position labels but display "(Q release)" text under the card for quarterly indicators.

**2. `credit_3y` direction** (`src/App.jsx:40`)

Current: `credit_3y:{mean:7,sd:5,dir:"hw"}` — high is worse (bubble framing).

At NOW 4.5%, narrative says "below 5% historically signals tight credit conditions and reduced economic dynamism" — i.e. low is ALSO worse. Scoring as `hw` gives us Low/benign, which contradicts the narrative.

Two options:
- (a) Flip to `dir:"lw"` — matches current-regime concern (tight credit); loses the bubble-risk framing.
- (b) Keep `hw` but rewrite narrative to remove the "tight credit" framing and replace with a "slowing credit expansion — watch for sustained contraction" take.

Recommend (b): the U-shaped risk is hard to capture in a single score, and the 2006-era bubble framing is historically valid. Narrative should stop describing low values as concerning when the score says otherwise.

**3. `copper_gold` SD calibration** (`src/App.jsx:39`)

Current: `copper_gold:{mean:0.20,sd:0.03,dir:"lw"}`. NOW 0.126 → z=2.47 Extreme, but visual/narrative feel "moderate-elevated".

Propose: empirically re-derive from FRED `PCOPPUSDM` / `GOLDPMGBD228NLBM` 2016-2026. Expect mean ~0.18-0.20, sd ~0.05. Would move NOW from Extreme to Elevated, aligned with narrative.

### P2 — narrative polish

**4. `real_rates` narrative** — replace "historical avg ~0.5%" with "historical avg ~0.7%" to match SD calibration (line 142).

**5. `bank_unreal` narrative** — replace "remain near recent highs" with "easing from 22.1% six months ago but still elevated" (line 160). The current copy reads as "still rising" when the trajectory is down.

**6. `cpff` narrative** — add that the spread has widened monotonically 8→18bps over 12M, even though the absolute level is benign (line 177).

**7. `bank_credit` jump** — 3.4%→6.7% in one month on a YoY series is unusual. Verify in source data (FRED H.8) that the 1M-prior value wasn't an error. If confirmed real, note the upside surprise in the signal.

## What this commit changes

- `src/App.jsx:549` — axis label `"2026"` → `"Q1 2026"`.
- `docs/INDICATOR_QC_2026-04-20.md` — this document.

Everything else flagged above is a proposal, not a change. Approve the P1 items and I'll land them as a separate branch.
