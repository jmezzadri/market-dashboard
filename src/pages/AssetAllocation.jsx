// AssetTilt — Phase 5 React rebuild reading live v10.1c allocator output.
//
// Consumes:
//   /cycle_board_snapshot.json  — 6 mechanism scores (refreshed nightly at 22:30 UTC)
//   /v10_allocation.json        — today's recommended allocation (refreshed nightly at 22:45 UTC)
//
// Replaces the offline calibration banner. The engine has been validated
// against v9 baseline (CAGR 13.85% ≈ v9 13.88%, Sharpe 1.034 vs v9 0.610,
// max DD -20.81% vs v9 -23.64%) — see PHASE2_V10_BACKTEST.md.

import { useState, useEffect, useMemo } from "react";
import FreshnessDot from "../components/FreshnessDot";

const STANCE_COLOR = {
  "Risk On":  "#2e7d32",
  "Neutral":  "#9b9384",
  "Cautious": "#b8860b",
  "Caution":  "#b8860b",
  "Risk Off": "#b71c1c",
};
const BAND_COLOR = {
  "risk-on":  "#2e7d32",
  "neutral":  "#9b9384",
  "caution":  "#b8860b",
  "risk-off": "#b71c1c",
};
const BAND_BG = {
  "risk-on":  "rgba(46,125,50,0.10)",
  "neutral":  "rgba(155,147,132,0.10)",
  "caution":  "rgba(184,134,11,0.10)",
  "risk-off": "rgba(183,28,28,0.10)",
};
const RATING_BG = {
  "OW":  "rgba(46,125,50,0.18)",
  "MW":  "rgba(155,147,132,0.18)",
  "UW":  "rgba(183,28,28,0.18)",
};
const RATING_TEXT = {
  "OW":  "#1c6f2c",
  "MW":  "#6b6357",
  "UW":  "#7a1414",
};
const RATING_LABEL = { OW: "Overweight", MW: "Market wt", UW: "Underweight" };

function bandOf(score) {
  if (score < 25) return "risk-on";
  if (score < 50) return "neutral";
  if (score < 75) return "caution";
  return "risk-off";
}
function bandLabel(b) {
  return { "risk-on": "Risk On", "neutral": "Neutral", "caution": "Caution", "risk-off": "Risk Off" }[b];
}
function fmtUSD(n, sign = false) {
  if (n == null) return "—";
  if (Math.abs(n) < 0.01) return "$0";
  const s = sign && n > 0 ? "+" : "";
  return s + "$" + Math.abs(n).toFixed(Math.abs(n) < 10 ? 2 : 0).replace(/^/, n < 0 ? "-" : "");
}
function fmtPP(n) {
  if (n == null || Math.abs(n) < 0.05) return "flat";
  return (n > 0 ? "+" : "") + n.toFixed(1) + "pp";
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StanceBadge({ stance }) {
  const color = STANCE_COLOR[stance] || "#6b6357";
  const bg = stance === "Risk On" ? "rgba(46,125,50,0.14)" :
             stance === "Cautious" || stance === "Caution" ? "rgba(184,134,11,0.16)" :
             stance === "Risk Off" ? "rgba(183,28,28,0.16)" :
             "rgba(155,147,132,0.16)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 12px", borderRadius: 999, background: bg, color,
      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
      letterSpacing: "0.10em", textTransform: "uppercase",
      border: `0.5px solid ${color}40`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {stance}
    </span>
  );
}

function MechanismCard({ mechanism, onClick }) {
  const b = bandOf(mechanism.score);
  return (
    <div
      onClick={() => onClick(mechanism)}
      style={{
        padding: "12px 14px",
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 8,
        borderLeft: `3px solid ${BAND_COLOR[b]}`,
        cursor: "pointer",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-2, #f0e9d6)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "var(--surface)"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", letterSpacing: "0.10em", fontWeight: 600 }}>
          {mechanism.num} · {mechanism.name.toUpperCase()}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {mechanism.score}/100
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: BAND_COLOR[b], marginTop: 4 }}>
        {bandLabel(b)}
      </div>
    </div>
  );
}

