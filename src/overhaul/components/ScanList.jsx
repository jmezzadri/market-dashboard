/* ScanList — shared row component used by Scanner and Portfolio Positions.
   Ported from prototype/lm-shared.jsx ScanList + lm-scancard structure.
   Drill renders below via the ScanDrill component the caller passes in.

   Score is on a 0-5 scale (live scanner data; Joe directive 2026-05-27).

   2026-06-01: every value here is now REAL — sparkline uses the engine's
   stored `spark` close series (no more synthetic random walk), price/change
   come straight off the scan row.

   When `indicatorColumns` is set (Scanner page only — Joe ask 2026-06-01
   "show all the columns for the indicators that feed the score"), each row
   adds four numeric columns for the real per-indicator points that SUM to
   the score: Insider, Technicals (200-day + RSI), Options, Dark-pool. A
   header row labels them. Portfolio Positions leaves the prop off and keeps
   the compact I/D/O facet dots. */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import ScoreDial from './ScoreDial';
import Sparkline from './Sparkline';
import Tip from './Tip';

const techPts = (r) => (Number(r.sma200_pts) || 0) + (Number(r.rsi_pts) || 0);

const GRID_FACETS = '1fr 56px 90px 110px 130px 24px';
const GRID_INDICATORS = '1fr 52px 84px 84px 52px 52px 52px 52px 22px';

export default function ScanList({
  rows,
  drillOpenKey,
  setDrillOpenKey,
  renderDrill,    // (row) => JSX for the drill body
  rowKey = (r) => r.ticker,
  showSparkline = true,
  indicatorColumns = false,
}) {
  const navigate = useNavigate();
  const grid = indicatorColumns ? GRID_INDICATORS : GRID_FACETS;

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
          <span>Ticker</span>
          <span style={{ textAlign: 'center' }}>Score</span>
          <span>Last</span>
          <span>30-day</span>
          <ColHead tip="Insider Form-4 points (rules A/B/C, decayed by age)">Insider</ColHead>
          <ColHead tip="Technicals points: above 200-day line + RSI penalty">Tech</ColHead>
          <ColHead tip="Options-volume-shock points">Options</ColHead>
          <ColHead tip="Dark-pool anchor points">Dark</ColHead>
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
              {/* Ticker + sub */}
              <div style={{ minWidth: 0 }}>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/ticker/${r.ticker}`);
                  }}
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'var(--mt-accent)',
                    cursor: 'pointer',
                    marginRight: 8,
                  }}
                >
                  {r.ticker}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--mt-ink-2)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.name ? `${r.name} · ` : ''}{r.sector || ''}
                </span>
              </div>
              {/* Score dial (0-10 engine ceiling) */}
              <ScoreDial score={r.score} max={10} size={44} />
              {/* Price + change */}
              {price != null ? (
                <div>
                  <div className="num" style={{ fontSize: 14, color: 'var(--mt-ink-0)', fontWeight: 600 }}>
                    ${Number(price).toFixed(2)}
                  </div>
                  <div className="num" style={{ fontSize: 11, color: chgColor, fontWeight: 500 }}>
                    {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                  </div>
                </div>
              ) : (
                <div />
              )}
              {/* Sparkline (real close series) */}
              {showSparkline && sparkData?.length ? (
                <div style={{ color: chgColor }}>
                  <Sparkline data={sparkData} width={indicatorColumns ? 80 : 100} height={32} stroke={chgColor} area />
                </div>
              ) : (
                <div />
              )}

              {indicatorColumns ? (
                <>
                  <PtsCell value={r.insider_pts} on={insiderOn} tip={insiderTip} />
                  <PtsCell value={tp} on={tp > 0} tip={techTip} />
                  <PtsCell value={r.options_pts} on={optionsOn} tip={optionsTip} />
                  <PtsCell value={r.dark_pool_pts} on={darkOn} tip={darkTip} />
                </>
              ) : (
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
