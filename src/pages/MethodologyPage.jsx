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
  usd:         { phase:"Fast", timing:"Coincident", source:"FRED DTWEXBGS",                 measure:"Trade-weighted US dollar against 26 trading-partner currencies.",                                                  rationale:"T3 — strong $ tightens global conditions; hits EM + commodity exposures." },
  cpff:        { phase:"Fast", timing:"Coincident", source:"FRED DCPF3M − DFF",             measure:"3M AA commercial paper yield minus effective Fed Funds rate, in bps.",                                            rationale:"T3 — short-term corporate funding stress gauge (GFC peak 280bps)." },
  skew:        { phase:"Fast", timing:"Leading",    source:"CBOE SKEW",                     measure:"Implied probability of a >2SD S&P 500 decline from far-OTM put pricing.",                                          rationale:"T3 — tail-risk positioning; contrarian when elevated alongside low VIX." },
  sloos_cre:   { phase:"Slow", timing:"Leading",    source:"FRED DRTSCLCC (Fed SLOOS)",     measure:"Net % of banks tightening Commercial Real Estate lending standards.",                                              rationale:"T3 — office/retail CRE sensitivity; leads CRE credit events." },
  bank_credit: { phase:"Slow", timing:"Coincident", source:"FRED TOTBKCR YoY",              measure:"Year-over-year growth in total bank credit (loans + securities).",                                                 rationale:"T3 — real-economy credit pulse; <3% signals tightening feeding through." },
  jobless:     { phase:"Fast", timing:"Leading",    source:"FRED ICSA (US DOL)",            measure:"Weekly count of new unemployment-insurance filings (thousands).",                                                  rationale:"T3 — most timely high-frequency labor signal; sustained >300K = early recession." },
  jolts_quits: { phase:"Slow", timing:"Coincident", source:"FRED JTSQUR (BLS JOLTS)",       measure:"Voluntary quits as a percentage of total nonfarm employment.",                                                     rationale:"T3 — worker confidence = wage pressure direction." },
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
export default function MethodologyPage({ ind, asOf, weights, cats, indFreq }) {
  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
      <HeaderOverview />
      <JumpNav />
      <TabWalkthrough />
      <CategoryMap ind={ind} weights={weights} cats={cats} indFreq={indFreq} />
      <CompositeMath ind={ind} weights={weights} cats={cats} />
      <SignalScoreMath />
      <CatalogSection ind={ind} asOf={asOf} cats={cats} />
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
        How every number in MacroTilt is built, where it comes from, and how it's weighted — top-down from
        macro to micro.
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.75, maxWidth: 880 }}>
        MacroTilt is two engines stacked on top of each other. The <strong>macro engine</strong> converts 25
        indicators into a single 0–100 Composite Stress Score — where we are in the regime. The <strong>sector
        engine</strong> drops one level down to rank sectors on cross-sectional factor tilts given that regime.
        The <strong>micro engine</strong> (scanner) scans individual stocks for conviction-trade setups —
        insiders, Congress, options flow, technicals — and scores each one on a single directional composite
        from −100 (bearish) to +100 (bullish). Your <strong>portfolio surface</strong> is the overlay: macro →
        sector → micro lined up against your actual holdings and watchlist.
      </div>
    </section>
  );
}

