/* Trading Scanner — rebuilt 2026-05-27 to prototype/pages/scanner.jsx.
   Joe directive: score is 0-5 (backend native scale). Bucket pills are
   4.5+ / 3.5-4.49 / 3.0-3.49. Score-math drill reconciles to /5.

   Uses shared ScanList + ScanDrill from src/overhaul/components/. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import FreshnessChip from '../components/FreshnessChip';
import Tip from '../components/Tip';
import ScanList from '../components/ScanList';
import ScanDrill from '../components/ScanDrill';

function bucketFor(s) {
  if (s >= 4.5) return 'b5';
  if (s >= 3.5) return 'b4';
  return 'b3';
}

const COMPONENTS = [
  ['Technicals',  '200d trend, RSI, MACD, ATR',           0.25],
  ['Insider',     'C-suite buys/sells, 60d ratio',        0.20],
  ['Analyst',     'Upgrades, raised price targets',       0.20],
  ['Options vol', 'Calls/puts, IV rank, sweeps',          0.15],
  ['Congress',    'Senate + House disclosures',           0.10],
  ['Dark pool',   'Block trades, VWAP anchor',            0.10],
];

export default function ScannerPage() {
  const { rows: rawRows, bandCounts, scanDate, loading } = useTradingOppsTop(100);
  const [bucket, setBucket] = useState('all');
  const [drillOpenKey, setDrillOpenKey] = useState(null);
  const [showCols, setShowCols] = useState(false);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  const rows = useMemo(
    () => (rawRows || []).map((r) => ({
      ...r,
      bucket: bucketFor(Number(r.score) || 0),
    })),
    [rawRows],
  );

  const counts = useMemo(() => {
    const c = { b5: 0, b4: 0, b3: 0 };
    rows.forEach((r) => { c[r.bucket] = (c[r.bucket] || 0) + 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (bucket === 'all') return rows;
    return rows.filter((r) => r.bucket === bucket);
  }, [rows, bucket]);

  function flashToast(action, ticker) {
    const msg = action === 'copy' ? `Copied ${ticker}` : `Added ${ticker} to watchlist`;
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  const universeTotal = bandCounts.total || rows.length || 0;

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Trading scanner</div>
          <h1 className="mt-h1">
            Cutting through the noise with <i>proprietary signal intelligence</i>{' '}
            to find trading opportunities.
          </h1>
          <p className="mt-deck">
            Five signals — <b>insider activity</b>, <b>dark-pool prints</b>,{' '}
            <b>options flow</b>, <b>congressional trades</b>, and{' '}
            <b>technicals</b> — rolled into one MacroTilt Score (0–5).
            Long alerts today{' '}
            <b className="num">{universeTotal}</b>.{' '}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); navigate('/methodology#scanner'); }}
              style={{ color: 'var(--mt-accent)' }}
            >
              See the scoring methodology →
            </a>
          </p>
        </div>
        <div className="mt-card" style={{ minWidth: 340, padding: 18 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <div className="mt-eyebrow">Today's scan{scanDate ? ` · ${scanDate}` : ''}</div>
            <FreshnessChip elementId="equity-latest_scan_data-daily" variant="label" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              ['b5', 'Score 4.5+', 'var(--mt-up)', counts.b5 || 0],
              ['b4', 'Score 3.5–4.49', 'var(--mt-accent)', counts.b4 || 0],
              ['b3', 'Score 3.0–3.49', 'var(--mt-warn)', counts.b3 || 0],
            ].map(([k, label, color, n]) => {
              const isOn = bucket === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBucket(isOn ? 'all' : k)}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    padding: '12px 10px',
                    textAlign: 'left',
                    background: isOn ? 'var(--mt-surface-2)' : 'var(--mt-surface)',
                    border: `1px solid ${isOn ? color : 'var(--mt-line-0)'}`,
                    borderTop: `3px solid ${color}`,
                    borderRadius: 10,
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
                  <div
                    style={{
                      fontSize: 10.5,
                      color: 'var(--mt-ink-2)',
                      marginTop: 4,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <section className="mt-pagesection" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div className="mt-pillgroup">
            {[
              ['all', `All ${universeTotal}`],
              ['b5', `Score 4.5+ ${counts.b5 || 0}`],
              ['b4', `Score 3.5–4.49 ${counts.b4 || 0}`],
              ['b3', `Score 3.0–3.49 ${counts.b3 || 0}`],
            ].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`mt-pill ${bucket === k ? 'on' : ''}`}
                onClick={() => setBucket(k)}
              >
                {l}
              </button>
            ))}
          </div>
          <Tip content="Engine doesn't yet output short signals — long-only universe today.">
            <span style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>Long signals only</span>
          </Tip>
          <span style={{ flex: 1 }} />
          <button type="button" className="mt-btn">＋ Filter</button>
          <button type="button" className="mt-btn" onClick={() => setShowCols(!showCols)}>
            ⚙ Columns <span className="num" style={{ marginLeft: 4 }}>11/14</span>
          </button>
        </div>
        {showCols && (
          <div
            className="mt-card mt-fade"
            style={{ marginTop: 12, padding: 18 }}
          >
            <div className="mt-eyebrow" style={{ marginBottom: 10 }}>Show / hide / reorder columns</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                ['Last trade', true],
                ['Ticker', true, true],
                ['Signal', true],
                ['Score', true, true],
                ['Score 1w', true],
                ['Score 1m', true],
                ['Insider activity', true],
                ['Dark pool anchor', true],
                ['Options vol shock', false],
                ['Chart', true],
                ['Price', true],
                ['Change', true],
                ['Volume', true],
                ['52w range', true],
              ].map(([name, on, locked]) => (
                <label
                  key={name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    border: '1px solid var(--mt-line-0)',
                    borderRadius: 8,
                    background: on ? 'var(--mt-surface-3)' : 'transparent',
                    cursor: locked ? 'not-allowed' : 'pointer',
                    fontSize: 12.5,
                  }}
                >
                  <input type="checkbox" checked={on} readOnly />
                  <span style={{ fontFamily: 'var(--mt-font-mono)', color: 'var(--mt-ink-3)' }}>⋮⋮</span>
                  <span>{name}</span>
                  {locked && <span style={{ marginLeft: 'auto', fontSize: 11 }}>🔒</span>}
                </label>
              ))}
            </div>
          </div>
        )}
        <div
          style={{
            marginTop: 12,
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
          The dark-pool and options layers are now live, raising the score
          ceiling from 5 to 10. These two layers are not yet backtested —
          treat them as developing signals. Any Score 1W or Score 1M figure
          from before this date is marked{' '}
          <span style={{ color: 'var(--mt-accent)' }}>*</span>.
        </div>
      </section>

      {/* ScanList */}
      <section className="mt-pagesection" style={{ paddingTop: 12 }}>
        {loading ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            Loading scan results…
          </div>
        ) : (
          <ScanList
            rows={filtered}
            drillOpenKey={drillOpenKey}
            setDrillOpenKey={setDrillOpenKey}
            renderDrill={(r) => <ScanDrill row={r} onAct={flashToast} />}
          />
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
              <div className="mt-h2">Six inputs · one number per ticker.</div>
            </div>
            <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate('/methodology#scanner')}>
              Full methodology →
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
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
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mt-ink-2)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
                  weight{' '}
                  <b className="num" style={{ color: 'var(--mt-ink-0)', fontSize: 13 }}>
                    {(weight * 100).toFixed(0)}%
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
