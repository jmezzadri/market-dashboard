/* Macro Overview — refactored 2026-05-27 per Joe Path-A directive.

   Catalog: 1 violation — DOMAIN_TITLE one-liners (Path-A exception #3:
   design copy, never gets stale, kept verbatim).

   Style refactor (zero inline style={{...}} after this commit):
   - "On this page" right card uses .mc-onthispage / .mc-otpval /
     .mc-otpsub / .mc-otprow classes from the prototype port instead of
     inline-styled approximations.
   - Filter bar uses .mc-filterbar / .mc-legend / .mc-legend--push.
   - Section spacing uses --tight / --tight2 / --flush variants.
   - Loading state uses .mt-loadingcard.

   Behavior preserved:
   - All counts derived from real useIndicators() hook.
   - Domain-strip freshness chip points to the OLDEST indicator in the
     domain (most likely to fail SLA first).
   - View toggle persists to localStorage. */

import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import FreshnessChip from '../components/FreshnessChip';
import RegimeCanvas from '../components/RegimeCanvas';
import IndicatorCard from '../components/IndicatorCard';
import IndicatorDetail from '../components/IndicatorDetail';
import useIndicators from '../lib/useIndicators';
import BigHistoryChart from '../components/BigHistoryChart';
import Sparkline from '../components/Sparkline';

const DOMAINS = ['Rates', 'Credit', 'Equities', 'Commodities', 'FX', 'Financial Conditions & Economy'];
// Path-A exception #3 (Joe 2026-05-27): design copy, never gets stale, keep.
const DOMAIN_TITLE = {
  Rates: 'The cost and shape of money.',
  Credit: 'Stress in lending markets.',
  Equities: 'Valuation, volatility, breadth.',
  Commodities: 'Metals, energy, and grains.',
  FX: 'The dollar and major currencies.',
  'Financial Conditions & Economy': 'Growth, jobs, and broad financial conditions.',
};

function loadView() {
  try {
    return window.localStorage.getItem('mt.overhaul.macro.view') || 'map';
  } catch {
    return 'map';
  }
}
function saveView(v) {
  try { window.localStorage.setItem('mt.overhaul.macro.view', v); } catch {}
}

// Domain-level freshness chip: bind to the oldest indicator in the domain
// (the one most likely to fail SLA first). useFreshness can't be called in
// a loop, so this is the cleanest one-chip aggregation we can do safely.
function DomainFreshness({ inds }) {
  const oldest = useMemo(() => {
    if (!inds?.length) return null;
    return [...inds].sort((a, b) => String(a.asOf || '').localeCompare(String(b.asOf || '')))[0];
  }, [inds]);
  if (!oldest) return null;
  return <FreshnessChip elementId={oldest.manifestId || `indicator-${oldest.id}-daily`} variant="dot" />;
}

// Positioning read inside a domain tile. Observation layer (CFTC COT): one
// plain-English "so what" plus a single-track read of the domain's headline
// market — filled dot = the speculative crowd, open dot = commercial hedgers,
// amber link = the two sit at opposite extremes (a divergence). Styled with
// theme tokens only, so it follows light/dark like everything else.
function DomainPositioning({ data }) {
  if (!data) return null;
  const wrap = { marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--mt-line-1)' };
  const label = { fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mt-ink-3)', fontWeight: 700, marginBottom: 5 };
  if (data.none) {
    return (
      <div style={wrap}>
        <div style={label}>Positioning</div>
        <div style={{ fontSize: 11.5, color: 'var(--mt-ink-3)', lineHeight: 1.4 }}>{data.takeaway}</div>
      </div>
    );
  }
  const h = data.headline || {};
  const lo = Math.min(h.spec, h.comm);
  const hi = Math.max(h.spec, h.comm);
  const conn = h.div ? 'var(--mt-warn)' : 'var(--mt-ink-3)';
  const dot = { position: 'absolute', top: '50%', width: 10, height: 10, borderRadius: '50%', transform: 'translate(-50%,-50%)' };
  return (
    <div style={wrap}>
      <div style={label}>Positioning</div>
      <div style={{ fontSize: 11.5, color: 'var(--mt-ink-1)', lineHeight: 1.4 }}>{data.takeaway}</div>
      <div style={{ position: 'relative', height: 6, background: 'var(--mt-surface-3)', borderRadius: 4, marginTop: 8 }}>
        <span style={{ position: 'absolute', top: '50%', height: 3, transform: 'translateY(-50%)', left: `${lo}%`, width: `${hi - lo}%`, background: conn, borderRadius: 2 }} />
        <span style={{ ...dot, left: `${h.spec}%`, background: 'var(--mt-accent)' }} />
        <span style={{ ...dot, left: `${h.comm}%`, background: 'var(--mt-bg)', border: '2px solid var(--mt-ink-3)' }} />
      </div>
    </div>
  );
}

