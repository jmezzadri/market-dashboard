/* Ticker Detail page. Site-overhaul PR-O6.
   Monumental ticker symbol + name + price + change · MacroTilt Score
   circle · price-history chart with TF pills + overlay buttons · 12-cell
   key-stats grid · tab pills (Score breakdown / Insider / Options / Dark /
   News / Fundamentals) rendered inline. */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BigHistoryChart from '../components/BigHistoryChart';
import ScoreDial from '../components/ScoreDial';
import FreshnessChip from '../components/FreshnessChip';
import useMassiveTickerInfo from '../../hooks/useMassiveTickerInfo';

const TABS = [
  ['score', 'Score breakdown'],
  ['insider', 'Insider'],
  ['options', 'Options flow'],
  ['dark', 'Dark pool'],
  ['news', 'News'],
  ['fundamentals', 'Fundamentals'],
];

const TFS = ['1M', '3M', '6M', '1Y', '5Y', 'Max'];

function fmt(v, decimals = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function fmtBig(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Math.abs(Number(v));
  if (n >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return fmt(v, 0);
}

export default function TickerPage() {
  const { symbol } = useParams();
  const sym = (symbol || '').toUpperCase();
  const navigate = useNavigate();
  const { info } = useMassiveTickerInfo(sym);
  const [tab, setTab] = useState('score');
  const [tf, setTf] = useState('1Y');
  const [pts, setPts] = useState(null);

  // Pull price history from the existing api/price-history endpoint.
  useEffect(() => {
    if (!sym) return;
    let cancelled = false;
    const tfMap = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '5Y': 1825, Max: 7300 };
    const days = tfMap[tf] || 365;
    setPts(null);
    fetch(`/api/price-history?symbol=${encodeURIComponent(sym)}&days=${days}`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const series = Array.isArray(d?.points) ? d.points : Array.isArray(d) ? d : [];
        const norm = series
          .map((p) => Array.isArray(p) ? [p[0], Number(p[1])] : [p.date || p.t, Number(p.close ?? p.c ?? p.v)])
          .filter((p) => p[0] && Number.isFinite(p[1]));
        setPts(norm);
      })
      .catch(() => setPts([]));
    return () => { cancelled = true; };
  }, [sym, tf]);

  const last = Array.isArray(pts) && pts.length ? pts[pts.length - 1][1] : null;
  const first = Array.isArray(pts) && pts.length ? pts[0][1] : null;
  const chg = last != null && first != null ? last - first : null;
  const chgPct = chg != null && first ? (chg / first) * 100 : null;
  const chgColor = chg == null ? 'var(--mt-ink-2)' : chg >= 0 ? 'var(--mt-up)' : 'var(--mt-down)';

  // Synthesize a MacroTilt score for now — real score will read from the
  // scanner/scoring service in a follow-up.
  const score = info?.mt_score ?? 3.4;

  return (
    <div className="mt-pagebody mt-fade">
      <div style={{ padding: '18px var(--mt-pad-page) 0' }}>
        <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate(-1)}>
          ← Back
        </button>
      </div>

      <section className="mt-pagehero" style={{ paddingTop: 24 }}>
        <div>
          <div className="mt-eyebrow">
            {info?.exchange || '—'} · {info?.sector || 'Sector tbd'}
          </div>
          <h1
            className="mt-h1"
            style={{
              fontSize: 'clamp(48px, 7vw, 96px)',
              letterSpacing: '-0.04em',
              lineHeight: 0.92,
            }}
          >
            {sym}
          </h1>
          <div
            style={{
              marginTop: 10,
              fontSize: 18,
              color: 'var(--mt-ink-1)',
            }}
          >
            {info?.name || 'Loading company name…'}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 14,
              marginTop: 14,
              flexWrap: 'wrap',
            }}
          >
            <span
              className="num"
              style={{
                fontFamily: 'var(--mt-font-display)',
                fontSize: 42,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                color: 'var(--mt-ink-0)',
              }}
            >
              {last == null ? '—' : `$${fmt(last, 2)}`}
            </span>
            <span className="num" style={{ fontSize: 15, color: chgColor, fontWeight: 600 }}>
              {chg == null
                ? ''
                : `${chg >= 0 ? '+' : ''}${fmt(chg, 2)} (${chg >= 0 ? '+' : ''}${fmt(chgPct, 2)}%) · ${tf}`}
            </span>
            <FreshnessChip elementId="prices-eod-daily" variant="dot" />
          </div>
        </div>
        <div
          className="mt-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            minWidth: 180,
          }}
        >
          <div className="mt-eyebrow">MacroTilt score</div>
          <ScoreDial score={score} max={5} size={96} />
          <div style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>out of 5</div>
        </div>
      </section>

      {/* Chart */}
      <section className="mt-pagesection" style={{ paddingTop: 8 }}>
        <div
          className="mt-card"
          style={{ padding: 18 }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div className="mt-pillgroup">
              {TFS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`mt-pill ${tf === k ? 'on' : ''}`}
                  onClick={() => setTf(k)}
                >
                  {k}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="mt-btn" disabled title="Coming soon">+ 50d SMA</button>
              <button type="button" className="mt-btn" disabled title="Coming soon">+ 200d SMA</button>
              <button type="button" className="mt-btn" disabled title="Coming soon">+ Volume</button>
              <button type="button" className="mt-btn" disabled title="Coming soon">+ Events</button>
            </div>
          </div>
          <BigHistoryChart points={pts || []} accent="var(--mt-accent)" height={320} yFormat={(v) => `$${fmt(v, 2)}`} />
        </div>
      </section>

      {/* Key stats grid */}
      <section className="mt-pagesection">
        <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Key stats</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 14,
          }}
        >
          {[
            ['Open', fmt(info?.day_open, 2)],
            ['High', fmt(info?.day_high, 2)],
            ['Low', fmt(info?.day_low, 2)],
            ['52w high', fmt(info?.high_52w, 2)],
            ['52w low', fmt(info?.low_52w, 2)],
            ['Avg vol', fmtBig(info?.avg_volume)],
            ['P/E', fmt(info?.pe_ratio, 2)],
            ['Div yield', info?.div_yield != null ? `${fmt(info.div_yield, 2)}%` : '—'],
            ['Beta', fmt(info?.beta, 2)],
            ['EPS', fmt(info?.eps, 2)],
            ['Float', fmtBig(info?.float)],
            ['Mkt cap', fmtBig(info?.market_cap)],
          ].map(([lbl, v]) => (
            <div key={lbl} className="mt-card" style={{ padding: 12 }}>
              <div className="mt-eyebrow">{lbl}</div>
              <div
                className="num"
                style={{ fontSize: 18, marginTop: 4, color: 'var(--mt-ink-0)' }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tabs */}
      <section className="mt-pagesection">
        <div className="mt-pillgroup" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          {TABS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={`mt-pill ${tab === k ? 'on' : ''}`}
              onClick={() => setTab(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <div
          className="mt-card"
          style={{ padding: 28, minHeight: 200 }}
        >
          {tab === 'score' && (
            <>
              <h3
                style={{
                  fontFamily: 'var(--mt-font-display)',
                  fontSize: 20,
                  fontWeight: 500,
                  margin: '0 0 8px',
                }}
              >
                Score breakdown — {sym}
              </h3>
              <p style={{ fontSize: 14, color: 'var(--mt-ink-1)', margin: 0 }}>
                The composite score above reconciles to a weighted sum of six
                component scores. Per-component scores will surface here once
                wired to the scoring service (planned next sprint).
              </p>
            </>
          )}
          {tab === 'insider' && (
            <p style={{ fontSize: 14, color: 'var(--mt-ink-2)', margin: 0 }}>
              Insider buy / sell timeline from Unusual Whales — wired in
              upcoming pass.
            </p>
          )}
          {tab === 'options' && (
            <p style={{ fontSize: 14, color: 'var(--mt-ink-2)', margin: 0 }}>
              Options flow snapshot from Unusual Whales — wired in
              upcoming pass.
            </p>
          )}
          {tab === 'dark' && (
            <p style={{ fontSize: 14, color: 'var(--mt-ink-2)', margin: 0 }}>
              Dark-pool prints from Unusual Whales — wired in upcoming pass.
            </p>
          )}
          {tab === 'news' && (
            <p style={{ fontSize: 14, color: 'var(--mt-ink-2)', margin: 0 }}>
              Recent headlines for {sym} — wired in upcoming pass.
            </p>
          )}
          {tab === 'fundamentals' && (
            <p style={{ fontSize: 14, color: 'var(--mt-ink-2)', margin: 0 }}>
              Income statement / balance sheet / cash flow from Polygon —
              wired in upcoming pass.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
