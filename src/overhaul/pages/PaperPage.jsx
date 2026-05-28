/* Paper Portfolio — overhaul shell page (Joe directive 2026-05-27).

   Reads four Supabase tables populated by the paper_portfolio nightly
   runner:
     * paper_accounts        — sleeve caps + leverage cap (one row)
     * paper_nav_daily       — daily NAV path for the chart + headline numbers
     * paper_positions       — latest snapshot's per-name positions, by sleeve
     * paper_orders          — recent order intents + their submitted/filled
                                status (the rebalance trail)

   Inline-style policy: zero layout/color/font/padding/margin/gap/background
   props (per the overhaul convention set by HomePage / PortfolioPage). All
   styling comes from overhaul/styles/* via the shared mt-* and hm-* / pf-*
   classes. Dynamic values like `style={{ width: pct + '%' }}` are the only
   exception and stay.

   Data-Steward note: every data-driven surface carries a FreshnessChip
   pinned to its registered pipeline element:
     * portfolio.paper-nav-daily        — NAV stats + hero
     * portfolio.paper-positions-snapshot — Sleeve A + Sleeve B tables
     * portfolio.paper-orders-intent    — Recent rebalances log
*/

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import { supabase } from '../../lib/supabase';

const STARTING_CAPITAL = 1_000_000;

// ── small helpers ──────────────────────────────────────────────────────────

