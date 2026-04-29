// MacroOverview — v11 Cycle Mechanism Board (Sprint 1, redesign 2026-04-29).
//
// Lives on the Macro Overview tab (#overview). Reads from
// public/methodology_calibration_v11.json. Page thesis (locked with Joe
// 2026-04-29): "Risk-on / Neutral / Risk-off — with the why."
//
// Layout:
//   1. Verdict hero — big Risk-on/Neutral/Risk-off pill + sub-headline.
//   2. Six dial gauges, one per cycle mechanism: composite score in ring
//      center, ring color = state, one-line so-what underneath. Greyed
//      placeholders for Sprint 2 / Sprint 4 mechanisms.
//   3. Detail block per live mechanism (rule + indicator rows).
//   4. Click any dial → mechanism drawer.
//   5. Click any indicator → round-6 indicator drawer (KPIs / chart /
//      composite contribution / episodes / co-movement / release).
//
// 4-state lexicon: Normal / Cautionary / Stressed / Distressed.
// Page-verdict bands: 0-1 elevated = Risk-on, 2 = Neutral, 3 = Risk-off
// setup forming, 4+ = High-conviction risk-off.

import React, { useEffect, useMemo, useState } from "react";

const STATE_COLORS = {
  Normal: "#4a7c4a",
  Cautionary: "#b8860b",
  Stressed: "#a04518",
  Distressed: "#7a1414",
};
const STATE_BG_TINT = {
  Normal: "rgba(74,124,74,0.05)",
  Cautionary: "rgba(184,134,11,0.05)",
  Stressed: "rgba(160,69,24,0.06)",
  Distressed: "rgba(122,20,20,0.07)",
};

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function formatVal(value, unit) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  if (unit === "bp") return `${Math.round(value)} bp`;
  if (unit === "% of GDP") return `${value.toFixed(1)}%`;
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "ratio") return `${value.toFixed(2)}×`;
  if (unit === "thousands") return `${Math.round(value).toLocaleString()}k`;
  if (typeof value === "number") return value.toFixed(2);
  return String(value);
}

// Plain-English signed change suffix (with the indicator's native unit)
function formatChange(value, unit) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  if (unit === "bp") return `${value > 0 ? "+" : ""}${Math.round(value)} bp`;
  if (unit === "% of GDP") return `${sign}${value.toFixed(1)}%`;
  if (unit === "percent") return `${sign}${value.toFixed(2)}%`;
  if (unit === "ratio") return `${sign}${value.toFixed(2)}×`;
  if (unit === "thousands") return `${sign}${Math.round(value).toLocaleString()}k`;
  if (typeof value === "number") return `${sign}${value.toFixed(2)}`;
  return String(value);
}

// Map JSON `direction` to the bar-coloring convention.
// Top-quartile-is-bad → high. Bottom-quartile-is-bad → low.
// "bidir_top" / "bidir_bottom" lock the read to whichever side is currently extreme.
function dirClass(direction) {
  if (!direction) return "high";
  if (direction === "low" || direction === "low_is_concerning" || direction === "bidir_bottom") return "low";
  return "high";
}

// --- Reusable visual primitives -------------------------------------------

function QuartileBar({ percentile, width = 140, direction = "high", sampleMin, sampleMax }) {
  const pos = Math.max(0, Math.min(100, Number(percentile) || 0));
  // Direction-aware bar coloring per round-6 design lock:
  //   high  → red on the right (CAPE, Buffett, jobless claims)
  //   low   → red on the left (ERP, ISM, BKX/SPX, CFNAI)
  //   bidir → both extremes red, mid green (HY OAS, IG OAS, HY/IG ratio)
  const d = dirClass(direction);
  const bgs = d === "low"
    ? ["#f0d4d4", "#f5e1ce", "#f5efde", "#eef0e8"]
    : ["#eef0e8", "#f5efde", "#f5e1ce", "#f0d4d4"];
  return (
    <div style={{ display: "inline-block", verticalAlign: "middle" }}>
      <div style={{ position: "relative", display: "flex", height: 7, width, borderRadius: 3, overflow: "hidden" }}>
        {bgs.map((bg, i) => <div key={i} style={{ flex: 1, background: bg }} />)}
        <div style={{
          position: "absolute", left: `calc(${pos}% - 6px)`, top: -3, width: 13, height: 13,
          borderRadius: "50%", background: "#1a1a1a", border: "2px solid #fff", boxShadow: "0 0 0 0.5px #cdc9bf",
        }} />
      </div>
      {(sampleMin !== undefined || sampleMax !== undefined) && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#7a7a72", marginTop: 3, width }}>
          <span>{sampleMin ?? ""}</span>
          <span>{sampleMax ?? ""}</span>
        </div>
      )}
    </div>
  );
}

function HistoryChart({ history, height = 160, showAxes = true, color = "#1a1a1a" }) {
  // Tiny inline SVG line chart, no library
  if (!Array.isArray(history) || history.length < 2) return null;
  const padL = showAxes ? 36 : 4, padR = 8, padT = 8, padB = showAxes ? 22 : 4;
  const w = 520, h = height;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const values = history.map((p) => Number(p[1]));
  const dates = history.map((p) => p[0]);
  const minV = Math.min(...values), maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const x = (i) => padL + (i / Math.max(1, history.length - 1)) * innerW;
  const y = (v) => padT + (1 - (v - minV) / range) * innerH;
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* horizontal gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const yy = padT + t * innerH;
        return <line key={i} x1={padL} x2={w - padR} y1={yy} y2={yy} stroke="#e0ddd5" strokeWidth="0.5" />;
      })}
      {/* axis labels */}
      {showAxes && (
        <>
          <text x={padL - 4} y={padT + 4} fontSize="9" fill="#7a7a72" textAnchor="end">{maxV.toFixed(maxV >= 100 ? 0 : 2)}</text>
          <text x={padL - 4} y={h - padB + 4} fontSize="9" fill="#7a7a72" textAnchor="end">{minV.toFixed(minV >= 100 ? 0 : 2)}</text>
          <text x={padL} y={h - 4} fontSize="9" fill="#7a7a72">{dates[0]}</text>
          <text x={w - padR} y={h - 4} fontSize="9" fill="#7a7a72" textAnchor="end">{dates[dates.length - 1]}</text>
        </>
      )}
      <path d={path} stroke={color} strokeWidth="1.4" fill="none" />
      <circle cx={x(history.length - 1)} cy={y(last)} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

