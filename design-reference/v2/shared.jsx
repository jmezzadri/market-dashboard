/* MacroTilt redesign — shared primitives.
   Every direction reuses these so the design system reads consistent across
   artboards. Exported to window so each direction's babel script can pick
   them up without imports. */

const { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } = React;

/* ─── Animated number ────────────────────────────────────────────────────
   Smoothly tweens from one value to the next. The point isn't decoration —
   it's that price ticks fade through rather than snap, which makes a live
   dashboard *feel* live without ever being misleading about the current
   value (the tween is fast: ~520ms by default).                          */
function AnimatedNumber({
  value, format = (v) => v.toFixed(2), duration = 520,
  className = "", style, prefix = "", suffix = "",
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef(performance.now());
  useEffect(() => {
    fromRef.current = shown;
    startRef.current = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - startRef.current) / duration);
      const e = 1 - Math.pow(1 - k, 3);  // ease-out-cubic
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

/* ─── Sparkline ────────────────────────────────────────────────────────
   Tiny line with optional area fill + final-point dot. SVG path is built
   from data; viewBox is fixed so it scales cleanly. Hover sets a vertical
   crosshair + emits the hovered index via onHover.                       */
function Sparkline({
  data, width = 120, height = 32, stroke = "currentColor",
  fill = "none", strokeWidth = 1.5, showDot = true, onHover, area = false,
  pad = 2,
}) {
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [
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
    const i = Math.max(0, Math.min(data.length - 1, Math.round((x - pad) / stepX)));
    setHoverIdx(i);
    onHover?.(i, data[i]);
  };
  const onLeave = () => { setHoverIdx(null); onHover?.(null, null); };
  return (
    <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
         onMouseMove={onMove} onMouseLeave={onLeave}
         style={{ display: "block", overflow: "visible" }}>
      {areaPath && <path d={areaPath} fill={fill} opacity={0.18} />}
      <path d={dPath} fill="none" stroke={stroke} strokeWidth={strokeWidth}
            strokeLinecap="round" strokeLinejoin="round" />
      {showDot && pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5}
                fill={stroke} />
      )}
      {hoverIdx != null && (
        <>
          <line x1={pts[hoverIdx][0]} x2={pts[hoverIdx][0]} y1={0} y2={height}
                stroke="currentColor" strokeWidth={1} strokeDasharray="2 3" opacity={0.35} />
          <circle cx={pts[hoverIdx][0]} cy={pts[hoverIdx][1]} r={3} fill={stroke}
                  stroke="var(--surface, #fff)" strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

/* ─── Freshness chip — evolution of the existing FreshnessDot ──────────
   Same semantics (Green if SLA met / Red if stale), but with three render
   variants the user can pick from: dot, dot+label, full pill. The hover
   tooltip is instant (zero-delay portal) — same pattern as the original. */
function FreshnessChip({ state = "fresh", asOf, variant = "dot", label, style }) {
  const [hover, setHover] = useState(false);
  const [tipXY, setTipXY] = useState(null);
  const ref = useRef(null);
  const color = state === "stale" ? "var(--mt-down)" :
                state === "checking" ? "var(--mt-ink-3)" : "var(--mt-up)";
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
    <span
      style={{
        display: "inline-block", width: 6, height: 6, borderRadius: "50%",
        background: color, flexShrink: 0, verticalAlign: "middle",
        boxShadow: hover ? `0 0 0 3px ${color}28` : "none",
        transition: "box-shadow 120ms ease-out",
      }}
    />
  );

  let inner;
  if (variant === "dot") inner = dot;
  else if (variant === "label")
    inner = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 11, fontFamily: "var(--mt-font-ui)", color: "var(--mt-ink-2)" }}>
        {dot}<span style={{ color }}>{word}</span>{asOf && <span>· {asOf}</span>}
      </span>
    );
  else // pill
    inner = (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 10.5, fontFamily: "var(--mt-font-ui)",
        padding: "3px 8px", borderRadius: 999,
        background: state === "stale" ? "color-mix(in oklab, var(--mt-down) 14%, transparent)"
                                      : "color-mix(in oklab, var(--mt-up) 12%, transparent)",
        color, letterSpacing: "0.04em", fontWeight: 500,
      }}>
        {dot}{label || word}{asOf && <span style={{ opacity: 0.7 }}>· {asOf}</span>}
      </span>
    );

  return (
    <span ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave}
          style={{ cursor: "help", display: "inline-flex", ...style }}>
      {inner}
      {hover && tipXY && ReactDOM.createPortal(
        <div role="tooltip" style={{
          position: "fixed", left: tipXY.x, top: tipXY.y + (tipXY.below ? 10 : -10),
          transform: tipXY.below ? "translate(-50%,0)" : "translate(-50%,-100%)",
          background: "var(--mt-surface, #fff)", color: "var(--mt-ink-0, #111)",
          border: "1px solid var(--mt-line-1, #ddd)", borderRadius: 8,
          padding: "8px 10px", fontSize: 11.5, lineHeight: 1.45, maxWidth: 260,
          fontFamily: "var(--mt-font-ui)", boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          pointerEvents: "none", zIndex: 100000,
        }}>{tip}</div>,
        document.body,
      )}
    </span>
  );
}

