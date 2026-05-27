/* Home page — editorial hero · two-column today's read · 3 feature cards.
   Composes RegimeCanvas + Engine call card + finished components.
   Site-overhaul PR-O10. */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import RegimeCanvas from '../components/RegimeCanvas';
import useIndicators from '../lib/useIndicators';
import useAllocation from '../lib/useAllocation';

const FEATURE_CARDS = [
  {
    n: '01',
    to: '/scanner',
    eyebrow: 'Trading scanner',
    title: 'High-conviction names',
    deck: 'Long signals across the screener universe, scored 0–5 on a published weighted sum across six components.',
  },
  {
    n: '02',
    to: '/portfolio',
    eyebrow: 'Portfolio insights',
    title: 'Your positions',
    deck: 'Imported from broker CSVs. MacroTilt score, market value, cost-basis P/L per position.',
  },
  {
    n: '03',
    to: '/scenarios',
    eyebrow: 'Scenario analysis',
    title: 'Stress your book',
    deck: 'Eight canned historical shocks plus a custom builder. Strategy comparison across SPX, 60/40, and the engine.',
  },
];

const HEADLINES = [
  ['08:35', 'Iran decries US "ceasefire violation" after overnight port raid', 'ZEROHEDGE'],
  ['08:25', 'Futures rise, US stocks set for new record as hopes for Iran peace deal persist', 'ZEROHEDGE'],
  ['07:45', 'Sterling falls as investors lower expectations of BOE rate rise', 'WSJ'],
  ['07:43', 'Marco Rubio unveils Indo-Pacific monitor plan as Hormuz crisis deepens', 'BLOOMBERG'],
  ['07:12', 'Powell hints at September cut conditional on cooling labor print', 'FT'],
  ['06:50', 'Eurozone CPI lands at 2.4%, below consensus — Bunds bid', 'BLOOMBERG'],
];

