// ScannerTilesStrip — compact 4-tile row for Trading Opps page header.
//
// Surfaces the four signal feeds that previously lived as a 2x2 tile grid on
// the standalone Scanner page (Congress · Insiders · Flow · Technicals).
// The Scanner route is still mounted (#scanner) and owns the full detail
// tables; this strip is the new entry point into those views from the top of
// Trading Opps.
//
// Tile click writes the requested detail view to sessionStorage and routes
// the user to #scanner. Scanner.jsx reads the marker on mount and jumps
// straight into the right tab. No nav re-architecture, no duplicated detail.
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

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtMoney(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// Congress amount strings are bucket ranges ("$1,001 - $15,000"); take the
// midpoint so the top trade can be ranked by approximate dollar size.
function congressAmountMidpoint(amt) {
  if (!amt || typeof amt !== "string") return 0;
  const nums = amt.match(/[\d,]+/g);
  if (!nums) return 0;
  const vals = nums.map(s => Number(s.replace(/,/g, ""))).filter(n => Number.isFinite(n) && n > 0);
  if (vals.length >= 2) return (vals[0] + vals[1]) / 2;
  return vals[0] || 0;
}

// ── Tile click → jump into the inline Scanner detail view ──────────────────
// The standalone /#scanner route was retired; Scanner.jsx now mounts inline
// at the bottom of /#portopps. Clicking a strip tile:
//   1. fires a window event Scanner.jsx listens for and uses to call setView
//      ("congress" | "insiders" | "flow" | "technicals")
//   2. smooth-scrolls the page down to the inline Scanner anchor so the
//      detail view is on screen
// A sessionStorage fallback covers the rare case where the user is not on
// /#portopps when the click happens (Scanner reads it on its next mount).
function openScannerView(viewId) {
  try {
    sessionStorage.setItem("mt:scanner:initial-view", viewId);
  } catch (_) { /* private mode etc. */ }
  // Fire the in-page event for the live Scanner instance.
  try {
    window.dispatchEvent(new CustomEvent("mt:scanner:set-view", { detail: { view: viewId } }));
  } catch (_) { /* IE-ish browsers */ }
  // Smooth-scroll to the inline Scanner anchor (added in App.jsx).
  const anchor = document.getElementById("mt-inline-scanner");
  if (anchor && typeof anchor.scrollIntoView === "function") {
    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ── Tile content (top-1 noteworthy item per surface) ───────────────────────
function topCongress(data) {
  const all = [
    ...(data?.signals?.congress_buys  || []),
    ...(data?.signals?.congress_sells || []),
  ];
  const ranked = all
    .map(r => ({ row: r, amtMid: congressAmountMidpoint(r.amounts) }))
    .filter(x => x.amtMid > 0)
    .sort((a, b) => b.amtMid - a.amtMid);
  return ranked[0] || null;
}

function topInsider(data) {
  const all = [
    ...(data?.signals?.insider_buys  || []),
    ...(data?.signals?.insider_sales || []),
  ];
  const ranked = all
    .map(r => {
      const shares = Math.abs(Number(r.amount) || 0);
      const px = Number(r.price || r.stock_price || 0);
      const usd = shares * px;
      return { row: r, usd, isBuy: (Number(r.amount) || 0) > 0 };
    })
    .filter(x => x.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  return ranked[0] || null;
}

function topFlow(data) {
  const all = [
    ...((data?.signals?.flow_alerts || []).map(r => ({ ...r, _side: "call" }))),
    ...((data?.signals?.put_flow_alerts || []).map(r => ({ ...r, _side: "put" }))),
  ];
  const ranked = all
    .map(r => ({ row: r, prem: Number(r.total_premium) || 0 }))
    .filter(x => x.prem > 0)
    .sort((a, b) => b.prem - a.prem);
  return ranked[0] || null;
}

function topTechnical(data) {
  const all = Object.entries(data?.signals?.technicals || {})
    .map(([ticker, v]) => ({
      ticker,
      score: Number(v?.composite?.score ?? 0),
      label: v?.composite?.label || "",
    }))
    .filter(x => x.score !== 0)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return all[0] || null;
}

// ── Tile renderers (the one-line preview body) ─────────────────────────────
function CongressPreview({ data }) {
  const top = topCongress(data);
  if (!top) return <span style={{ color: "var(--text-muted)" }}>No recent trades</span>;
  const isBuy = /buy/i.test(top.row.txn_type || "");
  const side = isBuy ? "BUY" : "SELL";
  const sideCol = isBuy ? "var(--green-text)" : "var(--red-text)";
  return (
    <>
      <span style={{ fontWeight: 700, color: "var(--text)" }}>{top.row.ticker}</span>
      <span style={{ color: sideCol, fontWeight: 700, marginLeft: 6 }}>{side}</span>
      <span className="num" style={{ color: "var(--text-2)", marginLeft: 6 }}>{fmtMoney(top.amtMid)}</span>
    </>
  );
}

function InsiderPreview({ data }) {
  const top = topInsider(data);
  if (!top) return <span style={{ color: "var(--text-muted)" }}>No Form 4 activity</span>;
  const side = top.isBuy ? "BUY" : "SELL";
  const sideCol = top.isBuy ? "var(--green-text)" : "var(--red-text)";
  return (
    <>
      <span style={{ fontWeight: 700, color: "var(--text)" }}>{top.row.ticker}</span>
      <span style={{ color: sideCol, fontWeight: 700, marginLeft: 6 }}>{side}</span>
      <span className="num" style={{ color: "var(--text-2)", marginLeft: 6 }}>{fmtMoney(top.usd)}</span>
    </>
  );
}

function FlowPreview({ data }) {
  const top = topFlow(data);
  if (!top) return <span style={{ color: "var(--text-muted)" }}>No unusual flow</span>;
  const isCall = top.row._side === "call";
  const sideCol = isCall ? "var(--green-text)" : "var(--red-text)";
  return (
    <>
      <span style={{ fontWeight: 700, color: "var(--text)" }}>{top.row.ticker}</span>
      <span style={{ color: sideCol, fontWeight: 700, marginLeft: 6 }}>{isCall ? "CALL" : "PUT"}</span>
      <span className="num" style={{ color: "var(--text-2)", marginLeft: 6 }}>{fmtMoney(top.prem)}</span>
    </>
  );
}

function TechnicalPreview({ data }) {
  const top = topTechnical(data);
  if (!top) return <span style={{ color: "var(--text-muted)" }}>No signal</span>;
  const isBull = top.score > 0;
  const col = isBull ? "var(--green-text)" : "var(--red-text)";
  const sign = isBull ? "+" : "";
  return (
    <>
      <span style={{ fontWeight: 700, color: "var(--text)" }}>{top.ticker}</span>
      <span className="num" style={{ color: col, fontWeight: 700, marginLeft: 6 }}>{sign}{top.score.toFixed(0)}</span>
      <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 10.5 }}>{top.label || ""}</span>
    </>
  );
}

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
        padding: "12px 14px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md, 12px)",
        cursor: "pointer",
        fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)",
        boxShadow: hover ? "var(--shadow-md, 0 2px 8px rgba(0,0,0,0.06))" : "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))",
        transition: "box-shadow 0.15s",
        gap: 8,
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

      {/* one-line preview */}
      <div style={{
        fontSize: 11.5, color: "var(--text-2)", fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
      }}>{children}</div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function ScannerTilesStrip() {
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
    <div
      style={{
        maxWidth: 1440,
        margin: "0 auto",
        padding: "16px 32px 4px",
      }}
    >
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
          onClick={() => openScannerView("congress")}
        >
          {loading ? "Loading…" : error ? "Data unavailable" : <CongressPreview data={data} />}
        </TileShell>

        {/* Insiders */}
        <TileShell
          meta={TILES[1]}
          kpi={loading ? "—" : insiderN}
          kpiUnit={loading ? "" : "Form 4s"}
          kpiColor={insiderN > 0 ? "#bf5af2" : "var(--text-muted)"}
          onClick={() => openScannerView("insiders")}
        >
          {loading ? "Loading…" : error ? "Data unavailable" : <InsiderPreview data={data} />}
        </TileShell>

        {/* Flow */}
        <TileShell
          meta={TILES[2]}
          kpi={loading ? "—" : flowN}
          kpiUnit={loading ? "" : "alerts"}
          kpiColor={flowN > 0 ? "#ff9f0a" : "var(--text-muted)"}
          onClick={() => openScannerView("flow")}
        >
          {loading ? "Loading…" : error ? "Data unavailable" : <FlowPreview data={data} />}
        </TileShell>

        {/* Technicals */}
        <TileShell
          meta={TILES[3]}
          kpi={loading ? "—" : techN}
          kpiUnit={loading ? "" : "scored"}
          kpiColor={techN > 0 ? "#B8860B" : "var(--text-muted)"}
          onClick={() => openScannerView("technicals")}
        >
          {loading ? "Loading…" : error ? "Data unavailable" : <TechnicalPreview data={data} />}
        </TileShell>
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
