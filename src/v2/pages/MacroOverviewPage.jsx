import React, { useEffect, useMemo, useState } from 'react';
import MTChart from '../components/MTChart';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import Drawer from '../components/Drawer';

/** Canonical mechanism → input map. Mirrors scripts/compute_v11_mechanisms.py PANELS. */
const PANELS = {
  valuation: {
    num: '01', name: 'Valuation',
    inputs: [
      { id: 'cape',    name: 'CAPE (Shiller)',           direction: 'high_is_concerning' },
      { id: 'erp',     name: 'Equity Risk Premium',      direction: 'low_is_concerning' },
      { id: 'buffett', name: 'Buffett Indicator',        direction: 'high_is_concerning' },
    ],
  },
  credit: {
    num: '02', name: 'Credit',
    inputs: [
      { id: 'ig_oas',      name: 'IG OAS',          direction: 'bidir_bottom' },
      { id: 'hy_oas',      name: 'HY OAS',          direction: 'bidir_bottom' },
      { id: 'hy_ig_ratio', name: 'HY / IG ratio',   direction: 'bidir_bottom' },
    ],
  },
  funding: {
    num: '03', name: 'Funding',
    inputs: [
      { id: 'cpff',          name: 'Commercial Paper risk premium', direction: 'high_is_concerning' },
      { id: 'stlfsi',        name: 'St. Louis Fed FSI',             direction: 'high_is_concerning' },
      { id: 'bank_reserves', name: 'Bank reserves at Fed',          direction: 'low_is_concerning' },
      { id: 'rrp',           name: 'Reverse repo balance',          direction: 'low_is_concerning' },
    ],
  },
  growth: {
    num: '04', name: 'Growth',
    inputs: [
      { id: 'cfnai_3ma', name: 'CFNAI 3-month',           direction: 'low_is_concerning' },
      { id: 'jobless',   name: 'Initial Claims (4-wk)',   direction: 'high_is_concerning' },
      { id: 'ism',       name: 'ISM Manufacturing PMI',   direction: 'low_is_concerning' },
      { id: 'bkx_spx',   name: 'BKX / SPX ratio',         direction: 'low_is_concerning' },
    ],
  },
  liquidity_policy: {
    num: '05', name: 'Liquidity & Policy',
    inputs: [
      { id: 'anfci',    name: 'Chicago Fed ANFCI',     direction: 'high_is_concerning' },
      { id: 'fed_bs',   name: 'Fed Balance Sheet YoY', direction: 'low_is_concerning' },
      { id: 'sloos_ci', name: 'SLOOS C&I lending',     direction: 'high_is_concerning' },
      { id: 'm2_yoy',   name: 'M2 Money Supply YoY',   direction: 'low_is_concerning' },
    ],
  },
  positioning_breadth: {
    num: '06', name: 'Positioning & Breadth',
    inputs: [
      { id: 'skew',       name: 'CBOE SKEW',                       direction: 'high_is_concerning' },
      { id: 'vix',        name: 'VIX',                             direction: 'high_is_concerning' },
      { id: 'eq_cr_corr', name: 'Equity-credit correlation (60d)', direction: 'high_is_concerning' },
      { id: 'move',       name: 'MOVE Index (Treasury vol)',       direction: 'high_is_concerning' },
    ],
  },
};

const QUARTILE_START = '2011-01-01';

function bandFromScore(score) {
  if (score == null) return { id: 'unknown', cls: 'placeholder', label: '—' };
  if (score < 25) return { id: 'r-on', cls: 'r-on', label: 'Risk On' };
  if (score < 50) return { id: 'r-neu', cls: 'r-neu', label: 'Neutral' };
  if (score < 75) return { id: 'r-cau', cls: 'r-cau', label: 'Cautionary' };
  return { id: 'r-off', cls: 'r-off', label: 'Risk Off' };
}

function directionCorrectedScore(pct, direction) {
  const d = (direction || 'high_is_concerning').toLowerCase();
  if (d === 'low_is_concerning' || d === 'bidir_bottom') return 100 - pct;
  return pct;
}

function percentileRank(value, samples) {
  if (samples.length === 0) return 50;
  let below = 0;
  for (let i = 0; i < samples.length; i++) if (samples[i] < value) below++;
  return (below / samples.length) * 100;
}

