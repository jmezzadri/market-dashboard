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

const DOMAINS = ['Rates', 'Credit', 'Equities', 'Money', 'Economy'];
// Path-A exception #3 (Joe 2026-05-27): design copy, never gets stale, keep.
const DOMAIN_TITLE = {
  Rates: 'The cost and shape of money.',
  Credit: 'Stress in lending markets.',
  Equities: 'Valuation, volatility, breadth.',
  Money: 'Reserves, liquidity, and the dollar.',
  Economy: 'Real growth and the labor market.',
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

export default function MacroPage() {
  const { active: indicators, loading } = useIndicators();
  const [view, setView] = useState(loadView);
  const [stateF, setStateF] = useState('all');
  const [domain, setDomain] = useState('All');
  const [selected, setSelected] = useState(null);

  useEffect(() => { saveView(view); }, [view]);

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
      const d = DOMAINS.includes(i.domain) ? i.domain : 'Money';
      out[d].push(i);
    });
    return out;
  }, [indicators]);

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Macro overview · today's read</div>
          <h1 className="mt-h1">
            The five things you should know <i>about the tape</i> today.
          </h1>
          <p className="mt-deck">
            {indicators.length || '—'} indicators across <b>Rates</b>, <b>Credit</b>,{' '}
            <b>Equities</b>, <b>Money &amp; Banking</b>, and the real <b>Economy</b>.
            No regime call lives on this page — that's Asset Tilt. This is the
            indicator backdrop.
          </p>
        </div>
        <div className="mc-onthispage">
          <div className="mt-eyebrow">On this page</div>
          <div className="mc-otpval num">{indicators.length || '—'}</div>
          <div className="mc-otpsub">indicators · five domains</div>
          <div className="mt-divider" />
          <div className="mc-otprow"><span>Leading</span><b className="num">{typeCounts.lead}</b></div>
          <div className="mc-otprow"><span>Coincident</span><b className="num">{typeCounts.coinc}</b></div>
          <div className="mc-otprow"><span>Lagging</span><b className="num">{typeCounts.lag}</b></div>
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
                      <span key={i.id} className={`mc-domsumdot mc-domsumdot--${i.state}`} />
                    ))}
                  </div>
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
          <div className="mc-legend mc-legend--push">
            <div className="mt-eyebrow">View</div>
            <div className="mt-pillgroup">
              <button type="button" className={`mt-pill ${view === 'map' ? 'on' : ''}`} onClick={() => setView('map')}>Map</button>
              <button type="button" className={`mt-pill ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')}>Grid</button>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="mt-pagesection">
          <div className="mt-loadingcard">Loading indicators…</div>
        </section>
      ) : view === 'map' ? (
        <>
          <section className="mt-pagesection">
            <div className="lm-canvas">
              <RegimeCanvas
                indicators={filtered}
                onSelect={setSelected}
                selected={selected}
              />
              <div className="lm-canvaslegend">
                <div className="lm-legrow">
                  <span className="lm-legdot lm-legdot--extreme" /> extreme
                  <span className="lm-legdot lm-legdot--elevated" /> elevated
                  <span className="lm-legdot lm-legdot--calm" /> calm
                </div>
                <div className="lm-legrow lm-legrow--dim">
                  showing {filtered.length} of {indicators.length} · click any dot to drill
                </div>
              </div>
            </div>
          </section>
          {selected && (
            <section className="mt-pagesection mt-pagesection--tight2">
              <IndicatorDetail ind={selected} onClose={() => setSelected(null)} />
            </section>
          )}
        </>
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
                <div className="mc-grid">
                  {inds.map((i) => (
                    <IndicatorCard key={i.id} ind={i} onClick={() => setSelected(i)} />
                  ))}
                </div>
              </section>
            );
          })}
          {selected && (
            <section className="mt-pagesection mt-pagesection--flush">
              <IndicatorDetail ind={selected} onClose={() => setSelected(null)} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
