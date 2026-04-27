// MethodologyPage v2.1 — one unified "Data & Methodology" page.
//
// v2.1 rework (2026-04-22) addressed 10 items of feedback on the v2 page:
//   #18 — jump-nav anchors collided with the hash router (links bounced
//         to homepage); now use prefixed IDs + onClick + scrollIntoView
//         with preventDefault, so the URL hash never changes.
//   #19 — tab-list matches the real sidebar: Home / Macro Overview / All
//         Indicators / Sectors / Trading Opportunities & Portfolio Insights
//         / Trading Scanner / Sector Lab · BETA (7 surfaces).
//   #20 — each tab card rewritten in hedge-fund PM pitch voice: WHY WE
//         BUILT IT / HOW A PM USES IT / WHERE THE EDGE COMES FROM, plus
//         the practical What you see / How to read it fields.
//   #21 — Indicator → Category map rebuilt with phase (fast/slow),
//         timing (leading/coincident/lagging), plain-English measure,
//         source, and tier rationale. Tier chips color-coded by tier.
//   #22 — every section header now carries an APPLIES TO chip pointing
//         at the real tab(s) that surface the methodology.
//   #23 — CONVICTION bands recalibrated against full 2006-2026 history
//         (see scripts/conviction-backtest.js). New thresholds anchor at
//         p60 / p85 / p97.5 so GFC + COVID sit in EXTREME and 2022 / SVB
//         sit in ELEVATED — previously both miscalibrated to NORMAL.
//   #24 — scanner-score story unified: one composite [-100, +100], one
//         methodology. The legacy "two parallel scores" language is
//         retired — Buy Alert / Near Trigger are thresholds on the same
//         single score. The only 0-100 scale anywhere is the macro
//         Composite Stress Score.
//   #25 — Data Streams catalog section-headers + infra tiles get
//         plain-English explanations (universe_snapshots, ticker_events,
//         user_scan_data are no longer raw table names).
//   #26 — "How This Works" tile on Scanner retired; points back here.
//
// Six sections, top-to-bottom:
//   §1  Header + overview (what MacroTilt is)
//   §2  By tab — 7 real tabs, PM pitch voice
//   §3  Indicator → Category Map (auto-rendered; enriched with
//        phase/timing/measure/source/rationale per indicator)
//   §4  Composite Score Math (dual-scale CONVICTION bands +
//        historical alignment)
//   §5  Signal Score Math — single [-100, +100] composite
//   §6  Data Streams Catalog (plain English)
//
// Props (all passed from App.jsx so there is a single source of truth):
//   ind     — IND registry (IND[id] = [short, long, cat, tier, unit, dec,
//             now, mo1, mo3, m6, m12, invertDir, desc, narrative])
//   asOf    — map of id → latest-data stamp ({vix:"Apr 16 2026", ...})
//   weights — WEIGHTS map used by compScore (id → 1.5/1.2/1.0)
//   cats    — CATS map (category key → {label, color})
//   indFreq — IND_FREQ map (id → "D"|"W"|"M"|"Q")

import React, { useMemo, useState } from "react";
import FreshnessDot from "../components/FreshnessDot";
import { DATA_REGISTRY, DATA_SECTIONS, buildSearchBlob } from "../data/dataRegistry";
import {
  SECTION_WEIGHTS,
  SECTION_ORDER,
  SECTION_LABELS,
} from "../ticker/sectionComposites";

// ─── ANCHOR PREFIX ──────────────────────────────────────────────────────────
// Scrolling anchors are name-spaced so they don't collide with the
// hash-router's tab names (e.g. #home, #overview). Previously jumping to
// "#methodology-overview" pulled the first section into view but the
// router would then re-interpret the raw label "overview" on any link
// under it. The guard: unique prefix + onClick preventDefault + manual
// scrollIntoView so the URL hash never mutates.
const A = (slug) => `mth__${slug}`;

// Smooth-scroll helper used by every jump link + TOC anchor.
function scrollToAnchor(id) {
  const el = typeof document !== "undefined" ? document.getElementById(id) : null;
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── CONVICTION MIRROR (v2.1 recalibrated) ──────────────────────────────────
// SD bands derived from scripts/conviction-backtest.js run against the full
// 2006-01-03 → 2026-04-22 composite history. Thresholds chosen at p60 /
// p85 / p97.5 so the worst crises in the sample (GFC 2.27 / COVID 2.02)
// sit firmly in EXTREME while 2022 bear (0.80) and SVB (0.67) sit in
// ELEVATED. Previously both were miscalibrated to NORMAL (old NORMAL
// ceiling was 0.88). App.jsx CONVICTION constant updated to match.
const CONVICTION_MIRROR = [
  { level:1, label:"LOW",      range:[-99,   0.12], color:"#30d158", hundred:"< 28",      eq:90, bd:5,  ca:3,  au:2,
    action:"Risk-on. Historically benign — bottom 60% of the 2006-2026 distribution. Add cyclical beta on pullbacks." },
  { level:2, label:"NORMAL",   range:[0.12,  0.41], color:"#B8860B", hundred:"28 – 35",   eq:75, bd:15, ca:7,  au:3,
    action:"Baseline tape. Maintain diversified exposure. Trim highest-beta into spikes. 25% of history." },
  { level:3, label:"ELEVATED", range:[0.41,  1.03], color:"#ff9f0a", hundred:"35 – 51",   eq:55, bd:28, ca:12, au:5,
    action:"Active hedging warranted. Sell covered calls, rotate defensive, reduce leverage. Includes 2022 bear + SVB + 2015-16 selloffs." },
  { level:4, label:"EXTREME",  range:[1.03,  99  ], color:"#ff453a", hundred:"≥ 51",      eq:20, bd:30, ca:35, au:15,
    action:"Crisis regime. Maximum defensiveness, harvest losses, hold dry powder. Top ~2.5% of history — GFC + COVID lived here." },
];

// Historical alignment table — composite SD at the peak of each named
// stress episode (from scripts/conviction-backtest.js). Mirrored so the
// methodology page can show "where GFC/COVID actually sit" alongside
// the new band thresholds.
const HISTORICAL_PEAKS = [
  { label:"GFC (Lehman)",              when:"2008-10-15", sd:2.27, h100:82, band:"EXTREME" },
  { label:"COVID shock",               when:"2020-04-01", sd:2.02, h100:75, band:"EXTREME" },
  { label:"2022 bear",                 when:"2022-10-22", sd:0.80, h100:45, band:"ELEVATED" },
  { label:"SVB / regional-bank",       when:"2023-03-18", sd:0.67, h100:42, band:"ELEVATED" },
  { label:"2015-16 selloff",           when:"2016-01-16", sd:0.59, h100:40, band:"ELEVATED" },
  { label:"2011 euro / debt ceiling",  when:"2011-12-31", sd:0.39, h100:35, band:"NORMAL" },
  { label:"Q4 2018 selloff",           when:"2018-12-31", sd:0.32, h100:33, band:"NORMAL" },
];

// ─── INDICATOR_META — enrichment for the Category Map (Item 21) ─────────────
// One entry per IND[id]. `phase` = observable cadence (fast daily market
// obs vs slow survey/accounting). `timing` = leading / coincident /
// lagging relative to the real economy. `measure` = plain-English read
// of what the number represents. `source` = terse provenance. `rationale`
// = why this tier ranking.
const INDICATOR_META = {
  vix:         { phase:"Fast", timing:"Coincident", source:"CBOE / FRED VIXCLS",            measure:"30-day implied S&P 500 volatility from the options market.",                                                       rationale:"T1 — real-time equity risk appetite; the most liquid read on fear." },
  hy_ig:       { phase:"Fast", timing:"Leading",    source:"FRED BAMLH0A0HYM2EY − BAMLC0A0CMEY", measure:"Extra yield investors demand for junk credit over investment-grade (bps).",                                  rationale:"T1 — bond market's real-time price of corporate default risk." },
  eq_cr_corr:  { phase:"Fast", timing:"Coincident", source:"Computed from VIX + HY-IG",     measure:"63-day rolling correlation between equity vol and credit spreads.",                                                rationale:"T1 — distinguishes a genuine risk-off regime from isolated noise." },
  yield_curve: { phase:"Fast", timing:"Leading",    source:"FRED T10Y2Y",                   measure:"10-year Treasury yield minus 2-year, in basis points.",                                                           rationale:"T1 — 40-year track record as a recession lead indicator." },
  move:        { phase:"Fast", timing:"Coincident", source:"ICE BofA MOVE Index",           measure:"Options-implied Treasury volatility across 2y/5y/10y/30y tenors.",                                                rationale:"T2 — the VIX of the bond market; flags rate-market dysfunction." },
  anfci:       { phase:"Slow", timing:"Leading",    source:"FRED ANFCI (Chicago Fed)",      measure:"Chicago Fed composite of 105 financial series, z-scored, business-cycle-adjusted.",                              rationale:"T2 — leads real-activity inflection by 1-2 quarters." },
  stlfsi:      { phase:"Slow", timing:"Coincident", source:"FRED STLFSI4 (St. Louis Fed)",  measure:"Principal-component composite of 18 weekly stress series (yields, spreads, vol).",                                rationale:"T2 — Fed-constructed broad-stress index; more volatile than ANFCI." },
  real_rates:  { phase:"Fast", timing:"Coincident", source:"FRED DFII10",                   measure:"10-year TIPS yield — market-implied real cost of long-term borrowing.",                                          rationale:"T2 — valuation compressor for long-duration (growth) equities." },
  sloos_ci:    { phase:"Slow", timing:"Leading",    source:"FRED DRTSCILM (Fed SLOOS)",     measure:"Net % of banks tightening Commercial & Industrial loan standards.",                                                rationale:"T2 — leads credit events by 1-2 quarters; GFC peak 84%." },
  cape:        { phase:"Slow", timing:"Lagging",    source:"Shiller dataset (Yale)",        measure:"S&P 500 price ÷ 10-year trailing CPI-adjusted earnings.",                                                          rationale:"T2 — weak timer, strong 10-year forward-return predictor." },
  ism:         { phase:"Slow", timing:"Coincident", source:"Institute for Supply Management", measure:"Diffusion index of 5 manufacturing subcomponents; 50 = expansion/contraction boundary.",                        rationale:"T2 — the OG manufacturing barometer; <45 has preceded every recession since 1970 (ex-1967)." },
  copper_gold: { phase:"Fast", timing:"Leading",    source:"CME HG1 / GC1 ratio",           measure:"Industrial-metal (copper) demand divided by safe-haven (gold) demand.",                                            rationale:"T2 — real-economy optimism vs. fear in a single number." },
  bkx_spx:     { phase:"Fast", timing:"Coincident", source:"Computed KBE / SPY",            measure:"Bank-sector equity performance relative to the broad market.",                                                     rationale:"T2 — preceded the SVB collapse; bank-sector stress canary." },
  bank_unreal: { phase:"Slow", timing:"Lagging",    source:"FDIC Quarterly Banking Profile", measure:"Aggregate AFS+HTM unrealized securities losses ÷ Tier 1 capital.",                                               rationale:"T2 — SVB was at 104% before failure; aggregate >20% = no margin." },
  credit_3y:   { phase:"Slow", timing:"Leading",    source:"FRED TOTBKCR 3-year growth",    measure:"3-year cumulative growth in total bank credit (loans + securities).",                                              rationale:"T2 — captures buildup of system-wide credit fragility over a cycle." },
  term_premium:{ phase:"Slow", timing:"Coincident", source:"Fed Board (Kim-Wright model)",  measure:"Extra yield demanded for holding a 10Y Treasury over rolling short bills.",                                        rationale:"T3 — structural tightening independent of Fed policy." },
  cmdi:        { phase:"Fast", timing:"Coincident", source:"NY Fed CMDI",                   measure:"Composite of primary-market issuance, secondary liquidity, and pricing dislocations in corporate credit.",        rationale:"T3 — contextual; leading indicator for credit availability." },
  loan_syn:    { phase:"Fast", timing:"Coincident", source:"FRED BAMLH0A0HYM2EY",           measure:"ICE BofA US High Yield Index all-in effective yield.",                                                              rationale:"T3 — refinancing pressure gauge for leveraged-finance issuers." },
  usd:         { phase:"Fast", timing:"Coincident", source:"Yahoo DX-Y.NYB",                 measure:"ICE US Dollar Index — geometric mean of USD against six major currencies (EUR/JPY/GBP/CAD/SEK/CHF). The dollar index trading desks reference intraday.", rationale:"T3 — strong $ tightens global conditions; hits EM + commodity exposures." },
  cpff:        { phase:"Fast", timing:"Coincident", source:"FRED DCPF3M − DFF",             measure:"3M AA commercial paper yield minus effective Fed Funds rate, in bps.",                                            rationale:"T3 — short-term corporate funding stress gauge (GFC peak 280bps)." },
  skew:        { phase:"Fast", timing:"Leading",    source:"CBOE SKEW",                     measure:"Implied probability of a >2SD S&P 500 decline from far-OTM put pricing.",                                          rationale:"T3 — tail-risk positioning; contrarian when elevated alongside low VIX." },
  sloos_cre:   { phase:"Slow", timing:"Leading",    source:"FRED DRTSCLCC (Fed SLOOS)",     measure:"Net % of banks tightening Commercial Real Estate lending standards.",                                              rationale:"T3 — office/retail CRE sensitivity; leads CRE credit events." },
  bank_credit: { phase:"Slow", timing:"Coincident", source:"FRED TOTBKCR YoY",              measure:"Year-over-year growth in total bank credit (loans + securities).",                                                 rationale:"T3 — real-economy credit pulse; <3% signals tightening feeding through." },
  jobless:     { phase:"Fast", timing:"Leading",    source:"FRED ICSA (US DOL)",            measure:"Weekly count of new unemployment-insurance filings (thousands).",                                                  rationale:"T3 — most timely high-frequency labor signal; sustained >300K = early recession." },
  jolts_quits: { phase:"Slow", timing:"Coincident", source:"FRED JTSQUR (BLS JOLTS)",       measure:"Voluntary quits as a percentage of total nonfarm employment.",                                                     rationale:"T3 — worker confidence = wage pressure direction." },
  // ─── 9 NEW SERIES (added 2026-04-24) — meta for the catalog table ──────
  m2_yoy:       { phase:"Slow", timing:"Leading",    source:"FRED M2SL (YoY)",                    measure:"Year-over-year growth in the M2 money stock — Friedman's medium-term monetary impulse to asset prices.",                                       rationale:"T1 — sustained >7% historically associated with looser conditions and higher asset valuations." },
  fed_bs:       { phase:"Slow", timing:"Coincident", source:"FRED WALCL (YoY)",                   measure:"Year-over-year change in the Fed's total assets — headline QE/QT measure.",                                                                       rationale:"T2 — direction of policy liquidity injection or withdrawal." },
  rrp:          { phase:"Fast", timing:"Coincident", source:"FRED RRPONTSYD",                     measure:"Cash parked at the Fed's overnight reverse-repo facility — liquidity drag from money-market funds.",                                              rationale:"T2 — falling take-up signals liquidity being pulled into private credit." },
  bank_reserves:{ phase:"Slow", timing:"Coincident", source:"FRED WRESBAL",                       measure:"Total reserves held by depository institutions at the Fed — system liquidity floor.",                                                              rationale:"T2 — Fed-signaled ample-reserves floor near $3T; sustained below = banking-system tightening." },
  tga:          { phase:"Slow", timing:"Coincident", source:"FRED WTREGEN",                       measure:"Treasury cash at the Fed — high withdraws liquidity from bank reserves; low adds it back.",                                                       rationale:"T2 — mechanical inverse to RRP and bank reserves." },
  breakeven_10y:{ phase:"Fast", timing:"Leading",    source:"FRED T10YIE",                        measure:"Bond market's read on average annual CPI inflation over the next decade (10Y nominal − 10Y TIPS).",                                                rationale:"T2 — long-run anchor near 2.0–2.5%; sustained >3% reflects inflation-regime concerns." },
  cfnai:        { phase:"Slow", timing:"Coincident", source:"FRED CFNAI",                         measure:"85-component composite of monthly economic activity (production / employment / consumption / sales).",                                              rationale:"T1 — readings above 0 = above-trend growth; sustained below −0.7 historically signals recession." },
  cfnai_3ma:    { phase:"Slow", timing:"Coincident", source:"FRED CFNAI 3-month avg",             measure:"Smoothed 3-month moving average of CFNAI — Fed's preferred read because the monthly series is noisy.",                                              rationale:"T1 — sustained −0.7 in this 3-month average is the standard recession-risk threshold." },
  hy_ig_etf:    { phase:"Fast", timing:"Coincident", source:"Yahoo (LQD ÷ HYG)",                  measure:"LQD/HYG price ratio — Yahoo-sourced proxy for HY-IG spread that backfills the 2007–2023 window.",                                                  rationale:"Reference indicator only — NOT a substitute for the FRED OAS series in composite math." },
};

// Color for a phase / timing pill (soft, not alarming).
const PHASE_COLOR = { Fast: "#06b6d4", Slow: "#a78bfa" };
const TIMING_COLOR = { Leading: "#30d158", Coincident: "#B8860B", Lagging: "#94a3b8" };
// Tier color — chip tint reflects weight (T1 heavy, T2 medium, T3 light).
const TIER_COLOR = { 1:"#ff453a", 2:"#ff9f0a", 3:"#06b6d4" };

// Frequency color accents for freq pills on tiles.
const FREQ_COLORS = { Daily:"var(--accent)", Weekly:"#14b8a6", Monthly:"#f59e0b", Quarterly:"#a78bfa" };
function freqAccent(freq) {
  if (!freq) return "var(--text-dim)";
  for (const [k, v] of Object.entries(FREQ_COLORS)) { if (freq.startsWith(k)) return v; }
  return "#ec4899";
}
// Indicator-frequency labels (D/W/M/Q → human words).
const FREQ_LABEL = { D:"Daily", W:"Weekly", M:"Monthly", Q:"Quarterly" };

// Precompute search blobs once per registry entry.
const REGISTRY_WITH_BLOBS = DATA_REGISTRY.map((row) => ({ ...row, _blob: buildSearchBlob(row) }));

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function MethodologyPage({ ind, asOf, asOfIso, weights, cats, indFreq }) {
  // Collapse-state for top-level sections. Default = all collapsed so the
  // page opens as a one-screen TOC. Joe directive 2026-04-27: "this page
  // is so long" — start compact, let the reader expand on demand.
  const [open, setOpen] = useState({
    catmap: false,
    compmath: false,
    alloc: false,
    catalog: false,
    signal: false,
  });
  const toggle = (k) => setOpen((s) => ({ ...s, [k]: !s[k] }));
  const expand = (k) => setOpen((s) => ({ ...s, [k]: true }));
  const expandAll = () => setOpen({ catmap:true, compmath:true, alloc:true, catalog:true, signal:true });
  const collapseAll = () => setOpen({ catmap:false, compmath:false, alloc:false, catalog:false, signal:false });

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
      <HeaderOverview />
      <Contents ind={ind} expand={expand} expandAll={expandAll} collapseAll={collapseAll} />
      <MacroIndicatorTable
        ind={ind} weights={weights} cats={cats} indFreq={indFreq}
        asOf={asOf} asOfIso={asOfIso}
        open={open.catmap} onToggle={() => toggle("catmap")} />
      <CompositeMath
        ind={ind} weights={weights} cats={cats}
        open={open.compmath} onToggle={() => toggle("compmath")} />
      <AssetAllocationMethodology
        open={open.alloc} onToggle={() => toggle("alloc")} />
      <DataCatalogTable
        ind={ind} asOf={asOf}
        open={open.catalog} onToggle={() => toggle("catalog")} />
      <SignalScoreMath
        open={open.signal} onToggle={() => toggle("signal")} />
      <Disclaimer />
    </div>
  );
}

