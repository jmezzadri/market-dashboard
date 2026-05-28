// PaperPortfolioPage — Paper Trading Portfolio results page.
//
// Brand re-aligned 2026-05-27: page now follows the canonical v2 editorial
// pattern (v2-root / v2-hero / v2-shell, Inter clamp typography on the NAV,
// --ink-/--bg-/--line- tokens, t-eyebrow accents, FreshnessChip on every
// surface). Previous version used stale --surface/--border tokens and a
// raw 32px non-formatted NAV that rendered as "997096", which Joe flagged
// as off-brand vs the rest of the cutover.
//
// Reads four Supabase tables populated by the paper_portfolio nightly
// runner (Phase 4):
//   * paper_accounts        — sleeve caps + leverage cap (one row)
//   * paper_nav_daily       — daily NAV path for the chart + headline numbers
//   * paper_positions       — latest snapshot's per-name positions, by sleeve
//   * paper_orders          — recent order intents + their submitted/filled
//                              status (the rebalance trail)
//
// Brand guard (UX Designer):
//   * Light mode primary. No emojis. Professional minimalist.
//   * Hero NAV uses the same Inter clamp + small superscript-$ pattern as
//     InsightsPage so the two financial pages read as siblings.
//   * Every data-driven section carries a FreshnessChip pinned to its
//     pipeline element (paper-nav-daily / paper-positions / paper-orders).
//
// Senior Quant guard:
//   * Sleeve attribution comes straight from the DB column (we do NOT
//     re-infer in the UI). If a row has sleeve='A' / 'B' that's the source.
//   * Leverage badge fires when sleeve_b_margin_used > 0.

import React, { useEffect, useMemo, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import { supabase } from '../../lib/supabase';
import { InfoTip } from '../../InfoTip';

const STARTING_CAPITAL = 1_000_000;       // $1M paper, locked

// Risk-on / risk-off palette (fallbacks match the .scenarios-page hex
// because the global --up/--down tokens aren't defined outside that scope).
const UP_COLOR   = 'var(--up, #1f8a5a)';
const DOWN_COLOR = 'var(--down, #b62121)';
const WARN_COLOR = 'var(--warn, #b87000)';

// ── small helpers ──────────────────────────────────────────────────────────

const fmtMoneyShort = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000)    return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtMoneyExact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

