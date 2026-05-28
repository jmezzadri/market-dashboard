// PaperPortfolioPage — Paper Trading Portfolio results page.
//
// Brand-aligned 2026-05-27 (round 3, Joe directive): adopts the canonical
// PageHero pattern used by EVERY other v2 page (Trading Opportunities,
// Macro Overview, Asset Tilt, Portfolio Insights). Editorial Fraunces
// headline with <em> italic accent phrases, bulleted "how it works" list
// on the left, bespoke summary stat-card on the right — same scaffold
// as every other top-level page. PR #868/#869 had matched the wrong cluster
// pattern (the editorial Inter hero used only by Home / Insights); per
// the locked spec in PageHero.jsx, EVERY page must use the same header.
//
// Reads four Supabase tables populated by the paper_portfolio nightly
// runner:
//   * paper_accounts        — sleeve caps + leverage cap (one row)
//   * paper_nav_daily       — daily NAV path for the chart + headline numbers
//   * paper_positions       — latest snapshot's per-name positions, by sleeve
//   * paper_orders          — recent order intents + their submitted/filled
//                              status (the rebalance trail)
//
// Senior Quant guard:
//   * Sleeve attribution comes straight from the DB column (we do NOT
//     re-infer in the UI).
//   * Leverage badge fires when sleeve_b_margin_used > 0.

import React, { useEffect, useMemo, useState } from 'react';
import PageHero from '../components/PageHero';
import FreshnessChip from '../components/FreshnessChip';
import { supabase } from '../../lib/supabase';
import { InfoTip } from '../../InfoTip';

const STARTING_CAPITAL = 1_000_000;       // $1M paper, locked

// Risk-on / risk-off palette (fallbacks because the global tokens aren't
// defined outside .scenarios-page).
const UP_COLOR   = 'var(--up, #1f8a5a)';
const DOWN_COLOR = 'var(--down, #b62121)';
const WARN_COLOR = 'var(--warn, #b87000)';

// ── Editorial hero copy — Fraunces italic accents inside the title ────────

const HERO_TITLE = (
  <>
    A <em>$1M paper book</em> on Alpaca, split in half &mdash; Sleeve A follows the{' '}
    <em>Asset Tilt</em> engine; Sleeve B follows the <em>Equity Scanner</em> long-only with up to 2&times; leverage on overflow buy signals.
  </>
);

const HERO_BULLETS = [
  'Sleeve A — 24 industry-group ETFs at the engine’s recommended weights, $500K capital, unlevered',
  'Sleeve B — long-only equities at MacroTilt Score ≥ 5, sized $50K / $40K / $30K by tier',
  'Idle cash sits as literal cash — no bond proxy. Borrow on Sleeve B only when buy signals exceed available cash.',
  'Orders go to Alpaca as market-on-open the next trading day',
];

// ── small helpers ──────────────────────────────────────────────────────────

const fmtMoneyExact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

const fmtMoneyShort = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
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

// ── Page-scoped styles (component-local; no globals) ──────────────────────

