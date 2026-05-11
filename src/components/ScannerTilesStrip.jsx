// ScannerTilesStrip — compact 4-tile row that sits just above the
// Trading Opps filter chip bar. Surfaces the four signal feeds (Congress,
// Insiders, Flow, Technicals) with title + count. Click a tile -> parent
// opens the matching detail tab in a Scanner modal.
//
// Compact spec: forced 4-column grid >= 1024px, 2x2 < 1024px, smaller
// padding / font scale than the legacy Scanner landing.

import { useEffect, useState } from "react";

const DATA_URL =
  "https://raw.githubusercontent.com/jmezzadri/market-dashboard/main/public/latest_scan_data.json";

// Tile metadata — accent colors match the legacy Scanner landing so
// downstream brand recognition stays intact.
const TILES = [
  { id: "congress",   eyebrow: "Congressional",     title: "Congress",   accent: "#0a84ff" },
  { id: "insiders",   eyebrow: "Form 4 Insiders",   title: "Insiders",   accent: "#bf5af2" },
  { id: "flow",       eyebrow: "Options Flow",      title: "Flow",       accent: "#ff9f0a" },
  { id: "technicals", eyebrow: "Per-ticker signal", title: "Technicals", accent: "#B8860B" },
];

// Congress amount strings are bucket ranges ("$1,001 - $15,000"); take the
// midpoint so the top trade can be ranked by approximate dollar size.

// ── Tile shell ─────────────────────────────────────────────────────────────
function TileShell({ meta, kpi, kpiUnit, kpiColor, children, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        textAlign: "left",
        padding: "10px 14px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md, 12px)",
        cursor: "pointer",
        fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)",
        boxShadow: hover ? "var(--shadow-md, 0 2px 8px rgba(0,0,0,0.06))" : "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))",
        transition: "box-shadow 0.15s",
        gap: 6,
        minWidth: 0,
      }}
    >
      {/* accent bar */}
      <span style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: meta.accent, opacity: 0.85,
        borderTopLeftRadius: "var(--r-md, 12px)", borderTopRightRadius: "var(--r-md, 12px)",
      }}/>

      {/* eyebrow row */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6, minWidth: 0 }}>
        <span style={{
          fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
          fontSize: 9.5, fontWeight: 600, letterSpacing: "0.10em",
          textTransform: "uppercase", color: "var(--text-muted)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{meta.eyebrow}</span>
      </div>

      {/* title + KPI */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <span style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 16, fontWeight: 500, color: "var(--text)", lineHeight: 1.1,
        }}>{meta.title}</span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, whiteSpace: "nowrap" }}>
          <span className="num" style={{
            fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
            fontSize: 20, fontWeight: 600, color: kpiColor || "var(--text)",
            lineHeight: 1, fontVariantNumeric: "tabular-nums",
          }}>{kpi}</span>
          {kpiUnit && (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{kpiUnit}</span>
          )}
        </span>
      </div>

    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function ScannerTilesStrip({ onTileClick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL + "?t=" + Date.now())
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (!cancelled) { setData(d); setLoading(false); }
      })
      .catch(e => {
        if (!cancelled) { setError(e.message || "fetch failed"); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, []);

  // KPI counts per tile
  const congressN = ((data?.signals?.congress_buys?.length  || 0)
                  +  (data?.signals?.congress_sells?.length || 0));
  const insiderN  = ((data?.signals?.insider_buys?.length   || 0)
                  +  (data?.signals?.insider_sales?.length  || 0));
  const flowN     = ((data?.signals?.flow_alerts?.length    || 0)
                  +  (data?.signals?.put_flow_alerts?.length|| 0));
  const techN     = Object.keys(data?.signals?.technicals  || {}).length;

  return (
    <div style={{ marginTop: 24, marginBottom: 12 }}>
      <div
        className="mt-scanner-tiles-strip"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {/* Congress */}
        <TileShell
          meta={TILES[0]}
          kpi={loading ? "—" : congressN}
          kpiUnit={loading ? "" : "trades"}
          kpiColor={congressN > 0 ? "var(--accent)" : "var(--text-muted)"}
          onClick={() => onTileClick && onTileClick("congress")}
        />

        {/* Insiders */}
        <TileShell
          meta={TILES[1]}
          kpi={loading ? "—" : insiderN}
          kpiUnit={loading ? "" : "Form 4s"}
          kpiColor={insiderN > 0 ? "#bf5af2" : "var(--text-muted)"}
          onClick={() => onTileClick && onTileClick("insiders")}
        />

        {/* Flow */}
        <TileShell
          meta={TILES[2]}
          kpi={loading ? "—" : flowN}
          kpiUnit={loading ? "" : "alerts"}
          kpiColor={flowN > 0 ? "#ff9f0a" : "var(--text-muted)"}
          onClick={() => onTileClick && onTileClick("flow")}
        />

        {/* Technicals */}
        <TileShell
          meta={TILES[3]}
          kpi={loading ? "—" : techN}
          kpiUnit={loading ? "" : "scored"}
          kpiColor={techN > 0 ? "#B8860B" : "var(--text-muted)"}
          onClick={() => onTileClick && onTileClick("technicals")}
        />
      </div>

      {/* Responsive: collapse to 2x2 below 1024px */}
      <style>{`
        @media (max-width: 1023px) {
          .mt-scanner-tiles-strip {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 540px) {
          .mt-scanner-tiles-strip {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
