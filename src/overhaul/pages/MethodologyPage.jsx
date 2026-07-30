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

   Power Trend rewrite (2026-07-15) — supersedes the 2026-07-14 two-sleeve
   copy IN PLACE (never appended):
   - §03/§04 rewritten around the current rules: Insider Conviction (buy ≥ 4,
     exit < 3, full $500K equal-weight across held names, rebalanced daily,
     3% drift band) and Momentum driven by the Power Trend signal (three tests
     on daily closes — trend / relative strength / breakout trigger — top 15
     by 3-month return, 8-name floor with unfilled slots in cash). The old
     12-1 quintile list and its crash guard are retired everywhere.
   - Evidence block = the 2020–2026 portfolio simulation with the 8-name
     floor (18.2%/yr vs 14.8%, Sharpe 1.26, max drawdown −19.7% vs −20.7%),
     with the survivor-cohort caveat and the short six-year window stated
     plainly: live results should be expected to run below the backtest.
   - §05 job table: crash-guard row removed (job retired); list publish row
     reworded to the Power Trend list. §06 vendor table is manifest-derived
     and picks the new elements up automatically.

   Scanner methodology rewrite (2026-07-30, Joe: "it doesn't actually explain
   the scanners... doesn't give the methodology, it's very vague") —
   supersedes the compressed §02 copy IN PLACE. §02 is now a step-by-step
   document re-sourced from the production engine
   (trading-scanner/scanner/trading_opps/run_screener.py +
   calibrated_config.json + backtest_engine.py, and supabase/migrations/
   078|081..084 for Power Trend):
   - Step 1 universe gate ($5 close, $1.5M 90-day MEDIAN dollar volume, ETFs
     excluded); Step 2 Form 4 code table (only code P scores; A/M/F/S/G
     discarded) + the 10b5-1 and 10%-owner exclusions + buy-only rationale;
     Step 3 rules A/B/C table with exact point values (4/4/2, layer cap 4) and
     the stake-lift definition; Step 4 age decay (plateau 15d, zero at 31d,
     insider layer only); Step 5 trend overlay (+1/−2 vs SMA200, −2 RSI>65);
     Step 6 score + publish 3 / buy 4 / hold 3, display banding (>=4.5 -> 5,
     3.5-4.49 -> 4) and SIX worked examples computed from the real rules.
   - Corrections: the "3x daily event firehoses" line was stale (dark-pool /
     options ingests retired 2026-07-20; EDGAR insider is 06:00 ET daily); the
     vague "beat the market two-to-one on hit rate" replaced with the
     calibrated_config figure (67% vs 57% base, 12mo / ~730k obs); entry/stop/
     target labelled NOT backtested (risk_levels.status = DRAFT).
   - Power Trend universe now states the $40B ADV ceiling (migration 078) and
     that the averages are EMAs; §03 sizing corrected from "full $500K" to 99%
     of live sleeve NAV with the fixed-allocation fallback (config.py
     SIZING_CASH_BUFFER_PCT / SIZING_NAV_SANITY_BAND, translator.py
     _sleeve_sizing_capital).
   - New .me-h3 sub-head class in methodology-v12.css (serif, hairline above)
     so a long section reads as a document. TOC unchanged — LESSONS 8.15 keeps
     one entry per nav page; the new sub-heads carry in-page anchors only.

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
            <h2 className="me-h2">Two independent sleeves · Insider Conviction &amp; Power Trend</h2>
            <p className="me-body-p">
              The Scanner page runs <b>two fully rules-based sleeves</b>. <b>Sleeve 1 — Insider Conviction</b>{' '}
              buys when executives are buying and the trend confirms, event-driven and scanned every
              trading day. <b>Sleeve 2 — Momentum</b> runs the <b>Power Trend</b> signal — strong,
              confirmed uptrends that have just broken out again — refreshed once a month.
              The sleeves are deliberately separate: we tested requiring both signals at once, and the
              overlap produced only 1–6 names a month — too few to hold a portfolio. So neither signal
              vetoes the other; a stock that qualifies for both is owned by both, and total exposure
              scales with the evidence. Everything below is the rule the production engine actually
              runs, including the exact thresholds.
            </p>

            {/* ── Sleeve 1 ─────────────────────────────────────────────── */}
            <h3 className="me-h3" id="insider-conviction" style={{ scrollMarginTop: 120 }}>
              Sleeve 1 — Insider Conviction: how a stock earns its score
            </h3>
            <p className="me-body-p">
              The score is a <b>sum of points</b>, not a weighted average of factors. Two things earn
              points — <b>insider conviction</b> (up to +4) and a <b>trend overlay</b> (+1 or −2, and a
              further −2 if the stock is overbought). Nothing else on the page enters the number. The
              ceiling is <b>5</b>. The steps below run in order, every trading day, on the whole US
              equity universe.
            </p>

            <p className="me-body-p">
              <b>Step 1 · Which stocks are eligible.</b> The nightly price batch covers roughly 12,000
              US tickers. A name is only scoreable if it clears a liquidity gate on the scan date:
              a <b>last close of at least $5</b> and a <b>90-day median daily dollar volume of at least
              $1.5 million</b>. ETFs and leveraged / sector funds are excluded outright. The gate is
              sized for real $10K–$30K positions — it removes names where a fill would move the price,
              not names we dislike. The scanner header on the Scanner page shows both counts for the
              day: how many tickers were scanned, and how many cleared the gate.
            </p>

            <p className="me-body-p">
              <b>Step 2 · What counts as an insider buy.</b> Insider data is Form 4 filings pulled
              from <b>SEC EDGAR every morning at 6:00 AM ET</b>, which captures the full prior filing
              day. A Form 4 reports many different kinds of transaction, and <b>only one of them
              scores</b>: transaction code <b>P</b>, an open-market purchase made with the insider&rsquo;s
              own money. Every other code is discarded before scoring.
            </p>
            <table className="me-vendors">
              <thead>
                <tr>
                  <th>Form 4 code</th>
                  <th>What it is</th>
                  <th>Scored?</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>P</td>
                  <td>Open-market purchase — the insider paid cash at the market price</td>
                  <td>Yes — the only code that scores</td>
                </tr>
                <tr>
                  <td>S</td>
                  <td>Open-market sale</td>
                  <td>No — see below</td>
                </tr>
                <tr>
                  <td>A</td>
                  <td>Grant, award or other acquisition from the company</td>
                  <td>No — compensation, not a decision to buy</td>
                </tr>
                <tr>
                  <td>M</td>
                  <td>Exercise or conversion of a derivative (option exercise)</td>
                  <td>No — an exercise, not a purchase at the market price</td>
                </tr>
                <tr>
                  <td>F</td>
                  <td>Shares withheld by the company to cover tax</td>
                  <td>No — administrative</td>
                </tr>
                <tr>
                  <td>G, and all other codes</td>
                  <td>Gifts, inheritances, plan mechanics</td>
                  <td>No — no market decision behind them</td>
                </tr>
              </tbody>
            </table>
            <p className="me-body-p">
              Two further filters are applied to the surviving <b>P</b> buys. <b>10b5-1 plan trades are
              excluded</b>: those purchases were scheduled months in advance under a written plan, so
              they say nothing about what the insider thinks today. <b>Buys by 10%-or-greater
              stakeholders are excluded</b>: a large outside holder adding to a position is a
              shareholder decision, and the rules below are looking specifically for
              <i> management</i> conviction. The sleeve is also <b>buy-only — insider selling is never
              scored</b>, in either direction. Executives sell for diversification, tax and liquidity
              reasons that carry no view on the business; buying is the one side with a single obvious
              motive.
            </p>

            <p className="me-body-p">
              <b>Step 3 · The three conviction rules.</b> All eligible buys <b>filed in the trailing 30
              calendar days</b> ending on the scan date are rolled up per ticker, and three rules are
              tested against that window. A name needs <b>only one</b> to fire.
            </p>
            <table className="me-vendors">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Fires when</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>A — C-suite conviction</td>
                  <td>
                    A <b>C-suite officer</b> — CEO, CFO, or the filing&rsquo;s designated principal
                    executive / principal financial officer — makes an open-market buy that lifts{' '}
                    <b>their own holding in the company by 10% or more</b> and is worth{' '}
                    <b>at least $100,000</b>. Both conditions, one purchase.
                  </td>
                  <td>+4</td>
                </tr>
                <tr>
                  <td>B — size versus the company</td>
                  <td>
                    Every eligible buy in the 30-day window, added together, is worth{' '}
                    <b>at least 0.05% of the company&rsquo;s market cap</b>. This is how a mid-cap gets
                    credit for a genuinely large cluster of buying even when no single officer
                    qualifies under Rule A.
                  </td>
                  <td>+4</td>
                </tr>
                <tr>
                  <td>C — cluster</td>
                  <td>
                    <b>Three or more different insiders</b> bought in the window. Independent people
                    reaching the same conclusion in the same month.
                  </td>
                  <td>+2</td>
                </tr>
              </tbody>
            </table>
            <p className="me-body-p">
              The &ldquo;lift their own holding by 10%&rdquo; test in Rule A is read straight off the
              Form 4: (shares owned after − shares owned before) ÷ shares owned before. An insider
              opening a brand-new position counts as a 100% lift. Points from rules that fire together
              are <b>added and then capped at +4</b> — so A alone is 4, B alone is 4, C alone is 2, and
              A + C is 6 capped back to 4. The cap is why the insider layer can never dominate the
              trend overlay.
            </p>

            <p className="me-body-p">
              <b>Step 4 · The signal fades with age.</b> An insider buy is only actionable while it is
              fresh. The <b>most recent eligible filing in the window</b> sets the clock, and the
              capped insider points are multiplied by an age factor: <b>full weight through day 15</b>,
              then a straight line down to <b>zero at day 31</b>. A rule-A name filed 18 days ago
              carries 4 × 0.81 = 3.25 insider points, not 4. The trend overlay is <b>not</b> decayed.
              This decay was added because it lifted the launched list&rsquo;s win rate by roughly 3
              points with no cost to fresh signals.
            </p>

            <p className="me-body-p">
              <b>Step 5 · The trend overlay.</b> Two price checks, computed on the same closing prices,
              stop the sleeve from buying conviction into a falling stock or chasing one that has
              already run: <b>+1</b> if the close is above the <b>200-day simple moving average</b>,{' '}
              <b>−2</b> if it is below, and a further <b>−2</b> if the <b>14-day Wilder RSI is above
              65</b>. The −2 below the 200-day is deliberately double the +1 above it: a stock in a
              downtrend has to clear a much higher bar of insider evidence to appear at all.
            </p>

            <p className="me-body-p">
              <b>Step 6 · The score, and who gets published.</b> Insider points plus trend points, and
              nothing else. A name is <b>published to the Scanner only at 3 or above</b>. The{' '}
              <b>buy line is 4</b> — the level at which the Paper Portfolio (section 03) actually buys —
              and a held name is kept until its score falls <b>below 3</b>.
            </p>
            <div className="me-formula">
              insider_pts = min(4×rule_A + 4×rule_B + 2×rule_C, 4) × age_decay(days since freshest filing)<br />
              age_decay   = 1.00 through day 15 · (31 − age) ÷ 16 from day 16 to 30 · 0.00 from day 31<br />
              trend_pts   = +1 close above the 200-day SMA · −2 close below it · −2 if 14-day Wilder RSI &gt; 65<br />
              MacroTilt Score = insider_pts + trend_pts   (ceiling 5)<br />
              publish = Score ≥ 3 · buy = Score ≥ 4 · hold until Score &lt; 3
            </div>
            <p className="me-body-p">
              Because the age decay is continuous, the stored score is a decimal. The badge on the
              table shows it as a <b>3, 4 or 5</b>: <b>4.5 and above shows 5</b>, <b>3.5 to 4.49 shows
              4</b>, and everything else published shows 3. Six worked examples, each computed exactly
              as the engine would:
            </p>
            <table className="me-vendors">
              <thead>
                <tr>
                  <th>Situation</th>
                  <th>Insider</th>
                  <th>Trend</th>
                  <th>Score</th>
                  <th>Shown as</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Rule B fires; freshest buy filed 6 days ago; stock above its 200-day line; RSI 58</td>
                  <td>4.00</td>
                  <td>+1</td>
                  <td>5.00</td>
                  <td>5 — buy</td>
                </tr>
                <tr>
                  <td>Rule A fires; freshest buy filed 18 days ago (81% weight left); above the 200-day; RSI 61</td>
                  <td>3.25</td>
                  <td>+1</td>
                  <td>4.25</td>
                  <td>4 — buy</td>
                </tr>
                <tr>
                  <td>Rules A and C both fire (6 points, capped at 4), fresh; above the 200-day; RSI 71 (overbought)</td>
                  <td>4.00</td>
                  <td>+1 −2</td>
                  <td>3.00</td>
                  <td>3 — appears, below the buy line</td>
                </tr>
                <tr>
                  <td>Rule C only — three insiders bought, fresh; above the 200-day; RSI 52</td>
                  <td>2.00</td>
                  <td>+1</td>
                  <td>3.00</td>
                  <td>3 — appears, below the buy line</td>
                </tr>
                <tr>
                  <td>Rule A fires, fresh — but the stock is below its 200-day line</td>
                  <td>4.00</td>
                  <td>−2</td>
                  <td>2.00</td>
                  <td>not published</td>
                </tr>
                <tr>
                  <td>Rule B fired 26 days ago (31% weight left); above the 200-day</td>
                  <td>1.25</td>
                  <td>+1</td>
                  <td>2.25</td>
                  <td>not published</td>
                </tr>
              </tbody>
            </table>
            <p className="me-body-p">
              Two consequences worth stating plainly. <b>A perfect 5 requires all three of</b>: a rule
              that pays 4 points (A or B), a filing no more than 15 days old, and a stock trading above
              its 200-day line without being overbought. And <b>a stock in a downtrend can essentially
              never reach the buy line</b> — the −2 caps it at 2.
            </p>

            <p className="me-body-p">
              <b>What is deliberately not in the score.</b> Dark-pool prints, options shock and options
              flow counted toward the score until 2026-07-07, when they were <b>shelved as
              unvalidated</b> — only weeks of history existed, not enough to prove they help — and
              removed from the scanner table entirely on 2026-07-08; the ceiling dropped from 10 to 5
              when they came out. <b>Short interest</b> (FINRA short position, days-to-cover,
              short-volume ratio, cost to borrow), <b>analyst actions</b>, <b>congressional trades</b>{' '}
              and <b>news</b> are shown or available as context but <b>never enter the score</b>. The
              standing rule is that nothing scores until it has roughly twelve months of history and a
              backtest behind it.
            </p>
            <p className="me-body-p">
              <b>Vol rank</b> (a table column, not a score input) reads the options market: each scanned
              name&rsquo;s <b>~30-day at-the-money implied volatility</b> from the London Strategic Edge
              options chain, shown as a percentile across that day&rsquo;s covered scan names — 0 is the
              calmest name on the list, 100 the most volatile. It answers one question for position
              sizing: how much movement is the options market pricing into this name versus the rest of
              the list. The feed lists options for actively-traded names only; a name without listed
              options shows an em-dash, never a substituted number. Refreshed once per trading day at
              5:50 PM ET, after the scan.
            </p>
            <p className="me-body-p">
              <b>The evidence.</b> The insider edge was validated over 12 months and roughly 730,000
              ticker-day observations. The <b>high-conviction slice</b> the rules above isolate — large
              executive and director buys, and clusters — won <b>67% of the time against a 57% base
              rate</b> for the eligible universe. The rule values themselves (window length, point
              values, the 200-day and RSI cut-points, the age-decay shape) are backtest-calibrated
              against forward returns at a 21-trading-day horizon, not chosen by judgment. Entry, stop
              and target levels displayed alongside a name are a <b>3% stop and 15% target off the
              scan-date close</b>, and are <b>not yet backtested</b> — they are a display convention,
              not a validated rule.
            </p>

            {/* ── Sleeve 2 ─────────────────────────────────────────────── */}
            <h3 className="me-h3" id="power-trend" style={{ scrollMarginTop: 120 }}>
              Sleeve 2 — Momentum: the Power Trend list
            </h3>
            <p className="me-body-p">
              The Power Trend signal looks for stocks already in a strong, confirmed uptrend that have
              just broken out again. It runs <b>once a month, on the 1st at 6:00 AM ET</b>, on the prior
              month&rsquo;s closing prices, and publishes a list of up to 15 names.
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
              <b>Construction.</b> Names passing all three are ranked by 3-month return; the sleeve owns
              at most the <b>top 15, equal-weight</b>, with an <b>industry cap</b>: no more than 3 names
              from the same industry group (2-digit SIC), with skipped slots filled by the next-ranked
              names from other industries. If fewer than 8 names pass, the sleeve does not concentrate
              further — sizing always divides by at least 8, so the unfilled slots stay in cash. A month
              where nothing qualifies publishes an explicit all-cash list.
            </p>
            <p className="me-body-p">
              <b>The one risk check between refreshes.</b> Daily, a held name that closes below all four
              of its moving averages — the same four the entry test requires it to be above — is{' '}
              <b>sold that day</b>, and the cash rests until the next monthly list. In the 2020–2026
              simulation this exit cut the worst peak-to-trough loss from about 40% to about 30%, at the
              cost of a few points of annual return.
            </p>
            <div className="me-formula">
              universe = US common stock · close ≥ $2 · 45-day average dollar volume $50M–$40B<br />
              trend    = price above the 10/21/50/200-day EMAs · 3-mo return in the top 20% of the universe<br />
              strength = 3-mo return at least 5 points above the S&amp;P 500&rsquo;s<br />
              trigger  = a new 10-day closing high on volume above 1.3&times; the 20-day average, any day in the trailing month<br />
              own      = top 15 by 3-mo return, equal-weight · max 3 per industry group · fewer than 8 fire → the rest stays in cash<br />
              exit     = a held name closing below all four averages is sold that day · cash rests until the next list
            </div>
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
              <b>Live results should be expected to run below the backtest, and single months can be
              brutal — the same rule would have lost roughly 20% in the first half of July 2026.</b>
            </p>

            {/* ── Divergences ──────────────────────────────────────────── */}
            <h3 className="me-h3" id="divergences" style={{ scrollMarginTop: 120 }}>
              RSI Divergences — a screen, not a signal
            </h3>
            <p className="me-body-p">
              <b>RSI Divergences</b> is a separate daily screen on the scanner page. It does <b>not</b>{' '}
              feed either sleeve and the Paper Portfolio never trades on it. It compares price and
              14-day RSI (simple-average method) at the two most recent confirmed pivots — a pivot needs
              5 bars on each side, which is why the newest possible pivot is always 5 days old. A{' '}
              <b>bullish regular divergence</b> is a lower price low with a higher RSI low; a{' '}
              <b>bearish regular divergence</b> is a higher price high with a lower RSI high. Only fresh
              setups surface (newer pivot within 15 trading days, pivots 5–30 days apart) across the
              same liquid US common-stock universe the Power Trend sleeve uses (last close ≥ $2, 45-day
              average dollar volume ≥ $50M). Split-like price jumps and close-versus-VWAP disagreements
              are filtered out as data artifacts. A divergence flags a possible reversal — it is a
              screen to investigate, not a trade signal, and it carries no timing claim.
            </p>
          </div>
        </article>

        {/* 04 — Paper Portfolio */}
        <article id="portfolio" className="me-section">
          <div className="me-num">03</div>
          <div>
            <div className="mt-eyebrow">Paper</div>
            <h2 className="me-h2">One $1M paper account · two sleeves</h2>
            <p className="me-body-p">
              MacroTilt runs a live <b>$1M paper portfolio</b> with no manual input and no broker import,
              split <b>$500K to each sleeve</b>. <b>Long-only, no leverage</b> in either sleeve — the book
              never borrows. A name held by both sleeves appears once per sleeve on the holdings table,
              marked ×2; its total exposure is the two positions combined.
            </p>
            <p className="me-body-p">
              <b>Sleeve 1 — Insider Conviction</b> buys every name at or above the buy line{' '}
              (<b>Score ≥ 4</b> on the Scanner&rsquo;s 0–5 scale, section 02) and always deploys the{' '}
              <b>whole sleeve, split equally across every qualifying name</b> — 3 names means about
              $165K each, 10 names means about $50K each. A name is held until its{' '}
              <b>score decays below 3</b>, and the sleeve is rebalanced every day on the open as names
              enter and leave; drifts inside a 3% band (or $500, whichever is larger) are left alone so
              the book is not churned by noise. It remains <b>signal-only</b>: entries and exits come
              from the score, never from price moves. (The original score-tiered sizing and leverage
              were retired in an earlier rebuild after a review found they — not the stock picks — were
              driving the losses.)
            </p>
            <p className="me-body-p">
              <b>Sleeve 2 — Momentum</b>, driven by the Power Trend signal, trades once a month on the
              list publish: it buys the current list <b>equal-weight — the sleeve divided by the number
              of names, at most 15 and never more than one-eighth of the sleeve in a single name</b> —
              sells what dropped off, and keeps a name into the next month only if it passes all three
              tests again. When fewer than 8 names qualify, each still gets only an eighth, so the
              unfilled slots rest in cash rather than concentrating the sleeve. Between publishes a
              daily stop watches every held name: a close below all four moving averages sells it that
              day, and the proceeds wait in cash for the next monthly list.
            </p>
            <p className="me-body-p">
              <b>How &ldquo;the whole sleeve&rdquo; is measured.</b> Both sleeves size off{' '}
              <b>99% of their own live net asset value</b> — holdings plus cash as of the latest daily
              snapshot — not off the fixed $500K they started with. Two reasons: the 1% buffer absorbs
              an overnight gap-up so a buy can never overdraw cash into unintended margin, and
              re-anchoring to NAV at every rebalance means a sleeve that has gained redeploys the gain
              and one that has lost sizes down, instead of letting cash quietly build up. If the NAV
              read is missing or lands outside half to one-and-a-half times the sleeve&rsquo;s
              allocation, sizing falls back to the fixed $500K rather than trusting a bad number.
            </p>
            <p className="me-body-p">
              Both sleeves share the account's order path: trades queue after the morning signal run and
              fill at the open. Positions are held at <b>cost basis</b> and priced off the end-of-day
              feed, so profit and loss is cost-basis P/L, not a live mark.
            </p>
            <p className="me-body-p">
              The positions tables also show a <b>Live price</b> column — the latest 1-minute bar from
              London Strategic Edge, about 10 seconds behind the tape, refreshed while the page is open.
              It is <b>display only</b>: every trade decision, fill and P&amp;L figure stays on official
              closes and broker fills. A name the live feed doesn&rsquo;t carry shows an em-dash.
            </p>
            <div className="me-formula">
              Sleeve 1: buy = Score ≥ 4 · size = $500K ÷ qualifying names · hold until Score &lt; 3<br />
              Sleeve 2: buy = current monthly Power Trend list · size = $500K ÷ names, capped at $500K ÷ 8 · fewer than 8 → rest in cash<br />
              unrealized_pl_$   = market_value − cost_basis<br />
              unrealized_pl_pct = (market_value − cost_basis) / cost_basis
            </div>
          </div>
        </article>

        {/* 05 — Portfolio Lab */}
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
