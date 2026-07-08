/* Methodology — content uplift + glass UX 2026-06-24.

   Content re-sourced from production code (LESSONS 8.3 — methodology copy is
   bound to what ships, never memory):
   - §01 categories reconciled to the All Indicators filter (Rates, Credit,
     Equities, Commodities, FX, Financial Conditions & Economy); the invented
     word "domains" dropped; the regime-map ladder kept as a SEPARATE lens with
     anchors re-sourced from RegimeCanvas.jsx (DOMAIN_Y / STATE_X).
   - §02 engine stats now read validation.engine ("Regime + Defensive Sleeve"),
     the live Macro Overview engine — NOT validation.asset_tilt (the retired
     sector-allocation overlay). The equity grid + defensive sleeve mix are
     re-sourced from scripts/compute_macrotilt_engine.py.
   - §03 states the buy line (Score ≥ 4, max 5) explicitly.
   - §04 rewritten as the automated $1M Paper Portfolio (the broker-CSV / Plaid
     import it described is dead); TOC entry renamed "Paper Portfolio".

   Cream rebrand Phase B (2026-07-07): page moved from the home-v11 glass
   scope to the shared home-v12 cream system (cream-system.css) with page
   styles in methodology-v12.css. RESKIN ONLY -- classNames, layout wrappers
   and CSS; zero copy/data/chip changes. The TOC rail keeps its exact
   scroll-spy + anchor behavior, restyled only. This is the site's reading
   page: open editorial sections on the cream ground, generous measure,
   serif section H2s, formula insets, vendor/job tables as putty cards. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import useIndicators from '../lib/useIndicators';
import FreshnessChip from '../components/FreshnessChip';
import '../styles/cream-system.css';
import '../styles/methodology-v12.css';

const SECTIONS = [
  ['macro',     'Macro overview'],
  ['engine',    'Engine read'],
  ['scanner',   'Trading scanner'],
  ['portfolio', 'Paper Portfolio'],
  ['freshness', 'Data freshness contract'],
  ['sources',   'Data sources & vendors'],
];

/* The vendor table is DERIVED from the data manifest (single source of truth)
   at runtime, so it can never drift. */
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

