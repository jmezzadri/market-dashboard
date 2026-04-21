// PositionsTable — sortable, user-customizable positions grid.
//
// Item 36 rewrite: columns are now a registry, users can drag-reorder headers
// and show/hide columns via the "Edit columns" picker. Layout preferences
// persist per user to public.user_preferences (see useTablePreferences).
//
// Props
// -----
//   rows          : Array<raw position> (from App.jsx heldPositions).
//                   Shape: { id, accountId, ticker, name, sector, price,
//                            avgCost, shares, value, beta, acctLabel,
//                            purchaseDate }
//   grandTotal    : total wealth for % of wealth column
//   screener      : { TICKER: { close, prev_close, marketcap, next_earnings_date,... } }
//                   Used for PNL DAY, Market Cap, Next Earnings lookups.
//   info          : { TICKER: { next_earnings_date, marketcap, dividend_yield, has_dividend,... } }
//                   Used as a fallback when screener row isn't present.
//   onOpenTicker  : fn(ticker) — open detail modal
//   onAdd, onBulkImport, onEdit, onDelete — action bar / row buttons
//   emptyMessage  : string shown when rows is empty
//
// Column registry
// ---------------
// Every column is { id, label, description, align, type, pinned?, getValue,
// renderCell }. `getValue` is used for sort comparisons; `renderCell` turns
// the value into a JSX node. Pinned columns (actions) can't be hidden or
// reordered.
//
// Data sources per column (see useTablePreferences for how user preferences
// merge with these defaults):
//   ticker, name, sector, shares, price, avgCost, pnl$, pnlPct, wealthPct,
//   account, beta, purchaseDate  →  the row itself
//   totalCost, currentValue       →  derived (shares × avgCost / price)
//   pnlDay$, pnlDayPct            →  screener[T].close / prev_close
//   holdingDays, annualizedPnl    →  derived from purchaseDate
//   marketcap, nextEarnings       →  screener[T] or info[T]
//   divYield                      →  info[T].dividend_yield (may be null
//                                    until a follow-up scan-ticker pass
//                                    populates it)

import { useMemo, useState } from "react";
import TableColumnPicker from "./TableColumnPicker";
import { useTablePreferences } from "../hooks/useTablePreferences";

// ─── formatters ──────────────────────────────────────────────────────────────
const fmt$Full = (v) =>
  v == null || !isFinite(v) ? "—" :
  `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmt$Signed = (v) =>
  v == null || !isFinite(v) ? "—" :
  (v >= 0 ? "+" : "−") +
  `$${Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPctSigned = (v, digits = 1) =>
  v == null || !isFinite(v) ? "—" :
  `${v >= 0 ? "+" : ""}${Number(v).toFixed(digits)}%`;

const fmtPct = (v, digits = 1) =>
  v == null || !isFinite(v) ? "—" :
  `${Number(v).toFixed(digits)}%`;

const fmtShares = (v) =>
  v == null || !isFinite(v) ? "—" :
  Number(v).toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 4,
  });

