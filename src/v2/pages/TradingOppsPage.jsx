// TradingOppsPage — v5 ship.
//
// Reads from public.signal_intel_v5_daily (populated daily by
// trading-scanner/run_v5_scanner.py via .github/workflows/V5_SCAN_DAILY.yml).
// Joins ticker_reference (name, sic_description) and universe_snapshots
// (full_name, sector, close, prev_close, perc_change, iv_rank, 52wk,
// snapshot_ts) just like v4.1 did.
//
// The page hero pairs a SectionHeader left column with a right-side
// glassmorphic funnel card. The table below shows the full universe
// scored, grouped by band, with 11 default columns including all six
// signal sub-scores. Clicking any row opens the global TickerDetailModal
// via the onOpenTicker prop, which renders the MacroTilt Signal tile
// (first tile in the right rail).
//
// Theme parity: every color is a CSS variable. Light + dark both clean.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import ScannerTilesStrip from "../../components/ScannerTilesStrip";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

// Per LESSONS rule: NO version strings in user-facing copy. The column
// storage key is internal so it carries a private version tag.
const STORAGE_KEY_COLS = "mt-portopps-cols-v5-1";

// 16-column schema. `default:true` = visible at first load (11 columns).
const COLUMNS = [
  { key: "ticker",   label: "Ticker",         group: "Identity",     numeric: false, default: true,
    tt: { label: "Identity", body: "Stock symbol. Click any row to open the full dossier modal." } },
  { key: "name",     label: "Name",           group: "Identity",     numeric: false, default: true,
    tt: { label: "Identity", body: "Company name. Source: Polygon ticker reference." } },
  { key: "sector",   label: "Sector",         group: "Identity",     numeric: false, default: true, categorical: true,
    tt: { label: "GICS Sector", body: "GICS Sector (11 top-level buckets). Derived from the ticker's SIC code via our SIC -> GICS mapping (~82% of the universe covered today; the remaining names show '—' because they lack a SIC code on Polygon's side). The same mapping anchors Scenario Analysis and Asset Tilt." } },
  { key: "ig",       label: "Industry Group", group: "Identity",     numeric: false, default: true, categorical: true,
    tt: { label: "GICS Industry Group", body: "GICS Industry Group (25 mid-level buckets, e.g. Pharmaceuticals · Biotechnology & Life Sciences, Capital Goods, Banks). Derived from the ticker's SIC code via the same SIC -> GICS mapping the Sector column uses, so the hierarchy stays consistent." } },
  { key: "price",    label: "Price",          group: "Quote",        numeric: true,  default: true,
    tt: { label: "Quote", body: "Last close. Source: Polygon Massive (end-of-day)." } },
  { key: "day_pct",  label: "Day %",          group: "Quote",        numeric: true,  default: true,
    tt: { label: "Quote", body: "1-day return vs prior close." } },
  { key: "mcap",     label: "Mkt Cap",        group: "Quote",        numeric: true,  default: true,
    tt: { label: "Quote", body: "Market capitalization. Source: Polygon ticker reference." } },
  { key: "score",    label: "MT Score",       group: "Signal",       numeric: true,  default: true,
    tt: { label: "MacroTilt Score", body: "Weighted blend of six signals, range -100 to +100. Positive = bullish tilt, negative = bearish tilt." } },
  { key: "band",     label: "Band",           group: "Signal",       numeric: false, default: true, categorical: true,
    tt: { label: "MacroTilt Score", body: "Strong Sell, Sell Watch, Neutral, Buy Watch, Strong Buy. Cutoffs at -50, -20, +20, +50." } },
  { key: "sub_insider", label: "Insider",     group: "Signals",      numeric: true, default: true,
    tt: { label: "Insider buying", body: "Form 4 open-market buys and sells over the last 30 days. Sub-score range -100 to +100. Buys dominate -> positive; sells dominate -> negative. 10b5-1 routine sales filtered out. A 'first buy in 12 months' classifier amplifies when a quiet officer steps in. Highest-weighted signal in the composite (36.3%) -- most predictive in the backtest." } },
  { key: "sub_options", label: "Options",     group: "Signals",      numeric: true, default: false,
    tt: { label: "Options flow", body: "30-day call vs put premium ratio (log-scale), ask-side vs bid-side bias, and unusual-size sweep count. Bullish when calls dominate AND sweeps hit the ask; bearish when puts dominate AND sweeps hit the bid. Sub-score -100 to +100. Currently on the 16.7% equal-weight floor pending more history." } },
  { key: "sub_congress", label: "Congress",   group: "Signals",      numeric: true, default: false,
    tt: { label: "Congress trades", body: "Disclosed buy and sell trades by US senators and representatives over the trailing 90 days, weighted by tier and amount band. Cluster bonus when multiple unique members trade the same direction. Sub-score -100 to +100. On the 16.7% floor while history is sparse." } },
  { key: "sub_technicals", label: "Technicals", group: "Signals",    numeric: true, default: true,
    tt: { label: "Technicals", body: "Composite of 14-day RSI (>70 overbought, <30 oversold), Bollinger band-width (<5% = squeeze setup), distance to the 50-day SMA (above = trend, below = breakdown), and 20-day relative volume (>=1.5x = unusual activity). Sub-score -100 to +100. Calibrated weight 8.7%." } },
  { key: "sub_analyst", label: "Analyst",     group: "Signals",      numeric: true, default: true,
    tt: { label: "Analyst actions", body: "Net upgrades minus downgrades over the trailing 90 days, weighted by broker tier (top 1.0x, major 0.7x, other 0.5x). Combined with the average price-target gap to spot: >=+15% saturates bullish, <=-15% saturates bearish. Sub-score -100 to +100. Calibrated weight 5.0%." } },
  { key: "sub_short_interest", label: "Short Interest", group: "Signals", numeric: true, default: false,
    tt: { label: "Short interest", body: "Percent of float sold short and cost-to-borrow trend. Three regimes: rising SI + rising CTB above the 50-day SMA = bearish (smart money short); high SI + cheap borrow into earnings = bullish squeeze setup; falling SI + rising price = bullish capitulation. Sub-score -100 to +100. On the 16.7% floor while coverage is sparse." } },

  // ── v5.1 (2026-05-10): legacy columns restored as toggleable ──
  // Joe noted the prior production table had ~25 columns; the v5 rewrite
  // dropped them to 15. These are sourced from universe_snapshots (52W
  // range, IV rank) and the v5 diagnostic.scorer_components (RVOL, RSI,
  // BB band-width, % vs SMA, insider buy count and total $). All default
  // off so the table stays tidy; users can toggle in the column menu.
  { key: "range_52w", label: "52W Range",        group: "Quote",     numeric: false, default: false,
    tt: { label: "52-week range", body: "Low to high over the trailing 52 weeks. Source: universe snapshots." } },
  { key: "iv_rank",   label: "IV Rank",          group: "Quote",     numeric: true,  default: false,
    tt: { label: "Implied volatility rank", body: "0 to 100 percentile of 30-day implied volatility over the trailing year. Source: universe snapshots." } },
  { key: "rsi_14",    label: "RSI(14)",          group: "Technicals",numeric: true,  default: false,
    tt: { label: "14-day RSI", body: "Relative Strength Index over a 14-day window. >70 conventionally overbought (cell turns red), <30 oversold (cell turns amber). Mid-range (30-70) is normal trend." } },
  { key: "bb_bw",     label: "BB Band-Width",    group: "Technicals",numeric: true,  default: false,
    tt: { label: "Bollinger band-width", body: "Width of the 20-day Bollinger bands as a percent of the 20-day moving average. <5% = compression / squeeze setup (cell turns amber) -- a break is coming, just not direction. >15% = expansion / trend in motion." } },
  { key: "rvol_20d",  label: "RVOL (20d)",       group: "Technicals",numeric: true,  default: false,
    tt: { label: "Relative volume (20-day)", body: "Today's volume divided by the 20-day average. >=1.5x = unusual activity (green); <0.7x = quiet (amber). 1.0x is exactly average." } },
  { key: "pct_50ma",  label: "% vs 50d MA",      group: "Technicals",numeric: true,  default: false,
    tt: { label: "% vs 50-day moving average", body: "Today's close as a percent distance from the 50-day SMA. >+5% = uptrend; <-5% = downtrend; between = ranging. Color = direction." } },
  { key: "pct_200ma", label: "% vs 200d MA",     group: "Technicals",numeric: true,  default: false,
    tt: { label: "% vs 200-day moving average", body: "Today's close as a percent distance from the 200-day SMA. >+10% = strong long-term trend up; <-10% = down-trend; between = sideways. Color = direction." } },
  { key: "ins_buys",  label: "Insider buys (#)", group: "Signals",   numeric: true,  default: false,
    tt: { label: "Insider buys (count)", body: "Number of Form 4 open-market buy events by company officers and directors in the recent window." } },
  { key: "ins_buy_$", label: "Insider buys ($)", group: "Signals",   numeric: true,  default: false,
    tt: { label: "Insider buys (dollar value)", body: "Total dollar value of recent Form 4 open-market buy events by company officers and directors." } },
];