// ─── JUMP NAV (Item 18 — fixed to use onClick + scrollIntoView) ─────────────
function JumpNav() {
  const links = [
    ["By tab",         A("tabs")],
    ["Category map",   A("catmap")],
    ["Composite math", A("composite-math")],
    ["Signal math",    A("signal-math")],
    ["Data streams",   A("catalog")],
  ];
  return (
    <nav data-testid="methodology-toc"
      style={{ display:"flex", flexWrap:"wrap", gap:8, fontFamily:"var(--font-mono)", fontSize:11,
               borderTop:"1px solid var(--border)", borderBottom:"1px solid var(--border)",
               padding:"10px 0", color:"var(--text-dim)" }}>
      <span style={{ color:"var(--text-dim)", letterSpacing:"0.08em" }}>JUMP TO:</span>
      {links.map(([label, id], i) => (
        <React.Fragment key={id}>
          <a
            href={`#${id}`}
            onClick={(e) => { e.preventDefault(); scrollToAnchor(id); }}
            style={{ color:"var(--accent)", textDecoration:"none", cursor:"pointer" }}
          >
            {label}
          </a>
          {i < links.length - 1 && <span style={{ color:"var(--border)" }}>·</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

// ─── §2 BY TAB ──────────────────────────────────────────────────────────────
// One card per real sidebar tab. PM pitch voice: why we built it, how a
// hedge-fund PM uses it, where the differentiated edge comes from.
// Seven surfaces, ordered as they appear in the sidebar.
const TAB_CONTENT = [
  {
    key: "home",
    title: "Home",
    path: "#home",
    tagline: "Cockpit — the one surface that answers 'what matters today'",
    purpose: "Every other tab goes deep on a single engine. Home is the cockpit — a four-tile glance that tells you the regime, the best micro setups inside your watchlist, what your portfolio looks like under the current conviction band, and a quick sector strip. It's the first page you open at 7:30am and the last you check at 4:15pm.",
    pmUse: "Use it as your morning gut-check. Regime tile sets the risk budget for the day; scanner strip surfaces any watchlist names hitting Buy Alert overnight; portfolio tile flashes REVIEW on positions where the composite collapsed. If nothing's moved, you click through to your real work. If anything's flagged, you drill into the relevant tab.",
    edge: "One pane, one glance, no separate logins. Most PMs rebuild this from three Bloombergs + a spreadsheet every morning. Here the regime and the micro are already stitched together.",
    what: "Four tiles: Macro (Composite + category bars), Micro (scanner top Buy/Near Trigger in your watchlist), Portfolio (allocation + flagged rows), Sector strip (cross-sectional read). Click any tile to land in the full tab.",
    howRead: "Tile tint mirrors the conviction band — green benign, yellow normal, amber elevated, red crisis. If the Macro tile flashes amber or red, skip the other tiles and go straight to Macro Overview.",
  },
  {
    key: "overview",
    title: "Macro Overview",
    path: "#overview",
    tagline: "Regime engine — one number for 'where are we'",
    purpose: "The Composite Stress Score collapses 25 macro indicators across six categories (equity/credit/rates/financial-conditions/bank/labor) into one 0–100 gauge. It's the regime call: LOW means you can run leverage and beta, EXTREME means capital preservation.",
    pmUse: "Use the regime read to size your book. Most PMs hand-roll this out of VIX + HY OAS + ISM + maybe SLOOS on a quarterly check-in with the macro team. Here it updates continuously — if the number jumps from 35 to 55 over two weeks without any headline news, you know credit and rates are quietly repricing and your exposure sizing is stale.",
    edge: "Single-blend score with explicit tier weights (T1 market-sensitive 1.5×, T2 survey/valuation 1.2×, T3 structural 1.0×) and empirically-calibrated conviction bands that align with every named crisis in the 2006-2026 sample. Velocity chip answers 'is stress accelerating?' — the question no single indicator can answer alone.",
    what: "Composite gauge + 6-category breakdown, 4-week velocity chip, historical stress chart (2005-present) with timeframe selector, and a one-line regime summary.",
    howRead: "Four bands on the SD scale — LOW<0.12 / NORMAL<0.41 / ELEVATED<1.03 / EXTREME≥1.03 (recalibrated 2026-04-22 from p60/p85/p97.5 of the 2006-2026 distribution). The 0–100 gauge is a linear rescale of the same SD number. Crises map: GFC=82 EXTREME, COVID=75 EXTREME, 2022=45 ELEVATED, SVB=42 ELEVATED. See Composite math below.",
  },
  {
    key: "indicators",
    title: "All Indicators",
    path: "#indicators",
    tagline: "The raw ingredients — 25 calibrated indicators, each with 10-20 years of history",
    purpose: "The Composite is a weighted mean of these 25. This tab lets you drill into each one: the live value, what's changed over 1-3-6-12 months, the narrative, the chart, and the long description covering source, construction, and historical thresholds.",
    pmUse: "When the Composite moves, come here to ask 'which components drove it?' Sort by category to isolate credit widening vs equity vol spike vs rates curve move. Click any tile for the full narrative and multi-timeframe chart — the 12-month history column catches slower-moving structural moves (term premium, CAPE, SLOOS) that daily tiles miss.",
    edge: "Every indicator ships with a calibrated description — historical thresholds, data source, construction notes, and a live narrative that auto-updates as values shift. You don't need to remember whether 'ANFCI at −0.47' is tight or loose; the card tells you.",
    what: "25 indicator tiles with sparkline, 1M/3M/6M/12M prior values, tier chip, category chip, narrative line. Filter by category or tier. Click for the full methodology description.",
    howRead: "Each value is z-scored against its own long-run history — the coloring tells you how unusual today's reading is for this particular metric, not whether the raw number is 'high'. A VIX of 20 is a different signal than an ISM of 20; the z-score handles that.",
  },
  {
    key: "sectors",
    title: "Sectors",
    path: "#sectors",
    tagline: "Cross-sectional — which sectors out/underperform given the regime",
    purpose: "The Macro engine tells you the regime; the Sector engine asks 'inside that regime, what do you want to be long vs short?' Decoupled by design — the macro score doesn't directly tilt sector weights. Instead, a cross-sectional APT-style factor engine ranks sector ETFs, and a macro-conditioned overlay adjusts the factor mix based on which regime you're in.",
    pmUse: "Use it to stress-test allocation rebalances before executing. If the macro engine says ELEVATED but the sector engine ranks Energy + Staples top-quartile while Tech is bottom, that's your tilt — not an overall gross-down. PMs running sector-neutral books use it to size pair trades: long top-ranked sector ETF, short bottom-ranked, with exposure scaled to the regime's vol budget.",
    edge: "Two separate models that only couple at the factor-tilt overlay. Most macro dashboards force a single 'regime → sector weights' mapping that breaks when factors rotate. This lets factor regimes and macro regimes disagree — which is usually when alpha shows up.",
    what: "Sector heat-map scored from subsector sensitivity to 8 macro factors. Currently consumer-facing surface is being rebuilt; deep research view lives on Sector Lab · BETA (admin only).",
    howRead: "Sector scores are relative (rank-based), not absolute stress. A sector can score high while the overall regime is EXTREME — that just means 'least-bad' within the current tape.",
    betaNote: true,
  },
  {
    key: "portopps",
    title: "Trading Opportunities & Portfolio Insights",
    path: "#portopps",
    tagline: "The overlay — macro × sector × micro pinned to your actual book",
    purpose: "This is where everything you've calibrated on the other tabs lines up against your holdings and watchlist. Concentration checks, beta outliers, deployable cash, scanner REVIEW flags on positions — all rules-driven. The Trading Opportunities panel filters the daily scanner output to names in your watchlist and ranks by composite.",
    pmUse: "First stop in the morning after the Macro tile. Check: (1) any position with a REVIEW flag from the scanner, (2) concentration > 10%, (3) deployable cash > 5% of book, (4) beta outliers given the current regime. If nothing fires, you're calibrated. If something fires, it's rules-driven — no vibes. Opportunities panel is your execution queue: every Buy Alert inside your watchlist, sorted by conviction.",
    edge: "Rules-driven observations — no 'diversified portfolio!' vibe notes. Silent when no rule fires, which is most days. The macro regime explicitly informs the guidance (EXTREME regime raises concentration flag thresholds, LOW regime lowers them).",
    what: "Positions table with live prices and PnL Day, watchlist, Trading Opportunities ranked list, account-by-account detail, allocation breakdown, Notable Signals summary, concentration & beta flags.",
    howRead: "Positions rows surface REVIEW when the scanner has a meaningful signal on one of your holdings — green for Buy Alert, amber for Near Trigger, red for STRONG BEAR collapse. Observations appear only when a calibrated rule fires.",
  },
  {
    key: "scanner",
    title: "Trading Scanner",
    path: "#scanner",
    tagline: "Micro engine — per-ticker directional signal in [−100, +100]",
    purpose: "Daily 3:30pm ET scan across the union of all users' watchlists. Each ticker gets six section sub-scores (Technicals, Options, Insider, Congress, Analyst, Dark Pool), weighted into a single composite on the [−100, +100] scale. Buy Alert, Near Trigger, and every directional tier is a threshold on that one composite.",
    pmUse: "This is the idea-generation engine — where a PM's morning 'what's worth a look today?' comes from. Insider buys + large call sweeps + technical momentum confirm each other and compound into a high-conviction Buy Alert. Bearish side works the same way: insider selling + bearish flow + technical breakdown = STRONG BEAR tier. Backs up the qualitative feel with a systematic composite.",
    edge: "Signed bidirectional composite (not a bullish-only 0–100) means a bearish idea looks as loud as a bullish one. The Technicals subscore is SCTR-style (long-term trend 60 / mid 30 / short 10) with ADX regime confirmation — picks up trend AND chop. Every subscore has its own fallback so a missing section doesn't zero the whole ticker.",
    what: "Ticker table with composite score, section sub-composites, buy/sell tier chip, current price, screener fields, and sparklines. Click any row for the full Ticker Detail modal (news, insider history, Congress history, options flow breakdown).",
    howRead: "One single scoring system: composite on [−100, +100]. Tiers on that same score — STRONG BULL ≥60 (Buy Alert), BULLISH ≥30 (Near Trigger threshold is ≥40 since 2026-04-20 after noise in the 30-34 band), TILT BULL ≥10, NEUTRAL, TILT BEAR ≤−10, BEARISH ≤−30, STRONG BEAR ≤−60. No second score anywhere — the only 0–100 scale in MacroTilt is the macro Composite.",
  },
  {
    key: "lab",
    title: "Sector Lab · BETA",
    path: "#lab",
    tagline: "Research sandbox — experimental overlays on top of the sector engine",
    purpose: "Where we prototype new sector-engine features before promoting them into /#sectors. Cycle-stage classifier (early/mid/late/recession), factor-debug panel exposing raw factor loadings, read-only ranking mirror. Admin-only — not consumer-ready, not investment advice.",
    pmUse: "Internal research surface — if you're not Joe or an invited power-user, you don't see this tab. Promotion path is block-by-block into the consumer /#sectors tab as each block passes validation.",
    edge: "Separation of concerns — research work doesn't pollute the production surface, and promoted blocks have already been stress-tested in the lab. Rest of the product stays stable while the sector engine gets rebuilt underneath.",
    what: "Cycle-stage classifier, factor-debug panel, read-only ranking mirror, experimental overlays.",
    howRead: "Labelled BETA · admin everywhere it appears. Not a source of live investment guidance.",
    betaNote: true,
  },
];

function TabWalkthrough() {
  return (
    <section id={A("tabs")} data-testid="methodology-section-tabs"
      style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <SectionHeader
        label="BY TAB"
        sub={`${TAB_CONTENT.length} user-facing surfaces`}
        applies={TAB_CONTENT.map(t => ({ id: t.key, label: t.title, path: t.path }))}
      />
      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.65, maxWidth:820 }}>
        For each surface in the sidebar: <strong>why we built it</strong>, <strong>how a hedge-fund PM would
        use it</strong>, <strong>where the differentiated edge comes from</strong>, what's on the page, and
        how to read it.
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(440px, 1fr))", gap:14 }}>
        {TAB_CONTENT.map((t) => <TabBlock key={t.key} tab={t}/>)}
      </div>
    </section>
  );
}

function TabBlock({ tab }) {
  return (
    <article data-testid={`methodology-tab-${tab.key}`}
      style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8,
               padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
        <div style={{ fontSize:15, fontWeight:700, color:"var(--text)" }}>{tab.title}</div>
        <a href={tab.path}
           style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--accent)",
                    textDecoration:"none", border:"1px solid var(--accent)",
                    borderRadius:3, padding:"1px 6px", letterSpacing:"0.05em" }}>
          OPEN {tab.path}
        </a>
        {tab.betaNote && (
          <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"#a78bfa",
                         border:"1px solid #a78bfa", borderRadius:3, padding:"1px 6px", letterSpacing:"0.05em" }}>
            BETA · admin
          </span>
        )}
      </div>
      <div style={{ fontSize:11, color:"var(--text-dim)", fontFamily:"var(--font-mono)",
                    letterSpacing:"0.06em", textTransform:"uppercase" }}>
        {tab.tagline}
      </div>
      <FieldRow label="Why we built it"           body={tab.purpose}/>
      <FieldRow label="How a PM uses it"          body={tab.pmUse}/>
      <FieldRow label="Where the edge comes from" body={tab.edge}/>
      <FieldRow label="What you see"              body={tab.what}/>
      <FieldRow label="How to read it"            body={tab.howRead}/>
    </article>
  );
}

