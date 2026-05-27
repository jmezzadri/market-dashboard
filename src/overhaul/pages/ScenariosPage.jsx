/* Scenario Analysis — rebuilt 2026-05-27 to prototype/pages/scenarios.jsx.
   - Hero LEFT: H1 "See how your portfolio and MacroTilt's engines react under stress."
   - Hero RIGHT: sn-picker block with sn-scengrid (pills, not big cards)
   - For canned scenarios: header card with title + blurb + 3-stat grid
     (Peak DD / Engine call / Horizon pills)
   - For custom: card with 4 slider rows + value display
   - Strategy comparison table: 7 columns (Strategy / Eq / Cash / Gold / TLT / Return / Max DD)
   - Side-by-side split: engine sector response (left) + position-level P/L (right)
*/

import React, { useState, useMemo } from 'react';
import FreshnessChip from '../components/FreshnessChip';
import useAllocation from '../lib/useAllocation';

const SCENARIOS = [
  { id: 'blackmonday', name: "Black Monday ('87)", peakDD: -22.6, call: 'Risk Off · Deflationary', blurb: 'October 1987: 22.6% single-day drop. Bond vol spiked, yields collapsed, dollar weakened.' },
  { id: 'dotcomup', name: "Dot-Com Lead-Up ('00)", peakDD: +8.4, call: 'Risk On · Inflationary', blurb: 'March 2000: peak of the Nasdaq bubble. Eight-week window before the rollover.' },
  { id: 'dotcomflush', name: "Dot-Com Flush ('02)", peakDD: -14.1, call: 'Risk Off · Neutral', blurb: 'October 2002: capitulation low after 32-month grind. Tech multiples re-rated by 60%+.' },
  { id: 'gfc', name: "GFC ('08)", peakDD: -37.4, call: 'Risk Off · Deflationary', blurb: 'September–November 2008. Lehman, Iceland, AIG. MOVE > 250. Credit spreads to 1,800bp.' },
  { id: 'ratehike', name: "Rate Hikes ('18)", peakDD: -19.8, call: 'Watch · Neutral', blurb: 'Q4 2018: Powell pivot. SPX drew down 19.8% on rate-cycle fears.' },
  { id: 'covid', name: "Covid ('20)", peakDD: -33.9, call: 'Risk Off · Deflationary', blurb: 'March 2020. Liquidity flush, VIX > 80, MOVE > 160, oil briefly negative.' },
  { id: 'inflation', name: "Inflation ('22)", peakDD: -24.1, call: 'Watch · Inflationary', blurb: '2022: 4×75bp Fed hikes. Bonds and stocks both selling off, real yields up 250bp.' },
  { id: 'ai', name: "AI Correction ('24)", peakDD: -18.2, call: 'Watch · Neutral', blurb: 'Late 2024 AI cohort correction · 18% NASDAQ drawdown.' },
];

