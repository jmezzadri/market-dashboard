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
import PageHero from "../components/PageHero";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";
import ScannerTilesStrip from "../../components/ScannerTilesStrip";
import Scanner from "../../Scanner";
import MTTable from "../../components/MTTable";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────


// Default per-column pixel widths. Falls back to DEFAULT_COL_WIDTH when a
// column key isn't listed. Users can override via the drag-resize handle on
// each header right edge; overrides persist in colState.colWidths.
const DEFAULT_COL_WIDTH = 90;
const COL_DEFAULT_WIDTHS = {
  ticker: 80, name: 220, sector: 130, ig: 190,
  price: 80, day_pct: 80, mcap: 100, score: 90, band: 100,
  sub_insider: 80, sub_options: 80, sub_congress: 80,
  sub_technicals: 90, sub_analyst: 80, sub_short_interest: 100,
  range_52w: 140, iv_rank: 80, rsi_14: 80, bb_bw: 100, rvol_20d: 90,
  pct_50ma: 90, pct_200ma: 90, ins_buys: 90, "ins_buy_$": 100,
};
const COL_MIN_WIDTH = 30;
const COL_MAX_WIDTH = 600;
function widthFor(key, overrides) {
  const o = overrides && overrides[key];
  return (typeof o === "number" && o >= COL_MIN_WIDTH && o <= COL_MAX_WIDTH)
    ? o
    : (COL_DEFAULT_WIDTHS[key] || DEFAULT_COL_WIDTH);
}

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
    return { order: [...COL_KEYS], visible: [...DEFAULT_VISIBLE], sort: { key: "score", dir: "desc" }, filter: "all", colFilters: [], colWidths: {} };
  }
  const order = (saved.order || []).filter(k => COL_KEYS.includes(k));
  COL_KEYS.forEach(k => { if (!order.includes(k)) order.push(k); });
  const visible = (saved.visible || []).filter(k => COL_KEYS.includes(k));
  if (visible.length === 0) visible.push(...DEFAULT_VISIBLE);
  return {
    order,
    visible,
    sort: saved.sort || { key: "score", dir: "desc" },
    filter: (saved.filter && saved.filter !== "actionable") ? saved.filter : "all",
    colFilters: Array.isArray(saved.colFilters) ? saved.colFilters : [],
    colWidths: (saved.colWidths && typeof saved.colWidths === "object") ? saved.colWidths : {},
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
  // Day % parsing.
  //   Note the Number(null) === 0 quirk: a bare `Number(snap?.perc_change)`
  //   silently coerces null to 0, then Number.isFinite(0) is true, so the
  //   fallback never fires and every row paints 0.00%. The bug Joe flagged
  //   on 2026-05-12 was caused by that combined with the producer
  //   (universe_snapshots.perc_change) being null for 100% of rows.
  //   We now: (a) read perc_change only when it's NOT null/undefined, and
  //   (b) require both close and prev_close to be finite AND positive
  //   before computing the fallback.
  let dayPct = null;
  const pcRaw = snap?.perc_change;
  const pc = (pcRaw == null) ? NaN : Number(pcRaw);
  const prevRaw = snap?.prev_close;
  const prev = (prevRaw == null) ? NaN : Number(prevRaw);
  if (Number.isFinite(pc)) {
    dayPct = pc;
  } else if (Number.isFinite(close) && Number.isFinite(prev) && prev > 0) {
    dayPct = ((close - prev) / prev) * 100;
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

// ── In-session cache for the scan data ────────────────────────────────────
// The Trading Opps fetch costs ~9 Supabase round trips (latest_scan_date +
// paginated scan rows + paginated ticker_state_current + the ticker_reference
// count). On every fresh mount that's 2-4s. By caching the resolved state at
// module scope, re-entering /#portopps paints instantly from cache, then
// background-refreshes if the cache is older than CACHE_FRESH_MS.
//
// Cache shape:
//   _scanCache.state         — the same state object useScanData returns
//   _scanCache.fetchedAt     — ms epoch of last successful fetch (0 = never)
//   _scanCache.pending       — Promise of an in-flight fetch (null otherwise)
//   _scanCache.subscribers   — Set<setState> of mounted hooks to notify on update
const CACHE_FRESH_MS = 5 * 60 * 1000; // 5 minutes
const _EMPTY_TOTALS = { massive_total: null, universe_v5: null, scored_with_mt: 0, insufficient: 0, strong_buy: 0, watch_buy: 0, neutral: 0, watch_sell: 0, strong_sell: 0 };
const _scanCache = {
  state: null,
  fetchedAt: 0,
  pending: null,
  subscribers: new Set(),
};

function _notifyScanSubscribers() {
  for (const setter of _scanCache.subscribers) {
    try { setter(_scanCache.state); } catch (_) { /* setter unmounted */ }
  }
}

async function _fetchScanDataOnce() {
  try {
        // 1. Latest scan date in v5
        const latestRes = await supabase
          .from("signal_intel_v5_daily")
          .select("scan_date")
          .order("scan_date", { ascending: false })
          .limit(1);
        const latest = latestRes?.data?.[0]?.scan_date;
        if (!latest) {
          _scanCache.state = { rows: [], scanDate: null, loading: false, error: null, totals: _EMPTY_TOTALS };
          _scanCache.fetchedAt = Date.now();
          _notifyScanSubscribers();
          return _scanCache.state;
        }

        // 2. Pull ALL rows of today's scan via paginated range.
        let scanRows = [];
        const PAGE = 1000;
        for (let from = 0; from < 20000; from += PAGE) {
          const r = await supabase
            .from("signal_intel_v5_daily")
            .select("*")
            .eq("scan_date", latest)
            .in("band", ["Strong Buy", "Watch Buy", "Watch Sell", "Strong Sell"])
            .order("mt_score", { ascending: false, nullsFirst: false })
            .range(from, from + PAGE - 1);
          if (r.error) throw r.error;
          if (!r.data || r.data.length === 0) break;
          scanRows = scanRows.concat(r.data);
          if (r.data.length < PAGE) break;
        }

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

        // Fetch ALL bands (just the band column, not full rows) so the funnel
        // and band tiles still show the true totals even though the table is
        // filtered to actionable rows only. One small round-trip, ~30KB.
        let allBandsCounts = { strong_buy: 0, watch_buy: 0, watch_sell: 0, strong_sell: 0, neutral: 0, insufficient: 0, total: 0 };
        try {
          let allBandRows = [];
          for (let from = 0; from < 20000; from += 1000) {
            const r = await supabase
              .from("signal_intel_v5_daily")
              .select("band")
              .eq("scan_date", latest)
              .range(from, from + 999);
            if (r.error) break;
            if (!r.data || r.data.length === 0) break;
            allBandRows = allBandRows.concat(r.data);
            if (r.data.length < 1000) break;
          }
          allBandsCounts.total = allBandRows.length;
          for (const b of allBandRows) {
            if (b.band === "Strong Buy")        allBandsCounts.strong_buy++;
            else if (b.band === "Watch Buy")    allBandsCounts.watch_buy++;
            else if (b.band === "Watch Sell")   allBandsCounts.watch_sell++;
            else if (b.band === "Strong Sell")  allBandsCounts.strong_sell++;
            else if (b.band === "Insufficient Data") allBandsCounts.insufficient++;
            else                                 allBandsCounts.neutral++;
          }
        } catch (_) { /* leave zeros */ }

        const universeV5 = allBandsCounts.total || scanRows.length;
        const totals = {
          massive_total:      massiveTotal,
          universe_v5:        universeV5,
          scored_with_mt:     scanRows.filter(r => r.mt_score != null && Number.isFinite(Number(r.mt_score))).length,
          insufficient:       allBandsCounts.insufficient,
          strong_buy:         allBandsCounts.strong_buy,
          watch_buy:          allBandsCounts.watch_buy,
          neutral:            allBandsCounts.neutral,
          watch_sell:         allBandsCounts.watch_sell,
          strong_sell:        allBandsCounts.strong_sell,
        };

        _scanCache.state = { rows: shaped, scanDate: latest, loading: false, error: null, totals };
        _scanCache.fetchedAt = Date.now();
        _notifyScanSubscribers();
        return _scanCache.state;
  } catch (err) {
    _scanCache.state = { rows: [], scanDate: null, loading: false, error: err?.message || String(err), totals: _EMPTY_TOTALS };
    _scanCache.fetchedAt = Date.now();
    _notifyScanSubscribers();
    return _scanCache.state;
  }
}

function _ensureScanData() {
  if (_scanCache.pending) return _scanCache.pending;
  _scanCache.pending = (async () => {
    try {
      const result = await _fetchScanDataOnce();
      return result;
    } finally {
      _scanCache.pending = null;
    }
  })();
  return _scanCache.pending;
}

function useScanData() {
  // Initial state: serve from cache if we have one (even if stale — the
  // background refresh below will replace it). Otherwise show loading.
  const [state, setState] = useState(
    _scanCache.state || { rows: [], scanDate: null, loading: true, error: null, totals: _EMPTY_TOTALS }
  );

  useEffect(() => {
    _scanCache.subscribers.add(setState);
    const now = Date.now();
    const isFresh = _scanCache.state && (now - _scanCache.fetchedAt) < CACHE_FRESH_MS;
    if (!_scanCache.state) {
      // First-ever fetch (or after a failure that left state null)
      _ensureScanData();
    } else if (!isFresh) {
      // Stale — kick a background refresh; cache is served from initial state
      _ensureScanData();
    }
    // If fresh: nothing to do; cached state is already in `state`.
    return () => {
      _scanCache.subscribers.delete(setState);
    };
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
  // Canonical PageHero — locked 2026-05-13 (Joe directive — every page
  // header looks the same).
  return (
    <PageHero
      eyebrow="Trading Opportunities"
      title={<>Cutting through the noise with <em>proprietary signal intelligence</em> to identify trading opportunities &ndash; six signals rolled into an overall <em>MacroTilt Score</em>.</>}
      bullets={[
        "Full universe scan of U.S. equities",
        "Filter out micro and penny stocks",
        "Apply indicator logic (e.g., Congress, insiders, technicals, options flow, analyst ratings)",
        "Compute a single MacroTilt Score",
      ]}
      right={<FunnelCard totals={totals} scanDate={scanDate} />}
    />
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

// 2026-05-12 Joe directive: mirror the modal's three-state sub-score render
// on the table. Same map of which signals are vendor-restricted vs full
// coverage lives here — kept in sync with src/components/TickerDetailModal.jsx.
//   Vendor-restricted (render ⊘ when null): sub_analyst, sub_options
//   Full universe        (render ⚠ when null): sub_insider, sub_technicals,
//                                              sub_congress, sub_short_interest
const SUBSCORE_VENDOR_LIMITED = new Set(["sub_analyst", "sub_options"]);
const SUBSCORE_VENDOR_LABEL = {
  sub_analyst: "broker analyst coverage (~2,000 names)",
  sub_options: "Unusual Whales options coverage (~2,000 names with active options markets)",
};
const SUBSCORE_NICE_NAME = {
  sub_insider:        "Insider buying",
  sub_options:        "Options flow",
  sub_congress:       "Congress trades",
  sub_technicals:     "Technicals",
  sub_analyst:        "Analyst actions",
  sub_short_interest: "Short interest",
};

function SubScoreCell({ value, signalKey }) {
  if (value != null && Number.isFinite(Number(value))) {
    const n = Number(value);
    const color = n >=  50 ? "var(--green-text, var(--green))"
                : n >=  20 ? "var(--yellow-text, var(--text))"
                : n <= -50 ? "var(--red-text, var(--red))"
                : n <= -20 ? "var(--yellow-text, var(--text))"
                :            "var(--text-muted)";
    const sign = n > 0 ? "+" : "";
    const niceName = SUBSCORE_NICE_NAME[signalKey] || "signal";
    const tip = n === 0
      ? `We have the data — ${niceName.toLowerCase()} is neutral today (no bullish or bearish information from this feed).`
      : `${niceName} sub-score (-100 to +100). ${n > 0 ? "Positive = bullish" : "Negative = bearish"}.`;
    return <span style={{ color, fontWeight: 600, cursor: "help" }} title={tip}>{sign}{n.toFixed(0)}</span>;
  }
  const niceName = SUBSCORE_NICE_NAME[signalKey] || "this signal";
  if (SUBSCORE_VENDOR_LIMITED.has(signalKey)) {
    const vendorPhrase = SUBSCORE_VENDOR_LABEL[signalKey] || `${niceName.toLowerCase()} universe`;
    return (
      <span
        style={{ color: "var(--text-dim)", fontSize: 14, cursor: "help", borderBottom: "1px dotted var(--text-dim)" }}
        title={`Not in scanned universe. This ticker is outside the ${vendorPhrase}. The data feed only covers a subset of US-listed equities; this name isn't one of them. Expected — not a bug.`}
        aria-label="not in scanned universe"
      >⊘</span>
    );
  }
  return (
    <span
      style={{ color: "var(--red-text, var(--red))", fontSize: 14, fontWeight: 600, cursor: "help", borderBottom: "1px dotted var(--red-text, var(--red))" }}
      title={`Data missing — we should have ${niceName.toLowerCase()} for this ticker (full US-listed coverage). The latest scanner run didn't return a value — likely a pipeline gap. Engineering will catch on next freshness sweep.`}
      aria-label="data fetch failed"
    >⚠</span>
  );
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
    return <SubScoreCell value={v} signalKey={key} />;
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
// ─────────────────────────────────────────────────────────────────────────
// Main page (MTTable migration 2026-05-12 — unified-table sweep PR)
// ─────────────────────────────────────────────────────────────────────────

// Build MTTable column registry from the existing COLUMNS schema. Each
// COLUMNS entry already carries label/group/numeric/categorical/default/
// tooltip — we just reshape the keys MTTable expects.
const MTTABLE_COLUMNS = COLUMNS.map(c => ({
  key: c.key,
  label: c.label,
  numeric: !!c.numeric,
  categorical: !!c.categorical,
  group: c.group,
  defaultVisible: !!c.default,
  defaultWidth: COL_DEFAULT_WIDTHS[c.key] || DEFAULT_COL_WIDTH,
  tooltip: c.tt ? `${c.tt.label} — ${c.tt.body}` : undefined,
  sortValue: (r) => r[c.key],
  render: (r) => renderCell(r, c.key),
}));

// Band-filter chips. v5.1 (d): Held / Watchlist placeholders removed.
const BAND_CHIPS = [
  { value: "__all__",      label: "All" },
  { value: "Strong Buy",   label: "Strong Buy" },
  { value: "Watch Buy",    label: "Buy Watch" },
  { value: "Watch Sell",   label: "Sell Watch" },
  { value: "Strong Sell",  label: "Strong Sell" },
];

export default function TradingOppsPage({ onOpenTicker }) {
  const { rows, scanDate, loading, error, totals } = useScanData();
  const [extraRows, setExtraRows] = useState([]);
  const [bandFilter, setBandFilter] = useState("__all__");
  // Scanner detail modal state — ScannerTilesStrip clicks set this to one
  // of congress|insiders|flow|technicals; the modal renders <Scanner /> with
  // that view forced. Null = modal closed.
  const [scannerView, setScannerView] = useState(null);

  // Lock body scroll while the scanner detail modal is open.
  useEffect(() => {
    if (!scannerView) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setScannerView(null); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [scannerView]);

  // 2026-05-13 — listen for the "mt:scanner:set-view" event dispatched
  // by TickerDetailModal's "See full screener →" links. When the dossier
  // closes, the user lands on this page; the event opens the scanner
  // overlay for the requested section (Congress / Insiders / Flow /
  // Technicals) instead of dumping them at the top of the table.
  useEffect(() => {
    function onSetView(e) {
      const v = e?.detail?.view;
      if (["congress","insiders","flow","technicals"].includes(v)) {
        setScannerView(v);
      }
    }
    window.addEventListener("mt:scanner:set-view", onSetView);
    // Also read the sessionStorage marker on mount, in case the dossier
    // dispatched the event before this page was even rendered.
    try {
      const v = sessionStorage.getItem("mt:scanner:initial-view");
      if (v && ["congress","insiders","flow","technicals"].includes(v)) {
        sessionStorage.removeItem("mt:scanner:initial-view");
        setScannerView(v);
      }
    } catch (_) { /* private mode */ }
    return () => window.removeEventListener("mt:scanner:set-view", onSetView);
  }, []);

  // Merge custom-added tickers with the scan rows.
  const allRows = useMemo(() => [...rows, ...extraRows], [rows, extraRows]);

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

  return (
    <>
    <div style={{ minHeight: "100vh" }}>
      <Hero totals={totals} scanDate={scanDate} />

      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 32px" }}>
        <ScannerTilesStrip onTileClick={(v) => setScannerView(v)} />

        {loading && (
          <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13, textAlign: "center", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", background: "var(--surface)", marginTop: 24 }}>
            Loading scan...
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 24, color: "var(--red-text, var(--red))", fontSize: 13, border: "1px solid var(--red, var(--border))", borderRadius: "var(--r-md, 16px)", background: "var(--surface)", marginTop: 24 }}>
            Trading Opps: failed to load scan ({error}).
          </div>
        )}
        {!loading && !error && allRows.length === 0 && (
          <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13, textAlign: "center", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", background: "var(--surface)", marginTop: 24 }}>
            No scan data yet — the daily scan runs after market close. Once it completes, the universe and the band counts will populate here automatically.
          </div>
        )}

        {!loading && !error && allRows.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <MTTable
              columns={MTTABLE_COLUMNS}
              rows={allRows}
              rowKey="ticker"
              onRowClick={(r) => { if (typeof onOpenTicker === "function") onOpenTicker(r.ticker); }}
              storageKey="portopps_v5"
              features="full"
              toolbar={{
                chips: {
                  current: bandFilter,
                  options: BAND_CHIPS,
                  onSet: setBandFilter,
                  predicate: (row, current) => {
                    if (current === "__all__") return true;
                    return row.band === current;
                  },
                },
                search: {
                  placeholder: "Search ticker...",
                  fields: ["ticker", "name"],
                },
                addAction: {
                  label: "+ Add ticker",
                  onClick: handleAddTicker,
                },
              }}
            />
          </div>
        )}

        <div style={{ margin: "32px 0 24px", paddingTop: 16, borderTop: "1px solid var(--border-faint, var(--border))", textAlign: "center", color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono, JetBrains Mono, monospace)" }}>
          Daily scan refreshes after market close · Sources: Polygon Massive · Unusual Whales · SEC Form 4 · Quiver Quant
        </div>
      </div>
    </div>

    {scannerView && (
      // Use the same modal-backdrop pattern as TickerDetailModal so the
      // sheet centers properly and the surrounding chrome (side nav, page
      // header) blurs out instead of bleeding through. Joe 2026-05-13: the
      // overlay was "jammed up" — too light a blur and too wide a sheet,
      // so the modal didn't feel centered against the visible content.
      <div className="modal-backdrop" onClick={() => setScannerView(null)}>
        <div
          className="modal-wrap"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-lg, 14px)",
            boxShadow: "0 18px 48px rgba(0,0,0,0.18)",
            overflow: "hidden",
          }}
        >
          <Scanner
            key={scannerView}
            embeddedMode
            forceInitialView={scannerView}
            onClose={() => setScannerView(null)}
            onOpenTicker={onOpenTicker}
          />
        </div>
      </div>
    )}
    </>
  );
}
