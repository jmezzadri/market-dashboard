/* Methodology — rebuilt 2026-05-27 to prototype/pages/methodology.jsx.
   Editorial long-form. 8 numbered sections. TOC anchors. Formula blocks.
   "X indicators" string binds to live count, not hardcoded 27. */

import React, { useEffect } from 'react';
import useIndicators from '../lib/useIndicators';

const SECTIONS = [
  ['macro',     'Macro overview'],
  ['tilt',      'Asset Tilt engine'],
  ['scanner',   'Trading scanner'],
  ['portfolio', 'Portfolio insights'],
  ['scenarios', 'Scenario analysis'],
  ['freshness', 'Data freshness contract'],
  ['sources',   'Data sources & vendors'],
  ['change',    'Changelog'],
];

const VENDORS = [
  ['FRED', 'St. Louis Fed economic data', 'Free', '24 indicators'],
  ['Polygon (Massive)', 'Daily prices, splits, dividends, fundamentals', 'Paid', 'Universe master'],
  ['Unusual Whales', 'Options flow, dark pool, insider, congress', 'Paid', 'Scanner facets'],
  ['ICE BofA via FRED', 'Investment-grade & high-yield credit spreads', 'Free', 'Credit family'],
  ['CBOE', 'VIX, SKEW, put/call', 'Free', 'Equity vol'],
  ['ISM', 'Manufacturing & Services PMI', 'Free', 'Economy'],
  ['FDIC Call Reports', 'Bank balance-sheet unrealized losses', 'Free', 'Bank family'],
  ['Shiller (Yale)', 'CAPE ratio', 'Free', 'Equity valuation'],
];

const CHANGELOG = [
  ['2026-05-27', 'Site overhaul — prototype-faithful rebuild of all 9 pages, shared components, regime hook.'],
  ['2026-05-21', 'Trading Scanner rebuilt — dual-direction, dark pool + options scoring went live.'],
  ['2026-05-11', 'Indicator framework finalized. NAAIM and SPX-vs-200dma retired.'],
  ['2026-04-30', 'v11 Cycle Mechanism Board became the Macro Overview anchor; old composites deprecated.'],
  ['2026-04-28', 'Massive (Polygon) integration phase 1 — universe master replaces UW screener.'],
  ['2026-04-27', 'Scenario Analysis v1 launched, aligned to CCAR US-16 factor panel.'],
];

