/* Asset Tilt — refactored 2026-05-27 per Joe Path-A directive.

   2026-06-16 — TRANSPARENCY PASS (feature/ux-asset-tilt-transparency).
   The page is no longer a black box. The same engine (unchanged) now shows
   its work top-to-bottom, in three plainly-labelled layers:

     1. THE CYCLE READ — the six cycle-board mechanisms (valuation, credit,
        funding, growth, liquidity & policy, positioning & breadth) scored
        0–100 with their band (risk-off / caution / neutral) and a one-line
        plain-English meaning each. This is the diagnosis that drives every
        sector tilt. Data: v10_allocation.json `mechanism_scores` +
        `mechanism_bands` (previously unused on this page).

     2. WHY EACH SECTOR TILT — every sector row now expands to a mechanism
        breakdown (the per-sector `contributions`, which sum to the tilt) as
        a small bar table, plus a one-sentence plain-English "why" naming the
        top ± mechanism drivers. Same for industry groups. Surfaces the
        existing `sectors[].contributions` / `industry_groups[].contributions`
        (handled in SectorFlow.jsx).

     3. THE RISK OVERLAY — an explicit, readable panel showing how the
        equity-vs-defensive split is set by the 2-axis engine: the stress
        axis (MOVE value + 5y percentile → Risk On / Watch / Risk Off →
        equity %) and the yield-regime axis (3-month change in 10Y →
        Inflationary / Neutral / Deflationary → which defensive sleeve), with
        the live readings and thresholds read straight from
        macrotilt_engine.json. The existing gauges (with their hover history)
        are kept; the overlay panel makes the logic explicit, not just a hover.

   The engine itself is UNCHANGED — this pass only surfaces data the engine
   already produces. No new factor model, no recomputation; every number is
   read from v10_allocation.json or macrotilt_engine.json.

   Original refactor notes (Path-A, kept):
   - Backtest values derived from /macrotilt_engine_backtest.json; em-dash on
     failure, never hardcoded.
   - Real MOVE / ΔY-3M / regime series from the engine history file.
   - Style: theme tokens only (var(--mt-*)); works light AND dark. */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import BigGauge, { GaugeLegend } from '../components/BigGauge';
import Sparkline from '../components/Sparkline';
import Tip from '../components/Tip';
import SectorFlow from '../components/SectorFlow';
import useAllocation from '../lib/useAllocation';
import useEngineRegime from '../lib/useEngineRegime';
import useIndicators from '../lib/useIndicators';
import IndicatorDetail from '../components/IndicatorDetail';
import { createPortal } from 'react-dom';