const fmtPct = (n, places = 2) => {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(places)}%`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

// ── NAV hero — editorial typography, matches InsightsPage hero ─────────────

function NavHero({ navHistory, account }) {
  const empty = !navHistory || navHistory.length === 0;
  const latest = empty ? null : navHistory[navHistory.length - 1];
  const first  = empty ? null : navHistory[0];

  const totalNav     = latest?.total_nav ?? null;
  const totalReturn  = totalNav != null ? (totalNav - STARTING_CAPITAL) / STARTING_CAPITAL : null;
  const periodReturn = (first && totalNav != null) ? (totalNav - first.total_nav) / first.total_nav : null;
  const spyStart     = first?.benchmark_spy_value ?? null;
  const spyNow       = latest?.benchmark_spy_value ?? null;
  const spyReturn    = (spyStart && spyNow) ? (spyNow / spyStart - 1) : null;
  const alpha        = (spyReturn != null && periodReturn != null) ? (periodReturn - spyReturn) : null;
  const leverageUsed = latest?.sleeve_b_margin_used || 0;
  const leverageOn   = leverageUsed > 0;
  const isUp         = totalReturn != null && totalReturn >= 0;

  return (
    <header className="v2-hero">
      <div className="arc" aria-hidden="true">
        <svg viewBox="0 0 600 600" preserveAspectRatio="xMaxYMid slice">
          <g transform="translate(420 300)">
            {[60,100,140,180,220,260,300,340].map((r) => <circle key={r} r={r} />)}
          </g>
        </svg>
      </div>
      <div className="v2-shell">
        <div className="v2-hero-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="t-eyebrow accent" style={{ marginBottom: 14 }}>
              Total portfolio NAV <InfoTip term="TOTAL PORTFOLIO NAV" def="The current liquidation value of the $1M paper book on Alpaca, summed across Sleeve A (Asset Tilt) and Sleeve B (Scanner)." size={11} />
            </div>
            <div style={{
              fontFamily: 'Inter,system-ui,-apple-system,sans-serif',
              fontSize: 'clamp(48px,6vw,80px)',
              lineHeight: 0.95,
              letterSpacing: '-.025em',
              color: 'var(--ink-0)',
              fontFeatureSettings: '"tnum","lnum"',
            }}>
              {totalNav == null ? '—' : (
                <>
                  <span style={{ fontSize: '.5em', color: 'var(--ink-2)', marginRight: 4, verticalAlign: '0.18em' }}>$</span>
                  <CountUp to={Math.round(totalNav)} format={(v) => Math.round(v).toLocaleString('en-US')} />
                </>
              )}
            </div>
            <div style={{ marginTop: 10, fontSize: 13, color: isUp ? UP_COLOR : DOWN_COLOR, fontWeight: 500, fontFeatureSettings: '"tnum"' }}>
              {totalReturn == null
                ? <span style={{ color: 'var(--ink-2)' }}>Awaiting first nightly run</span>
                : <>{fmtPct(totalReturn)} since inception · {fmtMoneyShort(totalNav - STARTING_CAPITAL)} {isUp ? 'gained' : 'lost'}</>
              }
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <FreshnessChip elementId="portfolio.paper-nav-daily" />
            {leverageOn && (
              <span style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                padding: '4px 10px',
                borderRadius: 4,
                background: WARN_COLOR,
                color: '#fff',
              }}>
                Leverage on · {fmtMoneyShort(leverageUsed)} borrowed
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ── KPI row — 4 tiles immediately below the hero (sleeves / benchmark / lev) ─

function KpiRow({ navHistory, account }) {
  const empty = !navHistory || navHistory.length === 0;
  const latest = empty ? null : navHistory[navHistory.length - 1];
  const first  = empty ? null : navHistory[0];

  const spyStart     = first?.benchmark_spy_value ?? null;
  const spyNow       = latest?.benchmark_spy_value ?? null;
  const spyReturn    = (spyStart && spyNow) ? (spyNow / spyStart - 1) : null;
  const periodReturn = (first && latest?.total_nav != null) ? (latest.total_nav - first.total_nav) / first.total_nav : null;
  const alpha        = (spyReturn != null && periodReturn != null) ? (periodReturn - spyReturn) : null;
  const leverageUsed = latest?.sleeve_b_margin_used || 0;
  const leverageOn   = leverageUsed > 0;

  const tileStyle = {
    background: 'var(--bg-1)',
    border: '1px solid var(--line-1)',
    borderRadius: 'var(--r-tile, 10px)',
    padding: '20px 22px',
    minHeight: 116,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };

  const eyebrow = {
    fontSize: 10.5,
    fontWeight: 500,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: 'var(--ink-2)',
  };

  const big = {
    fontFamily: 'Inter,system-ui,-apple-system,sans-serif',
    fontSize: 26,
    lineHeight: 1,
    color: 'var(--ink-0)',
    fontFeatureSettings: '"tnum","lnum"',
    fontWeight: 500,
  };

  const sub = { fontSize: 11.5, color: 'var(--ink-2)', fontFeatureSettings: '"tnum"' };

  return (
    <div className="v2-shell" style={{ marginTop: 28 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div style={tileStyle}>
          <span style={eyebrow}>Sleeve A — Asset Tilt <InfoTip term="Sleeve A" def="$500K following the Asset Tilt engine's 24-industry-group allocation. ETFs only. Unlevered." size={10} /></span>
          <span style={big}>{latest?.sleeve_a_nav != null ? fmtMoneyExact(latest.sleeve_a_nav) : '—'}</span>
          <span style={sub}>
            {latest ? `${fmtMoneyExact(latest.sleeve_a_equity)} held · ${fmtMoneyExact(latest.sleeve_a_cash)} cash` : 'Awaiting first run'}
          </span>
        </div>

        <div style={tileStyle}>
          <span style={eyebrow}>Sleeve B — Scanner <InfoTip term="Sleeve B" def="$500K following the Equity Scanner long-only. Up to 2x leverage when buy signals exceed $500K. Cash idle when signals are scarce." size={10} /></span>
          <span style={big}>{latest?.sleeve_b_nav != null ? fmtMoneyExact(latest.sleeve_b_nav) : '—'}</span>
          <span style={sub}>
            {latest ? `${fmtMoneyExact(latest.sleeve_b_equity)} held · ${fmtMoneyExact(latest.sleeve_b_cash)} cash` : 'Awaiting first run'}
          </span>
        </div>

        <div style={tileStyle}>
          <span style={eyebrow}>vs SPY 50/50 Benchmark <InfoTip term="vs SPY 50/50" def="Difference between the portfolio's total return and a 50/50 SPY benchmark since inception. Positive numbers mean the strategy is beating buy-and-hold SPY." size={10} /></span>
          <span style={{ ...big, color: alpha == null ? 'var(--ink-3)' : (alpha >= 0 ? UP_COLOR : DOWN_COLOR) }}>
            {alpha == null ? '—' : fmtPct(alpha)}
          </span>
          <span style={sub}>
            SPY {spyReturn == null ? '—' : fmtPct(spyReturn)} · Portfolio {periodReturn == null ? '—' : fmtPct(periodReturn)}
          </span>
        </div>

        <div style={tileStyle}>
          <span style={eyebrow}>Leverage usage <InfoTip term="Leverage usage" def="Dollars borrowed via margin on Sleeve B. Fires whenever Scanner buy signals exceed $500K of cash. Cap is 2x Sleeve B ($1M total stock value)." size={10} /></span>
          <span style={{ ...big, color: leverageOn ? WARN_COLOR : 'var(--ink-3)' }}>
            {leverageOn ? fmtMoneyExact(leverageUsed) : '—'}
          </span>
          <span style={sub}>Cap: $1M total stock value (2× Sleeve B)</span>
        </div>
      </div>
    </div>
  );
}

// ── NAV path — line chart styled like InsightsPage ─────────────────────────

function NavPath({ data }) {
  if (!data || data.length < 2) return null;
  const w = 1100;
  const h = 220;
  const padL = 56;
  const padR = 20;
  const padT = 16;
  const padB = 28;

  const xs = data.map((_, i) => i);
  const ys = data.map((d) => d.total_nav);
  const spyYs = data.map((d) => d.benchmark_spy_value).filter((v) => v != null);
  const spyAvailable = spyYs.length === data.length;
  const minY = Math.min(...ys, ...(spyAvailable ? spyYs : []));
  const maxY = Math.max(...ys, ...(spyAvailable ? spyYs : []));
  const yRange = Math.max(1, maxY - minY);
  const xRange = Math.max(1, xs.length - 1);
  const xScale = (i) => padL + ((w - padL - padR) * i) / xRange;
  const yScale = (v) => padT + (h - padT - padB) * (1 - (v - minY) / yRange);

  const navPath = ys.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i)},${yScale(v)}`).join(' ');
  const spyPath = spyAvailable
    ? data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i)},${yScale(d.benchmark_spy_value)}`).join(' ')
    : '';

  return (
    <div className="v2-shell" style={{ marginTop: 28 }}>
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile, 10px)', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 18, fontWeight: 600, color: 'var(--ink-0)', letterSpacing: '-.005em' }}>
            NAV path <InfoTip term="NAV PATH" def="Total portfolio NAV since the paper book began trading, alongside a 50/50 SPY benchmark for context." size={12} />
          </h2>
          <span style={{ fontSize: 11, color: 'var(--ink-2)', display: 'flex', gap: 18, fontFeatureSettings: '"tnum"' }}>
            <span><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--ink-0)', marginRight: 6, verticalAlign: 'middle' }} /> Portfolio</span>
            {spyAvailable && <span><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--ink-2)', marginRight: 6, verticalAlign: 'middle' }} /> SPY 50/50</span>}
          </span>
        </div>
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const v = minY + t * yRange;
            const y = yScale(v);
            return (
              <g key={t}>
                <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="var(--line-0)" strokeWidth="0.6" />
                <text x={padL - 8} y={y + 3} fontSize="10" textAnchor="end" fill="var(--ink-2)">
                  ${(v / 1000).toFixed(0)}K
                </text>
              </g>
            );
          })}
          {spyAvailable && (
            <path d={spyPath} fill="none" stroke="var(--ink-2)" strokeWidth="1.5" strokeDasharray="3,4" />
          )}
          <path d={navPath} fill="none" stroke="var(--ink-0)" strokeWidth="2" />
          <text x={padL} y={h - 8} fontSize="10" fill="var(--ink-2)">{fmtDate(data[0].snapshot_date)}</text>
          <text x={w - padR} y={h - 8} fontSize="10" textAnchor="end" fill="var(--ink-2)">{fmtDate(data[data.length - 1].snapshot_date)}</text>
        </svg>
      </div>
    </div>
  );
}

// ── Positions panel (one per sleeve) ───────────────────────────────────────

function PositionsPanel({ title, sleeve, positions, totalCapital, infoDef }) {
  const [sortBy, setSortBy] = useState('market_value');
  const [sortDir, setSortDir] = useState('desc');

  const sorted = useMemo(() => {
    const a = [...positions];
    a.sort((x, y) => {
      const xv = x[sortBy] ?? -Infinity;
      const yv = y[sortBy] ?? -Infinity;
      if (typeof xv === 'string') return sortDir === 'asc' ? xv.localeCompare(yv) : yv.localeCompare(xv);
      return sortDir === 'asc' ? xv - yv : yv - xv;
    });
    return a;
  }, [positions, sortBy, sortDir]);

  const grossLong = positions.reduce((s, p) => s + (p.market_value || 0), 0);
  const unreal = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
  const leverageRatio = totalCapital > 0 ? grossLong / totalCapital : 0;

  const headStyle = {
    textAlign: 'left',
    padding: '14px 28px',
    fontSize: 10.5,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: 'var(--ink-2)',
    fontWeight: 500,
    borderBottom: '1px solid var(--line-1)',
    background: 'var(--bg-1)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const cellStyle = (align = 'left') => ({
    padding: '14px 28px',
    borderBottom: '1px solid var(--line-0)',
    textAlign: align,
    color: 'var(--ink-1)',
    fontFeatureSettings: '"tnum"',
  });

  const sortBtn = (label, key, align = 'left') => (
    <th
      onClick={() => {
        if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortBy(key); setSortDir('desc'); }
      }}
      style={{ ...headStyle, textAlign: align }}
    >
      {label} {sortBy === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="v2-shell" style={{ marginTop: 28 }}>
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile, 10px)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '24px 28px 14px', borderBottom: '1px solid var(--line-0)', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 18, fontWeight: 600, color: 'var(--ink-0)', letterSpacing: '-.005em' }}>
              Sleeve {sleeve} — {title}
              {infoDef && <InfoTip term={`Sleeve ${sleeve}`} def={infoDef} size={12} />}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 6, fontFeatureSettings: '"tnum"' }}>
              {positions.length} position{positions.length === 1 ? '' : 's'} · {fmtMoneyExact(grossLong)} gross long
              {leverageRatio > 1.0 && (
                <> · <span style={{ color: WARN_COLOR, fontWeight: 600 }}>{leverageRatio.toFixed(2)}× leverage</span></>
              )}
              {' '}· {unreal >= 0
                ? <span style={{ color: UP_COLOR }}>+{fmtMoneyExact(unreal)} unrealized</span>
                : <span style={{ color: DOWN_COLOR }}>{fmtMoneyExact(unreal)} unrealized</span>
              }
            </div>
          </div>
          <FreshnessChip elementId="portfolio.paper-positions-snapshot" />
        </div>

        {positions.length === 0 ? (
          <div style={{ padding: '32px 28px', textAlign: 'center', color: 'var(--ink-2)', fontSize: 13 }}>
            {sleeve === 'B'
              ? 'Scanner found no qualifying buy signals at the moment. Positions appear here after the next rebalance cycle.'
              : 'Awaiting first rebalance. Asset Tilt positions appear here after the next nightly run.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {sortBtn('Ticker', 'ticker', 'left')}
                  {sortBtn('Quantity', 'quantity', 'right')}
                  {sortBtn('Avg cost', 'avg_cost', 'right')}
                  {sortBtn('Market value', 'market_value', 'right')}
                  {sortBtn('Unrealized P&L', 'unrealized_pnl', 'right')}
                  {sleeve === 'B' && sortBtn('Score', 'current_score', 'right')}
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => (
                  <tr key={`${p.ticker}-${i}`}>
                    <td style={{ ...cellStyle('left'), color: 'var(--ink-0)', fontWeight: 500 }}>{p.ticker}</td>
                    <td style={cellStyle('right')}>
                      {p.quantity != null ? Number(p.quantity).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td style={cellStyle('right')}>
                      {p.avg_cost != null ? `$${Number(p.avg_cost).toFixed(2)}` : '—'}
                    </td>
                    <td style={{ ...cellStyle('right'), color: 'var(--ink-0)', fontWeight: 500 }}>
                      {fmtMoneyExact(p.market_value)}
                    </td>
                    <td style={{ ...cellStyle('right'), color: (p.unrealized_pnl || 0) >= 0 ? UP_COLOR : DOWN_COLOR }}>
                      {fmtMoneyExact(p.unrealized_pnl)}
                    </td>
                    {sleeve === 'B' && (
                      <td style={cellStyle('right')}>
                        {p.current_score != null ? p.current_score : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rebalance log ──────────────────────────────────────────────────────────

function RebalanceLog({ orders }) {
  const byDate = useMemo(() => {
    if (!orders || orders.length === 0) return [];
    const m = new Map();
    for (const o of orders) {
      const d = (o.created_at || '').split('T')[0];
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(o);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
  }, [orders]);

  return (
    <div className="v2-shell" style={{ marginTop: 28 }}>
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile, 10px)', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 18, fontWeight: 600, color: 'var(--ink-0)', letterSpacing: '-.005em' }}>
            Recent rebalances <InfoTip term="RECENT REBALANCES" def="Last five days on which the engine fired buy or sell intents to Alpaca. Filled / pending / rejected counts come from the Alpaca order ledger." size={12} />
          </h2>
          <FreshnessChip elementId="portfolio.paper-orders-intent" />
        </div>
        {byDate.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--ink-2)', fontSize: 13 }}>
            No orders yet. The first rebalance will appear here after the next signal cycle.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {byDate.map(([date, rows]) => {
              const buys = rows.filter((r) => r.side === 'buy').length;
              const sells = rows.filter((r) => r.side === 'sell').length;
              const filled = rows.filter((r) => r.status === 'filled').length;
              const pending = rows.filter((r) => r.status === 'pending').length;
              const rejected = rows.filter((r) => r.status === 'rejected').length;
              return (
                <div key={date} style={{ borderLeft: '2px solid var(--line-1)', paddingLeft: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-0)' }}>
                    {fmtDate(date)}
                    {' '}<span style={{ fontWeight: 400, color: 'var(--ink-2)', fontFeatureSettings: '"tnum"' }}>
                      · {rows.length} orders ({buys} buys, {sells} sells)
                      {pending > 0  && <> · <span style={{ color: WARN_COLOR }}>{pending} pending</span></>}
                      {rejected > 0 && <> · <span style={{ color: DOWN_COLOR }}>{rejected} rejected</span></>}
                      {filled > 0   && <> · <span style={{ color: UP_COLOR }}>{filled} filled</span></>}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3, letterSpacing: '.04em' }}>
                    {[...new Set(rows.map((r) => r.signal_source))].join(' + ')}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Spec card ──────────────────────────────────────────────────────────────

function SpecCard() {
  return (
    <div className="v2-shell" style={{ marginTop: 28, marginBottom: 32 }}>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile, 10px)', padding: 24 }}>
        <div className="t-eyebrow" style={{ marginBottom: 10, color: 'var(--ink-2)' }}>How this portfolio works</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-1)' }}>
          $1M paper portfolio on Alpaca, split in half. Sleeve A follows the Asset Tilt
          engine: 24 industry-group ETFs at the engine's recommended weights, $500K
          capital, unlevered. Sleeve B follows the Equity Scanner long-only: buy when
          the buy-score is at least 5, exit when it drops below 5, sized into $50K /
          $40K / $30K slots by tier, up to 2× leverage when there are more buys than
          cash to cover them. Rebalance fires whenever Asset Tilt or the Scanner moves;
          orders go to Alpaca as market-on-open for the next trading day. Idle cash
          sits as literal cash — no bond proxy.
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PaperPortfolioPage() {
  const [navHistory, setNavHistory] = useState([]);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [account, setAccount] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nav = await supabase
          .from('paper_nav_daily')
          .select('*')
          .order('snapshot_date', { ascending: true });
        if (!cancelled) setNavHistory(nav.data || []);

        const latestDate = await supabase
          .from('paper_positions')
          .select('snapshot_date')
          .order('snapshot_date', { ascending: false })
          .limit(1);
        const ld = latestDate?.data?.[0]?.snapshot_date;
        if (ld) {
          const pos = await supabase
            .from('paper_positions')
            .select('*')
            .eq('snapshot_date', ld)
            .order('market_value', { ascending: false });
          if (!cancelled) setPositions(pos.data || []);
        }

        const ord = await supabase
          .from('paper_orders')
          .select('id, created_at, sleeve, ticker, side, target_notional, signal_source, status, signal_score')
          .order('created_at', { ascending: false })
          .limit(200);
        if (!cancelled) setOrders(ord.data || []);

        const acc = await supabase
          .from('paper_accounts')
          .select('*')
          .eq('status', 'active')
          .limit(1);
        if (!cancelled) setAccount(acc?.data?.[0] || null);
      } catch (e) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sleeveA = useMemo(() => positions.filter((p) => p.sleeve === 'A'), [positions]);
  const sleeveB = useMemo(() => positions.filter((p) => p.sleeve === 'B'), [positions]);

  return (
    <div className="v2-root">
      <NavHero navHistory={navHistory} account={account} />
      <KpiRow navHistory={navHistory} account={account} />
      <NavPath data={navHistory} />
      <PositionsPanel
        title="Asset Tilt — Industry-Group ETFs"
        sleeve="A"
        positions={sleeveA}
        totalCapital={account?.sleeve_a_allocation || 500_000}
        infoDef="$500K following the Asset Tilt engine's 24-industry-group allocation. ETFs only. Unlevered."
      />
      <PositionsPanel
        title="Equity Scanner — Long-Only"
        sleeve="B"
        positions={sleeveB}
        totalCapital={account?.sleeve_b_allocation || 500_000}
        infoDef="$500K following the Equity Scanner long-only. Buy when buy-score ≥ 5; size $50K / $40K / $30K by tier; up to 2× leverage when signals exceed $500K."
      />
      <RebalanceLog orders={orders} />
      <SpecCard />

      {err && (
        <div className="v2-shell" style={{ marginBottom: 24 }}>
          <div style={{ padding: 14, background: 'var(--bg-2)', border: `1px solid ${DOWN_COLOR}`, borderRadius: 'var(--r-tile, 10px)', color: DOWN_COLOR, fontSize: 12 }}>
            Data load error: {err}
          </div>
        </div>
      )}
    </div>
  );
}
