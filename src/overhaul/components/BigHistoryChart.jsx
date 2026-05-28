/* BigHistoryChart — wide history chart with grid-line y-ticks, area fill,
   hover crosshair, floating value tooltip. Measures its container via
   ResizeObserver so SVG viewBox matches actual rendered width — never use
   preserveAspectRatio="none" (it distorts text).

   2026-05-27 — extended to support:
     - overlays[]   : [{ points: [[date,value], ...], color, label, dashed? }]
     - showVolume   : bool — render a small volume sub-row below the price plot
     - volumePoints : [[date, volume], ...] aligned to main series
     - events[]     : [{ date, label, color? }] vertical markers on the plot
*/

import React, { useState, useRef, useEffect, useMemo } from 'react';

export default function BigHistoryChart({
  points = [],          // [[isoDate, value], ...]
  accent = 'var(--mt-accent)',
  height = 300,
  overlays = [],
  showVolume = false,
  volumePoints = [],
  events = [],
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
      .filter((p) => Array.isArray(p) && p.length >= 2 && typeof p[1] === 'number' && Number.isFinite(p[1]))
      .map((p) => ({ x: p[0], y: p[1] }));
  }, [points]);

  // Index date strings to position so overlays can align even if shorter.
  const xIndex = useMemo(() => {
    const m = new Map();
    data.forEach((d, i) => m.set(d.x, i));
    return m;
  }, [data]);

  if (!data.length) {
    return (
      <div ref={wrapRef} style={{ height, display: 'grid', placeItems: 'center',
        color: 'var(--mt-ink-3)', fontSize: 13 }}>
        Loading price history…
      </div>
    );
  }

  // Layout: optionally reserve a small band at the bottom for volume.
  const volBandH = showVolume ? Math.max(40, Math.round(height * 0.18)) : 0;
  const plotH = height - volBandH;
  const padL = 56, padR = 16, padT = 16, padB = 28;

  // Y-range computed across MAIN series AND overlay values that fall inside
  // the visible window — that way SMA50 and SMA200 don't compress the price
  // line by sitting off the top/bottom.
  const allYs = [...data.map((d) => d.y)];
  for (const o of overlays) {
    if (!Array.isArray(o.points)) continue;
    for (const [date, v] of o.points) {
      if (xIndex.has(date) && typeof v === 'number' && Number.isFinite(v)) {
        allYs.push(v);
      }
    }
  }
  const yMin = Math.min(...allYs);
  const yMax = Math.max(...allYs);
  const yRange = (yMax - yMin) || 1;
  const yPad = yRange * 0.1;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;
  const xOf = (i) => padL + (i / Math.max(1, data.length - 1)) * (w - padL - padR);
  const yOf = (v) => padT + (1 - (v - yLo) / (yHi - yLo)) * (plotH - padT - padB);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => yLo + (i / ticks) * (yHi - yLo));

  const buildPath = (rows) => rows
    .map((r, i) => `${i ? 'L' : 'M'}${xOf(r.i).toFixed(1)} ${yOf(r.y).toFixed(1)}`)
    .join(' ');

  const mainRows = data.map((d, i) => ({ i, y: d.y }));
  const path = buildPath(mainRows);
  const areaPath = `${path} L${xOf(data.length - 1).toFixed(1)} ${(plotH - padB).toFixed(1)} L${xOf(0).toFixed(1)} ${(plotH - padB).toFixed(1)} Z`;

  // Pre-project each overlay to plot-space rows.
  const overlayPaths = overlays.map((o) => {
    const rows = (o.points || [])
      .map(([date, v]) => {
        const i = xIndex.get(date);
        if (i == null || typeof v !== 'number' || !Number.isFinite(v)) return null;
        return { i, y: v };
      })
      .filter(Boolean);
    return { ...o, path: buildPath(rows), rows };
  });

  // Volume band.
  const volByDate = new Map(volumePoints || []);
  const volRows = data.map((d) => volByDate.get(d.x) || 0);
  const vMax = Math.max(...volRows, 1);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((x - padL) / ((w - padL - padR) / Math.max(1, data.length - 1)))));
    setHover({ i, x: xOf(i), y: yOf(data[i].y), d: data[i] });
  };
  const onLeave = () => setHover(null);

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
        {/* event markers (vertical lines behind the price line) */}
        {events.map((ev, k) => {
          const i = xIndex.get(ev.date);
          if (i == null) return null;
          return (
            <g key={`ev-${k}`}>
              <line
                x1={xOf(i)} x2={xOf(i)}
                y1={padT} y2={plotH - padB}
                stroke={ev.color || 'var(--mt-warn)'}
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.55"
              />
            </g>
          );
        })}
        {/* area fill (main) */}
        <path d={areaPath} fill={accent} opacity={0.10} />
        {/* main line */}
        <path
          d={path}
          fill="none"
          stroke={accent}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* overlays */}
        {overlayPaths.map((o, k) => (
          <path
            key={`ov-${k}`}
            d={o.path}
            fill="none"
            stroke={o.color || 'var(--mt-ink-2)'}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={o.dashed ? '5 4' : undefined}
            opacity="0.95"
          />
        ))}
        {/* volume band */}
        {showVolume && (
          <g>
            <line
              x1={padL}
              x2={w - padR}
              y1={plotH}
              y2={plotH}
              stroke="var(--mt-line-1)"
              strokeWidth="1"
            />
            {volRows.map((v, i) => {
              const barW = Math.max(1, (w - padL - padR) / Math.max(1, data.length) * 0.7);
              const x0 = xOf(i) - barW / 2;
              const h = volBandH > 4 ? (v / vMax) * (volBandH - 6) : 0;
              return (
                <rect
                  key={`vb-${i}`}
                  x={x0}
                  y={plotH + (volBandH - h - 2)}
                  width={barW}
                  height={h}
                  fill="var(--mt-ink-3)"
                  opacity="0.55"
                />
              );
            })}
            <text
              x={padL - 8}
              y={plotH + volBandH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--mt-ink-3)"
              style={{ font: '10px var(--mt-font-ui)' }}
            >
              Vol
            </text>
          </g>
        )}
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
              y2={plotH - padB}
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
      {/* overlay legend chips */}
      {overlayPaths.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 64,
            top: 8,
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            pointerEvents: 'none',
          }}
        >
          {overlayPaths.map((o, k) => (
            <span
              key={`leg-${k}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontFamily: 'var(--mt-font-ui)',
                color: 'var(--mt-ink-2)',
                background: 'var(--mt-surface)',
                border: '1px solid var(--mt-line-1)',
                padding: '2px 7px',
                borderRadius: 999,
              }}
            >
              <span style={{
                display: 'inline-block', width: 10, height: 2,
                background: o.color || 'var(--mt-ink-2)',
                borderRadius: 1,
                borderTop: o.dashed ? `2px dashed ${o.color || 'var(--mt-ink-2)'}` : undefined,
              }} />
              {o.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