const COL_KEYS = COLUMNS.map(c => c.key);
const DEFAULT_VISIBLE = COLUMNS.filter(c => c.default).map(c => c.key);

// ─── Display helpers ──────────────────────────────────────────────────────
function shortName(name) {
  if (!name) return "—";
  return String(name)
    .replace(/\s+Class\s+[A-Z](\s+Common Stock)?$/i, "")
    .replace(/\s+Common Stock$/i, "")
    .replace(/\s+Common Shares$/i, "")
    .replace(/,\s+(Inc|Ltd|LP|L\.P|Plc|PLC|Corp)\.?$/i, "")
    .trim();
}
function titleCaseSector(s) {
  if (!s) return "—";
  return String(s).toLowerCase().replace(/\b(\w)/g, c => c.toUpperCase());
}


// ─────────────────────────────────────────────────────────────────────────
// localStorage helpers
// ─────────────────────────────────────────────────────────────────────────

function loadColState() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLS);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  if (!saved) {
    return { order: [...COL_KEYS], visible: [...DEFAULT_VISIBLE], sort: { key: "score", dir: "desc" }, filter: "actionable", colFilters: [] };
  }
  const order = (saved.order || []).filter(k => COL_KEYS.includes(k));
  COL_KEYS.forEach(k => { if (!order.includes(k)) order.push(k); });
  const visible = (saved.visible || []).filter(k => COL_KEYS.includes(k));
  if (visible.length === 0) visible.push(...DEFAULT_VISIBLE);
  return {
    order,
    visible,
    sort: saved.sort || { key: "score", dir: "desc" },
    filter: saved.filter || "all",
    colFilters: Array.isArray(saved.colFilters) ? saved.colFilters : [],
  };
}

