/* Home — rebuilt 2026-05-27 to match prototype/pages/home.jsx line by line.
   Joe directives:
     - All "X indicators" counts bind to live `active.length` (29 today).
     - Indicator breakdown appears ONCE — in stat tile 3's subtitle line.
     - Regime call sourced from useEngineRegime (stress zone + yield regime).
     - Engine Call card RIGHT column shows RECOMMENDED ALLOCATION (the
       engine's nominal `weight` per sector), NOT tilt-vs-S&P.
*/

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import RegimeCanvas from '../components/RegimeCanvas';
import useIndicators from '../lib/useIndicators';
import useAllocation from '../lib/useAllocation';
import useEngineRegime from '../lib/useEngineRegime';

const HEADLINES = [
  ['08:35', 'Iran decries US "ceasefire violation" after overnight port raid', 'ZEROHEDGE'],
  ['08:25', 'Futures rise, US stocks set for new record as hopes for Iran peace deal persist', 'ZEROHEDGE'],
  ['07:45', 'Sterling falls as investors lower expectations of BOE rate rise', 'WSJ'],
  ['07:43', 'Marco Rubio unveils Indo-Pacific monitor plan as Hormuz crisis deepens', 'BLOOMBERG'],
  ['07:12', 'Powell hints at September cut conditional on cooling labor print', 'FT'],
  ['06:50', 'Eurozone CPI lands at 2.4%, below consensus — Bunds bid', 'BLOOMBERG'],
];

