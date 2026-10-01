/* IndicatorCard — compact card used in the Macro grid view. */

import React from 'react';
import Sparkline from './Sparkline';
import FreshnessChip from './FreshnessChip';

function fmtNum(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export default function IndicatorCard({ ind, onClick }) {
  const accent =
    ind.state === 'extreme'
      ? 'var(--mt-down)'
      : ind.state === 'elevated'
        ? 'var(--mt-warn)'
        : 'var(--mt-up)';
  const trend = (ind.points || []).slice(-90).map((p) => p[1]).filter((v) => Number.isFinite(v));
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-card ind-card"
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        background: 'var(--mt-surface)',
        border: '1px solid var(--mt-line-0)',
        padding: 'var(--sp-16)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-8)',
        transition: 'transform var(--dur-160) var(--mt-ease), box-shadow var(--dur-160) var(--mt-ease)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 'var(--sp-8)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--v13-t3)',
              fontWeight: 'var(--fw-600)',
              color: 'var(--mt-ink-0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ind.name}
          </div>
          <div style={{ fontSize: 'var(--v13-t1)', color: 'var(--mt-ink-2)', marginTop: 'var(--sp-2)' }}>
            {ind.familyFull || ind.domain}
          </div>
        </div>
        <FreshnessChip elementId={ind.manifestId || ind.id} fallback={{ asOfIso: ind.asOf }} variant="dot" />
      </header>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--sp-12)',
        }}
      >
        <div className="num" style={{ fontSize: 'var(--v13-t6)', fontWeight: 'var(--fw-400)', color: accent }}>
          {fmtNum(ind.value, ind.decimals ?? 2)}
          <span style={{ fontSize: 'var(--v13-t2)', color: 'var(--mt-ink-2)', marginLeft: 'var(--sp-4)', fontWeight: 'var(--fw-400)' }}>
            {ind.unit}
          </span>
        </div>
        <span
          className={`mt-tag mt-tag--${ind.state === 'extreme' ? 'extreme' : ind.state === 'elevated' ? 'elev' : 'calm'}`}
        >
          {ind.state}
        </span>
      </div>
      <div style={{ color: accent }}>
        <Sparkline data={trend} width={240} height={28} stroke={accent} showDot />
      </div>
      <div style={{ fontSize: 'var(--v13-t1)', color: 'var(--mt-ink-2)' }} className="num">
        {ind.pct != null ? `${ind.pct}th percentile` : 'no rank'}
      </div>
    </button>
  );
}
