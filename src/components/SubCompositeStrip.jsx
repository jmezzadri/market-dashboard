// Compact six-bar subcomposite strip — one slim tile per section
// (Technicals, Options, Insider, Congress, Analyst, Dark Pool) plus a
// weighted OVERALL chip. Mirrors the modal's CompositePill layout but
// much denser, so it fits inline on Trading Opportunities / Portfolio
// Insights cards without clicking through to the detail modal.
//
// `signals` is the same object passed to scanner/portopps cards (i.e.
// scanData.signals); we wrap it in a { signals } scanData shim so
// computeSectionComposites can consume it.
//
// Originally lived in Scanner.jsx (commit 0b5345c); extracted 2026-04-19
// so App.jsx (portopps) can render it on oppCard and position rows.
import {
  computeSectionComposites,
  colorForDirection,
  SECTION_ORDER,
} from "../ticker/sectionComposites";

const LABEL_SHORT = {
  technicals: "TECH",
  options:    "OPT",
  insider:    "INS",
  congress:   "CON",
  analyst:    "ANL",
  darkpool:   "DP",
};

export default function SubCompositeStrip({ ticker, signals }) {
  const composite = computeSectionComposites(ticker, { signals });
  if (!composite) return null;
  const overall = composite.overall || {};
  const overallCol = colorForDirection(overall.direction);

  return (
    <div style={{
      display: "flex", gap: 4, padding: "8px 10px",
      background: "var(--surface-2)", borderTop: "1px solid var(--border)",
      alignItems: "stretch",
    }}>
      {SECTION_ORDER.map(key => {
        const sec = composite.sections[key];
        const col = colorForDirection(sec.direction);
        const hasScore = sec.score != null;
        const valStr = !hasScore ? "—" : (sec.score >= 0 ? "+" : "") + sec.score;
        return (
          <div key={key} title={`${sec.name}: ${sec.label} · weight ${sec.weight}%`} style={{
            flex: "1 1 0", minWidth: 0,
            background: "var(--surface-3)",
            border: `1px solid ${hasScore && sec.score !== 0 ? col + "55" : "var(--border-faint)"}`,
            borderRadius: 4, padding: "4px 6px",
            display: "flex", flexDirection: "column", justifyContent: "center",
            lineHeight: 1.1,
          }}>
            <div style={{
              fontSize: 8, color: "var(--text-muted)",
              fontFamily: "monospace", letterSpacing: "0.06em", fontWeight: 700,
            }}>{LABEL_SHORT[key]}</div>
            <div style={{
              fontSize: 13, fontWeight: 800, fontFamily: "monospace",
              color: hasScore ? col : "var(--text-dim)", marginTop: 1,
            }}>{valStr}</div>
          </div>
        );
      })}
      {/* Overall weighted-composite chip */}
      <div title={`Weighted overall: ${overall.label || "no data"}`} style={{
        flex: "0 0 auto", minWidth: 54,
        background: overallCol + "15",
        border: `1px solid ${overall.score != null && overall.score !== 0 ? overallCol + "55" : "var(--border-faint)"}`,
        borderRadius: 4, padding: "4px 7px",
        display: "flex", flexDirection: "column", justifyContent: "center",
        lineHeight: 1.1,
      }}>
        <div style={{
          fontSize: 8, color: "var(--text-muted)",
          fontFamily: "monospace", letterSpacing: "0.06em", fontWeight: 700,
        }}>OVERALL</div>
        <div style={{
          fontSize: 13, fontWeight: 800, fontFamily: "monospace",
          color: overall.score != null ? overallCol : "var(--text-dim)", marginTop: 1,
        }}>
          {overall.score == null ? "—" : (overall.score >= 0 ? "+" : "") + overall.score}
        </div>
      </div>
    </div>
  );
}
