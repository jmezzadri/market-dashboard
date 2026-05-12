// MTTable - shared table primitive for MacroTilt.
//
// One look across every <table> on the site. Full feature set:
//   * Sort on every column (click header to toggle asc -> desc -> off)
//   * Per-column filter via a "+ Filter" popover (operators auto-pick for
//     numeric vs categorical columns)
//   * Sticky header
//   * Drag right-edge of a header to resize that column (double-click to reset)
//   * Drag a header onto another to reorder columns
//   * Visibility toggle via a "Columns N/M" popover
//   * Body cells use text-overflow: ellipsis when content overflows
//
// Two modes via the `features` prop:
//   * full  (Tier A) - everything above
//   * look  (Tier B) - shared visual look only (no sort buttons, no filter,
//                      no resize, no reorder, no visibility). For tiny
//                      reference/lookup tables.
//
// State persisted to localStorage when `storageKey` is provided.
//
// Joe directive 2026-05-11. Anchored to the Trading Opps v5 styling.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

const MIN_W = 30;
const MAX_W = 600;

function loadColState(storageKey, columns) {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem("mt-table-" + storageKey);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return null;
    return s;
  } catch (_) { return null; }
}
function saveColState(storageKey, s) {
  if (!storageKey) return;
  try { localStorage.setItem("mt-table-" + storageKey, JSON.stringify(s)); } catch (_) { /* ignore */ }
}

function defaultOpsFor(col) {
  if (col.numeric) return [">=", "<=", ">", "<", "is", "is not"];
  if (col.categorical) return ["is one of", "is", "is not", "contains"];
  return ["contains", "is", "is not"];
}

