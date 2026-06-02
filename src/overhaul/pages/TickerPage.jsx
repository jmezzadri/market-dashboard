/* Ticker Detail — Wired to real data 2026-05-27 evening.

   Replaces the empty-state version that shipped earlier today (PR #841)
   with live data from existing hooks. Every tab now reads real values
   when the user is authenticated; em-dashes gracefully otherwise.

   Data sources:
   - useTickerEvents       → insider / dark pool / news events (3x/weekday
                             from Unusual Whales firehoses)
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
   - useEarningsHistory    → last 4 quarters EPS estimate/actual/surprise
   - useMassiveTickerInfo  → full name from Polygon
   - useTradingOppsTop     → scanner row for price/score/signal/sector

   Layout follows the prototype tk-* class set unchanged.
*/

import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BigHistoryChart from '../components/BigHistoryChart';
import ScoreDial from '../components/ScoreDial';
import FreshnessChip from '../components/FreshnessChip';
import Tip from '../components/Tip';
import useMassiveTickerInfo from '../../hooks/useMassiveTickerInfo';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import { useTickerEvents } from '../../hooks/useTickerEvents';
import { useUniverseSnapshot } from '../../hooks/useUniverseSnapshot';
import useTickerTechnicalsLive from '../../hooks/useTickerTechnicalsLive';
import useTickerDeepDive from '../../hooks/useTickerDeepDive';
import useV5ScanBatch from '../../hooks/useV5ScanBatch';
import { useEarningsHistory } from '../../hooks/useEarningsHistory';
import useTickerEodHistory from '../../hooks/useTickerEodHistory';
import useTickerEodPrice from '../../hooks/useTickerEodPrice';
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
  if (key === 'Options flow') return r.options_vol_shock != null ? `Vol shock ${Number(r.options_vol_shock).toFixed(2)}×` : 'No options shock';
  if (key === 'Dark pool') return r.dark_pool_anchor != null ? `Anchor $${Number(r.dark_pool_anchor).toFixed(2)}` : 'No anchor print';
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
  ['options', 'Options flow'],
  ['dark',    'Dark pool'],
  ['news',    'News'],
  ['fund',    'Fundamentals'],
];

/* ---------- formatters ---------- */

