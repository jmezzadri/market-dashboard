/* Sparkline — tiny SVG line with optional area fill + final-point dot.
   Hover emits the index + value via onHover.
   Ported from site-overhaul prototype shared.jsx. */

import React, { useState, useRef } from 'react';

export default function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = 'currentColor',
  fill = 'currentColor',
  strokeWidth = 1.5,
  showDot = true,
  onHover,
  area = false,
  pad = 2,
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [
    pad + i * stepX,
    height - pad - ((d - min) / range) * (height - pad * 2),
  ]);
  const dPath = pts
    .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(' ');
  const areaPath = area
    ? `${dPath} L${pts[pts.length - 1][0].toFixed(2)} ${height - pad} L${pts[0][0].toFixed(2)} ${height - pad} Z`
    : null;

  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const onMove = (e) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * width;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((x - pad) / stepX)));
    setHoverIdx(i);
    onHover?.(i, data[i]);
  };
  const onLeave = () => {
    setHoverIdx(null);
    onHover?.(null, null);
  };

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {areaPath && <path d={areaPath} fill={fill} opacity={0.18} />}
      <path
        d={dPath}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDot && pts.length > 0 && (
        <circle
          cx={pts[pts.length - 1][0]}
          cy={pts[pts.length - 1][1]}
          r={2.5}
          fill={stroke}
        />
      )}
      {hoverIdx != null && (
        <>
          <line
            x1={pts[hoverIdx][0]}
            x2={pts[hoverIdx][0]}
            y1={0}
            y2={height}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.35}
          />
          <circle
            cx={pts[hoverIdx][0]}
            cy={pts[hoverIdx][1]}
            r={3}
            fill={stroke}
            stroke="var(--mt-surface)"
            strokeWidth={1.5}
          />
        </>
      )}
    </svg>
  );
}
