// Sortable watchlist table — replaces the card-stack render on the portopps
// tab's OTHER WATCHLIST sub-panel so you can sort by any composite column.
//
// Columns: Ticker, Name, Sector, TECH, OPT, INS, CON, ANL, DP, OVR.
// Short codes kept in the header row (keeps the table narrow), with a
// native title-attribute tooltip defining each one on hover. Numeric
// cells carry numeric sort values so clicking a column header sorts by
// actual score instead of text-sort (which would put +9 after +10).
//
// Row click bubbles ticker up via onOpenTicker (opens TickerDetailModal).
import { useMemo, useState } from "react";
import {
  computeSectionComposites,
  colorForDirection,
  SECTION_ORDER,
} from "../ticker/sectionComposites";
import { normalizeTickerName } from "../lib/nameFormat";
import ProvenanceStamp from "./ProvenanceStamp";

// Header metadata — label shown in the header cell, tooltip spells it out.
// Order here is the render order of the signal columns — sorted LEFT TO
// RIGHT by composite weighting (most important first, least important last):
// Technicals 25% · Insider 25% · Options 20% · Congress 15% · Analyst 10% ·
// Dark Pool 5% (see SECTION_WEIGHTS in ticker/sectionComposites.js). OVR is
// rendered separately as the rightmost column.
const SIGNAL_COLS = [
  { key: "technicals", short: "TECH", long: "Technicals (25%)" },
  { key: "insider",    short: "INS",  long: "Insiders (25%)" },
  { key: "options",    short: "OPT",  long: "Option Flow (20%)" },
  { key: "congress",   short: "CON",  long: "Congress (15%)" },
  { key: "analyst",    short: "ANL",  long: "Analyst (10%)" },
  { key: "darkpool",   short: "DP",   long: "Dark Pool (5%)" },
];

// Sanity: SIGNAL_COLS must align 1:1 with SECTION_ORDER so computeSectionComposites
// output stays in sync if either list changes.
if (SIGNAL_COLS.length !== SECTION_ORDER.length) {
  // eslint-disable-next-line no-console
  console.warn("WatchlistTable: SIGNAL_COLS out of sync with SECTION_ORDER");
}

function SortArrow({ dir }) {
  if (!dir) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4, color: "var(--text)" }}>{dir === "asc" ? "▲" : "▼"}</span>;
}

function ScoreCell({ score, direction }) {
  const col = score == null ? "var(--text-dim)" : colorForDirection(direction);
  const display = score == null ? "—" : (score >= 0 ? "+" : "") + score;
  return (
    <span style={{
      color: col,
      fontFamily: "var(--font-mono)",
      fontWeight: 700,
      fontSize: 12,
    }}>{display}</span>
  );
}

