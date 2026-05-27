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
  const periodReturn = first ? (totalNav - first.total_nav) / first.total_nav : 0;
  const spyStart = first?.benchmark_spy_value || null;
  const spyNow = latest?.benchmark_spy_value || null;
  const spyReturn = spyStart && spyNow ? (spyNow / spyStart - 1) : null;
  const alpha = spyReturn != null ? (periodReturn - spyReturn) : null;
  const isUp = totalReturn >= 0;
  const leverageUsed = latest.sleeve_b_margin_used || 0;
  const leverageOn = leverageUsed > 0;

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div style={KPI_CELL}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
            Sleeve A — Asset Tilt <InfoTip term="Sleeve A" def="$500K following the Asset Tilt engine's 24-industry-group allocation. ETFs only. Unlevered." size={10} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLOR.text }}>{fmtMoney(latest.sleeve_a_nav)}</div>
          <div style={{ fontSize: 11, color: COLOR.textMuted }}>
            {fmtMoney(latest.sleeve_a_equity)} held · {fmtMoney(latest.sleeve_a_cash)} cash
          </div>
        </div>

        <div style={KPI_CELL}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
            Sleeve B — Scanner <InfoTip term="Sleeve B" def="$500K following the Equity Scanner long-only. Up to 2x leverage when buy signals exceed $500K. Cash idle when signals are scarce." size={10} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLOR.text }}>{fmtMoney(latest.sleeve_b_nav)}</div>
          <div style={{ fontSize: 11, color: COLOR.textMuted }}>
            {fmtMoney(latest.sleeve_b_equity)} held · {fmtMoney(latest.sleeve_b_cash)} cash
          </div>
        </div>

        <div style={KPI_CELL}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
            vs SPY 50/50 Benchmark
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: alpha == null ? COLOR.textMuted : (alpha >= 0 ? COLOR.green : COLOR.red) }}>
            {alpha == null ? '—' : fmtPct(alpha)}
          </div>
          <div style={{ fontSize: 11, color: COLOR.textMuted }}>
            SPY {spyReturn == null ? '—' : fmtPct(spyReturn)} · Portfolio {fmtPct(periodReturn)}
          </div>
        </div>

        <div style={KPI_CELL}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
            Leverage usage
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLOR.text }}>
            {leverageOn ? fmtMoney(leverageUsed) : '—'}
          </div>
          <div style={{ fontSize: 11, color: COLOR.textMuted }}>
            Cap: {fmtMoney(STARTING_CAPITAL)} total stock value (2x Sleeve B)
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
  const xs = data.map((d, i) => i);
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
    <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${COLOR.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: COLOR.textMuted, letterSpacing: 0.4 }}>
          NAV path
        </span>
        <span style={{ fontSize: 11, color: COLOR.textMuted, display: 'flex', gap: 14 }}>
          <span><span style={{ display: 'inline-block', width: 14, height: 2, background: COLOR.text, marginRight: 4, verticalAlign: 'middle' }} /> Portfolio</span>
          {spyAvailable && <span><span style={{ display: 'inline-block', width: 14, height: 2, background: COLOR.textMuted, marginRight: 4, verticalAlign: 'middle' }} /> SPY 50/50</span>}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {/* y-axis ticks */}
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
        {spyAvailable && (
          <path d={spyPath} fill="none" stroke={COLOR.textMuted} strokeWidth="1.5" strokeDasharray="3,3" />
        )}
        <path d={navPath} fill="none" stroke={COLOR.text} strokeWidth="2" />
        {/* x-axis date labels */}
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
  const leverageRatio = totalCapital > 0 ? grossLong / totalCapital : 0;

  const sortBtn = (label, key) => (
    <th
      onClick={() => {
        if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortBy(key); setSortDir('desc'); }
      }}
      style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${COLOR.borderHeavy}`, fontSize: 11, fontWeight: 600, color: COLOR.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }}
    >
      {label} {sortBy === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
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
            {' '}· {unreal >= 0 ? <span style={{ color: COLOR.green }}>+{fmtMoney(unreal)} unrealized</span> : <span style={{ color: COLOR.red }}>{fmtMoney(unreal)} unrealized</span>}
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
                {sortBtn('Quantity', 'quantity')}
                {sortBtn('Avg Cost', 'avg_cost')}
                {sortBtn('Market Value', 'market_value')}
                {sortBtn('Unrealized P&L', 'unrealized_pnl')}
                {sleeve === 'B' && sortBtn('Score', 'current_score')}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={`${p.ticker}-${i}`} style={{ borderBottom: `1px solid ${COLOR.border}` }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{p.ticker}</td>
                  <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>
                    {p.quantity != null ? Number(p.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>
                    {p.avg_cost != null ? `$${Number(p.avg_cost).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoneyExact(p.market_value)}
                  </td>
                  <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums', color: (p.unrealized_pnl || 0) >= 0 ? COLOR.green : COLOR.red }}>
                    {fmtMoneyExact(p.unrealized_pnl)}
                  </td>
                  {sleeve === 'B' && (
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>
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
    // The cancellation flag pattern caused a render bug on deep-link mounts:
    // React's strict-mount-then-unmount-then-remount cycle during initial hydration
    // could land the await-resolved setState after `cancelled` had been flipped,
    // leaving the state at defaults and the page in its empty render. Removed the
    // flag — the only cost is a benign "setState on unmounted" warning if the
    // user clicks away mid-fetch, which beats showing them empty data.
    (async () => {
      try {
        const nav = await supabase
          .from('paper_nav_daily')
          .select('*')
          .order('snapshot_date', { ascending: true });
        setNavHistory(nav.data || []);

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
          setPositions(pos.data || []);
        }

        const ord = await supabase
          .from('paper_orders')
          .select('id, created_at, sleeve, ticker, side, target_notional, signal_source, status, signal_score')
          .order('created_at', { ascending: false })
          .limit(200);
        setOrders(ord.data || []);

        const acc = await supabase
          .from('paper_accounts')
          .select('*')
          .eq('status', 'active')
          .limit(1);
        setAccount(acc?.data?.[0] || null);
      } catch (e) {
        setErr(e?.message || String(e));
      }
    })();
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
