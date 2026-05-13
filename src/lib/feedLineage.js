// feedLineage.js — source-to-target lineage for every admin-visible feed.
//
// Maps pipeline_health.indicator_id (short snake-case keys like "massive-eod",
// "vix", "uw-universe-snapshots") to the rich manifest entry in
// /public/data_manifest.json (dotted keys like "market.prices-eod-massive"),
// plus per-feed plain-English copy that data_manifest.json does not yet
// carry — specifically:
//
//   • ingestion mechanism — REST API call vs web scrape vs computed in-house
//     vs file download vs manual upload. data_manifest's `sourcing_mode`
//     only distinguishes "stp / derived / computed"; Joe's question is
//     more granular (is this an API or a scrape?), so we encode the
//     mechanism here from per-vendor knowledge.
//
//   • data_fields — the columns / fields this feed produces. The
//     manifest carries `target_storage` ("Supabase: prices_eod") but no
//     column list. For the highest-value feeds (Polygon Massive
//     reference data, UW universe snapshots) we hand-curate the columns
//     so the drawer can answer "where does company name come from."
//
// What is NOT here, by design:
//   • a row-level lineage for every one of the 50+ feeds. Curated
//     entries cover Polygon Massive (~5), UW (~3), and the highest-
//     traffic FRED / Yahoo / computed feeds. Everything else falls
//     back to manifest data. Expand this file as feeds get attention.

// ─── pipeline_health.indicator_id → manifest element key ───────────────────
// When pipeline_health uses one indicator_id for a pull that lands in multiple
// manifest elements (e.g. corporate-actions → dividends + splits), the value
// is an array — the drawer renders one section per matched element.
export const PIPELINE_TO_MANIFEST = {
  // Polygon Massive feeds
  "massive-eod":                "market.prices-eod-massive",
  "massive-ticker-details":     "market.ticker-reference-massive",
  "massive-universe":           "market.universe-master-massive",
  "massive-corporate-actions":  ["market.dividends-massive", "market.splits-massive"],

  // Polygon-derived
  "sector_perf":                "market.sector-perf",

  // Unusual Whales feeds (live pulls)
  "uw-universe-snapshots":      "scanner.universe-snapshot-uw",

  // Computed in-house composite scorers
  "scanner-v5-daily":           "scanner.v5-scan-composite",
  "latest_scan":                "scanner.v5-scan-composite",
  "latest_scan_data":           "scanner.legacy-user-scan-data",
  "v10_allocation":             "scenario.v10-allocation",
  "cycle_board":                "indicator.cycle-board-snapshot",
  "cycle_mechanism_board":      "indicator.cycle-board-snapshot",
  "composite_history":          "indicator.cycle-board-snapshot",
  "methodology_calibration_v11":"indicator.methodology-calibration-v11",
  "scenarios":                  "scenario.allocations-precompute",
  "scenario_stress":            "scenario.stress-daily",
  "portfolio_history":          "portfolio.nav-chart",

  // ISM (manual / FRED-style read)
  "ism":                        "indicator.ism-mfg",

  // Macro indicators (FRED + Yahoo) — all roll up under the unified
  // indicator-history pipeline that fetch_history.py runs each morning.
  "vix":                        "indicator.indicator-history-fred-yahoo",
  "real_rates":                 "indicator.indicator-history-fred-yahoo",
  "breakeven_10y":              "indicator.indicator-history-fred-yahoo",
  "cape":                       "indicator.indicator-history-fred-yahoo",
  "cfnai":                      "indicator.indicator-history-fred-yahoo",
  "cfnai_3ma":                  "indicator.indicator-history-fred-yahoo",
  "cmdi":                       "indicator.indicator-history-fred-yahoo",
  "copper_gold":                "indicator.indicator-history-fred-yahoo",
  "cpff":                       "indicator.indicator-history-fred-yahoo",
  "credit_3y":                  "indicator.indicator-history-fred-yahoo",
  "fed_bs":                     "indicator.indicator-history-fred-yahoo",
  "hy_ig":                      "indicator.indicator-history-fred-yahoo",
  "hy_ig_etf":                  "indicator.indicator-history-fred-yahoo",
  "jobless":                    "indicator.indicator-history-fred-yahoo",
  "jolts_quits":                "indicator.indicator-history-fred-yahoo",
  "m2_yoy":                     "indicator.indicator-history-fred-yahoo",
  "move":                       "indicator.indicator-history-fred-yahoo",
  "rrp":                        "indicator.indicator-history-fred-yahoo",
  "skew":                       "indicator.indicator-history-fred-yahoo",
  "sloos_ci":                   "indicator.indicator-history-fred-yahoo",
  "sloos_cre":                  "indicator.indicator-history-fred-yahoo",
  "stlfsi":                     "indicator.indicator-history-fred-yahoo",
  "term_premium":               "indicator.indicator-history-fred-yahoo",
  "tga":                        "indicator.indicator-history-fred-yahoo",
  "usd":                        "indicator.indicator-history-fred-yahoo",
  "yield_curve":                "indicator.indicator-history-fred-yahoo",
  "bkx_spx":                    "indicator.indicator-history-fred-yahoo",
  "loan_syn":                   "indicator.indicator-history-fred-yahoo",
  "anfci":                      "indicator.indicator-history-fred-yahoo",
  "bank_credit":                "indicator.indicator-history-fred-yahoo",
  "bank_reserves":              "indicator.indicator-history-fred-yahoo",
  "bank_unreal":                "indicator.indicator-history-fred-yahoo",
  "eq_cr_corr":                 "indicator.indicator-history-fred-yahoo",
  "indicator_history":          "indicator.indicator-history-fred-yahoo",
};

