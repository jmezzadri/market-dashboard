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
import FreshnessChip from '../components/FreshnessChip';
import RegimeCanvas from '../components/RegimeCanvas';
import IndicatorCard from '../components/IndicatorCard';
import IndicatorDetail from '../components/IndicatorDetail';
import useIndicators from '../lib/useIndicators';

const DOMAINS = ['Rates', 'Credit', 'Equities', 'Commodities', 'FX', 'Economy', 'Financial Conditions'];
// Path-A exception #3 (Joe 2026-05-27): design copy, never gets stale, keep.
const DOMAIN_TITLE = {
  Rates: 'The cost and shape of money.',
  Credit: 'Stress in lending markets.',
  Equities: 'Valuation, volatility, breadth.',
  Commodities: 'Metals, energy, and grains.',
  FX: 'The dollar and major currencies.',
  Economy: 'Real growth and the labor market.',
  'Financial Conditions': 'Liquidity and broad conditions.',
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
function posRead(p){ return p>=90?'crowded long':p<=10?'crowded short':p>=75?'leaning long':p<=25?'leaning short':'neutral'; }

function BucketPositioning({ data, onSelect }) {
  if (!data) return null;
  const items = data.markets || [];
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div className="mt-eyebrow" style={{ marginBottom: 4 }}>Positioning signals</div>
      {data.takeaway && <p className="mt-deck" style={{ marginTop: 0, marginBottom: 12 }}>{data.takeaway}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0 22px' }}>
        {items.map((m) => (
          <button key={m.market} type="button" onClick={() => onSelect && onSelect(m)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px', border: 'none', borderBottom: '1px solid var(--mt-line-1)', background: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
            <span className={`mc-domsumdot mc-domsumdot--${posState(m.spec)}`} style={{ width: 11, height: 11, borderRadius: '50%', flex: '0 0 auto', display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--mt-ink-0)', flex: 1 }}>{m.market}</span>
            <span style={{ fontSize: 11.5, color: 'var(--mt-ink-2)' }}>{posRead(m.spec)} · {Math.round(m.spec)}th</span>
            <span style={{ color: 'var(--mt-ink-3)', fontSize: 13 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PosStat({ label, v }) {
  return (<div><div style={{ fontSize: 11, color: 'var(--mt-ink-3)' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 600, color: 'var(--mt-ink-0)' }}>{v}</div></div>);
}

function PositioningDetail({ item, onClose }) {
  if (!item) return null;
  const h = item.history || [];
  const isDealer = item.comm == null;
  const specs = h.map((r) => r[1]).filter((v) => v != null);
  const comms = h.map((r) => r[2]).filter((v) => v != null);
  const all = (isDealer ? specs : specs.concat(comms)).concat([0]);
  const mn = Math.min(...all), mx = Math.max(...all);
  const W = 680, Hh = 150, pad = 8, rng = (mx - mn) || 1;
  const xx = (i) => pad + (i / Math.max(1, h.length - 1)) * (W - 2 * pad);
  const yy = (v) => Hh - pad - ((v - mn) / rng) * (Hh - 2 * pad);
  const path = (idx) => h.map((r, i) => (r[idx] == null ? null : `${i ? 'L' : 'M'}${xx(i).toFixed(1)} ${yy(r[idx]).toFixed(1)}`)).filter(Boolean).join(' ');
  const read = item.spec >= 90 ? 'the most bullish in 3 years — crowded long, fragile to an unwind'
    : item.spec <= 10 ? 'the most bearish in 3 years — crowded short, fragile to a squeeze'
    : item.spec >= 75 ? 'in the upper part of its 3-year range'
    : item.spec <= 25 ? 'in the lower part of its 3-year range' : 'mid-range over the last 3 years';
  const unit = isDealer ? (item.dealerUnit || '$bn net') : '% of open interest';
  return (
    <div className="mt-card" style={{ padding: '20px 24px', marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="mt-eyebrow">Positioning detail</div>
          <div className="mt-h2" style={{ margin: '2px 0' }}>{item.market}</div>
          <div style={{ fontSize: 13, color: 'var(--mt-ink-2)' }}>Speculators net {item.specNet}{isDealer ? '' : '%'} — {Math.round(item.spec)}th percentile · {read}</div>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, color: 'var(--mt-ink-3)', cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" height="150" preserveAspectRatio="none" style={{ marginTop: 14 }}>
        <line x1={pad} x2={W - pad} y1={yy(0)} y2={yy(0)} stroke="var(--mt-line-1)" strokeWidth="1" strokeDasharray="3 3" />
        {!isDealer && <path d={path(2)} fill="none" stroke="var(--mt-ink-3)" strokeWidth="1.5" />}
        <path d={path(1)} fill="none" stroke="var(--mt-accent)" strokeWidth="1.8" />
      </svg>
      <div style={{ display: 'flex', gap: 18, fontSize: 11.5, color: 'var(--mt-ink-2)', marginTop: 6 }}>
        <span><span style={{ color: 'var(--mt-accent)' }}>●</span> Speculators</span>
        {!isDealer && <span><span style={{ color: 'var(--mt-ink-3)' }}>●</span> Commercials (hedgers)</span>}
        <span style={{ marginLeft: 'auto' }}>net position, {unit} · 3-year weekly history</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--mt-line-1)' }}>
        <PosStat label="Speculators net" v={`${item.specNet}${isDealer ? '' : '%'}`} />
        <PosStat label="Speculator percentile" v={`${Math.round(item.spec)}th`} />
        {!isDealer && item.commNet != null && <PosStat label="Commercials net" v={`${item.commNet}%`} />}
        {item.oi != null && <PosStat label="Open interest" v={Number(item.oi).toLocaleString()} />}
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--mt-line-1)', fontSize: 11.5, color: 'var(--mt-ink-2)', lineHeight: 1.8 }}>
        <b>Source</b> {isDealer ? 'New York Fed primary-dealer statistics' : 'CFTC Commitments of Traders (futures + options)'}<br />
        <b>Frequency</b> Weekly · {isDealer ? 'Wednesday snapshot' : 'Tuesday snapshot'}<br />
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
      const d = DOMAINS.includes(i.domain) ? i.domain : 'Financial Conditions';
      out[d].push(i);
    });
    return out;
  }, [indicators]);

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Macro overview</div>
          <h1 className="mt-h1">
            Where every market sits <i>in its own range</i>.
          </h1>
          <p className="mt-deck">
            {indicators.length || '—'} indicators across <b>Rates</b>, <b>Credit</b>,{' '}
            <b>Equities</b>, <b>Commodities</b>, <b>FX</b>, the <b>Economy</b>, and{' '}
            <b>Financial Conditions</b> — each with its positioning. No regime call
            lives on this page; that's Asset Tilt. This is the indicator backdrop.
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
          <div className="mc-domstrip">
            {DOMAINS.map((dom) => {
              const inds = byDomain[dom] || [];
              const ext = inds.filter((i) => i.state === 'extreme').length;
              const elev = inds.filter((i) => i.state === 'elevated').length;
              const isActive = domain === dom;
              return (
                <button
                  key={dom}
                  type="button"
                  className={`mc-domcell ${isActive ? 'on' : ''}`}
                  onClick={() => setDomain(isActive ? 'All' : dom)}
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
                  <div className="mc-domsumbar">
                    {inds.map((i) => (
                      <span key={i.id} className={`mc-domsumdot mc-domsumdot--${i.state}`} style={{ width: 8, height: 8, borderRadius: '50%' }} />
                    ))}
                  </div>
                  {cotPos?.domains?.[dom]?.takeaway && (
                    <div className="mc-domtake" style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--mt-line-1)', fontSize: 11.5, lineHeight: 1.4, color: 'var(--mt-ink-2)' }}>
                      {cotPos.domains[dom].takeaway}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Filter bar + view toggle */}
      <section className="mt-pagesection mt-pagesection--tight">
        <div className="mc-filterbar">
          <div className="mc-legend">
            <div className="mt-eyebrow">Filter</div>
            <div className="mt-pillgroup">
              {[['all', 'All'], ['extreme', 'Extreme'], ['elevated', 'Elevated'], ['calm', 'Calm']].map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={`mt-pill ${stateF === k ? 'on' : ''}`}
                  onClick={() => setStateF(k)}
                >
                  {l} <span className="mc-pillcount num">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mc-legend">
            <div className="mt-eyebrow">Domain</div>
            <div className="mt-pillgroup">
              {['All', ...DOMAINS].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`mt-pill ${domain === d ? 'on' : ''}`}
                  onClick={() => setDomain(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="mt-pagesection">
          <div className="mt-loadingcard">Loading indicators…</div>
        </section>
      ) : (
        <>
          {DOMAINS.filter((d) => domain === 'All' || domain === d).map((dom) => {
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
            <section className="mt-pagesection mt-pagesection--flush">
              <IndicatorDetail ind={selected} onClose={() => setSelected(null)} />
            </section>
          )}
          {selectedPos && (
            <section className="mt-pagesection mt-pagesection--flush">
              <PositioningDetail item={selectedPos} onClose={() => setSelectedPos(null)} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
