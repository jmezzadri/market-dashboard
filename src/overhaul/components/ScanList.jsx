/* ScanList — shared row component used by Scanner and Portfolio Positions.
   Ported from prototype/lm-shared.jsx ScanList + lm-scancard structure.
   Drill renders below via the ScanDrill component the caller passes in.

   Score is on a 0-10 scale (live scanner data).

   2026-06-01: every value here is now REAL — sparkline uses the engine's
   stored `spark` close series (no more synthetic random walk), price/change
   come straight off the scan row.

   When `indicatorColumns` is set (Scanner page only), each row adds numeric
   columns for the real per-indicator points that SUM to the score: Insider,
   Technicals (200-day + RSI), Options, Dark-pool.

   2026-06-04: the Scanner column picker is now LIVE. The caller passes an
   ordered `columns` array of column keys (a subset/reordering of
   INDICATOR_COL_KEYS). The header, grid template, and each row's cells are
   built dynamically from that list. Ticker + Score always render. Portfolio
   Positions leaves both props off and keeps the compact I/D/O facet dots. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ScoreDial from './ScoreDial';
import Sparkline from './Sparkline';
import Tip from './Tip';

const techPts = (r) => (Number(r.sma200_pts) || 0) + (Number(r.rsi_pts) || 0);

const GRID_FACETS = '1fr 56px 90px 110px 130px 24px';


// Column registry for the indicator (Scanner) view. `w` is the grid track
// width. `head` is the short column header label. Ticker + Score are locked
// on by the picker, so they always appear; the rest are toggleable.
export const INDICATOR_COLS = {
  ticker:  { key: 'ticker',  label: 'Ticker',                head: 'Ticker',   w: '78px', locked: true },
  name:    { key: 'name',    label: 'Company name',          head: 'Name',     w: '150px' },
  price:   { key: 'price',   label: 'Last price',            head: 'Last',     w: '74px' },
  day:     { key: 'day',     label: 'Day change',            head: 'Day',      w: '66px' },
  chg30:   { key: 'chg30',   label: '30-day change',         head: '30-Day',   w: '88px' },
  from52hi:{ key: 'from52hi',label: '% from 52-week high',   head: '% 52w hi', w: '70px' },
  rsi:     { key: 'rsi',     label: 'RSI (14-day)',          head: 'RSI',      w: '46px' },
  vs200:   { key: 'vs200',   label: '% vs 200-day line',     head: '% 200d',   w: '62px' },
  rvol:    { key: 'rvol',    label: 'Relative volume',       head: 'Rel vol',  w: '58px' },
  mktcap:  { key: 'mktcap',  label: 'Market cap',            head: 'Mkt cap',  w: '66px' },
  ivrank:  { key: 'ivrank',  label: 'IV rank',               head: 'IV rank',  w: '56px' },
  earn:    { key: 'earn',    label: 'Next earnings date',    head: 'Earnings', w: '74px' },
  insider: { key: 'insider', label: 'Insider pts',           head: 'Insider',  w: '54px' },
  tech:    { key: 'tech',    label: 'Technicals pts',        head: 'Tech',     w: '46px' },
  options: { key: 'options', label: 'Options pts',           head: 'Options',  w: '54px' },
  dark:    { key: 'dark',    label: 'Dark-pool pts',         head: 'Dark',     w: '46px' },
  short:   { key: 'short',   label: 'Short interest %',      head: 'Short %',  w: '58px' },
  flow:    { key: 'flow',    label: 'Options flow net $',    head: 'Flow $',   w: '62px' },
  score:   { key: 'score',   label: 'Score',                 head: 'Score',    w: '54px', locked: true },
};

// Full available-column universe + initial order grouped per Joe's layout
// (2026-06-17 PM): Stock → Performance → Technicals → Signal scores → Other →
// Score. All values ride the same nightly scan row, so they share the scan's
// freshness stamp.
export const INDICATOR_COL_KEYS = [
  'ticker', 'name', 'price',                       // Stock
  'day', 'chg30', 'from52hi',                      // Performance
  'rsi', 'vs200', 'rvol', 'ivrank',                // Technicals
  'insider', 'tech', 'options', 'dark', 'flow',    // Signal scores
  'mktcap', 'short', 'earn',                       // Other
  'score',                                         // MacroTilt Score
];

// All columns show by default; the gear chooser only hides what you opt out of.
export const DEFAULT_VISIBLE_KEYS = [...INDICATOR_COL_KEYS];

// Column → group, and the group display label. Drives the grouped header tier.
export const COL_GROUP = {
  ticker: 'stock', name: 'stock', price: 'stock',
  day: 'performance', chg30: 'performance', from52hi: 'performance',
  rsi: 'technicals', vs200: 'technicals', rvol: 'technicals', ivrank: 'technicals',
  insider: 'signals', tech: 'signals', options: 'signals', dark: 'signals', flow: 'signals',
  mktcap: 'other', short: 'other', earn: 'other',
  score: 'score',
};
export const GROUP_LABEL = {
  stock: 'Stock',
  performance: 'Performance',
  technicals: 'Technicals',
  signals: 'MacroTilt signal scores',
  other: 'Other',
  score: '',
};

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// Sort value accessor per column. Returns a number, a string, or null
// (nulls always sort last). techPts is summed for the Technicals column.
const SORT_ACCESSORS = {
  ticker:   (r) => r.ticker || '',
  name:     (r) => r.name || '',
  price:    (r) => num(r.price),
  day:      (r) => num(r.chg),
  chg30:    (r) => num(r.chg30),
  from52hi: (r) => (r.price != null && r.week52High) ? (Number(r.price) - Number(r.week52High)) / Number(r.week52High) : null,
  rsi:      (r) => num(r.rsi),
  vs200:    (r) => num(r.sma200_pct),
  rvol:     (r) => num(r.relVolume),
  mktcap:   (r) => num(r.marketCap),
  ivrank:   (r) => num(r.iv_rank),
  earn:     (r) => r.earningsDate || null,
  insider:  (r) => num(r.insider_pts),
  tech:     (r) => techPts(r),
  options:  (r) => num(r.options_pts),
  dark:     (r) => num(r.dark_pool_pts),
  short:    (r) => num(r.si_float_pct),
  flow:     (r) => num(r.flow_net_call_prem_usd),
  score:    (r) => num(r.score),
};

// Text columns sort A→Z first; numbers/dates sort high→low (or soonest) first.
const ASC_FIRST = new Set(['ticker', 'name', 'earn']);

/* Signed compact dollars for the options-flow column: $1.2M / -$340k / $980. */
function flowMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

