/* All Indicators — table with a "Used for" column and user-controllable
   columns (sort by any header, drag a header edge to resize, drag a header to
   reorder). Column order + widths persist per browser via localStorage. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Sparkline from '../components/Sparkline';
import FreshnessChip from '../components/FreshnessChip';
import IndicatorDetail from '../components/IndicatorDetail';
import useIndicators from '../lib/useIndicators';
import { useSearchParams } from 'react-router-dom';
import '../styles/home-system.css';
import '../styles/indicators-glass.css';

/* DetailModal — the centered "pill modal" used across the site (matches Macro
   Overview). Replaces the old inline drawer that opened below the row. */
function DetailModal({ onClose, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  const target = (typeof document !== 'undefined' && (document.querySelector('.mt-overhaul') || document.body)) || null;
  if (!target) return null;
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,28,.55)', zIndex: 5000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px 64px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 'min(1080px, 95vw)', background: 'var(--mt-surface, #fff)', borderRadius: 18, boxShadow: '0 24px 70px rgba(20,30,45,.4)' }}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 14, right: 16, border: 'none', background: 'none', fontSize: 26, lineHeight: 1, color: 'var(--mt-ink-3)', cursor: 'pointer', zIndex: 2 }}>×</button>
        {children}
      </div>
    </div>,
    target,
  );
}

const DOMAINS = ['All', 'Rates', 'Credit', 'Equities', 'Commodities', 'FX', 'Financial Conditions & Economy'];

function fmtNum(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
function fmtFreq(freq) {
  const f = String(freq || '').toUpperCase();
  if (f === 'D') return 'Daily';
  if (f === 'W') return 'Weekly';
  if (f === 'M') return 'Monthly';
  if (f === 'Q') return 'Quarterly';
  return freq || '—';
}

/* "Used for" — does the indicator drive the two-axis engine read on the
   Macro Overview, or is it backdrop only ("Reference"). The engine has two
   axes: a stress signal (equity vs defensive) driven by MOVE, and a
   yield-regime axis driven by the 10Y Treasury yield. MOVE is the only one
   of those that is also a tile on this page. Producer:
   scripts/compute_macrotilt_engine.py. Keep this set in sync with it. */
const ENGINE_IDS = new Set([
  'move',
]);
function usedFor(id) {
  return ENGINE_IDS.has(id) ? 'Engine' : 'Reference';
}

/* Column catalog. `sortKey` null = not sortable. `num` = right-aligned. */
const COLUMNS = [
  {
    key: 'name', label: 'Indicator', sortKey: 'name', width: 210,
    render: (i) => (
      <div className="al-tk">
        <div className="al-tkname">{i.name}</div>
        <div className="al-tkcode">{i.id}</div>
      </div>
    ),
  },
  {
    key: 'domain', label: 'Category', sortKey: 'domain', width: 112,
    render: (i) => <span className="al-cat">{i.domain}</span>,
  },
  {
    key: 'usedFor', label: 'Used for', sortKey: 'usedFor', width: 130,
    render: (i) => {
      const r = usedFor(i.id);
      return (
        <span style={{
          fontSize: 11.5,
          color: r === 'Reference' ? 'var(--mt-ink-3)' : 'var(--mt-ink-1)',
          fontWeight: r === 'Reference' ? 400 : 500,
        }}>{r}</span>
      );
    },
  },
  {
    key: 'freq', label: 'Freq', sortKey: 'freq', width: 92,
    render: (i) => <span className="al-freq">{i.cadenceLabel || fmtFreq(i.freq)}</span>,
  },
  {
    key: 'refresh', label: 'Last refresh', sortKey: 'asOf', width: 120,
    render: (i) => (
      <FreshnessChip elementId={i.manifestId} fallback={{ asOfIso: i.asOf }} variant="label" />
    ),
  },
  {
    key: 'value', label: 'Current', sortKey: 'value', num: true, width: 112,
    render: (i) => (
      <span className={`al-current al-current--${i.state}`}>
        {fmtNum(i.value, i.decimals ?? 2)}<span className="al-unit">{i.unit}</span>
      </span>
    ),
  },
  {
    key: 'prior_3m', label: '3M ago', sortKey: 'prior_3m', num: true, width: 92,
    render: (i) => <span className="al-historical">{fmtNum(i.prior_3m, i.decimals ?? 2)}</span>,
  },
  {
    key: 'prior_6m', label: '6M ago', sortKey: 'prior_6m', num: true, width: 92,
    render: (i) => <span className="al-historical">{fmtNum(i.prior_6m, i.decimals ?? 2)}</span>,
  },
  {
    key: 'prior_1y', label: '1Y ago', sortKey: 'prior_1y', num: true, width: 92,
    render: (i) => <span className="al-historical">{fmtNum(i.prior_1y, i.decimals ?? 2)}</span>,
  },
  {
    key: 'spark', label: '5y', sortKey: null, width: 160,
    render: (i, ctx) => <Sparkline data={ctx.trendPts} width={140} height={22} stroke={ctx.color} showDot={false} />,
  },
];
const COL_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
const DEFAULT_ORDER = COLUMNS.map((c) => c.key);
const ORDER_LS = 'al_col_order_v1';
const WIDTH_LS = 'al_col_widths_v1';

function loadOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_LS) || 'null');
    if (Array.isArray(raw)) {
      const known = raw.filter((k) => COL_BY_KEY[k]);
      const missing = DEFAULT_ORDER.filter((k) => !known.includes(k));
      return [...known, ...missing];
    }
  } catch { /* ignore */ }
  return [...DEFAULT_ORDER];
}
function loadWidths() {
  const base = Object.fromEntries(COLUMNS.map((c) => [c.key, c.width]));
  try {
    const raw = JSON.parse(localStorage.getItem(WIDTH_LS) || 'null');
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(base)) {
        if (Number.isFinite(raw[k])) base[k] = raw[k];
      }
    }
  } catch { /* ignore */ }
  return base;
}