// ─── §1 HEADER + OVERVIEW ───────────────────────────────────────────────────
function HeaderOverview() {
  return (
    <section id={A("overview")} data-testid="methodology-section-overview"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
        Data & Methodology
      </div>
      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7, maxWidth: 880 }}>
        Four sections. First the macro indicator → composite chain, then the per-ticker signal
        chain, then the full catalog of every data stream that feeds the site.
      </div>
    </section>
  );
}

// ─── CONTENTS (multi-level TOC) ─────────────────────────────────────────────
// 2026-04-27 rebuild (Joe's 4 asks):
//   1. Multi-level — every top-level section now lists its sub-anchors so
//      the page is navigable without scrolling 1300 lines of prose.
//   2. Live counts — the indicator count and scanner-stream count come from
//      the data props (Object.keys(ind).length, rows.length on the catalog
//      table), so adding indicators in App.jsx auto-updates the page.
//   3. Pairs with the collapsible-section refactor — clicking a sub-link
//      auto-expands the parent before scrolling to the anchor.
//   4. Expand-all / Collapse-all controls so the page can collapse to a
//      one-screen overview, then expand whatever section the reader wants.
function Contents({ ind, expand, expandAll, collapseAll }) {
  const indCount = ind ? Object.keys(ind).length : 0;
  const items = [
    {
      key: "catmap",
      num: "1",
      label: "Macro Mapping & Data Sources",
      sub: `${indCount} macro indicators — source, frequency, last refresh, tier, weight, type.`,
      id: A("catmap"),
      children: [
        { num: "1.1", label: "Indicator catalog (sortable)",     id: A("catmap") },
        { num: "1.2", label: "Data freshness — what the dots mean", id: "freshness-explainer" },
      ],
    },
    {
      key: "compmath",
      num: "2",
      label: "Macro Methodology",
      sub: `How the ${indCount} indicators roll up into one 0–100 Composite Stress Score and four conviction bands.`,
      id: A("composite-math"),
      children: [
        { num: "2.1", label: "z-score, sign-flip, tier weights", id: A("composite-math") },
        { num: "2.2", label: "Conviction bands + history alignment", id: A("composite-math") },
      ],
    },
    {
      key: "alloc",
      num: "3",
      label: "Asset Allocation",
      sub: "How the strategic allocation is built — universe, factor maps, 9-step pipeline, back-test.",
      id: "mth__asset-alloc",
      children: [
        { num: "3.1",  label: "Universe — 25 industry groups + defensive sleeve", id: "mth__alloc-universe" },
        { num: "3.2",  label: "Inputs",                                            id: "mth__alloc-inputs" },
        { num: "3.3",  label: "Per-asset factor maps",                             id: "mth__alloc-factor-maps" },
        { num: "3.4",  label: "Logic — 9-step pipeline",                           id: "mth__alloc-logic" },
        { num: "3.5",  label: "Confirmatory rule & regime-flip override",          id: "mth__alloc-confirm" },
        { num: "3.6",  label: "Top-5 equal-weighted — trade-offs",                 id: "mth__alloc-top5" },
        { num: "3.7",  label: "Back-test results",                                 id: "mth__alloc-backtest" },
        { num: "3.8",  label: "Honest limitations",                                id: "mth__alloc-limits" },
        { num: "3.9",  label: "Refinement process",                                id: "mth__alloc-refine" },
        { num: "3.10", label: "Citations",                                         id: "mth__alloc-cites" },
        { num: "3.11", label: "What can break this",                               id: "mth__alloc-break" },
      ],
    },
    {
      key: "catalog",
      num: "4",
      label: "Equity Scanner Data Sources",
      sub: "The upstream streams that feed the per-ticker Signal Score — section + weight each carries.",
      id: A("catalog"),
      children: [],
    },
    {
      key: "signal",
      num: "5",
      label: "Equity Scanner Methodology",
      sub: "How six section sub-scores combine into a single signed composite on [−100, +100] per ticker.",
      id: A("signal-math"),
      children: [],
    },
  ];
  return (
    <nav data-testid="methodology-contents" aria-label="Contents"
      style={{ display:"flex", flexDirection:"column", gap:0,
               border:"1px solid var(--border)", borderRadius:8,
               background:"var(--surface)", overflow:"hidden" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"8px 12px", borderBottom:"1px solid var(--border)",
                    background:"var(--surface-2)" }}>
        <div style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                      letterSpacing:"0.08em", textTransform:"uppercase" }}>
          Contents
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={expandAll}
            style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--accent)",
                     background:"transparent", border:"1px solid var(--accent)",
                     borderRadius:3, padding:"3px 8px", cursor:"pointer",
                     letterSpacing:"0.05em", textTransform:"uppercase" }}>
            Expand all
          </button>
          <button onClick={collapseAll}
            style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                     background:"transparent", border:"1px solid var(--border-strong)",
                     borderRadius:3, padding:"3px 8px", cursor:"pointer",
                     letterSpacing:"0.05em", textTransform:"uppercase" }}>
            Collapse all
          </button>
        </div>
      </div>
      {items.map((it, i) => (
        <div key={it.id}
             style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
          <a href={`#${it.id}`}
             onClick={(e) => { e.preventDefault(); expand(it.key); setTimeout(() => scrollToAnchor(it.id), 50); }}
             style={{ display:"flex", alignItems:"baseline", gap:12,
                      padding:"10px 12px", textDecoration:"none", color:"var(--text)",
                      cursor:"pointer" }}>
            <span style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                           width:18, flexShrink:0 }}>
              {it.num}.
            </span>
            <span style={{ fontSize:13, fontWeight:600, minWidth:240, color:"var(--text)" }}>
              {it.label}
            </span>
            <span style={{ fontSize:11, color:"var(--text-muted)", lineHeight:1.5, flex:1 }}>
              {it.sub}
            </span>
          </a>
          {it.children.length > 0 && (
            <div style={{ paddingLeft:42, paddingRight:12, paddingBottom:8,
                          display:"flex", flexDirection:"column", gap:2 }}>
              {it.children.map((c) => (
                <a key={c.num + c.id} href={`#${c.id}`}
                   onClick={(e) => { e.preventDefault(); expand(it.key); setTimeout(() => scrollToAnchor(c.id), 50); }}
                   style={{ display:"flex", alignItems:"baseline", gap:10,
                            padding:"3px 0", textDecoration:"none", color:"var(--text-2)",
                            cursor:"pointer", fontSize:12 }}>
                  <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                                 width:32, flexShrink:0 }}>
                    {c.num}
                  </span>
                  <span style={{ color:"var(--text-2)" }}>{c.label}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

// ─── §2 MACRO MAPPING & DATA SOURCES (sortable table) ──────────────────────
function MacroIndicatorTable({ ind, weights, cats, indFreq, asOf, asOfIso, open, onToggle }) {
  const rows = useMemo(() => {
    if (!ind) return [];
    return Object.keys(ind).map((id) => {
      const r = ind[id] || [];
      const meta = INDICATOR_META[id] || {};
      const w = (weights && weights[id]) || 0;
      const tier = w >= 1.5 ? 1 : w >= 1.2 ? 2 : 3;
      const catKey = r[2] || "";
      const cat = (cats && cats[catKey]) || {};
      return {
        id,
        short: r[0] || id,
        catKey,
        catLabel: cat.label || catKey,
        catColor: cat.color || "#94a3b8",
        source: meta.source || "",
        freq: (indFreq && indFreq[id]) || "",
        asOf: (asOf && asOf[id]) || "",
        asOfIso: (asOfIso && asOfIso[id]) || "",
        tier,
        weight: w,
        timing: meta.timing || "",
        detail: meta.measure || "",
      };
    });
  }, [ind, weights, cats, indFreq, asOf, asOfIso]);

  const [sortKey, setSortKey] = useState("tier");
  const [sortDir, setSortDir] = useState("asc");

  const CAT_ORDER = ["equity","credit","rates","fincond","bank","labor"];
  const FREQ_ORDER = { D:1, W:2, M:3, Q:4, Y:5 };
  const TIMING_ORDER = { Leading:1, Coincident:2, Lagging:3 };

  const sorted = useMemo(() => {
    const arr = [...rows];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case "num":    av = a.tier; bv = b.tier; break;
        case "short":  av = a.short.toLowerCase(); bv = b.short.toLowerCase(); break;
        case "catKey": av = CAT_ORDER.indexOf(a.catKey); bv = CAT_ORDER.indexOf(b.catKey); break;
        case "source": av = a.source.toLowerCase(); bv = b.source.toLowerCase(); break;
        case "freq":   av = FREQ_ORDER[a.freq] || 99; bv = FREQ_ORDER[b.freq] || 99; break;
        case "asOf":   av = Date.parse(a.asOf) || 0; bv = Date.parse(b.asOf) || 0; break;
        case "tier":   av = a.tier; bv = b.tier; break;
        case "weight": av = a.weight; bv = b.weight; break;
        case "timing": av = TIMING_ORDER[a.timing] || 99; bv = TIMING_ORDER[b.timing] || 99; break;
        case "detail": av = a.detail.toLowerCase(); bv = b.detail.toLowerCase(); break;
        default:       av = 0; bv = 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      const ca = CAT_ORDER.indexOf(a.catKey), cb = CAT_ORDER.indexOf(b.catKey);
      if (ca !== cb) return ca - cb;
      return a.short.localeCompare(b.short);
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  function onSort(k) {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  }

  const COLS = [
    { k:"num",    label:"#",            align:"right"  },
    { k:"short",  label:"Indicator",    align:"left"   },
    { k:"catKey", label:"Category",     align:"left"   },
    { k:"source", label:"Source",       align:"left"   },
    { k:"freq",   label:"Frequency",    align:"center" },
    { k:"asOf",   label:"Last Refresh", align:"left"   },
    { k:"tier",   label:"Tier",         align:"center" },
    { k:"weight", label:"Weight",       align:"right"  },
    { k:"timing", label:"Type",         align:"center" },
    { k:"detail", label:"Detail",       align:"left"   },
  ];

  return (
    <section id={A("catmap")} data-testid="methodology-section-catmap"
      style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <CollapsibleSectionHeader
        label="1 · MACRO MAPPING & DATA SOURCES"
        sub={`${rows.length} macro indicators · sortable`}
        applies={[
          { id:"overview",   label:"Macro Overview",  path:"#overview" },
          { id:"indicators", label:"All Indicators",  path:"#indicators" },
        ]}
        open={open}
        onToggle={onToggle}
      />
      {open && (<>
      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.65, maxWidth:880 }}>
        Click a column header to sort. <strong>Frequency</strong> is how often the underlying source
        refreshes (D = daily, W = weekly, M = monthly, Q = quarterly). <strong>Tier</strong> sets the
        indicator's weight in the Composite — T1 = 1.5× (market-sensitive), T2 = 1.2× (important but
        slower), T3 = 1.0× (structural / context). <strong>Type</strong> = leading / coincident / lagging
        vs. real-economy activity.
      </div>

      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8,
                    overflow:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"var(--font-mono)" }}>
          <thead>
            <tr style={{ color:"var(--text-dim)", background:"var(--surface-2)" }}>
              {COLS.map((c) => (
                <th key={c.k}
                    onClick={() => onSort(c.k)}
                    style={{ ...thStyle, textAlign:c.align, cursor:"pointer", userSelect:"none",
                             whiteSpace:"nowrap" }}>
                  {c.label}
                  <span style={{ marginLeft:4, color: sortKey === c.k ? "var(--accent)" : "transparent" }}>
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => (
              <tr key={r.id} style={{ borderTop:"1px solid var(--border)" }}>
                <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-dim)",
                             fontFamily:"var(--font-mono)", whiteSpace:"nowrap", width:32 }}>
                  {idx + 1}
                </td>
                <td style={{ ...tdStyle, fontWeight:700, color:"var(--text)", whiteSpace:"nowrap" }}>
                  {r.short}
                </td>
                <td style={{ ...tdStyle }}>
                  <span style={{ fontSize:10, color:r.catColor, border:`1px solid ${r.catColor}`,
                                 borderRadius:3, padding:"1px 6px", letterSpacing:"0.05em",
                                 textTransform:"uppercase", whiteSpace:"nowrap" }}>
                    {r.catLabel}
                  </span>
                </td>
                <td style={{ ...tdStyle, color:"var(--text-2)" }}>{r.source || "—"}</td>
                <td style={{ ...tdStyle, textAlign:"center", color:"var(--text-2)" }}>{r.freq || "—"}</td>
                <td style={{ ...tdStyle, color:"var(--text-2)", whiteSpace:"nowrap" }}>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                    <FreshnessDot indicatorId={r.id} asOfIso={r.asOfIso} cadence={r.freq}/>
                    {r.asOf || "—"}
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign:"center", fontWeight:700, color:TIER_COLOR[r.tier] }}>
                  T{r.tier}
                </td>
                <td style={{ ...tdStyle, textAlign:"right", color:"var(--text)" }}>
                  {r.weight ? `${r.weight.toFixed(1)}×` : "—"}
                </td>
                <td style={{ ...tdStyle, textAlign:"center" }}>
                  <span style={{ fontSize:10, color:TIMING_COLOR[r.timing] || "var(--text-dim)",
                                 border:`1px solid ${TIMING_COLOR[r.timing] || "var(--border)"}`,
                                 borderRadius:3, padding:"1px 6px", letterSpacing:"0.05em",
                                 textTransform:"uppercase", whiteSpace:"nowrap" }}>
                    {r.timing || "—"}
                  </span>
                </td>
                <td style={{ ...tdStyle, color:"var(--text-muted)", lineHeight:1.6, minWidth:320 }}>
                  {r.detail || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FreshnessExplainer />
      </>)}
    </section>
  );
}

// ─── DATA FRESHNESS EXPLAINER ──────────────────────────────────────────────
// Anchor target for every FreshnessDot click on the site. Plain English,
// no acronyms (per Joe 2026-04-23). The dot is the at-a-glance signal,
// this is the page that explains what "stale" actually means.
function FreshnessExplainer() {
  const swatch = (color) => ({
    display: "inline-block", width: 10, height: 10, borderRadius: "50%",
    background: color, marginRight: 8, verticalAlign: "middle",
  });
  return (
    <section id="freshness-explainer" style={{ scrollMarginTop: 80 }}>
      <SectionHeader
        label="1.2 · DATA FRESHNESS — what the colored dots mean"
        sub="Every indicator has a small dot · green = current · amber = a little overdue · red = stale or missing"
      />
      <div style={{ marginTop: 12,
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "16px 20px", lineHeight: 1.7, color: "var(--text-2)",
        fontSize: 13,
      }}>
        <p style={{ margin: "0 0 14px" }}>
          We re-check every indicator every 30 minutes against its expected release schedule.
          A daily indicator like the VIX should refresh every weekday, so if today's VIX dot is
          green it means the site is showing a value from within the last day or so. A weekly
          indicator like Initial Jobless Claims releases on Thursday morning — its dot stays
          green from Thursday through the following Wednesday because that's the actual release
          cadence. Click any dot anywhere on the site to land back on this page.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
          <div>
            <span style={swatch("#1f9d60")}/>
            <strong style={{ color: "#1f9d60" }}>Fresh</strong>
            <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
              — within the indicator's normal release cadence. Nothing to worry about.
            </span>
          </div>
          <div>
            <span style={swatch("#b8811c")}/>
            <strong style={{ color: "#b8811c" }}>Overdue</strong>
            <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
              — between one and two release cycles late. Often legitimate (a holiday, a
              release-day shift) but worth a glance. We start watching but don't alert yet.
            </span>
          </div>
          <div>
            <span style={swatch("#d23040")}/>
            <strong style={{ color: "#d23040" }}>Stale</strong>
            <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
              — more than two release cycles late, or the last fetch hit an error. The
              monitoring job emails Joe automatically (debounced, max one per day per
              indicator) so the data pipeline can be repaired.
            </span>
          </div>
          <div>
            <span style={{ ...swatch("#bbb4a3") }}/>
            <strong style={{ color: "var(--text-muted)" }}>Grey</strong>
            <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
              — freshness is being checked, or this indicator isn't yet tracked by the
              monitor. Treat as informational only.
            </span>
          </div>
        </div>

        <p style={{ margin: "16px 0 6px", fontWeight: 600, color: "var(--text)" }}>
          Why a daily indicator can show "Fresh" for two days
        </p>
        <p style={{ margin: 0 }}>
          Most "daily" series like FRED's VIX don't release a number every calendar day —
          they skip weekends and US bank holidays. The freshness rules build in a 6-hour
          grace period for daily series, 48 hours for weekly, ten days for monthly, and
          thirty days for quarterly to handle release-schedule reality (FRED monthly releases
          land 4–6 weeks after month-end; Senior Loan Officer surveys are 6–10 weeks delayed).
          The dot reflects whether the data is on its expected schedule, not whether the
          calendar moved.
        </p>

        <p style={{ margin: "16px 0 6px", fontWeight: 600, color: "var(--text)" }}>
          When something turns red
        </p>
        <p style={{ margin: 0 }}>
          A red dot generally means the data pipeline has broken silently — Yahoo throttled,
          FRED returned an empty series, the scheduled scanner workflow didn't run. The
          alerting job emails Joe so the pipeline can be fixed. The site keeps showing
          whatever the last good value was; no value silently drifts.
        </p>
      </div>
    </section>
  );
}

// ─── §3 MACRO METHODOLOGY ──────────────────────────────────────────────────
function CompositeMath({ ind, weights, open, onToggle }) {
  // Tier distribution pulled live from WEIGHTS.
  const tierBuckets = useMemo(() => {
    const buckets = { 1:[], 2:[], 3:[] };
    if (!ind || !weights) return buckets;
    Object.keys(weights).forEach((id) => {
      const w = weights[id];
      const tier = w >= 1.5 ? 1 : w >= 1.2 ? 2 : 3;
      const short = ind[id]?.[0] || id;
      buckets[tier].push(short);
    });
    return buckets;
  }, [ind, weights]);

  const tierRows = [
    { tier:1, weight:1.5, label:"most market-sensitive" },
    { tier:2, weight:1.2, label:"important but less real-time" },
    { tier:3, weight:1.0, label:"structural / context" },
  ];

  return (
    <section id={A("composite-math")} data-testid="methodology-section-compmath"
      style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <CollapsibleSectionHeader
        label="2 · MACRO METHODOLOGY"
        sub={`How the ${ind ? Object.keys(ind).length : 0} indicators roll up into one number`}
        applies={[
          { id:"home",     label:"Home",           path:"#home" },
          { id:"overview", label:"Macro Overview", path:"#overview" },
        ]}
        open={open}
        onToggle={onToggle}
      />
      {open && (<>

      <Prose>
        <P><strong>Step 1 — z-score each indicator against its own history.</strong> Mean and standard
        deviation are computed from each indicator's own full history, so the question is <em>"how unusual
        is today's reading for this particular metric?"</em> not <em>"how high is this number?"</em>. A VIX
        of 20 is a different signal than an ISM of 20. Formula: <code>z = (v − μ<sub>id</sub>) /
        σ<sub>id</sub></code>.</P>

        <P><strong>Step 2 — flip sign where lower is worse.</strong> Most indicators point the same way
        ("up = stress") but some are inverted — yield curve inversion (low = recessionary), ISM PMI (low =
        contraction), copper/gold (low = growth fear), CAPE (high = rich valuation = stress). Those get
        sign-flipped so every contributor runs the same direction before aggregation. Controlled by each
        indicator's direction flag in <code>IND[id][11]</code>.</P>

        <P><strong>Step 3 — apply tier weights.</strong> The {ind ? Object.keys(ind).length : 0} indicators split into three tiers by market
        sensitivity:</P>
      </Prose>

      {/* Tier table — auto-rendered from WEIGHTS. */}
      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"var(--font-mono)" }}>
          <thead>
            <tr style={{ color:"var(--text-dim)", background:"var(--surface-2)" }}>
              <th style={thStyle}>Tier</th>
              <th style={{ ...thStyle, textAlign:"right" }}>Weight</th>
              <th style={{ ...thStyle, textAlign:"center" }}>Count</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Indicators</th>
            </tr>
          </thead>
          <tbody>
            {tierRows.map((row) => (
              <tr key={row.tier} style={{ borderTop:"1px solid var(--border)" }}>
                <td style={{ ...tdStyle, fontWeight:700, color:TIER_COLOR[row.tier] }}>T{row.tier}</td>
                <td style={{ ...tdStyle, textAlign:"right", color:"var(--text)" }}>{row.weight.toFixed(1)}×</td>
                <td style={{ ...tdStyle, textAlign:"center", color:"var(--text-2)" }}>
                  {tierBuckets[row.tier]?.length || 0}
                </td>
                <td style={{ ...tdStyle, color:"var(--text-2)" }}>{row.label}</td>
                <td style={{ ...tdStyle, color:"var(--text-muted)" }}>
                  {(tierBuckets[row.tier] || []).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Prose>
        <P><strong>Step 4 — weighted average.</strong> The Composite is the weighted mean of the z-scored,
        sign-flipped indicators:</P>
        <Formula>COMP = Σ(z<sub>id</sub> × W<sub>id</sub>) / Σ(W<sub>id</sub>)</Formula>
        <P>Only indicators with a non-null reading in the current snapshot contribute — a missing data point
        drops out of the numerator and denominator, so it doesn't falsely pull the composite toward zero.</P>

        <P><strong>Step 5 — rescale for display.</strong> The raw Composite is in SD units (negative =
        benign, positive = stress). The 0–100 gauge is a linear rescale clamped to [0, 100]:</P>
        <Formula>COMP<sub>100</sub> = clamp(((COMP + 1) / 4) × 100, 0, 100)</Formula>
        <P>So an SD-unit composite of 0 renders as 25, +1 as 50, +3 as 100. The bands below are named on the
        SD scale; the gauge shows the rescaled value.</P>

        <P><strong>Step 6 — classify into a conviction band.</strong> Four bands — LOW / NORMAL / ELEVATED
        / EXTREME — were <strong>recalibrated 2026-04-22</strong> against the full 2006-2026 composite
        history (see <code>scripts/conviction-backtest.js</code>). Thresholds anchor at the 60th, 85th, and
        97.5th percentiles of the daily distribution, so EXTREME corresponds to the top ~2.5% of history.</P>
      </Prose>

      {/* Conviction bands — auto-rendered from CONVICTION_MIRROR, dual-scale. */}
      <div>
        <div style={{ fontSize:10, color:"var(--text-dim)", fontFamily:"var(--font-mono)",
                      letterSpacing:"0.08em", marginBottom:8 }}>
          CONVICTION BANDS (dual-scale)
        </div>
        <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"var(--font-mono)" }}>
            <thead>
              <tr style={{ color:"var(--text-dim)", background:"var(--surface-2)" }}>
                <th style={thStyle}>Band</th>
                <th style={thStyle}>SD range</th>
                <th style={thStyle}>0–100 range</th>
                <th style={{ ...thStyle, textAlign:"center" }}>EQ</th>
                <th style={{ ...thStyle, textAlign:"center" }}>BD</th>
                <th style={{ ...thStyle, textAlign:"center" }}>CA</th>
                <th style={{ ...thStyle, textAlign:"center" }}>AU</th>
                <th style={thStyle}>Guidance</th>
              </tr>
            </thead>
            <tbody>
              {CONVICTION_MIRROR.map((c) => {
                const rng = c.range[0] === -99 ? `< ${c.range[1].toFixed(2)}`
                          : c.range[1] ===  99 ? `≥ ${c.range[0].toFixed(2)}`
                          : `${c.range[0].toFixed(2)} – ${c.range[1].toFixed(2)}`;
                return (
                  <tr key={c.label} style={{ borderTop:"1px solid var(--border)" }}>
                    <td style={{ ...tdStyle, fontWeight:700, color:c.color }}>{c.label}</td>
                    <td style={{ ...tdStyle, color:"var(--text-2)" }}>{rng}</td>
                    <td style={{ ...tdStyle, color:"var(--text-2)" }}>{c.hundred}</td>
                    <td style={{ ...tdStyle, textAlign:"center", color:"var(--text-2)" }}>{c.eq}%</td>
                    <td style={{ ...tdStyle, textAlign:"center", color:"var(--text-2)" }}>{c.bd}%</td>
                    <td style={{ ...tdStyle, textAlign:"center", color:"var(--text-2)" }}>{c.ca}%</td>
                    <td style={{ ...tdStyle, textAlign:"center", color:"var(--text-2)" }}>{c.au}%</td>
                    <td style={{ ...tdStyle, color:"var(--text-muted)" }}>{c.action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:6 }}>
          EQ / BD / CA / AU = equities / bonds / cash / alternatives (illustrative allocation shifts; not
          investment advice).
        </div>
      </div>

      {/* Historical alignment — proves the bands line up with real crises. */}
      <div>
        <div style={{ fontSize:10, color:"var(--text-dim)", fontFamily:"var(--font-mono)",
                      letterSpacing:"0.08em", marginBottom:8 }}>
          HISTORICAL ALIGNMENT — WHERE EACH NAMED STRESS EPISODE PEAKED
        </div>
        <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"var(--font-mono)" }}>
            <thead>
              <tr style={{ color:"var(--text-dim)", background:"var(--surface-2)" }}>
                <th style={thStyle}>Episode</th>
                <th style={thStyle}>Peak date</th>
                <th style={{ ...thStyle, textAlign:"right" }}>Composite (SD)</th>
                <th style={{ ...thStyle, textAlign:"right" }}>Gauge (0–100)</th>
                <th style={thStyle}>Band under new calibration</th>
              </tr>
            </thead>
            <tbody>
              {HISTORICAL_PEAKS.map((p) => {
                const band = CONVICTION_MIRROR.find(c => p.sd >= c.range[0] && p.sd < c.range[1]) || CONVICTION_MIRROR[3];
                return (
                  <tr key={p.label} style={{ borderTop:"1px solid var(--border)" }}>
                    <td style={{ ...tdStyle, color:"var(--text)" }}>{p.label}</td>
                    <td style={{ ...tdStyle, color:"var(--text-2)" }}>{p.when}</td>
                    <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-2)" }}>{p.sd.toFixed(2)}</td>
                    <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-2)" }}>{p.h100}</td>
                    <td style={{ ...tdStyle, color:band.color, fontWeight:700 }}>{band.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:6, lineHeight:1.55, maxWidth:880 }}>
          Backtest source: <code>scripts/conviction-backtest.js</code>, run against the 2006-01-03 →
          2026-04-22 composite time series (N ≈ 6,300 trading days). Previous calibration (NORMAL &lt; 0.88)
          placed the 2022 bear peak (0.80 SD) and SVB peak (0.67 SD) in NORMAL — a miscalibration the v2.1
          bands correct by pulling the ELEVATED threshold down to 0.41 SD (p85 of history).
        </div>
      </div>
      </>)}
    </section>
  );
}


// ─── §4.5 ASSET ALLOCATION METHODOLOGY ─────────────────────────────────────
// Comprehensive section — destination for every "Methodology →" link on the
// Asset Allocation tab. Documents the live v9.1 production state (25 GICS
// industry groups, top-5 equal-weighted selection, 1.5× leverage cap).
function AssetAllocationMethodology({ open, onToggle }) {
  // 25-IG universe (live in compute_v9_allocation.py).
  // type=etf has a clean single-ETF proxy; type=basket uses an equal-weighted
  // basket of constituent names because no clean ETF exists.
  const UNIVERSE_25 = [
    { sector: "Energy",                  ig: "Energy",                                      proxy: "XLE",   type: "etf" },
    { sector: "Materials",               ig: "Materials",                                   proxy: "XLB",   type: "etf" },
    { sector: "Industrials",             ig: "Capital Goods",                               proxy: "XLI",   type: "etf" },
    { sector: "Industrials",             ig: "Commercial & Professional Services",          proxy: "WM/RSG/CTAS basket", type: "basket" },
    { sector: "Industrials",             ig: "Transportation",                              proxy: "IYT",   type: "etf" },
    { sector: "Consumer Discretionary",  ig: "Automobiles & Components",                    proxy: "CARZ",  type: "etf" },
    { sector: "Consumer Discretionary",  ig: "Consumer Durables & Apparel",                 proxy: "NKE/LULU/DECK basket", type: "basket" },
    { sector: "Consumer Discretionary",  ig: "Consumer Services",                           proxy: "PEJ",   type: "etf" },
    { sector: "Consumer Discretionary",  ig: "Cons Disc Distribution & Retail",             proxy: "XRT",   type: "etf" },
    { sector: "Consumer Staples",        ig: "Cons Staples Distribution & Retail",          proxy: "WMT/COST/KR basket",   type: "basket" },
    { sector: "Consumer Staples",        ig: "Food, Beverage & Tobacco",                    proxy: "PBJ",   type: "etf" },
    { sector: "Consumer Staples",        ig: "Household & Personal Products",               proxy: "PG/CL/KMB basket",     type: "basket" },
    { sector: "Health Care",             ig: "Health Care Equipment & Services",            proxy: "IHI",   type: "etf" },
    { sector: "Health Care",             ig: "Pharmaceuticals, Biotech & Life Sciences",    proxy: "XLV",   type: "etf" },
    { sector: "Financials",              ig: "Banks",                                       proxy: "XLF",   type: "etf" },
    { sector: "Financials",              ig: "Financial Services",                          proxy: "IYG",   type: "etf" },
    { sector: "Financials",              ig: "Insurance",                                   proxy: "KIE",   type: "etf" },
    { sector: "Information Technology",  ig: "Software & Services",                         proxy: "IGV",   type: "etf" },
    { sector: "Information Technology",  ig: "Tech Hardware & Equipment",                   proxy: "AAPL/CSCO/HPQ basket", type: "basket" },
    { sector: "Information Technology",  ig: "Semiconductors & Semi Equipment",             proxy: "SOXX",  type: "etf" },
    { sector: "Communication Services",  ig: "Telecommunication Services",                  proxy: "IYZ",   type: "etf" },
    { sector: "Communication Services",  ig: "Media & Entertainment",                       proxy: "XLC",   type: "etf" },
    { sector: "Utilities",               ig: "Utilities",                                   proxy: "XLU",   type: "etf" },
    { sector: "Real Estate",             ig: "REITs",                                       proxy: "IYR",   type: "etf" },
    { sector: "Real Estate",             ig: "Real Estate Mgmt & Development",              proxy: "CBRE/JLL/SLG basket",  type: "basket" },
  ];

  const DEFENSIVE = [
    { ticker: "BIL", desc: "SPDR 1-3 Month Treasury Bill ETF", role: "cash proxy" },
    { ticker: "TLT", desc: "iShares 20+ Year Treasury Bond ETF", role: "long-duration rates" },
    { ticker: "GLD", desc: "SPDR Gold Shares", role: "real-asset hedge" },
    { ticker: "LQD", desc: "iShares iBoxx Investment Grade Corporate Bond ETF", role: "credit anchor" },
  ];

  // Equity-vs-defensive split thresholds (from compute step 6)
  const EQ_THRESHOLDS = [
    { rl: "≤ +20",     equity: "100%",       defensive: "0%",   note: "Calm regime — full equity exposure" },
    { rl: "+20 to +30", equity: "100% → 85%", defensive: "0% → 15%", note: "Linear scale-down as risk rises" },
    { rl: "+30 to +50", equity: "85% → 60%",  defensive: "15% → 40%", note: "Continued de-risking through stress" },
    { rl: "> +50",      equity: "60%",        defensive: "40%",  note: "Maximum defensive — equity floor at 60%" },
  ];

  // Leverage thresholds (from compute step 7)
  const LEV_THRESHOLDS = [
    { ir: "> +30",       lev: "1.00×", note: "Inflation hot — no leverage" },
    { ir: "0 to +30",    lev: "1.00× → 1.10×", note: "Linear scale-up as inflation eases" },
    { ir: "−10 to 0",    lev: "1.10× → 1.25×", note: "Disinflationary regime — moderate leverage" },
    { ir: "−10 to −50",  lev: "1.25× → 1.50×", note: "Deflationary regime — capped at 1.5× per Joe's directive" },
    { ir: "Override",    lev: "1.00×", note: "Force leverage = 1.0× whenever R&L > +20 (don't lever in stress)" },
  ];

  // 12 IGs without a clean single-ETF proxy
  const BASKET_IGS = UNIVERSE_25.filter(u => u.type === "basket");

  // Back-test comparison
  const BACKTEST = [
    { metric: "CAGR",                       v9: "13.88%", spy: "11.06%", sixty40: "8.02%", edge: "+2.82 pp/yr" },
    { metric: "Sharpe ratio (3-mo T-bill RF)", v9: "0.610",  spy: "0.495",  sixty40: "0.422", edge: "+0.115" },
    { metric: "Max drawdown",               v9: "−23.64%", spy: "−46.32%", sixty40: "—",      edge: "+22.7 pp" },
    { metric: "Cumulative ($1 → $X)",       v9: "$10.84",  spy: "$6.84",   sixty40: "$4.12",  edge: "+58%" },
    { metric: "Calendar years winning",     v9: "10 of 19", spy: "—",       sixty40: "—",      edge: "—" },
  ];

  const tableTh = { textAlign: "left", padding: "8px 12px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, borderBottom: "1px solid var(--border-strong)" };
  const tableThR = { ...tableTh, textAlign: "right" };
  const tableTd = { padding: "8px 12px", fontSize: 12, borderBottom: "1px solid var(--border-faint)", verticalAlign: "top" };
  const tableTdR = { ...tableTd, textAlign: "right", fontFamily: "var(--font-mono)" };

  return (
    <section id="mth__asset-alloc" data-testid="methodology-section-asset-alloc"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <CollapsibleSectionHeader
        label="3 · ASSET ALLOCATION"
        sub="How the strategic allocation is built — full v9.1 (current) methodology"
        applies={[{ id:"allocation", label:"Asset Allocation", path:"#allocation" }]}
        open={open}
        onToggle={onToggle}
      />
      {open && (<>

      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 880 }}>
        The Asset Allocation tab translates the three macro composites (Risk &amp; Liquidity, Growth, Inflation &amp; Rates) into a concrete portfolio recommendation: which industry groups to overweight, how much equity exposure to take, when to activate the defensive sleeve, and how much leverage to use. The strategy rebalances weekly on Saturdays.
      </div>

      {/* — UNIVERSE — */}
      <div id="mth__alloc-universe" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.1 · UNIVERSE" sub="25 GICS industry groups + 4 defensive assets" applies={["allocation"]} />
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 880 }}>
        The universe spans the 11 GICS sectors, decomposed into 25 industry groups under the post-March-2023 GICS structure. Implementation uses single-ETF proxies where one is available (13 of 25) and equal-weighted baskets of the largest names where no clean ETF exists (12 of 25).
      </div>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui)" }}>
          <thead><tr><th style={tableTh}>Sector</th><th style={tableTh}>Industry group</th><th style={tableTh}>Proxy</th><th style={tableTh}>Type</th></tr></thead>
          <tbody>
            {UNIVERSE_25.map((u, i) => (
              <tr key={i}>
                <td style={tableTd}>{u.sector}</td>
                <td style={tableTd}>{u.ig}</td>
                <td style={{ ...tableTd, fontFamily: "var(--font-mono)" }}>{u.proxy}</td>
                <td style={{ ...tableTd, color: u.type === "basket" ? "var(--text-muted)" : "var(--text)" }}>{u.type === "basket" ? "Basket" : "Single ETF"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 880, marginTop: 8 }}><strong>Defensive sleeve:</strong></div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui)" }}>
        <thead><tr><th style={tableTh}>Ticker</th><th style={tableTh}>Description</th><th style={tableTh}>Role</th></tr></thead>
        <tbody>
          {DEFENSIVE.map((d, i) => (
            <tr key={i}><td style={{ ...tableTd, fontFamily: "var(--font-mono)" }}>{d.ticker}</td><td style={tableTd}>{d.desc}</td><td style={tableTd}>{d.role}</td></tr>
          ))}
        </tbody>
      </table>

      {/* — INPUTS — */}
      <div id="mth__alloc-inputs" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.2 · INPUTS" sub="9 macro inputs feed the model" applies={["allocation"]} />
      <Prose>
        <P><strong>1. Daily prices</strong> for all 25 industry-group proxies + 4 defensive ETFs from yfinance. Baskets are aggregated from constituent names, equal-weighted.</P>
        <P><strong>2. Macro factor panel</strong> — ~32 factors back to 1998-2003 from FRED + Yahoo. Includes the yield curve (10Y minus 2Y), real rates, term premium, breakeven inflation, broad dollar, the Chicago Fed Financial Conditions Index, the St. Louis Financial Stress Index, commercial paper risk, fed funds, the Fed balance sheet, initial jobless claims, industrial production, capacity utilization, consumer sentiment, retail sales, PCE, durable-goods orders, housing starts, the 30-year mortgage rate, M2 money supply year-over-year, bank credit, WTI crude, natural gas, the copper-gold ratio, VIX, SKEW, and SLOOS lending standards (commercial &amp; industrial and commercial real estate).</P>
        <P><strong>3. Macro composites</strong> — the Risk &amp; Liquidity, Growth, and Inflation &amp; Rates composites from the Today's Macro pipeline (`composite_history_daily.json`). These drive the equity-vs-defensive split and the leverage decision.</P>
      </Prose>

      {/* — PER-ASSET FACTOR MAPS — */}
      <div id="mth__alloc-factor-maps" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.3 · PER-ASSET FACTOR MAPS" sub="Each industry group has its own multivariate regression" applies={["allocation"]} />
      <Prose>
        <P>Each industry group's expected return is forecast from a dedicated multivariate regression on macro factors. The factor list is determined by forward-stepwise selection on 1998-2026 monthly returns: factors stay only if their t-statistic exceeds 2 in the calibration window. Two universal background factors apply to every group (10Y-2Y yield curve slope and Kim-Wright term premium). The factor map is regenerated quarterly — factors that lose statistical significance over time are dropped at the next refresh.</P>
        <P><strong>Cyclicals</strong> (Energy, Materials, Capital Goods, Transportation, Automobiles) load on jobless claims, industrial production, copper-gold ratio, and oil prices.</P>
        <P><strong>Rate-sensitives</strong> (Software, Pharma/Biotech, Real Estate, Utilities) load on real rates, term premium, and 10Y breakeven inflation.</P>
        <P><strong>Financials</strong> load on the yield curve slope, SLOOS C&amp;I lending standards, and credit spreads.</P>
        <P><strong>Consumer-facing</strong> (Cons Disc Retail, Consumer Services, Apparel) load on Michigan sentiment, real PCE, retail sales, and the 30-year mortgage rate.</P>
        <P><strong>Defensives</strong> (Cons Staples, Health Care, Insurance) load on jobless claims and SLOOS C&amp;I as recession early-warning indicators.</P>
      </Prose>

      {/* — LOGIC — 9-step pipeline — */}
      <div id="mth__alloc-logic" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.4 · LOGIC — 9-STEP PIPELINE" sub="What runs every Saturday rebalance" applies={["allocation"]} />
      <Prose>
        <P><strong>Step 1 — Forecast.</strong> Per-asset OLS regression on the factor panel (lagged 1 month). Last 60 months of returns × shifted factors → coefficient estimates. Forecast = α + β·X[T-1]. Shrink toward each asset's long-run mean by 50% (Bayesian / James-Stein-lite). Output is a vector of expected next-month returns across all 25 industry groups.</P>
        <P><strong>Step 2 — Momentum.</strong> Trailing 6-month price return for each industry group, strict prior 6 months only — current month is NOT included (lookahead-safe).</P>
        <P><strong>Step 3 — Regime-flip detection.</strong> If the Risk &amp; Liquidity composite has dropped more than 15 points over the last 3 months AND is now below +30, this is a stress-to-recovery regime change. Set <code>regime_flip = True</code>.</P>
        <P><strong>Step 4 — Selection.</strong> In normal mode, rank groups by both indicator μ and 6-month momentum. Eligible = both ranks above median. Pick top 5 by combined rank, equal-weight 20% each within the equity sleeve. Fallback if fewer than 5 eligible: fill with indicator-positive only (NEVER momentum-positive only — indicators are forward-looking). In regime-flip mode, override momentum entirely and rank by indicator μ alone.</P>
        <P><strong>Step 5 — Defensive sub-portfolio weights.</strong> Max-Sharpe optimisation across BIL/TLT/GLD/LQD with per-asset cap of 70%. Returns a 4-vector summing to 100%.</P>
        <P><strong>Step 6 — Equity-vs-defensive split</strong> from the Risk &amp; Liquidity composite — see the threshold table below.</P>
        <P><strong>Step 7 — Leverage decision</strong> from the Inflation &amp; Rates composite — see the threshold table below. Capped at 1.5× per Joe's 2026-04-25 directive.</P>
        <P><strong>Step 8 — Apply leverage and financing cost.</strong> If alpha &gt; 1.0×, financing drag = (alpha − 1.0) × (risk-free + 0.5%/12). Subtracted from the realised portfolio return.</P>
        <P><strong>Step 9 — Final weights.</strong> Each of the 5 picks gets 20% × equity_share × leverage. Each defensive bucket gets (its defensive sub-weight) × (1 − equity_share). If levered, defensive = 0%, equity &gt; 100%, financing drag applies.</P>
      </Prose>

      {/* Equity vs Defensive split */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 880, marginTop: 4 }}><strong>Equity-vs-defensive split (Step 6):</strong></div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui)" }}>
        <thead><tr><th style={tableTh}>R&amp;L composite</th><th style={tableThR}>Equity weight</th><th style={tableThR}>Defensive weight</th><th style={tableTh}>Notes</th></tr></thead>
        <tbody>{EQ_THRESHOLDS.map((t, i) => (
          <tr key={i}><td style={{ ...tableTd, fontFamily: "var(--font-mono)" }}>{t.rl}</td><td style={tableTdR}>{t.equity}</td><td style={tableTdR}>{t.defensive}</td><td style={{ ...tableTd, color: "var(--text-muted)" }}>{t.note}</td></tr>
        ))}</tbody>
      </table>

      {/* Leverage thresholds */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 880, marginTop: 4 }}><strong>Leverage thresholds (Step 7):</strong></div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui)" }}>
        <thead><tr><th style={tableTh}>Inflation &amp; Rates composite</th><th style={tableThR}>Leverage</th><th style={tableTh}>Notes</th></tr></thead>
        <tbody>{LEV_THRESHOLDS.map((t, i) => (
          <tr key={i}><td style={{ ...tableTd, fontFamily: "var(--font-mono)" }}>{t.ir}</td><td style={tableTdR}>{t.lev}</td><td style={{ ...tableTd, color: "var(--text-muted)" }}>{t.note}</td></tr>
        ))}</tbody>
      </table>

      {/* — CONFIRMATORY RULE + REGIME FLIP — */}
      <div id="mth__alloc-confirm" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.5 · CONFIRMATORY RULE & REGIME-FLIP OVERRIDE" sub="Why two signals must agree to enter a position" applies={["allocation"]} />
      <Prose>
        <P><strong>Confirmatory selection.</strong> A pure indicator-based ranking would over-fit the regression and chase factors. A pure momentum-based ranking would chase trends and crash at regime changes. Requiring both signals to point above-median in the same direction is a robustness device — it kills positions where one signal screens hot and the other is cold, which is usually where you get hurt.</P>
        <P><strong>Regime-flip override.</strong> The exception is at V-bottoms. After a sharp risk-off move (R&amp;L drops more than 15 points in 3 months and is now below +30), trailing 6-month momentum is full of crash data and pointing the wrong way. The override falls back to indicator-only ranking, which is forward-looking and catches the recovery. This pattern is documented in the academic momentum-crash literature (Daniel &amp; Moskowitz 2016).</P>
      </Prose>

      {/* — TOP-5 EQUAL-WEIGHTED — */}
      <div id="mth__alloc-top5" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.6 · TOP-5 EQUAL-WEIGHTED — TRADE-OFFS" sub="Why 5 picks instead of N or continuous weights" applies={["allocation"]} />
      <Prose>
        <P><strong>Concentration.</strong> Five picks at 20% each within the equity sleeve concentrates conviction. The model is making active calls — diluting them across 10 or 15 positions would produce something closer to a sector-rotation index fund.</P>
        <P><strong>Why not continuous weights.</strong> Variable conviction weighting (e.g., max-Sharpe across the top 10 with weight caps) produces tighter back-test stats but is more fragile out-of-sample because it concentrates on whichever bucket the regression happens to like most that month. Equal-weight 5 is robust to single-bucket forecast errors.</P>
        <P><strong>What would justify a v10 change.</strong> A back-test showing variable conviction weights deliver materially higher Sharpe AND comparable max drawdown across the full 2008-2026 window. If a future v10 proposal can demonstrate that, the council reviews on the same back-test discipline (walk-forward, no peek-ahead, identical risk-free rate convention). Until then, top-5 equal-weight stays.</P>
      </Prose>

      {/* — BACK-TEST — */}
      <div id="mth__alloc-backtest" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.7 · BACK-TEST RESULTS" sub="Jan 2008 → Apr 2026, 220 months ≈ 18.3 years" applies={["allocation"]} />
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui)" }}>
        <thead><tr><th style={tableTh}>Metric</th><th style={tableThR}>v9.1 strategy</th><th style={tableThR}>S&amp;P 500 (SPY)</th><th style={tableThR}>60/40 (SPY/AGG)</th><th style={tableThR}>Edge</th></tr></thead>
        <tbody>
          {BACKTEST.map((b, i) => (
            <tr key={i}><td style={tableTd}>{b.metric}</td><td style={{ ...tableTdR, color: "var(--green-text)", fontWeight: 600 }}>{b.v9}</td><td style={tableTdR}>{b.spy}</td><td style={tableTdR}>{b.sixty40}</td><td style={{ ...tableTdR, color: "var(--text-muted)" }}>{b.edge}</td></tr>
          ))}
        </tbody>
      </table>
      <Prose>
        <P><strong>Where v9.1 wins.</strong> Regime-change years: 2008 GFC (+22pp), 2010 (+10pp), 2013 (+17pp), 2020 COVID (+2pp), 2022 inflation shock (+4pp), 2026 YTD (+18pp). The strategy's edge concentrates in two regimes — aggressive tilts when R&amp;L is calm, and the defensive sleeve activating ahead of major drawdowns.</P>
        <P><strong>Where v9.1 lags.</strong> Mega-cap-concentration years: 2021 (-12pp), 2024 (-9pp), 2009 recovery (-6pp). When dispersion is low and the top 5 happen to be the wrong 5, the equal-weight 5 design under-performs. This is by design — concentration is the cost of conviction.</P>
        <P><strong>Walk-forward discipline.</strong> Calibration is refit at each Saturday rebalance using only data available at that point in time — no peeking ahead. Back-test results published on the Asset Allocation tab use the exact same code path that runs live. Both Sharpes (strategy and S&amp;P) use the 3-month T-bill as the risk-free rate.</P>
      </Prose>

      {/* — HONEST LIMITATIONS — */}
      <div id="mth__alloc-limits" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.8 · HONEST LIMITATIONS" sub="12 of 25 industry groups have no clean single-ETF proxy" applies={["allocation"]} />
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 880 }}>
        These industry groups don't have a clean single-ETF proxy and are tracked through equal-weighted baskets of the largest names. Implementation cost is higher for these (more positions to maintain, no tight-tracking ETF wrapper available). Calibration accuracy depends on the basket adequately representing the underlying GICS group.
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui)" }}>
        <thead><tr><th style={tableTh}>Sector</th><th style={tableTh}>Industry group</th><th style={tableTh}>Basket</th></tr></thead>
        <tbody>{BASKET_IGS.map((u, i) => (
          <tr key={i}><td style={tableTd}>{u.sector}</td><td style={tableTd}>{u.ig}</td><td style={{ ...tableTd, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{u.proxy}</td></tr>
        ))}</tbody>
      </table>

      {/* — REFINEMENT PROCESS — */}
      <div id="mth__alloc-refine" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.9 · REFINEMENT PROCESS" sub="How v9.x → v9.x+1 happens" applies={["allocation"]} />
      <Prose>
        <P>Refinements ship as v9.2, v9.3, etc. Each refinement requires: (1) back-test on the same 2008-2026 window, (2) comparison table vs v9.1 baseline (CAGR, Sharpe, max DD, calendar wins), (3) Senior Quant sign-off, (4) UX Designer sign-off if UI changes, (5) Lead Developer ships PR.</P>
        <P><strong>Decisions that should not change without explicit council re-approval:</strong> the 1.5× leverage cap, industry-group level allocation (no cap dimension), the confirmatory selection rule (both indicator and momentum agree), the 6-month momentum window, the per-asset multivariate factor maps, and top-5 equal-weighted selection.</P>
      </Prose>

      {/* — CITATIONS — */}
      <div id="mth__alloc-cites" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.10 · CITATIONS" sub="Academic + sell-side methodology references" applies={["allocation"]} />
      <Prose>
        <P><strong>Momentum and momentum crashes.</strong> Daniel &amp; Moskowitz, "Momentum Crashes," Journal of Financial Economics (2016) — motivates the regime-flip override at V-bottoms.</P>
        <P><strong>Multivariate factor models.</strong> Asness, Moskowitz &amp; Pedersen, "Value and Momentum Everywhere," Journal of Finance (2013) — supports combining indicator-based and momentum-based ranks.</P>
        <P><strong>Walk-forward calibration.</strong> López de Prado, "Advances in Financial Machine Learning" (2018), Chapter 7 — methodology for avoiding lookahead bias in back-tests.</P>
        <P><strong>Defensive sleeve composition.</strong> Asness, Frazzini &amp; Pedersen, "Leverage Aversion and Risk Parity," Financial Analysts Journal (2012) — supports max-Sharpe optimisation with per-asset caps for tail-risk hedging.</P>
        <P><strong>Sector rotation literature.</strong> Conover, Jensen, Johnson &amp; Mercer, "Sector Rotation and Monetary Conditions," Journal of Investing (2008) — supports macro-regime-conditional sector selection.</P>
      </Prose>

      <div id="mth__alloc-break" style={{ scrollMarginTop: 80 }} /><SectionHeader label="3.11 · WHAT CAN BREAK THIS" sub="Conditions that change the ratings" applies={["allocation"]} />
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 880 }}>
        The 9 risk scenarios on the Asset Allocation tab map directly to specific indicators in the All Indicators tab. Each scenario links through to its underlying indicator with current value, history, and threshold context. Triggers include: real rates &gt; 2.0%, HY-IG spread &gt; 250bp, yield curve flattening below +25bp, SLOOS C&amp;I tightening &gt; +20pp, VIX sustained above 25, term premium &gt; 1.5%, copper-gold ratio breakdown, ISM &lt; 48, and USD index &gt; 110.
      </div>
      </>)}
    </section>
  );
}

