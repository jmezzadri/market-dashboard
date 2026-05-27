/* ScanList — shared row component used by Scanner and Portfolio Positions.
   Ported from prototype/lm-shared.jsx ScanList + lm-scancard structure.
   Row layout: ticker block + ScoreDial + price/change + sparkline + facets + chevron.
   Drill renders below via the ScanDrill component the caller passes in.

   Score is on 0-5 scale (live scanner data; Joe directive 2026-05-27). */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import ScoreDial from './ScoreDial';
import Sparkline from './Sparkline';
import Tip from './Tip';

function fakeSpark(seed, n = 30) {
  let s = String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = [];
  let v = 50 + (s % 30);
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    v += ((s / 233280) - 0.5) * 4;
    out.push(v);
  }
  return out;
}

export default function ScanList({
  rows,
  drillOpenKey,
  setDrillOpenKey,
  renderDrill,    // (row) => JSX for the drill body
  rowKey = (r) => r.ticker,
  showSparkline = true,
}) {
  const navigate = useNavigate();

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
      {rows.map((r) => {
        const key = rowKey(r);
        const isOpen = drillOpenKey === key;
        const chg = Number(r.chg) || 0;
        const chgColor = chg >= 0 ? 'var(--mt-up)' : 'var(--mt-down)';
        const insider = r.insider || [];
        const dark = r.dark;
        const price = r.price;
        const sparkData = r.sparkData || fakeSpark(r.ticker);
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
                gridTemplateColumns: '1fr 56px 90px 110px 130px 24px',
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
              {/* Score dial (0-5) */}
              <ScoreDial score={r.score} max={5} size={44} />
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
              {/* Sparkline */}
              {showSparkline ? (
                <div style={{ color: chgColor }}>
                  <Sparkline data={sparkData} width={100} height={32} stroke={chgColor} area />
                </div>
              ) : (
                <div />
              )}
              {/* Facets */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                <Tip content={insider.length ? `Insider activity (60d): ${insider.join(', ')}` : 'No recent insider activity'}>
                  <Facet label="I" active={insider.length > 0} color="var(--mt-up)" />
                </Tip>
                <Tip content={dark != null ? `Dark-pool block at $${dark}` : 'No recent dark-pool prints'}>
                  <Facet label="D" active={dark != null} color="var(--mt-accent)" />
                </Tip>
                <Tip content="Options flow signal">
                  <Facet label="O" active={true} color="var(--mt-warn)" />
                </Tip>
              </div>
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