/* Value a row sorts by for a given key (handles derived columns). */
function sortVal(i, key) {
  if (key === 'usedFor') return usedFor(i.id);
  if (key === 'state') {
    return { extreme: 2, elevated: 1, calm: 0 }[i.state] ?? -1;
  }
  return i[key];
}

export default function IndicatorsPage() {
  const { active, loading, indexSeries } = useIndicators();
  const [domain, setDomain] = useState('All');
  const [sort, setSort] = useState({ key: 'state', dir: 'desc' });
  const [drill, setDrill] = useState(null);

  const [colOrder, setColOrder] = useState(loadOrder);
  const [colWidths, setColWidths] = useState(loadWidths);
  const [dragKey, setDragKey] = useState(null);
  const [searchParams] = useSearchParams();
  // Deep-link: /indicators?ind=<id> opens that indicator's detail and scrolls to it.
  useEffect(() => {
    const want = searchParams.get('ind');
    if (!want || !active?.length || !active.some((i) => i.id === want)) return;
    setDomain('All');
    setDrill(want);
    const t = setTimeout(() => {
      document.getElementById(`ind-row-${want}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => clearTimeout(t);
  }, [searchParams, active]);
  const resizingRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(ORDER_LS, JSON.stringify(colOrder)); } catch { /* ignore */ }
  }, [colOrder]);
  useEffect(() => {
    try { localStorage.setItem(WIDTH_LS, JSON.stringify(colWidths)); } catch { /* ignore */ }
  }, [colWidths]);

  const orderedCols = useMemo(
    () => colOrder.map((k) => COL_BY_KEY[k]).filter(Boolean),
    [colOrder],
  );

  const filtered = useMemo(() => {
    let rows = active;
    if (domain !== 'All') rows = rows.filter((i) => i.domain === domain);
    const arr = [...rows];
    const key = sort.key;
    const dir = sort.dir === 'desc' ? -1 : 1;
    arr.sort((a, b) => {
      const av = sortVal(a, key);
      const bv = sortVal(b, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
  }, [active, domain, sort]);

  function toggleSort(key) {
    if (!key) return;
    setSort((p) => p.key === key ? { key, dir: p.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  }
  function arrow(key) {
    if (!key || sort.key !== key) return '';
    return sort.dir === 'desc' ? ' ↓' : ' ↑';
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  function startResize(e, key) {
    e.stopPropagation();
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startW = colWidths[key] ?? COL_BY_KEY[key].width;
    const onMove = (ev) => {
      const w = Math.max(60, Math.round(startW + (ev.clientX - startX)));
      setColWidths((p) => ({ ...p, [key]: w }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Defer clearing so the header's click/dragstart sees we were resizing.
      setTimeout(() => { resizingRef.current = false; }, 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Reorder (drag a header onto another) ────────────────────────────────────
  function onDragStart(e, key) {
    if (resizingRef.current) { e.preventDefault(); return; }
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDrop(e, key) {
    e.preventDefault();
    if (!dragKey || dragKey === key) { setDragKey(null); return; }
    setColOrder((prev) => {
      const arr = prev.filter((k) => k !== dragKey);
      const idx = arr.indexOf(key);
      arr.splice(idx < 0 ? arr.length : idx, 0, dragKey);
      return arr;
    });
    setDragKey(null);
  }

  return (
    <div className="home-v11 indicators-page mt-fade">
      <div className="shell">
      <section className="sc-hero-solo">
        <div className="glass sc-ed">
          <div className="ed-eyebrow">● All indicators</div>
          <h1>Every indicator tracked on <i>MacroTilt</i> — what it is, why it matters, how it's used.</h1>
          <p className="ed-deck">Sourced live from the data registry, across <b>Rates</b>, <b>Credit</b>, <b>Equities</b>, <b>Commodities</b>, <b>FX</b>, the <b>Economy</b>, and <b>Financial Conditions</b>.</p>
        </div>
      </section>

      <section className="mt-pagesection mt-pagesection--tight">
        <div className="al-toolbar mt-card">
          <div className="al-row">
            <div className="mt-eyebrow">Category</div>
            <div className="mt-pillgroup">
              {DOMAINS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`mt-pill ${domain === d ? 'on' : ''}`}
                  onClick={() => setDomain(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="al-row al-row--push">
            <span style={{ fontSize: 11, color: 'var(--mt-ink-3)' }}>
              Click a header to sort · drag a header to reorder · drag its right edge to resize
            </span>
          </div>
        </div>
      </section>

      <section className="mt-pagesection mt-pagesection--tight2">
        {loading ? (
          <div className="mt-loadingcard">Loading indicators…</div>
        ) : (
          <div className="mt-tablecard" style={{ overflowX: 'auto' }}>
            <table className="al-table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                {orderedCols.map((c) => (
                  <col key={c.key} style={{ width: `${colWidths[c.key] ?? c.width}px` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {orderedCols.map((c) => (
                    <th
                      key={c.key}
                      className={c.num ? 'num' : ''}
                      draggable
                      onDragStart={(e) => onDragStart(e, c.key)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDrop(e, c.key)}
                      onClick={() => { if (!resizingRef.current) toggleSort(c.sortKey); }}
                      title={c.sortKey ? 'Click to sort · drag to reorder' : 'Drag to reorder'}
                      style={{
                        position: 'relative',
                        cursor: c.sortKey ? 'pointer' : 'grab',
                        userSelect: 'none',
                        opacity: dragKey === c.key ? 0.5 : 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.label}{arrow(c.sortKey)}
                      <span
                        onMouseDown={(e) => startResize(e, c.key)}
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          height: '100%',
                          width: 8,
                          cursor: 'col-resize',
                        }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const isOpen = drill === i.id;
                  const color =
                    i.state === 'extreme'
                      ? 'var(--mt-down)'
                      : i.state === 'elevated'
                        ? 'var(--mt-warn)'
                        : 'var(--mt-up)';
                  const trendPts = (i.points || [])
                    .slice(-Math.min(1260, (i.points || []).length))
                    .map((p) => p[1])
                    .filter(Number.isFinite);
                  const ctx = { color, trendPts };
                  return (
                    <React.Fragment key={i.id}>
                      <tr id={`ind-row-${i.id}`} className={`al-row-tr ${isOpen ? 'open' : ''}`} onClick={() => setDrill(isOpen ? null : i.id)}>
                        {orderedCols.map((c) => (
                          <td
                            key={c.key}
                            className={`${c.num ? 'num ' : ''}${c.key === 'spark' ? 'al-sparkcell' : ''}`.trim()}
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                          >
                            {c.render(i, ctx)}
                          </td>
                        ))}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="al-tablefoot">
          <span>
            Showing <b className="num">{filtered.length}</b> of <b className="num">{active.length}</b> indicators
          </span>
          {!loading && <FreshnessChip elementId="market-universe_master-daily" variant="label" />}
        </div>
      </section>
      </div>
      {drill && (() => {
        const ind = active.find((i) => i.id === drill);
        return ind ? (
          <DetailModal onClose={() => setDrill(null)}>
            <IndicatorDetail ind={ind} onClose={() => setDrill(null)} indexSeries={indexSeries} />
          </DetailModal>
        ) : null;
      })()}
    </div>
  );
}
