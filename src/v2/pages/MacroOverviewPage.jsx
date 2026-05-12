import React, { useEffect, useMemo, useState } from 'react';
import Drawer from '../components/Drawer';

/**
 * Macro Overview — Signal Intelligence regime read.
 *
 * Built strictly to Risk_Off_Framework_Methodology.md. All math, thresholds,
 * stages, and regime rules come from the spec; nothing is improvised here.
 *
 * Layer 1 — three vol anchors (CPFF, MOVE, VIX). Each has a threshold = its own
 * trailing-5y 85th percentile. Stage = consecutive weeks above threshold
 * (0 Calm → 1 Watching → 2 Holding → 3 Confirmed → 4 Entrenched).
 *
 * Layer 2 — cycle composite = average of 7 stress-direction percentile ranks
 * over the indicator's full history (Copper/Gold, KBW Bank/SPX, 10y-2y Yield
 * Curve, Chicago Fed ANFCI, Initial Jobless Claims, HY OAS, IG OAS). "Stress
 * direction" means: for indicators whose HIGH value is bearish (ANFCI, claims,
 * HY/IG spreads) percentile is straight; for indicators whose LOW value is
 * bearish (Copper/Gold, KBW/SPX, Yield Curve) percentile is inverted.
 *
 * Regime (per spec — mapped 1:1 to the locked lexicon):
 *   GREEN  → Risk On     — no anchor at Stage 1+
 *   WATCH  → Neutral     — one anchor at Stage 1 only (single-week cross)
 *   AMBER  → Cautionary  — anchor Stage 2+, cycle composite quintile Q3-Q5
 *   RED    → Risk Off    — anchor Stage 2+, cycle composite quintile Q1-Q2
 *
 * Data sources: /indicator_history.json (all raw indicator history).
 * No /cycle_v2.json (different framework, different methodology — not used).
 */

// ─────────────────────────────────────────────────────────────────────
//   FRAMEWORK CONSTANTS — straight from Risk_Off_Framework_Methodology.md
// ─────────────────────────────────────────────────────────────────────

// Three vol anchors. Threshold = trailing-5y 85th percentile of raw values.
// Dial scale_max is chosen to cover full historical range with headroom.
// scaleMax is derived dynamically at render time from each anchor's threshold:
//   scaleMax = threshold / 0.65
// so the 85th-percentile threshold mark lands at the same 65% arc position on
// every dial. No more invented numbers.
const VOL_ANCHORS = [
  { id: 'vix',  title: 'Equity Volatility',  niceName: 'VIX',  unit: '',     fmt: (v) => v.toFixed(1) },
  { id: 'move', title: 'Bond Volatility',    niceName: 'MOVE', unit: '',     fmt: (v) => v.toFixed(0) },
  { id: 'cpff', title: 'Funding Stress',     niceName: 'CPFF', unit: ' bp',  fmt: (v) => v.toFixed(0)+' bp' },
];

