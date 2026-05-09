# Trading Opportunities — v2 Methodology Spec ("Signal Intelligence")

**Status:** draft for Joe's review · **Date:** 2026-05-08
**Specialists:** Senior Quant (lead) · UX Designer (consulted) · Lead Developer (consulted) · Data Steward (consulted)
**Replaces:** signal_composite.py v1 (2026-04-20 calibration), TradingOppsPage UI bands

**Brand terminology (per Joe 2026-05-08):** the framework is **Signal Intelligence**. Five **Signals** — Insider, Options, Analyst, Congress, Technicals — each scored −100 to +100. The Signals roll up to Magnitude, then to Conviction, then to MacroTilt Score. "Signal" replaces "section" everywhere user-facing.

---

## TL;DR — what changes

1. **Every section is rebuilt against peer-reviewed evidence.** Each section explicitly cites the paper(s) it's grounded in, what those papers actually showed, and what v1 was missing. The current insider/options/analyst constructions are crude approximations of richer published work; technicals leans on practitioner indicators; dark pool is dropped entirely.
2. **The calibration target is "very high hit rate of risk-adjusted outperformance vs SPY,"** not "highest possible alpha." Conviction over magnitude — your call.
3. **Universe = ≥$1B market cap + ≥$10M average daily dollar volume.** No trend / RS / RSI pre-filters. The composite is the only thing separating signal from noise.
4. **Cross-section weighting is derived from data,** not eyeballed. Three candidates back-tested side by side; you pick the operating point on the hit-rate-vs-basket-size curve.
5. **Bands fall out of the back-test.** No more +60/+40 or +75/+50 by gut feel.
6. **The headline number is "MacroTilt Score" = Magnitude × Conviction.** Per Joe's direction (2026-05-08): user sees raw indicators, then 5 section scores, then Magnitude (the composite), then Conviction (cross-section agreement × historical hit rate), then a single rollup MT Score. Bands fire on MT Score, not Magnitude — so a +80 Magnitude with thin section support gets damped before it can surface as a Buy. See Section A0.

---

## Phase A — per-section reconstruction

Six memos plus an architecture note. For each section: the section's job, what v1 does, what the academic literature actually says, the proposed v2 construction, and the "so-what" sentence (per project standard, every metric must roll up to a one-sentence "so what" for the user).

---

### A0. Score architecture — what the user actually sees on the page

**The hierarchy, working from raw data up to the headline number:**

1. **Indicators** (the raw data): Form 4 filings, options trades, congressional disclosures, analyst notes, price tape. Surfaced on the ticker modal as detail panels.
2. **Signal scores** (five per ticker, each −100 to +100, **all symmetric — every Signal can score negative**): Insider, Options, Analyst, Congress, Technicals. (Dark Pool dropped per A6.) Surfaced as a clean row of five numbers on the ticker modal. Each has a tooltip carrying the Signal's "so-what" sentence.
3. **Magnitude** (one number, −100 to +100): weighted average of the five Signal scores per the cross-section weights derived in Phase D. Answers **"how strongly are the signals pointing bullish or bearish on this name?"**

   **Magnitude is tagged with a calibrated expected excess return from the back-test.** Phase E produces a calibration curve mapping Magnitude → average historical 21-day excess return vs SPY. Display: *"Magnitude +68 (expect +2.8% over SPY in 21 days)."* This is what makes the abstract score interpretable — the user reads it as "this stock is in the historical bucket that beat SPY by ~2.8% next month."
4. **Conviction** (one number, 50%–100%, with direction): probability that the directional call (bullish if Magnitude positive, bearish if negative) plays out. From a 2-D back-test calibration table indexed by **(Magnitude bucket, signal-agreement bucket)**. **50% = coin flip = no actionable edge.** Values below 50% mean signals are wrong about direction; in practice the back-test won't produce sub-50% Conviction at non-zero Magnitude (signals do work, on average). Display: *"Conviction: 78% (bullish)"* or *"Conviction: 85% (bearish)."*
5. **MacroTilt Score** (one number, −100 to +100): the headline rollup. Formula:

   **MT Score = Magnitude × (Conviction% − 50%) / 50**

   This subtracts the coin-flip baseline so **MT Score = 0 means "no actionable edge" regardless of Magnitude.** A high Magnitude with weak Conviction gets damped hard; a strong Magnitude with strong Conviction passes through nearly intact. Sign of MT Score follows Magnitude.

**Bands fire on MT Score (8-band scheme per Joe 2026-05-08):**

| MT Score range | Band label | Direction | Action |
|---|---|---|---|
| +75 to +100 | **Buy Signal** | Bullish | Actionable buy alert |
| +50 to +75 | Strong Bullish | Bullish | High conviction long |
| +25 to +50 | Moderate Bullish | Bullish | Positional long |
| 0 to +25 | Weak Bullish | Bullish | Watch only |
| −25 to 0 | Weak Bearish | Bearish | Watch only |
| −50 to −25 | Moderate Bearish | Bearish | Caution / lighten |
| −75 to −50 | Strong Bearish | Bearish | High conviction short / exit |
| −100 to −75 | **Sell Trigger** | Bearish | Actionable sell alert |

**Bands are validated by Phase E back-test.** Default = Joe's 25-point grid. If the data shows non-monotonic hit rates or natural clusters that warrant adjustment, cutoffs shift but the four actionable extremes (Buy Signal, Sell Trigger) and four "watch but don't act" middle bands stay structurally.

