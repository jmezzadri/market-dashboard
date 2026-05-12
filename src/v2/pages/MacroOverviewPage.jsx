import React, { useEffect, useMemo, useState } from 'react';
import Drawer from '../components/Drawer';
import FreshnessChip from '../components/FreshnessChip';

/**
 * Signal Intelligence — Macro Overview replacement.
 *
 * Joe directive 2026-05-12: replace the 7 sub-composite tile grid with a
 * 4-state regime read (Risk On / Neutral / Cautionary / Risk Off) driven by
 * three vol triggers (VIX, MOVE, CPFF) modulated by the cycle composite.
 *
 * Page structure (v5 mockup locked):
 *   ├── Top strip: editorial header (left) + Regime tile (right)
 *   ├── Three vol tiles in a row (Equity / Bond / Funding)
 *   └── Wide Cycle Positioning tile with 7 sub-composite breakdown
 *
 * Rule book:
 *   - Vol trigger = indicator above its trailing-5y 85th-percentile mark
 *   - Stage: 0 calm, 1 crossed this week, 2 sustained 2-3w, 3 sustained 4w+
 *   - Late-cycle = cycle composite ≥ 80 (top 20% of trailing 5y)
 *   - Regime:
 *       0 triggers crossed              → Risk On
 *       1+ trigger crossed, none sustained → Neutral
 *       1+ trigger sustained (stage ≥ 2) → Cautionary
 *       sustained + late-cycle           → Risk Off
 *
 * Data sources (existing, no new pipelines):
 *   - /indicator_history.json — daily VIX/MOVE/CPFF history
 *   - /cycle_v2.json          — current cycle composite + 7 sub-composites
 */

// ───────── Constants ─────────
const TRIGGER_PCTILE = 85;
const LATE_CYCLE_THRESHOLD = 80;
const HORIZON = '6m';

// ───────── Pure helpers ─────────

function trailing5ySorted(points) {
  if (!points || points.length === 0) return [];
  const last = new Date(points[points.length - 1][0]);
  const cutoff = new Date(last);
  cutoff.setFullYear(last.getFullYear() - 5);
  const vals = points.filter(([d]) => new Date(d) >= cutoff).map(([, v]) => v).filter(v => v != null && !isNaN(v));
  return vals.sort((a, b) => a - b);
}

function valueAtPercentileSorted(sortedSamples, pct) {
  if (!sortedSamples || sortedSamples.length === 0) return null;
  const idx = Math.min(sortedSamples.length - 1, Math.floor((pct / 100) * sortedSamples.length));
  return sortedSamples[idx];
}

function pctileOfSorted(value, sortedSamples) {
  if (!sortedSamples || sortedSamples.length === 0 || value == null || isNaN(value)) return null;
  let lo = 0, hi = sortedSamples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedSamples[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / sortedSamples.length) * 100);
}

// Cycle Position is rolled up from these 7 raw indicators (matches the original
// Signal Intelligence handoff). Each indicator is read from indicator_history.json,
// percentile-ranked vs the trailing 5 years, then direction-corrected so HIGHER
// pctile = more late-cycle. Cycle Position score = average of the 7 corrected pcts.
const CYCLE_INDICATORS = [
  { id: 'copper_gold',  name: 'Copper / Gold',                         fmt: (v) => v.toFixed(3),                          invert: true  },
  { id: 'bkx_spx_v11',  name: 'KBW Bank / S&P',                        fmt: (v) => v.toFixed(4),                          invert: true  },
  { id: 'yield_curve',  name: 'Yield Curve (10y − 2y)',           fmt: (v) => (v >= 0 ? '+' : '') + Math.round(v) + ' bp', invert: true  },
  { id: 'anfci',        name: 'Chicago Fed Financial Conditions',      fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2),    invert: false },
  { id: 'ic4wsa',       name: 'Initial Jobless Claims (4-wk avg)',     fmt: (v) => Math.round(v) + 'K',                   invert: false },
  { id: 'hy_ig',        name: 'High-Yield credit spread',              fmt: (v) => Math.round(v) + ' bp',                 invert: false },
  { id: 'ig_oas',       name: 'Investment-Grade credit spread',        fmt: (v) => Math.round(v) + ' bp',                 invert: false },
];

