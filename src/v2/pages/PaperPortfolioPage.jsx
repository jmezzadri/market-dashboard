// PaperPortfolioPage — the "Conviction Events" paper book.
//
// Strategy reset (Joe, 2026-08-10): the earlier paper strategies were retired
// and the account re-seeds at cutover. This page describes and tracks the ONE
// replacement book:
//
//   Conviction Events — trades large real insider purchases (aggregated
//   open-market buys of $250,000 or more per name per day, automatic 10b5-1
//   plan purchases excluded), confirmed by the stock trading above its 50-day
//   average, entered at the next morning's open, up to 8 equal positions
//   (one-eighth of equity each), each exited at the open of the 21st trading
//   day. Pre-registered kill switch: trailing the S&P 500 by 10+ points after
//   8 weeks, or drawdown over 15%, freezes new entries automatically.
//
// Data (code against the cutover contract exactly):
//   * paper_nav_daily / paper_intraday_nav — book value path; the book sits in
//     the sleeve-B slot (sleeve_m zero). Inception = the EARLIEST nav row
//     (re-seeded at cutover) — never a hardcoded date.
//   * paper_positions / paper_intraday_positions — open positions snapshot.
//   * paper_accounts — capital base for since-start math.
//   * ce_events / ce_kill_switch — the decision ledger + kill-switch state,
//     via the shared useCeEvents hooks (same reads the Scanner panel uses).
//
// Degrade contract: the ce_* tables (and, locally, every table) may not
// resolve — every read stands alone and every section renders its own
// "awaiting first events" empty state on failure. No error panels for a feed
// that simply has not started.
//
// Kept from the previous build: the route-level error boundary + onOpenTicker
// plumbing (OverhaulApp.jsx), the v12 cream reskin (cream-system.css +
// paper-v12.css token bridge), the shared performance math (one module feeds
// the hero card and the chart — LESSONS 2026-06-12b), entry-aware day P&L,
// honest em-dashes (LESSONS 4.4), instant CSS tooltips (LESSONS 6.13), and
// freshness dots (LESSONS 0.1) — dots, not text.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import FreshnessChip from '../../overhaul/components/FreshnessChip';
import { supabase } from '../../lib/supabase';
import { InfoTip } from '../../InfoTip';
import {
  useCeEvents,
  useCeOpenEntries,
  useCeKillSwitch,
  ceActionMeta,
  ceReasonText,
  ceInsiderNames,
  ceWhyText,
} from '../../hooks/useCeEvents';
import '../../overhaul/styles/cream-system.css';
import '../../overhaul/styles/paper-v12.css';

const STARTING_CAPITAL = 100_000; // paper base fallback; paper_accounts overrides when present

// Risk-on / risk-off palette (fallbacks because the global tokens aren't
// defined at the page scope).
const UP_COLOR = 'var(--up, #1f8a5a)';
const DOWN_COLOR = 'var(--down, #b62121)';
const WARN_COLOR = 'var(--warn, #b87000)';

// ── small helpers ──────────────────────────────────────────────────────────

const fmtMoneyExact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
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

// "Aug 10, 2026 · 4:50 PM ET" for the kill-switch check stamp.
const fmtStampET = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  return `${day} · ${fmtTimeET(iso)} ET`;
};

// Whole calendar days from today (ET) to a date — drives "exit due in Nd".
const etTodayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const daysUntil = (iso) => {
  if (!iso) return null;
  const d = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  const t = Date.parse(etTodayIso() + 'T00:00:00Z');
  if (!Number.isFinite(d) || !Number.isFinite(t)) return null;
  return Math.round((d - t) / 86400000);
};

// Day P&L, entry-aware (one rule everywhere, 2026-07-15 fix): a position
// opened on the snapshot date has only moved since its entry — measuring it
// against a prior close it never held through overstates the day.
const dayAwareRow = (p, asOfIso) => {
  const boughtToday = p.entry_date && asOfIso
    && String(p.entry_date).slice(0, 10) === String(asOfIso).slice(0, 10);
  const dayPl = boughtToday
    ? (p.unrealized_pnl ?? p.unrealized_intraday_pl ?? null)
    : (p.unrealized_intraday_pl ?? null);
  return { ...p, unrealized_intraday_pl: dayPl };
};

// ── Performance math (shared, pure) ────────────────────────────────────────
// ONE module feeds the hero card AND the chart, so every number on the page
// comes from the same window logic (shared-function rule 2026-06-12). Every
// function returns null on insufficient history; null renders as an em-dash —
// the page never fabricates a number. Everything populates automatically as
// paper_nav_daily accrues rows after the account re-seed.

function trailingReturn(values, k) {
  if (!Array.isArray(values) || values.length < k + 1) return null;
  const last = values[values.length - 1];
  const base = values[values.length - 1 - k];
  if (last == null || base == null || base === 0) return null;
  return last / base - 1;
}

