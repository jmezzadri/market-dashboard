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
      <Contents />
      <MacroIndicatorTable ind={ind} weights={weights} cats={cats} indFreq={indFreq} asOf={asOf} />
      <CompositeMath ind={ind} weights={weights} cats={cats} />
      <DataCatalogTable ind={ind} asOf={asOf} />
      <SignalScoreMath />
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

// ─── CONTENTS (replaces prior JumpNav strip) ────────────────────────────────
function Contents() {
  const items = [
    { num: "1", label: "Macro Mapping & Data Sources",   sub: "The 25 macro indicators — source, frequency, last refresh, tier, weight, type, detail.",                id: A("catmap") },
    { num: "2", label: "Macro Methodology",              sub: "How the 25 indicators roll up into one 0-100 Composite Stress Score and four conviction bands.",        id: A("composite-math") },
    { num: "3", label: "Equity Scanner Data Sources",    sub: "The 8 upstream streams that feed the per-ticker Signal Score — scanner section + weight each carries.",   id: A("catalog") },
    { num: "4", label: "Equity Scanner Methodology",     sub: "How six section sub-scores combine into a single signed composite on [-100, +100] per ticker.",           id: A("signal-math") },
  ];
  return (
    <nav data-testid="methodology-contents" aria-label="Contents"
      style={{ display:"flex", flexDirection:"column", gap:0,
               border:"1px solid var(--border)", borderRadius:8,
               background:"var(--surface)", overflow:"hidden" }}>
      <div style={{ fontSize:10, fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                    letterSpacing:"0.08em", textTransform:"uppercase",
                    padding:"8px 12px", borderBottom:"1px solid var(--border)",
                    background:"var(--surface-2)" }}>
        Contents
      </div>
      {items.map((it, i) => (
        <a key={it.id} href={`#${it.id}`}
           onClick={(e) => { e.preventDefault(); scrollToAnchor(it.id); }}
           style={{ display:"flex", alignItems:"baseline", gap:12,
                    padding:"10px 12px", textDecoration:"none", color:"var(--text)",
                    borderTop: i === 0 ? "none" : "1px solid var(--border)", cursor:"pointer" }}>
          <span style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--text-dim)",
                         width:14, flexShrink:0 }}>
            {it.num}.
          </span>
          <span style={{ fontSize:13, fontWeight:600, minWidth:280, color:"var(--text)" }}>
            {it.label}
          </span>
          <span style={{ fontSize:11, color:"var(--text-muted)", lineHeight:1.5, flex:1 }}>
            {it.sub}
          </span>
        </a>
      ))}
    </nav>
  );
}

// ─── §2 MACRO MAPPING & DATA SOURCES (sortable table) ──────────────────────
function MacroIndicatorTable({ ind, weights, cats, indFreq, asOf }) {
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
        tier,
        weight: w,
        timing: meta.timing || "",
        detail: meta.measure || "",
      };
    });
  }, [ind, weights, cats, indFreq, asOf]);

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
      <SectionHeader
        label="1 · MACRO MAPPING & DATA SOURCES"
        sub={`${rows.length} macro indicators · sortable`}
        applies={[
          { id:"overview",   label:"Macro Overview",  path:"#overview" },
          { id:"indicators", label:"All Indicators",  path:"#indicators" },
        ]}
      />
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
            {sorted.map((r) => (
              <tr key={r.id} style={{ borderTop:"1px solid var(--border)" }}>
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
                <td style={{ ...tdStyle, color:"var(--text-2)", whiteSpace:"nowrap" }}>{r.asOf || "—"}</td>
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
    </section>
  );
}

// ─── §3 MACRO METHODOLOGY ──────────────────────────────────────────────────
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
        label="2 · MACRO METHODOLOGY"
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

// ─── §5 EQUITY SCANNER METHODOLOGY ─────────────────────────────────────────
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
        label="4 · EQUITY SCANNER METHODOLOGY"
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
    </section>
  );
}

// ─── §4 EQUITY SCANNER DATA SOURCES (sortable flat table, scanner-only) ───
// Scanner data only — the macro indicators have their own table in §1, so
// repeating them here would be redundant.
function DataCatalogTable({ ind, asOf }) {
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
      <SectionHeader
        label="3 · EQUITY SCANNER DATA SOURCES"
        sub={`${rows.length} streams that feed the per-ticker Signal Score · sortable`}
        applies={[
          { id:"scanner",  label:"Trading Scanner",                            path:"#scanner" },
          { id:"portopps", label:"Trading Opportunities & Portfolio Insights", path:"#portopps" },
        ]}
      />
      <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.65, maxWidth:880 }}>
        Every upstream stream the scanner reads when it scores a ticker. Click a column header to sort.
        <strong> Frequency</strong> is how often the stream refreshes (D = once per weekday, 3x/D = three
        pulls per weekday). <strong>Weight</strong> is that stream's share of the overall Signal Score
        (see §4). Before any of this runs, a price ($5–$500) and market-cap screen from the Unusual Whales
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
    </section>
  );
}

// Mapping tables used by §4.
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
