// WatchlistTable — composite-score watchlist grid, user-customizable columns.
//
// Item 36 retrofit: adds "Edit columns" picker + drag-reorder. Default
// visible columns stay the same as before (ticker, name, sector, TECH, INS,
// OPT, CON, ANL, DP, OVR) so existing users' views don't change on upgrade.
// Additional columns (PRICE, MARKET CAP, NEXT EARNINGS, PNL DAY %, IV RANK,
// DIV YIELD, TAGS, COMPOSITE SIZE, etc.) are available via the picker.
//
// Props
// -----
//   rows          : Array<{ ticker, name, theme }>  from caller
//   signals       : scanData.signals (public + merged private)
//   screener      : { TICKER: { close, prev_close, marketcap, ... } }
//   info          : { TICKER: { dividend_yield, has_dividend, tags, ... } }
//   onOpenTicker  : fn(ticker)
//   heldTickers   : Set<string>  — for the OWNED pill on ticker cell
//   emptyMessage  : string
//   tableKey      : "watchlist_buy" | "watchlist_near" | "watchlist_other"
//                   keyed independently in user_preferences so each instance
//                   can have its own layout (buy-alerts users will often want
//                   a different view than the full watchlist)

import { useMemo, useState } from "react";
import { Tip } from "../InfoTip";
import {
  computeSectionComposites,
  colorForDirection,
  SECTION_ORDER,
} from "../ticker/sectionComposites";
import { normalizeTickerName } from "../lib/nameFormat";
import TableColumnPicker from "./TableColumnPicker";
import { useTablePreferences } from "../hooks/useTablePreferences";

const SIGNAL_COLS = [
  { key: "technicals", short: "TECH", long: "Technicals (25%)" },
  { key: "insider",    short: "INS",  long: "Insiders (25%)" },
  { key: "options",    short: "OPT",  long: "Option Flow (20%)" },
  { key: "congress",   short: "CON",  long: "Congress (15%)" },
  { key: "analyst",    short: "ANL",  long: "Analyst (10%)" },
  { key: "darkpool",   short: "DP",   long: "Dark Pool (5%)" },
];

if (SIGNAL_COLS.length !== SECTION_ORDER.length) {
  // eslint-disable-next-line no-console
  console.warn("WatchlistTable: SIGNAL_COLS out of sync with SECTION_ORDER");
}

// ─── formatters (abbreviated — full set lives in PositionsTable) ─────────────
const fmt$ = (v) =>
  v == null || !isFinite(v) ? "—" :
  `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPctSigned = (v) =>
  v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`;

const fmtMcap = (v) => {
  if (v == null) return "—";
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
};

const fmtDate = (v) => {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
};

function SortArrow({ dir }) {
  if (!dir) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4, color: "var(--text)" }}>{dir === "asc" ? "▲" : "▼"}</span>;
}

function ScoreCell({ score, direction }) {
  const col = score == null ? "var(--text-dim)" : colorForDirection(direction);
  const display = score == null ? "—" : (score >= 0 ? "+" : "") + score;
  return (
    <span style={{ color: col, fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12 }}>
      {display}
    </span>
  );
}

