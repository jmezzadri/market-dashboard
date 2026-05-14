// feedLineage.js — source-to-target lineage for every admin-visible feed.
//
// The deployed /data_manifest.json is a LIST of 86 rich element objects, each
// with `id` (slug like "market-prices_eod-daily"), `name` (short key like
// "prices_eod"), source_vendor, source_endpoint, monthly_cost_usd,
// scheduled_fetch_time_et, refresh_trigger, output_destination, producer_script,
// freshness_sla_hours, and consumer_surfaces (a list of {tab, tile} objects).
//
// pipeline_health.indicator_id uses a different convention — mostly short
// snake-case ("vix", "real_rates") which DOES match manifest.name directly,
// plus a handful of dash-prefixed exceptions ("massive-eod",
// "uw-universe-snapshots", "scanner-v5-daily") that need a small override map.
//
// This module:
//   1. Resolves pipeline_health.indicator_id → matching manifest element(s)
//   2. Hosts curated extras (concrete API endpoint URLs, per-column data
//      field tables) for the highest-value feeds, since the manifest itself
//      does not carry that level of detail.

// ─── pipeline_health.indicator_id → manifest.name override ─────────────────
// Empty array means "no match attempted via this override — fall back to
// direct name lookup." A list means "this one pipeline check covers
// multiple manifest entries (e.g. a Polygon CA pull populates BOTH
// dividends + splits)."
export const PIPELINE_TO_MANIFEST_NAMES = {
  // Polygon Massive
  "massive-eod":                ["prices_eod"],
  "massive-ticker-details":     ["ticker_reference"],
  "massive-universe":           ["universe_master"],
  "massive-corporate-actions":  ["dividends", "splits"],

  // Unusual Whales
  "uw-universe-snapshots":      ["universe_snapshots"],

  // Computed scorers
  "scanner-v5-daily":           ["user_scan_data"],
  "latest_scan":                ["latest_scan_data"],
  "latest_scan_data":           ["latest_scan_data"],

  // Misc — only listed where the override is needed.
  "indicator_history":          [], // unified pipeline; no single manifest row
};

// Names that genuinely don't appear in the public manifest (we surface this
// in the drawer to tell Joe the manifest hasn't picked it up yet).
const KNOWN_UNREGISTERED = new Set([
  "fed_bs", "rrp", "tga", "scenarios", "scenario_stress",
  "methodology_calibration_v11", "v10_allocation", "cycle_board",
  "cycle_mechanism_board", "composite_history", "sector_perf",
]);

