# MacroTilt Data Vendor Ledger

Last updated: 2026-06-16. Owner: Data Steward.

This is the cost + blast-radius ledger for every external data source AND paid infrastructure service that feeds the live site. Run-rate as of 2026-07-20 (verified against receipts in the 2026-07-08 cost sweep, which found this file understating true cost): approximately **$275/month (~$3,300/year) excluding the Claude subscription**; ~$525/month (~$6,300/year) including it. Prior versions of this file listed Unusual Whales at $150/YEAR — the receipt says **$150/MONTH** — and omitted Supabase and Vercel entirely.

**2026-07-20 CUTOVER EXECUTED — insiders now run on SEC EDGAR.** The scanner, universe gate and Ticker-page insider evidence read `insider_history_edgar` in production. The UW insider ingest runs as a parity-monitor comparison only until the subscription lapses 2026-08-12, then all UW pipelines retire.

**2026-07-20 update — Unusual Whales replacement in flight.** UW renews 2026-08-13 (paid through 08-12) and is being replaced, not just cancelled: a free SEC EDGAR Form 4 ingest (`scanner-insider_edgar-daily.yml` -> `insider_history_edgar`) is live in shadow, with a full reconciliation + scanner-score parity gate (Senior Quant) required before cutover. Killing UW takes the run-rate down ~$1,800/yr.

**2026-05-27 update — Treasury.gov added.** Daily Treasury par yields and TIPS real yields were migrated from FRED to Treasury.gov (the upstream publisher) for same-day publication. FRED publishes these series ~20:00 UTC, after our morning workflow; Treasury.gov posts the same data ~16:00 ET, captured by our afternoon workflow. Three indicators moved: `yield_curve` (10Y-2Y slope), `real_rates` (10Y TIPS), and `breakeven_10y` (computed). FRED stays primary for the rest of the macro series.

**2026-06-16 update — deep-history backfill + two free uranium sources registered.** The Asset Tilt rebuild's backtest needs multi-regime depth, so several short feeds were deepened in place: commodity levels (oil, brent, copper, gold, silver, natural gas, corn, wheat, soybeans) and FX crosses (euro, yen, pound) now carry full daily history (~20-26 years, back to ~2000-2003; yen to 1996) pulled from Yahoo and merge-preserved so daily runs never truncate. Index breadth (% of S&P 500 / Nasdaq-100 members above their 50- and 200-day averages) was recomputed from the deepened price store back to 2011 (S&P) / 2016 (Nasdaq) — as far back as today's membership had enough trading history under the representativeness filter. Uranium gained ~25 years of monthly spot history from **IndexMundi** behind its daily live value. **One vendor limit found:** the investment-grade credit spread (ICE BofA US Corporate OAS, series `ig_oas`) is only available with ~3 years of history on FRED — ICE restricts redistribution of the deep series. The displayed indicator stays at that real depth (its chip is green; the data is current, just short-history); the backtest's credit/financial-conditions factor uses the deep Chicago Fed financial-conditions index and the high-yield spread instead, not a fabricated deep IG series.

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
  - `scenario.v9-allocation-legacy`, `scenario.v10-allocation`
- **Alternatives evaluated:** None — FRED is the canonical free source for US macro time series. Bloomberg + Haver Analytics are paid alternatives in the same data category ($24k+/year), not viable for personal-use MacroTilt.
- **Contract end date:** None (API key is perpetual; St. Louis Fed has no commercial license tier).
- **Removal blast radius:** Catastrophic. Macro Overview entirely breaks (all gauges, all mechanism scores, all drill panels). Asset Tilt breaks (allocator inputs vanish). All 36+ Indicator tiles render em-dashes. Methodology page registry tiles go stale but page still loads.

---

## 2. U.S. Treasury (home.treasury.gov daily yield curve CSVs)

- **Monthly cost:** $0 (free public CSV feed)
- **License tier:** Public, no key required, no rate-limit posted. The feed is the Treasury Department's own publication — FRED and every commercial vendor downstream of these series pull from this same CSV.
- **What it powers (manifest elements):**
  - `indicator-yield_curve-daily` — 10Y nominal − 2Y nominal, in bps (recession early-warning gauge)
  - `indicator-real_rates-daily` — 10Y TIPS real yield, in %
  - `indicator-breakeven_10y-daily` — 10Y nominal − 10Y TIPS, in % (market-implied inflation expectation; computed in-house from the two feeds above)
