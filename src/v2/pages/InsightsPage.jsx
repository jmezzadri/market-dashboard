import React, { useEffect, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';
import MTChart from '../components/MTChart';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import usePortfolioHistory from '../../hooks/usePortfolioHistory';

export default function InsightsPage() {
  const { positions, accounts, loading: posLoading } = useUserPortfolio();
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

  const totalNav = (positions || []).reduce((s, p) => s + (p.market_value || 0), 0);
  const accountList = accounts || [];

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
              <div style={{ fontFamily: 'Fraunces,serif', fontVariationSettings: '"opsz" 144,"SOFT" 30,"wght" 400', fontSize: 'clamp(48px,6vw,80px)', lineHeight: .95, letterSpacing: '-.025em', color: 'var(--ink-0)', fontFeatureSettings: '"tnum","lnum"' }}>
                {posLoading ? '—' : (
                  <>
                    <span style={{ fontSize: '.5em', color: 'var(--ink-2)', marginRight: 4, verticalAlign: '0.18em' }}>$</span>
                    <CountUp to={Math.round(totalNav)} format={(v) => Math.round(v).toLocaleString('en-US')} />
                  </>
                )}
              </div>
            </div>
            <FreshnessChip elementId="portfolio_history" />
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
              <div style={{ fontFamily: 'Fraunces,serif', fontVariationSettings: '"opsz" 96,"wght" 400', fontSize: 30, lineHeight: 1, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"' }}>
                <span style={{ fontSize: '.55em', color: 'var(--ink-2)', marginRight: 2, verticalAlign: '0.18em' }}>$</span>
                <CountUp to={Math.round(a.market_value || a.total_value || 0)} format={(v) => Math.round(v).toLocaleString('en-US')} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, color: 'var(--ink-2)' }}>
                <span>{a.position_count || 0} positions</span>
                <span style={{ fontFeatureSettings: '"tnum"' }}>{a.last_synced_at ? new Date(a.last_synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
              </div>
            </div>
          ))}
        </div>
        {(!posLoading && accountList.length === 0) && (
          <div style={{ marginTop: 32, padding: 32, background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', textAlign: 'center', color: 'var(--ink-2)' }}>
            Sign in to load portfolio. (Insights shows real account balances when authenticated.)
          </div>
        )}
        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          accounts · prices_eod nightly · positions live from Chase / Schwab / IRAs / UTMA imports
        </div>
      </div>
    </div>
  );
}
