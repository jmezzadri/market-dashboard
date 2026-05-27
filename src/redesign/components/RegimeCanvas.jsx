/**
 * RegimeCanvas — the 2D macro map (stress × inflation regime).
 * Renders quadrant tints, axes, engine-call marker (top-left, no pulse),
 * sector overlay bubbles (optional), and indicator dots positioned via
 * positionIndicators(inds).
 */
import React from "react";
import { SECTOR_POS } from "../data/mock";

export default function RegimeCanvas({
  data,
  onHover,
  hover,
  onSelect,
  selected,
  aspect = 1.78,
  sectorOverlay = false,
  sectorData = null,
  onHoverSector,
  hoverSector,
  showIndicators = true,
}) {
  const W = 1200;
  const H = Math.round(W / aspect);
  const px = (x) => 60 + ((x + 1) / 2) * (W - 120);
  const py = (y) => H - 60 - ((y + 1) / 2) * (H - 120);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="lm-mapsvg"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="lm-q-extreme" cx="0.85" cy="0.15" r="0.6">
          <stop offset="0%" stopColor="var(--mt-down)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--mt-down)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lm-q-cool" cx="0.15" cy="0.85" r="0.6">
          <stop offset="0%" stopColor="var(--mt-up)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--mt-up)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lm-glow" cx="0.5" cy="0.5">
          <stop offset="0%" stopColor="var(--mt-accent)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--mt-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="url(#lm-q-extreme)" />
      <rect x="0" y="0" width={W} height={H} fill="url(#lm-q-cool)" />

      <line x1={W / 2} x2={W / 2} y1="30" y2={H - 30} stroke="var(--mt-line-1)" strokeDasharray="2 4" />
      <line x1="30" x2={W - 30} y1={H / 2} y2={H / 2} stroke="var(--mt-line-1)" strokeDasharray="2 4" />

      <text x={W - 12} y={H / 2 - 8} textAnchor="end" className="lm-axlbl">stress ↑</text>
      <text x="12" y={H / 2 - 8} className="lm-axlbl">← calm</text>
      <text x={W / 2 + 8} y="28" className="lm-axlbl">inflationary ↑</text>
      <text x={W / 2 + 8} y={H - 14} className="lm-axlbl">↓ deflationary</text>

      <text x={W - 24} y="40" textAnchor="end" className="lm-quadlbl lm-quadlbl--extreme">RISK OFF · INFL</text>
      <text x="24" y="40" className="lm-quadlbl">RISK ON · INFL</text>
      <text x={W - 24} y={H - 24} textAnchor="end" className="lm-quadlbl">RISK OFF · DEFL</text>
      <text x="24" y={H - 24} className="lm-quadlbl lm-quadlbl--cool">RISK ON · DEFL</text>

      {/* Engine-call marker — upper LEFT (Risk On · Inflationary) */}
      <g transform={`translate(${px(-0.55)} ${py(0.45)})`}>
        <circle r="22" fill="none" stroke="var(--mt-accent)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
        <line x1="-30" x2="30" y1="0" y2="0" stroke="var(--mt-accent)" strokeWidth="1" opacity="0.4" />
        <line x1="0" x2="0" y1="-30" y2="30" stroke="var(--mt-accent)" strokeWidth="1" opacity="0.4" />
        <circle r="5" fill="var(--mt-accent)" stroke="var(--mt-surface)" strokeWidth="2" />
        <text x="14" y="-26" className="lm-mappinlbl">Engine call</text>
        <text x="14" y="-12" className="lm-mappinlbl lm-mappinlbl--strong">Risk On · Inflationary</text>
      </g>

      {sectorOverlay && sectorData && sectorData.map((s) => {
        const pos = SECTOR_POS[s.code];
        if (!pos) return null;
        const x = px(pos.x), y = py(pos.y);
        const isOver = s.tilt > 0.1;
        const isUnder = s.tilt < -0.1;
        const isHover = hoverSector === s.code;
        const r = 6 + (s.weight / 28) * 14;
        const col = isOver ? "var(--mt-up)" : isUnder ? "var(--mt-down)" : "var(--mt-ink-3)";
        return (
          <g
            key={s.code}
            transform={`translate(${x} ${y})`}
            onMouseEnter={() => onHoverSector?.(s.code)}
            onMouseLeave={() => onHoverSector?.(null)}
            style={{ cursor: "pointer" }}
          >
            <circle r={isHover ? r + 4 : r} fill={col} opacity="0.22" />
            <circle r={isHover ? r * 0.55 : r * 0.45} fill={col} stroke="var(--mt-surface)" strokeWidth="1.5" />
            <text textAnchor="middle" y={-r - 4} className="lm-sectorlbl" style={{ fill: col }}>
              {s.code}
            </text>
            {isHover && (
              <g transform={`translate(${x > 600 ? -22 : 22} ${-r - 30})`}>
                <rect x={x > 600 ? -150 : 0} y="0" width="150" height="56" rx="8" fill="var(--mt-surface)" stroke={col} strokeWidth="1.5" />
                <text x={x > 600 ? -142 : 8} y="18" className="lm-tipname">{s.name}</text>
                <text x={x > 600 ? -142 : 8} y="34" className="lm-tipval" style={{ fontSize: 14 }}>
                  {s.tilt > 0 ? "+" : ""}{s.tilt.toFixed(1)}% tilt
                </text>
                <text x={x > 600 ? -142 : 8} y="48" className="lm-tippct">{s.weight.toFixed(1)}% of S&amp;P</text>
              </g>
            )}
          </g>
        );
      })}

      {showIndicators && data.map((d) => {
        const x = px(d.x), y = py(d.y);
        const isHover = hover?.id === d.id;
        const isSelected = selected?.id === d.id;
        const col = d.state === "extreme" ? "var(--mt-down)" : d.state === "elevated" ? "var(--mt-warn)" : "var(--mt-up)";
        return (
          <g
            key={d.id}
            className="lm-mapdot"
            transform={`translate(${x} ${y})`}
            onMouseEnter={() => onHover(d)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect?.(isSelected ? null : d)}
            style={{ cursor: "pointer" }}
          >
            {isSelected && <circle r={18} fill="none" stroke={col} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />}
            <circle r={isHover || isSelected ? 12 : 8} fill={col} opacity={isSelected ? 0.28 : 0.18} />
            <circle r={isHover || isSelected ? 6 : 4} fill={col} stroke="var(--mt-surface)" strokeWidth="1.5" style={{ transition: "r 200ms" }} />
            {isHover && (
              <g>
                <line x1="0" y1="0" x2={x > W / 2 ? -18 : 18} y2={-22} stroke={col} strokeWidth="1" />
                <g transform={`translate(${x > W / 2 ? -22 : 22} ${-72})`}>
                  <rect x={x > W / 2 ? -160 : 0} y="0" width="160" height="60" rx="8" fill="var(--mt-surface)" stroke={col} strokeWidth="1.5" />
                  <text x={x > W / 2 ? -150 : 10} y="18" className="lm-tipname">{d.name}</text>
                  <text x={x > W / 2 ? -150 : 10} y="36" className="lm-tipval">
                    {d.value.toFixed(d.value > 100 ? 0 : 2)}{d.unit}
                  </text>
                  <text x={x > W / 2 ? -150 : 10} y="50" className="lm-tippct">{d.pct}ᵗʰ pctile · {d.state}</text>
                </g>
              </g>
            )}
          </g>
        );
      })}
      <text x="50" y="20" className="lm-mapttl">macro position · stress × yield regime · 5y normalized</text>
    </svg>
  );
}