function vendorOnly(s) {
  if (!s) return '—';
  let v = String(s).split(/[(:]/)[0].trim();
  v = v.split(' / ')[0].trim();
  return v || s;
}

function cadenceFromHistory(history) {
  if (!history || history.length < 2) return '—';
  const a = history[history.length - 2][0];
  const b = history[history.length - 1][0];
  const da = new Date(a.length === 7 ? a + '-01' : a);
  const db = new Date(b.length === 7 ? b + '-01' : b);
  const gap = (db - da) / (1000 * 60 * 60 * 24);
  if (gap < 4) return 'Daily';
  if (gap < 10) return 'Weekly';
  if (gap < 45) return 'Monthly';
  return 'Quarterly';
}

function fmtVal(v, unit) {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  const av = Math.abs(v);
  if (av >= 1000) return v.toFixed(0);
  if (av >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtRelativeAge(iso) {
  if (!iso) return '—';
  const dt = new Date(iso); const now = Date.now();
  const days = Math.floor((now - dt.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function sparkPath(history, w = 54, h = 18) {
  const last = (history || []).slice(-12);
  if (last.length < 2) return '';
  const vs = last.map((p) => p[1]);
  const min = Math.min(...vs); const max = Math.max(...vs);
  return last.map((p, i) => {
    const x = (i / (last.length - 1)) * w;
    const y = h - ((p[1] - min) / ((max - min) || 1)) * h;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
}

function pctBandClass(pct, direction) {
  if (pct == null) return 'r-neu';
  const dcs = directionCorrectedScore(pct, direction);
  if (dcs >= 85) return 'r-off';
  if (dcs >= 75) return 'r-cau';
  if (dcs <= 25) return 'r-on';
  return 'r-neu';
}

/** Compute composite history series for a mechanism — 0-100 score per date.
 * Uses direction-corrected percentile of the value at each date vs the full sample.
 * Only includes dates where ALL mechanism indicators have a value (after Q-START).
 */
function computeCompositeHistory(panel, indicatorHistory) {
  const inds = (panel.inputs || []).map((inp) => {
    const ih = indicatorHistory?.[inp.id];
    if (!ih?.points) return null;
    const filtered = ih.points.filter(([d, v]) => v != null && d >= QUARTILE_START);
    if (filtered.length < 30) return null;
    const sortedSample = [...filtered.map((p) => p[1])].sort((a, b) => a - b);
    return { id: inp.id, direction: inp.direction, points: filtered, sample: sortedSample };
  }).filter(Boolean);
  if (inds.length === 0) return [];

  // sample = 1 point per month from the union of dates (use the date set with most points)
  const allDates = new Set();
  inds.forEach((ind) => ind.points.forEach(([d]) => allDates.add(d)));
  const dates = Array.from(allDates).sort();
  // downsample to monthly
  const monthly = [];
  let lastMonth = null;
  for (const d of dates) {
    const m = d.slice(0, 7);
    if (m !== lastMonth) { monthly.push(d); lastMonth = m; }
  }

  const out = [];
  for (const date of monthly) {
    const scores = [];
    for (const ind of inds) {
      // find latest point on or before date
      let latest = null;
      for (const [d, v] of ind.points) {
        if (d <= date) latest = v; else break;
      }
      if (latest == null) continue;
      const pct = percentileRank(latest, ind.sample);
      scores.push(directionCorrectedScore(pct, ind.direction));
    }
    if (scores.length >= Math.max(2, Math.floor(inds.length * 0.6))) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      out.push([date, +avg.toFixed(1)]);
    }
  }
  return out;
}

function useMacroData() {
  const [snap, setSnap] = useState(null);
  const [calib, setCalib] = useState(null);
  const [v10, setV10] = useState(null);
  const [history, setHistory] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([
      fetch('/cycle_board_snapshot.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/methodology_calibration_v11.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/v10_allocation.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/indicator_history.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
    ]).then(([s, c, v, h]) => { setSnap(s); setCalib(c); setV10(v); setHistory(h); }).catch((e) => setErr(e?.message));
  }, []);
  return { snap, calib, v10, history, err };
}

function deriveMechanisms(snap, calib, v10, history) {
  const ORDER = ['valuation', 'credit', 'funding', 'growth', 'liquidity_policy', 'positioning_breadth'];
  const snapMechs = {};
  (snap?.mechanisms || []).forEach((m) => { snapMechs[m.id] = m; });
  const calibTiles = {};
  (calib?.tiles || []).forEach((t) => { calibTiles[t.id] = t; });

  return ORDER.map((id) => {
    const panel = PANELS[id];
    const sm = snapMechs[id];
    const ct = calibTiles[id];
    // Score: v10 (latest), then snapshot, then calibration headline
    const score = v10?.mechanism_scores?.[id] ?? sm?.score ?? null;
    const band = bandFromScore(score);
    const v10Band = v10?.mechanism_bands?.[id]; // 'risk-off'/'caution'/'neutral'/'risk-on' string

    // Build indicators list: prefer calibration JSON (rich Sprint 1 detail),
    // fall back to PANELS+indicator_history (Sprint 2/4)
    let indicators = [];
    if (ct?.indicators?.length) {
      indicators = ct.indicators.map((i) => ({
        id: i.id,
        name: i.name || i.id,
        unit: i.unit || '',
        current: i.current || null,
        percentile: i.percentile != null ? Math.round(i.percentile) : null,
        quartile: i.quartile,
        direction: i.direction,
        soWhat: i.so_what || '',
        description: i.description || '',
        source: i.source || '',
        sampleWindow: i.sample_window || '',
        history: i.history || (history?.[i.id]?.points || []),
        kpis: i.kpis || [],
        episodes: i.episodes || [],
        comovement: i.comovement || [],
        compositeShare: i.composite_share_pct,
        release: i.release || null,
      }));
    } else if (panel?.inputs?.length) {
      indicators = panel.inputs.map((inp) => {
        const ih = history?.[inp.id];
        const points = ih?.points || [];
        const filtered = points.filter(([d, v]) => v != null && d >= QUARTILE_START);
        const lastPt = filtered.length ? filtered[filtered.length - 1] : null;
        const sample = filtered.map((p) => p[1]).sort((a, b) => a - b);
        const pct = lastPt ? Math.round(percentileRank(lastPt[1], sample)) : null;
        return {
          id: inp.id,
          name: inp.name,
          unit: ih?.unit || '',
          current: lastPt ? { value: lastPt[1], date: lastPt[0], unit: ih?.unit || '' } : null,
          percentile: pct,
          direction: inp.direction === 'low_is_concerning' ? 'low' : inp.direction === 'bidir_bottom' ? 'low' : 'high',
          rawDirection: inp.direction,
          soWhat: '',
          description: '',
          source: 'FRED',
          history: filtered,
        };
      });
    }

    const flagged = indicators.filter((i) => {
      if (i.percentile == null) return false;
      const dcs = directionCorrectedScore(i.percentile, i.rawDirection || (i.direction === 'low' ? 'low_is_concerning' : 'high_is_concerning'));
      return dcs >= 75;
    }).length;

    return {
      id, name: panel?.name || id, num: panel?.num || '',
      score, band,
      v10Band, // for tile color we prefer v10's actual band string
      bandClass: v10Band ? (v10Band === 'risk-off' ? 'r-off' : v10Band === 'caution' ? 'r-cau' : v10Band === 'neutral' ? 'r-neu' : v10Band === 'risk-on' ? 'r-on' : band.cls) : band.cls,
      bandLabel: v10Band ? (v10Band === 'risk-off' ? 'Risk Off' : v10Band === 'caution' ? 'Cautionary' : v10Band === 'neutral' ? 'Neutral' : v10Band === 'risk-on' ? 'Risk On' : band.label) : band.label,
      indicators,
      flagged,
      total: indicators.length,
      shortDesc: ct?.description_short || '',
      ruleText: typeof sm?.rule === 'string' ? sm.rule : (typeof ct?.rule === 'object' ? ct.rule.description : ''),
      compositeHistory: computeCompositeHistory(panel || { inputs: [] }, history),
    };
  });
}

function IndicatorDetail({ ind, mechName }) {
  const lastValue = ind.current?.value ?? (ind.history?.length ? ind.history[ind.history.length - 1][1] : null);
  const asOfDate = ind.current?.date || (ind.history?.length ? ind.history[ind.history.length - 1][0] : '—');
  const oneYearKpi = (ind.kpis || []).find((k) => k.label?.toLowerCase().includes('1-year'));
  const chgClass = oneYearKpi ? (oneYearKpi.value > 0 ? 'down' : oneYearKpi.value < 0 ? 'up' : '') : '';
  return (
    <>
      <div className="t-eyebrow accent">{mechName} · indicator</div>
      <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>{ind.name}</h3>
      {ind.description && <p className="t-body" style={{ maxWidth: '62ch' }}>{ind.description}</p>}
      <div className="v2-drawer-grid">
        <div className="v2-drawer-stat">
          <div className="lbl" title="Most recent value we have for this indicator.">Current reading</div>
          <div className="v">{fmtVal(lastValue, ind.unit)}{ind.unit ? <span style={{ fontSize: 14, color: 'var(--ink-2)', marginLeft: 3 }}>{ind.unit}</span> : null}</div>
          <div className="sub2">As of {asOfDate}</div>
        </div>
        <div className="v2-drawer-stat">
          <div className="lbl" title="Where the current reading sits in the indicator&apos;s 15y baseline distribution. 0 = lowest reading in 15y; 100 = highest.">Percentile vs 15y</div>
          <div className="v">{ind.percentile != null ? <>{ind.percentile}<span style={{ fontSize: 14, color: 'var(--ink-2)' }}>th</span></> : '—'}</div>
          <div className="sub2">{ind.percentile != null ? (ind.percentile >= 75 ? 'top quartile' : ind.percentile <= 25 ? 'bottom quartile' : 'mid-range') : ''}</div>
        </div>
        <div className="v2-drawer-stat">
          <div className="lbl" title="Change in the indicator&apos;s reading over the last year (when we have a 1-year KPI), otherwise the count of historical observations.">{oneYearKpi ? '1-year change' : 'Series'}</div>
          <div className={`v ${chgClass}`} style={oneYearKpi ? {} : { fontSize: 22 }}>
            {oneYearKpi ? `${oneYearKpi.value > 0 ? '+' : ''}${oneYearKpi.value.toFixed(2)}` : `${ind.history?.length || 0} pts`}
          </div>
          <div className="sub2">{oneYearKpi?.value_pct != null ? `${oneYearKpi.value_pct > 0 ? '+' : ''}${oneYearKpi.value_pct.toFixed(1)}%` : (ind.direction === 'low' || ind.rawDirection?.includes('low') ? 'Low flags' : 'High flags')}</div>
        </div>
      </div>
      {ind.history?.length >= 2 && (
        <MTChart
          data={ind.history}
          initialRange="5Y"
          timeframes={[{key:'1Y',label:'1Y'},{key:'3Y',label:'3Y'},{key:'5Y',label:'5Y'},{key:'10Y',label:'10Y'},{key:'MAX',label:'MAX'}]}
          tintBands={(() => {
            const cutHist = ind.history.slice(-260 * 5);
            if (cutHist.length < 4) return null;
            const vals = cutHist.map((p) => p[1]).filter((v) => v != null && !Number.isNaN(v));
            if (vals.length < 4) return null;
            const sorted = [...vals].sort((a, b) => a - b);
            const q = (frac) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * frac)))];
            return {
              p25: q(0.25),
              p50: q(0.50),
              p75: q(0.75),
              direction: ind.direction === 'low' || (typeof ind.direction === 'string' && ind.direction.startsWith('low')) ? 'low' : 'high',
            };
          })()}
        />
      )}
      {ind.soWhat && (
        <div className="v2-drawer-section">
          <span className="t-eyebrow">So what</span>
          <p className="t-body" style={{ marginTop: 0 }}>{ind.soWhat}</p>
        </div>
      )}
      {ind.episodes?.length > 0 && (
        <div className="v2-drawer-section">
          <span className="t-eyebrow" title="Historical episodes when this indicator was in its top quartile, and how SPX performed 6 and 12 months later.">When this indicator was in its top quartile · 6m / 12m SPX after</span>
          {ind.episodes.map((ep, i) => (
            <div className="v2-drawer-row" key={i}>
              <span className="lbl">{ep.period} ({ind.name} {ep.value})</span>
              <span className="val">{ep.spx_6m_pct >= 0 ? '+' : ''}{ep.spx_6m_pct?.toFixed(1)}% · {ep.spx_12m_pct >= 0 ? '+' : ''}{ep.spx_12m_pct?.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
      {ind.comovement?.length > 0 && (
        <div className="v2-drawer-section">
          <span className="t-eyebrow" title="Indicators that historically move in step with this one — useful to know what else this reading implies.">Moves in step with</span>
          {ind.comovement.map((cm, i) => (
            <div className="v2-drawer-row" key={i}>
              <span className="lbl">{cm.peer_name}</span>
              <span className="val">{cm.corr_5y != null ? cm.corr_5y.toFixed(2) : '—'} (5y)</span>
            </div>
          ))}
        </div>
      )}
      <div className="v2-drawer-section">
        <span className="t-eyebrow" title="The data vendor we license this series from, plus the freshness date of the latest reading.">Source · As of</span>
        <div className="v2-drawer-row"><span className="lbl" title="Original data vendor.">Vendor</span><span className="val">{vendorOnly(ind.source)}</span></div>
        <div className="v2-drawer-row"><span className="lbl" title="Date of the most recent reading we have on file for this indicator.">As of</span><span className="val">{ind.current?.date || (ind.history?.length ? ind.history[ind.history.length - 1][0] : '—')}</span></div>
        <div className="v2-drawer-row"><span className="lbl" title="How frequently the vendor publishes a new reading.">Cadence</span><span className="val">{ind.release?.frequency || cadenceFromHistory(ind.history)}</span></div>
        <div className="v2-drawer-row"><span className="lbl" title="The historical window we use to compute the percentile and tint-band cutoffs.">Baseline window</span><span className="val">{ind.sampleWindow || '5y trailing'}</span></div>
        {ind.compositeShare != null && (
          <div className="v2-drawer-row"><span className="lbl" title="How much this indicator weighs into the mechanism composite score.">Weight in {mechName} composite</span><span className="val">{ind.compositeShare.toFixed(1)}%</span></div>
        )}
      </div>
    </>
  );
}

function MechanismOverview({ mech, onPickIndicator }) {
  return (
    <>
      <div className="t-eyebrow accent">{mech.name} · cycle mechanism</div>
      <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>
        {mech.name} — {mech.bandLabel}
      </h3>
      {mech.shortDesc && <p className="t-body" style={{ maxWidth: '62ch' }}>{mech.shortDesc}</p>}

      <div className="v2-drawer-grid">
        <div className="v2-drawer-stat">
          <div className="lbl" title="Mechanism composite — average of the underlying indicators&apos; direction-corrected percentiles vs 5y baseline. 0 = supportive of risk; 100 = defensive.">Composite score</div>
          <div className={`v ${mech.bandClass === 'r-off' ? 'down' : mech.bandClass === 'r-cau' ? 'warn' : mech.bandClass === 'r-on' ? 'up' : ''}`}>
            {mech.score != null ? Math.round(mech.score) : '—'}{mech.score != null ? <span style={{ fontSize: 16, color: 'var(--ink-2)' }}> /100</span> : null}
          </div>
          <div className="sub2">{mech.bandLabel}</div>
        </div>
        <div className="v2-drawer-stat">
          <div className="lbl" title="Number of underlying indicators currently in their tail (top quartile for high-is-elevated, bottom quartile for low-is-elevated).">Inputs flagged</div>
          <div className="v">{mech.flagged}<span style={{ fontSize: 16, color: 'var(--ink-2)' }}> /{mech.total}</span></div>
          <div className="sub2" title="Whether any underlying indicators are currently in their tail.">{mech.flagged === 0 ? 'all benign' : 'in top quartile'}</div>
        </div>
        <div className="v2-drawer-stat">
          <div className="lbl" title="Number of monthly composite readings we have on file for this mechanism, going back to the start of the calibration window.">Months of history</div>
          <div className="v" style={{ fontSize: 22 }}>{mech.compositeHistory.length}</div>
          <div className="sub2">monthly composite series</div>
        </div>
      </div>

      {/* Composite mechanism history chart — derived from underlying indicator percentiles */}
      {mech.compositeHistory.length >= 12 && (
        <MTChart
          data={mech.compositeHistory}
          initialRange="5Y"
          timeframes={[{key:'1Y',label:'1Y'},{key:'3Y',label:'3Y'},{key:'5Y',label:'5Y'},{key:'10Y',label:'10Y'},{key:'MAX',label:'MAX'}]}
          yFormat={(v) => v.toFixed(0)}
          tipFormat={(v) => `${v.toFixed(1)} /100`}
          tintBands={{ p25: 25, p50: 50, p75: 75, direction: 'high' }}
        />
      )}

      {mech.ruleText && (
        <div className="v2-drawer-section">
          <span className="t-eyebrow">Rule</span>
          <p className="t-body" style={{ marginTop: 0 }}>{mech.ruleText}</p>
        </div>
      )}

      <div className="v2-drawer-section">
        <span className="t-eyebrow">Underlying indicators · click any to drill in</span>
        <div className="v2-ind-list">
          {mech.indicators.length === 0 && (
            <p style={{ color: 'var(--ink-2)', fontSize: 13, padding: '14px 0' }}>Indicators not yet wired for this mechanism.</p>
          )}
          {mech.indicators.map((ind) => {
            const band = pctBandClass(ind.percentile, ind.rawDirection || (ind.direction === 'low' ? 'low_is_concerning' : 'high_is_concerning'));
            return (
              <div key={ind.id} className={`v2-ind-row ${band}`} onClick={() => onPickIndicator(ind.id)}>
                <span className="dot" />
                <span className="name">{ind.name}</span>
                <span className="val">{fmtVal(ind.current?.value, ind.unit)}<span className="unit">{ind.unit}</span></span>
                <span className="pct">{ind.percentile != null ? `${ind.percentile}th pct` : '—'}</span>
                <svg className="spark" viewBox="0 0 54 18" style={{ color: band === 'r-off' ? 'var(--down)' : band === 'r-cau' ? 'var(--warn)' : band === 'r-on' ? 'var(--up)' : 'var(--ink-2)' }}>
                  <path d={sparkPath(ind.history)} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="arr">→</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function MacroOverviewPage() {
  const { snap, calib, v10, history, err } = useMacroData();
  const [openMechId, setOpenMechId] = useState(null);
  const [openIndId, setOpenIndId] = useState(null);

  const mechanisms = useMemo(() => deriveMechanisms(snap, calib, v10, history), [snap, calib, v10, history]);
  const liveCount = mechanisms.filter((m) => m.score != null).length;
  const liveScores = mechanisms.filter((m) => m.score != null).map((m) => m.score);
  const flaggedTotal = mechanisms.filter((m) => m.bandClass === 'r-off' || m.bandClass === 'r-cau').length;
  const rawStance = v10?.page_stance || snap?.page_stance || calib?.headline_gauge?.verdict_label || 'Loading';
  // Theme #3: collapse any non-v2-lexicon variants to the canonical four
  const STANCE_MAP = {
    'Cautious': 'Cautionary',
    'Stressed': 'Risk Off',
    'Distressed': 'Risk Off',
    'Concerning': 'Cautionary',
    'Complacent': 'Cautionary',
    'Normal': 'Neutral',
  };
  const headlineState = STANCE_MAP[rawStance] || rawStance;
  const compositeAvg = liveScores.length
    ? Math.round(liveScores.reduce((a, b) => a + b, 0) / liveScores.length)
    : null;

  function open(mechId) { setOpenMechId(mechId); setOpenIndId(null); }
  function close() { setOpenMechId(null); setOpenIndId(null); }
  function back() { setOpenIndId(null); }

  const openMech = mechanisms.find((m) => m.id === openMechId);
  const openInd = openMech?.indicators.find((i) => i.id === openIndId);

  return (
    <div className="v2-root">
      <header className="v2-hero">
        <div className="arc" aria-hidden="true">
          <svg viewBox="0 0 600 600" preserveAspectRatio="xMaxYMid slice">
            <g transform="translate(420 300)">
              {[60,100,140,180,220,260,300,340].map((r) => <circle key={r} r={r} />)}
            </g>
          </svg>
        </div>
        <div className="v2-shell">
          <div className="v2-hero-row">
            <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>{headlineState}.</h1>
            <FreshnessChip elementId="cycle_board" fallback={snap?.as_of} />
          </div>
          <div className="v2-stats" style={{ marginTop: 28 }}>
            <div className={`s ${flaggedTotal > 0 ? 'warn' : ''}`}>
              <span className="lbl" title="Number of cycle mechanisms whose composite reading is currently in Cautionary or Risk Off territory.">Mechanisms flagged</span>
              <span className="v">{liveCount > 0 ? flaggedTotal : <span style={{ color: 'var(--ink-2)' }}>—</span>}<span style={{ fontSize: 18, color: 'var(--ink-2)' }}> /{liveCount > 0 ? liveCount : 6}</span></span>
              <span className="d">above Neutral</span>
            </div>
            <div className="s">
              <span className="lbl" title="Average composite score across all live cycle mechanisms. 0 = supportive of risk; 100 = defensive.">Composite</span>
              <span className="v">{compositeAvg != null ? compositeAvg : <span style={{ color: 'var(--ink-2)' }}>—</span>}<span style={{ fontSize: 18, color: 'var(--ink-2)' }}> /100</span></span>
              <span className="d">average across {liveCount}</span>
            </div>
            <div className="s">
              <span className="lbl" title="Total number of underlying indicators feeding the live cycle mechanisms.">Calibrated indicators</span>
              <span className="v">{mechanisms.reduce((sum, m) => sum + (m.indicators?.length || 0), 0)}</span>
              <span className="d">across {liveCount} mechanisms</span>
            </div>
            <div className="s">
              <span className="lbl" title="The cycle-counting framework: a six-mechanism descriptive board.">Framework</span>
              <span className="v" style={{ fontSize: 24 }}>v{(calib?.version || snap?.version || '11.0').replace(/^v/, '')}</span>
              <span className="d">cycle-mechanism counting</span>
            </div>
          </div>
        </div>
      </header>

      <div className="v2-shell">
        <div className="v2-mech-grid" style={{ marginTop: 32 }}>
          {mechanisms.map((m) => (
            <article key={m.id}
              className="v2-tile"
              onClick={() => open(m.id)}
              tabIndex={0}>
              <div className={`v2-mech-state-bar ${m.bandClass}`} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 14, color: 'var(--accent)' }}>{m.num}</span>
                <span className={`v2-pill ${m.bandClass}`}>{m.bandLabel}</span>
              </div>
              <h3 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>{m.name}</h3>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '18px 0 8px' }}>
                <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 48, lineHeight: 1, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"' }}>
                  {m.score != null ? <CountUp to={Math.round(m.score)} /> : <span style={{ color: 'var(--ink-2)' }}>—</span>}
                </span>
                <span style={{ color: 'var(--ink-2)', fontSize: 14 }}>/100</span>
              </div>
              <p style={{ color: 'var(--ink-2)', fontSize: 12, margin: 0 }}>
                {m.flagged} of {m.total} inputs flagged
              </p>
              <div style={{ marginTop: 'auto', paddingTop: 14, fontSize: 11, color: 'var(--accent)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 500 }}>
                Open mechanism →
              </div>
            </article>
          ))}
        </div>

        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {(() => {
            const vendors = new Set();
            mechanisms.forEach((m) => m.indicators.forEach((i) => { if (i.source) vendors.add(vendorOnly(i.source)); }));
            const asOf = snap?.as_of || calib?.as_of || null;
            const vList = Array.from(vendors).join(' · ');
            return (vList || 'FRED · CBOE · ICE BofA · Shiller · Kim-Wright Fed · ISM · BLS') + (asOf ? ' · As of ' + asOf : '');
          })()}
          {' · '}v{(calib?.version || '11.0').replace(/^v/, '')}
        </div>
      </div>

      <Drawer open={openMechId != null} onClose={close}
        onBack={openIndId ? back : null} backLabel={openMech?.name || 'mechanism'}>
        {openMechId && openMech && (
          openIndId && openInd
            ? <IndicatorDetail ind={openInd} mechName={openMech.name} />
            : <MechanismOverview mech={openMech} onPickIndicator={(indId) => setOpenIndId(indId)} />
        )}
      </Drawer>
      {err && (
        <div style={{ position: 'fixed', bottom: 16, left: 16, padding: '10px 16px', background: 'var(--bg-1)', border: '1px solid var(--down)', borderRadius: 8, color: 'var(--down)', fontSize: 12 }}>
          Macro Overview: failed to load live data ({err}).
        </div>
      )}
    </div>
  );
}