function saveColState(state) {
  try { localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────

function fmtMcap(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v)}`;
}

function fmtDay(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function dayClass(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "muted-val";
  return n > 0 ? "pos-val" : "neg-val";
}

function bandGroup(b) {
  // v5.2: no more Insufficient Data band -- every stock gets a score.
  if (b === "Strong Buy")        return "strong_buy";
  if (b === "Watch Buy")         return "watch_buy";
  if (b === "Watch Sell")        return "watch_sell";
  if (b === "Strong Sell")       return "strong_sell";
  return "neutral";
}

// ─────────────────────────────────────────────────────────────────────────
// Data hydration — pulls signal_intel_v5_daily for the latest scan date
// and joins ticker_reference + universe_snapshots in follow-up queries.
// ─────────────────────────────────────────────────────────────────────────

// v5.1 (e): SIC code -> rough GICS sector mapping so the Sector column
// is not literally the same string as Industry Group. SIC divisions are
// coarser than GICS so the mapping is approximate, but it gives Joe a
// useful Sector / Industry distinction instead of two identical cells.
// Full mapping at https://www.osha.gov/data/sic-manual; pruned to the
// divisions that show up in our universe.
function sicCodeToSector(sicCode) {
  if (!sicCode) return null;
  const n = parseInt(String(sicCode).trim().slice(0, 4), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 100 && n <= 999)   return "Agriculture & Forestry";
  if (n >= 1000 && n <= 1499) return "Mining";
  if (n >= 1500 && n <= 1799) return "Construction";
  if (n >= 2000 && n <= 2199) return "Food & Beverage";
  if (n >= 2200 && n <= 2399) return "Textiles & Apparel";
  if (n >= 2400 && n <= 2599) return "Lumber, Wood & Furniture";
  if (n >= 2600 && n <= 2799) return "Paper, Print & Publishing";
  // 28xx covers chemicals AND pharma -- split at 2830 for health care.
  if (n >= 2830 && n <= 2839) return "Health Care";
  if (n >= 2800 && n <= 2899) return "Chemicals";
  if (n >= 2900 && n <= 2999) return "Energy (Refining)";
  if (n >= 3000 && n <= 3299) return "Rubber, Plastics & Stone";
  if (n >= 3300 && n <= 3399) return "Metals & Mining";
  if (n >= 3400 && n <= 3499) return "Industrial Metals";
  // 3570-3579 are computers + office equipment (part of GICS Information Technology).
  if (n >= 3570 && n <= 3579) return "Electronics & Hardware";
  if (n >= 3500 && n <= 3599) return "Industrial Machinery";
  if (n >= 3600 && n <= 3699) return "Electronics & Hardware";
  if (n >= 3700 && n <= 3799) return "Transportation Equipment";
  // 38xx = instruments + medical devices.
  if (n >= 3840 && n <= 3851) return "Health Care";
  if (n >= 3800 && n <= 3899) return "Industrial Instruments";
  if (n >= 3900 && n <= 3999) return "Misc. Manufacturing";
  // 4xxx = transport / comms / utilities.
  if (n >= 4800 && n <= 4899) return "Communications";
  if (n >= 4900 && n <= 4999) return "Utilities";
  if (n >= 4000 && n <= 4799) return "Transportation";
  if (n >= 5000 && n <= 5199) return "Wholesale Trade";
  if (n >= 5200 && n <= 5999) return "Retail";
  // 60s = financials.
  if (n >= 6000 && n <= 6199) return "Banking";
  if (n >= 6200 && n <= 6299) return "Capital Markets";
  if (n >= 6300 && n <= 6499) return "Insurance";
  if (n >= 6500 && n <= 6599) return "Real Estate";
  if (n >= 6700 && n <= 6799) return "Holding Companies & Investment";
  // 7xxx-8xxx = services. 8000s mostly health/education.
  if (n >= 8000 && n <= 8099) return "Health Care";
  if (n >= 8200 && n <= 8299) return "Education";
  if (n >= 7370 && n <= 7379) return "Software & IT Services";
  if (n >= 7000 && n <= 7999) return "Consumer & Business Services";
  if (n >= 8100 && n <= 8999) return "Professional Services";
  if (n >= 9100 && n <= 9999) return "Public Administration";
  return null;
}

function shapeRow(scan, ref, snap) {
  const close = Number(snap?.close ?? 0) || null;
  let dayPct = null;
  const pc = Number(snap?.perc_change);
  if (Number.isFinite(pc)) dayPct = pc;
  else if (Number.isFinite(close) && Number.isFinite(Number(snap?.prev_close)) && Number(snap?.prev_close) > 0) {
    dayPct = ((close - Number(snap.prev_close)) / Number(snap.prev_close)) * 100;
  }
  const subs = scan?.sub_scores || {};
  // v5.1: pull the scorer components so the restored legacy columns can
  // render (RVOL, RSI, BB band-width, % vs SMA, insider buy count and $).
  const sc      = (scan?.diagnostic && scan.diagnostic.scorer_components) || {};
  const techC   = sc.technicals || {};
  const insC    = sc.insider    || {};
  const high52  = Number(snap?.week_52_high);
  const low52   = Number(snap?.week_52_low);
  const rangeStr = (Number.isFinite(low52) && Number.isFinite(high52) && low52 > 0 && high52 > 0)
    ? `$${low52.toFixed(2)}–$${high52.toFixed(2)}`
    : null;
  const ivRank  = Number(snap?.iv_rank);
  const rsi14   = Number(techC.rsi14);
  const bbBw    = Number(techC.bb_bandwidth);
  const rvol    = Number(techC.rvol_20d);
  const sma50   = Number(techC.sma50);
  const sma200  = Number(techC.sma200);
  const todayC  = Number(techC.today_close);
  const pct50   = (Number.isFinite(todayC) && Number.isFinite(sma50)  && sma50  > 0) ? ((todayC - sma50)  / sma50)  * 100 : null;
  const pct200  = (Number.isFinite(todayC) && Number.isFinite(sma200) && sma200 > 0) ? ((todayC - sma200) / sma200) * 100 : null;
  // SECTOR: prefer the real GICS sector from universe_snapshots; if absent,
  // derive a coarse sector from the SIC code (so we don't show the same
  // SIC description in both Sector AND Industry Group cells).
  // v5.5: Joe's rule -- anchor to gold-source GICS only. Use the real
  // sector from universe_snapshots when present; show "—" when not.
  // The previous SIC-code-to-fake-GICS mapping (which produced things
  // like "Banking" or "Industrial Machinery") is gone.
  const snapSector = snap?.sector && String(snap.sector).trim() ? snap.sector : null;
  const derivedSector = snapSector;
  return {
    ticker: scan.ticker,
    name: ref?.name || snap?.full_name || scan.ticker,
    // v5.5b: Sector + Industry Group come from the GICS-via-SIC mapping
    // function on the server (ticker_state_current view). When the SIC
    // mapping doesn't reach the name (no SIC code or out-of-range), the
    // values are null -> render '—'. NOT a SIC description anymore.
    sector: snap?.sector || "—",
    ig:     snap?.industry_group || "—",
    price: close,
    day_pct: dayPct,
    mcap: scan?.market_cap != null ? Number(scan.market_cap) : null,
    score: Number.isFinite(Number(scan?.mt_score)) ? Number(scan.mt_score) : null,
    band: scan?.band || "Neutral",
    band_group: bandGroup(scan?.band),
    sub_insider: subs.insider == null ? null : Number(subs.insider),
    sub_options: subs.options == null ? null : Number(subs.options),
    sub_congress: subs.congress == null ? null : Number(subs.congress),
    sub_technicals: subs.technicals == null ? null : Number(subs.technicals),
    sub_analyst: subs.analyst == null ? null : Number(subs.analyst),
    sub_short_interest: subs.short_interest == null ? null : Number(subs.short_interest),
    so_what: scan?.so_what || null,
    cap_discount: Number.isFinite(Number(scan?.cap_discount)) ? Number(scan.cap_discount) : null,
    // ── Legacy columns restored (v5.1, 2026-05-10) ──
    range_52w: rangeStr,
    iv_rank:   Number.isFinite(ivRank) ? ivRank : null,
    rsi_14:    Number.isFinite(rsi14)  ? rsi14  : null,
    bb_bw:     Number.isFinite(bbBw)   ? bbBw * 100 : null, // percent
    rvol_20d:  Number.isFinite(rvol)   ? rvol   : null,
    pct_50ma:  pct50,
    pct_200ma: pct200,
    ins_buys:  Number.isFinite(Number(insC.buy_count))         ? Number(insC.buy_count)         : null,
    "ins_buy_$": Number.isFinite(Number(insC.buy_dollar_total)) ? Number(insC.buy_dollar_total) : null,
    _raw: { scan, ref, snap },
  };
}

function useScanData() {
  const [state, setState] = useState({
    rows: [],
    scanDate: null,
    loading: true,
    error: null,
    totals: { massive_total: null, universe_v5: null, scored_with_mt: 0, insufficient: 0, strong_buy: 0, watch_buy: 0, neutral: 0, watch_sell: 0, strong_sell: 0 },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1. Latest scan date in v5
        const latestRes = await supabase
          .from("signal_intel_v5_daily")
          .select("scan_date")
          .order("scan_date", { ascending: false })
          .limit(1);
        const latest = latestRes?.data?.[0]?.scan_date;
        if (!latest) {
          if (!cancelled) setState(s => ({ ...s, loading: false }));
          return;
        }

        // 2. Pull ALL rows of today's scan via paginated range.
        let scanRows = [];
        const PAGE = 1000;
        for (let from = 0; from < 20000; from += PAGE) {
          const r = await supabase
            .from("signal_intel_v5_daily")
            .select("*")
            .eq("scan_date", latest)
            .order("mt_score", { ascending: false, nullsFirst: false })
            .range(from, from + PAGE - 1);
          if (r.error) throw r.error;
          if (!r.data || r.data.length === 0) break;
          scanRows = scanRows.concat(r.data);
          if (r.data.length < PAGE) break;
        }
        if (cancelled) return;

        // 3. (v5.1 cleanup) Removed the "total US-listed equities" count
        //    query - it kept returning null and silently falling back to the
        //    same number as the row below it, producing the "3304/3304"
        //    funnel Joe rejected on 2026-05-10.

        // 4. Joins for the table. v5.1 (h) -- replaced the prior 3-table
        // dance (ticker_reference + universe_snapshots + prices_eod) with
        // a single query against the new `ticker_state_current` view.
        // The view stitches every per-ticker fact into one row at the DB
        // layer: name, GICS sector, SIC description, last close (with
        // built-in prices_eod fallback), 52W range, IV rank, market cap.
        // The page never has to know which source each field came from.
        const tickers = scanRows.map(r => r.ticker);
        const TICK_BATCH = 800;

        const refByT = new Map();
        const stateByT = new Map();
        for (let i = 0; i < tickers.length; i += TICK_BATCH) {
          const slice = tickers.slice(i, i + TICK_BATCH);
          const r = await supabase
            .from("ticker_state_current")
            .select("ticker,ticker_name,gics_sector,gics_industry_group,sic_description,sic_code,last_close,prev_close_snap,day_perc_change,week_52_high,week_52_low,iv_rank,market_cap,snap_full_name")
            .in("ticker", slice);
          (r?.data || []).forEach(row => {
            stateByT.set(row.ticker, row);
            // Keep refByT populated as a shim for the legacy shapeRow signature.
            refByT.set(row.ticker, { ticker: row.ticker, name: row.ticker_name, sic_description: row.sic_description, sic_code: row.sic_code });
          });
        }

        // v5.1 (h): the prior 30+ lines of fallback fetching (snapshots
        // with date filter + prices_eod for tickers missing a snapshot)
        // is now ONE join inside the `ticker_state_current` view. Convert
        // every state-view row into the snap-shape shapeRow expects.
        const snapByT = new Map();
        for (const [ticker, row] of stateByT.entries()) {
          snapByT.set(ticker, {
            ticker,
            full_name: row.snap_full_name,
            sector: row.gics_sector,             // GICS sector via SIC mapping
            industry_group: row.gics_industry_group, // GICS IG via SIC mapping
            close: row.last_close,
            prev_close: row.prev_close_snap,
            perc_change: row.day_perc_change,
            iv_rank: row.iv_rank,
            week_52_high: row.week_52_high,
            week_52_low: row.week_52_low,
            marketcap: row.market_cap,
          });
        }

        if (cancelled) return;

        const shaped = scanRows.map(s => shapeRow(s, refByT.get(s.ticker), snapByT.get(s.ticker)));

        // 5. Funnel counts.
        // v5.1 (i): query the ALL-US-listed total from ticker_reference so
        // the funnel starts at the real Polygon Massive count (~12,629)
        // not the post-filter scan universe (3,304). Falls back to null
        // when the count query fails so the funnel doesn't lie with a
        // duplicate number.
        let massiveTotal = null;
        try {
          const mt = await supabase
            .from("ticker_reference")
            .select("ticker", { count: "exact", head: true });
          if (Number.isFinite(Number(mt?.count))) massiveTotal = Number(mt.count);
        } catch (_) { /* leave null */ }

        const universeV5 = scanRows.length;
        const totals = {
          massive_total:      massiveTotal,
          universe_v5:        universeV5,
          scored_with_mt:     scanRows.filter(r => r.mt_score != null && Number.isFinite(Number(r.mt_score))).length,
          insufficient:       scanRows.filter(r => r.band === "Insufficient Data").length,
          strong_buy:   scanRows.filter(r => r.band === "Strong Buy").length,
          watch_buy:    scanRows.filter(r => r.band === "Watch Buy").length,
          neutral:      scanRows.filter(r => r.band === "Neutral").length,
          watch_sell:   scanRows.filter(r => r.band === "Watch Sell").length,
          strong_sell:  scanRows.filter(r => r.band === "Strong Sell").length,
        };

        setState({
          rows: shaped,
          scanDate: latest,
          loading: false,
          error: null,
          totals,
        });
      } catch (err) {
        if (!cancelled) setState({ rows: [], scanDate: null, loading: false, error: err?.message || String(err), totals: { massive_total: null, universe_v5: null, scored_with_mt: 0, insufficient: 0, strong_buy: 0, watch_buy: 0, neutral: 0, watch_sell: 0, strong_sell: 0 } });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}

// ─────────────────────────────────────────────────────────────────────────
// Tooltip component.
// ─────────────────────────────────────────────────────────────────────────

function Tooltip({ label, body, children, side = "bottom" }) {
  // v5.5d: portal-rendered, fixed-positioned, viewport-clamped.
  // Previous implementation used position:absolute inside the <th>, which
  // overflowed adjacent columns and rendered as visible "hanging" block
  // text on sticky-header sort. Now mounts to document.body with explicit
  // hover gate and viewport clamping borrowed from the project Tip
  // component (src/InfoTip.jsx).
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, flip: false });
  const anchorRef = useRef(null);
  const TT_W = 300;

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const margin = 8;
    const TT_H_APPROX = 170;   // generous; we don't know body height yet
    const wantX = r.left + r.width / 2 - TT_W / 2;
    const clampedX = Math.max(margin, Math.min(wantX, window.innerWidth - TT_W - margin));
    // Prefer above when caller asked OR there isn't enough room below.
    let flipAbove;
    if (side === "top") {
      // If anchor is near the top, fall back to below.
      flipAbove = r.top >= TT_H_APPROX + margin;
    } else {
      flipAbove = r.bottom + TT_H_APPROX > window.innerHeight;
    }
    setPos({
      x: clampedX,
      y: flipAbove ? r.top - 8 : r.bottom + 8,
      flip: flipAbove,
    });
  }, [open, side]);

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "help" }}
      >
        {children}
      </span>
      {open && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.flip ? undefined : pos.y,
            bottom: pos.flip ? window.innerHeight - pos.y : undefined,
            width: TT_W,
            padding: "10px 12px",
            background: "var(--surface-solid, #fff)",
            color: "var(--text, #111)",
            border: "1px solid var(--border, #d4d7db)",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            zIndex: 9999,
            pointerEvents: "none",
            whiteSpace: "normal",
            letterSpacing: 0,
            textTransform: "none",
            fontWeight: 400,
            textAlign: "left",
          }}
        >
          {label && (
            <div style={{ color: "var(--accent)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>
              {label}
            </div>
          )}
          {body}
        </div>,
        document.body
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Animated counter used inside the funnel card.
// ─────────────────────────────────────────────────────────────────────────

function AnimatedCount({ value, durationMs = 900 }) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (value == null) { setShown(null); return; }
    const target = Number(value) || 0;
    const start = performance.now();
    const startVal = fromRef.current;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(startVal + (target - startVal) * eased);
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick); else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  if (value == null || shown == null) return <span>—</span>;
  return <span>{Number(shown).toLocaleString()}</span>;
}

// ─────────────────────────────────────────────────────────────────────────
// Funnel summary card (right column of the hero).
// ─────────────────────────────────────────────────────────────────────────

function FunnelCard({ totals, scanDate }) {
  const ts = scanDate ? new Date(`${scanDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · EOD" : "Pending";

  // v5.5 (Joe's mockup): summary table = Total Universe / MacroTilt Gate /
  // Weak Signals · Missing Data. Then 4 band tiles: Strong Buy, Buy Watch,
  // Sell Watch, Strong Sell. No Neutral tile.
  const u_total = totals?.massive_total || null;  // ~12,629
  const u_v5    = totals?.universe_v5   || 0;     // 3,304
  const u_weak  = totals?.neutral       || 0;     // names in the Neutral band -- "weak signal / missing data" in v5.2 reality

  const summaryRows = [
    { key: "total",  label: "Total Universe", count: u_total, subline: null },
    { key: "gate",   label: "MacroTilt Gate", count: u_v5,
      subline: "Mkt Cap: ≥$300M, Price: >$5" },
    { key: "weak",   label: "Weak Signals / Missing Data", count: u_weak, subline: null },
  ];

  const tiles = [
    { key: "strong_buy",  count: totals?.strong_buy,  label: "Strong Buy",  color: "var(--green-text, var(--green))" },
    { key: "watch_buy",   count: totals?.watch_buy,   label: "Buy Watch",   color: "var(--text-2)" },
    { key: "watch_sell",  count: totals?.watch_sell,  label: "Sell Watch",  color: "var(--text-2)" },
    { key: "strong_sell", count: totals?.strong_sell, label: "Strong Sell", color: "var(--red-text, var(--red))" },
  ];

  return (
    <div
      style={{
        padding: "16px 16px 14px",
        borderRadius: "var(--r-lg, 14px)",
        border: "1px solid var(--border)",
        background: "var(--glass-bg, var(--surface))",
        minWidth: 280,
        boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))",
      }}
    >
      {/* Header: "Today's Scan" centered, EOD date small-right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 500, fontSize: 16, color: "var(--text)", margin: "0 auto" }}>
          Today&rsquo;s Scan
        </span>
        <span style={{ position: "absolute", fontFamily: "var(--font-ui, Inter)", fontSize: 11, color: "var(--text-muted)", right: 22, marginTop: -2 }}>
          {ts}
        </span>
      </div>

      {/* Summary rows -- one bordered table per Joe's mockup */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
        {summaryRows.map((r, i) => (
          <div key={r.key} style={{
              display: "flex",
              alignItems: r.subline ? "flex-start" : "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: i < summaryRows.length - 1 ? "1px solid var(--border)" : "none",
              gap: 12,
            }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontFamily: "var(--font-ui, Inter)", fontSize: 13, color: "var(--text)" }}>
                {r.label}
              </span>
              {r.subline && (
                <span style={{ fontFamily: "var(--font-ui, Inter)", fontSize: 11, color: "var(--text-muted)" }}>
                  {r.subline}
                </span>
              )}
            </div>
            <span style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 600, fontSize: 18, color: "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {r.count == null ? "—" : Number(r.count).toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* 4 band tiles -- Strong Buy / Buy Watch / Sell Watch / Strong Sell */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {tiles.map(t => (
          <div key={t.key} style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 4px 10px",
              textAlign: "center",
              background: "var(--surface)",
              minWidth: 0,
            }}>
            <div style={{ fontFamily: "var(--font-ui, Inter)", fontSize: 10.5, fontWeight: 500, color: "var(--text-muted)", marginBottom: 4, lineHeight: 1.2 }}>
              {t.label}
            </div>
            <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontSize: 22, fontWeight: 600, lineHeight: 1, color: t.color, fontVariantNumeric: "tabular-nums" }}>
              {t.count == null ? "—" : Number(t.count).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hero (left column).
// ─────────────────────────────────────────────────────────────────────────

function Hero({ totals, scanDate }) {
  // v5.5 (Joe's mockup): single big sentence on the left, summary card on
  // the right. Phrase uses italic accent on "proprietary signal intelligence"
  // and on "MacroTilt Score" -- matches the site's existing italic-accent
  // pattern (Fraunces italic in --accent color).
  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "32px 32px 16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 36, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <h2
            style={{
              fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
              fontSize: 30,
              fontWeight: 500,
              letterSpacing: "-0.015em",
              lineHeight: 1.18,
              color: "var(--text)",
              margin: 0,
            }}
          >
            Cutting through the noise with{" "}
            <em style={{ fontStyle: "italic", color: "var(--accent)", fontWeight: 500 }}>proprietary signal intelligence</em>
            {" "}to identify trading opportunities &ndash; six signals rolled into an overall{" "}
            <em style={{ fontStyle: "italic", color: "var(--accent)", fontWeight: 500 }}>MacroTilt Score</em>.
          </h2>
        </div>
        <FunnelCard totals={totals} scanDate={scanDate} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cell renderers
// ─────────────────────────────────────────────────────────────────────────

function ScoreCell({ value }) {
  if (value == null || !Number.isFinite(Number(value))) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  const n = Number(value);
  const color = n >=  50 ? "var(--green-text, var(--green))"
              : n >=  20 ? "var(--yellow-text, var(--text))"
              : n <= -50 ? "var(--red-text, var(--red))"
              : n <= -20 ? "var(--yellow-text, var(--text))"
              :            "var(--text-muted)";
  const sign = n > 0 ? "+" : "";
  return (
    <span style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 700, fontSize: 15, color }}>
      {sign}{n.toFixed(0)}
    </span>
  );
}

