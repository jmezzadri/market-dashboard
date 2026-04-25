// useSortableTable — shared sort state + sort comparator for every data
// table on macrotilt.com.
//
// Why this exists
// ───────────────
// LESSONS.md rule #4 says every data table is sortable: click any column
// header to cycle ascending → descending. Each existing sortable table
// (PositionsTable, WatchlistTable, Scanner) implemented its own copy of
// the same pattern — sortCol/sortDir state, toggleSort, null-last
// comparator, ↑/↓/↕ arrow component. This hook collapses that duplication
// and gives static tables a one-line retrofit path.
//
// Usage
// ─────
//   const cols = [
//     { id: "name", label: "Indicator", align: "left",  sortValue: r => r.name },
//     { id: "auc",  label: "AUC",       align: "right", sortValue: r => r.auc },
//     { id: "w",    label: "Weight",    align: "right", sortValue: r => r.weight },
//   ];
//   const { sorted, sortCol, sortDir, toggleSort } =
//     useSortableTable({ rows, columns: cols, defaultColId: "w", defaultDir: "desc" });
//
//   // In the header:
//   <th onClick={() => toggleSort("auc")}>
//     AUC <SortArrow dir={sortCol === "auc" ? sortDir : null} />
//   </th>
//
// Behavior
// ────────
// • Clicking the active column flips direction.
// • Clicking a different column switches to it; default direction is
//   "desc" for right-aligned (numeric) columns and "asc" for everything
//   else, matching the existing PositionsTable / WatchlistTable behavior.
// • Nulls always sort to the bottom (regardless of direction).
// • Numbers compare numerically; strings use locale compare with numeric
//   awareness so "AAPL10" sorts after "AAPL2".
// • A column can opt out with `sortable: false`.
//
// This hook does not own column-resize, drag-reorder, or column-picker
// state — those live in PositionsTable / WatchlistTable specifically.

import { useMemo, useState } from "react";

export function useSortableTable({
  rows,
  columns,
  defaultColId,
  defaultDir = "desc",
}) {
  const [sortCol, setSortCol] = useState(defaultColId);
  const [sortDir, setSortDir] = useState(defaultDir);

  const toggleSort = (colId) => {
    const col = columns.find((c) => c.id === colId);
    if (!col || col.sortable === false) return;
    if (colId === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(colId);
      // Numeric (right-aligned) cols → desc; text → asc.
      setSortDir(col.align === "right" ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    if (!Array.isArray(rows)) return rows;
    const col = columns.find((c) => c.id === sortCol);
    if (!col || typeof col.sortValue !== "function") return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1; // nulls always at the bottom
      if (bNull) return -1;
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, columns, sortCol, sortDir]);

  return { sorted, sortCol, sortDir, toggleSort, setSortCol, setSortDir };
}

// SortArrow — visual indicator that lives next to the column label.
//   <SortArrow dir={sortCol === "auc" ? sortDir : null} />
// Renders a dim ↕ when the column is not the active sort, ▲ for asc, ▼
// for desc. Color and margin match the existing PositionsTable /
// WatchlistTable arrow exactly so retrofits read identical.
export function SortArrow({ dir }) {
  if (!dir) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return (
    <span style={{ marginLeft: 4, color: "var(--text)" }}>
      {dir === "asc" ? "▲" : "▼"}
    </span>
  );
}

// sortableHeaderProps — convenience for building a clickable <th>.
// Returns { onClick, style, role, tabIndex, onKeyDown, "aria-sort" }
// so the header is keyboard-accessible and announces sort state to
// screen readers. Spread it onto the <th>.
export function sortableHeaderProps({ colId, sortCol, sortDir, toggleSort }) {
  const isActive = sortCol === colId;
  return {
    onClick: () => toggleSort(colId),
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSort(colId);
      }
    },
    role: "button",
    tabIndex: 0,
    "aria-sort": isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none",
    style: { cursor: "pointer", userSelect: "none" },
  };
}