function fmt(v, decimals = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 0,
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
const SCORE_CAPS = { Insider: 4, Technicals: 1, 'Options flow': 4, 'Dark pool': 2 };

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
  const earnings = useEarningsHistory(sym);
  const eod = useTickerEodPrice(sym);
  const histAll = useTickerEodHistory(sym);

  const [tab, setTab] = useState('news');
  const [tf, setTf]   = useState('1Y');
  const [show50, setShow50]       = useState(false);
  const [show200, setShow200]     = useState(false);
  const [showVol, setShowVol]     = useState(false);
  const [showEvents, setShowEvents] = useState(false);
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
  const chgPct  = eod?.day_pct != null
    ? Number(eod.day_pct)
    : (snap?.perc_change != null
        ? Number(snap.perc_change) * (Math.abs(snap.perc_change) < 1 ? 100 : 1)
        : (scanRow?.chg ?? 0));
  const prevClose = eod?.prev_close ?? snap?.prev_close ?? null;
  const priceAsOf = eod?.trade_date || null;
  const exchange  = deep?.ref?.primary_exchange || info?.exchange || null;
  const marketcap = snap?.marketcap ?? scanRow?.marketCap ?? v5Row?.market_cap ?? null;
  const stockVol  = snap?.stock_volume ?? scanRow?.volume ?? null;

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
  const ivRankVal = snap?.iv_rank ?? scanRow?.iv_rank ?? null;
  const iv30Display = snap?.iv30d != null ? fmtPctFraction(snap.iv30d)
    : (scanRow?.iv != null ? `${Number(scanRow.iv).toFixed(1)}%` : '—');
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

  const related = (scanner.rows || []).filter((r) => r.ticker !== sym).slice(0, 4);

  /* Sort events newest first for the tabs. */
  const insiderEvents = useMemo(
    () => [...(eventsForSym.insider || [])].sort((a, b) => (b.event_ts || '').localeCompare(a.event_ts || '')),
    [eventsForSym.insider],
  );
  const darkEvents = useMemo(
    () => [...(eventsForSym.darkpool || [])].sort((a, b) => (b.event_ts || '').localeCompare(a.event_ts || '')),
    [eventsForSym.darkpool],
  );
  const newsEvents = useMemo(
    () => [...(eventsForSym.news || [])].sort((a, b) => (b.event_ts || '').localeCompare(a.event_ts || '')),
    [eventsForSym.news],
  );

  return (
    <div className="mt-pagebody tk-page mt-fade">
      {/* Back row */}
      <div className="tk-backrow">
        <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate(-1)}>
          ← Back to scanner
        </button>
        <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
      </div>

      {/* Hero */}
      <section className="mt-pagehero tk-hero">
        <div>
          <div className="tk-symwrap">
            <h1 className="tk-symbol">{sym}</h1>
            <div>
              <div className="tk-name">{info.loading ? 'Loading…' : (info.name || snap?.full_name || sym)}</div>
              <div className="tk-meta">
                <span>{sector}</span>
                <span className="lm-flowfootsep" />
                <span>{exchange || '—'}</span>
                <span className="lm-flowfootsep" />
                <span>Mkt cap <b className="num">{fmtMcap(marketcap)}</b></span>
                <span className="lm-flowfootsep" />
                <span>Vol <b className="num">{fmtVol(stockVol)}</b></span>
              </div>
            </div>
          </div>
          <div className="tk-priceblock">
            <div className="tk-price num">${fmt(price, 2)}</div>
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
            <div className="tk-pricemeta num">
              {priceAsOf ? <>close {fmtDateShort(priceAsOf)} · </> : null}
              {prevClose != null
                ? <>prev close ${fmt(prevClose, 2)}</>
                : <>prev close —</>}
            </div>
          </div>
        </div>
        <div className="tk-scoreblock">
          <div className="mt-eyebrow">MacroTilt Score</div>
          <div className="tk-bigdial">
            {score != null
              ? <ScoreDial score={score} max={10} size={96} />
              : <div className="tk-noscore">No score<span>not in today's scan</span></div>}
          </div>
          {signal && (
            <span className="mt-tag mt-tag--accent tk-sigpill">
              {signal}{direction ? ` · ${direction}` : ''}
            </span>
          )}
          <div className="tk-scoredelta">
            <span>Score change · 1 week</span>
            <b className="num">{
              (score != null && scanRow?.score_1w != null)
                ? `${(score - scanRow.score_1w) >= 0 ? '+' : ''}${(score - scanRow.score_1w).toFixed(2)}`
                : '—'
            }</b>
          </div>
        </div>
      </section>

      {/* The verdict — expandable score drill-down, right under the identity */}
      <ScoreDrillSection
        scanRow={scanRow}
        comp={comp}
        score={score}
        insiderEvents={insiderEvents}
      />

      {/* Price chart */}
      <section className="mt-pagesection mt-pagesection--tight2">
        <article className="mt-card">
          <div className="mt-sectionhead tk-charthead">
            <div>
              <div className="mt-eyebrow">Price history</div>
              <div className="mt-h2">
                ${fmt(price, 2)} <span className="tk-windowlabel">· {customRange ? 'custom range' : `${tf} window`}{priceAsOf ? ` · close ${fmtDateShort(priceAsOf)}` : ''}</span>
              </div>
            </div>
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
          </div>
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
        </article>
      </section>

      {/* Key stats grid */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead-tight">
          <div className="mt-eyebrow">
            Key stats{priceAsOf ? ` · prior close ${fmtDateShort(priceAsOf)}` : ''}
          </div>
          <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
        </div>
        <div className="tk-keygrid">
          <KvCell label="Open"      tip={`Opening price of the last completed session${priceAsOf ? ` (${fmtDateShort(priceAsOf)})` : ''}.`} value={lastBar?.open != null ? `$${fmt(lastBar.open, 2)}` : '—'} />
          <KvCell label="Day high"  tip="Intraday high of the last completed session — not the 52-week high below." value={lastBar?.high != null ? `$${fmt(lastBar.high, 2)}` : (snap?.high != null ? `$${fmt(snap.high, 2)}` : '—')} />
          <KvCell label="Day low"   tip="Intraday low of the last completed session — not the 52-week low below." value={lastBar?.low  != null ? `$${fmt(lastBar.low, 2)}`  : (snap?.low  != null ? `$${fmt(snap.low, 2)}`  : '—')} />
          <KvCell label="52w high"  tip="Highest intraday price over the trailing ~252 trading days (about one year)." value={hi52 != null ? `$${fmt(hi52, 2)}` : '—'} />
          <KvCell label="52w low"   tip="Lowest intraday price over the trailing ~252 trading days (about one year)." value={lo52 != null ? `$${fmt(lo52, 2)}` : '—'} />
          <KvCell label="Avg vol"   tip="Average daily share volume over the last 30 trading sessions." value={fmtVol(avgVol)} />
          <KvCell label="Mkt cap"   tip="Market value — share price times shares outstanding." value={fmtMcap(marketcap)} />
          <KvCell label="IV rank"   tip="Where current options-implied volatility sits in its own 52-week range, 0–100. Blank when this name has no options data." value={ivRankVal != null ? Math.round(ivRankVal) : '—'} />
          <KvCell label="IV 30d"    tip="Options-implied volatility for about 30-day expiries, annualized." value={iv30Display} />
          <KvCell label="P/E"       tip="Price-to-earnings. Needs a fundamentals feed that isn't wired yet." value="—" />
          <KvCell label="Div yield" tip="Annual dividend as a percent of price. Needs a fundamentals feed that isn't wired yet." value="—" />
          <KvCell label="Beta"      tip="Sensitivity to the broad market. Needs a fundamentals feed that isn't wired yet." value="—" />
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
          Open, day high/low and average volume come from the daily price history;
          52-week range, market cap, and implied volatility come from the latest scan.
          Live technicals are computed from daily history. Hover the ⓘ on any tile for
          its definition. P/E, dividend yield, and beta require a fundamentals feed not
          yet wired.
        </div>
      </section>

      {/* Company overview — restored from the old detail view */}
      <CompanyOverview deep={deep} sector={sector} exchange={exchange} />

      {/* Recent activity & filings — detail feeds, switched by source */}
      <section className="mt-pagesection">
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
              {l}{badgeForTab(id, eventsForSym, earnings)}
            </button>
          ))}
        </div>

        {tab === 'options' && <OptionsTab snap={snap} scanRow={scanRow} />}
        {tab === 'dark'    && <DarkPoolTab events={darkEvents} />}
        {tab === 'news'    && <NewsTab events={newsEvents} />}
        {tab === 'fund'    && <FundamentalsTab earnings={earnings} deep={deep} snap={snap} />}
      </section>

      {/* Related names */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Related names · same sector</div>
            <div className="mt-h2">Other names the scanner liked in {sector}</div>
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
                <ScoreDial score={r.score} max={10} size={36} />
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
      </section>
    </div>
  );
}

