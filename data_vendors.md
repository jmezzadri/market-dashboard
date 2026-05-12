# MacroTilt Data Vendor Ledger

Last updated: 2026-05-12. Owner: Data Steward.

This is the cost + blast-radius ledger for every external data source that feeds the live site. Eight vendors total. Run-rate as of 2026-05-12 is approximately **$209/month** ($2,508/year), down from the pre-cancellation ~$420/month after the 2026-04-22 subscription audit retired Cursor and Unusual Whales Retail Pro.

If a vendor disappears, the "Removal blast radius" line tells Joe exactly what goes blank on the site. Manifest element IDs in each section link to the corresponding entry in `data_manifest.json`.

---

## 1. FRED (Federal Reserve Economic Data, St. Louis Fed)

- **Monthly cost:** $0 (free public API)
- **License tier:** Public, requires API key (`FRED_API_KEY` in workflow secrets). Rate limit ~120 requests/minute per key — well under our actual daily pull.
- **What it powers (manifest elements):**
  - `indicator.indicator-history-fred-yahoo` — ~30 macro series (rates, spreads, claims, M2, fed balance sheet, etc.)
  - `indicator.indicator-drills` — 17 auto-computed drill panels
  - `indicator.cycle-board-snapshot` — Valuation / Credit / Funding / Growth / Liquidity & Policy / Positioning & Breadth (6-mechanism Cycle Board)
  - `indicator.methodology-calibration-v11` — per-mechanism KPIs and percentiles
  - `indicator.cycle-v2-headline-cycle-value`, `cycle-v2-headline-market-stress`, `cycle-v2-headline-real-economy`, `cycle-v2-regime-label`, `cycle-v2-history` — v2 cycle composites
  - `scenario.allocations-precompute`, `scenario.stress-daily`, `scenario.ccar-calibration`, `scenario.v9-allocation-legacy`, `scenario.v10-allocation`
- **Alternatives evaluated:** None — FRED is the canonical free source for US macro time series. Bloomberg + Haver Analytics are paid alternatives in the same data category ($24k+/year), not viable for personal-use MacroTilt.
- **Contract end date:** None (API key is perpetual; St. Louis Fed has no commercial license tier).
- **Removal blast radius:** Catastrophic. Macro Overview entirely breaks (all gauges, all mechanism scores, all drill panels). Asset Tilt breaks (allocator inputs vanish). Scenario Analysis breaks (CCAR calibration + stress framework). All 36+ Indicator tiles render em-dashes. Methodology page registry tiles go stale but page still loads.

---

## 2. Yahoo Finance (yfinance unofficial library)

- **Monthly cost:** $0 (free, no API key)
- **License tier:** Public scrape. Unofficial — Yahoo has periodically tightened access. Rate-limit-friendly with backoff.
- **What it powers (manifest elements):**
  - `indicator.indicator-history-fred-yahoo` — DX-Y.NYB (USD), HG=F (copper), GC=F (gold), BKX (banks), SPX, plus other equity tickers used in v11 inputs
  - `infra.yfinance-bootstrap` — one-shot 2003-2024 ETF history backfill (already shipped; no recurring cost)
- **Alternatives evaluated:** Polygon Massive covers EOD equity prices and could replace yfinance for non-FX/commodity series. DX-Y.NYB and the commodity futures don't have direct Massive equivalents at Basic tier — that's why yfinance stays.
- **Contract end date:** None (no contract; informal terms-of-service).
- **Removal blast radius:** Moderate. USD index, copper, gold, and bank-index inputs to the cycle board would go stale; ~5 indicators on /#indicators render last-good with a stale chip. v9/v10 allocator falls back to last-known prices for these symbols.

---

## 3. Polygon Massive

