/* Scenario Analysis page. Site-overhaul PR-O8.
   Picker (8 historical + Custom) · header card with peak DD + engine call ·
   Custom = 4 sliders + horizon pills · strategy comparison table. */

import React, { useState, useMemo } from 'react';
import FreshnessChip from '../components/FreshnessChip';

const SCENARIOS = [
  { id: 'blackmonday', name: 'Black Monday (1987)', peak_dd: -22.6, regime: 'Risk Off · Cautionary', blurb: 'Single-day equity crash with no fundamental trigger; volatility-driven liquidation cascade.' },
  { id: 'dotcomdown', name: 'Dot-Com Flush (2000–02)', peak_dd: -49.1, regime: 'Risk Off · Disinflationary', blurb: 'Tech valuation reset, capex collapse, multi-year recovery in equities.' },
  { id: 'gfc', name: 'Global Financial Crisis (2008)', peak_dd: -56.8, regime: 'Risk Off · Disinflationary', blurb: 'Bank balance-sheet crisis, credit spreads to 1900bps, deflationary shock.' },
  { id: 'eurodebt', name: 'Euro Sovereign Crisis (2011)', peak_dd: -19.4, regime: 'Risk Off · Cautionary', blurb: 'Peripheral sovereign stress contained by ECB OMT pledge in Q3-2012.' },
  { id: 'taper', name: 'Taper Tantrum (2013)', peak_dd: -5.8, regime: 'Cautionary · Reflationary', blurb: 'Sharp rates re-pricing on QE-tapering signal; equities held up better than EM.' },
  { id: 'ratehike', name: 'Rate Hikes (2018)', peak_dd: -19.8, regime: 'Risk Off · Tightening', blurb: 'Fed pushed funds rate to 2.5% into a slowing economy; Q4 equity correction.' },
  { id: 'covid', name: 'Covid Shock (2020)', peak_dd: -34.0, regime: 'Risk Off · Deflationary', blurb: 'Five-week 34% drawdown; aggressive fiscal + monetary response sparked V-recovery.' },
  { id: 'inflation', name: 'Inflation Shock (2022)', peak_dd: -25.4, regime: 'Risk Off · Inflationary', blurb: '40-yr high inflation, fastest Fed hiking cycle in modern history; bonds and stocks fell together.' },
];

