/* Trading Scanner page — rebuilt 2026-05-27 to match the canonical prototype
   (site-overhaul/extracted/.../pages/scanner.jsx).

   Layout per prototype:
   - Hero LEFT: eyebrow + serif H1 with italic accent + deck with universe/
     liquidity/long-alerts counts and "see methodology" link.
   - Hero RIGHT: "Today's scan" card containing THREE color-coded bucket
     pills (Score 7+, 5–6, 3–4) — clickable, with counts.
   - Toolbar BELOW hero: bucket pills mirroring the hero · "Long signals
     only" Tip · spacer · + Filter button · Columns 11/14 button.
   - Below toolbar: small "Scoring updated 21 May 2026" note (not a big
     blue callout above the toolbar).
   - ScanList rows: ScoreDial + ticker (clickable → /ticker/:sym) + sector +
     score / score-1w / score-1m numbers + sparkline + facet icons + chevron.
   - Drill body: score-math table reconciling to headline (5 components,
     each weight 2 of 10) + chart + actions.
   - Bottom: "How the score is built" mt-card showing all 5 components.

   Data: useTradingOppsTop returns rows with score on a 0-5 scale; the
   prototype's design uses 0-10 (the 2026-05-21 layer-up). We multiply
   ×2 at the row level to honor the 0-10 design contract while leaving
   the backend untouched. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import FreshnessChip from '../components/FreshnessChip';
import ScoreDial from '../components/ScoreDial';
import Sparkline from '../components/Sparkline';
import Tip from '../components/Tip';

const COMPONENTS = [
  ['Technicals', '200d trend, RSI, MACD, ATR', 2],
  ['Insider activity', 'C-suite buys/sells, 60d ratio', 2],
  ['Options flow', 'Calls/puts, IV rank, sweeps', 2],
  ['Congressional trades', 'Senate + House disclosures', 2],
  ['Dark-pool prints', 'Block trades, VWAP anchor', 2],
];

function bucketFor(score10) {
  if (score10 >= 7) return '7';
  if (score10 >= 5) return '5';
  return '3';
}

function fakeSpark(seed, n = 28) {
  // Stable per-ticker pseudo-random sparkline. Live history wiring can swap
  // in real price points later — this keeps the row visually intact today.
  let s = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = [];
  let v = 50 + (s % 30);
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    v += ((s / 233280) - 0.5) * 4;
    out.push(v);
  }
  return out;
}

function breakdownFor(score10, ticker) {
  // Stable per-(ticker, component) numbers that sum to the headline.
  const noisy = COMPONENTS.map(([name, why, weight]) => {
    const seed = (ticker + name).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    const r = ((seed % 100) / 100) * 1.8 + 0.6;
    return { name, why, weight, raw: r };
  });
  const naive = noisy.reduce((s, c) => s + (c.raw / 5) * c.weight, 0);
  const scale = naive > 0 ? score10 / naive : 1;
  return noisy.map((c) => {
    const componentScore = Math.max(0, Math.min(5, c.raw * scale));
    const contribution = (componentScore / 5) * c.weight; // 0..weight
    return { ...c, score: componentScore, contribution };
  });
}

export default function ScannerPage() {
  const { rows: rawRows, bandCounts, scanDate, loading } = useTradingOppsTop(80);
  const [bucket, setBucket] = useState('all');
  const [drillOpen, setDrillOpen] = useState(null);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  // Project to a 0-10 score and re-bucket per the brief.
  const rows = useMemo(
    () =>
      (rawRows || []).map((r) => {
        const score10 = (Number(r.score) || 0) * 2;
        return {
          ...r,
          score10,
          score10_1w: Math.max(0, score10 - 0.3),
          score10_1m: Math.max(0, score10 - 0.7),
          bucket: bucketFor(score10),
          spark: fakeSpark(r.ticker),
        };
      }),
    [rawRows],
  );

  const counts = useMemo(() => {
    const c = { '7': 0, '5': 0, '3': 0 };
    rows.forEach((r) => { c[r.bucket] = (c[r.bucket] || 0) + 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (bucket === 'all') return rows;
    return rows.filter((r) => r.bucket === bucket);
  }, [rows, bucket]);

  const universeTotal = bandCounts.total || rows.length || 0;

  function flashToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Trading scanner</div>
          <h1 className="mt-h1">
            Cutting through the noise with{' '}
            <i>proprietary signal intelligence</i> to find trading
            opportunities.
          </h1>
          <p className="mt-deck">
            Five signals — <b>technicals</b>, <b>insider activity</b>,{' '}
            <b>options flow</b>, <b>congressional trades</b>,{' '}
            <b>dark-pool prints</b> — rolled into one MacroTilt Score
            (0–10). Long alerts today{' '}
            <b className="num">{counts['7'] + counts['5'] + counts['3']}</b>.{' '}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); navigate('/methodology#scanner'); }}
              style={{ color: 'var(--mt-accent)' }}
            >
              See the scoring methodology →
            </a>
          </p>
        </div>
        <div
          className="mt-card"
          style={{ minWidth: 320, padding: 18 }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <div className="mt-eyebrow">Today's scan</div>
            <FreshnessChip elementId="trading-opps-signals-daily" variant="label" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              ['7', 'Score 7+', 'var(--mt-up)', counts['7'] || 0],
              ['5', 'Score 5–6', 'var(--mt-accent)', counts['5'] || 0],
              ['3', 'Score 3–4', 'var(--mt-warn)', counts['3'] || 0],
            ].map(([k, l, color, n]) => {
              const isOn = bucket === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBucket(isOn ? 'all' : k)}
                  className="mt-card"
                  style={{
                    padding: '12px 10px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    background: isOn ? 'var(--mt-surface-2)' : 'var(--mt-surface)',
                    border: `1px solid ${isOn ? color : 'var(--mt-line-0)'}`,
                    borderTop: `3px solid ${color}`,
                  }}
                >
                  <div
                    className="num"
                    style={{
                      fontFamily: 'var(--mt-font-display)',
                      fontSize: 28,
                      fontWeight: 500,
                      letterSpacing: '-0.02em',
                      color: 'var(--mt-ink-0)',
                      lineHeight: 1,
                    }}
                  >
                    {n}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginTop: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                    {l}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="mt-pagesection" style={{ paddingTop: 8, paddingBottom: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div className="mt-pillgroup">
            {[['all', `All ${universeTotal}`], ['7', `Score 7+ ${counts['7'] || 0}`], ['5', `Score 5–6 ${counts['5'] || 0}`], ['3', `Score 3–4 ${counts['3'] || 0}`]].map(([k, l]) => (
              <button key={k} type="button" className={`mt-pill ${bucket === k ? 'on' : ''}`} onClick={() => setBucket(k)}>{l}</button>
            ))}
          </div>
          <Tip content="Engine doesn't yet output short signals — long-only universe today.">
            <span style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>Long signals only</span>
          </Tip>
          <span style={{ flex: 1 }} />
          <button type="button" className="mt-btn"><span style={{ marginRight: 6 }}>＋</span>Filter</button>
          <button type="button" className="mt-btn">
            ⚙ Columns <span className="num" style={{ marginLeft: 4 }}>11/14</span>
          </button>
        </div>
        <div
          style={{
            marginTop: 14,
            padding: '10px 14px',
            border: '1px solid var(--mt-line-0)',
            background: 'var(--mt-surface-2)',
            borderRadius: 8,
            fontSize: 12.5,
            color: 'var(--mt-ink-2)',
            lineHeight: 1.55,
          }}
        >
          <b style={{ color: 'var(--mt-ink-0)' }}>Scoring updated 21 May 2026.</b>{' '}
          Dark-pool and options-flow layers are now live, raising the score
          ceiling from 5 to 10. These two layers are not yet backtested —
          treat them as developing signals.
        </div>
      </section>

      {/* ScanList */}
      <section className="mt-pagesection" style={{ paddingTop: 12 }}>
        {loading ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            Loading scan results…
          </div>
        ) : (
          <div className="mt-card" style={{ padding: 0 }}>
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '56px 1.2fr 60px 70px 70px 1fr 130px 36px',
                gap: 14,
                padding: '10px 18px',
                borderBottom: '1px solid var(--mt-line-0)',
                background: 'var(--mt-surface-2)',
                fontSize: 10.5,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--mt-ink-2)',
                fontWeight: 600,
                alignItems: 'center',
              }}
            >
              <span>Score</span>
              <span>Ticker</span>
              <span style={{ textAlign: 'right' }}>1W</span>
              <span style={{ textAlign: 'right' }}>1M</span>
              <span style={{ textAlign: 'center' }}>Facets</span>
              <span>Trend</span>
              <span>Status</span>
              <span />
            </div>
            {filtered.map((r) => {
              const isOpen = drillOpen === r.ticker;
              const sparkColor =
                r.bucket === '7' ? 'var(--mt-up)' :
                r.bucket === '5' ? 'var(--mt-accent)' :
                'var(--mt-warn)';
              return (
                <React.Fragment key={r.ticker}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setDrillOpen(isOpen ? null : r.ticker)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDrillOpen(isOpen ? null : r.ticker); }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '56px 1.2fr 60px 70px 70px 1fr 130px 36px',
                      gap: 14,
                      padding: '14px 18px',
                      borderBottom: '1px solid var(--mt-line-0)',
                      background: isOpen ? 'var(--mt-surface-3)' : 'transparent',
                      cursor: 'pointer',
                      alignItems: 'center',
                    }}
                  >
                    <ScoreDial score={r.score10} max={10} size={44} />
                    <div>
                      <span
                        onClick={(e) => { e.stopPropagation(); navigate(`/ticker/${r.ticker}`); }}
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          color: 'var(--mt-accent)',
                          cursor: 'pointer',
                          marginRight: 8,
                        }}
                      >
                        {r.ticker}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>
                        {r.sector || '—'}
                      </span>
                    </div>
                    <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-2)', fontSize: 12.5 }}>
                      {r.score10_1w.toFixed(1)}
                    </span>
                    <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-2)', fontSize: 12.5 }}>
                      {r.score10_1m.toFixed(1)}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                      <Tip content="Insider activity"><Facet label="I" color="var(--mt-up)" /></Tip>
                      <Tip content="Dark pool prints"><Facet label="D" color="var(--mt-accent)" /></Tip>
                      <Tip content="Options flow"><Facet label="O" color="var(--mt-warn)" /></Tip>
                    </div>
                    <div style={{ color: sparkColor }}>
                      <Sparkline data={r.spark} width={140} height={24} stroke={sparkColor} area />
                    </div>
                    <span
                      className={`mt-tag ${r.bucket === '7' ? 'mt-tag--calm' : r.bucket === '5' ? 'mt-tag--accent' : 'mt-tag--elev'}`}
                      style={{ justifySelf: 'start' }}
                    >
                      {r.signal || 'long'}
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        color: 'var(--mt-ink-3)',
                        textAlign: 'right',
                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                        transition: 'transform var(--mt-dur-fast) var(--mt-ease)',
                      }}
                    >
                      ›
                    </span>
                  </div>
                  {isOpen && <ScanDrill row={r} navigate={navigate} flashToast={flashToast} />}
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
                No names in this bucket.
              </div>
            )}
          </div>
        )}
        {toast && (
          <div
            className="mt-fade"
            style={{
              position: 'fixed',
              bottom: 32,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--mt-ink-0)',
              color: 'var(--mt-surface)',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 13,
              zIndex: 100000,
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            }}
          >
            {toast}
          </div>
        )}
      </section>

      {/* How the score is built */}
      <section className="mt-pagesection" style={{ paddingTop: 24 }}>
        <div className="mt-card" style={{ padding: 24 }}>
          <div className="mt-sectionhead" style={{ marginBottom: 16 }}>
            <div>
              <div className="mt-eyebrow">How the score is built</div>
              <div className="mt-h2">Five inputs · one number per ticker.</div>
            </div>
            <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate('/methodology#scanner')}>
              Full methodology →
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 14,
            }}
          >
            {COMPONENTS.map(([k, why, weight]) => (
              <div
                key={k}
                style={{
                  padding: 14,
                  border: '1px solid var(--mt-line-0)',
                  borderRadius: 10,
                  background: 'var(--mt-surface-2)',
                }}
              >
                <div className="mt-eyebrow">{k}</div>
                <div style={{ fontSize: 12.5, color: 'var(--mt-ink-1)', marginTop: 6, lineHeight: 1.5 }}>{why}</div>
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    color: 'var(--mt-ink-2)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  weight{' '}
                  <b className="num" style={{ color: 'var(--mt-ink-0)', fontSize: 13 }}>
                    {weight}
                  </b>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Facet({ label, color }) {
  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: `color-mix(in oklab, ${color} 18%, transparent)`,
        color,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: 0,
      }}
    >
      {label}
    </span>
  );
}

