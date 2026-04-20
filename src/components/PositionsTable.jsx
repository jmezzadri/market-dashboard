// Sortable positions table — replaces the card-stack render on the portopps
// tab's POSITIONS sub-panel. Columns: Ticker, Name, Sector, Price, Cost
// Basis, PnL $, PnL %, Beta, % of Total Wealth, Account, (Actions). Sort by
// any column — click a header to toggle asc/desc. Row click bubbles ticker
// up via onOpenTicker (opens TickerDetailModal).
//
// Rows expected shape (from App.jsx heldPositions):
//   { id, accountId, ticker, name, sector, price, avgCost, shares, value,
//     beta, acctLabel }
//
// Total wealth (grandTotal) must be passed so we can compute the wealth-%
// column here — the positions list doesn't carry it natively.
//
// Optional action props — when any of these are supplied, an ACTIONS column
// and an action bar above the table become visible. The parent owns the
// modal state and the Supabase writes; this component just surfaces the
// affordances.
//   onAdd         — () => void   | show "Add position" button
//   onBulkImport  — () => void   | show "Bulk import" button
//   onEdit        — (rawRow) => void | show a pencil per row
//   onDelete      — (rawRow) => void | show a trash per row
//
// rawRow passed back is the original heldPositions object (carries id,
// accountId, ticker, shares, avgCost, price, etc.) — everything the
// PositionEditor / delete handler needs to target the right DB row.
import { useMemo, useState } from "react";
import TruncatedText from "./TruncatedText";

function SortArrow({ dir }) {
  if (!dir) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4, color: "var(--text)" }}>{dir === "asc" ? "▲" : "▼"}</span>;
}

const fmt$Full = (v) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmt$Signed = (v) =>
  v == null ? "—" : (v >= 0 ? "+" : "−") + `$${Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PositionsTable({
  rows, grandTotal, onOpenTicker, emptyMessage,
  onAdd, onBulkImport, onEdit, onDelete,
}) {
  const showActionsCol = Boolean(onEdit || onDelete);
  const showActionBar  = Boolean(onAdd || onBulkImport);
  const enriched = useMemo(() => {
    return (rows || []).map((p) => {
      const pnlPct = p.avgCost ? ((p.price / p.avgCost - 1) * 100) : null;
      const pnl$ = p.avgCost != null ? (p.value - p.avgCost * p.shares) : null;
      const wealthPct = grandTotal ? (p.value / grandTotal * 100) : null;
      return {
        ticker: p.ticker,
        name: p.name || "",
        sector: p.sector || "",
        price: p.price,
        avgCost: p.avgCost,
        pnl$,
        pnlPct,
        beta: p.beta,
        wealthPct,
        acctLabel: p.acctLabel || "",
        _raw: p,
      };
    });
  }, [rows, grandTotal]);

  const [sortCol, setSortCol] = useState("wealthPct");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (col) => {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      const numCols = new Set(["price", "avgCost", "pnl$", "pnlPct", "beta", "wealthPct"]);
      setSortDir(numCols.has(col) ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...enriched];
    const getVal = (row) => {
      if (sortCol === "ticker") return row.ticker;
      if (sortCol === "name") return (row.name || "").toLowerCase();
      if (sortCol === "sector") return (row.sector || "").toLowerCase();
      if (sortCol === "acctLabel") return (row.acctLabel || "").toLowerCase();
      return row[sortCol];
    };
    arr.sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
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

  // Style for the small icon buttons in the actions column + top bar.
  const actionBtn = {
    padding: "4px 8px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 4,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };
  const topBarBtn = {
    ...actionBtn,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
  };
  const topBarPrimary = {
    ...topBarBtn,
    color: "#fff",
    background: "var(--accent)",
    border: "1px solid var(--accent)",
  };

  const ActionBar = () => (
    showActionBar ? (
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 8 }}>
        {onBulkImport && (
          <button type="button" style={topBarBtn} onClick={onBulkImport}>
            Bulk import (CSV/XLSX)
          </button>
        )}
        {onAdd && (
          <button type="button" style={topBarPrimary} onClick={onAdd}>
            + Add position
          </button>
        )}
      </div>
    ) : null
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

  const headerStyle = {
    fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
    fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
    padding: "6px 6px", textAlign: "left",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-3)", position: "sticky", top: 0,
    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };
  const headerStyleNum = { ...headerStyle, textAlign: "right" };

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
    <>
      <ActionBar />
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {renderHeader("ticker", "TICKER", "Ticker symbol")}
            {renderHeader("name", "NAME", "Company or fund name")}
            {renderHeader("sector", "SECTOR", "Sector / asset class")}
            {renderHeader("price", "PRICE", "Current market price per share", true)}
            {renderHeader("avgCost", "COST BASIS", "Average cost per share", true)}
            {renderHeader("pnl$", "PnL $", "Unrealized gain/loss, dollars (value − cost × shares)", true)}
            {renderHeader("pnlPct", "PnL %", "Unrealized gain/loss, percent (price / cost − 1)", true)}
            {renderHeader("beta", "BETA", "Position beta vs. SPY (if available)", true)}
            {renderHeader("wealthPct", "% WEALTH", "Position market value as a % of total wealth", true)}
            {renderHeader("acctLabel", "ACCOUNT", "Account holding this position")}
            {showActionsCol && (
              <th style={{ ...headerStyle, cursor: "default", textAlign: "right", width: 90 }}>
                ACTIONS
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const pnlCol = row.pnlPct == null ? "var(--text-muted)" : row.pnlPct >= 0 ? "#30d158" : "#ff453a";
            const betaCol = row.beta == null ? "var(--text-dim)" : row.beta > 1.5 ? "#ff453a" : row.beta > 1.0 ? "#ff9f0a" : row.beta > 0.5 ? "#ffd60a" : "#30d158";
            return (
              <tr
                key={`${row.acctLabel}-${row.ticker}`}
                onClick={() => onOpenTicker?.(row.ticker)}
                style={{
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border-faint)",
                  background: "var(--surface-2)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              >
                <td style={{ padding: "7px 6px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>
                  {row.ticker}
                </td>
                <TruncatedText
                  element="td"
                  text={row.name}
                  limit={20}
                  style={{
                    padding: "7px 6px", color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                />
                <td style={{ padding: "7px 6px", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
                  {row.sector || "—"}
                </td>
                <td style={{ padding: "7px 6px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                  {fmt$Full(row.price)}
                </td>
                <td style={{ padding: "7px 6px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                  {fmt$Full(row.avgCost)}
                </td>
                <td style={{ padding: "7px 6px", textAlign: "right", fontFamily: "var(--font-mono)", color: pnlCol, fontWeight: 600 }}>
                  {fmt$Signed(row.pnl$)}
                </td>
                <td style={{ padding: "7px 6px", textAlign: "right", fontFamily: "var(--font-mono)", color: pnlCol, fontWeight: 600 }}>
                  {row.pnlPct == null ? "—" : `${row.pnlPct >= 0 ? "+" : ""}${row.pnlPct.toFixed(1)}%`}
                </td>
                <td style={{ padding: "7px 6px", textAlign: "right", fontFamily: "var(--font-mono)", color: betaCol }}>
                  {row.beta == null ? "—" : row.beta.toFixed(2)}
                </td>
                <td style={{ padding: "7px 6px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                  {row.wealthPct == null ? "—" : `${row.wealthPct.toFixed(1)}%`}
                </td>
                <td style={{ padding: "7px 6px", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
                  {row.acctLabel || "—"}
                </td>
                {showActionsCol && (
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
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
