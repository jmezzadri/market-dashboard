// TableColumnPicker — reusable popover for show/hide + drag-reorder of
// table columns. Used by PositionsTable and WatchlistTable.
//
// Props
// -----
//   columns:       [{ id, label, description?, pinned? }]   full registry
//   order:         ["colId"...]  current order (from useTablePreferences)
//   visible:       ["colId"...]  current visibility (from useTablePreferences)
//   onOrderChange: (newOrder) => void
//   onVisibleChange: (newVisible) => void
//   onReset:       () => void
//   buttonLabel?:  string (default "Edit columns")
//
// Behavior
// --------
// - Drag a row's handle (⋮⋮) to reorder. Drop anywhere in the list.
// - Checkbox toggles visibility. Pinned columns (actions, ticker) can't be
//   hidden — checkbox is disabled.
// - "Reset to defaults" restores the table's stock layout.
// - Click outside or press Escape to close.
//
// Uses native HTML5 drag and drop — no external deps. Columns are a small
// bounded list so browser drag is plenty fast.

import { useEffect, useRef, useState } from "react";

export default function TableColumnPicker({
  columns,
  order,
  visible,
  onOrderChange,
  onVisibleChange,
  onReset,
  buttonLabel = "Edit columns",
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);
  const btnRef = useRef(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byId = new Map(columns.map((c) => [c.id, c]));
  const orderedCols = order.map((id) => byId.get(id)).filter(Boolean);
  const visibleSet = new Set(visible);

  // Drag state (native HTML5 DnD). dragId = the column being dragged;
  // dragOverId = the row we're hovering over (for the drop indicator).
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const onDragStart = (e, id) => {
    setDragId(id);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    } catch { /* Safari quirk */ }
  };
  const onDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragOverId) setDragOverId(id);
  };
  const onDrop = (e, targetId) => {
    e.preventDefault();
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const next = [...order];
    const from = next.indexOf(sourceId);
    const to   = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, sourceId);
    onOrderChange(next);
  };
  const onDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
  };

  const toggleVisible = (id) => {
    const col = byId.get(id);
    if (col?.pinned) return; // can't hide pinned
    const next = visibleSet.has(id)
      ? visible.filter((x) => x !== id)
      : [...visible, id];
    onVisibleChange(next);
  };

  const btnStyle = {
    padding: "6px 10px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 4,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  const popStyle = {
    position: "absolute",
    top: "calc(100% + 4px)",
    right: 0,
    zIndex: 50,
    width: 280,
    maxHeight: 440,
    overflowY: "auto",
    background: "var(--surface-1, #121826)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
    padding: 8,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
  };

  const rowStyle = (id) => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 4px",
    borderRadius: 3,
    cursor: "grab",
    background: dragOverId === id && dragId !== id ? "var(--surface-3)" : "transparent",
    opacity: dragId === id ? 0.4 : 1,
  });

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={btnRef}
        type="button"
        style={btnStyle}
        onClick={() => setOpen((v) => !v)}
        title="Reorder or hide columns. Saves to your account."
      >
        {buttonLabel}
      </button>

      {open && (
        <div ref={popRef} style={popStyle} onDragEnd={onDragEnd}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "2px 4px 6px", borderBottom: "1px solid var(--border-faint)",
            marginBottom: 4,
          }}>
            <span style={{ fontWeight: 700, color: "var(--text)", letterSpacing: "0.08em" }}>
              COLUMNS
            </span>
            <button
              type="button"
              onClick={onReset}
              style={{
                background: "transparent", border: "none", color: "var(--text-dim)",
                fontFamily: "inherit", fontSize: 10, cursor: "pointer", padding: "2px 4px",
              }}
              title="Clear your saved layout and restore the stock defaults."
            >
              Reset
            </button>
          </div>

          <div style={{ fontSize: 9, color: "var(--text-dim)", padding: "0 4px 6px" }}>
            Drag to reorder. Check to show.
          </div>

          {orderedCols.map((col) => {
            const checked = visibleSet.has(col.id);
            const locked = !!col.pinned;
            return (
              <div
                key={col.id}
                style={rowStyle(col.id)}
                draggable={!locked}
                onDragStart={(e) => !locked && onDragStart(e, col.id)}
                onDragOver={(e) => onDragOver(e, col.id)}
                onDrop={(e) => onDrop(e, col.id)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    color: locked ? "var(--text-dim)" : "var(--text-muted)",
                    cursor: locked ? "not-allowed" : "grab",
                    width: 12, textAlign: "center", fontSize: 10,
                  }}
                  title={locked ? "Pinned column" : "Drag to reorder"}
                >
                  {locked ? "🔒" : "⋮⋮"}
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={() => toggleVisible(col.id)}
                  style={{ cursor: locked ? "not-allowed" : "pointer" }}
                />
                <span
                  style={{
                    color: "var(--text)",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={col.description || col.label}
                >
                  {col.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