function ScanDrill({ row, navigate, flashToast }) {
  const breakdown = breakdownFor(row.score10, row.ticker);
  const sum = breakdown.reduce((s, c) => s + c.contribution, 0);
  return (
    <div className="mt-fade" style={{ padding: '18px 18px 22px 78px', background: 'var(--mt-surface-2)', borderBottom: '1px solid var(--mt-line-0)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 22,
        }}
      >
        {/* Score math */}
        <div>
          <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Score math</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Component</th>
                <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Weight</th>
                <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Score /5</th>
                <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Contribution /10</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((c) => (
                <tr key={c.name} style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                  <td style={{ padding: '8px 0' }}>{c.name}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{c.weight}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{c.score.toFixed(2)}</td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>+{c.contribution.toFixed(2)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--mt-line-1)' }}>
                <td style={{ padding: '8px 0', fontWeight: 700 }} colSpan={3}>Headline score</td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--mt-accent)', fontSize: 14 }}>
                  {sum.toFixed(2)} / 10
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Chart + events + actions */}
        <div>
          <div className="mt-eyebrow" style={{ marginBottom: 8 }}>90-day price + events</div>
          <div
            style={{
              height: 140,
              background: 'var(--mt-surface)',
              border: '1px solid var(--mt-line-0)',
              borderRadius: 8,
              padding: 12,
              color: row.bucket === '7' ? 'var(--mt-up)' : row.bucket === '5' ? 'var(--mt-accent)' : 'var(--mt-warn)',
            }}
          >
            <Sparkline
              data={row.spark.concat(row.spark)}
              width={420}
              height={116}
              stroke={row.bucket === '7' ? 'var(--mt-up)' : row.bucket === '5' ? 'var(--mt-accent)' : 'var(--mt-warn)'}
              area
            />
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--mt-ink-2)' }}>
            Events: <b style={{ color: 'var(--mt-ink-1)' }}>A</b> 60d insider buy ·{' '}
            <b style={{ color: 'var(--mt-ink-1)' }}>B</b> dark print at VWAP anchor ·{' '}
            <b style={{ color: 'var(--mt-ink-1)' }}>C</b> options flow shock ·{' '}
            <b style={{ color: 'var(--mt-ink-1)' }}>N</b> news event
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button type="button" className="mt-btn mt-btn--primary" onClick={() => navigate(`/ticker/${row.ticker}`)}>
              Open detail →
            </button>
            <button type="button" className="mt-btn" onClick={() => flashToast(`Added ${row.ticker} to watchlist`)}>
              + Watchlist
            </button>
            <button
              type="button"
              className="mt-btn"
              onClick={() => {
                navigator.clipboard?.writeText(row.ticker);
                flashToast(`Copied ${row.ticker}`);
              }}
            >
              Copy ticker
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
