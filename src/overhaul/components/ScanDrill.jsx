/* ScanDrill — drill body that opens under a ScanList row.
   Ported from prototype/lm-shared.jsx ScanDrill.
   Two-column body:
     LEFT  = score-math table reconciling to headline (5 components × weight = total /5)
     RIGHT = EventChart 90-day path + event list + 3 working buttons
   Score scale is 0-5 (Joe directive 2026-05-27 — backend native scale).
*/

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EventChart from './EventChart';
import { SCORE_WEIGHTS } from '../lib/scoreWeights';
/* SCORE_WEIGHTS moved to ../lib/scoreWeights.js (2026-05-27) so the
   "How the score is built" cards on ScannerPage and this drill body
   read from the same source — previously a catalog violation. */

function breakdownFor(headlineScore5, ticker) {
  // Stable per-(ticker, component) numbers that sum to the headline.
  const meanFive = headlineScore5;
  const offsets = [0.6, 0.4, 0.2, -0.1, -0.4, -0.6];
  const seedNum = (s) => s.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const noisy = SCORE_WEIGHTS.map((c, i) => {
    const tweak = ((seedNum(ticker + c.key) % 100) / 100 - 0.5) * 0.6;
    const raw = Math.max(0.5, Math.min(5, meanFive + offsets[i] + tweak));
    return { ...c, raw };
  });
  // Scale to make Σ contribution = headline exactly.
  const naive = noisy.reduce((s, c) => s + (c.raw / 5) * c.weight * 5, 0);
  const k = naive > 0 ? headlineScore5 / naive : 1;
  return noisy.map((c) => {
    const score5 = Math.max(0, Math.min(5, c.raw * k));
    const contribution = (score5 / 5) * c.weight * 5;
    return { ...c, score5, contribution };
  });
}

function fakePath(ticker, price = 50) {
  let s = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = [];
  let v = price;
  for (let i = 0; i < 90; i++) {
    s = (s * 9301 + 49297) % 233280;
    v += ((s / 233280) - 0.5) * (price * 0.04);
    out.push(v);
  }
  return out;
}

export default function ScanDrill({ row, onAct }) {
  const navigate = useNavigate();
  const items = useMemo(() => breakdownFor(Number(row.score) || 0, row.ticker), [row.ticker, row.score]);
  const total = items.reduce((s, x) => s + x.contribution, 0);
  const accent = (row.chg ?? 0) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)';

  // Event markers at specific day indices on a 0–89 path.
  const events = [
    { idx: 86, badge: 'A', label: `${row.ticker} insider buy`, when: '4d ago' },
    { idx: 83, badge: 'B', label: `${row.ticker} CFO buy`, when: '7d ago' },
    { idx: 79, badge: 'C', label: 'Block 142K at VWAP anchor', when: '11d ago' },
    { idx: 76, badge: 'N', label: 'BMO → Outperform', when: '14d ago' },
  ];

  const series = useMemo(() => fakePath(row.ticker, row.price || 50), [row.ticker, row.price]);

  return (
    <div
      className="mt-fade"
      style={{
        padding: '18px 18px 22px',
        background: 'var(--mt-surface-2)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 22,
      }}
    >
      {/* LEFT — score math */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div className="mt-eyebrow">Signal composition</div>
          <div className="num" style={{ fontSize: 14, color: 'var(--mt-ink-1)' }}>
            = <b style={{ color: 'var(--mt-accent)' }}>{total.toFixed(2)}</b>
            <span style={{ color: 'var(--mt-ink-3)', marginLeft: 2 }}>/5</span>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Component</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Weight</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Score /5</th>
              <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Contribution</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.key} style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                <td style={{ padding: '8px 8px 8px 0' }}>
                  <div style={{ color: 'var(--mt-ink-0)', fontWeight: 500 }}>{c.key}</div>
                  <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{c.why}</div>
                </td>
                <td className="num" style={{ textAlign: 'right' }}>{(c.weight * 100).toFixed(0)}%</td>
                <td className="num" style={{ textAlign: 'right' }}>
                  {c.score5.toFixed(2)}
                </td>
                <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
                  +{c.contribution.toFixed(2)}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--mt-line-1)' }}>
              <td style={{ padding: '10px 8px 6px 0', fontWeight: 700 }} colSpan={3}>MacroTilt Score</td>
              <td
                className="num"
                style={{ textAlign: 'right', fontWeight: 700, color: 'var(--mt-accent)', fontSize: 14 }}
              >
                {total.toFixed(2)}<span style={{ color: 'var(--mt-ink-3)', fontSize: 11, marginLeft: 2 }}>/5</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* RIGHT — chart + events + actions */}
      <div>
        <div className="mt-eyebrow" style={{ marginBottom: 8 }}>90-day path · events marked</div>
        <EventChart data={series} accent={accent} events={events} />
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {events.map((e) => (
            <div key={e.badge} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 70px', gap: 8, alignItems: 'center' }}>
              <span
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'var(--mt-surface)',
                  border: `1px solid ${accent}`,
                  color: accent,
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'var(--mt-font-mono)',
                }}
              >
                {e.badge}
              </span>
              <span style={{ color: 'var(--mt-ink-1)' }}>{e.label}</span>
              <span className="num" style={{ color: 'var(--mt-ink-2)', textAlign: 'right' }}>{e.when}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="mt-btn mt-btn--primary"
            onClick={() => navigate(`/ticker/${row.ticker}`)}
          >
            Open ticker detail →
          </button>
          <button
            type="button"
            className="mt-btn"
            onClick={() => onAct?.('watchlist', row.ticker)}
          >
            + Watchlist
          </button>
          <button
            type="button"
            className="mt-btn"
            onClick={() => {
              navigator.clipboard?.writeText(row.ticker);
              onAct?.('copy', row.ticker);
            }}
          >
            Copy ticker
          </button>
        </div>
      </div>
    </div>
  );
}