// Compact market-cap: 1.47T, 180.6M, 42B, etc.
const fmtMarketCap = (v) => {
  if (v == null) return "—";
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtDate = (v) => {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
};

function daysBetween(from, to) {
  if (!from) return null;
  const a = new Date(from);
  const b = to ? new Date(to) : new Date();
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function annualizedPct(currentValue, totalCost, holdingDays) {
  if (!totalCost || !currentValue || !holdingDays || holdingDays <= 0) return null;
  const ratio = currentValue / totalCost;
  if (ratio <= 0) return null;
  const years = holdingDays / 365;
  if (years <= 0) return null;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

const pnlColor = (v) =>
  v == null ? "var(--text-muted)" : v >= 0 ? "#30d158" : "#ff453a";
const betaColor = (v) =>
  v == null ? "var(--text-dim)"
  : v > 1.5 ? "#ff453a"
  : v > 1.0 ? "#ff9f0a"
  : v > 0.5 ? "#ffd60a" : "#30d158";

function SortArrow({ dir }) {
  if (!dir) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4, color: "var(--text)" }}>{dir === "asc" ? "▲" : "▼"}</span>;
}

// ─── column registry ─────────────────────────────────────────────────────────
// Values are computed up-front in the `enrich` step below and then read by
// both the sort comparator (via `sortValue`) and `renderCell`.
const COLUMNS = [
  {
    id: "ticker",
    label: "TICKER",
    description: "Ticker symbol",
    align: "left",
    sortValue: (r) => r.ticker,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>
        {r.ticker}
      </span>
    ),
  },
  {
    id: "name",
    label: "NAME",
    description: "Company or fund name",
    align: "left",
    sortValue: (r) => (r.name || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{
        color: "var(--text-muted)", maxWidth: 220, display: "inline-block",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        verticalAlign: "bottom",
      }} title={r.name}>{r.name || "—"}</span>
    ),
  },
  {
    id: "sector",
    label: "SECTOR",
    description: "Sector / asset class",
    align: "left",
    sortValue: (r) => (r.sector || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
        {r.sector || "—"}
      </span>
    ),
  },
  {
    id: "shares",
    label: "SHARES",
    description: "Total shares held",
    align: "right",
    sortValue: (r) => r.shares,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
        {fmtShares(r.shares)}
      </span>
    ),
  },
  {
    id: "price",
    label: "CURRENT PRICE/SHARE",
    description: "Current market price per share",
    align: "right",
    sortValue: (r) => r.price,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
        {fmt$Full(r.price)}
      </span>
    ),
  },
  {
    id: "avgCost",
    label: "COST/SHARE",
    description: "Average cost paid per share",
    align: "right",
    sortValue: (r) => r.avgCost,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {fmt$Full(r.avgCost)}
      </span>
    ),
  },
  {
    id: "totalCost",
    label: "TOTAL COST",
    description: "shares × avg cost — what you paid in aggregate",
    align: "right",
    sortValue: (r) => r.totalCost,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {fmt$Full(r.totalCost)}
      </span>
    ),
  },
  {
    id: "currentValue",
    label: "CURRENT VALUE",
    description: "shares × current price — what it's worth now",
    align: "right",
    sortValue: (r) => r.currentValue,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
        {fmt$Full(r.currentValue)}
      </span>
    ),
  },
  {
    id: "pnlDay$",
    label: "PNL DAY $",
    description: "Today's dollar change on this position",
    align: "right",
    sortValue: (r) => r.pnlDay$,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlDay$), fontWeight: 600 }}>
        {fmt$Signed(r.pnlDay$)}
      </span>
    ),
  },
  {
    id: "pnlDayPct",
    label: "PNL DAY %",
    description: "Today's percent change on this position",
    align: "right",
    sortValue: (r) => r.pnlDayPct,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlDayPct), fontWeight: 600 }}>
        {fmtPctSigned(r.pnlDayPct)}
      </span>
    ),
  },
  {
    id: "pnl$",
    label: "TOTAL PNL $",
    description: "Unrealized gain/loss in dollars (current value − total cost)",
    align: "right",
    sortValue: (r) => r.pnl$,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnl$), fontWeight: 600 }}>
        {fmt$Signed(r.pnl$)}
      </span>
    ),
  },
  {
    id: "pnlPct",
    label: "PNL %",
    description: "Unrealized gain/loss percent (price / cost − 1)",
    align: "right",
    sortValue: (r) => r.pnlPct,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlPct), fontWeight: 600 }}>
        {fmtPctSigned(r.pnlPct)}
      </span>
    ),
  },
  {
    id: "beta",
    label: "BETA",
    description: "Position beta vs. SPY (where available)",
    align: "right",
    sortValue: (r) => r.beta,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: betaColor(r.beta) }}>
        {r.beta == null ? "—" : Number(r.beta).toFixed(2)}
      </span>
    ),
  },
  {
    id: "purchaseDate",
    label: "PURCHASE DATE",
    description: "Date position was acquired. Optional — enables Holding Period and Annualized PnL columns.",
    align: "right",
    sortValue: (r) => r.purchaseDate ? new Date(r.purchaseDate).getTime() : null,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
        {fmtDate(r.purchaseDate)}
      </span>
    ),
  },
  {
    id: "holdingDays",
    label: "HOLDING PERIOD (DAYS)",
    description: "Days since purchase date. Empty if no purchase date set.",
    align: "right",
    sortValue: (r) => r.holdingDays,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {r.holdingDays == null ? "—" : r.holdingDays.toLocaleString()}
      </span>
    ),
  },
  {
    id: "annualizedPnl",
    label: "ANNUALIZED PNL %",
    description: "((current value / total cost) ^ (365 / holding days)) − 1. Needs purchase date.",
    align: "right",
    sortValue: (r) => r.annualizedPnl,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.annualizedPnl), fontWeight: 600 }}>
        {fmtPctSigned(r.annualizedPnl)}
      </span>
    ),
  },
  {
    id: "wealthPct",
    label: "% OF TOTAL WEALTH",
    description: "Current value as % of total portfolio value",
    align: "right",
    sortValue: (r) => r.wealthPct,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
        {fmtPct(r.wealthPct)}
      </span>
    ),
  },
  {
    id: "account",
    label: "ACCOUNT",
    description: "Account holding this position",
    align: "left",
    sortValue: (r) => (r.acctLabel || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
        {r.acctLabel || "—"}
      </span>
    ),
  },
  {
    id: "marketcap",
    label: "MARKET CAP",
    description: "Company market capitalization (from latest scan)",
    align: "right",
    sortValue: (r) => r.marketcap,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {fmtMarketCap(r.marketcap)}
      </span>
    ),
  },
  {
    id: "divYield",
    label: "DIV YIELD",
    description: "Dividend yield, when available. 'Y' / 'N' shown if only has-dividend flag is known.",
    align: "right",
    sortValue: (r) => r.divYield != null ? r.divYield : (r.hasDividend ? 0.001 : null),
    renderCell: (r) => {
      if (r.divYield != null && isFinite(r.divYield)) {
        return (
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {fmtPct(r.divYield * (r.divYield < 1 ? 100 : 1), 2)}
          </span>
        );
      }
      if (r.hasDividend === true) {
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>Y</span>;
      }
      if (r.hasDividend === false) {
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>N</span>;
      }
      return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>—</span>;
    },
  },
  {
    id: "nextEarnings",
    label: "NEXT EARNINGS",
    description: "Next expected earnings report date",
    align: "right",
    sortValue: (r) => r.nextEarnings ? new Date(r.nextEarnings).getTime() : null,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
        {fmtDate(r.nextEarnings)}
      </span>
    ),
  },
  {
    // Pinned rightmost, always visible, never draggable.
    id: "actions",
    label: "ACTIONS",
    description: "Edit / delete this position",
    align: "right",
    pinned: true,
    sortable: false,
    sortValue: () => null,
    renderCell: () => null, // rendered specially in row loop
  },
];