// ─── §5 EQUITY SCANNER METHODOLOGY ─────────────────────────────────────────
function SignalScoreMath({ open, onToggle }) {
  const TIER_BANDS = [
    { label:"STRONG BULL", range:"≥ 60",        note:"Buy Alert",                      color:"#30d158" },
    { label:"BULLISH",     range:"30 – 59",     note:"Near Trigger threshold ≥ 40",    color:"#30d158" },
    { label:"TILT BULL",   range:"10 – 29",     note:"below Near Trigger threshold",   color:"#86efac" },
    { label:"NEUTRAL",     range:"−10 – 10",    note:"no directional read",            color:"#B8860B" },
    { label:"TILT BEAR",   range:"−29 – −10",   note:"below Near Short threshold",     color:"#B8860B" },
    { label:"BEARISH",     range:"−59 – −30",   note:"directional short bias",         color:"#ff9f0a" },
    { label:"STRONG BEAR", range:"≤ −60",       note:"conviction bear",                color:"#ff453a" },
  ];

  const SECTION_BLURBS = {
    technicals: "RSI momentum, MACD crossover direction, price vs. 50-/200-day moving averages. SCTR-style composite with ADX regime confirmation on [−100, +100].",
    insider:    "SEC Form 4 purchases and sales weighted by dollar notional. Insider BUYs carry more weight than SELLs (selling is far more common and less informative).",
    options:    "Unusual Whales real-time options flow. Sweep vs. block, call/put mix, premium size. Large call sweeps with meaningful premium push the score up; bearish flow pulls it down.",
    congress:   "Unusual Whales congressional PTR disclosures, 45-day rolling window. Scored by disclosed dollar-range tier and buy/sell direction.",
    analyst:    "Rating changes and price-target revisions from the UW analyst feed. Upgrades and PT increases lift the score; downgrades and PT cuts push it negative.",
    darkpool:   "Dark-pool block prints weighted by volume vs. ADV and recency. Intentionally small weight (5%) — historically a weak tiebreaker, not a standalone signal.",
  };

  const weightsTotal = SECTION_ORDER.reduce((s, k) => s + (SECTION_WEIGHTS[k] || 0), 0);

  return (
    <section id={A("signal-math")} data-testid="methodology-section-signalmath"
      style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <CollapsibleSectionHeader
        label="5 · EQUITY SCANNER METHODOLOGY"
        sub="Single composite on [−100, +100]"
        applies={[
          { id:"scanner",  label:"Trading Scanner",                         path:"#scanner" },
          { id:"portopps", label:"Trading Opportunities & Portfolio Insights", path:"#portopps" },
        ]}
        open={open}
        onToggle={onToggle}
      />
      {open && (<>

      <Prose>
        <P><strong>One score, one methodology.</strong> Every scanned ticker carries a single directional
        composite on <strong>[−100, +100]</strong>. STRONG BULL / BULLISH / TILT BULL / NEUTRAL / TILT BEAR
        / BEARISH / STRONG BEAR are tier labels on that one composite — <em>there is no second score
        anywhere</em>. The only 0–100 scale in MacroTilt is the macro Composite Stress Score.</P>

        <P><strong>The composite is a weighted average of 6 section scores.</strong> Each section
        independently emits a score in [−100, +100] — bullish, bearish, or null for "no qualifying
        activity". Weights sum to {weightsTotal}:</P>
      </Prose>

      {/* Section weights table — auto-rendered from SECTION_WEIGHTS. */}
      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"var(--font-mono)" }}>
          <thead>
            <tr style={{ color:"var(--text-dim)", background:"var(--surface-2)" }}>
              <th style={thStyle}>Section</th>
              <th style={{ ...thStyle, textAlign:"right" }}>Weight</th>
              <th style={thStyle}>What it scores</th>
            </tr>
          </thead>
          <tbody>
            {SECTION_ORDER.map((k) => (
              <tr key={k} style={{ borderTop:"1px solid var(--border)" }}>
                <td style={{ ...tdStyle, fontWeight:700, color:"var(--text)" }}>{SECTION_LABELS[k] || k}</td>
                <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-2)" }}>
                  {SECTION_WEIGHTS[k]}%
                </td>
                <td style={{ ...tdStyle, color:"var(--text-muted)" }}>
                  {SECTION_BLURBS[k] || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Prose>
        <P><strong>Aggregation rule.</strong> The composite is the weighted average across sections with a
        non-null score. A section with no qualifying activity drops out of both numerator and denominator,
        so one empty section doesn't dilute the others toward zero.</P>

        <Formula>composite = Σ(section<sub>i</sub> × w<sub>i</sub>) / Σ(w<sub>i</sub>)   (over sections with score ≠ null)</Formula>

        <P>Both sides of the system use the same numbers:
        <code> src/ticker/sectionComposites.js</code> (dashboard) and
        <code> trading-scanner/scanner/signal_composite.py</code> (scanner). The Python file carries a
        "MUST mirror" comment enforcing parity.</P>

        <P><strong>Inside the Technicals subscore.</strong> The 25% Technicals weight is itself a weighted
        blend — SCTR-style, with long-term trend dominating. Short-term momentum (MACD + RSI) is
        intentionally small so a single crossover doesn't swing the ticker's overall score.</P>
      </Prose>

      {/* Inside-Technicals breakdown — shows how each technical input rolls up. */}
      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"var(--font-mono)" }}>
          <thead>
            <tr style={{ color:"var(--text-dim)", background:"var(--surface-2)" }}>
              <th style={thStyle}>Block</th>
              <th style={thStyle}>Input</th>
              <th style={{ ...thStyle, textAlign:"right" }}>Max pts (of ±100)</th>
              <th style={{ ...thStyle, textAlign:"right" }}>% of Technicals</th>
              <th style={{ ...thStyle, textAlign:"right" }}>% of overall ticker</th>
              <th style={thStyle}>What it measures</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop:"1px solid var(--border)" }}>
              <td style={{ ...tdStyle, fontWeight:700, color:"var(--text)" }} rowSpan={2}>Long-term trend<br/><span style={{ fontSize:10, color:"var(--text-dim)" }}>60 pts total</span></td>
              <td style={{ ...tdStyle }}>Price vs 200-day MA</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>±30</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>30%</td>
              <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-2)" }}>7.50%</td>
              <td style={{ ...tdStyle, color:"var(--text-muted)" }}>Distance above / below the 200-day MA, capped ±5%.</td>
            </tr>
            <tr style={{ borderTop:"1px solid var(--border-subtle, rgba(0,0,0,0.04))" }}>
              <td style={{ ...tdStyle }}>YTD return vs SPY</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>±30</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>30%</td>
              <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-2)" }}>7.50%</td>
              <td style={{ ...tdStyle, color:"var(--text-muted)" }}>IBD-style relative strength year-to-date, capped ±10%.</td>
            </tr>
            <tr style={{ borderTop:"1px solid var(--border)" }}>
              <td style={{ ...tdStyle, fontWeight:700, color:"var(--text)" }} rowSpan={2}>Mid-term trend<br/><span style={{ fontSize:10, color:"var(--text-dim)" }}>30 pts total</span></td>
              <td style={{ ...tdStyle }}>Price vs 50-day MA</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>±15</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>15%</td>
              <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-2)" }}>3.75%</td>
              <td style={{ ...tdStyle, color:"var(--text-muted)" }}>Distance above / below the 50-day MA, capped ±2%.</td>
            </tr>
            <tr style={{ borderTop:"1px solid var(--border-subtle, rgba(0,0,0,0.04))" }}>
              <td style={{ ...tdStyle }}>1-month return vs SPY</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>±15</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>15%</td>
              <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-2)" }}>3.75%</td>
              <td style={{ ...tdStyle, color:"var(--text-muted)" }}>Relative strength over the trailing month, capped ±5%.</td>
            </tr>
            <tr style={{ borderTop:"1px solid var(--border)" }}>
              <td style={{ ...tdStyle, fontWeight:700, color:"var(--text)" }} rowSpan={2}>Short-term momentum<br/><span style={{ fontSize:10, color:"var(--text-dim)" }}>10 pts total</span></td>
              <td style={{ ...tdStyle, color:"var(--text)" }}><strong>MACD cross</strong> (12/26/9)</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>±5</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>5%</td>
              <td style={{ ...tdStyle, textAlign:"right", color:"var(--text)", fontWeight:700 }}>1.25%</td>
              <td style={{ ...tdStyle, color:"var(--text-muted)" }}>Bullish / bearish cross within the last 3 daily bars.</td>
            </tr>
            <tr style={{ borderTop:"1px solid var(--border-subtle, rgba(0,0,0,0.04))" }}>
              <td style={{ ...tdStyle }}>RSI-14</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>±5</td>
              <td style={{ ...tdStyle, textAlign:"right" }}>5%</td>
              <td style={{ ...tdStyle, textAlign:"right", color:"var(--text-2)" }}>1.25%</td>
              <td style={{ ...tdStyle, color:"var(--text-muted)" }}>Healthy-uptrend zone 50-70 adds +5; mild oversold &lt;30 adds +2.</td>
            </tr>
          </tbody>
          <tfoot>
            <tr style={{ borderTop:"2px solid var(--border)", background:"var(--surface-2)" }}>
              <td style={{ ...tdStyle, fontWeight:700, color:"var(--text)" }} colSpan={2}>Total pre-regime</td>
              <td style={{ ...tdStyle, textAlign:"right", fontWeight:700 }}>±100</td>
              <td style={{ ...tdStyle, textAlign:"right", fontWeight:700 }}>100%</td>
              <td style={{ ...tdStyle, textAlign:"right", fontWeight:700, color:"var(--text)" }}>25%</td>
              <td style={{ ...tdStyle, color:"var(--text-muted)" }}>Before ADX regime multiplier and volume confirmation.</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.7, maxWidth:880 }}>
        <strong>Plain-English read-out for MACD:</strong> a bullish MACD crossover on its own can add at most
        <strong> ±5 of ±100 Technicals points (5% of Technicals)</strong>. Since Technicals is 25% of the
        overall ticker composite, MACD's maximum contribution to the overall <strong>−100 / +100</strong>
        score is <strong>5% × 25% = 1.25%</strong>. RSI carries the same weight. Short-term momentum is
        intentionally a tiebreaker, not a driver — the long-term trend and relative-strength blocks do the
        heavy lifting.
      </div>

      <Prose>
        <P><strong>ADX regime + volume multipliers.</strong> After the raw additive score, ADX sets a regime
        flag — CONFIRMED trend (ADX ≥ 25, |score| &gt; 30) leaves the score as-is; chop regime (ADX &lt; 20)
        dampens it; indeterminate leaves it alone. Volume surge above 1.5× average adds a small
        confirmation bump. These are multiplicative, not additive — they don't shift the weights above.</P>

        <P><strong>Tier bands.</strong> The composite maps to a named direction (modal label) and a tier
        (Buy Alert / Near Trigger membership). The Near Trigger threshold was lifted from 30 → 40 on
        2026-04-20 to drop arithmetic noise in the 30-34 band (51/67 Near Trigger names on the 2026-04-19
        scan were in that band purely from weighted-average dilution). The BULLISH label boundary stays at
        30 — label and tier are decoupled.</P>
      </Prose>


      {/* Tier band table. */}
      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"var(--font-mono)" }}>
          <thead>
            <tr style={{ color:"var(--text-dim)", background:"var(--surface-2)" }}>
              <th style={thStyle}>Directional label</th>
              <th style={thStyle}>Composite range</th>
              <th style={thStyle}>Tier meaning</th>
            </tr>
          </thead>
          <tbody>
            {TIER_BANDS.map((t) => (
              <tr key={t.label} style={{ borderTop:"1px solid var(--border)" }}>
                <td style={{ ...tdStyle, fontWeight:700, color:t.color }}>{t.label}</td>
                <td style={{ ...tdStyle, color:"var(--text-2)" }}>{t.range}</td>
                <td style={{ ...tdStyle, color:"var(--text-muted)" }}>{t.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>)}
    </section>
  );
}

