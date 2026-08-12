/* DataTable — the site's ONE table control (Joe, 2026-08-11).

   The Paper positions table was hand-rolled: fixed column order, no sorting,
   no resizing, and a wall of prose in the last column. Joe's instruction was
   to stop building tables like that, so this is the shared control every data
   table on the site should use from here on.

   What a reader gets:
     · click a header to sort (first click is descending for numbers, ascending
       for text — the useful direction in each case), click again to reverse
     · drag the grip on a header's right edge to resize a column
     · drag a header onto another to reorder columns
     · "Columns" menu to show/hide, and one button to reset the layout
     · layout (order, widths, hidden set, sort) persists per table id in
       localStorage, so a reader's arrangement survives a reload

   Deliberately NOT included: pagination, filtering, virtualisation. The tables
   on this site are tens of rows; adding machinery for thousands would be
   inventing a requirement.

   Summary rows (cash, totals) are passed as `summary` and rendered in a real
   <tfoot> against the SAME colgroup, each value anchored to a COLUMN KEY — so
   a summary number stays under its column no matter how the reader reorders or
   hides things. If its column is hidden the value falls to the last visible
   column rather than disappearing.

   Props:
     id        string, storage key for the saved layout
     columns   [{ key, label, tip, align:'l'|'r', width, minWidth, hidden,
                  noHide, render(row), sortValue(row), cellClass(row) }]
     rows      array of row objects
     rowKey    (row) => string
     initialSort { key, dir:'asc'|'desc' }
     summary   [{ label, labelTip, at: <columnKey>, value, valueClass, strong }]
     onRowClick optional
*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/datatable.css';

const STORE_PREFIX = 'mt.table.';
const DEFAULT_WIDTH = 110;
const MIN_WIDTH = 56;

function loadLayout(id) {
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function saveLayout(id, layout) {
  try { window.localStorage.setItem(STORE_PREFIX + id, JSON.stringify(layout)); } catch (_) { /* private mode */ }
}