**Worked examples** (illustrative — actual numbers come out of Phase E):

| Name | Magnitude | Expected excess (21d) | Signals firing | Conviction | MT Score | Band |
|---|---|---|---|---|---|---|
| NVDA | +68 | +2.8% | 5 of 5 | 78% bullish | 68 × (78−50)/50 = **+38** | Moderate Bullish |
| META | +70 | +2.9% | 3 of 5 | 65% bullish | 70 × (65−50)/50 = **+21** | Weak Bullish |
| BAC | +35 | +1.4% | 5 of 5 | 90% bullish | 35 × (90−50)/50 = **+28** | Moderate Bullish |
| XYZ | +90 | +3.7% | 1 of 5, only insider | 55% bullish | 90 × (55−50)/50 = **+9** | Weak Bullish |
| HOG | −55 | −2.3% | 4 of 5 negative | 75% bearish | −55 × (75−50)/50 = **−27** | Moderate Bearish |
| GME | −85 | −3.5% | 5 of 5 negative | 92% bearish | −85 × (92−50)/50 = **−71** | Strong Bearish |

Note XYZ vs BAC: explosive Magnitude on one Signal alone (XYZ at +90) gets damped to +9 by low Conviction. Modest Magnitude with full agreement (BAC at +35) surfaces at +28. **The math directly honors "conviction over magnitude."**

**On the page**, per-name layout:
- **MT Score** (large, drives the band color and label)
- **Magnitude** with calibrated excess return tag below it
- **Conviction %** with direction below that
- Five Signal scores with sparkline component breakdowns
- Drill into any Signal → underlying indicators with timestamps

**Why this works:** what professional risk managers call "shrinkage toward neutral" — when confidence is low, signals get damped toward zero. The user-facing version says the same thing in plain English: **"we only get loud when the Signals agree AND the historical hit rate at this signal strength has been a real edge above coin flip."**

**Tunable parameter for Phase D:** the formula above strips coin-flip strictly. A milder alternative is `MT = Magnitude × Conviction% / 100` (no baseline subtraction — Conviction 50% counts as "half credit"). Phase D tests both against hit rate at the Buy Signal threshold; the strict version is the proposed default.

**Where the user sees this data — full surface coverage (per Joe 2026-05-08):**

| Surface | What's exposed |
|---|---|
| Trading Opps page Buy / Near-trigger panels | Top-of-universe MT Scores, sorted descending |
| Trading Opps page **"Sell alerts" panel** | Names in **portfolio OR watchlist** with MT Score collapse, insider reversal, or technical breakdown |
| Watchlist tab | Each watchlist name carries current MT Score and band |
| Portfolio Insights tab | Each holding row carries current MT Score (visible deterioration tracking on owned names) |
| **Ticker detail modal — any name, anywhere on the site** | Full Signal Intelligence: all 5 Signal scores with component breakdowns, Magnitude, Conviction, MT Score, all underlying indicators with timestamps |

The data is universe-wide; not exposing it on watchlist + every modal is a UX gap, not a data gap. v2 closes the gap.

---

### A0.5 — Worked example (NVDA, illustrative)

Inputs are realistic-but-illustrative; bands and weights are the v2 starting points. Phase D may shift them. This walkthrough is the canonical reference for "how does a single name go from raw filings to a MacroTilt Score."

**Signal 1 — Insider: +80**
- Last 30 days, two opportunistic buys totaling $5.97M (CFO + Director). One CEO sell at $87M classified routine (10b5-1 plan, same-month-every-year for 4 years) → excluded per Cohen-Malloy-Pomorski. One VP sell at $4.32M ALSO on a 10b5-1 plan → classified routine, excluded. (Note: under the new symmetric A1, an *opportunistic* VP sell would count at ½ weight and pull this Signal lower; on this name, both sells are pre-scheduled, so neither contributes.)
- Math: log₁₀($5.97M) − 5 = 1.78. Officer multiplier (CFO present): 1.78 × 1.5 = 2.67. Cluster bonus (need 3+ buyers, only 2): 0. Raw: 2.67 × 30 = 80.
- *So-what:* "Two opportunistic insider buys including a CFO purchase, no offsetting opportunistic selling. Strong but not maximal — would need 3+ unique buyers for cluster bonus."

**Signal 2 — Options: +44**
- Today's flow (opening trades only): net delta-adjusted directional premium +$69.9M against NVDA's 30-day mean of $25M (SD $30M) → z-score +1.50.
- 25-delta IV skew: −2.7% (calls cheaper than puts — *normal* shape, not bullish-inverted).
- Total premium $227M vs 30-day mean $145M (SD $50M) → z-score +1.64.
- Math: directional component +1.50 × 25 = +38. Skew component −2.7 × 5 = −14. Magnitude component +1.64 × 12 = +20. Sum = **+44**.
- *So-what:* "Flow is firing bullish on positioning and magnitude, but volatility surface hasn't repriced — the flow knows something the vol market doesn't yet."

**Signal 3 — Analyst: +51**
- Last 30 days: GS upgrade Hold→Buy (+12), Citi initiation Buy (+10 init bonus + +12 buy action = +22), MS PT raise $850→$920, JPM reiteration (0), BTIG downgrade Buy→Hold mid-tier 0.7× weight (−8.4).
- Math: action score +12 + 22 + (−8.4) = +25.6. Consensus PT change +6.25% × 4 = +25 (capped). Sum = **+51**.
- *So-what:* "Three positive analyst events from major brokers vs one downgrade from a smaller shop. Consensus PT up 6%. Womack/Barber action signal firing."

