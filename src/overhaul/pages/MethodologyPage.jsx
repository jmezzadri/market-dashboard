/* Methodology — refactored 2026-05-27 per Joe Path-A directive.

   Catalog violations resolved (5 of 5):
   1. CHANGELOG hardcoded rows → moved to /methodology_changelog.json
      (curated, owned by Senior Quant + Data Steward, registered in the
      manifest as site-methodology_changelog-static).
   2. Backtest paragraph numbers (CAGR 11.93%, Sharpe 0.61, Max DD
      −32.1%, 2056 weeks, vs-SPY 11.16%/0.47/−54.6%) → derived from
      /macrotilt_engine_backtest.json (validation.asset_tilt and
      validation.spy and validation.n_weeks).
   3. "Eight canned historical scenarios" → bound to the live count
      from /scenario_definitions.json.
   4. "Six sections. Plain English." → bound to SECTIONS.length (now 8).
   5. VENDORS table → kept as labeled DESIGN CONFIG with explicit
      Path-A exception #1 note (Joe: "Optional: derive from
      data_manifest.json grouped by source_vendor, but content is the
      same."). Content == manifest content.

   Style refactor (zero inline style props):
   - Body uses .me-body wrapper (max-width 980, centered).
   - Each article uses prototype .me-section (80/1fr grid) with .me-num
     left-column display number, .me-h2 right-column display title,
     .me-body-p paragraphs, .me-links button rows.
   - TOC uses .me-toc (full-width card at top, no inline grid sidebar).
   - Changelog uses .me-changelog list (prototype grid-templated).
   - Vendor table uses .me-vendors. */

import React, { useEffect, useState } from 'react';
import useIndicators from '../lib/useIndicators';
import FreshnessChip from '../components/FreshnessChip';

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

/* Path-A exception #1 (Joe 2026-05-27): vendor table content is the
   same whether read literally here or derived from the manifest, so we
   keep this labeled list as design copy. If/when a vendor changes,
   update both this constant AND the relevant manifest entries in the
   same PR (the project Data Steward sign-off rule catches this). */
const VENDORS = [
  ['FRED',              'St. Louis Fed economic data',                  'Free', 'Macro indicator family'],
  ['Polygon (Massive)', 'Daily prices, splits, dividends, fundamentals','Paid', 'Universe master, ticker reference'],
  ['Unusual Whales',    'Options flow, dark pool, insider, congress',   'Paid', 'Scanner facets, ticker events'],
  ['ICE BofA via FRED', 'Investment-grade & high-yield credit spreads', 'Free', 'Credit family'],
  ['CBOE',              'VIX, SKEW, put/call',                          'Free', 'Equity volatility family'],
  ['ISM',               'Manufacturing & Services PMI',                 'Free', 'Economy family'],
  ['FDIC Call Reports', 'Bank balance-sheet unrealized losses',         'Free', 'Bank family'],
  ['Shiller (Yale)',    'CAPE ratio',                                   'Free', 'Equity valuation family'],
];

