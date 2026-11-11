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

   Added 2026-11-11 for the Watchlist page (every table on the site gets them):
     · shift-click a second header to sort within the first (up to three)
     · double-click a header's right edge to fit that column to its contents;
       "Fit all" does every column at once
     · columns that carry a `group` get a searchable, grouped Columns menu
     · optional: rows dragged into a manual order (`onRowReorder`), rows
       gathered under group headings (`groupBy`), and a layout kept by the
       caller instead of the browser (`layout` + `onLayoutChange`)

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
     layout / onLayoutChange   caller-owned layout (e.g. saved to the signed-in
                               user); when absent the browser keeps it
     onRowReorder(fromKey, toKey)  enables dragging rows; only offered while no
                               sort is applied, because a sort IS the order
     groupBy   { value(row) -> string|null, emptyLabel }  group headings
     fitAll    show the "Fit all" button (default true)
*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/datatable.css';

const STORE_PREFIX = 'mt.table.';
const DEFAULT_WIDTH = 110;
const MIN_WIDTH = 56;
const MAX_SORTS = 3;
const FIT_PAD = 6;

// A saved sort is one {key, dir} (every layout before 2026-11-11) or a list.
function sortList(sort) {
  if (!sort) return [];
  return (Array.isArray(sort) ? sort : [sort]).filter((x) => x && x.key);
}

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
  layout: extLayout = null,
  onLayoutChange = null,
  onRowReorder = null,
  groupBy = null,
  fitAll = true,
}) {
  const controlled = typeof onLayoutChange === 'function';
  const colByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns]);
  const defaults = useMemo(() => ({
    order: columns.map((c) => c.key),
    widths: Object.fromEntries(columns.map((c) => [c.key, c.width || DEFAULT_WIDTH])),
    hidden: columns.filter((c) => c.hidden).map((c) => c.key),
    sort: initialSort,
  }), [columns, initialSort]);

  const [layout, setLayout] = useState(defaults);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuQuery, setMenuQuery] = useState('');
  const menuRef = useRef(null);
  const tableRef = useRef(null);
  const rowDrag = useRef(null);
  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;
  const dragKey = useRef(null);
  const resizing = useRef(null);

  // Restore a saved layout once, reconciled against the CURRENT column set —
  // a saved order from an older build must not hide a column added since.
  const extKey = controlled ? JSON.stringify(extLayout || null) : '';
  useEffect(() => {
    const saved = controlled ? extLayout : loadLayout(id);
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
  }, [id, columns, extKey]);

  const persist = useCallback((next) => {
    if (onLayoutChangeRef.current) onLayoutChangeRef.current(next);
    else saveLayout(id, next);
  }, [id]);

  const update = useCallback((next) => {
    setLayout((prev) => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      persist(merged);
      return merged;
    });
  }, [persist]);

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
  const sorts = useMemo(() => sortList(layout.sort).filter((x) => colByKey[x.key]), [layout.sort, colByKey]);
  const sorted = useMemo(() => {
    if (!sorts.length) return rows;
    // Nulls always sort last, in BOTH directions — an em-dash is absence, not
    // a small number, and a column of them must never take the top of a sort.
    const cmp = (s, a, b) => {
      const col = colByKey[s.key];
      const val = col.sortValue || ((r) => r[col.key]);
      const dir = s.dir === 'asc' ? 1 : -1;
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
    };
    return [...rows].sort((a, b) => {
      for (const s of sorts) { const c = cmp(s, a, b); if (c) return c; }
      return 0;
    });
  }, [rows, sorts, colByKey]);

  // Click sorts by this column alone; shift-click adds it beneath the sorts
  // already applied (or flips it if it is one of them).
  const toggleSort = (col, additive = false) => {
    update((prev) => {
      const cur = sortList(prev.sort);
      const first = col.align === 'r' ? 'desc' : 'asc';
      const at = cur.findIndex((x) => x.key === col.key);
      if (additive && cur.length) {
        if (at >= 0) return { ...prev, sort: cur.map((x, i) => (i === at ? { key: x.key, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x)) };
        return { ...prev, sort: [...cur, { key: col.key, dir: first }].slice(0, MAX_SORTS) };
      }
      if (cur.length === 1 && at === 0) return { ...prev, sort: [{ key: col.key, dir: cur[0].dir === 'asc' ? 'desc' : 'asc' }] };
      return { ...prev, sort: [{ key: col.key, dir: first }] };
    });
  };
  const clearSort = () => update((prev) => ({ ...prev, sort: [] }));

  // ── fit to contents ───────────────────────────────────────────────────────
  // Measured from the rendered cells: collapse the column, read how wide its
  // header and every cell want to be, and take the widest.
  const measure = (keys) => {
    const table = tableRef.current;
    if (!table) return {};
    const cols = table.querySelectorAll('colgroup col');
    const lead = table.querySelector('colgroup col.dt-col-drag') ? 1 : 0;
    const out = {};
    const prevLayout = table.style.tableLayout;
    const prevWidth = table.style.width;
    table.style.tableLayout = 'auto';
    table.style.width = 'max-content';
    const saved = [];
    cols.forEach((c) => { saved.push(c.style.width); if (!c.classList.contains('dt-col-drag')) c.style.width = 'auto'; });
    const head = table.querySelectorAll('thead th');
    keys.forEach((k) => {
      const i = visible.findIndex((c) => c.key === k);
      if (i < 0) return;
      const th = head[i + lead];
      if (!th) return;
      const col = colByKey[k];
      const w = Math.ceil(th.getBoundingClientRect().width) + FIT_PAD;
      out[k] = Math.max(col.minWidth || MIN_WIDTH, Math.min(w, col.maxWidth || 420));
    });
    cols.forEach((c, i) => { c.style.width = saved[i]; });
    table.style.tableLayout = prevLayout;
    table.style.width = prevWidth;
    return out;
  };
  const fitColumns = (keys) => {
    const widths = measure(keys);
    if (Object.keys(widths).length) update((prev) => ({ ...prev, widths: { ...prev.widths, ...widths } }));
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
      setLayout((prev) => { persist(prev); return prev; });
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

  const reset = () => {
    if (controlled) persist(defaults);
    else { try { window.localStorage.removeItem(STORE_PREFIX + id); } catch (_) { /* noop */ } }
    setLayout(defaults); setMenuOpen(false);
  };

  const sortMark = (col) => {
    const at = sorts.findIndex((x) => x.key === col.key);
    if (at < 0) return null;
    return (
      <span className="dt-sort">
        {sorts[at].dir === 'asc' ? '↑' : '↓'}{sorts.length > 1 ? <sup className="dt-sort-n">{at + 1}</sup> : null}
      </span>
    );
  };

  // ── manual row order ──────────────────────────────────────────────────────
  const canDragRows = typeof onRowReorder === 'function' && sorts.length === 0 && !groupBy;
  const showDragCol = typeof onRowReorder === 'function';

  // ── grouping ──────────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const order = []; const by = new Map();
    sorted.forEach((r) => {
      const g = groupBy.value(r) || groupBy.emptyLabel || 'Other';
      if (!by.has(g)) { by.set(g, []); order.push(g); }
      by.get(g).push(r);
    });
    const empty = groupBy.emptyLabel || 'Other';
    order.sort((a, b) => (a === empty) - (b === empty) || a.localeCompare(b));
    return order.map((g) => ({ label: g, rows: by.get(g) }));
  }, [sorted, groupBy]);

  // ── columns menu (grouped + searchable when columns carry a group) ────────
  const menuCols = (layout.order || []).map((k) => colByKey[k]).filter(Boolean);
  const hasGroups = menuCols.some((c) => c.group);
  const q = menuQuery.trim().toLowerCase();
  const menuShown = q ? menuCols.filter((c) => `${c.menuLabel || c.label} ${c.group || ''}`.toLowerCase().includes(q)) : menuCols;
  const menuGroups = hasGroups
    ? [...new Set(columns.map((c) => c.group || 'Other'))].map((g) => ({ g, cols: menuShown.filter((c) => (c.group || 'Other') === g) })).filter((x) => x.cols.length)
    : [{ g: null, cols: menuShown }];
  const colSpanAll = visible.length + (showDragCol ? 1 : 0);

  const renderRow = (row, i) => {
    const k = rowKey(row, i);
    return (
      <tr
        key={k}
        className={onRowClick ? 'clickable' : undefined}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        draggable={canDragRows || undefined}
        onDragStart={canDragRows ? (e) => { rowDrag.current = k; e.dataTransfer.effectAllowed = 'move'; } : undefined}
        onDragOver={canDragRows ? (e) => { if (rowDrag.current) e.preventDefault(); } : undefined}
        onDrop={canDragRows ? (e) => {
          e.preventDefault();
          const from = rowDrag.current; rowDrag.current = null;
          if (from && from !== k) onRowReorder(from, k);
        } : undefined}
      >
        {showDragCol && (
          <td className={`dt-drag${canDragRows ? '' : ' off'}`} aria-hidden="true">{canDragRows ? '⠿' : ''}</td>
        )}
        {visible.map((c) => (
          <td key={c.key} data-col={c.key} className={`${c.align === 'r' ? 'r' : ''} ${c.cellClass ? c.cellClass(row) : ''}`}>
            {c.render ? c.render(row) : row[c.key]}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className={`dt-wrap ${className}`}>
      <div className="dt-toolbar">
        <div className="dt-toolbar-left">{toolbarLeft}</div>
        <div className="dt-colmenu" ref={menuRef}>
          {showDragCol && sorts.length > 0 && (
            <button type="button" className="dt-colbtn" onClick={clearSort} data-tip="Remove the sort and go back to your own order. Drag a row to move it.">
              My order
            </button>
          )}
          {fitAll && (
            <button type="button" className="dt-colbtn" onClick={() => fitColumns(visible.map((c) => c.key))}>
              Fit all
            </button>
          )}
          <button type="button" className="dt-colbtn" onClick={() => { setMenuOpen((v) => !v); setMenuQuery(''); }} aria-expanded={menuOpen}>
            Columns
          </button>
          {menuOpen && (
            <div className={`dt-menu${hasGroups ? ' dt-menu--wide' : ''}`} role="menu">
              {hasGroups ? (
                <input
                  className="dt-menu-search"
                  type="search"
                  placeholder="Find a column"
                  aria-label="Find a column"
                  value={menuQuery}
                  onChange={(e) => setMenuQuery(e.target.value)}
                  autoFocus
                />
              ) : <div className="dt-menu-head">Show columns</div>}
              <div className="dt-menu-list">
                {menuGroups.map(({ g, cols }) => (
                  <React.Fragment key={g || 'all'}>
                    {g ? <div className="dt-menu-head">{g}</div> : null}
                    {cols.map((c) => (
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
                        <span>{c.menuLabel || c.label}</span>
                      </label>
                    ))}
                  </React.Fragment>
                ))}
                {menuShown.length === 0 ? <div className="dt-menu-none">No column matches.</div> : null}
              </div>
              <button type="button" className="dt-menu-reset" onClick={reset}>Reset layout</button>
            </div>
          )}
        </div>
      </div>

      <div className="dt-scroll">
        <table className="dt-table" ref={tableRef}>
          <colgroup>
            {showDragCol && <col className="dt-col-drag" />}
            {visible.map((c) => <col key={c.key} data-col={c.key} style={{ width: `${layout.widths[c.key] || DEFAULT_WIDTH}px` }} />)}
          </colgroup>
          <thead>
            <tr>
              {showDragCol && <th className="dt-drag" aria-hidden="true" />}
              {visible.map((c) => (
                <th
                  key={c.key}
                  data-col={c.key}
                  className={`${c.align === 'r' ? 'r' : ''}${sorts.some((x) => x.key === c.key) ? ' sorted' : ''}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, c)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(e, c)}
                >
                  <span
                    className="dt-th"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => toggleSort(c, e.shiftKey)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(c, e.shiftKey); } }}
                    {...(c.tip ? { 'data-tip': c.tip } : {})}
                  >
                    {c.label}{sortMark(c)}
                  </span>
                  <span className="dt-grip" onMouseDown={(e) => startResize(e, c)} onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); fitColumns([c.key]); }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped
              ? grouped.map((g) => (
                <React.Fragment key={`g:${g.label}`}>
                  <tr className="dt-group"><td colSpan={colSpanAll}>{g.label}<span className="dt-group-n">{g.rows.length}</span></td></tr>
                  {g.rows.map(renderRow)}
                </React.Fragment>
              ))
              : sorted.map(renderRow)}
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
                    <td className="dt-foot-label" colSpan={ai + (showDragCol ? 1 : 0)}>
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
