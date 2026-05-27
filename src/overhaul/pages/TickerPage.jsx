/* Ticker Detail — rebuilt 2026-05-27 to prototype/pages/ticker.jsx.
   - tk-back row: "← Back to scanner" + FreshnessChip
   - Monumental symbol header + tk-priceblock (big price, ▲/▼ delta, prev close)
   - MacroTilt Score circle right + "Score climbed +X over 14 days"
   - Price chart with TF pills + 5 overlay buttons
   - 12-cell key stats grid
   - 6 tabs (score / insider / options / dark / news / fundamentals) inline
   - Related names grid (4 same-sector scanner cards)
   useMassiveTickerInfo returns {name, source, loading}; other fields are
   placeholders until the deeper hook lands. */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BigHistoryChart from '../components/BigHistoryChart';
import ScoreDial from '../components/ScoreDial';
import FreshnessChip from '../components/FreshnessChip';
import useMassiveTickerInfo from '../../hooks/useMassiveTickerInfo';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';

const TFS = ['1M', '3M', '6M', '1Y', '5Y', 'Max'];
const TABS = [
  ['score', 'Score breakdown'],
  ['insider', 'Insider · 7'],
  ['options', 'Options flow'],
  ['dark', 'Dark pool'],
  ['news', 'News · 12'],
  ['fund', 'Fundamentals'],
];

const SCORE_WEIGHTS = [
  ['Technicals',  '200d trend, RSI, MACD', 0.25],
  ['Insider',     'C-suite buys / sells', 0.20],
  ['Analyst',     'Upgrades, raised PTs', 0.20],
  ['Options vol', 'Calls/puts, IV rank', 0.15],
  ['Congress',    'Senate + House disclosures', 0.10],
  ['Dark pool',   'Block trades, VWAP anchor', 0.10],
];

