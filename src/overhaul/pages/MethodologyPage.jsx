/* Methodology — refactored 2026-05-27 per Joe Path-A directive.

   Catalog violations resolved (5 of 5):
   1. CHANGELOG hardcoded rows → moved to /methodology_changelog.json
      (curated, owned by Senior Quant + Data Steward, registered in the
      manifest as site-methodology_changelog-static).
   2. Backtest paragraph numbers (CAGR 11.93%, Sharpe 0.61, Max DD
      −32.1%, 2056 weeks, vs-SPY 11.16%/0.47/−54.6%) → derived from
      /macrotilt_engine_backtest.json (validation.asset_tilt and
      validation.spy and validation.n_weeks).
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
   - TOC is a sticky left-rail nav (.me-toc.me-rail) inside a 2-col
     .me-layout grid; scroll-spy highlights the active section. Collapses
     to a stacked card above the content at <=900px (see pages.css).
   - Changelog uses .me-changelog list (prototype grid-templated).
   - Vendor table uses .me-vendors. */

import React, { useEffect, useMemo, useState } from 'react';
import useIndicators from '../lib/useIndicators';
import FreshnessChip from '../components/FreshnessChip';

const SECTIONS = [
  ['macro',     'Macro overview'],
  ['engine',    'Engine read'],
  ['scanner',   'Trading scanner'],
  ['portfolio', 'Portfolio insights'],
  ['freshness', 'Data freshness contract'],
  ['sources',   'Data sources & vendors'],
  ['change',    'Changelog'],
];

/* 2026-06-16 (Joe directive: nothing hardcoded): the vendor table is DERIVED
   from public/data_manifest.json (the single source of truth) at runtime, so it
   can never drift. Add or change a feed's source_vendor in the manifest and this
   table updates itself. Plain-English column values come from the manifest's
   category + consumer-surface fields, never raw element ids. */
const TAB_LABEL = { home: 'Home', overview: 'Macro Overview', indicators: 'All Indicators',
  readme: 'Methodology', methodology: 'Methodology', scanner: 'Trading Scanner',
  paper: 'Paper Portfolio', ticker: 'Ticker', data: 'Admin / Data' };