/* ---------- helpers ---------- */

function badgeForTab(id, events, earnings) {
  const ct =
    id === 'insider' ? events.insider?.length :
    id === 'dark'    ? events.darkpool?.length :
    id === 'news'    ? events.news?.length :
    id === 'fund'    ? earnings.quarters?.length :
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

/* ---------- Insider tab ---------- */

function InsiderTab({ events }) {
  if (!events.length) {
    return (
      <article className="mt-card mt-fade">
        <div className="tk-tabhead">
          <div className="mt-eyebrow">Recent insider activity · 90d</div>
        </div>
        <div className="tk-empty">
          No insider Form-4 activity reported in the last 90 days.
        </div>
      </article>
    );
  }
  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">Recent insider activity · 90d · {events.length} filings</div>
      </div>
      <div className="tk-tablewrap">
        <table className="tk-evttable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Insider</th>
              <th>Role</th>
              <th>Action</th>
              <th className="num">Shares</th>
              <th className="num">Price</th>
              <th className="num">Value</th>
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
      </div>
      {events.length > 50 && (
        <div className="tk-techfoot">Showing 50 of {events.length} filings.</div>
      )}
    </article>
  );
}

/* ---------- Options tab ---------- */

function OptionsTab({ snap, scanRow }) {
  // Snapshot covers large-caps only; for the scanner's discovery names fall back
  // to the option fields stored on the scan row so the tab isn't all blanks.
  const cpRatio = snap?.put_call_ratio ?? scanRow?.pc_ratio ?? null;
  const ivRank = snap?.iv_rank ?? scanRow?.iv_rank ?? null;
  const iv30 = snap?.iv30d != null ? fmtPctFraction(snap.iv30d)
    : (scanRow?.iv != null ? `${Number(scanRow.iv).toFixed(1)}%` : '—');
  const impMove = snap?.implied_move_perc_30 != null ? fmtPctFraction(snap.implied_move_perc_30)
    : (scanRow?.implied_30d_pct != null ? `${Number(scanRow.implied_30d_pct).toFixed(1)}%` : '—');
  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">Options activity · latest snapshot</div>
      </div>
      <div className="tk-keygrid tk-keygrid--tight">
        <KvCell label="Call vol"     value={fmtVol(snap?.call_volume)} />
        <KvCell label="Put vol"      value={fmtVol(snap?.put_volume)} />
        <KvCell label="C/P ratio"    value={cpRatio != null ? Number(cpRatio).toFixed(2) : '—'} />
        <KvCell label="IV rank"      value={ivRank != null ? Math.round(ivRank) : '—'} />
        <KvCell label="IV (30d)"     value={iv30} />
        <KvCell label="Implied move 30d" value={impMove} />
      </div>
      <div className="tk-techstrip">
        <div className="mt-eyebrow">Premium flow (latest)</div>
        <div className="tk-techgrid">
          <TechCell label="Call premium"   value={fmt$(snap?.call_premium, 0)} />
          <TechCell label="Put premium"    value={fmt$(snap?.put_premium, 0)} />
          <TechCell label="Net call $"     value={fmt$(snap?.net_call_premium, 0)} />
          <TechCell label="Net put $"      value={fmt$(snap?.net_put_premium, 0)} />
          <TechCell label="Bullish $"      value={fmt$(snap?.bullish_premium, 0)} />
          <TechCell label="Bearish $"      value={fmt$(snap?.bearish_premium, 0)} />
        </div>
      </div>
      <div className="tk-emptyfoot">
        Notable sweeps and ticker-level option chain not surfaced here yet —
        the per-ticker options events firehose is a separate pipeline.
      </div>
    </article>
  );
}

