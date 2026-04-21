// TableColumnPicker — reusable popover for show/hide + drag-reorder of
// table columns. Used by PositionsTable and WatchlistTable.
//
// Staging model (Joe, 2026-04-21)
// -------------------------------
// The picker edits a LOCAL staging copy of {order, visible}. Nothing is
// persisted until the user clicks Save. Behavior:
//   • Open → staging is seeded from the current persisted props.
//   • Check / uncheck a column → updates staging only.
//   • Drag-reorder a row       → updates staging only.
//   • Save   → commits staging via onOrderChange + onVisibleChange, closes.
//   • Cancel → discards staging, closes. Outside-click and Escape also close
//              and discard (treated as implicit cancel).
//   • Reset  → calls onResetAll which wipes ALL persisted prefs for this
//              table (order + visible + widths). Also resets staging so the
//              popover reflects the defaults immediately. User still needs
//              to click Save to persist the reset order/visible — but the
//              onResetAll call has already nuked widths & the DB slice.
//
// Props
// -----
//   columns:        [{ id, label, description?, pinned? }]   full registry
//   order:          ["colId"...]   current persisted order
//   visible:        ["colId"...]   current persisted visibility
//   defaultOrder:   ["colId"...]   reset target for order
//   defaultVisible: ["colId"...]   reset target for visibility
//   onOrderChange:  (newOrder) => void      called on Save
//   onVisibleChange:(newVisible) => void    called on Save
//   onResetAll:     () => void              nukes the table's prefs slice
//   buttonLabel?:   string (default "Edit columns")

import { useEffect, useRef, useState } from "react";

export default function TableColumnPicker({
  columns,
  order,
  visible,
  defaultOrder,
  defaultVisible,
  onOrderChange,
  onVisibleChange,
  onResetAll,
  buttonLabel = "Edit columns",
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);
  const btnRef = useRef(null);

  // ─── Staging ───────────────────────────────────────────────────────────────
  // Reseeded from props each time the popover opens. Writes during an open
  // session update ONLY the staging state; persistence happens on Save.
  const [stagedOrder,   setStagedOrder]   = useState(order);
  const [stagedVisible, setStagedVisible] = useState(visible);
  useEffect(() => {
    if (open) {
      setStagedOrder(order);
      setStagedVisible(visible);
    }
    // Intentionally do NOT depend on order/visible — re-seeding while the
    // popover is open would overwrite the user's in-progress edits whenever
    // the parent re-renders (e.g., from a background scan refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click / Escape — both discard staging (implicit cancel).
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byId = new Map(columns.map((c) => [c.id, c]));
  const orderedCols = stagedOrder.map((id) => byId.get(id)).filter(Boolean);
  const stagedSet = new Set(stagedVisible);

  // ─── Drag-reorder (native HTML5 DnD) ───────────────────────────────────────
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
    const next = [...stagedOrder];
    const from = next.indexOf(sourceId);
    const to   = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, sourceId);
    setStagedOrder(next);
  };
  const onDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
  };

  // ─── Staging mutations ─────────────────────────────────────────────────────
  const toggleVisible = (id) => {
    const col = byId.get(id);
    if (col?.pinned) return; // can't hide pinned
    setStagedVisible((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const onSave = () => {
    onOrderChange(stagedOrder);
    onVisibleChange(stagedVisible);
    setOpen(false);
  };
  const onCancel = () => setOpen(false);
  const onReset = () => {
    // Reset the staged view AND the persisted slice (including widths) so the
    // full layout returns to defaults on close. User still needs Save to also
    // persist the default order/visible — though that's identical to what the
    // wipe above would have produced on the next prefs merge.
    setStagedOrder(defaultOrder);
    setStagedVisible(defaultVisible);
    if (typeof onResetAll === "function") onResetAll();
  };

  // ─── Styles ────────────────────────────────────────────────────────────────
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
    maxHeight: 480,
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-1, #121826)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
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

  const footerBtn = {
    padding: "5px 10px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    letterSpacing: "0.04em",
    border: "1px solid var(--border)",
    borderRadius: 4,
    cursor: "pointer",
    userSelect: "none",
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={btnRef}
        type="button"
        style={btnStyle}
        onClick={() => setOpen((v) => !v)}
        title="Reorder or hide columns. Click Save to persist."
      >
        {buttonLabel}
      </button>

      {open && (
        <div ref={popRef} style={popStyle} onDragEnd={onDragEnd}>
          {/* Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 10px 6px", borderBottom: "1px solid var(--border-faint)",
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

          {/* Scrolling row list */}
          <div style={{ overflowY: "auto", flex: 1, padding: "6px 8px" }}>
            <div style={{ fontSize: 9, color: "var(--text-dim)", padding: "0 4px 6px" }}>
              Drag to reorder. Check to show.
            </div>
            {orderedCols.map((col) => {
              const checked = stagedSet.has(col.id);
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
                    {locked ? "L" : "||"}
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

          {/* Footer — Cancel + Save */}
          <div style={{
            display: "flex", justifyContent: "flex-end", gap: 6,
            padding: "8px 10px", borderTop: "1px solid var(--border-faint)",
            background: "var(--surface-2, #1a2233)",
          }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                ...footerBtn,
                background: "transparent",
                color: "var(--text-muted)",
              }}
              title="Discard changes"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              style={{
                ...footerBtn,
                background: "var(--accent)",
                color: "#fff",
                borderColor: "var(--accent)",
              }}
              title="Save column layout"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