// series = [{ d:'YYYY-MM-DD', v }] ascending, nulls already removed.
// siBase: capital base for since-start (the book's starting capital);
// benchmarks pass null and measure from their first close. Windows: Day=1,
// 1W=5, 1M=21, 3M=63 sessions; YTD vs the last row dated before Jan 1 of the
// latest row's year (series starts this year → YTD = since start).
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

// Since-start risk block vs one benchmark. Gates: max drawdown needs ≥5
// daily returns; everything else needs ≥20 (n = daily-return count). rf = 0.
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

const fmtRatio2 = (n) => (n == null || Number.isNaN(n)) ? '—' : n.toFixed(2);
const fmtPctPlain1 = (n) => (n == null || Number.isNaN(n)) ? '—' : `${(n * 100).toFixed(1)}%`;
const pctCls = (n) => (n == null ? 'mut' : (n >= 0 ? 'up' : 'down'));

// Benchmark return since a given date: last close ÷ close on/nearest-before
// sinceDate − 1. Used for the "Start" column (book inception anchor).
function returnSinceDate(series, sinceDate) {
  if (!Array.isArray(series) || series.length === 0 || !sinceDate) return null;
  let base = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (String(series[i].d) <= String(sinceDate)) { base = series[i].v; break; }
  }
  const last = series[series.length - 1].v;
  return (base && last != null) ? last / base - 1 : null;
}

// Pair the nav-row series against the prices_eod S&P series by date (falls
// back to the row's stamped close — e.g. the live intraday row, whose date
// has no stored close yet). Feeds riskStats index-aligned.
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
/* Hero right card — the book vs the S&P 500 since the book's start. */
.paper-tile-summary {
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: 14px;
  padding: 22px 24px;
  display: flex; flex-direction: column; gap: 14px;
}
.paper-tile-summary .pts-head {
  display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap;
}
.paper-tile-summary .pts-title {
  font-size: 12.5px; font-weight: 600; color: var(--ink-0); letter-spacing: .02em;
}
.paper-tile-summary .pts-asof { font-size: 11px; color: var(--ink-2); letter-spacing: .04em; }

/* Panels below the hero. */
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
.paper-panel-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-2); font-feature-settings: "tnum"; flex-wrap: wrap; }
.paper-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.paper-table th {
  text-align: left; padding: 10px 12px;
  font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-2); font-weight: 500;
  border-bottom: 1px solid var(--line-1); background: var(--bg-1);
  white-space: nowrap;
}
.paper-table th.r { text-align: right; }
.paper-table td {
  padding: 11px 12px; border-bottom: 1px solid var(--line-0);
  color: var(--ink-1); font-feature-settings: "tnum"; white-space: nowrap;
}
.paper-table tbody tr:last-child td { border-bottom: none; }
.paper-table td.r { text-align: right; }
.paper-table td.ticker { color: var(--ink-0); font-weight: 500; }
.paper-table td.up { color: ${UP_COLOR}; }
.paper-table td.down { color: ${DOWN_COLOR}; }
.paper-table td.why { white-space: normal; min-width: 260px; max-width: 420px; font-size: 12.5px; line-height: 1.5; }
.paper-table td.due-past { color: ${WARN_COLOR}; }
.paper-empty { padding: 28px 28px; text-align: center; color: var(--ink-2); font-size: 13px; }
.paper-empty small { display: block; margin-top: 6px; color: var(--ink-3); font-size: 12px; }

.paper-ticker-link {
  background: none; border: none; padding: 0; font: inherit; font-weight: 500;
  color: var(--accent, #2563eb); cursor: pointer;
}
.paper-ticker-link:hover { text-decoration: underline; }

/* Kill-switch status line — slim strip under the hero. */
.pp-ks {
  display: flex; align-items: baseline; gap: 10px;
  background: var(--bg-1); border: 1px solid var(--line-1); border-radius: 14px;
  padding: 14px 20px; margin-top: 24px;
  font-size: 13px; color: var(--ink-1); line-height: 1.55;
}
.pp-ks .ksdot { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; background: var(--ink-3); }
.pp-ks.quiet .ksdot { background: ${UP_COLOR}; }
.pp-ks.tripped .ksdot { background: ${DOWN_COLOR}; }
.pp-ks b { color: var(--ink-0); font-weight: 600; }
.pp-ks.tripped b { color: ${DOWN_COLOR}; }
.pp-ks .ksmeta { color: var(--ink-3); font-size: 12px; white-space: nowrap; margin-left: auto; align-self: center; font-feature-settings: "tnum"; }

/* ── Performance block on the hero card ── */
.pp-perf { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--line-0); padding-top: 12px; }
.pp-rt-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
.pp-rt { width: 100%; min-width: 420px; border-collapse: collapse; font-feature-settings: "tnum","lnum"; }
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
.paper-table th:first-child .pp-tip:hover::after { left: 0; transform: none; }
.paper-table th:last-child .pp-tip:hover::after { left: auto; right: 0; transform: none; }

