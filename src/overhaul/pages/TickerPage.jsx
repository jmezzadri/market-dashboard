/* Ticker Detail — Wired to real data 2026-05-27 evening.

   Replaces the empty-state version that shipped earlier today (PR #841)
   with live data from existing hooks. Every tab now reads real values
   when the user is authenticated; em-dashes gracefully otherwise.

   Data sources:
   - useTickerEvents       → insider / dark pool / news events (3x/weekday
                             event streams)
   - useUniverseSnapshot   → close, prev_close, high, low, 52w hi/lo,
                             avg vol, marketcap, IV rank, IV30d, implied
                             moves, call/put volume + premium, put/call
                             ratio, next earnings date (3x/weekday)
   - useTickerTechnicalsLive → RSI(14), MACD cross, %vs MA50/200,
                             vol surge, week/month/YTD change, SPY-relative
                             (Yahoo daily, computed on the fly)
   - useV5ScanBatch        → per-category sub-scores (Technicals, Insider,
                             Options, Analyst, Congress, Short Interest) +
                             insider buy count + buy dollars (signal_intel_v5)
   - useTickerDeepDive     → ticker_reference (exchange, country, etc.),
                             recent dividends, recent splits
   - useMassiveTickerInfo  → full name from Polygon
   - useTradingOppsTop     → scanner row for price/score/signal/sector

   Layout follows the prototype tk-* class set unchanged.

   Cream rebrand Phase B (2026-07-07): page moved from the home-v11 glass
   scope to the shared home-v12 cream system (cream-system.css) with page
   styles in ticker-v12.css. RESKIN ONLY — classNames, layout wrappers and
   CSS; zero data/logic/chip changes. The chart canvas keeps reading the
   app's --mt-* theme tokens (SVG strokes/fills are var(--mt-*) references),
   bridged to the cream palette in ticker-v12.css — no chart code touched.
   The TradingView embed keeps its own hardcoded light/dark widget config
   (chart-internals theming is a later pass).
*/

import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/cream-system.css';
import '../styles/ticker-v12.css';
import { useParams, useNavigate } from 'react-router-dom';
import { latestTradingSessionDate } from '../../lib/freshnessClock';
import BigHistoryChart from '../components/BigHistoryChart';
import TradingViewChart, { tvSymbolFor } from '../components/TradingViewChart';
import ScoreDial from '../components/ScoreDial';
import FreshnessChip from '../components/FreshnessChip';
import useLseLive from '../../hooks/useLseLive';
import Tip from '../components/Tip';
import useMassiveTickerInfo from '../../hooks/useMassiveTickerInfo';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import useTickerPositioning from '../../hooks/useTickerPositioning';
import { useTickerEvents } from '../../hooks/useTickerEvents';
import { useUniverseSnapshot } from '../../hooks/useUniverseSnapshot';
import useTickerTechnicalsLive from '../../hooks/useTickerTechnicalsLive';
import useTickerDeepDive from '../../hooks/useTickerDeepDive';
import useTickerSuggestions from '../../hooks/useTickerSuggestions';
import useV5ScanBatch from '../../hooks/useV5ScanBatch';
import useEdgarInsider from '../../hooks/useEdgarInsider';
import useTickerEodHistory from '../../hooks/useTickerEodHistory';
import useTickerEodPrice from '../../hooks/useTickerEodPrice';
import usePowerTrendRank from '../../hooks/usePowerTrendRank';
import useDivergenceScan from '../../hooks/useDivergenceScan';
import { buildScanBreakdown } from '../lib/scoreWeights';

/* Plain-English reading for each scanner score component, from the scan row.
   Mirrors the Scanner drill so the ticker page and scanner never disagree. */
function readingForScan(key, r) {
  if (!r) return '—';
  if (key === 'Insider') {
    const rules = r.insider_rules?.length ? r.insider_rules.join(' + ') : '—';
    return `Rules ${rules}${r.insider_age_days != null ? ` · ${r.insider_age_days}d old` : ''}`;
  }
  if (key === 'Technicals') {
    const pct = r.sma200_pct;
    const trend = pct == null ? '—' : `${pct >= 0 ? 'above' : 'below'} 200-day by ${Math.abs(pct).toFixed(1)}%`;
    return `${trend}${r.rsi != null ? ` · RSI ${r.rsi.toFixed(0)}` : ''}`;
  }
  return '—';
}

/* Simple trailing moving average over a [{date, close}] series. Returns an
   array of [date, value|null] aligned 1:1 — null during the warm-up window
   so the line just starts later instead of bending toward zero. */
function sma(rows, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].close;
    if (i >= period) sum -= rows[i - period].close;
    out.push([rows[i].date, i >= period - 1 ? sum / period : null]);
  }
  return out;
}

/* Wilder 14-day RSI over a [{date, close}] series. Returns [date, rsi|null]
   aligned 1:1 — null during the warm-up window. Same method as the engine. */
