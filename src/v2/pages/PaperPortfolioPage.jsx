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

// Day change % for a position — ONE rule, used everywhere the column renders
// (2026-07-15 fix). A position opened TODAY has only moved since its entry:
// measuring it against the prior close it never held through overstated the
// "day" move (AEHR bought at the open after a +33% gap showed +22.6% while
// actually down since entry). So: entry_date == the row's as-of date →
// price / avg cost − 1; otherwise price / prior close − 1. Fraction form.
const dayChangePct = (p, asOfIso) => {
  if (p?.current_price == null) return null;
  const boughtToday = p.entry_date && asOfIso
    && String(p.entry_date).slice(0, 10) === String(asOfIso).slice(0, 10);
  if (boughtToday && p.avg_cost) return p.current_price / p.avg_cost - 1;
  return p.lastday_price ? p.current_price / p.lastday_price - 1 : null;
};

// Same entry-aware rule for the DOLLAR day column and the sleeve cards'
// "Today" sums: a name bought on the as-of date has only earned its
// since-entry P&L today, not (close − a prior close it never held through).
// Applied once at row load so every consumer (row, total, card) agrees.
const dayAwareRow = (p, asOfIso) => {
  const boughtToday = p.entry_date && asOfIso
    && String(p.entry_date).slice(0, 10) === String(asOfIso).slice(0, 10);
  const dayPl = boughtToday
    ? (p.unrealized_pnl ?? p.unrealized_intraday_pl ?? null)
    : (p.unrealized_intraday_pl ?? null);
  return {
    ...p,
    unrealized_intraday_pl: dayPl,
    change_today: dayChangePct(p, asOfIso),
  };
};

// ── Performance math (shared, pure) ────────────────────────────────────────
// ONE module feeds the book card AND both sleeve cards, so every number on
// the page comes from the same window logic (shared-function rule 2026-06-12).
// Every function returns null on insufficient history; null renders as an
// em-dash — the page never fabricates a number. Everything below populates
// automatically as paper_nav_daily accrues rows after the account reset.

// last / value k sessions back − 1. Needs k+1 points.
function trailingReturn(values, k) {
  if (!Array.isArray(values) || values.length < k + 1) return null;
  const last = values[values.length - 1];
  const base = values[values.length - 1 - k];
  if (last == null || base == null || base === 0) return null;
  return last / base - 1;
}

// ONE sleeve-NAV accessor (2026-07-20, Joe: "sync these up"). A sleeve's
// value for ANY return math is its full account value — holdings + cash — so
// selling a name at a loss moves the number (position-only sums silently drop
// realized P&L: the Book said -0.5% while the sleeves read -0.3%/+0.1%
// because the morning GGAL sale's realized loss existed only at book level).
// Daily rows carry sleeve_*_nav; the live intraday row carries equity/value +
// cash pieces. Chart, sleeve tables, and the Today numbers all read THIS.
function sleeveNavOf(r, code) {
  if (!r) return null;
  if (code === 'B') {
    if (r.sleeve_b_nav != null) return Number(r.sleeve_b_nav);
    if (r.sleeve_b_equity != null) return Number(r.sleeve_b_equity) + Number(r.sleeve_b_cash ?? 0);
    return null;
  }
  if (r.sleeve_m_nav != null) return Number(r.sleeve_m_nav);
  if (r.sleeve_m_value != null) return Number(r.sleeve_m_value) + Number(r.sleeve_m_cash ?? 0);
  return null;
}

// series = [{ d:'YYYY-MM-DD', v }] ascending, nulls already removed.
// siBase: the capital base for since-inception (a sleeve's $500K allocation /
// the book's $1M); benchmarks pass null and measure from their first close.
// Windows: Day=1, 1W=5, 1M=21, 3M=63 sessions; YTD = vs the last row dated
// before Jan 1 of the latest row's year (series starts this year → YTD = SI).
function windowReturns(series, siBase = null) {
  const vals = series.map((p) => p.v);
  const n = vals.length;
  const out = {
    day: trailingReturn(vals, 1), w1: trailingReturn(vals, 5),
    m1: trailingReturn(vals, 21), m3: trailingReturn(vals, 63),
    ytd: null, si: null,
  };
  if (n === 0) return out;
  const last = vals[n - 1];
  const base0 = siBase != null ? siBase : (n >= 2 ? vals[0] : null);
  out.si = (last != null && base0) ? last / base0 - 1 : null;
  const yr = String(series[n - 1].d || '').slice(0, 4);
  let yBase = null;
  for (let i = n - 1; i >= 0; i--) {
    if (String(series[i].d || '').slice(0, 4) < yr) { yBase = vals[i]; break; }
  }
  out.ytd = yBase ? last / yBase - 1 : out.si;
  return out;
}

const meanOf = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const stdOf = (xs) => {
  if (!xs || xs.length === 0) return null;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length);
};

// Paired daily simple returns over rows where BOTH sides have a value, so
// beta / tracking error always compare identical sessions.
function pairedDailyReturns(pVals, bVals) {
  const rp = [], rb = [];
  let pp = null, pb = null, pFirst = null, bFirst = null, pLast = null, bLast = null;
  for (let i = 0; i < pVals.length; i++) {
    const a = pVals[i] != null ? Number(pVals[i]) : null;
    const b = bVals[i] != null ? Number(bVals[i]) : null;
    if (a == null || b == null || a === 0 || b === 0 || Number.isNaN(a) || Number.isNaN(b)) continue;
    if (pFirst == null) { pFirst = a; bFirst = b; }
    if (pp != null) { rp.push(a / pp - 1); rb.push(b / pb - 1); }
    pp = a; pb = b; pLast = a; bLast = b;
  }
  return { rp, rb, pFirst, bFirst, pLast, bLast };
}