**Signal 4 — Congress: +72**
- Last 45 days: Pelosi $1M+ buy (30 tier points), Tuberville $50K-$100K buy (7 points), Hern $15K-$50K sell (4 × 0.5 = 2 points subtracted).
- Net: 35 tier points. Cluster bonus: 0 (only 2 unique buyers). z-score normalization vs universe 90th percentile (~20 points/45 days) → +72.
- *So-what:* "Pelosi loaded up at $1M+, Tuberville added smaller, one minor sell. Above 90th percentile of recent congressional flow. Real signal — but post-STOCK Act literature is weaker than headlines, hence 5% weight."

**Signal 5 — Technicals: +94**
- 12-month return excluding last month (Jegadeesh-Titman): +37.1% → top 8% of universe → +30.
- 52-week-high proximity: 96.7% (within 4% of high) → +30 per George-Hwang.
- 6-month relative strength: NVDA +18% vs SPY +6% → excess +12% → +25.
- Volume: 1.58× normal → ×1.1 amplifier triggers.
- Math: 30 + 30 + 25 = 85. ×1.1 = +94 (clamped to ±100).
- *So-what:* "Triple confirmation: top decile momentum, near 52-week high, beating SPY meaningfully, on heavy volume. Three peer-reviewed signals all firing."

**Magnitude rollup:**

| Signal | Score | Weight | Contribution |
|---|---|---|---|
| Insider | +80 | 35% | +28.0 |
| Technicals | +94 | 25% | +23.5 |
| Options | +44 | 20% | +8.8 |
| Analyst | +51 | 15% | +7.65 |
| Congress | +72 | 5% | +3.6 |
| **Total** | | **100%** | **+71.55** |

**Magnitude = +72.** *(Note: weights must sum to 1.0; the +5% from dropping Dark Pool was reallocated to Insider, which carries the strongest academic foundation per A1. Earlier draft of this worked example used 30% on Insider with weights summing to 95% — arithmetic error, fixed 2026-05-08.)*

**Calibrated expected excess return** (from Phase E back-test, illustrative): Magnitude +60 to +70 historically corresponds to **+2.8% excess vs SPY over 21 days**, on average.

**Conviction (probability of beating SPY):**
- Cross-section agreement: 5 of 5 Signals positive (100% agreement).
- Back-test hit rate at Magnitude +60 to +70 with full agreement: 78% of historical names beat SPY over the next 21 days.
- **Conviction = 78% (bullish).**

**MacroTilt Score = 68 × (78 − 50) / 50 = 68 × 0.56 = +38.**

**Band: Moderate Bullish (+25 to +50).**

**Page headline:**
> **NVDA · Moderate Bullish · MT Score +38**
> Magnitude +68 — historically +2.8% excess vs SPY over 21 days
> Conviction 78% bullish — signals point up 78% of historical similar setups

Click NVDA → modal opens with all 5 Signal scores broken down, component contributions, and underlying indicators with timestamps.

**Counter-example to demonstrate Conviction's role:** name XYZ with the same +68 Magnitude but only Insider (+95) and Technicals (+50) firing, three other Signals null. Cross-section agreement still 100% (all non-null are positive), but back-test hit rate at +68 *with only 2-of-5 Signals reporting* is much lower — say 60%. Conviction = 60%. MT Score = 68 × (60 − 50) / 50 = **+14** (Weak Bullish — doesn't surface as actionable). Compare to NVDA's +38 with all 5 Signals firing: same Magnitude, very different MT Score. The math directly punishes thin support.

**Bear-side counter-example:** name HOG with Magnitude −55 (signals pointing bearish), 4 of 5 Signals negative, back-test hit rate 75% bearish (75% of historical names at this profile underperformed SPY over 21 days). MT Score = −55 × (75 − 50) / 50 = **−27** (Moderate Bearish). Page would show it as a position-trimming candidate or short-watch idea (depending on the open decision below about the long-short surface).

---

### A1. Insider Transactions — proposed weight 30% (up from 25%)

**Job of this section:** detect when corporate officers and directors are buying or selling their own company's stock with their own money, on the public market (SEC Form 4 filings).

**v1 construction:** Sum of buy dollars minus sum of sell dollars on a log scale. Officer trades multiplied ×1.5. Cluster bonus +15 if 5+ unique buyers, +8 if 3+. $25K row-level floor. Returns 0 (not null) when no data.

**What the academic literature actually says:**

- **Lakonishok & Lee (2001), "Are Insider Trades Informative?" (Review of Financial Studies, 16(1).)** Insider buys predict 6–12 month abnormal returns. Insider sells have **far weaker** information content because insiders sell for many non-information reasons: tax planning, diversification, options exercise, lifestyle. The asymmetry is large and stable across decades. *v1 treats buys and sells symmetrically — that's a mistake.*
- **Cohen, Malloy, Pomorski (2012), "Decoding Inside Information," Journal of Finance, 67(3).** Distinguishing **routine** trades (insiders who buy or sell in the same calendar month every year — typically tied to compensation grants) from **opportunistic** trades (irregular, conviction-driven). Opportunistic buys earned roughly 8–9% annual abnormal returns; routine buys earned essentially 0%. *This is the single most important refinement available — and v1 doesn't make it.*
- **Jeng, Metrick, Zeckhauser (2003).** Aggregating insider trades into firm-level signals with longer windows enhances predictive power. *Supports v1's cluster bonus and notional log-scaling — those are right. The 14-day INSIDER_LOOKBACK_DAYS in `config.py` is too short; the literature uses 30–90 day windows.*