// ─── Column registry ─────────────────────────────────────────────────────────
const baseCols = [
  {
    id: "ticker", label: "TICKER", description: "Ticker symbol (OWNED badge if in your positions)",
    align: "left",
    sortValue: (r) => r.ticker,
    renderCell: (r) => (
      <>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>
          {r.ticker}
        </span>
        {r.held && (
          <span style={{
            marginLeft: 6, fontSize: 9, color: "var(--accent)",
            border: "1px solid var(--accent)", borderRadius: 3,
            padding: "1px 4px", fontFamily: "var(--font-mono)", fontWeight: 700,
          }}>OWNED</span>
        )}
      </>
    ),
  },
  {
    id: "name", label: "NAME", description: "Company name", align: "left",
    sortValue: (r) => (r.name || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{
        color: "var(--text-muted)", maxWidth: 240, display: "inline-block",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        verticalAlign: "bottom",
      }} title={r.name}>{r.name || "—"}</span>
    ),
  },
  {
    id: "sector", label: "SECTOR", description: "Sector (industry not always available)",
    align: "left",
    sortValue: (r) => (r.sector || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
        {r.sector || "—"}
      </span>
    ),
  },
  {
    id: "price", label: "PRICE", description: "Current price per share (from scanner's screener feed)",
    align: "right",
    sortValue: (r) => r.price,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{fmt$(r.price)}</span>
    ),
  },
  {
    id: "dayChangePct", label: "DAY %", description: "Today's percent change",
    align: "right",
    sortValue: (r) => r.dayChangePct,
    renderCell: (r) => {
      const c = r.dayChangePct == null ? "var(--text-muted)" : r.dayChangePct >= 0 ? "#30d158" : "#ff453a";
      return (
        <span style={{ fontFamily: "var(--font-mono)", color: c, fontWeight: 600 }}>
          {fmtPctSigned(r.dayChangePct)}
        </span>
      );
    },
  },
  {
    id: "marketcap", label: "MARKET CAP", description: "Company market capitalization",
    align: "right",
    sortValue: (r) => r.marketcap,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{fmtMcap(r.marketcap)}</span>
    ),
  },
  {
    id: "ivRank", label: "IV RANK", description: "Implied volatility rank (0–100, higher = more option premium)",
    align: "right",
    sortValue: (r) => r.ivRank,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {r.ivRank == null ? "—" : Number(r.ivRank).toFixed(1)}
      </span>
    ),
  },
  {
    id: "divYield", label: "DIV YIELD",
    description: "Dividend yield where available; 'Y'/'N' if only has-dividend flag is known.",
    align: "right",
    sortValue: (r) => r.divYield != null ? r.divYield : (r.hasDividend ? 0.001 : null),
    renderCell: (r) => {
      if (r.divYield != null && isFinite(r.divYield)) {
        const pct = r.divYield * (r.divYield < 1 ? 100 : 1);
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{pct.toFixed(2)}%</span>;
      }
      if (r.hasDividend === true)  return <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Y</span>;
      if (r.hasDividend === false) return <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>N</span>;
      return <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>—</span>;
    },
  },
  {
    id: "nextEarnings", label: "NEXT EARNINGS", description: "Next expected earnings date",
    align: "right",
    sortValue: (r) => r.nextEarnings ? new Date(r.nextEarnings).getTime() : null,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
        {fmtDate(r.nextEarnings)}
      </span>
    ),
  },
  {
    id: "week52", label: "52W RANGE", description: "52-week low / high",
    align: "right",
    sortValue: (r) => r.weekHigh,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
        {r.weekLow != null && r.weekHigh != null ? `${fmt$(r.weekLow)} – ${fmt$(r.weekHigh)}` : "—"}
      </span>
    ),
  },
  {
    id: "theme", label: "THEME", description: "Your watchlist note for this ticker",
    align: "left",
    sortValue: (r) => (r.theme || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{
        color: "var(--text-dim)", fontSize: 11, maxWidth: 220, display: "inline-block",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom",
      }} title={r.theme}>{r.theme || "—"}</span>
    ),
  },
];

const signalCols = SIGNAL_COLS.map((c) => ({
  id: c.key,
  label: c.short,
  description: c.long,
  align: "center",
  sortValue: (r) => r.sections[c.key]?.score,
  renderCell: (r) => {
    const s = r.sections[c.key] || {};
    return <ScoreCell score={s.score} direction={s.direction} />;
  },
}));

const overallCol = {
  id: "overall",
  label: "OVR",
  description: "Overall weighted composite (−100 bearish → +100 bullish)",
  align: "center",
  sortValue: (r) => r.overall.score,
  renderCell: (r) => <ScoreCell score={r.overall.score} direction={r.overall.direction} />,
};

const COLUMNS = [...baseCols, ...signalCols, overallCol];

// Defaults preserve the pre-36 layout: ticker, name, sector, 6 signal cols, OVR.
const DEFAULT_ORDER = [
  "ticker", "name", "sector",
  ...SIGNAL_COLS.map((c) => c.key),
  "overall",
  // Remaining columns are appended so the picker shows them in a predictable
  // order, but they start hidden.
  "price", "dayChangePct", "marketcap", "ivRank", "divYield",
  "nextEarnings", "week52", "theme",
];
const DEFAULT_VISIBLE = [
  "ticker", "name", "sector",
  ...SIGNAL_COLS.map((c) => c.key),
  "overall",
];