/* Compact market cap: $6.4B / $940M / $42M. */
function capMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

/* Earnings date as a short 'Jul 28' label; '—' when none is scheduled. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function earningsLabel(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/* 30-day change cell: signed percent over a center-zero magnitude bar, so a
   +28% and a +3% read differently at a glance (Joe 2026-06-11 — the spark
   made magnitude unreadable). Bar saturates at ±30%. */
function Chg30Cell({ value }) {
  const v = Number(value);
  if (!Number.isFinite(v)) {
    return <div className="num" style={{ textAlign: 'center', fontSize: 13, color: 'var(--mt-ink-3)' }}>—</div>;
  }
  const color = v >= 0 ? 'var(--mt-up)' : 'var(--mt-down)';
  const half = Math.min(Math.abs(v) / 30, 1) * 50;   // % of track, from center
  return (
    <div style={{ width: 62, textAlign: 'center' }}>
      <div className="num" style={{ fontSize: 13, fontWeight: 600, color }}>
        {v > 0 ? '+' : ''}{v.toFixed(1)}%
      </div>
      <div style={{ position: 'relative', height: 3, marginTop: 3, background: 'var(--mt-line-0)', borderRadius: 2 }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            height: 3,
            borderRadius: 2,
            background: color,
            left: v >= 0 ? '50%' : `${50 - half}%`,
            width: `${half}%`,
          }}
        />
      </div>
    </div>
  );
}

