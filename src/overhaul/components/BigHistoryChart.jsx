/* BigHistoryChart — wide history chart with grid-line y-ticks, area fill,
   hover crosshair, floating value tooltip. Measures its container via
   ResizeObserver so SVG viewBox matches actual rendered width — never use
   preserveAspectRatio="none" (it distorts text).
   Ported from site-overhaul lm-core.jsx, adapted for real point arrays. */

import React, { useState, useRef, useEffect, useMemo } from 'react';

export default function BigHistoryChart({
  points = [],          // [[isoDate, value], ...]
  accent = 'var(--mt-accent)',
  height = 300,
  compareData = null,
  compareAccent = 'var(--mt-warn)',
  yFormat = (v) => v.toFixed(2),
}) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setW(Math.max(320, Math.round(e.contentRect.width)));
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    return points
      .filter((p) => Array.isArray(p) && p.length >= 2 && typeof p[1] === 'number')
      .map((p) => ({ x: p[0], y: p[1] }));
  }, [points]);

  if (!data.length) {
    return (
      <div ref={wrapRef} style={{ height, display: 'grid', placeItems: 'center',
        color: 'var(--mt-ink-3)', fontSize: 13 }}>
        No data
      </div>
    );
  }

  const padL = 56, padR = 16, padT = 16, padB = 28;
  const yVals = data.map((d) => d.y);
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const yRange = (yMax - yMin) || 1;
  const yPad = yRange * 0.1;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;
  const xOf = (i) => padL + (i / Math.max(1, data.length - 1)) * (w - padL - padR);
  const yOf = (v) => padT + (1 - (v - yLo) / (yHi - yLo)) * (height - padT - padB);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => yLo + (i / ticks) * (yHi - yLo));

  const path = data
    .map((d, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(d.y).toFixed(1)}`)
    .join(' ');
  const areaPath = `${path} L${xOf(data.length - 1).toFixed(1)} ${(height - padB).toFixed(1)} L${xOf(0).toFixed(1)} ${(height - padB).toFixed(1)} Z`;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((x - padL) / ((w - padL - padR) / Math.max(1, data.length - 1)))));
    setHover({ i, x: xOf(i), y: yOf(data[i].y), d: data[i] });
  };
  const onLeave = () => setHover(null);

  // Date labels — beginning, middle, end.
  const dateLabel = (i) => {
    const iso = data[i]?.x;
    if (!iso) return '';
    const dt = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
    return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <svg
        width={w}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ display: 'block' }}
      >
        {/* horizontal grid lines */}
        {tickVals.map((v, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={w - padR}
              y1={yOf(v)}
              y2={yOf(v)}
              stroke="var(--mt-line-0)"
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={yOf(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--mt-ink-3)"
              style={{ font: '11px var(--mt-font-ui)' }}
              className="num"
            >
              {yFormat(v)}
            </text>
          </g>
        ))}
        {/* area fill */}
        <path d={areaPath} fill={accent} opacity={0.10} />
        {/* line */}
        <path
          d={path}
          fill="none"
          stroke={accent}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* x-axis labels */}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text
            key={i}
            x={xOf(i)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            fill="var(--mt-ink-3)"
            style={{ font: '10.5px var(--mt-font-ui)' }}
          >
            {dateLabel(i)}
          </text>
        ))}
        {/* hover crosshair */}
        {hover && (
          <>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={padT}
              y2={height - padB}
              stroke="var(--mt-ink-2)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.4"
            />
            <circle
              cx={hover.x}
              cy={hover.y}
              r="4.5"
              fill={accent}
              stroke="var(--mt-surface)"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      {hover && (
        <div
          style={{
            position: 'absolute',
            left: hover.x,
            top: hover.y - 48,
            transform: 'translateX(-50%)',
            background: 'var(--mt-surface)',
            border: '1px solid var(--mt-line-1)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11.5,
            color: 'var(--mt-ink-0)',
            fontFamily: 'var(--mt-font-ui)',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            pointerEvents: 'none',
          }}
          className="num"
        >
          <b>{yFormat(hover.d.y)}</b>{' '}
          <span style={{ color: 'var(--mt-ink-2)' }}>· {dateLabel(hover.i)}</span>
        </div>
      )}
    </div>
  );
}