/* ── Performance chart panel ── */
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
@media (max-width: 640px) {
  .pp-perfchart .paper-panel-head { flex-direction: column; gap: 10px; }
  .pp-rt { min-width: 400px; }
  .pp-risk { grid-template-columns: repeat(3, 1fr); }
  .pp-tip:hover::after { width: 170px; }
  .pp-ks { flex-wrap: wrap; }
  .pp-ks .ksmeta { margin-left: 0; }
}
`;

// Full dollars for P&L deltas; minus sign for negatives.
const fmt$Delta = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const s = `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
  return n < 0 ? `-${s}` : `+${s}`;
};
const fmtPctP = (n, places = 1) => {
  if (n == null || Number.isNaN(n)) return '—';
  const s = `${(Math.abs(n) * 100).toFixed(places)}%`;
  return n < 0 ? `-${s}` : `+${s}`;
};
const dirClass = (n) => (n == null ? 'muted' : (n >= 0 ? 'up' : 'down'));

// One compact risk stat with an instant CSS tooltip.
function RiskStat({ label, tip, value }) {
  return (
    <div className="pp-risk-item">
      <span className="lbl pp-tip" data-tip={tip}>{label}</span>
      <span className="val">{value}</span>
    </div>
  );
}

/* BookCard — the hero card: book value, and the book vs the S&P 500 since
   the book's start. Inception = the earliest paper_nav_daily row (re-seeded
   at cutover) — never a hardcoded date. siBase = the account's starting
   capital so day-one losses are visible. */