// --- Verdict pill hero (Risk-on / Neutral / Risk-off) ---------------------

const VERDICT_COLORS = {
  Normal: "#4a7c4a",       // Risk-on
  Cautionary: "#b8860b",   // Neutral
  Stressed: "#a04518",     // Risk-off setup forming
  Distressed: "#7a1414",   // High-conviction risk-off
};
const VERDICT_BG = {
  Normal: "rgba(74,124,74,0.08)",
  Cautionary: "rgba(184,134,11,0.08)",
  Stressed: "rgba(160,69,24,0.08)",
  Distressed: "rgba(122,20,20,0.10)",
};

function VerdictHero({ gauge, asOf }) {
  const verdict = gauge?.verdict_label || "—";
  const verdictState = gauge?.verdict_state || "Normal";
  const sub = gauge?.subheadline || "";
  const color = VERDICT_COLORS[verdictState] || "#1a1a1a";
  return (
    <section style={{ paddingBottom: 28, borderBottom: "1px solid #1a1a1a", marginBottom: 32 }}>
      <div style={{
        fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "#7a7a72", marginBottom: 16, fontWeight: 600,
      }}>
        Macro Overview · {formatDate(asOf)}
      </div>
      <div style={{
        display: "inline-block",
        padding: "8px 22px",
        background: VERDICT_BG[verdictState] || "transparent",
        border: `1px solid ${color}`,
        borderRadius: 4,
        marginBottom: 18,
      }}>
        <span style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 38, fontWeight: 300, lineHeight: 1, letterSpacing: "-0.018em",
          color,
        }}>{verdict}</span>
      </div>
      <h1 style={{
        fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
        fontSize: 26, fontWeight: 400, lineHeight: 1.25, letterSpacing: "-0.008em",
        color: "#1a1a1a", margin: "0 0 10px", maxWidth: 880,
      }}>
        {sub}
      </h1>
      <div style={{ fontSize: 13, color: "#3a3a32", maxWidth: 760, lineHeight: 1.55 }}>
        Six cycle mechanisms describe where the market is in the cycle. Verdict bands:
        zero or one elevated reads as Risk-on; two as Neutral; three as Risk-off setup
        forming; four or more as High-conviction risk-off. We don't predict downturns —
        we describe cycle position. <a href="#readme" style={{ color: "#1a1a1a" }}>Methodology</a>.
      </div>
    </section>
  );
}

// --- Dial gauge (the new "popping" replacement for the minimalist strip) --
// 0–100 concerning-score semicircle dial. Ring color reflects the tile's
// current state (Normal / Cautionary / Stressed / Distressed). Greyed out
// for placeholder tiles (Sprint 2 / Sprint 4).

function MechanismDial({ tile, onClick }) {
  const live = tile.live;
  const state = tile.current_state;
  const score = tile.composite_score;
  const color = STATE_COLORS[state] || "#7a7a72";
  // Dial geometry — half-arc from 180deg (left) to 0deg (right).
  // Ring is built as 4 stacked colored arcs (Normal / Cautionary / Stressed /
  // Distressed band sectors). Pointer falls on the ring at the score angle.
  const W = 220, H = 130;
  const cx = W / 2, cy = H - 20;
  const R_outer = 90, R_inner = 78;
  const scoreToAngleDeg = (s) => 180 - Math.max(0, Math.min(100, s)) * 1.8; // 0→180deg, 100→0deg
  const polar = (r, deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };
  // Build ring sectors: four bands in 0..100 score-space
  const bands = [
    { from: 0, to: 25, color: "#4a7c4a" },     // Normal — green
    { from: 25, to: 50, color: "#b8860b" },    // Cautionary — amber
    { from: 50, to: 75, color: "#a04518" },    // Stressed — oxblood
    { from: 75, to: 100, color: "#7a1414" },   // Distressed — dark oxblood
  ];
  const arc = (s0, s1, r1, r2, fill) => {
    const a0 = scoreToAngleDeg(s0), a1 = scoreToAngleDeg(s1);
    const [x0o, y0o] = polar(r1, a0), [x1o, y1o] = polar(r1, a1);
    const [x1i, y1i] = polar(r2, a1), [x0i, y0i] = polar(r2, a0);
    return (
      <path
        d={`M ${x0o.toFixed(2)} ${y0o.toFixed(2)} A ${r1} ${r1} 0 0 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)} L ${x1i.toFixed(2)} ${y1i.toFixed(2)} A ${r2} ${r2} 0 0 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)} Z`}
        fill={live ? fill : "#e8e6dd"}
        opacity={live ? 0.85 : 0.6}
      />
    );
  };
  // Pointer (only for live tiles with a score)
  let pointer = null;
  if (live && score !== undefined && score !== null) {
    const a = scoreToAngleDeg(score);
    const [px, py] = polar(R_outer + 6, a);
    const [bx, by] = polar(R_inner - 4, a);
    pointer = (
      <>
        <line x1={bx.toFixed(2)} y1={by.toFixed(2)} x2={px.toFixed(2)} y2={py.toFixed(2)}
              stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={px.toFixed(2)} cy={py.toFixed(2)} r="4" fill="#1a1a1a" stroke="#fff" strokeWidth="1.5" />
      </>
    );
  }
  return (
    <button
      type="button"
      onClick={() => live && onClick && onClick(tile)}
      disabled={!live}
      style={{
        background: "transparent", border: "none", padding: 0, cursor: live ? "pointer" : "default",
        textAlign: "center", width: "100%", color: "inherit",
      }}
    >
      <div style={{
        fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
        fontSize: 11, color: "#7a7a72", letterSpacing: "0.04em",
        marginBottom: 4,
      }}>
        {String(tile.order || 0).padStart(2, "0")}
      </div>
      <div style={{
        fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
        fontSize: 16, fontWeight: 400, lineHeight: 1.2,
        color: "#1a1a1a", marginBottom: 6, fontStyle: live ? "normal" : "italic",
      }}>
        {tile.name}
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
          {bands.map((b, i) => (
            <g key={i}>{arc(b.from, b.to, R_outer, R_inner, b.color)}</g>
          ))}
          {pointer}
        </svg>
        <div style={{
          position: "absolute", left: 0, right: 0, top: 38,
          textAlign: "center", pointerEvents: "none",
        }}>
          {live && score !== undefined && score !== null ? (
            <>
              <div style={{
                fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
                fontSize: 36, fontWeight: 300, lineHeight: 1, color: "#1a1a1a",
              }}>{score}</div>
              <div style={{ fontSize: 9, color: "#7a7a72", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                / 100
              </div>
            </>
          ) : (
            <div style={{
              fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
              fontSize: 14, fontStyle: "italic", color: "#7a7a72",
            }}>
              {tile.ships_in || "—"}
            </div>
          )}
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
        color: live ? color : "#7a7a72", marginTop: -10, marginBottom: 6,
      }}>
        {live ? state : (tile.ships_in || "—")}
      </div>
      <div style={{
        fontSize: 12, color: live ? "#3a3a32" : "#9a9a92", lineHeight: 1.45,
        padding: "0 6px", minHeight: 36,
      }}>
        {tile.headline_caption || tile.description_short || ""}
      </div>
    </button>
  );
}

