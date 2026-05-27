/**
 * BigGauge + GaugeLegend — three-zone arc with a single black needle.
 * No labels inside the SVG — the GaugeLegend below is a 3-card row showing
 * zone label + numeric range.
 */
import React from "react";

export function BigGauge({ value, max = 100, thresholds = [], bidirectional = false }) {
  const norm = Math.max(
    0.02,
    Math.min(0.98, bidirectional ? (value + max) / (2 * max) : value / max)
  );

  const arcXY = (t) => {
    const a = ((180 + t * 180) * Math.PI) / 180;
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
  const t1 = sorted[0]?.pos ?? 0.50;
  const t2 = sorted[1]?.pos ?? 0.75;

  const needleAngle = (norm - 0.5) * 180;

  return (
    <svg viewBox="0 0 300 160" style={{ width: "100%", height: 160 }}>
      <path d={arcPath(0, t1)} fill="none" strokeWidth="10" strokeLinecap="round"
        stroke="color-mix(in oklab, var(--mt-up) 38%, var(--mt-surface-3))" />
      <path d={arcPath(t1, t2)} fill="none" strokeWidth="10"
        stroke="color-mix(in oklab, var(--mt-warn) 48%, var(--mt-surface-3))" />
      <path d={arcPath(t2, 1)} fill="none" strokeWidth="10" strokeLinecap="round"
        stroke="color-mix(in oklab, var(--mt-down) 40%, var(--mt-surface-3))" />

      <g transform={`translate(150 140) rotate(${needleAngle})`}>
        <line x1="0" y1="0" x2="0" y2="-110" stroke="var(--mt-ink-0)" strokeWidth="3" strokeLinecap="round" />
        <circle cy="-110" r="5" fill="var(--mt-ink-0)" stroke="var(--mt-surface)" strokeWidth="2" />
        <circle r="8" fill="var(--mt-ink-0)" />
        <circle r="3" fill="var(--mt-surface)" />
      </g>
    </svg>
  );
}

export function GaugeLegend({ zones }) {
  return (
    <div className="at-gaugelegend">
      {zones.map((z, i) => (
        <span key={i} className={`at-gaugezone at-gaugezone--${z.kind}`}>
          <span className="at-gaugezonedot" />
          <span className="at-gaugezonelbl">{z.label}</span>
          <span className="at-gaugezonenum num">{z.range}</span>
        </span>
      ))}
    </div>
  );
}