const PAGE_CSS = `
.paper-shell { max-width: 1440px; margin: 0 auto; padding: 0 32px 64px; }

/* Right-side summary card on the hero — mirrors the Trading Opps
   "Latest Scan Results" stat block. */
.paper-tile-summary {
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: 14px;
  padding: 22px 24px;
  display: flex; flex-direction: column; gap: 14px;
}
.paper-tile-summary .pts-head {
  display: flex; justify-content: space-between; align-items: baseline;
}
.paper-tile-summary .pts-title {
  font-size: 12.5px; font-weight: 600; color: var(--ink-0); letter-spacing: .02em;
}
.paper-tile-summary .pts-asof { font-size: 11px; color: var(--ink-2); letter-spacing: .04em; }
.paper-tile-summary .pts-nav-eyebrow {
  font-size: 10.5px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-2); margin-bottom: 6px;
}
.paper-tile-summary .pts-nav-value {
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: clamp(30px, 3.4vw, 42px);
  line-height: 1; color: var(--ink-0); font-feature-settings: "tnum","lnum";
  font-weight: 500; letter-spacing: -.012em;
}
.paper-tile-summary .pts-nav-value .pts-curr {
  font-size: .55em; color: var(--ink-2); margin-right: 3px; vertical-align: .18em;
}
.paper-tile-summary .pts-nav-delta {
  margin-top: 6px; font-size: 12px; font-weight: 500; font-feature-settings: "tnum";
}
.paper-tile-summary .pts-row {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 13px; color: var(--ink-1); border-top: 1px solid var(--line-0);
  padding-top: 10px;
}
.paper-tile-summary .pts-row .lbl { color: var(--ink-2); font-size: 12px; }
.paper-tile-summary .pts-row .val { color: var(--ink-0); font-weight: 500; font-feature-settings: "tnum"; }
.paper-tile-summary .pts-leverage-on {
  display: inline-block; font-size: 10.5px; font-weight: 600; letter-spacing: .14em;
  text-transform: uppercase; padding: 3px 8px; border-radius: 4px;
  background: ${WARN_COLOR}; color: #fff;
}

/* Section panels below the hero — same look as the rest of the v2 pages. */
.paper-panel {
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: 14px;
  overflow: hidden;
  margin-top: 24px;
}
.paper-panel-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 22px 28px 14px; border-bottom: 1px solid var(--line-0);
  flex-wrap: wrap; gap: 12px;
}
.paper-panel-title {
  margin: 0; font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 17px; font-weight: 600; color: var(--ink-0); letter-spacing: -.005em;
}
.paper-panel-sub {
  font-size: 12px; color: var(--ink-2); margin-top: 4px; font-feature-settings: "tnum";
}
.paper-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.paper-table th {
  text-align: left; padding: 12px 28px;
  font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-2); font-weight: 500;
  border-bottom: 1px solid var(--line-1); background: var(--bg-1);
  cursor: pointer; user-select: none; white-space: nowrap;
}
.paper-table th.r { text-align: right; }
.paper-table td {
  padding: 13px 28px; border-bottom: 1px solid var(--line-0);
  color: var(--ink-1); font-feature-settings: "tnum";
}
.paper-table td.r { text-align: right; }
.paper-table td.ticker { color: var(--ink-0); font-weight: 500; }
.paper-table td.mv { color: var(--ink-0); font-weight: 500; }
.paper-table td.up { color: ${UP_COLOR}; }
.paper-table td.down { color: ${DOWN_COLOR}; }
.paper-empty { padding: 28px 28px; text-align: center; color: var(--ink-2); font-size: 13px; }

.paper-rebal-row { border-left: 2px solid var(--line-1); padding-left: 14px; margin-bottom: 14px; }
.paper-rebal-row:last-child { margin-bottom: 0; }
.paper-rebal-date { font-size: 13.5px; font-weight: 500; color: var(--ink-0); }
.paper-rebal-meta { font-weight: 400; color: var(--ink-2); font-feature-settings: "tnum"; }
.paper-rebal-source { font-size: 11px; color: var(--ink-3); margin-top: 3px; letter-spacing: .04em; }
`;

// ── Right-slot summary card ───────────────────────────────────────────────

