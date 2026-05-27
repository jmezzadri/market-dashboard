/* RegimeCanvas — 2D macro map. Quadrants (Risk On/Off × Inflationary /
   Deflationary), engine-call marker in upper-LEFT (Risk On · Inflationary
   per the brief's baked-in decision), indicator dots positioned by
   state (extreme right, calm left) and domain (y-axis).
   Ported from site-overhaul lm-shared.jsx.

   positionIndicators is the public anchor — DO NOT switch back to raw
   percentile. State maps to x; domain maps to y. */

import React, { useState, useMemo } from 'react';

const DOMAIN_Y = {
  Rates: 0.45,
  Credit: 0.20,
  Equities: -0.10,
  Money: -0.40,
  Economy: -0.65,
};

const STATE_X = {
  extreme: 0.62,
  elevated: 0.20,
  calm: -0.55,
};

const DOMAIN_X_JITTER = {
  Rates: -0.05,
  Credit: 0.05,
  Equities: -0.03,
  Money: 0.03,
  Economy: 0.0,
};

function positionIndicators(inds) {
  // Group by (domain, state) → place each indicator in a small stacked
  // cluster so dots don't overlap.
  const buckets = new Map();
  inds.forEach((i) => {
    const key = `${i.domain}|${i.state}`;
    const list = buckets.get(key) || [];
    list.push(i);
    buckets.set(key, list);
  });
  const out = [];
  for (const [key, list] of buckets.entries()) {
    const [dom, state] = key.split('|');
    const baseX = (STATE_X[state] ?? 0) + (DOMAIN_X_JITTER[dom] ?? 0);
    const baseY = (DOMAIN_Y[dom] ?? 0);
    const cols = Math.ceil(Math.sqrt(list.length));
    list.forEach((ind, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      out.push({
        ...ind,
        x: baseX + (col - (cols - 1) / 2) * 0.08,
        y: baseY + row * 0.07,
      });
    });
  }
  return out;
}

const COLOR_FOR_STATE = {
  extreme: 'var(--mt-down)',
  elevated: 'var(--mt-warn)',
  calm: 'var(--mt-up)',
};

