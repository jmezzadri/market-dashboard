/* Methodology — the site's reading page (cream v12 system).

   Quality Trend rewrite (2026-08-17): Conviction Events was retired on
   2026-08-13 — it selected positions on a single input (dollar value of
   insider buying) with no test of who was buying or how meaningful the
   purchase was to them, and its own last day showed why that fails. §03
   Paper is rewritten around the replacement, Quality Trend v3 (20 names + MOVE brake since 2026-09-01; brake v2 2026-09-10)
   scored on momentum + trend consistency + drawdown resilience (price),
   gross profitability + cash generation + buybacks (point-in-time SEC
   fundamentals), and a meaningful-insider-buy bonus; equal weight, monthly
   rebalance, hold-until-top-25% trade band, no leverage. Backtest figures
   (Feb 2017 – Aug 2026, survivorship-free universe incl. 2,011 delisted
   companies: 21.2%/yr vs S&P 15.3%, Sharpe 0.97 vs 0.82, maxDD −19.3% vs
   −23.9%, 7 of 10 years, both halves win independently, survives 40bp
   costs) are quoted VERBATIM from paper_portfolio/QUALITY_TREND_V3.md —
   never re-derived here, never rounded differently (LESSONS 8.3). The
   Conviction Events content is deleted, not archived (LESSONS 0.10).

   §02 relabels from "Scanner" to "Idea feeds" — the Scanner PAGE left the
   nav on 2026-08-11; the Power Trend list is still published monthly, so
   its rule still needs a home here. The id
   stays "scanner" so old #scanner deep links keep landing (as do
   #power-trend). #conviction-events is gone with its book; #divergences went
   with the RSI-divergence scan (retired 2026-10-13).

   §04 Macro Scorecard (added 2026-10-21): the Trade Idea contract and the
   marking rules, every number quoted from scripts/build_trade_idea.py and
   scripts/score_trade_ideas.py (Contract v2, LESSONS 6.26). It had been
   missing since the Scorecard joined the top bar — a nav page with no
   methodology section (LESSONS 0.15). Data is now §05; its #freshness and
   #sources anchors are unchanged. Section numbers are 01–05.

   Untouched: §01 Macro + the Engine, §05 Data (freshness contract +
   manifest-derived vendor table; the stale dead-pipeline rows in the jobs
   table were replaced with the three QT jobs).

   Cream rebrand Phase B (2026-07-07): page moved to the shared home-v12
   cream system (cream-system.css) with page styles in methodology-v12.css.
   The TOC rail keeps its exact scroll-spy + anchor behavior. This is the
   site's reading page: open editorial sections on the cream ground,
   generous measure, serif section H2s, formula insets, vendor/job tables
   as putty cards. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import useIndicators from '../lib/useIndicators';
import { PAGE_NAME } from '../chrome/siteNav';
import FreshnessChip from '../components/FreshnessChip';
import '../styles/cream-system.css';
import '../styles/methodology-v12.css';
// v13 last — it overrides the page's own v12 stylesheet.
import '../styles/v13.css';
import '../styles/pages-v13.css';

/* TOC = the site's pages, one entry per nav page, EXACTLY as named in
   chrome/siteNav.js — Joe 2026-07-28. The Engine folds into
   Macro (that's the page it lives on); freshness + sources fold into Data.
   #engine / #freshness / #sources stay as in-page anchors for deep links. */
const SECTIONS = [
  ['macro',     PAGE_NAME.macro],
  ['scanner',   'Idea feeds'],
  ['portfolio', PAGE_NAME.paper],
  ['scorecard', PAGE_NAME.scorecard],
  ['data',      PAGE_NAME.data],
];

/* The vendor table is DERIVED from the data manifest (single source of truth)
   at runtime, so it can never drift. */
/* Values = the nav's current page names. 'indicators' folds into Macro (the
   standalone All Indicators page was retired 2026-07-07; Macro is the
   indicator inventory surface). */
const TAB_LABEL = { home: PAGE_NAME.home, overview: PAGE_NAME.macro,
  indicators: PAGE_NAME.macro, macro: PAGE_NAME.macro, 'asset-tilt': PAGE_NAME.macro,
  readme: PAGE_NAME.methodology, methodology: PAGE_NAME.methodology,
  scanner: 'Scanner', paper: PAGE_NAME.paper, portfolio: PAGE_NAME.paper,
  portopps: 'Scanner', ticker: 'Ticker', data: PAGE_NAME.data, admin: PAGE_NAME.data,
  scorecard: PAGE_NAME.scorecard, email: 'Email' };