function fmtPercent(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export default function HomePage() {
  const { active } = useIndicators();
  const { allocation } = useAllocation();
  const regime = useEngineRegime();
  const navigate = useNavigate();

  // Counts derive once; used in the H1 + stat tile 3 subtitle ONLY.
  const stressed = active.filter((i) => i.state === 'extreme').length;
  const elevated = active.filter((i) => i.state === 'elevated').length;
  const calm = active.filter((i) => i.state === 'calm').length;
  const total = active.length;

  const equityPct = allocation?.equity_pct ?? null;
  const defPct = allocation?.defensive_pct ?? null;

  // Recommended allocation — sectors sorted by ENGINE WEIGHT desc.
  // Bar scales to the largest weight.
  const allocRows = useMemo(() => {
    const rows = (allocation?.sectors || [])
      .map((s) => ({
        code: (s.etfs && s.etfs[0]) || s.sector,
        name: s.sector,
        weight: Number(s.weight) || 0,
      }))
      .filter((s) => s.weight > 0)
      .sort((a, b) => b.weight - a.weight);
    const maxW = rows.length ? rows[0].weight : 0;
    return rows.map((r) => ({ ...r, fraction: maxW > 0 ? r.weight / maxW : 0 }));
  }, [allocation]);

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Today's tape · MacroTilt</div>
          <h1 className="mt-h1">
            {regime.stressZone || 'Reading'},
            <br />
            <i>{(regime.yieldRegime || 'inflationary').toLowerCase()}</i>{' '}
            — with{' '}
            <span style={{ whiteSpace: 'nowrap' }} className="num">
              {stressed} of {total}
            </span>{' '}
            flashing.
          </h1>
          <p className="mt-deck">
            Bond-market volatility set by{' '}
            <b className="num">MOVE {regime.move != null ? regime.move.toFixed(1) : '—'}</b>{' '}
            and the 3-month change in 10y rates at{' '}
            <b className="num">{regime.yieldDeltaBp != null ? `${regime.yieldDeltaBp >= 0 ? '+' : ''}${regime.yieldDeltaBp.toFixed(0)} bp` : '—'}</b>{' '}
            put the engine in{' '}
            <b>{equityPct != null ? `${(equityPct * 100).toFixed(0)}% equity` : 'reading…'}</b>.{' '}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); navigate('/methodology'); }}
              style={{ color: 'var(--mt-accent)' }}
            >
              Read the methodology →
            </a>
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
            minWidth: 480,
          }}
        >
          <StatTile
            label="Stress signal"
            value={regime.move != null ? regime.move.toFixed(1) : '—'}
            sub={
              <>
                MOVE · {regime.movePct != null ? `${regime.movePct}th pctile` : '—'} · Watch{' '}
                <span className="num">{regime.stressThresholds?.watch ?? 116}</span>
              </>
            }
          />
          <StatTile
            label="Yield regime"
            value={regime.yieldDeltaBp != null ? `${regime.yieldDeltaBp >= 0 ? '+' : ''}${regime.yieldDeltaBp.toFixed(0)}` : '—'}
            unit="bp"
            sub={
              <>
                3M Δ 10y · {regime.yieldPct != null ? `${regime.yieldPct}th pctile` : '—'} ·{' '}
                <span style={{ color: regime.yieldColor, fontWeight: 600 }}>
                  {(regime.yieldRegime || '—').toLowerCase()}
                </span>
              </>
            }
          />
          <StatTile
            label="Indicators"
            value={`${stressed + elevated}`}
            unit={`/${total}`}
            sub={
              <>
                <span style={{ color: 'var(--mt-down)' }}><b className="num">{stressed}</b> extreme</span>
                {' · '}
                <span style={{ color: 'var(--mt-warn)' }}><b className="num">{elevated}</b> elevated</span>
                {' · '}
                <span style={{ color: 'var(--mt-up)' }}><b className="num">{calm}</b> calm</span>
              </>
            }
          />
        </div>
      </section>

      {/* Today's read — Macro position (left) + Engine call + recommended allocation (right) */}
      <section className="mt-pagesection">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.55fr 1fr',
            gap: 'var(--mt-gap-card)',
            alignItems: 'stretch',
          }}
        >
          {/* Map card with its OWN internal header */}
          <div className="mt-card" style={{ padding: 18 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                marginBottom: 12,
                gap: 12,
              }}
            >
              <div>
                <div className="mt-eyebrow">Macro position</div>
                <div className="mt-h2">Where the {total} indicators sit today.</div>
                <div style={{ fontSize: 12, color: 'var(--mt-ink-2)', marginTop: 4 }}>
                  Hover any dot to read · click to drill into history
                </div>
              </div>
              <button type="button" className="mt-btn" onClick={() => navigate('/macro')}>
                Open Macro →
              </button>
            </div>
            <div style={{ margin: '0 -12px' }}>
              <RegimeCanvas indicators={active} aspect={1.55} />
            </div>
            <div className="lm-canvaslegend">
              <div className="lm-legrow">
                <span className="lm-legdot lm-legdot--extreme" /> extreme
                <span className="lm-legdot lm-legdot--elevated" /> elevated
                <span className="lm-legdot lm-legdot--calm" /> calm
              </div>
              <div className="lm-legrow lm-legrow--dim">
                {total} indicators · live · 5y normalized
              </div>
            </div>
          </div>

          {/* Engine Call card */}
          <aside className="mt-card" style={{ padding: 18, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 14,
                gap: 8,
              }}
            >
              <div>
                <div className="mt-eyebrow">Engine call · today</div>
                <div
                  style={{
                    fontFamily: 'var(--mt-font-display)',
                    fontSize: 28,
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    margin: '4px 0',
                    color: 'var(--mt-ink-0)',
                  }}
                >
                  <span style={{ color: regime.stressColor }}>{regime.stressZone || '—'}</span>
                  <span> · </span>
                  <i style={{ color: regime.yieldColor }}>{regime.yieldRegime || '—'}</i>
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--mt-ink-2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span><b className="num">{fmtPercent(equityPct, 0)}</b> equity</span>
                  <span>·</span>
                  <span><b className="num">{fmtPercent(defPct, 0)}</b> defensive</span>
                  <span>·</span>
                  <FreshnessChip elementId="v10-allocation-daily" variant="label" />
                </div>
              </div>
              <button type="button" className="mt-btn" onClick={() => navigate('/tilt')}>
                Open Tilt →
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 10,
              }}
            >
              <span className="mt-eyebrow">Recommended allocation</span>
              <span className="num" style={{ fontSize: 11, color: 'var(--mt-ink-3)' }}>= 100%</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              {allocRows.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => navigate('/tilt')}
                  className="hm-allocrow"
                >
                  <span className="hm-allocname">
                    <span className="lm-flowcode">{s.code}</span>
                    <span className="hm-allocnamelbl">{s.name}</span>
                  </span>
                  <span className="hm-allocbar">
                    <span
                      style={{
                        width: `${(s.fraction * 100).toFixed(1)}%`,
                        background: 'var(--mt-accent)',
                      }}
                    />
                  </span>
                  <span className="num hm-allocpct">
                    {(s.weight * 100).toFixed(1)}
                    <i>%</i>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </section>

      {/* Feature cards */}
      <section className="mt-pagesection">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--mt-gap-card)',
          }}
        >
          <FeatureCard
            num="01"
            label="Trading scanner"
            title="Five signals into one score"
            body="Insider, dark-pool prints, options flow, congressional trades and technicals — cleared liquidity gate."
            stat="long alerts today"
            freshnessId="equity-latest_scan_data-daily"
            onClick={() => navigate('/scanner')}
          />
          <FeatureCard
            num="02"
            label="Portfolio insights"
            title="Your book, augmented"
            body="Every line scored, tilts compared to engine, freshness on every value. Chase / Fidelity / Schwab CSV import."
            stat="six accounts"
            freshnessId="portfolio-positions-on_change"
            onClick={() => navigate('/portfolio')}
          />
          <FeatureCard
            num="03"
            label="Scenario analysis"
            title="Stress-test the playbook"
            body="Eight canned historical shocks plus a custom builder. See how each strategy responds."
            stat="8 scenarios · 4 factors"
            freshnessId="scenario-allocation_history-weekly"
            onClick={() => navigate('/scenarios')}
          />
        </div>
      </section>

      {/* Market news */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Market news · Macro</div>
            <div className="mt-h2">What moved the tape this morning.</div>
          </div>
          <div className="mt-pillgroup">
            <button type="button" className="mt-pill on">All</button>
            <button type="button" className="mt-pill">Macro</button>
            <button type="button" className="mt-pill">Equities</button>
            <button type="button" className="mt-pill">Crypto</button>
          </div>
        </div>
        <ul className="mt-card" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {HEADLINES.map(([time, head, src], i) => (
            <li
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
              <span style={{ color: 'var(--mt-ink-0)' }}>{head}</span>
              <span style={{ fontSize: 10.5, color: 'var(--mt-ink-2)', letterSpacing: '0.08em', textAlign: 'right' }}>{src}</span>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="mt-btn mt-btn--ghost">Show more headlines →</button>
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value, unit, sub }) {
  return (
    <div className="mt-card" style={{ padding: 14 }}>
      <div className="mt-eyebrow">{label}</div>
      <div
        className="num"
        style={{
          fontFamily: 'var(--mt-font-display)',
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--mt-ink-0)',
          marginTop: 4,
          lineHeight: 1.05,
        }}
      >
        {value}
        {unit && (
          <span style={{ fontSize: 13, color: 'var(--mt-ink-2)', marginLeft: 4, fontWeight: 400 }}>
            {unit}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginTop: 6, lineHeight: 1.5 }}>
        {sub}
      </div>
    </div>
  );
}

function FeatureCard({ num, label, title, body, stat, freshnessId, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-card"
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        position: 'relative',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--mt-font-display)',
          fontSize: 32,
          fontWeight: 500,
          color: 'var(--mt-ink-3)',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {num}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="mt-eyebrow">{label}</div>
        <FreshnessChip elementId={freshnessId} variant="dot" />
      </div>
      <div
        style={{
          fontFamily: 'var(--mt-font-display)',
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--mt-ink-0)',
        }}
      >
        {title}
      </div>
      <p style={{ fontSize: 13, color: 'var(--mt-ink-2)', lineHeight: 1.55, margin: 0 }}>{body}</p>
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
        <span className="mt-tag mt-tag--accent">{stat}</span>
        <span style={{ color: 'var(--mt-accent)', fontSize: 13, fontWeight: 600 }}>Open →</span>
      </div>
    </button>
  );
}
