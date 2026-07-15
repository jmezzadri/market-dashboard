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

   Two-sleeve rewrite (2026-07-14, MOMENTUM_SLEEVE_BUILD_SPEC.md §5 — PR-4):
   - §03/§04 REWRITTEN (not appended) around the two sleeves: Insider
     Conviction (thresholds from paper_portfolio/config.py: buy ≥ 4, exit < 3)
     and Momentum (rules from scripts/momentum_rules.py: 12-1 ranks, quintile
     clamp 20–50, SPY-vs-200-day guard).
   - Evidence block sourced from Strategy_Backtest_2026-07-14.xlsx: the
     survivorship-controlled +4.7%/yr gets EQUAL BILLING with the 16.3%-vs-8.8%
     headline; costs (10 bps/side, ~32%/mo turnover), drawdowns (−55.7%
     unguarded / −23.8% guarded), the guard's 2026 whipsaw (−7% vs +21%), and
     the insider sleeve's 11-month evidence window stated plainly.
   - §05 job table gains the monthly momentum list publish + daily guard
     refresh. §06 vendor table is manifest-derived and picks the new elements
     up automatically.

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
            <h2 className="me-h2">Two independent sleeves · Insider Conviction &amp; Momentum</h2>
            <p className="me-body-p">
              The Scanner page runs <b>two fully rules-based sleeves</b>. <b>Sleeve 1 — Insider Conviction</b>{' '}
              buys when executives are buying and the trend confirms, event-driven and scanned daily.{' '}
              <b>Sleeve 2 — Momentum</b> owns the strongest 12-month performers, re-ranked once a month.
              The sleeves are deliberately separate: we tested requiring both signals at once, and the
              overlap produced only 1–6 names a month — too few to hold a portfolio. So neither signal
              vetoes the other; a stock that qualifies for both is owned by both, and total exposure
              scales with the evidence.
            </p>
            <p className="me-body-p">
              <b>Sleeve 1 scoring.</b> Each ticker earns points from two validated inputs, added — not
              weighted — into a single score from 0 to 5. A name needs at least <b>3 points to appear</b>;
              the <b>buy line is a Score of 4</b> (a high-conviction insider name not in a downtrend), the
              level at which the Paper Portfolio (section 04) actually buys.
            </p>
            <div className="me-formula">
              Insider (up to +4) + Technicals (+1 / −2)<br />
              MacroTilt Score = the sum, capped at 5<br />
              buy = Score ≥ 4 · hold until Score &lt; 3
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
            <p className="me-body-p">
              <b>Sleeve 2 selection.</b> On the first of each month, every liquid US common stock (last
              close ≥ $2, 45-day average dollar volume ≥ $50M) is ranked by its <b>12-month return
              excluding the most recent month</b> (the standard "12-1" academic construction — the last
              month is skipped because very recent winners tend to snap back). The sleeve owns the{' '}
              <b>top fifth of that ranking, clamped to 20–50 names, equal-weight</b>, and holds them
              untouched until the next monthly re-rank. A <b>portfolio-level crash guard</b> checks the
              S&amp;P 500 against its own 200-day average every trading day: below it, the whole sleeve
              moves to cash; back above, it re-enters at the next signal. An insider-badge dot on the
              ranked list marks names where an officer or director also bought in the trailing 90 days —
              information only, it does not affect selection.
            </p>
            <div className="me-formula">
              rank  = total return from 12 months ago to 1 month ago, highest first<br />
              own   = top quintile of the ranked universe, clamped to 20–50 names, equal-weight<br />
              guard = S&amp;P 500 below its 200-day average → whole sleeve to cash (checked daily)
            </div>
            <p className="me-body-p">
              <b>The evidence, stated honestly.</b> Over 270 monthly rebalances (Jan 2004 – Jun 2026),
              momentum returned <b>16.3%/yr against the S&amp;P 500's 8.8%/yr</b>, net of modeled costs
              (10 basis points per side on roughly a third of the list turning over each month). That
              headline flatters: the deep price history only exists for companies still alive today, so
              failed companies are missing. Controlling for that — comparing momentum against an
              equal-weight portfolio of the <b>same</b> universe — the honest edge is{' '}
              <b>about +4.7%/yr</b>, and that number deserves the same billing as the headline. The cost
              is volatility: the unguarded sleeve's worst peak-to-trough loss was <b>−55.7%</b> (2008);
              with the crash guard it was <b>−23.8%</b>, but the guard gives return back in whipsaw years —
              in 2026 so far the guarded sleeve is <b>−7% against +21% unguarded</b>. Expect the guard to
              cost return most years and pay for itself only in extended bear markets, and expect any
              single year to lose to the index badly. The insider sleeve's evidence window is much
              shorter — <b>11 months of filings history</b> (+6%/yr excess in that window) plus the
              separate 12-month hit-rate study — directionally consistent, but not long-term proof.
            </p>
            <p>
              <b>Dark pool</b>, <b>Options shock</b> and <b>Options flow</b> counted toward the score until
              2026-07-07, when they were <b>shelved as unvalidated</b> — only weeks of history exist for them,
              not enough to prove they help — and <b>removed from the scanner table</b> entirely on 2026-07-08.
              <b>Short interest</b> (FINRA short position, days-to-cover, short-volume ratio, cost to borrow)
              remains alongside the score as <b>context that does not enter it</b>, refreshed each weekday morning.
            </p>
            <p className="me-body-p">
              <b>RSI Divergences</b> is a separate daily screen on the scanner page and does not feed the
              score. It compares price and 14-day RSI (simple-average method) at the two most recent
              confirmed pivots — a pivot needs 5 bars on each side. A <b>bullish regular divergence</b> is a
              lower price low with a higher RSI low; a <b>bearish regular divergence</b> is a higher price
              high with a lower RSI high. Only fresh setups surface (newer pivot within 15 trading days,
              pivots 5–30 days apart) across liquid US common stocks (last close ≥ $2, 45-day average
              dollar volume ≥ $50M). Split-like price jumps and close-versus-VWAP disagreements are
              filtered as data artifacts. A divergence flags a possible reversal — it is a screen to
              investigate, not a trade signal, and it carries no timing claim.
            </p>
          </div>
        </article>

        {/* 04 — Paper Portfolio */}
        <article id="portfolio" className="me-section">
          <div className="me-num">04</div>
          <div>
            <div className="mt-eyebrow">Paper Portfolio</div>
            <h2 className="me-h2">One $1M paper account · two sleeves</h2>
            <p className="me-body-p">
              MacroTilt runs a live <b>$1M paper portfolio</b> with no manual input and no broker import,
              split <b>$500K to each sleeve</b>. <b>Long-only, no leverage</b> in either sleeve — the book
              never borrows. A name held by both sleeves appears once per sleeve on the holdings table,
              marked ×2; its total exposure is the two positions combined.
            </p>
            <p className="me-body-p">
              <b>Sleeve 1 — Insider Conviction</b> buys every name at or above the buy line{' '}
              (<b>Score ≥ 4</b>) at a <b>fixed $100K per name</b>, filling the highest-scored names first
              and resting the remainder in cash, rebalanced daily on the open. It is{' '}
              <b>signal-only, and holds through the noise</b>: a name is bought once and{' '}
              <b>held until its score decays below 3</b> — a name that dips just under the buy line for a
              day is kept, not dumped-and-rebought. (Rebuilt 2026-07-07: the old score-tiered sizing and
              2× leverage were retired after a review found they — not the stock picks — were driving the
              losses.)
            </p>
            <p className="me-body-p">
              <b>Sleeve 2 — Momentum</b> trades once a month, on the list publish: it buys the current
              ranked list <b>equal-weight, $500K divided by the list size</b> (20–50 names, so roughly
              $10–25K per name), sells what dropped off, and otherwise does not touch positions between
              re-ranks. The only intra-month action is the crash guard: if the S&amp;P 500 closes below
              its 200-day average, the sleeve exits to cash. Expect roughly a third of the list to turn
              over each month (~15 orders) — fine on paper, tax-inefficient in a real taxable account.
            </p>
            <p className="me-body-p">
              Both sleeves share the account's order path: trades queue after the morning signal run and
              fill at the open. Positions are held at <b>cost basis</b> and priced off the end-of-day
              feed, so profit and loss is cost-basis P/L, not a live mark.
            </p>
            <div className="me-formula">
              Sleeve 1: buy = Score ≥ 4 · size = fixed $100K (≤10% of book) · hold until Score &lt; 3<br />
              Sleeve 2: buy = current monthly list · size = $500K ÷ list size · guard → all cash<br />
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
                <tr>
                  <td>8:45 AM</td>
                  <td>Momentum crash guard</td>
                  <td>Daily: re-checks the S&amp;P 500 against its 200-day average and updates the sleeve's invested / in-cash status.</td>
                </tr>
                <tr>
                  <td>6:00 AM · 1st of month</td>
                  <td>Momentum list publish</td>
                  <td>Monthly: re-ranks the universe on the prior month's last complete day and publishes the 20–50 name list.</td>
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
