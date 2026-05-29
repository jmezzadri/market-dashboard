// PaperPortfolioPage — Paper Trading Portfolio results page.
//
// Brand-aligned 2026-05-27 (round 3, Joe directive): adopts the canonical
// PageHero pattern used by EVERY other v2 page (Trading Opportunities,
// Macro Overview, Asset Tilt, Portfolio Insights). Editorial Fraunces
// headline with <em> italic accent phrases, bulleted "how it works" list
// on the left, bespoke summary stat-card on the right — same scaffold
// as every other top-level page. PR #868/#869 had matched the wrong cluster
// pattern (the editorial Inter hero used only by Home / Insights); per
// the locked spec in PageHero.jsx, EVERY page must use the same header.
//
// Reads four Supabase tables populated by the paper_portfolio nightly
// runner:
//   * paper_accounts        — sleeve caps + leverage cap (one row)
//   * paper_nav_daily       — daily NAV path for the chart + headline numbers
//   * paper_positions       — latest snapshot's per-name positions, by sleeve
//   * paper_orders          — recent order intents + their submitted/filled
//                              status (the rebalance trail)
//
// Senior Quant guard:
//   * Sleeve attribution comes straight from the DB column (we do NOT
//     re-infer in the UI).
//   * Leverage badge fires when sleeve_b_margin_used > 0.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageHero from '../components/PageHero';
import FreshnessChip from '../components/FreshnessChip';
import { supabase } from '../../lib/supabase';
import { InfoTip } from '../../InfoTip';

const STARTING_CAPITAL = 1_000_000;       // $1M paper, locked

// Risk-on / risk-off palette (fallbacks because the global tokens aren't
// defined outside .scenarios-page).
const UP_COLOR   = 'var(--up, #1f8a5a)';
const DOWN_COLOR = 'var(--down, #b62121)';
const WARN_COLOR = 'var(--warn, #b87000)';

// ── Editorial hero copy — Fraunces italic accents inside the title ────────

const HERO_TITLE = (
  <>
    A <em>$1M paper book</em> on Alpaca, split in half &mdash; Sleeve A follows the{' '}
    <em>Asset Tilt</em> engine; Sleeve B follows the <em>Equity Scanner</em> long-only with up to 2&times; leverage on overflow buy signals.
  </>
);

const HERO_BULLETS = [
  'Sleeve A — 24 industry-group ETFs at the engine’s recommended weights, $500K capital, unlevered',
  'Sleeve B — long-only equities at MacroTilt Score ≥ 5, sized $50K / $40K / $30K by tier',
  'Idle cash sits as literal cash — no bond proxy. Borrow on Sleeve B only when buy signals exceed available cash.',
  'Orders go to Alpaca as market-on-open the next trading day',
];

// ── small helpers ──────────────────────────────────────────────────────────

const fmtMoneyExact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

const fmtMoneyShort = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtPct = (n, places = 2) => {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(places)}%`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

// ── Page-scoped styles (component-local; no globals) ──────────────────────

const PAGE_CSS = `
.paper-shell { max-width: 1440px; margin: 0 auto; padding: 0 32px 64px; }

/* Right-side summary card on the hero — mirrors the Trading Opps
   "Latest Scan Results" stat block. */