// Seven cycle indicators. `bearishHigh` = true means HIGH value is bearish
// (percentile rank in stress direction is the raw percentile). FALSE means LOW
// value is bearish (percentile is inverted: stress_pct = 100 - raw_pct).
const CYCLE_INDICATORS = [
  { id: 'copper_gold',  name: 'Copper / Gold ratio',     bearishHigh: false, fmt: (v) => v.toFixed(3) },
  { id: 'bkx_spx_v11',  name: 'KBW Bank / S&P ratio',    bearishHigh: false, fmt: (v) => v.toFixed(4) },
  { id: 'yield_curve',  name: 'Yield curve (10y − 2y)',  bearishHigh: false, fmt: (v) => (v >= 0 ? '+' : '') + Math.round(v) + ' bp' },
  { id: 'anfci',        name: 'Chicago Fed FCI',         bearishHigh: true,  fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { id: 'ic4wsa',       name: 'Initial Jobless Claims',  bearishHigh: true,  fmt: (v) => Math.round(v) + 'K' },
  { id: 'hy_ig',        name: 'High-Yield spread',       bearishHigh: true,  fmt: (v) => Math.round(v) + ' bp' },
  { id: 'ig_oas',       name: 'Investment-Grade spread', bearishHigh: true,  fmt: (v) => Math.round(v) + ' bp' },
];

// Anchor stage names per spec. Index = stage number.
const STAGE_NAMES = ['Calm', 'Watching', 'Holding', 'Confirmed', 'Entrenched'];

// Regime labels, ordered least to most severe (matches GREEN/WATCH/AMBER/RED).
const REGIME_ORDER = ['Risk On', 'Neutral', 'Cautionary', 'Risk Off'];
const REGIME_DESC = {
  'Risk On':    'No volatility triggers.',
  'Neutral':    'One volatility trigger.',
  'Cautionary': 'One or more volatility triggers sustained.',
  'Risk Off':   'One or more volatility triggers sustained + late-cycle positioning.',
};

// ─────────────────────────────────────────────────────────────────────
//   PURE HELPERS
// ─────────────────────────────────────────────────────────────────────

function trailing5ySorted(points) {
  if (!points || !points.length) return [];
  const last = new Date(points[points.length - 1][0]);
  const cutoff = new Date(last); cutoff.setFullYear(last.getFullYear() - 5);
  return points
    .filter(([d]) => new Date(d) >= cutoff)
    .map(([, v]) => v)
    .filter(v => v != null && !isNaN(v))
    .sort((a, b) => a - b);
}

function fullHistorySorted(points) {
  if (!points || !points.length) return [];
  return points
    .map(([, v]) => v)
    .filter(v => v != null && !isNaN(v))
    .sort((a, b) => a - b);
}

function valueAtPctile(sorted, pct) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx];
}

function pctileOf(value, sorted) {
  if (!sorted.length || value == null || isNaN(value)) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (sorted[m] < value) lo = m + 1; else hi = m; }
  return Math.round((lo / sorted.length) * 100);
}

// Collapse daily points → last N weekly closes (Sunday week-key, last value of week)
function weeklyClose(points, weeksBack = 24) {
  if (!points || !points.length) return [];
  const byWeek = {};
  for (const [ds, v] of points) {
    if (v == null || isNaN(v)) continue;
    const d = new Date(ds), w = new Date(d); w.setDate(d.getDate() - d.getDay());
    byWeek[w.toISOString().slice(0, 10)] = { date: ds, value: v };
  }
  const ks = Object.keys(byWeek).sort();
  return ks.slice(-weeksBack).map(k => byWeek[k]);
}

// Per spec: stage = consecutive weeks above threshold (anchored at most recent week).
// 0 = below threshold, 1 = crossed this week, 2 = 2 weeks, 3 = 4 weeks, 4 = 8 weeks.
function anchorStage(weekly, threshold) {
  if (!weekly.length || threshold == null) return 0;
  let consec = 0;
  for (let i = weekly.length - 1; i >= 0; i--) {
    if (weekly[i].value >= threshold) consec++;
    else break;
  }
  if (consec === 0) return 0;
  if (consec === 1) return 1;
  if (consec <= 3) return 2;
  if (consec <= 7) return 3;
  return 4;
}

// Per-week stage history (each week sees stage based on its trailing consecutive run)
function weeklyStages(weekly, threshold) {
  let consec = 0;
  return weekly.map(w => {
    if (w.value >= threshold) consec++; else consec = 0;
    if (consec === 0) return 0;
    if (consec === 1) return 1;
    if (consec <= 3) return 2;
    if (consec <= 7) return 3;
    return 4;
  });
}

// Cycle composite → quintile bucket. Q1 = lowest (most bullish), Q5 = highest (most bearish).
function quintile(score) {
  if (score == null) return null;
  if (score < 20)  return 1;
  if (score < 40)  return 2;
  if (score < 60)  return 3;
  if (score < 80)  return 4;
  return 5;
}

