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


// ─── <Dial> — semicircle gauge ported from MacroTilt_Macro_Overview_Page_v11.html ──
// 4 wedges (teal gradient, Risk-on → Risk-off) + pointer line + dot. Single
// source of visual truth across the composite hero dial and every card.
// score: 0..100 (or null). isLive: false renders a grey placeholder wedge set.
function Dial({ score, isLive = true, size = 'card' }) {
  const W = size === 'hero' ? 380 : 220;
  const H = size === 'hero' ? 230 : 140;
  const cx = W / 2;
  const cy = H - (size === 'hero' ? 50 : 12);
  const R_outer = size === 'hero' ? 140 : 92;
  const R_inner = size === 'hero' ? 90 : 64;
  const FILLS = [
    'rgba(14,85,96,0.18)',
    'rgba(14,85,96,0.42)',
    'rgba(14,85,96,0.68)',
    'rgba(14,85,96,0.92)',
  ];
  const wedges = [
    { from: 0,   to: 25  },
    { from: 25,  to: 50  },
    { from: 50,  to: 75  },
    { from: 75,  to: 100 },
  ];
  const scoreToDeg = (s) => 180 - Math.max(0, Math.min(100, s)) * 1.8;
  const polar = (r, deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };
  const paths = wedges.map((w, i) => {
    const a0 = scoreToDeg(w.from), a1 = scoreToDeg(w.to);
    const [x0o, y0o] = polar(R_outer, a0);
    const [x1o, y1o] = polar(R_outer, a1);
    const [x1i, y1i] = polar(R_inner, a1);
    const [x0i, y0i] = polar(R_inner, a0);
    const d = `M ${x0o.toFixed(2)} ${y0o.toFixed(2)} A ${R_outer} ${R_outer} 0 0 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)} L ${x1i.toFixed(2)} ${y1i.toFixed(2)} A ${R_inner} ${R_inner} 0 0 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)} Z`;
    return <path key={i} d={d} fill={FILLS[i]} fillOpacity={isLive ? 1 : 0.35} />;
  });
  let pointer = null;
  if (isLive && score != null && Number.isFinite(score)) {
    const a = scoreToDeg(score);
    const [px, py] = polar(R_outer + 6, a);
    pointer = (
      <g>
        <line x1={cx} y1={cy} x2={px.toFixed(2)} y2={py.toFixed(2)} stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx={px.toFixed(2)} cy={py.toFixed(2)} r="4.0" fill="var(--accent)" stroke="var(--bg-0, #fff)" strokeWidth="1.6" />
        <circle cx={cx} cy={cy} r="4" fill="var(--accent)" />
      </g>
    );
  }
  const labelY = H - 8;
  // Labels only on the hero dial (room for 4 spread-out strings).
  // Card dials are too narrow at 220px to fit RISK-ON / NEUTRAL /
  // CAUTION / RISK-OFF without collision, so we omit them and rely on
  // the card's band-coloured pointer + score readout.
  const labelStyle = { fontFamily: 'Inter, sans-serif', fontSize: 9, fill: 'var(--ink-2)', letterSpacing: '0.14em', fontWeight: 600 };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
      {paths}
      {pointer}
      {size === 'hero' && (
        <>
          <text x={cx - R_outer + 8} y={labelY} textAnchor="start" {...labelStyle}>RISK-ON</text>
          <text x={cx - R_outer * 0.35} y={labelY} textAnchor="middle" {...labelStyle}>NEUTRAL</text>
          <text x={cx + R_outer * 0.35} y={labelY} textAnchor="middle" {...labelStyle}>CAUTION</text>
          <text x={cx + R_outer - 8} y={labelY} textAnchor="end" {...labelStyle}>RISK-OFF</text>
        </>
      )}
    </svg>
  );
}