// ─── §4 EQUITY SCANNER DATA SOURCES (sortable flat table, scanner-only) ───
// Scanner data only — the macro indicators have their own table in §1, so
// repeating them here would be redundant.
function DataCatalogTable({ ind, asOf, open, onToggle }) {
  const rows = useMemo(() => {
    return DATA_REGISTRY
      .filter((r) => r.section === "scanner" && !r.isFilter)
      .map((r) => {
        const secLabel = SCANNER_SECTION_FOR[r.key] || "—";
        const secKey   = SCANNER_SECTION_KEY_FOR[r.key];
        let weighting = "—";
        let weightingSort = 0;
        if (secKey && SECTION_WEIGHTS[secKey] != null) {
          weighting = `${SECTION_WEIGHTS[secKey]}%`;
          weightingSort = SECTION_WEIGHTS[secKey];
        } else {
          weighting = "Enrichment";
          weightingSort = -1;
        }
        return {
          key: r.key,
          name: r.name,
          section: secLabel,
          source: r.source || "—",
          freq: r.freqCode || "—",
          lastRefresh: r.lastRefresh || "—",
          weighting,
          weightingSort,
          timing: r.timing || "",
          detail: r.summary || r.details || "",
        };
      });
  }, []);

  const [sortKey, setSortKey] = useState("weighting");
  const [sortDir, setSortDir] = useState("desc");
  const TIMING_ORDER = { Leading:1, Coincident:2, Lagging:3 };
  const FREQ_ORDER   = { "3x/D":1, D:2, W:3, M:4, Q:5, Y:6 };

  const sorted = useMemo(() => {
    const arr = [...rows];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case "name":        av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case "section":     av = a.section.toLowerCase(); bv = b.section.toLowerCase(); break;
        case "source":      av = a.source.toLowerCase(); bv = b.source.toLowerCase(); break;
        case "freq":        av = FREQ_ORDER[a.freq] || 99; bv = FREQ_ORDER[b.freq] || 99; break;
        case "lastRefresh": av = Date.parse(a.lastRefresh) || 0; bv = Date.parse(b.lastRefresh) || 0; break;
        case "weighting":   av = a.weightingSort; bv = b.weightingSort; break;
        case "timing":      av = TIMING_ORDER[a.timing] || 99; bv = TIMING_ORDER[b.timing] || 99; break;
        case "detail":      av = a.detail.toLowerCase(); bv = b.detail.toLowerCase(); break;
        default:            av = 0; bv = 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  function onSort(k) {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "weighting" ? "desc" : "asc"); }
  }

  const COLS = [
    { k:"name",        label:"Data",         align:"left"   },
    { k:"section",     label:"Category / Use", align:"left" },
    { k:"source",      label:"Source",       align:"left"   },
    { k:"freq",        label:"Frequency",    align:"center" },
    { k:"lastRefresh", label:"Last Refresh", align:"left"   },
    { k:"weighting",   label:"Weight",       align:"right"  },
    { k:"timing",      label:"Type",         align:"center" },
    { k:"detail",      label:"Detail",       align:"left"   },
  ];

  return (
    <section id={A("catalog")} data-testid="methodology-section-catalog"
      style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <CollapsibleSectionHeader
        label="4 · EQUITY SCANNER DATA SOURCES"
        sub={`${rows.length} streams that feed the per-ticker Signal Score · sortable`}
        applies={[
          { id:"scanner",  label:"Trading Scanner",                            path:"#scanner" },
          { id:"portopps", label:"Trading Opportunities & Portfolio Insights", path:"#portopps" },
        ]}
        open={open}
        onToggle={onToggle}
      />
      {open && (<>
      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.65, maxWidth:880 }}>
        Every upstream stream the scanner reads when it scores a ticker. Click a column header to sort.
        <strong> Frequency</strong> is how often the stream refreshes (D = once per weekday, 3x/D = three
        pulls per weekday). <strong>Weight</strong> is that stream's share of the overall Signal Score
        (see §5). Before any of this runs, a price ($5–$500) and market-cap screen from the Unusual Whales
        screener filters the investable universe — the screener is a methodology step, not a scoring input.
      </div>

      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8,
                    overflow:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"var(--font-mono)" }}>
          <thead>
            <tr style={{ color:"var(--text-dim)", background:"var(--surface-2)" }}>
              {COLS.map((c) => (
                <th key={c.k}
                    onClick={() => onSort(c.k)}
                    style={{ ...thStyle, textAlign:c.align, cursor:"pointer", userSelect:"none",
                             whiteSpace:"nowrap" }}>
                  {c.label}
                  <span style={{ marginLeft:4, color: sortKey === c.k ? "var(--accent)" : "transparent" }}>
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} style={{ borderTop:"1px solid var(--border)" }}>
                <td style={{ ...tdStyle, fontWeight:700, color:"var(--text)", whiteSpace:"nowrap" }}>
                  {r.name}
                </td>
                <td style={{ ...tdStyle }}>
                  <span style={{ fontSize:10, color:"#06b6d4", border:"1px solid #06b6d4",
                                 borderRadius:3, padding:"1px 6px", letterSpacing:"0.05em",
                                 whiteSpace:"nowrap", textTransform:"uppercase" }}>
                    {r.section}
                  </span>
                </td>
                <td style={{ ...tdStyle, color:"var(--text-2)" }}>{r.source}</td>
                <td style={{ ...tdStyle, textAlign:"center", color:"var(--text-2)" }}>{r.freq}</td>
                <td style={{ ...tdStyle, color:"var(--text-2)", whiteSpace:"nowrap" }}>{r.lastRefresh}</td>
                <td style={{ ...tdStyle, textAlign:"right", color:"var(--text)" }}>{r.weighting}</td>
                <td style={{ ...tdStyle, textAlign:"center" }}>
                  {r.timing ? (
                    <span style={{ fontSize:10, color:TIMING_COLOR[r.timing] || "var(--text-dim)",
                                   border:`1px solid ${TIMING_COLOR[r.timing] || "var(--border)"}`,
                                   borderRadius:3, padding:"1px 6px", letterSpacing:"0.05em",
                                   textTransform:"uppercase", whiteSpace:"nowrap" }}>
                      {r.timing}
                    </span>
                  ) : "—"}
                </td>
                <td style={{ ...tdStyle, color:"var(--text-muted)", lineHeight:1.6, minWidth:320 }}>
                  {r.detail || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>)}
    </section>
  );
}