export default function DataTable({
  id,
  columns,
  rows,
  rowKey = (r, i) => String(i),
  initialSort = null,
  summary = [],
  onRowClick = null,
  className = '',
  toolbarLeft = null,
}) {
  const colByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns]);
  const defaults = useMemo(() => ({
    order: columns.map((c) => c.key),
    widths: Object.fromEntries(columns.map((c) => [c.key, c.width || DEFAULT_WIDTH])),
    hidden: columns.filter((c) => c.hidden).map((c) => c.key),
    sort: initialSort,
  }), [columns, initialSort]);

  const [layout, setLayout] = useState(defaults);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const dragKey = useRef(null);
  const resizing = useRef(null);

  // Restore a saved layout once, reconciled against the CURRENT column set —
  // a saved order from an older build must not hide a column added since.
  useEffect(() => {
    const saved = loadLayout(id);
    if (!saved) { setLayout(defaults); return; }
    const known = new Set(columns.map((c) => c.key));
    const order = (saved.order || []).filter((k) => known.has(k));
    for (const c of columns) if (!order.includes(c.key)) order.push(c.key);
    setLayout({
      order,
      widths: { ...defaults.widths, ...(saved.widths || {}) },
      hidden: (saved.hidden || []).filter((k) => known.has(k) && !colByKey[k]?.noHide),
      sort: saved.sort ?? defaults.sort,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, columns]);

  const update = useCallback((next) => {
    setLayout((prev) => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      saveLayout(id, merged);
      return merged;
    });
  }, [id]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const away = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menuOpen]);

  const hiddenSet = useMemo(() => new Set(layout.hidden || []), [layout.hidden]);
  const visible = useMemo(
    () => (layout.order || []).map((k) => colByKey[k]).filter((c) => c && !hiddenSet.has(c.key)),
    [layout.order, colByKey, hiddenSet],
  );

  // ── sorting ───────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const s = layout.sort;
    if (!s || !colByKey[s.key]) return rows;
    const col = colByKey[s.key];
    const val = col.sortValue || ((r) => r[col.key]);
    const dir = s.dir === 'asc' ? 1 : -1;
    // Nulls always sort last, in BOTH directions — an em-dash is absence, not
    // a small number, and a column of them must never take the top of a sort.
    return [...rows].sort((a, b) => {
      const av = val(a); const bv = val(b);
      const an = av == null || (typeof av === 'number' && Number.isNaN(av));
      const bn = bv == null || (typeof bv === 'number' && Number.isNaN(bv));
      if (an && bn) return 0;
      if (an) return 1;
      if (bn) return -1;
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(av).localeCompare(String(bv));
      }
      return dir * (av - bv);
    });
  }, [rows, layout.sort, colByKey]);

  const toggleSort = (col) => {
    update((prev) => {
      const cur = prev.sort;
      const numeric = col.align === 'r';
      if (!cur || cur.key !== col.key) return { ...prev, sort: { key: col.key, dir: numeric ? 'desc' : 'asc' } };
      return { ...prev, sort: { key: col.key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } };
    });
  };

  // ── resizing ──────────────────────────────────────────────────────────────
  const startResize = (e, col) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { key: col.key, x: e.clientX, w: layout.widths[col.key] || DEFAULT_WIDTH };
    const move = (ev) => {
      const r = resizing.current;
      if (!r) return;
      const w = Math.max(col.minWidth || MIN_WIDTH, r.w + (ev.clientX - r.x));
      setLayout((prev) => ({ ...prev, widths: { ...prev.widths, [r.key]: w } }));
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      resizing.current = null;
      setLayout((prev) => { saveLayout(id, prev); return prev; });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  // ── reordering ────────────────────────────────────────────────────────────
  const onDragStart = (e, col) => { dragKey.current = col.key; e.dataTransfer.effectAllowed = 'move'; };
  const onDrop = (e, col) => {
    e.preventDefault();
    const from = dragKey.current;
    dragKey.current = null;
    if (!from || from === col.key) return;
    update((prev) => {
      const order = prev.order.filter((k) => k !== from);
      order.splice(order.indexOf(col.key), 0, from);
      return { ...prev, order };
    });
  };

  const reset = () => { try { window.localStorage.removeItem(STORE_PREFIX + id); } catch (_) { /* noop */ } setLayout(defaults); setMenuOpen(false); };

  const sortMark = (col) => {
    const s = layout.sort;
    if (!s || s.key !== col.key) return null;
    return <span className="dt-sort">{s.dir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className={`dt-wrap ${className}`}>
      <div className="dt-toolbar">
        <div className="dt-toolbar-left">{toolbarLeft}</div>
        <div className="dt-colmenu" ref={menuRef}>
          <button type="button" className="dt-colbtn" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            Columns
          </button>
          {menuOpen && (
            <div className="dt-menu" role="menu">
              <div className="dt-menu-head">Show columns</div>
              {(layout.order || []).map((k) => colByKey[k]).filter(Boolean).map((c) => (
                <label key={c.key} className={`dt-menu-row${c.noHide ? ' locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!hiddenSet.has(c.key)}
                    disabled={!!c.noHide}
                    onChange={() => update((prev) => ({
                      ...prev,
                      hidden: hiddenSet.has(c.key)
                        ? prev.hidden.filter((x) => x !== c.key)
                        : [...prev.hidden, c.key],
                    }))}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
              <button type="button" className="dt-menu-reset" onClick={reset}>Reset layout</button>
            </div>
          )}
        </div>
      </div>

      <div className="dt-scroll">
        <table className="dt-table">
          <colgroup>
            {visible.map((c) => <col key={c.key} style={{ width: `${layout.widths[c.key] || DEFAULT_WIDTH}px` }} />)}
          </colgroup>
          <thead>
            <tr>
              {visible.map((c) => (
                <th
                  key={c.key}
                  className={`${c.align === 'r' ? 'r' : ''}${layout.sort?.key === c.key ? ' sorted' : ''}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, c)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(e, c)}
                >
                  <span
                    className="dt-th"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSort(c)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(c); } }}
                    {...(c.tip ? { 'data-tip': c.tip } : {})}
                  >
                    {c.label}{sortMark(c)}
                  </span>
                  <span className="dt-grip" onMouseDown={(e) => startResize(e, c)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={onRowClick ? 'clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {visible.map((c) => (
                  <td key={c.key} className={`${c.align === 'r' ? 'r' : ''} ${c.cellClass ? c.cellClass(row) : ''}`}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {summary.length > 0 && (
            <tfoot>
              {summary.map((s, si) => {
                // The label spans every column BEFORE its value's column, so a
                // summary label is never clipped by the width of column one
                // (which is usually a narrow ticker column).
                let ai = visible.findIndex((c) => c.key === s.at);
                if (ai < 1) ai = visible.length - 1;
                const trailing = visible.length - ai - 1;
                return (
                  <tr key={s.label} className={`dt-foot${s.strong ? ' strong' : ''}${si === 0 ? ' first' : ''}`}>
                    <td className="dt-foot-label" colSpan={ai}>
                      {s.labelTip ? <span className="dt-tip" data-tip={s.labelTip}>{s.label}</span> : s.label}
                    </td>
                    <td className={`r ${s.valueClass || ''}`}>{s.value}</td>
                    {trailing > 0 && <td colSpan={trailing} />}
                  </tr>
                );
              })}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