// Default column widths (px).
const DEFAULT_WIDTHS = {
  ticker:        90,
  name:          220,
  sector:        120,
  price:         100,
  dayChangePct:  90,
  marketcap:     100,
  ivRank:        85,
  divYield:      95,
  nextEarnings:  125,
  week52:        150,
  theme:         220,
  technicals:    70,
  insider:       70,
  options:       70,
  congress:      70,
  analyst:       70,
  darkpool:      70,
  overall:       80,
};

export default function WatchlistTable({
  rows, signals, screener, info,
  onOpenTicker, heldTickers, emptyMessage,
  tableKey = "watchlist_other",
}) {
  const screenerMap = screener || {};
  const infoMap     = info     || {};

  const { prefs, setOrder, setVisible, setWidths, resetToDefaults } = useTablePreferences(tableKey, {
    defaultOrder:   DEFAULT_ORDER,
    defaultVisible: DEFAULT_VISIBLE,
    defaultWidths:  DEFAULT_WIDTHS,
  });

  const enriched = useMemo(() => {
    return (rows || []).map((w) => {
      const t = (w.ticker || "").toUpperCase();
      const sc = screenerMap[t] || {};
      const inf = infoMap[t] || {};

      const composite = computeSectionComposites(t, { signals }) || {
        sections: {}, overall: { score: null, direction: null },
      };
      const sectionScores = {};
      SIGNAL_COLS.forEach(c => {
        const s = composite.sections?.[c.key];
        sectionScores[c.key] = { score: s?.score ?? null, direction: s?.direction ?? null };
      });

      const hasRealName = w.name && w.name.trim().toUpperCase() !== t;
      const rawName = hasRealName ? w.name : (sc.full_name || inf.full_name || "");

      const price    = sc.close != null ? Number(sc.close) : (sc.prev_close != null ? Number(sc.prev_close) : null);
      const prev     = sc.prev_close != null ? Number(sc.prev_close) : null;
      const dayChangePct = (price != null && prev) ? (price / prev - 1) * 100 : null;

      return {
        ticker: t,
        name: normalizeTickerName(rawName),
        sector: sc.sector || inf.sector || "",
        theme: w.theme || "",
        held: heldTickers?.has?.(t) || false,
        sections: sectionScores,
        overall: {
          score: composite.overall?.score ?? null,
          direction: composite.overall?.direction ?? null,
        },
        price,
        dayChangePct,
        marketcap: sc.marketcap != null ? Number(sc.marketcap) : (inf.marketcap != null ? Number(inf.marketcap) : null),
        ivRank: sc.iv_rank != null ? Number(sc.iv_rank) : null,
        divYield: inf.dividend_yield != null ? Number(inf.dividend_yield) : null,
        hasDividend: inf.has_dividend != null ? Boolean(inf.has_dividend) : null,
        nextEarnings: inf.next_earnings_date || sc.next_earnings_date || null,
        weekLow:  sc.week_52_low  != null ? Number(sc.week_52_low)  : null,
        weekHigh: sc.week_52_high != null ? Number(sc.week_52_high) : null,
      };
    });
  }, [rows, signals, screenerMap, infoMap, heldTickers]);

  const [sortCol, setSortCol] = useState("overall");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (id) => {
    const col = COLUMNS.find((c) => c.id === id);
    if (!col) return;
    if (id === sortCol) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(id);
      setSortDir(col.align === "left" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.id === sortCol);
    if (!col) return enriched;
    const arr = [...enriched];
    arr.sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
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

  // Drag state MUST be declared before any conditional return — React hook-order invariant (Item 36 hotfix).
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  // liveWidths (column resize) MUST also be declared before the early return -- same React hook-order invariant.
  const [liveWidths, setLiveWidths] = useState(null);

  if (!enriched.length) {
    return (
      <>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <TableColumnPicker
            columns={COLUMNS.map(({ id, label, description }) => ({ id, label, description }))}
            order={prefs.order}
            visible={prefs.visible}
            defaultOrder={DEFAULT_ORDER}
            defaultVisible={DEFAULT_VISIBLE}
            onOrderChange={setOrder}
            onVisibleChange={setVisible}
            onResetAll={resetToDefaults}
          />
        </div>
        <div style={{
          padding: "10px 12px", fontSize: 12, color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
        }}>
          {emptyMessage || "No tickers on your watchlist. Add one below."}
        </div>
      </>
    );
  }

  const byId = new Map(COLUMNS.map((c) => [c.id, c]));
  const visibleIds = prefs.order.filter((id) => prefs.visible.includes(id) && byId.has(id));
  const visibleColumns = visibleIds.map((id) => byId.get(id)).filter(Boolean);

  // ─── Draggable headers ─────────────────────────────────────────────────────
  const onHdrDragStart = (e, id) => {
    setDragId(id);
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); } catch {}
  };
  const onHdrDragOver = (e, id) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragOverId) setDragOverId(id);
  };
  const onHdrDrop = (e, targetId) => {
    e.preventDefault();
    const source = dragId;
    setDragId(null); setDragOverId(null);
    if (!source || source === targetId) return;
    const next = [...prefs.order];
    const from = next.indexOf(source);
    const to   = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, source);
    setOrder(next);
  };
  const onHdrDragEnd = () => { setDragId(null); setDragOverId(null); };

  const headerStyle = {
    fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
    fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
    padding: "6px 6px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-3)", position: "sticky", top: 0,
    userSelect: "none", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis",
  };

  // --- Resizable columns ----------------------------------------------------
  const widthOf = (id) => (liveWidths && liveWidths[id] != null)
    ? liveWidths[id]
    : (prefs.widths[id] != null ? prefs.widths[id] : (DEFAULT_WIDTHS[id] || 100));

  const onResizeStart = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(id);
    let next = startW;
    const onMove = (ev) => {
      next = Math.max(48, Math.min(2000, Math.round(startW + ev.clientX - startX)));
      setLiveWidths((prev) => ({ ...(prev || {}), [id]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const merged = { ...prefs.widths, [id]: next };
      setLiveWidths(null);
      setWidths(merged);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resizeHandleStyle = {
    position: "absolute",
    top: 0, right: 0, bottom: 0,
    width: 6,
    cursor: "col-resize",
    userSelect: "none",
    zIndex: 2,
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <TableColumnPicker
          columns={COLUMNS.map(({ id, label, description }) => ({ id, label, description }))}
          order={prefs.order}
          visible={prefs.visible}
          defaultOrder={DEFAULT_ORDER}
          defaultVisible={DEFAULT_VISIBLE}
          onOrderChange={setOrder}
          onVisibleChange={setVisible}
          onResetAll={resetToDefaults}
        />
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <colgroup>
            {visibleColumns.map((col) => (
              <col key={col.id} style={{ width: widthOf(col.id) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((col) => {
                const isDragOver = dragOverId === col.id && dragId && dragId !== col.id;
                const isDragging = dragId === col.id;
                return (
                  <th
                    key={col.id}
                    draggable
                    onDragStart={(e) => onHdrDragStart(e, col.id)}
                    onDragOver={(e) => onHdrDragOver(e, col.id)}
                    onDrop={(e) => onHdrDrop(e, col.id)}
                    onDragEnd={onHdrDragEnd}
                    onClick={() => toggleSort(col.id)}
                    title={col.description}
                    style={{
                      ...headerStyle,
                      textAlign: col.align,
                      cursor: "grab",
                      opacity: isDragging ? 0.5 : 1,
                      borderLeft: isDragOver ? "2px solid var(--accent)" : "2px solid transparent",
                    }}
                  >
                    {col.label}
                    <SortArrow dir={sortCol === col.id ? sortDir : null} />
                    <Tip def="Drag to resize column"><div
                      draggable={false}
                      onMouseDown={(e) => onResizeStart(e, col.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={resizeHandleStyle}
                    /></Tip>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.ticker}
                onClick={() => onOpenTicker?.(row.ticker)}
                style={{
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border-faint)",
                  background: "var(--surface-2)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-3)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "var(--surface-2)"}
              >
                {visibleColumns.map((col) => (
                  <td
                    key={col.id}
                    style={{
                      padding: "7px 6px",
                      textAlign: col.align,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {col.renderCell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