// Mapping tables used by §5.
const SCANNER_SECTION_FOR = {
  uw_options_flow:   "Options",
  uw_dark_pool:      "Dark Pool",
  uw_congressional:  "Congress",
  uw_insider:        "Insider",
  uw_screener:       "Filter (universe screen)",
  uw_news:           "Ticker Detail — News",
  yahoo_prices:      "Prices (enrichment)",
  yahoo_technicals:  "Technicals",
};
const SCANNER_SECTION_KEY_FOR = {
  uw_options_flow:   "options",
  uw_dark_pool:      "darkpool",
  uw_congressional:  "congress",
  uw_insider:        "insider",
  yahoo_technicals:  "technicals",
};

const thStyle = { textAlign:"left", fontWeight:600, fontSize:10, letterSpacing:"0.08em",
                  padding:"8px 12px", color:"var(--text-dim)", textTransform:"uppercase",
                  fontFamily:"var(--font-mono)", whiteSpace:"nowrap" };
const tdStyle = { padding:"8px 12px", verticalAlign:"top" };

// ─── SHARED HELPERS ──────────────────────────────────────────────────────────
// SectionHeader + Prose + P + Formula + PillChip were co-located with the old
// §6 catalog section; the §6 → §5 rebuild dropped them inadvertently. Restored
// here, one layer above Disclaimer, so every section can read them.
// CollapsibleSectionHeader — used by every top-level section so the page
// can collapse to a one-screen TOC then expand on demand. Sub-section
// anchors stay always-rendered when their parent is open; the parent
// collapse alone gets ~80% of the length-reduction win.
function Chevron({ open }) {
  return (
    <span style={{ display:"inline-block", width:14, transition:"transform .15s",
                   transform: open ? "rotate(90deg)" : "rotate(0deg)",
                   color:"var(--text-dim)", fontFamily:"var(--font-mono)" }}>
      ▶
    </span>
  );
}
function CollapsibleSectionHeader({ label, sub, applies, open, onToggle }) {
  return (
    <div onClick={onToggle}
         role="button" tabIndex={0}
         onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
         style={{ display:"flex", flexDirection:"column", gap:6,
                  borderBottom:"1px solid var(--border)", paddingBottom:6,
                  cursor:"pointer", userSelect:"none" }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
        <Chevron open={open} />
        <div style={{ fontSize:15, fontWeight:700, color:"var(--text)",
                      fontFamily:"var(--font-mono)", letterSpacing:"0.08em" }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontSize:11, color:"var(--text-dim)", fontFamily:"var(--font-mono)" }}>
            · {sub}
          </div>
        )}
        <div style={{ marginLeft:"auto", fontSize:10, fontFamily:"var(--font-mono)",
                      color:"var(--text-dim)", letterSpacing:"0.05em",
                      textTransform:"uppercase" }}>
          {open ? "click to collapse" : "click to expand"}
        </div>
      </div>
      {applies && applies.length > 0 && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:10, color:"var(--text-dim)", fontFamily:"var(--font-mono)",
                         letterSpacing:"0.08em" }}>
            APPLIES TO:
          </span>
          {applies.map((a) => (
            <a key={a.id} href={a.path}
               onClick={(e) => e.stopPropagation()}
               style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--accent)",
                        textDecoration:"none", border:"1px solid var(--accent)",
                        borderRadius:3, padding:"2px 6px", letterSpacing:"0.05em" }}>
              {a.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label, sub, applies }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, borderBottom:"1px solid var(--border)", paddingBottom:6 }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
        <div style={{ fontSize:15, fontWeight:700, color:"var(--text)",
                      fontFamily:"var(--font-mono)", letterSpacing:"0.08em" }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontSize:11, color:"var(--text-dim)", fontFamily:"var(--font-mono)" }}>
            · {sub}
          </div>
        )}
      </div>
      {applies && applies.length > 0 && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:10, color:"var(--text-dim)", fontFamily:"var(--font-mono)",
                         letterSpacing:"0.08em" }}>
            APPLIES TO:
          </span>
          {applies.map((a) => (
            <a key={a.id} href={a.path}
               style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--accent)",
                        textDecoration:"none", border:"1px solid var(--accent)",
                        borderRadius:3, padding:"2px 6px", letterSpacing:"0.05em" }}>
              {a.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Prose({ children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:900,
                   fontSize:13, color:"var(--text-2)", lineHeight:1.75 }}>
      {children}
    </div>
  );
}

