/**
 * BigHistoryChart — wide history chart with grid-line y-ticks, area fill,
 * hover crosshair, and a floating value tooltip. Measures its container
 * via ResizeObserver and sets viewBox width to actual rendered width —
 * never uses preserveAspectRatio="none" which distorts text.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

export default function BigHistoryChart({
  data,
  accent,
  height = 240,
  compareData = null,
  compareAccent = null,
}) {
  const wrapRef = useRef(null);
  const [W, setW] = useState(800);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(320, Math.floor(entry.contentRect.width));
      if (w !== W) setW(w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safe = Array.isArray(data) && data.length > 1 ? data : [0, 0];
  const H = height;
  const P = 20;
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;
  const stepX = (W - P * 2) / (safe.length - 1);
  const pts = safe.map((d, i) => [
    P + i * stepX,
    H - P - ((d - min) / range) * (H - P * 2),
  ]);
  const dPath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${dPath} L${pts[pts.length - 1][0]} ${H - P} L${pts[0][0]} ${H - P} Z`;

  let cmpDPath = null;
  if (compareData && compareData.length) {
    const cmin = Math.min(...compareData);
    const cmax = Math.max(...compareData);
    const cr = cmax - cmin || 1;
    const cStepX = (W - P * 2) / (compareData.length - 1);
    const cPts = compareData.map((d, i) => [
      P + i * cStepX,
      H - P - ((d - cmin) / cr) * (H - P * 2),
    ]);
    cmpDPath = cPts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  }

  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const ticks = 4;
  const gradId = useMemo(() => `lm-area-${Math.random().toString(36).slice(2, 8)}`, []);

  const onMove = (e) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(safe.length - 1, Math.round((x - P) / stepX)));
    setHover(i);
  };

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="lm-iddchart-svg"
        width={W}
        height={H}
        style={{ height, width: "100%" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const y = P + ((H - P * 2) / ticks) * i;
          const v = max - (range / ticks) * i;
          return (
            <g key={i}>
              <line x1={P} x2={W - P} y1={y} y2={y} stroke="var(--mt-line-0)" strokeWidth="1" />
              <text x={W - P + 4} y={y + 3} fontSize="9" fill="var(--mt-ink-3)">
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={dPath} fill="none" stroke={accent} strokeWidth="1.6" />
        {cmpDPath && (
          <path d={cmpDPath} fill="none" stroke={compareAccent} strokeWidth="1.4" strokeDasharray="3 3" />
        )}
        {hover != null && pts[hover] && (
          <>
            <line
              x1={pts[hover][0]}
              x2={pts[hover][0]}
              y1={P}
              y2={H - P}
              stroke="var(--mt-ink-2)"
              strokeWidth="1"
              strokeDasharray="2 3"
              opacity="0.6"
            />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4" fill={accent} stroke="var(--mt-surface)" strokeWidth="1.5" />
            <g transform={`translate(${Math.min(W - 110, Math.max(10, pts[hover][0] - 50))} ${Math.max(8, pts[hover][1] - 40)})`}>
              <rect width="100" height="32" rx="6" fill="var(--mt-surface)" stroke={accent} strokeWidth="1.2" />
              <text x="8" y="13" fontSize="9" fill="var(--mt-ink-2)" letterSpacing="0.06em">PT {hover + 1}</text>
              <text x="8" y="26" fontSize="12" fill="var(--mt-ink-0)" fontWeight="600">
                {safe[hover].toFixed(2)}
              </text>
            </g>
          </>
        )}
      </svg>
    </div>
  );
}
