// AssetAllocation — v11 Cycle Mechanism Board (Sprint 1, iteration 2).
//
// Reads from public/methodology_calibration_v11.json. Layout follows the
// Editorial / magazine hero design (round-2 mockup A, approved 2026-04-29):
//   1. Eyebrow date + big sentence headline
//   2. Numbered 6-tile strip across the page (top-border accent in state color)
//   3. Detail block per live tile (rule + indicator rows with quartile bars)
//   4. Click any tile → tile drawer slides in from the right
//   5. Click any indicator → indicator drawer slides in with history chart
//
// 4-state lexicon: Normal / Cautionary / Stressed / Distressed.

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

// --- Reusable visual primitives -------------------------------------------

function QuartileBar({ percentile, width = 140 }) {
  const pos = Math.max(0, Math.min(100, Number(percentile) || 0));
  return (
    <div style={{ display: "inline-block", verticalAlign: "middle" }}>
      <div style={{ position: "relative", display: "flex", height: 7, width, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ flex: 1, background: "#eef0e8" }} />
        <div style={{ flex: 1, background: "#f5efde" }} />
        <div style={{ flex: 1, background: "#f5e1ce" }} />
        <div style={{ flex: 1, background: "#f0d4d4" }} />
        <div style={{
          position: "absolute", left: `calc(${pos}% - 6px)`, top: -3, width: 13, height: 13,
          borderRadius: "50%", background: "#1a1a1a", border: "2px solid #fff", boxShadow: "0 0 0 0.5px #cdc9bf",
        }} />
      </div>
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

// --- Tile strip (top of page) ---------------------------------------------

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
      <div><QuartileBar percentile={indicator.percentile} /></div>
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

// --- Indicator drawer body -------------------------------------------------

function IndicatorDrawerBody({ ind, tile }) {
  if (!ind) return null;
  const value = ind?.current?.value;
  const stateColor = STATE_COLORS[tile?.current_state] || "#1a1a1a";
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7a72", fontWeight: 600, marginBottom: 6 }}>
        {tile?.name} · indicator
      </div>
      <h2 style={{
        fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
        fontSize: 28, fontWeight: 400, margin: "0 0 6px", letterSpacing: "-0.012em",
      }}>{ind.name}</h2>
      <div style={{ fontSize: 13, color: "#7a7a72", marginBottom: 18, lineHeight: 1.55 }}>{ind.description}</div>

      {/* Big number block */}
      <div style={{
        padding: "16px 18px", background: "#fff", border: "0.5px solid #e0ddd5", borderRadius: 10, marginBottom: 22,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 8 }}>
          <span style={{
            fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
            fontSize: 44, fontWeight: 300, lineHeight: 1, letterSpacing: "-0.015em",
          }}>
            {formatVal(value, ind.unit)}
          </span>
          <span style={{ fontSize: 12, color: "#7a7a72" }}>as of {ind.current?.date || "—"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <QuartileBar percentile={ind.percentile} width={180} />
          <span style={{ fontSize: 12, color: stateColor, fontWeight: 600 }}>{ind.percentile}th percentile</span>
        </div>
        <div style={{ fontSize: 11, color: "#7a7a72" }}>
          Sample window: {ind.sample_window || "—"}
        </div>
        {ind.z_score !== undefined && ind.z_score !== null && (
          <div style={{ fontSize: 11, color: "#7a7a72", marginTop: 4 }}>
            z = {ind.z_score >= 0 ? "+" : ""}{ind.z_score.toFixed(2)} · trend over 60 trading days: {ind.trend_60d || "—"}
          </div>
        )}
      </div>

      {/* So what */}
      {ind.so_what && (
        <div style={{ marginBottom: 22, padding: "14px 16px", background: STATE_BG_TINT[tile?.current_state] || "#f6f3ec", borderRadius: 8 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7a72", fontWeight: 600, marginBottom: 4 }}>
            So what
          </div>
          <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.55 }}>{ind.so_what}</div>
        </div>
      )}

      {/* History chart */}
      {Array.isArray(ind.history) && ind.history.length > 1 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a7a72", fontWeight: 600, marginBottom: 8 }}>
            History
          </div>
          <HistoryChart history={ind.history} color={stateColor} />
        </div>
      )}

      {/* Formula + source */}
      <div style={{ borderTop: "0.5px solid #e0ddd5", paddingTop: 16, fontSize: 12, color: "#3a3a32", lineHeight: 1.6 }}>
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
        {/* Editorial hero */}
        <section style={{ paddingBottom: 24, borderBottom: "1px solid #1a1a1a", marginBottom: 28 }}>
          <div style={{
            fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "#7a7a72", marginBottom: 14, fontWeight: 600,
          }}>
            Cycle Mechanism Board · {formatDate(calib.as_of)}
          </div>
          <h1 style={{
            fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
            fontSize: 42, fontWeight: 300, lineHeight: 1.12, letterSpacing: "-0.018em",
            color: "#1a1a1a", margin: "0 0 16px", maxWidth: 940,
          }}>
            {gauge.headline_sentence}
          </h1>
          <div style={{ fontSize: 14, color: "#3a3a32", maxWidth: 760, lineHeight: 1.55 }}>
            {gauge.verdict}. Recovery Watch hidden — page activates if a fourth tile elevates
            or the S&amp;P enters a 15% drawdown. <a href="#readme" style={{ color: "#1a1a1a" }}>Full methodology</a>.
          </div>
        </section>

        {/* 6-tile strip */}
        <TileStrip tiles={tiles} onTileClick={setOpenTile} />

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
          Sprint 1 ships three of six tiles. Funding (Sprint 2), Liquidity &amp; Policy (Sprint 4),
          and Positioning &amp; Breadth (Sprint 4) render as greyed placeholders above.
          Click any tile or indicator to drill in. Calibration source: <code>{calib.build_meta?.script || "v11 build script"}</code> · framework {calib.version || "v11"}.
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
