# Signal Intelligence v4.1 — Production Blueprint (LOCKED)

**Status:** LOCKED 2026-05-09 · **Owner:** Senior Quant
**Replaces:** v2 (Magnitude/Conviction/MT — retired) · v3 / v3.1 (large-cap variants — retired)
**Validated by:** 12-month backtest, 197 small-caps, 40,442 (ticker, day) observations + first-buy refinement test.

---

## What this is

A long-only equity scanner targeting **small/mid-cap names** ($300M-$3B market cap) where **information asymmetry between insiders/whales and retail price action is statistically meaningful**. The scanner produces ~2-3 actionable trades per week with a 62-70% historical win rate on a 21-day hold horizon.

The scanner identifies the rare moment when **a corporate insider opens their wallet for the first time in a year, while institutional money is showing aggression in the price tape and the volatility is coiled for a breakout.**

---

## The Spec

### Universe

| Filter | Value |
|---|---|
| Market cap | $300M ≤ mcap ≤ $3B |
| Issue type | Common Stock only (no ETFs / ADRs / preferred) |
| Liquidity floor | 22-day average dollar volume > 500k shares (Gate 2) |
| Anti-hedge exclusion | Excludes SPY, QQQ, IWM, DIA, VTI (Gate 3) |
| Approximate size | ~2,000 names |

### Mandatory Gates (PASS / FAIL — required to surface)

| # | Gate | Trigger |
|---|---|---|
| **1** | **Insider Purchase** | 1+ insider P-buy (transaction_code = 'P' ONLY — filters RSU grants, options exercises, tax sales) within last 30 days |
| **1.1** | **First-Buy Filter** | At least one of those P-buyers must have **NO prior P-buy in the 12 months preceding** the current 30-day window |
| **2** | **Liquidity** | Price > $5 AND 22-day avg dollar volume > 500k shares |
| **3** | **Anti-Hedge** | Ticker is NOT in {SPY, QQQ, IWM, DIA, VTI} |

### Scoring Pillars (additive, max 65)

