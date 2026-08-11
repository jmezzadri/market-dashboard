/* Methodology — the site's reading page (cream v12 system).

   Conviction Events rewrite (2026-08, strategy reset): the paper book's
   portfolio-strategy content — §02 Scanner and §03 Paper — is rewritten
   around the ONE replacement book, Conviction Events (large real insider
   purchases ≥ $250,000 per name per day, automatic 10b5-1 plan purchases
   excluded, confirmed above the 50-day average, next-open entry, up to 8
   equal positions at one-eighth of equity, exit at the open of the 21st
   trading day, pre-registered kill switch: 10+ points behind the S&P 500
   after 8 weeks or drawdown over 15% freezes new entries). Backtest figures
   (June 2025 – August 2026 event study, ~14 months, zero costs: +112% vs
   S&P +24%, Sharpe 2.3, 61% winners, ~18-day average hold, +53% with the
   five best trades removed) are quoted VERBATIM from the strategy spec —
   never re-derived here, never rounded differently (LESSONS 8.3). The
   earlier two-sleeve content is deleted, not archived (LESSONS 0.10).
   §02 keeps Power Trend (relabeled an idea feed — not auto-traded) and RSI
   Divergences; the retired insider-score methodology went with its panel.

   Untouched by that rewrite: §01 Macro + the Engine, §04 Portfolio Lab,
   §05 Data (freshness contract + manifest-derived vendor table). Section
   numbers stay 01–05; the TOC stays one entry per nav page, named exactly
   as the nav names it (LESSONS 8.15); #conviction-events / #power-trend /
   #divergences are in-page anchors only.

   Cream rebrand Phase B (2026-07-07): page moved to the shared home-v12
   cream system (cream-system.css) with page styles in methodology-v12.css.
   The TOC rail keeps its exact scroll-spy + anchor behavior. This is the
   site's reading page: open editorial sections on the cream ground,
   generous measure, serif section H2s, formula insets, vendor/job tables
   as putty cards. */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import useIndicators from '../lib/useIndicators';
import FreshnessChip from '../components/FreshnessChip';
import '../styles/cream-system.css';
import '../styles/methodology-v12.css';

/* TOC = the site's pages, one entry per nav page, EXACTLY as named in
   NAV_ITEMS (chrome/TopNav.jsx) — Joe 2026-07-28. The Engine folds into
   Macro (that's the page it lives on); freshness + sources fold into Data.
   #engine / #freshness / #sources stay as in-page anchors for deep links. */
const SECTIONS = [
  ['macro',     'Macro'],
  ['scanner',   'Scanner'],
  ['portfolio', 'Paper'],
  ['lab',       'Portfolio Lab'],
  ['data',      'Data'],
];

/* The vendor table is DERIVED from the data manifest (single source of truth)
   at runtime, so it can never drift. */
/* Values = the nav's current page names. 'indicators' folds into Macro (the
   standalone All Indicators page was retired 2026-07-07; Macro is the
   indicator inventory surface). */
const TAB_LABEL = { home: 'Home', overview: 'Macro', indicators: 'Macro',
  macro: 'Macro', 'asset-tilt': 'Macro', readme: 'Methodology',
  methodology: 'Methodology', scanner: 'Scanner', paper: 'Paper',
  portfolio: 'Paper', portopps: 'Scanner', ticker: 'Ticker', data: 'Data',
  admin: 'Data', lab: 'Portfolio Lab', 'portfolio-lab': 'Portfolio Lab' };