// Take daily points → array of last N weekly closes
function weeklyAggregate(points, weeksBack = 24) {
  if (!points || points.length === 0) return [];
  const byWeek = {};
  for (const [dateStr, val] of points) {
    if (val == null || isNaN(val)) continue;
    const d = new Date(dateStr);
    const week = new Date(d);
    week.setDate(d.getDate() - d.getDay()); // Sunday key
    const key = week.toISOString().slice(0, 10);
    byWeek[key] = { date: dateStr, value: val };
  }
  const weeks = Object.keys(byWeek).sort();
  return weeks.slice(-weeksBack).map(w => byWeek[w]);
}

// Stage at each week (consecutive weeks above mark, ending at that week)
function weeklyStages(weekly, mark) {
  if (mark == null) return weekly.map(() => 0);
  let consec = 0;
  return weekly.map(w => {
    if (w.value >= mark) consec += 1; else consec = 0;
    if (consec === 0) return 0;
    if (consec === 1) return 1;
    if (consec <= 3) return 2;
    return 3;
  });
}

function regimeFor(vixSt, moveSt, cpffSt, cycleVal) {
  const stages = [vixSt, moveSt, cpffSt];
  const sustained = stages.filter(s => s >= 2).length;
  const crossed = stages.filter(s => s === 1).length;
  const latecycle = cycleVal != null && cycleVal >= LATE_CYCLE_THRESHOLD;
  if (sustained >= 1 && latecycle) return { label: 'Risk Off', key: 'risk-off', stage: 3 };
  if (sustained >= 1) return { label: 'Cautionary', key: 'cautionary', stage: 2 };
  if (crossed >= 1) return { label: 'Neutral', key: 'neutral', stage: 1 };
  return { label: 'Risk On', key: 'risk-on', stage: 0 };
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ───────── Component ─────────

export default function MacroOverviewPage() {
  const [indHist, setIndHist] = useState(null);
  const [cycleV2, setCycleV2] = useState(null);
  const [drawer, setDrawer] = useState({ open: false, kind: null, payload: null });

  const [cycleHist, setCycleHist] = useState(null);
  useEffect(() => {
    fetch('/indicator_history.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).then(setIndHist).catch(() => {});
    fetch('/cycle_v2.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).then(setCycleV2).catch(() => {});
    fetch('/cycle_v2_history.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).then(setCycleHist).catch(() => {});
  }, []);

  const data = useMemo(() => {
    if (!indHist || !cycleV2) return null;

    function buildIndicator(key, niceName, unit) {
      const raw = indHist[key];
      if (!raw || !raw.points || raw.points.length === 0) return null;
      const sortedSamples = trailing5ySorted(raw.points);
      const mark = valueAtPercentileSorted(sortedSamples, TRIGGER_PCTILE);
      const weekly = weeklyAggregate(raw.points, 24);
      const stages = weeklyStages(weekly, mark);
      const current = raw.points[raw.points.length - 1];
      const pctile = pctileOfSorted(current[1], sortedSamples);
      return {
        key, niceName, unit,
        currentValue: current[1],
        currentDate: current[0],
        asOf: raw.as_of,
        pctile, mark,
        weekly: weekly.map((w, i) => ({
          ...w,
          stage: stages[i],
          pctile: pctileOfSorted(w.value, sortedSamples),
        })),
        currentStage: stages[stages.length - 1] || 0,
      };
    }

    const vix = buildIndicator('vix', 'VIX', '');
    const move = buildIndicator('move', 'MOVE', '');
    const cpff = buildIndicator('cpff', 'CPFF', ' bp');

    const cycleAsOf = cycleV2.as_of;
    // Build the 7 Cycle Position indicators from indicator_history.json
    const cycleIndicators = CYCLE_INDICATORS.map(cfg => {
      const raw = indHist[cfg.id];
      if (!raw || !raw.points || !raw.points.length) {
        return { id: cfg.id, name: cfg.name, value: null, pctile: null, lateCyclePctile: null, valueText: '—' };
      }
      const sortedSamples = trailing5ySorted(raw.points);
      const current = raw.points[raw.points.length - 1];
      const rawPctile = pctileOfSorted(current[1], sortedSamples);
      const lateCyclePctile = rawPctile == null ? null : (cfg.invert ? (100 - rawPctile) : rawPctile);
      return {
        id: cfg.id,
        name: cfg.name,
        value: current[1],
        pctile: rawPctile,
        lateCyclePctile,
        valueText: current[1] != null && !isNaN(current[1]) ? cfg.fmt(current[1]) : '—',
      };
    });
    // Cycle Position score = average of the 7 direction-corrected percentiles
    const scoresAvail = cycleIndicators.map(i => i.lateCyclePctile).filter(p => p != null);
    const cycleScore = scoresAvail.length ? Math.round(scoresAvail.reduce((a, b) => a + b, 0) / scoresAvail.length) : null;

    const regime = regimeFor(
      vix?.currentStage || 0, move?.currentStage || 0, cpff?.currentStage || 0, cycleScore
    );

    // Regime history (per-week) — uses each week's stages, fixed current cycle as proxy
    const weeks = vix?.weekly?.length || 0;
    const regimeHistory = [];
    for (let i = 0; i < weeks; i++) {
      const r = regimeFor(
        vix?.weekly[i]?.stage || 0,
        move?.weekly[i]?.stage || 0,
        cpff?.weekly[i]?.stage || 0,
        cycleScore
      );
      regimeHistory.push({
        date: vix?.weekly[i]?.date,
        label: r.label,
        stage: r.stage,
      });
    }

    let cycleHistoryBars = [];
    if (cycleHist && cycleHist.series && cycleHist.series.headlines && cycleHist.series.headlines.cycle_value) {
      const arr = cycleHist.series.headlines.cycle_value;
      if (Array.isArray(arr) && arr.length > 0) {
        cycleHistoryBars = arr.slice(-24).map(([d, v]) => {
          const score = (v == null || isNaN(v)) ? null : Math.round(v);
          const stage = score == null ? 0 : score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : 3;
          return { date: d, score, stage };
        });
      }
    }
    return { vix, move, cpff, cycle: { score: cycleScore, asOf: cycleAsOf, indicators: cycleIndicators, historyBars: cycleHistoryBars }, regime, regimeHistory };
  }, [indHist, cycleV2, cycleHist]);

  if (!data) {
    return (
      <div className="v2-shell" style={{ padding: '60px 32px', textAlign: 'center', color: 'var(--ink-2)' }}>
        Loading macro data...
      </div>
    );
  }

  const { vix, move, cpff, cycle, regime, regimeHistory } = data;

  const openWeekSnapshot = (weekIdx) => {
    setDrawer({ open: true, kind: 'week', payload: weekIdx });
  };
  const openIndicatorDetail = (which) => {
    setDrawer({ open: true, kind: 'indicator', payload: which });
  };
  const openSubComposite = (name) => {
    setDrawer({ open: true, kind: 'sub', payload: name });
  };

  return (
    <>
      <style>{MO_CSS}</style>
      <div className="mo-page">

        {/* TOP STRIP */}
        <div className="mo-top">
          <div>
            <div className="mo-eyebrow">Macro Overview</div>
            <h1 className="mo-h1">Three volatility <em>triggers</em>, one <em>cycle position</em>, one regime read.</h1>
            <p className="mo-lede">
              Vol triggers tell us when trouble has arrived. The cycle composite tells us whether
              that trouble matters. Together they produce a single state: <strong>Risk On</strong>{' '}
              (stay invested), <strong>Neutral</strong> (probably noise), <strong>Cautionary</strong>{' '}
              (trim risk), or <strong>Risk Off</strong> (defensive). We describe the tape — we don't
              predict tops.
            </p>
          </div>

          {/* REGIME TILE */}
          <aside className="mo-regime">
            <h2 className="mo-regime-title">Regime</h2>
            {['Risk On', 'Neutral', 'Cautionary', 'Risk Off'].map(name => (
              <div key={name} className={`mo-rrow ${regime.label === name ? 'current' : ''}`}>
                <span className="mo-rpill">{name}</span>
                <span className="mo-rdesc">{regimeDescriptions[name]}</span>
              </div>
            ))}
            <div className="mo-bar-wrap" style={{ marginTop: 18 }}>
              <div className="mo-bar-frame">
                <div className="mo-y-label">Regime</div>
                <div className="mo-bar-strip">
                  {regimeHistory.map((w, i) => (
                    <span
                      key={i}
                      className={`mo-bar s${w.stage}`}
                      style={{ height: 18 + w.stage * 24 + '%' }}
                      data-tt={`${fmtDate(w.date)} · ${w.label}${i === regimeHistory.length - 1 ? ' · current' : ''}`}
                      onClick={() => openWeekSnapshot(i)}
                    />
                  ))}
                </div>
              </div>
              <div className="mo-bar-axis" style={{ paddingLeft: 26 }}><span>24 weeks ago</span><span>today</span></div>
            </div>
          </aside>
        </div>

        {/* THREE VOL TILES */}
        <div className="mo-vol-grid">
          <IndicatorTile data={vix} onDial={() => openIndicatorDetail('vix')} onBar={openWeekSnapshot} />
          <IndicatorTile data={move} onDial={() => openIndicatorDetail('move')} onBar={openWeekSnapshot} />
          <IndicatorTile data={cpff} onDial={() => openIndicatorDetail('cpff')} onBar={openWeekSnapshot} />
        </div>

        {/* WIDE CYCLE POSITIONING TILE */}
        <div className="mo-cycle">
          <h2 className="mo-cycle-title">Cycle Positioning</h2>
          <div className="mo-cycle-body">

            <div className="mo-cycle-left" onClick={() => openIndicatorDetail('cycle')}>
              <Dial value={cycle.score} mark={LATE_CYCLE_THRESHOLD} markLabel="top 20% mark" wide />
              <div className="mo-readout">
                <span className="mo-val">{cycle.score != null ? cycle.score : '—'}</span>
                <span className="mo-denom">/ 100</span>
              </div>
            </div>

            <div className="mo-cycle-right">
              <div className="mo-sub-eyebrow">Rolled up from seven indicators &middot; click any to drill in</div>
              <div className="mo-sub-list">
                {cycle.indicators.map(ind => {
                  const p = ind.lateCyclePctile;
                  return (
                    <div key={ind.id} className="mo-sub-row" onClick={() => openSubComposite(ind.name)}>
                      <span className="mo-sub-name">{ind.name}</span>
                      <span className="mo-sub-bar-wrap">
                        <span
                          className={`mo-sub-bar ${p == null ? 'low' : p >= 75 ? 'high' : p >= 50 ? 'med' : 'low'}`}
                          style={{ width: (p ?? 0) + '%' }}
                        />
                        <span className="mo-peak-mark" />
                      </span>
                      <span className="mo-sub-val">{ind.valueText}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {cycle.historyBars && cycle.historyBars.length > 0 && (
            <div className="mo-bar-wrap" style={{ marginTop: 18 }}>
              <div className="mo-bar-axis"><span>24 weeks ago</span><span>today</span></div>
              <div className="mo-bar-strip no-frame">
                {cycle.historyBars.map((w, i) => {
                  const heightPct = w.score == null ? 8 : Math.max(8, Math.min(95, w.score));
                  return (
                    <span
                      key={i}
                      className={`mo-bar s${w.stage}`}
                      style={{ height: heightPct + '%' }}
                      data-tt={`${fmtDate(w.date)} · ${w.score != null ? w.score : '—'}`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

      </div>

      <Drawer open={drawer.open} onClose={() => setDrawer({ open: false, kind: null, payload: null })}>
        {drawer.open && (
          <DrawerContent drawer={drawer} data={data} />
        )}
      </Drawer>
    </>
  );
}

// ───────── Sub-component: indicator tile ─────────

function IndicatorTile({ data, onDial, onBar }) {
  if (!data) return null;
  return (
    <div className="mo-tile">
      <h2 className="mo-tile-title">{tileLabel(data.key)}</h2>
      <div className="mo-dial-wrap" onClick={onDial}>
        <Dial
          value={data.pctile}
          mark={TRIGGER_PCTILE}
          markLabel={formatVal(data.mark, data.key)}
        />
        <div className="mo-readout">
          <span className="mo-val">{data.pctile != null ? data.pctile : '—'}</span>
          <span className="mo-denom">/ 100</span>
        </div>
      </div>
      <div className="mo-bar-wrap">
        <div className="mo-bar-axis"><span>24w</span><span>now</span></div>
        <div className="mo-bar-strip no-frame">
          {data.weekly.map((w, i) => {
            const heightPct = clamp(w.pctile != null ? w.pctile : 20, 8, 95);
            return (
              <span
                key={i}
                className={`mo-bar s${w.stage}`}
                style={{ height: heightPct + '%' }}
                data-tt={`${fmtDate(w.date)} · ${formatVal(w.value, data.key)}`}
                onClick={() => onBar(i)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function tileLabel(key) {
  return key === 'vix' ? 'Equity Volatility'
    : key === 'move' ? 'Bond Volatility'
    : 'Funding Stress';
}

function formatVal(v, key) {
  if (v == null) return '—';
  return key === 'cpff' ? `${Math.round(v)} bp` : v.toFixed(1);
}

function clamp(n, lo, hi) {
  if (n == null || isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// ───────── Sub-component: Dial gauge ─────────

function Dial({ value, mark, markLabel, markVal, wide = false }) {
  const W = wide ? 260 : 230;
  const H = wide ? 150 : 140;
  const cx = 120, cy = 120, R = 100;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const angle = 180 - (v * 1.8);
  const rad = (angle * Math.PI) / 180;
  const tipX = cx + R * Math.cos(rad);
  const tipY = cy - R * Math.sin(rad);

  // Trigger mark position (if mark is provided as a percentile, place at that angle)
  let markX = null, markY = null;
  if (mark != null) {
    const mAngle = 180 - (mark * 1.8);
    const mRad = (mAngle * Math.PI) / 180;
    markX = cx + R * Math.cos(mRad);
    markY = cy - R * Math.sin(mRad);
  }

  return (
    <svg className="mo-dial" viewBox={`0 0 240 ${H}`} style={wide ? { maxWidth: 280 } : null}>
      <path d="M 20 122 A 100 100 0 0 1 55 49" fill="rgba(0,113,227,0.18)" />
      <path d="M 55 49 A 100 100 0 0 1 120 22" fill="rgba(0,113,227,0.42)" />
      <path d="M 120 22 A 100 100 0 0 1 185 49" fill="rgba(0,113,227,0.68)" />
      <path d="M 185 49 A 100 100 0 0 1 220 122" fill="rgba(0,113,227,0.92)" />
      {markX != null && (
        <>
          <line x1={markX} y1={markY} x2={markX + 10 * Math.cos((180 - mark * 1.8) * Math.PI / 180)} y2={markY - 10 * Math.sin((180 - mark * 1.8) * Math.PI / 180)} stroke="#0e1115" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx={markX} cy={markY} r="3" fill="#0e1115" />
          <text x={markX + 14 * Math.cos((180 - mark * 1.8) * Math.PI / 180)} y={markY - 14 * Math.sin((180 - mark * 1.8) * Math.PI / 180)} fontFamily="JetBrains Mono" fontSize="9" fill="#0e1115" fontWeight="600" textAnchor={mark > 50 ? 'start' : 'end'}>
            {markLabel || ''}
          </text>
        </>
      )}
      <line x1={cx} y1={cy} x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx={tipX} cy={tipY} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.8" />
      <circle cx={cx} cy={cy} r="4.5" fill="var(--accent)" />
    </svg>
  );
}

// ───────── Sub-component: drawer content ─────────

function DrawerContent({ drawer, data }) {
  if (drawer.kind === 'week') {
    const i = drawer.payload;
    const vixW = data.vix?.weekly[i];
    const moveW = data.move?.weekly[i];
    const cpffW = data.cpff?.weekly[i];
    const r = data.regimeHistory[i];
    return (
      <>
        <div className="v2-drawer-eyebrow">Weekly snapshot</div>
        <h2 className="v2-drawer-title">{fmtDate(vixW?.date)} <em>{r?.label}</em></h2>
        <div className="mo-drawer-section">
          <table className="mo-drawer-table">
            <thead><tr><th>Indicator</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>State</th></tr></thead>
            <tbody>
              <tr><td>Equity Vol · VIX</td><td className="num">{formatVal(vixW?.value, 'vix')}</td><td className="num">{vixW?.stage === 0 ? 'Calm' : `Stage ${vixW?.stage}`}</td></tr>
              <tr><td>Bond Vol · MOVE</td><td className="num">{formatVal(moveW?.value, 'move')}</td><td className="num">{moveW?.stage === 0 ? 'Calm' : `Stage ${moveW?.stage}`}</td></tr>
              <tr><td>Funding · CPFF</td><td className="num">{formatVal(cpffW?.value, 'cpff')}</td><td className="num">{cpffW?.stage === 0 ? 'Calm' : `Stage ${cpffW?.stage}`}</td></tr>
              <tr><td>Cycle Position</td><td className="num">{data.cycle.score}</td><td className="num">{data.cycle.score >= 80 ? 'At peak' : 'Mid-cycle'}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="mo-drawer-section">
          <h4>Seven cycle sub-composites</h4>
          <table className="mo-drawer-table">
            <tbody>
              {data.cycle.subs.map(s => (
                <tr key={s.name}><td>{s.name}</td><td className="num">{s.score ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  if (drawer.kind === 'indicator') {
    return (
      <>
        <div className="v2-drawer-eyebrow">Indicator detail</div>
        <h2 className="v2-drawer-title"><em>{drawer.payload.toUpperCase()}</em></h2>
        <div className="mo-drawer-stub">
          Indicator detail view — extended chart, weeks-above-mark rollup, and methodology.
          Wiring after the v1 layout lands.
        </div>
      </>
    );
  }
  if (drawer.kind === 'sub') {
    return (
      <>
        <div className="v2-drawer-eyebrow">Sub-composite detail</div>
        <h2 className="v2-drawer-title"><em>{drawer.payload}</em></h2>
        <div className="mo-drawer-stub">
          Sub-composite drill-down — underlying indicators, percentile ranks, methodology.
          Wiring after the v1 layout lands.
        </div>
      </>
    );
  }
  return null;
}

// ───────── Regime descriptions ─────────

const regimeDescriptions = {
  'Risk On':     'No volatility triggers.',
  'Neutral':     'One volatility trigger crossed.',
  'Cautionary':  'One or more volatility triggers sustained.',
  'Risk Off':    'Sustained · late-cycle positioning.',
};

// ───────── Inline CSS (matches v5 mockup) ─────────

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
.mo-rdesc{color:var(--ink-1);font-size:12.5px;font-weight:400}
.mo-rrow.current .mo-rdesc{color:var(--ink-0);font-weight:500}

.mo-bar-wrap{margin-top:14px;padding-top:12px;border-top:1px solid var(--border-faint)}
.mo-bar-axis{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9px;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3);font-weight:500;margin-bottom:6px}
.mo-bar-frame{display:grid;grid-template-columns:18px 1fr;gap:8px;align-items:end}
.mo-y-label{writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--font-mono);font-size:8.5px;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3);font-weight:500;text-align:center;padding-bottom:14px;white-space:nowrap}
.mo-bar-strip{display:flex;align-items:end;gap:2px;height:48px;border-bottom:1px solid var(--border-faint);position:relative}
.mo-bar-strip.no-frame{border-bottom:none;height:54px}
.mo-bar{flex:1;border-radius:2px 2px 0 0;cursor:pointer;transition:filter 80ms,transform 80ms;min-height:5px;position:relative;outline:none}
.mo-bar:hover{filter:brightness(1.15);transform:scaleY(1.04) translateY(-1.5px)}
.mo-bar.s0{background:rgba(0,113,227,0.20)}
.mo-bar.s1{background:rgba(0,113,227,0.42)}
.mo-bar.s2{background:rgba(0,113,227,0.68)}
.mo-bar.s3{background:rgba(0,113,227,0.92)}
.mo-bar::after{content:attr(data-tt);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);padding:6px 10px;border-radius:4px;background:var(--ink-0);color:#fff;font-family:var(--font-mono);font-size:10.5px;font-weight:500;letter-spacing:0.02em;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0ms;z-index:8}
.mo-bar:hover::after{opacity:1}
.mo-bar::before{content:'';position:absolute;left:50%;bottom:calc(100% + 1px);transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--ink-0);pointer-events:none;opacity:0;z-index:8}
.mo-bar:hover::before{opacity:1}

.mo-vol-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px}
.mo-tile{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px 18px}
.mo-tile-title{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:22px;color:var(--accent);text-align:center;margin:0 0 4px;letter-spacing:-0.005em}
.mo-dial-wrap{display:flex;flex-direction:column;align-items:center;margin:8px 0 0;cursor:pointer}
.mo-dial{width:100%;max-width:230px;height:auto;display:block;transition:filter 80ms}
.mo-dial-wrap:hover .mo-dial{filter:brightness(1.04)}
.mo-readout{margin-top:-4px;display:flex;align-items:baseline;gap:5px}
.mo-val{font-family:var(--font-display);font-weight:400;font-size:42px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-0.015em;color:var(--ink-0)}
.mo-denom{font-family:var(--font-display);font-style:italic;font-size:16px;color:var(--ink-3)}

.mo-cycle{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px 28px}
.mo-cycle-title{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:24px;color:var(--accent);text-align:left;margin:0 0 18px;letter-spacing:-0.005em}
.mo-cycle-body{display:grid;grid-template-columns:300px 1fr;gap:34px;align-items:center}
.mo-cycle-left{display:flex;flex-direction:column;align-items:center;cursor:pointer}
.mo-cycle-right .mo-sub-eyebrow{font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-2);font-weight:500;margin-bottom:10px}
.mo-sub-list{display:flex;flex-direction:column;gap:7px}
.mo-sub-row{display:grid;grid-template-columns:130px 1fr 38px;gap:14px;align-items:center;font-size:12.5px;cursor:pointer;padding:4px 6px;margin:-4px -6px;border-radius:5px;transition:background 80ms}
.mo-sub-row:hover{background:var(--surface-2)}
.mo-sub-name{color:var(--ink-1);font-weight:500}
.mo-sub-bar-wrap{display:block;height:8px;background:var(--surface-2);border-radius:3px;overflow:hidden;position:relative}
.mo-sub-bar{display:block;height:100%}
.mo-sub-bar.low{background:rgba(0,113,227,0.32)}
.mo-sub-bar.med{background:rgba(0,113,227,0.55)}
.mo-sub-bar.high{background:rgba(0,113,227,0.85)}
.mo-sub-val{font-family:var(--font-mono);font-size:11.5px;color:var(--ink-0);font-weight:600;text-align:right}
.mo-peak-mark{position:absolute;top:-2px;bottom:-2px;width:1.5px;background:var(--ink-3);left:80%}

.mo-drawer-section{margin-bottom:22px}
.mo-drawer-section h4{font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-2);font-weight:600;margin:0 0 10px}
.mo-drawer-table{width:100%;border-collapse:collapse;font-size:13px}
.mo-drawer-table th{font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);font-weight:500;text-align:left;padding:8px 0;border-bottom:1px solid var(--border-faint)}
.mo-drawer-table td{padding:9px 0;border-bottom:1px solid var(--border-faint);color:var(--ink-1)}
.mo-drawer-table td.num{font-family:var(--font-mono);text-align:right;color:var(--ink-0);font-weight:500}
.mo-drawer-stub{background:var(--surface-2);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;padding:14px 16px;color:var(--ink-1);font-size:13px;line-height:1.55}
`;