- **Monthly cost:** ~$29-79/month (Basic tier; exact tier needs verification). Capped at ~2 years of historical aggregates per the 2026-04-30 memo on Polygon Basic's 2-year cap.
- **License tier:** Paid. API key `MASSIVE_API_KEY` in workflow + edge function secrets.
- **What it powers (manifest elements):**
  - `market.prices-eod-massive` — EOD equity prices for ~12,600 US-listed tickers
  - `market.ticker-reference-massive` — name, SIC, sector, industry group metadata
  - `market.dividends-massive` — corporate actions (backfilled, no live consumer yet)
  - `market.splits-massive` — corporate actions (backfilled, no live consumer yet)
  - `market.universe-master-massive` — master universe table
  - `market.sector-perf` — sector ETF 1M/3M/TTM return + vol (producer running; consumer code path not yet shipped)
  - `portfolio.option-mark-uw` — equity leg marks for option positions (option leg comes from UW; underlying close from Massive)
  - `infra.massive-initial-backfill`, `infra.massive-v9-etf-backfill` — one-shot backfills
- **Alternatives evaluated:** Per 2026-04-30 memo: (a) stay on Yahoo Finance ($0, unofficial), (b) upgrade Polygon to a higher tier ($29-79/month for longer history), (c) hybrid bootstrap (yfinance one-shot + Massive forward refresh — what we picked).
- **Contract end date:** Unknown (month-to-month subscription).
- **Removal blast radius:** Severe. Trading Opportunities scanner table loses last close, day % change, 52-week range, company name, sector / industry group columns. Portfolio Insights equity position marks freeze. Asset Tilt loses sector performance data when that consumer ships.

---

## 4. Unusual Whales

- **Monthly cost:** ~$12.50/month ($150/year UW API tier, kept per 2026-04-22 audit). The $63/month UW Retail Pro tier ($756/year) was **cancelled** on 2026-04-22.
- **License tier:** Paid API. Key `UNUSUAL_WHALES_API_KEY` in workflow secrets. Per the 2026-05-09 insider backfill memo, the API tier does NOT honor ticker filters — bulk endpoints stream global and we filter client-side.
- **What it powers (manifest elements):**
  - `scanner.v5-scan-composite` — MT Score + Band per ticker (the trading scanner output)
  - `scanner.universe-snapshot-uw` — IV Rank, market cap, screener fields
  - `scanner.insider-history-uw` — insider transactions (UNIVERSE: $300M-$25B market cap, expanded 2026-05-09)
  - `scanner.options-flow-uw` — options flow alerts (sub-score)
  - `scanner.congress-trades-uw` — congress trades (sub-score)
  - `scanner.analyst-ratings-uw` — analyst ratings (sub-score)
  - `scanner.short-interest-finra-uw` — UW continuous estimate (blended with FINRA settlement)
  - `scanner.ticker-events-uw` — News / Insider / Congress / Dark Pool event streams for Ticker Detail modal
  - `scanner.earnings-history-uw` — earnings beats/misses for Ticker Detail
  - `scanner.legacy-user-scan-data` — legacy daily scan (back-compat only)
  - `news.ticker-events-news` — News tab feed
  - `portfolio.option-mark-uw` — option leg marks
- **Alternatives evaluated:** Bloomberg Terminal ($24k/year) and FactSet ($12k+/year) carry equivalent options-flow + insider feeds at institutional pricing. No retail-priced substitute for the combination of feeds UW bundles.
- **Contract end date:** Month-to-month.
- **Removal blast radius:** Catastrophic for Trading Opportunities. Every sub-score column (Insider / Options Flow / Congress / Analyst / Short Interest) renders em-dash. MT Score cannot be computed without sub-scores so the entire scanner table goes blank. Ticker Detail modal loses News, Insider, Congress, Dark Pool, Earnings tabs. Portfolio Insights option marks freeze. Trading Opportunities tab effectively dies.

---

## 5. Nasdaq / FINRA short-interest API

- **Monthly cost:** $0 (free public endpoint)
- **License tier:** Public. Bi-monthly settlement data (15th + end-of-month).
- **What it powers (manifest elements):**
  - `scanner.short-interest-finra-uw` — official settlement print (UW provides the between-settlement continuous estimate)
- **Alternatives evaluated:** FINRA is the source of record for short interest; everyone (UW included) ultimately re-distributes it.
- **Contract end date:** None.
- **Removal blast radius:** Limited. UW continuous estimate continues to populate the Short Interest sub-score; the FINRA settlement print is the authoritative anchor. Loss would degrade accuracy by ~5-15% but not break the column.

---

## 6. ISM (Institute for Supply Management — via investing.com scrape)