function KPIBox({ label, value, sub }) {
  return (
    <div style={{
      padding: "10px 14px",
      background: "var(--surface-2, #f0e9d6)",
      borderRadius: 6,
      borderLeft: "3px solid var(--accent)",
    }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.10em", fontWeight: 600, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, marginTop: 2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectorRow({ sector, igs, onIGClick }) {
  const [open, setOpen] = useState(false);
  const sectorIGs = igs.filter(ig => ig.sector === sector.sector);
  return (
    <div style={{ borderBottom: "0.5px solid var(--border)" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 80px 80px 70px",
          gap: 12, padding: "10px 14px",
          cursor: "pointer", alignItems: "center", fontSize: 13,
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-2, #f0e9d6)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <div>
          <strong>{sector.sector}</strong>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
            via {sector.etfs.join(" · ")}
          </span>
          <span style={{
            display: "inline-block", marginLeft: 8, fontSize: 10,
            transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}>▸</span>
        </div>
        <div style={{
          height: 6, background: "var(--surface-2, #f0e9d6)", borderRadius: 3, overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${Math.min(100, sector.dollar * 3)}%`,
            background: BAND_COLOR[sector.rating === "OW" ? "risk-on" : sector.rating === "UW" ? "risk-off" : "neutral"],
          }} />
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "right" }}>
          ${sector.dollar.toFixed(2)}
        </div>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right",
          color: sector.vs_spy_pp > 0 ? "var(--green, #2e7d32)" : sector.vs_spy_pp < 0 ? "var(--red, #b71c1c)" : "var(--text-muted)",
        }}>
          {sector.vs_spy_pp > 0 ? "+" : ""}{sector.vs_spy_pp}pp
        </div>
      </div>
      {open && sectorIGs.map(ig => (
        <div key={ig.id} style={{
          display: "grid", gridTemplateColumns: "1.4fr 80px 80px 70px", gap: 12,
          padding: "8px 14px 8px 36px", fontSize: 12,
          background: "var(--surface-2, #f0e9d6)", borderTop: "0.5px dotted var(--border)",
          alignItems: "center",
        }}>
          <div>
            <strong style={{ color: "var(--text)" }}>{ig.name}</strong>
            <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 6 }}>
              · {ig.tickers.join(" · ")}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onIGClick(ig); }}
              style={{
                marginLeft: 8, fontSize: 10, padding: "2px 6px", borderRadius: 3,
                background: "transparent", border: "0.5px solid var(--border)",
                color: "var(--accent)", cursor: "pointer",
              }}
            >view →</button>
          </div>
          <div></div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>
            ${ig.dollar.toFixed(2)}
          </div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10, textAlign: "right",
            color: ig.rating === "OW" ? "var(--green, #2e7d32)" : ig.rating === "UW" ? "var(--red, #b71c1c)" : "var(--text-muted)",
          }}>
            {ig.rating}
          </div>
        </div>
      ))}
    </div>
  );
}

function MechanismModal({ mechanism, onClose }) {
  if (!mechanism) return null;
  const b = bandOf(mechanism.score);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200,
      display: "flex", justifyContent: "center", alignItems: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface)", borderRadius: 12, padding: 24,
        maxWidth: 560, width: "90%", maxHeight: "80vh", overflowY: "auto",
        border: "0.5px solid var(--border)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22 }}>
            {mechanism.num} · {mechanism.name}
          </h3>
          <button onClick={onClose} style={{
            background: "transparent", border: "0.5px solid var(--border)",
            borderRadius: 4, padding: "3px 9px", fontSize: 11, cursor: "pointer",
          }}>Close ✕</button>
        </div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "4px 10px", borderRadius: 999,
          background: BAND_BG[b], color: BAND_COLOR[b],
          fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
          textTransform: "uppercase", marginBottom: 12,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: BAND_COLOR[b] }} />
          {bandLabel(b)} · score {mechanism.score}/100
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)", marginBottom: 14 }}>
          Mechanism score derived from quartile-based scoring of underlying indicators.
          See methodology page for the input panel and threshold logic.
        </div>
        <div style={{
          padding: "10px 12px", background: "var(--surface-2, #f0e9d6)",
          borderRadius: 6, fontSize: 12, color: "var(--text-muted)",
        }}>
          Bands: 0-25 Risk On · 25-50 Neutral · 50-75 Caution · 75-100 Risk Off.
          The page-level stance aggregates all six mechanisms.
        </div>
      </div>
    </div>
  );
}

function IGModal({ ig, onClose }) {
  if (!ig) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200,
      display: "flex", justifyContent: "center", alignItems: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface)", borderRadius: 12, padding: 24,
        maxWidth: 640, width: "90%", maxHeight: "80vh", overflowY: "auto",
        border: "0.5px solid var(--border)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22 }}>{ig.name}</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              {ig.sector} · ${ig.dollar.toFixed(2)} of $100 capital
            </div>
          </div>
          <span style={{
            background: RATING_BG[ig.rating], color: RATING_TEXT[ig.rating],
            fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999,
          }}>{RATING_LABEL[ig.rating]}</span>
        </div>
        <h4 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em",
                     color: "var(--text-muted)", margin: "20px 0 8px", fontWeight: 600 }}>
          ETFs that give exposure
        </h4>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead><tr style={{ borderBottom: "0.5px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500, fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Ticker</th>
            <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500, fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Exposure type</th>
          </tr></thead>
          <tbody>
            {ig.tickers.map((t, i) => (
              <tr key={t} style={{ borderBottom: "0.5px dashed var(--border)" }}>
                <td style={{ padding: "8px", fontFamily: "var(--font-mono)" }}><strong>{t}</strong></td>
                <td style={{ padding: "8px", fontSize: 12, color: "var(--text-muted)" }}>
                  {i === 0 ? "Most liquid" : i === 1 ? "Alternate" : "Niche / leveraged"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
          Most-liquid ETFs first. Per-stock breakdown is in Trading Opportunities — click below.
        </div>
        <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
          <button onClick={() => window.location.hash = `#opportunities?ig=${ig.id}`} style={{
            background: "var(--accent)", color: "#fff", border: "none",
            padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 500,
            cursor: "pointer",
          }}>View in Trading Opportunities →</button>
        </div>
      </div>
    </div>
  );
}

function HeatmapTile({ contributionMatrix }) {
  if (!contributionMatrix) return null;
  const sectors = contributionMatrix.cols_sectors;
  const mechs = contributionMatrix.rows;
  const MECH_LABEL = {
    valuation: "Valuation", credit: "Credit", funding: "Funding",
    growth: "Growth", liquidity_policy: "Liquidity & Policy", positioning_breadth: "Positioning & Breadth",
  };
  const cellColor = (v) => {
    if (Math.abs(v) < 0.15) return { bg: "rgba(155,147,132,0.10)", color: "var(--text-muted)" };
    if (v > 0.7) return { bg: "rgba(46,125,50,0.55)", color: "#fff" };
    if (v > 0.3) return { bg: "rgba(46,125,50,0.30)", color: "var(--text)" };
    if (v > 0) return { bg: "rgba(46,125,50,0.15)", color: "var(--text)" };
    if (v < -0.7) return { bg: "rgba(183,28,28,0.55)", color: "#fff" };
    if (v < -0.3) return { bg: "rgba(183,28,28,0.30)", color: "var(--text)" };
    return { bg: "rgba(183,28,28,0.15)", color: "var(--text)" };
  };
  return (
    <div style={{
      background: "var(--surface)", border: "0.5px solid var(--border)",
      borderRadius: 12, padding: 0, overflow: "hidden",
    }}>
      <div style={{ padding: 16, fontSize: 13, lineHeight: 1.5, borderBottom: "0.5px solid var(--border)" }}>
        <strong>How to read this:</strong>
        Each cell shows how much each cycle mechanism is helping or hurting that sector right now.
        <span style={{ color: "var(--green, #2e7d32)" }}> +green</span> = tailwind ·
        <span style={{ color: "var(--red, #b71c1c)" }}> −red</span> = headwind · grey = neutral.
        Math: sector's historical sensitivity (β) × today's mechanism score normalized.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, background: "var(--surface-2, #f0e9d6)" }}>
                Cycle mechanism
              </th>
              {sectors.map(s => (
                <th key={s} style={{ padding: "8px 4px", textAlign: "center", fontWeight: 500, fontFamily: "var(--font-display)", fontSize: 11, background: "var(--surface-2, #f0e9d6)" }}>
                  {s.split(" ").slice(0, 2).join(" ").substring(0, 10)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mechs.map(m => (
              <tr key={m}>
                <td style={{ padding: "5px 12px", fontWeight: 500, fontSize: 12 }}>
                  {MECH_LABEL[m]}
                </td>
                {sectors.map(s => {
                  const v = contributionMatrix.by_sector[s]?.[m] ?? 0;
                  const { bg, color } = cellColor(v);
                  const tip = `${s} × ${MECH_LABEL[m]}: ${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
                  return (
                    <td key={s} title={tip} style={{
                      padding: "5px 4px", textAlign: "center",
                      fontFamily: "var(--font-mono)", fontSize: 11,
                      background: bg, color,
                    }}>
                      {v >= 0 ? "+" : ""}{v.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────

export default function AssetTilt({ onOpenTicker }) {
  const [cycleBoard, setCycleBoard] = useState(null);
  const [v10, setV10] = useState(null);
  const [mechModal, setMechModal] = useState(null);
  const [igModal, setIgModal] = useState(null);

  useEffect(() => {
    fetch("/cycle_board_snapshot.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null).then(setCycleBoard).catch(() => setCycleBoard(null));
    fetch("/v10_allocation.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null).then(setV10).catch(() => setV10(null));
  }, []);

  if (!v10 || !cycleBoard) {
    return (
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "60px 32px" }}>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          Loading Asset Tilt…
        </div>
      </main>
    );
  }

  const stance = v10.page_stance;
  const stanceHeadline = useMemo(() => {
    if (stance === "Risk On") return "Risk on — full equity, modest leverage where conditions warrant.";
    if (stance === "Neutral") return "Neutral — full equity, no leverage, watch for transitions.";
    if (stance === "Cautious" || stance === "Caution") return "Cautious — late-cycle positioning, defensive sleeve activating.";
    return "Risk off — defensive priority, maximum 50% defensive sleeve.";
  }, [stance]);

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 32px 48px" }}>

      {/* HERO */}
      <section style={{
        padding: "24px 28px", background: "var(--surface)",
        border: "0.5px solid var(--border)", borderRadius: 12, marginBottom: 16,
        display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start", justifyContent: "space-between",
      }}>
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>
            Asset Tilt · {v10.as_of}
          </div>
          <div style={{ marginTop: 6 }}>
            <StanceBadge stance={stance} />
          </div>
          <h1 style={{
            fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500,
            margin: "10px 0 4px", letterSpacing: "-0.015em", lineHeight: 1.25,
          }}>
            {stanceHeadline}
          </h1>
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, minmax(110px, 1fr))",
          gap: 10, minWidth: 540,
        }}>
          <KPIBox label="Equity" value={`${(v10.equity_pct * 100).toFixed(0)}%`} />
          <KPIBox label="Defensive" value={`${(v10.defensive_pct * 100).toFixed(0)}%`} />
          <KPIBox label="Leverage" value={`${v10.leverage.toFixed(2)}×`} />
          <KPIBox label="Stress" value={`${v10.stress_score}/6`} />
          <KPIBox label="Gross" value={`${(v10.gross_exposure * 100).toFixed(0)}%`} />
        </div>
      </section>

      {/* MECHANISMS */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "8px 0 12px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, margin: 0 }}>
          Cycle mechanisms — what's driving the engine
        </h2>
        <FreshnessDot indicatorId="cycle_board" asOfIso={cycleBoard.as_of} />
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 20,
      }}>
        {cycleBoard.mechanisms.map(m => (
          <MechanismCard key={m.id} mechanism={m} onClick={setMechModal} />
        ))}
      </div>

      {/* ALLOCATION */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "8px 0 12px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, margin: 0 }}>
          Recommended allocation — per $100 of capital
        </h2>
        <FreshnessDot indicatorId="v10_allocation" asOfIso={v10.as_of} />
      </div>
      <section style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        {/* Asset class summary bar */}
        <div style={{ padding: "16px 20px", borderBottom: "0.5px solid var(--border)" }}>
          <div style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", background: "var(--surface-2, #f0e9d6)" }}>
            <div style={{ width: `${v10.equity_pct * 100}%`, background: "var(--accent, #1d3557)" }} />
            <div style={{ width: `${(v10.gross_exposure - v10.equity_pct) * 100}%`, background: "#b87333" }} />
            <div style={{ width: `${v10.defensive_pct * 100}%`, background: "var(--text-muted)" }} />
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--accent, #1d3557)", borderRadius: 2, marginRight: 4 }} />Equity {(v10.equity_pct * 100).toFixed(0)}%</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#b87333", borderRadius: 2, marginRight: 4 }} />Leverage +{((v10.leverage - 1) * 100).toFixed(0)}%</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--text-muted)", borderRadius: 2, marginRight: 4 }} />Defensive {(v10.defensive_pct * 100).toFixed(0)}%</span>
          </div>
        </div>
        {/* Sector header */}
        <div style={{
          display: "grid", gridTemplateColumns: "1.4fr 80px 80px 70px",
          gap: 12, padding: "10px 14px",
          fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
          letterSpacing: "0.06em", textTransform: "uppercase",
          borderBottom: "0.5px solid var(--border)", background: "var(--surface-2, #f0e9d6)",
        }}>
          <div>Sector · click to expand industry groups</div>
          <div>Visual</div>
          <div style={{ textAlign: "right" }}>Allocation</div>
          <div style={{ textAlign: "right" }}>vs SPY</div>
        </div>
        {v10.sectors.map(s => (
          <SectorRow key={s.sector} sector={s} igs={v10.industry_groups} onIGClick={setIgModal} />
        ))}
        {/* Defensive */}
        {v10.defensive && v10.defensive.length > 0 && (
          <div style={{ padding: "12px 14px", borderTop: "0.5px solid var(--border)", background: "var(--surface-2, #f0e9d6)" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
              Defensive sleeve · {(v10.defensive_pct * 100).toFixed(0)}% of capital
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {v10.defensive.map(d => (
                <div key={d.ticker} style={{ fontSize: 12 }}>
                  <strong>{d.ticker}</strong>
                  <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{d.name}</span>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>${d.dollar.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* HEATMAP */}
      <div style={{ margin: "8px 0 12px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, margin: 0 }}>
          Which mechanisms are tailwinds vs headwinds for each sector right now?
        </h2>
      </div>
      <HeatmapTile contributionMatrix={v10.contribution_matrix} />

      {/* METHODOLOGY FOOTER */}
      <div style={{
        marginTop: 32, padding: 18, background: "var(--surface-2, #f0e9d6)",
        borderRadius: 8, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5,
      }}>
        <strong style={{ color: "var(--text)" }}>How this page works.</strong>{" "}
        The engine reads the six cycle mechanisms from Macro Overview and applies
        backtested decision rules. Hard caps: defensive ≤ 50%, leverage ≤ 1.5×,
        defensive and leverage never on at the same time. v10.1c calibration
        (2026-05-04) backtests CAGR 13.85%, Sharpe 1.034, max drawdown −20.81%
        over 2012-2026. <a href="#methodology" style={{ color: "var(--accent)" }}>Read the full methodology →</a>
      </div>

      {/* MODALS */}
      {mechModal && <MechanismModal mechanism={mechModal} onClose={() => setMechModal(null)} />}
      {igModal && <IGModal ig={igModal} onClose={() => setIgModal(null)} />}
    </main>
  );
}