function BookCard({ navHistory, spySeries = [], live = false, asOfIso = null, day$Override = null, bookBase }) {
  const rows = navHistory || [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  const nav = latest ? latest.total_nav : null;
  const day$ = day$Override;
  const incep$ = (nav != null && bookBase) ? nav - bookBase : null;

  const navSeries = rows.filter((r) => r.total_nav != null)
    .map((r) => ({ d: r.snapshot_date, v: Number(r.total_nav) }));
  const inception = navSeries.length ? String(navSeries[0].d).slice(0, 10) : null;
  const book = windowReturns(navSeries, bookBase);

  const spy = windowReturns(spySeries, null);
  // "Start" for the S&P 500 = its return since the BOOK's start date. Same-
  // window discipline (Joe 2026-07-20): while the book is younger than the
  // calendar year its YTD is really since-start, so the S&P must measure from
  // the SAME date or the excess line is meaningless.
  spy.si = inception ? returnSinceDate(spySeries, inception) : null;
  const curYear = new Date().getFullYear();
  if (inception && Number(String(inception).slice(0, 4)) >= curYear) spy.ytd = spy.si;
  if (live && latest && latest.spy_close && latest.spy_prev_close) {
    spy.day = Number(latest.spy_close) / Number(latest.spy_prev_close) - 1;
  }

  const cols = [['Day', 'day'], ['1W', 'w1'], ['1M', 'm1'], ['3M', 'm3'], ['YTD', 'ytd'], ['Start', 'si']];
  const excess = {};
  cols.forEach(([, k]) => { excess[k] = (book[k] != null && spy[k] != null) ? book[k] - spy[k] : null; });

  const paired = pairAgainstBench(rows, (r) => r.total_nav, spySeries, 'spy_close');
  const risk = riskStats(paired.pVals, paired.bVals);

  const bookHasReturn = navSeries.length >= 2 || book.day != null;

  return (
    <div className="paper-tile-summary pp-book">
      <div className="pts-head">
        <span className="pts-title">Conviction Events · paper book</span>
        <span className="pts-asof">{live && asOfIso ? `AS OF ${(fmtTimeET(asOfIso) || '').toUpperCase()} ET · LIVE` : (latest?.snapshot_date ? `AS OF ${fmtDate(latest.snapshot_date).toUpperCase()} · CLOSE` : 'AWAITING FIRST CLOSE')}</span>
      </div>
      <div className="pp-book-nav">{fmtMoneyExact(nav)}</div>
      <div className="pp-book-rows">
        <div><span>Today</span><b className={dirClass(day$)}>{fmt$Delta(day$)}</b></div>
        <div><span>Since start{inception ? ` (${fmtDate(inception)})` : ''}</span><b className={dirClass(incep$)}>{fmt$Delta(incep$)}</b></div>
      </div>
      <div className="pp-perf">
        <div className="pp-rt-scroll">
          <table className="pp-rt">
            <thead>
              <tr><th>Return</th>{cols.map(([l]) => <th key={l}>{l}</th>)}</tr>
            </thead>
            <tbody>
              <tr><td className="rl">Book</td>{cols.map(([l, k]) => <td key={l} className={pctCls(book[k])}>{fmtPctP(book[k], 1)}</td>)}</tr>
              <tr><td className="rl">S&amp;P 500</td>{cols.map(([l, k]) => <td key={l} className={pctCls(spy[k])}>{fmtPctP(spy[k], 1)}</td>)}</tr>
              <tr className="ex"><td className="rl">Excess vs S&amp;P</td>{cols.map(([l, k]) => <td key={l} className={pctCls(excess[k])}>{fmtPctP(excess[k], 1)}</td>)}</tr>
            </tbody>
          </table>
        </div>
        {!bookHasReturn && (
          <div className="pp-risk-note">No daily close on record yet — tracking starts at the book's first close. The S&amp;P 500 row fills from stored market prices meanwhile.</div>
        )}
        <div className="pp-risk">
          <RiskStat label="Ann. vol" value={fmtPctPlain1(risk.annVol)} tip="Annualized volatility: how much the book's daily returns swing, scaled to a yearly rate. Measured since the book's start." />
          <RiskStat label="Sharpe" value={fmtRatio2(risk.sharpe)} tip="Annualized return divided by annualized volatility — return earned per unit of risk taken. Risk-free rate assumed 0." />
          <RiskStat label="Sortino" value={fmtRatio2(risk.sortino)} tip="Like Sharpe, but only losing days count as risk." />
          <RiskStat label="Max drawdown" value={fmtPctPlain1(risk.maxDD)} tip="Largest peak-to-trough decline in book value since the start. The kill switch freezes new entries past 15%." />
          <RiskStat label="Beta" value={fmtRatio2(risk.beta)} tip="Sensitivity to the S&P 500's daily moves; 1.00 means the book moves in line with it." />
          <RiskStat label="Info ratio" value={fmtRatio2(risk.ir)} tip="Annualized excess return over the S&P 500 divided by how much the book's path deviates from it — how consistently the book beats the index." />
        </div>
        {risk.n < 20 && (
          <div className="pp-risk-note">Risk numbers build after 20 trading sessions ({risk.n} so far).</div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <FreshnessChip elementId={live ? 'portfolio.paper-nav-intraday' : 'portfolio.paper-nav-daily'} variant="dot" fallback={{ asOfIso: live ? asOfIso : (latest ? (latest.created_at || latest.snapshot_date) : null), calendar: 'nyse' }} />
      </div>
    </div>
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

/* ── KillSwitchLine — quiet vs tripped, thresholds stated in words ──────────
   Reads the single ce_kill_switch row. No reading (table absent / engine not
   started) renders the grey no-reading state — never an error, never a
   fabricated "quiet". Numeric fields on the row (book_return / spy_return /
   max_drawdown) are deliberately NOT rendered until the engine pins their
   units — see NOTES.md; a number shown in the wrong unit is worse than none
   (LESSONS 4.4). */
const KS_RULE = 'If the book trails the S&P 500 by 10 or more points after 8 weeks, or drawdown exceeds 15%, new entries freeze automatically.';
function KillSwitchLine({ row, loading }) {
  if (loading) return null;
  if (!row) {
    return (
      <div className="pp-ks" role="status">
        <span className="ksdot" />
        <span><b>Kill switch — no reading yet.</b> {KS_RULE}</span>
      </div>
    );
  }
  if (row.tripped) {
    return (
      <div className="pp-ks tripped" role="status">
        <span className="ksdot" />
        <span>
          <b>Kill switch tripped{row.tripped_at ? ` ${fmtDate(row.tripped_at)}` : ''} — new entries are frozen.</b>
          {ceReasonText(row.reason) ? ` ${ceReasonText(row.reason)}.` : ''} Open positions still exit on their scheduled day. {KS_RULE}
        </span>
        {row.checked_at && <span className="ksmeta">checked {fmtStampET(row.checked_at)}</span>}
      </div>
    );
  }
  return (
    <div className="pp-ks quiet" role="status">
      <span className="ksdot" />
      <span><b>Kill switch quiet.</b> {KS_RULE}</span>
      {row.checked_at && <span className="ksmeta">checked {fmtStampET(row.checked_at)}</span>}
    </div>
  );
}

/* ── PositionsPanel — the book's open positions ─────────────────────────────
   Columns per the strategy spec: ticker, price, day P&L, total P&L, entered
   date, exit due in N days, and WHY the book holds it (the qualifying insider
   purchase, from ce_events). Numbers in the rows; explanations live in the
   header tooltips and the one meta line. ≤8 rows by construction. */
function PositionsPanel({ positions, openEvents, onOpenTicker, asOf, updatedAt, live, killSwitchTripped }) {
  const rows = useMemo(() => {
    const withDue = positions.map((p) => {
      const ev = openEvents[p.ticker] || null;
      return { ...p, ev, due: ev?.exit_due_date || null, dueDays: daysUntil(ev?.exit_due_date) };
    });
    // Soonest scheduled exit first; unknown due dates last, then newest entry.
    withDue.sort((a, b) => {
      const ad = a.dueDays == null ? Infinity : a.dueDays;
      const bd = b.dueDays == null ? Infinity : b.dueDays;
      if (ad !== bd) return ad - bd;
      return String(b.entry_date || '').localeCompare(String(a.entry_date || ''));
    });
    return withDue;
  }, [positions, openEvents]);

  const dueCell = (r) => {
    if (r.dueDays == null) return <td className="r">—</td>;
    const label = r.dueDays > 0 ? `in ${r.dueDays}d` : r.dueDays === 0 ? 'today' : 'past due';
    const tip = `Scheduled exit at the open of ${fmtDate(r.due)} — the open of the 21st trading day after entry.`;
    return (
      <td className={`r${r.dueDays < 0 ? ' due-past' : ''}`}>
        <span className="ce-tip" data-tip={tip}>{label}</span>
      </td>
    );
  };

  return (
    <div className="paper-panel">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            Positions <InfoTip term="Positions" def="Every name the book currently holds. Each was bought at the morning open after a qualifying insider purchase, sized at one-eighth of the book's equity, and exits at the open of the 21st trading day after entry." size={12} />
          </h2>
          <div className="paper-panel-sub">
            {rows.length} of 8 positions · one-eighth of equity each · each exits at the open of its 21st trading day
          </div>
        </div>
        <div className="paper-panel-meta">
          <FreshnessChip elementId={live ? 'portfolio.paper-positions-intraday' : 'portfolio.paper-positions-snapshot'} variant="dot" fallback={{ asOfIso: updatedAt || asOf, calendar: 'nyse' }} />
          <span>{live ? `Live · as of ${fmtTimeET(updatedAt) || '—'} ET` : (asOf ? `As of ${fmtDate(asOf)} close` : '—')}</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="paper-empty">
          No open positions — awaiting the first qualifying events.
          <small>{killSwitchTripped
            ? 'The kill switch has frozen new entries; positions will appear once it clears.'
            : 'A qualifying insider purchase is bought at the next morning’s open and appears here.'}</small>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="paper-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th className="r"><span className="pp-tip" data-tip="The position's price on the displayed snapshot — the latest mark during market hours, the official close after 4 PM ET.">Price</span></th>
                <th className="r"><span className="pp-tip" data-tip="Change in this position's value today, in dollars (profit and loss). A name entered today measures from its entry price.">Day P&amp;L</span></th>
                <th className="r"><span className="pp-tip" data-tip="Profit and loss since entry, in dollars: the position's value now minus what it cost.">Total P&amp;L</span></th>
                <th className="r"><span className="pp-tip" data-tip="The day the book bought it — the morning open after its qualifying event.">Entered</span></th>
                <th className="r"><span className="pp-tip" data-tip="Days until the scheduled exit. Every position leaves at the open of the 21st trading day after entry.">Exit due</span></th>
                <th>Why it&rsquo;s here</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const why = ceWhyText(r.ev, fmtMoneyExact, fmtDate);
                const names = ceInsiderNames(r.ev?.insider_names);
                return (
                  <tr key={r.ticker}>
                    <td className="ticker">
                      {onOpenTicker
                        ? <button type="button" className="paper-ticker-link" onClick={() => onOpenTicker(r.ticker)}>{r.ticker}</button>
                        : r.ticker}
                    </td>
                    <td className="r">{r.current_price != null ? `$${Number(r.current_price).toFixed(2)}` : '—'}</td>
                    <td className={`r ${dirClass(r.unrealized_intraday_pl)}`}>{r.unrealized_intraday_pl != null ? fmtMoneyExact(r.unrealized_intraday_pl) : '—'}</td>
                    <td className={`r ${dirClass(r.unrealized_pnl)}`}>{r.unrealized_pnl != null ? fmtMoneyExact(r.unrealized_pnl) : '—'}</td>
                    <td className="r">{fmtDate(r.entry_date || r.ev?.entered_at)}</td>
                    {dueCell(r)}
                    <td className="why">
                      {why
                        ? (names.length > 1
                          ? <span className="ce-tip" data-tip={names.join(' · ')}>{why}</span>
                          : why)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── EventLedgerPanel — recent ce_events with plain-English action chips ── */
function EventLedgerPanel({ events, loading, onOpenTicker }) {
  const latest = events.length ? events[0].filing_date : null;
  const chip = (r) => {
    const meta = ceActionMeta(r.action);
    const reason = r.action === 'skipped_gate' ? ceReasonText(r.gate_fail_reason) : null;
    const tip = reason
      || (r.action === 'skipped_full' ? 'The book already held 8 positions when this event qualified.' : null)
      || (r.action === 'skipped_dup' ? 'The book already held this name.' : null)
      || (r.action === 'blocked_kill_switch' ? 'The kill switch had frozen new entries when this event qualified.' : null);
    const el = <span className={`ce-chip ${meta.tone}`}>{meta.label}</span>;
    return tip ? <span className="ce-tip" data-tip={tip}>{el}</span> : el;
  };
  return (
    <div className="paper-panel">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            Event ledger <InfoTip term="Event ledger" def="Every large insider purchase the engine evaluated — aggregated open-market buys of $250,000 or more in one name in one day, automatic (10b5-1) plan purchases excluded — and what it did with it: entered, skipped, or blocked. Hover a chip for the reason." size={12} />
          </h2>
          <div className="paper-panel-sub">Newest first · hover an action chip for the reason</div>
        </div>
        <div className="paper-panel-meta">
          <FreshnessChip elementId="portfolio.ce-events-daily" variant="dot" fallback={{ asOfIso: latest, calendar: 'nyse-trading-day' }} />
          <span>{latest ? `Latest event · ${fmtDate(latest)}` : '—'}</span>
        </div>
      </div>
      {loading ? (
        <div className="paper-empty">Loading the ledger…</div>
      ) : events.length === 0 ? (
        <div className="paper-empty">
          Awaiting first events.
          <small>Large insider purchases appear here as the engine evaluates them — entered, skipped, or blocked, with the reason.</small>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="paper-table">
            <thead>
              <tr>
                <th>Filed</th>
                <th>Ticker</th>
                <th className="r"><span className="pp-tip" data-tip="All open-market insider buys in the name that day, added together. The bar to qualify is $250,000.">Buy total</span></th>
                <th className="r"><span className="pp-tip" data-tip="How many different insiders bought that day. Hover the number for their names.">Insiders</span></th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {events.map((r, i) => {
                const names = ceInsiderNames(r.insider_names);
                const n = r.n_insiders != null ? Number(r.n_insiders) : (names.length || null);
                return (
                  <tr key={`${r.ticker}-${r.filing_date}-${i}`}>
                    <td>{fmtDate(r.filing_date)}</td>
                    <td className="ticker">
                      {onOpenTicker
                        ? <button type="button" className="paper-ticker-link" onClick={() => onOpenTicker(r.ticker)}>{r.ticker}</button>
                        : r.ticker}
                    </td>
                    <td className="r">{fmtMoneyExact(r.total_usd != null ? Number(r.total_usd) : null)}</td>
                    <td className="r">
                      {n == null ? '—'
                        : names.length
                          ? <span className="ce-tip" data-tip={names.join(' · ')}>{n}</span>
                          : n}
                    </td>
                    <td>{chip(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── PerfChartPanel — the book vs the S&P 500, indexed since the start ──────
   Every visible series is indexed to 100 at the start of the selected window
   so both are directly comparable on one axis. "Start" indexes the book at
   its capital base so day-one losses are visible, and the S&P 500 from its
   close on/nearest-before the book's first nav row (the same anchor the hero
   card's Start column uses). */
const PERF_SERIES = [
  { k: 'total', label: 'Conviction Events book', color: 'var(--ink-0, #111927)', width: 2.2, dash: null },
  { k: 'spy', label: 'S&P 500', color: '#8a8578', width: 1.4, dash: '5 4' },
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

function PerfChartPanel({ rows, spySeries, bookBase, live }) {
  const [win, setWin] = useState('Start');
  const [on, setOn] = useState({ total: true, spy: true });
  // CALLBACK ref, not useRef + mount effect: this component returns null until
  // the nav rows load, so a mount-time effect would run before the div existed
  // and the ResizeObserver never attached (caught in live UAT 2026-07-20).
  const [wrapEl, setWrapEl] = useState(null);
  const [w, setW] = useState(860);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    if (!wrapEl) return undefined;
    const ro = new ResizeObserver((es) => { for (const e of es) setW(Math.max(320, Math.round(e.contentRect.width) - 40)); });
    ro.observe(wrapEl);
    return () => ro.disconnect();
  }, [wrapEl]);

  const bookRows = useMemo(() => (rows || []).filter((r) => r.total_nav != null).map((r) => ({
    d: String(r.snapshot_date).slice(0, 10),
    total: Number(r.total_nav),
  })), [rows]);

  const model = useMemo(() => {
    if (!bookRows.length) return null;
    const nSess = PERF_WINDOWS.find(([l]) => l === win)?.[1] ?? Infinity;
    const visRows = Number.isFinite(nSess) ? bookRows.slice(-(nSess + 1)) : bookRows;
    const isStart = !Number.isFinite(nSess) || visRows.length === bookRows.length;
    const inception = bookRows[0].d;
    const base = {};
    const first = visRows[0];
    base.total = isStart ? (bookBase || null) : first.total;
    const anchorDate = isStart ? inception : first.d;
    base.spy = benchAtOrBefore(spySeries, anchorDate);
    const pts = [];
    if (isStart) pts.push({ d: inception, label: 'Start', vals: Object.fromEntries(PERF_SERIES.map(({ k }) => [k, 100])) });
    visRows.forEach((r) => {
      const vals = {};
      PERF_SERIES.forEach(({ k }) => {
        const raw = k === 'total' ? r.total : benchAtOrBefore(spySeries, r.d);
        vals[k] = (raw != null && base[k]) ? (raw / base[k]) * 100 : null;
      });
      pts.push({ d: r.d, label: fmtDate(r.d), vals });
    });
    return { pts, isStart, inception };
  }, [bookRows, spySeries, win, bookBase]);

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
            Book vs S&amp;P 500 <InfoTip term="Book vs S&P 500" def="Growth of the book and the S&P 500, each indexed to 100 at the start of the selected window. On the Start window the book indexes from its starting capital, so the first session's profit or loss is visible; the S&P 500 from its close on the same date." size={12} />
          </h2>
          <div className="paper-panel-sub">Indexed to 100 at {win === 'Start' ? `the book's start (${fmtDate(model.inception)})` : `the start of the ${win} window`} · close-to-close{live ? ' · latest point is today, live' : ''}</div>
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
            <text key={p.d + i} x={X(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'} fontSize="10.5" fill="var(--ink-3, #8a8578)">{p.label}</text>
          ) : null))}
        </svg>
        {hp && (
          <div className="pp-pc-tip" style={{ left: Math.min(Math.max(X(hover) - 10, 0), w - 190) }}>
            <div className="pp-pc-tipdate">{hp.label === 'Start' ? `Start · ${fmtDate(model.inception)}` : hp.label}</div>
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
  const [spySeries, setSpySeries] = useState([]);
  const [positions, setPositions] = useState([]);
  const [posAsOf, setPosAsOf] = useState(null);
  const [liveNav, setLiveNav] = useState(null);
  const [livePos, setLivePos] = useState([]);
  const [account, setAccount] = useState(null);

  // Conviction Events reads — the SAME shared hooks the Scanner panel uses,
  // so the two surfaces can never disagree on an event.
  const ledger = useCeEvents(40);
  const open = useCeOpenEntries();
  const ks = useCeKillSwitch();

  useEffect(() => {
    let cancelled = false;
    // Every read stands alone: one unreadable table (the ce_* tables before
    // the engine's first run, or everything when offline) must never blank
    // the rest of the page or raise an error panel — the affected section
    // renders its own awaiting state instead.
    const attempt = async (label, fn) => {
      try { return await fn(); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[paper] ${label} read failed:`, e?.message || e);
        return null;
      }
    };
    (async () => {
      const nav = await attempt('nav history', () => supabase
        .from('paper_nav_daily')
        .select('*')
        .order('snapshot_date', { ascending: true }));
      if (!cancelled) setNavHistory(nav?.data || []);

      // S&P 500 closes, ~420 calendar days (covers 3M + YTD + prior-year
      // anchor with margin). One ticker per query stays far under the
      // PostgREST 1,000-row response cap (LESSONS 4.18); a cap-sized
      // response fails loud rather than shipping a truncated series.
      const spy = await attempt('S&P 500 series', async () => {
        const sinceIso = new Date(Date.now() - 420 * 86_400_000).toISOString().slice(0, 10);
        const px = await supabase
          .from('prices_eod')
          .select('trade_date,close')
          .eq('ticker', 'SPY')
          .gte('trade_date', sinceIso)
          .order('trade_date', { ascending: true });
        if ((px.data || []).length >= 1000) throw new Error('benchmark fetch hit the 1,000-row cap — series would be truncated');
        return px;
      });
      if (!cancelled) {
        setSpySeries((spy?.data || [])
          .filter((r) => r.close != null)
          .map((r) => ({ d: r.trade_date, v: Number(r.close) })));
      }

      const latestDate = await attempt('positions date', () => supabase
        .from('paper_positions')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1));
      const ld = latestDate?.data?.[0]?.snapshot_date;
      if (ld) {
        const pos = await attempt('positions', () => supabase
          .from('paper_positions')
          .select('*')
          .eq('snapshot_date', ld)
          .order('market_value', { ascending: false }));
        // The book lives in the sleeve-B slot of the position tables
        // (cutover contract); anything else is residue and never renders.
        const posRows = (pos?.data || [])
          .filter((r) => (r.sleeve || 'B') === 'B')
          .map((r) => dayAwareRow(r, ld));
        if (!cancelled) { setPositions(posRows); setPosAsOf(ld); }
      }

      const acc = await attempt('account', () => supabase
        .from('paper_accounts')
        .select('*')
        .eq('status', 'active')
        .limit(1));
      if (!cancelled) setAccount(acc?.data?.[0] || null);

      // LIVE intraday view (refreshed hourly during market hours). Kept in a
      // separate table from the official close record so live marks never
      // touch the daily history; the page prefers it only while the market
      // is open (see liveMode below).
      const lnav = await attempt('intraday value', () => supabase
        .from('paper_intraday_nav')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1));
      if (!cancelled) setLiveNav(lnav?.data?.[0] || null);
      const liveAsOf = lnav?.data?.[0]?.as_of_date || null;
      const lpos = await attempt('intraday positions', () => supabase
        .from('paper_intraday_positions')
        .select('*')
        .order('market_value', { ascending: false }));
      if (!cancelled) {
        setLivePos((lpos?.data || [])
          .filter((r) => (r.sleeve || 'B') === 'B')
          .map((r) => dayAwareRow(r, r.as_of_date || liveAsOf)));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Live-vs-close selection ───────────────────────────────────────────────
  // Prefer the live intraday view whenever its session date is AFTER the
  // latest official close row — i.e. during market hours, before the close
  // run writes today's snapshot. Pure date compare → DST-proof.
  const lastClose = navHistory.length ? navHistory[navHistory.length - 1] : null;
  const liveMode = !!(liveNav && lastClose && liveNav.as_of_date && lastClose.snapshot_date
    && liveNav.as_of_date > lastClose.snapshot_date);

  const displayPositions = liveMode ? livePos : positions;
  const displayPosAsOf = liveMode ? liveNav.as_of_date : posAsOf;
  const posUpdatedAt = liveMode ? (liveNav.updated_at || liveNav.as_of_date)
    : displayPositions.reduce((mx, p) => (p.last_updated && (!mx || p.last_updated > mx)) ? p.last_updated : mx, null);

  // For the card/chart, append the live point as today's bar so all the
  // shared math works unchanged. History is never mutated.
  const navForCard = useMemo(() => {
    if (!liveMode) return navHistory;
    return [...navHistory, {
      snapshot_date: liveNav.as_of_date,
      total_nav: liveNav.total_nav,
      spy_close: liveNav.spy_close, spy_prev_close: liveNav.spy_prev_close,
      created_at: liveNav.updated_at,
    }];
  }, [liveMode, liveNav, navHistory]);

  // Capital base for since-start math. The re-seeded account carries the
  // whole book in the sleeve-B slot; its allocation is the base. $1M is the
  // configured fallback while the account row is unreadable.
  const bookBase = account?.sleeve_b_allocation != null ? Number(account.sleeve_b_allocation) : STARTING_CAPITAL;

  // Today = the account's own value move (close-to-close; live vs prior
  // close in live mode). The same quantity the card's Day % is a percent of,
  // so the dollar and the percent can never disagree in sign.
  const priorNavRow = navForCard.length >= 2 ? navForCard[navForCard.length - 2] : null;
  const lastNavRow = navForCard.length ? navForCard[navForCard.length - 1] : null;
  const dayBook = (lastNavRow?.total_nav != null && priorNavRow?.total_nav != null)
    ? Number(lastNavRow.total_nav) - Number(priorNavRow.total_nav)
    : null;

  return (
    <div className="home-v12 paper-v12">
      <style>{PAGE_CSS}</style>

      {/* Hero — strategy blurb left (the exact rule set), book vs S&P card
          right. The blurb links Methodology for the full write-up. */}
      <section className="wrap pp-hero">
        <Reveal className="pp-ed">
          <div className="eyebrow2"><span className="dot" />Paper portfolio</div>
          <h1><i>Conviction Events</i> — an automated paper book.</h1>
          <ul className="impl">
            <li><b>The signal</b>: large real insider purchases — aggregated open-market buys of <b>$250,000 or more</b> per name per day, automatic (10b5-1) plan purchases excluded.</li>
            <li><b>The confirmation</b>: the stock must be trading <b>above its 50-day average price</b>.</li>
            <li><b>Entry &amp; exit</b>: bought at the <b>next morning&rsquo;s open</b>, up to <b>8 equal positions</b> (one-eighth of equity each); each exits at the <b>open of the 21st trading day</b>.</li>
            <li><b>The kill switch</b>: if the book trails the S&amp;P 500 by <b>10 or more points after 8 weeks</b>, or drawdown exceeds <b>15%</b>, new entries freeze automatically.</li>
          </ul>
          <div className="pp-methlink">
            <Link to="/methodology#portfolio">Full methodology, backtest included →</Link>
          </div>
        </Reveal>
        <Reveal className="pp-heroright">
          <BookCard
            navHistory={navForCard}
            spySeries={spySeries}
            live={liveMode}
            asOfIso={liveMode ? (liveNav.updated_at || liveNav.as_of_date) : null}
            day$Override={dayBook}
            bookBase={bookBase}
          />
        </Reveal>
      </section>

      <section className="wrap pp-main">
        {/* Kill-switch state first — it governs whether new entries can happen. */}
        <KillSwitchLine row={ks.row} loading={ks.loading} />

        {/* The book vs the S&P 500 since the start (hidden until 2 points exist). */}
        <Reveal>
          <PerfChartPanel rows={navForCard} spySeries={spySeries} bookBase={bookBase} live={liveMode} />
        </Reveal>

        <Reveal>
          <PositionsPanel
            positions={displayPositions}
            openEvents={open.byTicker}
            onOpenTicker={onOpenTicker}
            asOf={displayPosAsOf}
            updatedAt={posUpdatedAt}
            live={liveMode}
            killSwitchTripped={!!ks.row?.tripped}
          />
        </Reveal>

        <Reveal>
          <EventLedgerPanel events={ledger.rows} loading={ledger.loading} onOpenTicker={onOpenTicker} />
        </Reveal>
      </section>
    </div>
  );
}