export default function RegimeCanvas({
  indicators = [],
  onSelect,
  selected,
  aspect = 1.78,
}) {
  const [hover, setHover] = useState(null);
  const positioned = useMemo(() => positionIndicators(indicators), [indicators]);

  const W = 1200;
  const H = Math.round(W / aspect);
  const px = (x) => 60 + (x + 1) / 2 * (W - 120);
  const py = (y) => H - 60 - (y + 1) / 2 * (H - 120);

  return (
    <div className="mt-card" style={{ padding: 12, position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <defs>
          <radialGradient id="rc-q-extreme" cx="0.85" cy="0.15" r="0.6">
            <stop offset="0%" stopColor="var(--mt-down)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--mt-down)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rc-q-cool" cx="0.15" cy="0.85" r="0.6">
            <stop offset="0%" stopColor="var(--mt-up)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--mt-up)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#rc-q-extreme)" />
        <rect x="0" y="0" width={W} height={H} fill="url(#rc-q-cool)" />

        {/* axes */}
        <line x1={W / 2} x2={W / 2} y1="30" y2={H - 30} stroke="var(--mt-line-1)" strokeDasharray="2 4" />
        <line x1="30" x2={W - 30} y1={H / 2} y2={H / 2} stroke="var(--mt-line-1)" strokeDasharray="2 4" />

        {/* axis labels */}
        <text x={W - 16} y={H / 2 - 10} textAnchor="end" fill="var(--mt-ink-2)" style={{ font: '10.5px var(--mt-font-ui)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>stress →</text>
        <text x="16" y={H / 2 - 10} fill="var(--mt-ink-2)" style={{ font: '10.5px var(--mt-font-ui)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>← calm</text>
        <text x={W / 2 + 10} y="28" fill="var(--mt-ink-2)" style={{ font: '10.5px var(--mt-font-ui)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>inflationary ↑</text>
        <text x={W / 2 + 10} y={H - 14} fill="var(--mt-ink-2)" style={{ font: '10.5px var(--mt-font-ui)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>↓ deflationary</text>

        {/* quadrant labels */}
        <text x={W - 24} y="44" textAnchor="end" fill="var(--mt-down)" style={{ font: '600 11px var(--mt-font-ui)', letterSpacing: '0.15em' }}>RISK OFF · INFL</text>
        <text x="24" y="44" fill="var(--mt-ink-2)" style={{ font: '600 11px var(--mt-font-ui)', letterSpacing: '0.15em' }}>RISK ON · INFL</text>
        <text x={W - 24} y={H - 28} textAnchor="end" fill="var(--mt-ink-2)" style={{ font: '600 11px var(--mt-font-ui)', letterSpacing: '0.15em' }}>RISK OFF · DEFL</text>
        <text x="24" y={H - 28} fill="var(--mt-up)" style={{ font: '600 11px var(--mt-font-ui)', letterSpacing: '0.15em' }}>RISK ON · DEFL</text>

        {/* Engine call marker — upper-left (Risk On · Inflationary) per brief */}
        <g transform={`translate(${px(-0.55)} ${py(0.45)})`}>
          <circle r="22" fill="none" stroke="var(--mt-accent)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
          <line x1="-30" x2="30" y1="0" y2="0" stroke="var(--mt-accent)" strokeWidth="1" opacity="0.4" />
          <line x1="0" x2="0" y1="-30" y2="30" stroke="var(--mt-accent)" strokeWidth="1" opacity="0.4" />
          <circle r="5" fill="var(--mt-accent)" stroke="var(--mt-surface)" strokeWidth="2" />
          <text x="14" y="-26" fill="var(--mt-ink-2)" style={{ font: '10px var(--mt-font-ui)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Engine call</text>
          <text x="14" y="-12" fill="var(--mt-accent)" style={{ font: '600 12px var(--mt-font-ui)' }}>Risk On · Inflationary</text>
        </g>

        {/* Indicator dots */}
        {positioned.map((ind) => {
          const cx = px(ind.x);
          const cy = py(ind.y);
          const isHover = hover === ind.id;
          const isSel = selected?.id === ind.id;
          const color = COLOR_FOR_STATE[ind.state];
          const r = isHover || isSel ? 9 : 7;
          return (
            <g
              key={ind.id}
              transform={`translate(${cx} ${cy})`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(ind.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(ind)}
            >
              <circle r={r + 4} fill={color} opacity={isHover || isSel ? 0.25 : 0.12} />
              <circle r={r} fill={color} stroke="var(--mt-surface)" strokeWidth="1.5" />
              {(isHover || isSel) && (
                <g transform={`translate(${cx > W * 0.7 ? -10 : 10}, ${cy > H * 0.7 ? -36 : -16})`}>
                  <rect
                    x={cx > W * 0.7 ? -180 : 0}
                    y="-12"
                    width="180"
                    height="32"
                    rx="6"
                    fill="var(--mt-surface)"
                    stroke="var(--mt-line-1)"
                    strokeWidth="1"
                  />
                  <text
                    x={cx > W * 0.7 ? -172 : 8}
                    y="2"
                    fill="var(--mt-ink-0)"
                    style={{ font: '600 11.5px var(--mt-font-ui)' }}
                  >
                    {ind.name}
                  </text>
                  <text
                    x={cx > W * 0.7 ? -172 : 8}
                    y="16"
                    fill="var(--mt-ink-2)"
                    style={{ font: '10.5px var(--mt-font-ui)' }}
                  >
                    {ind.domain} · {ind.state}{ind.pct != null ? ` · ${ind.pct}th pct` : ''}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 16,
          display: 'flex',
          gap: 14,
          fontSize: 11,
          color: 'var(--mt-ink-2)',
          alignItems: 'center',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-down)' }} />
          extreme
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-warn)' }} />
          elevated
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-up)' }} />
          calm
        </span>
      </div>
    </div>
  );
}

export { positionIndicators };
