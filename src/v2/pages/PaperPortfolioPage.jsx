// PaperPortfolioPage — Paper Trading Portfolio results page.
//
// Reads four Supabase tables populated by the paper_portfolio nightly
// runner (Phase 4):
//   * paper_accounts        — sleeve caps + leverage cap (one row)
//   * paper_nav_daily       — daily NAV path for the chart + headline numbers
//   * paper_positions       — latest snapshot's per-name positions, by sleeve
//   * paper_orders          — recent order intents + their submitted/filled
//                              status (the rebalance trail)
//   * paper_signal_capture  — what the engine + scanner said when the last
//                              rebalance fired (audit modal)
//
// Brand guard (UX Designer):
//   * Light mode primary. No emojis. Professional minimalist.
//   * Numbers formatted like the rest of the dashboard. Freshness chip on
//     every data-driven block.
//   * Tables sortable via the shared useSortableTable_v1 hook (LESSONS 4).
//
// Senior Quant guard:
//   * Sleeve attribution comes straight from the DB column (we do NOT
//     re-infer in the UI). If a row has sleeve='A' / 'B' that's the source.
//   * Leverage badge fires when sleeve_b_margin_used > 0. Cap badge fires
//     when total_nav_long > paper_accounts.starting_capital × leverage cap.

import React, { useEffect, useMemo, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import { supabase } from '../../lib/supabase';
import { InfoTip } from '../../InfoTip';

const STARTING_CAPITAL = 1_000_000;       // $1M paper, locked

// ── small helpers ──────────────────────────────────────────────────────────

const fmtMoney = (n, places = 0) => {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(places || 2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(places || 1)}K`;
  return `${sign}$${abs.toFixed(places)}`;
};

const fmtMoneyExact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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

// ── styles (inline, matches the rest of v2's pattern) ──────────────────────

const COLOR = {
  green: '#0e8a3e',
  red:   '#b62121',
  amber: '#b87000',
  border: 'var(--border-faint)',
  borderHeavy: 'var(--border)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2, var(--surface))',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
};

const SECTION = {
  marginBottom: 24,
  background: COLOR.surface,
  border: `1px solid ${COLOR.border}`,
  borderRadius: 8,
  padding: 18,
};

const KPI_CELL = {
  display: 'grid',
  gap: 4,
  padding: '12px 14px',
  background: COLOR.surface2,
  border: `1px solid ${COLOR.border}`,
  borderRadius: 6,
};

// ── NAV hero ───────────────────────────────────────────────────────────────

function NavHero({ navHistory, account }) {
  if (!navHistory || navHistory.length === 0) {
    return (
      <div style={{ ...SECTION, textAlign: 'center', padding: 36, color: COLOR.textMuted }}>
        No NAV history yet. The paper portfolio starts populating after the first
        nightly cycle. <FreshnessChip elementId="portfolio.paper-nav-daily" label="awaiting first run" />
      </div>
    );
  }

  const latest = navHistory[navHistory.length - 1];
  const first = navHistory[0];
  const totalNav = latest.total_nav;
  const totalReturn = (totalNav - STARTING_CAPITAL) / STARTING_CAPITAL;
  const isUp = totalReturn >= 0;

  // P&L decomposition (written by the close-of-day snapshot). Fall back to the
  // exact identity total = realized + unrealized if a column is missing.
  const totalUnrl = latest.total_unrealized_pnl ?? null;
  const totalReal = latest.total_realized_pnl ??
    (totalUnrl != null ? (totalNav - STARTING_CAPITAL) - totalUnrl : null);

  // Benchmarks — capital-matched to $1M at the first day we have a SPY close.
  // SPY = 100% S&P 500 buy & hold. Blend = 60% SPY / 40% AGG bonds.
  const bmBase = navHistory.find((d) => d.spy_close != null) || null;
  const spy0 = bmBase?.spy_close ?? null;
  const agg0 = bmBase?.agg_close ?? null;
  const spyN = latest?.spy_close ?? null;
  const aggN = latest?.agg_close ?? null;
  // Portfolio return measured over the SAME window as the benchmark anchor.
  const portBase = bmBase?.total_nav ?? first?.total_nav ?? STARTING_CAPITAL;
  const periodReturn = portBase ? (totalNav - portBase) / portBase : totalReturn;
  const spyReturn = spy0 && spyN ? (spyN / spy0 - 1) : null;
  const blendReturn = (spy0 && spyN && agg0 && aggN)
    ? (0.6 * (spyN / spy0 - 1) + 0.4 * (aggN / agg0 - 1)) : null;
  const spyAlpha = spyReturn != null ? (periodReturn - spyReturn) : null;
  const blendAlpha = blendReturn != null ? (periodReturn - blendReturn) : null;

  const beta = latest.portfolio_beta ?? null;
  const leverageUsed = latest.sleeve_b_margin_used || 0;
  const leverageOn = leverageUsed > 0;

  // Per-sleeve roll-ups. NOTE: sleeve_*_nav from the DB is a cash-plug that
  // always sums back to the $500K cap (single Alpaca cash pool), so it can't
  // be used for return. Mark each sleeve to market instead:
  //   value = $500K start + realized + unrealized;  return = P&L / $500K.
  const SLEEVE_CAP = 500_000;
  const aUnrl = latest.sleeve_a_unrealized_pnl ?? null;
  const bUnrl = latest.sleeve_b_unrealized_pnl ?? null;
  const aReal = latest.sleeve_a_realized_pnl ?? null;
  const bReal = latest.sleeve_b_realized_pnl ?? null;
  const aPos = latest.sleeve_a_positions ?? null;
  const bPos = latest.sleeve_b_positions ?? null;
  const aPnl = (aUnrl != null || aReal != null) ? (aReal ?? 0) + (aUnrl ?? 0) : null;
  const bPnl = (bUnrl != null || bReal != null) ? (bReal ?? 0) + (bUnrl ?? 0) : null;
  const aNav = aPnl != null ? SLEEVE_CAP + aPnl : latest.sleeve_a_nav;
  const bNav = bPnl != null ? SLEEVE_CAP + bPnl : latest.sleeve_b_nav;
  const aRet = aPnl != null ? aPnl / SLEEVE_CAP : null;
  const bRet = bPnl != null ? bPnl / SLEEVE_CAP : null;

  const signColor = (n) => (n == null ? COLOR.textMuted : (n >= 0 ? COLOR.green : COLOR.red));

  const SleeveCell = ({ name, def, nav, ret, unrl, real, pos }) => (
    <div style={KPI_CELL}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
        {name} <InfoTip term={name} def={def} size={10} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: COLOR.text }}>{fmtMoney(nav)}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: signColor(ret) }}>{fmtPct(ret)}</span>
      </div>
      <div style={{ fontSize: 11, color: COLOR.textMuted }}>
        <span style={{ color: signColor(unrl) }}>{fmtMoneyExact(unrl)}</span> unreal ·{' '}
        <span style={{ color: signColor(real) }}>{fmtMoneyExact(real)}</span> real
      </div>
      <div style={{ fontSize: 11, color: COLOR.textMuted }}>
        {pos == null ? '—' : pos} position{pos === 1 ? '' : 's'}
      </div>
    </div>
  );

  const BenchCell = ({ label, def, alpha, you, bench, benchLabel }) => (
    <div style={KPI_CELL}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
        {label} <InfoTip term={label} def={def} size={10} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: signColor(alpha) }}>
        {alpha == null ? '—' : `${fmtPct(alpha)} α`}
      </div>
      <div style={{ fontSize: 11, color: COLOR.textMuted }}>
        You {you == null ? '—' : fmtPct(you)} · {benchLabel} {bench == null ? '—' : fmtPct(bench)}
      </div>
    </div>
  );

  return (
    <div style={SECTION}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: COLOR.textMuted, marginBottom: 4 }}>
            Total Portfolio NAV
          </div>
          <div style={{ fontSize: 32, fontWeight: 600, color: COLOR.text, lineHeight: 1 }}>
            <CountUp to={Math.round(totalNav)} prefix="$" />
          </div>
          <div style={{ fontSize: 13, color: isUp ? COLOR.green : COLOR.red, marginTop: 6, fontWeight: 500 }}>
            {fmtPct(totalReturn)} since inception · {fmtMoney(totalNav - STARTING_CAPITAL)} {isUp ? 'gained' : 'lost'}
          </div>
          {(totalReal != null || totalUnrl != null) && (
            <div style={{ fontSize: 11, color: COLOR.textMuted, marginTop: 3 }}>
              <span style={{ color: signColor(totalReal) }}>{fmtMoneyExact(totalReal)}</span> realized ·{' '}
              <span style={{ color: signColor(totalUnrl) }}>{fmtMoneyExact(totalUnrl)}</span> unrealized (open)
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FreshnessChip elementId="portfolio.paper-nav-daily" />
          {leverageOn && (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 4,
              background: COLOR.amber, color: '#fff', letterSpacing: 0.3,
            }}>
              LEVERAGE ON · {fmtMoney(leverageUsed)} borrowed
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <SleeveCell
          name="Sleeve A — Asset Tilt"
          def="$500K following the Asset Tilt engine's industry-group allocation. ETFs only. Unlevered. Return shown vs the $500K sleeve start."
          nav={aNav} ret={aRet} unrl={aUnrl} real={aReal} pos={aPos}
        />
        <SleeveCell
          name="Sleeve B — Scanner"
          def="$500K following the Equity Scanner long-only. Up to 2x leverage when buy signals exceed $500K. Return shown vs the $500K sleeve start."
          nav={bNav} ret={bRet} unrl={bUnrl} real={bReal} pos={bPos}
        />
        <BenchCell
          label="vs S&P 500"
          def="Benchmark: putting the full $1M into SPY (S&P 500 ETF) on day one and holding. α (alpha) is how much the book beat or lagged that. Positive = the model added value over just owning the index."
          alpha={spyAlpha} you={periodReturn} bench={spyReturn} benchLabel="SPY"
        />
        <BenchCell
          label="vs 60/40"
          def="Benchmark: $1M in a classic balanced mix — 60% SPY (stocks) + 40% AGG (US bonds) — held since day one. α is the book's edge over that balanced portfolio."
          alpha={blendAlpha} you={periodReturn} bench={blendReturn} benchLabel="60/40"
        />
        <div style={KPI_CELL}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
            Portfolio Beta <InfoTip term="Portfolio Beta" def="How much the book moves for each 1% move in the S&P 500, from daily returns. 1.0 = moves with the market; >1 = more volatile; <1 = less. Needs ~20 trading days of history to be meaningful." size={10} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLOR.text }}>
            {beta == null ? <span style={{ fontSize: 13, color: COLOR.textMuted }}>building…</span> : beta.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: COLOR.textMuted }}>
            {leverageOn ? `${fmtMoney(leverageUsed)} leverage in use` : 'No leverage in use'}
          </div>
        </div>
      </div>

      <NavSparkline data={navHistory} />
    </div>
  );
}

// Lightweight inline SVG NAV chart — no external chart lib needed for a
// daily line. Keeps the page self-contained and the bundle thin.
function NavSparkline({ data }) {
  if (!data || data.length < 2) return null;
  const w = 800;
  const h = 140;
  const padL = 50;
  const padR = 20;
  const padT = 16;
  const padB = 22;

  // Capital-matched benchmark lines: $1M (anchored to the first NAV point)
  // grown by SPY and by the 60/40 SPY/AGG blend, so all three lines start
  // together and are directly comparable in dollars.
  const bmBase = data.find((d) => d.spy_close != null) || null;
  const spy0 = bmBase?.spy_close ?? null;
  const agg0 = bmBase?.agg_close ?? null;
  const anchor = bmBase?.total_nav ?? data[0].total_nav;
  const spyLineV = (d) => (spy0 && d.spy_close != null ? anchor * (d.spy_close / spy0) : null);
  const blendLineV = (d) => (spy0 && agg0 && d.spy_close != null && d.agg_close != null)
    ? anchor * (0.6 * (d.spy_close / spy0) + 0.4 * (d.agg_close / agg0)) : null;

  const ys = data.map((d) => d.total_nav);
  const spyYs = data.map(spyLineV).filter((v) => v != null);
  const blendYs = data.map(blendLineV).filter((v) => v != null);
  const spyAvailable = spyYs.length >= 2;
  const blendAvailable = blendYs.length >= 2;

  const allY = [...ys, ...spyYs, ...blendYs];
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const yRange = Math.max(1, maxY - minY);
  const xRange = Math.max(1, data.length - 1);
  const xScale = (i) => padL + ((w - padL - padR) * i) / xRange;
  const yScale = (v) => padT + (h - padT - padB) * (1 - (v - minY) / yRange);

  const pathFrom = (valFn) => {
    let started = false;
    return data.map((d, i) => {
      const v = valFn(d);
      if (v == null) return '';
      const cmd = started ? 'L' : 'M';
      started = true;
      return `${cmd}${xScale(i)},${yScale(v)}`;
    }).join(' ');
  };

  const navPath = ys.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i)},${yScale(v)}`).join(' ');
  const spyPath = spyAvailable ? pathFrom(spyLineV) : '';
  const blendPath = blendAvailable ? pathFrom(blendLineV) : '';

  const legendSwatch = (color, dashed) => (
    <span style={{ display: 'inline-block', width: 14, height: 0, marginRight: 4, verticalAlign: 'middle',
      borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
  );

  return (
    <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${COLOR.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
          NAV vs benchmarks · $1M start
        </span>
        <span style={{ fontSize: 11, color: COLOR.textMuted, display: 'flex', gap: 14 }}>
          <span>{legendSwatch(COLOR.text, false)} Portfolio</span>
          {spyAvailable && <span>{legendSwatch(COLOR.textMuted, true)} S&P 500</span>}
          {blendAvailable && <span>{legendSwatch(COLOR.amber, true)} 60/40</span>}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {[0, 0.5, 1].map((t) => {
          const v = minY + t * yRange;
          const y = yScale(v);
          return (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke={COLOR.border} strokeWidth="0.5" />
              <text x={padL - 6} y={y + 3} fontSize="9" textAnchor="end" fill={COLOR.textMuted}>
                ${(v / 1000).toFixed(0)}K
              </text>
            </g>
          );
        })}
        {blendAvailable && <path d={blendPath} fill="none" stroke={COLOR.amber} strokeWidth="1.5" strokeDasharray="3,3" />}
        {spyAvailable && <path d={spyPath} fill="none" stroke={COLOR.textMuted} strokeWidth="1.5" strokeDasharray="3,3" />}
        <path d={navPath} fill="none" stroke={COLOR.text} strokeWidth="2" />
        <text x={padL} y={h - 6} fontSize="9" fill={COLOR.textMuted}>{fmtDate(data[0].snapshot_date)}</text>
        <text x={w - padR} y={h - 6} fontSize="9" textAnchor="end" fill={COLOR.textMuted}>{fmtDate(data[data.length - 1].snapshot_date)}</text>
      </svg>
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
  const dayPL = positions.reduce((s, p) => s + (p.unrealized_intraday_pl || 0), 0);
  const leverageRatio = totalCapital > 0 ? grossLong / totalCapital : 0;

  const daysHeld = (iso) => {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).getTime();
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.round(ms / 86_400_000));
  };

  const sortBtn = (label, key, align = 'left') => (
    <th
      onClick={() => {
        if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortBy(key); setSortDir('desc'); }
      }}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: align, padding: '8px 10px', borderBottom: `1px solid ${COLOR.borderHeavy}`, fontSize: 11, fontWeight: 600, color: COLOR.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}
    >
      {label} {sortBy === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  const numTd = { padding: '8px 10px', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' };
  const plCell = (dollars, pct) => (
    <td style={{ ...numTd, color: (dollars || 0) >= 0 ? COLOR.green : COLOR.red }}>
      <div style={{ fontWeight: 600 }}>{fmtMoneyExact(dollars)}</div>
      <div style={{ fontSize: 11, opacity: 0.85 }}>{pct == null ? '' : fmtPct(pct)}</div>
    </td>
  );

  return (
    <div style={SECTION}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: COLOR.text }}>
            Sleeve {sleeve} — {title}
            {infoDef && <InfoTip term={`Sleeve ${sleeve}`} def={infoDef} size={11} />}
          </h3>
          <div style={{ fontSize: 12, color: COLOR.textMuted, marginTop: 4 }}>
            {positions.length} position{positions.length === 1 ? '' : 's'} ·
            {' '}{fmtMoney(grossLong)} gross long
            {leverageRatio > 1.0 && (
              <> · <span style={{ color: COLOR.amber, fontWeight: 600 }}>{leverageRatio.toFixed(2)}x leverage</span></>
            )}
            {' '}· <span style={{ color: dayPL >= 0 ? COLOR.green : COLOR.red }}>{fmtMoneyExact(dayPL)} today</span>
            {' '}· <span style={{ color: unreal >= 0 ? COLOR.green : COLOR.red }}>{fmtMoneyExact(unreal)} total open P&L</span>
          </div>
        </div>
        <FreshnessChip elementId="portfolio.paper-positions-snapshot" />
      </div>

      {positions.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: COLOR.textMuted, fontSize: 13 }}>
          No positions yet. {sleeve === 'B' ? 'Scanner finds no qualifying buy signals at the moment.' : 'Awaiting first rebalance.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {sortBtn('Ticker', 'ticker')}
                {sortBtn('Qty', 'quantity', 'right')}
                {sortBtn('Avg Cost', 'avg_cost', 'right')}
                {sortBtn('Price', 'current_price', 'right')}
                {sortBtn('Market Value', 'market_value', 'right')}
                {sortBtn('Day P&L', 'unrealized_intraday_pl', 'right')}
                {sortBtn('Total P&L', 'unrealized_pnl', 'right')}
                {sortBtn('Held', 'entry_date', 'right')}
                {sleeve === 'B' && sortBtn('Score', 'current_score', 'right')}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const held = daysHeld(p.entry_date);
                return (
                  <tr key={`${p.ticker}-${i}`} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{p.ticker}</td>
                    <td style={numTd}>
                      {p.quantity != null ? Number(p.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td style={numTd}>
                      {p.avg_cost != null ? `$${Number(p.avg_cost).toFixed(2)}` : '—'}
                    </td>
                    <td style={numTd}>
                      {p.current_price ? `$${Number(p.current_price).toFixed(2)}` : '—'}
                    </td>
                    <td style={numTd}>{fmtMoneyExact(p.market_value)}</td>
                    {plCell(p.unrealized_intraday_pl, p.unrealized_intraday_plpc)}
                    {plCell(p.unrealized_pnl, p.unrealized_plpc)}
                    <td style={{ ...numTd, color: COLOR.textMuted }}>
                      {held == null ? '—' : `${held}d`}
                    </td>
                    {sleeve === 'B' && (
                      <td style={numTd}>
                        {p.current_score != null ? p.current_score : '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Rebalance log ──────────────────────────────────────────────────────────

function RebalanceLog({ orders }) {
  if (!orders || orders.length === 0) {
    return (
      <div style={SECTION}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Recent rebalances</h3>
        <div style={{ padding: '24px 0', textAlign: 'center', color: COLOR.textMuted, fontSize: 13 }}>
          No orders yet. The first rebalance will appear here after the next signal cycle.
        </div>
      </div>
    );
  }
  const byDate = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      const d = (o.created_at || '').split('T')[0];
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(o);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
  }, [orders]);

  return (
    <div style={SECTION}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Recent rebalances</h3>
        <FreshnessChip elementId="portfolio.paper-orders-intent" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {byDate.map(([date, rows]) => {
          const buys = rows.filter((r) => r.side === 'buy').length;
          const sells = rows.filter((r) => r.side === 'sell').length;
          const filled = rows.filter((r) => r.status === 'filled').length;
          const pending = rows.filter((r) => r.status === 'pending').length;
          const rejected = rows.filter((r) => r.status === 'rejected').length;
          return (
            <div key={date} style={{ borderLeft: `2px solid ${COLOR.borderHeavy}`, paddingLeft: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {fmtDate(date)}
                {' '}<span style={{ fontWeight: 400, color: COLOR.textMuted }}>
                  · {rows.length} orders ({buys} buys, {sells} sells)
                  {pending > 0 && <> · <span style={{ color: COLOR.amber }}>{pending} pending</span></>}
                  {rejected > 0 && <> · <span style={{ color: COLOR.red }}>{rejected} rejected</span></>}
                  {filled > 0 && <> · <span style={{ color: COLOR.green }}>{filled} filled</span></>}
                </span>
              </div>
              <div style={{ fontSize: 11, color: COLOR.textMuted, marginTop: 3 }}>
                {[...new Set(rows.map((r) => r.signal_source))].join(' + ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Spec card (Joe-readable summary of the strategy) ───────────────────────

function SpecCard() {
  return (
    <div style={{ ...SECTION, background: COLOR.surface2 }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>How this portfolio works</h3>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: COLOR.textMuted }}>
        $1M paper portfolio on Alpaca, split in half. Sleeve A follows the Asset Tilt
        engine: 24 industry-group ETFs at the engine's recommended weights, $500K
        capital, unlevered. Sleeve B follows the Equity Scanner long-only: buy when
        the buy-score is at least 5, exit when it drops below 5, sized into $50K /
        $40K / $30K slots by tier, up to 2x leverage when there are more buys than
        cash to cover them. Rebalance fires whenever Asset Tilt or the Scanner moves;
        orders go to Alpaca as market-on-open for the next trading day. Idle cash
        sits as literal cash — no bond proxy.
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
        // 1) NAV daily history
        const nav = await supabase
          .from('paper_nav_daily')
          .select('*')
          .order('snapshot_date', { ascending: true });
        if (!cancelled) setNavHistory(nav.data || []);

        // 2) latest positions snapshot
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

        // 3) recent order intents
        const ord = await supabase
          .from('paper_orders')
          .select('id, created_at, sleeve, ticker, side, target_notional, signal_source, status, signal_score')
          .order('created_at', { ascending: false })
          .limit(200);
        if (!cancelled) setOrders(ord.data || []);

        // 4) account config
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
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <NavHero navHistory={navHistory} account={account} />
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
        infoDef="$500K following the Equity Scanner long-only. Buy when buy-score ≥ 5; size $50K / $40K / $30K by tier; up to 2x leverage when signals exceed $500K."
      />
      <RebalanceLog orders={orders} />
      <SpecCard />

      {err && (
        <div style={{ marginTop: 16, padding: 12, background: '#fff1f1', border: `1px solid ${COLOR.red}`, borderRadius: 6, color: COLOR.red, fontSize: 12 }}>
          Data load error: {err}
        </div>
      )}
    </div>
  );
}