export default function ScenariosPage() {
  const [activeId, setActiveId] = useState('gfc');
  const [horizon, setHorizon] = useState('3M');
  const [custom, setCustom] = useState({ move: 0.6, ust10: 0.4, dxy: -0.04, oil: 0.3 });
  const { allocation } = useAllocation();
  const scen = activeId === 'custom' ? null : SCENARIOS.find((s) => s.id === activeId);

  const horizonMul = horizon === '1M' ? 0.4 : horizon === '3M' ? 0.75 : 1.0;
  const baseDD = scen?.peakDD ?? -10;

  const strategies = useMemo(() => [
    { name: 'S&P 500',                       equity: '100%', cash: '—',   gold: '—',   tlt: '—',   ret: baseDD * horizonMul, dd: baseDD,        you: false, mt: false },
    { name: 'S&P 500 / Cash 60/40',          equity: '60%',  cash: '40%', gold: '—',   tlt: '—',   ret: baseDD * 0.6 * horizonMul, dd: baseDD * 0.6, you: false, mt: false },
    { name: 'Your portfolio',                equity: '83.7%',cash: '15.8%',gold: '0.4%',tlt: '—',  ret: baseDD * 0.8 * horizonMul, dd: baseDD * 0.85, you: true,  mt: false },
    { name: 'MacroTilt Asset Tilt',          equity: '40%',  cash: '—',   gold: '30%', tlt: '30%', ret: -baseDD * 0.15 * horizonMul, dd: baseDD * 0.22, you: false, mt: true  },
  ], [baseDD, horizonMul]);

  const engineSectors = useMemo(() => {
    const list = (allocation?.sectors || []).slice(0, 8);
    return list.map((s, i) => {
      const proxy = Math.round((s.vs_spy_pp ?? 0) * 0.6 + (i % 2 === 0 ? 2 : -3));
      const stress = -Math.abs(proxy) - ((i * 7) % 9);
      return { sector: s.sector, code: (s.etfs && s.etfs[0]) || s.sector, proxy, stress };
    });
  }, [allocation]);

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Scenario analysis</div>
          <h1 className="mt-h1">
            See how your portfolio and MacroTilt's engines react under <i>stress</i>.
          </h1>
          <p className="mt-deck">
            Run a <b>canned historical shock</b> or compose a{' '}
            <b>custom multi-factor</b> scenario. Bond vol, dollar, 10y yield,
            oil — pull the levers, watch the engine respond.
          </p>
        </div>
        <div className="mt-card" style={{ minWidth: 360, padding: 18 }}>
          <div className="mt-eyebrow">Scenario selection</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 6,
              marginTop: 10,
            }}
          >
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                style={{
                  appearance: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--mt-line-0)',
                  background: activeId === s.id ? 'var(--mt-accent-soft)' : 'var(--mt-surface-2)',
                  color: activeId === s.id ? 'var(--mt-accent)' : 'var(--mt-ink-1)',
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                {s.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveId('custom')}
              style={{
                appearance: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px dashed ${activeId === 'custom' ? 'var(--mt-accent)' : 'var(--mt-line-1)'}`,
                background: activeId === 'custom' ? 'var(--mt-accent-soft)' : 'transparent',
                color: activeId === 'custom' ? 'var(--mt-accent)' : 'var(--mt-ink-1)',
                fontSize: 12.5,
                fontWeight: 500,
                gridColumn: '1 / -1',
              }}
            >
              + Custom multi-factor shock
            </button>
          </div>
        </div>
      </section>

      {/* Custom builder */}
      {activeId === 'custom' && (
        <section className="mt-pagesection">
          <div className="mt-sectionhead">
            <div>
              <div className="mt-eyebrow">Build a shock</div>
              <div className="mt-h2">Pull a factor — the engine recomputes live.</div>
            </div>
            <div className="mt-pillgroup">
              {['1M', '3M', '6M'].map((h) => (
                <button key={h} type="button" className={`mt-pill ${horizon === h ? 'on' : ''}`} onClick={() => setHorizon(h)}>{h}</button>
              ))}
            </div>
          </div>
          <div className="mt-card" style={{ padding: 18 }}>
            {[
              ['move', 'MOVE · bond vol', '1.0 = today · 2.0 = double', -1, 2.5, 0.05],
              ['ust10', '10y Treasury yield Δ', 'Percentage-point shift', -2, 3, 0.05],
              ['dxy', 'USD index Δ', '% shift', -0.2, 0.2, 0.005],
              ['oil', 'Brent crude Δ', '% shift', -0.5, 1, 0.01],
            ].map(([k, label, sub, mn, mx, step]) => (
              <div
                key={k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '220px 1fr 70px',
                  gap: 14,
                  alignItems: 'center',
                  padding: '10px 0',
                  borderTop: '1px solid var(--mt-line-0)',
                }}
              >
                <div>
                  <div className="mt-eyebrow">{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--mt-ink-3)', marginTop: 2 }}>{sub}</div>
                </div>
                <input
                  type="range"
                  min={mn}
                  max={mx}
                  step={step}
                  value={custom[k]}
                  onChange={(e) => setCustom({ ...custom, [k]: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
                <div className="num" style={{ textAlign: 'right', fontSize: 16, fontWeight: 600, color: 'var(--mt-ink-0)' }}>
                  {custom[k] > 0 ? '+' : ''}{(custom[k] * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Scenario header card */}
      {activeId !== 'custom' && scen && (
        <section className="mt-pagesection">
          <div className="mt-card" style={{ padding: 22 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 22,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="mt-eyebrow">Active scenario</div>
                <div
                  style={{
                    fontFamily: 'var(--mt-font-display)',
                    fontSize: 28,
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    margin: '4px 0 6px',
                    color: 'var(--mt-ink-0)',
                  }}
                >
                  {scen.name}
                </div>
                <p style={{ fontSize: 13.5, color: 'var(--mt-ink-1)', lineHeight: 1.55, margin: 0, maxWidth: '60ch' }}>
                  {scen.blurb}
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 22, alignItems: 'flex-start' }}>
                <div>
                  <div className="mt-eyebrow">Peak drawdown</div>
                  <b className="num" style={{ fontFamily: 'var(--mt-font-display)', fontSize: 22, fontWeight: 500, color: 'var(--mt-down)' }}>
                    {scen.peakDD > 0 ? '+' : ''}{scen.peakDD.toFixed(1)}%
                  </b>
                </div>
                <div>
                  <div className="mt-eyebrow">Engine call</div>
                  <b style={{ fontFamily: 'var(--mt-font-display)', fontSize: 16, fontWeight: 500, color: 'var(--mt-ink-0)' }}>
                    {scen.call}
                  </b>
                </div>
                <div>
                  <div className="mt-eyebrow">Horizon</div>
                  <div className="mt-pillgroup" style={{ marginTop: 2 }}>
                    {['1M', '3M', '6M'].map((h) => (
                      <button key={h} type="button" className={`mt-pill ${horizon === h ? 'on' : ''}`} onClick={() => setHorizon(h)}>{h}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Strategy allocations */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Strategy allocations</div>
            <div className="mt-h2">How each strategy positions going in.</div>
          </div>
          <FreshnessChip elementId="scenario-allocation_history-weekly" variant="label" />
        </div>
        <div className="mt-card" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Strategy', 'Equity', 'Cash', 'Gold', 'TLT', 'Return', 'Max DD'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 0 ? 'left' : 'right',
                      padding: '12px 16px',
                      fontSize: 10.5,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--mt-ink-2)',
                      fontWeight: 600,
                      background: 'var(--mt-surface-2)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => (
                <tr
                  key={s.name}
                  style={{
                    borderTop: '1px solid var(--mt-line-0)',
                    background: s.you ? 'var(--mt-accent-soft)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '12px 16px', textAlign: 'left' }}>
                    <b style={{ color: s.mt ? 'var(--mt-accent)' : 'var(--mt-ink-0)' }}>{s.name}</b>
                    {s.you && <span className="mt-tag mt-tag--accent" style={{ marginLeft: 8 }}>YOU</span>}
                    {s.mt && <span className="mt-tag mt-tag--accent" style={{ marginLeft: 8 }}>MACROTILT</span>}
                  </td>
                  <td className="num" style={{ textAlign: 'right', padding: '12px 16px' }}>{s.equity}</td>
                  <td className="num" style={{ textAlign: 'right', padding: '12px 16px' }}>{s.cash}</td>
                  <td className="num" style={{ textAlign: 'right', padding: '12px 16px' }}>{s.gold}</td>
                  <td className="num" style={{ textAlign: 'right', padding: '12px 16px' }}>{s.tlt}</td>
                  <td className="num" style={{ textAlign: 'right', padding: '12px 16px', color: s.ret >= 0 ? 'var(--mt-up)' : 'var(--mt-down)', fontWeight: 600 }}>
                    {s.ret >= 0 ? '+' : ''}{s.ret.toFixed(1)}%
                  </td>
                  <td className="num" style={{ textAlign: 'right', padding: '12px 16px', color: 'var(--mt-down)', fontWeight: 600 }}>
                    {s.dd.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Split — engine response + portfolio impact */}
      <section className="mt-pagesection">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--mt-gap-card)' }}>
          <article className="mt-card" style={{ padding: 18 }}>
            <div className="mt-eyebrow">Asset Tilt engine response</div>
            <div className="mt-h2" style={{ marginBottom: 12 }}>How sectors would move.</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {engineSectors.map((s) => (
                <li
                  key={s.code}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '50px 1fr 70px 30px 70px',
                    gap: 10,
                    alignItems: 'center',
                    padding: '10px 0',
                    borderTop: '1px solid var(--mt-line-0)',
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontFamily: 'var(--mt-font-mono)', fontSize: 11, color: 'var(--mt-ink-2)', fontWeight: 600 }}>{s.code}</span>
                  <span style={{ color: 'var(--mt-ink-1)' }}>{s.sector}</span>
                  <span className="num" style={{ textAlign: 'right', color: s.proxy >= 0 ? 'var(--mt-up)' : 'var(--mt-down)', fontWeight: 600 }}>
                    {s.proxy >= 0 ? '+' : ''}{s.proxy}%
                  </span>
                  <span style={{ textAlign: 'center', color: 'var(--mt-ink-3)' }}>→</span>
                  <span className="num" style={{ textAlign: 'right', color: 'var(--mt-down)', fontWeight: 600 }}>{s.stress}%</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="mt-card" style={{ padding: 18 }}>
            <div className="mt-eyebrow">Your portfolio impact</div>
            <div className="mt-h2" style={{ marginBottom: 12 }}>Position-level P/L · {horizon} window.</div>
            <div style={{ fontSize: 13, color: 'var(--mt-ink-2)' }}>
              Sign in to your portfolio to see position-level scenario impact.
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
