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

const TFS = ['1M', '3M', '6M', '1Y', '5Y', 'Max'];
/* Detail feeds shown in the activity section. Score composition is NOT here —
   it's an always-visible section, not a per-source feed. */
const TABS = [
  ['insider', 'Insider'],
  ['options', 'Options flow'],
  ['dark',    'Dark pool'],
  ['news',    'News'],
  ['fund',    'Fundamentals'],
];

/* Framework score weights (published MacroTilt scoring methodology). The
   per-row Score and Contribution values are derived from real sub-scores
   below when available. */
const SCORE_WEIGHTS = [
  { key: 'sub_technicals',     name: 'Technicals',  why: '200d trend, RSI, MACD',         w: 0.25 },
  { key: 'insider',            name: 'Insider',     why: 'C-suite buys / sells',          w: 0.20 },
  { key: 'sub_analyst',        name: 'Analyst',     why: 'Upgrades, raised PTs',          w: 0.20 },
  { key: 'sub_options',        name: 'Options vol', why: 'Calls/puts, IV rank',           w: 0.15 },
  { key: 'sub_congress',       name: 'Congress',    why: 'Senate + House disclosures',    w: 0.10 },
  { key: 'sub_short_interest', name: 'Short int.',  why: 'Short interest read',           w: 0.10 },
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

/* ---------- score helpers ---------- */

/* Convert a raw sub-score (-10..+10 typical range from v5 scorer) into a
   0-5 display value. Negative scores clamp to 0 — the breakdown shows
   how MUCH each category contributed, not direction. */
function subTo5(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  // The v5 sub_scores roughly land in -3..+3; map to 0..5 with 0 → 2.5.
  return Math.max(0, Math.min(5, 2.5 + n * 0.85));
}

/* Build the breakdown rows from v5 sub-scores + insider counts. */
function buildBreakdown(v5Row) {
  return SCORE_WEIGHTS.map((spec) => {
    let raw = null;
    if (spec.key === 'insider') {
      // Insider has no direct sub_insider field in v5 — derive from buy count.
      const n = v5Row?.ins_buys;
      if (n != null && Number.isFinite(Number(n))) {
        raw = n === 0 ? 0 : Math.min(3, Math.log2(Number(n) + 1));
      }
    } else {
      raw = v5Row?.[spec.key];
    }
    const s5 = subTo5(raw);
    const contrib = s5 != null ? (s5 / 5) * spec.w * 5 : null;
    return { ...spec, s5, contrib };
  });
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

  const [tab, setTab] = useState('insider');
  const [tf, setTf]   = useState('1Y');
  const [show50, setShow50]       = useState(false);
  const [show200, setShow200]     = useState(false);
  const [showVol, setShowVol]     = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [compareSym, setCompareSym] = useState('');
  const compareHist = useTickerEodHistory(compareSym || null);

  const scanRow = (scanner.rows || []).find((r) => r.ticker === sym);
  const snap = universe.byTicker?.get?.(sym) || null;
  const v5Row = v5Map?.byTicker?.[sym] || null;
  const eventsForSym = events.byTicker?.get?.(sym) || { news: [], insider: [], congress: [], darkpool: [] };

  /* Composite price / score — scanner row is canonical 0-5. When the scanner
     doesn't carry this ticker (it ranks only the top discovery names), fall
     back to the totalScore from the v5 breakdown below — which is also 0-5
     because every sub-score is mapped to 0-5 first. v5's raw mt_score uses a
     different scale and would over-rotate the dial. */
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
  const windowRows = useMemo(() => {
    const n = tfMap[tf] || 252;
    return hist.slice(Math.max(0, hist.length - n));
  }, [hist, tf]);
  const windowDates = useMemo(() => new Set(windowRows.map((r) => r.date)), [windowRows]);
  const series   = useMemo(() => windowRows.map((r) => [r.date, r.close]), [windowRows]);
  const sma50Win  = useMemo(() => sma50Full.filter(([d]) => windowDates.has(d)), [sma50Full, windowDates]);
  const sma200Win = useMemo(() => sma200Full.filter(([d]) => windowDates.has(d)), [sma200Full, windowDates]);
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
    (eventsForSym.insider || []).forEach((e) => {
      const d = snapDate(e.payload?.transaction_date || e.event_ts);
      if (d) evs.push({ date: d, label: 'Insider', color: 'var(--mt-up)' });
    });
    (eventsForSym.darkpool || []).forEach((e) => {
      const d = snapDate(e.payload?.executed_at || e.event_ts);
      if (d) evs.push({ date: d, label: 'Dark pool', color: 'var(--mt-accent)' });
    });
    return evs;
  }, [windowRows, eventsForSym]);

  const overlays = [];
  if (show50)  overlays.push({ points: sma50Win,  color: 'var(--mt-accent)', label: '50d SMA', dash: '5 3' });
  if (show200) overlays.push({ points: sma200Win, color: 'var(--mt-warn)',   label: '200d SMA', dash: '5 3' });

  const breakdown  = useMemo(() => buildBreakdown(v5Row), [v5Row]);
  const totalScore = useMemo(() => breakdown.reduce(
    (s, c) => s + (c.contrib ?? 0), 0
  ), [breakdown]);

  /* Dial score — scanner first (canonical 0-5), then the totalScore from the
     v5 breakdown (also 0-5). Never raw v5 mt_score (different scale). */
  const score = scanRow?.score ?? (v5Row ? totalScore : null);

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
              {chgPct >= 0 ? '▲' : '▼'} ${Math.abs((price * chgPct) / 100).toFixed(2)}{' '}
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
            <ScoreDial score={score != null ? score : 0} max={5} size={96} />
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

      {/* Price chart */}
      <section className="mt-pagesection mt-pagesection--tight2">
        <article className="mt-card">
          <div className="mt-sectionhead tk-charthead">
            <div>
              <div className="mt-eyebrow">Price history</div>
              <div className="mt-h2">
                ${fmt(price, 2)} <span className="tk-windowlabel">· {tf} window{priceAsOf ? ` · close ${fmtDateShort(priceAsOf)}` : ''}</span>
              </div>
            </div>
            <div className="mt-pillgroup">
              {TFS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`mt-pill ${tf === k ? 'on' : ''}`}
                  onClick={() => setTf(k)}
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
              height={320}
              freq="D"
              overlays={overlays}
              volume={showVol ? volumeWin : null}
              events={showEvents ? chartEvents : []}
              compareData={compareSym ? compareSeries : null}
              compareLabel={compareSym}
              yFormat={(v) => `$${fmt(v, 2)}`}
            />
          ) : (
            <div style={{ height: 320, display: 'grid', placeItems: 'center', color: 'var(--mt-ink-3)' }}>
              No price history on file for {sym}.
            </div>
          )}
          <div className="tk-overlay">
            <button type="button" className={`mt-btn ${show50 ? 'on' : ''}`} onClick={() => setShow50((v) => !v)}>
              {show50 ? '✓ ' : '+ '}50d SMA
            </button>
            <button type="button" className={`mt-btn ${show200 ? 'on' : ''}`} onClick={() => setShow200((v) => !v)}>
              {show200 ? '✓ ' : '+ '}200d SMA
            </button>
            <button type="button" className={`mt-btn ${showVol ? 'on' : ''}`} onClick={() => setShowVol((v) => !v)}>
              {showVol ? '✓ ' : '+ '}Volume
            </button>
            <button type="button" className={`mt-btn ${showEvents ? 'on' : ''}`} onClick={() => setShowEvents((v) => !v)}>
              {showEvents ? '✓ ' : '+ '}Events
            </button>
            <select
              className="mt-btn"
              value={compareSym}
              onChange={(e) => setCompareSym(e.target.value)}
              style={{ cursor: 'pointer' }}
            >
              <option value="">+ Compare ticker</option>
              {(scanner.rows || [])
                .filter((r) => r.ticker !== sym)
                .map((r) => (
                  <option key={r.ticker} value={r.ticker}>{r.ticker}</option>
                ))}
            </select>
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
          <KvCell label="Open"      value={lastBar?.open != null ? `$${fmt(lastBar.open, 2)}` : '—'} />
          <KvCell label="High"      value={lastBar?.high != null ? `$${fmt(lastBar.high, 2)}` : (snap?.high != null ? `$${fmt(snap.high, 2)}` : '—')} />
          <KvCell label="Low"       value={lastBar?.low  != null ? `$${fmt(lastBar.low, 2)}`  : (snap?.low  != null ? `$${fmt(snap.low, 2)}`  : '—')} />
          <KvCell label="52w high"  value={hi52 != null ? `$${fmt(hi52, 2)}` : '—'} />
          <KvCell label="52w low"   value={lo52 != null ? `$${fmt(lo52, 2)}` : '—'} />
          <KvCell label="Avg vol"   value={fmtVol(avgVol)} />
          <KvCell label="Mkt cap"   value={fmtMcap(marketcap)} />
          <KvCell label="IV rank"   value={ivRankVal != null ? Math.round(ivRankVal) : '—'} />
          <KvCell label="IV 30d"    value={iv30Display} />
          <KvCell label="P/E"       value="—" />
          <KvCell label="Div yield" value="—" />
          <KvCell label="Beta"      value="—" />
        </div>

        {/* Live technicals — moved here from the score tab; computed on the fly
            from daily history (no scanner lag), so they live with the stats. */}
        <div className="tk-techstrip">
          <div className="mt-eyebrow">Live technicals · daily</div>
          <div className="tk-techgrid">
            <TechCell label="RSI(14)"      value={tech?.rsi_14 != null ? tech.rsi_14.toFixed(1) : '—'} />
            <TechCell label="MACD cross"   value={tech?.macd_cross || '—'} />
            <TechCell label="vs SMA 50"    value={fmtPctFraction(tech?.pct_vs_50ma)} />
            <TechCell label="vs SMA 200"   value={fmtPctFraction(tech?.pct_vs_200ma)} />
            <TechCell label="Volume surge" value={tech?.vol_surge != null ? `${tech.vol_surge.toFixed(2)}×` : '—'} />
            <TechCell label="1w return"    value={fmtPctFraction(tech?.week_change)} />
            <TechCell label="1m return"    value={fmtPctFraction(tech?.month_change)} />
            <TechCell label="YTD return"   value={fmtPctFraction(tech?.ytd_change)} />
            <TechCell label="1m vs S&P"    value={fmtPctFraction(tech?.spy_relative_month)} />
          </div>
        </div>

        <div className="tk-emptyfoot">
          Open / High / Low and average volume come from the daily price history;
          52-week range, market cap, and IV come from the latest scan. Live technicals
          are computed from daily history. P/E, dividend yield, and beta require a
          fundamentals feed not yet wired.
        </div>
      </section>

      {/* Score composition — always visible, ties out to the dial above */}
      <section className="mt-pagesection">
        <article className="mt-card">
          <div className="mt-sectionhead-tight">
            <div className="mt-eyebrow">
              Score composition{score != null ? ` · why the ${Number(score).toFixed(1)} / 5` : ''}
            </div>
          </div>
          {comp ? (
            <table className="lm-scoremath tk-scoretable">
              <thead>
                <tr><th>Component</th><th>Reading</th><th className="num">Points</th></tr>
              </thead>
              <tbody>
                {comp.items.map((c) => {
                  const zero = !(c.points > 0);
                  return (
                    <tr key={c.key}>
                      <td>
                        <div className="lm-scoreklabel">{c.key}</div>
                        <div className="lm-scorekwhy">{c.why}</div>
                      </td>
                      <td style={{ color: zero ? 'var(--mt-ink-3)' : 'var(--mt-ink-1)' }}>{readingForScan(c.key, scanRow)}</td>
                      <td className="num lm-scorecontr"><b>{c.points > 0 ? '+' : ''}{c.points.toFixed(2)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><b>MacroTilt Score</b></td>
                  <td className="num lm-scorecontr"><b>{comp.total.toFixed(2)}<i>/5</i></b></td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <div className="tk-empty">This name isn't in today's scan, so there's no MacroTilt Score breakdown.</div>
          )}
        </article>
      </section>

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

        {tab === 'insider' && <InsiderTab events={insiderEvents} />}
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

function KvCell({ label, value }) {
  return (
    <div className="tk-kvcell">
      <div className="mt-eyebrow">{label}</div>
      <b className="num">{value ?? '—'}</b>
    </div>
  );
}

function TechCell({ label, value }) {
  return (
    <div className="tk-techcell">
      <div className="mt-eyebrow">{label}</div>
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