const CAT_LABEL = { indicator: 'Indicators', market: 'Market data', equity: 'Equity data',
  portfolio: 'Portfolio', news: 'News', options: 'Options data',
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
   the v12 page system. Replays in BOTH directions; state lives in React
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
    <div className="home-v12 v13 methodology-v12">
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
            <div className="mt-eyebrow">{PAGE_NAME.macro}</div>
            <h2 className="me-h2">Six categories · {liveIndicatorCount} indicators</h2>
            <p className="me-body-p">
              Every indicator on MacroTilt is sorted into one of the six tiles on the Macro Landscape
              page: <b>Rates</b>, <b>Credit</b>, <b>Equities</b>, <b>Commodities</b>,
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
              the pill and the chart always agree. One exception: corporate bond distress (the New York
              Fed's index) is ranked against its full history since 2005, because the last three years were
              unusually calm for corporate bonds and a 3-year rank labelled an ordinary reading distressed.
            </p>
            <p className="me-body-p">
              Each <b>tile</b> shows three counts for its category: how many of its gauges — the
              indicators and the positioning rows together — are <b>stretched</b> (Extreme), how many are
              <b>elevated</b>, and how many indicators just printed a <b>big move</b> (the latest one-step change,
              divided by the indicator's median move over its trailing 60 observations, ranks in the
              top 10% of that same ratio over the last 3 years). The
              tile with the largest share of its gauges stretched — plus half the share elevated — is
              marked the <b>hot spot</b>; when no gauge anywhere is stretched, no tile is. Clicking a tile
              opens its full list under that row of tiles, one category at a time; clicking any row
              opens the chart.
            </p>
            <div className="me-formula" data-mono="code">
              state(today) = bin(percentile_3y(value); high-warns [75, 85] · low-warns [25, 15] · two-sided both ends)<br />
              big_move     = |Δ| ÷ median(|Δ|, trailing 60 obs) ≥ 90th percentile of the same ratio over 3 years<br />
              hot_spot     = argmax over tiles of (stretched + 0.5 · elevated) / gauges, if stretched &gt; 0
            </div>

            {/* The Engine — lives on the Macro page; folded into this section
                2026-07-28 so the TOC matches the nav exactly. Anchor kept. */}
            <div className="mt-eyebrow" id="engine" style={{ marginTop: 'var(--sp-34)', scrollMarginTop: 120 }}>The Engine</div>
            <h2 className="me-h2">Two axes set the regime · stress &amp; yield</h2>
            <p className="me-body-p">
              Bond-market volatility (<b>MOVE</b>) sets the <b>stress axis</b> — it decides how much of the
              book sits in equities versus a defensive bucket. The 3-month change in the 10-year
              Treasury yield (<b>3M Δ 10y</b>) sets the <b>yield axis</b> — it decides what goes inside that
              defensive bucket when the engine de-risks, and does not change the equity weight.
            </p>
            <div className="me-formula" data-mono="code">
              stress_signal = MOVE<br />
              stress_zone   = MOVE &lt; 116 → Risk On · 116 ≤ MOVE &lt; 124 → Watch · MOVE ≥ 124 → Risk Off<br />
              entry_filter  = a de-risk only starts after 2 consecutive Fridays at or above 116;
              the return to full equity is immediate<br />
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
              comparable return. The defensive bucket fills only when stress crosses Watch.
              {' '}The two-week entry filter was added on 29 July 2026 after a review of every de-risk the
              engine has ever made: without it the gate fired on one-week volatility spikes, producing 69
              de-risk episodes since 1986 of which 48 lasted four weeks or less — including one that sold
              the exact bottom of the April 2025 drawdown. Requiring confirmation cuts that to 45 episodes
              and improves return, Sharpe and maximum drawdown together, in both halves of the sample and
              at every threshold pair tested. The Macro Landscape page charts every de-risked stretch
              against the S&amp;P 500.{' '}
              <FreshnessChip elementId="indicator-move-daily" variant="dot" />
            </p>
          </div>
        </article>

        {/* 02 — Idea feeds (id stays "scanner" for old deep links) */}
        <article id="scanner" className="me-section">
          <div className="me-num">02</div>
          <div>
            <div className="mt-eyebrow">Idea feeds</div>
            <h2 className="me-h2">One idea screen</h2>
            <p className="me-body-p">
              One screen runs on its own schedule and surfaces ideas. <b>Power Trend
              Momentum</b> is a monthly momentum list. Below is the rule it actually runs,
              including the exact thresholds.
            </p>

            {/* ── Power Trend ──────────────────────────────────────────── */}
            <h3 className="me-h3" id="power-trend" style={{ scrollMarginTop: 120 }}>
              Power Trend — the monthly momentum list
            </h3>
            <p className="me-body-p">
              The Power Trend signal looks for stocks already in a strong, confirmed uptrend that
              have just broken out again. It runs <b>once a month, on the 1st at 6:00 AM ET</b>, on
              the prior month&rsquo;s closing prices, and publishes a list of up to 15 names. It is
              an <b>idea feed — not auto-traded</b>: the Paper book does not hold it.
            </p>
            <p className="me-body-p">
              <b>The universe</b> is liquid US common stock: an active common-stock listing with a{' '}
              <b>last close of at least $2</b> and a <b>45-day average daily dollar volume between $50
              million and $40 billion</b>. The upper bound keeps a handful of mega-cap index proxies
              from crowding the list. Every test below is computed on daily closing prices.
            </p>
            <p className="me-body-p">
              <b>Test 1 — trend.</b> The price must sit above its <b>10-, 21-, 50- and 200-day
              exponential moving averages</b>, and its <b>3-month return</b> (63 trading days) must rank
              in the <b>top 20%</b> of that day&rsquo;s universe. <b>Test 2 — relative strength.</b> That
              same 3-month return must beat the S&amp;P 500&rsquo;s 3-month return by <b>at least 5
              percentage points</b>. <b>Test 3 — breakout trigger.</b> At some point in the trailing
              month (the last 21 trading days) the stock must have closed at a <b>new 10-day closing
              high on volume more than 1.3&times; its own 20-day average</b> — while tests 1 and 2 still
              hold as of the list date.
            </p>
            <p className="me-body-p">
              <b>The list.</b> Names passing all three are ranked by 3-month return; the list carries
              at most the <b>top 15</b>, with an industry cap — no more than 3 names from the same
              industry group (by the SEC&rsquo;s two-digit industry classification), skipped slots
              filled by the next-ranked names from other industries. A month where nothing qualifies
              publishes an explicit all-cash list. Between refreshes, a listed name that closes{' '}
              <b>below all four of those moving averages</b> — the same four the entry test requires —{' '}
              <b>drops off the list that day</b>. In the 2020–2026 simulation that drop rule cut the
              worst peak-to-trough loss from about 40% to about 30%, at the cost of a few points of
              annual return.
            </p>
            <div className="me-formula" data-mono="code">
              universe = US common stock · close ≥ $2 · 45-day average dollar volume $50M–$40B<br />
              trend    = price above the 10/21/50/200-day EMAs · 3-mo return in the top 20% of the universe<br />
              strength = 3-mo return at least 5 points above the S&amp;P 500&rsquo;s<br />
              trigger  = a new 10-day closing high on volume above 1.3&times; the 20-day average, any day in the trailing month<br />
              list     = top 15 by 3-mo return · max 3 per industry group · nothing qualifies → an explicit all-cash list<br />
              drop     = a listed name closing below all four averages leaves the list that day
            </div>
            {/* The Vol rank paragraph was removed 2026-08-11 with the Power Trend
                Momentum panel: it documented a column on that table, and the site no
                longer renders the implied-volatility reading anywhere. The daily feed
                itself keeps running (manifest element equity.lse-iv-scan-daily, now
                with no consumer surface) — documenting a column no reader can see is
                the defect LESSONS 8.13 governs. */}
            <p className="me-body-p">
              <b>The evidence, stated honestly.</b> In a January&nbsp;2020&nbsp;–&nbsp;July&nbsp;2026 portfolio
              simulation (monthly cadence, 8-name floor, industry cap, no trading costs) the rule
              returned <b>27.0% a year against 13.6% for the S&amp;P 500</b>, with a Sharpe ratio of 1.08
              and a worst peak-to-trough loss of <b>24.1%</b> — shallower than the index&rsquo;s own 34% over
              the same window. This re-validation (2026-07-23) replaced an earlier study that had
              measured a different fire-window than the deployed rule and stopped in March 2026. Two
              caveats stand. The test window is six and a half years — far shorter than the multi-decade
              evidence behind classic momentum. And the simulation ran on a <b>survivor-leaning
              cohort</b>: mostly companies that exist today. That flatters the result, because failures
              that would have been bought along the way are under-represented.{' '}
              <b>Published results of the list should be expected to run below the simulation, and single
              months can be brutal — the same rule would have lost roughly 20% in the first half of
              July 2026.</b>
            </p>
          </div>
        </article>

        {/* 03 — Paper · Quality Trend (2026-08-17 rewrite; Conviction Events
            retired 2026-08-13, its content deleted per LESSONS 0.10) */}
        <article id="portfolio" className="me-section">
          <div className="me-num">03</div>
          <div>
            <div className="mt-eyebrow">{PAGE_NAME.paper}</div>
            <h2 className="me-h2">One paper book · Quality Trend</h2>
            <p className="me-body-p">
              MacroTilt runs a live <b>$1,000,000 paper account</b> with no manual input and no
              broker import, live since <b>September 1, 2026</b>. It trades a single rules-based
              book, <b>Quality Trend</b>: own the <b>20 US companies</b> with the strongest
              combination of steady price trend and real profitability, equal-weighted, rebalanced
              monthly, with no leverage, plus an automatic crash brake described below. Every rule
              on this page is the deployed rule — the scoring code and this page describe the same
              system. (A 40-name version of this book ran on paper from August 17–25, 2026 on an
              account that was then closed; its brief record is preserved on the Paper Portfolio page and is
              not part of this book's track record.)
            </p>
            <p className="me-body-p">
              <b>Why the previous book was retired.</b> Conviction Events (retired 13 August 2026)
              bought whenever insiders purchased more than a set dollar amount of a stock. That
              single test asked nothing about <i>who</i> was buying, how meaningful the purchase
              was <i>to them</i>, or what condition the business was in — so a large holder
              rebalancing counted the same as a chief executive buying with conviction, and names
              days off an earnings collapse qualified. We measured it: across ten years of insider
              filings, <b>all open-market buys as a group trail the market by about 2 points over
              the following six months</b>. Raw insider buying is not a signal. What survives, as
              a bonus on top of the seven scored inputs below, is a much narrower filter.
            </p>
            <p className="me-body-p">
              <b>The score.</b> Every eligible company is ranked on seven inputs, combined with
              fixed weights. Price (55%): <b>12-month momentum</b> (45 points, skipping the most
              recent month) and <b>6-month momentum</b> (30 points, same skip) — is it winning, and
              is it still winning; <b>trend consistency</b> (15 points) — the share of the last six
              months spent above its own average, separating steady advances from jumpy ones; and{' '}
              <b>drawdown resilience</b> (10 points) — its worst peak-to-trough loss over the past
              year. Fundamentals (45 points): <b>gross profit ÷ total assets</b> (15) — is the
              business actually profitable; <b>operating cash flow ÷ total assets</b> (10) — does
              the profit turn into cash; and <b>share-count reduction</b> (20) — buybacks score
              positive, dilution scores negative. Weights sum to more than 100 because each input
              is a relative rank, not a dollar figure.
            </p>
            <p className="me-body-p">
              <b>The insider bonus — a filter, not a firehose.</b> On top of the score, a bonus of
              up to 20 points for <b>meaningful insider buying</b> over the trailing 180 days:{' '}
              <b>officers and directors only</b> (a pure 10%-owner never counts, however large the
              purchase), <b>open-market purchases only</b> (no 10b5-1 plans, grants or exercises),
              ranked by the <b>size of the purchase relative to the shares the insider already
              held</b> — a doubled stake is conviction; a 2% top-up is rebalancing. Purchases over
              $250,000 get <i>half</i> weight, because in our testing the very large dollar buys
              were the <i>worst</i> performers. The bonus is never a penalty: no insider activity
              simply means no bonus.
            </p>
            <p className="me-body-p">
              <b>Eligibility.</b> Before scoring, a company must trade <b>$100 million a day</b> on
              average, at a price of <b>$5 or more</b>, with annualized volatility <b>under 70%</b>,
              on at least 95% of trading days — and it must be an operating company with filed SEC
              financials: ETFs, trusts and funds never qualify, and a company with no filings is
              dropped rather than scored on price alone. Fundamentals are used{' '}
              <b>point-in-time</b>: a company&rsquo;s numbers enter the score only on the date they
              were actually <i>filed</i> with the SEC, never the period they refer to — the score
              never knows a quarter before the market did.
            </p>
            <p className="me-body-p">
              <b>Portfolio rules.</b> Buy the top 20 by score, <b>$50,000 per name</b> at inception
              (5% each), rebalanced on the <b>first trading day of each month</b> with orders
              submitted market-on-open. A held name is kept until it falls out of the <b>top 25% of
              the ranking</b> — not the moment it slips below rank 20 — which roughly halves
              turnover versus rebalancing to a fixed list. Long-only, <b>no leverage, no strategic
              cash</b> in normal conditions.
            </p>
            <p className="me-body-p">
              <b>The backtest, stated honestly.</b> The figures in this paragraph were computed on
              the <b>40-name, equal-weight variant with no brake</b> and are quoted unchanged; the
              live book holds 20 names and carries the brake, so treat them as evidence for the
              scoring engine, not a promise for this exact configuration. Validated{' '}
              <b>February 2017 – August 2026</b> on
              a <b>survivorship-free universe</b>: 14,632 US companies including <b>2,011 that no
              longer exist</b> — the bankrupt and the acquired stay in the sample, at their real
              exit prices. The strategy returned <b>21.2% a year against 15.3%</b> for the
              S&amp;P 500, Sharpe <b>0.97 vs 0.82</b>, Sortino 1.57 vs 1.18, worst drawdown{' '}
              <b>−19.3% vs −23.9%</b>, beating the index in <b>7 of 10 calendar years</b> with a
              worst year of <b>−6.7%</b> against the index&rsquo;s −18.2%. The sample splits into
              two independent halves and the strategy wins both — including 2017–2021, the
              index&rsquo;s best stretch. It survives punitive 40bp round-trip costs. No
              three-year window lost money.
            </p>
            <p className="me-body-p">
              <b>The caveats, also honestly.</b> Ten years of data covers the 2018 selloff, the
              2020 crash and the 2022 bear market — but not 2008. Three of the ten backtest years
              trailed the index (2019, 2021, 2025); more will come. The strategy runs a little
              more volatile than the index at full investment. The drawdown figures above are
              month-end marks; on daily marks the worst fall was &minus;33% (March 2020), which is why
              the brake table below is daily. And every backtest, however
              carefully built, flatters: <b>expect the live book to run below these numbers</b>.
              That is why it trades paper money, in public, with every rule pre-registered on this
              page.
            </p>
            <p className="me-body-p">
              <b>Data sources.</b> Prices are Alpaca&rsquo;s full-market daily history, which
              includes delisted companies. Fundamentals are SEC XBRL company filings, keyed to
              their filing dates. Insider purchases are the SEC&rsquo;s insider-filing record.
              All three are public data. Fills and account marks on the Paper Portfolio page are the paper
              broker&rsquo;s official records, snapshotted after each close.
            </p>
            <p className="me-body-p">
              <b>The crash brake &mdash; what it reads.</b> Once a day after the close, the book
              reads one number: where today&rsquo;s <b>MOVE Index</b> &mdash; the bond
              market&rsquo;s fear gauge, the same series that drives the Macro page&rsquo;s
              engine &mdash; sits against every day of its own last five years (0 = calmest
              day in five years, 1 = the most stressed). Bond-market volatility is used
              rather than the VIX because it spikes <i>before</i> the stock fall, not during it:
              in February 2020 it crossed the line on the 26th; this book&rsquo;s fall ran to
              March 20.
            </p>
            <p className="me-body-p">
              <b>What it does.</b> <b>Out:</b> when the reading closes above <b>0.95</b> two
              days running, the brake switches on and sells every position at the next open;
              the book sits in cash. <b>Back in:</b> the brake stays on until the reading closes
              below <b>0.80</b>, then buys the whole book back at full weights at the next open.
              The gap between 0.95 and 0.80 is deliberate: a reading hovering at the line
              cannot sell and buy back day after day. While on, the monthly rebalance still
              scores the book but buys nothing. The brake can only ever do those two things
              &mdash; all out, or all in. It never picks stocks, never shorts, never borrows,
              and if its data is missing it does nothing. Today&rsquo;s reading and the
              brake&rsquo;s state are shown on the Paper Portfolio page.
            </p>
            <p className="me-body-p">
              <b>The evidence, on this exact book.</b> The rule was chosen on September 10,
              2026 by replaying the 20-name book day by day from February 2017, with trades at
              the next open, 5 basis points a side, and cash earning nothing. The criterion
              was written down first: best risk-adjusted return, which had to hold in both
              halves of the sample and with the data a day late. Roughly 400 variants were run.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="me-vendors">
                <thead><tr><th>Feb 2017 &ndash; Sep 2026, daily marks</th><th>Return / yr</th><th>Sharpe</th><th>Worst fall</th><th>Worst year</th><th>2020</th><th>2022</th><th>Time in cash</th></tr></thead>
                <tbody>
                  <tr><td>No brake</td><td>19.8%</td><td>0.75</td><td>&minus;36.7%</td><td>&minus;6.5%</td><td>+18.7%</td><td>&minus;6.5%</td><td>&mdash;</td></tr>
                  <tr><td>VIX + high-yield, sell half (ran Sep 1&ndash;10)</td><td>16.3%</td><td>0.72</td><td>&minus;25.6%</td><td>&minus;8.8%</td><td>+10.2%</td><td>&minus;8.8%</td><td>20%</td></tr>
                  <tr><td>MOVE above 0.95 twice &rarr; cash; below 0.80 &rarr; back <b>(live)</b></td><td><b>23.7%</b></td><td><b>1.00</b></td><td>&minus;26.7%</td><td><b>0.0%</b></td><td><b>+44.3%</b></td><td><b>0.0%</b></td><td>18%</td></tr>
                  <tr><td>Same rule, sell half instead of all</td><td>22.0%</td><td>0.90</td><td>&minus;26.7%</td><td>&minus;2.5%</td><td>+32.0%</td><td>&minus;2.5%</td><td>18%</td></tr>
                  <tr><td>S&amp;P 500</td><td>15.2%</td><td>0.75</td><td>&minus;33.8%</td><td>&minus;18.2%</td><td>+18.5%</td><td>&minus;18.2%</td><td>&mdash;</td></tr>
                </tbody>
              </table>
            </div>
            <p className="me-body-p">
              The live rule beats no brake in both halves (Sharpe 1.26 vs 0.84 for 2017&ndash;21,
              0.72 vs 0.65 for 2022&ndash;26), with the data a day late, and on the 40-name
              version of the book. Every MOVE-based variant tested beat no brake; every
              VIX-based variant lost to it. It left the market three times: August&ndash;September
              2019, February 28 to April 2, 2020, and November 2021 to June 2023. Stated
              honestly: three episodes is a thin sample, and the gain rests mostly on 2020 and
              2022; the same signal is validated over forty years on the Macro engine, which is
              why it is trusted here. It protects against bond-market panics only &mdash; the
              April 2025 tariff fall, the residual worst drawdown above, had no bond panic and
              the brake stayed in. And the 2021&ndash;23 exit kept the book in cash for nineteen
              months; the book made &minus;5.9% over that stretch, so it was right, narrowly.
              The rule that ran from September 1 to 10 was the cross-asset engine&rsquo;s
              overlay lifted across untested; that was a mistake, and it is recorded as one.
            </p>
            <p className="me-body-p">
              <b>The risk cockpit &mdash; what the Paper Portfolio page measures, and how.</b> Every
              risk figure on the page is computed <b>once after each close, at that close&rsquo;s
              weights, from one year of daily closes</b> in the site&rsquo;s own price feed, and stored;
              the page shows the stored figure with its date. Every formula is
              re-derived and checked in the repository, and no figure prints until a full year of
              prices exists for the name. <b>10-day Value at Risk, 99%:</b> the 1% quantile of the
              book&rsquo;s own daily return distribution (historical simulation, no bell-curve
              assumption), scaled by &radic;10 to a ten-day horizon &mdash; the standard market-risk
              convention; a normal-distribution figure is shown beside it so a reader can see how
              much fatter the real tail is. <b>Risk share per name:</b> each holding&rsquo;s marginal
              contribution to book volatility times its weight, divided by book volatility &mdash;
              shares sum to 100%, and a name carrying over twice its weight is flagged.{' '}
              <b>Variance decomposition:</b> the book&rsquo;s daily returns are regressed on the
              S&amp;P 500 fund (market share = &beta;&sup2;&middot;market variance &divide; book
              variance), then the residual on five style funds minus the market (momentum, quality,
              buybacks, small-cap, value); what those explain is the style share, the rest is
              stock-specific. <b>Active style loadings:</b> for each name, momentum, quality,
              buybacks, size and value are turned into z-scores against the <b>500 largest US
              common stocks</b> (the site holds no official S&amp;P 500 list), winsorised at the
              2.5th/97.5th percentile; the page shows the book&rsquo;s weighted z minus the
              baseline&rsquo;s cap-weighted z, rebuilt at each monthly scoring from the same data as
              the score. <b>Shock scenarios:</b> the S&amp;P 500 fund&rsquo;s actual peak-to-trough fall
              in 2000&ndash;02, 2008&ndash;09, 2020 and 2022, read from the price feed and multiplied by
              the book&rsquo;s one-year beta; and an instant VIX-to-40 shock sized by the fund&rsquo;s
              measured elasticity to the VIX since 2006. These are projections, labelled as such
              &mdash; they assume the beta holds. <b>Alerts</b> fire on exactly the rules printed
              under the alert log, and nothing else.
            </p>
            <div className="me-formula" data-mono="code">
              eligible = $100M+ daily dollar volume · price ≥ $5 · volatility ≤ 70% · operating company with SEC filings<br />
              score    = 0.45·mom12 + 0.30·mom6 + 0.15·trend + 0.10·drawdown + 0.15·gross_profit/assets + 0.10·cash_flow/assets + 0.20·buyback (all cross-sectional ranks)<br />
              insider  = + up to 0.20 bonus · officers/directors only · open-market only, no 10b5-1 · ranked by purchase ÷ existing stake · buys &gt; $250k half-weighted · never a penalty<br />
              book     = top 20 · equal weight · monthly rebalance at the open · hold until out of the top 25%<br />
              brake    = daily, after the close · MOVE Index rank vs its last 5 years · &gt; 0.95 two days running → all to cash · then &lt; 0.80 → all back in<br />
              risk     = no leverage · ~5% per name · the monthly exit band · the brake — no per-stock stops<br />
              cockpit  = 1y daily closes at today's weights · VaR₁ = −quantile₀.₀₁(book daily return), VaR₁₀ = VaR₁·√10 · risk share = w·(Σw)/σ² · market = β²σ²ₘ/σ², style = residual explained by (MTUM, QUAL, PKW, IWM, VLUE) − SPY, specific = the rest · z vs 500 largest US stocks, winsorised 2.5/97.5 · shocks = β × SPY peak-to-trough
            </div>
          </div>
        </article>

        {/* 04 — Macro Scorecard: the Trade Idea contract and how every call is
            marked. Every number here is quoted from scripts/build_trade_idea.py
            and scripts/score_trade_ideas.py (LESSONS 9.3); rewritten 2026-10-21
            for Contract v2 (LESSONS 6.26). */}
        <article id="scorecard" className="me-section">
          <div className="me-num">04</div>
          <div>
            <div className="mt-eyebrow">{PAGE_NAME.scorecard}</div>
            <h2 className="me-h2">Every trade call, and how it is marked</h2>
            <p className="me-body-p">
              MacroTilt publishes a trade idea only when one clears a written contract, and then marks
              it in public until it closes. Research runs every morning before the US open; at most{' '}
              <b>two notes publish in any rolling seven days</b>, and most days publish nothing. A note
              that cannot name something to buy or sell is not published. Nothing publishes without a
              human tap; the contract below is what the idea has to survive first.
            </p>

            <h3 className="me-h3" id="scorecard-contract" style={{ scrollMarginTop: 120 }}>
              What a note has to clear before it publishes
            </h3>
            <p className="me-body-p">
              <b>A measured edge, with a baseline.</b> The note names the signal behind the call
              (positioning, technicals, relative value, flows, a cross-asset divergence, credit, volatility
              structure, calendar mechanics or market structure), the historical cases it was tested on,
              what followed, and the <b>unconditional outcome over the same holding period</b> — a hit
              rate means nothing until you know the rate from any start date. A famous valuation ratio
              (CAPE, the Buffett indicator, the equity risk premium) may appear as context but may not be
              the driver. The horizon is at most <b>18 months</b>.
            </p>
            <p className="me-body-p">
              <b>The return bar is a pace.</b> The note states the return it calls for on the position a
              retail account would hold, and that return must run at <b>20% a year</b> — the S&amp;P
              500&rsquo;s long-run 10% plus a 10-point margin — pro-rated to the horizon: 1.67% for one
              month, 5% for three, 10% for six, 20% for twelve. It must also pay <b>at least twice</b>
              what the position loses if the stated exit level prints. Every leg names a vehicle a US
              retail brokerage can hold: a listed stock, a fund, or listed options on one — never a
              futures contract or a swap.
            </p>
            <p className="me-body-p">
              <b>Today&rsquo;s conditions.</b> The note names the one factor it says is driving the
              move and counts how many of its historical cases share today&rsquo;s state on it. With{' '}
              <b>five or more</b> matching cases, the edge has to hold inside those cases alone. With
              fewer, the idea may still publish only if the cases&rsquo; returns did not depend on that
              factor — the correlation between each case&rsquo;s return and the factor&rsquo;s move over
              the hold must be <b>under 0.30</b> in absolute value — and then the note says so in plain
              words, carries an exit level at most <b>one third</b> of the expected return, and is sized
              at half the standard weight.
            </p>
            <p className="me-body-p">
              <b>Positioning edges</b> (bets that an extreme in futures positioning reverses) are measured
              on the full record with each week ranked only against the history available that week,
              counted in <b>at least ten independent episodes</b> at least 13 weeks apart, split by
              whether price was above or below its 200-day average, over <b>at least ten years</b> of
              data — or, when the contract or trader category is younger than that, over its full
              history provided the edge keeps the same sign at every threshold from the published
              percentile to twice it. One sign flip and the note is refused.
            </p>
            <p className="me-body-p">
              <b>Shorts.</b> Any short may publish if a retail account can express it: put options,
              a pair against a long, an outright short of a liquid fund, or an inverse fund held at
              most four weeks. A lagging asset is not a falling asset: an <b>outright short</b> must
              show the asset&rsquo;s own median forward return below zero, not just below the market;
              an edge that is only relative publishes as a pair. Every short-containing note states
              its expected return against simply holding the S&amp;P 500.
            </p>
            <p className="me-body-p">
              <b>Event ideas.</b> A second kind of note: a defined-risk options spread on one named
              event with a date, resolving within <b>six months</b>. It has no backtest; it passes three
              tests instead — the note&rsquo;s own odds of the event are at least <b>1.5 times</b> the
              breakeven odds the premium implies, each link in the chain from the event to the
              instrument carries a measured number from a dated source, and the structure is a spread
              or single option on a listed underlying with the premium stated as the most it can lose.
              It is exempt from the pace bar and the two-to-one rule: the premium is the stop.
            </p>
            <p className="me-body-p">
              <b>The book.</b> The book is a notional 100. A standard idea is sized at <b>10</b>, an
              idea published under the fewer-than-five-cases rule at <b>5</b>, an event idea at{' '}
              <b>1 to 2</b> of premium; the rest is cash. A candidate is rejected if its daily returns
              over the last 126 sessions ran at more than <b>0.60</b> correlation with any open call,
              and a standard idea must raise the book&rsquo;s expected return over the S&amp;P per unit
              of volatility at the real weights. The weight is written at publication and never changed.
            </p>
            <div className="me-formula" data-mono="code">
              bar       = 20% a year pro-rated to the horizon · expected return ≥ 2 × loss at the exit level<br />
              edge      = cases · what followed · the unconditional outcome over the same hold<br />
              today     = ≥ 5 matching cases, or |corr(case return, factor move)| &lt; 0.30 at half size and a one-third stop<br />
              position  = ≥ 10 episodes · ≥ 10 years or full history with no sign flip to 2× the threshold<br />
              short     = the asset's own median forward return &lt; 0, else a pair only<br />
              event     = our odds ≥ 1.5 × breakeven · measured transmission · premium is the max loss · resolves ≤ 6 months<br />
              book      = 100 notional · weights 10 / 5 / 1–2 · |correlation with any open call| ≤ 0.60
            </div>

            <h3 className="me-h3" id="scorecard-marking" style={{ scrollMarginTop: 120 }}>
              How each call is marked
            </h3>
            <p className="me-body-p">
              <b>Entry</b> is the last closing price that had settled when the note published — the
              price a reader was looking at, looked up by timestamp so it cannot be chosen. A close is
              treated as settled from 5 PM ET. Every call is marked as the <b>price return</b> of the
              series or fund the note named, on both sides of a spread, netted; no dividends, interest,
              costs or financing. Next to every call is the same yardstick: what the <b>S&amp;P 500</b>{' '}
              did over exactly the same days, read on or before the call&rsquo;s own mark date and left
              blank if the index is more than four days behind it.
            </p>
            <p className="me-body-p">
              <b>A call closes</b> at the earliest of three things: the stated exit level printing
              (the call is marked there and does not run on into a recovery); the <b>weekly review</b>,
              every Monday, finding a critical claim the note relied on no longer holds (closed at the
              last close before that review); or the planned close date. An <b>event idea</b> is marked
              at expiry from the underlying&rsquo;s closing price against its strikes — the payoff
              divided by the premium, so the result runs from a loss of the whole premium to the stated
              payoff ratio — shown as open before expiry, and closed early only when the weekly review
              finds the event decided, at the spread&rsquo;s value that day.
            </p>
            <p className="me-body-p">
              <b>The book figures.</b> A call&rsquo;s <b>contribution</b> is its weight multiplied by its
              own return, in points of the 100: a call at weight 10 that returns 20% contributes 2.
              Realized is the sum for closed calls, shown by the year they closed; unrealized is the sum
              for open calls; the two add to the book&rsquo;s total return exactly. The benchmark at
              book level is the S&amp;P 500 held at the same total weight the book had invested each
              day. Annualized figures are withheld below 28 days of history, and <b>no hit rate is
              shown until ten calls have closed</b> — below that a single outcome moves it by ten
              points. Every call is listed, including the ones that did not work. Calls published
              before October 21, 2026 were assigned the standard weight of 10 and say so.
            </p>
            <div className="me-formula" data-mono="code">
              entry        = last settled close before publication (settled from 5 PM ET)<br />
              mark         = price return of the named series, long minus short, no costs<br />
              benchmark    = S&amp;P 500 over the same days, read on or before the mark date (blank if &gt; 4 days stale)<br />
              close        = exit level printed · weekly review finds a critical claim broken · planned close date<br />
              event mark   = intrinsic value at expiry ÷ premium − 1 (−100% to the payoff ratio)<br />
              contribution = weight × return ÷ 100 · realized + unrealized = total · no hit rate below 10 closed calls
            </div>
          </div>
        </article>

        {/* 05 — Data (freshness contract + sources & vendors;
            #freshness / #sources anchors kept for deep links) */}
        <article id="data" className="me-section">
          <div className="me-num">05</div>
          <div>
            <div className="mt-eyebrow" id="freshness" style={{ scrollMarginTop: 120 }}>{PAGE_NAME.data}</div>
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
                  <td>9:40 AM · 1st trading day</td>
                  <td>Quality Trend scoring</td>
                  <td>Monthly: scores the full universe, writes the 20-name target book and places the orders to move the account onto it. Fully automatic, with repeat runs through the 5th of the month in case a run is missed.</td>
                </tr>
                <tr>
                  <td>5:10 PM · daily</td>
                  <td>Quality Trend snapshot</td>
                  <td>Records the paper account's closing equity and positions, and syncs order fills. Read-only at the broker.</td>
                </tr>
                <tr>
                  <td>6:00 AM · 1st of month</td>
                  <td>Power Trend list publish</td>
                  <td>Monthly: runs the three Power Trend tests on the prior month's closing prices and publishes the list of up to 15 names; when fewer than 8 qualify the unfilled slots stay in cash.</td>
                </tr>
              </tbody>
            </table>
            <p className="me-body-p">
              Each job is safe to re-run, and backup runs fire if any one job misses its window. Same-day
              evening price pulls are kept as best-effort scraps so dashboard tiles can show a rough
              close intra-evening — the canonical "data is complete" run is the 8 AM morning one.
            </p>
            <p className="me-body-p">
              For per-feed freshness across all sources at any time, the <b>Data</b>{' '}
              page shows every feed, when it last refreshed, and what's on its dependency chain.
            </p>

            {/* Data sources & vendors — merged into the Data section
                2026-07-28; anchor kept for deep links. */}
            <div className="mt-eyebrow" id="sources" style={{ marginTop: 'var(--sp-34)', scrollMarginTop: 120 }}>Data sources &amp; vendors</div>
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