// ─── Sub-composite metadata: prose captions by band + source/cadence ─────
// Captions hand-written to mirror the legacy Macro Overview's voice. The
// matching caption for the current band displays on the card.
const SUB_META = {
  Equities: {
    num: '01', name: 'Equities', headline: 'cycle_value', headlineLabel: 'Cycle & Value',
    captions: {
      'r-on':  'Valuations broadly cheap relative to long-run history — equity risk premium expanded, drawdown setup attractive.',
      'r-neu': 'Valuations sitting around the middle of their long-run distribution. Neither rich nor cheap.',
      'r-cau': 'Valuations elevated — CAPE, ERP, and Buffett are skewed into the upper half of long-run history. Risk-reward less favorable.',
      'r-off': 'At cycle peak — CAPE, ERP, and Buffett ratio all sit in the top quartile of long-run history. Caution advised.',
    },
    cadence: 'Monthly · CAPE/ERP refresh; Buffett quarterly',
  },
  Rates: {
    num: '02', name: 'Rates', headline: 'cycle_value', headlineLabel: 'Cycle & Value',
    captions: {
      'r-on':  'Curve steep and term premium positive — early-cycle rates posture, supportive setup.',
      'r-neu': 'Rates structure mid-cycle — neither inverted enough to flag risk-off nor steep enough to flag risk-on.',
      'r-cau': 'Rates structure flashing late-cycle signals — flat curve, elevated term premium, real yields restrictive.',
      'r-off': 'Late-cycle rates regime — inverted curve, high real rates, term premium working against risk assets.',
    },
    cadence: 'Daily · FRED · Kim–Wright Fed',
  },
  MoneyBanking: {
    num: '03', name: 'Money / Banking', headline: 'cycle_value', headlineLabel: 'Cycle & Value',
    captions: {
      'r-on':  'Money supply expanding, bank reserves ample, credit growth healthy — reflationary setup.',
      'r-neu': 'Bank-system liquidity sitting around average. Neither stretched nor flooding.',
      'r-cau': 'Money supply growth and bank credit are in restrictive territory — late-cycle tightening signature.',
      'r-off': 'Bank-system liquidity drained — reserves low, M2 contracting, unrealized losses elevated. Risk-off setup.',
    },
    cadence: 'Weekly · FRED · Fed H.4.1',
  },
  Credit: {
    num: '04', name: 'Credit', headline: 'market_stress', headlineLabel: 'Market Stress',
    captions: {
      'r-on':  'Spreads sitting at extreme tights — investment-grade and high-yield have not been this compressed since before 2008. Late-cycle signature.',
      'r-neu': 'Credit spreads sitting around long-run averages. Neither pricing panic nor euphoria.',
      'r-cau': 'Spreads widening from prior tights — credit markets stepping back from peak risk appetite.',
      'r-off': 'Credit spreads in panic territory — high-yield OAS and IG/HY ratio both flashing dislocation.',
    },
    cadence: 'Daily · ICE BofA via FRED',
  },
  Funding: {
    num: '05', name: 'Funding', headline: 'market_stress', headlineLabel: 'Market Stress',
    captions: {
      'r-on':  'Bank-system funding spreads sit in the lower half of post-2018 history. Funding markets benign.',
      'r-neu': 'Funding spreads mid-range — TGA balance and reverse-repo neither flooding nor draining.',
      'r-cau': 'Funding indicators tightening — TGA build, RRP fading, CP spread widening. Liquidity at the margin getting expensive.',
      'r-off': 'Funding indicators elevated — STLFSI and ANFCI in the upper quartile, CP risk premium spiking. Money markets dislocated.',
    },
    cadence: 'Daily · NY Fed · DTCC · FRED',
  },
  PositioningVol: {
    num: '06', name: 'Positioning / Vol', headline: 'market_stress', headlineLabel: 'Market Stress',
    captions: {
      'r-on':  'Vol low, breadth strong, equity-credit correlation in trend mode. Positioning posture supportive.',
      'r-neu': 'Vol and positioning indicators sitting around long-run averages.',
      'r-cau': 'Vol creeping higher, breadth narrowing — positioning at the margin getting defensive.',
      'r-off': 'Vol elevated and breadth thin — VIX, MOVE, and SKEW all in the upper quartile. Positioning crowded one-way.',
    },
    cadence: 'Daily · CBOE · NAAIM',
  },
  RealEconomy: {
    num: '07', name: 'Real Economy', headline: 'real_economy', headlineLabel: 'Real Economy',
    captions: {
      'r-on':  'Real economy expanding — ISM in expansion, GDPNow positive, jobless claims low. Backdrop confirms risk-on.',
      'r-neu': 'Real economy reading mid-range — neither expanding decisively nor contracting.',
      'r-cau': 'Real economy softening — ISM near 50, jobless trending up, growth indicators weakening.',
      'r-off': 'Real economy contracting — ISM below 50, jobless rising, CFNAI negative. Hard data confirming risk-off.',
    },
    cadence: 'Monthly · ISM · BLS · Atlanta Fed',
  },
};

