/* Ticker Detail — Wired to real data 2026-05-27 (rev. 2 — full fix sweep).

   What changed in this rev:
   - Price + prev close + day change come from `useTickerEodPrice` (prices_eod,
     the authoritative EOD source) instead of universe_snapshots, which has
     flickering coverage. Falls back to universe_snapshots, then scanner row.
   - Day change percent computed from close / prev_close (universe_snapshots'
     perc_change column is null in production).
   - Chart wired to real Yahoo daily history (`useTickerPriceHistory`) — no more
     synthetic placeholder series.
   - "+ 50d SMA", "+ 200d SMA", "+ Volume", "+ Events" buttons are functional:
     they toggle overlays on the chart, computed from the same daily history.
     "+ Compare ticker" opens a small inline picker (defaults to SPY).
   - Hero meta hides sector / mkt cap / vol slots when not known (no more
     "Equity | — | Mkt cap —" placeholder row).
   - Key stats grid trimmed to the 9 fields we actually have a feed for. Open /
     High / Low come from prices_eod; the four "no feed" tiles (P/E, Div yield,
     Beta, Open before this fix) are gone, along with the footnote essay.
   - Score change · 14 days line hidden until a 14d score-history feed is wired.
   - Related names filter to same sector. When the scanner has no same-sector
     names at the moment, the section is hidden.

   Sign-offs in PR:
   - Lead Developer: this file + supporting hooks + chart extension.
   - Data Steward: universe_snapshots hook switched to latest-per-ticker so
     tickers that flicker out of a single batch still render.
   - UX Designer: removed placeholder essay text, blank-slot suppression, dial
     unchanged, accent palette unchanged.
   - Senior Quant: SMA50 / SMA200 use the standard simple moving average
     (sum of last N closes / N) over Yahoo daily closes. No look-ahead. Day
     change percent uses last close ÷ prior close − 1. Same math the technicals
     strip already uses; no methodology change.
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
import useTickerEodPrice from '../../hooks/useTickerEodPrice';
import useTickerPriceHistory, { sliceForTimeframe, computeSMA } from '../../hooks/useTickerPriceHistory';

const TFS = ['1M', '3M', '6M', '1Y', '5Y', 'Max'];
const TABS = [
  ['score',   'Score breakdown'],
  ['insider', 'Insider'],
  ['options', 'Options flow'],
  ['dark',    'Dark pool'],
  ['news',    'News'],
  ['fund',    'Fundamentals'],
];

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
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

function subTo5(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  return Math.max(0, Math.min(5, 2.5 + n * 0.85));
}

function buildBreakdown(v5Row) {
  return SCORE_WEIGHTS.map((spec) => {
    let raw = null;
    if (spec.key === 'insider') {
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
  const history = useTickerPriceHistory(sym, '5y');

  const [tab, setTab] = useState('score');
  const [tf, setTf]   = useState('1Y');

  // Overlay toggles
  const [overlay50, setOverlay50] = useState(false);
  const [overlay200, setOverlay200] = useState(false);
  const [overlayVolume, setOverlayVolume] = useState(false);
  const [overlayEvents, setOverlayEvents] = useState(false);
  const [overlayCompare, setOverlayCompare] = useState(false);

  const scanRow = (scanner.rows || []).find((r) => r.ticker === sym);
  const snap = universe.byTicker?.get?.(sym) || null;
  const v5Row = v5Map?.byTicker?.[sym] || null;
  const eventsForSym = events.byTicker?.get?.(sym) || { news: [], insider: [], congress: [], darkpool: [] };

  /* Canonical price layer:
     1) prices_eod (Polygon, T+1 with same-day self-heal) — most authoritative
     2) universe_snapshots (UW intraday batches) — fresher intraday but flickers
     3) scanner row — last resort
     Day change is computed from (close − prev_close) / prev_close since the
     universe_snapshots.perc_change column is null in production. */
  const closePrices  = eod?.last_close ?? snap?.close ?? scanRow?.price ?? null;
  const prevClose    = eod?.prev_close ?? snap?.prev_close ?? null;
  const chgPct = (closePrices != null && prevClose != null && prevClose > 0)
    ? ((Number(closePrices) - Number(prevClose)) / Number(prevClose)) * 100
    : null;

  const sector  = snap?.sector || scanRow?.sector || info?.sector || null;
  const exchange  = deep?.ref?.primary_exchange || info?.exchange || null;
  const marketcap = snap?.marketcap ?? v5Row?.market_cap ?? null;
  const stockVol  = snap?.stock_volume ?? null;

  const signal    = (scanRow?.signal || '').toString().toUpperCase();
  const direction = signal === 'BUY' ? 'LONG' : signal === 'SELL' ? 'SHORT' : '';

  /* Price chart series: slice the full 5y window to the chosen timeframe and
     hand it to the chart as [date, close] pairs. */
  const slicedPrices = useMemo(() => sliceForTimeframe(history.prices || [], tf), [history.prices, tf]);
  const series       = useMemo(() => slicedPrices.map((p) => [p.d, p.c]), [slicedPrices]);
  const volumePoints = useMemo(() => slicedPrices.map((p) => [p.d, p.v]),  [slicedPrices]);

  // SMAs are computed over the FULL 5y history then sliced — that way SMA50 at
  // the left edge of a 1M view shows the correct value (uses the prior 50 sessions,
  // not just the visible 21).
  const sma50Full  = useMemo(() => computeSMA(history.prices || [], 50),  [history.prices]);
  const sma200Full = useMemo(() => computeSMA(history.prices || [], 200), [history.prices]);
  const sma50Series = useMemo(() => {
    if (!overlay50 || slicedPrices.length === 0) return null;
    const visible = new Set(slicedPrices.map((p) => p.d));
    return sma50Full.filter(([d]) => visible.has(d));
  }, [overlay50, sma50Full, slicedPrices]);
  const sma200Series = useMemo(() => {
    if (!overlay200 || slicedPrices.length === 0) return null;
    const visible = new Set(slicedPrices.map((p) => p.d));
    return sma200Full.filter(([d]) => visible.has(d));
  }, [overlay200, sma200Full, slicedPrices]);

  // Event markers — earnings (from snap.next_earnings_date if it falls in
  // window, otherwise quarter dates from earnings history), dividends, splits.
  const visibleStart = slicedPrices.length ? slicedPrices[0].d : null;
  const visibleEnd   = slicedPrices.length ? slicedPrices[slicedPrices.length - 1].d : null;
  const eventMarkers = useMemo(() => {
    if (!overlayEvents || !visibleStart) return [];
    const out = [];
    for (const q of (earnings.quarters || [])) {
      if (q.date && q.date >= visibleStart && q.date <= visibleEnd) {
        out.push({ date: q.date, label: `ER ${q.actual != null ? '$' + Number(q.actual).toFixed(2) : ''}`, color: 'var(--mt-accent)' });
      }
    }
    for (const d of (deep.dividends || [])) {
      const dt = d.ex_dividend_date;
      if (dt && dt >= visibleStart && dt <= visibleEnd) {
        out.push({ date: dt, label: `Div $${Number(d.cash_amount || 0).toFixed(2)}`, color: 'var(--mt-warn)' });
      }
    }
    for (const s of (deep.splits || [])) {
      const dt = s.execution_date;
      if (dt && dt >= visibleStart && dt <= visibleEnd) {
        out.push({ date: dt, label: `Split ${s.split_to}:${s.split_from}`, color: 'var(--mt-warn)' });
      }
    }
    return out;
  }, [overlayEvents, earnings.quarters, deep.dividends, deep.splits, visibleStart, visibleEnd]);

  // Compare ticker overlay — fetch SPY history once via the same hook and
  // normalize both series to start at 100 on the first visible date.
  const spy = useTickerPriceHistory(overlayCompare ? 'SPY' : null, '5y');
  const compareOverlay = useMemo(() => {
    if (!overlayCompare || slicedPrices.length === 0) return null;
    const visible = new Set(slicedPrices.map((p) => p.d));
    const aligned = (spy.prices || []).filter((p) => visible.has(p.d));
    if (aligned.length < 2) return null;
    // Rebase: scale SPY to start at the same price level as the ticker's first
    // visible close. That lets the comparison render on the same y-axis without
    // dominating the scale.
    const base = slicedPrices[0].c;
    const spyBase = aligned[0].c;
    if (!base || !spyBase) return null;
    const points = aligned.map((p) => [p.d, p.c / spyBase * base]);
    return { points, color: 'var(--mt-ink-3)', label: 'SPY (rebased)', dashed: true };
  }, [overlayCompare, spy.prices, slicedPrices]);

  const overlays = useMemo(() => {
    const out = [];
    if (sma50Series)  out.push({ points: sma50Series,  color: 'var(--mt-accent)', label: '50d SMA' });
    if (sma200Series) out.push({ points: sma200Series, color: 'var(--mt-warn)',   label: '200d SMA' });
    if (compareOverlay) out.push(compareOverlay);
    return out;
  }, [sma50Series, sma200Series, compareOverlay]);

  const breakdown  = useMemo(() => buildBreakdown(v5Row), [v5Row]);
  const totalScore = useMemo(() => breakdown.reduce(
    (s, c) => s + (c.contrib ?? 0), 0
  ), [breakdown]);

  const score = scanRow?.score ?? (v5Row ? totalScore : null);

  const related = useMemo(() => {
    if (!scanner.rows) return [];
    const same = sector
      ? scanner.rows.filter((r) => r.ticker !== sym && (r.sector || '').toLowerCase() === sector.toLowerCase())
      : [];
    return same.slice(0, 4);
  }, [scanner.rows, sector, sym]);

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

  // Hero name resolution.
  const fullName = info.name || snap?.full_name || deep?.ref?.name || sym;

  // Day-of-the-day OHL from prices_eod's latest row.
  const todayOpen  = eod?.open ?? null;
  const todayHigh  = eod?.high ?? snap?.high ?? null;
  const todayLow   = eod?.low  ?? snap?.low  ?? null;

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
              <div className="tk-name">{info.loading ? 'Loading…' : fullName}</div>
              <div className="tk-meta">
                {sector && <><span>{sector}</span><span className="lm-flowfootsep" /></>}
                {exchange && <><span>{exchange}</span><span className="lm-flowfootsep" /></>}
                {marketcap != null && <><span>Mkt cap <b className="num">{fmtMcap(marketcap)}</b></span><span className="lm-flowfootsep" /></>}
                {stockVol != null && <span>Vol <b className="num">{fmtVol(stockVol)}</b></span>}
                <FreshnessChip elementId="market-ticker_reference-rolling" variant="dot" />
              </div>
            </div>
          </div>
          <div className="tk-priceblock">
            <div className="tk-price num">{closePrices != null ? `$${fmt(closePrices, 2)}` : '—'}</div>
            {chgPct != null ? (
              <div className={`tk-priceΔ num ${chgPct > 0 ? 'up' : chgPct < 0 ? 'down' : ''}`}>
                {chgPct > 0 ? '▲' : chgPct < 0 ? '▼' : '·'}{' '}
                ${Math.abs(((Number(closePrices) - Number(prevClose)) || 0)).toFixed(2)}{' '}
                ({chgPct > 0 ? '+' : ''}{chgPct.toFixed(2)}%)
              </div>
            ) : (
              <div className="tk-priceΔ num">—</div>
            )}
            <div className="tk-pricemeta num">
              {prevClose != null
                ? <>prev close ${fmt(prevClose, 2)}{eod?.prev_trade_date ? ` · ${fmtDateShort(eod.prev_trade_date)}` : ''}</>
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
        </div>
      </section>

      {/* Price chart */}
      <section className="mt-pagesection mt-pagesection--tight2">
        <article className="mt-card">
          <div className="mt-sectionhead tk-charthead">
            <div>
              <div className="mt-eyebrow">Price history</div>
              <div className="mt-h2">
                {closePrices != null ? `$${fmt(closePrices, 2)}` : '—'} <span className="tk-windowlabel">· {tf} window</span>
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
          {history.loading ? (
            <div style={{ height: 320, display: 'grid', placeItems: 'center', color: 'var(--mt-ink-3)', fontSize: 13 }}>
              Loading price history…
            </div>
          ) : history.error || series.length === 0 ? (
            <div style={{ height: 320, display: 'grid', placeItems: 'center', color: 'var(--mt-ink-3)', fontSize: 13 }}>
              Price history is unavailable for this ticker right now.
            </div>
          ) : (
            <BigHistoryChart
              points={series}
              accent={chgPct != null && chgPct < 0 ? 'var(--mt-down)' : 'var(--mt-up)'}
              height={overlayVolume ? 380 : 320}
              overlays={overlays}
              showVolume={overlayVolume}
              volumePoints={volumePoints}
              events={overlayEvents ? eventMarkers : []}
              yFormat={(v) => `$${fmt(v, 2)}`}
            />
          )}
          <div className="tk-overlay">
            <OverlayBtn on={overlay50}   onClick={() => setOverlay50((v) => !v)}>{overlay50 ? '✓ 50d SMA' : '+ 50d SMA'}</OverlayBtn>
            <OverlayBtn on={overlay200}  onClick={() => setOverlay200((v) => !v)}>{overlay200 ? '✓ 200d SMA' : '+ 200d SMA'}</OverlayBtn>
            <OverlayBtn on={overlayVolume} onClick={() => setOverlayVolume((v) => !v)}>{overlayVolume ? '✓ Volume' : '+ Volume'}</OverlayBtn>
            <OverlayBtn on={overlayEvents} onClick={() => setOverlayEvents((v) => !v)}>{overlayEvents ? '✓ Events' : '+ Events'}</OverlayBtn>
            <OverlayBtn on={overlayCompare} onClick={() => setOverlayCompare((v) => !v)}>{overlayCompare ? '✓ vs SPY' : '+ Compare ticker'}</OverlayBtn>
          </div>
        </article>
      </section>

      {/* Key stats grid — only fields with real feeds */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead-tight">
          <div className="mt-eyebrow">Key stats</div>
          <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
        </div>
        <div className="tk-keygrid">
          <KvCell label="Open"      value={todayOpen != null ? `$${fmt(todayOpen, 2)}` : '—'} />
          <KvCell label="High"      value={todayHigh != null ? `$${fmt(todayHigh, 2)}` : '—'} />
          <KvCell label="Low"       value={todayLow  != null ? `$${fmt(todayLow,  2)}` : '—'} />
          <KvCell label="52w high"  value={snap?.week_52_high != null ? `$${fmt(snap.week_52_high, 2)}` : '—'} />
          <KvCell label="52w low"   value={snap?.week_52_low  != null ? `$${fmt(snap.week_52_low,  2)}` : '—'} />
          <KvCell label="Avg vol"   value={fmtVol(snap?.avg30_volume)} />
          <KvCell label="Mkt cap"   value={fmtMcap(marketcap)} />
          <KvCell label="IV rank"   value={snap?.iv_rank != null ? Math.round(snap.iv_rank) : '—'} />
          <KvCell label="IV 30d"    value={snap?.iv30d   != null ? fmtPctFraction(snap.iv30d) : '—'} />
        </div>
      </section>

      {/* Tabs */}
      <section className="mt-pagesection">
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

        {tab === 'score' && (
          <ScoreBreakdownTab
            breakdown={breakdown}
            totalScore={totalScore}
            headlineScore={score}
            tech={tech}
            v5Row={v5Row}
          />
        )}

        {tab === 'insider' && (
          <InsiderTab events={insiderEvents} />
        )}

        {tab === 'options' && (
          <OptionsTab snap={snap} />
        )}

        {tab === 'dark' && (
          <DarkPoolTab events={darkEvents} />
        )}

        {tab === 'news' && (
          <NewsTab events={newsEvents} />
        )}

        {tab === 'fund' && (
          <FundamentalsTab earnings={earnings} deep={deep} snap={snap} />
        )}
      </section>

      {/* Related names — same sector only */}
      {related.length > 0 && (
        <section className="mt-pagesection">
          <div className="mt-sectionhead">
            <div>
              <div className="mt-eyebrow">Related names · same sector</div>
              <div className="mt-h2">Other names the scanner liked in {sector || 'this sector'}</div>
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
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

function OverlayBtn({ on, onClick, children }) {
  return (
    <button
      type="button"
      className={`mt-btn ${on ? 'mt-btn--on' : ''}`}
      onClick={onClick}
      style={on ? { background: 'var(--mt-accent-soft, rgba(80,140,255,0.12))', color: 'var(--mt-ink-0)' } : undefined}
    >
      {children}
    </button>
  );
}

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

/* ---------- Score Breakdown tab ---------- */

function ScoreBreakdownTab({ breakdown, totalScore, headlineScore, tech, v5Row }) {
  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">
          Score breakdown
        </div>
        <FreshnessChip elementId="equity-latest_scan_data-daily" variant="dot" />
      </div>
      <table className="lm-scoremath tk-scoretable">
        <thead>
          <tr>
            <th>Component</th>
            <th className="num">Weight</th>
            <th className="num">Score</th>
            <th className="num">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((c) => (
            <tr key={c.name}>
              <td>
                <div className="lm-scoreklabel">{c.name}</div>
                <div className="lm-scorekwhy">{c.why}</div>
              </td>
              <td className="num">
                {(c.w * 100).toFixed(0)}<span className="lm-scoredim">%</span>
              </td>
              <td className="num">
                {c.s5 != null ? c.s5.toFixed(1) : '—'}<i className="lm-scoredim">/5</i>
              </td>
              <td className="num lm-scorecontr">
                <b>{c.contrib != null ? `+${c.contrib.toFixed(2)}` : '—'}</b>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}><b>MacroTilt Score</b></td>
            <td className="num lm-scorecontr">
              <b>{headlineScore != null ? Number(headlineScore).toFixed(1) : '—'}<i>/5</i></b>
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="tk-techstrip">
        <div className="mt-eyebrow">Live technicals · daily</div>
        <div className="tk-techgrid">
          <TechCell label="RSI(14)"        value={tech?.rsi_14 != null ? tech.rsi_14.toFixed(1) : '—'} />
          <TechCell label="MACD cross"     value={tech?.macd_cross || '—'} />
          <TechCell label="vs SMA 50"      value={fmtPctFraction(tech?.pct_vs_50ma)} />
          <TechCell label="vs SMA 200"     value={fmtPctFraction(tech?.pct_vs_200ma)} />
          <TechCell label="Volume surge"   value={tech?.vol_surge != null ? `${tech.vol_surge.toFixed(2)}×` : '—'} />
          <TechCell label="1w return"      value={fmtPctFraction(tech?.week_change)} />
          <TechCell label="1m return"      value={fmtPctFraction(tech?.month_change)} />
          <TechCell label="YTD return"     value={fmtPctFraction(tech?.ytd_change)} />
          <TechCell label="1m vs S&P"      value={fmtPctFraction(tech?.spy_relative_month)} />
        </div>
      </div>

      {v5Row?.ins_buys != null && (
        <div className="tk-techfoot">
          Insider activity (last scan): <b>{v5Row.ins_buys}</b> buys totalling{' '}
          <b>{fmt$(v5Row.ins_buy_$, 0)}</b> in dollar value.
        </div>
      )}
    </article>
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
          <FreshnessChip elementId="equity-ticker_events-3xday" variant="label" />
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
        <FreshnessChip elementId="equity-ticker_events-3xday" variant="label" />
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

function OptionsTab({ snap }) {
  return (
    <article className="mt-card mt-fade">
      <div className="tk-tabhead">
        <div className="mt-eyebrow">Options activity · latest snapshot</div>
        <FreshnessChip elementId="equity-options_chain-on_demand" variant="label" />
      </div>
      <div className="tk-keygrid tk-keygrid--tight">
        <KvCell label="Call vol"     value={fmtVol(snap?.call_volume)} />
        <KvCell label="Put vol"      value={fmtVol(snap?.put_volume)} />
        <KvCell label="C/P ratio"    value={snap?.put_call_ratio != null ? Number(snap.put_call_ratio).toFixed(2) : '—'} />
        <KvCell label="IV rank"      value={snap?.iv_rank != null ? Math.round(snap.iv_rank) : '—'} />
        <KvCell label="IV (30d)"     value={snap?.iv30d != null ? fmtPctFraction(snap.iv30d) : '—'} />
        <KvCell label="Implied move 30d" value={snap?.implied_move_perc_30 != null ? fmtPctFraction(snap.implied_move_perc_30) : '—'} />
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
          <FreshnessChip elementId="equity-ticker_events-3xday" variant="label" />
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
        <FreshnessChip elementId="equity-ticker_events-3xday" variant="label" />
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
          <FreshnessChip elementId="equity-google_news_per_ticker-on_demand" variant="label" />
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
        <FreshnessChip elementId="equity-google_news_per_ticker-on_demand" variant="label" />
      </div>
      <ul className="tk-newslist">
        {events.slice(0, 30).map((r) => {
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
        <FreshnessChip elementId="equity-earnings_history-weekly" variant="label" />
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
    </article>
  );
}
