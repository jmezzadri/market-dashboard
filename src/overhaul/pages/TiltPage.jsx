/* Asset Tilt page. Site-overhaul PR-O4.
   - Hero headline is the NOMINAL allocation in monumental display type.
   - Two BigGauges (Stress signal + Mechanism scores summary) with 3-card legends.
   - Sector flow: full sector list with tilt + IG breakdown on row click.
*/

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import BigGauge, { GaugeLegend } from '../components/BigGauge';
import useAllocation from '../lib/useAllocation';

function fmtPct(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export default function TiltPage() {
  const { allocation, loading } = useAllocation();
  const [openSector, setOpenSector] = useState(null);
  const navigate = useNavigate();

  const equityPct = allocation?.equity_pct ?? null;
  const defPct = allocation?.defensive_pct ?? null;
  const stress = allocation?.stress_score ?? null;
  const mech = allocation?.mechanism_scores || {};
  const bands = allocation?.mechanism_bands || {};

  // Avg mechanism score as a summary "yield regime" gauge value.
  const mechAvg = useMemo(() => {
    const vs = Object.values(mech).filter(Number.isFinite);
    if (!vs.length) return null;
    return vs.reduce((s, v) => s + v, 0) / vs.length;
  }, [mech]);

  const sectors = (allocation?.sectors || [])
    .slice()
    .sort((a, b) => (b.tilt_score ?? 0) - (a.tilt_score ?? 0));

  const igsBySector = useMemo(() => {
    const out = {};
    (allocation?.industry_groups || []).forEach((ig) => {
      out[ig.sector] = out[ig.sector] || [];
      out[ig.sector].push(ig);
    });
    return out;
  }, [allocation]);

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Asset Tilt · today</div>
          <h1
            className="mt-h1"
            style={{
              fontSize: 'clamp(48px, 6vw, 84px)',
              letterSpacing: '-0.035em',
              lineHeight: 0.95,
            }}
          >
            <span className="num">{fmtPct(equityPct, 0)}</span>{' '}
            <i>equity</i>
            <span style={{ color: 'var(--mt-ink-2)' }}> · </span>
            <span className="num">{fmtPct(defPct, 0)}</span>{' '}
            <span style={{ color: 'var(--mt-ink-1)' }}>defensive</span>
          </h1>
          <p className="mt-deck">
            The engine reads the regime and produces this nominal allocation
            across 25 industry groups plus four defensive sleeves. Backtested
            on 40 years of data; validated against the S&amp;P 500 on Sharpe.
          </p>
        </div>
        <div
          className="mt-card"
          style={{ minWidth: 240, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <div className="mt-eyebrow">Backtest 1986–2026</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>CAGR</span><b className="num">14.2%</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Sharpe</span><b className="num">0.82</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Max DD</span><b className="num">−24.1%</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>Validated</span>
            <FreshnessChip elementId="v9-asset-allocation-daily" variant="dot" />
          </div>
        </div>
      </section>

      {/* Engine read row — two BigGauges + stance card */}
      <section className="mt-pagesection">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--mt-gap-card)',
          }}
        >
          <div className="mt-card">
            {/* stress_score from the v10 engine is on a 0-5 scale, not 0-1.
                Don't multiply by 100. Gauge buckets: 0-1.5 calm, 1.5-3 caution, 3-5 risk-off. */}
            <BigGauge
              value={stress}
              min={0}
              max={5}
              thresholds={[1.5, 3]}
              label="Stress signal"
              size={240}
            />
            <GaugeLegend
              zones={[
                { label: 'Risk On', range: '0 – 1.5', color: 'var(--mt-up)' },
                { label: 'Cautionary', range: '1.5 – 3', color: 'var(--mt-warn)' },
                { label: 'Risk Off', range: '3 – 5', color: 'var(--mt-down)' },
              ]}
            />
          </div>
          <div className="mt-card">
            <BigGauge
              value={mechAvg}
              min={0}
              max={100}
              thresholds={[40, 70]}
              label="Mechanism average"
              size={240}
            />
            <GaugeLegend
              zones={[
                { label: 'Loose', range: '0 – 40', color: 'var(--mt-up)' },
                { label: 'Tightening', range: '40 – 70', color: 'var(--mt-warn)' },
                { label: 'Tight', range: '70 – 100', color: 'var(--mt-down)' },
              ]}
            />
          </div>
          <div className="mt-card">
            <div className="mt-eyebrow">Page stance</div>
            <div
              style={{
                fontFamily: 'var(--mt-font-display)',
                fontSize: 28,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                margin: '4px 0 10px',
                color: 'var(--mt-ink-0)',
              }}
            >
              {allocation?.page_stance || 'Reading…'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--mt-ink-2)', marginBottom: 12 }}>
              Six mechanism scores from the v11 framework. Each rolls dozens
              of indicator inputs into a single 0–100 reading.
            </div>
            {Object.entries(mech).map(([k, v]) => {
              const band = bands[k] || 'neutral';
              const color =
                band === 'risk-off'
                  ? 'var(--mt-down)'
                  : band === 'caution'
                    ? 'var(--mt-warn)'
                    : 'var(--mt-up)';
              const display = k
                .replace(/_/g, ' & ')
                .replace(/\b\w/g, (c) => c.toUpperCase());
              return (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 0',
                    fontSize: 13,
                  }}
                >
                  <span>{display}</span>
                  <span
                    className="num"
                    style={{ fontWeight: 600, color }}
                  >
                    {v}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Sector flow */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Sector flow</div>
            <div className="mt-h2">Eleven sectors, ranked by tilt.</div>
          </div>
          <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate('/methodology#tilt')}>
            Read methodology →
          </button>
        </div>
        {loading ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            Loading allocation…
          </div>
        ) : (
          <div className="mt-card" style={{ padding: 0 }}>
            {sectors.map((s) => {
              const isOpen = openSector === s.sector;
              const tilt = s.vs_spy_pp ?? 0;
              const color = tilt > 0 ? 'var(--mt-up)' : tilt < 0 ? 'var(--mt-down)' : 'var(--mt-ink-2)';
              const igs = igsBySector[s.sector] || [];
              return (
                <div
                  key={s.sector}
                  style={{ borderBottom: '1px solid var(--mt-line-0)' }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenSector(isOpen ? null : s.sector)}
                    style={{
                      appearance: 'none',
                      border: 'none',
                      background: isOpen ? 'var(--mt-surface-3)' : 'transparent',
                      width: '100%',
                      padding: '14px 18px',
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto auto',
                      gap: 16,
                      alignItems: 'center',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: 14,
                      color: 'var(--mt-ink-0)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 11,
                          opacity: 0.6,
                          transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                          transition: 'transform var(--mt-dur-fast) var(--mt-ease)',
                        }}
                      >
                        ›
                      </span>
                      <span style={{ fontWeight: 600 }}>{s.sector}</span>
                      <span
                        style={{
                          fontSize: 10.5,
                          color: 'var(--mt-ink-3)',
                          marginLeft: 6,
                          fontFamily: 'var(--mt-font-mono)',
                        }}
                      >
                        {(s.etfs || []).join(' · ')}
                      </span>
                    </div>
                    <span className="num" style={{ color: 'var(--mt-ink-2)', fontSize: 12 }}>
                      {fmtPct(s.spy_weight, 1)} S&amp;P
                    </span>
                    <span
                      className={`mt-tag ${tilt > 0 ? 'mt-tag--calm' : tilt < 0 ? 'mt-tag--extreme' : 'mt-tag--range'}`}
                    >
                      {s.rating}
                    </span>
                    <span
                      className="num"
                      style={{ color, fontWeight: 600, minWidth: 70, textAlign: 'right' }}
                    >
                      {tilt > 0 ? '+' : ''}{tilt.toFixed(1)}pp
                    </span>
                  </button>
                  {isOpen && (
                    <div
                      style={{ padding: '0 18px 14px 44px', background: 'var(--mt-surface-2)' }}
                      className="mt-fade"
                    >
                      <div className="mt-eyebrow" style={{ paddingTop: 10, marginBottom: 6 }}>
                        Industry groups
                      </div>
                      {igs.length === 0 && (
                        <div style={{ color: 'var(--mt-ink-2)', fontSize: 12, padding: '6px 0' }}>
                          No industry-group detail for this sector.
                        </div>
                      )}
                      {igs.map((ig) => (
                        <div
                          key={ig.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto auto',
                            gap: 12,
                            alignItems: 'center',
                            padding: '8px 0',
                            borderTop: '1px solid var(--mt-line-0)',
                            fontSize: 13,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>{ig.name}</div>
                            <div
                              style={{
                                fontSize: 10.5,
                                color: 'var(--mt-ink-3)',
                                fontFamily: 'var(--mt-font-mono)',
                              }}
                            >
                              {(ig.tickers || []).join(' · ')}
                            </div>
                          </div>
                          <span className={`mt-tag ${ig.rating === 'OW' ? 'mt-tag--calm' : ig.rating === 'UW' ? 'mt-tag--extreme' : 'mt-tag--range'}`}>
                            {ig.rating}
                          </span>
                          <span
                            className="num"
                            style={{
                              minWidth: 70,
                              textAlign: 'right',
                              color: ig.tilt_score > 0 ? 'var(--mt-up)' : 'var(--mt-down)',
                              fontWeight: 600,
                            }}
                          >
                            {ig.tilt_score > 0 ? '+' : ''}{(ig.tilt_score ?? 0).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