function P({ children }) {
  return <div>{children}</div>;
}

function Formula({ children }) {
  return (
    <div style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text)",
                   background:"var(--surface-2)", border:"1px solid var(--border)",
                   borderRadius:6, padding:"10px 12px" }}>
      {children}
    </div>
  );
}

function PillChip({ text, color }) {
  if (!text) return null;
  return (
    <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:color || "var(--text-dim)",
                   border:`1px solid ${color || "var(--border)"}`, borderRadius:3,
                   padding:"1px 6px", letterSpacing:"0.05em", whiteSpace:"nowrap" }}>
      {text}
    </span>
  );
}

// ─── Disclaimer ─────────────────────────────────────────────────────────────
function Disclaimer() {
  return (
    <div style={{ background:"var(--surface-2)", border:"1px solid var(--border)",
                   borderRadius:8, padding:"12px 14px" }}>
      <div style={{ fontSize:11, color:"var(--text-dim)", fontFamily:"var(--font-mono)",
                    letterSpacing:"0.1em", marginBottom:6 }}>
        DISCLAIMER
      </div>
      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.75 }}>
        This dashboard is for informational and educational purposes only. It is not financial advice,
        investment advice, or a solicitation to buy or sell any security. All data is sourced from public
        databases and third-party providers and may have errors or delays. Past relationships between
        indicators and market outcomes do not guarantee future results.
      </div>
    </div>
  );
}