// Since-inception risk block vs one benchmark. Gates: max drawdown needs ≥5
// daily returns; everything else needs ≥20 (n = daily-return count). rf = 0.
// downside deviation = √(Σ min(r,0)² / n) — zero-target, n denominator.
function riskStats(pVals, bVals) {
  const { rp, rb, pFirst, bFirst, pLast, bLast } = pairedDailyReturns(pVals, bVals);
  const n = rp.length;
  const out = { n, annVol: null, annRet: null, sharpe: null, sortino: null, maxDD: null, beta: null, te: null, ir: null };
  if (n >= 5) {
    let peak = -Infinity, mdd = 0;
    for (const raw of pVals) {
      const v = raw != null ? Number(raw) : null;
      if (v == null || Number.isNaN(v)) continue;
      if (v > peak) peak = v;
      const dd = peak > 0 ? v / peak - 1 : 0;
      if (dd < mdd) mdd = dd;
    }
    out.maxDD = mdd;
  }
  if (n >= 20) {
    const vol = stdOf(rp);
    out.annVol = vol != null ? vol * Math.sqrt(252) : null;
    out.annRet = (pFirst && pLast != null) ? Math.pow(pLast / pFirst, 252 / n) - 1 : null;
    out.sharpe = (out.annRet != null && out.annVol) ? out.annRet / out.annVol : null;
    const dDev = Math.sqrt(rp.reduce((s, r) => { const d = Math.min(r, 0); return s + d * d; }, 0) / n);
    out.sortino = (out.annRet != null && dDev > 0) ? out.annRet / (dDev * Math.sqrt(252)) : null;
    const mP = meanOf(rp), mB = meanOf(rb);
    const varB = rb.reduce((s, x) => s + (x - mB) * (x - mB), 0) / n;
    const cov = rp.reduce((s, x, i) => s + (x - mP) * (rb[i] - mB), 0) / n;
    out.beta = varB > 0 ? cov / varB : null;
    const te = stdOf(rp.map((r, i) => r - rb[i]));
    out.te = te != null ? te * Math.sqrt(252) : null;
    const annRetB = (bFirst && bLast != null) ? Math.pow(bLast / bFirst, 252 / n) - 1 : null;
    out.ir = (out.annRet != null && annRetB != null && out.te > 0) ? (out.annRet - annRetB) / out.te : null;
  }
  return out;
}

// Risk-metric display formats. Ratios two decimals; vol/drawdown one-decimal
// percent (drawdown carries its own minus sign).
const fmtRatio2 = (n) => (n == null || Number.isNaN(n)) ? '—' : n.toFixed(2);
const fmtPctPlain1 = (n) => (n == null || Number.isNaN(n)) ? '—' : `${(n * 100).toFixed(1)}%`;
const pctCls = (n) => (n == null ? 'mut' : (n >= 0 ? 'up' : 'down'));

// Fixed benchmark set (2026-07-15, Joe directive): the switcher is gone —
// S&P 500, NASDAQ 100 and Dow 30 render as always-visible rows. Benchmark
// history is self-sufficient: fetched straight from prices_eod at mount
// (~420 calendar days), so the rows populate even when paper_nav_daily is
// empty right after an account reset.

// Benchmark return since a given date: last close ÷ close on/nearest-before
// sinceDate − 1. Used for the "Start" column (book/sleeve inception anchor).
function returnSinceDate(series, sinceDate) {
  if (!Array.isArray(series) || series.length === 0 || !sinceDate) return null;
  let base = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (String(series[i].d) <= String(sinceDate)) { base = series[i].v; break; }
  }
  const last = series[series.length - 1].v;
  return (base && last != null) ? last / base - 1 : null;
}

