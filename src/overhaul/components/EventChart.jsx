/* EventChart — sparkline with A/B/C/N event markers at specific day indices.
   Ported from prototype/lm-shared.jsx EventChart. */

import React from 'react';

export default function EventChart({
  data = [],
  accent = 'var(--mt-accent)',
  events = [],
}) {
  if (!data.length) return <div style={{ height: 130, background: 'var(--mt-surface-3)', borderRadius: 8 }} />;

  const W = 480, H = 130, P = 10;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const r = (max - min) || 1;
  const stepX = (W - P * 2) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [P + i * stepX, H - P - ((d - min) / r) * (H - P * 2)]);
  const dPath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaPath = `${dPath} L${pts[pts.length - 1][0]} ${H - P} L${pts[0][0]} ${H - P} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: H, display: 'block' }}>
      <defs>
        <linearGradient id="evt-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#evt-area)" />
      <path
        d={dPath}
        fill="none"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {events.map((e) => {
        const p = pts[Math.min(pts.length - 1, e.idx)];
        if (!p) return null;
        return (
          <g key={e.badge} transform={`translate(${p[0]} ${p[1]})`}>
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="-22"
              stroke={accent}
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.6"
            />
            <circle
              cy="-26"
              r="8"
              fill="var(--mt-surface)"
              stroke={accent}
              strokeWidth="1.5"
            />
            <text
              textAnchor="middle"
              y="-23"
              fontSize="9.5"
              fontWeight="700"
              fontFamily="var(--mt-font-mono)"
              fill={accent}
            >
              {e.badge}
            </text>
            <circle r="3.5" fill={accent} stroke="var(--mt-surface)" strokeWidth="1.5" />
          </g>
        );
      })}
    </svg>
  );
}