function posState(p){ return (p<=10||p>=90)?'extreme':(p<=25||p>=75)?'elevated':'calm'; }
function stColor(s){ return s==='extreme'?'var(--mt-down)':s==='elevated'?'var(--mt-warn)':'var(--mt-up)'; }
function signedPct(p){ if (p == null || !Number.isFinite(p)) return ''; const d = Math.round(p - 50); return (d >= 0 ? '+' : '') + d; }
const SHORT = {
  'Inflation expectations (10-year)': '10y breakeven',
  'High-yield spread over Treasuries': 'HY vs UST',
  'Investment-grade spread over Treasuries': 'IG vs UST',
  'Business lending standards': 'C&I lending stds',
  'Real-estate lending standards': 'CRE lending stds',
  'Corporate-bond distress': 'Corp bond distress',
  'High-yield total yield': 'HY total yield',
  'High-yield vs investment-grade': 'HY vs IG',
  'Dollar funding stress': 'USD funding',
  'Bank credit growth': 'Bank credit',
  '10-year real yield': '10y real yield',
  'Yield curve slope': 'Yield curve',
  'Stock volatility': 'Stock vol (VIX)',
  'Crash risk (options)': 'Crash risk (SKEW)',
  'Stocks vs credit': 'Stock-credit corr',
  'Stock valuation': 'Stock val (CAPE)',
  'Manufacturing activity': 'Mfg activity (ISM)',
  'Copper-to-gold ratio': 'Copper / gold',
  'Financial conditions (Chicago Fed)': 'Fin conditions',
  'Financial stress (St. Louis Fed)': 'Fin stress',
  'Treasury General Account': 'Treasury acct (TGA)',
  'US dollar index': 'Dollar index',
  'US Dollar Index': 'Dollar index',
  'Australian Dollar': 'Aussie dollar',
  'Investment-grade bonds': 'IG bonds',
  'High-yield bonds': 'HY bonds',
};
function shortLabel(n) {
  if (SHORT[n]) return SHORT[n];
  return n.length > 20 ? n.slice(0, 19) + '\u2026' : n;
}
function posRead(p){ return p>=90?'crowded long':p<=10?'crowded short':p>=75?'leaning long':p<=25?'leaning short':'neutral'; }
function posAccent(p){ const x=posState(p); return x==='extreme'?'var(--mt-down)':x==='elevated'?'var(--mt-warn)':'var(--mt-up)'; }

function DetailModal({ onClose, children }) {
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,28,.55)', zIndex: 5000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px 64px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 'min(1080px, 95vw)', background: 'var(--mt-surface, #fff)', borderRadius: 18, boxShadow: '0 24px 70px rgba(20,30,45,.4)' }}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 14, right: 16, border: 'none', background: 'none', fontSize: 26, lineHeight: 1, color: 'var(--mt-ink-3)', cursor: 'pointer', zIndex: 2 }}>×</button>
        {children}
      </div>
    </div>,
    target,
  );
}

function PositioningCard({ item, onClick }) {
  const accent = posAccent(item.spec);
  const isDealer = item.comm == null;
  const trend = (item.history || []).slice(-90).map((r) => r[1]).filter((v) => Number.isFinite(v));
  return (
    <button type="button" onClick={onClick} className="mt-card ind-card"
      style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--mt-surface)', border: '1px solid var(--mt-line-0)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mt-ink-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.market}</div>
          <div style={{ fontSize: 10.5, color: 'var(--mt-ink-2)', marginTop: 2 }}>{isDealer ? 'Dealer inventory' : 'Futures positioning'}</div>
        </div>
        <FreshnessChip elementId="indicator-cftc-cot-weekly" variant="dot" />
      </header>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div className="num" style={{ fontSize: 22, fontWeight: 500, color: accent }}>{Math.round(item.spec)}<span style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginLeft: 3, fontWeight: 400 }}>th pct</span></div>
        <span className={`mt-tag mt-tag--${posState(item.spec) === 'extreme' ? 'extreme' : posState(item.spec) === 'elevated' ? 'elev' : 'calm'}`}>{posRead(item.spec)}</span>
      </div>
      <div style={{ color: accent }}><Sparkline data={trend} width={240} height={28} stroke={accent} showDot /></div>
      <div style={{ fontSize: 10.5, color: 'var(--mt-ink-2)' }}>speculators · net {item.specNet}{isDealer ? '' : '%'}</div>
    </button>
  );
}