function BandPill({ value }) {
  // v5.5: display labels "Buy Watch" / "Sell Watch" (per Joe's mockup);
  // underlying band string in the DB stays "Watch Buy" / "Watch Sell".
  let bg, fg, label = value || "—";
  if      (value === "Strong Buy")  { bg = "var(--accent-soft, var(--surface-2))"; fg = "var(--green-text, var(--green))"; }
  else if (value === "Watch Buy")   { bg = "var(--surface-3, var(--surface-2))";   fg = "var(--yellow-text, var(--text))"; label = "Buy Watch"; }
  else if (value === "Neutral")     { bg = "var(--surface-3, var(--surface-2))";   fg = "var(--text-muted)"; }
  else if (value === "Watch Sell")  { bg = "var(--surface-3, var(--surface-2))";   fg = "var(--yellow-text, var(--text))"; label = "Sell Watch"; }
  else if (value === "Strong Sell") { bg = "var(--surface-3, var(--surface-2))";   fg = "var(--red-text, var(--red))"; }
  else                              { bg = "var(--surface-3, var(--surface-2))";   fg = "var(--text-dim)"; }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 999, fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, background: bg, color: fg, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function SubScoreCell({ value }) {
  // v5.3: distinguish "data missing for this name" (null -> n/a, italic +
  // amber dot) from "data fetched, score is exactly zero / quiet" (0 ->
  // plain "0" in normal text). Joe's call: "0 = we checked and there is
  // no insider buys/sells; — = we don't have the data."
  if (value == null || !Number.isFinite(Number(value))) {
    return (
      <span style={{ color: "var(--text-dim)", fontStyle: "italic", display: "inline-flex", alignItems: "center", gap: 4 }}
            title="No data for this signal on this name today (pipeline gap)">
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--yellow, #b89000)", opacity: 0.7 }} aria-hidden="true" />
        n/a
      </span>
    );
  }
  const n = Number(value);
  const color = n >=  50 ? "var(--green-text, var(--green))"
              : n >=  20 ? "var(--yellow-text, var(--text))"
              : n <= -50 ? "var(--red-text, var(--red))"
              : n <= -20 ? "var(--yellow-text, var(--text))"
              :            "var(--text-muted)";
  const sign = n > 0 ? "+" : "";
  return <span style={{ color, fontWeight: 600 }}>{sign}{n.toFixed(0)}</span>;
}

function renderCell(row, key) {
  const v = row[key];
  if (key === "ticker") return (
    <span style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{row.ticker}</span>
  );
  if (key === "name") {
    const display = shortName(v);
    return <span title={String(v || "")} style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{display}</span>;
  }
  if (key === "sector") {
    // v5.5b: GICS values come pre-cased ('Information Technology', 'REITs').
    // Don't run titleCaseSector -- it would mangle 'REITs' into 'Reits'.
    const display = v || "—";
    return <span title={String(v || "")} style={{ display: "inline-block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{display}</span>;
  }
  if (key === "ig") {
    const display = v || "—";
    return <span title={String(v || "")} style={{ display: "inline-block", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{display}</span>;
  }
  if (key === "price") {
    // Number(null) === 0 quirk: must short-circuit on v == null first or
    // every missing-close row would render as $0.00. (Joe caught this 5/10.)
    if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    return <span>{`$${Number(v).toFixed(2)}`}</span>;
  }
  if (key === "day_pct") {
    const formatted = fmtDay(v);
    if (formatted == null) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const cls = dayClass(v);
    const c = cls === "pos-val" ? "var(--green-text, var(--green))" : cls === "neg-val" ? "var(--red-text, var(--red))" : "var(--text-muted)";
    return <span style={{ color: c }}>{formatted}</span>;
  }
  if (key === "mcap") return <span>{fmtMcap(v)}</span>;
  if (key === "score") return <ScoreCell value={v} />;
  if (key === "band") return <BandPill value={v} />;
  if (key === "sub_insider" || key === "sub_options" || key === "sub_congress" || key === "sub_technicals" || key === "sub_analyst" || key === "sub_short_interest") {
    return <SubScoreCell value={v} />;
  }
  // ── v5.1 restored legacy columns ──
  if (key === "range_52w") {
    if (!v) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    return <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-2)" }}>{String(v)}</span>;
  }
  if (key === "iv_rank") {
    if (v == null || !Number.isFinite(Number(v))) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const n = Number(v);
    const c = n >= 70 ? "var(--red-text, var(--red))" : n >= 40 ? "var(--yellow-text)" : "var(--text-muted)";
    return <span style={{ color: c, fontWeight: 600 }}>{n.toFixed(0)}</span>;
  }
  if (key === "rsi_14") {
    if (v == null || !Number.isFinite(Number(v))) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const n = Number(v);
    const c = n >= 70 ? "var(--red-text, var(--red))" : n <= 30 ? "var(--yellow-text, var(--text))" : "var(--text-2)";
    return <span style={{ color: c, fontWeight: 600 }}>{n.toFixed(0)}</span>;
  }
  if (key === "bb_bw") {
    if (v == null || !Number.isFinite(Number(v))) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const n = Number(v);
    const c = n < 5 ? "var(--yellow-text)" : "var(--text-2)";
    return <span style={{ color: c }}>{n.toFixed(1)}%</span>;
  }
  if (key === "rvol_20d") {
    if (v == null || !Number.isFinite(Number(v))) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const n = Number(v);
    const c = n >= 1.5 ? "var(--green-text, var(--green))" : n < 0.7 ? "var(--yellow-text)" : "var(--text-2)";
    return <span style={{ color: c }}>{n.toFixed(2)}×</span>;
  }
  if (key === "pct_50ma" || key === "pct_200ma") {
    if (v == null || !Number.isFinite(Number(v))) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const n = Number(v);
    const c = n > 0 ? "var(--green-text, var(--green))" : n < 0 ? "var(--red-text, var(--red))" : "var(--text-muted)";
    return <span style={{ color: c }}>{`${n > 0 ? "+" : ""}${n.toFixed(1)}%`}</span>;
  }
  if (key === "ins_buys") {
    if (v == null || !Number.isFinite(Number(v))) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    return <span style={{ color: "var(--text-2)", fontWeight: 600 }}>{Number(v).toFixed(0)}</span>;
  }
  if (key === "ins_buy_$") {
    if (v == null || !Number.isFinite(Number(v))) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const n = Number(v);
    return <span style={{ color: "var(--text-2)" }}>{n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n.toFixed(0)}`}</span>;
  }
  if (v == null) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  return <span>{String(v)}</span>;
}

// ─────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────

export default function TradingOppsPage({ onOpenTicker }) {
  const { rows, scanDate, loading, error, totals } = useScanData();
  const [colState, setColState] = useState(() => loadColState());
  const [searchQ, setSearchQ] = useState("");
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [extraRows, setExtraRows] = useState([]);
  // v5.4 (item 3): filter-panel state.
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const filterPanelRef = useRef(null);
  const [draftFilter, setDraftFilter] = useState({ key: "score", op: ">", value: "" });
  const colMenuRef = useRef(null);
  const dragKeyRef = useRef(null);

  useEffect(() => { saveColState(colState); }, [colState]);

  useEffect(() => {
    const onDoc = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false);
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target)) setFilterPanelOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const allRows = useMemo(() => [...rows, ...extraRows], [rows, extraRows]);

  const filtered = useMemo(() => {
    const q = searchQ.toLowerCase().trim();
    // v5.4 item 3: column filters (in addition to the band pills + search).
    // Each colFilter = { id, key, op, value }.
    //   op = ">", ">=", "<", "<=", "=", "!=", "contains"
    //   For string columns, contains uses lower-case substring match.
    const colFilters = Array.isArray(colState.colFilters) ? colState.colFilters : [];
    const matchOne = (row, f) => {
      const v = row[f.key];
      // v5.5: "in" op holds an ARRAY of allowed values -- multi-select.
      // Used for categorical columns (Band, Sector, Industry).
      if (f.op === "in") {
        if (!Array.isArray(f.value) || f.value.length === 0) return true;
        return f.value.some(x => String(v).toLowerCase() === String(x).toLowerCase());
      }
      if (v == null) return false;
      if (f.op === "contains") {
        return String(v).toLowerCase().includes(String(f.value).toLowerCase());
      }
      const nA = Number(v);
      const nB = Number(f.value);
      if (Number.isFinite(nA) && Number.isFinite(nB)) {
        switch (f.op) {
          case ">":  return nA >  nB;
          case ">=": return nA >= nB;
          case "<":  return nA <  nB;
          case "<=": return nA <= nB;
          case "=":  return nA === nB;
          case "!=": return nA !== nB;
        }
      }
      if (f.op === "=")  return String(v).toLowerCase() === String(f.value).toLowerCase();
      if (f.op === "!=") return String(v).toLowerCase() !== String(f.value).toLowerCase();
      return false;
    };
    return allRows.filter(r => {
      if (q && !(r.ticker || "").toLowerCase().includes(q) && !(r.name || "").toLowerCase().includes(q)) return false;
      // Band-chip filter (existing).
      let bandOK = true;
      switch (colState.filter) {
        case "actionable":   bandOK = r.band === "Strong Buy" || r.band === "Watch Buy" || r.band === "Watch Sell" || r.band === "Strong Sell"; break;
        case "strong_buy":   bandOK = r.band === "Strong Buy"; break;
        case "watch_buy":    bandOK = r.band === "Watch Buy"; break;
        case "neutral":      bandOK = r.band === "Neutral"; break;
        case "watch_sell":   bandOK = r.band === "Watch Sell"; break;
        case "strong_sell":  bandOK = r.band === "Strong Sell"; break;
        case "held":         bandOK = r.band !== null; break; // placeholder
        case "watchlist":    bandOK = r.band !== null; break; // placeholder
        case "all":
        default: bandOK = true;
      }
      if (!bandOK) return false;
      // Column filters (all must pass).
      for (const f of colFilters) {
        if (!matchOne(r, f)) return false;
      }
      return true;
    });
  }, [allRows, searchQ, colState.filter, colState.colFilters]);

  const sorted = useMemo(() => {
    const k = colState.sort.key;
    const dir = colState.sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[k]; const bv = b[k];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, colState.sort]);

  // Row groups: Strong Buy > Watch Buy > Strong Sell > Watch Sell > Neutral > Insufficient Data.
  const groupOrder = ["strong_buy", "watch_buy", "strong_sell", "watch_sell", "neutral", "insufficient"];
  const groupMeta = {
    strong_buy:   { label: "Strong Buy",        dot: "var(--green-text, var(--green))" },
    watch_buy:    { label: "Watch Buy",         dot: "var(--yellow-text, var(--yellow))" },
    strong_sell:  { label: "Strong Sell",       dot: "var(--red-text, var(--red))" },
    watch_sell:   { label: "Watch Sell",        dot: "var(--yellow-text, var(--yellow))" },
    neutral:      { label: "Neutral",           dot: "var(--text-dim)" },
    insufficient: { label: "Insufficient Data", dot: "var(--text-dim)" },
  };

  const visibleCols = colState.order.filter(k => colState.visible.includes(k));

  const sortBy = (k) => {
    setColState(s => {
      if (s.sort.key === k) return { ...s, sort: { key: k, dir: s.sort.dir === "asc" ? "desc" : "asc" } };
      return { ...s, sort: { key: k, dir: "desc" } };
    });
  };

  const setFilter = (f) => setColState(s => ({ ...s, filter: f }));

  // v5.4 (item 3): column filter helpers.
  const addColFilter  = (f)  => setColState(s => ({ ...s, colFilters: [ ...(s.colFilters || []), { ...f, id: Date.now() + Math.random() } ] }));
  const removeColFilter = (id) => setColState(s => ({ ...s, colFilters: (s.colFilters || []).filter(x => x.id !== id) }));
  const clearColFilters = ()  => setColState(s => ({ ...s, colFilters: [] }));

  const toggleCol = (k) => {
    setColState(s => {
      const visible = s.visible.includes(k) ? s.visible.filter(x => x !== k) : [...s.visible, k];
      return { ...s, visible };
    });
  };

  const handleAddTicker = () => {
    // eslint-disable-next-line no-alert
    const sym = prompt("Add a ticker to the table (e.g. PLTR):");
    if (!sym) return;
    const t = String(sym).trim().toUpperCase();
    if (!t) return;
    if (allRows.some(r => r.ticker === t)) { alert(`${t} is already in the table.`); return; }
    setExtraRows(prev => [...prev, {
      ticker: t, name: "(custom add)", sector: "—", ig: "—",
      price: null, day_pct: null, mcap: null,
      score: null, band: "Neutral", band_group: "neutral",
      sub_insider: null, sub_options: null, sub_congress: null,
      sub_technicals: null, sub_analyst: null, sub_short_interest: null,
      so_what: null, cap_discount: null, _raw: {},
    }]);
  };

  const onDragStart = (e, key) => { dragKeyRef.current = key; e.dataTransfer.effectAllowed = "move"; e.target.classList.add("mt-drag-source"); };
  const onDragEnd = (e) => { e.target.classList.remove("mt-drag-source"); document.querySelectorAll(".mt-drag-over").forEach(x => x.classList.remove("mt-drag-over")); };
  const onDragOver = (e) => { if (!dragKeyRef.current) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; document.querySelectorAll(".mt-drag-over").forEach(x => x.classList.remove("mt-drag-over")); e.currentTarget.classList.add("mt-drag-over"); };
  const onDrop = (e, dropKey) => {
    e.preventDefault();
    const dragKey = dragKeyRef.current;
    dragKeyRef.current = null;
    if (!dragKey || dragKey === dropKey) return;
    setColState(s => {
      const order = [...s.order];
      const from = order.indexOf(dragKey);
      const to = order.indexOf(dropKey);
      if (from < 0 || to < 0) return s;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      return { ...s, order };
    });
  };

  // v5.1 (d): Held and Watchlist were placeholder filter chips that
  // returned every row when clicked -- confusing during UAT. Hidden until
  // the portfolio overlay is actually wired up (out of v5 scope).
  // v5.2: dropped Insufficient Data chip (the band no longer exists).
  const filterChips = [
    { f: "actionable",   label: "Actionable" },
    { f: "all",          label: "All" },
    { f: "strong_buy",   label: "Strong Buy" },
    { f: "watch_buy",    label: "Buy Watch" },
    { f: "neutral",      label: "Neutral" },
    { f: "watch_sell",   label: "Sell Watch" },
    { f: "strong_sell",  label: "Strong Sell" },
  ];

  return (
    <div style={{ minHeight: "100vh" }}>
      <ScannerTilesStrip />
      <Hero totals={totals} scanDate={scanDate} />

      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 32px" }}>
        {/* v5.4 (item 3): column-filter strip. Active filters render as
            removable chips. "+ Add filter" opens a popover with column /
            operator / value pickers. */}
        {(colState.colFilters || []).length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))", marginTop: 24 }}>
            <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", marginRight: 4 }}>
              Filters
            </span>
            {(colState.colFilters || []).map(f => {
              const c = COLUMNS.find(x => x.key === f.key);
              return (
                <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px 4px 10px", borderRadius: 999, background: "var(--accent-soft, var(--surface-2))", border: "1px solid var(--border)", color: "var(--text-2)", fontSize: 11.5, fontFamily: "var(--font-ui)" }}>
                  <span style={{ fontWeight: 600 }}>{c?.label || f.key}</span>
                  <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    {f.op === "in" ? "is one of" : f.op}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {Array.isArray(f.value)
                      ? (f.value.length <= 2
                          ? f.value.join(", ")
                          : `${f.value.slice(0, 2).join(", ")} +${f.value.length - 2}`)
                      : String(f.value)}
                  </span>
                  <button type="button" onClick={() => removeColFilter(f.id)} aria-label="Remove filter"
                    style={{ background: "transparent", border: 0, color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</button>
                </span>
              );
            })}
            <button type="button" onClick={clearColFilters}
              style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", padding: "4px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
              Clear all
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))", marginTop: (colState.colFilters||[]).length > 0 ? 8 : 24, marginBottom: 16 }}>
          {filterChips.map(c => {
            const active = colState.filter === c.f;
            return (
              <button
                key={c.f}
                type="button"
                onClick={() => setFilter(c.f)}
                style={{
                  background: active ? "var(--accent)" : "transparent",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  color: active ? "var(--surface)" : "var(--text-2)",
                  padding: "6px 13px",
                  borderRadius: 999,
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)",
                  transition: "all 0.15s",
                }}
              >
                {c.label}
              </button>
            );
          })}

          <div style={{ flex: 1 }} />

          <input
            type="text"
            placeholder="Search ticker..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12,
              minWidth: 200,
              fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)",
            }}
          />

          {/* v5.4 (item 3): + Filter popover. */}
          <div ref={filterPanelRef} style={{ position: "relative", display: "inline-block" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFilterPanelOpen(o => !o); }}
              style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-2)", padding: "6px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-ui)", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              + Filter
              {(colState.colFilters || []).length > 0 && (
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>{colState.colFilters.length}</span>
              )}
            </button>
            {filterPanelOpen && (() => {
              // v5.5: context-aware popover. Categorical column -> multi-select
              // checkbox list of distinct values. Numeric column -> operator + value.
              const selectedCol = COLUMNS.find(c => c.key === draftFilter.key) || COLUMNS[0];
              const isCategorical = !!selectedCol.categorical;
              // Distinct values for the selected column (sorted).
              const distinct = isCategorical ? Array.from(new Set(allRows.map(r => r[draftFilter.key]).filter(x => x != null && String(x).trim() !== ""))).sort((a, b) => String(a).localeCompare(String(b))) : [];
              const selectedSet = new Set(Array.isArray(draftFilter.value) ? draftFilter.value : []);
              const toggleVal = (v) => setDraftFilter(d => {
                const cur = new Set(Array.isArray(d.value) ? d.value : []);
                if (cur.has(v)) cur.delete(v); else cur.add(v);
                return { ...d, op: "in", value: [...cur] };
              });
              return (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg, 0 16px 48px rgba(0,0,0,0.20))", padding: 12, zIndex: 50, width: 340, maxHeight: 460, overflowY: "auto" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", paddingBottom: 8, borderBottom: "1px solid var(--border-faint, var(--border))", marginBottom: 10 }}>
                    Add column filter
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                      Column
                      <select value={draftFilter.key}
                        onChange={e => {
                          const newKey = e.target.value;
                          const c = COLUMNS.find(x => x.key === newKey);
                          // Reset draft when switching column type.
                          setDraftFilter(d => c?.categorical
                            ? { key: newKey, op: "in", value: [] }
                            : { key: newKey, op: ">", value: "" });
                        }}
                        style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "var(--font-ui)", color: "var(--text)" }}>
                        {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </label>

                    {isCategorical ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          Pick values ({selectedSet.size} selected of {distinct.length})
                        </div>
                        <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface-2)" }}>
                          {distinct.length === 0 ? (
                            <div style={{ padding: "10px 12px", fontSize: 11.5, color: "var(--text-dim)", fontStyle: "italic" }}>No values available for this column.</div>
                          ) : distinct.map(val => (
                            <label key={String(val)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12, color: "var(--text-2)", cursor: "pointer", borderBottom: "1px solid var(--border-faint, var(--border))" }}>
                              <input type="checkbox" checked={selectedSet.has(val)} onChange={() => toggleVal(val)} style={{ accentColor: "var(--accent)", cursor: "pointer" }} />
                              <span>{String(val)}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                          Operator
                          <select value={draftFilter.op === "in" ? ">" : draftFilter.op}
                            onChange={e => setDraftFilter(d => ({ ...d, op: e.target.value }))}
                            style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "var(--font-ui)", color: "var(--text)" }}>
                            <option value=">">{"greater than (>)"}</option>
                            <option value=">=">{"greater or equal (>=)"}</option>
                            <option value="<">{"less than (<)"}</option>
                            <option value="<=">{"less or equal (<=)"}</option>
                            <option value="=">{"equals (=)"}</option>
                            <option value="!=">{"not equal (!=)"}</option>
                            <option value="contains">{"contains text"}</option>
                          </select>
                        </label>
                        <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                          Value
                          <input type="text" value={typeof draftFilter.value === "string" ? draftFilter.value : ""}
                            onChange={e => setDraftFilter(d => ({ ...d, value: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter" && draftFilter.value !== "") { addColFilter(draftFilter); setDraftFilter({ key: draftFilter.key, op: draftFilter.op, value: "" }); setFilterPanelOpen(false); } }}
                            placeholder="e.g. 50, 1000000000"
                            style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, fontFamily: "var(--font-ui)", color: "var(--text)", boxSizing: "border-box" }} />
                        </label>
                      </>
                    )}

                    <button type="button"
                      disabled={isCategorical ? selectedSet.size === 0 : draftFilter.value === ""}
                      onClick={() => {
                        if (isCategorical && selectedSet.size === 0) return;
                        if (!isCategorical && draftFilter.value === "") return;
                        addColFilter(draftFilter);
                        setDraftFilter(isCategorical ? { key: draftFilter.key, op: "in", value: [] } : { key: draftFilter.key, op: draftFilter.op, value: "" });
                        setFilterPanelOpen(false);
                      }}
                      style={{ marginTop: 4, padding: "8px 12px", borderRadius: 8, background: (isCategorical ? selectedSet.size === 0 : draftFilter.value === "") ? "var(--surface-2)" : "var(--accent)", border: "1px solid var(--accent)", color: (isCategorical ? selectedSet.size === 0 : draftFilter.value === "") ? "var(--text-dim)" : "var(--surface)", fontSize: 12, fontFamily: "var(--font-ui)", cursor: (isCategorical ? selectedSet.size === 0 : draftFilter.value === "") ? "default" : "pointer", fontWeight: 600 }}>
                      Apply
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          <div ref={colMenuRef} style={{ position: "relative", display: "inline-block" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setColMenuOpen(o => !o); }}
              style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-2)", padding: "6px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              Columns
              <span style={{ color: "var(--text-dim)", marginLeft: 6 }}>{colState.visible.length}/{COLUMNS.length}</span>
            </button>
            {colMenuOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg, 0 16px 48px rgba(0,0,0,0.20))", padding: 8, zIndex: 50, minWidth: 280, maxHeight: 460, overflowY: "auto" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", padding: "6px 10px 8px", fontWeight: 600, borderBottom: "1px solid var(--border-faint, var(--border))", marginBottom: 4, fontFamily: "var(--font-mono, JetBrains Mono, monospace)" }}>
                  Show / hide &middot; Drag headers to reorder
                </div>
                {(() => {
                  const groups = {};
                  colState.order.forEach(k => {
                    const c = COLUMNS.find(x => x.key === k);
                    if (!c) return;
                    if (!groups[c.group]) groups[c.group] = [];
                    groups[c.group].push(c);
                  });
                  return Object.keys(groups).map(g => (
                    <div key={g}>
                      <div style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-dim)", padding: "8px 10px 4px", fontWeight: 600 }}>{g}</div>
                      {groups[g].map(c => (
                        <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 6, cursor: "pointer", color: "var(--text-2)", fontSize: 12, userSelect: "none" }}>
                          <input
                            type="checkbox"
                            checked={colState.visible.includes(c.key)}
                            onChange={() => toggleCol(c.key)}
                            style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                          />
                          <span>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleAddTicker}
            style={{ background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--surface)", padding: "6px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            + Add ticker
          </button>
        </div>

        {loading && (
          <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13, textAlign: "center", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", background: "var(--surface)" }}>
            Loading scan...
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 24, color: "var(--red-text, var(--red))", fontSize: 13, border: "1px solid var(--red, var(--border))", borderRadius: "var(--r-md, 16px)", background: "var(--surface)" }}>
            Trading Opps: failed to load scan ({error}).
          </div>
        )}
        {!loading && !error && allRows.length === 0 && (
          <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13, textAlign: "center", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", background: "var(--surface)" }}>
            No scan data yet - the daily scan runs after market close. Once it completes, the universe and the band counts will populate here automatically.
          </div>
        )}

        {!loading && !error && allRows.length > 0 && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))", overflow: "hidden" }}>
            <div style={{ overflowX: "auto", maxHeight: "70vh", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1400 }}>
                <thead>
                  <tr>
                    {visibleCols.map(k => {
                      const c = COLUMNS.find(x => x.key === k);
                      if (!c) return null;
                      const isSort = colState.sort.key === k;
                      const arrow = isSort ? (colState.sort.dir === "asc" ? "↑" : "↓") : "";
                      return (
                        <th
                          key={k}
                          draggable
                          onDragStart={(e) => onDragStart(e, k)}
                          onDragEnd={onDragEnd}
                          onDragOver={(e) => onDragOver(e, k)}
                          onDrop={(e) => onDrop(e, k)}
                          onClick={(e) => { if (!e.target.closest('[role="tooltip"]')) sortBy(k); }}
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 5,
                            background: "var(--surface-2)",
                            fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
                            fontSize: 10,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "var(--text-muted)",
                            fontWeight: 600,
                            padding: "11px 10px",
                            textAlign: c.numeric ? "right" : "left",
                            borderBottom: "1px solid var(--border)",
                            boxShadow: "0 1px 0 var(--border)",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            userSelect: "none",
                          }}
                        >
                          <Tooltip label={c.tt.label} body={c.tt.body} side="top">
                            <span>
                              {c.label}
                              {arrow && <span style={{ marginLeft: 4, color: "var(--accent)", fontSize: 9 }}>{arrow}</span>}
                            </span>
                          </Tooltip>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {/* v5.3 (c): band-group header rows removed. Band is a
                      column on every row -- a "WATCH BUY · 19" row above
                      19 watch-buy rows added nothing. Table renders flat
                      under any sort. (Joe: "We don't need the table
                      headers and to split the table for each band, we
                      have it as a column already.") */}
                  {sorted.map(r => (
                    <tr
                      key={r.ticker}
                      onClick={() => { if (typeof onOpenTicker === "function") onOpenTicker(r.ticker); }}
                      style={{ cursor: "pointer", transition: "background 0.12s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {visibleCols.map(k => {
                        const c = COLUMNS.find(x => x.key === k);
                        return (
                          <td key={k} style={{
                            padding: "11px 10px",
                            borderBottom: "1px solid var(--border-faint, var(--border))",
                            color: "var(--text-2)",
                            whiteSpace: "nowrap",
                            textAlign: c?.numeric ? "right" : "left",
                            fontVariantNumeric: c?.numeric ? "tabular-nums" : "normal",
                            fontFamily: c?.numeric ? "var(--font-mono, JetBrains Mono, monospace)" : undefined,
                          }}>
                            {renderCell(r, k)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ margin: "32px 0 24px", paddingTop: 16, borderTop: "1px solid var(--border-faint, var(--border))", textAlign: "center", color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono, JetBrains Mono, monospace)" }}>
          Daily scan refreshes after market close &middot; Sources: Polygon Massive &middot; Unusual Whales &middot; SEC Form 4 &middot; Quiver Quant
        </div>
      </div>

      <style>{`
        th.mt-drag-over { background: var(--accent-soft, var(--surface-2)) !important; }
        th.mt-drag-source { opacity: 0.4; }
        @keyframes mt-band-pulse-anim {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
          50%      { box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.04); }
        }
        .mt-band-pulse {
          animation: mt-band-pulse-anim 2.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