// --- Dial strip — six dials in a responsive grid --------------------------

function DialStrip({ tiles, onTileClick }) {
  const ordered = [...tiles].sort((a, b) => (a.order || 99) - (b.order || 99));
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
      gap: "32px 24px", marginTop: 8, marginBottom: 16,
    }}>
      {ordered.map((t) => (
        <MechanismDial key={t.id} tile={t} onClick={onTileClick} />
      ))}
    </div>
  );
}

// --- Tile strip (legacy minimalist — kept for reference, no longer used) ---

function TileStrip({ tiles, onTileClick }) {
  const ordered = [...tiles].sort((a, b) => (a.order || 99) - (b.order || 99));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14, marginTop: 30 }}>
      {ordered.map((t, i) => {
        const live = t.live;
        const state = t.current_state;
        const color = STATE_COLORS[state] || "#1a1a1a";
        const isElevated = state && state !== "Normal" && state !== "—";
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => live && onTileClick && onTileClick(t)}
            disabled={!live}
            style={{
              background: "transparent", border: "none", padding: "14px 8px 10px 0", textAlign: "left",
              borderTop: live
                ? `${isElevated ? 3 : 1.5}px solid ${color}`
                : "1px dashed #cdc9bf",
              opacity: live ? 1 : 0.45,
              cursor: live ? "pointer" : "default",
              transition: "background 120ms ease",
            }}
            onMouseEnter={(e) => { if (live) e.currentTarget.style.background = STATE_BG_TINT[state] || "transparent"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontSize: 11, color: "#7a7a72" }}>
              {String(i + 1).padStart(2, "0")}
            </div>
            <div style={{
              fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontSize: 16, fontWeight: 400,
              lineHeight: 1.2, margin: "6px 0 8px", minHeight: 36, fontStyle: live ? "normal" : "italic",
            }}>
              {t.name}
            </div>
            <div style={{ fontSize: 11, letterSpacing: "0.04em", color: live ? color : "#7a7a72", display: "flex", alignItems: "center", gap: 6 }}>
              <span>{live ? state : t.ships_in}</span>
              {live && <span style={{ fontSize: 14, color: "#7a7a72", opacity: 0.6 }}>›</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// --- Indicator row (clickable) --------------------------------------------

function IndicatorRow({ indicator, onClick }) {
  const value = indicator?.current?.value;
  return (
    <button
      type="button"
      onClick={() => onClick && onClick(indicator)}
      style={{
        display: "grid", gridTemplateColumns: "1.4fr 160px 1fr 18px",
        gap: 18, alignItems: "center", padding: "12px 6px", width: "100%", border: "none",
        background: "transparent", textAlign: "left", cursor: "pointer",
        borderBottom: "0.5px dashed var(--border, #e0ddd5)",
        transition: "background 100ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#f6f3ec"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div>
        <div style={{ fontSize: 13, color: "#1a1a1a", fontWeight: 500 }}>{indicator.name}</div>
        <div style={{ fontSize: 11, color: "#7a7a72", marginTop: 2, lineHeight: 1.45 }}>{indicator.description}</div>
      </div>
      <div><QuartileBar percentile={indicator.percentile} direction={indicator.direction} /></div>
      <div style={{ fontSize: 12, color: "#3a3a32", textAlign: "right" }}>
        <div style={{ fontWeight: 500 }}>{formatVal(value, indicator.unit)}</div>
        <div style={{ fontSize: 11, color: "#7a7a72" }}>
          {indicator.percentile}th percentile · {indicator.sample_window || ""}
        </div>
      </div>
      <div style={{ fontSize: 18, color: "#7a7a72", textAlign: "right" }}>›</div>
    </button>
  );
}

function TileDetail({ tile, onIndicatorClick, onTileClick }) {
  if (!tile.live) return null;
  const color = STATE_COLORS[tile.current_state] || "#1a1a1a";
  return (
    <section style={{ padding: "26px 0 22px", borderTop: `2px solid ${color}`, marginTop: 20 }}>
      <button
        type="button"
        onClick={() => onTileClick && onTileClick(tile)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          width: "100%", border: "none", background: "transparent", padding: 0, cursor: "pointer",
          marginBottom: 8,
        }}
      >
        <h2 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 26, fontWeight: 400, margin: 0, letterSpacing: "-0.008em", textAlign: "left",
        }}>
          {tile.name} <span style={{ fontSize: 14, color: "#7a7a72", marginLeft: 6, fontWeight: 400 }}>›</span>
        </h2>
        <div style={{ fontSize: 12, letterSpacing: "0.04em", color, fontWeight: 600 }}>{tile.current_state}</div>
      </button>
      <p style={{ fontSize: 13, color: "#7a7a72", margin: "0 0 6px", maxWidth: 720 }}>
        {tile.description_long || tile.description_short}
      </p>
      <p style={{ fontSize: 12, color: "#3a3a32", margin: "0 0 16px", fontStyle: "italic" }}>
        Rule status: {tile.rule_status}
      </p>
      <div>
        {(tile.indicators || []).map((ind) => (
          <IndicatorRow key={ind.id} indicator={ind} onClick={onIndicatorClick} />
        ))}
      </div>
    </section>
  );
}

// --- Drawer (slide-in from right) -----------------------------------------

function Drawer({ open, onClose, children, ariaLabel }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose && onClose(); }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label={ariaLabel || "Detail drawer"}
      style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(26,26,26,0.32)", animation: "drawerFade 160ms ease" }}
      />
      <aside style={{
        position: "relative", width: "min(620px, 92vw)", height: "100%",
        background: "#fafaf7", boxShadow: "-12px 0 28px rgba(0,0,0,0.10)",
        overflowY: "auto", padding: "26px 28px 60px",
        animation: "drawerSlide 200ms cubic-bezier(0.16,1,0.3,1)",
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            position: "absolute", top: 14, right: 18, fontSize: 22, lineHeight: 1,
            border: "none", background: "transparent", cursor: "pointer", color: "#7a7a72",
          }}
          aria-label="Close drawer"
        >×</button>
        {children}
      </aside>
      <style>{`
        @keyframes drawerSlide { from { transform: translateX(20px); opacity: 0.6 } to { transform: translateX(0); opacity: 1 } }
        @keyframes drawerFade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  );
}

// =============================================================================
// Round-6 indicator drawer — all panels (locked design with Joe 2026-04-29).
// Section order: hero / KPI strip / chart / composite-contribution / so-what /
// episodes / co-movement / release calendar / footer.
// =============================================================================

// --- Section eyebrow + drawer-block primitives -----------------------------

const DRAWER_EYEBROW_STYLE = {
  fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
  color: "#7a7a72", fontWeight: 600, marginBottom: 8,
};
const DRAWER_BLOCK_STYLE = {
  padding: "14px 16px", background: "#fff", border: "0.5px solid #e0ddd5",
  borderRadius: 10, marginBottom: 18,
};

function DrawerBlock({ eyebrow, children, tinted, tintColor, style }) {
  const merged = {
    ...DRAWER_BLOCK_STYLE,
    ...(tinted ? { background: tintColor || "#f6f3ec", border: "0" } : {}),
    ...(style || {}),
  };
  return (
    <div style={merged}>
      {eyebrow && <div style={DRAWER_EYEBROW_STYLE}>{eyebrow}</div>}
      {children}
    </div>
  );
}

// --- KPI strip — 4 sparkline tiles (1M / 3M / 1Y change + distance from peak)

function Sparkline({ direction }) {
  // Decorative micro-line; up = stressed-red, dn = normal-green.
  const color = direction === "up" ? "#a04518" : "#4a7c4a";
  const points = direction === "up"
    ? "0,14 12,12 24,13 36,10 48,11 60,7 72,9 84,5 100,3"
    : "0,4 12,6 24,5 36,8 48,7 60,11 72,9 84,13 100,15";
  return (
    <svg viewBox="0 0 100 18" preserveAspectRatio="none" width="100%" height="18" style={{ display: "block", marginTop: 6 }}>
      <polyline fill="none" stroke={color} strokeWidth="1.4" points={points} />
    </svg>
  );
}

function KpiStrip({ kpis, unit }) {
  if (!Array.isArray(kpis) || kpis.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
      {kpis.map((k, i) => {
        const isPeak = (k.label || "").toLowerCase().includes("peak");
        const valStr = isPeak
          ? formatChange(k.value, unit)
          : formatChange(k.value, unit);
        const sub = isPeak
          ? `peak: ${formatVal(k.peak_value, unit)} / ${k.peak_date || ""}`
          : (k.value_pct !== null && k.value_pct !== undefined
              ? `${k.value_pct > 0 ? "+" : ""}${k.value_pct}%`
              : "");
        return (
          <div key={i} style={{
            padding: "12px 12px 8px", background: "#fff",
            border: "0.5px solid #e0ddd5", borderRadius: 8,
          }}>
            <div style={{
              fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase",
              color: "#7a7a72", fontWeight: 600,
            }}>{k.label}</div>
            <div style={{
              fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
              fontSize: 18, fontWeight: 400, marginTop: 4, lineHeight: 1,
              color: k.direction === "up" ? "#a04518" : k.direction === "dn" ? "#4a7c4a" : "#1a1a1a",
            }}>{valStr}</div>
            {sub && <div style={{ fontSize: 10, color: "#7a7a72", marginTop: 2 }}>{sub}</div>}
            <Sparkline direction={k.direction} />
          </div>
        );
      })}
    </div>
  );
}

// --- IndicatorChart — range chips + mean ±1σ overlay + recession bands -------

function IndicatorChart({ history, color = "#1a1a1a", unit = "" }) {
  const [range, setRange] = useState("MAX");
  const [showSd, setShowSd] = useState(true);
  const [hover, setHover] = useState(null);
  if (!Array.isArray(history) || history.length < 2) return null;

  // Filter history by range chip (1Y / 5Y / 10Y / MAX). Months-based.
  const filtered = useMemo(() => {
    if (range === "MAX") return history;
    const [ly, lm] = (history[history.length - 1][0] || "").split("-").map(Number);
    if (!ly || !lm) return history;
    const cutoffMonths = range === "1Y" ? 12 : range === "5Y" ? 60 : 120;
    const m0 = ly * 12 + lm;
    return history.filter(([d]) => {
      const [y, mo] = d.split("-").map(Number);
      return y * 12 + mo >= m0 - cutoffMonths;
    });
  }, [history, range]);

  const pts = filtered.length >= 2 ? filtered : history;
  const W = 720, H = 220, padL = 44, padR = 18, padT = 14, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const values = pts.map((p) => Number(p[1]));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const minV = Math.min(...values, mean - 2 * sd);
  const maxV = Math.max(...values, mean + 2 * sd);
  const span = maxV - minV || 1;
  const x = (i) => padL + (i / Math.max(1, pts.length - 1)) * innerW;
  const y = (v) => padT + (1 - (v - minV) / span) * innerH;
  const path = pts.map(([, v], i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(Number(v)).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const px = ratio * W;
    if (px < padL || px > W - padR) { setHover(null); return; }
    const idx = Math.round(((px - padL) / innerW) * (pts.length - 1));
    if (idx < 0 || idx >= pts.length) { setHover(null); return; }
    setHover({ x: x(idx), y: y(Number(pts[idx][1])), date: pts[idx][0], val: pts[idx][1] });
  }

  return (
    <div style={DRAWER_BLOCK_STYLE}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ ...DRAWER_EYEBROW_STYLE, marginBottom: 0 }}>History</div>
        <div style={{ display: "flex", gap: 4 }}>
          {["1Y", "5Y", "10Y", "MAX"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              style={{
                padding: "3px 9px", fontSize: 11, letterSpacing: "0.04em",
                border: "0.5px solid #e0ddd5", borderRadius: 4, cursor: "pointer",
                background: r === range ? "#1a1a1a" : "#fff",
                color: r === range ? "#fff" : "#3a3a32",
                borderColor: r === range ? "#1a1a1a" : "#e0ddd5",
                fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
              }}
            >{r}</button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#3a3a32", cursor: "pointer", marginLeft: "auto" }}>
          <input type="checkbox" checked={showSd} onChange={(e) => setShowSd(e.target.checked)} />
          Mean ±1 SD
        </label>
      </div>
      <div style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}>
          {showSd && (
            <>
              <line x1={padL} x2={W - padR} y1={y(mean)} y2={y(mean)} stroke="#5a5a52" strokeWidth="0.8" strokeDasharray="4 3" />
              <line x1={padL} x2={W - padR} y1={y(mean + sd)} y2={y(mean + sd)} stroke="#7a7a72" strokeWidth="0.6" strokeDasharray="3 4" opacity="0.6" />
              <line x1={padL} x2={W - padR} y1={y(mean - sd)} y2={y(mean - sd)} stroke="#7a7a72" strokeWidth="0.6" strokeDasharray="3 4" opacity="0.6" />
            </>
          )}
          <path d={path} stroke={color} strokeWidth="1.5" fill="none" />
          <circle cx={x(pts.length - 1)} cy={y(Number(last[1]))} r="3.8" fill={color} stroke="#fff" strokeWidth="1.5" />
          {hover && (
            <line x1={hover.x} x2={hover.x} y1={padT} y2={H - padB} stroke="#1a1a1a" strokeWidth="0.5" strokeDasharray="2 2" />
          )}
          <text x={padL - 4} y={padT + 4} fontSize="9" fill="#7a7a72" textAnchor="end">{maxV.toFixed(maxV >= 100 ? 0 : 2)}</text>
          {showSd && <text x={padL - 4} y={y(mean) + 3} fontSize="9" fill="#5a5a52" textAnchor="end">{mean.toFixed(mean >= 100 ? 0 : 2)}</text>}
          <text x={padL - 4} y={H - padB + 4} fontSize="9" fill="#7a7a72" textAnchor="end">{minV.toFixed(minV >= 100 ? 0 : 2)}</text>
          <text x={padL} y={H - 6} fontSize="9" fill="#7a7a72">{pts[0][0]}</text>
          <text x={W - padR} y={H - 6} fontSize="9" fill="#7a7a72" textAnchor="end">{pts[pts.length - 1][0]}</text>
        </svg>
        {hover && (
          <div style={{
            position: "absolute", left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`,
            transform: "translate(-50%, calc(-100% - 6px))",
            background: "#1a1a1a", color: "#fff",
            fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10,
            padding: "3px 7px", borderRadius: 3, pointerEvents: "none", whiteSpace: "nowrap",
          }}>
            {hover.date} · {formatVal(Number(hover.val), unit)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 10, color: "#7a7a72", paddingTop: 6, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 12, height: 2, background: color }} /> Indicator
        </span>
        {showSd && (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: "2px dashed #5a5a52" }} /> Mean ±1 SD
          </span>
        )}
      </div>
    </div>
  );
}

