/* DivergencePanel — "RSI Divergences" section on the Trading Scanner page.
   Two putty cards (bullish / bearish) reading the latest nightly scan from
   public.divergence_scan via useDivergenceScan. Sortable columns, an
   RSI-extremes-only filter, watchlist stars, instant Tip tooltips, and the
   section's own freshness chip (element equity-rsi_divergences-daily).

   Copy is factual/academic: a regular divergence is a screen, not a signal.
   The RSI method is labeled (simple-average / Cutler) per the build spec. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useDivergenceScan from '../../hooks/useDivergenceScan';
import FreshnessChip from './FreshnessChip';
import Tip from './Tip';

const fmtRsi = (v) => (v == null ? '—' : String(Math.round(v)));
const fmtPx = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  return n >= 1000 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                   : `$${n.toFixed(2)}`;
};
const fmtAge = (b) => (b == null ? '—' : b === 0 ? 'today' : b === 1 ? '1 bar' : `${b} bars`);

function fmtDay(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MO[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

const EXPLAIN = (
  <div style={{ maxWidth: 300 }}>
    <b>Regular divergence.</b> Price and RSI(14) are compared at the two most
    recent confirmed pivots (a pivot needs 5 bars on each side). Bullish:
    price sets a lower low while RSI sets a higher low. Bearish: price sets a
    higher high while RSI sets a lower high. The newer pivot must be within
    the last 15 bars, with the pivots 5–30 bars apart. A divergence flags a
    possible reversal; it does not time one.
  </div>
);

const COLS = [
  { key: 'ticker', label: 'Ticker', numeric: false },
  { key: 'rsiPath', label: 'RSI at pivots', numeric: true, sortKey: 'rsiGap',
    tip: 'RSI(14) at the older → newer pivot. Sorts by the size of the RSI move between pivots.' },
  { key: 'pxPath', label: 'Price at pivots', numeric: true, sortKey: null },
  { key: 'now', label: 'Now · RSI', numeric: true, sortKey: 'curRsi',
    tip: 'Latest close and its RSI(14).' },
  { key: 'age', label: 'Age', numeric: true, sortKey: 'barsAgo',
    tip: 'Trading days since the newer pivot printed. Newest setups first.' },
];

function DvTable({ rows, dir, watchlist, onPick }) {
  const [sort, setSort] = useState({ key: 'barsAgo', asc: true });

  const sorted = useMemo(() => {
    const s = [...rows];
    s.sort((a, b) => {
      const va = a[sort.key]; const vb = b[sort.key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va === vb) return (b.rsiGap ?? 0) - (a.rsiGap ?? 0);
      return sort.asc ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1);
    });
    return s;
  }, [rows, sort]);

  const clickSort = (sortKey) => {
    if (!sortKey) return;
    setSort((p) => (p.key === sortKey ? { key: sortKey, asc: !p.asc } : { key: sortKey, asc: sortKey === 'barsAgo' }));
  };

  if (!rows.length) {
    return <div className="dv-empty">No fresh {dir === 'bull' ? 'bullish' : 'bearish'} divergences in the latest scan.</div>;
  }

  return (
    <div className="dv-scroll">
      <table className="dv-table">
        <thead>
          <tr>
            {COLS.map((c) => {
              const sortKey = c.key === 'ticker' ? 'ticker' : c.sortKey;
              const active = sortKey && sort.key === sortKey;
              /* Tip must live INSIDE the th — a wrapper between tr and th
                 breaks table structure and the browser reparents the row. */
              const label = c.tip
                ? <Tip content={c.tip} bare><span>{c.label}</span></Tip>
                : c.label;
              return (
                <th
                  key={c.key}
                  className={`${c.numeric ? 'num-h' : ''} ${sortKey ? 'sortable' : ''} ${active ? 'on' : ''}`}
                  aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : undefined}
                  onClick={() => clickSort(sortKey)}
                >
                  {label}{active ? (sort.asc ? ' \u2191' : ' \u2193') : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.ticker}>
              <td>
                <button type="button" className="dv-tk" onClick={() => onPick(r.ticker)}>
                  {watchlist.has(r.ticker) && (
                    <Tip content="On your watchlist" bare><span className="dv-star" aria-label="On your watchlist">★</span></Tip>
                  )}
                  <b>{r.ticker}</b>
                  {r.name ? <span className="dv-name">{r.name}</span> : null}
                </button>
              </td>
              <td className="num">
                <span className={`dv-path ${dir}`}>{fmtRsi(r.rsi1)} → {fmtRsi(r.rsi2)}</span>
                {r.strong && (
                  <Tip content={`Older pivot printed from an RSI extreme (${dir === 'bull' ? '30 or below' : '70 or above'}).`} bare>
                    <span className={`dv-extreme ${dir}`} aria-label="RSI extreme">●</span>
                  </Tip>
                )}
              </td>
              <td className="num">{fmtPx(r.px1)} → {fmtPx(r.px2)}</td>
              <td className="num">{fmtPx(r.curClose)} · {fmtRsi(r.curRsi)}</td>
              <td className="num">{fmtAge(r.barsAgo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DivergencePanel() {
  const navigate = useNavigate();
  const { bull, bear, scanDate, watchlist, loading, error } = useDivergenceScan();
  const [extremesOnly, setExtremesOnly] = useState(false);

  const bullShown = useMemo(() => (extremesOnly ? bull.filter((r) => r.strong) : bull), [bull, extremesOnly]);
  const bearShown = useMemo(() => (extremesOnly ? bear.filter((r) => r.strong) : bear), [bear, extremesOnly]);
  const onPick = (tk) => navigate(`/ticker/${tk}`);

  return (
    <section className="wrap sc-divsec">
      <div className="dv-headrow">
        <div>
          <div className="eyebrow2"><span className="dot" />RSI Divergences</div>
          <h2 className="dv-title">
            Price and RSI disagreeing at the pivots
            <Tip content={EXPLAIN} bare><span className="dv-info" aria-label="What is a regular divergence?">ⓘ</span></Tip>
          </h2>
          <div className="dv-sub">
            {scanDate ? <>Daily scan of liquid US common stocks · close of {fmtDay(scanDate)} · </> : null}
            RSI(14), simple-average method
            <FreshnessChip
              elementId="equity-rsi_divergences-daily"
              variant="dot"
              fallback={{ asOfIso: scanDate, calendar: 'nyse-trading-day' }}
            />
          </div>
        </div>
        <label className="dv-filter">
          <input type="checkbox" checked={extremesOnly} onChange={(e) => setExtremesOnly(e.target.checked)} />
          RSI-extreme pivots only
        </label>
      </div>

      {loading ? (
        <div className="dv-loading">Loading divergence scan…</div>
      ) : error ? (
        <div className="dv-loading">Divergence scan unavailable — {String(error.message || 'data error')}.</div>
      ) : (
        <div className="dv-grid">
          <div className="dv-card">
            <div className="dv-cardhead">
              <h3>Bullish <span className="dv-def">price lower low · RSI higher low</span></h3>
              <span className="dv-count num">{bullShown.length}</span>
            </div>
            <DvTable rows={bullShown} dir="bull" watchlist={watchlist} onPick={onPick} />
          </div>
          <div className="dv-card">
            <div className="dv-cardhead">
              <h3>Bearish <span className="dv-def">price higher high · RSI lower high</span></h3>
              <span className="dv-count num">{bearShown.length}</span>
            </div>
            <DvTable rows={bearShown} dir="bear" watchlist={watchlist} onPick={onPick} />
          </div>
        </div>
      )}

      <div className="dv-caveat">
        A screen, not a signal — a regular divergence flags a possible reversal and says nothing
        about timing. Names with split-like price jumps or close-versus-VWAP disagreements are
        filtered out before display.
      </div>
    </section>
  );
}
