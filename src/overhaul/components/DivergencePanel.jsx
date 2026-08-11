/* DivergencePanel — the RSI Divergence Scanner on the Trading
   Scanner page.

   Scanner-page consistency rebuild (2026-07-16, Joe): same tile anatomy as
   the other two scanners — .sc-tablecard shell, .sc-kicker / .sc-paneltitle
   / .sc-rule header, .sc-scanmeta chip line (chip first, same spot). The
   bullish / bearish tables sit on the shared .sc-inset surface and use the
   shared .sc-table styling (row hover, 16px gold tickers, green/red paths).

   RSI-EXTREMES ONLY (Joe 2026-07-16): the panel now shows only divergences
   whose older pivot printed from an RSI extreme (≤30 bullish / ≥70
   bearish) — the strongest setups. The filter checkbox is gone; the
   per-row extreme dot is gone (every shown row qualifies by definition).

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
// Age in trading days — "2d" language (Joe, cockpit build 2026-07-30; the
// column tooltip spells out "trading days since the newer pivot printed").
const fmtAge = (b) => (b == null ? '—' : b === 0 ? 'today' : `${b}d`);

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
    return <div className="dv-empty">No fresh {dir === 'bull' ? 'bullish' : 'bearish'} divergences from an RSI extreme in the latest scan.</div>;
  }

  return (
    <div className="sc-insetscroll">
      <table className="sc-table dv-min">
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
                  {label}{active ? (sort.asc ? ' ↑' : ' ↓') : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.ticker} className="sc-trow" onClick={() => onPick(r.ticker)}>
              <td>
                <button type="button" className="sc-tk" onClick={(e) => { e.stopPropagation(); onPick(r.ticker); }}>
                  {watchlist.has(r.ticker) && (
                    <Tip content="On your watchlist" bare><span className="dv-star" aria-label="On your watchlist">★</span></Tip>
                  )}
                  <b>{r.ticker}</b>
                  {r.name ? <span className="nm">{r.name}</span> : null}
                </button>
              </td>
              <td className="num">
                <span className={`dv-path ${dir}`}>{fmtRsi(r.rsi1)} → {fmtRsi(r.rsi2)}</span>
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

  // Extremes only (Joe 2026-07-16): the older pivot must have printed from
  // an RSI extreme — 30 or below for bullish, 70 or above for bearish.
  const bullShown = useMemo(() => bull.filter((r) => r.strong), [bull]);
  const bearShown = useMemo(() => bear.filter((r) => r.strong), [bear]);
  const onPick = (tk) => navigate(`/ticker/${tk}`);

  return (
    <section className="wrap sc-divsec">
      <div className="sc-tablecard">
        <div className="sc-panelhead">
          <div>
            <div className="sc-kicker">Scanner · Daily scan · Display only</div>
            <h2 className="sc-paneltitle">
              RSI Divergence Scanner
              <Tip content={EXPLAIN} bare><span className="dv-info" aria-label="What is a regular divergence?">ⓘ</span></Tip>
            </h2>
            <div className="sc-rule">
              Daily screen of liquid US common stocks where price and RSI(14) disagree at their two
              most recent pivots — bullish when price sets a lower low but RSI a higher low, bearish
              when price sets a higher high but RSI a lower high. A screen, not a signal: a divergence
              flags a possible reversal, says nothing about timing, and drives no trades.
            </div>
            <div className="sc-rule">
              Only extremes are shown: the older pivot must have printed from an RSI extreme — 30 or
              below for bullish setups, 70 or above for bearish.
            </div>
            <div className="sc-scanmeta">
              <FreshnessChip
                elementId="equity-rsi_divergences-daily"
                variant="dot"
                fallback={{ asOfIso: scanDate, calendar: 'nyse-trading-day' }}
              />
              <span>
                {scanDate ? <>Latest scan · {fmtDay(scanDate)} close · </> : null}
                refreshes 8:45 AM ET · RSI(14), simple-average method
              </span>
              <button type="button" className="sc-metalink" onClick={() => navigate('/methodology#scanner')}>
                Methodology →
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="sc-loading">Loading divergence scan…</div>
        ) : error ? (
          <div className="sc-loading">Divergence scan unavailable — {String(error.message || 'data error')}.</div>
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

        <div className="sc-tilefoot">
          Names with split-like price jumps or close-versus-VWAP disagreements are filtered out
          before display.
        </div>
      </div>
    </section>
  );
}