function fmt$(v, decimals = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${Math.round(v).toLocaleString('en-US', { maximumFractionDigits: decimals })}`;
}
function fmt$Short(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function fmtPct(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(decimals)}%`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ── StatTile (matches HomePage's pattern verbatim) ────────────────────────

function StatTile({ label, value, unit, sub }) {
  return (
    <div className="hm-stat">
      <div className="mt-eyebrow">{label}</div>
      <div className="hm-statval num">
        {value}
        {unit && <span>{unit}</span>}
      </div>
      <div className="hm-statsub">{sub}</div>
    </div>
  );
}

// ── Sleeve positions table (mirrors PortfolioPage's pf-mini pattern) ──────

function SleevePanel({ sleeve, title, positions, totalCapital, navigate }) {
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

  const click = (key) => () => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('desc'); }
  };
  const arrow = (key) => sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <section className="mt-pagesection">
      <div className="mt-sectionhead">
        <div>
          <div className="mt-eyebrow">Sleeve {sleeve} · {sleeve === 'A' ? 'Asset Tilt engine' : 'Equity Scanner long-only'}</div>
          <div className="mt-h2">{title}</div>
          <div className="hm-mapcardsub">
            <b className="num">{positions.length}</b> position{positions.length === 1 ? '' : 's'}
            {' · '}<b className="num">{fmt$(grossLong, 0)}</b> gross long
            {leverageRatio > 1.0 && (
              <> · <b className="num">{leverageRatio.toFixed(2)}×</b> leverage</>
            )}
            {' · '}<b className={'num ' + (unreal >= 0 ? 'up' : 'down')}>
              {unreal >= 0 ? '+' : ''}{fmt$(unreal, 0)}
            </b> unrealized
          </div>
        </div>
        <FreshnessChip elementId="portfolio.paper-positions-snapshot" variant="label" />
      </div>

      <article className="mt-card">
        {positions.length === 0 ? (
          <div className="pf-allocempty">
            <div>
              {sleeve === 'B'
                ? 'Scanner found no qualifying buy signals at the moment. Positions appear here after the next rebalance cycle.'
                : 'Awaiting first rebalance. Asset Tilt positions appear here after the next nightly run.'}
            </div>
            <FreshnessChip elementId="portfolio.paper-positions-snapshot" variant="label" />
          </div>
        ) : (
          <table className="pf-mini">
            <thead>
              <tr>
                <th onClick={click('ticker')} style={{ cursor: 'pointer' }}>Ticker{arrow('ticker')}</th>
                <th className="num" onClick={click('quantity')} style={{ cursor: 'pointer' }}>Quantity{arrow('quantity')}</th>
                <th className="num" onClick={click('avg_cost')} style={{ cursor: 'pointer' }}>Avg cost{arrow('avg_cost')}</th>
                <th className="num" onClick={click('market_value')} style={{ cursor: 'pointer' }}>Value{arrow('market_value')}</th>
                <th className="num" onClick={click('unrealized_pnl')} style={{ cursor: 'pointer' }}>P/L{arrow('unrealized_pnl')}</th>
                {sleeve === 'B' && <th className="num" onClick={click('current_score')} style={{ cursor: 'pointer' }}>Score{arrow('current_score')}</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const pl = p.unrealized_pnl ?? 0;
                const plPct = p.avg_cost && p.quantity ? pl / (p.avg_cost * p.quantity) : null;
                return (
                  <tr key={`${p.ticker}-${i}`}>
                    <td>
                      <span
                        className="lm-tkmain lm-tkmain--link"
                        onClick={() => navigate(`/ticker/${p.ticker}`)}
                      >
                        {p.ticker}
                      </span>
                    </td>
                    <td className="num">
                      {p.quantity != null ? Number(p.quantity).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="num">{p.avg_cost != null ? `$${Number(p.avg_cost).toFixed(2)}` : '—'}</td>
                    <td className="num"><b>{fmt$(p.market_value, 0)}</b></td>
                    <td className={'num ' + (pl >= 0 ? 'up' : 'down')}>
                      {pl > 0 ? '+' : ''}{fmt$(pl, 0)}
                      {plPct != null && <> · {fmtPct(plPct, 1)}</>}
                    </td>
                    {sleeve === 'B' && (
                      <td className="num">
                        {p.current_score != null ? <b>{Number(p.current_score).toFixed(1)}</b> : '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </article>
    </section>
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
    <section className="mt-pagesection">
      <div className="mt-sectionhead">
        <div>
          <div className="mt-eyebrow">Engine log</div>
          <div className="mt-h2">Recent rebalances.</div>
          <div className="hm-mapcardsub">
            Last five days the engine fired buy or sell intents to Alpaca.
          </div>
        </div>
        <FreshnessChip elementId="portfolio.paper-orders-intent" variant="label" />
      </div>

      <article className="mt-card">
        {byDate.length === 0 ? (
          <div className="pf-allocempty">
            <div>No orders yet. The first rebalance will appear here after the next signal cycle.</div>
          </div>
        ) : (
          <table className="pf-mini">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Orders</th>
                <th className="num">Filled</th>
                <th className="num">Pending</th>
                <th className="num">Rejected</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {byDate.map(([date, rows]) => {
                const filled = rows.filter((r) => r.status === 'filled').length;
                const pending = rows.filter((r) => r.status === 'pending').length;
                const rejected = rows.filter((r) => r.status === 'rejected').length;
                return (
                  <tr key={date}>
                    <td><b>{fmtDate(date)}</b></td>
                    <td className="num"><b>{rows.length}</b></td>
                    <td className={'num ' + (filled > 0 ? 'up' : '')}>{filled || '—'}</td>
                    <td className="num">{pending || '—'}</td>
                    <td className={'num ' + (rejected > 0 ? 'down' : '')}>{rejected || '—'}</td>
                    <td>{[...new Set(rows.map((r) => r.signal_source))].join(' + ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PaperPage() {
  const navigate = useNavigate();
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

  const latest = navHistory.length ? navHistory[navHistory.length - 1] : null;
  const first  = navHistory.length ? navHistory[0] : null;
  const totalNav    = latest?.total_nav ?? null;
  const totalReturn = totalNav != null ? (totalNav - STARTING_CAPITAL) / STARTING_CAPITAL : null;
  const periodReturn = (first && totalNav != null) ? (totalNav - first.total_nav) / first.total_nav : null;
  const spyStart  = first?.benchmark_spy_value ?? null;
  const spyNow    = latest?.benchmark_spy_value ?? null;
  const spyReturn = (spyStart && spyNow) ? (spyNow / spyStart - 1) : null;
  const alpha     = (spyReturn != null && periodReturn != null) ? (periodReturn - spyReturn) : null;
  const leverageUsed = latest?.sleeve_b_margin_used || 0;
  const leverageOn   = leverageUsed > 0;

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Paper portfolio · MacroTilt</div>
          <h1 className="mt-h1">
            A <i>$1M paper book</i> on Alpaca,
            <br />
            split across <i>Asset Tilt</i> and <i>Equity Scanner</i> sleeves.
          </h1>
          <p className="mt-deck">
            Sleeve A holds the <b>Asset Tilt engine's 24 industry-group ETFs</b>{' '}
            at the recommended weights — <b className="num">$500K</b> capital,
            unlevered. Sleeve B holds the <b>Equity Scanner long-only</b> book,
            buy-when-score ≥ 5, sized into <b className="num">$50K / $40K / $30K</b>{' '}
            tiers, with up to <b>2× leverage</b> on overflow buy signals. Orders go to{' '}
            Alpaca as market-on-open the next trading day. Idle cash sits as literal
            cash — no bond proxy.
          </p>
        </div>

        <div className="hm-statgrid">
          <StatTile
            label="Total NAV"
            value={totalNav != null ? `$${Math.round(totalNav).toLocaleString('en-US')}` : '—'}
            sub={
              <>
                {totalReturn != null
                  ? <><b className={'num ' + (totalReturn >= 0 ? 'up' : 'down')}>{fmtPct(totalReturn)}</b> since inception · <b className="num">{fmt$Short(totalNav - STARTING_CAPITAL)}</b> {totalReturn >= 0 ? 'gained' : 'lost'}</>
                  : 'Awaiting first nightly run'}
                {' · '}<FreshnessChip elementId="portfolio.paper-nav-daily" variant="dot" />
              </>
            }
          />
          <StatTile
            label="vs SPY 50/50"
            value={alpha != null ? fmtPct(alpha) : '—'}
            sub={
              <>
                Portfolio <b className="num">{periodReturn != null ? fmtPct(periodReturn) : '—'}</b>
                {' · '}SPY <b className="num">{spyReturn != null ? fmtPct(spyReturn) : '—'}</b>
              </>
            }
          />
          <StatTile
            label="Leverage in use"
            value={leverageOn ? fmt$Short(leverageUsed) : '—'}
            sub={<>Cap: <b className="num">$1M</b> total stock value (2× Sleeve B)</>}
          />
        </div>
      </section>

      <SleevePanel
        sleeve="A"
        title="Industry-group ETFs, engine-weighted."
        positions={sleeveA}
        totalCapital={account?.sleeve_a_allocation || 500_000}
        navigate={navigate}
      />

      <SleevePanel
        sleeve="B"
        title="Long-only equities, scanner-driven."
        positions={sleeveB}
        totalCapital={account?.sleeve_b_allocation || 500_000}
        navigate={navigate}
      />

      <RebalanceLog orders={orders} />

      {err && (
        <section className="mt-pagesection">
          <article className="mt-card">
            <div className="pf-allocempty">
              <div>Data load error: {err}</div>
            </div>
          </article>
        </section>
      )}
    </div>
  );
}
