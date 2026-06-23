// PaperPortfolioPage — Paper Trading Portfolio results page.
// rev: ticker-click + Score + Held (2026-05-29b) — cache-bust rebuild.
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
  'Buy at Score \u2265 5; sized at Score \u00d7 $10K \u2014 5 = $50K, 6 = $60K, 7 = $70K, 8 = $80K, 9 = $90K, 10 = $100K',
  'Long-only, 2\u00d7 max leverage',
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
.pcol-item input { accent-color: var(--accent, #0071e3); }
.pcol-foot { display: flex; justify-content: space-between; align-items: center;
  border-top: 1px solid var(--line-0); margin-top: 8px; padding-top: 8px; }
.pcol-reset { font-size: 11.5px; color: var(--accent, #0071e3); background: none; border: none; cursor: pointer; padding: 0; }
.paper-table th { position: relative; }
.paper-table th .rsz {
  position: absolute; top: 0; right: 0; width: 7px; height: 100%; cursor: col-resize; user-select: none;
}
.paper-table th.dragover { background: var(--bg-2); }
.paper-cash-row td { border-top: 1px solid var(--line-1); color: var(--ink-2); font-style: italic; }
.paper-cash-row td.mv { font-style: normal; font-weight: 500; color: var(--ink-1); }
.paper-ticker-link {
  background: none; border: none; padding: 0; font: inherit; font-weight: 500;
  color: var(--accent, #0071e3); cursor: pointer;
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

// Full dollars (no K-rounding) for P&L deltas — daily moves are hundreds of
// dollars and would render as "$0K". Accounting parentheses for negatives.
const fmt$Delta = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const s = `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
  return n < 0 ? `(${s})` : `+${s}`;
};

// Beta of a value series vs the SPY close series (daily returns,
// cov/var). Needs minN return pairs before it reports — below that the
// estimate is statistically meaningless noise.
const seriesBeta = (vals, spys, minN = 6) => {
  const br = [], sr = [];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] != null && vals[i - 1] && spys[i] != null && spys[i - 1]) {
      br.push(vals[i] / vals[i - 1] - 1);
      sr.push(spys[i] / spys[i - 1] - 1);
    }
  }
  const n = Math.min(br.length, sr.length);
  if (n < minN) return null;
  const mb = br.reduce((a, x) => a + x, 0) / n;
  const ms = sr.reduce((a, x) => a + x, 0) / n;
  const varS = sr.reduce((a, x) => a + (x - ms) ** 2, 0) / n;
  if (!varS) return null;
  const cov = br.reduce((a, x, i) => a + (x - mb) * (sr[i] - ms), 0) / n;
  return cov / varS;
};

const PAPER_SLEEVE_CAP = 500_000;

// Split the shared Alpaca account into two sleeve values that ALWAYS sum to
// the broker total (total_nav). The account shares one cash pool and one
// margin balance, so per-sleeve value = the sleeve's holdings + its share of
// the book's idle cash (or minus its share of borrowing). Handles BOTH
// regimes:
//   • net idle cash (book under-invested): cash goes to the sleeve(s) with
//     unused capacity below their $500K cap — a fully-invested sleeve holds
//     none. (Earlier bug: the levered-only formula dumped ALL idle cash on
//     whichever sleeve was $1 over cap, inventing a fake +35% sleeve.)
//   • net borrowing (book levered): the loan is charged to the sleeve(s) that
//     exceeded their cap.
// Returns dollar value AND cash for each sleeve so the tables can show cash.
function reconcileSleeves(row, aGrossOverride = null, bGrossOverride = null) {
  const CAP = PAPER_SLEEVE_CAP;
  if (!row || row.total_nav == null) return { aValue: null, bValue: null, aCash: null, bCash: null };
  const tn = row.total_nav;

  // Sleeve A retired 2026-06-23 — the Equity Scanner is the ENTIRE book now. When
  // there is no Sleeve A position, ALL idle cash belongs to the one sleeve, so
  // Cash + holdings tie to the account NAV. (Previously idle cash was split
  // against Sleeve A's old $500K cap, which hid ~$450K of cash on the table.)
  const _agNow = (aGrossOverride != null && Number.isFinite(aGrossOverride)) ? aGrossOverride : (row.sleeve_a_equity ?? 0);
  if (!_agNow || _agNow <= 0.01) {
    const _b = (bGrossOverride != null && Number.isFinite(bGrossOverride)) ? bGrossOverride
             : (row.sleeve_b_equity != null && Number.isFinite(row.sleeve_b_equity)) ? row.sleeve_b_equity : null;
    if (_b == null) return { aValue: 0, bValue: tn, aCash: 0, bCash: tn };
    return { aValue: 0, bValue: tn, aCash: 0, bCash: tn - _b };
  }
  // Prefer the EOD-priced per-sleeve holdings summed from the positions the page
  // actually displays, so the headline sleeve value equals the sleeve table.
  // The nav row's sleeve_*_equity is priced from live Alpaca and disagrees with
  // the prices_eod basis used everywhere else on the site; fall back to it only
  // when the live positions have not loaded.
  const ag = (aGrossOverride != null && Number.isFinite(aGrossOverride)) ? aGrossOverride : row.sleeve_a_equity;
  const bg = (bGrossOverride != null && Number.isFinite(bGrossOverride)) ? bGrossOverride : row.sleeve_b_equity;
  if (ag == null || bg == null) {
    const av = row.sleeve_a_value, bv = row.sleeve_b_value;
    if (av != null && bv != null && (av + bv) > 0) { const k = tn / (av + bv); return { aValue: av * k, bValue: bv * k, aCash: null, bCash: null }; }
    return { aValue: tn / 2, bValue: tn / 2, aCash: null, bCash: null };
  }
  const gross = ag + bg;
  const totalCash = tn - gross;                 // + = idle cash, − = net borrowing
  let aCash, bCash;
  if (totalCash >= 0) {
    const capA = Math.max(0, CAP - ag), capB = Math.max(0, CAP - bg);
    const base = capA + capB;
    if (base > 0) { aCash = totalCash * capA / base; bCash = totalCash * capB / base; }
    else { aCash = totalCash / 2; bCash = totalCash / 2; }
  } else {
    const borA = Math.max(0, ag - CAP), borB = Math.max(0, bg - CAP);
    const base = borA + borB;
    if (base > 0) { aCash = totalCash * borA / base; bCash = totalCash * borB / base; }
    else { aCash = totalCash / 2; bCash = totalCash / 2; }
  }
  return { aValue: ag + aCash, bValue: bg + bCash, aCash, bCash };
}

// ── ONE shared per-sleeve headline computation (Joe directive 2026-06-12) ──
// The Performance card AND each sleeve table's header line render THESE
// numbers — never a per-position re-sum. Any two surfaces saying "today" or
// "since inception" for a sleeve must show the same dollar.
// Daily $: the writer's exact session P&L when present (holdings move plus
// the effect of trades executed at the open), else the net-equity delta.
// Inception $/%: reconciled sleeve value vs its $500K start.
function sleeveHeadlines(navHistory, sleeveAGross = null, sleeveBGross = null) {
  const none = { value: null, prevValue: null, day$: null, incep$: null, incepPct: null };
  if (!navHistory || navHistory.length === 0) return { a: none, b: none };
  const latest = navHistory[navHistory.length - 1];
  const prev   = navHistory.length >= 2 ? navHistory[navHistory.length - 2] : null;
  const s = reconcileSleeves(latest, sleeveAGross, sleeveBGross);
  const p = reconcileSleeves(prev);
  const mk = (val, prevVal, exactDay) => ({
    value: val,
    prevValue: prevVal,
    day$: exactDay ?? ((val != null && prevVal != null) ? val - prevVal : null),
    incep$: val != null ? val - PAPER_SLEEVE_CAP : null,
    incepPct: val != null ? val / PAPER_SLEEVE_CAP - 1 : null,
  });
  return {
    a: mk(s.aValue, p.aValue, latest.sleeve_a_day_pnl ?? null),
    b: mk(s.bValue, p.bValue, latest.sleeve_b_day_pnl ?? null),
  };
}

function SummaryCard({ navHistory, sleeveAGross = null, sleeveBGross = null, live = false, asOfIso = null }) {
  const empty = !navHistory || navHistory.length === 0;
  const latest = empty ? null : navHistory[navHistory.length - 1];
  const prev   = (!empty && navHistory.length >= 2) ? navHistory[navHistory.length - 2] : null;

  // Betas computed from the same NAV history the card displays (daily
  // returns of each reconciled series vs SPY). Self-updating; needs ≥6
  // return pairs, indicative until ~20 sessions. (TTM column killed
  // 2026-06-10, Joe directive — meaningless while the book is young.)
  const betas = useMemo(() => {
    if (!navHistory || navHistory.length < 2) return { a: null, b: null, total: null };
    const spys = navHistory.map((r) => r.spy_close ?? null);
    const recon = navHistory.map((r) => reconcileSleeves(r));
    return {
      a: seriesBeta(recon.map((x) => x.aValue), spys),
      b: seriesBeta(recon.map((x) => x.bValue), spys),
      total: seriesBeta(navHistory.map((r) => r.total_nav ?? null), spys),
    };
  }, [navHistory]);

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
  const ret = (now, then) => (now != null && then) ? (now / then - 1) : null;
  const dlt = (now, then) => (now != null && then != null) ? now - then : null;

  // Sleeve values reconciled so Sleeve A + Sleeve B === Total (broker NAV),
  // in both the idle-cash and levered regimes. See reconcileSleeves above.
  // The latest row ties to the displayed sleeve tables (gross overrides);
  // the prior row reconciles from its own stored equities, so sleeve daily
  // P&L sums EXACTLY to the book's daily P&L on both days.
  const heads = sleeveHeadlines(navHistory, sleeveAGross, sleeveBGross);
  // (Sleeve values now roll up to the single Equity Scanner book; see rows below.)

  const spyNow = latest.spy_close ?? null;
  const spyVal = (spyNow && latest.spy_inception_close) ? TOTAL_CAP * (spyNow / latest.spy_inception_close) : null;
  const spyValPrev = (latest.spy_prev_close && latest.spy_inception_close)
    ? TOTAL_CAP * (latest.spy_prev_close / latest.spy_inception_close) : null;

  // Sleeve Daily $: prefer the writer's EXACT session P&L (holdings move +
  // effect of trades executed at the open; A+B sums to the book's NAV change
  // to the cent). Fall back to the net-equity delta for rows written before
  // the column existed.
  // Total Daily = the sum of the sleeve session P&Ls when the exact numbers
  // exist, so the card always foots on one consistent mark set (names whose
  // official bar is late carry broker marks until the morning certification;
  // summing keeps Total and sleeves on identical marks).
  const totDay$ = (latest.sleeve_b_day_pnl != null)
    ? latest.sleeve_b_day_pnl
    : dlt(latest.total_nav, prev?.total_nav);
  // Sleeve A retired 2026-06-23 — the Equity Scanner is now the entire book, so
  // the single sleeve row IS the total book ($1M start).
  const rows = [
    {
      label: 'Paper Portfolio', sub: '$1M start', strong: true,
      value: latest.total_nav,
      daily$: totDay$, daily: (totDay$ != null && prev?.total_nav) ? totDay$ / prev.total_nav : null,
      incep$: dlt(latest.total_nav, TOTAL_CAP),       incep: ret(latest.total_nav, TOTAL_CAP),
      beta: betas.total ?? latest.portfolio_beta ?? null,
    },
    {
      label: 'S&P 500', sub: '$1M buy & hold', benchmark: true,
      value: spyVal,
      daily$: dlt(spyVal, spyValPrev),  daily: ret(spyNow, latest.spy_prev_close),
      incep$: dlt(spyVal, TOTAL_CAP),   incep: ret(spyNow, latest.spy_inception_close),
      beta: 1.0,
    },
  ];
  const total = rows[0], spy = rows[1];
  const vs = {
    label: 'vs S&P 500', vs: true,
    value: (total.value != null && spy.value != null) ? total.value - spy.value : null,
    daily$: (total.daily$ != null && spy.daily$ != null) ? total.daily$ - spy.daily$ : null,
    daily: (total.daily != null && spy.daily != null) ? total.daily - spy.daily : null,
    incep$: (total.incep$ != null && spy.incep$ != null) ? total.incep$ - spy.incep$ : null,
    incep: (total.incep != null && spy.incep != null) ? total.incep - spy.incep : null,
    beta: null,
  };

  const betaTd = (r) => {
    if (r.vs) return <td className="muted"></td>;
    if (r.beta == null) return <td className="muted" title="Needs ~6 sessions of history; indicative until ~20">—</td>;
    return <td className="rowval" title="Indicative until ~20 sessions of history">{r.beta.toFixed(2)}</td>;
  };

  const Row = (r) => (
    <tr key={r.label} className={r.vs ? 'vs' : undefined}>
      <td className="rlabel">{r.label}{r.sub && <small>{r.sub}</small>}</td>
      <td className={r.vs ? dirClass(r.value) : 'rowval'}>{fmtK(r.value)}</td>
      <td className={dirClass(r.daily$)}>{fmt$Delta(r.daily$)}</td>
      <td className={dirClass(r.daily)}>{fmtPctP(r.daily)}</td>
      <td className={dirClass(r.incep$)}>{fmt$Delta(r.incep$)}</td>
      <td className={dirClass(r.incep)}>{fmtPctP(r.incep)}</td>
      {betaTd(r)}
    </tr>
  );

  return (
    <div className="paper-tile-summary">
      <div className="pts-head">
        <span className="pts-title">Performance <InfoTip term="Performance matrix" def="P&L for the Equity Scanner book and a $1M S&P 500 buy-and-hold benchmark — every value marked at OFFICIAL closing prices. The book snapshots each trading day ~4:50 PM ET at the broker's official closes; next morning the site's canonical price feed re-verifies those closes. Book value = account equity (cash + holdings, net of any borrowing). Inception = since the book opened, anchored to the $1M start. Beta = sensitivity to the S&P 500 from daily returns since inception — indicative until ~20 sessions of history. Daily is the exact session P&L — price moves of holdings plus the effect of any trades executed at the open." size={11} /></span>
        <span className="pts-asof">{live && asOfIso ? `AS OF ${(fmtTimeET(asOfIso) || '').toUpperCase()} ET · LIVE` : (latest.snapshot_date ? `AS OF ${fmtDate(latest.snapshot_date).toUpperCase()} · CLOSE` : '—')}</span>
      </div>
      <table className="pmx">
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr>
            <th></th><th>Value</th><th>Daily $</th><th>Daily %</th><th>Incep. $</th><th>Incep. %</th><th>Beta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(Row)}
          {Row(vs)}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
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
  { key: 'current_score',            label: 'Score',       w: 70,  align: 'right', fmt: 'num',    def: true, sleeveOnly: 'B' },
];

// ONE shared column config (visibility + order + width) for BOTH sleeve
// tables. Set once, persists once. Score is a Sleeve-B-only column.
// (Sleeve A retired 2026-06-23; only the Equity Scanner sleeve renders.)
const PAPER_COLS_KEY = 'mt_paper_cols_v3_shared';
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

function PositionsPanel({ title, sleeve, positions, totalCapital, infoDef, onOpenTicker, asOf, updatedAt, cashValue, cfg, setCfg, headline = null, live = false, freshnessId = 'portfolio.paper-positions-snapshot' }) {
  // Column visibility / order / widths come from ONE shared config (lifted to
  // the parent, persisted once). This table renders only the columns that
  // apply to its sleeve — Score is Sleeve-B-only and is filtered out elsewhere.
  const appliesToSleeve = (key) => {
    const m = POS_COLUMNS.find((c) => c.key === key);
    return !!m && (!m.sleeveOnly || m.sleeveOnly === sleeve);
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [sortBy, setSortBy] = useState('market_value');
  const [sortDir, setSortDir] = useState('desc');
  const meta = (k) => POS_COLUMNS.find((c) => c.key === k);
  const visibleCols = cfg.filter((c) => c.visible && appliesToSleeve(c.key));

  const grossLong = positions.reduce((s, p) => s + (p.market_value || 0), 0);
  // Header "today" / "since inception" come from the shared sleeveHeadlines
  // computation — identical to the Performance card by construction (Joe
  // directive 2026-06-12: the card and the tables must never disagree).
  // Never re-sum per-position P&L here; if the snapshot hasn't loaded, show
  // an em-dash rather than a divergent number.
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
      case 'ticker': return onOpenTicker
        ? <button type="button" className="paper-ticker-link" onClick={(e) => { e.stopPropagation(); onOpenTicker(p.ticker); }}>{p.ticker}</button>
        : <span style={{ color: 'var(--ink-0)', fontWeight: 500 }}>{p.ticker}</span>;
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
          <h2 className="paper-panel-title">Paper Portfolio</h2>
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

function RebalanceLog({ orders, fills }) {
  const [openDate, setOpenDate] = useState(null);
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
    <div className="paper-panel">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            Recent rebalances <InfoTip term="Recent rebalances" def="Last five days on which the engine fired buy or sell intents to Alpaca. Filled / pending / rejected counts come from the Alpaca order ledger." size={12} />
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
                <div className="paper-rebal-source">
                  {[...new Set(rows.map((r) => r.signal_source))].join(' + ')}
                </div>
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
                      <td>{l.sleeve}</td>
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
      spy_close: liveNav.spy_close, spy_prev_close: liveNav.spy_prev_close,
      spy_inception_close: liveNav.spy_inception_close,
      sleeve_b_day_pnl: liveNav.day_pnl, portfolio_beta: liveNav.portfolio_beta,
      created_at: liveNav.updated_at,
    }];
  }, [liveMode, liveNav, navHistory]);

  const sleeveA = useMemo(() => displayPositions.filter((p) => p.sleeve === 'A'), [displayPositions]);
  const sleeveB = useMemo(() => displayPositions.filter((p) => p.sleeve === 'B'), [displayPositions]);

  // Reconciled per-sleeve cash (idle) so each table can show a Cash line that
  // ties the sleeve's holdings + cash to the broker NAV.
  const latestNav = navForCard.length ? navForCard[navForCard.length - 1] : null;
  // Per-sleeve holdings, summed from the displayed positions, so the
  // Performance card's sleeve value and each table's Cash line tie to the rows.
  const sleeveAGross = useMemo(() => sleeveA.length ? sleeveA.reduce((s, p) => s + (p.market_value || 0), 0) : null, [sleeveA]);
  const sleeveBGross = useMemo(() => sleeveB.length ? sleeveB.reduce((s, p) => s + (p.market_value || 0), 0) : null, [sleeveB]);
  const recon = useMemo(() => reconcileSleeves(latestNav, sleeveAGross, sleeveBGross), [latestNav, sleeveAGross, sleeveBGross]);
  // Shared headline stats — the SAME object family the Performance card renders.
  const heads = useMemo(() => sleeveHeadlines(navForCard, sleeveAGross, sleeveBGross), [navForCard, sleeveAGross, sleeveBGross]);
  // Precise last-update timestamp for the displayed snapshot (has time-of-day,
  // so the freshness tooltip shows date AND time, not just a date).
  const posUpdatedAt = liveMode ? (liveNav.updated_at || liveNav.as_of_date)
    : displayPositions.reduce((mx, p) => (p.last_updated && (!mx || p.last_updated > mx)) ? p.last_updated : mx, null);

  // One shared column config for both sleeve tables — set once, persists for both.
  const [colCfg, setColCfg] = useState(loadPaperCols);
  useEffect(() => { try { localStorage.setItem(PAPER_COLS_KEY, JSON.stringify(colCfg)); } catch { /* ignore */ } }, [colCfg]);

  return (
    <div style={{ minHeight: '100vh' }}>
      <style>{PAGE_CSS}</style>

      <PageHero
        eyebrow="Paper Portfolio"
        title={HERO_TITLE}
        bullets={HERO_BULLETS}
        right={<SummaryCard navHistory={navForCard} sleeveAGross={sleeveAGross} sleeveBGross={sleeveBGross} live={liveMode} asOfIso={liveMode ? (liveNav.updated_at || liveNav.as_of_date) : null} />}
      />

      <div className="paper-shell">
        <PositionsPanel
          title="Equity Scanner — Long-Only"
          sleeve="B"
          positions={sleeveB}
          asOf={displayPosAsOf}
          updatedAt={posUpdatedAt}
          live={liveMode}
          freshnessId={liveMode ? 'portfolio.paper-positions-intraday' : 'portfolio.paper-positions-snapshot'}
          cashValue={recon.bCash}
          totalCapital={STARTING_CAPITAL}
          onOpenTicker={onOpenTicker}
          cfg={colCfg}
          setCfg={setColCfg}
          headline={heads.b}
          infoDef="$1M following the Trading Scanner long-only. Buy at Score ≥ 5; position size = Score × $10K (5 = $50K … 10 = $100K); up to 2× leverage when signals exceed the cash sleeve."
        />
        <RebalanceLog orders={orders} fills={fills} />

        {err && (
          <div style={{ marginTop: 24, padding: 14, background: 'var(--bg-2)', border: `1px solid ${DOWN_COLOR}`, borderRadius: 14, color: DOWN_COLOR, fontSize: 12 }}>
            Data load error: {err}
          </div>
        )}
      </div>
    </div>
  );
}