- **Alternatives evaluated:** FRED (republishes these series as T10Y2Y, DFII10, T10YIE) — declined on 2026-05-27 because FRED publishes them with an afternoon delay (DFII10 ~20:00 UTC) that left the cards stale into the next morning. Bloomberg / Reuters carry the same data on paid terminals — not viable for personal-use MacroTilt.
- **Contract end date:** None (perpetual public CSV).
- **Removal blast radius:** Moderate. Three indicator cards on /#indicators go stale, the rates pillar on the Cycle Mechanism Board loses two of its inputs, and the 10Y Breakeven card has no replacement (it depends on having both feeds same-day). FRED republishes the same series with a publication lag, so a fallback to FRED is one-line revert; we just gain back the lag.

---

## 3. Yahoo Finance (yfinance unofficial library)

- **Monthly cost:** $0 (free, no API key)
- **License tier:** Public scrape. Unofficial — Yahoo has periodically tightened access. Rate-limit-friendly with backoff.
- **What it powers (manifest elements):**
  - `indicator.indicator-history-fred-yahoo` — DX-Y.NYB (USD), HG=F (copper), GC=F (gold), BKX (banks), SPX, plus other equity tickers used in v11 inputs
  - `infra.yfinance-bootstrap` — one-shot 2003-2024 ETF history backfill (already shipped; no recurring cost)
  - `eod-backfill-history` edge function (2026-07-27) — on-demand deep-history backfill of `prices_eod` for viewed tickers whose series is shallower than ~4.7 years (the bulk universe only carried ~18 months from the capped Polygon backfill). Yahoo daily bars from the 1996 floor, current split basis, 1%-tolerance seam check on overlapping sessions before any write, older rows only, `source='yahoo-backfill'`. One vendor call per ticker ever (no-op once deep).
- **Alternatives evaluated:** Polygon Massive covers EOD equity prices and could replace yfinance for non-FX/commodity series. DX-Y.NYB and the commodity futures don't have direct Massive equivalents at Basic tier — that's why yfinance stays.
- **Contract end date:** None (no contract; informal terms-of-service).
- **Removal blast radius:** Moderate. USD index, copper, gold, and bank-index inputs to the cycle board would go stale; ~5 indicators on /#indicators render last-good with a stale chip. v9/v10 allocator falls back to last-known prices for these symbols.

---

## 4. Polygon Massive

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

## 5. Unusual Whales

- **Monthly cost:** **$150/month ($1,800/year)** — verified from the 2026-04-13 signup receipt ('month, $150.00'). (This line previously said $150/YEAR — wrong by 12x.) Renews 2026-08-13; paid through 2026-08-12; being replaced by SEC EDGAR before the lapse. The $63/month UW Retail Pro tier ($756/year) was **cancelled** on 2026-04-22. The Phase 1 dark-pool and per-contract options feeds added 2026-05-20 for the rebuilt Trading Opportunities screener are exposed on this same $150/year API tier — no upgrade cost (verified per Decision 2 of the Trading Opportunities overhaul).
- **License tier:** Paid API. Key `UNUSUAL_WHALES_API_KEY` in workflow secrets. Per the 2026-05-09 insider backfill memo, the API tier does NOT honor ticker filters — bulk endpoints stream global and we filter client-side.
- **What it powers (manifest elements):**
  - `scanner.v5-scan-composite` — MT Score + Band per ticker (the trading scanner output)
  - `scanner.universe-snapshot-uw` — IV Rank, market cap, screener fields
  - `scanner.insider-history-uw` — insider transactions (UNIVERSE: $300M-$25B market cap, expanded 2026-05-09)
  - `scanner.options-flow-uw` — options flow alerts; ingested but NOT surfaced (removed from the scanner table 2026-07-08)
  - `scanner.congress-trades-uw` — congress trades (sub-score)
  - `scanner.analyst-ratings-uw` — analyst ratings (sub-score)
  - `scanner.short-interest-finra-uw` — UW continuous estimate (blended with FINRA settlement)
  - `scanner.ticker-events-uw` — News / Insider / Congress / Dark Pool event streams for Ticker Detail modal
  - `scanner.darkpool-prints-uw` — dark-pool block prints; ingested but NOT surfaced (removed from the scanner table + score 2026-07-08); retained for future validation
  - `scanner.options-eod-uw` — per-contract end-of-day options; ingested but NOT surfaced (removed from the scanner table + score 2026-07-08); retained for future validation
  - `scanner.earnings-history-uw` — earnings beats/misses for Ticker Detail
  - `scanner.legacy-user-scan-data` — legacy daily scan (back-compat only)
  - `news.ticker-events-news` — News tab feed
  - `portfolio.option-mark-uw` — option leg marks