export default function WatchlistTable({ rows, signals, screener, onOpenTicker, heldTickers, emptyMessage, provenance }) {
  // Each row: { ticker, name, theme }. We enrich with composites + sector
  // here so sorting has all the data pre-computed (avoids recomputing on
  // every sort click).
  const enriched = useMemo(() => {
    return (rows || []).map(w => {
      const t = (w.ticker || "").toUpperCase();
      const sc = (screener || {})[t] || {};
      const composite = computeSectionComposites(t, { signals }) || {
        sections: {}, overall: { score: null, direction: null },
      };
      const sectionScores = {};
      SIGNAL_COLS.forEach(c => {
        const s = composite.sections?.[c.key];
        sectionScores[c.key] = {
          score: s?.score ?? null,
          direction: s?.direction ?? null,
        };
      });
      // Name fallback: when a ticker is added while the Yahoo validator is
      // unreachable (CORS / rate-limit), w.name is backfilled with the ticker
      // symbol itself. Once scan-ticker populates screener data, prefer the
      // real full_name from UW over the ticker-as-name placeholder.
      const hasRealName = w.name && w.name.trim().toUpperCase() !== t;
      const rawName = hasRealName ? w.name : (sc.full_name || "");
      return {
        ticker: t,
        // normalizeTickerName only touches ALL-CAPS strings (UW feed); Yahoo-sourced
        // names like "NVIDIA Corp" / "CrowdStrike" pass through untouched. See
        // lib/nameFormat.js for the full rationale on why we need this.
        name: normalizeTickerName(rawName),
        sector: sc.sector || "",
        theme: w.theme || "",
        held: heldTickers?.has?.(t) || false,
        sections: sectionScores,
        overall: {
          score: composite.overall?.score ?? null,
          direction: composite.overall?.direction ?? null,
        },
      };
    });
  }, [rows, signals, screener, heldTickers]);

  // Sort state: colKey is one of "ticker" | "name" | "sector" |
  // "technicals" | "options" | "insider" | "congress" | "analyst" |
  // "darkpool" | "overall". Default sort: OVR desc (most bullish first).
  const [sortCol, setSortCol] = useState("overall");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (col) => {
    if (col === sortCol) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      // Numeric columns default to desc (most bullish at top); text to asc.
      const isNum = col === "overall" || SIGNAL_COLS.some(c => c.key === col);
      setSortDir(isNum ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...enriched];
    const getVal = (row) => {
      if (sortCol === "ticker") return row.ticker;
      if (sortCol === "name") return (row.name || "").toLowerCase();
      if (sortCol === "sector") return (row.sector || "").toLowerCase();
      if (sortCol === "overall") return row.overall.score;
      return row.sections[sortCol]?.score;
    };
    arr.sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      // Push null/undefined to the bottom regardless of asc/desc so
      // unscored rows don't dominate the top of a "most bullish" sort.
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [enriched, sortCol, sortDir]);

  if (!enriched.length) {
    return (
      <div style={{
        padding: "10px 12px", fontSize: 12, color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
      }}>
        {emptyMessage || "No tickers on your watchlist. Add one below."}
      </div>
    );
  }

  const headerStyle = {
    fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
    fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
    padding: "6px 6px", textAlign: "left",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-3)", position: "sticky", top: 0,
    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };
  const headerStyleNum = { ...headerStyle, textAlign: "center" };

  const renderHeader = (colKey, label, tooltip, numeric = false) => (
    <th
      style={numeric ? headerStyleNum : headerStyle}
      title={tooltip}
      onClick={() => toggleSort(colKey)}
    >
      {label}
      <SortArrow dir={sortCol === colKey ? sortDir : null} />
    </th>
  );

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 0 }}>
        <thead>
          <tr>
            {renderHeader("ticker", "TICKER", "Ticker symbol")}
            {renderHeader("name", "NAME", "Company name")}
            {renderHeader("sector", "SECTOR", "Sector (industry not available on all tickers)")}
            {SIGNAL_COLS.map(c => renderHeader(c.key, c.short, c.long, true))}
            {renderHeader("overall", "OVR", "Overall weighted composite (−100 bearish to +100 bullish)", true)}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr
              key={row.ticker}
              onClick={() => onOpenTicker?.(row.ticker)}
              style={{
                cursor: "pointer",
                borderBottom: "1px solid var(--border-faint)",
                background: "var(--surface-2)",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--surface-3)"}
              onMouseLeave={e => e.currentTarget.style.background = "var(--surface-2)"}
            >
              <td style={{ padding: "7px 6px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>
                <span>{row.ticker}</span>
                {row.held && (
                  <span style={{
                    marginLeft: 6, fontSize: 9, color: "var(--accent)",
                    border: "1px solid var(--accent)", borderRadius: 3,
                    padding: "1px 4px", fontFamily: "var(--font-mono)",
                    fontWeight: 700, verticalAlign: "middle",
                  }}>OWNED</span>
                )}
              </td>
              <td style={{
                padding: "7px 6px", color: "var(--text-muted)",
                maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }} title={row.name}>{row.name || "—"}</td>
              <td style={{
                padding: "7px 6px", color: "var(--text-dim)",
                fontFamily: "var(--font-mono)", fontSize: 11,
                whiteSpace: "nowrap",
              }}>{row.sector || "—"}</td>
              {SIGNAL_COLS.map(c => {
                const s = row.sections[c.key] || {};
                return (
                  <td key={c.key} style={{ padding: "7px 6px", textAlign: "center" }}>
                    <ScoreCell score={s.score} direction={s.direction} />
                  </td>
                );
              })}
              <td style={{ padding: "7px 6px", textAlign: "center" }}>
                <ScoreCell score={row.overall.score} direction={row.overall.direction} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {provenance && (provenance.source || provenance.asOf) && (
        <ProvenanceStamp
          source={provenance.source}
          asOf={provenance.asOf}
          prefix={provenance.prefix}
          align="right"
          style={{ padding: "6px 10px", borderTop: "1px solid var(--border-faint)", background: "var(--surface-3)" }}
        />
      )}
    </div>
  );
}
