/**
 * MacroTilt v2 — shared atoms.
 *
 * AnimatedNumber, Sparkline, FreshnessChip, Tip.
 * Ported from the design handoff (shared.jsx) into proper ES modules.
 */
import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";

/* ─── AnimatedNumber ──────────────────────────────────────────────── */
export function AnimatedNumber({
  value,
  format = (v) => v.toFixed(2),
  duration = 520,
  className = "",
  style,
  prefix = "",
  suffix = "",
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(safeValue);
  const fromRef = useRef(safeValue);
  const startRef = useRef(typeof performance !== "undefined" ? performance.now() : 0);

  useEffect(() => {
    if (!Number.isFinite(value)) return;
    fromRef.current = shown;
    startRef.current = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - startRef.current) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(fromRef.current + (value - fromRef.current) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className={`num ${className}`} style={style}>
      {prefix}{format(shown)}{suffix}
    </span>
  );
}

/* ─── Sparkline ────────────────────────────────────────────────────── */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = "currentColor",
  fill = "none",
  strokeWidth = 1.5,
  showDot = true,
  onHover,
  area = false,
  pad = 2,
}) {
  const safe = Array.isArray(data) && data.length > 0 ? data : [0, 0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(1, safe.length - 1);
  const pts = safe.map((d, i) => [
    pad + i * stepX,
    height - pad - ((d - min) / range) * (height - pad * 2),
  ]);
  const dPath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const areaPath = area
    ? `${dPath} L${pts[pts.length - 1][0].toFixed(2)} ${height - pad} L${pts[0][0].toFixed(2)} ${height - pad} Z`
    : null;

  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const onMove = (e) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * width;
    const i = Math.max(0, Math.min(safe.length - 1, Math.round((x - pad) / stepX)));
    setHoverIdx(i);
    onHover?.(i, safe[i]);
  };
  const onLeave = () => { setHoverIdx(null); onHover?.(null, null); };

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ display: "block", overflow: "visible" }}
    >
      {areaPath && <path d={areaPath} fill={fill} opacity={0.18} />}
      <path d={dPath} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {showDot && pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={stroke} />
      )}
      {hoverIdx != null && (
        <>
          <line x1={pts[hoverIdx][0]} x2={pts[hoverIdx][0]} y1={0} y2={height} stroke="currentColor" strokeWidth={1} strokeDasharray="2 3" opacity={0.35} />
          <circle cx={pts[hoverIdx][0]} cy={pts[hoverIdx][1]} r={3} fill={stroke} stroke="var(--mt-surface, #fff)" strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

/* ─── FreshnessChip ───────────────────────────────────────────────── */
export function FreshnessChip({ state = "fresh", asOf, variant = "dot", label, style }) {
  const [hover, setHover] = useState(false);
  const [tipXY, setTipXY] = useState(null);
  const ref = useRef(null);

  const color = state === "stale" ? "var(--mt-down)" : state === "checking" ? "var(--mt-ink-3)" : "var(--mt-up)";
  const word = state === "stale" ? "Stale" : state === "checking" ? "Checking" : "Fresh";
  const tip = state === "stale"
    ? `Data is stale — last updated ${asOf || "—"}.`
    : state === "checking"
    ? "Checking data freshness…"
    : `Data is fresh. Last updated ${asOf || "—"}.`;

  const onEnter = () => {
    setHover(true);
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setTipXY({ x: r.left + r.width / 2, y: r.top, below: r.top < 80 });
    }
  };
  const onLeave = () => { setHover(false); setTipXY(null); };

  const dot = (
    <span style={{
      display: "inline-block", width: 6, height: 6, borderRadius: "50%",
      background: color, flexShrink: 0, verticalAlign: "middle",
      boxShadow: hover ? `0 0 0 3px ${color}28` : "none",
      transition: "box-shadow 120ms ease-out",
    }} />
  );

  let inner;
  if (variant === "dot") inner = dot;
  else if (variant === "label")
    inner = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "var(--mt-font-ui)", color: "var(--mt-ink-2)" }}>
        {dot}<span style={{ color }}>{word}</span>{asOf && <span>· {asOf}</span>}
      </span>
    );
  else
    inner = (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 10.5, fontFamily: "var(--mt-font-ui)",
        padding: "3px 8px", borderRadius: 999,
        background: state === "stale" ? "color-mix(in oklab, var(--mt-down) 14%, transparent)" : "color-mix(in oklab, var(--mt-up) 12%, transparent)",
        color, letterSpacing: "0.04em", fontWeight: 500,
      }}>
        {dot}{label || word}{asOf && <span style={{ opacity: 0.7 }}>· {asOf}</span>}
      </span>
    );

  return (
    <span ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave} style={{ cursor: "help", display: "inline-flex", ...style }}>
      {inner}
      {hover && tipXY && typeof document !== "undefined" && ReactDOM.createPortal(
        <div role="tooltip" style={{
          position: "fixed", left: tipXY.x, top: tipXY.y + (tipXY.below ? 10 : -10),
          transform: tipXY.below ? "translate(-50%,0)" : "translate(-50%,-100%)",
          background: "var(--mt-surface, #fff)", color: "var(--mt-ink-0, #111)",
          border: "1px solid var(--mt-line-1, #ddd)", borderRadius: 8,
          padding: "8px 10px", fontSize: 11.5, lineHeight: 1.45, maxWidth: 260,
          fontFamily: "var(--mt-font-ui)", boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          pointerEvents: "none", zIndex: 100000,
        }}>{tip}</div>,
        document.body
      )}
    </span>
  );
}

/* ─── Tip ─────────────────────────────────────────────────────────── */
export function Tip({ children, content, side = "top", bare = false, block = false }) {
  const [hover, setHover] = useState(false);
  const [xy, setXY] = useState(null);
  const ref = useRef(null);

  const enter = () => {
    setHover(true);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    if (side === "right") setXY({ x: r.right + 8, y: r.top + r.height / 2, side });
    else if (side === "left") setXY({ x: r.left - 8, y: r.top + r.height / 2, side });
    else if (side === "bottom") setXY({ x: r.left + r.width / 2, y: r.bottom + 6, side });
    else setXY({ x: r.left + r.width / 2, y: r.top - 6, side: "top" });
  };
  const tr = {
    top: "translate(-50%, -100%)",
    bottom: "translate(-50%, 0)",
    right: "translate(0, -50%)",
    left: "translate(-100%, -50%)",
  };

  return (
    <>
      <span ref={ref} onMouseEnter={enter} onMouseLeave={() => setHover(false)} style={{
        display: block ? "block" : "inline-flex",
        cursor: "help",
        borderBottom: bare ? "none" : "1px dotted color-mix(in oklab, currentColor 35%, transparent)",
      }}>
        {children}
      </span>
      {hover && xy && typeof document !== "undefined" && ReactDOM.createPortal(
        <div style={{
          position: "fixed", left: xy.x, top: xy.y,
          transform: tr[xy.side] || tr.top,
          background: "var(--mt-surface, #fff)", color: "var(--mt-ink-0, #111)",
          border: "1px solid var(--mt-line-1, #ddd)", borderRadius: 8,
          padding: "8px 10px", fontSize: 12, lineHeight: 1.5, maxWidth: 280,
          fontFamily: "var(--mt-font-ui)", boxShadow: "0 12px 32px rgba(0,0,0,.18)",
          pointerEvents: "none", zIndex: 100000,
        }}>{content}</div>,
        document.body
      )}
    </>
  );
}