- **Alternatives evaluated:** Bloomberg Terminal ($24k/year) and FactSet ($12k+/year) carry equivalent options-flow + insider feeds at institutional pricing. No retail-priced substitute for the combination of feeds UW bundles.
- **Contract end date:** Month-to-month.
- **Removal blast radius:** Catastrophic for Trading Opportunities. The MacroTilt Score (now Insider + Technicals) loses its Insider input, so the Score + Band columns go blank and the paper portfolio has nothing to buy. Insider / Congress / Analyst / Short-Interest / Options-Flow / Dark-Pool columns render em-dash. Ticker Detail modal loses News, Insider, Congress, Dark Pool, Earnings tabs. Portfolio Insights option marks freeze. Trading Opportunities tab effectively dies.

---

## 6. Nasdaq / FINRA short-interest API

- **Monthly cost:** $0 (free public endpoint)
- **License tier:** Public. Bi-monthly settlement data (15th + end-of-month).
- **What it powers (manifest elements):**
  - `scanner.short-interest-finra-uw` — official settlement print (UW provides the between-settlement continuous estimate)
- **Alternatives evaluated:** FINRA is the source of record for short interest; everyone (UW included) ultimately re-distributes it.
- **Contract end date:** None.
- **Removal blast radius:** Limited. UW continuous estimate continues to populate the Short Interest sub-score; the FINRA settlement print is the authoritative anchor. Loss would degrade accuracy by ~5-15% but not break the column.

---

## 7. ISM (Institute for Supply Management — via investing.com scrape)