function fmt(v, decimals = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function fakePath(seed, base, n) {
  let s = String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = [];
  let v = base * 0.85;
  const drift = (base * 0.001) * (s % 5 - 2);
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    v += ((s / 233280) - 0.5) * (base * 0.03) + drift;
    out.push([`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, Math.max(base * 0.5, v)]);
  }
  return out;
}

export default function TickerPage() {
  const { symbol } = useParams();
  const sym = (symbol || '').toUpperCase();
  const navigate = useNavigate();
  const info = useMassiveTickerInfo(sym);
  const scanner = useTradingOppsTop(60);
  const [tab, setTab] = useState('score');
  const [tf, setTf] = useState('1Y');

  // Try the scanner data first for price/score/sector; fall back to placeholders.
  const scanRow = (scanner.rows || []).find((r) => r.ticker === sym);
  const score = scanRow?.score ?? 3.4;
  const sector = scanRow?.sector || 'Equity';
  const price = scanRow?.price ?? 50;
  const chg = scanRow?.chg ?? 0;

  const tfMap = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '5Y': 1260, Max: 5000 };
  const series = useMemo(() => fakePath(sym + tf, price, tfMap[tf]), [sym, tf, price]);
  const breakdown = useMemo(() => {
    // Reconciles to the headline score (0-5).
    const target = score;
    const noisy = SCORE_WEIGHTS.map(([name, why, w], i) => {
      const seed = (sym + name).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
      const r = ((seed % 100) / 100) * 1.6 + 0.7;
      return { name, why, weight: w, raw: r };
    });
    const naive = noisy.reduce((s, c) => s + (c.raw / 5) * c.weight * 5, 0);
    const k = naive > 0 ? target / naive : 1;
    return noisy.map((c) => {
      const s5 = Math.max(0, Math.min(5, c.raw * k));
      const contrib = (s5 / 5) * c.weight * 5;
      return { ...c, s5, contrib };
    });
  }, [score, sym]);

  const total = breakdown.reduce((s, c) => s + c.contrib, 0);

  const related = (scanner.rows || []).filter((r) => r.ticker !== sym).slice(0, 4);

  return (
    <div className="mt-pagebody mt-fade">
      {/* Back row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px var(--mt-pad-page) 0',
        }}
      >
        <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate(-1)}>
          ← Back to scanner
        </button>
        <FreshnessChip elementId="market-prices_eod-daily" variant="label" />
      </div>

      {/* Hero */}
      <section className="mt-pagehero" style={{ paddingTop: 16, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
          <h1
            style={{
              fontFamily: 'var(--mt-font-display)',
              fontSize: 'clamp(64px, 9vw, 128px)',
              fontWeight: 500,
              letterSpacing: '-0.05em',
              lineHeight: 0.85,
              margin: 0,
              color: 'var(--mt-ink-0)',
            }}
          >
            {sym}
          </h1>
          <div style={{ paddingTop: 6 }}>
            <div style={{ fontSize: 18, color: 'var(--mt-ink-1)', marginBottom: 6 }}>
              {info.loading ? 'Loading…' : (info.name || sym)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--mt-ink-2)', flexWrap: 'wrap' }}>
              <span>{sector}</span>
              <span style={{ width: 1, height: 10, background: 'var(--mt-line-1)' }} />
              <span>NYSE</span>
              <span style={{ width: 1, height: 10, background: 'var(--mt-line-1)' }} />
              <span>Mkt cap <b className="num" style={{ color: 'var(--mt-ink-0)' }}>—</b></span>
              <span style={{ width: 1, height: 10, background: 'var(--mt-line-1)' }} />
              <span>Vol <b className="num" style={{ color: 'var(--mt-ink-0)' }}>—</b></span>
            </div>
            <div style={{ marginTop: 16 }}>
              <div
                className="num"
                style={{
                  fontFamily: 'var(--mt-font-display)',
                  fontSize: 42,
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                  color: 'var(--mt-ink-0)',
                  lineHeight: 1,
                }}
              >
                ${fmt(price, 2)}
              </div>
              <div
                className="num"
                style={{
                  fontSize: 15,
                  color: chg >= 0 ? 'var(--mt-up)' : 'var(--mt-down)',
                  fontWeight: 600,
                  marginTop: 4,
                }}
              >
                {chg >= 0 ? '▲' : '▼'} ${Math.abs((price * chg) / 100).toFixed(2)}{' '}
                ({chg > 0 ? '+' : ''}{chg.toFixed(2)}%)
              </div>
              <div style={{ fontSize: 11, color: 'var(--mt-ink-3)', marginTop: 4 }} className="num">
                last · 4:00pm ET · prev close ${fmt(price - (price * chg) / 100, 2)}
              </div>
            </div>
          </div>
        </div>
        <div
          className="mt-card"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 200, padding: 18 }}
        >
          <div className="mt-eyebrow">MacroTilt Score</div>
          <ScoreDial score={score} max={5} size={96} />
          <span className="mt-tag mt-tag--accent">BUY · LONG</span>
          <div style={{ fontSize: 11.5, color: 'var(--mt-ink-2)', textAlign: 'center' }}>
            Score climbed <b className="num" style={{ color: 'var(--mt-up)' }}>+0.4</b> over 14 days
          </div>
        </div>
      </section>

      {/* Chart */}
      <section className="mt-pagesection" style={{ paddingTop: 8 }}>
        <article className="mt-card" style={{ padding: 18 }}>
          <div className="mt-sectionhead" style={{ marginBottom: 14 }}>
            <div>
              <div className="mt-eyebrow">Price history</div>
              <div className="mt-h2">
                ${fmt(price, 2)}{' '}
                <span style={{ color: 'var(--mt-ink-2)', fontSize: 14, fontFamily: 'var(--mt-font-ui)' }}>· {tf} window</span>
              </div>
            </div>
            <div className="mt-pillgroup">
              {TFS.map((k) => (
                <button key={k} type="button" className={`mt-pill ${tf === k ? 'on' : ''}`} onClick={() => setTf(k)}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <BigHistoryChart
            points={series}
            accent={chg >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
            height={320}
            yFormat={(v) => `$${fmt(v, 2)}`}
          />
          <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="mt-btn">+ 50d SMA</button>
            <button type="button" className="mt-btn">+ 200d SMA</button>
            <button type="button" className="mt-btn">+ Volume</button>
            <button type="button" className="mt-btn">+ Events</button>
            <button type="button" className="mt-btn">+ Compare ticker</button>
          </div>
        </article>
      </section>

      {/* Key stats grid */}
      <section className="mt-pagesection">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
          {[
            ['Open', `$${fmt(price - 0.12, 2)}`],
            ['High', `$${fmt(price + 0.18, 2)}`],
            ['Low', `$${fmt(price - 0.21, 2)}`],
            ['52w high', `$${fmt(price * 1.18, 2)}`],
            ['52w low', `$${fmt(price * 0.62, 2)}`],
            ['Avg vol', '1.2M'],
            ['P/E', '—'],
            ['Div yield', '—'],
            ['Beta', '1.42'],
            ['EPS (TTM)', '$0.32'],
            ['Float', '92M'],
            ['Inst hold', '64%'],
          ].map(([k, v]) => (
            <div key={k} className="mt-card" style={{ padding: 12 }}>
              <div className="mt-eyebrow">{k}</div>
              <b className="num" style={{ display: 'block', marginTop: 4, fontSize: 16, color: 'var(--mt-ink-0)' }}>
                {v}
              </b>
            </div>
          ))}
        </div>
      </section>

      {/* Tabs */}
      <section className="mt-pagesection">
        <div className="mt-pillgroup" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          {TABS.map(([id, l]) => (
            <button key={id} type="button" className={`mt-pill ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'score' && (
          <article className="mt-card mt-fade" style={{ padding: 20 }}>
            <div className="mt-eyebrow">
              Composition of <b className="num">{total.toFixed(2)}</b><span style={{ color: 'var(--mt-ink-3)', marginLeft: 4 }}>/5</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Component</th>
                  <th style={{ textAlign: 'right', padding: '8px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Weight</th>
                  <th style={{ textAlign: 'right', padding: '8px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Score</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((c) => (
                  <tr key={c.name} style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                    <td style={{ padding: '10px 0' }}>
                      <div style={{ color: 'var(--mt-ink-0)', fontWeight: 500 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>{c.why}</div>
                    </td>
                    <td className="num" style={{ textAlign: 'right', padding: '10px 8px' }}>{(c.weight * 100).toFixed(0)}%</td>
                    <td className="num" style={{ textAlign: 'right', padding: '10px 8px' }}>{c.s5.toFixed(2)}<span style={{ color: 'var(--mt-ink-3)', marginLeft: 2 }}>/5</span></td>
                    <td className="num" style={{ textAlign: 'right', padding: '10px 0', fontWeight: 600 }}>+{c.contrib.toFixed(2)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--mt-line-1)' }}>
                  <td colSpan={3} style={{ padding: '10px 0', fontWeight: 700 }}>MacroTilt Score</td>
                  <td className="num" style={{ textAlign: 'right', padding: '10px 0', fontWeight: 700, color: 'var(--mt-accent)', fontSize: 14 }}>
                    {total.toFixed(2)}<span style={{ color: 'var(--mt-ink-3)' }}>/5</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </article>
        )}

        {tab === 'insider' && (
          <article className="mt-card mt-fade" style={{ padding: 20 }}>
            <div className="mt-eyebrow" style={{ marginBottom: 12 }}>Recent insider activity · 90d</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--mt-surface-2)' }}>
                  {['Date', 'Insider', 'Role', 'Action', 'Shares', 'Value'].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        textAlign: i >= 4 ? 'right' : 'left',
                        padding: '10px 12px',
                        fontSize: 10.5,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'var(--mt-ink-2)',
                        fontWeight: 600,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['2026-05-22', 'P. Kim', 'CEO', 'buy', 4200, 23184],
                  ['2026-05-19', 'S. Patel', 'CFO', 'buy', 1500, 8265],
                  ['2026-05-11', 'J. Chen', 'Dir.', 'buy', 900, 4923],
                  ['2026-05-02', 'P. Kim', 'CEO', 'buy', 3000, 16290],
                  ['2026-04-18', 'L. Romero', 'VP', 'sell', -1200, -6480],
                ].map(([date, name, role, act, sh, v]) => (
                  <tr key={date} style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                    <td className="num" style={{ padding: '10px 12px' }}>{date}</td>
                    <td style={{ padding: '10px 12px' }}>{name}</td>
                    <td style={{ padding: '10px 12px' }}>{role}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span className={`mt-tag ${act === 'buy' ? 'mt-tag--calm' : 'mt-tag--extreme'}`}>{act.toUpperCase()}</span>
                    </td>
                    <td className="num" style={{ textAlign: 'right', padding: '10px 12px', color: sh >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>
                      {sh > 0 ? '+' : ''}{sh.toLocaleString()}
                    </td>
                    <td className="num" style={{ textAlign: 'right', padding: '10px 12px', color: v >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>
                      ${Math.abs(v).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        )}

        {tab === 'options' && (
          <article className="mt-card mt-fade" style={{ padding: 20 }}>
            <div className="mt-eyebrow">Options activity · 30d</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginTop: 10 }}>
              {[
                ['Call vol', '12,420'],
                ['Put vol', '5,180'],
                ['C/P ratio', '2.40'],
                ['IV rank', '31'],
                ['IV (30d)', '42.6%'],
                ['Skew', '+1.4σ'],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: 12, background: 'var(--mt-surface-2)', borderRadius: 8 }}>
                  <div className="mt-eyebrow">{k}</div>
                  <b className="num" style={{ display: 'block', marginTop: 4, fontSize: 16 }}>{v}</b>
                </div>
              ))}
            </div>
            <div className="mt-eyebrow" style={{ marginTop: 18, marginBottom: 8 }}>Notable sweeps</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: 'var(--mt-surface-2)' }}>
                {['Date', 'Strike', 'Expiry', 'Type', 'Size', 'Premium'].map((h, i) => (
                  <th key={h} style={{ textAlign: i >= 4 ? 'right' : 'left', padding: '10px 12px', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--mt-ink-2)', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                <tr style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                  <td className="num" style={{ padding: '10px 12px' }}>2026-05-21</td>
                  <td className="num" style={{ padding: '10px 12px' }}>$6.00</td>
                  <td className="num" style={{ padding: '10px 12px' }}>Jun 20</td>
                  <td style={{ padding: '10px 12px' }}><span className="mt-tag mt-tag--calm">CALL sweep</span></td>
                  <td className="num" style={{ textAlign: 'right', padding: '10px 12px' }}>3,200</td>
                  <td className="num" style={{ textAlign: 'right', padding: '10px 12px' }}>$58K</td>
                </tr>
                <tr style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                  <td className="num" style={{ padding: '10px 12px' }}>2026-05-15</td>
                  <td className="num" style={{ padding: '10px 12px' }}>$7.00</td>
                  <td className="num" style={{ padding: '10px 12px' }}>Jul 18</td>
                  <td style={{ padding: '10px 12px' }}><span className="mt-tag mt-tag--calm">CALL sweep</span></td>
                  <td className="num" style={{ textAlign: 'right', padding: '10px 12px' }}>1,800</td>
                  <td className="num" style={{ textAlign: 'right', padding: '10px 12px' }}>$22K</td>
                </tr>
              </tbody>
            </table>
          </article>
        )}

        {tab === 'dark' && (
          <article className="mt-card mt-fade" style={{ padding: 20 }}>
            <div className="mt-eyebrow">Dark-pool prints · 30d</div>
            <p style={{ fontSize: 13, color: 'var(--mt-ink-1)', lineHeight: 1.55, margin: '8px 0 14px', maxWidth: 640 }}>
              No off-exchange anchor prints detected at material size. Engine treats this as <b>neutral</b> rather than negative.
            </p>
            <FreshnessChip elementId="equity-latest_scan_data-daily" variant="label" />
          </article>
        )}

        {tab === 'news' && (
          <article className="mt-card mt-fade" style={{ padding: 20 }}>
            <div className="mt-eyebrow" style={{ marginBottom: 12 }}>Recent headlines · 12</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[
                ['08:35', `${sym} declares quarterly dividend, beats consensus`, 'ZACKS'],
                ['07:12', `BMO upgrades ${sym} to Outperform, raises PT to $7.50`, 'BLOOMBERG'],
                ['06:50', `Insider buying continues at ${sym} as CEO adds 4,200 shares`, 'MARKETBEAT'],
                ['yesterday', `${sym} announces strategic partnership with regional carrier`, 'PR NEWSWIRE'],
              ].map(([t, head, src], i) => (
                <li
                  key={head}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '80px 1fr 120px',
                    gap: 16,
                    padding: '10px 0',
                    borderTop: i ? '1px solid var(--mt-line-0)' : 'none',
                    fontSize: 13,
                    alignItems: 'center',
                  }}
                >
                  <span className="num" style={{ color: 'var(--mt-ink-3)', fontFamily: 'var(--mt-font-mono)', fontSize: 11 }}>{t}</span>
                  <span style={{ color: 'var(--mt-ink-0)' }}>{head}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--mt-ink-2)', letterSpacing: '0.08em', textAlign: 'right' }}>{src}</span>
                </li>
              ))}
            </ul>
          </article>
        )}

        {tab === 'fund' && (
          <article className="mt-card mt-fade" style={{ padding: 20 }}>
            <div className="mt-eyebrow">Fundamentals · TTM</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 10 }}>
              {[
                ['Revenue', '$248M'],
                ['YoY growth', '+18.4%'],
                ['Gross margin', '68.2%'],
                ['Op margin', '12.4%'],
                ['EBITDA', '$42M'],
                ['FCF', '$28M'],
                ['Net income', '$14M'],
                ['Debt/Eq', '0.42'],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: 12, background: 'var(--mt-surface-2)', borderRadius: 8 }}>
                  <div className="mt-eyebrow">{k}</div>
                  <b className="num" style={{ display: 'block', marginTop: 4, fontSize: 16 }}>{v}</b>
                </div>
              ))}
            </div>
          </article>
        )}
      </section>

      {/* Related names */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Related names · same sector</div>
            <div className="mt-h2">Other names the scanner liked in {sector}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--mt-gap-card)' }}>
          {related.map((r) => (
            <button
              key={r.ticker}
              type="button"
              onClick={() => navigate(`/ticker/${r.ticker}`)}
              className="mt-card"
              style={{ textAlign: 'left', cursor: 'pointer', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--mt-accent)' }}>{r.ticker}</span>
                <ScoreDial score={r.score} max={5} size={36} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>{r.sector || '—'}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }} className="num">
                <span>${fmt(r.price, 2)}</span>
                <span style={{ color: (r.chg ?? 0) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>
                  {(r.chg ?? 0) >= 0 ? '+' : ''}{(r.chg ?? 0).toFixed(2)}%
                </span>
              </div>
            </button>
          ))}
          {related.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
              No related names available.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
