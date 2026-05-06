import React, { useEffect, useMemo, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import Drawer from '../components/Drawer';

/**
 * AssetTiltPage v2 — cutover.
 * Live JSON: /v10_allocation.json (engine output — equity_pct, defensive_pct, leverage,
 * mechanism_scores, mechanism_bands, sectors, industry_groups with tickers + contributions + dollar).
 */

const MECH_LABELS = {
  valuation: 'Valuation', credit: 'Credit', funding: 'Funding',
  growth: 'Growth', liquidity_policy: 'Liquidity & Policy', positioning_breadth: 'Positioning & Breadth',
};

export default function AssetTiltPage() {
  const [v10, setV10] = useState(null);
  const [err, setErr] = useState(null);
  const [openIg, setOpenIg] = useState(null);
  const [igFilter, setIgFilter] = useState('all');

  useEffect(() => {
    fetch('/v10_allocation.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null)
      .then(setV10).catch((e) => setErr(e?.message));
  }, []);

  const eqPct = v10?.equity_pct != null ? Math.round(v10.equity_pct * 100) : null;
  const defPct = v10?.defensive_pct != null ? Math.round(v10.defensive_pct * 100) : null;
  const lev = v10?.leverage;
  const stress = v10?.stress_score;
  const STANCE_MAP = { 'Cautious':'Cautionary', 'Stressed':'Risk Off', 'Distressed':'Risk Off', 'Concerning':'Cautionary', 'Complacent':'Cautionary', 'Normal':'Neutral' };
  const rawStance = v10?.page_stance || '—';
  const stance = STANCE_MAP[rawStance] || rawStance;
  const sectors = v10?.sectors || [];
  const igs = v10?.industry_groups || [];
  const igsSorted = useMemo(() => [...igs].sort((a, b) => (b.tilt_score || 0) - (a.tilt_score || 0)), [igs]);

  const igsFiltered = useMemo(() => {
    if (igFilter === 'all') return igsSorted;
    return igsSorted.filter((ig) => ig.rating === igFilter);
  }, [igsSorted, igFilter]);

  const top = igsSorted.slice(0, 5);
  const bot = igsSorted.slice(-5).reverse();

  const openIgRecord = openIg ? igs.find((ig) => ig.id === openIg) : null;

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
            <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>{stance}{stance && stance !== '—' ? ' lean.' : ''}</h1>
            <FreshnessChip elementId="v10_allocation" fallback={v10?.as_of} />
          </div>
          <div className="v2-stats" style={{ marginTop: 28 }}>
            <div className={`s ${stress > 1 ? 'warn' : ''}`}>
              <span className="lbl">Stress</span>
              <span className="v"><CountUp to={stress != null ? stress : 0} /><span style={{ fontSize: 18, color: 'var(--ink-2)' }}> /6</span></span>
              <span className="d">mechanisms above Neutral</span>
            </div>
            <div className="s">
              <span className="lbl">Equity</span>
              <span className="v"><CountUp to={eqPct != null ? eqPct : 0} /><span style={{ fontSize: 18, color: 'var(--ink-2)' }}>%</span></span>
              <span className="d">{defPct === 0 ? 'no defensive sleeve' : `${defPct}% defensive`}</span>
            </div>
            <div className="s">
              <span className="lbl">Defensive</span>
              <span className="v"><CountUp to={defPct != null ? defPct : 0} /><span style={{ fontSize: 18, color: 'var(--ink-2)' }}>%</span></span>
              <span className="d">BIL · TLT · GLD · LQD</span>
            </div>
            <div className="s">
              <span className="lbl">Leverage</span>
              <span className="v">{lev != null ? lev.toFixed(2) : '—'}<span style={{ fontSize: 18, color: 'var(--ink-2)' }}>×</span></span>
              <span className="d">gross {v10?.gross_exposure?.toFixed(2) || '—'}×</span>
            </div>
          </div>
        </div>
      </header>

      <div className="v2-shell">
        {/* Theme #8: cycle mechanism strip lives only on Macro Overview.
            Asset Tilt links back, never re-renders.  Bug #1164. */}
        <a
          href="#overview"
          className="v2-cycle-link"
          title="The cycle mechanism board lives on Macro Overview. Click to see all six mechanisms."
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="t-eyebrow accent" style={{ marginRight: 4 }}>Cycle says</span>
            <span className="stance">{stance || '—'}</span>
          </span>
          <span className="cta">see Macro Overview →</span>
        </a>

        {/* 2-COL: SECTORS + TOP/BOTTOM */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, padding: '32px 0 0' }} className="v2-asset-grid">

          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line-0)', paddingBottom: 14, marginBottom: 14 }}>
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Sectors</h2>
              <span className="t-eyebrow">{sectors.length} GICS</span>
            </div>
            {sectors.map((s) => {
              const maxW = Math.max(...sectors.map((x) => x.weight));
              return (
                <div key={s.sector} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 60px 60px', gap: 14, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--line-0)', fontSize: 14 }}>
                  <span className={`v2-pill ${s.rating === 'OW' ? 'r-on' : s.rating === 'UW' ? 'r-off' : 'placeholder'}`}>{s.rating}</span>
                  <span style={{ color: 'var(--ink-0)' }}>{s.sector}</span>
                  <div style={{ height: 5, background: 'var(--bg-2)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'var(--accent)', width: `${(s.weight / maxW) * 100}%`, borderRadius: 'var(--r-pill)' }} />
                  </div>
                  <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 15, color: 'var(--ink-1)', fontFeatureSettings: '"tnum"', textAlign: 'right' }}>{(s.weight * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>

          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line-0)', paddingBottom: 14, marginBottom: 14 }}>
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Top &amp; bottom tilts</h2>
              <span className="t-eyebrow" title="The five industry groups with the largest overweight versus the five with the largest underweight.">Top 5 · bottom 5</span>
            </div>
            {top.map((ig) => (
              <div key={ig.id} onClick={() => setOpenIg(ig.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line-0)', fontSize: 13, cursor: 'pointer' }}>
                <div>
                  <div style={{ color: 'var(--ink-0)', fontSize: 13.5 }}>{ig.name}</div>
                  <div style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', marginTop: 2 }}>{ig.sector}</div>
                </div>
                <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 16, color: 'var(--up)', fontFeatureSettings: '"tnum"' }}>${(ig.dollar || 0).toFixed(0)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', color: 'var(--ink-2)', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 500 }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line-1)' }} />
              Underweight
              <span style={{ flex: 1, height: 1, background: 'var(--line-1)' }} />
            </div>
            {bot.map((ig) => (
              <div key={ig.id} onClick={() => setOpenIg(ig.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line-0)', fontSize: 13, cursor: 'pointer' }}>
                <div>
                  <div style={{ color: 'var(--ink-0)', fontSize: 13.5 }}>{ig.name}</div>
                  <div style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', marginTop: 2 }}>{ig.sector}</div>
                </div>
                <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 16, color: 'var(--down)', fontFeatureSettings: '"tnum"' }}>${(ig.dollar || 0).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FULL IG TABLE */}
        <div style={{ marginTop: 24, background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px 14px', borderBottom: '1px solid var(--line-0)', gap: 14, flexWrap: 'wrap' }}>
            <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Industry groups</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['all', `All ${igs.length}`], ['OW', 'Overweight'], ['MW', 'Marketweight'], ['UW', 'Underweight']].map(([k, lbl]) => (
                <button key={k} onClick={() => setIgFilter(k)} style={{
                  fontSize: 11, fontWeight: 500, padding: '6px 12px', borderRadius: 'var(--r-pill)',
                  background: igFilter === k ? 'var(--accent)' : 'var(--bg-2)',
                  color: igFilter === k ? '#1a1411' : 'var(--ink-1)',
                  border: igFilter === k ? '1px solid transparent' : '1px solid var(--line-1)',
                  cursor: 'pointer', letterSpacing: '.04em',
                }}>{lbl}</button>
              ))}
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Industry group', 'Sector', 'Tickers', 'Tilt', '$ exposure'].map((h, i) => (
                  <th key={h} style={{
                    textAlign: i === 4 ? 'right' : 'left',
                    padding: '14px 28px', fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase',
                    color: 'var(--ink-2)', fontWeight: 500, borderBottom: '1px solid var(--line-1)',
                    background: 'var(--bg-1)', position: 'sticky', top: 0,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {igsFiltered.map((ig) => (
                <tr key={ig.id} onClick={() => setOpenIg(ig.id)} style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-0)', fontWeight: 500 }}>
                    <span className={`v2-pill ${ig.rating === 'OW' ? 'r-on' : ig.rating === 'UW' ? 'r-off' : 'placeholder'}`} style={{ marginRight: 10, minWidth: 30, justifyContent: 'center' }}>{ig.rating}</span>
                    {ig.name}
                  </td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-1)' }}>{ig.sector}</td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-2)', fontSize: 11, fontFeatureSettings: '"tnum"', letterSpacing: '.04em' }}>{(ig.tickers || []).join(' · ')}</td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)' }}>
                    <span style={{ fontSize: 14, color: ig.tilt_score >= 0 ? 'var(--up)' : 'var(--down)' }}>
                      {ig.tilt_score >= 0 ? '↑' : '↓'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', textAlign: 'right' }}>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontFeatureSettings: '"tnum"', fontSize: 15, color: 'var(--ink-0)' }}>${ig.dollar?.toFixed(2)}K</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          v{(v10?.version || '10.1c').replace(/^v/, '')} · {v10?.engine || '6-mechanism cycle-board allocator'} · refreshed nightly 22:45 UTC
        </div>
      </div>

      <Drawer open={openIgRecord != null} onClose={() => setOpenIg(null)}>
        {openIgRecord && (
          <>
            <div className="t-eyebrow accent">{openIgRecord.sector} · industry group</div>
            <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>{openIgRecord.name}</h3>
            <div style={{ marginBottom: 8, color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em' }}>
              {(openIgRecord.tickers || []).map((t) => (
                <span key={t} style={{ display: 'inline-block', padding: '3px 8px', border: '1px solid var(--line-1)', borderRadius: 4, marginRight: 6, color: 'var(--ink-1)' }}>{t}</span>
              ))}
            </div>
            <div className="v2-drawer-grid">
              <div className="v2-drawer-stat">
                <div className="lbl">Position</div>
                <div className={`v ${openIgRecord.tilt_score >= 0 ? 'up' : 'down'}`} style={{ fontSize: 22 }}>
                  {openIgRecord.tilt_score >= 0 ? 'Overweight' : 'Underweight'}
                </div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">Rating</div>
                <div className="v">{openIgRecord.rating}</div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">$ exposure</div>
                <div className="v">${openIgRecord.dollar?.toFixed(2)}K</div>
              </div>
            </div>

            <div className="v2-drawer-section">
              <span className="t-eyebrow">Contribution by mechanism</span>
              {Object.entries(openIgRecord.contributions || {}).map(([m, v]) => {
                const up = v >= 0;
                const segW = Math.min(50, Math.abs(v) * 50);
                return (
                  <div key={m} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 80px', gap: 16, alignItems: 'center', padding: '8px 0', fontSize: 13 }}>
                    <span style={{ color: 'var(--ink-1)' }}>{MECH_LABELS[m] || m}</span>
                    <div style={{ position: 'relative', height: 14, display: 'flex', alignItems: 'center' }}>
                      <span style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'var(--line-1)' }} />
                      <span style={{
                        position: 'absolute', top: 3, height: 8, borderRadius: 2,
                        background: up ? 'var(--up)' : 'var(--down)',
                        ...(up ? { right: '50%', width: `${segW}%` } : { left: '50%', width: `${segW}%` }),
                      }} />
                    </div>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 14, fontFeatureSettings: '"tnum"', textAlign: 'right', color: up ? 'var(--up)' : 'var(--down)' }}>
                      {up ? '+' : ''}{v?.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Drawer>

      {err && (
        <div style={{ position: 'fixed', bottom: 16, left: 16, padding: '10px 16px', background: 'var(--bg-1)', border: '1px solid var(--down)', borderRadius: 8, color: 'var(--down)', fontSize: 12 }}>
          Asset Tilt: failed to load v10_allocation ({err}).
        </div>
      )}
    </div>
  );
}