function SummaryCard({ navHistory }) {
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
    <div className="paper-tile-summary">
      <div className="pts-head">
        <span className="pts-title">Paper book NAV <InfoTip term="Paper book NAV" def="Current liquidation value of the $1M paper book on Alpaca, summed across Sleeve A (Asset Tilt) and Sleeve B (Scanner)." size={11} /></span>
        <span className="pts-asof">
          {latest?.snapshot_date ? fmtDate(latest.snapshot_date).toUpperCase() : '—'}
        </span>
      </div>

      <div>
        <div className="pts-nav-eyebrow">Total portfolio NAV</div>
        <div className="pts-nav-value">
          {totalNav == null ? '—' : (
            <>
              <span className="pts-curr">$</span>
              {Math.round(totalNav).toLocaleString('en-US')}
            </>
          )}
        </div>
        <div className="pts-nav-delta" style={{ color: totalReturn == null ? 'var(--ink-2)' : (isUp ? UP_COLOR : DOWN_COLOR) }}>
          {totalReturn == null
            ? 'Awaiting first nightly run'
            : <>{fmtPct(totalReturn)} since inception &middot; {fmtMoneyShort(totalNav - STARTING_CAPITAL)} {isUp ? 'gained' : 'lost'}</>
          }
        </div>
      </div>

      <div className="pts-row">
        <span className="lbl">Sleeve A — Asset Tilt</span>
        <span className="val">{latest?.sleeve_a_nav != null ? fmtMoneyExact(latest.sleeve_a_nav) : '—'}</span>
      </div>
      <div className="pts-row">
        <span className="lbl">Sleeve B — Scanner</span>
        <span className="val">{latest?.sleeve_b_nav != null ? fmtMoneyExact(latest.sleeve_b_nav) : '—'}</span>
      </div>
      <div className="pts-row">
        <span className="lbl">vs SPY 50/50</span>
        <span className="val" style={{ color: alpha == null ? 'var(--ink-3)' : (alpha >= 0 ? UP_COLOR : DOWN_COLOR) }}>
          {alpha == null ? '—' : fmtPct(alpha)}
        </span>
      </div>
      <div className="pts-row">
        <span className="lbl">Leverage in use</span>
        <span className="val">
          {leverageOn ? <span className="pts-leverage-on">{fmtMoneyShort(leverageUsed)}</span> : '—'}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        <FreshnessChip elementId="portfolio.paper-nav-daily" />
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

  const sortClick = (key) => () => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('desc'); }
  };
  const arrow = (key) => sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="paper-panel">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            Sleeve {sleeve} &mdash; {title}
            {infoDef && <InfoTip term={`Sleeve ${sleeve}`} def={infoDef} size={12} />}
          </h2>
          <div className="paper-panel-sub">
            {positions.length} position{positions.length === 1 ? '' : 's'} &middot; {fmtMoneyExact(grossLong)} gross long
            {leverageRatio > 1.0 && (
              <> &middot; <span style={{ color: WARN_COLOR, fontWeight: 600 }}>{leverageRatio.toFixed(2)}&times; leverage</span></>
            )}
            {' '}&middot; {unreal >= 0
              ? <span style={{ color: UP_COLOR }}>+{fmtMoneyExact(unreal)} unrealized</span>
              : <span style={{ color: DOWN_COLOR }}>{fmtMoneyExact(unreal)} unrealized</span>
            }
          </div>
        </div>
        <FreshnessChip elementId="portfolio.paper-positions-snapshot" />
      </div>

      {positions.length === 0 ? (
        <div className="paper-empty">
          {sleeve === 'B'
            ? 'Scanner found no qualifying buy signals at the moment. Positions appear here after the next rebalance cycle.'
            : 'Awaiting first rebalance. Asset Tilt positions appear here after the next nightly run.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="paper-table">
            <thead>
              <tr>
                <th onClick={sortClick('ticker')}>Ticker{arrow('ticker')}</th>
                <th className="r" onClick={sortClick('quantity')}>Quantity{arrow('quantity')}</th>
                <th className="r" onClick={sortClick('avg_cost')}>Avg cost{arrow('avg_cost')}</th>
                <th className="r" onClick={sortClick('market_value')}>Market value{arrow('market_value')}</th>
                <th className="r" onClick={sortClick('unrealized_pnl')}>Unrealized P&amp;L{arrow('unrealized_pnl')}</th>
                {sleeve === 'B' && <th className="r" onClick={sortClick('current_score')}>Score{arrow('current_score')}</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={`${p.ticker}-${i}`}>
                  <td className="ticker">{p.ticker}</td>
                  <td className="r">{p.quantity != null ? Number(p.quantity).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</td>
                  <td className="r">{p.avg_cost != null ? `$${Number(p.avg_cost).toFixed(2)}` : '—'}</td>
                  <td className="r mv">{fmtMoneyExact(p.market_value)}</td>
                  <td className={'r ' + ((p.unrealized_pnl || 0) >= 0 ? 'up' : 'down')}>
                    {fmtMoneyExact(p.unrealized_pnl)}
                  </td>
                  {sleeve === 'B' && <td className="r">{p.current_score != null ? p.current_score : '—'}</td>}
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
    <div className="paper-panel">
      <div className="paper-panel-head">
        <div>
          <h2 className="paper-panel-title">
            Recent rebalances <InfoTip term="Recent rebalances" def="Last five days on which the engine fired buy or sell intents to Alpaca. Filled / pending / rejected counts come from the Alpaca order ledger." size={12} />
          </h2>
        </div>
        <FreshnessChip elementId="portfolio.paper-orders-intent" />
      </div>
      <div style={{ padding: '20px 28px 24px' }}>
        {byDate.length === 0 ? (
          <div className="paper-empty" style={{ padding: 0 }}>
            No orders yet. The first rebalance will appear here after the next signal cycle.
          </div>
        ) : (
          byDate.map(([date, rows]) => {
            const buys = rows.filter((r) => r.side === 'buy').length;
            const sells = rows.filter((r) => r.side === 'sell').length;
            const filled = rows.filter((r) => r.status === 'filled').length;
            const pending = rows.filter((r) => r.status === 'pending').length;
            const rejected = rows.filter((r) => r.status === 'rejected').length;
            return (
              <div key={date} className="paper-rebal-row">
                <div className="paper-rebal-date">
                  {fmtDate(date)}
                  {' '}<span className="paper-rebal-meta">
                    &middot; {rows.length} orders ({buys} buys, {sells} sells)
                    {pending > 0  && <> &middot; <span style={{ color: WARN_COLOR }}>{pending} pending</span></>}
                    {rejected > 0 && <> &middot; <span style={{ color: DOWN_COLOR }}>{rejected} rejected</span></>}
                    {filled > 0   && <> &middot; <span style={{ color: UP_COLOR }}>{filled} filled</span></>}
                  </span>
                </div>
                <div className="paper-rebal-source">
                  {[...new Set(rows.map((r) => r.signal_source))].join(' + ')}
                </div>
              </div>
            );
          })
        )}
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
    <div style={{ minHeight: '100vh' }}>
      <style>{PAGE_CSS}</style>

      <PageHero
        eyebrow="Paper Portfolio"
        title={HERO_TITLE}
        bullets={HERO_BULLETS}
        right={<SummaryCard navHistory={navHistory} />}
      />

      <div className="paper-shell">
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

        {err && (
          <div style={{ marginTop: 24, padding: 14, background: 'var(--bg-2)', border: `1px solid ${DOWN_COLOR}`, borderRadius: 14, color: DOWN_COLOR, fontSize: 12 }}>
            Data load error: {err}
          </div>
        )}
      </div>
    </div>
  );
}