function fmtPct(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v).toFixed(digits)}%`;
}
function fmtPctSigned(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = (v * 100).toFixed(digits);
  return `${s}%`;
}

export default function MethodologyPage() {
  const { active } = useIndicators();
  const liveIndicatorCount = active.length || '—';

  const [backtest, setBacktest] = useState(null);
  const [scenarioCount, setScenarioCount] = useState(null);
  const [changelog, setChangelog] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/macrotilt_engine_backtest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setBacktest(j); })
      .catch(() => {});
    fetch('/scenario_definitions.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && Array.isArray(j?.scenarios)) setScenarioCount(j.scenarios.length); })
      .catch(() => {});
    fetch('/methodology_changelog.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && Array.isArray(j?.entries)) setChangelog(j.entries); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const hash = window.location.hash?.slice(1);
    if (hash) {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const at = backtest?.validation?.asset_tilt;
  const spy = backtest?.validation?.spy;
  const nWeeks = backtest?.validation?.n_weeks;
  // Backtest values render em-dash when the backtest file fails to load —
  // never a hardcoded number. FreshnessChip on the section reports staleness.
  const cagrEngine = at ? fmtPct(at.cagr, 2) : '—';
  const cagrSpy   = spy ? fmtPct(spy.cagr, 2) : '—';
  const sharpeEng = at ? at.sharpe.toFixed(2) : '—';
  const sharpeSpy = spy ? spy.sharpe.toFixed(2) : '—';
  const ddEng     = at ? fmtPctSigned(at.max_drawdown, 1) : '—';
  const ddSpy     = spy ? fmtPctSigned(spy.max_drawdown, 1) : '—';
  const validatedWeeks = nWeeks ? nWeeks.toLocaleString() : '—';
  const validatedRange = backtest?.calibration_label || '—';

  const scenariosLiteral = scenarioCount != null ? scenarioCount : '—';
  const sectionsLiteral  = SECTIONS.length;

  return (
    <div className="mt-pagebody me-body mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Methodology</div>
          <h1 className="mt-h1">
            How MacroTilt <i>actually</i> works.
          </h1>
          <p className="mt-deck">
            {sectionsLiteral} sections. Plain English. Every page on the site
            links here for the underlying logic. The full formula sheet and
            data vendor table are at the bottom.
          </p>
        </div>
      </section>

      <section className="mt-pagesection">
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

        {/* 01 — Macro overview */}
        <article id="macro" className="me-section">
          <div className="me-num">01</div>
          <div>
            <div className="mt-eyebrow">Macro overview</div>
            <h2 className="me-h2">Five-domain backdrop · {liveIndicatorCount} indicators</h2>
            <p className="me-body-p">
              Every indicator on MacroTilt is classified into one of five domains: <b>Rates</b>, <b>Credit</b>,
              <b> Equities</b>, <b>Money &amp; Banking</b>, and the real <b>Economy</b>. Within a domain, each
              indicator has a <b>type</b> — Lead, Coincident, or Lag — based on its empirical timing vs.
              the business cycle.
            </p>
            <p className="me-body-p">
              <b>State</b> (Calm / Elevated / Extreme) is set by where today's reading sits in the 5-year
              percentile distribution of the same indicator. Cut-points are domain-specific; for most
              two-sided indicators we use <code>[10, 25, 75, 90]</code> percentiles. The map's spatial
              placement uses <i>state</i>, not raw percentile, so red dots always live in the stress quadrant
              regardless of whether the extreme is high or low.
            </p>
            <div className="me-formula">
              state(today) = bin(percentile_5y(value), [10, 25, 75, 90])<br />
              stress_x  = state ∈ {`{extreme: +0.62, elevated: +0.18, calm: −0.55}`} + jitter<br />
              regime_y  = domain_anchor ∈ {`{Rates: +0.40, Equities: +0.10, Credit: −0.05, Money: −0.25, Economy: −0.42}`}
            </div>
          </div>
        </article>

        {/* 02 — Asset Tilt */}
        <article id="tilt" className="me-section">
          <div className="me-num">02</div>
          <div>
            <div className="mt-eyebrow">Asset Tilt engine</div>
            <h2 className="me-h2">Two axes set the regime · equity % &amp; sector tilts</h2>
            <p className="me-body-p">
              Bond-market volatility (<b>MOVE</b>) sets the stress axis. The 3-month change in 10-year
              Treasury yield (<b>3M Δ 10y</b>) sets the yield-regime axis. Together they define a 3×3 grid
              (Risk On / Watch / Risk Off × Inflationary / Neutral / Deflationary). The cell determines
              equity %, the defensive sleeve composition, and the within-equity sector tilts.
            </p>
            <div className="me-formula">
              stress_signal = MOVE<br />
              stress_zone   = MOVE &lt; 116 → Risk On · 116 ≤ MOVE &lt; 124 → Watch · MOVE ≥ 124 → Risk Off<br />
              yield_regime  = 3M Δ 10y ≥ +32 bp → Inflationary · ≤ −11 bp → Deflationary · else Neutral<br />
              equity_pct    = lookup_grid(stress_zone, yield_regime)<br />
              sleeve_mix    = inflationary ? 12% Au / 9% TLT / 4% Cash : 4% Au / 16% TLT / 5% Cash (only when stress ≥ Watch)
            </div>
            <p className="me-body-p">
              Within the equity bucket, six factor reads drive sector and industry-group tilts: credit OAS,
              valuation z-score, breadth, growth, liquidity, and an earnings-revision z. Each sector's
              active weight is a weighted sum of those factors, clipped to [−4%, +6%] vs. its cap weight.
            </p>
            <p className="me-body-p">
              <b>Validated {validatedRange}</b> over <b className="num">{validatedWeeks}</b> weeks.{' '}
              <b>CAGR {cagrEngine}</b> vs SPY {cagrSpy}, Sharpe {sharpeEng} vs {sharpeSpy},
              max drawdown {ddEng} vs {ddSpy}. Rebalanced weekly; defensive sleeve fires only when stress
              crosses Watch.{' '}
              <FreshnessChip elementId="cycle-mechanism-board-daily" variant="dot" />
            </p>
          </div>
        </article>

        {/* 03 — Scanner */}
        <article id="scanner" className="me-section">
          <div className="me-num">03</div>
          <div>
            <div className="mt-eyebrow">Trading scanner</div>
            <h2 className="me-h2">Five signals · one MacroTilt Score</h2>
            <p className="me-body-p">
              Each ticker is scored on six components, each on a 0–5 scale. The headline score is the
              weighted sum on the same 0–5 scale. Weights are calibrated to historical alpha contribution.
            </p>
            <div className="me-formula">
              Technicals × 0.25 · Insider × 0.20 · Analyst × 0.20<br />
              Options vol × 0.15 · Congress × 0.10 · Dark pool × 0.10<br />
              MacroTilt Score = Σ (component_score / 5) × weight × 5
            </div>
            <p className="me-body-p">
              The dark-pool and options layers are live but not yet backtested — treat them as developing
              signals. <b>Universe scan</b> runs once per trading day. <b>Event firehoses</b> (insider Form
              4, congressional disclosures, dark-pool prints, news) refresh 3× daily.
            </p>
          </div>
        </article>

        {/* 04 — Portfolio */}
        <article id="portfolio" className="me-section">
          <div className="me-num">04</div>
          <div>
            <div className="mt-eyebrow">Portfolio insights</div>
            <h2 className="me-h2">Cost-basis P/L, not just market value</h2>
            <p className="me-body-p">
              Positions are imported from broker CSVs (Chase, Fidelity, Schwab) or wired via Plaid (coming
              soon). Realized P/L uses the broker's taxable number as canonical; wash-sale disallowed losses
              are preserved in the transaction ledger for future economic-P/L overlay but do not affect the
              headline realized number.
            </p>
            <div className="me-formula">
              unrealized_pl_$   = market_value − cost_basis<br />
              unrealized_pl_pct = (market_value − cost_basis) / cost_basis
            </div>
          </div>
        </article>

        {/* 05 — Scenarios */}
        <article id="scenarios" className="me-section">
          <div className="me-num">05</div>
          <div>
            <div className="mt-eyebrow">Scenario analysis</div>
            <h2 className="me-h2">{scenariosLiteral} historical · plus 4-factor custom shocks</h2>
            <p className="me-body-p">
              The {scenariosLiteral} canned scenarios are reference facts about historical stress windows
              (Black Monday '87 through AI Correction '24). Each is a fixed historical window with
              frozen factor moves replayed against today's portfolio.
            </p>
            <p className="me-body-p">
              <b>Custom shocks</b> use a correlated factor-move framework — moving one factor automatically
              nudges the others by their historical covariance. Independent factor sliders are not exposed
              to prevent uncalibrated shock combinations.
            </p>
          </div>
        </article>

        {/* 06 — Freshness */}
        <article id="freshness" className="me-section">
          <div className="me-num">06</div>
          <div>
            <div className="mt-eyebrow">Data freshness contract</div>
            <h2 className="me-h2">Why every value has a chip</h2>
            <p className="me-body-p">
              Every value, chart, gauge and table on MacroTilt renders a <b>freshness chip</b> — green if
              the underlying data is within SLA, red if stale. Aggregates roll up automatically: a single
              stale dependency flips the parent chip red and the tooltip names the culprit. No surface
              ever renders a hard-coded freshness string.
            </p>
            <div className="me-formula">
              chip(element) = green if last_good_at(element) within SLA(element) ∧ all_deps_green<br />
              chip(element) = red   otherwise<br />
              tooltip(red)  = "Data is stale — last updated {`{ts}`} ({`{age}`} past due) · {`{root cause}`}"
            </div>
            <p className="me-body-p">
              SLAs and the manifest of every element are stored in <code>data_manifest.json</code>; live
              status is tracked in <code>pipeline_health</code>. The chip component reads both via{' '}
              <code>useFreshness(elementId)</code>.
            </p>
          </div>
        </article>

        {/* 07 — Sources */}
        <article id="sources" className="me-section">
          <div className="me-num">07</div>
          <div>
            <div className="mt-eyebrow">Data sources &amp; vendors</div>
            <h2 className="me-h2">Where every number comes from</h2>
            <p className="me-body-p">
              Every indicator and every market-data field is registered in the data manifest with its
              vendor, endpoint, license tier, and SLA.
            </p>
            <table className="me-vendors">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>What we ingest</th>
                  <th>License</th>
                  <th>Where it shows up</th>
                </tr>
              </thead>
              <tbody>
                {VENDORS.map(([v, c, t, w]) => (
                  <tr key={v}>
                    <td>{v}</td>
                    <td>{c}</td>
                    <td>{t}</td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        {/* 08 — Changelog */}
        <article id="change" className="me-section">
          <div className="me-num">08</div>
          <div>
            <div className="mt-eyebrow">Changelog</div>
            <h2 className="me-h2">What changed, when</h2>
            <p className="me-body-p">
              Material changes to the engine, indicator framework, or scoring math.{' '}
              <FreshnessChip elementId="site-methodology_changelog-static" variant="dot" />
            </p>
            {changelog === null ? (
              <ul className="me-changelog">
                <li><b className="num">—</b><span>Loading changelog…</span></li>
              </ul>
            ) : (
              <ul className="me-changelog">
                {changelog.map((c) => (
                  <li key={c.date}>
                    <b className="num">{c.date}</b>
                    <span>{c.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