.paper-tile-summary {
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: 14px;
  padding: 22px 24px;
  display: flex; flex-direction: column; gap: 14px;
}
.paper-tile-summary .pts-head {
  display: flex; justify-content: space-between; align-items: baseline;
}
.paper-tile-summary .pts-title {
  font-size: 12.5px; font-weight: 600; color: var(--ink-0); letter-spacing: .02em;
}
.paper-tile-summary .pts-asof { font-size: 11px; color: var(--ink-2); letter-spacing: .04em; }
.paper-tile-summary .pts-nav-eyebrow {
  font-size: 10.5px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-2); margin-bottom: 6px;
}
.paper-tile-summary .pts-nav-value {
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: clamp(30px, 3.4vw, 42px);
  line-height: 1; color: var(--ink-0); font-feature-settings: "tnum","lnum";
  font-weight: 500; letter-spacing: -.012em;
}
.paper-tile-summary .pts-nav-value .pts-curr {
  font-size: .55em; color: var(--ink-2); margin-right: 3px; vertical-align: .18em;
}
.paper-tile-summary .pts-nav-delta {
  margin-top: 6px; font-size: 12px; font-weight: 500; font-feature-settings: "tnum";
}
.paper-tile-summary .pts-row {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 13px; color: var(--ink-1); border-top: 1px solid var(--line-0);
  padding-top: 10px;
}
.paper-tile-summary .pts-row .lbl { color: var(--ink-2); font-size: 12px; }
.paper-tile-summary .pts-row .val { color: var(--ink-0); font-weight: 500; font-feature-settings: "tnum"; }
.paper-tile-summary .pts-leverage-on {
  display: inline-block; font-size: 10.5px; font-weight: 600; letter-spacing: .14em;
  text-transform: uppercase; padding: 3px 8px; border-radius: 4px;
  background: ${WARN_COLOR}; color: #fff;
}

/* Section panels below the hero — same look as the rest of the v2 pages. */
.paper-panel {
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: 14px;
  overflow: hidden;
  margin-top: 24px;
}
.paper-panel-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 22px 28px 14px; border-bottom: 1px solid var(--line-0);
  flex-wrap: wrap; gap: 12px;
}
.paper-panel-title {
  margin: 0; font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 17px; font-weight: 600; color: var(--ink-0); letter-spacing: -.005em;
}
.paper-panel-sub {
  font-size: 12px; color: var(--ink-2); margin-top: 4px; font-feature-settings: "tnum";
}
.paper-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.paper-table th {
  text-align: left; padding: 12px 28px;
  font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-2); font-weight: 500;
  border-bottom: 1px solid var(--line-1); background: var(--bg-1);
  cursor: pointer; user-select: none; white-space: nowrap;
}
.paper-table th.r { text-align: right; }
.paper-table td {
  padding: 13px 28px; border-bottom: 1px solid var(--line-0);
  color: var(--ink-1); font-feature-settings: "tnum";
}
.paper-table td.r { text-align: right; }
.paper-table td.ticker { color: var(--ink-0); font-weight: 500; }
.paper-table td.mv { color: var(--ink-0); font-weight: 500; }
.paper-table td.up { color: ${UP_COLOR}; }
.paper-table td.down { color: ${DOWN_COLOR}; }
.paper-empty { padding: 28px 28px; text-align: center; color: var(--ink-2); font-size: 13px; }

.paper-rebal-row { border-left: 2px solid var(--line-1); padding-left: 14px; margin-bottom: 14px; }
.paper-rebal-row:last-child { margin-bottom: 0; }
.paper-rebal-date { font-size: 13.5px; font-weight: 500; color: var(--ink-0); }
.paper-rebal-meta { font-weight: 400; color: var(--ink-2); font-feature-settings: "tnum"; }
.paper-rebal-source { font-size: 11px; color: var(--ink-3); margin-top: 3px; letter-spacing: .04em; }

/* Summary matrix (top-right) — restrained, hairline, tabular.
   table-layout:fixed + width:100% so it ALWAYS fits the card (never clips
   Inception/Beta). Columns share the width via the colgroup. */
.pmx { width: 100%; table-layout: fixed; border-collapse: collapse; font-feature-settings: "tnum","lnum"; }
.pmx th, .pmx td { padding: 7px 6px; text-align: right; white-space: nowrap; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; }
.pmx thead th {
  font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-2);
  font-weight: 500; border-bottom: 1px solid var(--line-1);
}
.pmx thead th:first-child, .pmx tbody td:first-child { text-align: left; white-space: normal; }
.pmx tbody td { border-bottom: 1px solid var(--line-0); color: var(--ink-1); }
.pmx tbody tr:last-child td { border-bottom: none; }
.pmx .rlabel { color: var(--ink-0); font-weight: 500; }
.pmx .rlabel small { display: block; color: var(--ink-3); font-weight: 400; font-size: 10.5px; }
.pmx .rowval { color: var(--ink-0); font-weight: 500; }
.pmx tr.vs td { border-top: 1px solid var(--line-1); }
.pmx tr.vs .rlabel { color: var(--ink-1); }
.pmx td.up { color: ${UP_COLOR}; }
.pmx td.down { color: ${DOWN_COLOR}; }
.pmx td.muted { color: var(--ink-3); }

