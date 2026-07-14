// PaperPortfolioPage — Paper Trading Portfolio results page.
// rev: ticker-click + Score + Held (2026-05-29b) — cache-bust rebuild.
//
// Cream rebrand Phase B (2026-07-07): page moved from the home-v11 glass
// scope to the shared home-v12 cream system (cream-system.css) with page
// styles in overhaul/styles/paper-v12.css. RESKIN ONLY — root scope,
// classNames, layout wrappers and CSS; zero data/logic/chip changes. The
// inline PAGE_CSS block below still styles the tables / drawer / popover
// with the legacy V2 tokens; paper-v12.css remaps those tokens to the cream
// palette at the page scope (token bridge, no logic edit) and restyles the
// cards putty. All hooks, sleeve reconciliation, P&L math, sorting, column
// resize/reorder and FreshnessChip usage are untouched.
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
import FreshnessChip from '../../overhaul/components/FreshnessChip';
import { supabase } from '../../lib/supabase';
import { InfoTip } from '../../InfoTip';
import '../../overhaul/styles/cream-system.css';
import '../../overhaul/styles/paper-v12.css';

const STARTING_CAPITAL = 1_000_000;       // $1M paper, locked

// Risk-on / risk-off palette (fallbacks because the global tokens aren't
// defined at the page scope).
const UP_COLOR   = 'var(--up, #1f8a5a)';
const DOWN_COLOR = 'var(--down, #b62121)';
const WARN_COLOR = 'var(--warn, #b87000)';

// ── Editorial hero copy — Fraunces italic accents inside the title ────────

const HERO_TITLE = (
  <>
    An <em>automated $1M paper portfolio</em>, rebalanced <em>daily on the open</em>.
  </>
);

const HERO_BULLETS = [
  '$1M starting capital, following the Trading Scanner recommendations',
  'Scanner indicates a buy at a Score \u2265 4 (max 5); each position is a fixed $100K, equal-weight',
  'Long-only, no leverage',
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

// Score formatter — IDENTICAL to the Trading Scanner's (whole numbers bare,
// fractions to two places trimmed). The Score shown here is the name's LIVE
// scanner score from the same source as the Scanner page (trading_opps_signals),
// never the rounded integer used only for position sizing — so Paper and
// Scanner can never disagree on a name's score again.
const fmtScore = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '\u2014';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, '');
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

// Time-of-day in ET (market time), e.g. "9:30 AM". Null-safe.
const fmtTimeET = (iso) => {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
};
// ET calendar-date key (YYYY-MM-DD) for matching fills to a rebalance day.
const etDateKey = (iso) => {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
};

// ── Page-scoped styles (component-local; no globals) ──────────────────────

const PAGE_CSS = `
/* Match the PageHero's overhaul width (1440px via legacy-bridge .mt-overhaul override) so the tables align
   with the hero above them. Was 1440 — 160px wider than the hero, which made
   the hero look narrower than the tables. */
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
  text-align: left; padding: 10px 12px;
  font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-2); font-weight: 500;
  border-bottom: 1px solid var(--line-1); background: var(--bg-1);
  cursor: pointer; user-select: none; white-space: nowrap;
}
.paper-table th.r { text-align: right; }
.paper-table td {
  padding: 11px 12px; border-bottom: 1px solid var(--line-0);
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
   Inception/Beta). Columns share the width via the colgroup.
   2026-06-10 (Joe): card enlarged — the hero grid's right slot widens to
   540px on this page only (scoped: this <style> mounts with the page), and
   the matrix type steps up from 11px to 12.5px. */
.mt-page-hero-inner { grid-template-columns: minmax(0, 1fr) 540px; }
.pmx { width: 100%; table-layout: fixed; border-collapse: collapse; font-feature-settings: "tnum","lnum"; }
.pmx th, .pmx td { padding: 8px 5px; text-align: right; white-space: nowrap; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; }
.pmx thead th {
  font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-2);
  font-weight: 500; border-bottom: 1px solid var(--line-1);
}
.pmx thead th:first-child, .pmx tbody td:first-child { text-align: left; white-space: normal; }
.pmx tbody td { border-bottom: 1px solid var(--line-0); color: var(--ink-1); }
.pmx tbody tr:last-child td { border-bottom: none; }
.pmx .rlabel { color: var(--ink-0); font-weight: 500; }
.pmx .rlabel small { display: block; color: var(--ink-3); font-weight: 400; font-size: 11px; }
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
.pcol-item input { accent-color: var(--accent, #2563eb); }
.pcol-foot { display: flex; justify-content: space-between; align-items: center;
  border-top: 1px solid var(--line-0); margin-top: 8px; padding-top: 8px; }
.pcol-reset { font-size: 11.5px; color: var(--accent, #2563eb); background: none; border: none; cursor: pointer; padding: 0; }
.paper-table th { position: relative; }
.paper-table th .rsz {
  position: absolute; top: 0; right: 0; width: 7px; height: 100%; cursor: col-resize; user-select: none;
}
.paper-table th.dragover { background: var(--bg-2); }
.paper-cash-row td { border-top: 1px solid var(--line-1); color: var(--ink-2); font-style: italic; }
.paper-cash-row td.mv { font-style: normal; font-weight: 500; color: var(--ink-1); }
.paper-ticker-link {
  background: none; border: none; padding: 0; font: inherit; font-weight: 500;
  color: var(--accent, #2563eb); cursor: pointer;
}
.paper-ticker-link:hover { text-decoration: underline; }

.paper-total-row td { border-top: 2px solid var(--line-1); border-bottom: none; font-weight: 600; color: var(--ink-0); padding-top: 12px; }
.paper-total-row td.ticker { color: var(--ink-0); letter-spacing: .01em; }

.paper-rebal-clickable { position: relative; cursor: pointer; border-radius: 6px; padding-right: 22px; transition: background .12s ease; }
.paper-rebal-clickable:hover { background: var(--line-0); }
.paper-rebal-clickable::after { content: '›'; position: absolute; right: 8px; top: 10px; color: var(--ink-3); font-size: 17px; opacity: .55; }

.paper-drawer-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.30); z-index: 60; }
.paper-drawer { position: fixed; top: 0; right: 0; height: 100%; width: 480px; max-width: 94vw; background: var(--bg-1); border-left: 1px solid var(--line-1); box-shadow: -10px 0 30px rgba(15,23,42,.16); z-index: 61; display: flex; flex-direction: column; }
.paper-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid var(--line-0); }
.paper-drawer-title { font-size: 15px; font-weight: 600; color: var(--ink-0); letter-spacing: -.005em; }
.paper-drawer-sub { font-size: 12px; color: var(--ink-2); margin-top: 4px; font-feature-settings: "tnum"; }
.paper-drawer-close { background: none; border: none; font-size: 18px; line-height: 1; cursor: pointer; color: var(--ink-2); padding: 0 4px; }
.paper-drawer-close:hover { color: var(--ink-0); }
.paper-drawer-body { overflow-y: auto; padding: 10px 20px 28px; }
.paper-drawer-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.paper-drawer-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: var(--ink-2); font-weight: 500; padding: 10px 8px 6px; border-bottom: 1px solid var(--line-1); }
.paper-drawer-table th.r { text-align: right; }
.paper-drawer-table td { padding: 9px 8px; border-bottom: 1px solid var(--line-0); color: var(--ink-1); font-feature-settings: "tnum"; }
.paper-drawer-table td.r { text-align: right; }
.paper-drawer-table td.ticker { color: var(--ink-0); font-weight: 500; }
`;

