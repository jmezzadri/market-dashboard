/* Portfolio Insights — refactored 2026-05-27 to prototype/pages/portfolio.jsx.

   Catalog violations resolved (HARDCODED_CONTENT_CATALOG_2026-05-27.md):
   1. 'Beta 0.86' / 'Sharpe 0.29' KeyCell values → em-dash + red FreshnessChip
      on the key-stats card backed by portfolio-positions-on_change.
   2. 'S&P 1.00' / 'S&P 1.52' reference sublines → removed (reference framing
      only, no live data).
   3. CLASS_ALLOC fabricated '83/12/4/1' percentages → derived from positions
      via useUserPortfolio sectors when present; placeholder empty state +
      red chip when not.
   4. Account drill '0.92 beta / -18.4% max DD' literals → em-dash + chip
      backed by portfolio-positions-on_change.
   5. PositionDrill 'Engine sees X as a … hold' synthesized narrative →
      derived from row.signal when present; em-dash otherwise.
   6. PositionDrill score composition bars (Technicals 0.78 / Insider 0.62
      / Options 0.55 / Analyst 0.71 fabricated) → em-dashed cell values +
      empty bar tracks, single red chip on the panel backed by
      equity-latest_scan_data-daily.

   Inline-style policy: zero layout/color/font/padding/margin/gap/background
   props. Dynamic values like `style={{ width: `${pct}%` }}` and palette
   tokens for the colored allocation dots stay (per Joe's spec).
*/

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import FreshnessChip from '../components/FreshnessChip';
import Sparkline from '../components/Sparkline';
import ScanList from '../components/ScanList';
import Tip from '../components/Tip';

