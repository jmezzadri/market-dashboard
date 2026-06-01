/* ScanDrill — drill body that opens under a ScanList row.
   Ported from prototype/lm-shared.jsx ScanDrill.

   2026-06-01 rebuild — EVERYTHING here is now real, read off the scan row:
     LEFT  = additive score composition. Each component shows its real
             underlying reading and the real points it contributed; the four
             component point totals SUM to the headline score exactly (no
             fabricated weights, no synthesised per-component scores).
     RIGHT = the engine's real recent-close spark series, the real signal
             facts (insider rules + age, trend, dark-pool, options), the
             plain-English "so_what", the real entry/stop/target trade plan,
             and 3 working buttons.

   The previous version invented all of this (hash-seeded component scores,
   a random-walk chart, and four hardcoded events — incl. "BMO → Outperform"
   — shown identically on every ticker). All removed.

   Score scale is 0-5 (Joe directive 2026-05-27 — backend native scale). */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Sparkline from './Sparkline';
import { buildScanBreakdown } from '../lib/scoreWeights';

/* Human-readable underlying reading for each component, from real fields. */
function readingFor(key, row) {
  if (key === 'Insider') {
    const rules = row.insider_rules?.length ? row.insider_rules.join(' + ') : '—';
    const age = row.insider_age_days != null ? ` · ${row.insider_age_days}d old` : '';
    return `Rules ${rules}${age}`;
  }
  if (key === 'Technicals') {
    const pct = row.sma200_pct;
    const trend = pct == null ? '—'
      : `${pct >= 0 ? 'above' : 'below'} 200-day by ${Math.abs(pct).toFixed(1)}%`;
    const rsi = row.rsi != null ? ` · RSI ${row.rsi.toFixed(0)}` : '';
    return `${trend}${rsi}`;
  }
  if (key === 'Options flow') {
    return row.options_vol_shock != null
      ? `Vol shock ${Number(row.options_vol_shock).toFixed(2)}×`
      : 'No options shock';
  }
  if (key === 'Dark pool') {
    return row.dark_pool_anchor != null
      ? `Anchor $${Number(row.dark_pool_anchor).toFixed(2)}`
      : 'No anchor print';
  }
  return '—';
}

const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `$${Number(v).toFixed(2)}`);

export default function ScanDrill({ row, onAct }) {
  const navigate = useNavigate();
  const { items, total } = useMemo(() => buildScanBreakdown(row), [row]);
  const accent = (row.chg ?? 0) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)';
  const spark = Array.isArray(row.sparkData) ? row.sparkData : null;

  const wk = row.score_1w;
  const mo = row.score_1m;

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
      {/* LEFT — real additive score composition */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div className="mt-eyebrow">Signal composition · points sum to score</div>
          <div className="num" style={{ fontSize: 14, color: 'var(--mt-ink-1)' }}>
            = <b style={{ color: 'var(--mt-accent)' }}>{total.toFixed(2)}</b>
            <span style={{ color: 'var(--mt-ink-3)', marginLeft: 2 }}>/5</span>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Component</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Reading</th>
              <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Points</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const zero = !(c.points > 0);
              return (
                <tr key={c.key} style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                  <td style={{ padding: '8px 8px 8px 0' }}>
                    <div style={{ color: 'var(--mt-ink-0)', fontWeight: 500 }}>{c.key}</div>
                    <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{c.why}</div>
                  </td>
                  <td style={{ padding: '8px', color: zero ? 'var(--mt-ink-3)' : 'var(--mt-ink-1)' }}>
                    {readingFor(c.key, row)}
                  </td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 600, color: zero ? 'var(--mt-ink-3)' : 'var(--mt-ink-0)' }}>
                    {c.points > 0 ? '+' : ''}{c.points.toFixed(2)}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid var(--mt-line-1)' }}>
              <td style={{ padding: '10px 8px 6px 0', fontWeight: 700 }} colSpan={2}>MacroTilt Score</td>
              <td
                className="num"
                style={{ textAlign: 'right', fontWeight: 700, color: 'var(--mt-accent)', fontSize: 14 }}
              >
                {total.toFixed(2)}<span style={{ color: 'var(--mt-ink-3)', fontSize: 11, marginLeft: 2 }}>/5</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Score trend — real prior-scan reads (— when no like-for-like) */}
        <div style={{ marginTop: 12, display: 'flex', gap: 18, fontSize: 12, color: 'var(--mt-ink-2)' }}>
          <span>1w ago <b className="num" style={{ color: 'var(--mt-ink-0)' }}>{wk != null ? wk.toFixed(2) : '—'}</b></span>
          <span>1m ago <b className="num" style={{ color: 'var(--mt-ink-0)' }}>{mo != null ? mo.toFixed(2) : '—'}</b></span>
        </div>
      </div>

      {/* RIGHT — real spark + facts + trade plan + actions */}
      <div>
        <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Recent close path</div>
        {spark?.length ? (
          <div style={{ color: accent }}>
            <Sparkline data={spark} width={460} height={90} stroke={accent} area />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--mt-ink-3)', padding: '24px 0' }}>
            No price series stored for this name.
          </div>
        )}

        {row.so_what && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--mt-ink-1)', lineHeight: 1.5 }}>
            {row.so_what}
          </div>
        )}

        {/* Trade plan — real entry / stop / target from the engine */}
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[['Entry', row.entry], ['Stop', row.stop], ['Target', row.target]].map(([label, v]) => (
            <div key={label} style={{ background: 'var(--mt-surface)', border: '1px solid var(--mt-line-0)', borderRadius: 8, padding: '8px 10px' }}>
              <div className="mt-eyebrow">{label}</div>
              <b className="num" style={{ fontSize: 13 }}>{money(v)}</b>
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