// ─── Curated per-feed extras ───────────────────────────────────────────────
// API endpoints and field-level columns. The manifest knows everything except
// the concrete API URL and the produced columns; we fill those in here.
export const FEED_DETAILS = {
  "massive-eod": {
    ingestion_kind: "api",
    api_endpoint: "https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/{date}",
    ingestion_explain: "Single REST API call to Polygon Massive's grouped-aggregates endpoint — pulls every US-listed ticker's daily OHLCV in one shot, then upserts into Supabase prices_eod.",
    data_fields: [
      { name: "ticker",     example: "AAPL",         note: "Polygon symbol — joins to ticker_reference" },
      { name: "date",       example: "2026-05-12",   note: "Trading day" },
      { name: "open",       example: "187.51",       note: "Day open" },
      { name: "high",       example: "189.24",       note: "Day high" },
      { name: "low",        example: "186.10",       note: "Day low" },
      { name: "close",      example: "188.66",       note: "Day close — the price most pages display" },
      { name: "volume",     example: "55,234,100",   note: "Day volume" },
      { name: "vwap",       example: "188.02",       note: "Volume-weighted average price" },
    ],
  },

  "massive-ticker-details": {
    ingestion_kind: "api",
    api_endpoint: "https://api.polygon.io/v3/reference/tickers/{ticker}",
    ingestion_explain: "REST API call to Polygon Massive's ticker-details endpoint, called per symbol then upserted into Supabase ticker_reference. Rolling refresh every 4 hours so name + sector changes are picked up quickly.",
    data_fields: [
      { name: "ticker",            example: "AAPL",                  note: "Primary key" },
      { name: "name",              example: "Apple Inc.",            note: "The 'company name' Joe sees on the screener" },
      { name: "sic_code",          example: "3571",                  note: "Standard Industrial Classification — broad industry bucket" },
      { name: "sic_description",   example: "Electronic Computers",  note: "Plain-English SIC label" },
      { name: "primary_exchange",  example: "XNAS",                  note: "Listing exchange (XNAS=Nasdaq, XNYS=NYSE)" },
      { name: "type",              example: "CS",                    note: "Security type (CS=common stock, ETF=exchange-traded fund)" },
      { name: "market_cap",        example: "2,950,000,000,000",     note: "Market capitalisation in USD" },
      { name: "share_class_shares_outstanding", example: "15.4B",    note: "Shares outstanding (listed class)" },
      { name: "sector",            example: "Information Technology", note: "GICS-aligned sector label" },
      { name: "industry_group",    example: "Technology Hardware",   note: "GICS-aligned industry group" },
      { name: "homepage_url",      example: "https://apple.com",     note: "Company website (Polygon-provided)" },
      { name: "list_date",         example: "1980-12-12",            note: "Original IPO / listing date" },
    ],
  },

  "massive-universe": {
    ingestion_kind: "api",
    api_endpoint: "https://api.polygon.io/v3/reference/tickers (paginated)",
    ingestion_explain: "REST API call to Polygon's tickers endpoint — pulls the full active US-listed universe (~12,600 symbols) and writes the master roster to Supabase universe_master.",
    data_fields: [
      { name: "ticker",      example: "AAPL",   note: "Universe key" },
      { name: "active",      example: "true",   note: "Whether the symbol is currently tradable" },
      { name: "market_type", example: "stocks", note: "Polygon market segment" },
      { name: "locale",      example: "us",     note: "Country" },
    ],
  },

  "massive-corporate-actions": {
    ingestion_kind: "api",
    api_endpoint: "https://api.polygon.io/v3/reference/dividends + /v3/reference/splits",
    ingestion_explain: "Two REST API calls to Polygon Massive — one for dividends history (cash payments by ex-date) and one for splits history (split ratios by execution date). Lands in two separate Supabase tables.",
    data_fields: [
      { name: "[dividends] ticker",      example: "AAPL",       note: "Symbol" },
      { name: "[dividends] ex_date",     example: "2026-02-09", note: "Ex-dividend date" },
      { name: "[dividends] cash_amount", example: "0.24",       note: "Cash dividend per share, USD" },
      { name: "[dividends] frequency",   example: "4",          note: "Payments per year (4=quarterly)" },
      { name: "[splits] execution_date", example: "2020-08-31", note: "Split effective date" },
      { name: "[splits] split_from",     example: "1",          note: "Old share count" },
      { name: "[splits] split_to",       example: "4",          note: "New share count (1→4 = 4-for-1 split)" },
    ],
  },

  "uw-universe-snapshots": {
    ingestion_kind: "api",
    api_endpoint: "https://api.unusualwhales.com/api/screener/stocks",
    ingestion_explain: "REST API call to Unusual Whales's screener endpoint — pulls the full tradable universe with intraday-marked price, day change, market cap, sector. Runs 3 times per weekday so intraday prices reflect within ~3 hours.",
    data_fields: [
      { name: "ticker",         example: "AAPL",   note: "Symbol" },
      { name: "last_close",     example: "188.66", note: "UW's marked last price" },
      { name: "day_change_pct", example: "1.24",   note: "Day percent change" },
      { name: "market_cap",     example: "2.95T",  note: "Market cap in shorthand" },
      { name: "sector",         example: "Tech",   note: "UW's sector label (slightly different from Polygon's GICS)" },
      { name: "volume",         example: "55M",    note: "Day volume" },
    ],
  },

  "scanner-v5-daily": {
    ingestion_kind: "computed",
    ingestion_explain: "Computed in-house — runs the v5 composite scorer over the joined UW screener + Polygon EOD + insider/options/short-interest tables. No external API call at this step; reads are from Supabase tables that earlier feeds populated.",
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

  "vix": {
    ingestion_kind: "api",
    api_endpoint: "Yahoo Finance ^VIX chart endpoint (via yfinance)",
    ingestion_explain: "Python's yfinance library queries Yahoo Finance for the ^VIX index; current value and 5-year history are written into public/indicator_history.json under the 'vix' key.",
    data_fields: [
      { name: "as_of",  example: "2026-05-12", note: "Trading day the value is dated to" },
      { name: "value",  example: "16.42",      note: "Closing VIX level for that day" },
      { name: "history",example: "[{date, value}, …]", note: "5-year trailing history for chart rendering" },
    ],
  },

  "real_rates": {
    ingestion_kind: "api",
    api_endpoint: "https://api.stlouisfed.org/fred/series/observations?series_id=DFII10",
    ingestion_explain: "REST API call to FRED for series DFII10 (10-year TIPS yield, the standard real-rate proxy). Pulled by fetch_history.py each weekday morning.",
    data_fields: [
      { name: "as_of",  example: "2026-05-12", note: "Trading day" },
      { name: "value",  example: "2.18",       note: "10-year real yield in percent" },
      { name: "history",example: "[{date, value}, …]", note: "5-year trailing history" },
    ],
  },

  "ism": {
    ingestion_kind: "scrape",
    api_endpoint: "TradingEconomics.com (free tier) — HTML scrape",
    ingestion_explain: "Web scrape of TradingEconomics for the ISM Manufacturing + Services PMI headline numbers, anchored by curated historical values pulled from ISM's monthly release. Runs monthly on the 1st business day after the release.",
    data_fields: [
      { name: "release_month", example: "2026-04", note: "Calendar month covered" },
      { name: "pmi_mfg",       example: "50.3",    note: "Manufacturing PMI headline" },
      { name: "pmi_svc",       example: "52.1",    note: "Services PMI headline" },
    ],
  },
};

// ─── Public API: look up a pipeline_health row ─────────────────────────────
// elementsList is the array from public/data_manifest.json's `elements` key.
// Returns { manifestEntries: object[], detail?: object, unregistered: bool }.
export function lookupFeed(indicatorId, elementsList) {
  if (!indicatorId) return { manifestEntries: [], detail: null, unregistered: false };

  // 1. Try override map first (handles dash-prefixed pipeline_health ids).
  const overrideNames = PIPELINE_TO_MANIFEST_NAMES[indicatorId];
  if (Array.isArray(overrideNames)) {
    const matched = overrideNames
      .map((n) => (elementsList || []).find((e) => e.name === n))
      .filter(Boolean);
    return {
      manifestEntries: matched,
      detail: FEED_DETAILS[indicatorId] || null,
      unregistered: overrideNames.length === 0 || matched.length === 0,
    };
  }

  // 2. Direct name match — pipeline_health.indicator_id === manifest element.name.
  const direct = (elementsList || []).find((e) => e.name === indicatorId);
  if (direct) {
    return {
      manifestEntries: [direct],
      detail: FEED_DETAILS[indicatorId] || null,
      unregistered: false,
    };
  }

  // 3. No match anywhere.
  return {
    manifestEntries: [],
    detail: FEED_DETAILS[indicatorId] || null,
    unregistered: KNOWN_UNREGISTERED.has(indicatorId),
  };
}

// ─── Plain-English ingestion mechanism ─────────────────────────────────────
// Used when FEED_DETAILS doesn't have a curated ingestion_explain string —
// derives "API / scrape / computed / manual / file_download" from the
// manifest's source_vendor + source_endpoint + refresh_trigger so the
// drawer always has a sensible "How we get it" line.
export function ingestionFromManifest(entry) {
  if (!entry) return { kind: "unknown", explain: "No manifest entry registered for this feed." };
  const vendor = (entry.source_vendor || "").toLowerCase();
  const endpoint = (entry.source_endpoint || "").toLowerCase();
  const mode = (entry.sourcing_mode || "").toLowerCase();

  if (vendor === "n/a" || vendor.includes("self") || mode === "computed" || mode === "derived" || vendor.startsWith("internal") || vendor.includes("anthropic")) {
    return { kind: "computed", explain: "Computed in-house — no external API call. Reads from Supabase tables that other feeds have populated." };
  }
  if (vendor.includes("zerohedge")) {
    return { kind: vendor.includes("rss") ? "api" : "scrape",
             explain: vendor.includes("rss") ? "Public RSS feed pulled over HTTP." : "Web scrape using a stored login cookie. No public API." };
  }
  if (endpoint.includes("scrape") || vendor.includes("scrape") || vendor.includes("scraped") || vendor.includes("tradingeconomics")) {
    return { kind: "scrape", explain: "Web scrape — no public API at the upstream source." };
  }
  if (vendor.includes("github:") || endpoint.includes("github.com") || vendor.includes("wikipedia") || vendor.includes("ishares")) {
    return { kind: "file_download", explain: "JSON or CSV file pulled over HTTP from a public site." };
  }
  if (vendor.includes("manual") || vendor.includes("user-managed") || vendor.includes("user-generated") || vendor.includes("user-uploaded")) {
    return { kind: "manual", explain: "User-entered or admin-entered through the site UI." };
  }
  if (vendor.includes("polygon") || vendor.includes("unusual") || vendor.includes("fred") || vendor.includes("yahoo") || vendor.includes("yfinance") || vendor.includes("finra") || vendor.includes("ny fed") || vendor.includes("fed ") || vendor.includes("cme") || vendor.includes("fdic") || vendor.includes("ism") || vendor.includes("naaim") || vendor.includes("shiller")) {
    return { kind: "api", explain: `REST API call to ${entry.source_vendor}.` };
  }
  return { kind: "unknown", explain: `Source: ${entry.source_vendor || "unspecified"}.` };
}
