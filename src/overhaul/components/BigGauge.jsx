/* BigGauge — three-zone arc (green/amber/red) with a single black needle.
   NO labels inside the SVG — the legend below names the zones with
   numeric ranges (rendered separately via GaugeLegend).
   Site-overhaul brief: zone labels live in a 3-card row, never inside arc. */

import React from 'react';

export default function BigGauge({
  value,                 // current value
  min = 0,
  max = 100,
  thresholds,            // [lowEnd, midEnd] e.g. [40, 70]
  size = 220,
  label,                 // small caption above
}) {
  const W = size;
  const H = Math.round(size * 0.65);
  const cx = W / 2;
  const cy = H * 0.95;
  const r = W * 0.42;
  const start = Math.PI;          // 180 deg (left)
  const end = 2 * Math.PI;        // 360 deg (right)
  const total = end - start;

  // Map value [min..max] → angle [start..end]
  const safeVal = Math.max(min, Math.min(max, value ?? min));
  const t = (safeVal - min) / Math.max(1e-9, max - min);
  const angle = start + total * t;
  const nx = cx + r * Math.cos(angle);
  const ny = cy + r * Math.sin(angle);

  // Three zones
  const [lo, mid] = thresholds || [(max - min) * 0.4 + min, (max - min) * 0.7 + min];
  const loA = start + total * ((lo - min) / (max - min));
  const midA = start + total * ((mid - min) / (max - min));

  function arc(a0, a1, color) {
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return (
      <path
        d={`M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`}
        stroke={color}
        strokeWidth={16}
        fill="none"
        strokeLinecap="butt"
      />
    );
  }

  return (
    <div style={{ textAlign: 'center' }}>
      {label && <div className="mt-eyebrow" style={{ marginBottom: 6 }}>{label}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
        {arc(start, loA, 'var(--mt-up)')}
        {arc(loA, midA, 'var(--mt-warn)')}
        {arc(midA, end, 'var(--mt-down)')}
        {/* needle */}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="var(--mt-ink-0)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="6" fill="var(--mt-ink-0)" />
      </svg>
      <div
        className="num"
        style={{
          fontFamily: 'var(--mt-font-display)',
          fontSize: 36,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--mt-ink-0)',
          marginTop: -8,
        }}
      >
        {safeVal == null || !Number.isFinite(safeVal) ? '—' : safeVal.toLocaleString(undefined, { maximumFractionDigits: 1 })}
      </div>
    </div>
  );
}

export function GaugeLegend({ zones }) {
  // zones: [{ label, range, color }, ...]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${zones.length}, 1fr)`,
        gap: 8,
        marginTop: 10,
      }}
    >
      {zones.map((z) => (
        <div
          key={z.label}
          className="mt-card"
          style={{
            padding: '10px 12px',
            borderTop: `3px solid ${z.color}`,
            borderRadius: 6,
            background: 'var(--mt-surface)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: z.color,
            }}
          >
            {z.label}
          </div>
          <div
            className="num"
            style={{ fontSize: 12, color: 'var(--mt-ink-2)', marginTop: 2 }}
          >
            {z.range}
          </div>
        </div>
      ))}
    </div>
  );
}
