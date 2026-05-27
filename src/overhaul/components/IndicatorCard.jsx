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
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'transform 160ms var(--mt-ease), box-shadow 160ms var(--mt-ease)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--mt-ink-0)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ind.name}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--mt-ink-2)', marginTop: 2 }}>
            {ind.familyFull || ind.domain}
          </div>
        </div>
        <FreshnessChip elementId={ind.id} variant="dot" />
      </header>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div className="num" style={{ fontSize: 24, fontWeight: 500, color: accent }}>
          {fmtNum(ind.value, ind.decimals ?? 2)}
          <span style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginLeft: 4, fontWeight: 400 }}>
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
      <div style={{ fontSize: 10.5, color: 'var(--mt-ink-2)' }} className="num">
        {ind.pct != null ? `${ind.pct}th percentile` : 'no rank'}
      </div>
    </button>
  );
}