// Regime per spec: anchor stages × cycle quintile.
function computeRegime(stages, cycleQuintile) {
  const maxStage = Math.max(...stages, 0);
  if (maxStage === 0) return 'Risk On';
  if (maxStage === 1 && stages.filter(s => s >= 1).length === 1) return 'Neutral';
  // Anchor at Stage 2+
  if (cycleQuintile == null) return 'Cautionary';
  return cycleQuintile <= 2 ? 'Risk Off' : 'Cautionary';
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────
//   COMPONENT
// ─────────────────────────────────────────────────────────────────────

export default function MacroOverviewPage() {
  const [indHist, setIndHist] = useState(null);
  const [drawer, setDrawer] = useState({ open: false, kind: null, payload: null });

  useEffect(() => {
    fetch('/indicator_history.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).then(setIndHist).catch(() => {});
  }, []);

  const data = useMemo(() => {
    if (!indHist) return null;

    // ── Vol anchors ──
    const anchors = VOL_ANCHORS.map(cfg => {
      const raw = indHist[cfg.id];
      if (!raw || !raw.points || !raw.points.length) {
        return { ...cfg, current: null, threshold: null, scaleMax: 100, stage: 0, stageName: 'Calm', weekly: [], stages: [], asOf: null };
      }
      const sorted5y = trailing5ySorted(raw.points);
      const threshold = valueAtPctile(sorted5y, 85);
      const current = raw.points[raw.points.length - 1];
      const weekly = weeklyClose(raw.points, 24);
      const stages = weeklyStages(weekly, threshold);
      const stage = anchorStage(weekly, threshold);
      // scale so threshold lands at 65% of the arc — same visual position across all 3 dials
      const scaleMax = threshold != null ? threshold / 0.65 : 100;
      return {
        ...cfg,
        current: current[1],
        threshold,
        scaleMax,
        stage,
        stageName: STAGE_NAMES[stage] || 'Calm',
        weekly,
        stages,
        asOf: raw.as_of,
      };
    });

    // ── Cycle indicators (stress-direction percentile, full history) ──
    const cycleInd = CYCLE_INDICATORS.map(cfg => {
      const raw = indHist[cfg.id];
      if (!raw || !raw.points || !raw.points.length) {
        return { ...cfg, value: null, valueText: '—', stressPctile: null };
      }
      const sortedFull = fullHistorySorted(raw.points);
      const current = raw.points[raw.points.length - 1];
      const rawPct = pctileOf(current[1], sortedFull);
      const stressPct = rawPct == null ? null : (cfg.bearishHigh ? rawPct : 100 - rawPct);
      return {
        ...cfg,
        value: current[1],
        valueText: current[1] != null && !isNaN(current[1]) ? cfg.fmt(current[1]) : '—',
        stressPctile: stressPct,
      };
    });
    const cycleAvail = cycleInd.map(i => i.stressPctile).filter(p => p != null);
    const cycleScore = cycleAvail.length ? Math.round(cycleAvail.reduce((a, b) => a + b, 0) / cycleAvail.length) : null;
    const cycleQuintile = quintile(cycleScore);

    // ── Regime ──
    const stagesArr = anchors.map(a => a.stage);
    const regime = computeRegime(stagesArr, cycleQuintile);

    // ── Regime history (last 24 weeks) — replay per-week ──
    const weeks = anchors[0]?.weekly?.length || 0;
    const regimeHistory = [];
    for (let i = 0; i < weeks; i++) {
      const wStages = anchors.map(a => a.stages[i] ?? 0);
      // Use the CURRENT cycle quintile as a stand-in (we don't recompute weekly cycle history here)
      const r = computeRegime(wStages, cycleQuintile);
      regimeHistory.push({
        date: anchors[0].weekly[i]?.date,
        label: r,
      });
    }

    return { anchors, cycleInd, cycleScore, cycleQuintile, regime, regimeHistory };
  }, [indHist]);

  if (!data) {
    return <div className="v2-shell" style={{ padding: '60px 32px', textAlign: 'center', color: 'var(--ink-2)' }}>Loading macro data…</div>;
  }

  const { anchors, cycleInd, cycleScore, regime, regimeHistory } = data;

  const openWeek = (i) => setDrawer({ open: true, kind: 'week', payload: i });
  const openAnchor = (id) => setDrawer({ open: true, kind: 'anchor', payload: id });
  const openCycleInd = (id) => setDrawer({ open: true, kind: 'cycle_ind', payload: id });

  return (
    <>
      <style>{MO_CSS}</style>
      <div className="mo-page">

        {/* HEAD STRIP */}
        <div className="mo-top">
          <div>
            <div className="mo-eyebrow">Macro Overview</div>
            <h1 className="mo-h1">
              Three volatility <em>triggers</em>, one <em>cycle position</em>, one regime read.
            </h1>
            <p className="mo-lede">
              Vol triggers tell us when trouble has arrived. The cycle composite tells us
              whether that trouble matters. Together they produce a single state:{' '}
              <strong>Risk On</strong>, <strong>Neutral</strong>, <strong>Cautionary</strong>, or{' '}
              <strong>Risk Off</strong>. We describe the tape — we don't predict tops.
            </p>
          </div>

          {/* REGIME TILE */}
          <aside className="mo-regime">
            <h2 className="mo-regime-title">Regime</h2>
            {REGIME_ORDER.map(name => (
              <div key={name} className={`mo-rrow ${regime === name ? 'current' : ''}`}>
                <span className="mo-rpill">{name}</span>
                <span className="mo-rdesc">{REGIME_DESC[name]}</span>
              </div>
            ))}

            <div className="mo-rhist-wrap">
              <div className="mo-rhist-axis"><span>24 weeks ago</span><span>today</span></div>
              <div className="mo-rhist-strip">
                {regimeHistory.map((w, i) => {
                  const stageHeight = REGIME_ORDER.indexOf(w.label);
                  const heightPct = 18 + (stageHeight * 22);
                  const stageClass = `s${stageHeight}`;
                  return (
                    <span
                      key={i}
                      className={`mo-rhist-bar ${stageClass}`}
                      style={{ height: heightPct + '%' }}
                      data-tt={`${fmtDate(w.date)} · ${w.label}`}
                      onClick={() => openWeek(i)}
                    />
                  );
                })}
              </div>
            </div>
          </aside>
        </div>

        {/* THREE VOL TILES — raw value dials with raw threshold mark + stage badge */}
        <div className="mo-vol-grid">
          {anchors.map(a => (
            <AnchorTile key={a.id} anchor={a} onDial={() => openAnchor(a.id)} onBar={openWeek} />
          ))}
        </div>

        {/* CYCLE POSITIONING — 7 stress-direction percentiles, simple average */}
        <div className="mo-cycle">
          <h2 className="mo-cycle-title">Cycle Positioning</h2>

          <div className="mo-cycle-body">
            <div className="mo-cycle-left">
              <CycleDial score={cycleScore} />
              <div className="mo-readout">
                <span className="mo-val">{cycleScore != null ? cycleScore : '—'}</span>
                <span className="mo-denom">/ 100</span>
              </div>
            </div>

            <div className="mo-cycle-right">
              <div className="mo-sub-eyebrow">
                Average of seven percentile ranks &middot; click any indicator to drill in
              </div>
              <div className="mo-ind-list">
                <div className="mo-ind-header">
                  <span>Indicator</span>
                  <span></span>
                  <span>Reading</span>
                  <span>Percentile Rank</span>
                </div>
                {cycleInd.map(ind => {
                  const p = ind.stressPctile;
                  return (
                    <div key={ind.id} className="mo-ind-row" onClick={() => openCycleInd(ind.id)}>
                      <span className="mo-ind-name">{ind.name}</span>
                      <span className="mo-ind-barwrap">
                        <span
                          className={`mo-ind-bar ${p == null ? 'low' : p >= 75 ? 'high' : p >= 50 ? 'med' : 'low'}`}
                          style={{ width: (p ?? 0) + '%' }}
                        />
                      </span>
                      <span className="mo-ind-reading">{ind.valueText}</span>
                      <span className="mo-ind-pctile">{p != null ? p + '%' : '—'}</span>
                    </div>
                  );
                })}
                <div className="mo-ind-avg">
                  <span></span><span></span>
                  <span className="mo-ind-avg-label">Average =</span>
                  <span className="mo-ind-avg-val">{cycleScore != null ? cycleScore : '—'} / 100</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <Drawer open={drawer.open} onClose={() => setDrawer({ open: false, kind: null, payload: null })}>
        {drawer.open && <DrawerContent drawer={drawer} data={data} />}
      </Drawer>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────

function AnchorTile({ anchor, onDial, onBar }) {
  const a = anchor;
  return (
    <div className="mo-tile">
      <h2 className="mo-tile-title">{a.title}</h2>
      <div className="mo-stage-row">
        <span className={`mo-stage-pill stage-${a.stage}`}>{a.stageName}</span>
      </div>
      <div className="mo-dial-wrap" onClick={onDial}>
        <RawDial value={a.current} threshold={a.threshold} max={a.scaleMax} fmt={a.fmt} />
        <div className="mo-readout">
          <span className="mo-val">{a.current != null ? a.fmt(a.current) : '—'}</span>
        </div>
        <div className="mo-mark-line">mark = {a.threshold != null ? a.fmt(a.threshold) : '—'}</div>
      </div>
      <div className="mo-bar-wrap">
        <div className="mo-bar-axis"><span>24w</span><span>now</span></div>
        <div className="mo-bar-strip">
          {a.weekly.map((w, i) => {
            const heightPct = a.scaleMax ? Math.max(8, Math.min(95, (w.value / a.scaleMax) * 100)) : 50;
            return (
              <span
                key={i}
                className={`mo-bar s${a.stages[i] || 0}`}
                style={{ height: heightPct + '%' }}
                data-tt={`${fmtDate(w.date)} · ${a.fmt(w.value)}`}
                onClick={() => onBar(i)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Half-circle dial that maps RAW VALUE to position along the arc using a fixed
// scale (0 → max). Threshold drawn as a tick + label at its raw position.
function RawDial({ value, threshold, max, fmt }) {
  const cx = 120, cy = 120, R = 100;
  const v = value == null || isNaN(value) ? 0 : Math.max(0, Math.min(max, value));
  const valPct = (v / max) * 100;
  const angle = 180 - (valPct * 1.8);
  const rad = (angle * Math.PI) / 180;
  const tipX = cx + R * Math.cos(rad);
  const tipY = cy - R * Math.sin(rad);

  let markX = null, markY = null, markLabelX = null, markLabelY = null;
  if (threshold != null && !isNaN(threshold)) {
    const tPct = Math.max(0, Math.min(100, (threshold / max) * 100));
    const tAngle = 180 - (tPct * 1.8);
    const tRad = (tAngle * Math.PI) / 180;
    markX = cx + R * Math.cos(tRad);
    markY = cy - R * Math.sin(tRad);
    markLabelX = cx + (R + 14) * Math.cos(tRad);
    markLabelY = cy - (R + 14) * Math.sin(tRad);
  }

  return (
    <svg className="mo-dial" viewBox="0 0 240 140">
      <path d="M 20 122 A 100 100 0 0 1 55 49"  fill="rgba(0,113,227,0.18)" />
      <path d="M 55 49 A 100 100 0 0 1 120 22"  fill="rgba(0,113,227,0.42)" />
      <path d="M 120 22 A 100 100 0 0 1 185 49" fill="rgba(0,113,227,0.68)" />
      <path d="M 185 49 A 100 100 0 0 1 220 122" fill="rgba(0,113,227,0.92)" />
      {markX != null && (
        <>
          <line x1={markX} y1={markY} x2={markX + 10*Math.cos((180 - (threshold/max*100)*1.8) * Math.PI/180)} y2={markY - 10*Math.sin((180 - (threshold/max*100)*1.8) * Math.PI/180)} stroke="#0e1115" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx={markX} cy={markY} r="3" fill="#0e1115" />
          <text x={markLabelX} y={markLabelY} fontFamily="JetBrains Mono" fontSize="9" fill="#0e1115" fontWeight="600" textAnchor={threshold/max > 0.5 ? 'start' : 'end'}>
            {fmt(threshold)}
          </text>
        </>
      )}
      <line x1={cx} y1={cy} x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx={tipX} cy={tipY} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.8" />
      <circle cx={cx} cy={cy} r="4.5" fill="var(--accent)" />
    </svg>
  );
}

// Cycle dial — 0-100 score. Same gradient pattern, no threshold mark.
function CycleDial({ score }) {
  const cx = 120, cy = 120, R = 100;
  const v = score == null ? 0 : Math.max(0, Math.min(100, score));
  const angle = 180 - (v * 1.8);
  const rad = (angle * Math.PI) / 180;
  const tipX = cx + R * Math.cos(rad);
  const tipY = cy - R * Math.sin(rad);
  return (
    <svg className="mo-dial" viewBox="0 0 240 140" style={{ maxWidth: 260 }}>
      <path d="M 20 122 A 100 100 0 0 1 55 49"  fill="rgba(0,113,227,0.18)" />
      <path d="M 55 49 A 100 100 0 0 1 120 22"  fill="rgba(0,113,227,0.42)" />
      <path d="M 120 22 A 100 100 0 0 1 185 49" fill="rgba(0,113,227,0.68)" />
      <path d="M 185 49 A 100 100 0 0 1 220 122" fill="rgba(0,113,227,0.92)" />
      <line x1={cx} y1={cy} x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx={tipX} cy={tipY} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.8" />
      <circle cx={cx} cy={cy} r="4.5" fill="var(--accent)" />
    </svg>
  );
}

function DrawerContent({ drawer, data }) {
  if (drawer.kind === 'week') {
    const i = drawer.payload;
    const wDate = data.anchors[0]?.weekly[i]?.date;
    const r = data.regimeHistory[i]?.label;
    return (
      <>
        <div className="v2-drawer-eyebrow">Weekly snapshot</div>
        <h2 className="v2-drawer-title">{fmtDate(wDate)} <em>{r}</em></h2>
        <div className="mo-drawer-section">
          <h4>Three vol anchors</h4>
          <table className="mo-drawer-table"><tbody>
            {data.anchors.map(a => (
              <tr key={a.id}><td>{a.title}</td><td className="num">{a.weekly[i] ? a.fmt(a.weekly[i].value) : '—'}</td><td className="num">{STAGE_NAMES[a.stages[i] || 0]}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="mo-drawer-section">
          <h4>Cycle composite (current)</h4>
          <p className="narrative">Cycle Position: <strong>{data.cycleScore} / 100</strong> · Average of seven stress-direction percentiles.</p>
        </div>
      </>
    );
  }
  if (drawer.kind === 'anchor') {
    const a = data.anchors.find(x => x.id === drawer.payload);
    if (!a) return null;
    return (
      <>
        <div className="v2-drawer-eyebrow">Anchor detail</div>
        <h2 className="v2-drawer-title">{a.title}</h2>
        <div className="mo-drawer-section">
          <p className="narrative">
            Current <strong>{a.niceName} = {a.current != null ? a.fmt(a.current) : '—'}</strong>.
            Trailing-5y 85th-percentile threshold = <strong>{a.threshold != null ? a.fmt(a.threshold) : '—'}</strong>.
            Stage: <strong>{a.stageName}</strong>.
          </p>
        </div>
        <div className="mo-drawer-stub">Indicator-detail chart (full history with threshold line, stage transitions, etc.) is the next build pass.</div>
      </>
    );
  }
  if (drawer.kind === 'cycle_ind') {
    const ind = data.cycleInd.find(x => x.id === drawer.payload);
    if (!ind) return null;
    return (
      <>
        <div className="v2-drawer-eyebrow">Cycle indicator</div>
        <h2 className="v2-drawer-title">{ind.name}</h2>
        <div className="mo-drawer-section">
          <p className="narrative">
            Current reading: <strong>{ind.valueText}</strong>.
            Percentile rank vs full history: <strong>{ind.stressPctile != null ? ind.stressPctile + '%' : '—'}</strong>.
            {ind.bearishHigh ? ' (High value is the bearish direction for the cycle.)' : ' (Low value is the bearish direction for the cycle.)'}
          </p>
        </div>
        <div className="mo-drawer-stub">Indicator-detail chart is the next build pass.</div>
      </>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
//   CSS
// ─────────────────────────────────────────────────────────────────────

const MO_CSS = `
.mo-page{max-width:1280px;margin:0 auto;padding:28px 32px 64px}
.mo-top{display:grid;grid-template-columns:1fr 480px;gap:32px;margin-bottom:22px;align-items:start}
.mo-eyebrow{font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-2);font-weight:500;margin-bottom:8px}
.mo-h1{font-family:var(--font-display);font-weight:400;font-size:34px;line-height:1.12;letter-spacing:-0.012em;margin:0 0 14px;color:var(--ink-0);max-width:620px}
.mo-h1 em{font-style:italic;color:var(--accent)}
.mo-lede{font-size:14px;color:var(--ink-1);line-height:1.6;margin:0;max-width:620px}
.mo-lede strong{color:var(--ink-0);font-weight:600}

.mo-regime{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:22px 24px 18px}
.mo-regime-title{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:24px;color:var(--accent);text-align:center;margin:0 0 18px;letter-spacing:-0.005em}
.mo-rrow{display:grid;grid-template-columns:108px 1fr;gap:14px;padding:7px 0;align-items:center;font-size:12.5px;line-height:1.4}
.mo-rpill{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:13px;text-align:center;padding:5px 0;border-radius:14px;background:var(--surface-2);color:var(--ink-2);border:1px solid var(--border-faint);letter-spacing:-0.005em}
.mo-rrow.current .mo-rpill{background:var(--accent-soft);color:var(--accent);border:1.5px solid var(--accent);font-weight:500}
.mo-rdesc{color:var(--ink-1);font-size:12.5px}
.mo-rrow.current .mo-rdesc{color:var(--ink-0);font-weight:500}
.mo-rhist-wrap{margin-top:18px;padding-top:14px;border-top:1px solid var(--border-faint)}
.mo-rhist-axis{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9px;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3);font-weight:500;margin-bottom:6px}
.mo-rhist-strip{display:flex;align-items:end;gap:2px;height:48px}
.mo-rhist-bar{flex:1;border-radius:2px 2px 0 0;cursor:pointer;min-height:5px;position:relative;transition:filter 80ms,transform 80ms}
.mo-rhist-bar:hover{filter:brightness(1.15);transform:scaleY(1.04)}
.mo-rhist-bar.s0{background:rgba(0,113,227,0.20)}
.mo-rhist-bar.s1{background:rgba(0,113,227,0.42)}
.mo-rhist-bar.s2{background:rgba(0,113,227,0.68)}
.mo-rhist-bar.s3{background:rgba(0,113,227,0.92)}
.mo-rhist-bar::after{content:attr(data-tt);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);padding:6px 10px;border-radius:4px;background:var(--ink-0);color:#fff;font-family:var(--font-mono);font-size:10.5px;font-weight:500;white-space:nowrap;pointer-events:none;opacity:0;z-index:8}
.mo-rhist-bar:hover::after{opacity:1}

.mo-vol-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px}
.mo-tile{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px 18px}
.mo-tile-title{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:22px;color:var(--accent);text-align:center;margin:0 0 8px;letter-spacing:-0.005em}
.mo-stage-row{display:flex;justify-content:center;margin-bottom:4px}
.mo-stage-pill{font-family:var(--font-mono);font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;padding:3px 10px;border-radius:11px;background:var(--surface-2);color:var(--ink-2);border:1px solid var(--border-faint);font-weight:600}
.mo-stage-pill.stage-0{color:var(--ink-2)}
.mo-stage-pill.stage-1{color:#c47a14;border-color:rgba(196,122,20,0.3);background:rgba(196,122,20,0.06)}
.mo-stage-pill.stage-2,.mo-stage-pill.stage-3,.mo-stage-pill.stage-4{color:var(--accent);border-color:rgba(0,113,227,0.3);background:var(--accent-soft)}

.mo-dial-wrap{display:flex;flex-direction:column;align-items:center;margin:8px 0 0;cursor:pointer}
.mo-dial{width:100%;max-width:230px;height:auto;display:block;transition:filter 80ms}
.mo-dial-wrap:hover .mo-dial{filter:brightness(1.04)}
.mo-readout{margin-top:-4px;display:flex;align-items:baseline}
.mo-val{font-family:var(--font-display);font-weight:400;font-size:42px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-0.015em;color:var(--ink-0)}
.mo-denom{font-family:var(--font-display);font-style:italic;font-size:16px;color:var(--ink-3);margin-left:4px}
.mo-mark-line{font-family:var(--font-mono);font-size:10px;letter-spacing:0.04em;color:var(--ink-3);margin-top:6px}

.mo-bar-wrap{margin-top:14px;padding-top:12px;border-top:1px solid var(--border-faint)}
.mo-bar-axis{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9px;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3);font-weight:500;margin-bottom:6px}
.mo-bar-strip{display:flex;align-items:end;gap:2px;height:48px;position:relative}
.mo-bar{flex:1;border-radius:2px 2px 0 0;cursor:pointer;min-height:5px;position:relative;transition:filter 80ms}
.mo-bar:hover{filter:brightness(1.15)}
.mo-bar.s0{background:rgba(0,113,227,0.20)}
.mo-bar.s1{background:rgba(0,113,227,0.42)}
.mo-bar.s2{background:rgba(0,113,227,0.68)}
.mo-bar.s3{background:rgba(0,113,227,0.92)}
.mo-bar.s4{background:rgba(0,113,227,0.92)}
.mo-bar::after{content:attr(data-tt);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);padding:6px 10px;border-radius:4px;background:var(--ink-0);color:#fff;font-family:var(--font-mono);font-size:10.5px;font-weight:500;white-space:nowrap;pointer-events:none;opacity:0;z-index:8}
.mo-bar:hover::after{opacity:1}

.mo-cycle{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px 28px}
.mo-cycle-title{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:24px;color:var(--accent);text-align:left;margin:0 0 18px;letter-spacing:-0.005em}
.mo-cycle-body{display:grid;grid-template-columns:300px 1fr;gap:34px;align-items:center}
.mo-cycle-left{display:flex;flex-direction:column;align-items:center}

.mo-sub-eyebrow{font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-2);font-weight:500;margin-bottom:12px}
.mo-ind-list{display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.mo-ind-header{display:grid;grid-template-columns:230px 1fr 90px 110px;gap:18px;padding:4px 6px;color:var(--ink-3);font-size:9.5px;letter-spacing:0.12em;text-transform:uppercase;font-weight:500;border-bottom:1px solid var(--border-faint);margin-bottom:4px;white-space:nowrap}
.mo-ind-header span:nth-child(3),.mo-ind-header span:nth-child(4){text-align:right}
.mo-ind-row{display:grid;grid-template-columns:230px 1fr 90px 110px;gap:18px;align-items:center;padding:6px;border-radius:5px;cursor:pointer;transition:background 80ms}
.mo-ind-row:hover{background:var(--surface-2)}
.mo-ind-name{color:var(--ink-1);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mo-ind-reading{font-family:var(--font-mono);font-size:12px;color:var(--ink-0);font-weight:500;text-align:right;font-variant-numeric:tabular-nums}
.mo-ind-pctile{font-family:var(--font-mono);font-size:13px;color:var(--ink-0);font-weight:600;text-align:right;font-variant-numeric:tabular-nums}
.mo-ind-barwrap{display:block;height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden;position:relative}
.mo-ind-bar{display:block;height:100%}
.mo-ind-bar.low{background:rgba(0,113,227,0.30)}
.mo-ind-bar.med{background:rgba(0,113,227,0.55)}
.mo-ind-bar.high{background:rgba(0,113,227,0.85)}
.mo-ind-avg{display:grid;grid-template-columns:230px 1fr 90px 110px;gap:18px;padding:10px 6px 2px;align-items:center;border-top:1px solid var(--border-faint);margin-top:6px}
.mo-ind-avg-label{font-family:var(--font-display);font-style:italic;font-size:12.5px;color:var(--ink-2);text-align:right}
.mo-ind-avg-val{font-family:var(--font-display);font-weight:400;font-size:18px;color:var(--accent);letter-spacing:-0.005em;text-align:right}

.mo-drawer-section{margin-bottom:22px}
.mo-drawer-section h4{font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-2);font-weight:600;margin:0 0 10px}
.mo-drawer-table{width:100%;border-collapse:collapse;font-size:13px}
.mo-drawer-table td{padding:9px 0;border-bottom:1px solid var(--border-faint);color:var(--ink-1)}
.mo-drawer-table td.num{font-family:var(--font-mono);text-align:right;color:var(--ink-0);font-weight:500}
.narrative{font-size:13px;color:var(--ink-1);line-height:1.6;background:var(--surface-2);border-radius:6px;padding:12px 14px;margin:0}
.narrative strong{color:var(--ink-0);font-weight:600}
.mo-drawer-stub{background:var(--surface-2);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;padding:14px 16px;color:var(--ink-1);font-size:13px;line-height:1.55;margin-top:14px}
`;