// --- Composite contribution panel ------------------------------------------

function CompositeContributionPanel({ ind, tile }) {
  if (!tile) return null;
  const breakdown = tile.composite_breakdown || [];
  if (!breakdown.length) return null;
  const tileScore = tile.composite_score ?? null;
  const thisRow = breakdown.find((b) => b.indicator_id === ind.id);
  const thisShare = thisRow ? thisRow.share_pct : 0;
  const thisScore = thisRow ? thisRow.concerning_score : 0;
  const totalScore = breakdown.reduce((a, b) => a + (b.concerning_score || 0), 0);
  return (
    <DrawerBlock eyebrow={`Composite contribution / ${tile.name}`}>
      <div style={{ fontSize: 12, color: "#3a3a32", marginBottom: 10, lineHeight: 1.55 }}>
        {ind.name} contributes a concerning score of <strong>{thisScore}</strong> of {totalScore} total —{" "}
        <strong>{thisShare}%</strong> of the {tile.name} composite{tileScore !== null ? ` (tile reads ${tileScore}/100)` : ""}.
      </div>
      {breakdown.map((b) => {
        const isThis = b.indicator_id === ind.id;
        const scoreColor = b.concerning_score >= 75 ? "#a04518"
          : b.concerning_score >= 50 ? "#b8860b"
          : b.concerning_score >= 25 ? "#3a3a32" : "#4a7c4a";
        return (
          <div
            key={b.indicator_id}
            style={{
              display: "grid", gridTemplateColumns: "1fr 56px",
              gap: 14, alignItems: "center", padding: "8px 0",
              borderBottom: "0.5px dashed #e0ddd5",
              background: isThis ? "rgba(74,124,74,0.06)" : "transparent",
              margin: isThis ? "0 -16px" : 0,
              paddingLeft: isThis ? 16 : 0, paddingRight: isThis ? 16 : 0,
            }}
          >
            <div style={{ fontSize: 12, color: "#1a1a1a", fontWeight: isThis ? 600 : 400 }}>
              {b.name}
              {isThis && (
                <span style={{ display: "block", fontSize: 10, color: "#7a7a72", fontWeight: 400, marginTop: 2 }}>
                  {b.share_pct}% of total composite weight
                </span>
              )}
            </div>
            <div style={{
              textAlign: "right", fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
              fontSize: 18, fontWeight: 400, color: scoreColor,
            }}>{b.concerning_score}</div>
          </div>
        );
      })}
      <div style={{ fontSize: 10, color: "#7a7a72", marginTop: 10, lineHeight: 1.5 }}>
        Score-weighted: each indicator's 0–100 concerning score divided by the tile's
        sum-of-scores. 0–25 Normal · 25–50 Mild · 50–75 Cautionary · 75+ Stressed.
      </div>
    </DrawerBlock>
  );
}