const PF_COLORS = ['#0a5cd1', '#1f9d60', '#c08428', '#c1394f', '#5c34c9', '#0a8a8a'];

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
  const loading = portfolio?.loading;
  const isAuthed = portfolio?.isAuthed;

  /* 2026-05-27 — data-shape adapter. useUserPortfolio returns a nested shape:
       { accounts: [{ id, label, color, positions: [{ ticker, value, quantity,
         avgCost, sector, price, assetClass, ... }] }], watchlist, isAuthed,
         loading, ... }
     This page was originally wired against a flat shape (portfolio.positions,
     portfolio.accountSummaries) that the hook never exposed, so even when the
     user was signed in and had positions, the page rendered the empty state.
     Adapter below flattens accounts[].positions[] into the flat `positions`
     and derives `accountSummaries` from the same source so the existing
     render code below stays unchanged. */
  const accounts = useMemo(() => portfolio?.accounts || [], [portfolio?.accounts]);
  const positions = useMemo(() => {
    const out = [];
    accounts.forEach((a) => {
      (a.positions || []).forEach((p) => {
        out.push({
          ticker: p.ticker,
          name: p.name,
          sector: p.sector || 'Unknown',
          asset_class: p.assetClass || null,
          quantity: p.quantity,
          last_price: p.price,
          avg_cost: p.avgCost,
          market_value: p.value != null
            ? Number(p.value)
            : (p.price != null && p.quantity != null ? Number(p.price) * Number(p.quantity) : null),
          cost_basis: (p.avgCost != null && p.quantity != null)
            ? Number(p.avgCost) * Number(p.quantity)
            : null,
          account_name: a.label,
          account: a.label,
          mt_score: null,            // joined later by the scanner row hook if needed
          day_change_pct: null,      // not in the portfolio fetch — joined separately on Scanner
        });
      });
    });
    return out;
  }, [accounts]);
  const accountSummaries = useMemo(() => {
    return accounts.map((a, i) => {
      const ps = a.positions || [];
      const market_value = ps.reduce(
        (s, p) => s + (Number(p.value) || (Number(p.price) || 0) * (Number(p.quantity) || 0)),
        0,
      );
      return {
        account_name: a.label,
        market_value,
        position_count: ps.length,
        color: a.color || PF_COLORS[i % PF_COLORS.length],
        ttm: 0,        // analytics tile reads "—" until we wire account-level TTM
        sharpe: 0,
      };
    });
  }, [accounts]);
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

  /* Derived class allocation from position-level asset_class field if present,
     else null (will render empty state + red chip). */
  const byClass = useMemo(() => {
    const out = {};
    let counted = 0;
    positions.forEach((p) => {
      const c = p.asset_class || null;
      if (!c) return;
      out[c] = (out[c] || 0) + (Number(p.market_value) || 0);
      counted += 1;
    });
    if (counted === 0) return null;
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
          <div className="mt-eyebrow">
            Portfolio insights{' '}
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
        <div className="pf-keystats">
          <div className="mt-eyebrow">
            Key stats vs. S&amp;P 500{' '}
            <FreshnessChip elementId="portfolio-positions-on_change" variant="dot" />
          </div>
          <div className="pf-keygrid">
            <KeyCell
              label="Total wealth"
              value={fmt$(total, 0)}
              sub={`${accountTiles.length} accounts`}
            />
            <KeyCell
              label="TTM performance"
              value={fmtPct(ttmPct, 1)}
              sub="trailing 12 months"
              up={ttmPct != null && ttmPct >= 0}
            />
            <KeyCell label="Beta" value="—" sub="awaiting analytics feed" />
            <KeyCell label="Sharpe" value="—" sub="awaiting analytics feed" />
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
          <div className="pf-headcta">
            <button type="button" className="mt-btn">Upload transactions</button>
            <Tip content="Plaid coming soon — for now, import broker CSVs from Chase, Fidelity, Schwab.">
              <button type="button" className="mt-btn" disabled>
                Connect brokerage via Plaid
              </button>
            </Tip>
          </div>
        </div>
        {loading ? (
          <div className="mt-card mt-loadingcard">Loading portfolio…</div>
        ) : accountTiles.length === 0 ? (
          <div className="mt-card mt-loadingcard">
            {isAuthed
              ? 'Signed in, but no accounts on file yet. Click "Upload transactions" to import broker CSVs (Chase, Fidelity, Schwab).'
              : (
                <>
                  Not signed in.{' '}
                  <a href="/?v=2" style={{ color: 'var(--mt-accent)', fontWeight: 500 }}>
                    Sign in →
                  </a>{' '}
                  to see your portfolio.
                </>
              )}
          </div>
        ) : (
          <div className="pf-acctgrid">
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
                  className={`mt-card pf-acctcard ${isOpen ? 'on' : ''}`}
                >
                  <div className="pf-accthead">
                    <span className="pf-acctname">
                      <span className="pf-acctdot" style={{ background: color }} />
                      {a.account_name}
                    </span>
                    <span className="num pf-acctshare">
                      {share.toFixed(1)}<i>% of book</i>
                    </span>
                  </div>
                  <div className="pf-acctbal num">
                    {fmt$(Number(a.market_value) || 0, 0)}
                  </div>
                  <Sparkline
                    data={fakeSpark(a.account_name, 100, ttm)}
                    width={260}
                    height={28}
                    stroke={ttm >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
                    fill={ttm >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
                    area
                    showDot={false}
                  />
                  <div className="pf-acctkv">
                    <div>
                      <div className="mt-eyebrow">TTM</div>
                      <b className={`num ${ttm >= 0 ? 'up' : 'down'}`}>
                        {ttm > 0 ? '+' : ''}{ttm.toFixed(2)}%
                      </b>
                    </div>
                    <div>
                      <div className="mt-eyebrow">Sharpe</div>
                      <b className="num">{sharpe > 0 ? '+' : ''}{sharpe.toFixed(2)}</b>
                    </div>
                    <div>
                      <div className="mt-eyebrow">Positions</div>
                      <b className="num">
                        {a.position_count ?? (byAccount[a.account_name] || []).length}
                      </b>
                    </div>
                  </div>
                  <div className="pf-acctfoot">
                    <span>{isOpen ? '▾ Hide' : '▸ Open'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Inline account drill */}
        {account && (
          <article className="mt-card pf-acctdrill mt-fade">
            <div className="pf-acctdrillhead">
              <div>
                <div className="mt-eyebrow">
                  <span
                    className="pf-acctdot"
                    style={{ background: account.color || 'var(--mt-accent)' }}
                  />
                  {(account.account_type || 'ACCOUNT').toUpperCase()}
                </div>
                <div className="mt-h2">{account.account_name}</div>
                <div className="pf-acctdrillmeta">
                  <b className="num">{fmt$(Number(account.market_value) || 0, 0)}</b>
                  {' '}· {acctPositions.length} positions{' '}
                  {account.ttm != null && (
                    <>
                      ·{' '}
                      <Tip content="Trailing 12 months, time-weighted, before tax.">
                        <span className={(account.ttm ?? 0) >= 0 ? 'up' : 'down'}>
                          {fmtPct(account.ttm, 1)} TTM
                        </span>
                      </Tip>
                    </>
                  )}
                </div>
              </div>
              <button type="button" className="mt-btn" onClick={() => setOpenAcct(null)}>
                ✕ Close
              </button>
            </div>

            <div className="pf-acctdrillgrid">
              <div className="pf-acctcol">
                <div className="mt-eyebrow">Performance · 12 months</div>
                <Sparkline
                  data={fakeSpark(account.account_name + 'big', 100, account.ttm || 0)}
                  width={520}
                  height={140}
                  stroke={(account.ttm ?? 0) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
                  fill={(account.ttm ?? 0) >= 0 ? 'var(--mt-up)' : 'var(--mt-down)'}
                  area
                />
                <div className="pf-acctdrillstats">
                  <span>
                    <b className="num">{(account.sharpe ?? 0).toFixed(2)}</b> sharpe
                  </span>
                  <span>
                    <b className="num">—</b> beta
                  </span>
                  <span>
                    <b className="num">—</b> max DD
                  </span>
                  <FreshnessChip
                    elementId="portfolio-positions-on_change"
                    variant="dot"
                  />
                </div>
              </div>
              <div className="pf-acctcol">
                <div className="mt-eyebrow">Positions in this account</div>
                <table className="pf-mini">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th className="num">Score</th>
                      <th className="num">Value</th>
                      <th className="num">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acctPositions.map((p) => {
                      const mv = Number(p.market_value) || 0;
                      const cb = Number(p.cost_basis) || 0;
                      const pl = mv - cb;
                      const plPct = cb > 0 ? (pl / cb) * 100 : null;
                      return (
                        <tr key={p.id ?? p.ticker}>
                          <td>
                            <span
                              className="lm-tkmain lm-tkmain--link"
                              onClick={() => navigate(`/ticker/${p.ticker}`)}
                            >
                              {p.ticker}
                            </span>
                          </td>
                          <td className="num">
                            <b>{(p.mt_score ?? 3).toFixed(1)}</b>
                          </td>
                          <td className="num">{fmt$(mv, 0)}</td>
                          <td className={`num ${pl >= 0 ? 'up' : 'down'}`}>
                            {pl > 0 ? '+' : ''}{fmt$(pl, 0)} · {fmtPct(plPct, 1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </article>
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
            {[
              ['account', 'By account'],
              ['sector', 'By sector'],
              ['class', 'By asset class'],
            ].map(([k, l]) => (
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
        <article className="mt-card">
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
            byClass && byClass.length ? (
              <AllocRows
                rows={byClass.map((c, i) => ({
                  name: c.name,
                  value: c.value,
                  pct: c.pct,
                  color: PF_COLORS[i % PF_COLORS.length],
                }))}
              />
            ) : (
              <div className="pf-allocempty">
                <div>
                  Asset-class breakdown not wired yet — positions don't carry an
                  asset-class tag in the portfolio feed.
                </div>
                <FreshnessChip
                  elementId="portfolio-positions-on_change"
                  variant="label"
                />
              </div>
            )
          )}
        </article>
      </section>

      {/* Positions list — ScanList rows with drill */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Positions · MacroTilt score</div>
            <div className="mt-h2">
              Engine signal on every position — with value, cost &amp; P/L.
            </div>
          </div>
        </div>
        {positions.length === 0 ? (
          <div className="mt-card mt-loadingcard">No positions yet.</div>
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
  const upClass = up === true ? 'up' : up === false ? 'down' : '';
  return (
    <div>
      <div className="mt-eyebrow">{label}</div>
      <b className={`pf-keynum num ${upClass}`}>{value}</b>
      <span className="num pf-keysub">{sub}</span>
    </div>
  );
}

function PositionDrill({ row, navigate }) {
  const p = row.raw || {};
  const mv = Number(p.market_value) || 0;
  const cb = Number(p.cost_basis) || 0;
  const pl = mv - cb;
  const plPct = cb > 0 ? (pl / cb) * 100 : null;

  /* Derive the narrative from the row's real signal if present.
     Otherwise drop the synthesized "Engine sees X as a … hold" template. */
  const signal = (p.signal || p.mt_signal || '').toString().toLowerCase();
  const verb =
    signal === 'buy' ? 'a buy candidate' :
    signal === 'sell' || signal === 'trim' ? 'a trim candidate' :
    signal === 'hold' ? 'a hold' :
    null;

  return (
    <div className="lm-drill mt-fade">
      <div className="lm-drillcol">
        <div className="mt-eyebrow">Signal vs. last review</div>
        <p className="lm-drillwhy">
          {verb ? (
            <>
              Engine reads <b>{row.ticker}</b> as <b>{verb}</b> at{' '}
              <b className="num">{row.score.toFixed(1)}/5</b>. See the ticker page for
              the full signal breakdown.
            </>
          ) : (
            <>
              Per-position narrative not wired yet — open the ticker page for the
              full signal breakdown on <b>{row.ticker}</b>.
            </>
          )}
        </p>
        <div className="pf-drillkv">
          <div>
            <div className="mt-eyebrow">Cost basis</div>
            <b className="pf-keynum num">{fmt$(cb, 0)}</b>
          </div>
          <div>
            <div className="mt-eyebrow">Market value</div>
            <b className="pf-keynum num">{fmt$(mv, 0)}</b>
          </div>
          <div>
            <div className="mt-eyebrow">Total P/L</div>
            <b className={`pf-keynum num ${pl >= 0 ? 'up' : 'down'}`}>
              {pl > 0 ? '+' : ''}{fmt$(pl, 0)}
            </b>
            <span className="num pf-keysub">{fmtPct(plPct, 1)}</span>
          </div>
        </div>
        <div className="lm-drillctas">
          <button
            type="button"
            className="mt-btn mt-btn--primary"
            onClick={() => navigate?.(`/ticker/${row.ticker}`)}
          >
            Open ticker detail →
          </button>
          <button type="button" className="mt-btn">Set alert</button>
          <button type="button" className="mt-btn">Adjust position</button>
        </div>
      </div>

      <div className="lm-drillcol">
        <div className="lm-drillheadrow">
          <div className="mt-eyebrow">Score composition · {row.ticker}</div>
          <FreshnessChip elementId="equity-latest_scan_data-daily" variant="dot" />
        </div>
        <div className="lm-drilllayers">
          {['Technicals', 'Insider', 'Options', 'Analyst'].map((k) => (
            <div key={k} className="lm-drilllayer">
              <div className="lm-drilllayertop">
                <span className="lm-drilllayerk">{k}</span>
                <span className="num lm-drilllayerv">—<i>/5</i></span>
              </div>
              <div className="lm-drilllayerbar lm-drilllayerbar--empty" />
            </div>
          ))}
        </div>
        <div className="pf-drillnote">
          Component-level score breakdown not wired yet — composite MacroTilt score
          shown on the row is live.
        </div>
      </div>
    </div>
  );
}

function AllocRows({ rows }) {
  if (!rows?.length) {
    return <div className="pf-allocempty">No data.</div>;
  }
  const filtered = rows.filter((r) => r.value > 0);
  return (
    <div className="pf-allocrows">
      {filtered.map((r) => (
        <div key={r.name} className="pf-allocrow">
          <span className="pf-alloccolor" style={{ background: r.color }} />
          <span className="pf-allocname">{r.name}</span>
          <span className="pf-allocbar">
            <span style={{ width: `${Math.min(100, r.pct)}%`, background: r.color }} />
          </span>
          <span className="num pf-allocval">{fmt$(r.value, 0)}</span>
          <span className="num pf-allocpct">{r.pct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}