- **Monthly cost:** $0 (scraped from investing.com; ISM's direct subscription is $1,895/year and not used)
- **License tier:** Free via scrape. License restriction is why FRED does not carry ISM series — we scrape rather than pay ISM directly.
- **What it powers (manifest elements):**
  - `indicator.ism-mfg` — ISM Manufacturing PMI
  - `indicator.ism-svc` — ISM Services PMI
- **Alternatives evaluated:** Direct ISM subscription ($1,895/year — not justified for personal-use site). FRED licenses only a small ISM subset (employment/prices sub-indices) and not the headline PMI.
- **Contract end date:** None (scrape, not contract).
- **Removal blast radius:** Moderate. Macro Overview Real Economy headline loses its primary input — the cycle-v2 real-economy gauge would fall back to claims + payrolls only, degrading signal quality.

---

## 8. State Street SPDR (SPY holdings file)

- **Monthly cost:** $0 (free public holdings file)
- **License tier:** Public — daily holdings disclosure required for ETFs.
- **What it powers (manifest elements):**
  - `market.spy-sector-weights` — SPY GICS sector weights (benchmark for Asset Tilt OW/UW deltas)
- **Alternatives evaluated:** S&P 500 GICS weights direct from S&P (paid). Vanguard VOO holdings (different fund, similar weights). Either could substitute.
- **Contract end date:** None.
- **Removal blast radius:** Limited. Asset Tilt sector deltas freeze at prior day's benchmark weights — sector pills could be off by ~30bps until refresh. No data goes blank.

---

## 9. GitHub `unitedstates/congress-legislators` (CC0)

- **Monthly cost:** $0 (CC0 public domain)
- **License tier:** Public, CC0 license.
- **What it powers (manifest elements):**
  - `scanner.congress-roster` — names / party / state of US senators and reps (member-ID lookup in Ticker Detail Congress tab)
- **Alternatives evaluated:** ProPublica Congress API (free, requires key). Senate.gov + House.gov scrape (more brittle).
- **Contract end date:** None.
- **Removal blast radius:** Trivial. New members of Congress would show as raw IDs in the Ticker Detail Congress tab until next monthly refresh; existing members are already cached in `src/data/congress_roster.json`.

---

## 10. ZeroHedge Premium

- **Monthly cost:** ~$30/month (per 2026-04-22 subscription audit memo)
- **License tier:** Paid subscription, cookie-based access (no API). Weekly canary checks the cookie's health.
- **What it powers (manifest elements):**
  - `commentary.zerohedge-premium` — premium news fetches in Ticker Detail commentary
- **Alternatives evaluated:** Free ZeroHedge tier (paywalls premium articles); other paid commentary feeds (Doomberg ~$20/month, others) — none currently wired.
- **Contract end date:** Month-to-month.
- **Removal blast radius:** Trivial. Ticker Detail commentary section loses ZH-sourced articles; UW news feed still populates the News tab.

---

## 11. Numerco / Yellow Cake plc (spot uranium U3O8)

- **Monthly cost:** $0 (free public endpoint).
- **License tier:** Public JSON endpoint (`yellowcakeplc.com`), no key. Single live spot value, updated daily.
- **What it powers (manifest elements):** `indicator-cmdty_uranium-daily` — the daily live uranium spot price on the Macro Overview Commodities tile, All Indicators, and Methodology.
- **Alternatives evaluated:** UxC and TradeTech publish the benchmark spot but behind paywalls; Numerco's public value is the only free daily spot.
- **Contract end date:** None (informal public endpoint).
- **Removal blast radius:** Minor. The Uranium tile's live value goes stale; the ~25-year monthly history (IndexMundi, below) still renders.

---

## 12. IndexMundi (uranium monthly history — one-time seed)

- **Monthly cost:** $0 (free public site).
- **License tier:** Public. Used once to seed ~25 years of monthly U3O8 spot history behind the daily live value; not a recurring pull.
- **What it powers (manifest elements):** the historical portion of `indicator-cmdty_uranium-daily` (monthly points 1996-2026).
- **Alternatives evaluated:** None free with comparable monthly depth.
- **Contract end date:** None.
- **Removal blast radius:** None ongoing (one-time backfill; the seeded history is stored).

---

## 13. TradingView (embedded Advanced Chart widget)

- **Monthly cost:** $0 (free public embed; no API key, no account, nothing installed by the user)
- **License tier:** Public external-embedding widget served from `s3.tradingview.com` / `tradingview-widget.com`. Rendered entirely client-side in an iframe.
- **What it powers (manifest elements):**
  - `equity.equity-tradingview_chart-on_demand` — the optional "TradingView" toggle on the Ticker Detail price chart (candlesticks, intraday timeframes, 100+ indicators, drawing tools).
- **Alternatives evaluated:** Build our own intraday/candlestick/drawing-tools charting (large effort, no edge) vs. the free official embed (chosen). Our own `BigHistoryChart` stays the default and the system of record; TradingView is a convenience layer the user opts into.
- **Contract end date:** None (free embed; no contract).
- **Removal blast radius:** Minimal. If TradingView is removed or unreachable, the toggle's chart area is blank; the default MacroTilt chart and every score/overlay are unaffected. No stored data depends on it.

---

## 13. SEC EDGAR (free — Unusual Whales insider replacement)

- **Monthly cost:** $0 (public SEC data; descriptive User-Agent required, ~8 req/s ceiling observed)
- **What it powers (manifest elements):** `scanner.insider-history-edgar` — Form 4/4A/5/5A ownership filings -> `insider_history_edgar` (shadow until cutover; becomes the scanner's insider input when the parity gate passes)
- **Alternatives evaluated:** Unusual Whales (being retired, $1,800/yr); institutional feeds at $12k+/yr. EDGAR is the primary source both re-distribute.
- **Contract end date:** None (public data).
- **Removal blast radius (post-cutover):** same as the UW insider element it replaces — Insider sub-score, 'Insider buys' chip, Ticker Detail Insider tab.

---

## 14. London Strategic Edge (free tier — live prices + options implied vol)

- **Monthly cost:** $0 (free tier on Joe's signup; key in Supabase Vault).
- **License tier:** Free API key. Verified plan limits (2026-07-27, live probe of the usage endpoint): 200 calls/minute, 2 concurrent vault reads, 50 GB/month data allowance (~13 MB used at integration time). No licensing/provenance story published — **continuity is the known risk**; the shadow-trial monitor (below) is the mitigation.
- **What it powers (manifest elements):**
  - `market.lse-intraday-live` — live 1-minute-bar prices, display only: Paper Portfolio positions "Live price" column + Ticker page "Live" line. Shared 45 s server cache (`lse_live_quotes`) via the `lse-live` edge function; engines stay on `prices_eod` + broker fills.
  - `options.lse-atm-iv-ondemand` — ATM implied-vol term structure for the Portfolio Lab's Implied vol method (`lse_iv_term` cache).
  - `equity.lse-iv-scan-daily` — ~30-day ATM IV + cross-sectional volatility rank for scanner names (`lse_iv_daily`, pg_cron 17:50 ET weekdays).
  - `options.lse-archive-iv-daily` — previous-close ATM IV term structure for names the LIVE options endpoint skips, derived nightly from the vendor's options-prints research archive (`/vault/export`, ~3,200 optionable names back to 2014; sized in the 2026-07-28 skew-density study: KTOS/RCAT/HUT ≈93–100% of days, PLSE ≈46%). GitHub Actions `LSE-ARCHIVE-IV` 22:30 ET Mon–Fri → `lse_iv_term` rows tagged `source=archive` with a data date; the Lab labels them "as of <date> close". Live coverage always wins; archive exports are capped at 5/hour account-wide (job uses ≤4/night, a few hundred KB each).
- **Coverage (verified 2026-07-27):** prices ~4,000 US stocks + major ETFs — Portfolio Lab test names 7/7, Paper book 32/33, benchmarks 4/4; options universe is much thinner (actively-traded names only — 3 of 22 names on the 2026-07-24 scan list had chains). Uncovered names render an em-dash everywhere, never a substituted value. Joe accepted these gaps 2026-07-27.
- **Data quirks (from the shadow trial + build, binding on any new consumer):** daily candles are midnight-UTC days including after-hours — the official close is the 20:00Z (EDT) 1m bar's OPEN; default row order is oldest-first (always pass order=desc); per-contract `underlying_price` and `dte` are stamped at that contract's own last update and can be days/weeks stale (anchor ATM to the freshest contract; compute days-to-expiry locally); options chains include long-expired contracts.
- **Quality vs. official tape:** Friday-close parity on SPY/DIA exact to the penny, QQQ −0.6 bps, IWM +1.4 bps (auction print vs last trade); 1m bars ~10 s behind; IV internally consistent vs Black-Scholes cross-check.
- **Alternatives evaluated:** Unusual Whales (paid, $150/mo — lapses 2026-08-12, the reason this feed exists); Polygon options Starter (~$29/mo — Joe declined 2026-07-27, "augment at $0"); Massive paid tiers (Joe declined — do not re-pitch).
- **Contract end date:** None (free key). Health monitored continuously: the shadow-trial loggers (`lse-shadow-pull`, every 30 min market hours + daily close parity) stay live, and the Aug 10 automated health report reviews the feed before the UW lapse.
- **Removal blast radius:** Cosmetic-to-moderate, engines untouched. Paper "Live price" column and Ticker "Live" line go em-dash; Portfolio Lab's Implied vol method falls back to CAPM + historical volatility for every name; Scanner "Vol rank" column goes em-dash with a red chip. No trade, score, or allocation changes anywhere — the feed is display/analytics only by design.

---

## Infrastructure (not data vendors, but real monthly cost — previously missing from this file)

- **Supabase Pro — $25/month.** The database behind the entire site (2.5 GB; 5x over the 500 MB free cap — cannot downgrade). Settled decision 2026-07: stays.
- **Vercel Pro — $20/month.** Hosting + build pipeline for macrotilt.com. Settled decision 2026-07: stays ($20/mo is cheap insurance vs Hobby's commercial-use restrictions).
- **Porkbun — ~$12/year.** The macrotilt.com domain.
- **Anthropic API — de minimis.** Pay-as-you-go key for the daily market-brief writer.

---

## Monthly run-rate summary

| Vendor | Monthly cost | Status |
|---|---|---|
| FRED | $0 | Active |
| Yahoo Finance | $0 | Active |
| Polygon Massive | ~$29-79 (Basic tier — exact tier unverified) | Active |
| Unusual Whales API | $150 (renews 8/13 — replacement in flight) | Active until 2026-08-12 |
| Unusual Whales Retail Pro | $0 (cancelled 2026-04-22) | Cancelled |
| Nasdaq/FINRA | $0 | Active |
| ISM scrape | $0 | Active |
| State Street SPDR | $0 | Active |
| GitHub unitedstates | $0 | Active |
| ZeroHedge Premium | ~$30 | Active |
| Numerco / Yellow Cake (uranium spot) | $0 | Active |
| IndexMundi (uranium history) | $0 | One-time seed |
| TradingView (embedded chart) | $0 | Active |
| SEC EDGAR (Form 4 insider) | $0 | Shadow (cutover pending parity gate) |
| Supabase Pro (database) | $25 | Active — infrastructure |
| Vercel Pro (hosting) | $20 | Active — infrastructure |
| Porkbun (domain) | ~$1 | Active — infrastructure |
| Anthropic API (brief writer) | ~$0 (de minimis) | Active — infrastructure |
| **Total active run-rate** | **~$71-121/month** | (~$852-1,452/year) |

Plus Anthropic API at ~$125/month per Joe's auto-memory (separate line — used for site infra, not a data vendor). Including Anthropic, true MacroTilt data + infra run-rate is approximately **~$196-246/month** (~$2,352-2,952/year), comfortably under the $5,052 pre-audit baseline.

Two open verification items: (1) confirm exact Polygon Massive tier price, (2) confirm ZeroHedge monthly cost — both currently estimated from the 2026-04-22 audit memo.
