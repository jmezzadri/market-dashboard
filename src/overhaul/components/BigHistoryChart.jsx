/* BigHistoryChart — wide history chart with grid-line y-ticks, area fill,
   hover crosshair, floating value tooltip. Measures its container via
   ResizeObserver so SVG viewBox matches actual rendered width — never use
   preserveAspectRatio="none" (it distorts text).
   Ported from site-overhaul lm-core.jsx, adapted for real point arrays.

   2026-06-01: added working overlays for the Ticker Detail page —
     overlays   : moving-average lines drawn on the price axis
     volume     : faint volume bars in a band along the bottom
     events     : dated vertical markers (insider / dark-pool prints)
     compareData: a second ticker, rebased to the primary's start price so
                  the two are comparable on one axis ("indexed to start").
   All series are aligned to the primary series BY DATE, so a missing or
   warm-up point (e.g. the first 199 days of a 200-day average) just leaves
   a gap rather than shifting the line. */

import React, { useState, useRef, useEffect, useMemo } from 'react';

export default function BigHistoryChart({
  points = [],          // [[isoDate, value], ...]
  accent = 'var(--mt-accent)',
  height = 300,
  overlays = [],        // [{ points:[[iso,val]], color, label, dash }]
  volume = null,        // [[iso, vol], ...]
  events = [],          // [{ date, label, color }]
  compareData = null,   // [[iso, val], ...] — rebased to primary start
  compareLabel = '',
  compareAccent = 'var(--mt-warn)',
  yFormat = (v) => v.toFixed(2),
  freq = '',            // 'D' | 'W' | 'M' | 'Q' — drives hover-date precision
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

  // index of iso date -> position, so overlays/compare/events align by date
  const idxByDate = useMemo(() => {
    const m = new Map();
    data.forEach((d, i) => m.set(d.x, i));
    return m;
  }, [data]);

  // Rebase compare to the primary's first value (indexed performance).
  const compareSeries = useMemo(() => {
    if (!compareData?.length || !data.length) return null;
    const cmpByDate = new Map(compareData.filter((p) => Array.isArray(p) && typeof p[1] === 'number').map((p) => [p[0], p[1]]));
    // first date present in both
    let base = null;
    for (const d of data) { if (cmpByDate.has(d.x)) { base = cmpByDate.get(d.x); break; } }
    if (!base) return null;
    const scale = data[0].y / base;
    return data.map((d) => (cmpByDate.has(d.x) ? cmpByDate.get(d.x) * scale : null));
  }, [compareData, data]);

  if (!data.length) {
    return (
      <div ref={wrapRef} style={{ height, display: 'grid', placeItems: 'center',
        color: 'var(--mt-ink-3)', fontSize: 13 }}>
        No data
      </div>
    );
  }

  const padL = 56, padR = 16, padT = 16, padB = 28;
  const volBand = volume ? Math.round((height - padT - padB) * 0.18) : 0;
  const plotBot = height - padB - volBand;   // price area sits above the volume band

  // y-range spans price + overlays + rebased compare
  let yVals = data.map((d) => d.y);
  overlays.forEach((o) => (o.points || []).forEach((p) => { if (typeof p[1] === 'number') yVals.push(p[1]); }));
  if (compareSeries) compareSeries.forEach((v) => { if (v != null) yVals.push(v); });
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const yRange = (yMax - yMin) || 1;
  const yPad = yRange * 0.1;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;
  const xOf = (i) => padL + (i / Math.max(1, data.length - 1)) * (w - padL - padR);
  const yOf = (v) => padT + (1 - (v - yLo) / (yHi - yLo)) * (plotBot - padT);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => yLo + (i / ticks) * (yHi - yLo));

  const path = data
    .map((d, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(d.y).toFixed(1)}`)
    .join(' ');
  const areaPath = `${path} L${xOf(data.length - 1).toFixed(1)} ${plotBot.toFixed(1)} L${xOf(0).toFixed(1)} ${plotBot.toFixed(1)} Z`;

  // Build a path for an overlay/compare series aligned by date (gaps allowed).
  function seriesPath(values) {
    let started = false;
    const segs = [];
    values.forEach((v, i) => {
      if (v == null) { started = false; return; }
      segs.push(`${started ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`);
      started = true;
    });
    return segs.join(' ');
  }
  function overlayValues(o) {
    const byDate = new Map((o.points || []).filter((p) => typeof p[1] === 'number').map((p) => [p[0], p[1]]));
    return data.map((d) => (byDate.has(d.x) ? byDate.get(d.x) : null));
  }

  // volume bars
  const volByDate = volume ? new Map(volume.filter((p) => typeof p[1] === 'number').map((p) => [p[0], p[1]])) : null;
  const maxVol = volByDate ? Math.max(1, ...Array.from(volByDate.values())) : 1;
  const volBarW = Math.max(1, (w - padL - padR) / Math.max(1, data.length) * 0.7);

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

  const f = String(freq || '').toUpperCase();
  const hoverDateOpts =
    f === 'M' || f === 'Q'
      ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
      : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  const hoverDateLabel = (i) => {
    const iso = data[i]?.x;
    if (!iso) return '';
    const dt = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
    return dt.toLocaleDateString('en-US', hoverDateOpts);
  };

  const fmtCompact = (n) => {
    n = Number(n);
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return String(Math.round(n));
  };

  // Aligned series for the hover readout, and events grouped by date index.
  const overlaySeries = overlays.map((o) => ({
    label: o.label, color: o.color || "var(--mt-ink-2)", values: overlayValues(o),
  }));
  const eventsByIdx = new Map();
  for (const ev of events) {
    const i = idxByDate.get(ev.date);
    if (i == null) continue;
    if (!eventsByIdx.has(i)) eventsByIdx.set(i, []);
    eventsByIdx.get(i).push(ev);
  }
  // Only list an event type in the legend when at least one of that type is
  // actually plotted (an event whose date falls inside the visible window).
  const plotted = [...eventsByIdx.values()].flat();
  const hasInsiderEv = plotted.some((e) => (e.label || '').toLowerCase().includes('insider'));
  const hasDarkEv = plotted.some((e) => (e.label || '').toLowerCase().includes('dark'));

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
            <line x1={padL} x2={w - padR} y1={yOf(v)} y2={yOf(v)} stroke="var(--mt-line-0)" strokeWidth="1" />
            <text x={padL - 8} y={yOf(v)} textAnchor="end" dominantBaseline="middle"
              fill="var(--mt-ink-3)" style={{ font: '11px var(--mt-font-ui)' }} className="num">
              {yFormat(v)}
            </text>
          </g>
        ))}

        {/* volume bars */}
        {volByDate && data.map((d, i) => {
          const v = volByDate.get(d.x);
          if (v == null) return null;
          const h = (v / maxVol) * volBand;
          return (
            <rect key={`v${i}`} x={xOf(i) - volBarW / 2} y={height - padB - h}
              width={volBarW} height={h} fill="var(--mt-ink-3)" opacity={0.28} />
          );
        })}

        {/* area + price line */}
        <path d={areaPath} fill={accent} opacity={0.10} />
        <path d={path} fill="none" stroke={accent} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />

        {/* moving-average overlays */}
        {overlays.map((o, k) => (
          <path key={`o${k}`} d={seriesPath(overlayValues(o))} fill="none"
            stroke={o.color || 'var(--mt-ink-2)'} strokeWidth="1.4"
            strokeDasharray={o.dash || ''} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
        ))}

        {/* compare line (rebased) */}
        {compareSeries && (
          <path d={seriesPath(compareSeries)} fill="none" stroke={compareAccent}
            strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
        )}

        {/* event markers — one dot per date, ON the price line; multiple events
            on the same day get a larger dot, with the full list shown on hover. */}
        {[...eventsByIdx.entries()].map(([i, evs]) => (
          <g key={`e${i}`}>
            <line x1={xOf(i)} x2={xOf(i)} y1={padT} y2={plotBot} stroke={evs[0].color || 'var(--mt-accent)'}
              strokeWidth="1" strokeDasharray="2 3" opacity={0.3} />
            <circle cx={xOf(i)} cy={yOf(data[i].y)} r={evs.length > 1 ? 4.5 : 3.5}
              fill={evs[0].color || 'var(--mt-accent)'} stroke="var(--mt-surface)" strokeWidth="1.5" />
          </g>
        ))}

        {/* x-axis labels */}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={xOf(i)} y={height - 8}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            fill="var(--mt-ink-3)" style={{ font: '10.5px var(--mt-font-ui)' }}>
            {dateLabel(i)}
          </text>
        ))}

        {/* hover crosshair */}
        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1={padT} y2={plotBot}
              stroke="var(--mt-ink-2)" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
            <circle cx={hover.x} cy={hover.y} r="4.5" fill={accent} stroke="var(--mt-surface)" strokeWidth="2" />
          </>
        )}
      </svg>

      {(overlays.length > 0 || compareSeries || volume || hasInsiderEv || hasDarkEv) && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 11, color: 'var(--mt-ink-2)' }}>
          <LegendSwatch color={accent} label="Price" />
          {overlays.map((o, k) => <LegendSwatch key={k} color={o.color || 'var(--mt-ink-2)'} label={o.label} dash />)}
          {compareSeries && <LegendSwatch color={compareAccent} label={`${compareLabel || 'Compare'} (indexed)`} dash />}
          {volume && <LegendSwatch color="var(--mt-ink-3)" label="Volume" block />}
          {hasInsiderEv && <LegendSwatch color="var(--mt-up)" label="Insider event" dot />}
          {hasDarkEv && <LegendSwatch color="var(--mt-accent)" label="Dark-pool event" dot />}
        </div>
      )}

      {hover && (() => {
        const i = hover.i;
        const rows = [["Price", yFormat(hover.d.y), accent]];
        overlaySeries.forEach((o) => { const v = o.values[i]; if (v != null) rows.push([o.label, yFormat(v), o.color]); });
        if (compareSeries && compareSeries[i] != null) rows.push([compareLabel || "Compare", yFormat(compareSeries[i]), compareAccent]);
        if (volByDate) { const vv = volByDate.get(data[i].x); if (vv != null) rows.push(["Volume", fmtCompact(vv), "var(--mt-ink-3)"]); }
        const evs = eventsByIdx.get(i) || [];
        const left = Math.max(80, Math.min(w - 80, hover.x));
        return (
          <div
            style={{
              position: 'absolute', left, top: Math.max(6, hover.y - 16),
              transform: 'translate(-50%, -100%)',
              background: 'var(--mt-surface)', border: '1px solid var(--mt-line-1)',
              borderRadius: 6, padding: '7px 9px', fontSize: 11.5, minWidth: 150,
              color: 'var(--mt-ink-0)', fontFamily: 'var(--mt-font-ui)',
              boxShadow: '0 6px 18px rgba(0,0,0,0.16)', pointerEvents: 'none', zIndex: 5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{hoverDateLabel(i)}</div>
            {rows.map(([label, val, color], k) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, lineHeight: 1.5 }}>
                <span style={{ color: 'var(--mt-ink-2)' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 5, verticalAlign: 'middle' }} />
                  {label}
                </span>
                <span className="num" style={{ color: 'var(--mt-ink-0)' }}>{val}</span>
              </div>
            ))}
            {evs.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--mt-line-0)' }}>
                {evs.map((e, k) => (
                  <div key={k} style={{ color: e.color || 'var(--mt-ink-1)', lineHeight: 1.5 }}>● {e.label}</div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function LegendSwatch({ color, label, dash, block, dot }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {dot ? (
        <span style={{ width: 8, height: 8, background: color, display: 'inline-block', borderRadius: '50%' }} />
      ) : block ? (
        <span style={{ width: 9, height: 9, background: color, opacity: 0.4, display: 'inline-block', borderRadius: 1 }} />
      ) : (
        <span style={{ width: 14, height: 0, borderTop: `2px ${dash ? 'dashed' : 'solid'} ${color}`, display: 'inline-block' }} />
      )}
      {label}
    </span>
  );
}