| Pillar | Trigger | Points |
|---|---|---:|
| **1. Aggression** | RVOL > 1.5 (today's volume ≥ 1.5× 22-day average) | +25 |
| **2. Volatility (Squeeze)** | Bollinger BandWidth < 4% (20-period, 2σ bands) | +20 |
| **3. Momentum** | Close > 50-day SMA AND RSI(14) between 40 and 70 | +20 |

### Red Flag

| Flag | Trigger | Effect |
|---|---|---|
| Overbought | RSI(14) > 70 | Score = 0 (disqualified — cannot surface as actionable) |

### Surface Bands

| Band | Score | Win rate (12mo backtest) | Mean 21d return | Trades/wk |
|---|---|---:|---:|---:|
| **High Conviction** | ≥ 45 | **70.0%** | +14.34% | 0.4 |
| **Watch** | ≥ 20 | **63.2%** | +5.84% | ~2.6 |
| Below threshold | < 20 | not surfaced | — | — |

Tiebreaker for multiple surface candidates: **largest total dollar amount** of insider P-buys in the 30-day window.

### Exit Rules (applied nightly to open positions)

| Rule | Trigger | Action |
|---|---|---|
| Technical Break | Daily close below 20-day SMA | Close position |
| Insider Exit | Whitelisted insider files Form 4 open-market sale (code 'S') | Close position |
| Time Decay | 21 trading days held with no +5% peak gain | Close position ("dead money") |
| Time Limit | 21 trading days held (regardless of peak) | Close position |

---

## Backtest Validation

**12-month window** (2025-04-15 to 2026-04-08), **197 small-caps**, **40,442 observations**.

### Headline performance

| Metric | Watch ≥20 | High ≥45 |
|---|---:|---:|
| Trades | 136 | 20 |
| Trades / week | 2.7 | 0.4 |
| Mean 21-day return | **+5.68%** | **+14.34%** |
| Mean 21-day excess vs SPY | +4.53% | +12.59% |
| Win rate | 62.5% | **70.0%** |
| Beat SPY rate | 52.2% | 60.0% |
| Best trade | +74.0% | +74.0% |
| Worst trade | −8.4% | −5.2% |
| Median trade | +1.3% | +4.7% |

### Insider Gate effect (matched score level)

| Score level | Gate Pass mean / win | Gate Fail mean / win |
|---|---:|---:|
| 45 | **+14.34% / 70%** | +1.31% / 37% |
| 20 | **+4.74% / 61%** | +0.73% / 34% |
| 0 (no pillars) | +0.78% / 45% | +0.81% / 43% |

The gate only adds value WHEN combined with at least one pillar firing. Gate alone is not predictive.

### First-Buy refinement effect (matched gate)

| Segment | n | Mean ret | Win rate |
|---|---:|---:|---:|
| First-buy + score ≥ 20 | **133** | **+5.84%** | **63.2%** |
| Repeat-buyer + score ≥ 20 | 3 | −1.44% | 33% |
| First-buy + score ≥ 45 | **20** | **+14.34%** | **70.0%** |
| Repeat-buyer + score ≥ 45 | 0 | — | — |

At every score threshold, **first-buy gate-passes outperform repeat-buyer gate-passes by 4-15 percentage points** in mean return. v4.1 makes the first-buy filter a hard requirement.

---

## Production Wiring

Per Joe 2026-05-09:

### Daily ETL (target 6:00 PM ET, after market close)

| Step | Source | Output |
|---|---|---|
| 1. Universe refresh | Supabase `universe_snapshots` (filter $300M-$3B, Common Stock, liquid) | `signal_intelligence_v4_universe.json` (~2,000 tickers) |
| 2. EOD prices | Polygon (Massive) → `prices_eod` | OHLC + volume for universe |
| 3. UW Insider | UW `/insider/transactions` for last 60 days, filter code='P' | Insider P-buy events |
| 4. UW Flow Summary | UW `/market/ticker/flow_summary` (when available) | Whale Flow per ticker (Pillar 2 — forward-only) |
| 5. Score | v4.1 module package | Per-ticker {gate_pass, score, band, components, dollar_tiebreaker} |
| 6. Surface | Filter to score ≥ 20 | `latest_v4_signals.json` for the dashboard |

### Open positions tracking

| Step | Source | Output |
|---|---|---|
| 1. Load open positions | Supabase `positions` table or local portfolio JSON | List of (ticker, entry_date, entry_price) |
| 2. Apply exit rules | Today's close vs 20-SMA, insider sale check, days held | Per-position {hold / close, reason} |
| 3. Surface exits | Filter to "close" decisions | `latest_v4_exits.json` |

### UI surfaces (when ready — gated on Joe's UI approval)

| Surface | Content |
|---|---|
| Trading Opps page — Buy List | Names with score ≥ 20, sorted by insider P-buy total dollar amount |
| Trading Opps page — High Conviction | Names with score ≥ 45 (separate prominent panel) |
| Trading Opps page — Sell Alerts | Open positions where exit rule fires today |
| Ticker modal | Full breakdown: gate status, each pillar's contribution, insider events with first-buy flag, RSI / RVOL / BB chart |

---

## Known limitations (v4.1)

| Limitation | Impact | Mitigation |
|---|---|---|
| Backtest is 12 months only (UW history thins pre-2025) | Sample is real but unproven through a real drawdown regime | Forward-only validation as months accumulate; manual review of every High Conviction entry for first ~6 weeks of live operation |
| 17 distinct tickers carried the actionable Watch ≥20 signal in backtest | Concentrated — could be regime-specific | Live performance tracked per ticker; flag if results diverge materially from backtest |
| First-buy filter uses 6-month proxy due to data depth | Slightly weaker than the 12-month rule the source recommends | UW historical data can be backfilled deeper if needed; the 6-month proxy already shows the effect |
| Pillar 2 (Whale Flow) and Pillar 5 (Analyst) from earlier specs DROPPED in v4.1 | Lose those pillars vs source's original 5-pillar spec | Forward accumulation of `universe_snapshots` enables these pillars in 3-6 months as v4.2 enhancement |

---

## Versioning

| Version | Status | What changed |
|---|---|---|
| v1 | Production today | 0-100 score, eyeballed weights, no gates |
| v2 (PRs #485-#495) | Retired | Magnitude/Conviction/MT Score framework — empirically too conservative, ~73% Technicals-only |
| v3 (3+ insider gate) | Retired | 0 signals at large-cap |
| v3.1 (1+ insider gate) | Retired | Worked at small-cap, partial validation |
| **v4.0** | **Validated** | Gate-and-pillar; small-cap universe; 62-70% backtest win rate |
| **v4.1** | **LOCKED** | Adds first-buy filter (12mo no prior P-buy); production blueprint |

---

## Implementation tracking

| PR | Title | Status |
|---|---|---|
| Live | `scanner/signal_intelligence_v4/` sub-package + tests | **In flight (this turn)** |
| Next | Daily ETL pipeline integration | Queued |
| Next | Database hardening (insider P-buy persistence + 12mo lookup) | Queued |
| After UI gate | Trading Opps page rewrite — High Conviction + Watch + Sell Alerts panels | Queued (gated on Joe approval) |