/* Column control popover + resizable/reorderable headers. */
.pcol-wrap { position: relative; }
.pcol-btn {
  display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-1);
  background: var(--bg-1); border: 1px solid var(--line-1); border-radius: 8px;
  padding: 5px 10px; cursor: pointer;
}
.pcol-btn:hover { border-color: var(--line-2, var(--line-1)); background: var(--bg-2); }
.pcol-pop {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: 220px;
  background: var(--bg-1); border: 1px solid var(--line-1); border-radius: 12px;
  padding: 10px 12px; box-shadow: 0 8px 28px rgba(14,17,21,.10);
}
.pcol-item {
  display: flex; align-items: center; gap: 8px; padding: 5px 4px; font-size: 12.5px;
  color: var(--ink-0); cursor: grab; border-radius: 6px;
}
.pcol-item:hover { background: var(--bg-2); }
.pcol-item.dragging { opacity: .45; }
.pcol-item .grip { color: var(--ink-3); cursor: grab; }
.pcol-item input { accent-color: var(--accent, #0071e3); }
.pcol-foot { display: flex; justify-content: space-between; align-items: center;
  border-top: 1px solid var(--line-0); margin-top: 8px; padding-top: 8px; }
.pcol-reset { font-size: 11.5px; color: var(--accent, #0071e3); background: none; border: none; cursor: pointer; padding: 0; }
.paper-table th { position: relative; }
.paper-table th .rsz {
  position: absolute; top: 0; right: 0; width: 7px; height: 100%; cursor: col-resize; user-select: none;
}
.paper-table th.dragover { background: var(--bg-2); }
`;

// ── Right-slot summary card ───────────────────────────────────────────────

// $K, integer, accounting-style parentheses for negatives.
const fmtK = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const k = Math.round(n / 1000);
  const s = `$${Math.abs(k).toLocaleString('en-US')}K`;
  return n < 0 ? `(${s})` : s;
};
// Percent, accounting-style parentheses for negatives.
const fmtPctP = (n, places = 1) => {
  if (n == null || Number.isNaN(n)) return '—';
  const s = `${(Math.abs(n) * 100).toFixed(places)}%`;
  return n < 0 ? `(${s})` : `+${s}`;
};
const dirClass = (n) => (n == null ? 'muted' : (n >= 0 ? 'up' : 'down'));

function SummaryCard({ navHistory }) {
  const empty = !navHistory || navHistory.length === 0;
  const latest = empty ? null : navHistory[navHistory.length - 1];
  const prev   = (!empty && navHistory.length >= 2) ? navHistory[navHistory.length - 2] : null;

  // Trailing-12-month anchor row (falls back to inception while the book is
  // younger than a year — TTM == inception until then).
  const ttmRow = useMemo(() => {
    if (empty) return null;
    const d = new Date((latest.snapshot_date || '') + 'T00:00:00Z');
    const cutoff = new Date(d); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    let r = navHistory[0];
    for (const row of navHistory) {
      if (new Date(row.snapshot_date + 'T00:00:00Z') <= cutoff) r = row; else break;
    }
    return r;
  }, [navHistory, empty, latest]);

  if (empty) {
    return (
      <div className="paper-tile-summary">
        <div className="pts-head"><span className="pts-title">Performance</span></div>
        <div style={{ color: 'var(--ink-2)', fontSize: 13 }}>Awaiting first nightly run.</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><FreshnessChip elementId="portfolio.paper-nav-daily" /></div>
      </div>
    );
  }

  const CAP = 500_000, TOTAL_CAP = STARTING_CAPITAL;
  const aVal = (r) => r?.sleeve_a_value ?? (r ? CAP + (r.sleeve_a_realized_pnl || 0) + (r.sleeve_a_unrealized_pnl || 0) : null);
  const bVal = (r) => r?.sleeve_b_value ?? (r ? CAP + (r.sleeve_b_realized_pnl || 0) + (r.sleeve_b_unrealized_pnl || 0) : null);
  const ret = (now, then) => (now != null && then) ? (now / then - 1) : null;

  const spyNow = latest.spy_close ?? null;
  const spyVal = (spyNow && latest.spy_inception_close) ? TOTAL_CAP * (spyNow / latest.spy_inception_close) : null;

  const rows = [
    {
      label: 'Sleeve A', sub: '$500K', cap: CAP,
      value: aVal(latest),
      daily: ret(aVal(latest), aVal(prev)),
      ttm: ret(aVal(latest), aVal(ttmRow)),
      incep: ret(aVal(latest), CAP),
      beta: latest.sleeve_a_beta ?? null,
    },
    {
      label: 'Sleeve B', sub: '$500K', cap: CAP,
      value: bVal(latest),
      daily: ret(bVal(latest), bVal(prev)),
      ttm: ret(bVal(latest), bVal(ttmRow)),
      incep: ret(bVal(latest), CAP),
      beta: latest.sleeve_b_beta ?? null,
    },
    {
      label: 'Total', sub: '$1M', cap: TOTAL_CAP, strong: true,
      value: latest.total_nav,
      daily: ret(latest.total_nav, prev?.total_nav),
      ttm: ret(latest.total_nav, ttmRow?.total_nav),
      incep: ret(latest.total_nav, TOTAL_CAP),
      beta: latest.portfolio_beta ?? null,
    },
    {
      label: 'S&P 500', sub: '$1M', benchmark: true,
      value: spyVal,
      daily: ret(spyNow, latest.spy_prev_close),
      ttm: ret(spyNow, latest.spy_ttm_close),
      incep: ret(spyNow, latest.spy_inception_close),
      beta: 1.0,
    },
  ];
  const total = rows[2], spy = rows[3];
  const vs = {
    label: 'Vs. S&P 500', vs: true,
    value: (total.value != null && spy.value != null) ? total.value - spy.value : null,
    daily: (total.daily != null && spy.daily != null) ? total.daily - spy.daily : null,
    ttm: (total.ttm != null && spy.ttm != null) ? total.ttm - spy.ttm : null,
    incep: (total.incep != null && spy.incep != null) ? total.incep - spy.incep : null,
    beta: null,
  };

  const betaTd = (r) => {
    if (r.vs) return <td className="muted"></td>;
    if (r.beta == null) return <td className="muted" title="Beta builds over ~20 trading days">—</td>;
    return <td className="rowval">{r.beta.toFixed(2)}</td>;
  };

  const Row = (r) => (
    <tr key={r.label} className={r.vs ? 'vs' : undefined}>
      <td className="rlabel">{r.label}{r.sub && <small>{r.sub}</small>}</td>
      <td className={r.vs ? dirClass(r.value) : 'rowval'}>{fmtK(r.value)}</td>
      <td className={dirClass(r.daily)}>{fmtPctP(r.daily)}</td>
      <td className={dirClass(r.ttm)}>{fmtPctP(r.ttm)}</td>
      <td className={dirClass(r.incep)}>{fmtPctP(r.incep)}</td>
      {betaTd(r)}
    </tr>
  );

  return (
    <div className="paper-tile-summary">
      <div className="pts-head">
        <span className="pts-title">Performance <InfoTip term="Performance matrix" def="Value and return of each sleeve, the total book, and a $1M S&P 500 buy-and-hold benchmark. Daily = today's move; TTM = trailing 12 months (equals inception until the book is a year old); Inception = since the book opened; Beta = sensitivity to the S&P 500 (builds over ~20 trading days)." size={11} /></span>
        <span className="pts-asof">{latest.snapshot_date ? fmtDate(latest.snapshot_date).toUpperCase() : '—'}</span>
      </div>
      <table className="pmx">
        <colgroup>
          <col style={{ width: '25%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '13%' }} />
        </colgroup>
        <thead>
          <tr>
            <th></th><th>Value</th><th>Daily</th><th>TTM</th><th>Incep.</th><th>Beta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(Row)}
          {Row(vs)}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        <FreshnessChip elementId="portfolio.paper-nav-daily" />
      </div>
    </div>
  );
}

// ── Positions panel (one per sleeve) ───────────────────────────────────────

// All available columns for the sleeve tables (every Alpaca position field +
// MacroTilt-computed weight & holding period). `def` = shown by default.
const POS_COLUMNS = [
  { key: 'ticker',                   label: 'Ticker',      w: 78,  align: 'left',  fmt: 'ticker', def: true },
  { key: 'side',                     label: 'Side',        w: 64,  align: 'left',  fmt: 'side',   def: false },
  { key: 'quantity',                 label: 'Qty',         w: 92,  align: 'right', fmt: 'qty',    def: true },
  { key: 'avg_cost',                 label: 'Avg entry',   w: 92,  align: 'right', fmt: 'price',  def: true },
  { key: 'current_price',            label: 'Price',       w: 84,  align: 'right', fmt: 'price',  def: true },
  { key: 'lastday_price',            label: 'Prior close', w: 96,  align: 'right', fmt: 'price',  def: false },
  { key: 'change_today',             label: 'Day chg %',   w: 90,  align: 'right', fmt: 'pctDir', def: false },
  { key: 'market_value',             label: 'Market value',w: 120, align: 'right', fmt: 'money',  def: true, strong: true },
  { key: 'cost_basis',               label: 'Cost basis',  w: 110, align: 'right', fmt: 'money',  def: false },
  { key: 'unrealized_intraday_pl',   label: 'Day P&L',     w: 100, align: 'right', fmt: 'moneyDir', def: true },
  { key: 'unrealized_intraday_plpc', label: 'Day P&L %',   w: 92,  align: 'right', fmt: 'pctDir', def: true },
  { key: 'unrealized_pnl',           label: 'Total P&L',   w: 108, align: 'right', fmt: 'moneyDir', def: true },
  { key: 'unrealized_plpc',          label: 'Total P&L %', w: 100, align: 'right', fmt: 'pctDir', def: true },
  { key: 'weight',                   label: 'Weight %',    w: 84,  align: 'right', fmt: 'pctPlain', def: false },
  { key: 'entry_date',               label: 'Held',        w: 72,  align: 'right', fmt: 'held',   def: true },
  { key: 'current_score',            label: 'Score',       w: 70,  align: 'right', fmt: 'num',    def: true, sleeveOnly: 'B' },
];

const daysHeld = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).getTime();
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 86_400_000));
};

function PositionsPanel({ title, sleeve, positions, totalCapital, infoDef }) {
  const available = useMemo(
    () => POS_COLUMNS.filter((c) => !c.sleeveOnly || c.sleeveOnly === sleeve),
    [sleeve]
  );
  const storeKey = `mt_paper_cols_v1_${sleeve}`;
  const defaultCfg = () => available.map((c) => ({ key: c.key, visible: c.def, w: c.w }));

  const [cfg, setCfg] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
      if (Array.isArray(saved) && saved.length) {
        const known = new Set(available.map((c) => c.key));
        const merged = saved.filter((s) => known.has(s.key));
        for (const c of available) if (!merged.find((m) => m.key === c.key)) merged.push({ key: c.key, visible: c.def, w: c.w });
        return merged;
      }
    } catch { /* ignore */ }
    return defaultCfg();
  });
  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(cfg)); } catch { /* ignore */ } }, [cfg, storeKey]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [sortBy, setSortBy] = useState('market_value');
  const [sortDir, setSortDir] = useState('desc');
  const meta = (k) => available.find((c) => c.key === k);
  const visibleCols = cfg.filter((c) => c.visible);

  const grossLong = positions.reduce((s, p) => s + (p.market_value || 0), 0);
  const unreal = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
  const dayPL = positions.reduce((s, p) => s + (p.unrealized_intraday_pl || 0), 0);
  const leverageRatio = totalCapital > 0 ? grossLong / totalCapital : 0;

  const cellValue = (p, key) => key === 'weight' ? (grossLong > 0 ? (p.market_value || 0) / grossLong : null) : p[key];

  const sorted = useMemo(() => {
    const a = [...positions];
    a.sort((x, y) => {
      const xv = cellValue(x, sortBy) ?? -Infinity;
      const yv = cellValue(y, sortBy) ?? -Infinity;
      if (typeof xv === 'string') return sortDir === 'asc' ? xv.localeCompare(yv) : yv.localeCompare(xv);
      return sortDir === 'asc' ? xv - yv : yv - xv;
    });
    return a;
  }, [positions, sortBy, sortDir, grossLong]);

  const sortClick = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('desc'); }
  };
  const arrow = (key) => sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  // ── resize ──
  const resizing = useRef(null);
  const onResizeDown = (key) => (e) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { key, startX: e.clientX, startW: cfg.find((c) => c.key === key)?.w || 90 };
    const move = (ev) => {
      if (!resizing.current) return;
      const w = Math.max(52, resizing.current.startW + (ev.clientX - resizing.current.startX));
      setCfg((prev) => prev.map((c) => c.key === resizing.current.key ? { ...c, w } : c));
    };
    const up = () => { resizing.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  // ── reorder (drag headers and menu rows) ──
  const dragKey = useRef(null);
  const [overKey, setOverKey] = useState(null);
  const reorder = (from, to) => {
    if (from === to) return;
    setCfg((prev) => {
      const arr = [...prev];
      const fi = arr.findIndex((c) => c.key === from);
      const ti = arr.findIndex((c) => c.key === to);
      if (fi < 0 || ti < 0) return prev;
      const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m); return arr;
    });
  };
  const toggle = (key) => setCfg((prev) => prev.map((c) => c.key === key ? { ...c, visible: !c.visible } : c));
  const reset = () => setCfg(defaultCfg());

  const fmtCell = (p, col) => {
    const m = meta(col.key); const v = cellValue(p, col.key);
    switch (m.fmt) {
      case 'ticker': return <span style={{ color: 'var(--ink-0)', fontWeight: 500 }}>{p.ticker}</span>;
      case 'side': return v || 'long';
      case 'qty': return v != null ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
      case 'price': return v != null ? `$${Number(v).toFixed(2)}` : '—';
      case 'money': return fmtMoneyExact(v);
      case 'num': return v != null ? v : '—';
      case 'held': { const d = daysHeld(v); return d == null ? '—' : `${d}d`; }
      case 'pctPlain': return v != null ? `${(v * 100).toFixed(1)}%` : '—';
      case 'moneyDir': return <span className={(v || 0) >= 0 ? 'up' : 'down'}>{fmtMoneyExact(v)}</span>;
      case 'pctDir': return <span className={(v || 0) >= 0 ? 'up' : 'down'}>{fmtPct(v)}</span>;
      default: return v ?? '—';
    }
  };

  return (
    <div className="paper-panel">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            Sleeve {sleeve} &mdash; {title}
            {infoDef && <InfoTip term={`Sleeve ${sleeve}`} def={infoDef} size={12} />}
          </h2>
          <div className="paper-panel-sub">
            {positions.length} position{positions.length === 1 ? '' : 's'} &middot; {fmtMoneyExact(grossLong)} gross long
            {leverageRatio > 1.0 && (
              <> &middot; <span style={{ color: WARN_COLOR, fontWeight: 600 }}>{leverageRatio.toFixed(2)}&times; leverage</span></>
            )}
            {' '}&middot; <span style={{ color: dayPL >= 0 ? UP_COLOR : DOWN_COLOR }}>{fmtMoneyExact(dayPL)} today</span>
            {' '}&middot; <span style={{ color: unreal >= 0 ? UP_COLOR : DOWN_COLOR }}>{fmtMoneyExact(unreal)} open P&amp;L</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="pcol-wrap">
            <button className="pcol-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Configure columns">
              <span style={{ fontSize: 13, lineHeight: 1 }}>⋯</span> Columns
            </button>
            {menuOpen && (
              <div className="pcol-pop" onMouseLeave={() => setMenuOpen(false)}>
                {cfg.map((c) => {
                  const m = meta(c.key);
                  return (
                    <div
                      key={c.key}
                      className={'pcol-item' + (overKey === c.key ? ' dragging' : '')}
                      draggable
                      onDragStart={() => { dragKey.current = c.key; }}
                      onDragOver={(e) => { e.preventDefault(); setOverKey(c.key); }}
                      onDrop={() => { reorder(dragKey.current, c.key); dragKey.current = null; setOverKey(null); }}
                      onDragEnd={() => { dragKey.current = null; setOverKey(null); }}
                    >
                      <span className="grip">⠿</span>
                      <input
                        type="checkbox"
                        checked={c.visible}
                        disabled={c.key === 'ticker'}
                        onChange={() => toggle(c.key)}
                      />
                      <span>{m ? m.label : c.key}</span>
                    </div>
                  );
                })}
                <div className="pcol-foot">
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>drag to reorder · saved per device</span>
                  <button className="pcol-reset" onClick={reset}>Reset</button>
                </div>
              </div>
            )}
          </div>
          <FreshnessChip elementId="portfolio.paper-positions-snapshot" />
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="paper-empty">
          {sleeve === 'B'
            ? 'Scanner found no qualifying buy signals at the moment. Positions appear here after the next rebalance cycle.'
            : 'Awaiting first rebalance. Asset Tilt positions appear here after the next nightly run.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="paper-table" style={{ tableLayout: 'fixed', minWidth: visibleCols.reduce((s, c) => s + (c.w || 90), 0) }}>
            <colgroup>{visibleCols.map((c) => <col key={c.key} style={{ width: (c.w || 90) + 'px' }} />)}</colgroup>
            <thead>
              <tr>
                {visibleCols.map((c) => {
                  const m = meta(c.key);
                  return (
                    <th
                      key={c.key}
                      className={(m.align === 'right' ? 'r ' : '') + (overKey === c.key ? 'dragover' : '')}
                      draggable
                      onDragStart={() => { dragKey.current = c.key; }}
                      onDragOver={(e) => { e.preventDefault(); setOverKey(c.key); }}
                      onDrop={() => { reorder(dragKey.current, c.key); dragKey.current = null; setOverKey(null); }}
                      onDragEnd={() => { dragKey.current = null; setOverKey(null); }}
                      onClick={() => sortClick(c.key)}
                    >
                      {m.label}{arrow(c.key)}
                      <span className="rsz" onMouseDown={onResizeDown(c.key)} onClick={(e) => e.stopPropagation()} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={`${p.ticker}-${i}`}>
                  {visibleCols.map((c) => {
                    const m = meta(c.key);
                    const cls = (m.align === 'right' ? 'r ' : '') + (c.key === 'ticker' ? 'ticker' : '') + (m.strong ? ' mv' : '');
                    return <td key={c.key} className={cls.trim()} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtCell(p, c)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Rebalance log ──────────────────────────────────────────────────────────

function RebalanceLog({ orders }) {
  const byDate = useMemo(() => {
    if (!orders || orders.length === 0) return [];
    const m = new Map();
    for (const o of orders) {
      const d = (o.created_at || '').split('T')[0];
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(o);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
  }, [orders]);

  return (
    <div className="paper-panel">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            Recent rebalances <InfoTip term="Recent rebalances" def="Last five days on which the engine fired buy or sell intents to Alpaca. Filled / pending / rejected counts come from the Alpaca order ledger." size={12} />
          </h2>
        </div>
        <FreshnessChip elementId="portfolio.paper-orders-intent" />
      </div>
      <div style={{ padding: '20px 28px 24px' }}>
        {byDate.length === 0 ? (
          <div className="paper-empty" style={{ padding: 0 }}>
            No orders yet. The first rebalance will appear here after the next signal cycle.
          </div>
        ) : (
          byDate.map(([date, rows]) => {
            const buys = rows.filter((r) => r.side === 'buy').length;
            const sells = rows.filter((r) => r.side === 'sell').length;
            const filled = rows.filter((r) => r.status === 'filled').length;
            const pending = rows.filter((r) => r.status === 'pending').length;
            const rejected = rows.filter((r) => r.status === 'rejected').length;
            return (
              <div key={date} className="paper-rebal-row">
                <div className="paper-rebal-date">
                  {fmtDate(date)}
                  {' '}<span className="paper-rebal-meta">
                    &middot; {rows.length} orders ({buys} buys, {sells} sells)
                    {pending > 0  && <> &middot; <span style={{ color: WARN_COLOR }}>{pending} pending</span></>}
                    {rejected > 0 && <> &middot; <span style={{ color: DOWN_COLOR }}>{rejected} rejected</span></>}
                    {filled > 0   && <> &middot; <span style={{ color: UP_COLOR }}>{filled} filled</span></>}
                  </span>
                </div>
                <div className="paper-rebal-source">
                  {[...new Set(rows.map((r) => r.signal_source))].join(' + ')}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PaperPortfolioPage() {
  const [navHistory, setNavHistory] = useState([]);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [account, setAccount] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nav = await supabase
          .from('paper_nav_daily')
          .select('*')
          .order('snapshot_date', { ascending: true });
        if (!cancelled) setNavHistory(nav.data || []);

        const latestDate = await supabase
          .from('paper_positions')
          .select('snapshot_date')
          .order('snapshot_date', { ascending: false })
          .limit(1);
        const ld = latestDate?.data?.[0]?.snapshot_date;
        if (ld) {
          const pos = await supabase
            .from('paper_positions')
            .select('*')
            .eq('snapshot_date', ld)
            .order('market_value', { ascending: false });
          if (!cancelled) setPositions(pos.data || []);
        }

        const ord = await supabase
          .from('paper_orders')
          .select('id, created_at, sleeve, ticker, side, target_notional, signal_source, status, signal_score')
          .order('created_at', { ascending: false })
          .limit(200);
        if (!cancelled) setOrders(ord.data || []);

        const acc = await supabase
          .from('paper_accounts')
          .select('*')
          .eq('status', 'active')
          .limit(1);
        if (!cancelled) setAccount(acc?.data?.[0] || null);
      } catch (e) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sleeveA = useMemo(() => positions.filter((p) => p.sleeve === 'A'), [positions]);
  const sleeveB = useMemo(() => positions.filter((p) => p.sleeve === 'B'), [positions]);

  return (
    <div style={{ minHeight: '100vh' }}>
      <style>{PAGE_CSS}</style>

      <PageHero
        eyebrow="Paper Portfolio"
        title={HERO_TITLE}
        bullets={HERO_BULLETS}
        right={<SummaryCard navHistory={navHistory} />}
      />

      <div className="paper-shell">
        <PositionsPanel
          title="Asset Tilt — Industry-Group ETFs"
          sleeve="A"
          positions={sleeveA}
          totalCapital={account?.sleeve_a_allocation || 500_000}
          infoDef="$500K following the Asset Tilt engine's 24-industry-group allocation. ETFs only. Unlevered."
        />
        <PositionsPanel
          title="Equity Scanner — Long-Only"
          sleeve="B"
          positions={sleeveB}
          totalCapital={account?.sleeve_b_allocation || 500_000}
          infoDef="$500K following the Equity Scanner long-only. Buy when buy-score ≥ 5; size $50K / $40K / $30K by tier; up to 2× leverage when signals exceed $500K."
        />
        <RebalanceLog orders={orders} />

        {err && (
          <div style={{ marginTop: 24, padding: 14, background: 'var(--bg-2)', border: `1px solid ${DOWN_COLOR}`, borderRadius: 14, color: DOWN_COLOR, fontSize: 12 }}>
            Data load error: {err}
          </div>
        )}
      </div>
    </div>
  );
}