// ── Right-slot summary card ───────────────────────────────────────────────

// $K, integer, minus sign for negatives.
const fmtK = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const k = Math.round(n / 1000);
  const s = `$${Math.abs(k).toLocaleString('en-US')}K`;
  return n < 0 ? `-${s}` : s;
};
// Percent, minus sign for negatives.
const fmtPctP = (n, places = 1) => {
  if (n == null || Number.isNaN(n)) return '—';
  const s = `${(Math.abs(n) * 100).toFixed(places)}%`;
  return n < 0 ? `-${s}` : `+${s}`;
};
const dirClass = (n) => (n == null ? 'muted' : (n >= 0 ? 'up' : 'down'));

// Full dollars (no K-rounding) for P&L deltas — daily moves are hundreds of
// dollars and would render as "$0K". Minus sign for negatives.
const fmt$Delta = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const s = `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
  return n < 0 ? `-${s}` : `+${s}`;
};

const PAPER_SLEEVE_CAP = 1_000_000;  // single Equity Scanner book = the whole $1M (Sleeve A retired 2026-06-23)

// Sleeve display names (two-sleeve build 2026-07-14). DB sleeve codes never
// render raw (plain-English rule): B = the insider book, M = momentum.
// A is the retired 2026-06-23 sleeve — historical rows only.
const SLEEVE_NAMES = { A: 'Insider Conviction', B: 'Insider Conviction', M: 'Momentum' };
const sleeveName = (s) => SLEEVE_NAMES[s] || s || '—';

// ── Three-way split of the broker NAV (two-sleeve build 2026-07-14) ────────
// Insider (sleeve B) holdings + Momentum (sleeve M) holdings + idle cash tie
// to the Alpaca NAV by construction: cash = NAV − gross holdings, and each
// sleeve's cash share follows its unused capacity below its allocation from
// paper_accounts (sleeve_b_allocation / sleeve_m_allocation — the engine's own
// caps). While the momentum sleeve is unfunded (allocation 0) it takes no
// cash, so the insider sleeve remains the whole book — matching the engine.
function splitBook(totalNav, insGross, momGross, insCap, momCap) {
  if (totalNav == null) return { insValue: null, momValue: null, cash: null, insCash: null, momCash: null };
  const ig = insGross || 0, mg = momGross || 0;
  const cash = totalNav - ig - mg;
  let insCash, momCash;
  if (cash >= 0) {
    const capI = Math.max(0, (insCap || 0) - ig), capM = Math.max(0, (momCap || 0) - mg);
    const base = capI + capM;
    if (base > 0) { insCash = cash * capI / base; momCash = cash * capM / base; }
    else { insCash = cash; momCash = 0; }
  } else {
    const borI = Math.max(0, ig - (insCap || 0)), borM = Math.max(0, mg - (momCap || 0));
    const base = borI + borM;
    if (base > 0) { insCash = cash * borI / base; momCash = cash * borM / base; }
    else { insCash = cash; momCash = 0; }
  }
  return { insValue: ig + insCash, momValue: mg + momCash, cash, insCash, momCash };
}

/* BookCard — the combined-account card in the hero (2026-07-14 two-column
   redesign, Joe directive: the old 7-column performance matrix read as stale
   V2 chrome). One big number (broker NAV), the book's day and since-inception
   P&L, the gap to the S&P, and a compact strip of the four $1M buy-and-hold
   benchmarks. Same inputs as the old matrix (paper_nav_daily / intraday row +
   the benchmark closes stamped on it) — presentation only. */
function BookCard({ navHistory, live = false, asOfIso = null }) {
  const empty = !navHistory || navHistory.length === 0;
  const latest = empty ? null : navHistory[navHistory.length - 1];
  const prev = (!empty && navHistory.length >= 2) ? navHistory[navHistory.length - 2] : null;
  if (empty) {
    return (
      <div className="paper-tile-summary">
        <div className="pts-head"><span className="pts-title">Paper portfolio</span></div>
        <div style={{ color: 'var(--ink-2)', fontSize: 13 }}>Awaiting first nightly run.</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><FreshnessChip elementId="portfolio.paper-nav-daily" /></div>
      </div>
    );
  }
  const TOTAL_CAP = STARTING_CAPITAL;
  const nav = latest.total_nav;
  const day$ = (latest.sleeve_b_day_pnl != null && latest.sleeve_m_day_pnl == null)
    ? latest.sleeve_b_day_pnl
    : (prev?.total_nav != null && nav != null ? nav - prev.total_nav : null);
  const dayPct = (day$ != null && prev?.total_nav) ? day$ / prev.total_nav : null;
  const incep$ = nav != null ? nav - TOTAL_CAP : null;
  const incepPct = nav != null ? nav / TOTAL_CAP - 1 : null;
  const bench = (label, k) => {
    const now = latest[`${k}_close`] ?? null;
    const incepC = latest[`${k}_inception_close`] ?? null;
    return { label, pct: (now && incepC) ? now / incepC - 1 : null };
  };
  const marks = [bench('S&P 500', 'spy'), bench('NASDAQ 100', 'qqq'), bench('Dow Jones', 'dia'), bench('Russell 2000', 'iwm')];
  const spyPct = marks[0].pct;
  const vsSpy$ = (incepPct != null && spyPct != null) ? (incepPct - spyPct) * TOTAL_CAP : null;
  return (
    <div className="paper-tile-summary pp-book">
      <div className="pts-head">
        <span className="pts-title">Paper portfolio · $1M start</span>
        <span className="pts-asof">{live && asOfIso ? `AS OF ${(fmtTimeET(asOfIso) || '').toUpperCase()} ET · LIVE` : (latest.snapshot_date ? `AS OF ${fmtDate(latest.snapshot_date).toUpperCase()} · CLOSE` : '—')}</span>
      </div>
      <div className="pp-book-nav">{fmtMoneyExact(nav)}</div>
      <div className="pp-book-rows">
        <div><span>Today</span><b className={dirClass(day$)}>{fmt$Delta(day$)}{dayPct != null ? ` · ${fmtPctP(dayPct)}` : ''}</b></div>
        <div><span>Since inception</span><b className={dirClass(incep$)}>{fmt$Delta(incep$)}{incepPct != null ? ` · ${fmtPctP(incepPct)}` : ''}</b></div>
        <div><span>vs S&P 500 (since inception)</span><b className={dirClass(vsSpy$)}>{fmt$Delta(vsSpy$)}</b></div>
      </div>
      <div className="pp-book-bench">
        {marks.map((m) => (
          <div key={m.label} className="pp-bench-cell">
            <span>{m.label}</span>
            <b className={dirClass(m.pct)}>{fmtPctP(m.pct)}</b>
          </div>
        ))}
        <div className="pp-bench-note">$1M buy &amp; hold, since the book opened</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <FreshnessChip elementId={live ? 'portfolio.paper-nav-intraday' : 'portfolio.paper-nav-daily'} variant="label" fallback={{ asOfIso: live ? asOfIso : (latest.created_at || latest.snapshot_date), calendar: 'nyse' }} />
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
  { key: 'change_today',             label: 'Day chg %',   w: 90,  align: 'right', fmt: 'pctDir', def: true },
  { key: 'market_value',             label: 'Market value',w: 120, align: 'right', fmt: 'money',  def: true, strong: true },
  { key: 'cost_basis',               label: 'Cost basis',  w: 110, align: 'right', fmt: 'money',  def: false },
  { key: 'unrealized_intraday_pl',   label: 'Day P&L',     w: 100, align: 'right', fmt: 'moneyDir', def: true },
  { key: 'unrealized_intraday_plpc', label: 'Day P&L %',   w: 92,  align: 'right', fmt: 'pctDir', def: false },
  { key: 'unrealized_pnl',           label: 'Total P&L',   w: 108, align: 'right', fmt: 'moneyDir', def: true },
  { key: 'unrealized_plpc',          label: 'Total P&L %', w: 100, align: 'right', fmt: 'pctDir', def: true },
  { key: 'weight',                   label: 'Weight %',    w: 84,  align: 'right', fmt: 'pctPlain', def: false },
  { key: 'entry_date',               label: 'Held',        w: 72,  align: 'right', fmt: 'held',   def: true },
  { key: 'sleeve',                   label: 'Sleeve',      w: 130, align: 'left',  fmt: 'sleeve', def: true },
  // Score: the live scanner score for Insider Conviction rows; the current
  // 12-month rank (#n) for Momentum rows (two-sleeve spec §4).
  { key: 'current_score',            label: 'Score / Rank', w: 88, align: 'right', fmt: 'score',  def: true },
];

// ONE shared column config (visibility + order + width) for BOTH sleeve
// tables. Set once, persists once. Score is a Sleeve-B-only column.
// (Sleeve A retired 2026-06-23; only the Equity Scanner sleeve renders.)
const PAPER_COLS_KEY = 'mt_paper_cols_v4_shared'; // v4: Sleeve column + Score/Rank (two-sleeve build); bump lands everyone on the new default set once
const posDefaultCfg = () => POS_COLUMNS.map((c) => ({ key: c.key, visible: c.def, w: c.w }));
function loadPaperCols() {
  try {
    const saved = JSON.parse(localStorage.getItem(PAPER_COLS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      const known = new Set(POS_COLUMNS.map((c) => c.key));
      const merged = saved.filter((s) => known.has(s.key));
      for (const c of POS_COLUMNS) if (!merged.find((m) => m.key === c.key)) merged.push({ key: c.key, visible: c.def, w: c.w });
      return merged;
    }
  } catch { /* ignore */ }
  return posDefaultCfg();
}

const daysHeld = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).getTime();
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 86_400_000));
};

function PositionsPanel({ title, sleeve, positions, totalCapital, infoDef, onOpenTicker, asOf, updatedAt, cashValue, cfg, setCfg, headline = null, live = false, freshnessId = 'portfolio.paper-positions-snapshot', scanScores = {}, momentumRanks = {}, overlapTickers = null, hideSleeveColumn = false }) {
  // Column visibility / order / widths come from ONE shared config (lifted to
  // the parent, persisted once). In the two-column layout each panel is a
  // single sleeve, so the redundant Sleeve column is dropped there.
  const appliesToSleeve = (key) => {
    if (hideSleeveColumn && key === 'sleeve') return false;
    return !!POS_COLUMNS.find((c) => c.key === key);
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [sortBy, setSortBy] = useState('market_value');
  const [sortDir, setSortDir] = useState('desc');
  const meta = (k) => POS_COLUMNS.find((c) => c.key === k);
  const visibleCols = cfg.filter((c) => c.visible && appliesToSleeve(c.key));

  const grossLong = positions.reduce((s, p) => s + (p.market_value || 0), 0);
  // Sleeve headline numbers live on the sleeve card above this table (one
  // computation, shown once — 2026-07-14 two-column redesign).
  const leverageRatio = totalCapital > 0 ? grossLong / totalCapital : 0;

  // Percentages are computed from the dollar P&L and cost basis we trust.
  // Alpaca's raw unrealized_plpc / unrealized_intraday_plpc arrive on a stale,
  // mismatched basis (they disagreed in SIGN with the dollar P&L — e.g. a
  // +$346 gain showing as -0.2%), so we derive them here instead.
  const cellValue = (p, key) => {
    if (key === 'weight') return grossLong > 0 ? (p.market_value || 0) / grossLong : null;
    if (key === 'unrealized_plpc') {                 // Total P&L %  = total P&L / cost basis
      const cb = p.cost_basis ?? ((p.avg_cost != null && p.quantity != null) ? p.avg_cost * p.quantity : null);
      return (p.unrealized_pnl != null && cb) ? p.unrealized_pnl / cb : null;
    }
    if (key === 'unrealized_intraday_plpc') {         // Day P&L %  = day P&L / prior market value
      const prior = (p.market_value != null && p.unrealized_intraday_pl != null) ? p.market_value - p.unrealized_intraday_pl : null;
      return (p.unrealized_intraday_pl != null && prior) ? p.unrealized_intraday_pl / prior : null;
    }
    if (key === 'change_today') {                     // Day chg %  = price / prior close - 1
      return (p.current_price != null && p.lastday_price) ? p.current_price / p.lastday_price - 1 : (p.change_today ?? null);
    }
    if (key === 'current_score') {
      // Momentum rows sort/show by their current 12-month rank; Insider rows
      // by the LIVE scanner score (source of truth, trading_opps_signals).
      if (p.sleeve === 'M') {
        const rk = momentumRanks?.[p.ticker];
        return rk != null ? rk : null;
      }
      const lv = scanScores?.[p.ticker];
      return lv != null ? lv : null;
    }
    if (key === 'sleeve') return sleeveName(p.sleeve);
    return p[key];
  };

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
      setCfg((prev) => prev.map((c) => c.key === key ? { ...c, w } : c)); // use closed-over key, not resizing.current (which mouseup may have nulled before this deferred updater runs)
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
  const reset = () => setCfg(posDefaultCfg());

  const fmtCell = (p, col) => {
    const m = meta(col.key); const v = cellValue(p, col.key);
    if (!m) return '—';
    switch (m.fmt) {
      case 'ticker': {
        const twice = overlapTickers ? overlapTickers.has(p.ticker) : false;
        const mark = twice ? <span className="pp-x2" data-tip="Held by both sleeves — one row per sleeve; combined exposure is the two rows summed">×2</span> : null;
        return onOpenTicker
          ? <><button type="button" className="paper-ticker-link" onClick={(e) => { e.stopPropagation(); onOpenTicker(p.ticker); }}>{p.ticker}</button>{mark}</>
          : <><span style={{ color: 'var(--ink-0)', fontWeight: 500 }}>{p.ticker}</span>{mark}</>;
      }
      case 'sleeve': return <span className={`pp-sleeve-tag ${p.sleeve === 'M' ? 'm' : 'b'}`}>{v}</span>;
      case 'side': return v || 'long';
      case 'qty': return v != null ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
      case 'price': return v != null ? `$${Number(v).toFixed(2)}` : '—';
      case 'money': return fmtMoneyExact(v);
      case 'num': return v != null ? v : '—';
      case 'score': return p.sleeve === 'M' ? (v != null ? `#${v}` : '—') : fmtScore(v);
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
          <h2 className="paper-panel-title">{title || 'Holdings'}</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="pcol-wrap">
            <button className="pcol-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Configure columns">
              <span style={{ fontSize: 13, lineHeight: 1 }}>⋯</span> Columns
            </button>
            {menuOpen && (
              <div className="pcol-pop" onMouseLeave={() => setMenuOpen(false)}>
                {cfg.filter((c) => appliesToSleeve(c.key)).map((c) => {
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
          <FreshnessChip elementId={freshnessId} variant="label" fallback={{ asOfIso: updatedAt || asOf, calendar: 'nyse' }} />
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="paper-empty">
          {'Scanner found no qualifying buy signals at the moment. Positions appear here after the next rebalance cycle.'}
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
              {cashValue != null && (
                <tr className="paper-cash-row">
                  {visibleCols.map((c) => {
                    const m = meta(c.key);
                    const cls = (m.align === 'right' ? 'r ' : '') + (c.key === 'ticker' ? 'ticker' : '') + (m.strong ? ' mv' : '');
                    let content = '';
                    if (c.key === 'ticker') content = 'Cash (idle)';
                    else if (c.key === 'market_value') content = fmtMoneyExact(cashValue);
                    else if (c.key === 'weight') content = grossLong + cashValue > 0 ? `${(cashValue / (grossLong + cashValue) * 100).toFixed(1)}%` : '';
                    return <td key={c.key} className={cls.trim()} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{content}</td>;
                  })}
                </tr>
              )}
              {sorted.length > 0 && (() => {
                const sum = (k) => sorted.reduce((s, p) => s + (Number(cellValue(p, k)) || 0), 0);
                const totMV = sum('market_value') + (cashValue || 0);
                const totCost = sum('cost_basis');
                const totDay = sum('unrealized_intraday_pl');
                const totPL = sum('unrealized_pnl');
                return (
                  <tr className="paper-total-row">
                    {visibleCols.map((c) => {
                      const m = meta(c.key);
                      const cls = (m.align === 'right' ? 'r ' : '') + (c.key === 'ticker' ? 'ticker' : '');
                      let content = '';
                      if (c.key === 'ticker') content = 'Total';
                      else if (c.key === 'market_value') content = fmtMoneyExact(totMV);
                      else if (c.key === 'cost_basis') content = fmtMoneyExact(totCost);
                      else if (c.key === 'unrealized_intraday_pl') content = <span className={totDay >= 0 ? 'up' : 'down'}>{fmtMoneyExact(totDay)}</span>;
                      else if (c.key === 'unrealized_pnl') content = <span className={totPL >= 0 ? 'up' : 'down'}>{fmtMoneyExact(totPL)}</span>;
                      else if (c.key === 'weight') content = '100.0%';
                      return <td key={c.key} className={cls.trim()}>{content}</td>;
                    })}
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Rebalance log ──────────────────────────────────────────────────────────

function RebalanceLog({ orders: allOrders, fills: allFills, sleeve = null, title = 'Recent rebalances' }) {
  const [openDate, setOpenDate] = useState(null);
  // Two-column layout (2026-07-14): each sleeve column carries its OWN
  // history — filter both ledgers to the sleeve before grouping.
  const orders = useMemo(
    () => (sleeve ? (allOrders || []).filter((o) => o.sleeve === sleeve) : (allOrders || [])),
    [allOrders, sleeve],
  );
  const fills = useMemo(
    () => (sleeve ? (allFills || []).filter((f) => f.sleeve === sleeve) : (allFills || [])),
    [allFills, sleeve],
  );
  const byDate = useMemo(() => {
    if (!orders || orders.length === 0) return [];
    const m = new Map();
    for (const o of orders) {
      // Idempotent dedup-skips (a working order already exists for this
      // ticker/side) never fired — keep them out of the rebalance log so they
      // don't inflate the order count or read as "rejected" (2026-06-16).
      if (o.status === 'cancelled') continue;
      const d = (o.created_at || '').split('T')[0];
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(o);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
  }, [orders]);

  // Earliest fill time per ET calendar date, so each rebalance row can show
  // when its orders actually executed (fills land at the next open).
  const fillByDate = useMemo(() => {
    const m = new Map();
    for (const fdesc of (fills || [])) {
      const k = etDateKey(fdesc.filled_at);
      if (!k) continue;
      const cur = m.get(k);
      if (!cur || fdesc.filled_at < cur) m.set(k, fdesc.filled_at);
    }
    return m;
  }, [fills]);

  return (
    <>
    <div className="paper-panel pp-rebal">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            {title} <InfoTip term={title} def="Last five days on which the engine fired buy or sell intents to the paper broker for this sleeve. Filled / pending / rejected counts come from the broker's order ledger." size={12} />
          </h2>
        </div>
        <FreshnessChip elementId="portfolio.paper-orders-intent" variant="label" fallback={{ asOfIso: orders?.[0]?.created_at, calendar: 'nyse' }} />
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
            const pending = rows.filter((r) => r.status === 'pending').length;
            const rejected = rows.filter((r) => r.status === 'rejected').length;
            // Queued = when these orders were sent to the broker; Filled = when
            // they executed at the open (from the fills ledger, matched on the
            // submit date so each row shows its own fills).
            const submits = rows.map((r) => r.submitted_at).filter(Boolean).sort();
            const queuedAt = submits[0] || null;
            const filledAt = fillByDate.get(etDateKey(queuedAt) || date) || null;
            return (
              <div key={date} className="paper-rebal-row paper-rebal-clickable" onClick={() => setOpenDate(date)} role="button" tabIndex={0}>
                <div className="paper-rebal-date">
                  {fmtDate(date)}
                  {' '}<span className="paper-rebal-meta">
                    &middot; {rows.length} orders ({buys} buys, {sells} sells)
                    {pending > 0  && <> &middot; <span style={{ color: WARN_COLOR }}>{pending} pending</span></>}
                    {rejected > 0 && <> &middot; <span style={{ color: DOWN_COLOR }}>{rejected} rejected</span></>}
                    {queuedAt && <> &middot; queued {fmtTimeET(queuedAt)}</>}
                    {filledAt
                      ? <> &middot; <span style={{ color: UP_COLOR }}>filled {fmtTimeET(filledAt)}</span></>
                      : (queuedAt && <> &middot; <span style={{ color: WARN_COLOR }}>awaiting fill</span></>)}
                  </span>
                </div>
                {!sleeve && (
                  <div className="paper-rebal-source">
                    {[...new Set(rows.map((r) => sleeveName(r.sleeve)))].join(' + ')}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
    {openDate && (() => {
      const entry = byDate.find(([d]) => d === openDate);
      const drows = entry ? entry[1] : [];
      const fillKey = etDateKey(drows.map((r) => r.submitted_at).filter(Boolean).sort()[0]) || openDate;
      const dayFills = (fills || []).filter((f) => etDateKey(f.filled_at) === fillKey);
      const lines = drows.map((o) => {
        const f = dayFills.find((x) => x.ticker === o.ticker && (x.side || '').toLowerCase() === (o.side || '').toLowerCase());
        const qty = f ? Number(f.quantity) : null;
        const price = f ? Number(f.price) : null;
        return {
          ticker: o.ticker, side: o.side, sleeve: o.sleeve, qty, price,
          notional: (qty != null && price != null) ? qty * price : (o.target_notional != null ? Math.abs(Number(o.target_notional)) : null),
          filled: !!f,
        };
      });
      const nFilled = lines.filter((l) => l.filled).length;
      return (
        <>
          <div className="paper-drawer-backdrop" onClick={() => setOpenDate(null)} />
          <aside className="paper-drawer" role="dialog" aria-label="Rebalance trades">
            <div className="paper-drawer-head">
              <div>
                <div className="paper-drawer-title">Trades &mdash; {fmtDate(openDate)}</div>
                <div className="paper-drawer-sub">{lines.length} orders &middot; {nFilled} filled</div>
              </div>
              <button type="button" className="paper-drawer-close" onClick={() => setOpenDate(null)} aria-label="Close">&times;</button>
            </div>
            <div className="paper-drawer-body">
              <table className="paper-drawer-table">
                <thead>
                  <tr><th>Ticker</th><th>Side</th><th>Sleeve</th><th className="r">Qty</th><th className="r">Fill price</th><th className="r">Value</th><th className="r">Status</th></tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={`${l.ticker}-${i}`}>
                      <td className="ticker">{l.ticker}</td>
                      <td><span className={l.side === 'buy' ? 'up' : 'down'}>{(l.side || '').toUpperCase()}</span></td>
                      <td>{sleeveName(l.sleeve)}</td>
                      <td className="r">{l.qty != null ? l.qty.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '\u2014'}</td>
                      <td className="r">{l.price != null ? `$${l.price.toFixed(2)}` : '\u2014'}</td>
                      <td className="r">{l.notional != null ? fmtMoneyExact(l.notional) : '\u2014'}</td>
                      <td className="r">{l.filled ? <span className="up">Filled</span> : <span style={{ color: 'var(--warn, #b87000)' }}>Queued</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </>
      );
    })()}
    </>
  );
}

/* Reveal — scroll-reveal wrapper, same pattern as HomePage / MacroPage /
   ScannerPage (v12 system). Replays in BOTH directions; state lives in React
   so data-poll re-renders preserve the revealed class. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVis(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`${className} rv${vis ? ' in' : ''}`} {...rest}>{children}</Tag>;
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PaperPortfolioPage({ onOpenTicker }) {
  const [navHistory, setNavHistory] = useState([]);
  const [positions, setPositions] = useState([]);
  const [posAsOf, setPosAsOf] = useState(null);
  const [liveNav, setLiveNav] = useState(null);
  const [livePos, setLivePos] = useState([]);
  const [orders, setOrders] = useState([]);
  const [fills, setFills] = useState([]);
  const [account, setAccount] = useState(null);
  const [scanScores, setScanScores] = useState({});
  const [momMeta, setMomMeta] = useState(null); // { ranks: {ticker: rank}, asOf, next }
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
          // Day chg % is the security's daily price move. The mirror never
          // wrote a `change_today` column, so this column read empty; derive
          // it from the prior close + current price already on each row.
          // Fraction form (current/lastday - 1) to match fmtPct (×100).
          const posRows = (pos.data || []).map((r) => ({
            ...r,
            change_today: (r.lastday_price && r.current_price != null)
              ? (r.current_price / r.lastday_price - 1)
              : null,
          }));
          if (!cancelled) { setPositions(posRows); setPosAsOf(ld); }
        }

        const ord = await supabase
          .from('paper_orders')
          .select('id, created_at, submitted_at, sleeve, ticker, side, target_notional, signal_source, status, signal_score')
          .order('created_at', { ascending: false })
          .limit(200);
        if (!cancelled) setOrders(ord.data || []);

        const fl = await supabase
          .from('paper_fills')
          .select('ticker, side, sleeve, quantity, price, filled_at')
          .order('filled_at', { ascending: false })
          .limit(400);
        if (!cancelled) setFills(fl.data || []);

        const acc = await supabase
          .from('paper_accounts')
          .select('*')
          .eq('status', 'active')
          .limit(1);
        if (!cancelled) setAccount(acc?.data?.[0] || null);

        // LIVE intraday view (refreshed hourly during market hours). Kept in a
        // separate table from the official close record so live marks never
        // touch the daily NAV history. The page prefers it only while the
        // market is open (see liveMode below); after the 16:50 close it flips
        // back to the official close snapshot.
        const lnav = await supabase
          .from('paper_intraday_nav')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1);
        if (!cancelled) setLiveNav(lnav?.data?.[0] || null);
        const lpos = await supabase
          .from('paper_intraday_positions')
          .select('*')
          .order('market_value', { ascending: false });
        if (!cancelled) setLivePos((lpos?.data || []).map((r) => ({
          ...r,
          change_today: (r.lastday_price && r.current_price != null)
            ? (r.current_price / r.lastday_price - 1) : null,
        })));

        // Momentum sleeve context (two-sleeve build 2026-07-14): the current
        // monthly list supplies the Score/Rank column for sleeve-M rows and
        // the sleeve card's dates. ≤50 rows by the quintile clamp.
        const mrd = await supabase
          .from('momentum_list')
          .select('rebalance_date')
          .order('rebalance_date', { ascending: false })
          .limit(1);
        const mDate = mrd?.data?.[0]?.rebalance_date;
        if (mDate) {
          const ml = await supabase
            .from('momentum_list')
            .select('ticker, rank, next_rebalance_date')
            .eq('rebalance_date', mDate)
            .order('rank', { ascending: true });
          if (!cancelled) {
            const ranks = {};
            (ml.data || []).forEach((r) => { ranks[r.ticker] = r.rank; });
            setMomMeta({ ranks, asOf: mDate, next: ml.data?.[0]?.next_rebalance_date || null });
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Live-vs-close selection (Joe 2026-06-23) ──────────────────────────────
  // Prefer the live intraday view whenever its session date is AFTER the latest
  // official close row — i.e. during market hours, before the 16:50 close run
  // writes today's official snapshot. The instant that close row lands, the
  // dates tie and this flips to false, so the LAST update of the day is always
  // the 4PM close. Pure date compare → DST-proof.
  const lastClose = navHistory.length ? navHistory[navHistory.length - 1] : null;
  const liveMode = !!(liveNav && lastClose && liveNav.as_of_date && lastClose.snapshot_date
                      && liveNav.as_of_date > lastClose.snapshot_date);

  // What the page renders: live rows during market hours, else the close record.
  const displayPositions = liveMode ? livePos : positions;

  // Live Score column source-of-truth: the SAME scanner score the Trading
  // Scanner shows (latest trading_opps_signals row per held name), to the same
  // precision. Replaces the rounded integer snapshot that drifted from the
  // scanner (Joe, recurring). Held names no longer in the scan show an em-dash.
  const heldTickersKey = useMemo(
    () => [...new Set((displayPositions || []).map((p) => p.ticker).filter(Boolean))].sort().join(','),
    [displayPositions],
  );
  useEffect(() => {
    const tickers = heldTickersKey ? heldTickersKey.split(',') : [];
    if (!tickers.length) { setScanScores({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const sd = await supabase.from('trading_opps_signals')
          .select('scan_date').order('scan_date', { ascending: false }).limit(1);
        const latest = sd?.data?.[0]?.scan_date;
        if (!latest) return;
        const scr = await supabase.from('trading_opps_signals')
          .select('ticker, score').eq('scan_date', latest).in('ticker', tickers);
        if (cancelled) return;
        const map = {};
        (scr.data || []).forEach((r) => { if (r.score != null) map[r.ticker] = Number(r.score); });
        setScanScores(map);
      } catch { /* leave scores empty -> em-dash */ }
    })();
    return () => { cancelled = true; };
  }, [heldTickersKey]);
  const displayPosAsOf = liveMode ? (liveNav.updated_at || liveNav.as_of_date) : posAsOf;
  // For the chart/card, append the live point as today's bar so all the shared
  // math (reconcile, headlines, betas) works unchanged. History is never mutated.
  const navForCard = useMemo(() => {
    if (!liveMode) return navHistory;
    return [...navHistory, {
      snapshot_date: liveNav.as_of_date,
      total_nav: liveNav.total_nav,
      sleeve_a_value: liveNav.sleeve_a_value, sleeve_b_value: liveNav.sleeve_b_value,
      sleeve_a_equity: liveNav.sleeve_a_equity, sleeve_b_equity: liveNav.sleeve_b_equity,
      spy_close: liveNav.spy_close, spy_prev_close: liveNav.spy_prev_close, spy_inception_close: liveNav.spy_inception_close,
      // 2026-07-08 fix: forward ALL four benchmarks in live mode (was SPY only,
      // which blanked the NASDAQ/Dow/Russell rows even though the data exists).
      qqq_close: liveNav.qqq_close, qqq_prev_close: liveNav.qqq_prev_close, qqq_inception_close: liveNav.qqq_inception_close,
      dia_close: liveNav.dia_close, dia_prev_close: liveNav.dia_prev_close, dia_inception_close: liveNav.dia_inception_close,
      iwm_close: liveNav.iwm_close, iwm_prev_close: liveNav.iwm_prev_close, iwm_inception_close: liveNav.iwm_inception_close,
      sleeve_b_day_pnl: liveNav.day_pnl, portfolio_beta: liveNav.portfolio_beta,
      created_at: liveNav.updated_at,
    }];
  }, [liveMode, liveNav, navHistory]);

  const sleeveA = useMemo(() => displayPositions.filter((p) => p.sleeve === 'A'), [displayPositions]);
  const sleeveB = useMemo(() => displayPositions.filter((p) => p.sleeve === 'B'), [displayPositions]);
  const sleeveM = useMemo(() => displayPositions.filter((p) => p.sleeve === 'M'), [displayPositions]);
  // One combined holdings table — both sleeves, a name held by both shows one
  // row per sleeve plus the ×2 marker (two-sleeve spec §4).
  const bothSleeves = useMemo(() => displayPositions.filter((p) => p.sleeve === 'B' || p.sleeve === 'M'), [displayPositions]);
  const overlapTickers = useMemo(() => {
    const bT = new Set(sleeveB.map((p) => p.ticker));
    return new Set(sleeveM.map((p) => p.ticker).filter((t) => bT.has(t)));
  }, [sleeveB, sleeveM]);

  // Reconciled per-sleeve cash (idle) so each table can show a Cash line that
  // ties the sleeve's holdings + cash to the broker NAV.
  const latestNav = navForCard.length ? navForCard[navForCard.length - 1] : null;
  // Per-sleeve holdings, summed from the displayed positions, so the
  // Performance card's sleeve value and each table's Cash line tie to the rows.
  const sleeveAGross = useMemo(() => sleeveA.length ? sleeveA.reduce((s, p) => s + (p.market_value || 0), 0) : null, [sleeveA]);
  const sleeveBGross = useMemo(() => sleeveB.length ? sleeveB.reduce((s, p) => s + (p.market_value || 0), 0) : null, [sleeveB]);
  // Precise last-update timestamp for the displayed snapshot (has time-of-day,
  // so the freshness tooltip shows date AND time, not just a date).
  const posUpdatedAt = liveMode ? (liveNav.updated_at || liveNav.as_of_date)
    : displayPositions.reduce((mx, p) => (p.last_updated && (!mx || p.last_updated > mx)) ? p.last_updated : mx, null);

  // ── Two-sleeve split + per-sleeve cards (two-sleeve build 2026-07-14) ────
  // One computation feeds the split bar AND both sleeve cards, so they can
  // never disagree (shared-function rule 2026-06-12).
  const momGross = useMemo(() => sleeveM.reduce((s, p) => s + (p.market_value || 0), 0), [sleeveM]);
  const insCap = account?.sleeve_b_allocation != null ? Number(account.sleeve_b_allocation) : STARTING_CAPITAL;
  const momCap = account?.sleeve_m_allocation != null ? Number(account.sleeve_m_allocation) : 0;
  const split = useMemo(
    () => splitBook(latestNav?.total_nav ?? null, sleeveBGross || 0, momGross, insCap, momCap),
    [latestNav, sleeveBGross, momGross, insCap, momCap],
  );
  // Since-inception vs S&P 500 for each sleeve card. While the momentum
  // sleeve is unfunded, the Insider Conviction sleeve IS the whole book, so
  // its since-inception equals the book's (same inputs the Performance matrix
  // uses). Once the momentum sleeve is funded, per-sleeve inception needs the
  // engine's per-sleeve daily values — until those columns exist, the funded
  // split renders em-dashes rather than a made-up basis.
  const spyIncep = (latestNav?.spy_close && latestNav?.spy_inception_close)
    ? latestNav.spy_close / latestNav.spy_inception_close - 1 : null;
  const insIncep = (momCap === 0 && latestNav?.total_nav != null)
    ? latestNav.total_nav / STARTING_CAPITAL - 1 : null;
  const lastActionFor = (code) => {
    const o = (orders || []).find((r) => r.sleeve === code && r.status !== 'cancelled');
    return o ? { date: (o.created_at || '').split('T')[0], side: o.side } : null;
  };
  const insLast = useMemo(() => lastActionFor('B'), [orders]);
  const momLast = useMemo(() => lastActionFor('M'), [orders]);

  // One shared column config for both sleeve tables — set once, persists for both.
  const [colCfg, setColCfg] = useState(loadPaperCols);
  useEffect(() => { try { localStorage.setItem(PAPER_COLS_KEY, JSON.stringify(colCfg)); } catch { /* ignore */ } }, [colCfg]);

  return (
    <div className="home-v12 paper-v12">
      <style>{PAGE_CSS}</style>

      {/* Hero — editorial left, performance-matrix card right (the v12
          split-hero pattern; pp- class names so the scanner page's sc- rules
          can never leak in). Copy unchanged from the v11 hero. */}
      <section className="wrap pp-hero">
        <Reveal className="pp-ed">
          <div className="eyebrow2"><span className="dot" />Paper portfolio</div>
          <h1>An <i>automated $1M paper portfolio</i>, run as <i>two rules-based sleeves</i>.</h1>
          <ul className="impl">
            <li><b>Sleeve 1 — Insider Conviction</b>: buys at Score ≥ 4 (max 5), a fixed $100K per name, holds until the score decays below 3; rebalanced daily on the open.</li>
            <li><b>Sleeve 2 — Momentum</b>: the top-quintile 12-month performers, equal-weight, re-ranked monthly, with a crash guard to cash when the S&P 500 is below its 200-day average.</li>
            <li><b>Long-only, no leverage</b> in either sleeve; a name held by both sleeves is owned by both.</li>
          </ul>
        </Reveal>
        <Reveal className="pp-heroright">
          <BookCard navHistory={navForCard} live={liveMode} asOfIso={liveMode ? (liveNav.updated_at || liveNav.as_of_date) : null} />
        </Reveal>
      </section>

      <section className="wrap pp-main">
        {/* Two-sleeve split bar — Insider / Momentum / cash, reconciled to the
            broker NAV by construction (splitBook). Widths are proportional. */}
        {latestNav?.total_nav != null && (
          <Reveal className="pp-splitwrap">
            <div className="pp-splitbar" aria-hidden="true">
              {[
                { k: 'ins', v: sleeveBGross || 0 },
                { k: 'mom', v: momGross },
                { k: 'cash', v: Math.max(0, split.cash || 0) },
              ].map(({ k, v }) => (
                <div key={k} className={`pp-seg ${k}`} style={{ flexGrow: Math.max(v, 0), flexBasis: 0 }} />
              ))}
            </div>
            <div className="pp-splitlegend">
              <span><span className="pp-dot ins" />Insider Conviction holdings {fmtMoneyShort(sleeveBGross || 0)}</span>
              <span><span className="pp-dot mom" />Momentum holdings {fmtMoneyShort(momGross)}</span>
              <span><span className="pp-dot cash" />Cash {fmtMoneyShort(split.cash)}</span>
              <span className="pp-splittotal">Account value {fmtMoneyShort(latestNav.total_nav)}</span>
            </div>
          </Reveal>
        )}

        {/* Two symmetric sleeve columns (Joe directive 2026-07-14): each
            column is sleeve card → full holdings → its own rebalance history.
            No Reveal wrappers here: the history's trades drawer is
            position:fixed, and a revealed wrapper's transform would become
            the drawer's containing block. */}
        <div className="pp-twocol">
          {[
            {
              code: 'B', n: 1, name: 'Insider Conviction', value: split.insValue,
              cash: split.insCash, positions: sleeveB, last: insLast,
              day$: sleeveB.length ? sleeveB.reduce((s, p) => s + (p.unrealized_intraday_pl || 0), 0) : null,
              incep: insIncep, spySame: momCap === 0 ? spyIncep : null,
              extra: null,
              infoDef: 'Buys at Score ≥ 4 (max 5), a fixed $100K per name, holds until the score decays below 3; rebalanced daily on the open.',
            },
            {
              code: 'M', n: 2, name: 'Momentum', value: momCap > 0 ? split.momValue : null,
              cash: split.momCash, positions: sleeveM, last: momLast,
              day$: sleeveM.length ? sleeveM.reduce((s, p) => s + (p.unrealized_intraday_pl || 0), 0) : null,
              incep: null, spySame: null,
              extra: momMeta,
              infoDef: 'Owns the current monthly momentum list equal-weight ($500K divided by the list size); the crash guard moves the sleeve to cash when the S&P 500 is below its 200-day average.',
            },
          ].map((s) => (
            <div key={s.code} className="pp-col">
              <div className="pp-sleevecard">
                <div className="pp-sc-eyebrow">Sleeve {s.n} · {s.name}</div>
                <div className="pp-sc-value">{fmtMoneyExact(s.value)}</div>
                <div className="pp-sc-rows">
                  <div><span>Today</span><b className={dirClass(s.day$)}>{fmt$Delta(s.day$)}</b></div>
                  <div><span>Since inception</span><b className={dirClass(s.incep)}>{s.incep != null ? fmtPctP(s.incep) : '—'}</b></div>
                  <div><span>S&P 500 same period</span><b className={dirClass(s.spySame)}>{s.spySame != null ? fmtPctP(s.spySame) : '—'}</b></div>
                  <div><span>Holdings</span><b>{s.positions.length}</b></div>
                  <div><span>Idle cash</span><b>{fmtMoneyExact(s.cash)}</b></div>
                  <div><span>Last action</span><b>{s.last ? `${s.last.side === 'buy' ? 'Bought' : 'Sold'} · ${fmtDate(s.last.date)}` : '—'}</b></div>
                  {s.extra && <div><span>Current list</span><b>{Object.keys(s.extra.ranks).length} names · as of {fmtDate(s.extra.asOf)}</b></div>}
                  {s.extra?.next && <div><span>Next re-rank</span><b>{fmtDate(s.extra.next)}</b></div>}
                </div>
              </div>
              <PositionsPanel
                title={s.name}
                sleeve={s.code}
                positions={s.positions}
                asOf={displayPosAsOf}
                updatedAt={posUpdatedAt}
                live={liveMode}
                freshnessId={liveMode ? 'portfolio.paper-positions-intraday' : 'portfolio.paper-positions-snapshot'}
                cashValue={s.cash}
                totalCapital={STARTING_CAPITAL}
                onOpenTicker={onOpenTicker}
                cfg={colCfg}
                setCfg={setColCfg}
                scanScores={scanScores}
                momentumRanks={momMeta?.ranks || {}}
                overlapTickers={overlapTickers}
                hideSleeveColumn
                infoDef={s.infoDef}
              />
              <RebalanceLog orders={orders} fills={fills} sleeve={s.code} title={`${s.name} — recent activity`} />
            </div>
          ))}
        </div>

        {err && (
          <div style={{ marginTop: 24, padding: 14, background: 'var(--bg-2)', border: `1px solid ${DOWN_COLOR}`, borderRadius: 14, color: DOWN_COLOR, fontSize: 12 }}>
            Data load error: {err}
          </div>
        )}
      </section>
    </div>
  );
}



