/* Asset Tilt — rebuilt 2026-05-27 to prototype/pages/tilt.jsx.
   - Stress gauge tracks MOVE (max 200, thresholds 116 / 124)
   - Yield gauge bidirectional 3M Δ 10y (max 100, thresholds -11 / +32 bp)
   - Stance card shows allocation + sleeve composition (NOT mechanism scores)
   - Backtest 2×2 grid with vs-SPY sublines per cell
   - SectorFlow drill with view toggle + OW/UW totals + Apply-to-portfolio button
   - Regime history strip: 24 weekly cells colored by stress + regime stage
*/

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import BigGauge, { GaugeLegend } from '../components/BigGauge';
import Sparkline from '../components/Sparkline';
import Tip from '../components/Tip';
import SectorFlow from '../components/SectorFlow';
import useAllocation from '../lib/useAllocation';
import useEngineRegime from '../lib/useEngineRegime';

function fmtPercent(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}`;
}

export default function TiltPage() {
  const { allocation, loading } = useAllocation();
  const regime = useEngineRegime();
  const [expandedSectors, setExpandedSectors] = useState(new Set());
  const [expandedIGs, setExpandedIGs] = useState(new Set());
  const [sectorView, setSectorView] = useState('tilt');
  const navigate = useNavigate();

  const equityPct = allocation?.equity_pct ?? null;
  const defPct = allocation?.defensive_pct ?? null;
  const stance = regime.regimeLabel;
  const sleeve = regime.sleeveMix;

  const sectors = useMemo(() => {
    return (allocation?.sectors || [])
      .slice()
      .sort((a, b) => (b.vs_spy_pp ?? 0) - (a.vs_spy_pp ?? 0));
  }, [allocation]);

  const igsBySector = useMemo(() => {
    const out = {};
    (allocation?.industry_groups || []).forEach((ig) => {
      out[ig.sector] = out[ig.sector] || [];
      out[ig.sector].push(ig);
    });
    return out;
  }, [allocation]);

  const owUw = useMemo(() => {
    const ow = sectors.filter((s) => (s.vs_spy_pp ?? 0) > 0);
    const uw = sectors.filter((s) => (s.vs_spy_pp ?? 0) < 0);
    return {
      owCount: ow.length,
      owSum: ow.reduce((s, x) => s + (x.vs_spy_pp ?? 0), 0),
      uwCount: uw.length,
      uwSum: uw.reduce((s, x) => s + (x.vs_spy_pp ?? 0), 0),
    };
  }, [sectors]);

  const toggleSector = (id) => {
    const n = new Set(expandedSectors);
    if (n.has(id)) n.delete(id); else n.add(id);
    setExpandedSectors(n);
  };
  const toggleIG = (id) => {
    const n = new Set(expandedIGs);
    if (n.has(id)) n.delete(id); else n.add(id);
    setExpandedIGs(n);
  };

  // 24-week mock history for the sparklines + regime strip.
  // Real history would come from /allocation_history.json — left wired for next pass.
  const stressHist = useMemo(
    () => Array.from({ length: 24 }, (_, i) => 70 + Math.sin(i * 0.6) * 12 + ((i * 13) % 7 - 3)),
    [],
  );
  const yieldHist = useMemo(
    () => Array.from({ length: 24 }, (_, i) => 20 + Math.cos(i * 0.5) * 22 + ((i * 19) % 9 - 4)),
    [],
  );

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Asset Tilt · today's call</div>
          <h1
            className="mt-h1"
            style={{ fontSize: 'clamp(44px, 5.5vw, 76px)', letterSpacing: '-0.035em', lineHeight: 0.95 }}
          >
            <span className="num">{fmtPercent(equityPct, 0)}</span>
            <i style={{ fontStyle: 'italic', color: 'var(--mt-accent)' }}>% equity</i>
            <span style={{ color: 'var(--mt-ink-2)', margin: '0 0.25em' }}> · </span>
            <span className="num" style={{ color: 'var(--mt-ink-2)' }}>{fmtPercent(defPct, 0)}</span>
            <i style={{ fontStyle: 'italic', color: 'var(--mt-ink-2)' }}>% defensive</i>
          </h1>
          <p className="mt-deck">
            <b>
              {regime.stressZone || '—'} ·{' '}
              <i style={{ color: regime.yieldColor }}>{regime.yieldRegime || '—'}</i>{' '}
              regime.
            </b>{' '}
            Bond-market volatility (MOVE) and the 3-month change in 10y yield set the regime and equity exposure.
            Sector tilts within the equity bucket key off six factor reads.
            Defensive sleeve fires only when stress crosses Watch.{' '}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); navigate('/methodology#tilt'); }}
              style={{ color: 'var(--mt-accent)' }}
            >
              Read the full methodology →
            </a>
          </p>
        </div>
        <div className="mt-card" style={{ minWidth: 320, padding: 18 }}>
          <div className="mt-eyebrow">Backtest · 1986–2026</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 14,
              marginTop: 10,
            }}
          >
            <BacktestCell label="CAGR" value="11.93" unit="%" vs="vs SPY 11.16%" />
            <BacktestCell label="Sharpe" value="0.61" vs="vs SPY 0.47" />
            <BacktestCell label="Max DD" value="−32.1" unit="%" down vs="vs SPY −54.6%" />
            <BacktestCell label="Validated" value="2,056" unit="w" vs="weekly rebal" />
          </div>
        </div>
      </section>

      {/* Today's engine read */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Today's engine read</div>
            <div className="mt-h2">
              {regime.stressZone || '—'} ·{' '}
              <span style={{ color: regime.yieldColor }}>{regime.yieldRegime || '—'}</span>
              {' '}— {fmtPercent(equityPct, 0)}% equity, defensive {sleeve ? 'firing' : 'on standby'}.
            </div>
          </div>
          <FreshnessChip elementId="v10-allocation-daily" variant="pill" label="Engine in cadence" />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 'var(--mt-gap-card)',
          }}
        >
          {/* Stress signal · MOVE */}
          <article className="mt-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div className="mt-eyebrow">Stress signal · MOVE</div>
              <div className="mt-pillgroup">
                <button type="button" className={`mt-pill ${regime.stressZone === 'Risk On' ? 'on' : ''}`}>RISK ON</button>
                <button type="button" className={`mt-pill ${regime.stressZone === 'Watch' ? 'on' : ''}`}>WATCH</button>
                <button type="button" className={`mt-pill ${regime.stressZone === 'Risk Off' ? 'on' : ''}`}>RISK OFF</button>
              </div>
            </div>
            <BigGauge
              value={regime.move ?? 0}
              max={200}
              thresholds={[{ pos: 116 / 200 }, { pos: 124 / 200 }]}
            />
            <GaugeLegend
              zones={[
                { kind: 'up', label: 'Risk On', range: '≤ 116' },
                { kind: 'warn', label: 'Watch', range: '116–124' },
                { kind: 'down', label: 'Risk Off', range: '≥ 124' },
              ]}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
              <span
                className="num"
                style={{ fontFamily: 'var(--mt-font-display)', fontSize: 22, fontWeight: 500, color: 'var(--mt-ink-0)' }}
              >
                {regime.move != null ? regime.move.toFixed(1) : '—'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>
                {regime.movePct != null ? `${regime.movePct}th pctile · 5y` : '—'}
              </span>
            </div>
            <div className="mt-eyebrow" style={{ marginTop: 12 }}>24-week history</div>
            <div style={{ color: 'var(--mt-accent)' }}>
              <Sparkline data={stressHist} width={520} height={56} stroke="var(--mt-accent)" fill="var(--mt-accent)" area />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mt-ink-3)', marginTop: 4 }} className="num">
              <span>24W</span><span>NOW</span>
            </div>
          </article>

          {/* Yield regime · 3M Δ 10y */}
          <article className="mt-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div className="mt-eyebrow">Yield regime · 3M Δ 10y</div>
              <div className="mt-pillgroup">
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Deflationary' ? 'on' : ''}`}>DEFL.</button>
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Neutral' ? 'on' : ''}`}>NEUTRAL</button>
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Inflationary' ? 'on' : ''}`}>INFL.</button>
              </div>
            </div>
            <BigGauge
              value={regime.yieldDeltaBp ?? 0}
              max={100}
              bidirectional
              thresholds={[{ pos: (100 - 11) / 200 }, { pos: (100 + 32) / 200 }]}
            />
            <GaugeLegend
              zones={[
                { kind: 'up', label: 'Deflationary', range: '≤ −11 bp' },
                { kind: 'warn', label: 'Neutral', range: '−11 / +32' },
                { kind: 'down', label: 'Inflationary', range: '≥ +32 bp' },
              ]}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
              <span
                className="num"
                style={{ fontFamily: 'var(--mt-font-display)', fontSize: 22, fontWeight: 500, color: 'var(--mt-ink-0)' }}
              >
                {regime.yieldDeltaBp != null ? `${regime.yieldDeltaBp >= 0 ? '+' : ''}${regime.yieldDeltaBp.toFixed(0)}` : '—'}
                <span style={{ fontSize: 13, color: 'var(--mt-ink-2)', marginLeft: 4, fontWeight: 400 }}>bp</span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>
                {regime.yieldPct != null ? `${regime.yieldPct}th pctile · 5y` : '—'}
              </span>
            </div>
            <div className="mt-eyebrow" style={{ marginTop: 12 }}>24-week history</div>
            <div style={{ color: 'var(--mt-warn)' }}>
              <Sparkline data={yieldHist} width={520} height={56} stroke="var(--mt-warn)" fill="var(--mt-warn)" area />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mt-ink-3)', marginTop: 4 }} className="num">
              <span>24W</span><span>NOW</span>
            </div>
          </article>

          {/* Stance card — allocation + sleeve composition */}
          <article className="mt-card" style={{ padding: 18 }}>
            <div className="mt-eyebrow">Allocation</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
              <span
                className="num"
                style={{ fontFamily: 'var(--mt-font-display)', fontSize: 56, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--mt-ink-0)' }}
              >
                {fmtPercent(equityPct, 0)}
                <span style={{ fontSize: 22, color: 'var(--mt-ink-2)', fontStyle: 'italic', fontWeight: 400 }}>%</span>
              </span>
              <span style={{ fontSize: 14, color: 'var(--mt-ink-1)' }}>equity</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
              <span
                className="num"
                style={{ fontFamily: 'var(--mt-font-display)', fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--mt-ink-2)' }}
              >
                {fmtPercent(defPct, 0)}
                <span style={{ fontSize: 16, color: 'var(--mt-ink-3)', fontStyle: 'italic' }}>%</span>
              </span>
              <span style={{ fontSize: 13, color: 'var(--mt-ink-2)' }}>defensive</span>
            </div>
            <div className="mt-divider" />
            <p style={{ fontSize: 12.5, color: 'var(--mt-ink-2)', lineHeight: 1.5, margin: 0 }}>
              Defensive sleeve on{' '}
              <Tip content="Activates when stress signal crosses Watch threshold (MOVE > 116).">
                <b>{sleeve ? 'firing' : 'standby'}</b>
              </Tip>{' '}
              — would compose{' '}
              {sleeve ? (
                <>
                  <b className="num">{sleeve.gold}% gold</b>,{' '}
                  <b className="num">{sleeve.tlt}% TLT</b>,{' '}
                  <b className="num">{sleeve.cash}% cash</b>
                </>
              ) : (
                <>
                  <b className="num">12% gold</b>, <b className="num">9% TLT</b>, <b className="num">4% cash</b>
                </>
              )}{' '}
              in this {(regime.yieldRegime || 'neutral').toLowerCase()} regime.
            </p>
          </article>
        </div>
      </section>

      {/* Equity bucket · sector tilts */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Equity bucket · sector tilts</div>
            <div className="mt-h2">Where the engine wants overweight — and what's underneath.</div>
          </div>
          <div className="mt-pillgroup">
            {[['tilt', 'Tilt vs cap'], ['weight', 'Weight'], ['score', 'Score']].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`mt-pill ${sectorView === k ? 'on' : ''}`}
                onClick={() => setSectorView(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            Loading allocation…
          </div>
        ) : (
          <SectorFlow
            sectors={sectors}
            igsBySector={igsBySector}
            expandedSectors={expandedSectors}
            expandedIGs={expandedIGs}
            toggleSector={toggleSector}
            toggleIG={toggleIG}
            view={sectorView}
          />
        )}
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 12.5,
            color: 'var(--mt-ink-2)',
            flexWrap: 'wrap',
          }}
        >
          <span>
            <b style={{ color: 'var(--mt-up)' }}>Overweight</b> · {owUw.owCount} sectors ·{' '}
            <b className="num up">+{owUw.owSum.toFixed(1)}pp</b>
          </span>
          <span style={{ width: 1, height: 12, background: 'var(--mt-line-1)' }} />
          <span>
            <b style={{ color: 'var(--mt-down)' }}>Underweight</b> · {owUw.uwCount} sectors ·{' '}
            <b className="num down">{owUw.uwSum.toFixed(1)}pp</b>
          </span>
          <span style={{ width: 1, height: 12, background: 'var(--mt-line-1)' }} />
          <FreshnessChip elementId="v10-allocation-daily" variant="label" />
          <span style={{ marginLeft: 'auto' }}>
            <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate('/portfolio')}>
              Apply to my portfolio →
            </button>
          </span>
        </div>
      </section>

      {/* Regime history · 24 weeks */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Regime history · 24 weeks</div>
            <div className="mt-h2">When the engine moved.</div>
          </div>
        </div>
        <div className="mt-card" style={{ padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 4, marginBottom: 12 }}>
            {Array.from({ length: 24 }).map((_, i) => {
              const stage = i < 6 ? 'neutral' : i < 12 ? 'infl' : i < 18 ? 'neutral' : 'infl';
              const stress = i < 8 ? 'on' : i < 14 ? 'watch' : 'on';
              const bg =
                stress === 'on' && stage === 'infl' ? 'color-mix(in oklab, var(--mt-up) 30%, var(--mt-warn) 30%)' :
                stress === 'on' ? 'var(--mt-up)' :
                stress === 'watch' && stage === 'infl' ? 'var(--mt-warn)' :
                'var(--mt-ink-3)';
              return (
                <Tip
                  key={i}
                  bare
                  block
                  content={`Week ${i + 1}: ${stress === 'on' ? 'Risk On' : 'Watch'} · ${stage === 'infl' ? 'Inflationary' : 'Neutral'}`}
                >
                  <div
                    style={{
                      height: 38,
                      borderRadius: 4,
                      background: bg,
                      opacity: 0.85,
                    }}
                  />
                </Tip>
              );
            })}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 14,
              fontSize: 11.5,
              color: 'var(--mt-ink-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-up)' }} /> Risk On
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-warn)' }} /> Watch
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-down)' }} /> Risk Off
            </span>
            <span style={{ width: 1, height: 12, background: 'var(--mt-line-1)' }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-ink-3)' }} /> Neutral
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-warn)' }} /> Inflationary
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mt-up)' }} /> Deflationary
            </span>
            <span className="num" style={{ marginLeft: 'auto', color: 'var(--mt-ink-3)' }}>
              24 weeks · rebalanced weekly
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function BacktestCell({ label, value, unit, vs, down }) {
  return (
    <div>
      <div className="mt-eyebrow">{label}</div>
      <div
        className="num"
        style={{
          fontFamily: 'var(--mt-font-display)',
          fontSize: 24,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          marginTop: 2,
          color: down ? 'var(--mt-down)' : 'var(--mt-ink-0)',
          lineHeight: 1.0,
        }}
      >
        {value}
        {unit && (
          <span style={{ fontSize: 14, color: 'var(--mt-ink-2)', fontStyle: 'italic', marginLeft: 2 }}>{unit}</span>
        )}
      </div>
      <div className="num" style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginTop: 2 }}>{vs}</div>
    </div>
  );
}