// Headline section metadata (3 v2 headlines, tagline + question)
const HEADLINE_META = {
  cycle_value:   { label: 'Cycle & Value',  tagline: 'The Setup',  question: 'Is the structural backdrop high-risk or low-risk?' },
  market_stress: { label: 'Market Stress',  tagline: 'The Panic',  question: 'Are the markets actually breaking right now?' },
  real_economy:  { label: 'Real Economy',   tagline: 'The Truth',  question: 'Is the real world confirming what the market is saying?' },
};

export default function MacroOverviewPage() {
  // v2 spec PR 3 — fetch cycle_v2.json for the new 3-headline panel.
  const [cycleV2, setCycleV2] = React.useState(null);
  const [v2Horizon, setV2Horizon] = React.useState("6m");
  React.useEffect(() => {
    fetch("/cycle_v2.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("cycle_v2.json HTTP " + r.status)))
      .then(setCycleV2)
      .catch((err) => { console.warn("[Macro Overview · v2 PR 3] cycle_v2.json fetch failed", err); });
  }, []);
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

      <div className="v2-shell">

        {/* HERO — single tight row: eyebrow + h1 + composite chip + horizon. */}
        {cycleV2 && cycleV2.subcomposites && (() => {
          const subOrder = ['Equities','Rates','MoneyBanking','Credit','Funding','PositioningVol','RealEconomy'];
          const scoresArr = subOrder.map(s => cycleV2.subcomposites[s]?.scores_by_horizon?.[v2Horizon]).filter(v => v != null);
          const compAvg = scoresArr.length ? Math.round(scoresArr.reduce((a,b)=>a+b,0) / scoresArr.length) : null;
          const compBand = bandFromScore(compAvg);
          return (
            <section style={{ marginTop: 12, padding: '12px 0 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 28, alignItems: 'start' }}>
              <div>
                <div className="t-eyebrow accent" style={{ marginBottom: 6, letterSpacing: '.10em' }}>Macro Overview · {snap?.as_of || calib?.as_of || ''}</div>
                <h1 className="t-display" style={{ margin: '0 0 10px', color: 'var(--ink-0)', fontSize: 'clamp(22px, 2.2vw, 28px)', lineHeight: 1.22 }}>
                  Where the cycle sits today, scored against history.
                </h1>
                <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.55, margin: 0, maxWidth: 640 }}>
                  Seven sub-composites scored 0&ndash;100, grouped into three headlines below. <strong>0&ndash;25</strong> Risk-on · <strong>25&ndash;50</strong> Neutral · <strong>50&ndash;75</strong> Cautionary · <strong>75&ndash;100</strong> Risk-off.
                </p>
                <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '.10em' }}>Horizon</span>
                  {['1m','3m','6m','12m'].map((h) => (
                    <button key={h} onClick={() => setV2Horizon(h)} style={{
                      fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 11, fontWeight: 600,
                      padding: '5px 12px',
                      background: v2Horizon === h ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))' : 'var(--surface)',
                      color: v2Horizon === h ? 'var(--accent)' : 'var(--ink-2)',
                      border: '1px solid var(--line-1)', borderRadius: 6, cursor: 'pointer', letterSpacing: '.04em',
                    }}>{h}</button>
                  ))}
                </div>
              </div>
              <div className="tile" style={{ padding: '20px 24px', cursor: 'default', minWidth: 280, alignSelf: 'start' }}>
                <div className="tile-eyebrow" style={{ textAlign: 'center', marginBottom: 6 }}>Composite</div>
                <div style={{ maxWidth: 260, margin: '0 auto' }}>
                  <Dial score={compAvg} size="hero" />
                </div>
                <div style={{ textAlign: 'center', marginTop: 4 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 44, lineHeight: 1, color: 'var(--ink-0)', letterSpacing: '-0.02em' }}>{compAvg ?? '—'}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '0.10em', textTransform: 'uppercase', marginLeft: 6 }}>/ 100</span>
                </div>
                <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--ink-2)', letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2 }}>composite average</div>
                <div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 22, color: 'var(--ink-0)', marginTop: 4 }}>{compBand.label} band</div>
              </div>
            </section>
          );
        })()}

        {/* SECTIONS — one per v2 headline, with sub-composite dial cards under each. */}
        {cycleV2 && cycleV2.subcomposites && Object.entries(HEADLINE_META).map(([hid, hMeta]) => {
          const subsInHeadline = Object.entries(SUB_META).filter(([_, m]) => m.headline === hid);
          if (!subsInHeadline.length) return null;
          const h = cycleV2.headlines && cycleV2.headlines[hid];
          const headlineScore = h && h.scores_by_horizon ? h.scores_by_horizon[v2Horizon] : null;
          const headlineBand = bandFromScore(headlineScore);
          return (
            <section key={hid} style={{ marginTop: 36, paddingTop: 22, borderTop: '1px solid var(--line-0)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div className="t-eyebrow accent" style={{ marginBottom: 4 }}>{hMeta.tagline} &middot; {v2Horizon}</div>
                  <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>{hMeta.label}</h2>
                  <p style={{ color: 'var(--ink-2)', fontSize: 12, margin: '4px 0 0' }}>{hMeta.question}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 36, lineHeight: 1, color: 'var(--ink-0)', letterSpacing: '-0.012em' }}>{headlineScore != null ? Math.round(headlineScore) : '—'}<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)', letterSpacing: '0.10em', marginLeft: 6 }}>/ 100</span></div>
                  <div style={{ fontSize: 11, color: 'var(--ink-2)', letterSpacing: '.08em', textTransform: 'uppercase' }}>{headlineBand.label}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                {subsInHeadline.map(([subId, meta]) => {
                  const s = cycleV2.subcomposites[subId];
                  if (!s) return null;
                  const score = s.scores_by_horizon?.[v2Horizon];
                  const band = bandFromScore(score);
                  const caption = score == null ? 'Not scored at this horizon — fewer than two indicators pass the predictive-power gate.' : (meta.captions[band.cls] || '');
                  const nScored = s.n_scored_by_horizon?.[v2Horizon] ?? 0;
                  const nTotal = s.n_indicators_total ?? 0;
                  return (
                    <article key={subId} className="tile" style={{ cursor: 'default', padding: '20px 18px', textAlign: 'left' }}>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', top: -4, left: 0, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '0.10em' }}>{meta.num}</span>
                      </div>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 22, lineHeight: 1.2, letterSpacing: '-0.006em', color: 'var(--ink-0)', margin: '4px 0 12px', textAlign: 'center' }}>{s.label}</h3>
                      <div style={{ maxWidth: 220, margin: '4px auto 8px' }}>
                        <Dial score={score ?? null} isLive={score != null} />
                      </div>
                      <div style={{ textAlign: 'center', marginTop: -8, marginBottom: 8 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 36, lineHeight: 1, color: 'var(--ink-0)', letterSpacing: '-0.02em' }}>
                          {score != null ? Math.round(score) : '—'}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: '0.10em', textTransform: 'uppercase', marginLeft: 4 }}>/ 100</span>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '6px 0 12px', minHeight: 60 }}>{caption}</p>
                      <div style={{ paddingTop: 12, borderTop: '0.5px dashed var(--line-1)', fontSize: 11, color: 'var(--ink-2)', letterSpacing: '.01em', fontFamily: 'var(--font-ui)', fontStyle: 'italic' }}>
                        Refreshes {meta.cadence} &middot; {nScored} of {nTotal} indicators scoring at this horizon
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* REGIME chip + recommended action — preserved from prior v2 panel */}
        {cycleV2 && cycleV2.regimes && cycleV2.regimes[v2Horizon] && (
          <div style={{ marginTop: 28, padding: '16px 20px', background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 14 }}>
              <div>
                <span className="t-eyebrow accent">Regime &middot; {v2Horizon}</span>
                <h4 style={{ margin: '4px 0 0', fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 24, fontWeight: 500, color: 'var(--ink-0)' }}>
                  {cycleV2.regimes[v2Horizon].label}
                </h4>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="t-eyebrow">Recommended action</span>
                <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--ink-0)', maxWidth: 460 }}>
                  {cycleV2.regimes[v2Horizon].recommended_action}
                </p>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-2)', fontStyle: 'italic' }}>
              {cycleV2.regimes[v2Horizon].real_economy_caption}
            </div>
          </div>
        )}

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
