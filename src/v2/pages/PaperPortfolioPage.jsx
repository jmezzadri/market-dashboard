// PaperPortfolioPage — under construction.
//
// 2026-08-13: the Conviction Events book was RETIRED and all automated trading
// halted (PR #1444). Why, in one line: it selected positions on a single input
// — the dollar value of aggregated insider buying — with no test of WHO was
// buying, how large the purchase was RELATIVE TO THAT PERSON'S EXISTING STAKE,
// or what condition the business was in.
//
// What that produced, from the book's own last day (2026-08-12):
//   * 13 of 13 positions came from that one signal, all opened within 2 days.
//   * A 10% beneficial owner adding 4.3% to an existing stake (PRTA) was sized
//     identically to a CEO opening a $2.0M position from zero (FBIN).
//   * A director's $666k purchase against his own $55.7M holding (BWFG, 1.2%)
//     cleared the same bar.
//   * PRCT and HUBS were both bought days after falling on earnings; PRCT was
//     under an active securities class action. Those two names were 69% of the
//     -$22,745 loss on the final day.
//
// The replacement is a multi-factor model (quality + momentum + low risk) with
// hard exclusion screens and a trend-based drawdown filter. It does not go live
// until the stock-level backtest is complete and signed off.
//
// The full previous implementation (1,359 lines: NAV path, positions table,
// event ledger, freshness chips) is preserved in git history — restore with
//   git log --oneline -- src/v2/pages/PaperPortfolioPage.jsx
//   git show <sha>^:src/v2/pages/PaperPortfolioPage.jsx

import React from 'react';
import { Link } from 'react-router-dom';

export default function PaperPortfolioPage({ onOpenTicker }) {  // eslint-disable-line no-unused-vars
  return (
    <div className="cream-page paper-under-construction">
      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: '96px 24px 120px',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            opacity: 0.55,
            marginBottom: 20,
          }}
        >
          Paper Portfolio
        </div>

        <h1
          style={{
            fontSize: 'clamp(34px, 5vw, 48px)',
            lineHeight: 1.1,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 24px',
          }}
        >
          Under construction
        </h1>

        <p style={{ fontSize: 18, lineHeight: 1.65, opacity: 0.8, margin: '0 0 32px' }}>
          The Conviction Events book has been retired. We are rebuilding the
          paper portfolio from the ground up, and no strategy is trading in the
          meantime.
        </p>

        <div
          style={{
            borderLeft: '2px solid rgba(0,0,0,0.16)',
            paddingLeft: 22,
            margin: '0 0 44px',
          }}
        >
          <p style={{ fontSize: 15, lineHeight: 1.7, opacity: 0.72, margin: 0 }}>
            The previous book bought a stock whenever insiders purchased more
            than a set dollar amount of it. That single test asked nothing about
            who was buying, how meaningful the purchase was to them, or how the
            business was performing — so a large shareholder rebalancing counted
            the same as a chief executive buying with conviction. The
            replacement scores every company on profitability, price trend and
            risk, screens out accounting and litigation red flags, and reduces
            market exposure when the broad trend breaks. It will not run until
            it has been tested against a decade of history that includes
            companies which failed.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 24,
            borderTop: '1px solid rgba(0,0,0,0.10)',
            paddingTop: 28,
            marginBottom: 48,
          }}
        >
          {[
            ['Automated trading', 'Halted'],
            ['Open positions', 'None'],
            ['Status', 'Rebuild in progress'],
          ].map(([k, v]) => (
            <div key={k}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  opacity: 0.5,
                  marginBottom: 7,
                }}
              >
                {k}
              </div>
              <div style={{ fontSize: 15 }}>{v}</div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 14, opacity: 0.6, margin: 0 }}>
          The rest of the site is unaffected —{' '}
          <Link to="/macro" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Macro
          </Link>
          ,{' '}
          <Link to="/portfolio-lab" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Portfolio Lab
          </Link>{' '}
          and{' '}
          <Link to="/methodology" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Methodology
          </Link>{' '}
          remain live.
        </p>
      </div>
    </div>
  );
}