function rowMatchesFilter(row, f) {
  const v = row[f.key];
  const value = f.value;
  if (f.op === "is one of") {
    const list = String(value).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    return list.includes(String(v ?? "").toLowerCase());
  }
  if (f.op === "is")       return String(v ?? "").toLowerCase() === String(value).toLowerCase();
  if (f.op === "is not")   return String(v ?? "").toLowerCase() !== String(value).toLowerCase();
  if (f.op === "contains") return String(v ?? "").toLowerCase().includes(String(value).toLowerCase());
  const nv = Number(v), nf = Number(value);
  if (!Number.isFinite(nv) || !Number.isFinite(nf)) return false;
  if (f.op === ">=") return nv >= nf;
  if (f.op === "<=") return nv <= nf;
  if (f.op === ">")  return nv > nf;
  if (f.op === "<")  return nv < nf;
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// MTTable
//
// props:
//   columns:    array of { key, label, numeric?, categorical?, defaultVisible?,
//                          defaultWidth?, render?(row), sortValue?(row), tooltip? }
//   rows:       array of row objects
//   rowKey:     string (column key for unique row id) or fn(row) => id
//   onRowClick: fn(row) => void
//   features:   "full" | "look"  (default "full")
//   storageKey: string for localStorage persistence (column widths/visibility/order/sort/filter)
//   toolbar:    optional toolbar config: { chips?, search?, addTickerButton? }
//   className:  extra wrapper class
// ───────────────────────────────────────────────────────────────────────────

export default function MTTable({
  columns,
  rows = [],
  rowKey,
  onRowClick,
  features = "full",
  storageKey,
  toolbar,
  className = "",
  emptyMessage = "No rows.",
  // expandable rows: optional
  //   isExpanded(row) => boolean
  //   onToggle(row)   => void   (caller manages the expansion state)
  //   renderExpanded(row) => ReactNode  (renders inside one <tr><td colSpan=N>)
  expandable,
}) {
  const isFull = features === "full";

  // Initialize state (with persistence)
  const saved = useMemo(() => loadColState(storageKey, columns), [storageKey, columns]);
  const initialOrder   = saved?.order   || columns.map(c => c.key);
  const initialVisible = saved?.visible || columns.filter(c => c.defaultVisible !== false).map(c => c.key);
  const initialWidths  = saved?.widths  || Object.fromEntries(columns.map(c => [c.key, c.defaultWidth || 100]));
  const initialSort    = saved?.sort    || { key: null, dir: "desc" };
  const initialFilters = saved?.colFilters || [];

  const [order,       setOrder]       = useState(initialOrder);
  const [visible,     setVisible]     = useState(new Set(initialVisible));
  const [widths,      setWidths]      = useState(initialWidths);
  const [sort,        setSort]        = useState(initialSort);
  const [colFilters,  setColFilters]  = useState(initialFilters);
  const [searchQ,     setSearchQ]     = useState("");
  const [popover,     setPopover]     = useState(null); // "filter" | "cols" | null
  const [draftFilter, setDraftFilter] = useState(null);

  // Persist
  useEffect(() => {
    saveColState(storageKey, {
      order, visible: Array.from(visible), widths, sort, colFilters,
    });
  }, [storageKey, order, visible, widths, sort, colFilters]);

  // Close popovers on outside click
  const rootRef = useRef(null);
  useEffect(() => {
    function onDoc(e) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setPopover(null);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  // Drag state
  const dragKeyRef = useRef(null);

  // Resolve helpers
  const colByKey = useMemo(() => Object.fromEntries(columns.map(c => [c.key, c])), [columns]);
  const visibleCols = useMemo(
    () => order.map(k => colByKey[k]).filter(c => c && visible.has(c.key)),
    [order, visible, colByKey]
  );

  const getRowKey = (row, i) => {
    if (typeof rowKey === "function") return rowKey(row);
    if (typeof rowKey === "string")   return row[rowKey];
    return i;
  };

  // Apply search + chip + col-filter + sort
  const processedRows = useMemo(() => {
    let r = rows;

    // search
    if (toolbar?.search && searchQ.trim()) {
      const q = searchQ.trim().toLowerCase();
      const keys = toolbar.search.fields || columns.filter(c => !c.numeric).map(c => c.key);
      r = r.filter(x => keys.some(k => String(x[k] ?? "").toLowerCase().includes(q)));
    }

    // chip
    if (toolbar?.chips && toolbar.chips.current && toolbar.chips.current !== "__all__") {
      const fn = toolbar.chips.predicate;
      if (typeof fn === "function") r = r.filter(x => fn(x, toolbar.chips.current));
    }

    // column filters
    if (isFull && colFilters.length > 0) {
      r = r.filter(x => colFilters.every(f => rowMatchesFilter(x, f)));
    }

    // sort
    if (isFull && sort.key) {
      const col = colByKey[sort.key];
      const dir = sort.dir === "asc" ? 1 : -1;
      r = r.slice().sort((a, b) => {
        const va = col?.sortValue ? col.sortValue(a) : a[sort.key];
        const vb = col?.sortValue ? col.sortValue(b) : b[sort.key];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (col?.numeric) return (Number(va) - Number(vb)) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    }

    return r;
  }, [rows, columns, colByKey, searchQ, toolbar, colFilters, sort, isFull]);

  // ── Interactions ─────────────────────────────────────────────────────────
  function sortBy(k) {
    if (!isFull) return;
    setSort(s => {
      if (s.key !== k) return { key: k, dir: "desc" };
      if (s.dir === "desc") return { key: k, dir: "asc" };
      return { key: null, dir: "desc" };
    });
  }

  function toggleVisible(k) {
    setVisible(s => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function moveColumn(fromKey, toKey) {
    setOrder(s => {
      const arr = s.slice();
      const fi = arr.indexOf(fromKey);
      const ti = arr.indexOf(toKey);
      if (fi < 0 || ti < 0) return s;
      const [m] = arr.splice(fi, 1);
      arr.splice(ti, 0, m);
      return arr;
    });
  }

  function addColumnFilter() {
    if (!draftFilter || !draftFilter.value || String(draftFilter.value).trim() === "") return;
    setColFilters(arr => [...arr, { id: Date.now() + Math.random(), ...draftFilter }]);
    setDraftFilter(null);
    setPopover(null);
  }
  function removeColumnFilter(id) {
    setColFilters(arr => arr.filter(f => f.id !== id));
  }
  function clearAllFilters() { setColFilters([]); }

  function startResize(k, ev) {
    if (!isFull) return;
    ev.stopPropagation();
    ev.preventDefault();
    const startX = ev.clientX;
    const startW = widths[k];
    const onMove = (e) => {
      const dx = e.clientX - startX;
      const next = Math.max(MIN_W, Math.min(MAX_W, startW + dx));
      setWidths(w => ({ ...w, [k]: next }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function resetWidth(k, ev) {
    ev.stopPropagation();
    const def = colByKey[k]?.defaultWidth || 100;
    setWidths(w => ({ ...w, [k]: def }));
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const filterPopoverOpen = isFull && popover === "filter";
  const colsPopoverOpen   = isFull && popover === "cols";

  // Initialize draft when opening filter popover
  useEffect(() => {
    if (filterPopoverOpen && !draftFilter) {
      const first = columns[0];
      const ops = defaultOpsFor(first);
      setDraftFilter({ key: first.key, op: ops[0], value: "" });
    }
    if (!filterPopoverOpen && draftFilter) setDraftFilter(null);
  }, [filterPopoverOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={rootRef} className={"mt-table-root " + (isFull ? "" : "mt-table-root--look ") + className}>
      <style>{MT_TABLE_CSS}</style>

      {/* Active column-filter chips */}
      {isFull && colFilters.length > 0 && (
        <div className="mt-active-filters">
          <span className="label">Filters</span>
          {colFilters.map(f => {
            const c = colByKey[f.key];
            return (
              <span key={f.id} className="f">
                <b>{c?.label || f.key}</b>
                <span className="op">{f.op}</span>
                <span>{Array.isArray(f.value) ? f.value.join(", ") : String(f.value)}</span>
                <button type="button" className="x" onClick={() => removeColumnFilter(f.id)} aria-label="Remove filter">×</button>
              </span>
            );
          })}
          <button type="button" className="clear" onClick={clearAllFilters}>Clear all</button>
        </div>
      )}

      {/* Toolbar (optional) */}
      {(toolbar?.chips || toolbar?.search || isFull) && (
        <div className="mt-chip-bar">
          {toolbar?.chips && toolbar.chips.options.map(opt => {
            const active = (toolbar.chips.current || "__all__") === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                className={"mt-chip" + (active ? " active" : "")}
                onClick={() => toolbar.chips.onSet && toolbar.chips.onSet(opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
          {toolbar?.search && (
            <input
              className="mt-search"
              placeholder={toolbar.search.placeholder || "Search..."}
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          )}
          <div className="mt-spacer" />
          {isFull && (
            <div className="mt-popover-host">
              <button
                type="button"
                className="mt-chip"
                onClick={(e) => { e.stopPropagation(); setPopover(filterPopoverOpen ? null : "filter"); }}
              >
                + Filter
                {colFilters.length > 0 && <span style={{ color: "var(--accent)", fontWeight: 600, marginLeft: 6 }}>{colFilters.length}</span>}
              </button>
              {filterPopoverOpen && draftFilter && (
                <div className="mt-popover open" onClick={(e) => e.stopPropagation()}>
                  <h4>Add a column filter</h4>
                  <div className="row">
                    <select
                      value={draftFilter.key}
                      onChange={(e) => {
                        const k = e.target.value;
                        const col = colByKey[k];
                        const ops = defaultOpsFor(col);
                        setDraftFilter({ key: k, op: ops[0], value: "" });
                      }}
                    >
                      {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="row">
                    <select value={draftFilter.op} onChange={(e) => setDraftFilter(d => ({ ...d, op: e.target.value }))}>
                      {defaultOpsFor(colByKey[draftFilter.key]).map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="row">
                    <input
                      type="text"
                      placeholder="value..."
                      value={draftFilter.value}
                      onChange={(e) => setDraftFilter(d => ({ ...d, value: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") addColumnFilter(); }}
                    />
                  </div>
                  <div className="actions">
                    <button type="button" className="mt-btn ghost" onClick={() => setPopover(null)}>Cancel</button>
                    <button type="button" className="mt-btn primary" onClick={addColumnFilter}>Apply filter</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {isFull && (
            <div className="mt-popover-host">
              <button type="button" className="mt-chip" onClick={(e) => { e.stopPropagation(); setPopover(colsPopoverOpen ? null : "cols"); }}>
                Columns <span style={{ color: "var(--text-dim)" }}>{visible.size}/{columns.length}</span>
              </button>
              {colsPopoverOpen && (
                <div className="mt-cols-popover open" onClick={(e) => e.stopPropagation()}>
                  {order.map(k => {
                    const col = colByKey[k];
                    if (!col) return null;
                    return (
                      <div
                        key={k}
                        className="item"
                        draggable
                        onDragStart={(e) => { dragKeyRef.current = k; e.dataTransfer.effectAllowed = "move"; e.currentTarget.classList.add("drag-source"); }}
                        onDragEnd={(e) => { e.currentTarget.classList.remove("drag-source"); document.querySelectorAll(".mt-cols-popover .item").forEach(x => x.classList.remove("drag-over")); dragKeyRef.current = null; }}
                        onDragOver={(e) => { if (!dragKeyRef.current || dragKeyRef.current === k) return; e.preventDefault(); document.querySelectorAll(".mt-cols-popover .item").forEach(x => x.classList.remove("drag-over")); e.currentTarget.classList.add("drag-over"); }}
                        onDrop={(e) => { e.preventDefault(); const dk = dragKeyRef.current; if (!dk || dk === k) return; moveColumn(dk, k); }}
                      >
                        <span className="grip">⋮⋮</span>
                        <input type="checkbox" checked={visible.has(k)} onChange={() => toggleVisible(k)} />
                        <span className="name">{col.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-card">
        <div className="mt-table-scroll">
          <table className="mt-table">
            {isFull && (
              <colgroup>
                {visibleCols.map(c => <col key={c.key} style={{ width: (widths[c.key] || c.defaultWidth || 100) + "px" }} />)}
              </colgroup>
            )}
            <thead>
              <tr>
                {visibleCols.map(c => {
                  const isSort = sort.key === c.key;
                  const arrow = isSort ? (sort.dir === "asc" ? "↑" : "↓") : "";
                  const hasFilter = colFilters.some(f => f.key === c.key);
                  return (
                    <th
                      key={c.key}
                      className={(c.numeric ? "numeric" : "") + (hasFilter ? " has-filter" : "")}
                      draggable={isFull}
                      title={c.tooltip || ""}
                      onClick={(e) => { if (e.target.classList.contains("resize-handle")) return; sortBy(c.key); }}
                      onDragStart={(e) => { if (!isFull) return; dragKeyRef.current = c.key; e.dataTransfer.effectAllowed = "move"; e.currentTarget.classList.add("drag-source"); }}
                      onDragEnd={(e) => { e.currentTarget.classList.remove("drag-source"); document.querySelectorAll(".mt-table thead th").forEach(x => x.classList.remove("drag-over")); dragKeyRef.current = null; }}
                      onDragOver={(e) => { if (!isFull || !dragKeyRef.current || dragKeyRef.current === c.key) return; e.preventDefault(); document.querySelectorAll(".mt-table thead th").forEach(x => x.classList.remove("drag-over")); e.currentTarget.classList.add("drag-over"); }}
                      onDrop={(e) => { if (!isFull) return; e.preventDefault(); const dk = dragKeyRef.current; if (!dk || dk === c.key) return; moveColumn(dk, c.key); }}
                    >
                      {c.label}
                      {c.headerExtra && <span style={{ marginLeft: 6, display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}>{c.headerExtra}</span>}
                      {arrow && <span className="arrow"> {arrow}</span>}
                      {hasFilter && <span className="filter-dot" />}
                      {isFull && (
                        <span
                          className="resize-handle"
                          onMouseDown={(e) => startResize(c.key, e)}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => resetWidth(c.key, e)}
                          title="Drag to resize, double-click to reset"
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {processedRows.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32, fontStyle: "italic" }}>
                    {emptyMessage}
                  </td>
                </tr>
              ) : processedRows.map((row, i) => {
                const expanded = expandable?.isExpanded ? expandable.isExpanded(row) : false;
                const childRows = expanded && expandable?.childRows ? (expandable.childRows(row) || []) : [];
                const rowKeyVal = getRowKey(row, i);
                return (
                  <Fragment key={rowKeyVal}>
                    <tr
                      className={onRowClick ? "clickable" : ""}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      style={onRowClick ? { cursor: "pointer" } : undefined}
                    >
                      {visibleCols.map(c => (
                        <td key={c.key} className={c.numeric ? "numeric" : ""}>
                          {c.render ? c.render(row) : (row[c.key] == null ? "—" : String(row[c.key]))}
                        </td>
                      ))}
                    </tr>
                    {childRows.map((child, ci) => (
                      <tr
                        key={`${rowKeyVal}-c${ci}`}
                        className={"mt-child" + (expandable?.onChildClick ? " clickable" : "")}
                        onClick={expandable?.onChildClick ? () => expandable.onChildClick(child, row) : undefined}
                        style={expandable?.onChildClick ? { cursor: "pointer" } : undefined}
                      >
                        {visibleCols.map(c => (
                          <td key={c.key} className={c.numeric ? "numeric" : ""}>
                            {c.renderChild ? c.renderChild(child, row) : c.render ? c.render(child) : (child[c.key] == null ? "—" : String(child[c.key]))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {expanded && expandable?.renderExpanded && (
                      <tr className="mt-expanded-row">
                        <td colSpan={visibleCols.length} style={{ padding: 0 }}>
                          {expandable.renderExpanded(row)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// All styling is inline via <style> so the component is fully self-contained.
// Anchored to MacroTilt theme tokens (theme.css var()s) so light + dark
// themes inherit automatically.
const MT_TABLE_CSS = `
.mt-table-root { font-family: var(--font-ui, system-ui, sans-serif); }
.mt-table-root .mt-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md, 12px); box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04)); overflow: hidden; }
.mt-table-root .mt-table-scroll { overflow-x: auto; overflow-y: auto; max-height: 70vh; }
.mt-table-root .mt-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
.mt-table-root .mt-table thead tr th {
  position: sticky; top: 0; z-index: 5;
  background: var(--surface-2); color: var(--text-muted);
  font-family: var(--font-mono, JetBrains Mono, monospace);
  font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  padding: 11px 24px 11px 10px; text-align: left;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border-faint, var(--border));
  box-shadow: 0 1px 0 var(--border);
  user-select: none; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mt-table-root .mt-table thead tr th.numeric { text-align: right; padding-right: 10px; padding-left: 24px; }
.mt-table-root .mt-table thead tr th:last-child { border-right: none; }
.mt-table-root .mt-table thead tr th:hover { background: var(--hover, var(--surface-3)); color: var(--text-2, var(--text)); }
.mt-table-root .mt-table thead tr th.has-filter { color: var(--accent); }
.mt-table-root .mt-table thead tr th .arrow { color: var(--accent); font-size: 9px; margin-left: 4px; }
.mt-table-root .mt-table thead tr th .filter-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); margin-left: 5px; vertical-align: middle; }
.mt-table-root .mt-table thead tr th .resize-handle { position: absolute; top: 0; right: 0; width: 8px; height: 100%; cursor: col-resize; user-select: none; z-index: 6; }
.mt-table-root .mt-table thead tr th .resize-handle:hover { background: linear-gradient(to right, transparent, var(--accent-soft, rgba(14,85,96,0.10))); }
.mt-table-root .mt-table thead tr th.drag-source { opacity: 0.4; }
.mt-table-root .mt-table thead tr th.drag-over { box-shadow: inset 3px 0 0 var(--accent); }
.mt-table-root .mt-table tbody tr td {
  padding: 11px 10px; color: var(--text-2, var(--text)); white-space: nowrap;
  border-bottom: 1px solid var(--border-faint, var(--border));
  border-right: 1px solid var(--border-faint, var(--border));
  overflow: hidden; text-overflow: ellipsis;
}
.mt-table-root .mt-table tbody tr td.numeric { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--font-mono, JetBrains Mono, monospace); }
.mt-table-root .mt-table tbody tr td:last-child { border-right: none; }
.mt-table-root .mt-table tbody tr { transition: background 0.12s; }
.mt-table-root .mt-table tbody tr:hover { background: var(--hover, var(--surface-3)); }
.mt-table-root .mt-table tbody tr:last-child td { border-bottom: none; }
.mt-table-root .mt-chip-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md, 12px); box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04)); margin-bottom: 12px; }
.mt-table-root .mt-chip { background: transparent; border: 1px solid var(--border); color: var(--text-2, var(--text)); padding: 6px 13px; border-radius: 999px; font-size: 12px; cursor: pointer; font-family: var(--font-ui, system-ui); transition: all 0.15s; }
.mt-table-root .mt-chip:hover { background: var(--surface-2); }
.mt-table-root .mt-chip.active { background: var(--accent); border-color: var(--accent); color: var(--surface); }
.mt-table-root .mt-search { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 8px; font-size: 12px; font-family: var(--font-ui, system-ui); min-width: 200px; }
.mt-table-root .mt-spacer { flex: 1; }
.mt-table-root .mt-active-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md, 12px); box-shadow: var(--shadow-sm); margin-bottom: 8px; font-size: 12px; }
.mt-table-root .mt-active-filters .label { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); margin-right: 4px; }
.mt-table-root .mt-active-filters .f { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 10px; border-radius: 999px; background: var(--accent-soft, rgba(14,85,96,0.10)); border: 1px solid var(--border); color: var(--text-2, var(--text)); font-size: 11.5px; }
.mt-table-root .mt-active-filters .f b { font-weight: 600; }
.mt-table-root .mt-active-filters .f .op { color: var(--text-muted); font-family: var(--font-mono); }
.mt-table-root .mt-active-filters .f .x { background: transparent; border: 0; color: var(--text-muted); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.mt-table-root .mt-active-filters .clear { background: transparent; border: 1px solid var(--border); color: var(--text-muted); padding: 4px 10px; border-radius: 999px; font-size: 11px; font-family: var(--font-ui, system-ui); cursor: pointer; }
.mt-table-root .mt-popover-host { position: relative; display: inline-block; }
.mt-table-root .mt-popover { position: absolute; right: 0; top: calc(100% + 6px); min-width: 280px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.06); padding: 14px; z-index: 30; font-size: 12px; }
.mt-table-root .mt-popover h4 { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 8px; }
.mt-table-root .mt-popover select, .mt-table-root .mt-popover input { width: 100%; background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 6px; font-size: 12px; font-family: var(--font-ui, system-ui); }
.mt-table-root .mt-popover .row { margin-bottom: 8px; }
.mt-table-root .mt-popover .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
.mt-table-root .mt-btn { padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: var(--font-ui, system-ui); }
.mt-table-root .mt-btn.primary { background: var(--accent); color: white; border: 1px solid var(--accent); }
.mt-table-root .mt-btn.ghost { background: transparent; color: var(--text-2, var(--text)); border: 1px solid var(--border); }
.mt-table-root .mt-cols-popover { position: absolute; right: 0; top: calc(100% + 6px); min-width: 260px; max-height: 380px; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.06); padding: 6px; z-index: 30; font-size: 12px; }
.mt-table-root .mt-cols-popover .item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.mt-table-root .mt-cols-popover .item:hover { background: var(--hover, var(--surface-3)); }
.mt-table-root .mt-cols-popover .item .name { flex: 1; color: var(--text-2, var(--text)); }
.mt-table-root .mt-cols-popover .item .grip { color: var(--text-dim); font-family: var(--font-mono); cursor: grab; }
.mt-table-root .mt-cols-popover .item.drag-source { opacity: 0.4; }
.mt-table-root .mt-cols-popover .item.drag-over { box-shadow: inset 0 2px 0 var(--accent); }

/* ── Tier B (features="look") overrides ─────────────────────────────────────
   Docs / reference tables: cells must WRAP (no ellipsis), table sizes to its
   content (no forced column widths), no inner scroll, no sticky header, no
   row-hover. Header is not clickable. */
.mt-table-root--look .mt-table { table-layout: auto; }
.mt-table-root--look .mt-table-scroll { max-height: none; overflow: visible; }
.mt-table-root--look .mt-table thead tr th {
  position: static; cursor: default; white-space: normal; box-shadow: none;
}
.mt-table-root--look .mt-table thead tr th:hover { background: var(--surface-2); color: var(--text-muted); }
.mt-table-root--look .mt-table tbody tr td {
  white-space: normal; overflow: visible; text-overflow: clip; vertical-align: top;
}
.mt-table-root--look .mt-table tbody tr:hover { background: transparent; }
.mt-table-root--look .mt-table tbody tr.clickable:hover { background: var(--hover, var(--surface-3)); }
.mt-table-root .mt-table tbody tr.mt-child td { background: var(--surface-2); font-size: 11.5px; padding-top: 9px; padding-bottom: 9px; }
.mt-table-root .mt-table tbody tr.mt-child.clickable:hover td { background: #edeef1; }
.mt-table-root .mt-table tbody tr.mt-child td.numeric { font-size: 11px; }
`;