function FieldRow({ label, body }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      <div style={{ fontSize:10, color:"var(--text-dim)", fontFamily:"var(--font-mono)",
                    letterSpacing:"0.08em", textTransform:"uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize:12, color:"var(--text-2)", lineHeight:1.7 }}>
        {body}
      </div>
    </div>
  );
}

// ─── §3 INDICATOR → CATEGORY MAP (Item 21 — enriched) ───────────────────────
function CategoryMap({ ind, weights, cats, indFreq }) {
  // Group IND keys by category (IND[id][2]) and sort within category by tier
  // asc, then short name. Augment with INDICATOR_META so each row can show
  // phase / timing / source / measure / rationale.
  const grouped = useMemo(() => {
    const g = {};
    Object.keys(ind || {}).forEach((id) => {
      const row = ind[id] || [];
      const cat = row[2];
      if (!cat) return;
      if (!g[cat]) g[cat] = [];
      const meta = INDICATOR_META[id] || {};
      g[cat].push({
        id,
        short: row[0],
        long: row[1],
        tier: row[3],
        unit: row[4],
        weight: (weights && weights[id]) || 0,
        freq: (indFreq && indFreq[id]) || "",
        phase: meta.phase || "",
        timing: meta.timing || "",
        source: meta.source || "",
        measure: meta.measure || "",
        rationale: meta.rationale || "",
      });
    });
    Object.values(g).forEach((rows) => rows.sort((a,b) => (a.tier - b.tier) || a.short.localeCompare(b.short)));
    return g;
  }, [ind, weights, indFreq]);

  // Keep category rendering order stable and consistent with App.jsx order.
  const CAT_ORDER = ["equity","credit","rates","fincond","bank","labor"];
  const orderedCats = CAT_ORDER.filter((k) => grouped[k] && grouped[k].length > 0);
  const totalCount = Object.values(grouped).reduce((n, rows) => n + rows.length, 0);

  return (
    <section id={A("catmap")} data-testid="methodology-section-catmap"
      style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <SectionHeader
        label="INDICATOR → CATEGORY MAP"
        sub={`${totalCount} macro indicators · ${orderedCats.length} categories`}
        applies={[
          { id:"overview",  label:"Macro Overview",  path:"#overview" },
          { id:"indicators", label:"All Indicators", path:"#indicators" },
        ]}
      />
      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.65, maxWidth:880 }}>
        Every indicator that feeds the Composite, grouped by category. <strong>Phase</strong> = how quickly
        the number moves (Fast daily market obs vs Slow survey / accounting). <strong>Timing</strong> =
        leading / coincident / lagging relative to real-economy activity. <strong>Weight tier</strong> =
        T1 (1.5×, most market-sensitive), T2 (1.2×, important but less real-time), T3 (1.0×, structural /
        context). Rendered live from <code style={{ fontFamily:"var(--font-mono)" }}>IND</code>
        + <code style={{ fontFamily:"var(--font-mono)" }}>WEIGHTS</code> + local <code
        style={{ fontFamily:"var(--font-mono)" }}>INDICATOR_META</code>; App.jsx is the source of truth for
        IND and WEIGHTS.
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {orderedCats.map((ck) => {
          const cat = cats?.[ck];
          if (!cat) return null;
          const rows = grouped[ck];
          return (
            <div key={ck} style={{ background:"var(--surface)", border:"1px solid var(--border)",
                                    borderRadius:8, overflow:"hidden" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
                            background:"var(--surface-2)", borderBottom:"1px solid var(--border)" }}>
                <span style={{ width:10, height:10, borderRadius:2, background:cat.color }}/>
                <span style={{ fontSize:12, fontWeight:700, color:"var(--text)",
                               fontFamily:"var(--font-mono)", letterSpacing:"0.06em", textTransform:"uppercase" }}>
                  {cat.label}
                </span>
                <span style={{ fontSize:10, color:"var(--text-dim)", fontFamily:"var(--font-mono)" }}>
                  · {rows.length} {rows.length === 1 ? "indicator" : "indicators"}
                </span>
              </div>
              <div style={{ display:"flex", flexDirection:"column" }}>
                {rows.map((r, idx) => (
                  <div key={r.id}
                    style={{ padding:"12px 14px",
                             borderTop: idx === 0 ? "none" : "1px solid var(--border)",
                             display:"flex", flexDirection:"column", gap:6 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <span style={{ fontSize:13, fontWeight:700, color:"var(--text)",
                                     fontFamily:"var(--font-mono)" }}>
                        {r.short}
                      </span>
                      <span style={{ fontSize:11, color:"var(--text-muted)" }}>
                        {r.long}
                      </span>
                      <span style={{ flex:1 }}/>
                      <TierChip tier={r.tier} weight={r.weight}/>
                      <PillChip text={r.phase} color={PHASE_COLOR[r.phase]}/>
                      <PillChip text={r.timing} color={TIMING_COLOR[r.timing]}/>
                      <PillChip text={FREQ_LABEL[r.freq] || r.freq} color={freqAccent(FREQ_LABEL[r.freq] || r.freq)}/>
                    </div>
                    {r.measure && (
                      <div style={{ fontSize:12, color:"var(--text-2)", lineHeight:1.6 }}>
                        {r.measure}
                      </div>
                    )}
                    <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
                      {r.source && (
                        <div style={{ fontSize:11, color:"var(--text-muted)" }}>
                          <span style={{ fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                                         letterSpacing:"0.08em" }}>SOURCE · </span>
                          {r.source}
                        </div>
                      )}
                      {r.rationale && (
                        <div style={{ fontSize:11, color:"var(--text-muted)" }}>
                          <span style={{ fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                                         letterSpacing:"0.08em" }}>TIER · </span>
                          {r.rationale}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TierChip({ tier, weight }) {
  const color = TIER_COLOR[tier] || "var(--text-muted)";
  return (
    <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color, border:`1px solid ${color}`,
                    borderRadius:3, padding:"2px 6px", letterSpacing:"0.05em", fontWeight:700 }}>
      T{tier} · {Number(weight).toFixed(1)}×
    </span>
  );
}

function PillChip({ text, color }) {
  if (!text) return null;
  const c = color || "var(--text-muted)";
  return (
    <span style={{ fontSize:10, fontFamily:"var(--font-mono)", color:c, border:`1px solid ${c}`,
                    borderRadius:3, padding:"2px 6px", letterSpacing:"0.04em", opacity:0.9 }}>
      {text}
    </span>
  );
}

const thStyle = { textAlign:"left", fontWeight:600, fontSize:10, letterSpacing:"0.08em",
                   textTransform:"uppercase", padding:"8px 12px" };
const tdStyle = { padding:"8px 12px", verticalAlign:"top" };

// ─── §4 COMPOSITE MATH ──────────────────────────────────────────────────────
function CompositeMath({ ind, weights }) {
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
      <SectionHeader
        label="COMPOSITE SCORE MATH"
        sub="How the 25 indicators roll up into one number"
        applies={[
          { id:"home",     label:"Home",           path:"#home" },
          { id:"overview", label:"Macro Overview", path:"#overview" },
        ]}
      />

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

        <P><strong>Step 3 — apply tier weights.</strong> The 25 indicators split into three tiers by market
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
    </section>
  );
}

// ─── §5 SIGNAL SCORE MATH (Item 24 — single-score methodology) ──────────────
function SignalScoreMath() {
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
      <SectionHeader
        label="SIGNAL SCORE MATH"
        sub="Single composite on [−100, +100]"
        applies={[
          { id:"scanner",  label:"Trading Scanner",                         path:"#scanner" },
          { id:"portopps", label:"Trading Opportunities & Portfolio Insights", path:"#portopps" },
        ]}
      />

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
    </section>
  );
}

// ─── §6 CATALOG — tiles + search (Item 25 — plain-English) ──────────────────
// Section blurbs rewritten away from raw table names.
const SECTION_BLURBS_OVERRIDE = {
  macro:   "Upstream macro data that feeds the Composite Stress Score. Each stream is z-scored against its own history, direction-flipped if lower-is-worse, then tier-weighted into a single number.",
  scanner: "Upstream signals the daily scanner reads when it scores each ticker on [−100, +100]. Each one contributes a section subscore (Options, Insider, Congress, Analyst, Technicals, Dark Pool) that the composite blends.",
  infra:   "Supabase aggregation tables the UI reads from. They don't introduce new data — they collect and stamp the upstream streams so every surface can look up the latest value in one fast query. Think of them as the plumbing, not the signal.",
};

function CatalogSection({ ind, asOf, cats }) {
  const [query, setQuery] = useState("");
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return REGISTRY_WITH_BLOBS;
    return REGISTRY_WITH_BLOBS.filter((row) => row._blob.includes(q));
  }, [q]);

  const bySection = useMemo(() => {
    const map = new Map(DATA_SECTIONS.map((s) => [s.key, []]));
    for (const row of filtered) {
      const bucket = map.get(row.section);
      if (bucket) bucket.push(row);
    }
    return map;
  }, [filtered]);

  const totalCount = REGISTRY_WITH_BLOBS.length;
  const matchCount = filtered.length;

  function toggle(key) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function expandAllVisible() { setOpenKeys(new Set(filtered.map((r) => r.key))); }
  function collapseAll()      { setOpenKeys(new Set()); }

  return (
    <section id={A("catalog")} data-testid="methodology-section-catalog"
      style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <SectionHeader
        label="DATA STREAMS CATALOG"
        sub={`${totalCount} streams · searchable`}
        applies={[
          { id:"overview",  label:"Macro Overview",  path:"#overview" },
          { id:"indicators", label:"All Indicators", path:"#indicators" },
          { id:"scanner",   label:"Trading Scanner", path:"#scanner" },
        ]}
      />

      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.65, maxWidth:820 }}>
        Every upstream data stream in one place. Click a tile to expand. Use the search box to filter by
        name, source, series ID, keyword, or downstream tab.
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search streams, sources, series IDs, keywords…"
          aria-label="Search data streams"
          data-testid="methodology-search"
          style={{
            flex:"1 1 320px", minWidth:260, maxWidth:560,
            fontSize:13, padding:"9px 12px",
            border:"1px solid var(--border)", borderRadius:6,
            background:"var(--surface-2)", color:"var(--text)",
            fontFamily:"var(--font-mono)", outline:"none",
          }}
        />
        <span data-testid="methodology-match-count"
          style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--text-dim)", whiteSpace:"nowrap" }}>
          {q ? `${matchCount} / ${totalCount} streams` : `${totalCount} streams`}
        </span>
        <button type="button" onClick={expandAllVisible} style={catalogBtnStyle}>Expand visible</button>
        <button type="button" onClick={collapseAll}     style={catalogBtnStyle}>Collapse all</button>
      </div>

      {DATA_SECTIONS.map((sec) => {
        const rows = bySection.get(sec.key) || [];
        if (q && rows.length === 0) return null;
        const blurb = SECTION_BLURBS_OVERRIDE[sec.key] || sec.blurb;
        return (
          <div key={sec.key} style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:10,
                          paddingBottom:6, borderBottom:"1px solid var(--border)" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--text)",
                            fontFamily:"var(--font-mono)", letterSpacing:"0.08em" }}>
                {sec.label.toUpperCase()}
              </div>
              <div style={{ fontSize:11, color:"var(--text-dim)", fontFamily:"var(--font-mono)" }}>
                · {rows.length} {rows.length === 1 ? "stream" : "streams"}
              </div>
            </div>
            <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.55, maxWidth:820, marginBottom:4 }}>
              {blurb}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(360px, 1fr))", gap:10 }}>
              {rows.map((row) => (
                <Tile key={row.key} row={row} cats={cats}
                  open={openKeys.has(row.key)} onToggle={() => toggle(row.key)}
                  ind={ind} asOf={asOf}/>
              ))}
            </div>
          </div>
        );
      })}

      {q && matchCount === 0 && (
        <div style={{ background:"var(--surface)", border:"1px dashed var(--border)",
                      borderRadius:8, padding:"16px 18px",
                      fontSize:13, color:"var(--text-muted)", textAlign:"center" }}>
          No streams match <code style={{ color:"var(--text)" }}>{JSON.stringify(query)}</code>.
          Try <code>fred</code>, <code>options</code>, or <code>quarterly</code>.
        </div>
      )}
    </section>
  );
}