export default function ScanList({
  rows,
  drillOpenKey,
  setDrillOpenKey,
  renderDrill,    // (row) => JSX for the drill body
  rowKey = (r) => r.ticker,
  showSparkline = true,
  indicatorColumns = false,
  columns,        // optional ordered array of indicator column keys
  onReorderColumn, // (fromKey, toKey) => void — drag a header to move a column
}) {
  const navigate = useNavigate();
  const [dragCol, setDragCol] = useState(null);

  // Resolve the active, ordered list of indicator columns. Ticker + Score
  // are always present (locked). If no `columns` prop is passed we fall back
  // to the full default set so older callers keep working.
  const activeKeys = indicatorColumns
    ? (() => {
        const requested = (columns && columns.length ? columns : INDICATOR_COL_KEYS)
          .filter((k) => INDICATOR_COLS[k]);
        // Ticker leads, Score is pinned on the far right (Joe 2026-06-11).
        const withLocks = ['ticker', ...requested.filter((k) => k !== 'ticker' && k !== 'score'), 'score'];
        return Array.from(new Set(withLocks));
      })()
    : null;

  const grid = indicatorColumns
    ? `${activeKeys.map((k) => INDICATOR_COLS[k].w).join(' ')} 22px`
    : GRID_FACETS;

  // Group the active columns into contiguous runs for the grouped header tier
  // (Stock / Performance / Technicals / Signal scores / Other / Score).
  const groupRuns = indicatorColumns ? (() => {
    const runs = [];
    activeKeys.forEach((k) => {
      const g = COL_GROUP[k] || '';
      const last = runs[runs.length - 1];
      if (last && last.group === g) last.span += 1;
      else runs.push({ group: g, span: 1 });
    });
    return runs;
  })() : [];

  // Click-to-sort (Scanner / indicator mode only). Default: keep the order the
  // caller passed in — the scan arrives already ranked by score, high first.
  const [sort, setSort] = useState({ key: null, dir: 'desc' });

  function onSort(k) {
    setSort((s) => (s.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: ASC_FIRST.has(k) ? 'asc' : 'desc' }));
  }

  const sortedRows = useMemo(() => {
    if (!indicatorColumns || !sort.key) return rows;
    const acc = SORT_ACCESSORS[sort.key];
    if (!acc) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // nulls always sort last
      if (vb == null) return -1;
      const cmp = (typeof va === 'string' || typeof vb === 'string')
        ? String(va).localeCompare(String(vb))
        : va - vb;
      return cmp * dir;
    });
  }, [rows, sort, indicatorColumns]);

  if (!rows?.length) {
    return (
      <div
        style={{
          padding: 36,
          textAlign: 'center',
          color: 'var(--mt-ink-2)',
          background: 'var(--mt-surface)',
          border: '1px solid var(--mt-line-0)',
          borderRadius: 14,
        }}
      >
        No rows.
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--mt-surface)',
        border: '1px solid var(--mt-line-0)',
        borderRadius: 14,
        overflowX: 'auto',
        overflowY: 'visible',
      }}
    >
    {indicatorColumns && (
      <style>{`
.sc-row{transition:background .15s ease, box-shadow .15s ease;}
.sc-row:hover{background:var(--mt-surface-2);box-shadow:inset 3px 0 0 var(--mt-accent);}
.sc-row.sc-row--open{background:var(--mt-surface-2);}
.sc-row:hover .sc-tkr{text-decoration:underline;text-underline-offset:3px;}
.sc-scanhead [role="button"]{transition:color .12s ease;}
.sc-scanhead [role="button"]:hover{color:var(--mt-ink-0);}
`}</style>
    )}
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        minWidth: indicatorColumns ? 'max-content' : undefined,
      }}
    >
      {indicatorColumns && (
        <li
          style={{
            display: 'grid',
            gridTemplateColumns: grid,
            gap: 14,
            padding: '9px 18px 7px',
            background: 'color-mix(in oklab, var(--mt-accent) 7%, var(--mt-surface-2))',
            borderBottom: '1px solid var(--mt-line-0)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: 'var(--mt-ink-2)',
          }}
        >
          {groupRuns.map((run, i) => (
            <div
              key={i}
              style={{
                gridColumn: `span ${run.span}`,
                textAlign: 'center',
                borderLeft: i > 0 ? '1px solid var(--mt-line-0)' : 'none',
              }}
            >
              {GROUP_LABEL[run.group] || ''}
            </div>
          ))}
          <span />
        </li>
      )}
      {indicatorColumns && (
        <li
          className="sc-scanhead"
          style={{
            display: 'grid',
            gridTemplateColumns: grid,
            gap: 14,
            padding: '10px 18px',
            borderBottom: '1px solid var(--mt-line-0)',
            background: 'var(--mt-surface-2)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--mt-ink-3)',
          }}
        >
          {activeKeys.map((k) => {
            const col = INDICATOR_COLS[k];
            const tips = {
              price: 'Last traded price from the latest scan',
              day: 'Change on the day, in percent',
              chg30: 'Change over the last ~30 calendar days',
              from52hi: 'How far the last price sits below its 52-week high',
              rsi: '14-day Wilder RSI — above 70 overbought, below 30 oversold',
              vs200: 'Percent the price sits above or below its 200-day average',
              rvol: "Today's volume vs its 30-day average — above 1 is heavier than usual",
              mktcap: 'Market value — shares outstanding times price',
              ivrank: 'Where 30-day implied volatility sits in its own 1-year range, 0–100',
              earn: 'Next scheduled earnings date',
              insider: 'Insider Form-4 points (rules A/B/C, decayed by age)',
              tech: 'Technicals points: above 200-day line + RSI penalty',
              options: 'Options-volume-shock points',
              dark: 'Dark-pool anchor points',
              short: 'FINRA short interest as % of shares outstanding — context only, not scored',
              flow: 'Net call premium in the 30-day options flow-alert window — context only, not scored',
              score: 'MacroTilt Score, 0–10 — the four signal points summed',
            };
            // identity heads sit left; Last/Day right over their number cells;
            // everything else is centered over centered values.
            const align = (k === 'ticker' || k === 'name') ? 'left'
              : (k === 'price' || k === 'day') ? 'right' : 'center';
            // ticker stays pinned left, score pinned right — everything else
            // can be dragged by its header to a new spot (Joe 2026-06-17).
            const canDrag = !!onReorderColumn && k !== 'ticker' && k !== 'score';
            return (
              <SortHead
                key={k}
                onClick={() => onSort(k)}
                align={align}
                active={sort.key === k}
                dir={sort.dir}
                tip={tips[k]}
                draggable={canDrag}
                dragging={dragCol === k}
                onDragStart={canDrag ? (e) => {
                  setDragCol(k);
                  if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', k); } catch { /* ignore */ }
                  }
                } : undefined}
                onDragOver={canDrag ? (e) => e.preventDefault() : undefined}
                onDrop={canDrag ? (e) => {
                  e.preventDefault();
                  let fromKey = dragCol;
                  try {
                    const dtKey = e.dataTransfer && e.dataTransfer.getData('text/plain');
                    if (dtKey) fromKey = dtKey;
                  } catch { /* ignore */ }
                  if (fromKey) onReorderColumn(fromKey, k);
                  setDragCol(null);
                } : undefined}
                onDragEnd={() => setDragCol(null)}
              >
                {col.head}
              </SortHead>
            );
          })}
          <span />
        </li>
      )}

      {sortedRows.map((r) => {
        const key = rowKey(r);
        const isOpen = drillOpenKey === key;
        const chg = Number(r.chg) || 0;
        const chgColor = chg >= 0 ? 'var(--mt-up)' : 'var(--mt-down)';
        const price = r.price;
        const sparkData = r.sparkData;     // real close series, or null

        const insiderOn = (r.insider_pts ?? 0) > 0;
        const darkOn = (r.dark_pool_pts ?? 0) > 0 || r.dark_pool_anchor != null;
        const optionsOn = (r.options_pts ?? 0) > 0;
        const tp = techPts(r);

        const insiderTip = insiderOn
          ? `Insider points ${r.insider_pts}${r.insider_rules?.length ? ` · rule${r.insider_rules.length > 1 ? 's' : ''} ${r.insider_rules.join(', ')}` : ''}${r.insider_age_days != null ? ` · ${r.insider_age_days}d old` : ''}`
          : 'Insider layer scored 0 for this name';
        const techTip = r.sma200_pct != null
          ? `${r.sma200_pct >= 0 ? 'Above' : 'Below'} 200-day by ${Math.abs(r.sma200_pct).toFixed(1)}%${r.rsi != null ? ` · RSI ${r.rsi.toFixed(0)}` : ''}`
          : 'No technicals reading';
        const darkTip = darkOn
          ? `Dark-pool points ${r.dark_pool_pts ?? 0}${r.dark_pool_anchor != null ? ` · anchor $${Number(r.dark_pool_anchor).toFixed(2)}` : ''}`
          : 'No dark-pool points scored';
        const optionsTip = optionsOn
          ? `Options points ${r.options_pts}${r.options_vol_shock != null ? ` · vol shock ${Number(r.options_vol_shock).toFixed(2)}×` : ''}`
          : 'Options layer scored 0 for this name';

        const cellFor = (k) => {
          switch (k) {
            case 'ticker':
              return (
                <div key={k} style={{ minWidth: 0 }}>
                  <span
                    className="sc-tkr"
                    onClick={(e) => { e.stopPropagation(); navigate(`/ticker/${r.ticker}`); }}
                    style={{ fontWeight: 700, fontSize: 16, color: 'var(--mt-accent)', cursor: 'pointer' }}
                  >
                    {r.ticker}
                  </span>
                  {!indicatorColumns && (
                    <span style={{ fontSize: 12, color: 'var(--mt-ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 8 }}>
                      {r.name ? `${r.name} · ` : ''}{r.sector || ''}
                    </span>
                  )}
                </div>
              );
            case 'name':
              return (
                <div key={k} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--mt-ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name || '—'}
                  </div>
                  {r.sector ? (
                    <div style={{ fontSize: 10.5, color: 'var(--mt-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.sector}
                    </div>
                  ) : null}
                </div>
              );
            case 'score':
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'center' }}>
                  <ScoreDial score={r.score} max={10} size={42} />
                </div>
              );
            case 'price':
              return price != null ? (
                <div key={k} style={{ textAlign: indicatorColumns ? 'right' : 'left' }}>
                  <div className="num" style={{ fontSize: 14, color: 'var(--mt-ink-0)', fontWeight: 600 }}>
                    ${Number(price).toFixed(2)}
                  </div>
                  {!indicatorColumns && (
                    <div className="num" style={{ fontSize: 11, color: chgColor, fontWeight: 500 }}>
                      {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                    </div>
                  )}
                </div>
              ) : <div key={k} />;
            case 'day':
              return (
                <div key={k} className="num" style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: chgColor }}>
                  <Tip content={r.chgUsd != null ? `${chg > 0 ? '+' : ''}${chg.toFixed(2)}% · ${r.chgUsd >= 0 ? '+' : '-'}$${Math.abs(Number(r.chgUsd)).toFixed(2)} on the day` : 'Day change'} bare>
                    {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                  </Tip>
                </div>
              );
            case 'chg30':
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'center' }}>
                  <Tip content={r.chg30 != null ? `${r.chg30 > 0 ? '+' : ''}${Number(r.chg30).toFixed(1)}% vs the close 21 trading days (~30 calendar days) earlier` : 'No 30-day reading yet — populates on the next nightly scan'} bare>
                    <Chg30Cell value={r.chg30} />
                  </Tip>
                </div>
              );
            case 'spark':
              return showSparkline && sparkData?.length ? (
                <div key={k} style={{ color: chgColor }}>
                  <Sparkline data={sparkData} width={80} height={32} stroke={chgColor} area />
                </div>
              ) : <div key={k} />;
            case 'from52hi': {
              const hi = num(r.week52High);
              const p = num(price);
              const v = (hi && p != null) ? (100 * (p - hi)) / hi : null;
              const c = v == null ? 'var(--mt-ink-3)' : v >= 0 ? 'var(--mt-up)' : 'var(--mt-down)';
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={v != null ? `${v >= 0 ? 'At its' : `${Math.abs(v).toFixed(1)}% below its`} 52-week high of $${hi.toFixed(2)}` : 'No 52-week high stored for this name'} bare>
                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: c }}>
                      {v != null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '—'}
                    </span>
                  </Tip>
                </div>
              );
            }
            case 'rsi': {
              const v = num(r.rsi);
              const c = v == null ? 'var(--mt-ink-3)' : v >= 70 ? 'var(--mt-down)' : v <= 30 ? 'var(--mt-up)' : 'var(--mt-ink-0)';
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={v != null ? `14-day RSI ${v.toFixed(0)} — ${v >= 70 ? 'overbought' : v <= 30 ? 'oversold' : 'neutral'}` : 'No RSI reading for this name'} bare>
                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: c }}>
                      {v != null ? v.toFixed(0) : '—'}
                    </span>
                  </Tip>
                </div>
              );
            }
            case 'vs200': {
              const v = num(r.sma200_pct);
              const c = v == null ? 'var(--mt-ink-3)' : v >= 0 ? 'var(--mt-up)' : 'var(--mt-down)';
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={v != null ? `${v >= 0 ? 'Above' : 'Below'} the 200-day average by ${Math.abs(v).toFixed(1)}%` : 'No 200-day reading for this name'} bare>
                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: c }}>
                      {v != null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '—'}
                    </span>
                  </Tip>
                </div>
              );
            }
            case 'rvol': {
              const v = num(r.relVolume);
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={v != null ? `Today's volume is ${v.toFixed(2)}× its 30-day average` : 'No volume reading for this name'} bare>
                    <span className="num" style={{ fontSize: 13, fontWeight: v != null && v >= 1.5 ? 700 : 600, color: v == null ? 'var(--mt-ink-3)' : v >= 1.5 ? 'var(--mt-ink-0)' : 'var(--mt-ink-2)' }}>
                      {v != null ? `${v.toFixed(2)}×` : '—'}
                    </span>
                  </Tip>
                </div>
              );
            }
            case 'mktcap': {
              const v = num(r.marketCap);
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={v != null ? `Market value about ${capMoney(v)}` : 'No market-cap reading for this name'} bare>
                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: v != null ? 'var(--mt-ink-0)' : 'var(--mt-ink-3)' }}>
                      {capMoney(v)}
                    </span>
                  </Tip>
                </div>
              );
            }
            case 'ivrank': {
              const v = num(r.iv_rank);
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={v != null ? `Implied-volatility rank ${Math.round(v)} of 100 over its own past year` : 'No options data for this name'} bare>
                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: v != null ? 'var(--mt-ink-0)' : 'var(--mt-ink-3)' }}>
                      {v != null ? Math.round(v) : '—'}
                    </span>
                  </Tip>
                </div>
              );
            }
            case 'earn': {
              const lbl = earningsLabel(r.earningsDate);
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={r.earningsDate ? `Next scheduled earnings ${r.earningsDate}` : 'No upcoming earnings date stored for this name'} bare>
                    <span className="num" style={{ fontSize: 12.5, fontWeight: 600, color: r.earningsDate ? 'var(--mt-ink-1)' : 'var(--mt-ink-3)' }}>
                      {lbl}
                    </span>
                  </Tip>
                </div>
              );
            }
            case 'insider':
              return <PtsCell key={k} value={r.insider_pts} on={insiderOn} tip={insiderTip} />;
            case 'tech':
              return <PtsCell key={k} value={tp} on={tp > 0} tip={techTip} />;
            case 'options':
              return <PtsCell key={k} value={r.options_pts} on={optionsOn} tip={optionsTip} />;
            case 'dark':
              return <PtsCell key={k} value={r.dark_pool_pts} on={darkOn} tip={darkTip} />;
            case 'short': {
              const v = r.si_float_pct;
              const tip = v != null
                ? `Short interest ${Number(v).toFixed(1)}% of shares outstanding`
                  + (r.si_days_to_cover != null ? ` · ${Number(r.si_days_to_cover).toFixed(1)} days to cover` : '')
                  + (r.si_cost_to_borrow_pct != null ? ` · ${Number(r.si_cost_to_borrow_pct).toFixed(1)}% to borrow` : '')
                  + (r.si_as_of ? ` · as of ${r.si_as_of}` : '')
                : 'No short-interest reading stored for this name';
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={tip} bare>
                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: v != null ? 'var(--mt-ink-0)' : 'var(--mt-ink-3)' }}>
                      {v != null ? `${Number(v).toFixed(1)}%` : '—'}
                    </span>
                  </Tip>
                </div>
              );
            }
            case 'flow': {
              const v = r.flow_net_call_prem_usd;
              const tip = v != null
                ? `Net call premium ${flowMoney(v)} over the 30-day flow-alert window`
                  + (r.flow_ask_side_share != null ? ` · ${Math.round(r.flow_ask_side_share * 100)}% printed at the ask` : '')
                  + (r.flow_sweep_count != null ? ` · ${r.flow_sweep_count} sweeps` : '')
                  + (r.flow_as_of ? ` · as of ${r.flow_as_of}` : '')
                : 'No options flow alerts stored for this name';
              return (
                <div key={k} style={{ textAlign: 'center' }}>
                  <Tip content={tip} bare>
                    <span className="num" style={{ fontSize: 13, fontWeight: 600, color: v == null ? 'var(--mt-ink-3)' : v >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>
                      {v != null ? flowMoney(v) : '—'}
                    </span>
                  </Tip>
                </div>
              );
            }
            default:
              return <div key={k} />;
          }
        };

        return (
          <li key={key} style={{ borderBottom: '1px solid var(--mt-line-0)' }}>
            <div
              role="button"
              tabIndex={0}
              className={indicatorColumns ? `sc-row${isOpen ? ' sc-row--open' : ''}` : undefined}
              onClick={() => setDrillOpenKey(isOpen ? null : key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDrillOpenKey(isOpen ? null : key);
                }
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: grid,
                gap: 14,
                padding: '14px 18px',
                ...(indicatorColumns ? {} : { background: isOpen ? 'var(--mt-surface-2)' : 'transparent' }),
                cursor: 'pointer',
                alignItems: 'center',
              }}
            >
              {indicatorColumns ? (
                activeKeys.map((k) => cellFor(k))
              ) : (
                <>
                  {cellFor('ticker')}
                  {cellFor('score')}
                  {cellFor('price')}
                  {cellFor('spark')}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    <Tip content={insiderTip}>
                      <Facet label="I" active={insiderOn} color="var(--mt-up)" />
                    </Tip>
                    <Tip content={darkTip}>
                      <Facet label="D" active={darkOn} color="var(--mt-accent)" />
                    </Tip>
                    <Tip content={optionsTip}>
                      <Facet label="O" active={optionsOn} color="var(--mt-warn)" />
                    </Tip>
                  </div>
                </>
              )}

              {/* Chevron */}
              <span
                style={{
                  fontSize: 14,
                  color: 'var(--mt-ink-3)',
                  textAlign: 'right',
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                  transition: 'transform var(--mt-dur-fast) var(--mt-ease)',
                }}
              >
                ›
              </span>
            </div>
            {isOpen && renderDrill?.(r)}
          </li>
        );
      })}
    </ul>
    </div>
  );
}

