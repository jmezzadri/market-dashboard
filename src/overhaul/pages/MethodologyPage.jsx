/* Methodology page — editorial long-form. 8 numbered sections, TOC with
   deep-link anchors, me-formula blocks for math, vendor table, changelog.
   Site-overhaul PR-O9. */

import React, { useEffect } from 'react';

const SECTIONS = [
  { id: 'macro',       title: 'Macro overview' },
  { id: 'tilt',        title: 'Asset Tilt' },
  { id: 'scanner',     title: 'Trading Scanner' },
  { id: 'portfolio',   title: 'Portfolio Insights' },
  { id: 'scenarios',   title: 'Scenario Analysis' },
  { id: 'freshness',   title: 'Data freshness' },
  { id: 'sources',     title: 'Sources & vendors' },
  { id: 'changelog',   title: 'Changelog' },
];

const VENDORS = [
  ['FRED',                    'St. Louis Fed economic data',                       'Free',     '24 indicators'],
  ['Polygon (Massive)',       'Daily prices, splits, dividends, fundamentals',     'Paid',     'Universe master'],
  ['Unusual Whales',          'Options flow, dark pool, insider, congress',        'Paid',     'Scanner facets'],
  ['ICE BofA via FRED',       'Investment-grade & high-yield credit spreads',      'Free',     'Credit family'],
  ['CBOE',                    'VIX, SKEW, put/call',                                'Free',     'Equity vol'],
  ['ISM',                     'Manufacturing & Services PMI',                       'Free',     'Economy'],
  ['FDIC Call Reports',       'Bank balance-sheet unrealized losses',               'Free',     'Bank family'],
  ['Shiller (Yale)',          'CAPE ratio',                                          'Free',     'Equity valuation'],
];

const CHANGELOG = [
  ['2026-05-26', 'Site overhaul — new design system, page chrome, and routing shipped behind ?v=3 flag.'],
  ['2026-05-21', 'Trading Scanner rebuilt — dual-direction, dark pool + options scoring went live.'],
  ['2026-05-11', 'Indicator framework finalized — 36 active indicators across 4 buckets. NAAIM and SPX-vs-200dma retired.'],
  ['2026-05-07', 'Asset Tilt v10 — top OW / bottom UW Home tile structure, IG drilldown wired.'],
  ['2026-04-30', 'v11 Cycle Mechanism Board became the Macro Overview anchor; old composites deprecated.'],
  ['2026-04-28', 'Massive (Polygon) integration phase 1 — universe master replaces UW screener.'],
  ['2026-04-27', 'Scenario Analysis v1 launched, aligned to CCAR US-16 factor panel.'],
];