const catalogBtnStyle = {
  fontSize:11, fontFamily:"var(--font-mono)",
  padding:"6px 10px", borderRadius:4,
  background:"var(--surface-2)", color:"var(--text-2)",
  border:"1px solid var(--border)", cursor:"pointer",
};

function Tile({ row, open, onToggle, ind, asOf, cats }) {
  const cat = row.category && cats ? cats[row.category] : null;
  const freqColor = freqAccent(row.freq);

  const longDescription = row.section === "macro" && row.indId
    ? (ind?.[row.indId]?.[12] || row.details || row.summary)
    : (row.details || row.summary);
  const latestData = row.section === "macro" && row.indId ? (asOf?.[row.indId] || null) : null;

  return (
    <div role="button" tabIndex={0} onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      aria-expanded={open}
      data-testid={`methodology-tile-${row.key}`}
      style={{ background:"var(--surface)", border:"1px solid var(--border)",
               borderRadius:8, padding:"12px 14px", cursor:"pointer",
               transition:"background 120ms ease, border-color 120ms ease" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
        {cat && <div title={cat.label}
          style={{ width:10, height:10, borderRadius:2, background:cat.color, marginTop:5, flexShrink:0 }}/>}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:6, flexWrap:"wrap" }}>
            <div style={{ fontSize:14, fontWeight:700, color:"var(--text)", fontFamily:"var(--font-mono)" }}>
              {row.name}
            </div>
            {row.tier && (
              <span style={{ fontSize:9, color:cat?.color || "var(--text-dim)",
                             fontFamily:"var(--font-mono)", letterSpacing:"0.08em", fontWeight:700 }}>
                T{row.tier}
              </span>
            )}
          </div>
          {row.longName && row.longName !== row.name && (
            <div style={{ fontSize:11, color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginTop:2 }}>
              {row.longName}
            </div>
          )}
        </div>
        <div style={{ fontSize:14, color:"var(--text-dim)", lineHeight:1, marginTop:2, flexShrink:0 }}>
          {open ? "▾" : "▸"}
        </div>
      </div>

      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8 }}>
        <Chip label={row.source} tone="neutral"/>
        <Chip label={row.freq} tone="accent" color={freqColor}/>
      </div>

      <div style={{ fontSize:12, color:"var(--text-2)", lineHeight:1.65, marginTop:8 }}>
        {row.summary}
      </div>

      {open && (
        <div style={{ marginTop:10, paddingTop:10, borderTop:"1px dashed var(--border)",
                      display:"flex", flexDirection:"column", gap:8 }}>
          {row.seriesId && <Field label="Series / endpoint" value={row.seriesId} mono/>}
          {latestData && <Field label="Latest data" value={latestData} mono/>}
          {row.powers?.length > 0 && (
            <Field label="Powers" valueNode={
              <ul style={{ margin:0, paddingLeft:18, fontSize:12, color:"var(--text-2)", lineHeight:1.6 }}>
                {row.powers.map((p) => <li key={p}>{p}</li>)}
              </ul>
            }/>
          )}
          <Field label="Detail" valueNode={
            <div style={{ fontSize:12, color:"var(--text-2)", lineHeight:1.75 }}>
              {longDescription}
            </div>
          }/>
          {cat && <Field label="Category" value={cat.label}/>}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone, color }) {
  if (!label) return null;
  const baseColor = color || (tone === "accent" ? "var(--accent)" : "var(--text-muted)");
  return (
    <span style={{ fontSize:10, fontFamily:"var(--font-mono)", letterSpacing:"0.04em",
                    color:baseColor, border:`1px solid ${baseColor}`, borderRadius:3,
                    padding:"2px 6px", lineHeight:1.45, whiteSpace:"nowrap", opacity:0.9 }}>
      {label}
    </span>
  );
}

function Field({ label, value, valueNode, mono }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
      <div style={{ fontSize:10, color:"var(--text-dim)", fontFamily:"var(--font-mono)",
                    letterSpacing:"0.08em" }}>
        {label.toUpperCase()}
      </div>
      {valueNode ? valueNode : (
        <div style={{ fontSize:12, color:"var(--text-2)",
                      fontFamily:mono ? "var(--font-mono)" : "inherit", lineHeight:1.6 }}>
          {value}
        </div>
      )}
    </div>
  );
}

// ─── Shared widgets ─────────────────────────────────────────────────────────
// SectionHeader now optionally carries an APPLIES TO chip group — Item 22.
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