/* ─── Hover tooltip primitive ──────────────────────────────────────────
   Replaces every "static label" use case. Wrap a child; show floating tip
   with rich content on hover. Portal'd to body so card overflow can't clip. */
function Tip({ children, content, side = "top", bare = false, block = false }) {
  const [hover, setHover] = useState(false);
  const [xy, setXY] = useState(null);
  const ref = useRef(null);
  const enter = () => {
    setHover(true);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    if (side === "right")        setXY({ x: r.right + 8,  y: r.top + r.height / 2, side });
    else if (side === "left")    setXY({ x: r.left  - 8,  y: r.top + r.height / 2, side });
    else if (side === "bottom")  setXY({ x: r.left + r.width / 2, y: r.bottom + 6, side });
    else                         setXY({ x: r.left + r.width / 2, y: r.top    - 6, side: "top" });
  };
  const tr = { top: "translate(-50%, -100%)", bottom: "translate(-50%, 0)", right: "translate(0, -50%)", left: "translate(-100%, -50%)" };
  return (
    <>
      <span ref={ref} onMouseEnter={enter} onMouseLeave={() => setHover(false)}
            style={{
              display: block ? "block" : "inline-flex",
              cursor: "help",
              borderBottom: bare ? "none" : "1px dotted color-mix(in oklab, currentColor 35%, transparent)",
            }}>
        {children}
      </span>
      {hover && xy && ReactDOM.createPortal(
        <div style={{
          position: "fixed", left: xy.x, top: xy.y,
          transform: tr[xy.side] || tr.top,
          background: "var(--mt-surface, #fff)", color: "var(--mt-ink-0, #111)",
          border: "1px solid var(--mt-line-1, #ddd)", borderRadius: 8,
          padding: "8px 10px", fontSize: 12, lineHeight: 1.5, maxWidth: 280,
          fontFamily: "var(--mt-font-ui)",
          boxShadow: "0 12px 32px rgba(0,0,0,.18)",
          pointerEvents: "none", zIndex: 100000,
        }}>{content}</div>,
        document.body,
      )}
    </>
  );
}

/* ─── Sample data the artboards share ──────────────────────────────────
   Mock but plausible — these mirror the indicator/regime/scanner data the
   real app pulls. Hooked to a single useTicker() so animated values move
   in concert across the artboards, giving the "live" feeling.            */
const SECTORS = [
  { code: "XLK",  name: "Technology",          weight: 28.4, tilt: +6.2,  score: 4.5 },
  { code: "XLF",  name: "Financials",          weight: 14.1, tilt: +2.1,  score: 3.8 },
  { code: "XLV",  name: "Health Care",         weight: 12.6, tilt: -1.4,  score: 2.6 },
  { code: "XLY",  name: "Consumer Discretion", weight: 10.8, tilt: +0.6,  score: 3.1 },
  { code: "XLC",  name: "Communication",       weight:  8.9, tilt: +1.8,  score: 3.4 },
  { code: "XLI",  name: "Industrials",         weight:  8.4, tilt: -0.9,  score: 2.9 },
  { code: "XLP",  name: "Consumer Staples",    weight:  6.1, tilt: -2.3,  score: 2.1 },
  { code: "XLE",  name: "Energy",              weight:  4.2, tilt: -1.2,  score: 2.5 },
  { code: "XLU",  name: "Utilities",           weight:  2.6, tilt: -0.4,  score: 2.4 },
  { code: "XLB",  name: "Materials",           weight:  2.4, tilt: -1.1,  score: 2.3 },
  { code: "XLRE", name: "Real Estate",         weight:  1.5, tilt: -3.4,  score: 1.9 },
];

