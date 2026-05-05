import React, { useEffect, useMemo, useState } from 'react';

export default function MethodologyPageV2() {
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    fetch('/data_manifest.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null).then(setManifest).catch(() => {});
  }, []);

  const sources = useMemo(() => {
    const els = manifest?.elements || {};
    const out = new Set();
    Object.values(els).forEach((e) => {
      const v = e?.source_vendor || e?.source || '';
      if (v) v.split(/[·,;|]/).forEach((s) => { const t = s.trim(); if (t) out.add(t); });
    });
    return Array.from(out).sort();
  }, [manifest]);

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
            <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>Methodology.</h1>
          </div>
          <p className="t-body" style={{ marginTop: 14, maxWidth: '62ch' }}>Every model, every threshold, every source. Sourced from the live data registry and shipped engine code.</p>
        </div>
      </header>
      <div className="v2-shell" style={{ marginTop: 32 }}>
        <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 32 }}>
          <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>v11 cycle framework</h2>
          <p className="t-body" style={{ maxWidth: '64ch' }}>MacroTilt scores the macro cycle across <strong style={{ color: 'var(--accent)' }}>six independent mechanisms</strong> (Valuation, Credit, Funding, Growth, Liquidity & Policy, Positioning & Breadth), each composed of 3-5 calibrated indicators. Mechanisms roll into a band: <strong style={{ color: 'var(--up)' }}>Risk On</strong>, <strong style={{ color: 'var(--info)' }}>Neutral</strong>, <strong style={{ color: 'var(--warn)' }}>Cautionary</strong>, <strong style={{ color: 'var(--down)' }}>Risk Off</strong>. The headline gauge counts how many mechanisms sit above Neutral.</p>

          <h3 className="t-tile" style={{ marginTop: 32, color: 'var(--ink-0)' }}>Allocator · v10.1c</h3>
          <p className="t-body" style={{ maxWidth: '64ch' }}>Phase 2 engine. Translates the 6 mechanism scores into <strong style={{ color: 'var(--accent)' }}>equity / defensive split</strong>, <strong style={{ color: 'var(--accent)' }}>leverage</strong>, and <strong style={{ color: 'var(--accent)' }}>per-IG tilts</strong> across 11 GICS sectors and 24 industry groups. Hard rules: defensive sleeve maxes at 50%, leverage maxes at 1.5×, defensive XOR leverage (never both at once).</p>

          <h3 className="t-tile" style={{ marginTop: 32, color: 'var(--ink-0)' }}>Sources</h3>
          <p className="t-body" style={{ maxWidth: '64ch', marginBottom: 18 }}>Every data element on the site is registered in <code style={{ background: 'var(--bg-2)', padding: '1px 6px', borderRadius: 4, color: 'var(--accent)', fontSize: 13 }}>data_manifest.json</code>. The list below is generated live from that registry — it stays in sync with what's actually wired.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {sources.length ? sources.map((s) => (
              <div key={s} style={{ padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--line-1)', fontSize: 13, color: 'var(--ink-0)' }}>{s}</div>
            )) : <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>Loading from data_manifest.json…</span>}
          </div>
        </div>
        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {sources.length} source vendors · {Object.keys(manifest?.elements || {}).length} elements registered
        </div>
      </div>
    </div>
  );
}