/* Reveal -- scroll-reveal wrapper, same pattern as HomePage / MacroPage /
   ScannerPage (v12 system). Replays in BOTH directions; state lives in React
   so data-poll re-renders preserve the revealed class. Hero only on this
   page: the reading sections and TOC render statically so hash deep-links
   (#engine etc.) land on settled, unblurred text. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVis(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`${className} rv${vis ? ' in' : ''}`} {...rest}>{children}</Tag>;
}

export default function MethodologyPage() {
  const { active } = useIndicators();
  const liveIndicatorCount = active.length || '—';

  const [backtest, setBacktest] = useState(null);
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
        let best = null;
        for (const id of ids) {
          if (visible.has(id)) { best = id; break; }
        }
        if (best) setActiveId(best);
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: [0, 0.1, 0.5, 1] }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Engine stats read the LIVE engine series ("Regime + Defensive Sleeve"),
  // not the retired sector-allocation overlay (validation.asset_tilt).
  const eng = backtest?.validation?.engine;
  const spy = backtest?.validation?.spy;
  const nWeeks = backtest?.validation?.n_weeks;
  // Backtest values render em-dash when the backtest file fails to load —
  // never a hardcoded number.
  const cagrEngine = eng ? fmtPct(eng.cagr, 2) : '—';
  const cagrSpy   = spy ? fmtPct(spy.cagr, 2) : '—';
  const sharpeEng = eng ? eng.sharpe.toFixed(2) : '—';
  const sharpeSpy = spy ? spy.sharpe.toFixed(2) : '—';
  const ddEng     = eng ? fmtPctSigned(eng.max_drawdown, 1) : '—';
  const ddSpy     = spy ? fmtPctSigned(spy.max_drawdown, 1) : '—';
  const validatedWeeks = nWeeks ? nWeeks.toLocaleString() : '—';
  // "1986-2026 validated (locked …)" → just the year range for clean prose.
  const validatedRange = (backtest?.calibration_label || '').split(' validated')[0] || '—';

  const sectionsLiteral  = SECTIONS.length;

  return (
    <div className="home-v12 methodology-v12">
      {/* hero -- left editorial, label + copy verbatim from the glass hero */}
      <div className="meth-hero wrap">
        <Reveal className="eyebrow2"><span className="dot" />Methodology</Reveal>
        <Reveal as="h1" className="meth-h1">How MacroTilt <i>actually</i> works.</Reveal>
        <Reveal as="p" className="sub">
          {sectionsLiteral} sections, plain English. Every page on the site
          links here for the logic behind the number. The full formula sheet
          and data-vendor table are at the bottom.
        </Reveal>
      </div>

      <section className="wrap meth-main">
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
            <h2 className="me-h2">Six categories · {liveIndicatorCount} indicators</h2>
            <p className="me-body-p">
              Every indicator on MacroTilt is sorted into one of the categories you can filter on the
              All Indicators page: <b>Rates</b>, <b>Credit</b>, <b>Equities</b>, <b>Commodities</b>,
              <b> FX</b>, and <b>Financial Conditions &amp; Economy</b>. Within a category, each indicator is
              tagged by where it sits in the business cycle — <b>Lead</b>, <b>Coincident</b>, or <b>Lag</b>.
            </p>
            <p className="me-body-p">
              <b>State</b> (Calm / Elevated / Extreme) is set by where today's reading sits in the
              indicator's own <b>trailing 3-year</b> percentile range — the same window the
              positioning signals use. Cut-points depend on which tail of the indicator is unhealthy:
              high-warns indicators turn Elevated at the 75th percentile and Extreme at the 85th;
              low-warns indicators turn Elevated at the 25th and Extreme at the 15th; two-sided
              indicators warn at both ends. The detail chart shades these same amber/red zones, so
              the pill and the chart always agree.
            </p>
            <p className="me-body-p">
              The <b>macro regime map</b> plots every indicator on two axes. Left-to-right is the
              indicator's state — calm names sit left, extreme names sit right. Top-to-bottom groups
              names on a five-rung macro ladder — Rates at the top, then Credit, Equities, Money, and
              the real Economy at the bottom — so a glance shows which part of the system is under
              stress. That ladder is a layout for the map only; it is a different lens from the
              category filter above.
            </p>
            <div className="me-formula">
              state(today) = bin(percentile_3y(value); high-warns [75, 85] · low-warns [25, 15] · two-sided both ends)<br />
              map x (state)        = extreme +0.62 · elevated +0.20 · calm −0.55<br />
              map y (macro ladder) = Rates +0.45 · Credit +0.20 · Equities −0.10 · Money −0.40 · Economy −0.65
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
              Bond-market volatility (<b>MOVE</b>) sets the <b>stress axis</b> — it decides how much of the
              book sits in equities versus a defensive bucket. The 3-month change in the 10-year
              Treasury yield (<b>3M Δ 10y</b>) sets the <b>yield axis</b> — it decides what goes inside that
              defensive bucket when the engine de-risks, and does not change the equity weight.
            </p>
            <div className="me-formula">
              stress_signal = MOVE<br />
              stress_zone   = MOVE &lt; 116 → Risk On · 116 ≤ MOVE &lt; 124 → Watch · MOVE ≥ 124 → Risk Off<br />
              equity_pct    = Risk On 100% · Watch 80% · Risk Off 50%  (set by stress alone)<br />
              yield_regime  = 3M Δ 10y ≥ +32 bp → Inflationary · ≤ −11 bp → Deflationary · else Neutral<br />
              defensive_mix = Inflationary 50% cash / 30% gold / 20% short Treasuries ·
              Deflationary 25% cash / 25% gold / 50% long Treasuries ·
              Neutral 50% cash / 25% gold / 25% long Treasuries
            </div>
            <p className="me-body-p">
              <b>Validated {validatedRange}</b> over <b className="num">{validatedWeeks}</b> weeks.{' '}
              <b>CAGR {cagrEngine}</b> vs SPY {cagrSpy}, Sharpe {sharpeEng} vs {sharpeSpy},
              max drawdown {ddEng} vs {ddSpy} — the engine takes far less of the drawdown for a
              comparable return. The defensive bucket fills only when stress crosses Watch.{' '}
              <FreshnessChip elementId="indicator-move-daily" variant="dot" />
            </p>
          </div>
        </article>

        {/* 03 — Scanner */}
        <article id="scanner" className="me-section">
          <div className="me-num">03</div>
          <div>
            <div className="mt-eyebrow">Trading scanner</div>
            <h2 className="me-h2">Two signals · one MacroTilt Score (0–5)</h2>
            <p className="me-body-p">
              Each ticker earns points from two validated inputs. They are added together — not weighted —
              into a single score from 0 to 5. A name needs at least <b>3 points to appear</b> on the scanner;
              the <b>buy line is a Score of 4</b> (out of a maximum of 5 — a high-conviction insider name not in a downtrend), the level at which the $1M Paper
              Portfolio (section 04) actually buys a name.
            </p>
            <div className="me-formula">
              Insider (up to +4) + Technicals (+1 / −2)<br />
              MacroTilt Score = the sum, capped at 5
            </div>
            <p className="me-body-p">
              <b>Insider</b> fires on open-market buys in the last 30 days — a C-suite officer lifting their
              own stake ≥10% (≥$100k), combined buying ≥0.05% of the company, or 3+ different insiders —
              capped at +4 and faded with age. <b>Technicals</b> add +1 above the 200-day line (−2 below) and
              −2 if the 14-day RSI is overbought. This is the pairing we validated over 12 months — the
              high-conviction insider slice beat the market roughly two-to-one on hit rate. <b>Universe scan</b>
              runs once per trading day; <b>event firehoses</b> (insider Form 4, dark-pool prints, options, news)
              refresh 3× daily.
            </p>
            <p>
              <b>Dark pool</b>, <b>Options shock</b> and <b>Options flow</b> counted toward the score until
              2026-07-07, when they were <b>shelved as unvalidated</b> — only weeks of history exist for them,
              not enough to prove they help — and <b>removed from the scanner table</b> entirely on 2026-07-08.
              <b>Short interest</b> (FINRA short position, days-to-cover, short-volume ratio, cost to borrow)
              remains alongside the score as <b>context that does not enter it</b>, refreshed each weekday morning.
            </p>
          </div>
        </article>

        {/* 04 — Paper Portfolio */}
        <article id="portfolio" className="me-section">
          <div className="me-num">04</div>
          <div>
            <div className="mt-eyebrow">Paper Portfolio</div>
            <h2 className="me-h2">The automated $1M paper book</h2>
            <p className="me-body-p">
              MacroTilt runs a live <b>$1M paper portfolio</b> that trades the Trading Scanner long-only —
              no manual input, no broker import. It buys every name <b>at or above the buy line (Score ≥ 4)</b>{' '}
              at a <b>fixed $100K per name</b> (equal-weight, capped at 10% of the book), filling the
              highest-scored names first and resting the remainder in cash. <b>No leverage</b> — the book never
              borrows. (Rebuilt 2026-07-07: the old score-tiered sizing and 2× leverage were retired after a
              review found they — not the stock picks — were driving the losses.)
            </p>
            <p className="me-body-p">
              The book is <b>signal-only, and holds through the noise</b>. A name is bought once when it
              crosses the buy line and <b>held until its score decays below 3</b> — a name that dips just under
              the buy line for a day is kept, not dumped-and-rebought (that churn is what the rebuild fixed). It
              never resizes on a price move or a one-point score wobble. Positions are held at <b>cost basis</b>
              and priced off the end-of-day feed, so profit and loss is cost-basis P/L, not a live mark.
            </p>
            <div className="me-formula">
              buy  = Score ≥ 4 · size = fixed $100K equal-weight (≤10% of book) · no leverage<br />
              hold = keep the name until Score &lt; 3 (hold through the wobble)<br />
              sell = Score &lt; 3 → exit the whole position<br />
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
              not same-day). Three jobs run in sequence:
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
                  <td>Price batch</td>
                  <td>Pulls Polygon's full overnight price batch (~12,200 tickers).</td>
                </tr>
                <tr>
                  <td>8:30 AM</td>
                  <td>Trading scanner</td>
                  <td>Scans the universe on last night's close, writes the signal table.</td>
                </tr>
                <tr>
                  <td>9:00 AM</td>
                  <td>Paper Portfolio queue</td>
                  <td>Queues rebalance trades for the 9:30 open.</td>
                </tr>
              </tbody>
            </table>
            <p className="me-body-p">
              Each job is safe to re-run, and backup runs fire if any one job misses its window. Same-day
              evening price pulls are kept as best-effort scraps so dashboard tiles can show a rough
              close intra-evening — the canonical "data is complete" run is the 8 AM morning one.
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

        </div>{/* /.me-content */}
       </div>{/* /.me-layout */}
      </section>
    </div>
  );
}
