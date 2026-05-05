import React, { useEffect, useMemo, useState } from 'react';
import MTChart from '../components/MTChart';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import Drawer from '../components/Drawer';

function scoreBand(score) {
  if (score == null) return { id: 'unknown', label: '—', cls: 'placeholder' };
  if (score < 25) return { id: 'r-on', label: 'Risk On', cls: 'r-on' };
  if (score < 50) return { id: 'r-neu', label: 'Neutral', cls: 'r-neu' };
  if (score < 75) return { id: 'r-cau', label: 'Cautionary', cls: 'r-cau' };
  return { id: 'r-off', label: 'Risk Off', cls: 'r-off' };
}

function pctBand(pct, direction) {
  if (pct == null) return 'r-neu';
  if (direction === 'low') {
    if (pct <= 15) return 'r-off';
    if (pct <= 25) return 'r-cau';
    if (pct >= 75) return 'r-on';
    return 'r-neu';
  }
  if (pct >= 85) return 'r-off';
  if (pct >= 75) return 'r-cau';
  if (pct <= 25) return 'r-on';
  return 'r-neu';
}

function sparkPath(history, w = 54, h = 18) {
  const last = (history || []).slice(-12);
  if (last.length < 2) return '';
  const vs = last.map((p) => Array.isArray(p) ? p[1] : p.value);
  const min = Math.min(...vs); const max = Math.max(...vs);
  return last.map((p, i) => {
    const v = Array.isArray(p) ? p[1] : p.value;
    const x = (i / (last.length - 1)) * w;
    const y = h - ((v - min) / ((max - min) || 1)) * h;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
}

function sparkClass(history) {
  const last = (history || []).slice(-3);
  if (last.length < 2) return 'flat';
  const a = Array.isArray(last[0]) ? last[0][1] : last[0].value;
  const b = Array.isArray(last[last.length - 1]) ? last[last.length - 1][1] : last[last.length - 1].value;
  if (b > a * 1.01) return 'up';
  if (b < a * 0.99) return 'down';
  return 'flat';
}

function fmtVal(v) {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  const av = Math.abs(v);
  if (av >= 1000) return v.toFixed(0);
  if (av >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function useMacroData() {
  const [snap, setSnap] = useState(null);
  const [calib, setCalib] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([
      fetch('/cycle_board_snapshot.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
      fetch('/methodology_calibration_v11.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null),
    ]).then(([s, c]) => { setSnap(s); setCalib(c); }).catch((e) => setErr(e?.message || 'fetch failed'));
  }, []);
  return { snap, calib, err };
}

function deriveMechanisms(snap, calib) {
  const ORDER = ['valuation', 'credit', 'funding', 'growth', 'liquidity_policy', 'positioning_breadth'];
  const NAMES = {
    valuation: 'Valuation', credit: 'Credit', funding: 'Funding',
    growth: 'Growth', liquidity_policy: 'Liquidity & Policy', positioning_breadth: 'Positioning & Breadth',
  };
  const calibTiles = {};
  (calib?.tiles || []).forEach((t) => { calibTiles[t.id] = t; });
  const snapMechs = {};
  (snap?.mechanisms || []).forEach((m) => { snapMechs[m.id] = m; });

  return ORDER.map((id) => {
    const c = calibTiles[id]; const s = snapMechs[id];
    const live = (c?.live === true) || !!(s?.state && s?.indicators?.length);
    const cycleScore = s?.score != null ? s.score : null;
    let indicators = [];
    if (c?.indicators?.length) {
      indicators = c.indicators.map((i) => ({
        id: i.id, name: i.name || i.id, unit: i.unit || '',
        current: i.current || null,
        percentile: i.percentile != null ? Math.round(i.percentile) : null,
        quartile: i.quartile, direction: i.direction,
        soWhat: i.so_what || '', description: i.description || '',
        source: i.source || '', sampleWindow: i.sample_window || '',
        history: i.history || [], kpis: i.kpis || [],
        episodes: i.episodes || [], comovement: i.comovement || [],
        compositeShare: i.composite_share_pct, release: i.release || null,
      }));
    } else if (s?.indicators?.length) {
      indicators = s.indicators.map((i) => ({
        id: i.id, name: i.label || i.id, unit: i.current?.unit || '',
        current: i.current, percentile: null, quartile: i.quartile,
        direction: i.direction === 'high_is_concerning' ? 'high' : i.direction === 'low_is_concerning' ? 'low' : null,
        soWhat: '', description: '', source: i.source || '', history: [],
      }));
    }
    const flagged = indicators.filter((i) => i.percentile != null
      ? (i.direction === 'low' ? i.percentile <= 25 : i.percentile >= 75)
      : false).length;
    return {
      id, name: NAMES[id], live, score: cycleScore,
      band: scoreBand(cycleScore), state: s?.state || null,
      ruleText: typeof s?.rule === 'string' ? s.rule : (typeof c?.rule === 'object' ? c.rule.description : ''),
      indicators, flagged, total: indicators.length,
      shortDesc: c?.description_short || '',
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
      <p className="t-body" style={{ maxWidth: '62ch' }}>{ind.description || '—'}</p>
      <div className="v2-drawer-grid">
        <div className="v2-drawer-stat">
          <div className="lbl">Current reading</div>
          <div className="v">{fmtVal(lastValue)}{ind.unit ? <span style={{ fontSize: 14, color: 'var(--ink-2)', marginLeft: 3 }}>{ind.unit}</span> : null}</div>
          <div className="sub2">As of {asOfDate}</div>
        </div>
        <div className="v2-drawer-stat">
          <div className="lbl">Percentile</div>
          <div className="v">{ind.percentile != null ? <>{ind.percentile}<span style={{ fontSize: 14, color: 'var(--ink-2)' }}>th</span></> : '—'}</div>
          <div className="sub2">{ind.percentile != null ? (ind.percentile >= 75 ? 'top quartile' : ind.percentile <= 25 ? 'bottom quartile' : 'mid-range') : ''}</div>
        </div>
        <div className="v2-drawer-stat">
          <div className="lbl">1-year change</div>
          <div className={`v ${chgClass}`}>{oneYearKpi ? `${oneYearKpi.value > 0 ? '+' : ''}${oneYearKpi.value.toFixed(2)}` : '—'}</div>
          <div className="sub2">{oneYearKpi?.value_pct != null ? `${oneYearKpi.value_pct > 0 ? '+' : ''}${oneYearKpi.value_pct.toFixed(1)}%` : ''}</div>
        </div>
      </div>
      {ind.history?.length >= 2 ? (
        <MTChart data={ind.history} initialRange="5Y"
          timeframes={[{key:'1Y',label:'1Y'},{key:'3Y',label:'3Y'},{key:'5Y',label:'5Y'},{key:'10Y',label:'10Y'},{key:'MAX',label:'MAX'}]} />
      ) : (
        <div className="v2-chart" style={{ textAlign: 'center', padding: 36, color: 'var(--ink-2)' }}>
          History series not yet available for this indicator.
        </div>
      )}
      {ind.soWhat && (
        <div className="v2-drawer-section">
          <span className="t-eyebrow">So what</span>
          <p className="t-body" style={{ marginTop: 0 }}>{ind.soWhat}</p>
        </div>
      )}
      {ind.episodes?.length > 0 && (
        <div className="v2-drawer-section">
          <span className="t-eyebrow">Top-quartile episodes · 6m and 12m SPX returns</span>
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
          <span className="t-eyebrow">Comoves with</span>
          {ind.comovement.map((cm, i) => (
            <div className="v2-drawer-row" key={i}>
              <span className="lbl">{cm.peer_name}</span>
              <span className="val">{cm.corr_5y != null ? cm.corr_5y.toFixed(2) : '—'} (5y)</span>
            </div>
          ))}
        </div>
      )}
      <div className="v2-drawer-section">
        <span className="t-eyebrow">Source · cadence</span>
        <div className="v2-drawer-row"><span className="lbl">Source</span><span className="val">{ind.source || '—'}</span></div>
        <div className="v2-drawer-row"><span className="lbl">Cadence</span><span className="val">{ind.release?.frequency || '—'}</span></div>
        <div className="v2-drawer-row"><span className="lbl">Sample window</span><span className="val">{ind.sampleWindow || '—'}</span></div>
        {ind.compositeShare != null && (
          <div className="v2-drawer-row"><span className="lbl">Composite share</span><span className="val">{ind.compositeShare.toFixed(1)}% of {mechName}</span></div>
        )}
      </div>
    </>
  );
}

function MechanismOverview({ mech, onPickIndicator }) {
  const sb = mech.band;
  return (
    <>
      <div className="t-eyebrow accent">{mech.name} · cycle mechanism</div>
      <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>
        {mech.name}{mech.state ? ` — ${mech.state}` : ''}
      </h3>
      {mech.shortDesc && <p className="t-body" style={{ maxWidth: '62ch' }}>{mech.shortDesc}</p>}
      <div className="v2-drawer-grid">
        <div className="v2-drawer-stat">
          <div className="lbl">Composite score</div>
          <div className={`v ${sb.cls === 'r-off' ? 'down' : sb.cls === 'r-cau' ? 'warn' : sb.cls === 'r-on' ? 'up' : ''}`}>
            {mech.score != null ? Math.round(mech.score) : '—'}{mech.score != null ? <span style={{ fontSize: 16, color: 'var(--ink-2)' }}> /100</span> : null}
          </div>
          <div className="sub2">{sb.label}</div>
        </div>
        <div className="v2-drawer-stat">
          <div className="lbl">Inputs flagged</div>
          <div className="v">{mech.flagged}<span style={{ fontSize: 16, color: 'var(--ink-2)' }}> /{mech.total}</span></div>
          <div className="sub2">tail of cohort</div>
        </div>
        <div className="v2-drawer-stat">
          <div className="lbl">State</div>
          <div className="v" style={{ fontSize: 22 }}>{mech.state || '—'}</div>
          <div className="sub2">v11 framework</div>
        </div>
      </div>
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
            const band = pctBand(ind.percentile, ind.direction === 'low' ? 'low' : 'high');
            return (
              <div key={ind.id} className={`v2-ind-row ${band}`} onClick={() => onPickIndicator(ind.id)}>
                <span className="dot" />
                <span className="name">{ind.name}</span>
                <span className="val">{fmtVal(ind.current?.value)}<span className="unit">{ind.unit}</span></span>
                <span className="pct">{ind.percentile != null ? `${ind.percentile}th pct` : '—'}</span>
                <svg className={`spark ${sparkClass(ind.history)}`} viewBox="0 0 54 18">
                  <path d={sparkPath(ind.history)} />
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
  const { snap, calib, err } = useMacroData();
  const [openMechId, setOpenMechId] = useState(null);
  const [openIndId, setOpenIndId] = useState(null);
  const mechanisms = useMemo(() => deriveMechanisms(snap, calib), [snap, calib]);
  const liveCount = mechanisms.filter((m) => m.live).length;
  const flaggedTotal = mechanisms.filter((m) => m.live && m.flagged > 0).length;
  const headlineState = snap?.page_stance || calib?.headline_gauge?.verdict_label || 'Loading';
  const headlineSub = calib?.headline_gauge?.headline_sentence || null;
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
          {headlineSub && (
            <p className="t-body" style={{ marginTop: 14, maxWidth: '62ch' }}>{headlineSub}</p>
          )}
          <div className="v2-stats" style={{ marginTop: 28 }}>
            <div className={`s ${flaggedTotal > 0 ? 'warn' : ''}`}>
              <span className="lbl">Mechanisms flagged</span>
              <span className="v"><CountUp to={flaggedTotal} /><span style={{ fontSize: 18, color: 'var(--ink-2)' }}> /{liveCount}</span></span>
              <span className="d">live mechanisms above Neutral</span>
            </div>
            <div className="s">
              <span className="lbl">Calibrated indicators</span>
              <span className="v"><CountUp to={mechanisms.reduce((sum, m) => sum + (m.indicators?.length || 0), 0)} /></span>
              <span className="d">across {liveCount} live mechanisms</span>
            </div>
            <div className="s">
              <span className="lbl">Framework</span>
              <span className="v" style={{ fontSize: 24 }}>v{(calib?.version || snap?.version || '11.0').replace(/^v/, '')}</span>
              <span className="d">cycle-mechanism counting</span>
            </div>
            <div className="s">
              <span className="lbl">Sprint</span>
              <span className="v" style={{ fontSize: 24 }}>{calib?.sprint || snap?.sprint || '—'}</span>
              <span className="d">{calib?.tiles?.filter((t) => t.live).length || 0} live, {(calib?.tiles?.length || 6) - (calib?.tiles?.filter((t) => t.live).length || 0)} calibrating</span>
            </div>
          </div>
        </div>
      </header>

      <div className="v2-shell">
        <div className="v2-mech-grid" style={{ marginTop: 32 }}>
          {mechanisms.map((m, idx) => (
            <article key={m.id}
              className={`v2-tile ${m.live ? '' : 'placeholder'}`}
              onClick={() => m.live && open(m.id)}
              tabIndex={m.live ? 0 : -1}>
              <div className={`v2-mech-state-bar ${m.band.cls === 'placeholder' ? 'placeholder' : m.band.cls}`} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <span style={{ fontFamily: 'Fraunces,serif', fontSize: 14, color: 'var(--accent)' }}>0{idx + 1}</span>
                <span className={`v2-pill ${m.band.cls}`}>{m.live ? m.band.label : 'Calibrating'}</span>
              </div>
              <h3 className="t-tile" style={{ margin: 0, color: m.live ? 'var(--ink-0)' : 'var(--ink-2)' }}>{m.name}</h3>
              {m.live ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '18px 0 8px' }}>
                    <span style={{ fontFamily: 'Fraunces,serif', fontSize: 48, fontVariationSettings: '"opsz" 96,"wght" 400', lineHeight: 1, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"' }}>
                      <CountUp to={m.score != null ? Math.round(m.score) : 0} />
                    </span>
                    <span style={{ color: 'var(--ink-2)', fontSize: 14 }}>/100</span>
                  </div>
                  <p style={{ color: 'var(--ink-2)', fontSize: 12, margin: 0 }}>
                    {m.flagged} of {m.total} inputs flagged
                  </p>
                  <div style={{ marginTop: 'auto', paddingTop: 14, fontSize: 11, color: 'var(--accent)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 500 }}>
                    Open mechanism →
                  </div>
                </>
              ) : (
                <div style={{ margin: 'auto 0', color: 'var(--ink-2)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  <span style={{ display: 'block', color: 'var(--accent)', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', marginBottom: 10 }}>Awaiting calibration</span>
                  Sprint {m.id === 'funding' ? '2' : '4'}
                </div>
              )}
            </article>
          ))}
        </div>
        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {(() => {
            const sources = new Set();
            mechanisms.forEach((m) => m.indicators.forEach((i) => { if (i.source) sources.add(i.source.split(' ')[0]); }));
            return Array.from(sources).join(' · ') || 'sources loading…';
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