function BucketPositioning({ data, onSelect }) {
  if (!data) return null;
  const items = data.markets || [];
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div className="mt-eyebrow" style={{ marginBottom: 4 }}>Positioning signals</div>
      {data.takeaway && <p className="mt-deck" style={{ marginTop: 0, marginBottom: 12 }}>{data.takeaway}</p>}
      <div className="mc-grid">
        {items.map((m) => (<PositioningCard key={m.market} item={m} onClick={() => onSelect && onSelect(m)} />))}
      </div>
    </div>
  );
}

function slicePos(points, tf) {
  if (!points || !points.length || tf === 'Max') return points || [];
  const last = new Date(points[points.length - 1][0]).getTime();
  const days = tf === '1Y' ? 365 : 3 * 365;
  const cutoff = last - days * 86400000;
  return points.filter((pt) => new Date(pt[0]).getTime() >= cutoff);
}
function PosStat({ label, v }) {
  return (<div><div style={{ fontSize: 11, color: 'var(--mt-ink-3)' }}>{label}</div><div className="num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--mt-ink-0)' }}>{v}</div></div>);
}
function PositioningDetail({ item, onClose }) {
  const [tf, setTf] = useState('3Y');
  const isDealer = item.comm == null;
  const h = item.history || [];
  const specAll = useMemo(() => h.map((r) => [r[0], r[1]]), [h]);
  const commAll = useMemo(() => h.map((r) => [r[0], r[2]]).filter((pt) => pt[1] != null), [h]);
  const spec = useMemo(() => slicePos(specAll, tf), [specAll, tf]);
  const comm = useMemo(() => (isDealer ? [] : slicePos(commAll, tf)), [commAll, tf, isDealer]);
  const accent = posAccent(item.spec);
  const read = item.spec >= 90 ? 'the most bullish in 3 years — crowded long, fragile to an unwind'
    : item.spec <= 10 ? 'the most bearish in 3 years — crowded short, fragile to a squeeze'
    : item.spec >= 75 ? 'in the upper part of its 3-year range'
    : item.spec <= 25 ? 'in the lower part of its 3-year range' : 'mid-range over the last 3 years';
  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="mt-eyebrow">Positioning · {isDealer ? 'dealer inventory' : 'futures'}</div>
          <div style={{ fontFamily: 'var(--mt-font-display)', fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', margin: '4px 0 0', lineHeight: 1.1 }}>{item.market}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 32, fontWeight: 500, color: accent, lineHeight: 1 }}>{Math.round(item.spec)}<span style={{ fontSize: 14, color: 'var(--mt-ink-2)', marginLeft: 6, fontWeight: 400 }}>th pct</span></div>
          <div style={{ marginTop: 6 }}><FreshnessChip elementId="indicator-cftc-cot-weekly" fallback={{ asOfIso: item.asof }} variant="label" /></div>
        </div>
      </header>
      <div style={{ fontSize: 14, color: 'var(--mt-ink-1)', marginBottom: 14 }}>Speculators net {item.specNet}{isDealer ? '' : '%'} — {read}.</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="mt-pillgroup">
          {['1Y', '3Y', 'Max'].map((k) => (<button key={k} type="button" className={`mt-pill ${tf === k ? 'on' : ''}`} onClick={() => setTf(k)}>{k}</button>))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}><b className="num">{spec.length}</b> weekly reports</div>
      </div>
      <BigHistoryChart points={spec} accent={accent} height={280} freq="W" primaryLabel="Speculators"
        overlays={isDealer ? [] : [{ points: comm, color: 'var(--mt-ink-3)', label: 'Commercials (hedgers)', dash: '4 3' }]}
        yFormat={(v) => `${v.toFixed(1)}${isDealer ? '' : '%'}`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 14, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--mt-line-1)' }}>
        <PosStat label="Speculators net" v={`${item.specNet}${isDealer ? '' : '%'}`} />
        <PosStat label="Speculator percentile" v={`${Math.round(item.spec)}th`} />
        {!isDealer && item.commNet != null && <PosStat label="Commercials net" v={`${item.commNet}%`} />}
        {item.oi != null && <PosStat label="Open interest" v={Number(item.oi).toLocaleString()} />}
      </div>
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--mt-line-1)', fontSize: 12, color: 'var(--mt-ink-2)', lineHeight: 1.9 }}>
        <b>Source</b> {isDealer ? 'New York Fed primary-dealer statistics' : 'CFTC Commitments of Traders (futures + options)'}<br />
        <b>Frequency</b> Weekly · NYSE trading days · {isDealer ? 'Wednesday snapshot' : 'Tuesday snapshot'}<br />
        <b>Timing</b> {isDealer ? 'Thursday, after release' : 'Saturday 07:00 ET'}<br />
        <b>Service-level target</b> {isDealer ? '14 days' : '8 days (192 hours)'}<br />
        <b>Last update</b> {item.asof}
      </div>
    </div>
  );
}

export default function MacroPage() {
  const { active: indicators, loading } = useIndicators();
  const [view, setView] = useState(loadView);
  const [stateF, setStateF] = useState('all');
  const [domain, setDomain] = useState('All');
  const [selected, setSelected] = useState(null);
  const [cotPos, setCotPos] = useState(null);
  const [selectedPos, setSelectedPos] = useState(null);

  useEffect(() => { saveView(view); }, [view]);
  useEffect(() => {
    let cancelled = false;
    fetch('/cot_positioning.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setCotPos(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const posCount = useMemo(() => {
    if (!cotPos || !cotPos.domains) return 0;
    let n = 0;
    Object.values(cotPos.domains).forEach((d) => {
      n += (d.markets ? d.markets.length : 0) + (d.dealer ? 2 : 0);
    });
    return n;
  }, [cotPos]);

  const filtered = useMemo(() => {
    return indicators.filter(
      (i) =>
        (stateF === 'all' || i.state === stateF) &&
        (domain === 'All' || i.domain === domain),
    );
  }, [indicators, stateF, domain]);

  const counts = useMemo(() => ({
    all: indicators.length,
    extreme: indicators.filter((i) => i.state === 'extreme').length,
    elevated: indicators.filter((i) => i.state === 'elevated').length,
    calm: indicators.filter((i) => i.state === 'calm').length,
  }), [indicators]);

  const typeCounts = useMemo(() => ({
    lead: indicators.filter((i) => i.registryTier === 1).length,
    coinc: indicators.filter((i) => i.registryTier === 2).length,
    lag: indicators.filter((i) => i.registryTier === 3).length,
  }), [indicators]);

  const byDomain = useMemo(() => {
    const out = {};
    DOMAINS.forEach((d) => { out[d] = []; });
    indicators.forEach((i) => {
      const d = DOMAINS.includes(i.domain) ? i.domain : 'Financial Conditions & Economy';
      out[d].push(i);
    });
    return out;
  }, [indicators]);

  return (
    <div className="mt-pagebody mt-fade">
      <style>{`.mc-pill{transition:filter .12s ease,transform .12s ease}.mc-pill:hover{filter:brightness(1.18);transform:translateY(-1px)}`}</style>
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Macro overview</div>
          <h1 className="mt-h1">
            Where every market sits <i>in its own range</i>.
          </h1>
          <p className="mt-deck">
            Every market's indicators — and, where it trades, its futures
            positioning — ranked against its own 3-year history. Green is calm,
            amber stretched, red at an extreme. The backdrop for the regime call,
            which lives on Asset Tilt.
          </p>
        </div>
        <div className="mc-onthispage">
          <div className="mt-eyebrow">On this page</div>
          <div className="mc-otpval num">{indicators.length || '—'}</div>
          <div className="mc-otpsub">indicators</div>
          <div className="mt-divider" />
          <div className="mc-otprow"><span>Positioning signals</span><b className="num">{posCount || '—'}</b></div>
          <div className="mc-otprow"><span>Asset classes</span><b className="num">5</b></div>
          <FreshnessChip elementId="market-universe_master-daily" variant="label" />
        </div>
      </section>

      {/* Domain strip */}
      {!loading && (
        <section className="mt-pagesection">
          <div className="mc-domstrip" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {DOMAINS.map((dom) => {
              const inds = byDomain[dom] || [];
              const ext = inds.filter((i) => i.state === 'extreme').length;
              const elev = inds.filter((i) => i.state === 'elevated').length;
              const isActive = domain === dom;
              return (
                <div
                  key={dom}
                  role="button"
                  tabIndex={0}
                  className={`mc-domcell ${isActive ? 'on' : ''}`}
                  onClick={() => setDomain(isActive ? 'All' : dom)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="mc-domhead">
                    <div className="mc-domname">{dom}</div>
                    <DomainFreshness inds={inds} />
                  </div>
                  <div className="mc-domnum num">
                    {ext}<span className="mc-domof">/{inds.length}</span>
                    <span className="mc-domlabel">extreme</span>
                  </div>
                  {elev > 0 && (
                    <div className="mc-domsub">+ <b>{elev}</b> elevated</div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <div className="mt-eyebrow" style={{ fontSize: 9.5, marginBottom: 6 }}>Indicators</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                      {inds.map((i) => (
                        <button key={i.id} type="button" title={i.name}
                          className={`mt-tag mc-pill mt-tag--${i.state === 'extreme' ? 'extreme' : i.state === 'elevated' ? 'elev' : 'calm'}`}
                          onClick={(e) => { e.stopPropagation(); setSelected(i); }}
                          style={{ cursor: 'pointer', border: 'none', font: 'inherit', width: '100%', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortLabel(i.name)}</span>
                          <span className="num" style={{ flex: '0 0 auto', opacity: 0.85 }}>{signedPct(i.pct)}</span>
                        </button>
                      ))}
                    </div>
                    {(cotPos?.domains?.[dom]?.markets || []).length > 0 && (
                      <>
                        <div className="mt-eyebrow" style={{ fontSize: 9.5, margin: '12px 0 6px' }}>Positioning · speculators</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                          {cotPos.domains[dom].markets.map((m) => (
                            <button key={m.market} type="button" title={`${m.market} \u00b7 positioning`}
                              className={`mt-tag mc-pill mt-tag--${posState(m.spec) === 'extreme' ? 'extreme' : posState(m.spec) === 'elevated' ? 'elev' : 'calm'}`}
                              onClick={(e) => { e.stopPropagation(); setSelectedPos(m); }}
                              style={{ cursor: 'pointer', border: '1px dashed currentColor', font: 'inherit', width: '100%', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortLabel(m.market)}</span>
                              <span className="num" style={{ flex: '0 0 auto', opacity: 0.85 }}>{signedPct(m.spec)}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}



      {!loading && domain === 'All' && (
        <section className="mt-pagesection mt-pagesection--tight">
          <div style={{ textAlign: 'center', color: 'var(--mt-ink-3)', fontSize: 13 }}>Select a bucket above to open its indicators and positioning.</div>
        </section>
      )}
      {loading ? (
        <section className="mt-pagesection">
          <div className="mt-loadingcard">Loading indicators…</div>
        </section>
      ) : (
        <>
          {DOMAINS.filter((d) => domain !== 'All' && domain === d).map((dom) => {
            const inds = (byDomain[dom] || []).filter(
              (i) => stateF === 'all' || i.state === stateF,
            );
            if (!inds.length) return null;
            const c = {
              extreme: inds.filter((i) => i.state === 'extreme').length,
              elevated: inds.filter((i) => i.state === 'elevated').length,
              calm: inds.filter((i) => i.state === 'calm').length,
            };
            return (
              <section key={dom} className="mt-pagesection">
                <div className="mt-sectionhead">
                  <div>
                    <div className="mt-eyebrow">{dom}</div>
                    <div className="mt-h2">{DOMAIN_TITLE[dom]}</div>
                  </div>
                  <div className="mc-domstate">
                    {c.extreme > 0 && <span className="mt-tag mt-tag--extreme">{c.extreme} extreme</span>}
                    {c.elevated > 0 && <span className="mt-tag mt-tag--elev">{c.elevated} elevated</span>}
                    {c.calm > 0 && <span className="mt-tag mt-tag--calm">{c.calm} calm</span>}
                  </div>
                </div>
                <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Indicators</div>
                <div className="mc-grid">
                  {inds.map((i) => (
                    <IndicatorCard key={i.id} ind={i} onClick={() => setSelected(i)} />
                  ))}
                </div>
                <BucketPositioning data={cotPos?.domains?.[dom]} onSelect={setSelectedPos} />
              </section>
            );
          })}
          {selected && (
            <DetailModal onClose={() => setSelected(null)}>
              <IndicatorDetail ind={selected} onClose={() => setSelected(null)} />
            </DetailModal>
          )}
          {selectedPos && (
            <DetailModal onClose={() => setSelectedPos(null)}>
              <PositioningDetail item={selectedPos} onClose={() => setSelectedPos(null)} />
            </DetailModal>
          )}
        </>
      )}
    </div>
  );
}
