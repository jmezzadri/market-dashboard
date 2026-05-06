import React, { useEffect, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';

export default function ScenariosPageV2() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch('/scenario_allocations.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null).then(setData).catch(() => {});
  }, []);
  const rawScenarios = data?.scenarios ?? data?.canned;
  const scenarios = Array.isArray(rawScenarios)
    ? rawScenarios
    : (rawScenarios && typeof rawScenarios === 'object')
      ? Object.values(rawScenarios)
      : [];
  return (
    <div className="v2-root">
      <header className="v2-hero">
        <div className="arc" aria-hidden="true">
          <svg viewBox="0 0 600 600" preserveAspectRatio="xMaxYMid slice">
            <g transform="translate(420 300)">{[60,100,140,180,220,260,300,340].map((r) => <circle key={r} r={r} />)}</g>
          </svg>
        </div>
        <div className="v2-shell">
          <div className="v2-hero-row">
            <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>Scenarios.</h1>
            <FreshnessChip elementId="scenarios" fallback={data?.as_of} />
          </div>
        </div>
      </header>
      <div className="v2-shell" style={{ marginTop: 32 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18 }} className="v2-asset-grid">
          {scenarios.length === 0 && (
            <div style={{ gridColumn: 'span 2', textAlign: 'center', color: 'var(--ink-2)', padding: 48 }}>
              Loading scenarios…
            </div>
          )}
          {scenarios.map((s, i) => (
            <article key={i} className="v2-tile" style={{ minHeight: 'auto' }}>
              <span className="t-eyebrow accent">{s.label || s.eyebrow || s.period}</span>
              <h3 className="t-tile" style={{ margin: '8px 0 0', color: 'var(--ink-0)' }}>{s.name || s.title || s.scenario || '—'}</h3>
              {s.description && <p className="t-body" style={{ marginTop: 8 }}>{s.description}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 14, marginTop: 'auto' }}>
                {(Array.isArray(s.key_metrics) ? s.key_metrics : Array.isArray(s.kpis) ? s.kpis : []).slice(0, 3).map((k, j) => (
                  <div key={j} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-2)', marginBottom: 6 }}>{k.label}</div>
                    <div style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 22, fontFeatureSettings: '"tnum"', color: k.value < 0 ? 'var(--down)' : 'var(--up)' }}>{k.value > 0 ? '+' : ''}{k.value}{k.unit || ''}</div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