- **Monthly cost:** $0 (scraped from investing.com; ISM's direct subscription is $1,895/year and not used)
- **License tier:** Free via scrape. License restriction is why FRED does not carry ISM series — we scrape rather than pay ISM directly.
- **What it powers (manifest elements):**
  - `indicator.ism-mfg` — ISM Manufacturing PMI
  - `indicator.ism-svc` — ISM Services PMI
- **Alternatives evaluated:** Direct ISM subscription ($1,895/year — not justified for personal-use site). FRED licenses only a small ISM subset (employment/prices sub-indices) and not the headline PMI.
- **Contract end date:** None (scrape, not contract).
- **Removal blast radius:** Moderate. Macro Overview Real Economy headline loses its primary input — the cycle-v2 real-economy gauge would fall back to claims + payrolls only, degrading signal quality. Scenario Analysis Cycle Mechanism Results table loses ISM-conditional scenarios.

---

## 7. State Street SPDR (SPY holdings file)

- **Monthly cost:** $0 (free public holdings file)
- **License tier:** Public — daily holdings disclosure required for ETFs.
- **What it powers (manifest elements):**
  - `market.spy-sector-weights` — SPY GICS sector weights (benchmark for Asset Tilt OW/UW deltas)
- **Alternatives evaluated:** S&P 500 GICS weights direct from S&P (paid). Vanguard VOO holdings (different fund, similar weights). Either could substitute.
- **Contract end date:** None.
- **Removal blast radius:** Limited. Asset Tilt sector deltas freeze at prior day's benchmark weights — sector pills could be off by ~30bps until refresh. No data goes blank.

---

## 8. GitHub `unitedstates/congress-legislators` (CC0)

- **Monthly cost:** $0 (CC0 public domain)
- **License tier:** Public, CC0 license.
- **What it powers (manifest elements):**
  - `scanner.congress-roster` — names / party / state of US senators and reps (member-ID lookup in Ticker Detail Congress tab)
- **Alternatives evaluated:** ProPublica Congress API (free, requires key). Senate.gov + House.gov scrape (more brittle).
- **Contract end date:** None.
- **Removal blast radius:** Trivial. New members of Congress would show as raw IDs in the Ticker Detail Congress tab until next monthly refresh; existing members are already cached in `src/data/congress_roster.json`.

---

## 9. ZeroHedge Premium

- **Monthly cost:** ~$30/month (per 2026-04-22 subscription audit memo)
- **License tier:** Paid subscription, cookie-based access (no API). Weekly canary checks the cookie's health.
- **What it powers (manifest elements):**
  - `commentary.zerohedge-premium` — premium news fetches in Ticker Detail commentary
- **Alternatives evaluated:** Free ZeroHedge tier (paywalls premium articles); other paid commentary feeds (Doomberg ~$20/month, others) — none currently wired.
- **Contract end date:** Month-to-month.
- **Removal blast radius:** Trivial. Ticker Detail commentary section loses ZH-sourced articles; UW news feed still populates the News tab.

---

## Monthly run-rate summary

| Vendor | Monthly cost | Status |
|---|---|---|
| FRED | $0 | Active |
| Yahoo Finance | $0 | Active |
| Polygon Massive | ~$29-79 (Basic tier — exact tier unverified) | Active |
| Unusual Whales API | ~$12.50 ($150/year) | Active |
| Unusual Whales Retail Pro | $0 (cancelled 2026-04-22) | Cancelled |
| Nasdaq/FINRA | $0 | Active |
| ISM scrape | $0 | Active |
| State Street SPDR | $0 | Active |
| GitHub unitedstates | $0 | Active |
| ZeroHedge Premium | ~$30 | Active |
| **Total active run-rate** | **~$71-121/month** | (~$852-1,452/year) |

Plus Anthropic API at ~$125/month per Joe's auto-memory (separate line — used for site infra, not a data vendor). Including Anthropic, true MacroTilt data + infra run-rate is approximately **~$196-246/month** (~$2,352-2,952/year), comfortably under the $5,052 pre-audit baseline.

Two open verification items: (1) confirm exact Polygon Massive tier price, (2) confirm ZeroHedge monthly cost — both currently estimated from the 2026-04-22 audit memo.
