import React, { useEffect, useMemo, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import Drawer from '../components/Drawer';
import { usePricesAsOfDate } from '../../hooks/usePricesAsOfDate';
import MTChart from '../components/MTChart';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import usePortfolioHistory from '../../hooks/usePortfolioHistory';
import { useTransactionsLedger } from '../../hooks/useTransactionsLedger';
import { useSession } from '../../auth/useSession';
import { InfoTip } from '../../InfoTip';

// Money formatter — matches the broker-statement style used elsewhere.
function fmtMoney(v, opts = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v < 0 ? '-' : opts.signed ? '+' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
}

// Option-aware ticker label so a trade row reads obvious — "NVDA $195P 7/17/26".
function tradeTickerLabel(r) {
  if (r.assetClass === 'option' && r.contractType && r.strike != null) {
    const ct = r.contractType.toUpperCase().slice(0, 1);
    const exp = r.expiration
      ? new Date(r.expiration).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
      : '';
    return `${r.ticker} $${r.strike}${ct}${exp ? ' ' + exp : ''}`;
  }
  return r.ticker;
}

export default function InsightsPage() {
  const { positions, accounts, loading: posLoading } = useUserPortfolio();
  const { session, loading: authLoading } = useSession();
  const isAuthed = !!session;
  const navHistory = usePortfolioHistory({ since: null });
  // Trade-level ledger — the components a position aggregates into. Drives
  // the Position → Trades drill.  Bug #1165.
  const { rows: txRows, loading: txLoading } = useTransactionsLedger();
  // Open position drill, identified by { ticker, accountId } so the same
  // ticker held in two accounts opens its own trades. null = drawer closed.
  const [openPos, setOpenPos] = useState(null);
  const [navPoints, setNavPoints] = useState([]);

  useEffect(() => {
    if (Array.isArray(navHistory?.history)) {
      const pts = navHistory.history
        .filter((p) => p.date && p.nav != null)
        .map((p) => [p.date, p.nav]);
      setNavPoints(pts);
    } else if (Array.isArray(navHistory)) {
      const pts = navHistory.filter((p) => p.date && p.nav != null).map((p) => [p.date, p.nav]);
      setNavPoints(pts);
    }
  }, [navHistory]);

  // Each account in the hook output carries a positions[] array. Sum
  // those to produce per-account NAV. Total NAV is the sum across accounts.
  // The hook also reshapes legacy shapes — `value` is the canonical position field.
  const accountList = useMemo(() => {
    const list = Array.isArray(accounts) ? accounts : [];
    return list.map((a) => {
      const pos = Array.isArray(a.positions) ? a.positions : [];
      const value = pos.reduce((s, p) => s + (Number(p.value) || Number(p.market_value) || 0), 0);
      return { ...a, value, positionCount: pos.length };
    }).sort((x, y) => y.value - x.value);
  }, [accounts]);
  const totalNav = useMemo(
    () => accountList.reduce((s, a) => s + (a.value || 0), 0),
    [accountList]
  );

  // Flat, sorted position list across every account — the rows the user
  // clicks to drill into trades. Each row keeps its account label so the
  // table reads without a second lookup.  Bug #1165.
  const positionRows = useMemo(() => {
    const out = [];
    accountList.forEach((a) => {
      (Array.isArray(a.positions) ? a.positions : []).forEach((p) => {
        out.push({
          ...p,
          accountId: p.accountId || p.account_id || a.id || a.account_id,
          accountLabel: a.label || a.account_name || 'Account',
          value: Number(p.value) || Number(p.market_value) || 0,
        });
      });
    });
    return out.sort((x, y) => (y.value || 0) - (x.value || 0));
  }, [accountList]);

  // Trades that make up the open position — same ticker, same account.
  // This is the component layer behind a position aggregate.
  const openPosTrades = useMemo(() => {
    if (!openPos || !Array.isArray(txRows)) return [];
    return txRows.filter(
      (r) => r.ticker === openPos.ticker
        && (openPos.accountId == null || r.accountId === openPos.accountId)
    );
  }, [openPos, txRows]);

  // Prices-as-of freshness chip (Joe directive — bug 1155).
  // Pinned to the `massive-eod` indicator in pipeline_health (the
  // green/red signal for daily EOD price ingest). The chip's label
  // shows the trade_date of the most recent prices_eod row so Joe
  // can see at a glance which trading day his NAV was priced from,
  // and the chip turns red when that pipeline goes past its SLA.
  const pricesAsOfDate = usePricesAsOfDate();
  const pricesAsOfLabel = pricesAsOfDate
    ? `Prices as of ${new Date(pricesAsOfDate + 'T16:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'Prices —';

  return (
    <div className="v2-root">
      <header className="v2-hero">
        <div className="arc" aria-hidden="true">
          <svg viewBox="0 0 600 600" preserveAspectRatio="xMaxYMid slice">
            <g transform="translate(420 300)">{[60,100,140,180,220,260,300,340].map((r) => <circle key={r} r={r} />)}</g>
          </svg>
        </div>
        <div className="v2-shell">
          <div className="v2-hero-row">
            <div>
              <div className="t-eyebrow accent" style={{ marginBottom: 14 }}>Total net liquidation <InfoTip term="TOTAL NET LIQUIDATION" size={11} /></div>
              <div style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 'clamp(48px,6vw,80px)', lineHeight: .95, letterSpacing: '-.025em', color: 'var(--ink-0)', fontFeatureSettings: '"tnum","lnum"' }}>
                {posLoading ? '—' : (
                  <>
                    <span style={{ fontSize: '.5em', color: 'var(--ink-2)', marginRight: 4, verticalAlign: '0.18em' }}>$</span>
                    <CountUp to={Math.round(totalNav)} format={(v) => Math.round(v).toLocaleString('en-US')} />
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <FreshnessChip elementId="portfolio_history" />
              <FreshnessChip elementId="massive-eod" label={pricesAsOfLabel} />
            </div>
          </div>
        </div>
      </header>

      {navPoints.length >= 2 && (
        <div className="v2-shell" style={{ marginTop: 32 }}>
          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Net liquidation <InfoTip term="NET LIQUIDATION" size={12} /></h2>
            </div>
            {/* Net liquidation is risk-on polarity (#1158): a higher
                reading is the favourable end, so the top quarter of the
                series' own history paints as the Risk-On zone. */}
            <MTChart
              data={navPoints}
              initialRange="3Y"
              polarity="risk-on"
              timeframes={[
                { key: '1Y', label: '1Y' },
                { key: '3Y', label: '3Y' },
                { key: 'MAX', label: 'MAX' },
              ]}
              tipFormat={(v) => `$${Math.round(v).toLocaleString('en-US')}`}
              yFormat={(v) => `$${Math.round(v / 1000)}K`}
              height={280}
            />
          </div>
        </div>
      )}

      <div className="v2-shell" style={{ marginTop: 32 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }} className="v2-asset-grid">
          {accountList.map((a) => (
            <div key={a.id || a.account_id} className="v2-tile" style={{ minHeight: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <span className="t-eyebrow">{a.label || a.account_name || 'Account'}</span>
                <span className="t-eyebrow accent">{a.account_type || ''}</span>
              </div>
              <div style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 30, lineHeight: 1, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"' }}>
                <span style={{ fontSize: '.55em', color: 'var(--ink-2)', marginRight: 2, verticalAlign: '0.18em' }}>$</span>
                <CountUp to={Math.round(a.value || 0)} format={(v) => Math.round(v).toLocaleString('en-US')} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, color: 'var(--ink-2)' }}>
                <span>{a.positionCount} positions</span>
                <span style={{ fontFeatureSettings: '"tnum"' }}>{a.last_synced_at ? new Date(a.last_synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
              </div>
            </div>
          ))}
        </div>
        {/* POSITIONS — each row drills to its underlying trades. Bug #1165. */}
        {isAuthed && positionRows.length > 0 && (
          <div style={{ marginTop: 24, background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px 14px', borderBottom: '1px solid var(--line-0)' }}>
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Positions</h2>
              <span className="t-eyebrow">{positionRows.length} holdings</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {[
                    { label: 'Position', align: 'left' },
                    { label: 'Account', align: 'left' },
                    { label: 'Quantity', align: 'right' },
                    { label: 'Price', align: 'right' },
                    { label: 'Market value', align: 'right' },
                  ].map((h) => (
                    <th key={h.label} style={{
                      textAlign: h.align, padding: '14px 28px', fontSize: 10.5, letterSpacing: '.14em',
                      textTransform: 'uppercase', color: 'var(--ink-2)', fontWeight: 500,
                      borderBottom: '1px solid var(--line-1)', background: 'var(--bg-1)',
                    }}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positionRows.map((p) => (
                  <tr key={`${p.accountId}-${p.id || p.ticker}`}
                    onClick={() => setOpenPos({ ticker: p.ticker, accountId: p.accountId, name: p.name, accountLabel: p.accountLabel, value: p.value })}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-0)', fontWeight: 500 }}>
                      {p.ticker}
                      {p.name ? <span style={{ color: 'var(--ink-2)', fontWeight: 400, marginLeft: 8, fontSize: 12 }}>{p.name}</span> : null}
                    </td>
                    <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-1)' }}>{p.accountLabel}</td>
                    <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', textAlign: 'right', color: 'var(--ink-1)', fontFeatureSettings: '"tnum"' }}>
                      {p.quantity != null ? Number(p.quantity).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}
                    </td>
                    <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', textAlign: 'right', color: 'var(--ink-1)', fontFeatureSettings: '"tnum"' }}>
                      {p.price != null ? fmtMoney(Number(p.price)) : '—'}
                    </td>
                    <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', textAlign: 'right', color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', fontWeight: 500 }}>
                      {fmtMoney(p.value, { cents: false })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(!authLoading && !isAuthed) && (
          <div style={{ marginTop: 32, padding: 32, background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', textAlign: 'center', color: 'var(--ink-2)' }}>
            Sign in to load your portfolio.
          </div>
        )}
        {(isAuthed && !posLoading && accountList.length === 0) && (
          <div style={{ marginTop: 32, padding: 32, background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', textAlign: 'center', color: 'var(--ink-2)' }}>
            No accounts on file. Add a position from the editor to populate this view.
          </div>
        )}
        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Accounts · End-of-day prices nightly · Positions imported from Chase, Schwab, Fidelity
        </div>
      </div>

      {/* POSITION → TRADES DRILL — Bug #1165. The trades that make up the
          clicked position, newest first, from the transactions ledger. */}
      <Drawer open={openPos != null} onClose={() => setOpenPos(null)}>
        {openPos && (
          <>
            <div className="t-eyebrow accent">{openPos.accountLabel} · position</div>
            <h3 className="t-section" style={{ margin: '8px 0 12px', color: 'var(--ink-0)' }}>
              {openPos.ticker}{openPos.name ? <span style={{ color: 'var(--ink-2)', fontWeight: 400, fontSize: 14, marginLeft: 8 }}>{openPos.name}</span> : null}
            </h3>
            <div className="v2-drawer-grid">
              <div className="v2-drawer-stat">
                <div className="lbl">Market value</div>
                <div className="v">{fmtMoney(openPos.value, { cents: false })}</div>
              </div>
              <div className="v2-drawer-stat">
                <div className="lbl">Trades on file</div>
                <div className="v">{openPosTrades.length}</div>
              </div>
            </div>

            <div className="v2-drawer-section">
              <span className="t-eyebrow">Trade history <InfoTip def="Every buy, sell, open and close logged against this position in the transactions ledger." size={10} /></span>
              {txLoading && (
                <div style={{ color: 'var(--ink-2)', fontSize: 12, padding: '10px 0' }}>Loading trades…</div>
              )}
              {!txLoading && openPosTrades.length === 0 && (
                <div style={{ color: 'var(--ink-2)', fontSize: 12, padding: '10px 0' }}>
                  No trades on file for this position yet. Trades appear here once they are recorded in the ledger.
                </div>
              )}
              {!txLoading && openPosTrades.map((t) => (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'baseline', padding: '10px 0', borderBottom: '1px solid var(--line-0)', fontSize: 13 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '.05em', padding: '3px 8px', borderRadius: 'var(--r-sm)',
                    background: 'var(--bg-2)', border: '1px solid var(--line-1)',
                    color: ['BUY', 'OPEN'].includes((t.side || '').toUpperCase()) ? 'var(--up)'
                      : ['SELL', 'SHORT'].includes((t.side || '').toUpperCase()) ? 'var(--down)' : 'var(--ink-1)',
                  }}>{(t.side || '—').toUpperCase()}</span>
                  <div>
                    <div style={{ color: 'var(--ink-0)' }}>{tradeTickerLabel(t)}</div>
                    <div style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.03em', marginTop: 2 }}>
                      {t.executedAt ? t.executedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                      {t.quantity != null ? ` · ${Number(t.quantity).toLocaleString('en-US', { maximumFractionDigits: 6 })} @ ${fmtMoney(t.price)}` : ''}
                    </div>
                  </div>
                  <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontFeatureSettings: '"tnum"', textAlign: 'right' }}>
                    {t.realizedPnl != null ? (
                      <span style={{ color: t.realizedPnl >= 0 ? 'var(--up)' : 'var(--down)' }}>{fmtMoney(t.realizedPnl, { signed: true })}</span>
                    ) : t.netProceeds != null ? (
                      <span style={{ color: 'var(--ink-1)' }}>{fmtMoney(t.netProceeds)}</span>
                    ) : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