**Proposed v2 construction:**

1. **Symmetric construction so the Insider Signal can score negative.** (Revised 2026-05-08 per Joe — initial draft "drop sells entirely" was over-aggressive and broke the Signal's ability to fire bearish.) Construction:
   - Opportunistic buys: full weight (academic case strongest per Lakonishok-Lee).
   - Opportunistic sells: ½ weight (sells carry less information than buys, but not zero).
   - **Cluster sell trigger: full weight.** 3+ unique opportunistic officer sells in a 30-day window means coordinated insider exit, which the literature treats as informative. When the cluster trigger fires, the sell side recovers full weight.
   - Range: −100 to +100. A name with 4 officers selling $30M+ opportunistically with no offsetting buys would score Insider ≈ −85.
2. **Routine vs opportunistic classification.** Routine = the insider has bought or sold in the same calendar month for 3+ consecutive years. Opportunistic = everything else. Routine trades get weight 0; opportunistic get weight 1.
3. **Officer multiplier stays at 1.5.** CEO/CFO transactions are higher-information than director transactions per the literature.
4. **Cluster bonus stays.** +15 for 5+ unique buyers, +8 for 3+. Aligned with Jeng et al.
5. **Notional log-scale stays.** Aligned with the literature on transaction-magnitude information.
6. **Window: tested at 30, 60, and 90 days in Phase D.** Bumped from v1's 14-day window to align with academic convention (Lakonishok-Lee used 6-month forward windows; Jeng-Metrick-Zeckhauser aggregated multi-month). The literature does **not** lock a single optimal lookback — longer windows smooth the signal but carry stale conviction (insider may have already exited the position quietly); shorter windows are more responsive but produce more null/zero observations on individual names. **It's a calibration parameter, not a theoretical lock.** Phase D back-tests 30/60/90 day windows; the winner on hit rate becomes production. Same logic applies to Congressional trades — current 45-day window will be tested at 45/90/120.
7. **No-data behavior changes from 0 to null.** A name with no insider activity should not be treated as "neutral insider" — it should be excluded from that section's contribution to the average. (Fixes the v1 dilution bug.)

**So-what (positive):** An Insider Signal of +60 means "multiple opportunistic buys by officers in the past 30 days, totaling >$1M in fresh capital, no offsetting opportunistic selling."

**So-what (negative):** An Insider Signal of −60 means "cluster of opportunistic officer sells in the past 30 days totaling >$5M, no offsetting buys" — coordinated insider exit. Both directions are peer-reviewed signals, not heuristics.

---

### A2. Options Flow — proposed weight 20% (unchanged)

**Job of this section:** detect whether the options market is positioning bullish or bearish on a name, beyond what the stock price already shows.

**v1 construction:** (a) net call premium minus net put premium, log-scaled, capped ±60; (b) bullish/bearish premium ratio ±20; (c) raw count of UW unusual-flow alerts net of put alerts, with sweeps weighted +4 each, capped ±40.

**What the academic literature actually says:**

- **Pan & Poteshman (2006), "The Information in Option Volume for Future Stock Prices," Review of Financial Studies, 19(3).** Open-buy put/call ratios from non-market-maker customers predict next-day stock returns. The construction matters — total volume mixes informed and uninformed flow; the predictive piece is **opening trades from end customers**, not market-making activity. *v1 uses raw premium, which mixes both.*
- **Cremers & Weinbaum (2010), "Deviations from Put-Call Parity and Stock Return Predictability," JFQA, 45(2).** Implied-volatility skew — the gap between call IV and put IV at the same strike/expiry — predicts cross-sectional returns over 2–4 weeks. Inverted skew (call IV > put IV at the same strike) is bullish. *v1 ignores IV skew entirely.*
- **Hu (2014), "Does option trading convey stock price information?" Journal of Financial Economics, 111(3).** Order imbalance from informed traders contains return-predictive information; the directional information is in **delta-weighted** flow, not raw notional.

**Proposed v2 construction:**

1. **Replace "net call premium minus net put premium" with delta-adjusted directional premium.** Call premium × call delta minus put premium × |put delta|. This is the academic measure of "directional dollar exposure created by the day's flow," not just notional. UW exposes deltas on the flow alerts.
2. **Add IV skew as a second input.** UW exposes call IV and put IV at the same strikes. We compute 25-delta call IV minus 25-delta put IV. Inverted skew (calls richer than puts) is bullish per Cremers-Weinbaum.
3. **Replace raw "alert count" with z-score of premium relative to the ticker's own 20-day rolling premium.** UW's "alert" flag is opaque (we don't know the threshold). A z-score is reproducible: "today's net premium is 2.1 standard deviations above this ticker's 30-day average." *v1's alert-count approach hard-codes UW's editorial choices into our score.*
4. **Filter to opening trades** (UW exposes a "type" field on flow rows: `opening` vs `unknown` vs `closing`). Opening trades carry the predictive content per Pan-Poteshman.
5. **No-data behavior: null** (already correct in v1).

**Three components, equal-weighted within the section:**
- delta-adjusted directional premium z-score (±50)
- IV skew (±25)
- premium magnitude z-score (±25)

**So-what:** An options score of +60 means "today's options flow is dollar-weighted bullish, IV skew is inverted in favor of calls, and total premium is 2+ standard deviations above this name's normal level. That triple-confirmation is what the academic literature has shown predicts 2–4 week excess returns."

---

### A3. Analyst Ratings — proposed weight 15% (up from 10%)

**Job of this section:** detect when sell-side analysts are upgrading or initiating coverage on a name, or raising price targets.

**v1 construction:** (a) buy/sell mix of static recommendations ±30; (b) price target upside × 1.1, capped −50/+60 (asymmetric — slight bullish bias baked in); (c) recent 60-day upgrade/downgrade action ±15.

**What the academic literature actually says:**

- **Womack (1996), "Do Brokerage Analysts' Recommendations Have Investment Value?" Journal of Finance, 51(1).** Recommendation **changes** (upgrades, downgrades, initiations) generate significant abnormal returns over the following 1–6 months. **Levels** (the static distribution of buy/hold/sell ratings) have much weaker predictive value. *v1 puts the heaviest weight (30 points) on the level signal — that's backwards.*
- **Barber, Lehavy, McNichols, Trueman (2001), "Can Investors Profit from the Prophets?" Journal of Finance, 56(2).** Strategies that buy on consensus upgrades and sell on downgrades earned ~4% annual abnormal returns gross of costs. The signal is in the **change**, not the standing rating.
- **Brav & Lehavy (2003), "An Empirical Analysis of Analysts' Target Prices," Journal of Finance, 58(5).** Target prices contain information beyond the recommendation. But the predictive piece is the **change** in consensus target, not the static gap between target and current price. The static gap is partly mechanical: when stock falls, target-upside automatically rises, but that's not new information.

**Proposed v2 construction:**

1. **Drop the rec-mix component.** It's a level signal and the literature says it's weakly predictive.
2. **Action score, weighted and windowed.** Past 30 days: each upgrade or initiation = +X; each downgrade = −X; weighted by analyst tier (top-tier broker upgrades count for more — UW exposes broker name). Capped ±50.
3. **Consensus PT change** (not static PT-vs-price). Compare today's median PT to the median PT 30 days ago. A +5% raise in consensus PT is a positive signal; a +20% mechanical-looking gap because the stock crashed is not. Capped ±25.
4. **Initiation bonus.** New coverage from a top-tier broker carries extra weight (+10).
5. **Bullish-bias cap removed** (current code caps PT upside at −50/+60 — we use symmetric ±25).
6. **No-data behavior: null** (already correct in v1).

**So-what:** An analyst score of +60 means "two or more upgrades or PT raises from major brokers in the past 30 days, no offsetting downgrades, and consensus PT has risen meaningfully." That's exactly what Womack/Barber identified as the predictive signal.

---

### A4. Congressional Trades — proposed weight 5% (down from 15%)

**Job of this section:** detect when members of Congress disclose buys or sells of a name. Disclosures are mandated by the STOCK Act (2012) and lag the actual trade by up to 45 days.

**v1 construction:** Tier points by disclosure dollar bucket ($1K-$15K = 2pts up to $1M+ = 30pts), buys minus sells, cluster bonus +15/+10. Multiplier ×3.3 to fit ±100.

**What the academic literature actually says:**

- **Ziobrowski, Cheng, Boyd, Ziobrowski (2004, 2011), JFQA.** Pre-STOCK Act (1985–2001 sample), Senate trades earned ~12% annual excess returns; House trades ~6%. These were the headline numbers that drove all the public attention. **But this was before mandatory rapid disclosure.**
- **Eggers & Hainmueller (2013), "Capitol Losses," Quarterly Journal of Political Science.** Replicated post-2008: alpha attenuated significantly. The Ziobrowski result was partly a function of weaker disclosure rules and concentration in a few prolific traders.
- **Belmont, Tahoun, van Dijk (2022) and follow-on work.** Mixed, modest evidence post-STOCK Act. Direction-of-flow remains weakly informative; magnitude is much weaker than the original headlines.

**Honest read:** the post-STOCK Act literature does not support a 15% weight. The original Ziobrowski numbers were pre-disclosure-reform and don't replicate. Keeping the section at 5% acknowledges there's *some* signal there (asymmetric information is real, even if the alpha has decayed) without overweighting a noisy input.

**Proposed v2 construction:**

1. **Dollar tier weighting stays.** The literature does support magnitude effects, even if attenuated.
2. **Buys minus sells stays,** but with the same asymmetry as insider — sells weighted at ½ of buys. Politicians sell for many of the same non-information reasons.
3. **Drop the ×3.3 multiplier** (it's a hack to fit ±100). Replace with proper z-score relative to historical disclosure flow for the universe.
4. **Cluster bonus stays.**
5. **No-data behavior changes from 0 to null** (fixes the v1 dilution bug).
6. **Window: 45 days** (unchanged — matches the disclosure lag).

**So-what:** A congress score of +60 means "3+ congressional buys totaling $250K+ disclosed in the past 45 days, no offsetting sells." Acknowledged lower-confidence section than insider trades — hence lower weight.

---

### A5. Technicals — proposed weight 25% (unchanged)

**Job of this section:** detect whether the price tape itself is bullish or bearish on a name, separate from any fundamental signal.

**v1 construction:** SCTR-style (long-term 60% / mid 30% / short 10%) using % vs 200MA, % vs 50MA, year-to-date and 1-month relative strength vs SPY, MACD cross, RSI band. ADX trend filter (×0.7 dampen if ADX<20). Volume confirmation (×1.1 amplify if RVOL ≥ 1.5).

**What the academic literature actually says:**

The technicals section has the **most academic literature** of any of the six, but **v1's chosen indicators are mostly practitioner heuristics** rather than the academic measures.

- **Jegadeesh & Titman (1993), "Returns to Buying Winners and Selling Losers," Journal of Finance, 48(1).** Cross-sectional momentum — buying the past-12-month winners and selling the losers, **skipping the most recent month** — earns ~1% per month for 3–6 month holding periods. Robust globally and out of sample. *This is the canonical momentum signal. v1 uses YTD vs SPY and 1M vs SPY — those are momentum proxies, but they don't follow the Jegadeesh-Titman construction (which specifically excludes last month because of short-term reversal — short-term winners revert).*
- **Asness, Moskowitz, Pedersen (2013), "Value and Momentum Everywhere," Journal of Finance, 68(3).** Momentum predicts returns globally across asset classes.
- **George & Hwang (2004), "The 52-Week High and Momentum Investing," Journal of Finance, 59(5).** Distance from 52-week high is a strong predictor — names trading near their 52-week high tend to keep outperforming. Adds information beyond the simple 12-month momentum signal.
- **Moskowitz, Ooi, Pedersen (2012), "Time Series Momentum," Journal of Financial Economics, 104(2).** Time-series (own-history) momentum complements cross-sectional momentum.

**Indicators v1 uses that are NOT well-supported by academic evidence:**
- ADX (Wilder, 1978) — practitioner indicator. No peer-reviewed predictive evidence at the individual-name level.
- RSI (Wilder, 1978) — practitioner. The 30/70 oversold/overbought levels are conventions, not data-derived.
- MACD — practitioner. Weak evidence in the academic literature.
- SCTR (Pring, StockCharts) — proprietary practitioner construction. Not peer-reviewed.

**Proposed v2 construction:**

Replace the SCTR pyramid with three academically grounded components, equal-weighted:

1. **Jegadeesh-Titman classical momentum (12-1).** Trailing 12-month total return, **excluding the most recent month** (the skip-month is what the literature explicitly shows works — without it, short-term reversal contaminates the signal). Cross-sectionally ranked vs the universe. ±35.
2. **52-week-high proximity (George-Hwang).** (current_price / 52-week-high). Names within 5% of their 52-week high score positively; names below the 52-week low score negatively. ±35.
3. **6-month relative strength vs SPY.** Closer to the academic momentum convention than v1's 1-month measure. ±30.

**Volume confirmation stays** (academic literature supports turnover/volume as a confirmation signal — Lee & Swaminathan 2000 "Price Momentum and Trading Volume," Journal of Finance, 55(5)).

**ADX, RSI, MACD come out of the score.** They remain on the dashboard as descriptive context for the user (current code already exposes them as separate fields), but they don't drive the score.

**So-what:** A technicals score of +60 means "name is in the top decile of 12-month-minus-1-month return, within 5% of its 52-week high, and outperforming SPY over 6 months on rising volume." Three peer-reviewed momentum signals confirming each other.

---

### A6. Dark Pool — proposed: drop entirely

**Job of this section in v1:** tiebreaker capped at ±20. NBBO-midpoint vote weighted by log of total premium, plus relative-volume bump.

**What the academic literature says:**

- **Comerton-Forde & Putnins (2015), "Dark trading and price discovery," Journal of Financial Economics, 118(1).** Dark pool activity affects price discovery, but predictive value at the individual-name level is weak.
- **Buti, Rindi, Werner (2017), "Diving into Dark Pools," Review of Financial Studies, 30(4).** Dark pool activity is correlated with the information environment but not directly predictive.
- **Zhu (2014), "Do Dark Pools Harm Price Discovery?" Review of Financial Studies, 27(3).** Dark pools tend to attract **uninformed** order flow; informed traders preferentially route to lit markets. *This argues directly against treating dark-pool flow as an information signal.*

**Recommendation: drop dark pool from the composite.** Reweight the freed 5% — proposed allocation: +5% to insider (now 30%) and +5% to analyst (now 15%), partially offset by reducing congress to 5%. This produces the proposed v2 weights below.

If you want to keep dark pool for narrative reasons (it's a popular feature on the Trading Opps page), we can keep it as a **descriptive panel** on the ticker modal — same data, displayed without entering the score.

---

## Phase B — calibration target

Per your answer to question 1: **high probability of beating SPY on a risk-adjusted basis. Conviction over magnitude.**

**Formal definition** (the back-test will optimize against this):

For each candidate combination of section construction, weighting scheme, and Buy threshold T:

1. **Daily Buy basket** = the set of tickers with v2 composite ≥ T on this day's scan.
2. **Holding** = equal-weighted across the basket, rebalanced weekly.
3. **Holding period** = 21 trading days forward (~1 calendar month).
4. **Information ratio (IR)** = (basket return − SPY return) / standard deviation of (basket return − SPY return), annualized. Measures how much risk-adjusted excess return the basket produces vs SPY.
5. **Hit rate** = % of overlapping 21-day windows in which basket return > SPY return.
6. **Drawdown floor** = max drawdown of the basket cannot exceed SPY's max drawdown over the same window by more than 5 percentage points.

**The optimizer maximizes hit rate, subject to:**
- IR > 0.5 (the basket has to actually be risk-adjusted-better than SPY, even if marginally)
- Average basket size ≥ 5 names (you need a workable number of trades)
- Drawdown floor (above)

This is the explicit "high conviction over magnitude" formulation: the optimizer prefers a basket that beats SPY 80% of months by 0.5% over one that beats 60% of months by 2%.

**You'll see the hit-rate-vs-basket-size curve in the back-test output.** The smaller the basket (higher Buy threshold), generally the higher the hit rate — but at some point you have 0–1 names per scan and the basket isn't useful. The "operating point" is your call.

---

## Phase C — universe

Per your answer to question 2 + Option A on the popup:

- **Market-cap floor: $1,000,000,000.** Source: `ticker_reference.market_cap` in Supabase (Massive / Polygon reference data).
- **Liquidity floor: $10M average daily dollar volume,** 20-day rolling. Source: `prices_eod` in Supabase.
- **No trend pre-filter, no relative-strength pre-filter, no RSI pre-filter.** The composite is the only thing separating signal from noise.
- **Common equities only, US-listed.** ETFs, ADRs, and OTC excluded for v2.

**Expected universe size: ~3,000 names per scan.** v1's 4-gate stack typically reduced this to ~400–600. The composite now has to do real work — names that surface as Buys are surfacing on the strength of the six sections, not on top of a momentum funnel.

**Scan-time impact:** roughly 5× the names to score. With current technical-composite caching (yfinance OHLCV pre-fetched once per ticker per scan), the incremental cost is ~15 minutes. Acceptable for a nightly job.

---

## Proposed v2 weights (preview — Phase D will derive these from data)

| Section | v1 weight | v2 starting weight | Rationale for change |
|---|---|---|---|
| Insider | 25% | **35%** | Strongest academic foundation. Routine/opportunistic split adds real predictive power not in v1. The +5% reallocation from dropped Dark Pool lands here (weights must sum to 1.0). |
| Technicals | 25% | **25%** | Unchanged. Reconstruction (Jegadeesh-Titman + 52w-high + RS) is academically stronger than v1 (SCTR/ADX/RSI). |
| Options | 20% | **20%** | Unchanged. Reconstruction (delta-adjusted + IV skew + premium z-score) matches the literature. |
| Analyst | 10% | **15%** | Increased — Womack/Barber action signal is strong. v1 underweights this. |
| Congress | 15% | **5%** | Reduced — post-STOCK Act literature does not support 15%. |
| Dark pool | 5% | **0%** | Dropped. Zhu (2014) argues dark pools attract uninformed flow. Re-allocated. |
| **Total** | **100%** | **100%** |  |

**These are starting points for Phase D's data-derived re-weighting.** Phase D will run three weighting schemes side by side:

- **Equal weight** across the five surviving sections (20% each).
- **Regression-derived weights:** in-sample regression of forward 21-day excess return on the five section scores; coefficients become weights. Cross-validated with rolling windows to test stability.
- **Logistic-regression classifier:** binary target = "did this name beat SPY by ≥ 0.1% over the next 21 days?" Coefficients become weights. Same stability checks.

The winner on hit rate (subject to the constraints above) is the v2 weight set.

---

## Phase E — back-test design (preview)

**Universe:** as defined in Phase C, point-in-time market cap and ADV using Massive data already in Supabase.

**Sample period:** 2019-01-01 through 2024-06-30 (training), 2024-07-01 through 2026-04-30 (out-of-sample hold-out). 5.5 years training + ~2 years OOS.

**Costs:** 5 basis points round-trip slippage + 1 basis point commission per trade. Reasonable for a $1B+ universe at retail-broker pricing.

**Walk-forward convention:** train on 2019–2023, validate on 2024H1, hold out 2024H2–2026.

**Three calibration outputs Phase E must produce** (for the Magnitude/Conviction display per A0):
1. **Magnitude → Expected Excess Return curve.** For each Magnitude bucket (e.g., 5-point buckets), the average historical 21-day excess return vs SPY. Pinned to `public/calibration_v2_magnitude_to_return.json`. The page reads this to render "Magnitude +68 (expect +2.8% over SPY in 21 days)."
2. **(Magnitude × Agreement) → Hit Rate matrix.** 2-D table indexed by Magnitude bucket and signal-agreement bucket. Each cell = % of historical names with that profile that beat (or, for negative Magnitude, underperformed) SPY over the next 21 days. Pinned to `public/calibration_v2_conviction_table.json`. The page reads this to render "Conviction: 78% bullish."
3. **MT Score → 8-band cutoff validation.** Joe's 25-point grid is the default. The back-test reports per-band hit rate, average return, and population %. If a band shows non-monotonic behavior (e.g., +50–75 doesn't outperform +25–50), cutoffs adjust. Pinned to `public/calibration_v2_bands.json`.

**Reporting (deliverable 5 per the brief):**
- Walk-forward IR + hit rate + max drawdown — overall and by year.
- Signal-level **ablation** — re-run with each Signal turned off, measure how much IR / hit rate degrades. Tells us which Signals are doing real work.
- **Long-only** (Buy Signal basket vs SPY) vs **long-short** (Buy Signal vs Sell Trigger) comparison runs to test whether the negative tail of the score has predictive power.
- **Hit-rate-vs-basket-size curve** so Joe can pick the operating point.
- **Equity curve chart** of the Buy-Signal-zone basket vs SPY.
- **Per-band performance table** — average return, hit rate, population %, max drawdown for each of the 8 bands.

**Reproducibility (per LESSONS rule):** every back-test number quoted in the methodology page comes from `scripts/backtest_trading_opps_v2.py`. The script's commit SHA and the JSON-pinned output are referenced inline; no hand-quoted numbers from markdown.

---

## Phase F — what ships at the end

1. **Producer script** — `scripts/compute_signal_composite_v2.py` (Python). Reads from Supabase / UW API / Massive, writes per-section + composite scores to `latest_scan_data.json`.
2. **Back-test harness** — `scripts/backtest_trading_opps_v2.py`. Output: `public/backtest_v2_results.json`.
3. **Threshold update** — Buy / Near-trigger bands derived from the back-test, replacing today's three-different-numbers situation (config: +60/+40, page caption: +80/+70, brief: +75/+50).
4. **Methodology page rewrite** — `src/v2/pages/MethodologyPage.jsx` rewritten in place per the existing LESSONS rule (no appended changelog).
5. **Trading Opps page UI update** — TradingOppsPage.jsx caption strings re-aligned to the new bands (today's "scored 80+" caption is stale).
6. **Data Steward registration** — `data_manifest.json` entries for `latest_scan` and `backtest_v2_results`. Freshness chips wired on the page.
7. **Methodology calibration JSON** — `methodology_calibration_trading_opps_v2.json` per the v11-mechanism convention. The producer script reads this so future weight changes are config-driven, not code edits.
8. **Sell-alert surface on the v2 Trading Opps page (NEW per Joe 2026-05-08).** Three deliverables:
   - **"Names you own OR watch that have turned bearish"** — driven by the existing `sell_alerts` output from `scanner/sell_signals.py`. Triggers: (a) MT Score collapse from prior Buy/Near-trigger (existing SCORE_COLLAPSE_THRESHOLD logic, retuned for v2 bands), (b) MT Score ≤ −10 on a name in your portfolio or watchlist, (c) insider-sell reversal on a recent buy. Portfolio + watchlist integration already exists (`portfolio_io.load_portfolio_positions`, `watchlist` array on the scan JSON). Surfaced as an amber/red panel above the Buys.
   - **(Conditional) "Strong Bear universe ideas"** — names with MT Score ≤ −60 across the universe. Surfaced **only if** the long-short back-test in Phase E shows the bear tail has predictive alpha. If not, drop. (One of the open decisions below.)
   - The NVDA scenario Joe asked about — "I bought it 6 months ago, signals turn bearish, how do I know?" — this is what addresses it. The page would have flagged NVDA the day MT Score crossed below the collapse threshold, with the trigger reason (insider selling cluster + technical breakdown + analyst downgrades, in plain English).

9. **Ticker detail modal — full Signal Intelligence on every name (NEW per Joe 2026-05-08).** Any ticker the user clicks anywhere on the site (Trading Opps, Watchlist, Portfolio Insights, Asset Tilt) opens a modal showing: all 5 Signal scores with component breakdowns, Magnitude, Conviction, MT Score, and the underlying indicators (Form 4 rows, options flow alerts, congressional disclosures, analyst notes, momentum/RS data) with timestamps and source attribution. The data is universe-wide; not exposing it on every modal is a UX gap, not a data gap.

10. **Watchlist + Portfolio rows carry MT Score inline (NEW per Joe 2026-05-08).** The watchlist tab and portfolio holdings rows each show the current MT Score and band next to the ticker, so the user sees deterioration / improvement at a glance without having to open a modal.

---

## Open decisions for Joe (will surface as popups on approval)

These are the remaining decisions before I implement Phase D–F. I'll fire them as popups once you sign off on Phase A–C.

1. **Insider sells: drop entirely, or keep at ¼ weight?** Academic case for symmetric treatment is weak; keeping sells at ¼ weight catches the rare strong-conviction sell.
2. **Cross-section weighting: equal / regression / classifier — pick winner on hit rate, or do we prefer the classifier even if it's narrowly worse, for the cleaner story?**
3. **Long-short back-test: surface "Strong Bear" universe alerts if alpha is real, or keep v2 long-only and only ever flag bearish on names you already own?** Position-aware sell alerts ship either way per #8 above.
4. **Dark pool: drop entirely vs keep as a descriptive panel on the ticker modal (same data, no score contribution)?**
5. **Conviction exponent: 0.5 / 1.0 / 1.5?** Controls how aggressively low Conviction damps Magnitude. 1.0 is the proposed default; Phase D tests all three on hit rate.

---

## Approval checklist

To sign off on Phase A–C and authorize Phase D–F execution, confirm:

- [ ] Score architecture (A0) — five sections → Magnitude → Conviction → MacroTilt Score, with bands on MT Score not Magnitude.
- [ ] Per-section reconstructions (A1–A6) directionally correct.
- [ ] Lookback windows for insider (30/60/90) and congress (45/90/120) tested as Phase D parameters, not locked upfront.
- [ ] Calibration target (Phase B) — high hit rate of risk-adjusted outperformance, basket size ≥ 5, IR > 0.5.
- [ ] Universe (Phase C) — $1B mkt cap + $10M ADV, no other gates. ~3,000 names.
- [ ] Starting weights (30/25/20/15/5/0) acceptable as the seed for Phase D's data-derived re-weighting.
- [ ] Phase E back-test design (training / hold-out windows, 5bp slippage, ablation study, long-short comparison).
- [ ] Phase F includes position-aware **Sell Alerts** as a v2 deliverable (not a follow-on PR).

Reply "approved" or push back on any line item. The 5 open decisions above I'll fire as popups on green light.
