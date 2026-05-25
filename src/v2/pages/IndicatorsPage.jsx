import React, { useEffect, useMemo, useState } from 'react';
import MTChart from '../components/MTChart';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import Drawer from '../components/Drawer';
import { IND } from '../../data/indicatorRegistry';
import { InfoTip } from '../../InfoTip';

/**
 * IndicatorsPage v2 — sortable filterable table of every calibrated indicator.
 *
 * Live JSON: /indicator_history.json
 *   shape: { [id]: { freq, unit, points: [[date, value], ...], as_of, stats: {mean, sd, n, direction, ...} } }
 *
 * Metadata (name, family, narrative, description) sourced from src/data/indicatorRegistry.js (the IND const).
 *
 * Per row: name + family + reading + percentile (computed from points using stats.mean/sd) + sparkline + click → drawer.
 * Drawer: full chart with timeframes (1Y/3Y/5Y/10Y/MAX), so-what narrative, source line.
 */

function pctRank(value, points) {
  if (value == null || !points?.length) return null;
  const vs = points.map((p) => p[1]).filter((v) => typeof v === 'number');
  if (!vs.length) return null;
  const below = vs.filter((v) => v < value).length;
  return Math.round((below / vs.length) * 100);
}

function pctBand(pct, direction) {
  // direction: 'hw' = high warns; 'lw' = low warns; 'bw' = bidirectional
  if (pct == null) return 'r-neu';
  const isLow = direction === 'lw';
  if (direction === 'bw') {
    if (pct >= 85 || pct <= 15) return 'r-off';
    if (pct >= 75 || pct <= 25) return 'r-cau';
    return 'r-on';
  }
  if (isLow) {
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

function sparkPath(points, w = 80, h = 24) {
  const last = (points || []).slice(-12);
  if (last.length < 2) return '';
  const vs = last.map((p) => p[1]);
  const min = Math.min(...vs); const max = Math.max(...vs);
  return last.map((p, i) => {
    const x = (i / (last.length - 1)) * w;
    const y = h - ((p[1] - min) / ((max - min) || 1)) * h;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
}

function sparkClassFor(points) {
  const last = (points || []).slice(-3);
  if (last.length < 2) return 'flat';
  const a = last[0][1]; const b = last[last.length - 1][1];
  if (b > a * 1.01) return 'up';
  if (b < a * 0.99) return 'down';
  return 'flat';
}

const FAMILY_LABEL = {
  equity: 'Equity', credit: 'Credit', rates: 'Rates',
  fincond: 'Financial conditions', bank: 'Bank & Money', labor: 'Labor & Growth',
};

function formatVal(v, decimals) {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  if (decimals != null && decimals >= 0) return v.toFixed(decimals);
  return v.toFixed(2);
}

function relativeAge(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  const now = Date.now();
  const days = Math.floor((now - dt.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function IndicatorsPage() {
  const [hist, setHist] = useState(null);
  const [calib, setCalib] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    fetch('/indicator_history.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null).then(setHist).catch((e) => setErr(e?.message));
    fetch('/methodology_calibration_v11.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null).then(setCalib).catch(() => {});
    fetch('/data_manifest.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null).then(setManifest).catch(() => {});
  }, []);

  // Deep-link: read ?id=X out of the hash on mount + on hashchange.
  // Hash format: #indicators?id=vix
  useEffect(() => {
    function syncFromHash() {
      const m = (window.location.hash || '').match(/[?&]id=([\w_-]+)/);
      setOpenId(m ? m[1] : null);
    }
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  // Build mechanism + share lookup from calibration tiles
  const mechFor = useMemo(() => {
    const out = {};
    (calib?.tiles || []).forEach((t) => {
      (t.indicators || []).forEach((ind) => {
        out[ind.id] = { mech_id: t.id, mech_name: t.name, share: ind.composite_share_pct };
      });
    });
    return out;
  }, [calib]);

  // Build tier lookup from manifest (license_tier collapsed to a short label)
  const tierFor = useMemo(() => {
    const out = {};
    const els = manifest?.elements;
    if (!Array.isArray(els)) return out;
    els.forEach((e) => {
      if (e.category !== 'indicator' || !e.name) return;
      const lt = String(e.license_tier || '').toLowerCase();
      let tier = 'free';
      if (lt.startsWith('paid')) tier = 'paid';
      else if (lt === 'internal') tier = 'internal';
      else if (lt === 'tbd' || lt === 'unknown' || !lt) tier = 'tbd';
      out[e.name] = tier;
    });
    return out;
  }, [manifest]);

  // Indicator id → source vendor + endpoint, from the data manifest.
  // This is the terminal node of the Indicator → source vendor drill so a
  // reader opening any indicator can see exactly which vendor feeds it.
  // Bug #1165.
  const sourceFor = useMemo(() => {
    const out = {};
    const els = manifest?.elements;
    if (!Array.isArray(els)) return out;
    els.forEach((e) => {
      if (e.category !== 'indicator' || !e.name) return;
      out[e.name] = {
        vendor: (e.source_vendor || '').split(/[(]/)[0].trim() || null,
        endpoint: e.source_endpoint || null,
      };
    });
    return out;
  }, [manifest]);

  // Manifest-derived live source list (for footer)
  const manifestSources = useMemo(() => {
    const els = manifest?.elements;
    if (!Array.isArray(els)) return [];
    const out = new Set();
    els.forEach((e) => {
      if (e.category !== 'indicator') return;
      const v = (e.source_vendor || '').split(/[(:]/)[0].trim();
      if (v) out.add(v);
    });
    return Array.from(out).sort();
  }, [manifest]);

  // Build the row list from registry IND (ordered) ∩ history JSON
  const rows = useMemo(() => {
    if (!hist) return [];
    const out = [];
    Object.entries(IND).forEach(([id, meta]) => {
      const h = hist[id];
      if (!h) return; // skip indicators without history yet
      const last = h.points?.length ? h.points[h.points.length - 1] : null;
      const value = last?.[1];
      const pct = pctRank(value, h.points);
      const dir = h.stats?.direction || 'hw';
      const mech = mechFor[id];
      out.push({
        id,
        name: meta[0],
        family: meta[2],
        familyLabel: FAMILY_LABEL[meta[2]] || meta[2],
        unit: h.unit || meta[4] || '',
        decimals: meta[5],
        value,
        asOf: last?.[0] || h.as_of,
        pct,
        direction: dir,
        deprecated: meta[11] === true,
        narrative: meta[13] || '',
        description: meta[12] || '',
        points: h.points || [],
        stats: h.stats || {},
        freq: h.freq || '',
        mech_id:   mech?.mech_id   || null,
        mech_name: mech?.mech_name || null,
        share:     mech?.share     != null ? Number(mech.share) : null,
        tier:      tierFor[id]     || null,
      });
    });
    return out;
  }, [hist, mechFor, tierFor]);

  // filter + search
  const filtered = useMemo(() => {
    let r = rows.filter((x) => !x.deprecated);
    if (filter !== 'all') r = r.filter((x) => x.family === filter);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((x) => x.name.toLowerCase().includes(s) || x.id.toLowerCase().includes(s));
    }
    return r;
  }, [rows, filter, search]);

  const openInd = openId ? rows.find((x) => x.id === openId) : null;

  // counts by family
  const families = ['all', 'equity', 'credit', 'rates', 'fincond', 'bank', 'labor'];
  const familyCount = (f) => f === 'all' ? rows.filter((x) => !x.deprecated).length : rows.filter((x) => x.family === f && !x.deprecated).length;
  const flaggedCount = rows.filter((x) => !x.deprecated && pctBand(x.pct, x.direction) === 'r-off').length;

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
            <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>Indicators.</h1>
            <FreshnessChip elementId="indicator_history" fallback={hist?.__meta__?.as_of} />
          </div>
          <div className="v2-stats" style={{ marginTop: 28 }}>
            <div className="s">
              <span className="lbl">Calibrated series <InfoTip term="CALIBRATED SERIES" size={10} /></span>
              <span className="v"><CountUp to={rows.filter((x) => !x.deprecated).length} /></span>
              <span className="d">live + tracked</span>
            </div>
            <div className={`s ${flaggedCount > 0 ? 'warn' : ''}`}>
              <span className="lbl">In alert tail <InfoTip term="IN ALERT TAIL" size={10} /></span>
              <span className="v"><CountUp to={flaggedCount} /></span>
              <span className="d">in alert quartile</span>
            </div>
            <div className="s">
              <span className="lbl">Months of history <InfoTip def="The total volume of historical data points on file across every tracked indicator." size={10} /></span>
              <span className="v"><CountUp to={Math.round(rows.reduce((s, x) => s + (x.points?.length || 0), 0) / 1000)} format={(v) => `${Math.round(v)}K`} /></span>
              <span className="d">across all series</span>
            </div>
            <div className="s">
              <span className="lbl">Last refresh <InfoTip def="When the most recent indicator reading on the page was published." size={10} /></span>
              <span className="v" style={{ fontSize: 24 }}>{rows.length ? relativeAge(rows[0].asOf) : '—'}</span>
              <span className="d">most recent point</span>
            </div>
          </div>
        </div>
      </header>

      <div className="v2-shell">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '24px 0 14px' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {families.map((f) => (
              <button key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontSize: 11, fontWeight: 500, padding: '6px 12px', borderRadius: 'var(--r-pill)',
                  background: filter === f ? 'var(--accent)' : 'var(--bg-2)',
                  color: filter === f ? '#1a1411' : 'var(--ink-1)',
                  border: filter === f ? '1px solid transparent' : '1px solid var(--line-1)',
                  cursor: 'pointer', letterSpacing: '.04em',
                }}>
                {f === 'all' ? 'All' : FAMILY_LABEL[f] || f} ({familyCount(f)})
              </button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-2)', fontSize: 14, pointerEvents: 'none' }}>⌕</span>
            <input
              type="search"
              placeholder="Search indicators…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'var(--bg-1)', border: '1px solid var(--line-1)',
                borderRadius: 'var(--r-pill)', padding: '8px 14px 8px 36px',
                color: 'var(--ink-0)', font: 'inherit', fontSize: 13, width: 240,
              }}
            />
          </div>
        </div>

        <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {[
                  { label: 'Indicator',   align: 'left',  tip: '' },
                  { label: 'Mechanism',   align: 'left',  tip: 'Which v11 cycle mechanism this indicator feeds, if any.' },
                  { label: 'Family',      align: 'left',  tip: 'Indicator family — Equity, Credit, Rates, Financial conditions, Bank & Money, Labor & Growth.' },
                  { label: 'Tier',        align: 'left',  tip: 'License tier of the data feed: free public, paid vendor, or internal.' },
                  { label: 'Reading',     align: 'right', tip: 'Most recent reading available.' },
                  { label: 'Percentile',  align: 'right', tip: 'Where the current reading sits in the indicator\'s 15y distribution.' },
                  { label: 'Share',       align: 'right', tip: 'Indicator\'s share of its mechanism composite score, when calibrated.' },
                  { label: 'Trend',       align: 'left',  tip: 'Twelve-month spark line.' },
                  { label: 'Direction',   align: 'left',  tip: 'Whether elevated, depressed, or both extremes are alert-side.' },
                  { label: 'Last update', align: 'right', tip: 'How recently the source vendor published a fresh reading.' },
                ].map((c) => (
                  <th key={c.label} style={{
                    textAlign: c.align,
                    padding: '14px 18px', fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase',
                    color: 'var(--ink-2)', fontWeight: 500, borderBottom: '1px solid var(--line-1)',
                    background: 'var(--bg-1)', position: 'sticky', top: 0,
                  }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexDirection: c.align === 'right' ? 'row-reverse' : 'row' }}>
                      {c.label}
                      {c.tip ? <InfoTip def={c.tip} size={10} /> : null}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const band = pctBand(row.pct, row.direction);
                const sCls = sparkClassFor(row.points);
                return (
                  <tr key={row.id}
                    onClick={() => setOpenId(row.id)}
                    style={{ cursor: 'pointer', transition: 'background 180ms ease' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-0)', fontWeight: 500 }}>{row.name}</td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-1)' }}>
                      {row.mech_name ? (
                        <a href="#overview" className="v2-cta" onClick={(e) => e.stopPropagation()} title={`Open ${row.mech_name} on Macro Overview.`}>
                          {row.mech_name}
                        </a>
                      ) : <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-1)' }}>
                      <span style={{ fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 'var(--r-sm)', letterSpacing: '.04em',
                        background: 'var(--bg-2)', color: 'var(--ink-1)', border: '1px solid var(--line-1)' }}>
                        {row.familyLabel}
                      </span>
                    </td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-1)' }}>
                      {row.tier ? (
                        <span style={{
                          fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 'var(--r-sm)', letterSpacing: '.04em',
                          background: 'var(--bg-2)',
                          color: row.tier === 'paid' ? 'var(--accent)' : row.tier === 'internal' ? 'var(--info)' : row.tier === 'tbd' ? 'var(--ink-3)' : 'var(--ink-1)',
                          border: '1px solid var(--line-1)',
                          textTransform: 'capitalize',
                        }}>{row.tier}</span>
                      ) : <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', textAlign: 'right' }}>
                      <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontFeatureSettings: '"tnum"', fontSize: 15, fontWeight: 500, color: 'var(--ink-0)' }}>
                        {formatVal(row.value, row.decimals)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink-2)', marginLeft: 3 }}>{row.unit}</span>
                    </td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', textAlign: 'right' }}>
                      {row.pct != null ? (
                        <span className={`v2-pill ${band}`}>{row.pct}<span style={{ fontSize: 9, marginLeft: 1, opacity: .7 }}>th</span></span>
                      ) : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', textAlign: 'right', color: 'var(--ink-1)', fontSize: 12, fontFeatureSettings: '"tnum"' }}>
                      {row.share != null ? `${row.share.toFixed(1)}%` : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)' }}>
                      <svg width="80" height="24" viewBox="0 0 80 24"
                        style={{ color: sCls === 'up' ? 'var(--up)' : sCls === 'down' ? 'var(--down)' : 'var(--ink-2)' }}>
                        <path d={sparkPath(row.points)} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-2)', fontSize: 12 }}>
                      {row.direction === 'hw' ? 'High = elevated' : row.direction === 'lw' ? 'Low = elevated' : row.direction === 'bw' ? 'Both extremes elevated' : '—'}
                    </td>
                    <td style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-0)', textAlign: 'right', color: 'var(--ink-2)', fontSize: 12, fontFeatureSettings: '"tnum"' }}>
                      {relativeAge(row.asOf)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan="10" style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-2)' }}>
                  No indicators match {search ? `“${search}”` : 'this filter'}.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {rows.length} series · sourced from {manifestSources.length ? manifestSources.join(' · ') : 'data registry'}
        </div>
      </div>

      {/* DRAWER */}
      <Drawer open={openInd != null} onClose={() => {
        setOpenId(null);
        // Clear any deep-link ?id= so re-navigation doesn't reopen the drawer
        try {
          const cur = window.location.hash || '';
          if (/[?&]id=/.test(cur)) window.location.hash = cur.split('?')[0] || '#indicators';
        } catch (_) { /* ignore */ }
      }}>
        {openInd && (
          <>
            <div className="t-eyebrow accent">{openInd.familyLabel} · indicator</div>
            <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>{openInd.name}</h3>
            <p className="t-body" style={{ maxWidth: '64ch' }}>{openInd.description || '—'}</p>

            <div className="v2-drawer-grid">
              <div className="v2-drawer-stat">
                <div className="lbl">Current reading</div>
                <div className="v">{formatVal(openInd.value, openInd.decimals)}{openInd.unit ? <span style={{ fontSize: 14, color: 'var(--ink-2)', marginLeft: 3 }}>{openInd.unit}</span> : null}</div>
                <div className="sub2">As of {openInd.asOf}</div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">Percentile (15y)</div>
                <div className="v">{openInd.pct != null ? <>{openInd.pct}<span style={{ fontSize: 14, color: 'var(--ink-2)' }}>th</span></> : '—'}</div>
                <div className="sub2">{openInd.pct != null ? (openInd.pct >= 75 ? 'top quartile' : openInd.pct <= 25 ? 'bottom quartile' : 'mid-range') : ''}</div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">Sample stats</div>
                <div className="v" style={{ fontSize: 22 }}>μ {openInd.stats?.mean?.toFixed(2) || '—'}</div>
                <div className="sub2">σ {openInd.stats?.sd?.toFixed(2) || '—'} · n {openInd.stats?.n || '—'}</div>
              </div>
            </div>

            {openInd.points?.length >= 2 && (
              // Calibrated regime tint bands (#1158): a high-warns indicator
              // is stress polarity (top quarter = Risk Off); a low-warns
              // indicator inverts; bidirectional gets no single 4-zone ramp.
              <MTChart
                data={openInd.points}
                initialRange="5Y"
                polarity={openInd.direction === 'lw' ? 'risk-on'
                  : openInd.direction === 'bw' ? 'none' : 'stress'}
                timeframes={[
                  { key: '1Y', label: '1Y' },
                  { key: '3Y', label: '3Y' },
                  { key: '5Y', label: '5Y' },
                  { key: '10Y', label: '10Y' },
                  { key: 'MAX', label: 'MAX' },
                ]}
              />
            )}

            {openInd.narrative && (
              <div className="v2-drawer-section">
                <span className="t-eyebrow">So what</span>
                <p className="t-body" style={{ marginTop: 0 }}>{openInd.narrative}</p>
              </div>
            )}

            <div className="v2-drawer-section">
              <span className="t-eyebrow">Series</span>
              <div className="v2-drawer-row"><span className="lbl">Frequency</span><span className="val">{openInd.freq || '—'}</span></div>
              <div className="v2-drawer-row"><span className="lbl">Direction</span><span className="val">{openInd.direction === 'hw' ? 'High = elevated' : openInd.direction === 'lw' ? 'Low = elevated' : openInd.direction === 'bw' ? 'Both extremes elevated' : '—'}</span></div>
              <div className="v2-drawer-row"><span className="lbl">Sample window</span><span className="val">{openInd.stats?.window || '—'}</span></div>
              <div className="v2-drawer-row"><span className="lbl">Outlier handling</span><span className="val">{openInd.stats?.winsorize || '—'}</span></div>
            </div>

            {/* Source vendor — terminal node of the Indicator → source drill.
                Pulled from data_manifest.json. Bug #1165. */}
            <div className="v2-drawer-section">
              <span className="t-eyebrow">Source</span>
              <div className="v2-drawer-row"><span className="lbl">Vendor</span><span className="val">{sourceFor[openInd.id]?.vendor || 'Source not yet mapped'}</span></div>
              {sourceFor[openInd.id]?.endpoint && (
                <div className="v2-drawer-row"><span className="lbl">Feed</span><span className="val">{sourceFor[openInd.id].endpoint}</span></div>
              )}
              {openInd.mech_name && (
                <div className="v2-drawer-row"><span className="lbl">Mechanism</span><span className="val">{openInd.mech_name}</span></div>
              )}
              <div className="v2-drawer-row"><span className="lbl">Licence tier</span><span className="val" style={{ textTransform: 'capitalize' }}>{openInd.tier || '—'}</span></div>
            </div>
          </>
        )}
      </Drawer>

      {err && (
        <div style={{ position: 'fixed', bottom: 16, left: 16, padding: '10px 16px', background: 'var(--bg-1)', border: '1px solid var(--down)', borderRadius: 8, color: 'var(--down)', fontSize: 12 }}>
          Indicators: failed to load history ({err}).
        </div>
      )}
    </div>
  );
}
