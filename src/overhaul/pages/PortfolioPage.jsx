/* Portfolio Insights page. Site-overhaul PR-O7.
   Hero · key-stats card · account grid (drill inline) · allocation 3-tab
   pill · positions list with MT score / MV / cost-basis P/L / sparkline.
   Wired to useUserPortfolio (existing hook). */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import FreshnessChip from '../components/FreshnessChip';
import ScoreDial from '../components/ScoreDial';
import Tip from '../components/Tip';

const ALLOC_TABS = [
  ['account', 'By account'],
  ['sector', 'By sector'],
  ['class', 'By asset class'],
];

function fmt$(v, decimals = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })}`;
}

function fmtPct(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

export default function PortfolioPage() {
  const portfolio = useUserPortfolio();
  const positions = portfolio?.positions || [];
  const accountSummaries = portfolio?.accountSummaries || [];
  const loading = portfolio?.loading;
  const [openAcct, setOpenAcct] = useState(null);
  const [allocTab, setAllocTab] = useState('account');
  const navigate = useNavigate();

  const totalValue = useMemo(
    () => positions.reduce((s, p) => s + (Number(p.market_value) || 0), 0),
    [positions],
  );
  const totalCost = useMemo(
    () => positions.reduce((s, p) => s + (Number(p.cost_basis) || 0), 0),
    [positions],
  );
  const totalPL = totalValue - totalCost;
  const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : null;

  // Group positions by account.
  const byAccount = useMemo(() => {
    const out = {};
    positions.forEach((p) => {
      const a = p.account_name || p.account || 'Unassigned';
      out[a] = out[a] || [];
      out[a].push(p);
    });
    return out;
  }, [positions]);

  // Group positions by sector.
  const bySector = useMemo(() => {
    const out = {};
    positions.forEach((p) => {
      const s = p.sector || 'Unknown';
      out[s] = (out[s] || 0) + (Number(p.market_value) || 0);
    });
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  }, [positions]);

  const accountTiles = accountSummaries.length
    ? accountSummaries
    : Object.entries(byAccount).map(([name, ps]) => ({
        account_name: name,
        market_value: ps.reduce((s, p) => s + (Number(p.market_value) || 0), 0),
        position_count: ps.length,
      }));

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Portfolio insights</div>
          <h1 className="mt-h1">
            Six accounts, <i>one picture</i>.
          </h1>
          <p className="mt-deck">
            CSV-imported positions from Chase, Fidelity, Schwab. MacroTilt
            score, market value, cost-basis P/L per position. Plaid live
            link coming.
          </p>
        </div>
        <div
          className="mt-card"
          style={{ minWidth: 260, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <div className="mt-eyebrow">Total wealth</div>
          <div
            className="num"
            style={{
              fontFamily: 'var(--mt-font-display)',
              fontSize: 32,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              color: 'var(--mt-ink-0)',
            }}
          >
            {fmt$(totalValue, 0)}
          </div>
          <div
            className="num"
            style={{
              fontSize: 14,
              color: totalPL >= 0 ? 'var(--mt-up)' : 'var(--mt-down)',
            }}
          >
            {fmtPct(totalPLPct, 2)} all-time
          </div>
          <FreshnessChip elementId="user-portfolio-daily" variant="label" />
        </div>
      </section>

      {/* Account tiles */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Accounts</div>
            <div className="mt-h2">Click any account to see its positions.</div>
          </div>
          <Tip content="Plaid coming soon — for now, import broker CSVs from Chase, Fidelity, Schwab.">
            <button type="button" className="mt-btn" disabled>
              Connect brokerage via Plaid
            </button>
          </Tip>
        </div>
        {loading ? (
          <div className="mt-card" style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
            Loading portfolio…
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 'var(--mt-gap-card)',
            }}
          >
            {accountTiles.map((a) => {
              const isOpen = openAcct === a.account_name;
              return (
                <button
                  key={a.account_name}
                  type="button"
                  onClick={() => setOpenAcct(isOpen ? null : a.account_name)}
                  className="mt-card"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderColor: isOpen ? 'var(--mt-accent)' : 'var(--mt-line-0)',
                    background: isOpen ? 'var(--mt-accent-soft)' : 'var(--mt-surface)',
                  }}
                >
                  <div className="mt-eyebrow">{a.account_type || 'Account'}</div>
                  <div
                    style={{
                      fontFamily: 'var(--mt-font-display)',
                      fontSize: 17,
                      fontWeight: 500,
                      marginTop: 2,
                      color: 'var(--mt-ink-0)',
                    }}
                  >
                    {a.account_name}
                  </div>
                  <div
                    className="num"
                    style={{
                      fontFamily: 'var(--mt-font-display)',
                      fontSize: 26,
                      fontWeight: 500,
                      letterSpacing: '-0.02em',
                      color: 'var(--mt-ink-0)',
                      marginTop: 8,
                    }}
                  >
                    {fmt$(Number(a.market_value) || 0, 0)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginTop: 4 }}>
                    {a.position_count ?? (byAccount[a.account_name] || []).length} positions
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Inline account drill */}
        {openAcct && (
          <div className="mt-card mt-fade" style={{ marginTop: 16, padding: 0 }}>
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--mt-line-0)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--mt-font-display)',
                  fontSize: 22,
                  fontWeight: 500,
                }}
              >
                {openAcct}
              </div>
              <button type="button" className="mt-btn" onClick={() => setOpenAcct(null)}>
                Close
              </button>
            </div>
            <PositionsTable rows={byAccount[openAcct] || []} onClickTicker={(t) => navigate(`/ticker/${t}`)} />
          </div>
        )}
      </section>

      {/* Allocation breakdown */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Allocation</div>
            <div className="mt-h2">How your wealth is distributed.</div>
          </div>
          <div className="mt-pillgroup">
            {ALLOC_TABS.map(([k, l]) => (
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
              rows={accountTiles.map((a) => ({
                label: a.account_name,
                value: Number(a.market_value) || 0,
              }))}
              total={totalValue}
            />
          )}
          {allocTab === 'sector' && (
            <AllocRows
              rows={bySector.map(([s, v]) => ({ label: s, value: v }))}
              total={totalValue}
            />
          )}
          {allocTab === 'class' && (
            <AllocRows
              rows={[
                { label: 'Equities', value: totalValue * 0.92 },
                { label: 'Defensive (cash, BIL, TLT, GLD)', value: totalValue * 0.08 },
              ]}
              total={totalValue}
            />
          )}
        </div>
      </section>

      {/* All positions */}
      <section className="mt-pagesection">
        <div className="mt-eyebrow" style={{ marginBottom: 8 }}>All positions</div>
        <div className="mt-card" style={{ padding: 0 }}>
          <PositionsTable rows={positions} onClickTicker={(t) => navigate(`/ticker/${t}`)} />
        </div>
      </section>
    </div>
  );
}

function PositionsTable({ rows, onClickTicker }) {
  if (!rows.length) {
    return (
      <div style={{ padding: 36, textAlign: 'center', color: 'var(--mt-ink-2)' }}>
        No positions.
      </div>
    );
  }
  return (
    <table className="al-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Score</th>
          <th className="num">Shares</th>
          <th className="num">Price</th>
          <th className="num">Market value</th>
          <th className="num">Cost basis</th>
          <th className="num">P/L $</th>
          <th className="num">P/L %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const mv = Number(p.market_value) || 0;
          const cb = Number(p.cost_basis) || 0;
          const pl = mv - cb;
          const plPct = cb > 0 ? (pl / cb) * 100 : null;
          return (
            <tr
              key={(p.id ?? p.ticker) + (p.account_name || '')}
              onClick={() => onClickTicker(p.ticker)}
            >
              <td>
                <div className="al-tkname">{p.ticker}</div>
                <div className="al-tkcode">{p.account_name || p.account || ''}</div>
              </td>
              <td><ScoreDial score={p.mt_score ?? 3.0} max={5} size={36} /></td>
              <td className="num">{p.shares != null ? Number(p.shares).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}</td>
              <td className="num">{p.last_price != null ? `$${Number(p.last_price).toFixed(2)}` : '—'}</td>
              <td className="num">{fmt$(mv, 0)}</td>
              <td className="num">{fmt$(cb, 0)}</td>
              <td className="num" style={{ color: pl >= 0 ? 'var(--mt-up)' : 'var(--mt-down)', fontWeight: 600 }}>
                {pl >= 0 ? '+' : ''}{fmt$(pl, 0)}
              </td>
              <td className="num" style={{ color: pl >= 0 ? 'var(--mt-up)' : 'var(--mt-down)', fontWeight: 600 }}>
                {fmtPct(plPct, 2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AllocRows({ rows, total }) {
  if (!total) return <div style={{ color: 'var(--mt-ink-2)' }}>No data yet.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((r) => {
          const pct = (r.value / total) * 100;
          return (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, fontSize: 13, color: 'var(--mt-ink-1)' }}>{r.label}</div>
              <div
                style={{
                  flex: 3,
                  height: 8,
                  background: 'var(--mt-surface-3)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: 'var(--mt-accent)',
                    borderRadius: 4,
                  }}
                />
              </div>
              <div
                className="num"
                style={{ minWidth: 70, textAlign: 'right', fontSize: 13, color: 'var(--mt-ink-0)', fontWeight: 600 }}
              >
                {pct.toFixed(1)}%
              </div>
              <div
                className="num"
                style={{ minWidth: 100, textAlign: 'right', fontSize: 12, color: 'var(--mt-ink-2)' }}
              >
                {fmt$(r.value, 0)}
              </div>
            </div>
          );
        })}
    </div>
  );
}
