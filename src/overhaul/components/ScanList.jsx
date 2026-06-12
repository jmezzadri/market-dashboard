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
  ticker:  { key: 'ticker',  label: 'Ticker',             head: 'Ticker',  w: '78px', locked: true },
  name:    { key: 'name',    label: 'Company name',       head: 'Name',    w: '1fr' },
  price:   { key: 'price',   label: 'Last price',         head: 'Last',    w: '74px' },
  day:     { key: 'day',     label: 'Day change',         head: 'Day',     w: '66px' },
  chg30:   { key: 'chg30',   label: '30-day change',      head: '30-Day',  w: '88px' },
  insider: { key: 'insider', label: 'Insider pts',        head: 'Insider', w: '54px' },
  tech:    { key: 'tech',    label: 'Technicals pts',     head: 'Tech',    w: '46px' },
  options: { key: 'options', label: 'Options pts',        head: 'Options', w: '54px' },
  dark:    { key: 'dark',    label: 'Dark-pool pts',      head: 'Dark',    w: '46px' },
  short:   { key: 'short',   label: 'Short interest %',   head: 'Short %', w: '58px' },
  flow:    { key: 'flow',    label: 'Options flow net $', head: 'Flow $',  w: '62px' },
  score:   { key: 'score',   label: 'Score',              head: 'Score',   w: '54px', locked: true },
};

// Display order (Joe 2026-06-11): identity → price action → the six signal /
// context indicators → Score pinned on the far right.
export const INDICATOR_COL_KEYS = [
  'ticker', 'name', 'price', 'day', 'chg30',
  'insider', 'tech', 'options', 'dark', 'short', 'flow',
  'score',
];

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
    <div style={{ textAlign: 'center' }}>
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
}) {
  const navigate = useNavigate();

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
            const tips = {
              insider: 'Insider Form-4 points (rules A/B/C, decayed by age)',
              tech: 'Technicals points: above 200-day line + RSI penalty',
              options: 'Options-volume-shock points',
              dark: 'Dark-pool anchor points',
              short: 'FINRA short interest as % of shares outstanding — context only, not scored',
              flow: 'Net call premium in the 30-day options flow-alert window — context only, not scored',
            };
            if (tips[k]) return <ColHead key={k} tip={tips[k]}>{col.head}</ColHead>;
            // price-action heads sit over their number cells: Last/Day right,
            // 30-Day centered (its value + magnitude bar are centered)
            if (['price', 'day'].includes(k)) {
              return <span key={k} style={{ textAlign: 'right' }}>{col.head}</span>;
            }
            if (k === 'chg30') {
              return <span key={k} style={{ textAlign: 'center' }}>{col.head}</span>;
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
                <div key={k}>
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
  // centered — the six indicator heads sit directly over centered cells
  // (Joe 2026-06-11: dashes/values must line up under their headers).
  return (
    <span style={{ textAlign: 'center' }}>
      <Tip content={tip}>{children}</Tip>
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