/* ---------- Dark pool tab ---------- */

function DarkPoolTab({ events }) {
  if (!events.length) {
    return (
      <article className="mt-card mt-fade">
        <div className="tk-tabhead">
          <div className="mt-eyebrow">Dark-pool prints · 90d</div>
        </div>
        <div className="tk-empty">
          No off-exchange anchor prints detected at material size in the last 90 days.
        </div>
      </article>
    );
  }
  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">Dark-pool prints · 90d · {events.length} prints</div>
      </div>
      <div className="tk-tablewrap">
        <table className="tk-evttable">
          <thead>
            <tr>
              <th>Time</th>
              <th>Exchange</th>
              <th className="num">Price</th>
              <th className="num">Size</th>
              <th className="num">Notional</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 50).map((r) => {
              const p = r.payload || {};
              const notional = Number(p.premium) || (Number(p.price) && Number(p.size) ? Number(p.price) * Number(p.size) : null);
              return (
                <tr key={`${r.event_ts}-${p.price}-${p.size}`}>
                  <td className="num">{fmtTimeAgo(p.executed_at || r.event_ts)}</td>
                  <td>{p.exchange || '—'}</td>
                  <td className="num">{p.price != null ? `$${fmt(p.price, 2)}` : '—'}</td>
                  <td className="num">{fmtVol(p.size)}</td>
                  <td className="num">{notional != null ? fmt$(notional, 0) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {events.length > 50 && (
        <div className="tk-techfoot">Showing 50 of {events.length} prints.</div>
      )}
    </article>
  );
}

/* ---------- News tab ---------- */

function NewsTab({ events }) {
  if (!events.length) {
    return (
      <article className="mt-card mt-fade">
        <div className="tk-tabhead">
          <div className="mt-eyebrow">Recent headlines</div>
        </div>
        <div className="tk-empty">
          No recent headlines on file for this ticker.
        </div>
      </article>
    );
  }
  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">Recent headlines · {events.length}</div>
      </div>
      <ul className="tk-newslist">
        {events.slice(0, 30).map((r, i) => {
          const p = r.payload || {};
          return (
            <li key={`${r.event_ts}-${p.headline}`} className="tk-newsrow">
              <span className="tk-newstime num">{fmtTimeAgo(r.event_ts)}</span>
              <span className="tk-newshead">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="tk-newslink">
                    {p.headline || '—'}
                  </a>
                ) : (p.headline || '—')}
              </span>
              <span className="tk-newssrc">{p.source || '—'}</span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/* ---------- Fundamentals tab ---------- */

function FundamentalsTab({ earnings, deep, snap }) {
  const quarters = earnings.quarters || [];
  const dividends = deep.dividends || [];
  const splits = deep.splits || [];

  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">Fundamentals</div>
      </div>

      <div className="tk-fundheader">
        <div>
          <div className="mt-eyebrow">Last 4 quarters · EPS</div>
          {quarters.length === 0 ? (
            <div className="tk-empty">Earnings history not on file for this ticker.</div>
          ) : (
            <div className="tk-techgrid">
              {quarters.map((q) => (
                <div key={q.date} className="tk-techcell">
                  <div className="mt-eyebrow">{fmtDateShort(q.date)}</div>
                  <b className={`num ${q.beat ? 'up' : 'down'}`}>
                    {q.actual != null ? `$${Number(q.actual).toFixed(2)}` : '—'}
                  </b>
                  <span className="tk-techsub num">
                    est ${q.estimate != null ? Number(q.estimate).toFixed(2) : '—'}
                    {q.surprisePct != null && (
                      <> · {fmtPct(q.surprisePct, 1)}</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mt-eyebrow">Next earnings</div>
          <b className="num">{snap?.next_earnings_date ? fmtDateShort(snap.next_earnings_date) : '—'}</b>
          {snap?.er_time && <span className="tk-techsub num"> · {snap.er_time}</span>}
        </div>
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
        feed not yet wired. Earnings, dividends, splits, and next-ER date come from the
        weekly earnings + Polygon corporate-actions pipelines.
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
  if (!scanRow || !comp) {
    return (
      <section className="mt-pagesection">
        <article className="mt-card">
          <div className="mt-sectionhead-tight">
            <div className="mt-eyebrow">How the score is built</div>
          </div>
          <div className="tk-empty">
            This name isn't in today's scan, so there's no MacroTilt Score breakdown.
          </div>
        </article>
      </section>
    );
  }
  return (
    <section className="mt-pagesection">
      <article className="mt-card">
        <div className="mt-sectionhead-tight">
          <div className="mt-eyebrow">
            How the score is built{score != null ? ` · why the ${Number(score).toFixed(1)} / 10` : ''}
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
          <b className="num">{comp.total.toFixed(2)}<i> / 10</i></b>
        </div>
        <div className="tk-emptyfoot">
          A name makes the list on its insider + trend score (3.0 or higher).
          Options-flow and dark-pool points add on top toward a ceiling of 10 —
          both read 0 for every name today and are not yet backtested.
        </div>
      </article>
    </section>
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
          {comp.key === 'Options flow' && <OptionsDrill scanRow={scanRow} pts={pts} />}
          {comp.key === 'Dark pool'    && <DarkDrill scanRow={scanRow} pts={pts} />}
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

function OptionsDrill({ scanRow, pts }) {
  const shock = scanRow.options_vol_shock;
  return (
    <div className="tk-drill-math">
      <div className="tk-drill-line">
        Unusual options-volume shock versus the stock's own baseline:{' '}
        {shock == null ? 'no qualifying flow detected' : `${Number(shock).toFixed(2)}× baseline`}
        {' '}→ <b className={`num ${pts > 0 ? 'up' : 'is-zero'}`}>{pts > 0 ? '+' : ''}{pts.toFixed(2)}</b>.
      </div>
      <div className="tk-drill-note">
        {pts > 0 ? '' : 'No qualifying unusual options flow today. '}
        Adds up to +4 when unusually heavy call buying shows up on moderately
        out-of-the-money, near-dated contracts. Not yet backtested.
      </div>
    </div>
  );
}

function DarkDrill({ scanRow, pts }) {
  const anchor = scanRow.dark_pool_anchor;
  return (
    <div className="tk-drill-math">
      <div className="tk-drill-line">
        Large off-exchange block prints clustered near the day's average price:{' '}
        {anchor == null ? 'none detected' : `anchored around $${fmt(anchor, 2)}`}
        {' '}→ <b className={`num ${pts > 0 ? 'up' : 'is-zero'}`}>{pts > 0 ? '+' : ''}{pts.toFixed(2)}</b>.
      </div>
      <div className="tk-drill-note">
        {pts > 0 ? '' : 'No qualifying block prints near the average price today. '}
        Adds up to +2 when big institutional prints stack within ~1.5% of the
        volume-weighted average price over a 72-hour window. Not yet backtested.
      </div>
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
    <section className="mt-pagesection">
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
          <KvCell label="Exchange"  value={exchange || '—'} />
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
    </section>
  );
}

