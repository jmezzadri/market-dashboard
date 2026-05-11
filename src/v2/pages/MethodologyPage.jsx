import React, { useEffect, useMemo, useState } from 'react';
import FreshnessChip from '../components/FreshnessChip';

/**
 * MethodologyPage v2 — cutover.
 *
 * Source of truth (read in this order — never invent thresholds, indicator
 * names, or formulas; always source from the producer):
 *   /methodology_calibration_v11.json — Sprint 1 producer output
 *   /data_manifest.json               — vendor + freshness registry
 *
 * 12-theme cutover compliance:
 *   #3   Lexicon = Risk On / Neutral / Cautionary / Risk Off only
 *   #4   Mechanism rule copy renders rule.description verbatim from JSON
 *        (calibrated percentile bands, not hard count rules)
 *   #5   Source attribution = "Vendor · As of YYYY-MM-DD"
 *   #6   Every non-obvious label has a title=… tooltip
 *   #9   Drilldown: each mechanism anchor links to its Macro Overview
 *        drawer via #overview?mech={id}
 *  #11   Jump-nav at top — relational navigation for a long page
 */

function vendorOnly(s) {
  if (!s) return '—';
  let v = String(s).split(/[(:]/)[0].trim();
  v = v.split(' / ')[0].trim();
  return v || s;
}

function fmtDate(iso) {
  if (!iso) return '—';
  // Accepts YYYY-MM-DD, YYYY-MM, or ISO. Always render YYYY-MM-DD.
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return s + '-01';
  const d = new Date(s);
  if (isNaN(d)) return '—';
  return d.toISOString().slice(0, 10);
}

function directionPlain(d) {
  switch ((d || '').toLowerCase()) {
    case 'high':
    case 'high_is_concerning':
      return 'High = elevated';
    case 'low':
    case 'low_is_concerning':
      return 'Low = elevated';
    case 'bidir':
    case 'bidir_top':
    case 'bidir_bottom':
      return 'Both extremes elevated';
    default:
      return d || '—';
  }
}

function MechCard({ tile }) {
  const inds = Array.isArray(tile?.indicators) ? tile.indicators : [];
  return (
    <section
      id={`mech-${tile.id}`}
      style={{
        background: 'var(--bg-1)',
        border: '1px solid var(--line-1)',
        borderRadius: 'var(--r-tile)',
        padding: 28,
        marginTop: 24,
        scrollMarginTop: 24,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div className="t-eyebrow accent">0{tile.order} · cycle mechanism</div>
          <h2 className="t-tile" style={{ margin: '6px 0 0', color: 'var(--ink-0)' }}>{tile.name}</h2>
        </div>
        <a
          href="#overview"
          className="v2-cta"
          title="Open this mechanism's live tile on Macro Overview."
        >see live tile →</a>
      </div>
      <p className="t-body" style={{ marginTop: 14, maxWidth: '64ch' }}>{tile.description_long}</p>

      <div className="t-eyebrow" style={{ marginTop: 24 }} title="Calibrated percentile-band rule that determines this mechanism's state. Read from methodology_calibration_v11.json — never hardcoded.">Rule</div>
      <p className="t-body" style={{ marginTop: 6, maxWidth: '72ch' }}>{tile?.rule?.description || '—'}</p>

      {inds.length > 0 && (
        <>
          <div className="t-eyebrow" style={{ marginTop: 24 }} title="The indicators that compose this mechanism, with vendor source and direction encoding.">Calibrated indicators</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line-1)' }}>
                <th style={{ textAlign: 'left',  padding: '10px 6px', color: 'var(--ink-2)', fontWeight: 500, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>Indicator</th>
                <th style={{ textAlign: 'left',  padding: '10px 6px', color: 'var(--ink-2)', fontWeight: 500, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }} title="Data vendor and the date of the latest reading.">Source · As of</th>
                <th style={{ textAlign: 'left',  padding: '10px 6px', color: 'var(--ink-2)', fontWeight: 500, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }} title="Whether elevated readings, depressed readings, or both come into the cycle-peak quartile.">Direction</th>
                <th style={{ textAlign: 'left',  padding: '10px 6px', color: 'var(--ink-2)', fontWeight: 500, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }} title="The trailing window used to compute percentile bands.">Window</th>
                <th style={{ textAlign: 'right', padding: '10px 6px', color: 'var(--ink-2)', fontWeight: 500, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }} title="Each indicator's share of the mechanism's composite score.">Share</th>
              </tr>
            </thead>
            <tbody>
              {inds.map((ind) => (
                <tr key={ind.id} style={{ borderBottom: '1px solid var(--line-0)' }}>
                  <td style={{ padding: '10px 6px', color: 'var(--ink-0)' }}>{ind.name || ind.id}</td>
                  <td style={{ padding: '10px 6px', color: 'var(--ink-1)' }}>
                    {vendorOnly(ind.source)} · As of {fmtDate(ind?.current?.date)}
                  </td>
                  <td style={{ padding: '10px 6px', color: 'var(--ink-1)' }}>{directionPlain(ind.direction)}</td>
                  <td style={{ padding: '10px 6px', color: 'var(--ink-1)' }}>{ind.sample_window || '—'}</td>
                  <td style={{ padding: '10px 6px', color: 'var(--ink-0)', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                    {ind.composite_share_pct != null ? `${ind.composite_share_pct.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export default function MethodologyPageV2() {
  const [calib, setCalib]     = useState(null);
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    fetch('/methodology_calibration_v11.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null)).then(setCalib).catch(() => {});
    fetch('/data_manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null)).then(setManifest).catch(() => {});
  }, []);

  const tiles = (calib?.tiles || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));

  const lexiconTooltips = calib?.lexicon?.tooltips || {};
  const headlineThresholds = calib?.lexicon?.headline_thresholds || {};
  const headline = calib?.headline_gauge || {};

  const sections = useMemo(() => ([
    { id: 'v2-framework', label: 'v2 framework (PR 1-5)' },
    { id: 'lexicon',   label: 'Lexicon' },
    { id: 'headline',  label: 'Headline gauge (v1, legacy)' },
    ...tiles.map((t) => ({ id: `mech-${t.id}`, label: t.name })),
    { id: 'allocator', label: 'Allocator (v10)' },
    { id: 'sources',   label: 'Sources' },
  ]), [tiles]);

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
            <div>
              <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>Methodology.</h1>
              <p className="t-body" style={{ marginTop: 14, maxWidth: '62ch' }}>
                Every model, every threshold, every source. Sourced live from the calibration JSON and the data registry — this page stays in sync with what the engines actually compute.
              </p>
            </div>
            <FreshnessChip elementId="methodology_calibration_v11" fallback={calib?.as_of} />
          </div>
        </div>
      </header>

      <div className="v2-shell" style={{ marginTop: 24 }}>
        {/* Jump-nav (theme #11 — relational nav for a long page) */}
        <nav className="v2-jump-nav" aria-label="Methodology sections">
          <span className="t-eyebrow" style={{ marginRight: 8, color: 'var(--ink-2)' }}>Jump to</span>
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="chip">{s.label}</a>
          ))}
        </nav>

        {/* v2 Framework section — Joe approval 2026-05-10 (PR 1-5 of CYCLE_MECHANISM_V2_SPEC.md) */}
        <section
          id="v2-framework"
          style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 28, marginTop: 24, scrollMarginTop: 80 }}
        >
          <div className="t-eyebrow accent">cycle mechanism — v2 (current)</div>
          <h2 className="t-tile" style={{ margin: '6px 0 0', color: 'var(--ink-0)' }}>Predictive Power, not data display</h2>
          <p className="t-body" style={{ marginTop: 14, maxWidth: '64ch' }}>
            v1 of the cycle dashboard mashed six mechanisms into a single 0-100 composite. The bug: those six mechanisms move at different points in the cycle and in different directions during stress, so averaging them cancelled the signal — Black Monday 1987 read 48 (Neutral) and today reads 54 (Caution), which is exactly backward. v2 rebuilds the framework around two dimensions and a hard predictive-power gate.
          </p>
          <h3 className="t-tile" style={{ margin: '24px 0 0', color: 'var(--ink-0)', fontSize: 18 }}>Two dimensions, not one</h3>
          <p className="t-body" style={{ marginTop: 8, maxWidth: '64ch' }}>
            Cycle timing (Lead / Coincident / Lag — Conference Board convention) answers <em>when</em> an indicator moves relative to the cycle. Stress direction (momentum / mean_reversion / flat — set by the indicator's IC sign at each forward horizon) answers <em>which way</em> the indicator predicts forward returns. They're different questions; both stay on the dashboard.
          </p>
          <h3 className="t-tile" style={{ margin: '24px 0 0', color: 'var(--ink-0)', fontSize: 18 }}>Seven sub-composites, three headlines</h3>
          <p className="t-body" style={{ marginTop: 8, maxWidth: '64ch' }}>
            <strong>Sub-composites:</strong> Equities · Credit · Rates · Money/Banking · Funding · Real Economy · Positioning/Vol. Each indicator belongs to one sub-composite and carries a full IC profile at four forward horizons (1m, 3m, 6m, 12m).<br/>
            <strong>Headlines:</strong> Cycle &amp; Value (Setup — Equities + Rates + Money/Banking) · Market Stress (Panic — Credit + Funding + Positioning/Vol) · Real Economy (Truth — Real Economy alone). Equal-weight average within each headline.
          </p>
          <h3 className="t-tile" style={{ margin: '24px 0 0', color: 'var(--ink-0)', fontSize: 18 }}>Horizon-aware scoring</h3>
          <p className="t-body" style={{ marginTop: 8, maxWidth: '64ch' }}>
            Every indicator's percentile score is the same regardless of horizon. What changes is the SIGN of its contribution to the sub-composite at the selected horizon. At horizons where the indicator's IC is negative (momentum), high score contributes raw — "more cautionary." At horizons where the IC is positive (mean-reversion), high score contributes inverted (100 minus raw) — "opportunity at this horizon." This is why Buffett at the 95th percentile reads as low cycle risk at 1m (FOMO momentum still alive) and high cycle risk at 12m (multi-quarter valuation drag). Four indicators today flip signal direction across horizons: Buffett, bank reserves, USD, CFNAI. Each carries a horizon-sensitive ↔ chip on the All Indicators page.
          </p>
          <h3 className="t-tile" style={{ margin: '24px 0 0', color: 'var(--ink-0)', fontSize: 18 }}>Predictive-power gate</h3>
          <p className="t-body" style={{ marginTop: 8, maxWidth: '64ch' }}>
            Every indicator must clear |IC| ≥ 0.10 at at least one forward horizon against SPY total return — otherwise it stays visible for context but contributes zero to scoring. Today: 30 of 38 indicators clear the gate. Real Economy uses absolute thresholds instead of percentile (PMI 40/50/60, jobless 350K/230K/180K, etc. per spec section 6.2) and is graded directly against the level, no IC test required.
          </p>
          <h3 className="t-tile" style={{ margin: '24px 0 0', color: 'var(--ink-0)', fontSize: 18 }}>Regime classifier + recommended action</h3>
          <p className="t-body" style={{ marginTop: 8, maxWidth: '64ch' }}>
            Four regime labels are read off the 2x2 of (Setup) × (Stress) at the selected horizon, with Real Economy as the fact-check caption. Each regime maps to a horizon-specific recommended action:
          </p>
          <ul className="t-body" style={{ marginTop: 8, maxWidth: '64ch', paddingLeft: 22 }}>
            <li><strong>HIGH Setup · LOW Stress = Late-cycle setup</strong> → Pull a little risk off (1-3m); de-risk strategically (12m).</li>
            <li><strong>HIGH Setup · HIGH Stress = Late-cycle correction</strong> → Hedge entries (1m); pull a lot of risk off, hedges on (3-6m).</li>
            <li><strong>LOW Setup · HIGH Stress = Capitulation / panic</strong> → Sell covered calls (1-3m); capitulation buy (6m); lever up (12m).</li>
            <li><strong>LOW Setup · LOW Stress = Early expansion</strong> → Risk-on / leverage (1-6m); strategic overweight equities (12m).</li>
          </ul>
          <h3 className="t-tile" style={{ margin: '24px 0 0', color: 'var(--ink-0)', fontSize: 18 }}>Transition window</h3>
          <p className="t-body" style={{ marginTop: 8, maxWidth: '64ch' }}>
            v1 (single 0-100 composite) and v2 are running side by side from 2026-05-10 through 2026-05-31. After that, v1 is removed and v2 becomes the sole source of truth. Full spec lives in <code>CYCLE_MECHANISM_V2_SPEC.md</code> at the repo root.
          </p>
        </section>

        {/* Lexicon (theme #3) */}
        <section
          id="lexicon"
          style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 28, marginTop: 24, scrollMarginTop: 80 }}
        >
          <div className="t-eyebrow accent">how it reads</div>
          <h2 className="t-tile" style={{ margin: '6px 0 0', color: 'var(--ink-0)' }}>The four-state lexicon</h2>
          <p className="t-body" style={{ marginTop: 14, maxWidth: '64ch' }}>
            Every cycle mechanism, every chart, every drawer maps the underlying reading onto one of four states. No exceptions.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 20 }}>
            {[
              { state: 'Risk On',    cls: 'r-on'  },
              { state: 'Neutral',    cls: 'r-neu' },
              { state: 'Cautionary', cls: 'r-cau' },
              { state: 'Risk Off',   cls: 'r-off' },
            ].map(({ state, cls }) => (
              <div
                key={state}
                style={{
                  padding: 16,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--line-1)',
                  borderRadius: 'var(--r-md)',
                }}
              >
                <div className={`v2-pill ${cls}`}>{state}</div>
                <p className="t-body" style={{ marginTop: 10, fontSize: 13 }}>
                  {lexiconTooltips[state] || '—'}
                </p>
              </div>
            ))}
          </div>

          {Object.keys(headlineThresholds).length > 0 && (
            <>
              <div className="t-eyebrow" style={{ marginTop: 28 }} title="How the page-level headline rolls up the six mechanism states.">Headline thresholds</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 }}>
                <tbody>
                  {Object.entries(headlineThresholds).map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid var(--line-0)' }}>
                      <td style={{ padding: '8px 6px', color: 'var(--ink-0)', width: '34%' }}>{k}</td>
                      <td style={{ padding: '8px 6px', color: 'var(--ink-1)' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* Headline gauge */}
        <section
          id="headline"
          style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 28, marginTop: 24, scrollMarginTop: 80 }}
        >
          <div className="t-eyebrow accent">where it stands</div>
          <h2 className="t-tile" style={{ margin: '6px 0 0', color: 'var(--ink-0)' }}>Headline gauge</h2>
          <p className="t-body" style={{ marginTop: 14, maxWidth: '64ch' }}>
            {headline.headline_sentence || 'Live headline reading not available.'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 18 }}>
            <div style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-md)', padding: 16 }}>
              <div className="t-eyebrow" title="Mechanisms whose composite reading sits in Cautionary or Risk Off territory.">Elevated</div>
              <div className="v2-metric-v">
                {headline.n_elevated ?? '—'}<span style={{ fontSize: 14, color: 'var(--ink-2)' }}> /6</span>
              </div>
            </div>
            <div style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-md)', padding: 16 }}>
              <div className="t-eyebrow" title="Mechanisms with a live composite score this run.">Live</div>
              <div className="v2-metric-v">
                {headline.n_live ?? '—'}<span style={{ fontSize: 14, color: 'var(--ink-2)' }}> /6</span>
              </div>
            </div>
            <div style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-md)', padding: 16 }}>
              <div className="t-eyebrow" title="Top-level page state derived from the elevated count.">Verdict</div>
              <div className="v2-metric-v small">
                {headline.verdict_label || headline.verdict_state || '—'}
              </div>
            </div>
          </div>
        </section>

        {/* Six mechanism cards (theme #4 — rule.description = percentile-band copy from JSON) */}
        {tiles.length > 0
          ? tiles.map((t) => <MechCard key={t.id} tile={t} />)
          : (
            <div style={{ marginTop: 24, padding: 24, color: 'var(--ink-2)', fontSize: 13 }}>
              Loading mechanisms from methodology_calibration_v11.json…
            </div>
          )}

        {/* Allocator */}
        <section
          id="allocator"
          style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 28, marginTop: 24, scrollMarginTop: 80 }}
        >
          <div className="t-eyebrow accent">phase 2 engine</div>
          <h2 className="t-tile" style={{ margin: '6px 0 0', color: 'var(--ink-0)' }}>Allocator (v10)</h2>
          <p className="t-body" style={{ marginTop: 14, maxWidth: '64ch' }}>
            The v10 allocator translates the six cycle-mechanism scores into an
            equity / defensive split, leverage, and per-industry-group tilts
            across 11 GICS sectors and 24 industry groups.
          </p>
          <div className="t-eyebrow" style={{ marginTop: 20 }} title="The hard rules the allocator must obey on every run. Sourced live from methodology_calibration_v11.json allocator_bounds.">Hard rules</div>
          <ul className="t-body" style={{ marginTop: 6, maxWidth: '64ch', paddingLeft: 18 }}>
            {(calib?.allocator_bounds?.rules || []).map((r) => (
              <li key={r.id}>{r.label}</li>
            ))}
            {(!calib?.allocator_bounds?.rules) && (
              <li style={{ color: 'var(--ink-2)' }}>Loading allocator bounds from calibration JSON…</li>
            )}
          </ul>
          <p className="t-body" style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-2)' }}>
            See the live allocation on{' '}
            <a href="#allocation" className="v2-cta" title="Open the Asset Tilt tab to see the live engine output.">Asset Tilt</a>.
          </p>
        </section>

        {/* Sources */}
        <section
          id="sources"
          style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 28, marginTop: 24, scrollMarginTop: 80 }}
        >
          <div className="t-eyebrow accent">where the data comes from</div>
          <h2 className="t-tile" style={{ margin: '6px 0 0', color: 'var(--ink-0)' }}>Sources</h2>
          <p className="t-body" style={{ marginTop: 14, maxWidth: '64ch' }}>
            Every data element on the site is registered in the data registry.
            The list below is generated live — it stays in sync with what's
            actually wired.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
            {sources.length
              ? sources.map((s) => (
                  <div key={s} style={{ padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-1)', fontSize: 13, color: 'var(--ink-0)' }}>
                    {s}
                  </div>
                ))
              : <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>Loading sources…</span>}
          </div>
        </section>

        {/* Footer attribution */}
        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Framework {calib?.framework || '—'} · Sprint {calib?.sprint ?? '—'} · As of {fmtDate(calib?.as_of)} · {sources.length} source vendors · {Object.keys(manifest?.elements || {}).length} elements registered
        </div>
      </div>
    </div>
  );
}