// ─── Curated per-feed details ───────────────────────────────────────────────
// For feeds where we want the drawer to be richer than the manifest alone:
//   • ingestion — plain-English description of HOW the data arrives (API call,
//                 scrape, computed locally, etc.)
//   • api_endpoint — concrete URL if it's an API pull (helps Joe trace it)
//   • data_fields — the columns this feed actually writes. Drawer renders
//                   them as a small table so the "where does company name
//                   come from" question is answerable.
//   • where_used — overrides manifest's consumer_surfaces when we have
//                  better copy.
export const FEED_DETAILS = {
  "massive-eod": {
    ingestion: "REST API call to Polygon Massive — pulls every US-listed ticker's daily OHLCV in a single grouped-aggregates request, then upserts into Supabase.",
    api_endpoint: "https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/{date}",
    triggered_by: "Scheduled GitHub Action: MASSIVE-DAILY.yml (18:00 ET primary + 20:00 ET + 23:00 ET backups)",
    data_fields: [
      { name: "ticker",     example: "AAPL",         note: "Polygon symbol — joins to ticker_reference" },
      { name: "date",       example: "2026-05-12",   note: "Trading day (T+1 publish)" },
      { name: "open",       example: "187.51",       note: "Day open" },
      { name: "high",       example: "189.24",       note: "Day high" },
      { name: "low",        example: "186.10",       note: "Day low" },
      { name: "close",      example: "188.66",       note: "Day close — the price most pages display" },
      { name: "volume",     example: "55,234,100",   note: "Day volume" },
      { name: "vwap",       example: "188.02",       note: "Volume-weighted average price" },
    ],
  },

  "massive-ticker-details": {
    ingestion: "REST API call to Polygon Massive — iterates the universe, calls the ticker-details endpoint per symbol, upserts the reference row.",
    api_endpoint: "https://api.polygon.io/v3/reference/tickers/{ticker}",
    triggered_by: "Scheduled GitHub Action: MASSIVE-TICKER-REFERENCE-BACKFILL.yml (every 4 hours: 00:30 / 04:30 / 08:30 / 12:30 / 16:30 / 20:30 ET)",
    data_fields: [
      { name: "ticker",            example: "AAPL",                 note: "Primary key" },
      { name: "name",              example: "Apple Inc.",           note: "The 'company name' Joe sees on the screener" },
      { name: "sic_code",          example: "3571",                 note: "Standard Industrial Classification — broad industry bucket" },
      { name: "sic_description",   example: "Electronic Computers", note: "Plain-English SIC label" },
      { name: "primary_exchange",  example: "XNAS",                 note: "Listing exchange (XNAS=Nasdaq, XNYS=NYSE)" },
      { name: "type",              example: "CS",                   note: "Security type (CS=common stock, ETF=exchange-traded fund)" },
      { name: "market_cap",        example: "2,950,000,000,000",    note: "Market capitalisation in USD" },
      { name: "share_class_shares_outstanding", example: "15.4B",   note: "Shares outstanding (for the listed class)" },
      { name: "sector",            example: "Information Technology", note: "GICS-aligned sector label" },
      { name: "industry_group",    example: "Technology Hardware",  note: "GICS-aligned industry group" },
      { name: "homepage_url",      example: "https://apple.com",    note: "Company website (Polygon-provided)" },
      { name: "list_date",         example: "1980-12-12",           note: "Original IPO / listing date" },
    ],
  },

  "massive-universe": {
    ingestion: "REST API call to Polygon Massive — pulls the full active US-listed universe (~12,600 symbols) and writes the master roster.",
    api_endpoint: "https://api.polygon.io/v3/reference/tickers (paginated)",
    triggered_by: "Manual / one-shot — re-run only on a cold start of new tables.",
    data_fields: [
      { name: "ticker",      example: "AAPL",  note: "Universe key" },
      { name: "active",      example: "true",  note: "Whether the symbol is currently tradable" },
      { name: "market_type", example: "stocks", note: "Polygon market segment" },
      { name: "locale",      example: "us",    note: "Country" },
    ],
  },

  "massive-corporate-actions": {
    ingestion: "Two REST API calls to Polygon Massive — dividends history (cash payments by ex-date) and splits history (split ratios by execution date).",
    api_endpoint: "https://api.polygon.io/v3/reference/dividends + /v3/reference/splits",
    triggered_by: "Manual / one-shot — re-run when re-loading corporate-actions history.",
    data_fields: [
      { name: "[dividends] ticker",      example: "AAPL",      note: "Symbol" },
      { name: "[dividends] ex_date",     example: "2026-02-09", note: "Ex-dividend date" },
      { name: "[dividends] cash_amount", example: "0.24",       note: "Cash dividend per share, USD" },
      { name: "[dividends] frequency",   example: "4",          note: "Payments per year (4=quarterly)" },
      { name: "[splits] execution_date", example: "2020-08-31", note: "Split effective date" },
      { name: "[splits] split_from",     example: "1",          note: "Old share count" },
      { name: "[splits] split_to",       example: "4",          note: "New share count (1→4 = 4-for-1 split)" },
    ],
  },

  "uw-universe-snapshots": {
    ingestion: "REST API call to Unusual Whales's screener endpoint — pulls the full tradable universe with intraday-marked price + market-cap + day-change snapshot.",
    api_endpoint: "https://api.unusualwhales.com/api/screener/stocks",
    triggered_by: "Scheduled GitHub Action: UNIVERSE_SNAPSHOT_3X_WEEKDAYS.yml (3x per weekday: ~09:30 / 13:00 / 16:30 ET).",
    data_fields: [
      { name: "ticker",         example: "AAPL",  note: "Symbol" },
      { name: "last_close",     example: "188.66", note: "UW's marked last price" },
      { name: "day_change_pct", example: "1.24",   note: "Day percent change" },
      { name: "market_cap",     example: "2.95T",  note: "Market cap in shorthand" },
      { name: "sector",         example: "Tech",   note: "UW's sector label (slightly different from Polygon's GICS)" },
      { name: "volume",         example: "55M",    note: "Day volume" },
    ],
  },

  "scanner-v5-daily": {
    ingestion: "Computed in-house — runs the v5 composite scorer over the joined UW screener + Polygon EOD + insider/options/short-interest tables.",
    triggered_by: "Scheduled GitHub Action: V5_SCAN_DAILY.yml (16:30 ET weekdays).",
    data_fields: [
      { name: "ticker",          example: "AAPL", note: "Symbol scored" },
      { name: "mt_score",        example: "62",   note: "v5 composite score (0–100)" },
      { name: "band",            example: "Buy",  note: "Bucket label (Strong Buy / Buy / Hold / Sell)" },
      { name: "ig_strength",     example: "+12",  note: "Industry-group momentum delta" },
      { name: "short_interest",  example: "8.4%", note: "% of float short (latest FINRA report)" },
      { name: "rsi",             example: "58",   note: "14-day RSI" },
      { name: "bb_bandwidth",    example: "0.21", note: "Bollinger Band width (volatility proxy)" },
      { name: "rvol",            example: "1.32", note: "Relative volume vs 20-day average" },
      { name: "pct_vs_sma200",   example: "+5.2", note: "% above/below 200-day moving average" },
      { name: "insider_buys",    example: "3",    note: "Number of insider buys in last 90 days" },
    ],
  },

  "ism": {
    ingestion: "Manual entry — Joe (or an admin) enters the ISM Manufacturing + Services PMI numbers each month after the public release.",
    triggered_by: "Manual upload through admin form once a month (1st business day after the ISM release date).",
    data_fields: [
      { name: "release_month", example: "2026-04", note: "Calendar month covered" },
      { name: "pmi_mfg",       example: "50.3",    note: "Manufacturing PMI headline" },
      { name: "pmi_svc",       example: "52.1",    note: "Services PMI headline" },
      { name: "new_orders_mfg", example: "51.5",   note: "Manufacturing new-orders sub-index" },
    ],
  },

  "indicator_history": {
    ingestion: "Two REST APIs called in one script — FRED (st-louis-fed) for macro series and Yahoo Finance for index-style series (VIX, MOVE, SKEW, KBE/SPY, LQD/HYG, DXY). Single Python script fetches them all and writes one combined JSON.",
    api_endpoint: "https://api.stlouisfed.org/fred/series/observations + https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
    triggered_by: "Scheduled GitHub Action: INDICATOR-REFRESH_7AM_WEEKDAYS.yml (07:00 ET weekdays).",
    data_fields: [
      { name: "series_id",    example: "VIXCLS",                note: "FRED series ID or Yahoo symbol" },
      { name: "label",        example: "CBOE Volatility Index", note: "Human-readable label" },
      { name: "as_of",        example: "2026-05-12",            note: "Trading day the value is dated to" },
      { name: "value",        example: "16.42",                 note: "Numeric reading" },
      { name: "history",      example: "[{date, value}, …]",    note: "Trailing series for trend / chart" },
    ],
  },
};

