/* BigGauge — three-zone arc with single black needle.
   Matches prototype/pages/tilt.jsx BigGauge component exactly:
     - 300x160 viewBox, arc centered at (150,140) r=120, sweep from 180° to 0°
     - Three zones colored from green→amber→red along the arc
     - Threshold pins at the two zone boundaries
     - Needle = line + tip-circle at r=110, central socket (8/3)
     - bidirectional flag: maps value in [-max..+max] to [0..1] (so 0 = center)
   Zone labels live OUTSIDE the SVG in a separate GaugeLegend row.
   Per brief: NO labels inside the SVG. Ever. */

import React from 'react';

export default function BigGauge({
  value,
  max = 100,
  thresholds = [],          // [{ pos: 0.58 }, { pos: 0.62 }] — fractions of arc
  bidirectional = false,    // map value in [-max..+max] to [0..1]
}) {
  const safe = Number.isFinite(value) ? value : 0;
  const norm = Math.max(
    0.02,
    Math.min(0.98, bidirectional ? (safe + max) / (2 * max) : safe / max),
  );

  // Arc position [0,1] → (x,y) on a r=120 arc centered at (150,140).
  // Left edge → (30,140) at 180°, top → (150,20) at 270°, right → (270,140) at 0°.
  const arcXY = (t) => {
    const a = (180 + t * 180) * (Math.PI / 180);
    return [150 + 120 * Math.cos(a), 140 + 120 * Math.sin(a)];
  };
  const arcPath = (t0, t1) => {
    const [x0, y0] = arcXY(t0);
    const [x1, y1] = arcXY(t1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A 120 120 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };

  const sorted = [...thresholds]
    .map((t) => ({ ...t, pos: Math.max(0, Math.min(1, t.pos)) }))
    .sort((a, b) => a.pos - b.pos);
  const t1 = sorted[0]?.pos ?? 0.5;
  const t2 = sorted[1]?.pos ?? 0.75;

  const needleAngle = (norm - 0.5) * 180;

  return (
    <svg viewBox="0 0 300 160" style={{ width: '100%', height: 160 }}>
      <path
        d={arcPath(0, t1)}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        stroke="color-mix(in oklab, var(--mt-up) 38%, var(--mt-surface-3))"
      />
      <path
        d={arcPath(t1, t2)}
        fill="none"
        strokeWidth="10"
        stroke="color-mix(in oklab, var(--mt-warn) 48%, var(--mt-surface-3))"
      />
      <path
        d={arcPath(t2, 1)}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        stroke="color-mix(in oklab, var(--mt-down) 40%, var(--mt-surface-3))"
      />

      <g transform={`translate(150 140) rotate(${needleAngle})`}>
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="-110"
          stroke="var(--mt-ink-0)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle
          cy="-110"
          r="5"
          fill="var(--mt-ink-0)"
          stroke="var(--mt-surface)"
          strokeWidth="2"
        />
        <circle r="8" fill="var(--mt-ink-0)" />
        <circle r="3" fill="var(--mt-surface)" />
      </g>
    </svg>
  );
}

export function GaugeLegend({ zones }) {
  // zones: [{ kind: 'up'|'warn'|'down', label, range }]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${zones.length}, 1fr)`,
        gap: 8,
        marginTop: 6,
      }}
    >
      {zones.map((z) => {
        const color =
          z.kind === 'up'
            ? 'var(--mt-up)'
            : z.kind === 'warn'
              ? 'var(--mt-warn)'
              : 'var(--mt-down)';
        return (
          <div
            key={z.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              border: '1px solid var(--mt-line-0)',
              borderRadius: 8,
              background: 'var(--mt-surface-2)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                color,
                flex: 1,
              }}
            >
              {z.label}
            </span>
            <span
              className="num"
              style={{
                fontSize: 11,
                color: 'var(--mt-ink-2)',
                fontFamily: 'var(--mt-font-mono)',
              }}
            >
              {z.range}
            </span>
          </div>
        );
      })}
    </div>
  );
}