export default function MethodologyPage() {
  const { active } = useIndicators();
  const liveCount = active.length || '—';

  useEffect(() => {
    const hash = window.location.hash?.slice(1);
    if (hash) {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Methodology</div>
          <h1 className="mt-h1">
            How MacroTilt <i>actually</i> works.
          </h1>
          <p className="mt-deck">
            Six sections. Plain English. Every page on the site links here for the underlying logic.
            The full formula sheet and data vendor table are at the bottom.
          </p>
        </div>
      </section>

      <section className="mt-pagesection">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '260px 1fr',
            gap: 32,
            alignItems: 'flex-start',
          }}
        >
          <nav className="me-toc">
            <div className="mt-eyebrow">Sections</div>
            <ol>
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`}>{label}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div>
            <article id="macro" className="me-section">
              <div className="mt-eyebrow">01 · Macro overview</div>
              <h2>Five-domain backdrop · {liveCount} indicators</h2>
              <p>
                Every indicator on MacroTilt is classified into one of five domains:{' '}
                <b>Rates</b>, <b>Credit</b>, <b>Equities</b>, <b>Money &amp; Banking</b>,
                and the real <b>Economy</b>. Within a domain, each indicator has a{' '}
                <b>type</b> — Lead, Coincident, or Lag — based on its empirical timing
                vs. the business cycle.
              </p>
              <p>
                <b>State</b> (Calm / Elevated / Extreme) is set by where today's reading
                sits in the 5-year percentile distribution of the same indicator. Cut-points
                are domain-specific; for most two-sided indicators we use{' '}
                <code>[10, 25, 75, 90]</code> percentiles. The map's spatial placement uses{' '}
                <i>state</i>, not raw percentile, so red dots always live in the stress quadrant
                regardless of whether the extreme is high or low.
              </p>
              <div className="me-formula">
{`state(today) = bin(percentile_5y(value), [10, 25, 75, 90])
stress_x = state ∈ {extreme: +0.62, elevated: +0.18, calm: −0.55}
regime_y = domain_anchor ∈ {Rates: +0.40, Equities: +0.10, Credit: −0.05, Money: −0.25, Economy: −0.42}`}
              </div>
            </article>

            <article id="tilt" className="me-section">
              <div className="mt-eyebrow">02 · Asset Tilt engine</div>
              <h2>Two axes set the regime · equity % &amp; sector tilts</h2>
              <p>
                Bond-market volatility (<b>MOVE</b>) sets the stress axis. The 3-month
                change in 10-year Treasury yield (<b>3M Δ 10y</b>) sets the yield-regime
                axis. Together they define a 3×3 grid (Risk On / Watch / Risk Off ×
                Inflationary / Neutral / Deflationary). The cell determines equity %, the
                defensive sleeve composition, and the within-equity sector tilts.
              </p>
              <div className="me-formula">
{`stress_signal = MOVE
stress_zone   = MOVE < 116 → Risk On · 116 ≤ MOVE < 124 → Watch · MOVE ≥ 124 → Risk Off
yield_regime  = 3M Δ 10y ≥ +32 bp → Inflationary · ≤ −11 bp → Deflationary · else Neutral
equity_pct    = lookup_grid(stress_zone, yield_regime)
sleeve_mix    = inflationary ? 12% Au / 9% TLT / 4% Cash : 4% Au / 16% TLT / 5% Cash`}
              </div>
              <p>
                Within the equity bucket, six factor reads drive sector and industry-group
                tilts: credit OAS, valuation z-score, breadth, growth, liquidity, and an
                earnings-revision z. Each sector's active weight is a weighted sum of those
                factors, clipped to [−4%, +6%] vs. its cap weight.
              </p>
              <p>
                <b>Validated 1986 → 2026</b> over 2,056 weeks. <b>CAGR 11.93%</b> vs SPY
                11.16%, Sharpe 0.61 vs 0.47, max drawdown −32.1% vs −54.6%. Rebalanced
                weekly; defensive sleeve fires only when stress crosses Watch.
              </p>
            </article>

            <article id="scanner" className="me-section">
              <div className="mt-eyebrow">03 · Trading scanner</div>
              <h2>Five signals · one MacroTilt Score (0–5 today; ceiling 10 once backtested)</h2>
              <p>
                Each ticker is scored on six components, each on a 0–5 scale. The headline
                score is the weighted sum. Weights are calibrated to historical alpha
                contribution.
              </p>
              <div className="me-formula">
{`Technicals × 0.25 · Insider × 0.20 · Analyst × 0.20
Options vol × 0.15 · Congress × 0.10 · Dark pool × 0.10
MacroTilt Score = Σ (component_score / 5) × weight × 5     (live, 0–5 scale)`}
              </div>
            </article>

            <article id="portfolio" className="me-section">
              <div className="mt-eyebrow">04 · Portfolio insights</div>
              <h2>Cost-basis P/L, not just market value</h2>
              <p>
                Positions are imported from broker CSVs (Chase, Fidelity, Schwab). Realized
                P/L uses the broker's taxable number as canonical; wash-sale disallowed losses
                are preserved in the transaction ledger for future economic-P/L overlay but
                do not affect the headline realized number.
              </p>
              <div className="me-formula">
{`unrealized_pl_$ = market_value − cost_basis
unrealized_pl_pct = (market_value − cost_basis) / cost_basis`}
              </div>
            </article>

            <article id="scenarios" className="me-section">
              <div className="mt-eyebrow">05 · Scenario analysis</div>
              <h2>Eight shocks, one custom builder</h2>
              <p>
                The scenario engine factor panel uses CCAR US-Domestic 16 (six economic
                variables, four financial-conditions variables, six interest-rate variables)
                translated into the v9 allocation engine's native factor set. Eight canned
                historical scenarios are re-anchored against the CCAR panel.
              </p>
              <p>
                Custom scenarios use a correlated factor-move framework — moving one factor
                automatically nudges the others by their historical covariance. Independent
                factor sliders are not exposed to prevent uncalibrated shock combinations.
              </p>
            </article>

            <article id="freshness" className="me-section">
              <div className="mt-eyebrow">06 · Data freshness contract</div>
              <h2>Green or red, never amber</h2>
              <p>
                Every value on every page renders a freshness chip. Two states: green if
                within SLA, red if past. There's no amber — you want to know either "fine"
                or "broken".
              </p>
              <p>
                SLAs are configured per element in <code>data_manifest.json</code> and are
                calendar-aware: a Friday-close daily indicator is not "stale" on Sunday
                night, and a monthly indicator is rendered as the period it covers
                ("Mar 2026") rather than an age ("80d ago").
              </p>
              <div className="me-formula">
{`status = green  if data_as_of within freshness_sla_hours
       = red    if past SLA OR upstream error OR no successful refresh

aggregate status = OR of element status + every dependency status`}
              </div>
            </article>

            <article id="sources" className="me-section">
              <div className="mt-eyebrow">07 · Data sources &amp; vendors</div>
              <h2>Where every number comes from</h2>
              <p>
                Every indicator and every market-data field is registered in the data
                manifest with its vendor, endpoint, license tier, and SLA.
              </p>
              <table className="me-vendortbl">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>What it covers</th>
                    <th>Tier</th>
                    <th>Where it shows up</th>
                  </tr>
                </thead>
                <tbody>
                  {VENDORS.map(([v, c, t, w]) => (
                    <tr key={v}>
                      <td><b>{v}</b></td>
                      <td>{c}</td>
                      <td>{t}</td>
                      <td>{w}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

            <article id="change" className="me-section">
              <div className="mt-eyebrow">08 · Changelog</div>
              <h2>What changed, when</h2>
              <p>
                Material changes to the engine, the indicator framework, or the scoring
                math are logged here in plain English.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {CHANGELOG.map(([date, note]) => (
                  <li
                    key={date}
                    style={{
                      display: 'flex',
                      gap: 16,
                      padding: '10px 0',
                      borderBottom: '1px solid var(--mt-line-0)',
                      fontSize: 14,
                      color: 'var(--mt-ink-1)',
                    }}
                  >
                    <span
                      className="num"
                      style={{
                        minWidth: 100,
                        color: 'var(--mt-ink-2)',
                        fontFamily: 'var(--mt-font-mono)',
                        fontSize: 12,
                      }}
                    >
                      {date}
                    </span>
                    <span style={{ flex: 1 }}>{note}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