// Pair a nav-row value series against a prices_eod benchmark series by date
// (falls back to the row's stamped close — e.g. the live intraday row, whose
// date has no prices_eod close yet). Feeds riskStats index-aligned.
function pairAgainstBench(navRows, valueOf, benchSeries, stampField) {
  const bMap = new Map((benchSeries || []).map((p) => [String(p.d).slice(0, 10), p.v]));
  const pVals = [], bVals = [];
  for (const r of (navRows || [])) {
    pVals.push(valueOf(r));
    const k = String(r.snapshot_date || '').slice(0, 10);
    bVals.push(bMap.get(k) ?? (r[stampField] != null ? Number(r[stampField]) : null));
  }
  return { pVals, bVals };
}

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
/* ── Performance chart panel (2026-07-20) ── */
.pp-perfchart .paper-panel-head { align-items: flex-start; }
.pp-pc-wins { display: inline-flex; gap: 4px; background: var(--surface-1, #f3efe7); border: 1px solid var(--line-0, #e6e2d8); border-radius: 999px; padding: 3px; }
.pp-pc-win { border: none; background: transparent; font: inherit; font-size: 12px; color: var(--ink-2, #6b675e); padding: 4px 12px; border-radius: 999px; cursor: pointer; }
.pp-pc-win.on { background: var(--surface-0, #fff); color: var(--ink-0, #111927); box-shadow: 0 1px 2px rgba(0,0,0,0.06); font-weight: 600; }
.pp-pc-legend { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 20px 12px; }
.pp-pc-tog { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line-0, #e6e2d8); background: transparent; border-radius: 999px; font: inherit; font-size: 11.5px; color: var(--ink-3, #8a8578); padding: 4px 11px; cursor: pointer; }
.pp-pc-tog.on { color: var(--ink-0, #111927); background: var(--surface-1, #f7f4ec); border-color: var(--line-1, #d8d3c6); }
.pp-pc-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.pp-pc-tip { position: absolute; top: 8px; background: var(--surface-0, #fff); border: 1px solid var(--line-1, #d8d3c6); border-radius: 8px; padding: 8px 10px; font-size: 11.5px; box-shadow: 0 8px 24px rgba(0,0,0,0.10); pointer-events: none; min-width: 178px; z-index: 5; }
.pp-pc-tipdate { color: var(--ink-2, #6b675e); font-weight: 600; margin-bottom: 4px; }
.pp-pc-tiprow { display: flex; align-items: center; gap: 6px; padding: 1.5px 0; color: var(--ink-1, #3d3a33); }
.pp-pc-tiprow b { margin-left: auto; font-weight: 600; }
.pp-pc-tiprow b.up { color: ${UP_COLOR}; }
.pp-pc-tiprow b.down { color: ${DOWN_COLOR}; }
@media (max-width: 640px) { .pp-perfchart .paper-panel-head { flex-direction: column; gap: 10px; } }

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

/* ── Performance block (book card + sleeve cards), 2026-07-15 ─────────────
   Institutional returns table + risk strip. Light-mode first; tabular
   numerals everywhere; em-dash for insufficient history. */
.pp-perf { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--line-0); padding-top: 12px; }
.pp-rt-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
.pp-rt { width: 100%; min-width: 460px; border-collapse: collapse; font-feature-settings: "tnum","lnum"; }
.pp-rt.mini { min-width: 320px; }
.pp-rt th, .pp-rt td { padding: 7px 6px; text-align: right; white-space: nowrap; font-size: 12.5px; }
.pp-rt thead th {
  font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink-2); font-weight: 500; border-bottom: 1px solid var(--line-1);
}
.pp-rt th:first-child, .pp-rt td:first-child { text-align: left; }
.pp-rt tbody td { border-bottom: 1px solid var(--line-0); color: var(--ink-1); }
.pp-rt tbody tr:last-child td { border-bottom: none; }
.pp-rt .rl { color: var(--ink-0); font-weight: 500; }
.pp-rt tr.ex td { border-top: 1px solid var(--line-1); }
.pp-rt tr.ex .rl { color: var(--ink-1); font-weight: 500; }
.pp-rt td.up { color: ${UP_COLOR}; }
.pp-rt td.down { color: ${DOWN_COLOR}; }
.pp-rt td.mut { color: var(--ink-3); }
.pp-risk { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px 10px; border-top: 1px solid var(--line-0); padding-top: 10px; }
.pp-risk.mini { grid-template-columns: repeat(3, 1fr); }
.pp-risk-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pp-risk-item .lbl {
  font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink-2); font-weight: 500; width: max-content; max-width: 100%;
}
.pp-risk-item .val { font-size: 12.5px; color: var(--ink-0); font-weight: 500; font-feature-settings: "tnum","lnum"; }
.pp-risk-note { font-size: 10.5px; color: var(--ink-3); letter-spacing: .01em; }
/* Instant CSS tooltip (page pattern — data-tip attribute, never native title). */
.pp-tip { position: relative; cursor: help; border-bottom: 1px dotted var(--ink-3); }
.pp-tip:hover::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 7px); left: 50%; transform: translateX(-50%);
  width: 210px; white-space: normal;
  background: var(--ink-0, #16181d); color: var(--bg-1, #fff);
  font-size: 11px; line-height: 1.45; font-weight: 400; letter-spacing: 0; text-transform: none;
  padding: 8px 10px; border-radius: 8px; z-index: 50;
  box-shadow: 0 6px 20px rgba(15,23,42,.18); pointer-events: none;
}
.pp-risk-item:first-child .pp-tip:hover::after { left: 0; transform: none; }
.pp-risk-item:last-child .pp-tip:hover::after { left: auto; right: 0; transform: none; }
/* Sleeve-card mini block spacing (sits between the value and the stat rows). */
.pp-sc-perf { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 12px; }
@media (max-width: 640px) {
  /* Returns tables scroll horizontally inside the card — never truncate. */
  .pp-rt { min-width: 440px; }
  .pp-rt.mini { min-width: 320px; }
  .pp-risk { grid-template-columns: repeat(3, 1fr); }
  .pp-tip:hover::after { width: 170px; }
}
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
// to the Alpaca NAV by construction: cash = NAV − gross holdings.
// 2026-07-15: the engine now writes each sleeve's OWN cash on the nav row
// (sleeve_b_cash / sleeve_m_cash) — when those are present they are the
// truth and are used directly. The old capacity-based inference below stays
// only as a fallback for older rows where the columns are NULL.
function splitBook(totalNav, insGross, momGross, insCap, momCap, bCash = null, mCash = null) {
  if (totalNav == null) return { insValue: null, momValue: null, cash: null, insCash: null, momCash: null };
  const ig = insGross || 0, mg = momGross || 0;
  const cash = totalNav - ig - mg;
  if (bCash != null && mCash != null) {
    const insCash = Number(bCash), momCash = Number(mCash);
    return { insValue: ig + insCash, momValue: mg + momCash, cash, insCash, momCash };
  }
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

// One compact risk stat with an instant CSS tooltip (data-tip pattern —
// never the native title attribute).
function RiskStat({ label, tip, value }) {
  return (
    <div className="pp-risk-item">
      <span className="lbl pp-tip" data-tip={tip}>{label}</span>
      <span className="val">{value}</span>
    </div>
  );
}

/* BookCard — the combined-account card in the hero (2026-07-15 institutional
   redesign, Joe directive: trailing returns across timeframes vs FIXED
   benchmark rows — S&P 500, NASDAQ 100, Dow 30 — an explicit Excess-vs-S&P
   line, and since-inception risk stats). Headline NAV unchanged; the
   holdings/cash split bar lives below the hero and is untouched. */
// day$Override: the SUM of the two sleeve cards' Today numbers (one shared
// computation, Joe rule 2026-06-12 — the book card and the sleeve cards must
// tie by construction, never two bases for the same word).
// benchHistory: { spy, qqq, dia } ascending [{d, v}] series from prices_eod —
// self-sufficient, so every benchmark row populates even with ZERO nav rows
// (Joe 2026-07-15: no more all-em-dash table right after an account reset).
function BookCard({ navHistory, benchHistory = {}, live = false, asOfIso = null, day$Override = null }) {
  const rows = navHistory || [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  const nav = latest ? latest.total_nav : null;
  const day$ = day$Override;
  const incep$ = nav != null ? nav - STARTING_CAPITAL : null;

  // Book windows come from the nav rows (close-to-close; live overlay is the
  // last row in live mode, so Day = live NAV vs prior close NAV). Benchmark
  // windows come from the prices_eod series with the SAME session logic
  // (1/5/21/63 sessions; YTD vs last close of the prior year). In live mode
  // each benchmark's Day is overridden by the live quote stamped on the
  // intraday row when present.
  const navSeries = rows.filter((r) => r.total_nav != null)
    .map((r) => ({ d: r.snapshot_date, v: Number(r.total_nav) }));
  const inception = navSeries.length ? String(navSeries[0].d).slice(0, 10) : null;
  const book = windowReturns(navSeries, STARTING_CAPITAL);

  const benchRow = (k) => {
    const s = benchHistory[k] || [];
    const bm = windowReturns(s, null);
    // "Start" for a benchmark = its return since the BOOK's inception date
    // (close on/nearest-before that date). Em-dash while the book has no rows.
    bm.si = inception ? returnSinceDate(s, inception) : null;
    // Same-window discipline (Joe 2026-07-20): the book's "YTD" is really
    // since-inception while the book is younger than the calendar year, so the
    // benchmark's YTD must measure from the SAME date — comparing a 3-day-old
    // book against the S&P's calendar-year run produced a fictional "-10.7%
    // YTD excess". Windows must be identical or the excess line is meaningless.
    const curYear = new Date().getFullYear();
    if (inception && Number(String(inception).slice(0, 4)) >= curYear) bm.ytd = bm.si;
    if (live && latest && latest[`${k}_close`] && latest[`${k}_prev_close`]) {
      bm.day = Number(latest[`${k}_close`]) / Number(latest[`${k}_prev_close`]) - 1;
    }
    return bm;
  };
  const spy = benchRow('spy');
  const cols = [['Day', 'day'], ['1W', 'w1'], ['1M', 'm1'], ['3M', 'm3'], ['YTD', 'ytd'], ['Start', 'si']];
  const benchRows = [
    ['S&P 500', spy],
    ['NASDAQ 100', benchRow('qqq')],
    ['Dow 30', benchRow('dia')],
  ];
  const excess = {};
  cols.forEach(([, k]) => { excess[k] = (book[k] != null && spy[k] != null) ? book[k] - spy[k] : null; });

  // Risk strip is fixed vs the S&P 500: nav rows paired against the
  // prices_eod SPY series by date (stamped spy_close as fallback for the
  // live row), so beta/TE/IR build as soon as 20 book sessions exist.
  const paired = pairAgainstBench(rows, (r) => r.total_nav, benchHistory.spy, 'spy_close');
  const risk = riskStats(paired.pVals, paired.bVals);

  // Honest-but-not-blank empty state: benchmarks always show; the quiet line
  // below the table disappears once the book has its first return.
  const bookHasReturn = navSeries.length >= 2 || book.day != null;

  return (
    <div className="paper-tile-summary pp-book">
      <div className="pts-head">
        <span className="pts-title">Paper portfolio · $1M start</span>
        <span className="pts-asof">{live && asOfIso ? `AS OF ${(fmtTimeET(asOfIso) || '').toUpperCase()} ET · LIVE` : (latest?.snapshot_date ? `AS OF ${fmtDate(latest.snapshot_date).toUpperCase()} · CLOSE` : '—')}</span>
      </div>
      <div className="pp-book-nav">{fmtMoneyExact(nav)}</div>
      <div className="pp-book-rows">
        <div><span>Today</span><b className={dirClass(day$)}>{fmt$Delta(day$)}</b></div>
        <div><span>Since inception</span><b className={dirClass(incep$)}>{fmt$Delta(incep$)}</b></div>
      </div>
      <div className="pp-perf">
        <div className="pp-rt-scroll">
          <table className="pp-rt">
            <thead>
              <tr><th>Return</th>{cols.map(([l]) => <th key={l}>{l}</th>)}</tr>
            </thead>
            <tbody>
              <tr><td className="rl">Book</td>{cols.map(([l, k]) => <td key={l} className={book[k] == null ? 'mut' : ''}>{fmtPctP(book[k], 1)}</td>)}</tr>
              {benchRows.map(([label, bm]) => (
                <tr key={label}><td className="rl">{label}</td>{cols.map(([l, k]) => <td key={l} className={bm[k] == null ? 'mut' : ''}>{fmtPctP(bm[k], 1)}</td>)}</tr>
              ))}
              <tr className="ex"><td className="rl">Excess vs S&amp;P</td>{cols.map(([l, k]) => <td key={l} className={pctCls(excess[k])}>{fmtPctP(excess[k], 1)}</td>)}</tr>
            </tbody>
          </table>
        </div>
        {!bookHasReturn && (
          <div className="pp-risk-note">Book tracking starts at the first close after the account reset — benchmarks shown meanwhile.</div>
        )}
        <div className="pp-risk">
          <RiskStat label="Ann. vol" value={fmtPctPlain1(risk.annVol)} tip="Annualized volatility: standard deviation of daily returns × √252, since inception." />
          <RiskStat label="Sharpe" value={fmtRatio2(risk.sharpe)} tip="Annualized return ÷ annualized volatility. Risk-free rate assumed 0." />
          <RiskStat label="Sortino" value={fmtRatio2(risk.sortino)} tip="Annualized return ÷ annualized downside deviation — only losing days count against the book." />
          <RiskStat label="Max drawdown" value={fmtPctPlain1(risk.maxDD)} tip="Largest peak-to-trough decline in account value since inception." />
          <RiskStat label="Beta" value={fmtRatio2(risk.beta)} tip="Sensitivity to the S&P 500's daily moves; 1.00 means the book moves in line with it." />
          <RiskStat label="Info ratio" value={fmtRatio2(risk.ir)} tip="Annualized excess return over the S&P 500 ÷ tracking error — how consistently the book beats it." />
        </div>
        {risk.n < 20 && (
          <div className="pp-risk-note">Risk metrics build after 20 trading sessions ({risk.n} so far).</div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <FreshnessChip elementId={live ? 'portfolio.paper-nav-intraday' : 'portfolio.paper-nav-daily'} variant="label" fallback={{ asOfIso: live ? asOfIso : (latest ? (latest.created_at || latest.snapshot_date) : null), calendar: 'nyse' }} />
      </div>
    </div>
  );
}

/* SleevePerf — one sleeve's mini returns table (Day · 1W · 1M · Start vs the
   S&P 500, with an explicit Excess line) plus a Sharpe / Max DD / Beta strip.
   Sleeve series = its value column on the nav rows (leading nulls skipped);
   the S&P side comes from the self-sufficient prices_eod SPY series
   (spySeries prop), so it populates even with zero sleeve history. The S&P
   "Start" is gated on the SLEEVE's own inception (close on/nearest-before
   its first nav row). SI base = the sleeve's allocation from paper_accounts. */
function SleevePerf({ rows, sleeveCode, alloc, spySeries = [], live = false }) {
  // NAV series (holdings + cash) via the shared accessor — the SAME family of
  // numbers the Book matrix uses (total_nav), so Day/1W/1M/Start here are
  // flow-adjusted and the two sleeves weighted-average exactly to the Book
  // row. The old series used the gross-holdings column and overrode live Day
  // with the positions' intraday P&L sum, which excludes anything realized on
  // names SOLD today — the sleeves and the Book could disagree every
  // rebalance morning (Joe caught -0.3%/+0.1% vs Book -0.5%, 2026-07-20).
  const sRows = (rows || []).filter((r) => sleeveNavOf(r, sleeveCode) != null);
  const series = sRows.map((r) => ({ d: r.snapshot_date, v: sleeveNavOf(r, sleeveCode) }));
  const inception = series.length ? String(series[0].d).slice(0, 10) : null;
  const sv = windowReturns(series, alloc > 0 ? alloc : null);
  const bm = windowReturns(spySeries, null);
  bm.si = inception ? returnSinceDate(spySeries, inception) : null;
  if (live) {
    // S&P Day = live quote vs its own stamped prior close when present; the
    // sleeve's Day already falls out of the NAV series (live vs prior close).
    const lr = sRows[sRows.length - 1];
    if (lr && lr.spy_close && lr.spy_prev_close) bm.day = Number(lr.spy_close) / Number(lr.spy_prev_close) - 1;
  }
  const cols = [['Day', 'day'], ['1W', 'w1'], ['1M', 'm1'], ['Start', 'si']];
  const excess = {};
  cols.forEach(([, k]) => { excess[k] = (sv[k] != null && bm[k] != null) ? sv[k] - bm[k] : null; });
  const paired = pairAgainstBench(sRows, (r) => sleeveNavOf(r, sleeveCode), spySeries, 'spy_close');
  const risk = riskStats(paired.pVals, paired.bVals);
  return (
    <div className="pp-sc-perf">
      <div className="pp-rt-scroll">
        <table className="pp-rt mini">
          <thead>
            <tr><th>Return</th>{cols.map(([l]) => <th key={l}>{l}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td className="rl">Sleeve</td>{cols.map(([l, k]) => <td key={l} className={sv[k] == null ? 'mut' : ''}>{fmtPctP(sv[k], 1)}</td>)}</tr>
            <tr><td className="rl">S&amp;P 500</td>{cols.map(([l, k]) => <td key={l} className={bm[k] == null ? 'mut' : ''}>{fmtPctP(bm[k], 1)}</td>)}</tr>
            <tr className="ex"><td className="rl">Excess</td>{cols.map(([l, k]) => <td key={l} className={pctCls(excess[k])}>{fmtPctP(excess[k], 1)}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <div className="pp-risk mini">
        <RiskStat label="Sharpe" value={fmtRatio2(risk.sharpe)} tip="Annualized return ÷ annualized volatility, daily data since inception. Risk-free rate assumed 0." />
        <RiskStat label="Max DD" value={fmtPctPlain1(risk.maxDD)} tip="Largest peak-to-trough decline in sleeve value since inception." />
        <RiskStat label="Beta" value={fmtRatio2(risk.beta)} tip="Sensitivity to the S&P 500's daily moves; 1.00 means the sleeve moves in line with it." />
      </div>
      {risk.n < 20 && (
        <div className="pp-risk-note">Risk metrics build after 20 trading sessions ({risk.n} so far).</div>
      )}
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
  // Power Trend rank (#n) for Momentum rows (two-sleeve spec §4).
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
    if (key === 'change_today') {                     // shared entry-aware helper (one rule everywhere)
      return p.change_today != null ? p.change_today : dayChangePct(p, asOf);
    }
    if (key === 'current_score') {
      // Momentum rows sort/show by their current Power Trend rank; Insider
      // rows by the LIVE scanner score (source of truth, trading_opps_signals).
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
          {sleeve === 'M'
            ? 'No filled positions yet. Queued orders fill at the next market open and appear here.'
            : 'Scanner found no qualifying buy signals at the moment. Positions appear here after the next rebalance cycle.'}
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
        {/* Grade the ENGINE's intent feed (pipeline_health), not the sleeve's own
            last order date. A monthly sleeve (Momentum / Power Trend) legitimately
            goes weeks without orders — passing its last order as the on-screen
            as-of made this chip red while the engine was running fine every
            morning and simply choosing not to trade (Joe 2026-07-20). An empty
            ledger is a fact, not staleness; the panel shows the dates anyway. */}
        <FreshnessChip elementId="portfolio.paper-orders-intent" variant="label" />
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
            // 'submitted' counts with 'pending': orders now normally reach
            // 'filled' (reconciler, 2026-07-15), so anything still sitting in
            // either state is genuinely awaiting a fill and must be visible.
            const pending = rows.filter((r) => r.status === 'pending' || r.status === 'submitted').length;
            const rejected = rows.filter((r) => r.status === 'rejected').length;
            // Queued = when these orders were sent to the broker; Filled = when
            // they executed at the open (from the fills ledger, matched on the
            // submit date so each row shows its own fills).
            const submits = rows.map((r) => r.submitted_at).filter(Boolean).sort();
            const queuedAt = submits[0] || null;
            const filledAt = fillByDate.get(etDateKey(queuedAt) || date) || null;
            // Plain-English pending copy (2026-07-20): before the open a queued
            // order is just waiting for the opening auction — nothing is wrong.
            // After the open, fills confirm on the next mirror pass (~minutes).
            const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const isToday = etDateKey(queuedAt) === new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            const preOpen = isToday && (etNow.getHours() * 60 + etNow.getMinutes()) < 9 * 60 + 30;
            const pendingWord = preOpen ? 'queued for today\u2019s open' : 'awaiting fill confirmation';
            return (
              <div key={date} className="paper-rebal-row paper-rebal-clickable" onClick={() => setOpenDate(date)} role="button" tabIndex={0}>
                <div className="paper-rebal-date">
                  {fmtDate(date)}
                  {' '}<span className="paper-rebal-meta">
                    &middot; {rows.length} orders ({buys} buys, {sells} sells)
                    {pending > 0  && <> &middot; <span style={{ color: WARN_COLOR }}>{pending} {pendingWord}</span></>}
                    {rejected > 0 && <> &middot; <span style={{ color: DOWN_COLOR }}>{rejected} rejected</span></>}
                    {queuedAt && <> &middot; queued {fmtTimeET(queuedAt)}</>}
                    {filledAt
                      ? <> &middot; <span style={{ color: UP_COLOR }}>filled {fmtTimeET(filledAt)}</span></>
                      : (queuedAt && <> &middot; <span style={{ color: WARN_COLOR }}>{preOpen ? 'fills at the open' : 'fill confirmation pending'}</span></>)}
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


/* ── PerfChartPanel — indexed growth chart: book + sleeves vs benchmarks ────
   Joe 2026-07-20: "show a chart so I can see how the portfolio is performing
   over time relative to benchmarks — each sleeve, overall, timeframes,
   different benchmarks." Every visible series is indexed to 100 at the start
   of the selected window, so magnitudes are directly comparable on one axis
   (BigHistoryChart normalizes compares to their own range — right for shape
   overlays, wrong for performance comparison — hence this dedicated chart).
   Window math mirrors BookCard/windowReturns: sessions not calendar days;
   "Start" indexes the book at its capital base ($1M / $500K sleeves) so
   day-one losses are visible, and benchmarks from their close on/nearest-
   before inception (same anchor as the matrix's Start column). */
const PERF_SERIES = [
  { k: 'total', label: 'Total book',        color: 'var(--ink-0, #111927)', width: 2.2, dash: null },
  { k: 'ins',   label: 'Insider Conviction', color: '#a07e2e', width: 1.6, dash: null },
  { k: 'mom',   label: 'Momentum',           color: '#3e7a44', width: 1.6, dash: null },
  { k: 'spy',   label: 'S&P 500',            color: '#8a8578', width: 1.4, dash: '5 4' },
  { k: 'qqq',   label: 'NASDAQ 100',         color: '#5e7d9a', width: 1.4, dash: '5 4' },
  { k: 'dia',   label: 'Dow 30',             color: '#9a6a5e', width: 1.4, dash: '5 4' },
  { k: 'iwm',   label: 'Russell 2000',       color: '#7d6f9a', width: 1.4, dash: '5 4' },
];
const PERF_WINDOWS = [['1W', 5], ['1M', 21], ['3M', 63], ['Start', Infinity]];

function benchAtOrBefore(series, dateIso) {
  if (!series || !series.length || !dateIso) return null;
  let v = null;
  for (let i = 0; i < series.length; i++) {
    if (series[i].d <= dateIso) v = series[i].v; else break;
  }
  return v;
}

function PerfChartPanel({ rows, benchHistory, insCap, momCap, live }) {
  const [win, setWin] = useState('Start');
  const [on, setOn] = useState({ total: true, ins: true, mom: true, spy: true, qqq: false, dia: false, iwm: false });
  // CALLBACK ref, not useRef + mount effect: this component returns null until
  // the nav rows load, so a mount-time effect ran before the div existed and
  // the ResizeObserver never attached — the chart stayed at its 860px default
  // inside a wider panel (caught in live UAT 2026-07-20). The state-ref
  // re-fires the effect the moment the div actually appears.
  const [wrapEl, setWrapEl] = useState(null);
  const [w, setW] = useState(860);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    if (!wrapEl) return undefined;
    const ro = new ResizeObserver((es) => { for (const e of es) setW(Math.max(320, Math.round(e.contentRect.width) - 40)); });
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);

  // Raw dollar value per series per book row (skip rows with no value).
  const bookRows = useMemo(() => (rows || []).filter((r) => r.total_nav != null).map((r) => ({
    d: String(r.snapshot_date).slice(0, 10),
    total: Number(r.total_nav),
    ins: sleeveNavOf(r, 'B'),
    mom: sleeveNavOf(r, 'M'),
  })), [rows]);

  const model = useMemo(() => {
    if (!bookRows.length) return null;
    const nSess = PERF_WINDOWS.find(([l]) => l === win)?.[1] ?? Infinity;
    const visRows = Number.isFinite(nSess) ? bookRows.slice(-(nSess + 1)) : bookRows;
    const isStart = !Number.isFinite(nSess) || visRows.length === bookRows.length;
    const inception = bookRows[0].d;
    // Per-series base: capital allocations for the Start window (so the first
    // session's P&L shows); first in-window value otherwise.
    const base = {};
    const first = visRows[0];
    base.total = isStart ? STARTING_CAPITAL : first.total;
    base.ins = isStart ? (insCap || null) : first.ins;
    base.mom = isStart ? (momCap || null) : first.mom;
    const anchorDate = isStart ? inception : first.d;
    ['spy', 'qqq', 'dia', 'iwm'].forEach((k) => { base[k] = benchAtOrBefore(benchHistory?.[k], anchorDate); });
    // Points: optional synthetic index-100 origin for Start, then one point
    // per book session. x = session index (calendar gaps are not sessions).
    const pts = [];
    if (isStart) pts.push({ d: inception, label: 'Inception', vals: Object.fromEntries(PERF_SERIES.map(({ k }) => [k, 100])) });
    visRows.forEach((r) => {
      const vals = {};
      PERF_SERIES.forEach(({ k }) => {
        let raw = null;
        if (k === 'total' || k === 'ins' || k === 'mom') raw = r[k];
        else raw = benchAtOrBefore(benchHistory?.[k], r.d);
        vals[k] = (raw != null && base[k]) ? (raw / base[k]) * 100 : null;
      });
      pts.push({ d: r.d, label: fmtDate(r.d), vals });
    });
    return { pts, isStart, inception };
  }, [bookRows, benchHistory, win, insCap, momCap]);

  if (!model || model.pts.length < 2) return null;
  const { pts } = model;
  const active = PERF_SERIES.filter(({ k }) => on[k] && pts.some((p) => p.vals[k] != null));
  const H = 280; const padL = 46; const padR = 14; const padT = 14; const padB = 26;
  const iw = Math.max(1, w - padL - padR); const ih = H - padT - padB;
  const allVals = active.flatMap(({ k }) => pts.map((p) => p.vals[k]).filter((v) => v != null));
  const lo = Math.min(...allVals, 100); const hi = Math.max(...allVals, 100);
  const pad = Math.max((hi - lo) * 0.12, 0.4);
  const y0 = lo - pad; const y1 = hi + pad;
  const X = (i) => padL + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * iw);
  const Y = (v) => padT + (1 - (v - y0) / (y1 - y0)) * ih;
  const ticks = [];
  { const span = y1 - y0; const step = span > 12 ? 5 : span > 6 ? 2 : span > 2.4 ? 1 : 0.5;
    for (let t = Math.ceil(y0 / step) * step; t <= y1; t += step) ticks.push(Number(t.toFixed(2))); }
  const pathFor = (k) => pts.map((p, i) => (p.vals[k] == null ? null : `${X(i).toFixed(1)},${Y(p.vals[k]).toFixed(1)}`))
    .reduce((acc, xy) => (xy == null ? acc : acc + (acc.endsWith('L') || acc === '' ? `${acc ? '' : 'M'}${xy}` : ` L${xy}`)), '');
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - padL) / iw) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  };
  const hp = hover != null ? pts[hover] : null;

  return (
    <div className="paper-panel pp-perfchart">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            Performance <InfoTip term="Performance" def="Growth of every series indexed to 100 at the start of the selected window, so the book, each sleeve, and the benchmarks are directly comparable. The book indexes from its $1M start (sleeves from their $500K allocations); benchmarks from their close on the same date." size={12} />
          </h2>
          <div className="paper-panel-sub">Indexed to 100 at {win === 'Start' ? `inception (${fmtDate(model.inception)})` : `the start of the ${win} window`} · close-to-close{live ? ' · latest point is today, live' : ''}</div>
        </div>
        <div className="pp-pc-wins" role="tablist" aria-label="Timeframe">
          {PERF_WINDOWS.map(([l]) => (
            <button key={l} type="button" role="tab" aria-selected={win === l} className={`pp-pc-win${win === l ? ' on' : ''}`} onClick={() => setWin(l)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="pp-pc-legend">
        {PERF_SERIES.map(({ k, label, color }) => (
          <button key={k} type="button" className={`pp-pc-tog${on[k] ? ' on' : ''}`} aria-pressed={on[k]} onClick={() => setOn((o) => ({ ...o, [k]: !o[k] }))}>
            <span className="pp-pc-dot" style={{ background: on[k] ? color : 'var(--ink-3, #9aa)' }} />{label}
          </button>
        ))}
      </div>
      <div ref={setWrapEl} style={{ position: 'relative', padding: '0 20px 16px' }}>
        {/* width={w} (not 100%): the svg's pixel width must equal its viewBox
            width, or preserveAspectRatio letterboxes the drawing with blank
            side margins and the hover x-math goes off by the margin. */}
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} stroke="var(--line-0, #e6e2d8)" strokeWidth={t === 100 ? 0 : 1} />
              <text x={padL - 8} y={Y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--ink-3, #8a8578)">{`${t - 100 > 0 ? '+' : ''}${(t - 100).toFixed(Math.abs(t - 100) < 1 && t !== 100 ? 1 : 0)}%`}</text>
            </g>
          ))}
          <line x1={padL} x2={w - padR} y1={Y(100)} y2={Y(100)} stroke="var(--ink-3, #8a8578)" strokeWidth="1" strokeDasharray="2 3" />
          {active.map(({ k, color, width, dash }) => (
            <path key={k} d={pathFor(k)} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash || undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hp && <line x1={X(hover)} x2={X(hover)} y1={padT} y2={H - padB} stroke="var(--ink-3, #8a8578)" strokeWidth="1" strokeDasharray="2 2" />}
          {hp && active.map(({ k, color }) => (hp.vals[k] == null ? null : <circle key={k} cx={X(hover)} cy={Y(hp.vals[k])} r="3" fill={color} />))}
          {pts.map((p, i) => ((pts.length <= 8 || i === 0 || i === pts.length - 1 || i % Math.ceil(pts.length / 6) === 0) ? (
            <text key={p.d + i} x={X(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'} fontSize="10.5" fill="var(--ink-3, #8a8578)">{p.label === 'Inception' ? 'Inception' : p.label}</text>
          ) : null))}
        </svg>
        {hp && (
          <div className="pp-pc-tip" style={{ left: Math.min(Math.max(X(hover) - 10, 0), w - 190) }}>
            <div className="pp-pc-tipdate">{hp.label === 'Inception' ? `Inception · ${fmtDate(model.inception)}` : hp.label}</div>
            {active.map(({ k, label, color }) => (hp.vals[k] == null ? null : (
              <div key={k} className="pp-pc-tiprow">
                <span className="pp-pc-dot" style={{ background: color }} />{label}
                <b className={hp.vals[k] >= 100 ? 'up' : 'down'}>{`${hp.vals[k] - 100 >= 0 ? '+' : ''}${(hp.vals[k] - 100).toFixed(2)}%`}</b>
              </div>
            )))}
          </div>
        )}
      </div>
    </div>
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
  const [scanScores, setScanScores] = useState({});
  const [momMeta, setMomMeta] = useState(null); // { ranks: {ticker: rank}, asOf, next }
  // Self-sufficient benchmark history from prices_eod (2026-07-15): per-ticker
  // ascending [{d, v}] series so the benchmark rows populate even when
  // paper_nav_daily has zero rows (fresh account reset).
  const [benchHistory, setBenchHistory] = useState({ spy: [], qqq: [], dia: [], iwm: [] });
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

        // Benchmark closes, ~420 calendar days (covers 3M + YTD + prior-year
        // anchor with margin). ~3×280 rows in one query.
        const sinceIso = new Date(Date.now() - 420 * 86_400_000).toISOString().slice(0, 10);
        // ONE QUERY PER TICKER (2026-07-20): 4 tickers x ~280 sessions in a
        // single .in() query crossed PostgREST's silent 1,000-row response cap
        // (LESSONS 4.18) — the tail of EVERY series was truncated and the
        // benchmark Start/YTD columns read +0.0%. ~280 rows per ticker per
        // query stays far under the cap; a cap-sized response fails loud.
        const benchTickers = [['SPY', 'spy'], ['QQQ', 'qqq'], ['DIA', 'dia'], ['IWM', 'iwm']];
        const by = { spy: [], qqq: [], dia: [], iwm: [] };
        for (const [tick, k] of benchTickers) {
          const px = await supabase
            .from('prices_eod')
            .select('trade_date,close')
            .eq('ticker', tick)
            .gte('trade_date', sinceIso)
            .order('trade_date', { ascending: true });
          if ((px.data || []).length >= 1000) throw new Error(`benchmark ${tick} fetch hit the 1,000-row cap — series would be truncated`);
          (px.data || []).forEach((r) => { if (r.close != null) by[k].push({ d: r.trade_date, v: Number(r.close) }); });
        }
        if (!cancelled) setBenchHistory(by);

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
          // it with the shared dayChangePct helper (entry-aware: names bought
          // on the snapshot date measure from their fill, not the prior
          // close). Fraction form to match fmtPct (×100).
          const posRows = (pos.data || []).map((r) => dayAwareRow(r, ld));
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
        const liveAsOf = lnav?.data?.[0]?.as_of_date || null;
        const lpos = await supabase
          .from('paper_intraday_positions')
          .select('*')
          .order('market_value', { ascending: false });
        if (!cancelled) setLivePos((lpos?.data || []).map((r) => dayAwareRow(r, r.as_of_date || liveAsOf)));

        // Momentum sleeve context: the current monthly Power Trend list
        // supplies the Rank column for sleeve-M rows and the sleeve card's
        // dates. ≤15 rows; the CASH sentinel (rank 0) carries no rank.
        const mrd = await supabase
          .from('power_trend_list')
          .select('rebalance_date')
          .order('rebalance_date', { ascending: false })
          .limit(1);
        const mDate = mrd?.data?.[0]?.rebalance_date;
        if (mDate) {
          const ml = await supabase
            .from('power_trend_list')
            .select('ticker, rank, next_rebalance_date')
            .eq('rebalance_date', mDate)
            .order('rank', { ascending: true });
          if (!cancelled) {
            const ranks = {};
            (ml.data || []).forEach((r) => { if (r.ticker !== 'CASH') ranks[r.ticker] = r.rank; });
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
      // 2026-07-15 perf redesign: forward the Momentum sleeve's live value +
      // day P&L too (NULL-safe), so the sleeve mini returns tables see the
      // live session. Never a made-up zero.
      sleeve_m_value: liveNav.sleeve_m_value ?? null,
      sleeve_m_day_pnl: liveNav.sleeve_m_day_pnl ?? null,
      spy_close: liveNav.spy_close, spy_prev_close: liveNav.spy_prev_close, spy_inception_close: liveNav.spy_inception_close,
      // 2026-07-08 fix: forward ALL four benchmarks in live mode (was SPY only,
      // which blanked the NASDAQ/Dow/Russell rows even though the data exists).
      qqq_close: liveNav.qqq_close, qqq_prev_close: liveNav.qqq_prev_close, qqq_inception_close: liveNav.qqq_inception_close,
      dia_close: liveNav.dia_close, dia_prev_close: liveNav.dia_prev_close, dia_inception_close: liveNav.dia_inception_close,
      iwm_close: liveNav.iwm_close, iwm_prev_close: liveNav.iwm_prev_close, iwm_inception_close: liveNav.iwm_inception_close,
      sleeve_b_day_pnl: liveNav.day_pnl, portfolio_beta: liveNav.portfolio_beta,
      // Per-sleeve cash (2026-07-15): forward when the intraday view carries
      // them; NULL falls back to splitBook's inference, never a made-up zero.
      sleeve_b_cash: liveNav.sleeve_b_cash ?? null, sleeve_m_cash: liveNav.sleeve_m_cash ?? null,
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
    () => splitBook(latestNav?.total_nav ?? null, sleeveBGross || 0, momGross, insCap, momCap,
      latestNav?.sleeve_b_cash ?? null, latestNav?.sleeve_m_cash ?? null),
    [latestNav, sleeveBGross, momGross, insCap, momCap],
  );
  // Per-sleeve returns/risk now come from the shared performance math on the
  // nav rows (SleevePerf) — the old single "since inception vs S&P" pair is
  // superseded by the mini returns tables (2026-07-15 redesign).
  const lastActionFor = (code) => {
    const o = (orders || []).find((r) => r.sleeve === code && r.status !== 'cancelled');
    return o ? { date: (o.created_at || '').split('T')[0], side: o.side } : null;
  };
  const insLast = useMemo(() => lastActionFor('B'), [orders]);
  const momLast = useMemo(() => lastActionFor('M'), [orders]);
  // ONE "Today" computation (Joe rule 2026-06-12): each sleeve's Today is the
  // sum of its displayed positions' session P&L; the book card's Today is the
  // sum of the two sleeve numbers — agreement by construction.
  // Today $ = sleeve NAV (holdings + cash) live vs prior close — the same
  // definition as the matrix's Day %, so a loss REALIZED on a morning sale
  // shows up (a positions-only sum drops it; that's how Today read -$7.1K
  // while the matrix said -1.1% of $983K). Falls back to the positions sum
  // only when a NAV side is missing. Book Today stays the sleeve sum.
  const posDayB = sleeveB.length ? sleeveB.reduce((s, p) => s + (p.unrealized_intraday_pl || 0), 0) : null;
  const posDayM = sleeveM.length ? sleeveM.reduce((s, p) => s + (p.unrealized_intraday_pl || 0), 0) : null;
  const priorNavRow = navForCard.length >= 2 ? navForCard[navForCard.length - 2] : null;
  const lastNavRow = navForCard.length ? navForCard[navForCard.length - 1] : null;
  const navDay = (code) => {
    const a = sleeveNavOf(lastNavRow, code); const b = sleeveNavOf(priorNavRow, code);
    return (a != null && b != null) ? a - b : null;
  };
  const dayB = navDay('B') ?? posDayB;
  const dayM = navDay('M') ?? posDayM;
  const dayBook = (dayB == null && dayM == null) ? null : (dayB || 0) + (dayM || 0);

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
            <li><b>Sleeve 1 — Insider Conviction</b>: buys at Score ≥ 4 (max 5) and holds until the score decays below 3; the full $500K is always deployed, split equally across every qualifying name; re-split daily on the open.</li>
            <li><b>Sleeve 2 — Momentum (Power Trend)</b>: up to 15 names in confirmed uptrends that just broke out on above-average volume while beating the S&P 500 over 3 months; equal-weight, refreshed monthly; fewer than 8 qualifiers leaves the rest in cash.</li>
            <li><b>Long-only, no leverage</b> in either sleeve; a name held by both sleeves is owned by both.</li>
          </ul>
        </Reveal>
        <Reveal className="pp-heroright">
          <BookCard navHistory={navForCard} benchHistory={benchHistory} live={liveMode} asOfIso={liveMode ? (liveNav.updated_at || liveNav.as_of_date) : null} day$Override={dayBook} />
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

        {/* Performance chart — book + sleeves vs benchmarks, indexed (2026-07-20) */}
        <Reveal>
          <PerfChartPanel rows={navForCard} benchHistory={benchHistory} insCap={insCap} momCap={momCap} live={liveMode} />
        </Reveal>

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
              day$: dayB, alloc: insCap,
              infoDef: 'Buys at Score ≥ 4 (max 5), holds until the score decays below 3. The sleeve’s full $500K is split equally across every qualifying name ($500K ÷ N) and re-split daily on the open; drifts inside a 3% band are left alone.',
            },
            {
              code: 'M', n: 2, name: 'Momentum', value: split.momValue,
              cash: split.momCash, positions: sleeveM, last: momLast,
              day$: dayM, alloc: momCap,
              infoDef: 'Owns the current monthly Power Trend list equal-weight ($500K ÷ number of names, max 15). If fewer than 8 names qualify, the unfilled slots stay in cash. Refreshed monthly on the 1st; a held name that closes below all four of its moving averages is sold that day, and the cash waits for the next refresh.',
            },
          ].map((s) => (
            <div key={s.code} className="pp-col">
              <div className="pp-sleevecard">
                <div className="pp-sc-eyebrow">Sleeve {s.n} · {s.name}</div>
                <div className="pp-sc-value">{fmtMoneyExact(s.value)}</div>
                <SleevePerf
                  rows={navForCard}
                  sleeveCode={s.code}
                  alloc={s.alloc}
                  spySeries={benchHistory.spy}
                  live={liveMode}
                />
                <div className="pp-sc-rows">
                  <div><span>Holdings</span><b>{s.positions.length}</b></div>
                  <div><span>Idle cash</span><b>{fmtMoneyExact(s.cash)}</b></div>
                  <div><span>Last action</span><b>{s.last ? `${s.last.side === 'buy' ? 'Bought' : 'Sold'} · ${fmtDate(s.last.date)}` : '—'}</b></div>
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