export default function MethodologyPage() {
  // Scroll-into-view when arriving via deep-link from an indicator drill.
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
            How the <i>engine</i> actually works.
          </h1>
          <p className="mt-deck">
            Every number on this site comes from a public formula. This page
            documents the math behind the macro indicators, the asset tilt
            engine, the trading scanner, and the freshness contract — section
            by section, in plain English with the underlying formulas inline.
          </p>
        </div>
        <nav className="me-toc" aria-label="Methodology table of contents">
          <div className="mt-eyebrow">Contents</div>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      </section>

      <section className="mt-pagesection" style={{ paddingTop: 8, maxWidth: 760, marginLeft: 'var(--mt-pad-page)' }}>
        {/* 1. Macro */}
        <article id="macro" className="me-section">
          <div className="mt-eyebrow">01 · Macro overview</div>
          <h2>What the indicators say.</h2>
          <p>
            The Macro Overview reads 36 indicators in five domains: <b>Rates</b>,{' '}
            <b>Credit</b>, <b>Equities</b>, <b>Money</b>, and the real{' '}
            <b>Economy</b>. Each indicator's current reading is ranked against
            its full history (back to 1996 where the series allows). The
            percentile rank is mapped to a state — <i>calm</i>, <i>elevated</i>,
            or <i>extreme</i> — using direction-aware thresholds.
          </p>
          <h3>Direction-aware state</h3>
          <p>
            Each indicator has a direction flag — high-warns, low-warns, or
            bidirectional. The state thresholds flip with the direction so an
            inverted yield curve at the 5th percentile is "extreme" but a low
            HY-IG spread at the same percentile is "calm".
          </p>
          <div className="me-formula">
{`if direction = "hw" (high warns):
    pct ≥ 85 → extreme; pct ≥ 75 → elevated; else calm

if direction = "lw" (low warns):
    pct ≤ 15 → extreme; pct ≤ 25 → elevated; else calm

if direction = "bw" (bidirectional):
    |pct − 50| ≥ 35 → extreme; ≥ 25 → elevated; else calm`}
          </div>
          <h3>Domain rollup on the regime map</h3>
          <p>
            On the regime canvas, an indicator's x-coordinate is anchored to
            its state (extreme → right, calm → left) and its y-coordinate to
            its domain. Dots in the same (domain, state) bucket are stacked in
            a small grid so they remain individually clickable.
          </p>
        </article>

        {/* 2. Tilt */}
        <article id="tilt" className="me-section">
          <div className="mt-eyebrow">02 · Asset Tilt</div>
          <h2>From regime to allocation.</h2>
          <p>
            The Asset Tilt engine reads the macro regime and produces a target
            allocation across 25 industry groups plus 4 defensive sleeves
            (BIL, TLT, GLD, LQD). The v9 framework is validated against the
            S&amp;P 500 on Sharpe and has shipped to production indefinitely.
          </p>
          <div className="me-formula">
{`target_weight(IG) = base_weight(IG)
                  + Σ factor_loading(IG, factor) × factor_signal
                  + regime_overlay(IG)`}
          </div>
          <p>
            Tilts are reported relative to the S&amp;P 500 sector benchmark.
            A positive tilt on Technology of +6.2% means the engine is
            recommending Tech 6.2 percentage points heavier than the
            benchmark.
          </p>
        </article>

        {/* 3. Scanner */}
        <article id="scanner" className="me-section">
          <div className="mt-eyebrow">03 · Trading Scanner</div>
          <h2>The composite score.</h2>
          <p>
            Each scanner row is scored on a 0–10 scale that reconciles to a
            weighted sum of six component scores. The score math is published
            and surfaced on the drill row of every result.
          </p>
          <div className="me-formula">
{`score(ticker) = Σ (component_score / 5) × weight × 10

weights:
  Technicals  0.25
  Insider     0.20
  Analyst     0.20
  Options vol 0.15
  Congress    0.10
  Dark pool   0.10`}
          </div>
          <p>
            Scoring methodology changed on <b>2026-05-21</b> to incorporate
            dark pool and options flow. Pre-2026-05-21 scores are not
            comparable; the change is documented in the scanner UI's blue
            callout.
          </p>
        </article>

        {/* 4. Portfolio */}
        <article id="portfolio" className="me-section">
          <div className="mt-eyebrow">04 · Portfolio Insights</div>
          <h2>Cost-basis P/L, not just market value.</h2>
          <p>
            Positions are imported from broker CSVs (Chase, Fidelity, Schwab).
            Realized P/L uses the broker's taxable number as canonical;
            wash-sale disallowed losses are preserved in the transaction
            ledger for future economic-P/L overlay but do not affect the
            headline realized number.
          </p>
          <div className="me-formula">
{`unrealized_pl_$ = market_value − cost_basis
unrealized_pl_pct = (market_value − cost_basis) / cost_basis`}
          </div>
        </article>

        {/* 5. Scenarios */}
        <article id="scenarios" className="me-section">
          <div className="mt-eyebrow">05 · Scenario Analysis</div>
          <h2>Eight shocks, one custom builder.</h2>
          <p>
            The scenario engine factor panel uses CCAR US-Domestic 16 (six
            economic variables, four financial-conditions variables, six
            interest-rate variables) translated into the v9 allocation
            engine's native factor set. Eight canned historical scenarios are
            re-anchored against the CCAR panel for consistency.
          </p>
          <p>
            Custom scenarios use a correlated factor-move framework — moving
            one factor automatically nudges the others by their historical
            covariance. Independent factor sliders are not exposed to prevent
            uncalibrated shock combinations.
          </p>
        </article>

        {/* 6. Freshness */}
        <article id="freshness" className="me-section">
          <div className="mt-eyebrow">06 · Data freshness</div>
          <h2>Green or red, never amber.</h2>
          <p>
            Every value on every page renders a freshness chip. Two states:
            green if the value is within its SLA, red if it's past. There's no
            amber — the user wants to know either "fine" or "broken".
          </p>
          <p>
            SLAs are configured per indicator in <code>data_manifest.json</code>{' '}
            and are calendar-aware: a Friday-close daily indicator is not
            "stale" on Sunday night, and a monthly indicator is rendered as
            the period it covers ("Mar 2026") rather than an age ("80d ago").
          </p>
          <div className="me-formula">
{`status = green  if data_as_of within freshness_sla_hours
       = red    if past SLA OR upstream error OR no successful refresh

aggregate status = OR of element status + every dependency status`}
          </div>
        </article>

        {/* 7. Sources */}
        <article id="sources" className="me-section">
          <div className="mt-eyebrow">07 · Sources &amp; vendors</div>
          <h2>Where every number comes from.</h2>
          <p>
            Every indicator and every market data field is registered in the
            data manifest with its vendor, endpoint, license tier, and SLA.
            The vendor list below covers the data flowing through the site
            today.
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

        {/* 8. Changelog */}
        <article id="changelog" className="me-section">
          <div className="mt-eyebrow">08 · Changelog</div>
          <h2>What changed, when.</h2>
          <p>
            Material changes to the engine, the indicator framework, or the
            scoring math are logged here in plain English. Versioned snapshots
            of the locked methodology JSON live in the repo for reproducibility.
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
      </section>
    </div>
  );
}