// ─── Plain-English ingestion mechanism (fallback when not curated) ─────────
// Used when a feed isn't in FEED_DETAILS — derives "API / scrape / computed /
// manual" from manifest sourcing_mode + vendor + refresh_trigger so the
// drawer always has SOMETHING to say in the "How we get it" line.
export function ingestionFromManifest(manifestEntry) {
  if (!manifestEntry) return { kind: "unknown", explain: "No manifest entry found for this feed." };
  const mode = manifestEntry.sourcing_mode;
  const vendor = manifestEntry.source_vendor || "";
  const trigger = manifestEntry.refresh_trigger || "";
  if (mode === "computed") {
    return { kind: "computed", explain: "Calculated in-house from upstream feeds (no external API call)." };
  }
  if (mode === "derived") {
    return { kind: "derived", explain: "Derived from another feed already on the site." };
  }
  if (vendor.startsWith("ZeroHedge")) {
    return { kind: "scrape", explain: "Web scrape using a stored login cookie. No API." };
  }
  if (vendor.startsWith("GitHub:")) {
    return { kind: "file_download", explain: "JSON file pulled from a public GitHub repository." };
  }
  if (vendor.startsWith("ISM")) {
    return { kind: "manual", explain: "Manually entered each month after the official ISM release." };
  }
  if (vendor.startsWith("State Street")) {
    return { kind: "file_download", explain: "CSV/XLSX file pulled from State Street SPDR's public landing page." };
  }
  if (vendor.includes("Polygon") || vendor.includes("Unusual Whales") || vendor.includes("FRED") || vendor.includes("Yahoo") || vendor.includes("NY Fed") || vendor.includes("Fed Board") || vendor.includes("CME") || vendor.includes("FDIC")) {
    return { kind: "api", explain: `REST API call to ${vendor}.` };
  }
  if (trigger.includes("github-actions:")) {
    return { kind: "api", explain: "REST API call run by a scheduled GitHub Action." };
  }
  return { kind: "unknown", explain: `Source: ${vendor || "unspecified"}.` };
}

// ─── Public API of this module ─────────────────────────────────────────────
// Returns { manifestKeys: string[], detail?: object } for a pipeline_health
// indicator_id. manifestKeys is always an array — usually one entry, occasionally
// two (e.g. corporate-actions splits across dividends + splits).
export function lookupFeed(indicatorId) {
  const mapped = PIPELINE_TO_MANIFEST[indicatorId];
  const manifestKeys = !mapped
    ? []
    : Array.isArray(mapped) ? mapped : [mapped];
  const detail = FEED_DETAILS[indicatorId] || null;
  return { manifestKeys, detail };
}