function fmtPercent(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}`;
}
function fmtPctRaw(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}`;
}
function fmtPctFraction(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}`;
}

function mapStressClass(s) {
  if (s === 'Risk Off') return 'off';
  if (s === 'Watch') return 'watch';
  return 'on';
}
function mapYieldClass(y) {
  if (y === 'Inflationary') return 'infl';
  if (y === 'Deflationary') return 'defl';
  return 'neutral';
}

/* ── The six cycle-board mechanisms ───────────────────────────────────────
   Module-level (NOT a hook) so it can be shared and never trips a TDZ. Each
   mechanism is scored 0–100 by the cycle board: a HIGHER score = more
   risk-off pressure from that lens. The band (risk-off / caution / neutral)
   comes straight from v10_allocation.json `mechanism_bands`. `phrase(score)`
   produces the plain-English clause shown after the band, written so a PM
   reads it as "what this lens is saying right now".

   These are descriptions of what the engine already measures — no new
   computation, no model change. */
const MECHANISMS = [
  {
    key: 'valuation',
    label: 'Valuation',
    blurb: 'How expensive equities are versus their own history.',
    phrase: (v) =>
      v >= 75 ? 'equities expensive vs history'
        : v >= 45 ? 'equities around fair value'
          : 'equities cheap vs history',
  },
  {
    key: 'credit',
    label: 'Credit',
    blurb: 'Corporate borrowing conditions — spreads and stress.',
    phrase: (v) =>
      v >= 75 ? 'credit spreads tightening risk appetite'
        : v >= 45 ? 'credit conditions mixed'
          : 'credit conditions supportive',
  },
  {
    key: 'funding',
    label: 'Funding',
    blurb: 'Cost and availability of short-term funding / liquidity plumbing.',
    phrase: (v) =>
      v >= 75 ? 'funding markets tightening'
        : v >= 45 ? 'funding conditions balanced'
          : 'funding markets easy',
  },
  {
    key: 'growth',
    label: 'Growth',
    blurb: 'Direction of the economic-growth signals.',
    phrase: (v) =>
      v >= 75 ? 'growth momentum fading'
        : v >= 45 ? 'growth signals mixed'
          : 'growth momentum firm',
  },
  {
    key: 'liquidity_policy',
    label: 'Liquidity & Policy',
    blurb: 'Central-bank stance and system liquidity.',
    phrase: (v) =>
      v >= 75 ? 'policy / liquidity restrictive'
        : v >= 45 ? 'policy / liquidity neutral'
          : 'policy / liquidity supportive',
  },
  {
    key: 'positioning_breadth',
    label: 'Positioning & Breadth',
    blurb: 'Crowding, sentiment and market breadth.',
    phrase: (v) =>
      v >= 75 ? 'positioning crowded, breadth thin'
        : v >= 45 ? 'positioning / breadth mixed'
          : 'positioning light, breadth broad',
  },
];

const BAND_LABEL = { 'risk-off': 'Risk-off', caution: 'Caution', neutral: 'Neutral' };
function bandClass(band) {
  if (band === 'risk-off') return 'off';
  if (band === 'caution') return 'watch';
  return 'on';
}

/* Direction → plain-English: which way of the reading is the "concerning" one.
   Mirrors the producer's direction_corrected_score logic so the modal explains
   the exact transform that built each indicator's 0–100. */
const DIRECTION_LABEL = {
  high: 'higher reading = more risk-off',
  high_is_concerning: 'higher reading = more risk-off',
  low_is_concerning: 'lower reading = more risk-off',
  bidir_top: 'elevated reading = more risk-off',
  bidir_bottom: 'too-low reading = more risk-off (complacency)',
};

/* History window each indicator's percentile is ranked against — derived from
   the actual data span of each series (calibration + indicator_history, verified
   2026-06-17). Answers 'percentile of WHAT history?' on every row. HY OAS / HY-IG
   ratio show 3y because that's all the data the feed currently holds — lengthens
   once the HY OAS series is registered with full history. */
const HISTORY_WINDOW = {
  ig_oas: '40-year', hy_oas: '3-year', hy_ig_ratio: '3-year',
  cape: '20-year', erp: '15-year', buffett: '55-year',
  cfnai_3ma: '20-year', jobless: '20-year', ism: '15-year', bkx_spx: '20-year',
  cpff: '15-year', stlfsi: '15-year', bank_reserves: '15-year', rrp: '15-year',
  anfci: '15-year', fed_bs: '15-year', sloos_ci: '15-year', m2_yoy: '15-year',
  skew: '15-year', vix: '15-year', eq_cr_corr: '15-year', move: '15-year',
};

/* Cycle-breakdown indicator id -> the catalog indicator whose full chart it
   opens. Most are identity; credit's calibration ids point at the live tracked
   series (hy_oas / ratio -> hy_ig = the ICE BofA HY OAS series, 15y history). */
const CHART_ID = { hy_oas: 'hy_ig', hy_ig_ratio: 'hy_ig' };

/* MechModal — opens when a cycle-mechanism card is clicked. Shows HOW the
   0–100 was built: each feeding indicator's percentile, its direction, and the
   direction-corrected 0–100 it contributes. The mechanism score is the average
   of those indicator scores. Data comes from v10_allocation.json
   `mechanism_breakdown` (emitted by the producer) — nothing is recomputed. */
function MechModal({ mech, breakdown, onClose, onOpenIndicator, chartableIds }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows = Array.isArray(breakdown) ? breakdown : [];
  const avg = rows.length
    ? Math.round(rows.reduce((s, r) => s + (Number(r.score) || 0), 0) / rows.length)
    : (mech.score ?? null);
  const b = bandClass(mech.band);
  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };
  return (
    <div className="at-mechmodal-scrim" onClick={onClose} role="presentation">
      <div
        className="at-mechmodal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${mech.label} score breakdown`}
      >
        <div className="at-mechmodal-head">
          <div>
            <div className="mt-eyebrow">Cycle mechanism · how the 0–100 is built</div>
            <div className="at-mechmodal-title">
              {mech.label}
              <span className={`mt-tag ${mech.band === 'risk-off' ? 'mt-tag--extreme' : mech.band === 'caution' ? 'mt-tag--elev' : 'mt-tag--calm'}`}>
                {BAND_LABEL[mech.band] || '—'}
              </span>
            </div>
          </div>
          <button type="button" className="at-mechmodal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="at-mechmodal-sub">{mech.blurb}</div>
        <div className="at-mechmodal-explain">
          Each indicator is placed in its own history as a <b>percentile</b>, then turned
          into a 0–100 score by its direction (sometimes a <i>low</i> reading is the
          concerning one). The mechanism score is the <b>average</b> of those indicator scores.
        </div>
        {rows.length === 0 ? (
          <div className="at-mechmodal-empty">No indicator breakdown available for this mechanism yet.</div>
        ) : (
          <div className="at-mechmodal-rows">
            {rows.map((r, i) => {
              const sc = Number(r.score) || 0;
              const bc = sc >= 75 ? 'off' : sc >= 50 ? 'watch' : 'on';
              const clickable = chartableIds && chartableIds.has(r.id);
              return (
                <div
                  className={`at-mechmodal-row${clickable ? ' at-mechmodal-row--link' : ''}`}
                  key={r.id || i}
                  onClick={clickable ? () => onOpenIndicator(r.id) : undefined}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onOpenIndicator(r.id); } : undefined}
                >
                  <div className="at-mechmodal-rowtop">
                    <span className="at-mechmodal-ind">{r.name}{clickable && <span className="at-mechmodal-chev" aria-hidden="true"> ↗</span>}</span>
                    <span className="num at-mechmodal-rowscore">{Math.round(sc)}<i>/100</i></span>
                  </div>
                  <span className="at-mechmodal-track">
                    <span className={`at-mechmodal-fill at-mechmodal-fill--${bc}`} style={{ width: `${Math.max(2, Math.min(100, sc))}%` }} />
                  </span>
                  <div className="at-mechmodal-why">
                    {r.percentile != null ? <>{ordinal(Math.round(r.percentile))} percentile of its {HISTORY_WINDOW[r.id] ? `${HISTORY_WINDOW[r.id]} ` : ''}history</> : 'percentile n/a'}
                    {' · '}{DIRECTION_LABEL[r.direction] || 'higher reading = more risk-off'}
                    {r.reading != null && <> · reading <span className="num">{r.reading}{r.unit ? ` ${r.unit}` : ''}</span></>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="at-mechmodal-foot">
          <span>Average</span>
          <span className={`num at-mechmodal-avg at-mechmodal-avg--${b}`}>{avg != null ? avg : '—'}<i>/100</i></span>
        </div>
      </div>
    </div>
  );
}

/* ChartModal — portal wrapper that hosts the canonical IndicatorDetail (chart
   + history + freshness) when a cycle indicator row is clicked. Mirrors the
   Macro Overview DetailModal so the full chart looks identical site-wide. */
function ChartModal({ onClose, children }) {
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,28,.55)', zIndex: 6000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px 64px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 'min(1080px, 95vw)', background: 'var(--mt-surface, #fff)', borderRadius: 18, boxShadow: '0 24px 70px rgba(20,30,45,.4)' }}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 14, right: 16, border: 'none', background: 'none', fontSize: 26, lineHeight: 1, color: 'var(--mt-ink-3)', cursor: 'pointer', zIndex: 2 }}>×</button>
        {children}
      </div>
    </div>,
    target,
  );
}

export default function TiltPage() {
  const { allocation, loading } = useAllocation();
  const regime = useEngineRegime();
  const [backtest, setBacktest] = useState(null);
  // Live weekly observation history (MOVE / ΔY-3M / regime). Separate from the
  // locked strategy backtest so the 24W history sparklines + Regime History
  // strip keep advancing every week instead of freezing at the calibration
  // lock date. (Joe 2026-06-03: history frozen at May 15.)
  const [history, setHistory] = useState(null);
  // 2026-06-16 — the 2-axis regime engine file. macrotilt_engine.json carries
  // the AUTHORITATIVE current readings + thresholds for the risk overlay (MOVE
  // value, 5y percentile, watch/risk-off threshold values; 3M ΔY value,
  // inflationary/deflationary thresholds; the resulting equity / defensive
  // split and the active sleeve composition). The live gauges read indicators
  // via useEngineRegime; this file is what the engine actually published, so
  // the overlay panel shows the exact logic the allocation was built from.
  const [engineFile, setEngineFile] = useState(null);
  const [expandedSectors, setExpandedSectors] = useState(new Set());
  const [expandedIGs, setExpandedIGs] = useState(new Set());
  /* Sparkline hover state — { idx, value, date } when the user is hovering,
     null otherwise. Lets the gauge "Now" line swap to the hovered week so the
     24-week history reads like a real tooltip instead of a decorative curve. */
  const [stressHover, setStressHover] = useState(null);
  const [yieldHover, setYieldHover] = useState(null);
  const [openMech, setOpenMech] = useState(null); // cycle-mechanism whose 0–100 breakdown modal is open
  const [openInd, setOpenInd] = useState(null);   // indicator whose full chart modal is open
  const { active: indCatalog, indexSeries: indIndexSeries } = useIndicators();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetch('/macrotilt_engine_backtest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setBacktest(j); })
      .catch(() => {});
    fetch('/macrotilt_engine_history.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setHistory(j); })
      .catch(() => {});
    fetch('/macrotilt_engine.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setEngineFile(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const equityPct = allocation?.equity_pct ?? null;
  const defPct = allocation?.defensive_pct ?? null;
  const sleeve = regime.sleeveMix;

  /* Sort control for the sector table. Default = recommended allocation
     (largest book weight on top), per Joe 2026-06-03. The pills re-sort by
     tilt-vs-cap. Defensive-sleeve rows always render AFTER the equity rows
     regardless of this sort (handled in SectorFlow). */
  const [sectorSort, setSectorSort] = useState('recommended'); // 'recommended' | 'tilt'

  const sectors = useMemo(() => {
    const arr = (allocation?.sectors || []).slice();
    if (sectorSort === 'tilt') {
      arr.sort((a, b) => (b.vs_spy_pp ?? 0) - (a.vs_spy_pp ?? 0));
    } else {
      arr.sort((a, b) => (b.dollar ?? 0) - (a.dollar ?? 0)); // % of total, largest first
    }
    return arr;
  }, [allocation, sectorSort]);

  /* The six cycle-board mechanism readings (score 0–100 + band) for THE CYCLE
     READ panel and for the per-sector "why" sentences. Read straight from
     v10_allocation.json — never recomputed. */
  const mechScores = allocation?.mechanism_scores || null;
  const mechBands = allocation?.mechanism_bands || null;
  // Per-indicator breakdown behind each 0–100 score (added 2026-06-17). Same
  // file the engine acts on (v10_allocation.json) — never recomputed here.
  const mechBreakdown = allocation?.mechanism_breakdown || null;
  const mechRows = useMemo(() => {
    if (!mechScores) return [];
    return MECHANISMS.map((m) => {
      const score = Number.isFinite(mechScores[m.key]) ? mechScores[m.key] : null;
      const band = (mechBands && mechBands[m.key]) || null;
      const breakdown = (mechBreakdown && mechBreakdown[m.key]) || [];
      return { ...m, score, band, breakdown };
    });
  }, [mechScores, mechBands, mechBreakdown]);

  /* Prior-week sector weights for the "Prev" column. Captured weekly into
     v10_sector_history.json — shows "—" until a prior snapshot exists. Picks
     the snapshot nearest 7 days before the current as_of. */
  const [sectorHist, setSectorHist] = useState(null);
  useEffect(() => {
    let c = false;
    fetch('/v10_sector_history.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!c) setSectorHist(j); })
      .catch(() => {});
    return () => { c = true; };
  }, []);

  const prevBySector = useMemo(() => {
    const snaps = Array.isArray(sectorHist?.snapshots) ? sectorHist.snapshots : [];
    const curAsOf = allocation?.as_of;
    if (!snaps.length || !curAsOf) return {};
    const cur = new Date(curAsOf).getTime();
    const target = cur - 7 * 86400000;
    const prior = snaps.filter((s) => new Date(s.as_of).getTime() < cur - 86400000);
    if (!prior.length) return {};
    prior.sort((a, b) => Math.abs(new Date(a.as_of).getTime() - target) - Math.abs(new Date(b.as_of).getTime() - target));
    const map = {};
    (prior[0].sectors || []).forEach((s) => { map[s.sector] = s.dollar; });
    return map;
  }, [sectorHist, allocation]);

  const igsBySector = useMemo(() => {
    const out = {};
    (allocation?.industry_groups || []).forEach((ig) => {
      out[ig.sector] = out[ig.sector] || [];
      out[ig.sector].push(ig);
    });
    return out;
  }, [allocation]);

  const owUw = useMemo(() => {
    const ow = sectors.filter((s) => (s.vs_spy_pp ?? 0) > 0);
    const uw = sectors.filter((s) => (s.vs_spy_pp ?? 0) < 0);
    return {
      owCount: ow.length,
      owSum: ow.reduce((s, x) => s + (x.vs_spy_pp ?? 0), 0),
      uwCount: uw.length,
      uwSum: uw.reduce((s, x) => s + (x.vs_spy_pp ?? 0), 0),
    };
  }, [sectors]);

  const toggleSector = (id) => {
    const n = new Set(expandedSectors);
    if (n.has(id)) n.delete(id); else n.add(id);
    setExpandedSectors(n);
  };
  const toggleIG = (id) => {
    const n = new Set(expandedIGs);
    if (n.has(id)) n.delete(id); else n.add(id);
    setExpandedIGs(n);
  };

  /* 2026-05-27 — history-range selector. Joe asked for more than 24 weeks
     and we have 2056 weekly points (~40 years) in the engine backtest.
     The user picks the window from the pill group inside each gauge card.
     Default 24W to stay zoomed-in on the current regime. */
  const [histRange, setHistRange] = useState('24w');
  const HIST_WINDOWS = [
    { key: '24w', label: '24W', weeks: 24 },
    { key: '1y',  label: '1Y',  weeks: 52 },
    { key: '5y',  label: '5Y',  weeks: 260 },
    { key: 'max', label: 'Max', weeks: null }, // null = all available
  ];

  /* Weekly observation series powering the history sparklines + Regime History
     strip. Prefer the LIVE history file (refreshed weekly by the engine); fall
     back to the locked backtest's weekly array only if the live file hasn't
     loaded, so the strip never goes blank. (Fix 2026-06-03 — the locked
     backtest froze at May 15.) */
  const histWeekly = useMemo(() => {
    if (Array.isArray(history?.weekly) && history.weekly.length) return history.weekly;
    return Array.isArray(backtest?.weekly) ? backtest.weekly : [];
  }, [history, backtest]);

  /* Real 24-week history (still used by the Regime History strip — cells
     need readable width so that stays at 24 cells). */
  const weeklyTail24 = useMemo(() => histWeekly.slice(-24), [histWeekly]);

  /* Sparkline windows — slice the weekly series to the selected range.
     Empty array degrades gracefully via the "pending wire" placeholder. */
  const weeklyHistRange = useMemo(() => {
    if (!histWeekly.length) return [];
    const cfg = HIST_WINDOWS.find((c) => c.key === histRange) ?? HIST_WINDOWS[0];
    return cfg.weeks ? histWeekly.slice(-cfg.weeks) : histWeekly;
  }, [histWeekly, histRange]);

  const stressHist = useMemo(() => weeklyHistRange.map((w) => w.move).filter(Number.isFinite), [weeklyHistRange]);
  const yieldHist  = useMemo(() => weeklyHistRange.map((w) => w.delta_y_3m_bp).filter(Number.isFinite), [weeklyHistRange]);
  const stressDates = useMemo(() => weeklyHistRange.filter((w) => Number.isFinite(w.move)).map((w) => w.date), [weeklyHistRange]);
  const yieldDates  = useMemo(() => weeklyHistRange.filter((w) => Number.isFinite(w.delta_y_3m_bp)).map((w) => w.date), [weeklyHistRange]);
  const totalWeeks = histWeekly.length;

  /* Defensive sleeve weights as a portion of the TOTAL portfolio, expressed
     as a percentage (0–100). Used to render the 4-bar allocation
     visualization in the stance card. Note: equity_pct / defensive_pct in
     v10_allocation.json are FRACTIONS (1.0 = 100%); we multiply by 100 here
     so the bar widths render at the right scale. When the sleeve is on
     standby (Risk On regime), all three defensive components are 0 — the
     "Defensive sleeve on standby" caption explains why under the bars. */
  const sleeveAllocPct = useMemo(() => {
    if (!sleeve || defPct == null) {
      return { gold: 0, treasury: 0, cash: 0 };
    }
    const def100 = defPct * 100;
    return {
      gold:     def100 * (sleeve.gld   ?? 0),
      treasury: def100 * (sleeve.tlt   ?? 0),
      // Cash row absorbs SHY for display per the engine spec.
      cash:     def100 * ((sleeve.cash ?? 0) + (sleeve.shy ?? 0)),
    };
  }, [sleeve, defPct]);

  /* Defensive-sleeve rows for the sector table. Active → allocation.defensive
     (ticker/name/dollar, % of total). On standby (Risk On) that array is empty,
     so synthesize 0% rows from the engine sleeve composition so the line items
     are always visible under the equity rows (Joe 2026-06-03). */
  const sleeveRows = useMemo(() => {
    const active = allocation?.defensive;
    if (Array.isArray(active) && active.length) {
      return active.map((d) => ({ ticker: d.ticker, name: d.name, dollar: d.dollar }));
    }
    return [
      { ticker: 'TLT', name: 'Long Treasuries', dollar: sleeveAllocPct.treasury || 0 },
      { ticker: 'GLD', name: 'Gold', dollar: sleeveAllocPct.gold || 0 },
      { ticker: 'SHY', name: 'Cash / T-Bills', dollar: sleeveAllocPct.cash || 0 },
    ];
  }, [allocation, sleeveAllocPct]);

  /* Backtest validation numbers — never hardcoded. */
  const at = backtest?.validation?.asset_tilt;
  const spy = backtest?.validation?.spy;
  const nWeeks = backtest?.validation?.n_weeks;
  const validatedRange = backtest?.calibration_label || '—';

  /* ── Risk-overlay readings, straight from macrotilt_engine.json ──────────
     The 2-axis engine: axis 1 (stress) sets equity %, axis 2 (yield) selects
     the defensive sleeve when de-risked. We read the published values so the
     overlay panel mirrors EXACTLY what the allocation was built from. */
  const eng = engineFile;
  const engStress = eng?.stress || null;
  const engYield = eng?.yield_regime || null;
  const engAlloc = eng?.allocation || null;
  const engStressState = engStress?.state || regime.stressZone || null;
  const engYieldState = engYield?.state || regime.yieldRegime || null;
  const engEquityPct =
    engAlloc && Number.isFinite(engAlloc.equity_pct) ? engAlloc.equity_pct
      : equityPct != null ? Math.round(equityPct * 100) : null;
  const engDefPct =
    engAlloc && Number.isFinite(engAlloc.defensive_pct) ? engAlloc.defensive_pct
      : defPct != null ? Math.round(defPct * 100) : null;

  const openMechObj = openMech ? (mechRows.find((r) => r.key === openMech) || null) : null;
  const catalogById = useMemo(() => { const m = {}; (indCatalog || []).forEach((i) => { m[i.id] = i; }); return m; }, [indCatalog]);
  const chartableIds = useMemo(() => { const s2 = new Set(); (openMechObj?.breakdown || []).forEach((r) => { if (catalogById[CHART_ID[r.id] || r.id]) s2.add(r.id); }); return s2; }, [openMechObj, catalogById]);
  const handleOpenIndicator = (rid) => { const ind = catalogById[CHART_ID[rid] || rid]; if (ind) { setOpenMech(null); setOpenInd(ind); } };

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Asset Tilt</div>
          <h1 className="mt-h1">
            A <i>back-tested</i> asset allocation tool that seeks to beat
            the S&amp;P 500 on a risk-adjusted basis over the long run.
          </h1>
          <ul className="at-subbullets">
            <li><b>1 · Engine read</b> — how much risk to carry &amp; what holds the defensive sleeve (the equity-vs-defensive split).</li>
            <li><b>2 · Cycle board → sector &amp; industry tilts</b> — six mechanisms score the cycle and set every tilt; click any mechanism for its 0–100 math.</li>
          </ul>
        </div>
        <div className="at-keystats at-keystats--compact">
          <div className="mt-eyebrow">Backtest · {validatedRange}</div>
          <div className="at-keygrid">
            <div>
              <div className="mt-eyebrow">CAGR</div>
              <b className="num at-keynum">{at ? fmtPctRaw(at.cagr, 2) : '—'}<i>%</i></b>
              <span className="at-keyvs num">vs SPY {spy ? fmtPctRaw(spy.cagr, 2) + '%' : '—'}</span>
            </div>
            <div>
              <div className="mt-eyebrow">Sharpe</div>
              <b className="num at-keynum">{at ? at.sharpe.toFixed(2) : '—'}</b>
              <span className="at-keyvs num">vs SPY {spy ? spy.sharpe.toFixed(2) : '—'}</span>
            </div>
            <div>
              <div className="mt-eyebrow">Max DD</div>
              <b className="num at-keynum down">{at ? fmtPctFraction(at.max_drawdown, 1) : '—'}<i>%</i></b>
              <span className="at-keyvs num">vs SPY {spy ? fmtPctFraction(spy.max_drawdown, 1) + '%' : '—'}</span>
            </div>
            <div>
              <div className="mt-eyebrow">Validated</div>
              <b className="num at-keynum">{nWeeks ? nWeeks.toLocaleString() : '—'}<i>w</i></b>
              <span className="at-keyvs num">weekly rebal</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION A · ENGINE READ + RECOMMENDED ALLOCATION ──────────────
          Three EQUAL dials. Each dial carries its own rule, folded in from the
          former standalone risk-overlay panel: the MOVE dial shows the stress
          rule + equity outcome, the yield dial shows the rate-regime rule +
          sleeve outcome, the allocation dial shows the resulting split with a
          one-line synthesis. The whole section is one outlined block. */}
      <section className="mt-pagesection at-section">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Section 1 · Engine read — how much risk, and what defensive</div>
            <div className="mt-h2">
              {regime.stressZone || '—'} · {regime.yieldRegime || '—'} — {fmtPercent(equityPct, 0)}% equity,
              defensive {sleeve ? 'firing' : 'on standby'}.
            </div>
          </div>
        </div>

        <div className="at-engineread">
          {/* ── Dial 1 · Stress signal (MOVE) → how much equity ── */}
          <article className="mt-card at-gauge">
            <div className="at-gaugehead">
              <div className="mt-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>Stress signal · MOVE</span>
                <FreshnessChip elementId="indicator-move-daily" variant="label" />
              </div>
              <div className="mt-pillgroup">
                <button type="button" className={`mt-pill ${regime.stressZone === 'Risk On' ? 'on' : ''}`}>RISK ON</button>
                <button type="button" className={`mt-pill ${regime.stressZone === 'Watch' ? 'on' : ''}`}>WATCH</button>
                <button type="button" className={`mt-pill ${regime.stressZone === 'Risk Off' ? 'on' : ''}`}>RISK OFF</button>
              </div>
            </div>
            <BigGauge
              value={regime.move ?? 0}
              max={200}
              thresholds={[{ pos: 116 / 200 }, { pos: 124 / 200 }]}
            />
            <GaugeLegend
              zones={[
                { kind: 'up', label: 'Risk On', range: '≤ 116' },
                { kind: 'warn', label: 'Watch', range: '116–124' },
                { kind: 'down', label: 'Risk Off', range: '≥ 124' },
              ]}
            />
            <div className="at-gaugefoot num">
              <span>
                {stressHover && stressHover.value != null
                  ? stressHover.value.toFixed(1)
                  : regime.move != null ? regime.move.toFixed(1) : '—'}
              </span>
              <span className="at-gaugedim">
                {stressHover && stressHover.date
                  ? `week of ${stressHover.date}`
                  : regime.movePct != null ? `${regime.movePct}th pctile · 5y` : '—'}
              </span>
            </div>
            {/* Folded risk-overlay logic — the rule that turns MOVE into an equity %. */}
            <div className="at-dialrule">
              <span className="at-axis-step"><span className="at-axis-dot at-axis-dot--on" /> MOVE below {engStress?.watch_threshold_value != null ? engStress.watch_threshold_value.toFixed(0) : '116'} → <b>Risk On</b> · 100% equity</span>
              <span className="at-axis-step"><span className="at-axis-dot at-axis-dot--watch" /> {engStress?.watch_threshold_value != null ? engStress.watch_threshold_value.toFixed(0) : '116'}–{engStress?.risk_off_threshold_value != null ? engStress.risk_off_threshold_value.toFixed(0) : '124'} → <b>Watch</b> · begin de-risking</span>
              <span className="at-axis-step"><span className="at-axis-dot at-axis-dot--off" /> above {engStress?.risk_off_threshold_value != null ? engStress.risk_off_threshold_value.toFixed(0) : '124'} → <b>Risk Off</b> · up to 50% defensive</span>
            </div>
            <div className="at-dialoutcome">
              → reads <b className={`at-axis-state at-axis-state--${mapStressClass(engStressState)}`}>{engStressState || '—'}</b> today ·
              sets <b className="num">{engEquityPct != null ? engEquityPct : '—'}%</b> equity
            </div>
            <div className="at-gauge-histhead">
              <div className="mt-eyebrow at-gauge-eyebrow">
                {HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W'} history
              </div>
              <div className="mt-pillgroup at-rangepills">
                {HIST_WINDOWS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`mt-pill ${histRange === c.key ? 'on' : ''}`}
                    onClick={() => setHistRange(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {stressHist.length > 0 ? (
              <Sparkline
                data={stressHist}
                width={520}
                height={56}
                stroke="var(--mt-accent)"
                fill="var(--mt-accent)"
                area
                onHover={(idx, value) => {
                  if (idx == null) setStressHover(null);
                  else setStressHover({ idx, value, date: stressDates[idx] ?? null });
                }}
              />
            ) : (
              <div className="at-spark-placeholder">MOVE history pending wire</div>
            )}
            <div className="at-gaugemini num">
              <span>{HIST_WINDOWS.find((c) => c.key === histRange)?.label === 'Max' ? `${totalWeeks}W` : (HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W')}</span>
              <span>NOW</span>
            </div>
          </article>

          {/* ── Dial 2 · Yield regime (3M Δ 10y) → which defensive sleeve ── */}
          <article className="mt-card at-gauge">
            <div className="at-gaugehead">
              <div className="mt-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>Yield regime · 3M Δ 10y</span>
                <FreshnessChip elementId="indicator-yield_curve-daily" variant="label" />
              </div>
              <div className="mt-pillgroup">
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Deflationary' ? 'on' : ''}`}>DEFL.</button>
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Neutral' ? 'on' : ''}`}>NEUTRAL</button>
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Inflationary' ? 'on' : ''}`}>INFL.</button>
              </div>
            </div>
            <BigGauge
              value={regime.yieldDeltaBp ?? 0}
              max={100}
              bidirectional
              thresholds={[{ pos: (100 - 11) / 200 }, { pos: (100 + 32) / 200 }]}
            />
            <GaugeLegend
              zones={[
                { kind: 'up', label: 'Deflationary', range: '≤ −11 bp' },
                { kind: 'warn', label: 'Neutral', range: '−11 / +32' },
                { kind: 'down', label: 'Inflationary', range: '≥ +32 bp' },
              ]}
            />
            <div className="at-gaugefoot num">
              <span>
                {yieldHover && yieldHover.value != null
                  ? `${yieldHover.value >= 0 ? '+' : ''}${yieldHover.value.toFixed(0)} bp`
                  : regime.yieldDeltaBp != null
                    ? `${regime.yieldDeltaBp >= 0 ? '+' : ''}${regime.yieldDeltaBp.toFixed(0)} bp`
                    : '—'}
              </span>
              <span className="at-gaugedim">
                {yieldHover && yieldHover.date
                  ? `week of ${yieldHover.date}`
                  : regime.yieldPct != null ? `${regime.yieldPct}th pctile · 5y` : '—'}
              </span>
            </div>
            {/* Folded risk-overlay logic — the rule that picks the defensive sleeve. */}
            <div className="at-dialrule">
              <span className="at-axis-step"><span className="at-axis-dot at-axis-dot--defl" /> below {engYield?.deflationary_threshold_bp != null ? engYield.deflationary_threshold_bp.toFixed(0) : '−10'} bp → <b>Deflationary</b> · lean long Treasuries</span>
              <span className="at-axis-step"><span className="at-axis-dot at-axis-dot--neutral" /> between → <b>Neutral</b> · balanced sleeve</span>
              <span className="at-axis-step"><span className="at-axis-dot at-axis-dot--infl" /> above {engYield?.inflationary_threshold_bp != null ? engYield.inflationary_threshold_bp.toFixed(0) : '+33'} bp → <b>Inflationary</b> · gold &amp; short T-bills</span>
            </div>
            <div className="at-dialoutcome">
              → reads <b className={`at-axis-state at-axis-state--${mapYieldClass(engYieldState)}`}>{engYieldState || '—'}</b> today ·
              {engDefPct ? <> sleeve <b>{engAlloc?.active_sleeve_label || engYieldState || '—'}</b></> : <> sleeve on standby (stress is Risk On)</>}
            </div>
            <div className="at-gauge-histhead">
              <div className="mt-eyebrow at-gauge-eyebrow">
                {HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W'} history
              </div>
              <div className="mt-pillgroup at-rangepills">
                {HIST_WINDOWS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`mt-pill ${histRange === c.key ? 'on' : ''}`}
                    onClick={() => setHistRange(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {yieldHist.length > 0 ? (
              <Sparkline
                data={yieldHist}
                width={520}
                height={56}
                stroke="var(--mt-warn)"
                fill="var(--mt-warn)"
                area
                onHover={(idx, value) => {
                  if (idx == null) setYieldHover(null);
                  else setYieldHover({ idx, value, date: yieldDates[idx] ?? null });
                }}
              />
            ) : (
              <div className="at-spark-placeholder">Yield history pending wire</div>
            )}
            <div className="at-gaugemini num">
              <span>{HIST_WINDOWS.find((c) => c.key === histRange)?.label === 'Max' ? `${totalWeeks}W` : (HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W')}</span>
              <span>NOW</span>
            </div>
          </article>

        </div>{/* end at-engineread — two dials only */}

        {/* Regime history — moved up INTO the engine-read section (Joe 2026-06-17). */}
        <div className="mt-card at-reghist-card">
          <div className="mt-eyebrow">Regime history · 24 weeks — when the engine moved</div>
          <div className="at-regstrip">
            {weeklyTail24.length > 0 ? (
              weeklyTail24.map((w, i) => {
                const stress = mapStressClass(w.stress_state);
                const stage = mapYieldClass(w.yield_regime);
                return (
                  <Tip
                    key={i}
                    bare
                    block
                    content={`Week ${i + 1} · ${w.date || '—'}: ${w.stress_state || '—'} · ${w.yield_regime || '—'}`}
                  >
                    <div className={`at-regcell at-regcell--${stage} at-regcell--${stress}`} />
                  </Tip>
                );
              })
            ) : (
              Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="at-regcell at-regcell--skel" />
              ))
            )}
          </div>
          <div className="at-regfoot">
            <span><span className="at-regdot at-regdot--on" /> Risk On</span>
            <span><span className="at-regdot at-regdot--watch" /> Watch</span>
            <span><span className="at-regdot at-regdot--off" /> Risk Off</span>
            <span className="lm-flowfootsep" />
            <span><span className="at-regdot at-regdot--neutral" /> Neutral</span>
            <span><span className="at-regdot at-regdot--infl" /> Inflationary</span>
            <span><span className="at-regdot at-regdot--defl" /> Deflationary</span>
            <span className="num at-foot-push">24 weeks · rebalanced weekly</span>
          </div>
        </div>
      </section>

      {/* ── SECTION B · CYCLE BOARD → SECTOR TILTS ────────────────────────
          The six mechanisms (click any for its 0–100 math) flow straight into
          the sector tilts. Same data the engine acts on; nothing recomputed.
          One outlined block. */}
      <section className="mt-pagesection at-section">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>Section 2 · The cycle board → sector tilts</span>
              <FreshnessChip
                elementId="v10-allocation-daily"
                variant="label"
                fallback={{ asOfIso: allocation?.as_of, calendar: 'us-business-day' }}
              />
            </div>
            <div className="mt-h2">Six mechanisms diagnose the cycle — and set every sector tilt.</div>
          </div>
          <div className="mt-pillgroup">
            {[['recommended', 'Recommended'], ['tilt', 'Tilt vs cap']].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`mt-pill ${sectorSort === k ? 'on' : ''}`}
                onClick={() => setSectorSort(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-card at-cycle">
          <div className="at-cycle-intro">
            Each mechanism is scored <b>0–100</b> — a higher score means more
            risk-off pressure from that lens. <b>Click any mechanism</b> to see
            the indicators behind its score and how they average to the number.
            Scores come straight from the engine; nothing here is recomputed.
          </div>
          {mechRows.length > 0 ? (
            <div className="at-cyclegrid">
              {mechRows.map((m) => {
                const b = bandClass(m.band);
                const scoreTxt = m.score != null ? Math.round(m.score) : '—';
                const pct = m.score != null ? Math.max(0, Math.min(100, m.score)) : 0;
                return (
                  <Tip
                    key={m.key}
                    bare
                    block
                    content={
                      <div style={{ maxWidth: 240 }}>
                        <b>{m.label}</b> · {BAND_LABEL[m.band] || '—'}
                        <div style={{ marginTop: 4, color: 'var(--mt-ink-2)' }}>{m.blurb}</div>
                        <div style={{ marginTop: 4, color: 'var(--mt-accent)', fontWeight: 600 }}>Click for the 0–100 math →</div>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      className={`at-mech at-mech--${b} at-mech--clickable`}
                      onClick={() => setOpenMech(m.key)}
                      aria-label={`${m.label} — show how the score is calculated`}
                    >
                      <div className="at-mech-top">
                        <span className="at-mech-label">{m.label}</span>
                        <span className={`mt-tag ${m.band === 'risk-off' ? 'mt-tag--extreme' : m.band === 'caution' ? 'mt-tag--elev' : 'mt-tag--calm'}`}>
                          {BAND_LABEL[m.band] || '—'}
                        </span>
                      </div>
                      <div className="at-mech-scorerow">
                        <span className="num at-mech-score">{scoreTxt}</span>
                        <span className="at-mech-track">
                          <span className={`at-mech-fill at-mech-fill--${b}`} style={{ width: `${pct}%` }} />
                        </span>
                      </div>
                      <div className="at-mech-mean">{m.score != null ? m.phrase(m.score) : '—'}</div>
                      <div className="at-mech-more">Show the math →</div>
                    </button>
                  </Tip>
                );
              })}
            </div>
          ) : (
            <div className="at-cycle-empty">Cycle-board reading unavailable — engine data not loaded.</div>
          )}
          <div className="at-cycle-foot">
            <span><span className="at-regdot at-regdot--off" /> Risk-off (75–100)</span>
            <span><span className="at-regdot at-regdot--watch" /> Caution (50–74)</span>
            <span><span className="at-regdot at-regdot--on" /> Neutral / risk-on (0–49)</span>
            <span className="at-foot-push">Each sector tilt below traces back to these six</span>
          </div>
        </div>

        <div className="at-sector-hint">
          Expand any sector to see how the six mechanisms produced its tilt, and
          how that tilt score becomes a weight versus the S&amp;P 500.
        </div>
        {loading ? (
          <div className="mt-loadingcard">Loading allocation…</div>
        ) : (
          <SectorFlow
            sectors={sectors}
            igsBySector={igsBySector}
            expandedSectors={expandedSectors}
            expandedIGs={expandedIGs}
            toggleSector={toggleSector}
            toggleIG={toggleIG}
            sortKey={sectorSort}
            sleeveRows={sleeveRows}
            prevBySector={prevBySector}
            mechBands={mechBands}
          />
        )}
        <div className="lm-flowfoot">
          <span>
            <b className="at-ow">Overweight</b> · {owUw.owCount} sectors ·{' '}
            <b className="num up">+{owUw.owSum.toFixed(1)}%</b>
          </span>
          <span className="lm-flowfootsep" />
          <span>
            <b className="at-uw">Underweight</b> · {owUw.uwCount} sectors ·{' '}
            <b className="num down">{owUw.uwSum.toFixed(1)}%</b>
          </span>
          <span className="at-foot-push">
            <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate('/portfolio')}>
              Apply to my portfolio →
            </button>
          </span>
        </div>
      </section>

      {openMechObj && (
        <MechModal mech={openMechObj} breakdown={openMechObj.breakdown} onClose={() => setOpenMech(null)} onOpenIndicator={handleOpenIndicator} chartableIds={chartableIds} />
      )}
      {openInd && (
        <ChartModal onClose={() => setOpenInd(null)}>
          <IndicatorDetail ind={openInd} catalog={indCatalog} indexSeries={indIndexSeries} onClose={() => setOpenInd(null)} />
        </ChartModal>
      )}
    </div>
  );
}