// Default column order per Joe's spec (2026-04-21):
// Ticker, Name, Current Price/Share, Cost/Share, PNL DAY $, PNL DAY %,
// Total Cost, Purchase Date, Total PNL $, PNL %, Beta, Holding Period,
// % of Total Wealth, Account, Market Cap, Div Yield, Next Earnings, Actions.
const DEFAULT_ORDER = [
  "ticker", "name", "price", "avgCost", "pnlDay$", "pnlDayPct",
  "totalCost", "purchaseDate", "pnl$", "pnlPct", "beta", "holdingDays",
  "wealthPct", "account", "marketcap", "divYield", "nextEarnings",
  "actions",
];

// Defaults-visible matches DEFAULT_ORDER. The rest (sector, shares,
// currentValue, annualizedPnl) are still available via the picker.
const DEFAULT_VISIBLE = [...DEFAULT_ORDER];

export default function PositionsTable({
  rows, grandTotal, screener, info,
  onOpenTicker, emptyMessage,
  onAdd, onBulkImport, onEdit, onDelete,
  tableKey = "positions",
}) {
  const showActionsCol = Boolean(onEdit || onDelete);
  const showActionBar  = Boolean(onAdd || onBulkImport);

  // Load/save column prefs (order + visibility) per user.
  const { prefs, setOrder, setVisible, resetToDefaults } = useTablePreferences(tableKey, {
    defaultOrder:   DEFAULT_ORDER,
    defaultVisible: DEFAULT_VISIBLE,
  });

  const screenerMap = screener || {};
  const infoMap     = info     || {};

  // Enrich each raw row once so sort + render read from the same shape.
  const enriched = useMemo(() => {
    return (rows || []).map((p) => {
      const T = String(p.ticker || "").toUpperCase();
      const sc = screenerMap[T] || {};
      const inf = infoMap[T] || {};

      const shares   = p.shares  != null ? Number(p.shares)  : null;
      const price    = p.price   != null ? Number(p.price)   : null;
      const avgCost  = p.avgCost != null ? Number(p.avgCost) : null;
      const valueDb  = p.value   != null ? Number(p.value)   : null;

      const currentValue = valueDb != null ? valueDb
                         : (shares != null && price != null ? shares * price : null);
      const totalCost    = (shares != null && avgCost != null) ? shares * avgCost : null;

      const pnl$   = (currentValue != null && totalCost != null) ? currentValue - totalCost : null;
      const pnlPct = (price != null && avgCost)                  ? (price / avgCost - 1) * 100 : null;

      // Daily change — screener gives us close + prev_close (strings). If
      // scan hasn't populated, render "—" (null flows through everywhere).
      const scClose = sc.close     != null ? Number(sc.close)     : null;
      const scPrev  = sc.prev_close != null ? Number(sc.prev_close) : null;
      const perShareDay = (scClose != null && scPrev != null) ? scClose - scPrev : null;
      const pnlDay$   = (perShareDay != null && shares != null) ? perShareDay * shares : null;
      const pnlDayPct = (scClose != null && scPrev)             ? (scClose / scPrev - 1) * 100 : null;

      const wealthPct = grandTotal && currentValue != null ? (currentValue / grandTotal) * 100 : null;

      const holdingDays = daysBetween(p.purchaseDate);
      const annualizedPnl = annualizedPct(currentValue, totalCost, holdingDays);

      // Prefer screener marketcap (refreshed per run) over info (cached);
      // both are strings on UW's wire, hence Number().
      const marketcap =
        sc.marketcap != null ? Number(sc.marketcap)
      : inf.marketcap != null ? Number(inf.marketcap)
      : null;

      // Divvy yield: UW's info payload carries `dividend_yield` for some
      // issuers (decimal, e.g. 0.0142 = 1.42%). When absent we fall back to
      // the has_dividend boolean so the column still communicates something.
      const divYield =
        inf.dividend_yield != null ? Number(inf.dividend_yield)
      : null;
      const hasDividend = inf.has_dividend != null ? Boolean(inf.has_dividend) : null;

      const nextEarnings = inf.next_earnings_date || sc.next_earnings_date || null;

      return {
        ticker: T,
        name: p.name || "",
        sector: p.sector || inf.sector || sc.sector || "",
        shares,
        price,
        avgCost,
        totalCost,
        currentValue,
        pnl$,
        pnlPct,
        pnlDay$,
        pnlDayPct,
        beta: p.beta != null ? Number(p.beta) : null,
        purchaseDate: p.purchaseDate || null,
        holdingDays,
        annualizedPnl,
        wealthPct,
        acctLabel: p.acctLabel || "",
        marketcap,
        divYield,
        hasDividend,
        nextEarnings,
        _raw: p,
      };
    });
  }, [rows, grandTotal, screenerMap, infoMap]);

  // ─── Sort state ────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState("wealthPct");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (colId) => {
    const col = COLUMNS.find((c) => c.id === colId);
    if (!col || col.sortable === false) return;
    if (colId === sortCol) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(colId);
      // Numeric cols → desc (most / biggest first); text → asc.
      setSortDir(col.align === "right" ? "desc" : "asc");
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
      if (aNull) return 1;          // nulls always at the bottom
      if (bNull) return -1;
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [enriched, sortCol, sortDir]);

  // ─── Action-bar + buttons ──────────────────────────────────────────────────
  const actionBtn = {
    padding: "4px 8px", fontSize: 11, fontFamily: "var(--font-mono)",
    letterSpacing: "0.04em", color: "var(--text-muted)",
    background: "transparent", border: "1px solid var(--border)",
    borderRadius: 4, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };
  const topBarBtn = { ...actionBtn, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--text)" };
  const topBarPrimary = { ...topBarBtn, color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" };

  const ActionBar = () => (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 8, flexWrap: "wrap" }}>
      <TableColumnPicker
        columns={COLUMNS.map(({ id, label, description, pinned }) => ({ id, label, description, pinned }))}
        order={prefs.order}
        visible={prefs.visible}
        onOrderChange={setOrder}
        onVisibleChange={setVisible}
        onReset={resetToDefaults}
      />
      {showActionBar && onBulkImport && (
        <button type="button" style={topBarBtn} onClick={onBulkImport}>
          Bulk import (CSV/XLSX)
        </button>
      )}
      {showActionBar && onAdd && (
        <button type="button" style={topBarPrimary} onClick={onAdd}>
          + Add position
        </button>
      )}
    </div>
  );

  if (!enriched.length) {
    return (
      <>
        <ActionBar />
        <div style={{
          padding: "10px 12px", fontSize: 12, color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--surface-2)",
        }}>
          {emptyMessage || "No positions."}
        </div>
      </>
    );
  }

  // ─── Visible column list for this render ───────────────────────────────────
  // Keep only ids the user has checked, then *always* append "actions" at the
  // end if the actions column is in use (pinned rightmost).
  const byId = new Map(COLUMNS.map((c) => [c.id, c]));
  const visibleIds = prefs.order
    .filter((id) => prefs.visible.includes(id) && byId.has(id))
    .filter((id) => id !== "actions"); // actions handled separately
  const visibleColumns = visibleIds.map((id) => byId.get(id)).filter(Boolean);
  const actionsCol = showActionsCol ? byId.get("actions") : null;

  // ─── Draggable headers ─────────────────────────────────────────────────────
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const onHdrDragStart = (e, id) => {
    setDragId(id);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    } catch {}
  };
  const onHdrDragOver = (e, id) => {
    if (!dragId || id === "actions") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragOverId) setDragOverId(id);
  };
  const onHdrDrop = (e, targetId) => {
    e.preventDefault();
    const source = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!source || source === targetId || targetId === "actions") return;
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
  };

  return (
    <>
      <ActionBar />
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
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
                      textAlign: col.align === "right" ? "right" : "left",
                      cursor: "grab",
                      opacity: isDragging ? 0.5 : 1,
                      borderLeft: isDragOver ? "2px solid var(--accent)" : "2px solid transparent",
                    }}
                  >
                    {col.label}
                    <SortArrow dir={sortCol === col.id ? sortDir : null} />
                  </th>
                );
              })}
              {actionsCol && (
                <th
                  style={{
                    ...headerStyle, cursor: "default", textAlign: "right", width: 90,
                    borderLeft: "1px solid var(--border-faint)",
                  }}
                  title={actionsCol.description}
                >
                  {actionsCol.label}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={`${row.acctLabel}-${row.ticker}-${row._raw?.id || ""}`}
                onClick={() => onOpenTicker?.(row.ticker)}
                style={{
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border-faint)",
                  background: "var(--surface-2)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              >
                {visibleColumns.map((col) => (
                  <td
                    key={col.id}
                    style={{
                      padding: "7px 6px",
                      textAlign: col.align === "right" ? "right" : "left",
                    }}
                  >
                    {col.renderCell(row)}
                  </td>
                ))}
                {actionsCol && (
                  <td
                    style={{ padding: "5px 6px", textAlign: "right", whiteSpace: "nowrap" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {onEdit && (
                      <button
                        type="button"
                        title="Edit position"
                        style={{ ...actionBtn, marginRight: 4 }}
                        onClick={(e) => { e.stopPropagation(); onEdit(row._raw); }}
                      >
                        Edit
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        title="Delete position"
                        style={{ ...actionBtn, color: "#ff453a", borderColor: "rgba(255,69,58,0.35)" }}
                        onClick={(e) => { e.stopPropagation(); onDelete(row._raw); }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