export default function HomePage() {
  const { indicators } = useIndicators();
  const { allocation } = useAllocation();
  const navigate = useNavigate();

  const stats = useMemo(() => ({
    extreme: indicators.filter((i) => i.state === 'extreme').length,
    elevated: indicators.filter((i) => i.state === 'elevated').length,
    calm: indicators.filter((i) => i.state === 'calm').length,
    total: indicators.length,
  }), [indicators]);

  const equityPct = allocation?.equity_pct ?? null;
  const defPct = allocation?.defensive_pct ?? null;
  const sectors = (allocation?.sectors || [])
    .slice()
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Today · {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <h1 className="mt-h1">
            The regime reads <i>risk-on inflationary</i>.
          </h1>
          <p className="mt-deck">
            <b>{stats.extreme}</b> of {stats.total} indicators in <b>extreme</b>,{' '}
            <b>{stats.elevated}</b> elevated, the rest calm. The engine is
            tilted{' '}
            <b>{equityPct != null ? `${(equityPct * 100).toFixed(0)}% equity` : 'equity-heavy'}</b>{' '}
            against the defensive sleeve.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
            minWidth: 320,
          }}
        >
          <StatTile
            label="Stress signal"
            value={allocation?.stress_score != null ? `${Math.round(allocation.stress_score * 100)}` : '—'}
            sub={allocation?.page_stance || 'Reading…'}
            color="var(--mt-up)"
          />
          <StatTile
            label="Equity / Defensive"
            value={equityPct != null ? `${Math.round(equityPct * 100)} / ${Math.round((defPct ?? 0) * 100)}` : '—'}
            sub="nominal allocation"
            color="var(--mt-accent)"
          />
          <StatTile
            label="Indicators"
            value={`${stats.extreme + stats.elevated} / ${stats.total}`}
            sub="extreme + elevated"
            color={stats.extreme > 5 ? 'var(--mt-down)' : 'var(--mt-warn)'}
          />
        </div>
      </section>

      {/* Today's read */}
      <section className="mt-pagesection">
        <div className="mt-eyebrow" style={{ marginBottom: 12 }}>Today's read</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.55fr 1fr',
            gap: 'var(--mt-gap-card)',
            alignItems: 'stretch',
          }}
        >
          <div onClick={() => navigate('/macro')} style={{ cursor: 'pointer' }}>
            <RegimeCanvas indicators={indicators} aspect={1.55} />
          </div>
          <div className="mt-card" style={{ padding: 22, display: 'flex', flexDirection: 'column' }}>
            <div className="mt-eyebrow">Engine call · today</div>
            <div
              style={{
                fontFamily: 'var(--mt-font-display)',
                fontSize: 28,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                margin: '4px 0 6px',
              }}
            >
              {allocation?.page_stance || 'Reading…'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--mt-ink-2)', marginBottom: 14 }}>
              <b className="num">{equityPct != null ? `${(equityPct * 100).toFixed(0)}%` : '—'}</b>{' '}
              equity · <b className="num">{defPct != null ? `${(defPct * 100).toFixed(0)}%` : '—'}</b>{' '}
              defensive
            </div>
            <div className="mt-divider" />
            <div className="mt-eyebrow" style={{ marginTop: 8, marginBottom: 8 }}>Eleven sectors</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, overflowY: 'auto' }}>
              {sectors.map((s) => {
                const tilt = s.vs_spy_pp ?? 0;
                const weight = (s.weight ?? 0) * 100;
                const color = tilt > 0 ? 'var(--mt-up)' : tilt < 0 ? 'var(--mt-down)' : 'var(--mt-ink-2)';
                return (
                  <div
                    key={s.sector}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 60px 40px',
                      gap: 8,
                      alignItems: 'center',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.sector}
                    </span>
                    <div
                      style={{
                        height: 6,
                        background: 'var(--mt-surface-3)',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, weight * 2.5)}%`,
                          height: '100%',
                          background: color,
                        }}
                      />
                    </div>
                    <span className="num" style={{ textAlign: 'right', color, fontWeight: 600 }}>
                      {tilt > 0 ? '+' : ''}{tilt.toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
            <FreshnessChip elementId="v9-asset-allocation-daily" variant="label" style={{ marginTop: 12 }} />
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="mt-pagesection">
        <div className="mt-eyebrow" style={{ marginBottom: 12 }}>Where to go next</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--mt-gap-card)',
          }}
        >
          {FEATURE_CARDS.map((c) => (
            <button
              key={c.to}
              type="button"
              onClick={() => navigate(c.to)}
              className="mt-card"
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--mt-font-display)',
                  fontSize: 32,
                  fontWeight: 500,
                  color: 'var(--mt-ink-3)',
                  letterSpacing: '-0.02em',
                }}
              >
                {c.n}
              </div>
              <div className="mt-eyebrow">{c.eyebrow}</div>
              <div
                style={{
                  fontFamily: 'var(--mt-font-display)',
                  fontSize: 22,
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                  color: 'var(--mt-ink-0)',
                }}
              >
                {c.title}
              </div>
              <p style={{ fontSize: 13, color: 'var(--mt-ink-2)', lineHeight: 1.55, margin: 0 }}>{c.deck}</p>
              <span style={{ color: 'var(--mt-accent)', fontSize: 13, fontWeight: 600, marginTop: 'auto' }}>
                Open {c.eyebrow.toLowerCase()} →
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* News list */}
      <section className="mt-pagesection">
        <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Market news</div>
        <div className="mt-card" style={{ padding: 0 }}>
          {HEADLINES.map(([time, headline, src], i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr 110px',
                gap: 16,
                padding: '12px 18px',
                borderTop: i ? '1px solid var(--mt-line-0)' : 'none',
                fontSize: 13,
                alignItems: 'center',
              }}
            >
              <span className="num" style={{ color: 'var(--mt-ink-3)', fontFamily: 'var(--mt-font-mono)', fontSize: 11 }}>{time}</span>
              <span style={{ color: 'var(--mt-ink-0)' }}>{headline}</span>
              <span style={{ fontSize: 10.5, color: 'var(--mt-ink-2)', letterSpacing: '0.08em', textAlign: 'right' }}>{src}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value, sub, color }) {
  return (
    <div className="mt-card" style={{ padding: 14 }}>
      <div className="mt-eyebrow">{label}</div>
      <div
        className="num"
        style={{
          fontFamily: 'var(--mt-font-display)',
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: color || 'var(--mt-ink-0)',
          marginTop: 2,
          lineHeight: 1.0,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}