const CAT_LABEL = { indicator: 'Indicators', market: 'Market data', equity: 'Equity data',
  portfolio: 'Portfolio', news: 'News', options: 'Options data',
  commentary: 'Commentary', ops: 'Operations', lab: 'Portfolio Lab' };

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
            <div className="mt-eyebrow">Macro</div>
            <h2 className="me-h2">Six categories · {liveIndicatorCount} indicators</h2>
            <p className="me-body-p">
              Every indicator on MacroTilt is sorted into one of the categories you can filter on the
              Macro page: <b>Rates</b>, <b>Credit</b>, <b>Equities</b>, <b>Commodities</b>,
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

            {/* The Engine — lives on the Macro page; folded into this section
                2026-07-28 so the TOC matches the nav exactly. Anchor kept. */}
            <div className="mt-eyebrow" id="engine" style={{ marginTop: 34, scrollMarginTop: 120 }}>The Engine</div>
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
              at every threshold pair tested. The Macro Overview page charts every de-risked stretch
              against the S&amp;P 500.{' '}
              <FreshnessChip elementId="indicator-move-daily" variant="dot" />
            </p>
          </div>
        </article>

        {/* 02 — Scanner */}
        <article id="scanner" className="me-section">
          <div className="me-num">02</div>
          <div>
            <div className="mt-eyebrow">Scanner</div>
            <h2 className="me-h2">Three panels · one book feed, two idea scanners</h2>
            <p className="me-body-p">
              The Scanner page shows three panels. <b>Conviction Events</b> is the decision feed the
              Paper book (section 03) actually trades — every large insider purchase the strategy
              evaluated, with the action it took. <b>Power Trend Momentum</b> is an{' '}
              <b>idea feed — not auto-traded</b>, published monthly. <b>RSI Divergences</b> is a
              daily screen — also not a trade signal. Everything below is the rule each panel
              actually runs, including the exact thresholds.
            </p>

            {/* ── Conviction Events ────────────────────────────────────── */}
            <h3 className="me-h3" id="conviction-events" style={{ scrollMarginTop: 120 }}>
              Conviction Events — the feed the Paper book trades
            </h3>
            <p className="me-body-p">
              A name qualifies on a day when its insiders genuinely bought it in size:{' '}
              <b>open-market purchases totaling $250,000 or more in that name on that day</b>,
              aggregated across its insiders. <b>Automatic (10b5-1) plan purchases are
              excluded</b> — those were scheduled months in advance under a written plan, so they
              say nothing about what the insider thinks today. The purchase record is the
              insider-filing record published by the SEC, which every officer, director and large
              holder is required to file.
            </p>
            <p className="me-body-p">
              One confirmation gate follows: the stock must already be trading <b>above its 50-day
              average price</b>, so the book never buys insider conviction into a name still in a
              downtrend. Every evaluated event is written to a decision ledger with the action
              taken — <b>entered</b>, <b>skipped</b> (the book was full, the name was already held,
              or a gate failed, with the reason), or <b>blocked</b> by the kill switch. That ledger
              is what this panel and the Paper page&rsquo;s event ledger render. The full entry,
              sizing and exit rules, the kill switch, and the backtest live in section 03.
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
            <div className="me-formula">
              universe = US common stock · close ≥ $2 · 45-day average dollar volume $50M–$40B<br />
              trend    = price above the 10/21/50/200-day EMAs · 3-mo return in the top 20% of the universe<br />
              strength = 3-mo return at least 5 points above the S&amp;P 500&rsquo;s<br />
              trigger  = a new 10-day closing high on volume above 1.3&times; the 20-day average, any day in the trailing month<br />
              list     = top 15 by 3-mo return · max 3 per industry group · nothing qualifies → an explicit all-cash list<br />
              drop     = a listed name closing below all four averages leaves the list that day
            </div>
            <p className="me-body-p">
              <b>Vol rank</b> (a table column, not a test input) reads the options market: each listed
              name&rsquo;s <b>~30-day at-the-money implied volatility</b>, shown as a percentile across
              that day&rsquo;s covered names — 0 is the calmest name on the list, 100 the most volatile.
              It answers one question for anyone sizing an idea from the list: how much movement is the
              options market pricing into this name versus the rest. Implied volatility comes from the
              London Strategic Edge options chain; the feed lists options for actively-traded names
              only, so a name without listed options shows an em-dash, never a substituted number.
              Refreshed once per trading day at 5:50 PM ET.
            </p>
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

            {/* ── Divergences ──────────────────────────────────────────── */}
            <h3 className="me-h3" id="divergences" style={{ scrollMarginTop: 120 }}>
              RSI Divergences — a screen, not a signal
            </h3>
            <p className="me-body-p">
              <b>RSI Divergences</b> is a separate daily screen on the scanner page. It does <b>not</b>{' '}
              feed the Paper book, which never trades on it. It compares price and
              14-day RSI (simple-average method) at the two most recent confirmed pivots — a pivot needs
              5 bars on each side, which is why the newest possible pivot is always 5 days old. A{' '}
              <b>bullish regular divergence</b> is a lower price low with a higher RSI low; a{' '}
              <b>bearish regular divergence</b> is a higher price high with a lower RSI high. Only fresh
              setups surface (newer pivot within 15 trading days, pivots 5–30 days apart) across the
              same liquid US common-stock universe the Power Trend list uses (last close ≥ $2, 45-day
              average dollar volume ≥ $50M). Split-like price jumps and close-versus-VWAP disagreements
              are filtered out as data artifacts. A divergence flags a possible reversal — it is a
              screen to investigate, not a trade signal, and it carries no timing claim.
            </p>
          </div>
        </article>

        {/* 03 — Paper */}
        <article id="portfolio" className="me-section">
          <div className="me-num">03</div>
          <div>
            <div className="mt-eyebrow">Paper</div>
            <h2 className="me-h2">One paper book · Conviction Events</h2>
            <p className="me-body-p">
              MacroTilt runs a live <b>paper account</b> with no manual input and no broker
              import. It trades a single rules-based book, <b>Conviction Events</b>: large real
              insider purchases, confirmed by trend, held for a fixed window. Every rule below is
              the deployed rule; every decision the book makes is written to the event ledger shown
              on the Paper and Scanner pages.
            </p>
            <p className="me-body-p">
              <b>The signal.</b> A name qualifies on a day when its insiders&rsquo; real buying is
              large: <b>aggregated open-market purchases of $250,000 or more in that name on that
              day</b>, added up across its insiders. <b>Automatic (10b5-1) plan purchases are
              excluded</b> — a purchase scheduled months in advance under a written plan carries no
              view on the business today. Only actual open-market buys count; grants, option
              exercises and other paper transfers never qualify.
            </p>
            <p className="me-body-p">
              <b>The confirmation.</b> The stock must already be trading <b>above its 50-day average
              price</b> on the signal day. The gate keeps the book out of names still in a
              downtrend: insider conviction alone, against the trend, does not qualify.
            </p>
            <p className="me-body-p">
              <b>Entry, sizing and exit.</b> A qualifying name is bought at the <b>next
              morning&rsquo;s open</b>. The book holds <b>up to 8 positions, each one-eighth of its
              equity</b> — equal sizing. A name already held is not bought
              again, and when all 8 slots are filled new qualifying events are skipped and logged.
              Each position <b>exits at the open of the 21st trading day after entry</b> — a fixed
              calendar exit with no discretion. Long-only, no leverage. Profit and loss is measured
              against cost, on the account&rsquo;s official snapshots — the latest mark during
              market hours, the closing record after 4 PM ET.
            </p>
            <p className="me-body-p">
              <b>The kill switch, set in advance.</b> If the book <b>trails the S&amp;P 500 by 10 or
              more points after 8 weeks</b>, or its <b>drawdown exceeds 15%</b>, new entries freeze
              automatically; open positions still exit on their scheduled day. The thresholds were
              fixed before the book launched, so the decision to stop is the rule&rsquo;s — not a
              judgment call made after a bad stretch. The current state — quiet or tripped — shows
              on the Paper page.
            </p>
            <p className="me-body-p">
              <b>The backtest, stated honestly.</b> In a <b>June 2025 – August 2026 event study —
              roughly 14 months, simulated with zero trading costs</b> — the rule returned{' '}
              <b>+112%</b> against <b>+24%</b> for the S&amp;P 500, with a Sharpe ratio of 2.3,{' '}
              <b>61% of trades profitable</b>, and an average hold of about 18 days. With the{' '}
              <b>five best trades removed it still returned +53%</b>. Two caveats stand: 14 months is a short window covering a single market
              stretch, and a zero-cost simulation flatters the result — live results should be
              expected to run below it.
            </p>
            <p className="me-body-p">
              <b>Data sources.</b> The signal reads the insider purchase filings published by the
              SEC — the public record every officer, director and large holder is required to
              file. The confirmation gate and all pricing use our own stored daily price history.
            </p>
            <div className="me-formula">
              signal  = aggregated open-market insider buys ≥ $250,000 per name per day · automatic (10b5-1) plan purchases excluded<br />
              confirm = stock trading above its 50-day average price<br />
              enter   = next morning&rsquo;s open · up to 8 positions · size = one-eighth of equity each<br />
              exit    = at the open of the 21st trading day after entry<br />
              freeze  = trailing the S&amp;P 500 by 10+ points after 8 weeks, or drawdown over 15% → new entries stop automatically
            </div>
          </div>
        </article>

        {/* 04 — Portfolio Lab */}
        <article id="lab" className="me-section">
          <div className="me-num">04</div>
          <div>
            <div className="mt-eyebrow">Portfolio Lab</div>
            <h2 className="me-h2">Expected return, three ways · one optimizer</h2>
            <p className="me-body-p">
              The <b>Portfolio Lab</b> (signed-in users) estimates the expected return of any US stock or
              ETF, builds portfolios from those estimates, and compares the result against benchmarks.
              Every price on the page is a <b>split- and dividend-adjusted daily close</b> fetched live
              from Yahoo Finance&rsquo;s public chart data — one price source for every series on the page —
              covering the trailing five years.
            </p>
            <p className="me-body-p">
              <b>Method 1 — CAPM.</b> Expected return = risk-free rate + beta × equity risk premium.
              Beta is measured by comparing the stock&rsquo;s daily moves to SPY&rsquo;s over that
              stock&rsquo;s own history, up to five years — so a recently listed name never shortens the
              beta window of anything else in the book. A holding with under a full trading year of
              history states how much it has and is left out of the expected-return, risk and frontier
              numbers; the rest of the book is unaffected. This long-window beta is the right input for a
              multi-year expected return; it can differ from the &ldquo;Beta · 1y&rdquo; tile on a ticker&rsquo;s
              detail page, which deliberately measures only the trailing year — a stock whose character
              changed recently (ONDS, for example) reads higher on the one-year measure. The risk-free rate is the live 2-year Treasury yield (a
              2y–10y blend for the 3-year horizon), and the equity risk premium is Damodaran&rsquo;s published
              implied premium for the US market, reviewed quarterly.
            </p>
            <p className="me-body-p">
              <b>Method 2 — Weighted Scenarios.</b> You supply Bull / Base / Bear target prices for the
              chosen horizon and a probability for each (they must sum to 100%). Expected return is the
              probability-weighted average of the three implied returns. This method uses your inputs
              only — no model.
            </p>
            <p className="me-body-p">
              <b>Method 3 — Implied vol.</b> This method prices risk directly from the options market.
              The expected return is the return the market&rsquo;s own going rate demands for the stock&rsquo;s
              volatility: risk-free rate + (equity risk premium ÷ SPY&rsquo;s option-implied volatility) ×
              the stock&rsquo;s option-implied volatility, with both volatilities read at the one-year point.
              A stock exactly as volatile as the market earns exactly risk-free + the equity risk
              premium; a stock the options market prices at six times SPY&rsquo;s volatility must offer six
              times the premium. It is the return <i>required to justify the risk</i> at the market&rsquo;s
              going rate — not a forecast that the stock will earn it. Implied volatility comes from the
              London Strategic Edge options chain — the at-the-money call at each listed expiry (strike
              within 10% of the current price, anchored to the most recently updated contract) —
              interpolated to the horizon linearly in total variance between the two nearest expiries
              (held flat beyond the last listed expiry). The range shown is the market-implied expected
              move over the horizon. In the optimizer, a holding on this method keeps historical
              correlations but its volatility is replaced by the implied figure. A name the live feed
              does not cover but whose options trade on the vendor&rsquo;s research archive gets a
              previous-close implied-vol curve derived overnight from actual traded option prices
              (strikes within 10% of the close, discounted Black-76 against the 3-month Treasury
              rate) — the row is labeled with its data date. A name with no usable options anywhere
              shows an em-dash and falls back to CAPM with historical volatility.
            </p>
            <p className="me-body-p">
              <b>The optimizer</b> draws the long-only efficient frontier: for each level of expected
              return, the mix of your holdings with the lowest volatility, where expected returns come
              from each holding&rsquo;s selected method and risk (volatility and correlations) comes
              from the longest daily history that every optimized holding shares, up to five years —
              except holdings on the Implied vol method, whose own
              volatility is options-implied (correlations stay historical). Clicking a point loads its weights. Marked points:
              minimum volatility, maximum Sharpe ratio, and equal weight. Portfolio statistics —
              volatility, Sharpe, beta, maximum drawdown, contribution to risk — are computed from the
              same daily history with the portfolio rebalanced monthly to its current weights. The
              &ldquo;Sector mix&rdquo; benchmark holds each stock&rsquo;s sector ETF at the same weight, mapped from the
              company&rsquo;s SEC industry classification.
            </p>
            <div className="me-formula">
              CAPM: expected_return = risk_free + beta × equity_risk_premium<br />
              Scenarios: expected_return = Σ probability × (target_price ÷ last_price − 1)<br />
              Implied vol: expected_return = risk_free + (equity_risk_premium ÷ SPY_implied_vol) × stock_implied_vol<br />
              Implied vol: expected_range = ± implied_vol(horizon) × √years, around that expected return<br />
              term interpolation: variance(horizon) is linear in σ²·days between the two nearest expiries<br />
              Frontier: minimize portfolio_variance subject to target return · weights ≥ 0 · weights sum to 100%<br />
              horizon scaling: return compounds by years · volatility scales by √years
            </div>
          </div>
        </article>

        {/* 05 — Data (freshness contract + sources & vendors;
            #freshness / #sources anchors kept for deep links) */}
        <article id="data" className="me-section">
          <div className="me-num">05</div>
          <div>
            <div className="mt-eyebrow" id="freshness" style={{ scrollMarginTop: 120 }}>Data</div>
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
            <div className="mt-eyebrow" id="sources" style={{ marginTop: 34, scrollMarginTop: 120 }}>Data sources &amp; vendors</div>
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