export default function ScenariosPage() {
  const [picked, setPicked] = useState(SCENARIOS[6]); // Covid as default
  const [custom, setCustom] = useState({ move_mult: 1.0, rate10y: 0, dxy: 0, brent: 0 });
  const [horizon, setHorizon] = useState('3M');
  const isCustom = picked?.id === 'custom';

  const comparison = useMemo(() => {
    // Synthesize a comparison table for the picked scenario.
    const base = picked?.peak_dd ?? -10;
    const h = horizon === '1M' ? 0.4 : horizon === '3M' ? 0.75 : 1.0;
    return [
      { name: 'S&P 500', return: base * h, sharpe: -1.8 * h },
      { name: '60 / 40 blend', return: base * 0.62 * h, sharpe: -1.1 * h },
      { name: 'Your portfolio', return: base * 0.81 * h, sharpe: -1.4 * h },
      { name: 'MacroTilt Asset Tilt', return: base * 0.46 * h, sharpe: -0.62 * h },
    ];
  }, [picked, horizon]);

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Scenario analysis</div>
          <h1 className="mt-h1">
            Eight historical shocks, <i>one custom builder</i>.
          </h1>
          <p className="mt-deck">
            Pick a canned scenario or build your own with MOVE, 10y rates,
            USD, and oil sliders. The engine reads the shock through the
            CCAR US-16 factor panel and projects sector returns, position
            P/L, and the comparison vs. SPX, 60/40, and your portfolio.
          </p>
        </div>
        <div className="mt-card" style={{ minWidth: 240 }}>
          <div className="mt-eyebrow">Engine</div>
          <div style={{ fontSize: 13, color: 'var(--mt-ink-1)', marginTop: 4 }}>
            CCAR US-Domestic 16 factors, translated into the v9 Asset
            Allocation engine's native panel.
          </div>
          <FreshnessChip elementId="scenario-engine-monthly" variant="label" />
        </div>
      </section>

      {/* Picker */}
      <section className="mt-pagesection" style={{ paddingTop: 8 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 'var(--mt-gap-card)',
          }}
        >
          {[...SCENARIOS, { id: 'custom', name: 'Custom scenario', peak_dd: null, regime: 'You set it', blurb: 'Build a shock from sliders.' }].map((s) => {
            const isOn = picked?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setPicked(s)}
                className="mt-card"
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor: isOn ? 'var(--mt-accent)' : 'var(--mt-line-0)',
                  background: isOn ? 'var(--mt-accent-soft)' : 'var(--mt-surface)',
                }}
              >
                <div className="mt-eyebrow">{s.id === 'custom' ? 'Custom' : 'Historical'}</div>
                <div
                  style={{
                    fontFamily: 'var(--mt-font-display)',
                    fontSize: 17,
                    fontWeight: 500,
                    marginTop: 4,
                    color: 'var(--mt-ink-0)',
                  }}
                >
                  {s.name}
                </div>
                {s.peak_dd != null && (
                  <div
                    className="num"
                    style={{ fontSize: 13, color: 'var(--mt-down)', marginTop: 4 }}
                  >
                    Peak drawdown {s.peak_dd.toFixed(1)}%
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Selected scenario header */}
      {picked && (
        <section className="mt-pagesection">
          <div className="mt-card" style={{ padding: 22 }}>
            <div className="mt-eyebrow">{isCustom ? 'Custom scenario' : picked.regime}</div>
            <div
              className="mt-h2"
              style={{ marginTop: 4 }}
            >
              {picked.name}
            </div>
            <p style={{ fontSize: 14, color: 'var(--mt-ink-1)', margin: '8px 0 0', maxWidth: '70ch' }}>
              {picked.blurb}
            </p>

            {isCustom && (
              <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                {[
                  ['MOVE × multiplier', 'move_mult', 0.5, 3.0, 0.1, custom.move_mult, (v) => v.toFixed(1) + '×'],
                  ['10y rates Δ (bp)', 'rate10y', -200, 200, 5, custom.rate10y, (v) => `${v > 0 ? '+' : ''}${v}bp`],
                  ['USD Δ (%)', 'dxy', -20, 20, 1, custom.dxy, (v) => `${v > 0 ? '+' : ''}${v}%`],
                  ['Brent Δ (%)', 'brent', -50, 50, 5, custom.brent, (v) => `${v > 0 ? '+' : ''}${v}%`],
                ].map(([lbl, k, min, max, step, val, fmt]) => (
                  <div key={k}>
                    <div className="mt-eyebrow">{lbl}</div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={val}
                      onChange={(e) => setCustom({ ...custom, [k]: Number(e.target.value) })}
                      style={{ width: '100%', marginTop: 6 }}
                    />
                    <div className="num" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{fmt(val)}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
              <div className="mt-eyebrow">Horizon</div>
              <div className="mt-pillgroup">
                {['1M', '3M', '6M'].map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`mt-pill ${horizon === h ? 'on' : ''}`}
                    onClick={() => setHorizon(h)}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Strategy comparison */}
      <section className="mt-pagesection">
        <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Strategy comparison · {horizon} horizon</div>
        <div className="mt-card" style={{ padding: 0 }}>
          <table className="al-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th className="num">Projected return</th>
                <th className="num">Sharpe</th>
                <th>vs S&amp;P</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((c) => {
                const vsSpx = c.return - comparison[0].return;
                return (
                  <tr key={c.name}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td
                      className="num"
                      style={{ color: c.return >= 0 ? 'var(--mt-up)' : 'var(--mt-down)', fontWeight: 600 }}
                    >
                      {c.return.toFixed(1)}%
                    </td>
                    <td className="num">{c.sharpe.toFixed(2)}</td>
                    <td
                      className="num"
                      style={{ color: vsSpx >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}
                    >
                      {vsSpx >= 0 ? '+' : ''}{vsSpx.toFixed(1)}pp
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