const CAT_LABEL = { indicator: 'Indicators', market: 'Market data', equity: 'Equity data',
  portfolio: 'Portfolio', news: 'News',
  commentary: 'Commentary', ops: 'Operations' };

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
  const [changelog, setChangelog] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [activeId, setActiveId] = useState(SECTIONS[0][0]);

  // Vendor table derived from the manifest (single source of truth) — never hardcoded.
  const vendorRows = useMemo(() => {
    const els = manifest?.elements || [];
    const by = {};
    for (const e of els) {
      const v = (e.source_vendor || '').trim();
      if (!v) continue;
      if (!by[v]) by[v] = { paid: false, cats: new Set(), tabs: new Set() };
      if (String(e.license_tier || '').toLowerCase().startsWith('paid')) by[v].paid = true;
      if (e.category) by[v].cats.add(CAT_LABEL[e.category] || e.category);
      (e.consumer_surfaces || []).forEach((su) => { if (su && su.tab) by[v].tabs.add(TAB_LABEL[su.tab] || su.tab); });
    }
    return Object.keys(by).sort().map((v) => [
      v,
      [...by[v].cats].join(', ') || '—',
      by[v].paid ? 'Paid' : 'Free',
      [...by[v].tabs].sort().join(', ') || '—',
    ]);
  }, [manifest]);

  useEffect(() => {
    let cancelled = false;
    fetch('/macrotilt_engine_backtest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setBacktest(j); })
      .catch(() => {});
    fetch('/methodology_changelog.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && Array.isArray(j?.entries)) setChangelog(j.entries); })
      .catch(() => {});
    fetch('/data_manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setManifest(j); })
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

  // Scroll-spy: highlight the left-rail link for whichever section is in view.
  useEffect(() => {
    const ids = SECTIONS.map(([id]) => id);
    const els = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (!els.length || typeof IntersectionObserver === 'undefined') return;

    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
          else visible.delete(e.target.id);
        });
        // Pick the section nearest the top of the viewport that is on screen.
        let best = null;
        for (const id of ids) {
          if (visible.has(id)) { best = id; break; }
        }
        if (best) setActiveId(best);
      },
      // Trigger when a section crosses the upper third of the viewport.
      { rootMargin: '-80px 0px -65% 0px', threshold: [0, 0.1, 0.5, 1] }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
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

  const sectionsLiteral  = SECTIONS.length;

  return (
    <div className="home-v11 glass-page mt-pagebody me-body mt-fade">
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
       <div className="me-layout">
        <nav className="me-toc me-rail" aria-label="Sections on this page">
          <div className="mt-eyebrow">Sections</div>
          <ol>
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className={activeId === id ? 'is-active' : undefined}
                  aria-current={activeId === id ? 'true' : undefined}
                >
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="me-content">
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
              <b>State</b> (Calm / Elevated / Extreme) is set by where today's reading sits in the
              indicator's own <b>trailing 3-year</b> percentile distribution — the same window the
              positioning signals use. Cut-points depend on which tail of the indicator is unhealthy:
              high-warns indicators go Elevated at the 75th percentile and Extreme at the 85th;
              low-warns indicators go Elevated at the 25th and Extreme at the 15th; two-sided
              indicators warn at both ends. The detail chart shades these same amber/red zones, so
              the pill and the chart always agree.
            </p>
            <div className="me-formula">
              state(today) = bin(percentile_3y(value); high-warns [75, 85] · low-warns [25, 15] · two-sided both)<br />
              stress_x  = state ∈ {`{extreme: +0.62, elevated: +0.18, calm: −0.55}`} + jitter<br />
              regime_y  = domain_anchor ∈ {`{Rates: +0.40, Equities: +0.10, Credit: −0.05, Money: −0.25, Economy: −0.42}`}
            </div>
          </div>
        </article>

        {/* 02 — Engine read */}
        <article id="engine" className="me-section">
          <div className="me-num">02</div>
          <div>
            <div className="mt-eyebrow">Engine read</div>
            <h2 className="me-h2">Two axes set the regime · stress &amp; yield</h2>
            <p className="me-body-p">
              Bond-market volatility (<b>MOVE</b>) sets the stress axis. The 3-month change in 10-year
              Treasury yield (<b>3M Δ 10y</b>) sets the yield-regime axis. Together they define a 3×3 grid
              (Risk On / Watch / Risk Off × Inflationary / Neutral / Deflationary). The cell sets the
              equity-vs-defensive read and the defensive sleeve composition.
            </p>
            <div className="me-formula">
              stress_signal = MOVE<br />
              stress_zone   = MOVE &lt; 116 → Risk On · 116 ≤ MOVE &lt; 124 → Watch · MOVE ≥ 124 → Risk Off<br />
              yield_regime  = 3M Δ 10y ≥ +32 bp → Inflationary · ≤ −11 bp → Deflationary · else Neutral<br />
              equity_pct    = lookup_grid(stress_zone, yield_regime)<br />
              sleeve_mix    = inflationary ? 12% Au / 9% TLT / 4% Cash : 4% Au / 16% TLT / 5% Cash (only when stress ≥ Watch)
            </div>
            <p className="me-body-p">
              <b>Validated {validatedRange}</b> over <b className="num">{validatedWeeks}</b> weeks.{' '}
              <b>CAGR {cagrEngine}</b> vs SPY {cagrSpy}, Sharpe {sharpeEng} vs {sharpeSpy},
              max drawdown {ddEng} vs {ddSpy}. The defensive sleeve fires only when stress crosses Watch.{' '}
              <FreshnessChip elementId="indicator-move-daily" variant="dot" />
            </p>
          </div>
        </article>

        {/* 03 — Scanner */}
        <article id="scanner" className="me-section">
          <div className="me-num">03</div>
          <div>
            <div className="mt-eyebrow">Trading scanner</div>
            <h2 className="me-h2">Four signals · one MacroTilt Score (0–10)</h2>
            <p className="me-body-p">
              Each ticker earns points from four inputs. They are added together — not weighted — into a
              single score from 0 to 10. A name needs at least 3 points to make the list.
            </p>
            <div className="me-formula">
              Insider (up to +4) + Technicals (+1 / −2) + Options shock (up to +4) + Dark pool (up to +2)<br />
              MacroTilt Score = the sum, capped at 10
            </div>
            <p className="me-body-p">
              <b>Insider</b> fires on open-market buys in the last 30 days — a C-suite officer lifting their
              own stake ≥10% (≥$100k), combined buying ≥0.05% of the company, or 3+ different insiders —
              capped at +4 and faded with age. <b>Technicals</b> add +1 above the 200-day line (−2 below) and
              −2 if the 14-day RSI is overbought. <b>Options shock</b> rewards an unusual surge in call buying,
              and <b>dark pool</b> rewards large prints near the day's average price. <b>Universe scan</b> runs
              once per trading day; <b>event firehoses</b> (insider Form 4, dark-pool prints, options, news)
              refresh 3× daily.
            </p>
            <p>
              Two context columns sit alongside the score and do not enter it: <b>Short interest</b> is the
              FINRA bi-monthly short position as a percent of shares outstanding (with days-to-cover, the
              daily short-volume ratio, and the annualized cost to borrow in the drill-down), and{' '}
              <b>Options flow</b> is the net call-minus-put premium across Unusual Whales flow alerts in the
              trailing 30-day window, with the share of premium printed at the ask and the sweep count.
              Both refresh each weekday morning (06:00 / 06:40 ET).
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

        {/* 05 — Freshness */}
        <article id="freshness" className="me-section">
          <div className="me-num">05</div>
          <div>
            <div className="mt-eyebrow">Data freshness contract</div>
            <h2 className="me-h2">When everything refreshes, and how you can tell</h2>
            <p className="me-body-p">
              Every value, chart, gauge and table on MacroTilt sits next to a <b>freshness chip</b>. The
              chip grades off the <b>last successful pull</b> — the last time the job that feeds it ran —
              measured against a target sized to how often that job runs plus a grace window. Green means
              the job pulled on schedule; red means it has missed its window or errored. The grade is not
              the age of the data: a monthly series whose latest reading is weeks old still reads green as
              long as the daily job that fetches it keeps running. Each chip shows five things — the
              source, how often it updates, the data's own as-of date, the job's last pull, and the target
              after which it turns red. When a section depends on multiple inputs, the chip rolls up: if
              any input's job has stalled, the section's chip turns red and names it.
            </p>
            <p className="me-body-p">
              The daily rebalance pipeline runs Tuesday through Saturday morning, after Polygon's full
              overnight price batch lands (the batch finishes between 2 AM and 8 AM ET the next morning,
              not same-day). Four jobs run in sequence:
            </p>
            <table className="me-vendors">
              <thead>
                <tr>
                  <th>When (ET)</th>
                  <th>Job</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>8:00 AM</td>
                  <td>Massive</td>
                  <td>Pulls Polygon's full overnight price batch (~12,200 tickers).</td>
                </tr>
                <tr>
                  <td>8:30 AM</td>
                  <td>Trading Ops scanner</td>
                  <td>Scans the universe on last night's close, writes the signal table.</td>
                </tr>
                <tr>
                  <td>9:00 AM</td>
                  <td>Paper Portfolio queue</td>
                  <td>Queues rebalance trades into Alpaca for the 9:30 open.</td>
                </tr>
              </tbody>
            </table>
            <p className="me-body-p">
              Each job is safe to re-run, and backup runs fire if any one job misses its window. Same-day
              evening runs of Massive are kept as best-effort scraps so dashboard tiles can show a rough
              close intra-evening — the canonical "data is complete" run is the 8 AM morning one.
            </p>
            <p className="me-body-p">
              <b>Paper Portfolio sizing.</b> The $1M paper book follows the Trading Scanner long-only.
              Each qualifying name (Score ≥ 5) is sized at <b>Score × $20K</b> — a Score of 5 buys
              $100K, 6 buys $120K, up to a Score of 10 at $200K. When total demand exceeds the $1M book it
              levers up to <b>2×</b> ($2M gross), filling the highest-scored names first and pro-rating the
              marginal score band. Trades fire on signal changes only and are priced off the end-of-day feed;
              the book rebalances daily on the open.
            </p>
            <p className="me-body-p">
              For per-feed freshness across all sources at any time, the <b>Admin · Data → Data Health</b>{' '}
              page shows every feed, when it last refreshed, and what's on its dependency chain.
            </p>
          </div>
        </article>

        {/* 06 — Sources */}
        <article id="sources" className="me-section">
          <div className="me-num">06</div>
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
                {vendorRows.map(([v, c, t, w]) => (
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

        {/* 07 — Changelog */}
        <article id="change" className="me-section">
          <div className="me-num">07</div>
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
        </div>{/* /.me-content */}
       </div>{/* /.me-layout */}
      </section>
    </div>
  );
}
