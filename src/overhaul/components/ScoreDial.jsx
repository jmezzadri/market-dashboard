/* ScoreDial — donut + center number. Used by scanner rows and the
   ticker page header (size 96).
   Ported from site-overhaul lm-core.jsx. */

import React from 'react';

export default function ScoreDial({ score, max = 5, size = 44 }) {
  const safe = score == null || !Number.isFinite(score) ? 0 : score;
  const pct = Math.max(0, Math.min(1, safe / max));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color =
    safe >= max * 0.85
      ? 'var(--mt-up)'
      : safe >= max * 0.6
        ? 'var(--mt-accent)'
        : safe >= max * 0.4
          ? 'var(--mt-warn)'
          : 'var(--mt-down)';
  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'inline-block',
      }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--mt-line-1)"
          strokeWidth="3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontSize: Math.round(size * 0.32),
          fontWeight: 600,
          color: 'var(--mt-ink-0)',
          fontFamily: 'var(--mt-font-display)',
          letterSpacing: '-0.02em',
        }}
      >
        {safe.toFixed(1)}
      </div>
    </div>
  );
}