const INDICATORS = [
  { id: "yc",      name: "Yield curve (10y−2y)", domain: "Rates",   value: 43,   unit: "bp", state: "calm",    pct: 63, fresh: "fresh",  asOf: "5d ago", trend: gen(40, 30, 24), delta: -10, dir: "down" },
  { id: "10yr",    name: "10y real yield",       domain: "Rates",   value: 2.18, unit: "%",  state: "extreme", pct: 93, fresh: "fresh",  asOf: "6d ago", trend: gen(40, 60, 30), delta: 0.29,dir: "up"  },
  { id: "move",   name: "MOVE · bond volatility",domain: "Rates",   value: 78,   unit: "",   state: "calm",    pct: 22, fresh: "fresh",  asOf: "5d ago", trend: gen(40, 80, 30), delta: 11,  dir: "up"  },
  { id: "tp",      name: "Term premium",         domain: "Rates",   value: 81,   unit: "bp", state: "extreme", pct: 100,fresh: "fresh",  asOf: "May 15", trend: gen(40, 50, 30, 1), delta: 16, dir: "up" },
  { id: "be10",    name: "10y breakeven",        domain: "Rates",   value: 2.40, unit: "%",  state: "calm",    pct: 50, fresh: "fresh",  asOf: "5d ago", trend: gen(40, 45, 30), delta: 0.02,dir: "up"  },
  { id: "hyig",    name: "HY−IG spread",         domain: "Credit",  value: 278,  unit: "bp", state: "calm",    pct: 31, fresh: "stale",  asOf: "May 19", trend: gen(40, 100, 25), delta: -8, dir: "down" },
  { id: "skew",    name: "SKEW Index",           domain: "Equities",value: 137,  unit: "",   state: "elevated",pct: 71, fresh: "fresh",  asOf: "4h ago", trend: gen(40, 120, 30), delta: 3,  dir: "up" },
  { id: "cape",    name: "CAPE",                 domain: "Equities",value: 42.0, unit: "x",  state: "extreme", pct: 98, fresh: "fresh",  asOf: "1d ago", trend: gen(40, 35, 20), delta: 0.4,dir: "up" },
  { id: "br",      name: "Bank reserves",        domain: "Money",   value: 3130, unit: "b",  state: "calm",    pct: 65, fresh: "fresh",  asOf: "May 20", trend: gen(40, 3000, 30), delta: 180,dir: "up" },
  { id: "ic",      name: "Initial claims",       domain: "Economy", value: 209,  unit: "k",  state: "calm",    pct: 38, fresh: "fresh",  asOf: "4d ago", trend: gen(40, 220, 25), delta: 1, dir: "up" },
  { id: "jolts",   name: "JOLTS quits",          domain: "Economy", value: 2.0,  unit: "%",  state: "extreme", pct: 9,  fresh: "fresh",  asOf: "1w ago", trend: gen(40, 2.4, 25), delta: -0.1,dir: "down" },
];

const SCANNER = [
  { ticker: "GRNT", name: "Granite Industries",   sector: "Energy",            score: 5.0, w1: 4.8, m1: 4.5, insider: ["B","C"], dark: null,      price: 5.52,  chg: +0.36, vol: "0.9M",  range: 0.42 },
  { ticker: "PAM",  name: "Pampa Energía",         sector: "Utilities",         score: 5.0, w1: 4.6, m1: 4.2, insider: ["B"],     dark: null,      price: 80.68, chg: -1.26, vol: "96.4M", range: 0.83 },
  { ticker: "PLSE", name: "Pulse Biosciences",     sector: "Healthcare",        score: 5.0, w1: 4.9, m1: 4.7, insider: ["A"],     dark: null,      price: 25.89, chg: +1.29, vol: "0.3M",  range: 0.55 },
  { ticker: "CVBF", name: "CVB Financial",         sector: "Financial Svcs",    score: 5.0, w1: 4.7, m1: 4.4, insider: ["B"],     dark: 20.31,     price: 20.35, chg: +0.15, vol: "1.5M",  range: 0.72 },
  { ticker: "ZGN",  name: "Ermenegildo Zegna",     sector: "Consumer Cyclical", score: 5.0, w1: 4.5, m1: 4.1, insider: ["A"],     dark: null,      price: 13.30, chg: -0.38, vol: "0.4M",  range: 0.31 },
  { ticker: "XRN",  name: "Xtractor Resources",    sector: "Real Estate",       score: 5.0, w1: 4.8, m1: 4.6, insider: ["A","B","C"], dark: null, price: 37.42, chg: -0.08, vol: "0.2M",  range: 0.91 },
];

function gen(n, base, range, drift = 0) {
  const out = []; let v = base;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.5) * range / 12 + drift * (i / n) * range / 30;
    out.push(v);
  }
  return out;
}

/* ─── A jittery "tick" hook used to nudge values so artboards feel alive
   without ever showing a fake number. Uses a small ±0.2% jitter on a few
   designated values — the underlying "true" value stays anchored.        */
function useTickerJitter(seed, pct = 0.0015, interval = 2200) {
  const [t, setT] = useState(seed);
  useEffect(() => {
    const id = setInterval(() => {
      setT((prev) => prev + (Math.random() - 0.5) * pct * Math.abs(seed));
    }, interval);
    return () => clearInterval(id);
  }, [seed, pct, interval]);
  return t;
}

Object.assign(window, {
  AnimatedNumber, Sparkline, FreshnessChip, Tip,
  SECTORS, INDICATORS, SCANNER, useTickerJitter,
});
