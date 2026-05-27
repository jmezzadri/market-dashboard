/* Macro Overview page — the 5-domain backdrop. Site-overhaul PR-O3.

   - Domain strip (5 clickable cards with state counts + per-indicator dot row)
   - Filter bar (state + domain pills + Map↔Grid view toggle)
   - Map view: RegimeCanvas with all indicators positioned by state×domain.
     Click a dot → IndicatorDetail drill below.
   - Grid view: indicators grouped by domain in IndicatorCards.
   - View choice persists in localStorage under mt.overhaul.macro.view.
*/

import React, { useMemo, useState, useEffect } from 'react';
import FreshnessChip from '../components/FreshnessChip';
import RegimeCanvas from '../components/RegimeCanvas';
import IndicatorCard from '../components/IndicatorCard';
import IndicatorDetail from '../components/IndicatorDetail';
import useIndicators from '../lib/useIndicators';

const DOMAINS = ['Rates', 'Credit', 'Equities', 'Money', 'Economy'];
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
  try {
    window.localStorage.setItem('mt.overhaul.macro.view', v);
  } catch {
    // ignored
  }
}

export default function MacroPage() {
  const { indicators, loading } = useIndicators();
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
            {indicators.length} indicators across <b>Rates</b>, <b>Credit</b>,{' '}
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
          <div className="mc-otprow">
            <span>Extreme</span><b className="num" style={{ color: 'var(--mt-down)' }}>{counts.extreme}</b>
          </div>
          <div className="mc-otprow">
            <span>Elevated</span><b className="num" style={{ color: 'var(--mt-warn)' }}>{counts.elevated}</b>
          </div>
          <div className="mc-otprow">
            <span>Calm</span><b className="num" style={{ color: 'var(--mt-up)' }}>{counts.calm}</b>
          </div>
          <FreshnessChip elementId="universe-master-daily" variant="label" />
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
                    {inds[0] && <FreshnessChip elementId={inds[0].id} variant="dot" />}
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
      <section className="mt-pagesection" style={{ paddingTop: 16, paddingBottom: 8 }}>
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
          <div className="mc-legend" style={{ marginLeft: 'auto' }}>
            <div className="mt-eyebrow">View</div>
            <div className="mt-pillgroup">
              <button type="button" className={`mt-pill ${view === 'map' ? 'on' : ''}`} onClick={() => setView('map')}>Map</button>
              <button type="button" className={`mt-pill ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')}>Grid</button>
            </div>
          </div>
        </div>
      </section>

      {/* Map or grid */}
      {loading ? (
        <section className="mt-pagesection">
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            Loading indicators…
          </div>
        </section>
      ) : view === 'map' ? (
        <>
          <section className="mt-pagesection">
            <RegimeCanvas
              indicators={filtered}
              onSelect={setSelected}
              selected={selected}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--mt-ink-2)' }}>
              Showing <b className="num">{filtered.length}</b> of <b className="num">{indicators.length}</b> · click any dot to drill
            </div>
          </section>
          {selected && (
            <section className="mt-pagesection" style={{ paddingTop: 8 }}>
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
            const counts = {
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
                    {counts.extreme > 0 && <span className="mt-tag mt-tag--extreme">{counts.extreme} extreme</span>}
                    {counts.elevated > 0 && <span className="mt-tag mt-tag--elev">{counts.elevated} elevated</span>}
                    {counts.calm > 0 && <span className="mt-tag mt-tag--calm">{counts.calm} calm</span>}
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
            <section className="mt-pagesection" style={{ paddingTop: 0 }}>
              <IndicatorDetail ind={selected} onClose={() => setSelected(null)} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