// --- Episodes table --------------------------------------------------------

function EpisodesTable({ episodes, disclosure, indUnit }) {
  if (!Array.isArray(episodes) || episodes.length === 0) {
    return (
      <DrawerBlock eyebrow="Historical episodes / last entries into current quartile">
        <div style={{ fontSize: 12, color: "#7a7a72", lineHeight: 1.55 }}>
          Indicator is currently in a mid-quartile (Normal) zone — no concerning-zone
          entries to report. The episode table activates once the indicator enters the
          top or bottom quartile and stays there for at least 3 months.
        </div>
      </DrawerBlock>
    );
  }
  return (
    <DrawerBlock eyebrow="Historical episodes / last entries into current quartile">
      <div style={{ fontSize: 11, color: "#7a7a72", marginBottom: 10, fontStyle: "italic" }}>
        {disclosure}
      </div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Period", "Value", "S&P 500 next 6m", "S&P 500 next 12m"].map((h) => (
              <th key={h} style={{
                fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 400,
                fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase",
                color: "#7a7a72", textAlign: "left",
                padding: "8px 12px 6px 0", borderBottom: "0.5px solid #1a1a1a",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {episodes.map((ep, i) => {
            const cell6 = ep.spx_6m_pct == null
              ? <span style={{ color: "#7a7a72" }}>—</span>
              : <span style={{ color: ep.spx_6m_pct < 0 ? "#a04518" : "#4a7c4a" }}>
                  {ep.spx_6m_pct > 0 ? "+" : ""}{ep.spx_6m_pct}%
                </span>;
            const cell12 = ep.spx_12m_pct == null
              ? <span style={{ color: "#7a7a72" }}>—</span>
              : <span style={{ color: ep.spx_12m_pct < 0 ? "#a04518" : "#4a7c4a" }}>
                  {ep.spx_12m_pct > 0 ? "+" : ""}{ep.spx_12m_pct}%
                </span>;
            return (
              <tr key={i}>
                <td style={tdStyle()}>{ep.period}</td>
                <td style={{ ...tdStyle(), fontVariantNumeric: "tabular-nums" }}>{formatVal(ep.value, indUnit)}</td>
                <td style={{ ...tdStyle(), fontVariantNumeric: "tabular-nums" }}>{cell6}</td>
                <td style={{ ...tdStyle(), fontVariantNumeric: "tabular-nums" }}>{cell12}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DrawerBlock>
  );
}
function tdStyle() {
  return { padding: "8px 12px 8px 0", borderBottom: "0.5px dashed #e0ddd5", color: "#3a3a32", verticalAlign: "top" };
}

// --- Co-movement panel — 1y AND 5y side-by-side (Joe-locked) ----------------

function ComovementPanel({ rows, sampleWindow }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <DrawerBlock eyebrow="Co-movement / top correlated framework indicators">
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 90px 90px",
        gap: 14, padding: "6px 0 8px",
        borderBottom: "0.5px solid #1a1a1a",
        fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 400,
        fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "#7a7a72",
      }}>
        <div>Peer indicator</div>
        <div style={{ textAlign: "right" }}>1y</div>
        <div style={{ textAlign: "right" }}>5y</div>
      </div>
      {rows.map((r, i) => {
        const fmt = (c, n) => c == null ? <span style={{ color: "#7a7a72" }}>—</span>
          : <>
              <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)" }}>
                {c > 0 ? "+" : ""}{c.toFixed(2)}
              </span>
              <span style={{ display: "block", fontSize: 9, color: "#7a7a72", marginTop: 2 }}>
                n={n}
              </span>
            </>;
        return (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1fr 90px 90px",
            gap: 14, padding: "8px 0", borderBottom: "0.5px dashed #e0ddd5",
            fontSize: 12, color: "#3a3a32", alignItems: "baseline",
          }}>
            <div style={{ fontSize: 12, color: "#1a1a1a" }}>{r.peer_name}</div>
            <div style={{ textAlign: "right" }}>{fmt(r.corr_1y, r.n_1y)}</div>
            <div style={{ textAlign: "right" }}>{fmt(r.corr_5y, r.n_5y)}</div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "#7a7a72", marginTop: 10, lineHeight: 1.5 }}>
        Pearson correlation on monthly first differences.
        <strong> 1y</strong> = trailing 12 months (current-regime read).
        <strong> 5y</strong> = trailing 60 months (cycle-average read).
        Difference between the two flags whether the relationship is in the cycle's normal pattern or a new regime.
        {sampleWindow && <> Sample window: {sampleWindow}.</>}
      </div>
    </DrawerBlock>
  );
}

// --- Release calendar -------------------------------------------------------

function ReleaseCalendar({ release }) {
  if (!release) return null;
  const rows = [
    ["Frequency", release.frequency],
    ["Last release", release.last_release || "—"],
    ["Next release", release.next_release || "—"],
    ["Source", release.source],
  ].filter((r) => r[1]);
  if (rows.length === 0) return null;
  return (
    <DrawerBlock eyebrow="Release calendar">
      {rows.map((r, i) => (
        <div key={i} style={{
          display: "flex", justifyContent: "space-between",
          padding: "8px 0", borderBottom: i === rows.length - 1 ? "none" : "0.5px dashed #e0ddd5",
          fontSize: 12,
        }}>
          <span style={{
            fontSize: 11, color: "#7a7a72", letterSpacing: "0.04em",
            textTransform: "uppercase", fontWeight: 600,
          }}>{r[0]}</span>
          <span style={{ color: "#1a1a1a" }}>{r[1]}</span>
        </div>
      ))}
    </DrawerBlock>
  );
}

// --- IndicatorDrawerBody — composes all the round-6 panels -----------------

function IndicatorDrawerBody({ ind, tile }) {
  if (!ind) return null;
  const value = ind?.current?.value;
  const stateColor = STATE_COLORS[tile?.current_state] || "#1a1a1a";
  const tintBg = STATE_BG_TINT[tile?.current_state] || "#f6f3ec";
  return (
    <div>
      {/* HERO — mono identity strip / display headline / current value / as-of */}
      <div style={{ marginBottom: 18 }}>
        <div style={{
          fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
          fontSize: 10, color: "#7a7a72", letterSpacing: "0.08em",
          textTransform: "uppercase", marginBottom: 8,
        }}>
          {tile?.name} / {ind.id?.toUpperCase()} / {ind.release?.frequency || "—"}
        </div>
        <h2 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 30, fontWeight: 400, letterSpacing: "-0.012em", margin: "0 0 4px",
        }}>{ind.name}</h2>
        <div style={{ fontSize: 13, color: "#7a7a72", lineHeight: 1.55, maxWidth: 640 }}>
          {ind.description}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 14 }}>
          <span style={{
            fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
            fontSize: 38, fontWeight: 300, letterSpacing: "-0.015em", lineHeight: 1,
          }}>{formatVal(value, ind.unit)}</span>
          <span style={{ fontSize: 11, color: "#7a7a72" }}>as of {ind.current?.date || "—"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <QuartileBar percentile={ind.percentile} width={200} direction={ind.direction} />
          <span style={{ fontSize: 12, color: stateColor, fontWeight: 600 }}>
            {ind.percentile}th percentile · {ind.sample_window || ""}
          </span>
        </div>
      </div>

      {/* KPI strip */}
      <KpiStrip kpis={ind.kpis} unit={ind.unit} />

      {/* Chart */}
      <IndicatorChart history={ind.history} color={stateColor} unit={ind.unit} />

      {/* Composite contribution */}
      <CompositeContributionPanel ind={ind} tile={tile} />

      {/* So what (state-tinted) */}
      {ind.so_what && (
        <DrawerBlock eyebrow="So what" tinted tintColor={tintBg}>
          <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.55 }}>{ind.so_what}</div>
        </DrawerBlock>
      )}

      {/* Episodes */}
      <EpisodesTable
        episodes={ind.episodes}
        disclosure={ind.episodes_disclosure}
        indUnit={ind.unit}
      />

      {/* Co-movement */}
      <ComovementPanel rows={ind.comovement} sampleWindow={ind.sample_window} />

      {/* Release calendar */}
      <ReleaseCalendar release={ind.release} />

      {/* Footer — formula / source / caveat */}
      <div style={{ borderTop: "0.5px solid #e0ddd5", paddingTop: 16, fontSize: 12, color: "#3a3a32", lineHeight: 1.6, marginTop: 4 }}>
        {ind.formula && (
          <div style={{ marginBottom: 10 }}>
            <strong style={{ color: "#1a1a1a" }}>Formula.</strong> {ind.formula}
          </div>
        )}
        {ind.source && (
          <div style={{ marginBottom: 10 }}>
            <strong style={{ color: "#1a1a1a" }}>Source.</strong> {ind.source}
            {ind.source_url && (
              <> · <a href={ind.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "#1a1a1a" }}>view</a></>
            )}
          </div>
        )}
        {ind.data_caveat && (
          <div style={{ marginBottom: 10, fontStyle: "italic", color: "#7a7a72" }}>
            <strong style={{ color: "#1a1a1a", fontStyle: "normal" }}>Caveat.</strong> {ind.data_caveat}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Tile drawer body ------------------------------------------------------

function TileDrawerBody({ tile, onIndicatorClick }) {
  if (!tile) return null;
  const color = STATE_COLORS[tile.current_state] || "#1a1a1a";
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7a72", fontWeight: 600, marginBottom: 6 }}>
        Cycle mechanism
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <h2 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 30, fontWeight: 400, margin: 0, letterSpacing: "-0.012em",
        }}>{tile.name}</h2>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color }}>{tile.current_state}</span>
      </div>
      <p style={{ fontSize: 13, color: "#3a3a32", lineHeight: 1.6, margin: "0 0 14px" }}>
        {tile.description_long || tile.description_short}
      </p>

      {/* Rule */}
      {tile.rule && (
        <div style={{
          padding: "14px 16px", background: "#fff", border: "0.5px solid #e0ddd5", borderRadius: 10, marginBottom: 18,
        }}>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7a72", fontWeight: 600, marginBottom: 6 }}>
            Rule
          </div>
          <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.6 }}>
            {tile.rule.description || JSON.stringify(tile.rule)}
          </div>
          {tile.rule.sprint_1_note && (
            <div style={{ fontSize: 11, color: "#7a7a72", marginTop: 6, fontStyle: "italic" }}>{tile.rule.sprint_1_note}</div>
          )}
        </div>
      )}

      {/* Today's reading */}
      <div style={{
        padding: "14px 16px", background: STATE_BG_TINT[tile.current_state] || "#f6f3ec",
        borderRadius: 10, marginBottom: 22,
      }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7a72", fontWeight: 600, marginBottom: 6 }}>
          Today's reading
        </div>
        <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.55 }}>
          <strong>{tile.current_state}.</strong> {tile.rule_status}.
        </div>
      </div>

      {/* Indicators (clickable into deeper drawer) */}
      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7a72", fontWeight: 600, marginBottom: 8 }}>
        Indicators
      </div>
      <div>
        {(tile.indicators || []).map((ind) => (
          <IndicatorRow key={ind.id} indicator={ind} onClick={onIndicatorClick} />
        ))}
      </div>
    </div>
  );
}

