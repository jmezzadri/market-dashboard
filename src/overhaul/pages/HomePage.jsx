/* Home page — editorial hero · two-column today's read · 3 feature cards.
   Composes RegimeCanvas + Engine call card + finished components.
   Site-overhaul PR-O10, fixed in PR-O12.

   2026-05-27 fixes:
   - Use `active` (non-deprecated) indicator set everywhere on this page so
     the deck count and the stat tile count come from the SAME source and
     can never disagree.
   - Replace the bogus "Stress Signal 300" (stress_score is a 0-5-ish
     value, not 0-1; multiplying by 100 was wrong) with the engine's
     canonical page_stance label.
   - Rebalance the Engine Call card so the right column doesn't end with a
     wall of white space below the sector bars. */

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
    deck: 'Long signals across the screener universe, scored on a published weighted sum across five components.',
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
  const { active } = useIndicators();
  const { allocation } = useAllocation();
  const navigate = useNavigate();

  // Single source of truth — every count on this page derives from this object.
  const stats = useMemo(() => ({
    extreme: active.filter((i) => i.state === 'extreme').length,
    elevated: active.filter((i) => i.state === 'elevated').length,
    calm: active.filter((i) => i.state === 'calm').length,
    total: active.length,
  }), [active]);

  const equityPct = allocation?.equity_pct ?? null;
  const defPct = allocation?.defensive_pct ?? null;
  const stance = allocation?.page_stance || null;
  const stanceColor =
    stance === 'Risk On' ? 'var(--mt-up)'
    : stance === 'Risk Off' || stance === 'Stressed' || stance === 'Distressed' ? 'var(--mt-down)'
    : 'var(--mt-warn)';

  const sectors = (allocation?.sectors || [])
    .slice()
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Today · {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <h1 className="mt-h1">
            The regime reads <i>{(stance || 'cautious').toLowerCase()}</i>.
          </h1>
          <p className="mt-deck">
            <b className="num">{stats.extreme}</b> of <b className="num">{stats.total}</b> indicators in{' '}
            <b>extreme</b>, <b className="num">{stats.elevated}</b> elevated,{' '}
            <b className="num">{stats.calm}</b> calm. The engine is tilted{' '}
            <b>{equityPct != null ? `${(equityPct * 100).toFixed(0)}% equity` : 'equity-heavy'}</b>{' '}
            against the defensive sleeve.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
            minWidth: 360,
          }}
        >
          <StatTile
            label="Engine stance"
            value={stance || '—'}
            sub={`${stats.extreme + stats.elevated} of ${stats.total} indicators elevated`}
            color={stanceColor}
            isText
          />
          <StatTile
            label="Equity / Defensive"
            value={equityPct != null ? `${Math.round(equityPct * 100)} / ${Math.round((defPct ?? 0) * 100)}` : '—'}
            sub="nominal allocation"
            color="var(--mt-accent)"
          />
          <StatTile
            label="Indicators"
            value={`${stats.extreme} / ${stats.total}`}
            sub="extreme today"
            color={stats.extreme > stats.total * 0.2 ? 'var(--mt-down)' : 'var(--mt-warn)'}
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
            <RegimeCanvas indicators={active} aspect={1.55} />
          </div>
          <div className="mt-card" style={{ padding: 22, display: 'flex', flexDirection: 'column' }}>
            <div className="mt-eyebrow">Engine call · today</div>
            <div
              style={{
                fontFamily: 'var(--mt-font-display)',
                fontSize: 32,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                margin: '6px 0 8px',
                color: stanceColor,
              }}
            >
              {stance || 'Reading…'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--mt-ink-1)', marginBottom: 14, lineHeight: 1.55 }}>
              The engine recommends{' '}
              <b>{equityPct != null ? `${(equityPct * 100).toFixed(0)}%` : '—'}</b>{' '}
              in equities and{' '}
              <b>{defPct != null ? `${(defPct * 100).toFixed(0)}%` : '—'}</b>{' '}
              in the defensive sleeve. Sectors sorted by current weight.
            </div>
            <div className="mt-divider" />
            <div className="mt-eyebrow" style={{ marginTop: 10, marginBottom: 10 }}>Eleven sectors · tilt vs S&amp;P</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
              {sectors.map((s) => {
                const tilt = s.vs_spy_pp ?? 0;
                const weight = (s.weight ?? 0) * 100;
                const color = tilt > 0 ? 'var(--mt-up)' : tilt < 0 ? 'var(--mt-down)' : 'var(--mt-ink-2)';
                return (
                  <div
                    key={s.sector}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 100px 50px',
                      gap: 10,
                      alignItems: 'center',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--mt-ink-0)' }}>
                      {s.sector}
                      <span
                        className="num"
                        style={{ color: 'var(--mt-ink-3)', fontSize: 11, marginLeft: 6 }}
                      >
                        {weight.toFixed(1)}%
                      </span>
                    </span>
                    <div
                      style={{
                        height: 8,
                        background: 'var(--mt-surface-3)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(6, weight * 2.8))}%`,
                          height: '100%',
                          background: color,
                        }}
                      />
                    </div>
                    <span className="num" style={{ textAlign: 'right', color, fontWeight: 600 }}>
                      {tilt > 0 ? '+' : ''}{tilt.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--mt-line-0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <FreshnessChip elementId="v9-asset-allocation-daily" variant="label" />
              <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate('/tilt')}>
                Open Asset Tilt →
              </button>
            </div>
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

function StatTile({ label, value, sub, color, isText = false }) {
  return (
    <div className="mt-card" style={{ padding: 14 }}>
      <div className="mt-eyebrow">{label}</div>
      <div
        className={isText ? '' : 'num'}
        style={{
          fontFamily: 'var(--mt-font-display)',
          fontSize: isText ? 22 : 26,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: color || 'var(--mt-ink-0)',
          marginTop: 4,
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginTop: 6 }}>{sub}</div>
    </div>
  );
}
