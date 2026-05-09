import React, { useEffect, useMemo, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import { usePricesAsOfDate } from '../../hooks/usePricesAsOfDate';
import MTChart from '../components/MTChart';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import usePortfolioHistory from '../../hooks/usePortfolioHistory';
import { useSession } from '../../auth/useSession';

export default function InsightsPage() {
  const { positions, accounts, loading: posLoading } = useUserPortfolio();
  const { session, loading: authLoading } = useSession();
  const isAuthed = !!session;
  const navHistory = usePortfolioHistory({ since: null });
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
              <div className="t-eyebrow accent" style={{ marginBottom: 14 }}>Total net liquidation</div>
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
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Net liquidation</h2>
            </div>
            <MTChart
              data={navPoints}
              initialRange="3Y"
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
    </div>
  );
}