function SortHead({
  children, tip, align, active, dir, onClick,
  draggable, dragging, onDragStart, onDragOver, onDrop, onDragEnd,
}) {
  // Clickable + draggable header — click to sort (click again to flip the
  // direction), or drag the header onto another to move the column there
  // (Joe 2026-06-17). The arrow shows on the active column only.
  const arrow = active ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  const inner = tip ? <Tip content={tip}>{children}</Tip> : children;
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Sort by ${children}${draggable ? ', or drag to move this column' : ''}`}
      draggable={draggable || undefined}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={draggable ? 'Click to sort · drag to move' : 'Click to sort'}
      style={{
        textAlign: align || 'center',
        cursor: draggable ? 'grab' : 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        color: active ? 'var(--mt-ink-1)' : undefined,
        opacity: dragging ? 0.4 : 1,
      }}
    >
      {inner}{arrow}
    </span>
  );
}

function PtsCell({ value, on, tip }) {
  const v = Number(value);
  const show = Number.isFinite(v) ? v.toFixed(v % 1 === 0 ? 0 : 2) : '—';
  return (
    <div className="num" style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: on ? 'var(--mt-ink-0)' : 'var(--mt-ink-3)' }}>
      <Tip content={tip} bare>
        {on ? `+${show}` : show}
      </Tip>
    </div>
  );
}

function Facet({ label, active, color }) {
  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: active ? `color-mix(in oklab, ${color} 20%, transparent)` : 'var(--mt-surface-3)',
        color: active ? color : 'var(--mt-ink-3)',
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}
