/* TickerPage — the per-symbol cockpit (rebuilt 2026-10-13, Joe: "a compact
   cockpit showing performance, technicals and risk, then info about the
   stock"). Everything is sourced from feeds that exist today:
   - prices_eod (daily history)      → price, chart, 52-week range, returns,
                                        realized vol, drawdown, beta vs SPY
   - ticker_reference (daily)        → name, industry (SIC), market cap,
                                        shares, HQ, employees, listed, site
   - corporate actions (Polygon)     → dividends, splits, dividend yield
   - FINRA short interest            → short interest, days to cover
   - LSE 1-minute bars               → live price during the session
   - ticker_events + Google News     → headlines
   No scanner feed is read here (the scanner pages are retired). */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/cream-system.css';
import '../styles/ticker-v12.css';
// v13 last — it overrides the page's own v12 stylesheet.
import '../styles/v13.css';
import '../styles/pages-v13.css';
import { useParams, useNavigate } from 'react-router-dom';
import { latestTradingSessionDate } from '../../lib/freshnessClock';
import BigHistoryChart from '../components/BigHistoryChart';
import TradingViewChart, { tvSymbolFor } from '../components/TradingViewChart';
import FreshnessChip from '../components/FreshnessChip';
import useLseLive from '../../hooks/useLseLive';
import Tip from '../components/Tip';
import useMassiveTickerInfo from '../../hooks/useMassiveTickerInfo';
import useTickerPositioning from '../../hooks/useTickerPositioning';
import { useTickerEvents } from '../../hooks/useTickerEvents';
import useTickerTechnicalsLive from '../../hooks/useTickerTechnicalsLive';
import useTickerDeepDive from '../../hooks/useTickerDeepDive';
import { SITE_NAME } from '../chrome/siteNav';
import useTickerSuggestions from '../../hooks/useTickerSuggestions';
import useTickerEodHistory from '../../hooks/useTickerEodHistory';
import useTickerEodPrice from '../../hooks/useTickerEodPrice';

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
/* What a quote shown under a CLOSED market's headline actually is, from the
   time of its bar in New York: before 9:30 a pre-market trade, after the 16:00
   closing print an after-hours trade, otherwise the session's last trade. Only an open market
   makes it "Live". */