function rsiWilder(rows, period = 14) {
  const out = rows.map((r) => [r.date, null]);
  if (rows.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = rows[i].close - rows[i - 1].close;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  const rsiNow = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = [rows[period].date, rsiNow()];
  for (let i = period + 1; i < rows.length; i++) {
    const ch = rows[i].close - rows[i - 1].close;
    const g = ch >= 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = [rows[i].date, rsiNow()];
  }
  return out;
}

const TFS = ['1M', '3M', '6M', '1Y', '5Y', 'Max'];

/* Beta vs a benchmark from two [{date, close}] daily series: covariance of
   daily returns over variance of benchmark returns, over the trailing
   `lookback` overlapping sessions. Returns null when the overlap is too thin
   to be meaningful (< 120 sessions ≈ 6 months). Standard market-model beta —
   display-only, feeds no score. */
function betaVsBench(rows, benchRows, lookback = 252) {
  if (!rows?.length || !benchRows?.length) return null;
  const bench = new Map(benchRows.map((r) => [r.date, r.close]));
  const pairs = [];
  for (const r of rows) {
    const b = bench.get(r.date);
    if (r.close != null && b != null) pairs.push([r.close, b]);
  }
  const win = pairs.slice(-Math.max(lookback + 1, 0));
  if (win.length < 121) return null;
  const rs = [], rb = [];
  for (let i = 1; i < win.length; i++) {
    rs.push(win[i][0] / win[i - 1][0] - 1);
    rb.push(win[i][1] / win[i - 1][1] - 1);
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const ms = mean(rs), mb = mean(rb);
  let cov = 0, varB = 0;
  for (let i = 0; i < rs.length; i++) {
    cov += (rs[i] - ms) * (rb[i] - mb);
    varB += (rb[i] - mb) * (rb[i] - mb);
  }
  if (varB <= 0) return null;
  return cov / varB;
}

/* Dividend yield from the stored corporate-actions rows (Polygon pipeline):
   annualize the latest REGULAR cash dividend by its declared frequency
   (falling back to a trailing-12-month sum when frequency is absent), divided
   by the last close. Returns { value, note }:
     value  — fraction (0.031 = 3.1%) or null
     note   — 'none'  → no dividends on record (render "None")
              'stale' → last dividend > ~13 months ago (render "—")
              null    → value is current */
function divYieldFromRecords(dividends, price) {
  const rows = (dividends || []).filter((d) => d.cash_amount != null);
  if (!rows.length) return { value: null, note: 'none' };
  // Regular cash dividends only — specials (SC/LT/ST) don't annualize.
  const regular = rows.filter((d) => !d.dividend_type || d.dividend_type === 'CD');
  if (!regular.length || !(price > 0)) return { value: null, note: 'none' };
  const latest = regular[0]; // hook returns ex-date DESC
  const exDate = latest.ex_dividend_date ? new Date(`${latest.ex_dividend_date}T00:00:00Z`) : null;
  if (exDate && (Date.now() - exDate.getTime()) > 400 * 24 * 3600 * 1000) {
    return { value: null, note: 'stale' };
  }
  const freq = Number(latest.frequency);
  let annual = null;
  if (Number.isFinite(freq) && freq > 0) {
    annual = Number(latest.cash_amount) * freq;
  } else {
    const cutoff = Date.now() - 366 * 24 * 3600 * 1000;
    annual = regular
      .filter((d) => d.ex_dividend_date && new Date(`${d.ex_dividend_date}T00:00:00Z`).getTime() >= cutoff)
      .reduce((s, d) => s + Number(d.cash_amount || 0), 0);
    if (!(annual > 0)) return { value: null, note: 'stale' };
  }
  return { value: annual / price, note: null };
}

/* Curated overlay universe for the compare box (all carried in prices_eod with
   ~6y of history), grouped for the dropdown. The user can also type ANY ticker
   into the box — it isn't limited to this list. */
const OVERLAY_UNIVERSE = [
  ['Indexes', [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100'], ['IWM', 'Russell 2000'], ['DIA', 'Dow 30'], ['VTI', 'US total market'], ['EFA', 'Developed ex-US'], ['EEM', 'Emerging markets']]],
  ['Sectors', [['XLK', 'Technology'], ['XLF', 'Financials'], ['XLE', 'Energy'], ['XLV', 'Health care'], ['XLI', 'Industrials'], ['XLY', 'Consumer disc.'], ['XLP', 'Consumer staples'], ['XLU', 'Utilities'], ['XLB', 'Materials'], ['XLRE', 'Real estate'], ['XLC', 'Communications']]],
  ['Commodities & FX', [['GLD', 'Gold'], ['SLV', 'Silver'], ['USO', 'Crude oil'], ['UNG', 'Natural gas'], ['DBC', 'Commodities'], ['UUP', 'US dollar']]],
  ['Bonds & rates', [['TLT', '20y+ Treasuries'], ['IEF', '7-10y Treasuries'], ['AGG', 'US agg bonds'], ['HYG', 'High-yield'], ['LQD', 'Inv-grade credit'], ['TIP', 'TIPS']]],
  ['Volatility', [['VIXY', 'VIX futures']]],
  ['Mega-caps', [['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'Nvidia'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta'], ['TSLA', 'Tesla'], ['JPM', 'JPMorgan'], ['V', 'Visa'], ['UNH', 'UnitedHealth'], ['XOM', 'Exxon'], ['JNJ', 'J&J'], ['WMT', 'Walmart'], ['PG', 'P&G']]],
];
const BENCH_LABEL = Object.fromEntries(OVERLAY_UNIVERSE.flatMap(([, items]) => items));
/* Detail feeds shown in the activity section. Score composition is NOT here —
   it's an always-visible section, not a per-source feed. */
/* Insider lives inside the score card now — not duplicated here. */
const TABS = [
  ['short',   'Short interest'],
  ['news',    'News'],
  ['fund',    'Fundamentals'],
];

/* ---------- formatters ---------- */

function fmt(v, decimals = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  /* Prices always render the full decimal count ($7.70, never $7.7) — every
     call on this page is a price; standard quote convention (2026-07-28). */
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
function fmt$(v, decimals = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(decimals)}`;
}
function fmtVol(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}
function fmtPct(v, decimals = 1) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}
function fmtPctFraction(v, decimals = 1) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return fmtPct(Number(v) * 100, decimals);
}
function fmtMcap(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}
function fmtDateShort(s) {
  if (!s) return '—';
  try {
    // Date-only values (YYYY-MM-DD, e.g. a trade_date) must be read in UTC,
    // otherwise a browser west of UTC renders them one calendar day early
    // ("May 29" close shows as "May 28"). Force UTC so the displayed day
    // matches the stored session date.
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch { return '—'; }
}
function fmtTimeAgo(s) {
  if (!s) return '—';
  try {
    const t = new Date(s).getTime();
    const diffH = (Date.now() - t) / 3.6e6;
    if (diffH < 1)    return `${Math.round(diffH * 60)}m ago`;
    if (diffH < 24)   return `${Math.round(diffH)}h ago`;
    const days = Math.round(diffH / 24);
    if (days <= 14)   return `${days}d ago`;
    return fmtDateShort(s);
  } catch { return '—'; }
}

/* ---------- score model (canonical — mirrors the nightly engine) ----------

   The displayed MacroTilt Score is the engine's ADDITIVE score, not a
   weighted average. The four components contribute points that sum to the
   badge. The rule text and thresholds below are the engine's own calibrated
   values, so the page can never disagree with how a name was actually scored. */
const INSIDER_RULES = {
  A: 'A C-suite officer bought on the open market, lifting their personal stake by at least 10% and worth at least $100,000.',
  B: "Open-market insider buying over the last 30 days added up to at least 0.05% of the company's market value.",
  C: 'Three or more different insiders bought on the open market within the 30-day window.',
};
/* Positive ceiling each component can contribute — used only to size its bar. */
const SCORE_CAPS = { Insider: 4, Technicals: 1 };

/* The engine fades insider points for age: full weight through day 15, then a
   straight line down to zero at day 31. Returns the share of full weight left. */
function insiderAgeWeight(ageDays) {
  if (ageDays == null || !Number.isFinite(Number(ageDays))) return null;
  const a = Number(ageDays);
  if (a <= 15) return 1;
  if (a >= 31) return 0;
  return (31 - a) / (31 - 15);
}

/* Format insider Form-4 transaction code (P=open-market buy, S=open-market
   sell, etc.). */
function insiderActionLabel(payload) {
  const code = (payload?.transaction_code || payload?.transaction_type || '').toString().toUpperCase();
  if (code.includes('P') || code === 'BUY')  return { label: 'BUY',  cls: 'mt-tag--calm' };
  if (code.includes('S') || code === 'SELL') return { label: 'SELL', cls: 'mt-tag--extreme' };
  return { label: code || '—', cls: 'mt-tag--range' };
}

function insiderRoleLabel(payload) {
  if (!payload) return '—';
  if (payload.is_ten_percent) return '10%+ owner';
  if (payload.is_officer)     return payload.title || 'Officer';
  if (payload.is_director)    return payload.title || 'Director';
  return payload.title || '—';
}

/* Reveal — scroll-reveal wrapper, same pattern as HomePage/MacroPage/
   ScannerPage (v12 system). Replays in BOTH directions; state lives in React
   so data-poll re-renders preserve the revealed class. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVis(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`${className} rv${vis ? ' in' : ''}`} {...rest}>{children}</Tag>;
}

/* ---------- main component ---------- */

export default function TickerPage() {
  const { symbol } = useParams();
  const sym = (symbol || '').toUpperCase();
  const navigate = useNavigate();

  const info = useMassiveTickerInfo(sym);
  const scanner = useTradingOppsTop(60);
  const events = useTickerEvents({ daysBack: 90 });
  const universe = useUniverseSnapshot();
  const tech = useTickerTechnicalsLive(sym);
  const deep = useTickerDeepDive(sym);
  const v5Map = useV5ScanBatch([sym]);
  const eod = useTickerEodPrice(sym);
  const histAll = useTickerEodHistory(sym);
  const spyHist = useTickerEodHistory(sym === 'SPY' ? null : 'SPY'); // beta benchmark
  const powerTrend = usePowerTrendRank(sym);
  const divergence = useDivergenceScan();
  const positioning = useTickerPositioning(sym);

  const [tab, setTab] = useState('news');
  const [tf, setTf]   = useState('1Y');
  const [show50, setShow50]       = useState(false);
  const [show200, setShow200]     = useState(false);
  const [showVol, setShowVol]     = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [chartMode, setChartMode] = useState('mt'); // 'mt' = our chart, 'tv' = TradingView
  const [showRsi, setShowRsi]       = useState(false);
  const [compareSym, setCompareSym] = useState('');
  const [fromDate, setFromDate]     = useState('');   // custom range start (YYYY-MM-DD)
  const [toDate, setToDate]         = useState('');    // custom range end
  const compareHist = useTickerEodHistory(compareSym || null);

  const scanRow = (scanner.rows || []).find((r) => r.ticker === sym);
  const snap = universe.byTicker?.get?.(sym) || null;
  const v5Row = v5Map?.byTicker?.[sym] || null;
  const eventsForSym = events.byTicker?.get?.(sym) || { news: [], insider: [], congress: [], darkpool: [] };

  /* The scanner row is the canonical 0–5 MacroTilt Score. If the scanner
     doesn't carry this ticker (it ranks only the top discovery names), there
     is simply no score for it — handled below. */
  const sector  = scanRow?.sector || snap?.sector || 'Equity';
  /* Single price anchor: prices_eod (real last close + its trade_date) is
     canonical so the header price, the chart, and the freshness chip all
     agree on one date. Snapshot / scanner only fill gaps. */
  const price   = eod?.last_close ?? snap?.close ?? scanRow?.price ?? 0;
  /* Whether a REAL price exists anywhere. The `?? 0` above keeps the chart and
     the derived maths from blowing up on a null, but a rendered "$0.00" is a
     substituted number, which we never show (LESSONS 4.4) — a covered symbol
     with no stored close yet (fresh listing, thin name) gets an em-dash. */
  const hasPrice = eod?.last_close != null || snap?.close != null || scanRow?.price != null;
  const chgPct  = eod?.day_pct != null
    ? Number(eod.day_pct)
    : (snap?.perc_change != null
        ? Number(snap.perc_change) * (Math.abs(snap.perc_change) < 1 ? 100 : 1)
        : (scanRow?.chg ?? 0));
  const prevClose = eod?.prev_close ?? snap?.prev_close ?? null;
  const priceAsOf = eod?.trade_date || null;
  // A prices_eod row dated later than the latest COMPLETED NYSE session is an
  // in-progress (intraday) print from the same-day Yahoo fallback — it is NOT
  // a close yet. Label it "intraday" until the 4 PM ET bell, then "close".
  const _completedSession = latestTradingSessionDate();
  const _completedIso = _completedSession
    ? _completedSession.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    : null;
  const isIntraday = !!(priceAsOf && _completedIso && priceAsOf > _completedIso);
  const asOfVerb = isIntraday ? 'intraday' : 'close';
  const exchange  = deep?.ref?.primary_exchange || info?.exchange || null;
  /* Market cap waterfall (2026-07-20): the retiring UW snapshot only covers
     its own ≥$1B flickering universe, which left names like PBF blank.
     ticker_reference (daily Massive cron, ~13K tickers) now backstops it. */
  const marketcap = snap?.marketcap ?? scanRow?.marketCap ?? deep?.ref?.market_cap ?? v5Row?.market_cap ?? null;
  const stockVol  = snap?.stock_volume ?? scanRow?.volume ?? null;

  /* Which scanner surfaced this name (2026-07-20) — the score block is scoped
     to Insider-scan names; everything else shows its source scanner instead
     of a dead "no score" dial. */
  /* Live price — LSE 1-minute bars (display only; ~10 s behind the tape,
     shared server cache). Uncovered names (LSE carries ~4,000 US stocks +
     major ETFs) render an em-dash — never a substituted number
     (Joe 2026-07-27; LESSONS 4.4). */
  const lseLive = useLseLive([sym], { enabled: !!sym });
  const liveQ = lseLive.bySymbol?.[sym] || null;
  const livePrice = liveQ && liveQ.covered && liveQ.price != null ? liveQ.price : null;
  // Move vs the last COMPLETED close: when the EOD row is itself an intraday
  // print, the completed close is prev_close; otherwise it is last_close.
  const liveBase = isIntraday ? prevClose : (price || null);
  const livePct = livePrice != null && liveBase > 0 ? ((livePrice / liveBase) - 1) * 100 : null;
  /* Live-first hero (Joe 2026-07-28): while the market is OPEN and the live
     feed covers this name, the live price is the headline number — nobody
     leads with yesterday's close during trading hours. The official close
     demotes to the small reference line. Closed market, uncovered names, or
     a missing base keep the close-first block unchanged. */
  const liveHero = lseLive.marketOpen === true && livePrice != null && livePct != null;

  const ptRow = powerTrend.row;
  const rsiHits = useMemo(() => {
    const hits = [];
    for (const r of (divergence.bull || [])) if (r.ticker === sym) hits.push({ dir: 'Bullish', strong: r.strong });
    for (const r of (divergence.bear || [])) if (r.ticker === sym) hits.push({ dir: 'Bearish', strong: r.strong });
    return hits;
  }, [divergence.bull, divergence.bear, sym]);

  /* Signal pill — derive from scanner row only; hide otherwise. */
  const signal    = (scanRow?.signal || '').toString().toUpperCase();
  const direction = signal === 'BUY' ? 'LONG' : signal === 'SELL' ? 'SHORT' : '';

  /* Price chart — REAL daily history from prices_eod. SMAs are computed over
     the full history then sliced to the visible window so they're accurate at
     the left edge. Volume, moving-average, event, and compare overlays are all
     toggled by the buttons under the chart. */
  const tfMap = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '5Y': 1260, Max: 100000 };
  const hist = histAll.rows || [];

  /* Key stats — sourced from data that actually exists for the scanner's
     discovery names. universe_snapshots only covers the large-cap universe, so
     small-caps (NEWT, ANNX, XRN, …) have no snap row and every snap-sourced
     stat blanked out. The real values are in prices_eod (the latest daily bar)
     and the scan row (52-week range, market cap, IV). */
  const lastBar = hist.length ? hist[hist.length - 1] : null;
  const hi52 = scanRow?.week52High ?? snap?.week_52_high ??
    (hist.length ? Math.max(...hist.slice(-252).map((r) => (r.high ?? r.close))) : null);
  const lo52 = scanRow?.week52Low ?? snap?.week_52_low ??
    (hist.length ? Math.min(...hist.slice(-252).map((r) => (r.low ?? r.close))) : null);
  const avgVol = snap?.avg30_volume ??
    (hist.length ? hist.slice(-30).reduce((s, r) => s + (r.volume || 0), 0) / Math.min(30, hist.length) : null);
  /* Beta + dividend yield are computed from data we already store — a year of
     daily closes vs SPY (prices_eod) and the Polygon corporate-actions rows.
     The old IV Rank / IV 30d tiles are gone with the UW feed (retires 8/12). */
  const beta1y = useMemo(
    () => (sym === 'SPY' ? 1 : betaVsBench(hist, spyHist.rows || [], 252)),
    [sym, hist, spyHist.rows],
  );
  const divYield = useMemo(
    () => divYieldFromRecords(deep?.dividends, price),
    [deep?.dividends, price],
  );
  const sma50Full  = useMemo(() => sma(hist, 50), [hist]);
  const sma200Full = useMemo(() => sma(hist, 200), [hist]);
  const rsiFull    = useMemo(() => rsiWilder(hist, 14), [hist]);
  const customRange = Boolean(fromDate || toDate);
  const windowRows = useMemo(() => {
    if (customRange) {
      return hist.filter((r) => (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate));
    }
    const n = tfMap[tf] || 252;
    return hist.slice(Math.max(0, hist.length - n));
  }, [hist, tf, customRange, fromDate, toDate]);
  const windowDates = useMemo(() => new Set(windowRows.map((r) => r.date)), [windowRows]);
  const series   = useMemo(() => windowRows.map((r) => [r.date, r.close]), [windowRows]);
  const sma50Win  = useMemo(() => sma50Full.filter(([d]) => windowDates.has(d)), [sma50Full, windowDates]);
  const sma200Win = useMemo(() => sma200Full.filter(([d]) => windowDates.has(d)), [sma200Full, windowDates]);
  const rsiWin    = useMemo(() => rsiFull.filter(([d]) => windowDates.has(d)), [rsiFull, windowDates]);
  const volumeWin = useMemo(() => windowRows.map((r) => [r.date, r.volume]), [windowRows]);
  const compareSeries = useMemo(() => (compareHist.rows || []).map((r) => [r.date, r.close]), [compareHist.rows]);
  const chartEvents = useMemo(() => {
    if (!windowRows.length) return [];
    const dates = windowRows.map((r) => r.date);
    const snapDate = (iso) => {
      if (!iso) return null;
      const d = String(iso).slice(0, 10);
      let best = null;
      for (const wd of dates) { if (wd <= d) best = wd; else break; }
      return best;
    };
    const evs = [];
    // Only the score-driving open-market BUYS — the same filings shown inside
    // the Insider score card, so the chart, the score, and the table agree.
    (eventsForSym.insider || [])
      .filter((e) => insiderActionLabel(e.payload || {}).label === 'BUY')
      .forEach((e) => {
        const p = e.payload || {};
        const d = snapDate(p.transaction_date || e.event_ts);
        if (!d) return;
        const shares = Number(p.amount) || null;
        const val = Number(p.value) || (shares && p.price ? shares * Number(p.price) : null);
        evs.push({ date: d, label: `Insider buy${val ? ` ${fmt$(val, 0)}` : ''}`, color: 'var(--mt-up)' });
      });
    return evs;
  }, [windowRows, eventsForSym]);

  const overlays = [];
  if (show50)  overlays.push({ points: sma50Win,  color: 'var(--mt-accent)', label: '50d SMA', dash: '5 3' });
  if (show200) overlays.push({ points: sma200Win, color: 'var(--mt-warn)',   label: '200d SMA', dash: '5 3' });

  /* Dial score — the scanner row is the single canonical 0–5. If a name isn't
     in today's scan there is no MacroTilt Score (the old fallback to a second
     scoring engine disagreed with this dial, so it was removed). */
  const score = scanRow?.score ?? null;

  /* Score composition — the SAME additive 4-input model as the scanner, so it
     reconciles exactly to the headline dial (the old v5 weighted table summed
     to a different number than the dial showed). */
  const comp = useMemo(() => (scanRow ? buildScanBreakdown(scanRow) : null), [scanRow]);

  // Related names must be the SAME sector as this ticker (the header promises
  // "same sector"). Match case-insensitively on the scanner's sector field;
  // if this name has no sector, fall back to an empty list rather than
  // showing unrelated names under a same-sector header.
  // Related names: prefer SAME-sector scanner names (the header promises it).
  // If the scanner has no other names in this sector, fall back to the top
  // names across all sectors and DROP the "same sector" claim from the header
  // (an empty card or a false sector label both read as broken).
  const _others = (scanner.rows || []).filter((r) => r.ticker !== sym);
  const _sameSector = _others.filter((r) => sector && r.sector
    && String(r.sector).toLowerCase() === String(sector).toLowerCase());
  const relatedSameSector = _sameSector.length > 0;
  const related = (relatedSameSector ? _sameSector : _others).slice(0, 4);

  /* Sort events newest first for the tabs. Insider evidence reads the SEC
     EDGAR table directly (2026-07-20 UW cutover) — the same table the scanner
     scores from, so evidence and score can never disagree. */
  const insiderEvents = useEdgarInsider(sym, 90);
  const newsEvents = useMemo(
    () => [...(eventsForSym.news || [])].sort((a, b) => (b.event_ts || '').localeCompare(a.event_ts || '')),
    [eventsForSym.news],
  );

  /* Live per-ticker news (Google News, fetched on demand when the News tab is
     open) merged with the stored ticker_events news rows. */
  const companyName = info.name || snap?.full_name || '';
  const liveNews = useLiveTickerNews(sym, companyName, tab === 'news');
  const mergedNews = useMemo(
    () => mergeTickerNews(newsEvents, liveNews.items),
    [newsEvents, liveNews.items],
  );
  const eventsForBadge = useMemo(
    () => ({ ...eventsForSym, news: mergedNews }),
    [eventsForSym, mergedNews],
  );

  /* ---- Does this symbol exist at all? (Joe 2026-07-30) ----------------
     /ticker/APPL (a typo for AAPL) used to render the entire page shell —
     $0.00 price, empty chart, empty company overview, empty news — because
     nothing here asked the question. A symbol is REAL if any of our own
     sources carries it: the reference list (~13K US listings), a stored
     close, stored daily history, the large-cap snapshot, or a scanner row.
     Nothing at all, once every one of those has finished loading, means the
     symbol is not one we cover — say so instead of drawing zeros. */
  /* Gate on the three per-ticker lookups only. The large-cap snapshot and the
     scanner batch are whole-table reads that can take ~10 s while signed in,
     and waiting on them meant a typo showed the full em-dashed shell for ten
     seconds before the not-found card replaced it. Anything in those feeds is
     in the reference list or has stored prices anyway, so they add evidence
     below but never delay the verdict. */
  const resolveLoading = deep.loading || eod.loading || histAll.loading;
  const symbolKnown = !!(
    deep?.ref ||
    eod?.last_close != null ||
    (histAll.rows || []).length > 0 ||
    snap ||
    scanRow ||
    info?.name
  );
  /* A failed reference read is NOT evidence of absence — if the lookup itself
     errored (offline, RLS, PostgREST hiccup) fall through to the normal page
     rather than telling the user a real symbol doesn't exist. */
  const unknownSymbol = !!sym && !resolveLoading && !symbolKnown && !deep.error && !eod?.error;
  const suggestions = useTickerSuggestions(sym, { enabled: unknownSymbol, limit: 4 });

  if (unknownSymbol) {
    return (
      <UnknownTicker
        sym={sym}
        suggestions={suggestions}
        onBack={() => navigate(-1)}
        onPick={(t) => navigate(`/ticker/${t}`)}
      />
    );
  }

  return (
    <div className="home-v12 ticker-v12">
      <div className="wrap">
      {/* Back row */}
      <div className="tk-backrow">
        <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate(-1)}>
          ← Back to scanner
        </button>
        <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
      </div>

      {/* Hero */}
      <Reveal as="section" className="mt-pagehero tk-hero">
        <div>
          <div className="tk-symwrap">
            <h1 className="tk-symbol">{sym}</h1>
            <div>
              <div className="tk-name">{info.loading ? 'Loading…' : (info.name || snap?.full_name || sym)}</div>
              <div className="tk-meta">
                <span>{sector}</span>
                {exchange && (
                  <>
                    <span className="lm-flowfootsep" />
                    <span>{exchange}</span>
                  </>
                )}
                <span className="lm-flowfootsep" />
                <span>Mkt cap <b className="num">{fmtMcap(marketcap)}</b></span>
                <span className="lm-flowfootsep" />
                <span>Vol <b className="num">{fmtVol(stockVol ?? lastBar?.volume)}</b></span>
              </div>
            </div>
          </div>
          <div className="tk-priceblock">
            {liveHero ? (
              <>
                <div className="tk-price num">${fmt(livePrice, 2)}</div>
                <div className={`tk-priceΔ num ${livePct >= 0 ? 'up' : 'down'}`}>
                  {livePct >= 0 ? '▲' : '▼'} ${Math.abs(livePrice - liveBase).toFixed(2)}{' '}
                  ({livePct > 0 ? '+' : ''}{livePct.toFixed(2)}%) today
                </div>
                <div className="tk-liveline num">
                  <FreshnessChip elementId="market-lse_intraday-live" variant="dot" />
                  <span className="tk-livelabel">Live</span>
                  <span>
                    {isIntraday
                      ? <>vs prev close ${fmt(liveBase, 2)}</>
                      : <>vs close{priceAsOf ? <> {fmtDateShort(priceAsOf)}</> : null} ${fmt(liveBase, 2)}</>}
                  </span>
                </div>
              </>
            ) : (
              <>
            <div className="tk-price num">{hasPrice ? `$${fmt(price, 2)}` : '—'}</div>
            {hasPrice && (
            <div className={`tk-priceΔ num ${chgPct >= 0 ? 'up' : 'down'}`}>
              {chgPct >= 0 ? '▲' : '▼'} ${Math.abs(
                /* actual price move = price − prior close. The old code used
                   price × pct/100, which bases the $ move on the CURRENT price
                   instead of the prior close, so the dollar figure and the %
                   disagreed ($17.75 shown when the real move was $16.40).
                   If prevClose is missing, derive the move from price and pct
                   consistently: move = price·pct/(100+pct). */
                prevClose != null
                  ? (price - prevClose)
                  : (price * chgPct) / (100 + chgPct)
              ).toFixed(2)}{' '}
              ({chgPct > 0 ? '+' : ''}{Number(chgPct).toFixed(2)}%)
            </div>
            )}
            <div className="tk-pricemeta num">
              {priceAsOf ? <>{asOfVerb} {fmtDateShort(priceAsOf)} · </> : null}
              {prevClose != null
                ? <>prev close ${fmt(prevClose, 2)}</>
                : <>prev close —</>}
            </div>
            {liveQ && (
              <div className="tk-liveline num">
                <FreshnessChip elementId="market-lse_intraday-live" variant="dot" />
                {livePrice != null ? (
                  <>
                    <span className="tk-livelabel">Live</span> ${fmt(livePrice, 2)}
                    {livePct != null && (
                      <span className={livePct >= 0 ? 'up' : 'down'}>
                        {' '}{livePct >= 0 ? '+' : ''}{livePct.toFixed(2)}% vs last close
                      </span>
                    )}
                  </>
                ) : (
                  <><span className="tk-livelabel">Live</span> — <span className="tk-livedim">not covered by the live price feed</span></>
                )}
              </div>
            )}
              </>
            )}
          </div>
        </div>
        <div className="tk-scoreblock">
          {score != null ? (
            <>
              {/* Insider Conviction scan name — the 0–5 score applies. */}
              <div className="mt-eyebrow">MacroTilt Score</div>
              <div className="tk-bigdial">
                <ScoreDial score={score} max={5} size={96} />
              </div>
              {signal && (
                <span className="mt-tag mt-tag--accent tk-sigpill">
                  {signal}{direction ? ` · ${direction}` : ''}
                </span>
              )}
              <div className="tk-scoredelta">
                <span>Score change · 1 week</span>
                <b className="num">{
                  scanRow?.score_1w != null
                    ? `${(score - scanRow.score_1w) >= 0 ? '+' : ''}${(score - scanRow.score_1w).toFixed(2)}`
                    : '—'
                }</b>
              </div>
            </>
          ) : (
            <>
              {/* Not an Insider-scan name — the 0–5 score doesn't apply here.
                  Say which scanner (if any) surfaced it instead of a dead dial. */}
              <div className="mt-eyebrow">Scanner signal</div>
              {(ptRow || rsiHits.length) ? (
                <div className="tk-srcpills">
                  {ptRow && (
                    <span className="mt-tag mt-tag--accent tk-sigpill">
                      Power Trend · #{ptRow.rank}
                    </span>
                  )}
                  {rsiHits.map((h) => (
                    <span key={h.dir} className="mt-tag mt-tag--accent tk-sigpill">
                      RSI Divergence · {h.dir}{h.strong ? ' · strong' : ''}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="tk-noscore">Not in a scan<span>no current scanner signal</span></div>
              )}
              <div className="tk-scoredelta">
                <span>{ptRow || rsiHits.length
                  ? 'The 0–5 MacroTilt Score applies to Insider Conviction names only'
                  : 'Scores appear when a scanner surfaces this name'}</span>
              </div>
            </>
          )}
        </div>
      </Reveal>

      {/* The verdict — expandable score drill-down, right under the identity */}
      <ScoreDrillSection
        scanRow={scanRow}
        comp={comp}
        score={score}
        insiderEvents={insiderEvents}
      />

      {/* Price chart */}
      <Reveal as="section" className="mt-pagesection mt-pagesection--tight2">
        <article className="mt-card">
          <div className="mt-sectionhead tk-charthead">
            <div>
              <div className="mt-eyebrow">Price history</div>
              <div className="mt-h2">
                ${fmt(price, 2)} <span className="tk-windowlabel">{chartMode === 'tv' ? '· TradingView · candles · intraday · indicators · drawing tools' : `· ${customRange ? 'custom range' : `${tf} window`}${priceAsOf ? ` · ${asOfVerb} ${fmtDateShort(priceAsOf)}` : ''}`}</span>
              </div>
            </div>
            <div className="tk-chartmodes" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
              <div className="mt-pillgroup">
                <button
                  type="button"
                  className={`mt-pill ${chartMode === 'mt' ? 'on' : ''}`}
                  onClick={() => setChartMode('mt')}
                >
                  MacroTilt
                </button>
                <button
                  type="button"
                  className={`mt-pill ${chartMode === 'tv' ? 'on' : ''}`}
                  onClick={() => setChartMode('tv')}
                >
                  TradingView
                </button>
              </div>
              {chartMode === 'mt' && (
                <div className="mt-pillgroup">
                  {TFS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`mt-pill ${(!customRange && tf === k) ? 'on' : ''}`}
                      onClick={() => { setTf(k); setFromDate(''); setToDate(''); }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {chartMode === 'tv' ? (
            <TradingViewChart symbol={tvSymbolFor(sym, exchange)} height={480} />
          ) : (
          <>
          {histAll.loading ? (
            <div style={{ height: 320, display: 'grid', placeItems: 'center', color: 'var(--mt-ink-3)' }}>
              Loading price history…
            </div>
          ) : series.length ? (
            <BigHistoryChart
              points={series}
              accent={chgPct >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
              height={showRsi ? 400 : 320}
              freq="D"
              overlays={overlays}
              volume={showVol ? volumeWin : null}
              rsi={showRsi ? rsiWin : null}
              events={showEvents ? chartEvents : []}
              compareData={compareSym ? compareSeries : null}
              compareLabel={BENCH_LABEL[compareSym] || compareSym}
              yFormat={(v) => `$${fmt(v, 2)}`}
            />
          ) : (
            <div style={{ height: 320, display: 'grid', placeItems: 'center', color: 'var(--mt-ink-3)' }}>
              No price history on file for {sym}.
            </div>
          )}
          <div className="tk-overlay">
            <button type="button" className={`mt-btn ${show50 ? 'on' : ''}`} onClick={() => setShow50((v) => !v)}>
              {show50 ? '✓ ' : '+ '}50-day avg
            </button>
            <button type="button" className={`mt-btn ${show200 ? 'on' : ''}`} onClick={() => setShow200((v) => !v)}>
              {show200 ? '✓ ' : '+ '}200-day avg
            </button>
            <button type="button" className={`mt-btn ${showVol ? 'on' : ''}`} onClick={() => setShowVol((v) => !v)}>
              {showVol ? '✓ ' : '+ '}Volume
            </button>
            <button type="button" className={`mt-btn ${showRsi ? 'on' : ''}`} onClick={() => setShowRsi((v) => !v)}>
              {showRsi ? '✓ ' : '+ '}RSI
            </button>
            <button type="button" className={`mt-btn ${showEvents ? 'on' : ''}`} onClick={() => setShowEvents((v) => !v)}>
              {showEvents ? '✓ ' : '+ '}Insider buys
            </button>
            <input
              list="tk-overlay-list"
              className="mt-btn tk-compareinput"
              placeholder="+ Compare (type any ticker)"
              value={compareSym}
              onChange={(e) => setCompareSym(e.target.value.toUpperCase().trim())}
            />
            <datalist id="tk-overlay-list">
              {OVERLAY_UNIVERSE.flatMap(([group, items]) =>
                items.filter(([t]) => t !== sym).map(([t, label]) => (
                  <option key={t} value={t}>{`${label} · ${group}`}</option>
                )),
              )}
            </datalist>
            {compareSym && (
              <button type="button" className="mt-btn" onClick={() => setCompareSym('')}>✕ {compareSym}</button>
            )}
          </div>
          <div className="tk-daterange">
            <span className="mt-eyebrow">Custom range</span>
            <input type="date" className="mt-btn tk-dateinput" value={fromDate}
              max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
            <span className="tk-daterange-sep">to</span>
            <input type="date" className="mt-btn tk-dateinput" value={toDate}
              min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
            {customRange && (
              <button type="button" className="mt-btn" onClick={() => { setFromDate(''); setToDate(''); }}>Clear</button>
            )}
          </div>
          </>
          )}
        </article>
      </Reveal>

      {/* Key stats grid */}
      <Reveal as="section" className="mt-pagesection">
        <div className="mt-sectionhead-tight">
          <div className="mt-eyebrow">
            Key stats{priceAsOf ? ` · ${isIntraday ? 'intraday' : 'prior close'} ${fmtDateShort(priceAsOf)}` : ''}
          </div>
          <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
        </div>
        <div className="tk-keygrid">
          <KvCell label="Open"      tip={`Opening price of the last completed session${priceAsOf ? ` (${fmtDateShort(priceAsOf)})` : ''}.`} value={lastBar?.open != null ? `$${fmt(lastBar.open, 2)}` : '—'} />
          <KvCell label="Prev close" tip="Closing price of the session before the one shown." value={prevClose != null ? `$${fmt(prevClose, 2)}` : '—'} />
          <KvCell label="Day high"  tip="Intraday high of the last completed session — not the 52-week high below." value={lastBar?.high != null ? `$${fmt(lastBar.high, 2)}` : (snap?.high != null ? `$${fmt(snap.high, 2)}` : '—')} />
          <KvCell label="Day low"   tip="Intraday low of the last completed session — not the 52-week low below." value={lastBar?.low  != null ? `$${fmt(lastBar.low, 2)}`  : (snap?.low  != null ? `$${fmt(snap.low, 2)}`  : '—')} />
          <KvCell label="52w high"  tip="Highest intraday price over the trailing ~252 trading days (about one year)." value={hi52 != null ? `$${fmt(hi52, 2)}` : '—'} />
          <KvCell label="52w low"   tip="Lowest intraday price over the trailing ~252 trading days (about one year)." value={lo52 != null ? `$${fmt(lo52, 2)}` : '—'} />
          <KvCell label="Avg vol"   tip="Average daily share volume over the last 30 trading sessions." value={fmtVol(avgVol)} />
          <KvCell label="Mkt cap"   tip="Market value — share price times shares outstanding. From the daily reference feed." value={fmtMcap(marketcap)} />
          <KvCell
            label="Div yield"
            tip={divYield.note === 'none'
              ? 'No dividends on record in the corporate-actions pipeline.'
              : divYield.note === 'stale'
                ? 'Last recorded dividend was over a year ago — no current yield.'
                : 'Latest regular cash dividend annualized by its declared frequency, divided by the last close. From the corporate-actions pipeline.'}
            value={divYield.value != null
              ? `${(divYield.value * 100).toFixed(2)}%`
              : divYield.note === 'none' ? 'None' : '—'}
          />
          <KvCell
            label="Beta · 1y"
            tip="Sensitivity to the S&P 500: covariance of daily returns vs SPY over variance of SPY, trailing year of daily closes. Dash when under six months of overlapping history."
            value={beta1y != null ? beta1y.toFixed(2) : '—'}
          />
          <KvCell
            label="Shares out"
            tip="Weighted shares outstanding, from the daily reference feed."
            value={fmtVol(deep?.ref?.weighted_shares_outstanding ?? deep?.ref?.share_class_shares_outstanding ?? null)}
          />
          <KvCell
            label="Listed"
            tip="Year this ticker first listed on its exchange."
            value={deep?.ref?.list_date ? String(deep.ref.list_date).slice(0, 4) : '—'}
          />
        </div>

        {/* Live technicals — moved here from the score tab; computed on the fly
            from daily history (no scanner lag), so they live with the stats. */}
        <div className="tk-techstrip">
          <div className="mt-eyebrow">Live technicals · daily</div>
          <div className="tk-techgrid">
            <TechCell label="RSI(14)"      tip="14-day Wilder RSI. Above 70 is overbought, below 30 oversold." value={tech?.rsi_14 != null ? tech.rsi_14.toFixed(1) : '—'} />
            <TechCell label="MACD cross"   tip="Whether the trend line sits above its signal line (bullish) or below it (bearish)." value={tech?.macd_cross || '—'} />
            <TechCell label="vs SMA 50"    tip="Percent the price sits above or below its 50-day average." value={fmtPctFraction(tech?.pct_vs_50ma)} />
            <TechCell label="vs SMA 200"   tip="Percent the price sits above or below its 200-day average." value={fmtPctFraction(tech?.pct_vs_200ma)} />
            <TechCell label="Volume surge" tip="Today's volume divided by the trailing 30-day average. Above 1.0 means heavier-than-usual trading." value={tech?.vol_surge != null ? `${tech.vol_surge.toFixed(2)}×` : '—'} />
            <TechCell label="1w return"    tip="Price change over the last 5 trading days." value={fmtPctFraction(tech?.week_change)} />
            <TechCell label="1m return"    tip="Price change over the last ~21 trading days." value={fmtPctFraction(tech?.month_change)} />
            <TechCell label="YTD return"   tip="Price change since the start of the calendar year." value={fmtPctFraction(tech?.ytd_change)} />
            <TechCell label="1m vs S&P"    tip="This name's 1-month return minus the S&P 500's over the same period." value={fmtPctFraction(tech?.spy_relative_month)} />
          </div>
        </div>

        <div className="tk-emptyfoot">
          Open, day high/low, average volume, and beta come from the daily price
          history; market cap from the daily reference feed; dividend yield from the
          corporate-actions pipeline. Live technicals are computed from daily history.
          Hover the ⓘ on any tile for its definition.
        </div>
      </Reveal>

      {/* Company overview — restored from the old detail view */}
      <CompanyOverview deep={deep} sector={sector} exchange={exchange} />

      {/* Recent activity & filings — detail feeds, switched by source */}
      <Reveal as="section" className="mt-pagesection">
        <div className="mt-sectionhead-tight">
          <div className="mt-eyebrow">Recent activity &amp; filings</div>
        </div>
        <div className="mt-pillgroup tk-tabs">
          {TABS.map(([id, l]) => (
            <button
              key={id}
              type="button"
              className={`mt-pill ${tab === id ? 'on' : ''}`}
              onClick={() => setTab(id)}
            >
              {l}{badgeForTab(id, eventsForBadge)}
            </button>
          ))}
        </div>

        {tab === 'short'   && <ShortInterestTab pos={positioning} />}
        {tab === 'news'    && <NewsTab items={mergedNews} loading={liveNews.loading} />}
        {tab === 'fund'    && <FundamentalsTab deep={deep} />}
      </Reveal>

      {/* Related names */}
      <Reveal as="section" className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">{relatedSameSector ? 'Related names · same sector' : 'Related names'}</div>
            <div className="mt-h2">{relatedSameSector ? `Other names the scanner liked in ${sector}` : 'Other names the scanner liked'}</div>
          </div>
        </div>
        <div className="tk-relatedgrid">
          {related.map((r) => (
            <button
              key={r.ticker}
              type="button"
              onClick={() => navigate(`/ticker/${r.ticker}`)}
              className="tk-relcard"
            >
              <div className="tk-relhead">
                <span className="lm-tkmain">{r.ticker}</span>
                <ScoreDial score={r.score} max={5} size={36} />
              </div>
              <div className="tk-relsub">{r.sector || '—'}</div>
              <div className="tk-relstats num">
                <span>${fmt(r.price, 2)}</span>
                <span className={(r.chg ?? 0) >= 0 ? 'up' : 'down'}>
                  {(r.chg ?? 0) >= 0 ? '+' : ''}{(r.chg ?? 0).toFixed(2)}%
                </span>
              </div>
            </button>
          ))}
          {related.length === 0 && (
            <div className="tk-relempty">No related names available.</div>
          )}
        </div>
      </Reveal>
      </div>{/* /.wrap */}
    </div>
  );
}

/* ---------- helpers ---------- */

function badgeForTab(id, events) {
  const ct =
    id === 'news'    ? events.news?.length :
    null;
  if (ct == null || ct === 0) return null;
  return <span className="sc-colcount num"> {ct}</span>;
}

function KvCell({ label, value, tip }) {
  return (
    <div className="tk-kvcell">
      <div className="mt-eyebrow tk-kvlabel">
        {label}
        {tip && <Tip content={tip}><span className="tk-info">ⓘ</span></Tip>}
      </div>
      <b className="num">{value ?? '—'}</b>
    </div>
  );
}

function TechCell({ label, value, tip }) {
  return (
    <div className="tk-techcell">
      <div className="mt-eyebrow tk-kvlabel">
        {label}
        {tip && <Tip content={tip}><span className="tk-info">ⓘ</span></Tip>}
      </div>
      <b className="num">{value}</b>
    </div>
  );
}

/* ---------- Short interest tab ---------- */

function ShortInterestTab({ pos }) {
  const f = pos?.finra || null;
  const pct1 = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
  const ratioPct = (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(0)}%`);
  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Short interest
          <FreshnessChip
            elementId="equity-short_interest-daily"
            variant="dot"
            fallback={{ asOfIso: f?.as_of_date }}
          />
        </div>
      </div>
      <div className="tk-keygrid tk-keygrid--tight">
        <KvCell
          label="% of shares out"
          value={pct1(f?.short_interest_float_pct)}
          tip="FINRA settlement short interest ÷ shares outstanding. Published twice a month with a settlement lag."
        />
        <KvCell label="Shares short" value={fmtVol(f?.short_interest_shares)} />
        <KvCell
          label="Days to cover"
          value={f?.days_to_cover != null ? Number(f.days_to_cover).toFixed(1) : '—'}
          tip="Shares short ÷ average daily volume at the same settlement date"
        />
      </div>
      <div className="tk-emptyfoot">
        {f
          ? `FINRA settlement as of ${fmtDateShort(f.as_of_date)}; bi-monthly with a reporting lag.`
          : 'No FINRA settlement row in the last 45 days for this name.'}
        {' '}Context only — short interest does not enter the MacroTilt Score.
      </div>
    </article>
  );
}

/* ---------- News tab ---------- */

/* Normalize a headline for dedupe — mirrors api/news-per-ticker.js. */
function normHeadline(h) {
  return (h || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/* Merge stored ticker_events news rows with the live Google News feed into a
   single, deduped, newest-first list. Live items are pushed first so their
   (fresher) source attribution wins on a duplicate headline. */
function mergeTickerNews(storedEvents, liveItems) {
  const out = [];
  const seen = new Set();
  const push = (it) => {
    const key = normHeadline(it.headline);
    if (!it.headline || !key || seen.has(key)) return;
    seen.add(key);
    out.push(it);
  };
  for (const it of (liveItems || [])) {
    push({ ts: it.published || null, headline: it.headline, url: it.url, source: it.source, live: true });
  }
  for (const r of (storedEvents || [])) {
    const p = r.payload || {};
    push({ ts: r.event_ts || null, headline: p.headline, url: p.url, source: p.source, live: false });
  }
  out.sort((a, b) => {
    const ta = a.ts ? Date.parse(a.ts) : 0;
    const tb = b.ts ? Date.parse(b.ts) : 0;
    return (tb || 0) - (ta || 0);
  });
  return out;
}

/* Live per-ticker news. Fetches /api/news-per-ticker on demand (only when the
   News tab is active) — no schedule, fresh on open. Best-effort: any failure
   leaves the stored list intact. */
function useLiveTickerNews(sym, company, enabled) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !sym) return undefined;
    let cancelled = false;
    setItems([]);
    setLoading(true);
    const params = new URLSearchParams({ ticker: sym });
    if (company) params.set('company', company);
    fetch(`/api/news-per-ticker?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (!cancelled) setItems(Array.isArray(d.items) ? d.items : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sym, company, enabled]);
  return { items, loading };
}

function NewsTab({ items, loading }) {
  if (!items.length) {
    return (
      <article className="mt-card mt-fade">
        <div className="tk-tabhead">
          <div className="mt-eyebrow">Recent headlines</div>
        </div>
        <div className="tk-empty">
          {loading ? 'Loading headlines…' : 'No recent headlines on file for this ticker.'}
        </div>
      </article>
    );
  }
  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">Recent headlines · {items.length}{loading ? ' · updating…' : ''}</div>
      </div>
      <ul className="tk-newslist">
        {items.slice(0, 30).map((r, i) => (
          <li key={`${r.ts}-${i}`} className="tk-newsrow">
            <span className="tk-newstime num">{fmtTimeAgo(r.ts)}</span>
            <span className="tk-newshead">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="tk-newslink">
                  {r.headline || '—'}
                </a>
              ) : (r.headline || '—')}
            </span>
            <span className="tk-newssrc">{r.source || '—'}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/* ---------- Fundamentals tab ---------- */

function FundamentalsTab({ deep }) {
  const dividends = deep.dividends || [];
  const splits = deep.splits || [];

  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">Fundamentals</div>
      </div>

      <div className="tk-fundsplit">
        <div>
          <div className="mt-eyebrow">Recent dividends</div>
          {dividends.length === 0 ? (
            <div className="tk-empty">No dividends on file.</div>
          ) : (
            <table className="tk-evttable">
              <thead>
                <tr>
                  <th>Ex date</th>
                  <th className="num">Cash</th>
                  <th>Freq</th>
                </tr>
              </thead>
              <tbody>
                {dividends.map((d) => (
                  <tr key={d.ex_dividend_date}>
                    <td className="num">{fmtDateShort(d.ex_dividend_date)}</td>
                    <td className="num">{d.cash_amount != null ? `$${Number(d.cash_amount).toFixed(2)}` : '—'}</td>
                    <td>{d.frequency || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <div className="mt-eyebrow">Recent splits</div>
          {splits.length === 0 ? (
            <div className="tk-empty">No splits on file.</div>
          ) : (
            <table className="tk-evttable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ratio</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((s) => (
                  <tr key={s.execution_date}>
                    <td className="num">{fmtDateShort(s.execution_date)}</td>
                    <td className="num">{s.split_to}-for-{s.split_from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="tk-emptyfoot">
        Revenue, margins, FCF, balance-sheet metrics require a full financial-statements
        feed not yet wired. Dividends and splits come from the Polygon
        corporate-actions pipeline.
      </div>
    </article>
  );
}

/* ---------- Score drill-down (the centerpiece) ----------

   The 0–5 badge expands here into its four engine components. Each card shows
   its points, the rule that fired, and the raw drivers behind it. Every value
   reads from the scan row, so the cards always reconcile to the badge above. */
function ScoreDrillSection({ scanRow, comp, score, insiderEvents }) {
  // Collapsed by default — the page opens to a clean 4-row summary; the raw
  // drivers (rule text, filings table, readings) appear only when a row is
  // clicked. No data dumped in your face on load.
  const [open, setOpen] = useState(null);
  /* 2026-07-20: the score (and its breakdown) only exists for Insider
     Conviction scan names. For everything else, render nothing — a card that
     just says "no score" was noise on every non-scan ticker. */
  if (!scanRow || !comp) return null;
  return (
    <Reveal as="section" className="mt-pagesection">
      <article className="mt-card">
        <div className="mt-sectionhead-tight">
          <div className="mt-eyebrow">
            How the score is built{score != null ? ` · why the ${Number(score).toFixed(1)} / 5` : ''}
          </div>
        </div>
        <div className="tk-scorecards">
          {comp.items.map((c) => (
            <ScoreCard
              key={c.key}
              comp={c}
              scanRow={scanRow}
              insiderEvents={insiderEvents}
              open={open === c.key}
              onToggle={() => setOpen(open === c.key ? null : c.key)}
            />
          ))}
        </div>
        <div className="tk-scoretotal">
          <span>Components add up to</span>
          <b className="num">{comp.total.toFixed(2)}<i> / 5</i></b>
        </div>
        {/* Stale paper-book claim removed 2026-08 (strategy reset): the paper
            book trades Conviction Events, not this score. */}
        <div className="tk-emptyfoot">
          A name makes the Insider Conviction list on its insider + trend score
          (3.0 or higher). Maximum score is 5.
        </div>
      </article>
    </Reveal>
  );
}

function ScoreCard({ comp, scanRow, insiderEvents, open, onToggle }) {
  const pts = comp.points;
  const cap = SCORE_CAPS[comp.key] || 4;
  const zero = !(pts > 0);
  const neg = pts < 0;
  const fill = Math.max(0, Math.min(1, pts / cap));
  return (
    <div className={`tk-scard ${open ? 'on' : ''}`}>
      <button type="button" className="tk-scard-head" onClick={onToggle}>
        <span className="tk-scard-caret">{open ? '▾' : '▸'}</span>
        <span className="tk-scard-name">{comp.key}</span>
        <span className="tk-scard-why">{comp.why}</span>
        <span className="tk-scard-bar"><i style={{ width: `${fill * 100}%` }} /></span>
        <b className={`num tk-scard-pts ${zero ? 'is-zero' : neg ? 'down' : 'up'}`}>
          {pts > 0 ? '+' : ''}{pts.toFixed(2)}
        </b>
      </button>
      {open && (
        <div className="tk-scard-body">
          {comp.key === 'Insider'      && <InsiderDrill scanRow={scanRow} pts={pts} events={insiderEvents} />}
          {comp.key === 'Technicals'   && <TechnicalsDrill scanRow={scanRow} pts={pts} />}
        </div>
      )}
    </div>
  );
}

function InsiderDrill({ scanRow, pts, events }) {
  const rules = scanRow.insider_rules || [];
  const age = scanRow.insider_age_days;
  const w = insiderAgeWeight(age);
  // Open-market buys are exactly what the engine scores — show them as evidence.
  const buys = (events || []).filter((e) => insiderActionLabel(e.payload || {}).label === 'BUY');
  const totalUsd = buys.reduce((s, e) => {
    const p = e.payload || {};
    const v = Number(p.value) || (Number(p.amount) && Number(p.price) ? Number(p.amount) * Number(p.price) : 0);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
  const dates = buys
    .map((e) => (e.payload?.transaction_date || e.event_ts || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const range = dates.length ? `${fmtDateShort(dates[0])}–${fmtDateShort(dates[dates.length - 1])}` : null;
  return (
    <>
      {rules.length ? (
        <ul className="tk-rulelist">
          {rules.map((r) => (
            <li key={r}><b>Rule {r}</b> — {INSIDER_RULES[r] || 'qualifying open-market insider buying.'}</li>
          ))}
        </ul>
      ) : (
        <div className="tk-empty">No insider rule fired.</div>
      )}
      {rules.length > 0 && (
        <div className="tk-drill-math">
          Rule points are capped at +4, then weighted for age:{' '}
          {age != null ? `most recent qualifying buy ${age} day${age === 1 ? '' : 's'} ago — ` : ''}
          {w == null ? '' : w >= 1 ? 'fresh, full weight' : `aging, about ${Math.round(w * 100)}% weight left`}
          {' '}→ <b className="num up">+{pts.toFixed(2)}</b>
        </div>
      )}
      <div className="tk-drill-note">
        Counts open-market purchases over the last 30 days. Routine pre-scheduled
        (10b5-1) trades and 10%+ owners are excluded.
      </div>
      {buys.length > 0 && (
        <div className="tk-drill-evidence">
          <div className="mt-eyebrow">
            {buys.length} open-market buy{buys.length === 1 ? '' : 's'} on record
            {totalUsd > 0 ? ` · ${fmt$(totalUsd, 0)}` : ''}{range ? ` · ${range}` : ''}
          </div>
          <InsiderFilingsTable events={buys} />
        </div>
      )}
    </>
  );
}

function TechnicalsDrill({ scanRow, pts }) {
  const pct = scanRow.sma200_pct;
  const smaPts = Number(scanRow.sma200_pts) || 0;
  const rsi = scanRow.rsi;
  const rsiPts = Number(scanRow.rsi_pts) || 0;
  return (
    <div className="tk-drill-math">
      <div className="tk-drill-line">
        <b>200-day trend:</b>{' '}
        {pct == null ? 'no reading' : `${pct >= 0 ? 'above' : 'below'} its 200-day line by ${Math.abs(pct).toFixed(1)}%`}
        {' '}→ <b className={`num ${smaPts >= 0 ? 'up' : 'down'}`}>{smaPts >= 0 ? '+' : ''}{smaPts}</b>
        <span className="tk-drill-note"> above the line +1, below −2</span>
      </div>
      <div className="tk-drill-line">
        <b>RSI(14):</b>{' '}
        {rsi == null ? 'no reading' : `${Number(rsi).toFixed(0)} — ${Number(rsi) > 65 ? 'overbought (above the 65 line)' : 'not overbought (below the 65 line)'}`}
        {' '}→ <b className={`num ${rsiPts >= 0 ? 'up' : 'down'}`}>{rsiPts >= 0 ? '+' : ''}{rsiPts}</b>
        <span className="tk-drill-note"> a hot 14-day Wilder RSI subtracts 2</span>
      </div>
      <div className="tk-drill-total">Trend total → <b className="num">{pts > 0 ? '+' : ''}{pts.toFixed(2)}</b></div>
    </div>
  );
}

function InsiderFilingsTable({ events }) {
  return (
    <div className="tk-tablewrap">
      <table className="tk-evttable">
        <thead>
          <tr>
            <th>Date</th><th>Insider</th><th>Role</th><th>Action</th>
            <th className="num">Shares</th><th className="num">Price</th><th className="num">Value</th>
          </tr>
        </thead>
        <tbody>
          {events.slice(0, 50).map((r) => {
            const p = r.payload || {};
            const act = insiderActionLabel(p);
            const role = insiderRoleLabel(p);
            const shares = Number(p.amount) || null;
            const value = Number(p.value) || (shares && p.price ? shares * Number(p.price) : null);
            const isBuy = act.label === 'BUY';
            return (
              <tr key={`${r.event_ts}-${p.owner_name}-${shares}`}>
                <td className="num">{fmtDateShort(p.transaction_date || r.event_ts)}</td>
                <td>
                  {p.owner_name || '—'}
                  {p.is_10b5_1 && <Tip content="Rule 10b5-1 — automatic preset plan, not discretionary"><span className="tk-tag-soft">10b5-1</span></Tip>}
                </td>
                <td>{role}</td>
                <td><span className={`mt-tag ${act.cls}`}>{act.label}</span></td>
                <td className={`num ${isBuy ? 'up' : 'down'}`}>
                  {shares != null ? (isBuy ? '+' : '−') + fmtVol(Math.abs(shares)) : '—'}
                </td>
                <td className="num">{p.price != null ? `$${fmt(p.price, 2)}` : '—'}</td>
                <td className={`num ${isBuy ? 'up' : 'down'}`}>
                  {value != null ? fmt$(Math.abs(value), 0) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {events.length > 50 && (
        <div className="tk-techfoot">Showing 50 of {events.length} buys.</div>
      )}
    </div>
  );
}

/* ---------- Company overview (restored) ---------- */

function CompanyOverview({ deep, sector, exchange }) {
  const ref = deep?.ref || null;
  const desc = ref?.description || null;
  const industry = ref?.sic_description || null;
  const city = ref?.address_city || null;
  const state = ref?.address_state || null;
  const hq = city ? `${city}${state ? `, ${state}` : ''}` : null;
  const employees = ref?.total_employees || null;
  const listed = ref?.list_date || null;
  const site = ref?.homepage_url || null;
  return (
    <Reveal as="section" className="mt-pagesection">
      <article className="mt-card">
        <div className="mt-sectionhead-tight">
          <div className="mt-eyebrow">Company overview</div>
        </div>
        {desc ? (
          <p className="tk-about">{desc}</p>
        ) : (
          <div className="tk-empty">No company description on file for this ticker.</div>
        )}
        <div className="tk-keygrid">
          <KvCell label="Sector"    value={sector || '—'} />
          <KvCell label="Industry"  value={industry || '—'} />
          {/* Exchange only when known — the reference feed doesn't carry it
              for most names, and a permanent em-dash tile reads as broken. */}
          {exchange && <KvCell label="Exchange" value={exchange} />}
          <KvCell label="HQ"        value={hq || '—'} />
          <KvCell label="Employees" value={employees != null ? Number(employees).toLocaleString() : '—'} />
          <KvCell label="Listed"    value={listed ? `${fmtDateShort(listed)}, ${String(listed).slice(0, 4)}` : '—'} />
        </div>
        {site && (
          <div className="tk-aboutlink">
            <a href={site} target="_blank" rel="noopener noreferrer" className="tk-newslink">
              {site.replace(/^https?:\/\//, '')}
            </a>
          </div>
        )}
        <div className="tk-emptyfoot">Company profile from the reference data feed (Polygon).</div>
      </article>
    </Reveal>
  );
}



/* ---------- Symbol we don't cover (Joe 2026-07-30) ----------
   The honest answer to /ticker/APPL. No zeros, no empty chart, no blank
   company card — one card that says the symbol isn't in our reference list
   and offers the names it most likely was meant to be. */

function UnknownTicker({ sym, suggestions, onBack, onPick }) {
  const rows = suggestions?.rows || [];
  const best = rows[0] || null;
  return (
    <div className="home-v12 ticker-v12">
      <div className="wrap">
        <div className="tk-backrow">
          <button type="button" className="mt-btn mt-btn--ghost" onClick={onBack}>
            ← Back
          </button>
        </div>

        <Reveal as="section" className="mt-pagesection">
          <article className="mt-card tk-nfcard">
            <div className="mt-eyebrow">Symbol not found</div>
            <h1 className="tk-symbol tk-nfsym">{sym}</h1>
            <p className="tk-nftext">
              We don&rsquo;t carry a symbol called <b>{sym}</b>. Our reference list covers
              roughly 13,000 US-listed stocks and exchange-traded funds, and this
              one isn&rsquo;t in it &mdash; so there is no price, no history and no company
              profile to show.
              {best && (
                <> Closest match: <b>{best.ticker}</b> &mdash; {String(best.name || '').replace(/\.$/, '')}.</>
              )}
            </p>

            {suggestions?.loading ? (
              <div className="tk-empty">Looking for close matches&hellip;</div>
            ) : rows.length > 0 ? (
              <>
                <div className="mt-eyebrow tk-nfsubhead">Did you mean</div>
                <div className="tk-relatedgrid">
                  {rows.map((r) => (
                    <button
                      key={r.ticker}
                      type="button"
                      className="tk-relcard"
                      onClick={() => onPick(r.ticker)}
                    >
                      <div className="tk-relhead">
                        <span className="lm-tkmain">{r.ticker}</span>
                      </div>
                      <div className="tk-relsub">{r.name || '—'}</div>
                      <div className="tk-relstats num">
                        <span>Mkt cap {fmtMcap(r.market_cap)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="tk-empty">
                No close matches either. Try the search box at the top of the page.
              </div>
            )}

            <div className="tk-emptyfoot">
              Non-US listings and names that have been delisted are outside the
              reference list, so they land here too.
            </div>
          </article>
        </Reveal>
      </div>
    </div>
  );
}
