/* Portfolio Insights — rebuilt 2026-05-27 to prototype/pages/portfolio.jsx.
   - Hero: inline FreshnessChip in eyebrow + 2×2 key stats grid with vs-SPY
   - Account cards: colored dot, % of book, balance, sparkline, 3-cell metrics
   - Account drill: 12-month perf chart (left) + positions table (right)
   - Allocation card: 3-tab pill + rows with colored dot prefix
   - Positions list: ScanList rows with score+P/L + drill
*/

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import FreshnessChip from '../components/FreshnessChip';
import Sparkline from '../components/Sparkline';
import ScanList from '../components/ScanList';
import ScoreDial from '../components/ScoreDial';
import Tip from '../components/Tip';

const PF_COLORS = ['#0a5cd1', '#1f9d60', '#c08428', '#c1394f', '#5c34c9', '#0a8a8a'];

const CLASS_ALLOC = [
  { name: 'Equities', pct: 83, color: '#0a5cd1' },
  { name: 'Cash', pct: 12, color: '#7a8290' },
  { name: 'Gold / Defensive', pct: 4, color: '#c08428' },
  { name: 'Crypto', pct: 1, color: '#5c34c9' },
];

function fmt$(v, decimals = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(decimals)}`;
}
function fmtPct(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

function fakeSpark(seed, base = 100, ttm = 10) {
  let s = String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = [];
  let v = base;
  for (let i = 0; i < 60; i++) {
    s = (s * 9301 + 49297) % 233280;
    v += ((s / 233280) - 0.5) * (base * 0.04) + (ttm / 60) * (base * 0.04);
    out.push(v);
  }
  return out;
}

export default function PortfolioPage() {
  const portfolio = useUserPortfolio();
  const positions = portfolio?.positions || [];
  const accountSummaries = portfolio?.accountSummaries || [];
  const loading = portfolio?.loading;
  const [openAcct, setOpenAcct] = useState(null);
  const [allocTab, setAllocTab] = useState('account');
  const [drillKey, setDrillKey] = useState(null);
  const navigate = useNavigate();

  const total = useMemo(
    () => positions.reduce((s, p) => s + (Number(p.market_value) || 0), 0),
    [positions],
  );
  const totalCost = useMemo(
    () => positions.reduce((s, p) => s + (Number(p.cost_basis) || 0), 0),
    [positions],
  );
  const ttmPct = totalCost > 0 ? ((total - totalCost) / totalCost) * 100 : null;

  const byAccount = useMemo(() => {
    const out = {};
    positions.forEach((p) => {
      const a = p.account_name || p.account || 'Unassigned';
      out[a] = out[a] || [];
      out[a].push(p);
    });
    return out;
  }, [positions]);

  const bySector = useMemo(() => {
    const out = {};
    positions.forEach((p) => {
      const s = p.sector || 'Unknown';
      out[s] = (out[s] || 0) + (Number(p.market_value) || 0);
    });
    return Object.entries(out)
      .map(([name, v]) => ({ name, value: v, pct: total > 0 ? (v / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [positions, total]);

  const accountTiles = accountSummaries.length
    ? accountSummaries
    : Object.entries(byAccount).map(([name, ps], i) => ({
        account_name: name,
        market_value: ps.reduce((s, p) => s + (Number(p.market_value) || 0), 0),
        position_count: ps.length,
        color: PF_COLORS[i % PF_COLORS.length],
        ttm: 0,
        sharpe: 0,
      }));

  const account = openAcct ? accountTiles.find((a) => a.account_name === openAcct) : null;
  const acctPositions = openAcct ? (byAccount[openAcct] || []) : [];

  const positionsAsScanRows = positions.map((p) => ({
    ticker: p.ticker,
    name: '',
    sector: `${p.account_name || p.account || ''} · ${p.sector || ''}`,
    score: p.mt_score ?? 3.0,
    price: p.last_price,
    chg: p.day_change_pct,
    insider: [],
    dark: null,
    raw: p,
  }));

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            Portfolio insights
            <FreshnessChip elementId="portfolio-positions-on_change" variant="dot" />
          </div>
          <h1 className="mt-h1">
            Your portfolio and watchlist — <i>augmented</i> with MacroTilt's signal intelligence.
          </h1>
          <p className="mt-deck">
            Time-weighted performance and position-level alerts. The same scoring you see on
            Trading Scanner applied to every position you hold across your accounts.
          </p>
        </div>
        <div className="mt-card" style={{ minWidth: 380, padding: 18 }}>
          <div className="mt-eyebrow">Key stats vs. S&amp;P 500</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 10 }}>
            <KeyCell label="Total wealth" value={fmt$(total, 0)} sub={`${accountTiles.length} accounts`} />
            <KeyCell label="TTM performance" value={fmtPct(ttmPct, 1)} sub="S&P +34.1%" up={ttmPct != null && ttmPct >= 0} />
            <KeyCell label="Beta" value="0.86" sub="S&P 1.00" />
            <KeyCell label="Sharpe" value="0.29" sub="S&P 1.52" />
          </div>
        </div>
      </section>

      {/* Accounts grid */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">By account</div>
            <div className="mt-h2">
              {accountTiles.length || 'No'} accounts · trailing 12 months · click to drill
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="mt-btn">Upload transactions</button>
            <Tip content="Plaid coming soon — for now, import broker CSVs from Chase, Fidelity, Schwab.">
              <button type="button" className="mt-btn" disabled>
                Connect brokerage via Plaid
              </button>
            </Tip>
          </div>
        </div>
        {loading ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            Loading portfolio…
          </div>
        ) : accountTiles.length === 0 ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            No accounts yet — sign in to see your portfolio.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 'var(--mt-gap-card)',
            }}
          >
            {accountTiles.map((a, i) => {
              const isOpen = openAcct === a.account_name;
              const color = a.color || PF_COLORS[i % PF_COLORS.length];
              const ttm = Number(a.ttm) || 0;
              const sharpe = Number(a.sharpe) || 0;
              const share = total > 0 ? ((Number(a.market_value) || 0) / total) * 100 : 0;
              return (
                <button
                  key={a.account_name}
                  type="button"
                  onClick={() => setOpenAcct(isOpen ? null : a.account_name)}
                  className="mt-card"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    borderColor: isOpen ? color : 'var(--mt-line-0)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--mt-ink-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.account_name}
                      </span>
                    </span>
                    <span className="num" style={{ fontSize: 11, color: 'var(--mt-ink-2)' }}>
                      {share.toFixed(1)}<i style={{ color: 'var(--mt-ink-3)', fontStyle: 'italic' }}>% of book</i>
                    </span>
                  </div>
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
                    {fmt$(Number(a.market_value) || 0, 0)}
                  </div>
                  <div style={{ color: ttm >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>
                    <Sparkline
                      data={fakeSpark(a.account_name, 100, ttm)}
                      width={260}
                      height={28}
                      stroke={ttm >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
                      fill={ttm >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
                      area
                      showDot={false}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <div>
                      <div className="mt-eyebrow">TTM</div>
                      <b className="num" style={{ color: ttm >= 0 ? 'var(--mt-up)' : 'var(--mt-down)', fontSize: 13 }}>
                        {ttm > 0 ? '+' : ''}{ttm.toFixed(2)}%
                      </b>
                    </div>
                    <div>
                      <div className="mt-eyebrow">Sharpe</div>
                      <b className="num" style={{ fontSize: 13 }}>{sharpe > 0 ? '+' : ''}{sharpe.toFixed(2)}</b>
                    </div>
                    <div>
                      <div className="mt-eyebrow">Positions</div>
                      <b className="num" style={{ fontSize: 13 }}>{a.position_count ?? (byAccount[a.account_name] || []).length}</b>
                    </div>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--mt-ink-2)' }}>
                    {isOpen ? '▾ Hide details' : '▸ Open details'}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Inline account drill */}
        {account && (
          <div className="mt-card mt-fade" style={{ marginTop: 16, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div className="mt-eyebrow">{(account.account_type || 'ACCOUNT').toUpperCase()}</div>
                <div className="mt-h2">{account.account_name}</div>
                <div style={{ fontSize: 13, color: 'var(--mt-ink-2)', marginTop: 4 }}>
                  <b className="num" style={{ color: 'var(--mt-ink-0)' }}>{fmt$(Number(account.market_value) || 0, 0)}</b>
                  {' '}· {acctPositions.length} positions
                </div>
              </div>
              <button type="button" className="mt-btn" onClick={() => setOpenAcct(null)}>✕ Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
              <div>
                <div className="mt-eyebrow">Performance · 12 months</div>
                <div style={{ color: (account.ttm ?? 0) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)' }}>
                  <Sparkline
                    data={fakeSpark(account.account_name + 'big', 100, account.ttm || 0)}
                    width={520}
                    height={140}
                    stroke={(account.ttm ?? 0) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
                    fill={(account.ttm ?? 0) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
                    area
                  />
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12, color: 'var(--mt-ink-2)' }}>
                  <span><b className="num" style={{ color: 'var(--mt-ink-0)' }}>{(account.sharpe ?? 0).toFixed(2)}</b> sharpe</span>
                  <span><b className="num" style={{ color: 'var(--mt-ink-0)' }}>0.92</b> beta</span>
                  <span><b className="num" style={{ color: 'var(--mt-down)' }}>−18.4%</b> max DD</span>
                </div>
              </div>
              <div>
                <div className="mt-eyebrow">Positions in this account</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Ticker</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Score</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--mt-ink-2)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Value</th>
                      <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--mt-ink-2)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acctPositions.map((p) => {
                      const mv = Number(p.market_value) || 0;
                      const cb = Number(p.cost_basis) || 0;
                      const pl = mv - cb;
                      const plPct = cb > 0 ? (pl / cb) * 100 : null;
                      return (
                        <tr key={p.id ?? p.ticker} style={{ borderTop: '1px solid var(--mt-line-0)' }}>
                          <td style={{ padding: '8px 0' }}>
                            <span
                              style={{ color: 'var(--mt-accent)', cursor: 'pointer', fontWeight: 600 }}
                              onClick={() => navigate(`/ticker/${p.ticker}`)}
                            >
                              {p.ticker}
                            </span>
                          </td>
                          <td className="num" style={{ textAlign: 'right', padding: '8px 8px', fontWeight: 600 }}>
                            {(p.mt_score ?? 3).toFixed(1)}
                          </td>
                          <td className="num" style={{ textAlign: 'right', padding: '8px 8px' }}>{fmt$(mv, 0)}</td>
                          <td
                            className="num"
                            style={{ textAlign: 'right', padding: '8px 0', color: pl >= 0 ? 'var(--mt-up)' : 'var(--mt-down)', fontWeight: 600 }}
                          >
                            {pl > 0 ? '+' : ''}{fmt$(pl, 0)} · {fmtPct(plPct, 1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Allocation */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Allocation</div>
            <div className="mt-h2">Where the money lives.</div>
          </div>
          <div className="mt-pillgroup">
            {[['account', 'By account'], ['sector', 'By sector'], ['class', 'By asset class']].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`mt-pill ${allocTab === k ? 'on' : ''}`}
                onClick={() => setAllocTab(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-card" style={{ padding: 18 }}>
          {allocTab === 'account' && (
            <AllocRows
              rows={accountTiles.map((a, i) => ({
                name: a.account_name,
                value: Number(a.market_value) || 0,
                pct: total > 0 ? ((Number(a.market_value) || 0) / total) * 100 : 0,
                color: a.color || PF_COLORS[i % PF_COLORS.length],
              }))}
            />
          )}
          {allocTab === 'sector' && (
            <AllocRows
              rows={bySector.map((s, i) => ({
                name: s.name,
                value: s.value,
                pct: s.pct,
                color: PF_COLORS[i % PF_COLORS.length],
              }))}
            />
          )}
          {allocTab === 'class' && (
            <AllocRows
              rows={CLASS_ALLOC.map((c) => ({
                name: c.name,
                value: (total * c.pct) / 100,
                pct: c.pct,
                color: c.color,
              }))}
            />
          )}
        </div>
      </section>

      {/* Positions list — ScanList rows with drill */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Positions · MacroTilt score</div>
            <div className="mt-h2">Engine signal on every position — with value, cost &amp; P/L.</div>
          </div>
        </div>
        {positions.length === 0 ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            No positions yet.
          </div>
        ) : (
          <ScanList
            rows={positionsAsScanRows}
            drillOpenKey={drillKey}
            setDrillOpenKey={setDrillKey}
            renderDrill={(row) => <PositionDrill row={row} navigate={navigate} />}
          />
        )}
      </section>
    </div>
  );
}

function KeyCell({ label, value, sub, up }) {
  return (
    <div>
      <div className="mt-eyebrow">{label}</div>
      <div
        className="num"
        style={{
          fontFamily: 'var(--mt-font-display)',
          fontSize: 24,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          marginTop: 2,
          lineHeight: 1.0,
          color: up === true ? 'var(--mt-up)' : up === false ? 'var(--mt-down)' : 'var(--mt-ink-0)',
        }}
      >
        {value}
      </div>
      <div className="num" style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function PositionDrill({ row }) {
  const p = row.raw || {};
  const mv = Number(p.market_value) || 0;
  const cb = Number(p.cost_basis) || 0;
  const pl = mv - cb;
  const plPct = cb > 0 ? (pl / cb) * 100 : null;
  return (
    <div
      className="mt-fade"
      style={{ padding: '18px 18px 22px', background: 'var(--mt-surface-2)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}
    >
      <div>
        <div className="mt-eyebrow">Signal vs. last review</div>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--mt-ink-1)', maxWidth: 480 }}>
          Engine sees <b>{row.ticker}</b> at a <b>{row.score.toFixed(1)}/5</b> score.
          {' '}Hold without action unless you see degradation on the next refresh.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
          <KeyCell label="Cost basis" value={fmt$(cb, 0)} sub="" />
          <KeyCell label="Market value" value={fmt$(mv, 0)} sub="" />
          <KeyCell label="Total P/L" value={`${pl > 0 ? '+' : ''}${fmt$(pl, 0)}`} sub={fmtPct(plPct, 1)} up={pl >= 0} />
        </div>
      </div>
      <div>
        <div className="mt-eyebrow">Score composition · {row.ticker}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {[['Technicals', 0.78], ['Insider', 0.62], ['Options', 0.55], ['Analyst', 0.71]].map(([k, v]) => (
            <div key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--mt-ink-1)' }}>
                <span>{k}</span>
                <span className="num">{(v * 5).toFixed(1)}<i style={{ color: 'var(--mt-ink-3)' }}>/5</i></span>
              </div>
              <div style={{ height: 6, background: 'var(--mt-surface-3)', borderRadius: 3, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ width: `${v * 100}%`, height: '100%', background: 'var(--mt-accent)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AllocRows({ rows }) {
  if (!rows?.length) return <div style={{ color: 'var(--mt-ink-2)' }}>No data.</div>;
  const filtered = rows.filter((r) => r.value > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {filtered.map((r) => (
        <div
          key={r.name}
          style={{
            display: 'grid',
            gridTemplateColumns: '14px 1.5fr 3fr 100px 70px',
            gap: 10,
            alignItems: 'center',
            fontSize: 13,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.color }} />
          <span style={{ color: 'var(--mt-ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.name}
          </span>
          <span style={{ height: 8, background: 'var(--mt-surface-3)', borderRadius: 4, overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${Math.min(100, r.pct)}%`, height: '100%', background: r.color, borderRadius: 4 }} />
          </span>
          <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-1)', fontSize: 12 }}>
            {fmt$(r.value, 0)}
          </span>
          <span className="num" style={{ textAlign: 'right', color: 'var(--mt-ink-0)', fontWeight: 600 }}>
            {r.pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}
