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
import Sparkline from '../components/Sparkline';
import useIndicators from '../lib/useIndicators';
import useCotPositioning from '../lib/useCotPositioning';

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

// Plain-English ordinal for a 0–100 percentile: "8th percentile of its
// 3-year range". Observation copy only — never a call.
function pctileInWords(p) {
  if (p == null || !Number.isFinite(p)) return null;
  const n = Math.round(p);
  const mod100 = n % 100;
  const mod10 = n % 10;
  let suffix = 'th';
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = 'st';
    else if (mod10 === 2) suffix = 'nd';
    else if (mod10 === 3) suffix = 'rd';
  }
  return `${n}${suffix} percentile of its 3-year range`;
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

/* ── Market Crowding ───────────────────────────────────────────────────────
   Observation-only read of where any futures market is at a positioning
   extreme this week (its watch group's net position is in the bottom or top
   tenth of its own 3-year range). Additive section below the domain strip —
   it does NOT touch the hero or the strip, feeds no score, and makes no
   buy/sell or predictive claim. */
function MarketCrowdingSection() {
  const { extremes, asOf, loading } = useCotPositioning();
  if (loading) return null;
  return (
    <section className="mt-pagesection mt-pagesection--tight">
      <div className="mt-sectionhead">
        <div>
          <div className="mt-eyebrow">Market crowding</div>
          <div className="mt-h2">Where the futures crowd is at an extreme.</div>
          <p className="mt-deck" style={{ marginTop: 8 }}>
            "Crowded" means a market's futures positioning is stretched versus
            its own history — leaving it fragile to a reversal if the crowd
            unwinds.
          </p>
        </div>
      </div>

      {extremes.length === 0 ? (
        <div className="mt-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FreshnessChip elementId="indicator-cftc-cot-weekly" fallback={{ asOfIso: asOf }} variant="dot" />
            <span style={{ fontSize: 14, color: 'var(--mt-ink-1)' }}>
              No market is at a positioning extreme this week.
            </span>
          </div>
        </div>
      ) : (
        <div className="mc-grid">
          {extremes.map((r) => {
            const sparkPts = (r.points || []).map((p) => p[1]).filter(Number.isFinite);
            return (
              <div key={r.key} className="mt-card" style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--mt-ink-0)' }}>
                      {r.market}
                    </div>
                    {r.group && (
                      <div style={{ fontSize: 12, color: 'var(--mt-ink-2)', marginTop: 2 }}>
                        {r.group}
                      </div>
                    )}
                  </div>
                  <FreshnessChip elementId="indicator-cftc-cot-weekly" fallback={{ asOfIso: r.asOf || asOf }} variant="dot" />
                </div>
                {pctileInWords(r.pctile3yr) && (
                  <div style={{ fontSize: 12.5, color: 'var(--mt-ink-1)', marginTop: 10 }}>
                    {pctileInWords(r.pctile3yr)}
                  </div>
                )}
                {r.read && (
                  <div style={{ fontSize: 13, color: 'var(--mt-ink-1)', marginTop: 6, lineHeight: 1.4 }}>
                    {r.read}
                  </div>
                )}
                {sparkPts.length > 1 && (
                  <div style={{ marginTop: 12 }}>
                    <Sparkline data={sparkPts} width={220} height={28} stroke="var(--mt-ink-2)" showDot={false} />
                    <div style={{ fontSize: 10.5, color: 'var(--mt-ink-3)', marginTop: 4 }}>
                      Net position as a share of open interest · 3-year history
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--mt-ink-3)', lineHeight: 1.5 }}>
        Observation only — this is a reference read of futures positioning. It
        feeds no score and is not a buy or sell signal; a forward-return
        backtest is pending.
      </div>
    </section>
  );
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

      {/* Market crowding — additive, below the domain strip. Extremes only. */}
      <MarketCrowdingSection />

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
