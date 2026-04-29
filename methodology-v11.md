# MacroTilt Methodology — v11

**As of:** 2026-04-29 · **Framework version:** v11.0.0 · **Sprint:** 1

---

## Table of contents

1. [Why this document was rewritten](#why-this-document-was-rewritten)
2. [The framework in one paragraph](#the-framework-in-one-paragraph)
3. [The four-state lexicon](#the-four-state-lexicon)
4. [The headline gauge](#the-headline-gauge)
5. [The six cycle mechanisms](#the-six-cycle-mechanisms)
   - [5.1 Valuation](#51-valuation)
   - [5.2 Credit](#52-credit)
   - [5.3 Funding (Sprint 2)](#53-funding-sprint-2)
   - [5.4 Growth](#54-growth)
   - [5.5 Liquidity & Policy (Sprint 4)](#55-liquidity--policy-sprint-4)
   - [5.6 Positioning & Breadth (Sprint 4)](#56-positioning--breadth-sprint-4)
6. [The Forward Warning tile](#the-forward-warning-tile)
7. [Recovery Watch](#recovery-watch)
8. [Watch List — what we won't claim](#watch-list--what-we-wont-claim)
9. [Data sources, sample windows, and caveats](#data-sources-sample-windows-and-caveats)
10. [Indicator drawer methodology](#indicator-drawer-methodology)
    - [10.1 KPI strip — change vs. distance from peak](#101-kpi-strip--change-vs-distance-from-peak)
    - [10.2 Historical episodes table](#102-historical-episodes-table)
    - [10.3 Co-movement panel](#103-co-movement-panel)
    - [10.4 Release calendar](#104-release-calendar)
    - [10.5 Composite contribution](#105-composite-contribution)
11. [What changed from v10 to v11](#what-changed-from-v10-to-v11)

---

## Why this document was rewritten

This page is the source of truth for what MacroTilt's market-stress models actually do. When a model changes, this page is updated in place — sections are replaced, not appended.

The v10 framework that this document used to describe has been retired in full. v10 read as four panels with 13 "validated" forward triggers, claiming hit-rate accuracy across a 21-year sample. On 2026-04-29 we re-examined the validation work and found that most triggers had only two-to-seven truly independent stress episodes, that out-of-sample testing demolished 11 of 13 of them, and that compound conditions don't escape multiple-testing risk. The honest read is that with roughly ten historical drawdowns in the daily-frequency dataset, the data simply cannot support hit-rate claims at the indicator level.

What follows replaces v10 entirely. The new framework is descriptive cycle-mechanism counting — not predictive trigger firing. Conviction comes from multi-mechanism alignment, not from any single indicator firing.

---

## The framework in one paragraph

MacroTilt observes six market mechanisms that historically describe where the cycle sits: Valuation, Credit, Funding, Growth, Liquidity & Policy, and Positioning & Breadth. Each mechanism is read against its own ex-ante rule and labeled Normal, Cautionary, Stressed, or Distressed. The headline gauge counts how many of the six mechanisms sit above Normal. Zero or one elevated reads as constructive. Two reads as watchful. Three is a defensive setup forming. Four or more is a high-conviction defensive posture. There is one separate forward-looking tile (yield-curve compound condition) and one symmetrical Recovery Watch tile that activates only when several mechanisms are stressed or when the equity market is in a 15%-plus drawdown.

---

## The four-state lexicon

Every tile on the site — and every other surface that describes a market reading on MacroTilt — uses the same four-state lexicon. The lexicon is defined per mechanism by the mechanism's own rule.

| State | Meaning |
|---|---|
| **Normal** | The mechanism's rule is not met. The reading is constructive or neutral. |
| **Cautionary** | The mechanism's rule is partially met. Worth watching, not yet enough to act on. |
| **Stressed** | The mechanism's rule is fully met. The mechanism is signaling its concerning regime. |
| **Distressed** | The mechanism's rule is fully met **and** deteriorating over the last 60 trading days. |

The cutoffs are intentionally conservative: Cautionary fires at partial rule-fire, Stressed only at full rule-fire, and Distressed is reserved for the case where the rule is fully met and the reading is still moving in the wrong direction. We do this so that when "Stressed" or "Distressed" appears on the page, it means something — there is no alert-fatigue tail.

---

## The headline gauge

The Cycle Mechanism Board lives on the **Macro Overview tab** (`#overview` on macrotilt.com). It is the answer to the first question in MacroTilt's three-stage funnel: *what is the macro state of the markets today — risk-on, risk-off, or neutral?* Asset Tilt (`#allocation`) is the second stage (how to position given the regime). Trading Opps (`#portopps`) is the third (which specific names execute the position).

The top of the page reports a single page-level verdict, derived from the count of mechanisms elevated above Normal:

| Mechanisms elevated above Normal | Page verdict |
|---|---|
| 0–1 | **Risk-on** — constructive macro setup |
| 2 | **Neutral** — mixed setup, neither risk-on nor risk-off cleanly |
| 3 | **Risk-off setup forming** — defensive setup is forming |
| 4+ | **High-conviction risk-off** — defensive setup is locked in |

A mechanism is "elevated" if its tile state is Cautionary, Stressed, or Distressed.

We do not report an aggregate "score." Each mechanism is described qualitatively and counted toward the page verdict. This is deliberate — aggregate scores invite the same false-precision the v10 framework collapsed under.

**Sprint 1 day-one reading.** As of 2026-04-29: **Neutral.** 2 of 3 live mechanisms are elevated — Valuation Stressed, Credit Cautionary, Growth Normal. Three further mechanisms (Funding, Liquidity & Policy, Positioning & Breadth) are dial-placeholders on the page pending Sprint 2 and Sprint 4 builds; the verdict-band logic will widen its denominator from 3 to 6 as those mechanisms ship.

**Why this replaces the old 3-composite design.** The Macro Overview tab used to render three composite gauges — Risk & Liquidity, Growth, Inflation & Rates — built from largely the same indicator universe but aggregated as weighted averages with backtested forward-trigger language attached. That design's thesis was *"we predict drawdowns."* Out-of-sample testing demolished the predictive claim. The Cycle Mechanism Board is the same data, organized differently and framed honestly: we describe cycle position, we don't predict timing. The composite indicators didn't disappear — they were reorganized into the appropriate cycle mechanisms (R&L → Liquidity & Policy + Funding + Credit; Growth → Growth; Inflation & Rates → Liquidity & Policy).

---

## The six cycle mechanisms

### 5.1 Valuation

**What it answers.** How richly is the equity market priced relative to its history? When several measures simultaneously sit in their concerning quartile, the equity market is showing the cycle-peak signature — high prices, high prices for risk, narrow risk premium.

**Indicators (Sprint 1).**

| Indicator | What it is | Source | Sample window |
|---|---|---|---|
| CAPE (Shiller) | S&P 500 price divided by 10-year average inflation-adjusted earnings | Shiller / multpl curated monthly | post-2011 (15y) |
| Equity Risk Premium | Earnings yield (1/CAPE) minus 10-year Treasury yield | Derived from CAPE + FRED DGS10 | post-2011 (15y) |
| Buffett Indicator | Nonfinancial corporate equity market cap as a percentage of GDP | FRED NCBCEL / GDP, quarterly | post-1970 (~55y) |
| Trailing P/E | S&P 500 trailing 12-month price-to-earnings | Shiller monthly | **Sprint 1.5** |

**Rule.** The mechanism is **Stressed** when 3 of 4 indicators sit in their concerning quartile. For CAPE, P/E, and Buffett the concerning quartile is the top 25% (rich). For equity risk premium it is the bottom 25% (no compensation for owning stocks vs bonds). **Cautionary** at 2 of 4. **Distressed** at 3 of 4 plus deteriorating over 60 trading days.

**Today (2026-04-29).** Stressed. CAPE at 34.2× sits in the top quartile of the post-2011 sample (77th percentile). Equity risk premium is −1.38% — the bottom quartile of the post-2011 sample (8th percentile), meaning stocks are yielding less than 10-year Treasuries. The Buffett indicator at 232.7% of GDP is at the all-time high of the post-1970 sample (100th percentile). Three of three live indicators are in their concerning quartile; the rule fires Stressed.

### 5.2 Credit

**What it answers.** What compensation are investors demanding to take corporate-credit risk? The Credit tile is read as bidirectional: extreme tightness reads as cycle-peak complacency ("priced for perfection"), extreme widening reads as actual stress arriving. Both are interesting in opposite ways.

**Indicators (Sprint 1).**

| Indicator | What it is | Source | Sample window |
|---|---|---|---|
| IG OAS (Baa − 10y) | Yield premium on Baa-rated investment-grade corporates over 10-year Treasuries | FRED BAA − DGS10, monthly | post-1986 (~40y) |
| HY OAS | High-yield (junk-rated) corporate bond spread over Treasuries | FRED BAMLH0A0HYM2, monthly | post-2011 (15y) |
| HY/IG ratio | High-yield spread divided by investment-grade spread | Derived | post-2011 (15y) |
| Leveraged loan spread | Average all-in spread on first-lien institutional leveraged loans | TBD | **Sprint 2** |

**Rule (bidirectional).** **Stressed** when 3 of 4 spreads sit in the top quartile (real stress arriving) **or** in the bottom quartile (priced for perfection). **Cautionary** at 2 of 4 in either tail. **Distressed** when the Stressed condition holds and spreads are deteriorating over 60 trading days.

**Today (2026-04-29).** Cautionary, complacency regime. IG OAS at 174 bp (23rd percentile) and HY OAS at 284 bp (16th percentile) both sit in the bottom quartile — credit is priced tight relative to recent history. HY/IG ratio at 1.89× is mid-distribution (47th percentile). Two of three live indicators in the bottom quartile triggers the partial-fire (complacency) condition; the rule fires Cautionary.

### 5.3 Funding (Sprint 2)

**Status.** Not yet live. Renders as a greyed placeholder on the Cycle Mechanism Board.

**Planned indicators.** SOFR-OIS, FRA-OIS, CDX investment-grade vs high-yield basis, 5-year EUR cross-currency basis, 3-month commercial-paper funding spread.

**Planned rule.** Stressed when any 2 of 5 sit in the top decile of the post-2008 distribution. Funding stress is sharp and short-lived; we use top-decile (not top-quartile) and a low fire-count because the regime is binary.

**Why we ship Funding before Liquidity & Policy.** Funding is the highest-expected-value new mechanism in the framework. Most stress episodes that the v10 panel missed had a funding-stress signature that wasn't being read; this is where the alpha is.

### 5.4 Growth

**What it answers.** How fast (or slow) is the real economy moving, and is it deteriorating? The Growth tile fires only when indicators are simultaneously at extreme levels **and** worsening — the "and" is critical, since several growth indicators sit in permanently-elevated states for years (jobless claims; BKX/SPX) and a level-only rule would fire constantly.

**Indicators (Sprint 1).**

| Indicator | What it is | Source | Sample window |
|---|---|---|---|
| CFNAI 3-month | Chicago Fed National Activity Index, 3-month moving average | FRED CFNAIMA3, monthly | post-2006 (20y) |
| Jobless claims (4-week) | Initial unemployment claims, 4-week moving average | FRED IC4WSA, weekly | post-2006 (20y) |
| ISM Manufacturing PMI | Headline composite (proxy for the new-orders subindex) | FRED NAPMPI, monthly | post-2006 (20y) |
| Banks vs S&P 500 (BKX/SPX) | Ratio of KBW Bank Index to S&P 500 | Yahoo ^BKX / ^GSPC, daily | post-2006 (20y) |

**Rule.** **Stressed** when 3 of 4 indicators are both extreme (|z| > 1, in the concerning direction) **and** deteriorating over the last 60 trading days. **Cautionary** when 2 of 4 meet the dual condition, or when 3 of 4 are deteriorating without the level condition. **Distressed** when 3 of 4 are extreme and all 4 are deteriorating.

**Today (2026-04-29).** Normal. None of the four indicators meets the level-and-trend condition simultaneously. CFNAI is mid-range and softening; jobless claims are tight; ISM at 52.7 is flat-falling; BKX/SPX is at the post-2006 6th percentile but not deteriorating month-over-month. Two of four are in the soft-deteriorating bucket — worth watching, not enough for a state change.

### 5.5 Liquidity & Policy (Sprint 4)

**Status.** Not yet live.

**Planned indicators.** Adjusted National Financial Conditions Index (ANFCI), real Fed funds rate, M2 year-over-year growth, term premium, Fed balance sheet 6-month change.

**Planned rule.** Bidirectional composite z-score in either tail (top or bottom quartile) is interesting in opposite ways. Tight conditions read as cycle peak; ultra-loose conditions read as policy reflation.

This tile replaces what v10 called the "Inflation & Rates composite" plus the "Macro Regime Context" tile.

### 5.6 Positioning & Breadth (Sprint 4)

**Status.** Not yet live.

**Planned indicators.** NAAIM exposure, margin debt year-over-year, equity put/call ratio, percentage of S&P 500 above 200-day moving average, advance-decline line.

**Planned rule.** Bidirectional. Euphoria (long positioning combined with narrow breadth) and capitulation (short positioning combined with breadth-thrust setup) both read as concerning, opposite directions. The breadth-thrust component will also feed Recovery Watch (below).

---

## The Forward Warning tile

The Forward Warning tile sits visually apart from the six cycle-mechanism tiles. It is the only forward-looking signal on the page that we are willing to publish.

**The compound condition.** All three of:

1. The 10-year minus 2-year Treasury yield curve sits in the +0 to +75 bp band (de-inversion underway, not yet steep).
2. The Federal funds rate has been cut by at least 75 bp in the last 12 months.
3. CFNAI 3-month is below −0.35 and worsening over the last 90 days.

**Read.** The tile fires at 2 of 3 sub-conditions ("warning"). It reads "high conviction" at 3 of 3.

**Why we publish this tile and not others.** Of the 13 forward triggers v10 claimed, only the yield-curve de-inversion compound condition survives both a mechanism story (cuts late in a cycle, then steepening as growth weakens) and the available statistical evidence. The other 12 are described in the Watch List below — we'll keep observing them, but we won't fire alerts off them.

**Sample-size disclosure.** This compound condition has been met three times in the 21-year daily-frequency sample (2007, 2019, 2023). Three observations is too few to claim a hit rate. We publish the read because the mechanism is well-understood; we do not claim it is a probability statement.

---

## Recovery Watch

Recovery Watch is the symmetric sibling of the cycle-mechanism board. It activates **only when** the cycle board has 3 or more mechanisms elevated **or** the S&P 500 is in a 15%-plus drawdown. Otherwise it is hidden.

**Why we built it.** The hardest call in cycle investing is not "when do I get defensive?" — most of the v10 framework already pointed at that. The hard call is "when do I come back?" Most defensive frameworks go defensive in time and stay defensive too long.

**Indicators (planned for Sprint 3).**

| Signal | Description |
|---|---|
| VIX peak-and-roll | VIX has printed a 90-day high then fallen 20% off the peak |
| HY spread peak-and-roll | HY OAS has printed a 90-day high then fallen 20% off the peak |
| Breadth thrust (Zweig) | 10-day average advance/decline ratio crosses above 0.615 |
| Fed pivot | Fed funds futures price in 2+ cuts within the next 6 months relative to spot |

**Rule.** Lights at 2 of 4. High conviction at 3 of 4.

This tile is the commercial differentiator on the page. Not every framework prints when to step back in. This one does.

---

## Watch List — what we won't claim

The following indicators were validated in v10 as forward triggers and **did not survive** out-of-sample testing. We continue to display them on the dashboard for context but we do **not** fire alerts on them and we do **not** include them in any tile rule.

| Indicator | v10 framing | Why we dropped the trigger |
|---|---|---|
| HY OAS > 250 bp | "Defensive sleeve activates" | The 250 bp threshold sits below the post-2011 minimum. Trigger was never wired to the model. |
| 10y-2y deeply inverted | "Recession imminent" | Coincident, not leading. The de-inversion (now in Forward Warning) is the actual lead signal. |
| VIX > 25 sustained | "Stress regime" | Two episodes of sustained > 25 VIX in 21 years — sample too thin. |
| MOVE > 130 sustained | "Rates stress" | Coincident with HY OAS in episode count; no incremental signal. |
| Real fed funds > 2% | "Restrictive policy" | Permanent-elevated failure mode (1990s). |
| ISM new orders < 45 | "Manufacturing recession" | Subindex requires paid feed; headline proxy is too noisy. |
| Jobless 4w > 300k | "Labor turning" | Threshold drift. Fired only 2x in 21 years. |
| CFNAI 3m < −0.7 | "Recession imminent" | Hits 2 false positives in 21 years (2003, 2016). |
| Breadth < 30% above 200dma | "Bear market regime" | Coincident with drawdown, not predictive. |
| Margin debt YoY < −20% | "Leverage unwind" | Two episodes; fires after the drawdown is well underway. |
| Real rates > 2.5% AND HY > 600 bp | "Compound stress" | Compound conditions don't escape multiple-testing risk. |

We display these honestly. The decision to publish a Watch List in plain language ("we don't have enough evidence to fire alerts off these") is intentional — it is more useful to the reader than the alternative, which is to hide the indicators or claim them as triggers despite the evidence.

---

## Data sources, sample windows, and caveats

| Indicator | Source | Window | Caveat |
|---|---|---|---|
| CAPE | Shiller / multpl monthly | post-2011 | Long-history Shiller (post-1881) deferred to v12; current 15y window is the operative comparison. |
| Trailing P/E | Shiller monthly | post-2011 | Sprint 1.5 add. |
| Equity Risk Premium | Derived (1/CAPE − DGS10) | post-2011 | — |
| Buffett Indicator | FRED NCBCEL / GDP, quarterly | post-1970 | NCBCEL is nonfinancial corps only; canonical version includes financials. Directional read is identical, level slightly understated. |
| HY OAS | FRED BAMLH0A0HYM2, monthly | post-2011 | ICE BofA license restricts FRED's free history to post-2011. The 2008 GFC peak (~2,000 bp) is out of sample. We do **not** report a percentile against a pre-2011 distribution we cannot see. |
| IG OAS proxy | FRED BAA − DGS10, monthly | post-1986 | The canonical IG OAS (BAMLC0A0CM) is also license-restricted; BAA − DGS10 is a clean long-history proxy. |
| HY/IG ratio | Derived | post-2011 | Same window as HY OAS limits the joint history. |
| Leveraged loan spread | TBD | TBD | Proprietary feed required; deferred to Sprint 2. |
| CFNAI 3-month | FRED CFNAIMA3, monthly | post-2006 (on disk) | Long history (1967+) available; current 20y window matches the rest of the Growth tile. |
| Jobless claims (4w) | FRED IC4WSA, weekly | post-2006 | — |
| ISM Manufacturing | FRED NAPMPI, monthly | post-2006 | Used as a proxy for the new-orders subindex (paid feed). The directional read tracks new orders closely; level differs. |
| BKX vs S&P 500 | Yahoo ^BKX, ^GSPC daily | post-2006 | Adjusted for splits; constructed as ^BKX / ^GSPC. |

Every percentile and quartile reading on the site is computed against the sample window in this table. Where the window is shorter than the indicator's true history, the methodology page says so explicitly.

---

## Indicator drawer methodology

Clicking any indicator on the Cycle Mechanism Board opens a drawer with five additional analytical panels. The math behind each panel is described below. All windowing respects each indicator's stated sample window in the table above.

### 10.1 KPI strip — change vs. distance from peak

The strip at the top of the drawer reports four numbers, all computed on a monthly grid (the indicator's native series, resampled to month-end last). Quarterly indicators are forward-filled between releases; daily indicators are reduced to month-end closes.

| Tile | What it shows |
|---|---|
| 1-month change | `value_now − value_one_month_ago`, plus the same as a percentage of the prior value. |
| 3-month change | `value_now − value_three_months_ago`, with prior-value-relative %. |
| 1-year change | `value_now − value_twelve_months_ago`, with prior-value-relative %. |
| Distance from peak | `value_now − sample_max`, plus the date of the sample max. |

The strip is a momentum read, not a forecast. The peak label tells the user how far the indicator has retreated from its sample-window high — useful context for indicators that have spent multi-year stretches near extremes.

### 10.2 Historical episodes table

The episodes table answers a single question: *"the last few times this indicator was in the regime it's in today, what did the S&P 500 do over the next 6 and 12 months?"* The table is a base-rate reference, not a forecast or hit-rate claim. The drawer makes that explicit in italics above the table; the JSON ships the disclosure string per indicator.

**Episode definition (locked 2026-04-29 with Joe).** An "entry into the concerning quartile" requires the indicator to remain in the quartile for at least three consecutive months on the monthly grid. The episode is dated at the first month of the run.

This rule is frequency-neutral by construction:

* **Quarterly indicators** (e.g. Buffett Indicator) auto-pass on the first danger-zone print, because the quarterly value forward-fills for three months until the next release. One quarterly print into the danger zone is one episode.
* **Monthly indicators** (e.g. CAPE, ISM) need three consecutive monthly prints in the danger zone.
* **Daily indicators** (e.g. HY OAS, IG OAS) are first resampled to month-end closes, then need three consecutive monthly closes in the danger zone.

The "concerning quartile" depends on the indicator's direction:

* **High-is-concerning** (CAPE, Buffett, jobless claims): top quartile of sample window.
* **Low-is-concerning** (Equity Risk Premium, ISM, CFNAI, BKX/SPX): bottom quartile.
* **Bidirectional** (IG OAS, HY OAS, HY/IG ratio): the rule is symmetric — top quartile = stress arriving, bottom quartile = priced for perfection. The episode side tracked is whichever quartile the indicator currently sits in.

If the indicator is in a mid-quartile (Normal) zone today, the episode table is empty by design — there is no "concerning regime" to look up the history of. The drawer surfaces a one-line note in this case.

**Forward returns.** S&P 500 6-month and 12-month forward returns are price-only, computed from month-end closes (`^GSPC` from Yahoo). When the entry date is too recent for the 12-month window to be observed, the cell renders as "—".

**Why we don't publish hit-rates.** With a typical sample window of 15–55 years and a 3-month confirmation rule, most Sprint 1 indicators yield 1–6 historical episodes. Hit-rate language at that sample size is statistically dishonest (LESSONS rule 29). The episodes table shows the dates and the forward returns, lets the user count, and stops there.

### 10.3 Co-movement panel

The co-movement panel ranks the four other framework indicators that move most with the indicator in question. Both a 1-year and a 5-year correlation are reported side-by-side per indicator pair.

**Math.** Pearson correlation on monthly first differences. The 1-year window uses the trailing 12 monthly observations; the 5-year window uses the trailing 60. Pairs are ranked by absolute 5-year correlation (or absolute 1-year correlation if 5-year is missing because of sample-window mismatch). The top four pairs are shown.

**Why both windows.** A 1-year correlation captures the current regime. A 5-year correlation captures the cycle-average. The *gap* between them is the cycle-mechanism signal: an indicator pair whose 1-year correlation has flipped sign vs. the 5-year average is a sign that the current regime is different from the prior cycle's pattern.

**Why first differences, not levels.** Monthly first-differencing removes shared trend. Two indicators that drift up together over 5 years will show high correlation in level-space even if their month-to-month moves are unrelated. First-differencing measures whether the indicators are moving in the same direction at the same time, which is the cycle-mechanism question.

**Why monthly, not daily.** Daily noise drowns out the cycle-frequency signal we care about. Weekly is closer but doesn't align with the quarterly indicators in the framework. Monthly first-differencing is the lowest common cadence that all Sprint 1 indicators support.

**Sample-size disclosures.** The drawer reports `n` next to each correlation. When n is small (12 for the 1-year window, 30–60 for the 5-year window depending on overlap), the user can judge how much weight to put on the number.

### 10.4 Release calendar

The release calendar reports four facts: frequency, last release date, next expected release date, and the source. Release dates are pulled from FRED's series-info API where available; for derived series (e.g. Equity Risk Premium = 1/CAPE − 10y) and non-FRED series (Yahoo, Shiller) the calendar uses caller-provided hints.

**Next-release estimate.** FRED does not expose a forward release calendar via its free API. We compute the next-release estimate from the cadence: daily series get T+1, weekly series get T+7, monthly series get T+30 days, quarterly series get T+90 days. The estimate is approximate; users should treat it as "around when to expect the next print," not a calendar lock.

### 10.5 Composite contribution

Each tile reports a composite score from 0 to 100 (the higher the score, the more concerning the tile reads). The drawer shows how the indicator currently in view contributes to that composite.

**Per-indicator concerning score.** Computed from the indicator's percentile rank within its sample window:

| Direction | Concerning score |
|---|---|
| High-is-concerning | `score = round(percentile)` |
| Low-is-concerning | `score = round(100 − percentile)` |
| Bidirectional | `score = round(abs(percentile − 50) × 2)` |

So a CAPE in the 77th percentile reads 77/100 (heading toward stressed). An ERP in the 8th percentile reads 92/100 (low ERP = stocks expensive). An IG OAS in the 23rd percentile reads 54/100 (the read is meaningful in either tail).

**Tile composite.** The simple average of the concerning scores of all live indicators in the tile.

**Per-indicator contribution share.** Computed as `concerning_score / sum_of_tile_concerning_scores × 100`. So if the Valuation tile has CAPE at 77, ERP at 85, and Buffett at 100, Buffett contributes 38.2% of the tile's composite weight, ERP 32.4%, and CAPE 29.4%.

**Why score-weighted, not equal-weighted (locked 2026-04-29 with Joe).** Equal-weighting would treat a percentile-50 indicator as equally important as a percentile-100 indicator, which is wrong — when a tile is being driven by one stressed component, the user should see that component dominating. Score-weighted contribution preserves that signal. The drawer shows the contribution math explicitly so the user can sanity-check the weighting.

---

## What changed from v10 to v11

| Area | v10 | v11 |
|---|---|---|
| Framework | Four panels with 13 "validated" forward triggers, hit-rate language | Six cycle-mechanism tiles + one Forward Warning tile + Recovery Watch + Watch List; descriptive, not predictive |
| Headline read | Composite "regime score" | Count of mechanisms elevated above Normal |
| State labels per tile | Four-band Normal/Cautious/Stressed/Distressed (level only) | Four-state Normal/Cautionary/Stressed/Distressed (rule-based, conservative cuts) |
| HY OAS framing | "Wide spreads = stress" forward trigger | State descriptor inside the Credit tile, bidirectional (tight = complacency, wide = stress) |
| Yield curve framing | "Deeply inverted" trigger | De-inversion compound condition with FOMC-rule sub-conditions |
| Hit-rate claims | Per-trigger hit rates published | Removed across the board; sample size too small to support |
| Constituent-override rules | "Fire if 3 of 4 constituents fire even if composite doesn't" | Removed (data mining) |
| Indicator visibility | Hidden if killed by OOS test | Published in the Watch List with explicit "insufficient evidence" tag |

The single largest change is the removal of trigger-firing language. v10 told the reader that specific indicators would fire defensive postures with quantified reliability. v11 tells the reader where each mechanism currently sits in its history, lets the reader count, and stays out of probability claims that the data cannot support.

---

*Document owner: Senior Quant (numerical accuracy) · UX Designer (structural coherence) · Lead Developer (ships in same PR as the calibration JSON, per LESSONS rule #31).*

*Calibration source: `public/methodology_calibration_v11.json`, built by `compute_v11_sprint1_calibration.py`.*
