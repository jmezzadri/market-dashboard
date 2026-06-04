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

import React from 'react';
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
  ticker:  { key: 'ticker',  label: 'Ticker',         head: 'Ticker',  w: '1fr',  locked: true },
  score:   { key: 'score',   label: 'Score',          head: 'Score',   w: '52px', locked: true },
  price:   { key: 'price',   label: 'Last price',     head: 'Last',    w: '84px' },
  spark:   { key: 'spark',   label: '30-day chart',   head: '30-day',  w: '84px' },
  insider: { key: 'insider', label: 'Insider pts',    head: 'Insider', w: '52px' },
  tech:    { key: 'tech',    label: 'Technicals pts', head: 'Tech',    w: '52px' },
  options: { key: 'options', label: 'Options pts',    head: 'Options', w: '52px' },
  dark:    { key: 'dark',    label: 'Dark-pool pts',  head: 'Dark',    w: '52px' },
};

export const INDICATOR_COL_KEYS = ['ticker', 'score', 'price', 'spark', 'insider', 'tech', 'options', 'dark'];

export default function ScanList({
  rows,
  drillOpenKey,
  setDrillOpenKey,
  renderDrill,    // (row) => JSX for the drill body
  rowKey = (r) => r.ticker,
  showSparkline = true,
  indicatorColumns = false,
  columns,        // optional ordered array of indicator column keys
}) {
  const navigate = useNavigate();

  // Resolve the active, ordered list of indicator columns. Ticker + Score
  // are always present (locked). If no `columns` prop is passed we fall back
  // to the full default set so older callers keep working.
  const activeKeys = indicatorColumns
    ? (() => {
        const requested = (columns && columns.length ? columns : INDICATOR_COL_KEYS)
          .filter((k) => INDICATOR_COLS[k]);
        const withLocks = ['ticker', 'score', ...requested.filter((k) => k !== 'ticker' && k !== 'score')];
        return Array.from(new Set(withLocks));
      })()
    : null;

  const grid = indicatorColumns
    ? `${activeKeys.map((k) => INDICATOR_COLS[k].w).join(' ')} 22px`
    : GRID_FACETS;

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
    <ul
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        background: 'var(--mt-surface)',
        border: '1px solid var(--mt-line-0)',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      {indicatorColumns && (
        <li
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
            if (k === 'score') return <span key={k} style={{ textAlign: 'center' }}>Score</span>;
            if (['insider', 'tech', 'options', 'dark'].includes(k)) {
              const tips = {
                insider: 'Insider Form-4 points (rules A/B/C, decayed by age)',
                tech: 'Technicals points: above 200-day line + RSI penalty',
                options: 'Options-volume-shock points',
                dark: 'Dark-pool anchor points',
              };
              return <ColHead key={k} tip={tips[k]}>{col.head}</ColHead>;
            }
            return <span key={k}>{col.head}</span>;
          })}
          <span />
        </li>
      )}

      {rows.map((r) => {
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
                    onClick={(e) => { e.stopPropagation(); navigate(`/ticker/${r.ticker}`); }}
                    style={{ fontWeight: 700, fontSize: 16, color: 'var(--mt-accent)', cursor: 'pointer', marginRight: 8 }}
                  >
                    {r.ticker}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--mt-ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name ? `${r.name} · ` : ''}{r.sector || ''}
                  </span>
                </div>
              );
            case 'score':
              return <ScoreDial key={k} score={r.score} max={10} size={44} />;
            case 'price':
              return price != null ? (
                <div key={k}>
                  <div className="num" style={{ fontSize: 14, color: 'var(--mt-ink-0)', fontWeight: 600 }}>
                    ${Number(price).toFixed(2)}
                  </div>
                  <div className="num" style={{ fontSize: 11, color: chgColor, fontWeight: 500 }}>
                    {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                  </div>
                </div>
              ) : <div key={k} />;
            case 'spark':
              return showSparkline && sparkData?.length ? (
                <div key={k} style={{ color: chgColor }}>
                  <Sparkline data={sparkData} width={80} height={32} stroke={chgColor} area />
                </div>
              ) : <div key={k} />;
            case 'insider':
              return <PtsCell key={k} value={r.insider_pts} on={insiderOn} tip={insiderTip} />;
            case 'tech':
              return <PtsCell key={k} value={tp} on={tp > 0} tip={techTip} />;
            case 'options':
              return <PtsCell key={k} value={r.options_pts} on={optionsOn} tip={optionsTip} />;
            case 'dark':
              return <PtsCell key={k} value={r.dark_pool_pts} on={darkOn} tip={darkTip} />;
            default:
              return <div key={k} />;
          }
        };

        return (
          <li key={key} style={{ borderBottom: '1px solid var(--mt-line-0)' }}>
            <div
              role="button"
              tabIndex={0}
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
                background: isOpen ? 'var(--mt-surface-2)' : 'transparent',
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
  );
}

function ColHead({ children, tip }) {
  return (
    <span style={{ textAlign: 'right' }}>
      <Tip content={tip}>{children}</Tip>
    </span>
  );
}

function PtsCell({ value, on, tip }) {
  const v = Number(value);
  const show = Number.isFinite(v) ? v.toFixed(v % 1 === 0 ? 0 : 2) : '—';
  return (
    <div className="num" style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: on ? 'var(--mt-ink-0)' : 'var(--mt-ink-3)' }}>
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