function closedQuoteLabel(barTs, marketOpen) {
  if (marketOpen === true) return 'Live';
  if (!barTs) return 'Last trade';
  const t = new Date(barTs);
  if (Number.isNaN(t.getTime())) return 'Last trade';
  const hm = t.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  if (hm < '09:30') return 'Pre-market';
  if (hm >= '16:01') return 'After hours';   // the closing auction prints at 16:00:0x
  return 'Last trade';
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
function insiderActionLabel(payload) {
  const code = (payload?.transaction_code || payload?.transaction_type || '').toString().toUpperCase();
  if (code.includes('P') || code === 'BUY')  return { label: 'BUY',  cls: 'mt-tag--calm' };
  if (code.includes('S') || code === 'SELL') return { label: 'SELL', cls: 'mt-tag--extreme' };
  return { label: code || '—', cls: 'mt-tag--range' };
}

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
  // The tab names the company once it is known (the shell sets "AAPL —
  // MacroTilt" on arrival; this adds the name — 2026-10-29).
  useEffect(() => {
    if (sym && info?.name) document.title = `${sym} · ${info.name} — ${SITE_NAME}`;
  }, [sym, info?.name]);
  const events = useTickerEvents({ daysBack: 90 });
  const tech = useTickerTechnicalsLive(sym);
  const deep = useTickerDeepDive(sym);
  const eod = useTickerEodPrice(sym);
  const histAll = useTickerEodHistory(sym);
  const spyHist = useTickerEodHistory(sym === 'SPY' ? null : 'SPY'); // benchmark
  const positioning = useTickerPositioning(sym);

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
  /* The chart fills whatever height the side column takes, so the two tiles
     always end on the same line (Joe 2026-10-13: no asymmetric tiles). The
     chart body is measured and the chart drawn to that height. */
  const chartBodyRef = useRef(null);
  const [chartH, setChartH] = useState(330);
  useEffect(() => {
    const el = chartBodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => {
      const h = Math.floor(e.contentRect.height);
      if (h > 200) setChartH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartMode]);


  const eventsForSym = events.byTicker?.get?.(sym) || { news: [], insider: [], congress: [], darkpool: [] };

  /* Industry classification (SIC description) from the daily reference feed.
     There is no sector feed on the site; unknown renders nothing, never a
     made-up label (Joe 2026-10-13: "there is no equity sector"). */
  const sector  = deep?.ref?.sic_description || null;
  /* Single price anchor: prices_eod (real last close + its trade_date) is
     canonical so the header price, the chart, and the freshness chip all
     agree on one date. */
  const price   = eod?.last_close ?? 0;
  /* Whether a REAL price exists anywhere. The `?? 0` above keeps the chart and
     the derived maths from blowing up on a null, but a rendered "$0.00" is a
     substituted number, which we never show (LESSONS 4.4) — a covered symbol
     with no stored close yet (fresh listing, thin name) gets an em-dash. */
  const hasPrice = eod?.last_close != null;
  /* Day move. Two rules, both learned the hard way:
     (a) never guess a unit. The old code multiplied a snapshot change by 100
         when |x| < 1, which turns a real +0.4% into +40%. universe_snapshots
         stores close and prev_close, so the percentage is computed, not
         inferred — and `perc_change` is NULL on every row anyway.
     (b) never fall back to 0. A missing change is an em-dash; a green
         "+0.00%" is a substituted number (LESSONS 4.4). */
  const chgPct  = eod?.day_pct != null ? Number(eod.day_pct) : null;
  const hasChg  = Number.isFinite(chgPct);
  const prevClose = eod?.prev_close ?? null;
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
  const marketcap = deep?.ref?.market_cap ?? null;
  

  /* Live price — LSE 1-minute bars (display only; ~10 s behind the tape,
     shared server cache). Uncovered names (LSE carries ~4,000 US stocks +
     major ETFs) render an em-dash — never a substituted number
     (Joe 2026-07-27; LESSONS 4.4). */
  const lseLive = useLseLive([sym], { enabled: !!sym });
  const liveQ = lseLive.bySymbol?.[sym] || null;
  const livePrice = liveQ && liveQ.covered && liveQ.price != null ? liveQ.price : null;
  /* Move vs the last COMPLETED close. Preference order matters:
     1. the base the QUOTE PROVIDER shipped with the price (Yahoo's
        chartPreviousClose). Price and base then come from one observation of
        one instrument at one moment — they cannot disagree.
     2. prev_close, when our stored row is itself an intraday print.
     3. the stored last close.
     (2) and (3) are a table lookup that can be a session behind the quote;
     (1) cannot. KLIC on 2026-08-18 is the case in point. */
  const liveBase = (liveQ?.prevClose != null && liveQ.prevClose > 0)
    ? liveQ.prevClose
    : (isIntraday ? prevClose : (price || null));
  const livePct = livePrice != null && liveBase > 0 ? ((livePrice / liveBase) - 1) * 100 : null;
  /* Live-first hero (Joe 2026-07-28): while the market is OPEN and the live
     feed covers this name, the live price is the headline number — nobody
     leads with yesterday's close during trading hours. The official close
     demotes to the small reference line. Closed market, uncovered names, or
     a missing base keep the close-first block unchanged. */
  const liveHero = lseLive.marketOpen === true && livePrice != null && livePct != null;

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
  const hi52 =     (hist.length ? Math.max(...hist.slice(-252).map((r) => (r.high ?? r.close))) : null);
  const lo52 =     (hist.length ? Math.min(...hist.slice(-252).map((r) => (r.low ?? r.close))) : null);
  const avgVol =
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


  /* ---- Performance / risk, all from the stored daily history ---- */
  const perf = useMemo(() => perfTable(hist, spyHist.rows || []), [hist, spyHist.rows]);
  const risk = useMemo(() => riskStats(hist), [hist]);

  const newsEvents = useMemo(
    () => [...(eventsForSym.news || [])].sort((a, b) => (b.event_ts || '').localeCompare(a.event_ts || '')),
    [eventsForSym.news],
  );
  const companyName = info.name || '';
  const liveNews = useLiveTickerNews(sym, companyName, true);
  const mergedNews = useMemo(
    () => mergeTickerNews(newsEvents, liveNews.items),
    [newsEvents, liveNews.items],
  );

  /* ---- Does this symbol exist at all? (Joe 2026-07-30) ----------------
     /ticker/APPL (a typo for AAPL) used to render the entire page shell —
     $0.00 price, empty chart, empty company overview, empty news — because
     nothing here asked the question. A symbol is REAL if any of our own
     sources carries it: the reference list (~13K US listings), a stored
     close, or stored daily history.
     Nothing at all, once every one of those has finished loading, means the
     symbol is not one we cover — say so instead of drawing zeros. */
  const resolveLoading = deep.loading || eod.loading || histAll.loading;
  const symbolKnown = !!(
    deep?.ref ||
    eod?.last_close != null ||
    (histAll.rows || []).length > 0 ||
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

  const finra = positioning?.finra || null;
  const sharesOut = deep?.ref?.weighted_shares_outstanding ?? deep?.ref?.share_class_shares_outstanding ?? null;
  const headPrice = liveHero ? livePrice : (hasPrice ? price : null);
  const hasRange = headPrice != null && lo52 != null && hi52 != null && hi52 > lo52;
  const rangePos = hasRange ? Math.min(100, Math.max(0, ((headPrice - lo52) / (hi52 - lo52)) * 100)) : null;

  return (
    <div className="home-v12 v13 ticker-v12">
      <div className="wrap">
      {/* Back row */}
      <div className="tk-backrow">
        <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
      </div>

      {/* ── Tape: one dense strip — identity · price · live · range · reference ── */}
      <Reveal as="section" className="tk-tape">
        <div className="tk-tape-id">
          <h1 className="tk-symbol">{sym}</h1>
          <div className="tk-tape-idtext">
            {/* Loading is a skeleton, never a sentence or a dash that reads as an
                answer (LESSONS 9.13; Muse 2026-10-29 item 1, ticker hero 10-30). */}
            <div className="tk-name">{info.loading ? <span className="rd-skel rd-skel--line is-short" /> : (info.name || sym)}</div>
            <div className="tk-meta">
              {sector && <span>{sector}</span>}
              {sector && exchange && <span className="lm-flowfootsep" />}
              {exchange && <span>{exchange}</span>}
            </div>
          </div>
        </div>

        <div className="tk-tape-price">
          {liveHero ? (
            <>
              <div className="tk-price num">${fmt(livePrice, 2)}</div>
              <div className={`tk-priceΔ num ${livePct >= 0 ? 'up' : 'down'}`}>
                {livePct >= 0 ? '▲' : '▼'} ${Math.abs(livePrice - liveBase).toFixed(2)} ({livePct > 0 ? '+' : ''}{livePct.toFixed(2)}%) today
              </div>
              <div className="tk-liveline num">
                <FreshnessChip elementId="market-lse_intraday-live" variant="dot" />
                <span className="tk-livelabel">Live</span>
                <span>{isIntraday ? <>vs prev close ${fmt(liveBase, 2)}</> : <>vs close{priceAsOf ? <> {fmtDateShort(priceAsOf)}</> : null} ${fmt(liveBase, 2)}</>}</span>
              </div>
            </>
          ) : (
            <>
              <div className="tk-price num">{hasPrice ? `$${fmt(price, 2)}` : resolveLoading ? <span className="rd-skel rd-skel--v" /> : '—'}</div>
              {hasPrice && hasChg && (
                <div className={`tk-priceΔ num ${chgPct >= 0 ? 'up' : 'down'}`}>
                  {chgPct >= 0 ? '▲' : '▼'} ${Math.abs(prevClose != null ? (price - prevClose) : (price * chgPct) / (100 + chgPct)).toFixed(2)}{' '}
                  ({chgPct > 0 ? '+' : ''}{Number(chgPct).toFixed(2)}%)
                  <span className="tk-chgsession">{isIntraday ? ' today' : (priceAsOf ? ` · ${fmtDateShort(priceAsOf)}` : '')}</span>
                </div>
              )}
              <div className="tk-liveline num">
                {liveQ ? (
                  <>
                    <FreshnessChip elementId="market-lse_intraday-live" variant="dot" />
                    {livePrice != null ? (
                      <>
                        {/* "Live" is a claim about the session (LESSONS 4.32). With the
                            market closed this line is an extended-hours or last
                            trade, and it says which (2026-10-29: SPY read "LIVE"
                            at 9:40 PM). */}
                        <span className="tk-livelabel">{closedQuoteLabel(liveQ?.barTs, lseLive.marketOpen)}</span> ${fmt(livePrice, 2)}
                        {livePct != null && (
                          <span className={livePct >= 0 ? 'up' : 'down'}>{' '}{livePct >= 0 ? '+' : ''}{livePct.toFixed(2)}%</span>
                        )}
                      </>
                    ) : (
                      <><span className="tk-livelabel">{lseLive.marketOpen === true ? 'Live' : 'Quote'}</span> <span className="tk-livedim">no quote</span></>
                    )}
                  </>
                ) : (
                  <span className="tk-livedim">{priceAsOf ? `${asOfVerb} ${fmtDateShort(priceAsOf)}` : ''}{prevClose != null ? ` · prev ${fmt(prevClose, 2)}` : ''}</span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="tk-tape-range">
          <div className="tk-tape-l">52-week range</div>
          {hasRange ? (
            <>
              <div className="tk-range" style={{ '--pos': `${rangePos}%` }}>
                <span className="num">${fmt(lo52, 2)}</span>
                <span className="tk-range-track"><span className="tk-range-mark" /></span>
                <span className="num">${fmt(hi52, 2)}</span>
              </div>
              <div className="tk-tape-s num">
                <span className="down">{(((headPrice / hi52) - 1) * 100).toFixed(1)}% vs high</span>
              </div>
            </>
          ) : resolveLoading ? <span className="rd-skel rd-skel--line is-short" /> : <div className="tk-tape-s">—</div>}
        </div>

        <div className="tk-tape-ref">
          <TapeStat loading={resolveLoading} label="Open"      value={lastBar?.open != null ? `$${fmt(lastBar.open, 2)}` : '—'} />
          <TapeStat loading={resolveLoading} label="Day range" value={lastBar?.low != null && lastBar?.high != null ? `${fmt(lastBar.low, 2)} – ${fmt(lastBar.high, 2)}` : '—'} />
          <TapeStat loading={resolveLoading} label="Prev close" value={prevClose != null ? `$${fmt(prevClose, 2)}` : '—'} />
          <TapeStat loading={resolveLoading} label="Volume"    value={fmtVol(lastBar?.volume)} sub={avgVol ? `avg ${fmtVol(avgVol)}` : null} />
          <TapeStat loading={resolveLoading} label="Mkt cap"   value={fmtMcap(marketcap)} />
          <TapeStat loading={resolveLoading} label="Shares out" value={fmtVol(sharesOut)} />
          <TapeStat loading={resolveLoading} label="Div yield" value={deep?.loading || deep?.error ? '—' : divYield.value != null ? `${(divYield.value * 100).toFixed(2)}%` : (divYield.note === 'none' ? 'None' : '—')} />
          <TapeStat loading={resolveLoading} label="Short int." value={finra?.short_interest_float_pct != null ? `${Number(finra.short_interest_float_pct).toFixed(1)}%` : '—'} sub={finra?.days_to_cover != null ? `${Number(finra.days_to_cover).toFixed(1)}d to cover` : null} />
        </div>
      </Reveal>

      {/* ── Main row: chart · performance / technicals / risk ── */}
      <div className="tk-mainrow">
      {/* Price chart */}
      <Reveal as="section" className="tk-chartsec">
        <article className="mt-card tk-chartcard">
          <div className="mt-sectionhead tk-charthead">
            <div>
              <div className="mt-eyebrow">Price history</div>
              <div className="mt-h2">
                {hasPrice ? `$${fmt(price, 2)}` : resolveLoading ? <span className="rd-skel rd-skel--v" /> : '—'} <span className="tk-windowlabel">{chartMode === 'tv' ? '· TradingView · candles · intraday · indicators · drawing tools' : `· ${customRange ? 'custom range' : `${tf} window`}${priceAsOf ? ` · ${asOfVerb} ${fmtDateShort(priceAsOf)}` : ''}`}</span>
              </div>
            </div>
            <div className="tk-chartmodes" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-8)', alignItems: 'center', justifyContent: 'flex-end' }}>
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
            <TradingViewChart symbol={tvSymbolFor(sym, exchange)} height={500} />
          ) : (
          <>
          <div className="tk-chartbody" ref={chartBodyRef}>
          {histAll.loading ? (
            <span className="rd-skel rd-skel--chart" aria-label="Price history loading" />
          ) : series.length ? (
            <BigHistoryChart
              points={series}
              accent={chgPct >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
              height={chartH}
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
          </div>
          <div className="tk-overlay" data-layout="natural">
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
          <div className="tk-daterange" data-layout="natural">
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


        <div className="tk-side">
          {/* Performance */}
          <article className="mt-card tk-panel">
            <div className="tk-panelhead">
              <div className="mt-eyebrow">Performance</div>
              <span className="tk-panelnote">total return · vs S&amp;P 500</span>
            </div>
            <table className="tk-ptable num">
              <thead><tr><th /><th>{sym}</th><th>S&amp;P</th><th>+/−</th></tr></thead>
              <tbody>
                {perf.map((r) => (
                  <tr key={r.label}>
                    <td className="tk-ptable-l">{r.label}</td>
                    <td className={toneOf(r.ret)}>{fmtPctFraction(r.ret)}</td>
                    <td className={toneOf(r.bench)}>{fmtPctFraction(r.bench)}</td>
                    <td className={toneOf(r.rel)}>{fmtPctFraction(r.rel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <div className="tk-sidepair">
          {/* Technicals */}
          <article className="mt-card tk-panel">
            <div className="tk-panelhead">
              <div className="mt-eyebrow">Technicals</div>
              <span className="tk-panelnote">daily · from stored history</span>
            </div>
            <dl className="tk-kv">
              <KvRow label="RSI (14)" tip="14-day Wilder RSI. Above 70 is overbought, below 30 oversold."
                value={tech?.rsi_14 != null ? tech.rsi_14.toFixed(1) : '—'}
                note={tech?.rsi_14 == null ? null : tech.rsi_14 >= 70 ? 'overbought' : tech.rsi_14 <= 30 ? 'oversold' : 'neutral'}
                tone={tech?.rsi_14 == null ? '' : tech.rsi_14 >= 70 ? 'down' : tech.rsi_14 <= 30 ? 'up' : ''} />
              <KvRow label="MACD" tip="Whether the trend line sits above its signal line (bullish) or below it (bearish)."
                value={tech?.macd_cross || '—'} tone={tech?.macd_cross === 'bullish' ? 'up' : tech?.macd_cross === 'bearish' ? 'down' : ''} />
              <KvRow label="vs 50-day avg" tip="Percent the price sits above or below its 50-day average."
                value={fmtPctFraction(tech?.pct_vs_50ma)} tone={toneOf(tech?.pct_vs_50ma)} />
              <KvRow label="vs 200-day avg" tip="Percent the price sits above or below its 200-day average."
                value={fmtPctFraction(tech?.pct_vs_200ma)} tone={toneOf(tech?.pct_vs_200ma)} />
              <KvRow label="Volume vs 30d avg" tip="Last session's volume divided by the trailing 30-day average."
                value={tech?.vol_surge != null ? `${tech.vol_surge.toFixed(2)}×` : '—'}
                note={tech?.vol_surge == null ? null : tech.vol_surge >= 1.5 ? 'heavy' : tech.vol_surge <= 0.7 ? 'quiet' : 'normal'} />
            </dl>
          </article>

          {/* Risk */}
          <article className="mt-card tk-panel">
            <div className="tk-panelhead">
              <div className="mt-eyebrow">Risk</div>
              <span className="tk-panelnote">annualized · trailing</span>
            </div>
            <dl className="tk-kv">
              <KvRow label="Beta · 1y" tip="Sensitivity to the S&P 500: covariance of daily returns vs SPY over variance of SPY, trailing year."
                value={beta1y != null ? beta1y.toFixed(2) : '—'} />
              <KvRow label="Realized vol · 30d" tip="Standard deviation of daily log returns over the last 30 sessions, annualized."
                value={risk.vol30 != null ? `${(risk.vol30 * 100).toFixed(1)}%` : '—'} />
              <KvRow label="Realized vol · 1y" tip="Standard deviation of daily log returns over the last 252 sessions, annualized."
                value={risk.vol1y != null ? `${(risk.vol1y * 100).toFixed(1)}%` : '—'} />
              <KvRow label="Max drawdown · 1y" tip="Largest peak-to-trough fall in the closing price over the last 252 sessions."
                value={risk.mdd1y != null ? `${(risk.mdd1y * 100).toFixed(1)}%` : '—'} tone={risk.mdd1y != null ? 'down' : ''} />
              <KvRow label="Avg daily move · 1y" tip="Mean absolute daily return over the last 252 sessions."
                value={risk.avgAbs1y != null ? `${(risk.avgAbs1y * 100).toFixed(2)}%` : '—'} />
            </dl>
          </article>
          </div>
        </div>
      </div>

      {/* ── Second row: news · company ── */}
      <div className="tk-secondrow">
        {/* "No headlines" only once every news source has answered — while any
            is still loading the panel says it is loading (2026-10-29). */}
        <NewsPanel items={mergedNews} loading={liveNews.loading || events.loading || info.loading} />
        <CompanyPanel deep={deep} sector={sector} exchange={exchange} sharesOut={sharesOut} />
      </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

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

/* ---------- performance / risk maths (stored daily history) ---------- */

function closeAt(rows, date) {
  // last close on or before `date`
  let best = null;
  for (const r of rows) { if (r.date <= date) best = r.close; else break; }
  return best;
}

function perfTable(rows, benchRows) {
  const out = [];
  if (!rows.length) return out;
  const last = rows[rows.length - 1];
  const windows = [['1 week', 5], ['1 month', 21], ['3 months', 63], ['YTD', null], ['1 year', 252]];
  for (const [label, n] of windows) {
    let base = null;
    let baseDate = null;
    if (n == null) {
      const y = String(last.date).slice(0, 4);
      const prevYear = rows.filter((r) => r.date < `${y}-01-01`);
      if (prevYear.length) { base = prevYear[prevYear.length - 1]; baseDate = base.date; }
    } else if (rows.length > n) {
      base = rows[rows.length - 1 - n]; baseDate = base.date;
    }
    const ret = base ? (last.close / base.close) - 1 : null;
    let bench = null;
    if (base && benchRows.length) {
      const b0 = closeAt(benchRows, baseDate);
      const b1 = closeAt(benchRows, last.date);
      if (b0 && b1) bench = (b1 / b0) - 1;
    }
    out.push({ label, ret, bench, rel: ret != null && bench != null ? ret - bench : null });
  }
  return out;
}

function riskStats(rows) {
  const n = rows.length;
  if (n < 2) return { vol30: null, vol1y: null, mdd1y: null, avgAbs1y: null };
  const lr = [];
  for (let i = 1; i < n; i += 1) {
    if (rows[i].close > 0 && rows[i - 1].close > 0) lr.push(Math.log(rows[i].close / rows[i - 1].close));
  }
  const sd = (a) => {
    if (a.length < 2) return null;
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
  };
  const vol30 = lr.length >= 20 ? sd(lr.slice(-30)) * Math.sqrt(252) : null;
  const yr = lr.slice(-252);
  const vol1y = lr.length >= 120 ? sd(yr) * Math.sqrt(252) : null;
  const avgAbs1y = yr.length ? yr.reduce((x, y) => x + Math.abs(y), 0) / yr.length : null;
  let peak = -Infinity; let mdd = 0;
  for (const r of rows.slice(-252)) {
    if (r.close > peak) peak = r.close;
    const dd = (r.close / peak) - 1;
    if (dd < mdd) mdd = dd;
  }
  return { vol30, vol1y, mdd1y: rows.length >= 120 ? mdd : null, avgAbs1y };
}

function freqLabel(f) {
  const m = { 12: 'monthly', 4: 'quarterly', 2: 'semi-annual', 1: 'annual', 0: 'one-time' };
  return f == null ? '' : (m[Number(f)] || String(f));
}

function toneOf(v) { return v == null ? '' : v >= 0 ? 'up' : 'down'; }

/* ---------- cockpit pieces ---------- */

function TapeStat({ label, value, sub, loading = false }) {
  // While the page's sources are still loading, a figure that is not in yet
  // is a skeleton, not "—" (which reads as "no such figure").
  const missing = value == null || value === '—';
  return (
    <div className="tk-tapestat">
      <span className="tk-tape-l">{label}</span>
      <b className="num">{loading && missing ? <span className="rd-skel rd-skel--v" /> : value}</b>
      {sub && <span className="tk-tape-s">{sub}</span>}
    </div>
  );
}

function KvRow({ label, value, note, tip, tone = '' }) {
  return (
    <div className="tk-kvrow">
      <dt>
        {label}
        {tip && <Tip content={tip}><span className="tk-info">ⓘ</span></Tip>}
      </dt>
      <dd>
        <b className={`num ${tone}`}>{value}</b>
        {note && <span className="tk-kvnote">{note}</span>}
      </dd>
    </div>
  );
}

function NewsPanel({ items, loading }) {
  return (
    <article className="mt-card tk-panel tk-news">
      <div className="tk-panelhead">
        <div className="mt-eyebrow">News{items.length ? ` · ${items.length}` : ''}{loading ? ' · updating…' : ''}</div>
        <span className="tk-panelnote">Google News · newest first</span>
      </div>
      {!items.length ? (
        <div className="tk-empty">{loading ? 'Loading headlines…' : 'No recent headlines on file for this ticker.'}</div>
      ) : (
        <ul className="tk-newslist">
          {items.slice(0, 14).map((r, i) => (
            <li key={`${r.ts}-${i}`} className="tk-newsrow">
              <span className="tk-newshead">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="tk-newslink">{r.headline || '—'}</a>
                ) : (r.headline || '—')}
              </span>
              <span className="tk-newsmeta"><span className="num">{fmtTimeAgo(r.ts)}</span> · {r.source || '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function CompanyPanel({ deep, sector, exchange, sharesOut }) {
  const ref = deep?.ref || null;
  const desc = ref?.description || null;
  const [openDesc, setOpenDesc] = useState(false);
  const longDesc = !!desc && desc.length > 260;
  const city = ref?.address_city || null;
  const state = ref?.address_state || null;
  const hq = city ? `${city}${state ? `, ${state}` : ''}` : null;
  const employees = ref?.total_employees || null;
  const listed = ref?.list_date || null;
  const site = ref?.homepage_url || null;
  const dividends = (deep?.dividends || []).slice(0, 4);
  const splits = (deep?.splits || []).slice(0, 3);
  return (
    <article className="mt-card tk-panel tk-company">
      <div className="tk-panelhead">
        <div className="mt-eyebrow">Company</div>
        <span className="tk-panelnote">reference data feed</span>
      </div>
      {deep?.loading ? (
        <div aria-busy="true" aria-label="Loading the company profile">
          <span className="rd-skel rd-skel--line" />
          <span className="rd-skel rd-skel--line" />
          <span className="rd-skel rd-skel--line is-short" />
        </div>
      ) : deep?.error && !ref ? (
        <div className="tk-empty">The company profile did not load — refresh to try again.</div>
      ) : desc ? (
        <>
          <p className={`tk-about${longDesc && !openDesc ? ' tk-about--clamp' : ''}`}>{desc}</p>
          {longDesc && (
            <button type="button" className="tk-aboutmore" onClick={() => setOpenDesc((v) => !v)}>
              {openDesc ? 'Less' : 'More'}
            </button>
          )}
        </>
      ) : (
        <div className="tk-empty">No company description on file for this ticker.</div>
      )}
      <dl className="tk-kv tk-kv--2col">
        <KvRow label="Industry"  value={sector || '—'} />
        {exchange && <KvRow label="Exchange" value={exchange} />}
        <KvRow label="HQ"        value={hq || '—'} />
        <KvRow label="Employees" value={employees != null ? Number(employees).toLocaleString() : '—'} />
        <KvRow label="Listed"    value={listed ? `${fmtDateShort(listed)}, ${String(listed).slice(0, 4)}` : '—'} />
        <KvRow label="Shares out" value={fmtVol(sharesOut)} />
        <KvRow label="Website"   value={site ? <a className="tk-newslink" href={site} target="_blank" rel="noopener noreferrer">{site.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a> : '—'} />
      </dl>
      <div className="tk-corp">
        <div>
          <div className="tk-tape-l">Recent dividends</div>
          {deep?.loading ? <span className="rd-skel rd-skel--line is-short" /> : deep?.error ? <div className="tk-tape-s">—</div> : dividends.length === 0 ? <div className="tk-tape-s">None on file.</div> : (
            <ul className="tk-corplist num">
              {dividends.map((d) => (
                <li key={d.ex_dividend_date}><span>{fmtDateShort(d.ex_dividend_date)}</span><b>{d.cash_amount != null ? `$${Number(d.cash_amount).toFixed(2)}` : '—'}</b><span>{freqLabel(d.frequency)}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="tk-tape-l">Splits</div>
          {deep?.loading ? <span className="rd-skel rd-skel--line is-short" /> : deep?.error ? <div className="tk-tape-s">—</div> : splits.length === 0 ? <div className="tk-tape-s">None on file.</div> : (
            <ul className="tk-corplist num">
              {splits.map((sp) => (
                <li key={sp.execution_date}><span>{fmtDateShort(sp.execution_date)}</span><b>{sp.split_to}-for-{sp.split_from}</b><span /></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}

function UnknownTicker({ sym, suggestions, onBack, onPick }) {
  const rows = suggestions?.rows || [];
  const best = rows[0] || null;
  return (
    <div className="home-v12 v13 ticker-v12">
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