// --- Main page -------------------------------------------------------------

export default function AssetAllocation() {
  const [calib, setCalib] = useState(null);
  const [error, setError] = useState(null);
  const [openTile, setOpenTile] = useState(null);
  const [openIndicator, setOpenIndicator] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/methodology_calibration_v11.json?v=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => { if (!cancelled) setCalib(data); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const tileById = useMemo(() => {
    const map = {};
    (calib?.tiles || []).forEach((t) => { map[t.id] = t; });
    return map;
  }, [calib]);

  // Determine which tile a clicked indicator belongs to
  function tileForIndicator(ind) {
    if (!ind || !calib) return null;
    return (calib.tiles || []).find((t) => (t.indicators || []).some((i) => i.id === ind.id));
  }

  if (error) {
    return (
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "var(--space-12, 48px) var(--space-8, 24px)" }}>
        <div style={{ padding: 24, border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#7a1414", marginBottom: 6 }}>Calibration data didn't load</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{error}</div>
        </div>
      </main>
    );
  }
  if (!calib) {
    return (
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "var(--space-12, 48px) var(--space-8, 24px)" }}>
        <div style={{ fontSize: 12, color: "var(--text-muted, #7a7a72)" }}>Loading…</div>
      </main>
    );
  }

  const tiles = calib.tiles || [];
  const liveTiles = tiles.filter((t) => t.live);
  const gauge = calib.headline_gauge || {};

  return (
    <>
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "var(--space-12, 48px) var(--space-8, 28px) 64px" }}>
        {/* Verdict hero — Risk-on / Neutral / Risk-off pill + sub-headline */}
        <VerdictHero gauge={gauge} asOf={calib.as_of} />

        {/* Six dial gauges — composite score in ring, ring color = state,
            one-line so-what under each. Greyed for Sprint 2 / Sprint 4. */}
        <DialStrip tiles={tiles} onTileClick={setOpenTile} />

        {/* Detail blocks per live tile */}
        <div style={{ marginTop: 36 }}>
          {liveTiles
            .sort((a, b) => (a.order || 99) - (b.order || 99))
            .map((t) => (
              <TileDetail
                key={t.id}
                tile={t}
                onIndicatorClick={setOpenIndicator}
                onTileClick={setOpenTile}
              />
            ))}
        </div>

        {/* Sprint 1 footer */}
        <div style={{
          marginTop: 48, paddingTop: 18, borderTop: "0.5px dashed var(--border)",
          fontSize: 11, color: "#7a7a72", lineHeight: 1.6,
        }}>
          Sprint 1 ships three of six cycle mechanisms. Funding (Sprint 2), Liquidity &amp; Policy (Sprint 4),
          and Positioning &amp; Breadth (Sprint 4) render as greyed dials above.
          Click any dial or indicator to drill in. Calibration source: <code>{calib.build_meta?.script || "v11 build script"}</code> · framework {calib.version || "v11"}.
        </div>
      </main>

      {/* Drawers */}
      <Drawer
        open={!!openTile}
        onClose={() => setOpenTile(null)}
        ariaLabel={openTile ? `${openTile.name} drawer` : ""}
      >
        <TileDrawerBody tile={openTile} onIndicatorClick={setOpenIndicator} />
      </Drawer>
      <Drawer
        open={!!openIndicator}
        onClose={() => setOpenIndicator(null)}
        ariaLabel={openIndicator ? `${openIndicator.name} drawer` : ""}
      >
        <IndicatorDrawerBody ind={openIndicator} tile={tileForIndicator(openIndicator)} />
      </Drawer>
    </>
  );
}
