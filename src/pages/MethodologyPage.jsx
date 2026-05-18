// MethodologyPage — full overhaul (2026-05-04).
//
// Layout:
//   Hero (eyebrow / headline / subhead / last-updated stamp)
//   Search bar (filters the TOC live)
//   Two-column layout:
//     Left: sticky TOC, collapsible per section, smooth-scroll anchors
//     Right: long-form sections in site flow:
//       1. Macro Overview
//       2. Asset Tilt
//       3. Trading Opportunities
//       4. Portfolio Insights
//     Each section: Why → How to use → Data → Models
//     Plus four appendices: Hard rules · Backtest · Sources · Glossary
//
// Site brand: Fraunces display, Inter body, JetBrains Mono technical, parchment palette.

import { useState, useEffect, useMemo, useRef } from "react";
import MTTable from "../components/MTTable";

// ─── Section schema ────────────────────────────────────────────────────────
// Used for TOC, search filtering, and content rendering. Each subsection's
// `body` is a JSX renderer; the searchable text comes from `searchText`.

const SECTIONS = [
  {
    id: "macro-overview",
    num: "01",
    title: "Macro Overview",
    blurb: "The indicator backdrop. No regime call.",
    sub: [
      { id: "macro-why",      label: "Why we built it" },
      { id: "macro-how",      label: "How to use it" },
      { id: "macro-data",     label: "Data behind it" },
      { id: "macro-models",   label: "Models & calcs" },
    ],
  },
  {
    id: "asset-tilt",
    num: "02",
    title: "Asset Tilt",
    blurb: "The 2-axis engine. Risk On / Watch / Risk Off lives here.",
    sub: [
      { id: "tilt-why",       label: "Why we built it" },
      { id: "tilt-how",       label: "How to use it" },
      { id: "tilt-data",      label: "Data behind it" },
      { id: "tilt-models",    label: "Models & calcs" },
    ],
  },
  {
    id: "trading-opps",
    num: "03",
    title: "Trading Opportunities",
    blurb: "What to act on today.",
    sub: [
      { id: "ops-why",        label: "Why we built it" },
      { id: "ops-how",        label: "How to use it" },
      { id: "ops-data",       label: "Data behind it" },
      { id: "ops-models",     label: "Models & calcs" },
    ],
  },
  {
    id: "portfolio-insights",
    num: "04",
    title: "Portfolio Insights",
    blurb: "What it means for your holdings.",
    sub: [
      { id: "port-why",       label: "Why we built it" },
      { id: "port-how",       label: "How to use it" },
      { id: "port-data",      label: "Data behind it" },
      { id: "port-models",    label: "Models & calcs" },
    ],
  },
  {
    id: "hard-rules",
    num: "A",
    title: "Hard rules & constraints",
    blurb: "Caps that bind every decision.",
    sub: [],
  },
  {
    id: "backtest",
    num: "B",
    title: "Backtest evidence",
    blurb: "1986 → 2026 · 2,056 weeks · 4 strategies.",
    sub: [],
  },
  {
    id: "sources",
    num: "C",
    title: "Sources",
    blurb: "Where every number comes from.",
    sub: [],
  },
  {
    id: "glossary",
    num: "D",
    title: "Glossary",
    blurb: "Terms used across the site.",
    sub: [],
  },
];

// ─── Reusable styled blocks ────────────────────────────────────────────────

const styles = {
  section: {
    paddingTop: 28,
    marginBottom: 48,
    scrollMarginTop: 80,  // anchor offset under sticky header
  },
  sectionEyebrow: {
    fontFamily: "var(--font-mono)", fontSize: 10,
    color: "var(--text-muted)", letterSpacing: "0.14em",
    textTransform: "uppercase", fontWeight: 600, marginBottom: 6,
  },
  sectionH2: {
    fontFamily: "var(--font-display, Georgia, serif)",
    fontSize: 30, fontWeight: 500, margin: "0 0 6px",
    letterSpacing: "-0.015em", lineHeight: 1.1,
  },
  sectionBlurb: {
    fontFamily: "var(--font-display, Georgia, serif)",
    fontSize: 16, fontStyle: "italic", color: "var(--text-muted)",
    margin: 0, lineHeight: 1.4,
  },
  subH3: {
    fontFamily: "var(--font-display, Georgia, serif)",
    fontSize: 18, fontWeight: 500, margin: "32px 0 10px",
    letterSpacing: "-0.01em", scrollMarginTop: 80,
  },
  body: {
    fontSize: 14, lineHeight: 1.65, color: "var(--text)",
    margin: "0 0 12px",
  },
  bodyMuted: {
    fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)",
    margin: "0 0 12px",
  },
  callout: {
    background: "var(--surface-2)",
    border: "0.5px solid var(--border)",
    borderRadius: 6, padding: "12px 14px", margin: "12px 0 16px",
    fontSize: 13, lineHeight: 1.55, color: "var(--text)",
  },
  formula: {
    fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
    fontSize: 12.5, background: "var(--surface-2)",
    padding: "10px 14px", borderRadius: 5, borderLeft: "3px solid var(--accent)",
    margin: "10px 0", whiteSpace: "pre-wrap", lineHeight: 1.55,
  },
  // table/th/td removed 2026-05-11 — replaced by shared MTTable primitive
  // (rendered in Tier B "look" mode via the local DocsTable helper below).
  inlineCode: {
    fontFamily: "var(--font-mono, monospace)", fontSize: 12,
    background: "var(--surface-2)", padding: "1px 6px", borderRadius: 3,
  },
  bullet: { margin: "6px 0", paddingLeft: 0, lineHeight: 1.55 },
};

// Inline pieces that show up repeatedly
function Code({ children }) { return <code style={styles.inlineCode}>{children}</code>; }
function Formula({ children }) { return <div style={styles.formula}>{children}</div>; }
function Callout({ children }) { return <div style={styles.callout}>{children}</div>; }
function Body({ children }) { return <p style={styles.body}>{children}</p>; }

// DocsTable — wraps the shared MTTable primitive in "look" (Tier B) mode for
// the reference / lookup tables on this page. Cells keep their inline JSX
// (Code, em, strong) via the column `render` prop. Each entry in `cols` can
// be either a string label or an object `{ label, numeric }` — numeric
// columns get right-aligned + tabular-nums per MTTable's styling.
function DocsTable({ cols, rows }) {
  const columns = cols.map((c, i) => {
    const spec = typeof c === "string" ? { label: c } : c;
    return {
      key: "c" + i,
      label: spec.label,
      numeric: !!spec.numeric,
      render: (r) => r["c" + i],
    };
  });
  const rowObjs = rows.map((cells, i) => {
    const o = { _id: i };
    cells.forEach((cell, j) => { o["c" + j] = cell; });
    return o;
  });
  // Tier A across the board (sweep PR 2026-05-12): even reference / docs
  // tables get the full sort/filter/resize/Columns toolbar so the site
  // looks identical everywhere. Methodology page has many of these, so each
  // gets a unique storageKey derived from its column shape.
  const sk = "methodology_" + columns.map((c) => c.label).join("|").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  return <MTTable columns={columns} rows={rowObjs} rowKey="_id" features="full" storageKey={sk} />;
}

// ─── Section content (hand-written prose, no auto-generation) ──────────────

const SECTION_CONTENT = {
  // ============================================================
  // §1 MACRO OVERVIEW
  // ============================================================
  "macro-why": (
    <>
      <Body>
        The Macro Overview is the <strong>indicator backdrop</strong> — the five things you should know about the macro tape today, organized into five domains: Rates, Credit, Equities, Money & Banking, and the real Economy. Twenty-seven indicators in all, each on its own tile, each colored against its own five-year history.
      </Body>
      <Body>
        <strong>This page does not take a regime stance.</strong> No Risk On / Risk Off call lives here. No regime label, no composite score, no "stress score" rolled across the page. The Macro Overview's job is to lay out the evidence — what each indicator is doing today, where it sits in its five-year range, and which direction it is moving.
      </Body>
      <Callout>
        <strong>The regime read lives on Asset Tilt.</strong> If you want to know whether the engine is calling Risk On, Watch, or Risk Off — and what allocation that implies — click through to the next tab. Macro Overview is the source data that the engine reads from, presented honestly without any layered interpretation.
      </Callout>
    </>
  ),
  "macro-how": (
    <>
      <Body>
        Five domain panels stacked top-to-bottom. Each panel holds the indicators that describe one slice of the macro tape:
      </Body>
      <DocsTable
        cols={["Domain", "What it covers"]}
        rows={[
          ["Rates",            "The cost and shape of money — what duration is being repriced."],
          ["Credit",           "What lenders are charging for risk, and whether they're still lending."],
          ["Equities",         "What the stock tape is pricing in — level, volatility, and tail risk."],
          ["Money & Banking",  "How freely capital is moving through the financial plumbing."],
          ["Economy",          "The real-world pulse — labor, activity, and cyclical demand."],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>How to read a tile</h4>
      <Body>
        Each indicator is shown as a tile carrying the current value, the change vs. the prior reading, a five-year sparkline, and a percentile pill showing where today sits in the five-year range. Tiles are colored by where the current reading falls in its five-year history:
      </Body>
      <DocsTable
        cols={["Color", "Meaning"]}
        rows={[
          ["Calm",         "Reading is not signalling stress (mid or low end of its 5y range, in the non-stress direction)."],
          ["Elevated",     "Mid-range — worth watching."],
          ["Stressed",     "Reading is at an extreme of its 5y range, in the direction that historically means stress."],
          ["Range-only",   "Direction-agnostic indicator — color suppressed; the tile shows position in 5y range only."],
        ]}
      />
      <Body>
        Click any tile for full history (back to 1986 where available), the indicator's methodology card, and overlay options for cross-indicator comparison. The hero strip at the top of the page summarizes today's count: how many indicators are Calm vs. Elevated vs. Stressed, and which domains carry the stress.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Refresh cadence</h4>
      <Body>
        Market-data indicators (rates, VIX, MOVE, credit OAS, indices) refresh after the 4 PM ET US close. Survey and economic-release indicators (ISM, SLOOS, JOLTS, jobless claims, Fed balance sheet) refresh on their published release calendars. The freshness chip on each tile tells you exactly when that indicator last updated — green within SLA, amber overdue, red if the pipeline has failed.
      </Body>
    </>
  ),
  "macro-data": (
    <>
      <Body>
        Twenty-seven indicators across five domains. All from public sources. Each indicator has a published vendor, a refresh cadence, and a documented historical window.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Rates (5 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["Yield curve (10y − 2y)",       "FRED T10Y2Y",                "Daily"],
          ["10y real yield",               "FRED DFII10",                "Daily"],
          ["MOVE · bond volatility",       "ICE BofA via Yahoo ^MOVE",   "Daily after close"],
          ["Term premium",                 "NY Fed ACM model · FRED",    "Daily"],
          ["10y breakeven inflation",      "FRED T10YIE",                "Daily"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Credit (5 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["High-yield OAS",               "ICE BofA · FRED BAMLH0A0HYM2",  "Daily"],
          ["Investment-grade OAS",         "ICE BofA · FRED BAMLC0A0CM",    "Daily"],
          ["HY / IG spread ratio",         "Derived from FRED OAS series",  "Daily"],
          ["SLOOS · C&I tightening",       "Federal Reserve SLOOS",         "Quarterly"],
          ["SLOOS · CRE tightening",       "Federal Reserve SLOOS",         "Quarterly"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Equities (5 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["Buffett indicator",            "FRED NCBCEL / GDP",          "Quarterly"],
          ["CAPE · Shiller P/E",           "Shiller · multpl",           "Monthly"],
          ["VIX · equity volatility",      "CBOE direct feed",           "Daily, real-time"],
          ["SKEW · tail risk",             "CBOE direct feed",           "Daily"],
          ["Equity-credit correlation",    "Derived: SPX vs HY OAS rolling correlation", "Daily"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Money & Banking (6 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["Commercial paper spread",      "Federal Reserve H.15 · FRED CPFF",   "Weekly · Wed"],
          ["Chicago Fed FCI (NFCI)",       "Chicago Fed · FRED ANFCI",           "Weekly"],
          ["St. Louis FCI",                "St. Louis Fed · FRED STLFSI",        "Weekly"],
          ["KBW Bank / SPX",               "NASDAQ KBW BKX vs SPX",              "Daily"],
          ["Bank credit growth (YoY)",     "Federal Reserve H.8 · FRED",         "Weekly"],
          ["Fed balance sheet (YoY)",      "Federal Reserve H.4.1 · FRED WALCL", "Weekly"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Economy (6 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["Initial jobless claims (4w avg)", "US DOL · FRED IC4WSA",        "Weekly"],
          ["ISM Manufacturing",               "ISM via FRED NAPMPI",         "Monthly"],
          ["JOLTS · quits rate",              "BLS · FRED JTSQUR",           "Monthly"],
          ["Copper / Gold ratio",             "CME front-month via Yahoo",   "Daily"],
          ["USD broad index",                 "Federal Reserve H.10 · FRED DTWEXBGS", "Daily"],
          ["Chicago Fed Nat. Activity",       "Chicago Fed · FRED CFNAI",    "Monthly"],
        ]}
      />
      <Body>
        Every indicator's color and percentile pill is computed against its own <strong>trailing 5-year window</strong>. This is deliberate — market and macro regimes drift across decades, so a 5y rolling sample keeps the reading calibrated to today's structural environment rather than an era that has already passed.
      </Body>
    </>
  ),
  "macro-models": (
    <>
      <Body>
        There is no model on this page. The Macro Overview does not compute a regime, a composite, or a stress score — it presents each indicator on its own merits. The only computation per tile is the color assignment and the percentile pill.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>How each tile is colored</h4>
      <Body>
        Every indicator has a defined "stress direction" — the direction (high or low) in which the reading historically means tightening, slowdown, or risk. For each tile, the current value is ranked against a trailing-five-year sample and the tile is colored by the position of that rank in the stress direction:
      </Body>
      <Formula>{`raw_pct = percentile_rank( indicator.current, indicator.history_5y )

if indicator.stress_direction == "low":
   stress_pct = 100 − raw_pct          # invert: low readings = stress
else:
   stress_pct = raw_pct                # high readings = stress

color = "Calm"        if stress_pct < 60
        "Elevated"    if 60 <= stress_pct < 80
        "Stressed"    if stress_pct >= 80
        "Range-only"  if indicator.stress_direction == "neutral"`}</Formula>
      <Body>
        The "Range-only" case covers a small set of indicators where the direction-of-stress is context-dependent (USD broad index, CFNAI). For these, the tile shows the percentile pill but suppresses the color — the user reads position-in-range without a directional editorial.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Why no aggregation</h4>
      <Body>
        Earlier iterations of MacroTilt rolled the indicators up into composite scores and four-state regime labels on this page. That work was retired on 2026-05-17. The composites correlated heavily, the labels were sensitive to small calibration choices, and the editorial roll-up obscured the per-indicator signal the user came to the page for. The decision: the Macro Overview presents the evidence, the Asset Tilt engine does the interpretation, and the two surfaces stay cleanly separated.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Refresh pipeline</h4>
      <Body>
        Each indicator refreshes on its own published schedule and writes to the data registry. The freshness chip on each tile is wired directly to the registry — it shows the actual last-fetch timestamp and the SLA, not a hardcoded "as of" date. If a pipeline fails twice in a row, the chip goes red and a bug auto-files.
      </Body>
    </>
  ),

  // ============================================================
  // §2 ASSET TILT
  // ============================================================
  "tilt-why": (
    <>
      <Body>
        Macro Overview shows the tape. Asset Tilt is where the tape becomes a portfolio. This is the page that takes a regime stance — it runs the locked 2-axis engine and outputs an explicit allocation: equity percentage, defensive sleeve composition keyed to yield direction, plus sector and industry-group tilts within the equity bucket.
      </Body>
      <Body>
        The engine has one stated objective: <strong>beat the S&P 500 on a risk-adjusted basis over the long run.</strong> Validated against 1986 → 2026, 2,056 weekly observations, the locked engine delivers Sharpe 0.61 vs SPY 0.50 with a max drawdown of 35% vs SPY's 55%. The improvement is in risk-adjusted return — slightly higher CAGR, materially smaller drawdowns.
      </Body>
      <Body>
        Two design principles:
      </Body>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}><strong>Every threshold is back-tested.</strong> The percentile cutoffs for Stress (75p → Watch, 85p → Risk Off) and Yield direction (70p / 30p) were chosen against 40 years of history. Nothing in the engine is hand-tuned.</li>
        <li style={styles.bullet}><strong>Hard caps bound every regime.</strong> Defensive sleeve never exceeds 50% of capital. Equity floor is 50% in Risk Off. The engine is currently unlevered (the v9 1.5× rule was orphaned by the 2-axis cutover and is parked for a separate Senior Quant validation).</li>
      </ul>
      <Body>
        These rules are constraints, not assumptions about what's optimal. Within the constraints, the engine produces a deterministic allocation that the back-test scored across forty years of regimes — and that the live page recomputes every 15:45 ET weekday.
      </Body>
    </>
  ),
  "tilt-how": (
    <>
      <Body>
        The page reads top-to-bottom in four blocks. Each block is independent — you can land on the page, glance at the engine read, and walk away with the headline allocation in under thirty seconds.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>1. Today's Engine Read</h4>
      <Body>
        Three cells side-by-side. The first two are dials — one for each axis:
      </Body>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}><strong>Stress signal</strong> — Risk On / Watch / Risk Off, driven by the trailing-5y percentile of the spliced MOVE Index. The dial shows where today sits relative to the 75th and 85th percentile cutoffs. Click for full 1986-today history.</li>
        <li style={styles.bullet}><strong>Yield regime</strong> — Inflationary / Neutral / Deflationary, driven by the trailing-5y percentile of the 3-month change in the 10-year Treasury yield. The dial shows where today's ΔY-3M sits relative to the 30th and 70th percentile cutoffs.</li>
      </ul>
      <Body>
        The third cell is the resulting allocation summary: equity %, defensive %, and the composition of the sleeve if active. Risk On = 100% equity. Watch = 80% equity / 20% defensive. Risk Off = 50% equity / 50% defensive. Sleeve composition changes by yield regime (see Models & calcs below).
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>2. Recommended Allocations table</h4>
      <Body>
        Eleven sectors plus four defensive buckets (BIL · GLD · SHY · TLT). Each row carries the sector name, ETF ticker, recommended dollar weight per $100 of capital, recent performance, realized volatility, and the rating + tilt vs SPY. Click any sector to expand its industry groups inline. Defensive rows are always visible — they show $0 when the sleeve is on standby and active dollars when stress crosses Watch.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>3. Heatmap</h4>
      <Body>
        Six cycle-mechanism rows × eleven sector columns. Each cell shows the contribution of that mechanism to that sector's tilt today: the sector's historical sensitivity to the mechanism multiplied by today's mechanism score. Darker teal = stronger effect. Click any mechanism row for a modal showing the mechanism's underlying indicators, today's reading, and methodology footer.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>4. Backtest Validation</h4>
      <Body>
        Four strategies compared side-by-side across 2,056 weekly observations 1986 → 2026:
      </Body>
      <DocsTable
        cols={["Strategy", "What it does"]}
        rows={[
          ["SPY buy & hold",            "Passive benchmark. Hold the broad equity index through every regime."],
          ["Regime + Cash",             "Use the engine's stress signal to scale equity 100 / 80 / 50%. Defensive bucket sits in cash."],
          ["Regime + Defensive Sleeve", "Same regime scaling, but the defensive bucket activates the yield-direction-aware sleeve (Cash + GLD + SHY/TLT)."],
          ["Engine + Asset Tilt",       "The MacroTilt headline strategy. Equity bucket follows the sector allocator; defensive bucket follows the engine sleeve."],
        ]}
      />
      <Body>
        Below the KPI grid sits a rebased interactive history chart of all four strategies plus a per-drawdown comparison table for the 11 major peak-to-trough episodes since 1986.
      </Body>
    </>
  ),
  "tilt-data": (
    <>
      <Body>
        The 2-axis engine reads two market data series plus the cycle mechanisms that drive the in-equity sector tilts.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Stress signal — spliced MOVE</h4>
      <DocsTable
        cols={["Window", "Source", "Notes"]}
        rows={[
          ["Pre-2002-11-12",  "21-day rolling std of daily 10Y yield changes × √252 (Z-standardized)", "Public MOVE data starts 2002. Pre-2002 the proxy is Z-score-rescaled to match MOVE's 2002-2007 distribution: μ_proxy 92.22 / σ_proxy 27.51 → μ_MOVE 87.97 / σ_MOVE 21.80."],
          ["2002-11-12 → today", "ICE BofA MOVE Index via Yahoo (^MOVE)",                                "Daily after close. Refreshed by the engine daily compute workflow."],
        ]}
      />
      <Body>
        The splice is validated empirically — the fire-rate around the 2002-11-12 boundary stays continuous (53.8% → 80.8% over the 6-month windows on either side, settling back to baseline within 18 months). Splice-continuity diagnostics live in <Code>FINAL_LOCKED_ENGINE_2026-05-13.md</Code>.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Yield direction — ΔY-3M</h4>
      <DocsTable
        cols={["Indicator", "Source", "Computation"]}
        rows={[
          ["10-year Treasury yield",       "FRED DGS10",                           "Daily constant-maturity yield, 1986 → today"],
          ["3-month change (ΔY-3M)",       "Derived from FRED DGS10",              "Today's 10Y minus the 10Y from 63 trading days ago"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Sector tilts — six cycle mechanisms</h4>
      <Body>
        Inside the equity bucket, sector and industry-group weights tilt away from SPY based on how each sector historically responds to the six cycle mechanisms (Valuation, Credit, Funding, Growth, Liquidity & Policy, Positioning & Breadth). Each mechanism rolls up from its own underlying indicator panel; the sensitivity matrix is documented as constants in the allocator script.
      </Body>
      <Body>
        Sector ETF universe: eleven GICS sectors with three ETF families to choose from per sector — the SPDR XL series (XLK / XLC / XLF / XLV / XLY / XLI / XLP / XLE / XLB / XLRE / XLU), the Vanguard V series, and the Fidelity F series. Plus four defensive buckets keyed to the yield regime: BIL (cash, 1-3M T-bills), GLD (gold), SHY (short Treasuries, 1-3y), TLT (long Treasuries, 20+y). SPY weights for the relative-tilt computation come from a quarterly snapshot.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Pipeline outputs</h4>
      <DocsTable
        cols={["File", "What it carries", "Refreshed by"]}
        rows={[
          [
            <Code>public/macrotilt_engine.json</Code>,
            "Today's engine read: regime, yield regime, sleeve composition, equity %, as-of, source attribution",
            <><Code>.github/workflows/macrotilt-engine-daily.yml</Code> · 15:45 ET weekdays</>,
          ],
          [
            <Code>public/macrotilt_engine_backtest.json</Code>,
            "Full 1986 → 2026 weekly back-test plus per-drawdown attribution (1.5 MB · 2,056 observations)",
            "Regenerated when the engine spec changes or fresh history lands.",
          ],
        ]}
      />
    </>
  ),
  "tilt-models": (
    <>
      <Body>
        Two axes, two percentile thresholds each, one allocation matrix. Plus an in-equity sector tilt step driven by the six cycle mechanisms. Every step is deterministic.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Axis 1 — Stress signal</h4>
      <Body>
        Today's spliced MOVE reading is ranked against the trailing-five-year window. The percentile result is bucketed into one of three labels:
      </Body>
      <Formula>{`stress_pct = percentile_rank( MOVE.today, MOVE.history_5y )

stress = "Risk On"   if stress_pct < 75
         "Watch"     if 75 <= stress_pct < 85
         "Risk Off"  if stress_pct >= 85`}</Formula>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Axis 2 — Yield direction</h4>
      <Body>
        Today's 3-month change in the 10-year Treasury yield (ΔY-3M) is ranked against the trailing-five-year window. Same percentile framework, three labels:
      </Body>
      <Formula>{`yield_pct = percentile_rank( ΔY3M.today, ΔY3M.history_5y )

yield = "Deflationary"  if yield_pct <= 30
        "Neutral"       if 30 < yield_pct < 70
        "Inflationary"  if yield_pct >= 70`}</Formula>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Allocation matrix — equity vs defensive</h4>
      <Body>
        Equity percentage is set by the stress axis alone:
      </Body>
      <DocsTable
        cols={["Stress", "Equity %", "Defensive %"]}
        rows={[
          ["Risk On",   "100%",  "0%"],
          ["Watch",     "80%",   "20%"],
          ["Risk Off",  "50%",   "50%"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Sleeve composition — keyed to yield regime</h4>
      <Body>
        When the defensive sleeve is active (stress is Watch or Risk Off), its internal composition is set by the yield axis. The sleeve activates the bucket mix that historically delivered best risk-adjusted returns under that yield regime:
      </Body>
      <DocsTable
        cols={["Yield regime", "Cash (BIL)", "GLD", "SHY", "TLT"]}
        rows={[
          ["Inflationary",   "50%",  "30%",  "20%",  "0%"],
          ["Neutral",        "50%",  "25%",  "0%",   "25%"],
          ["Deflationary",   "25%",  "25%",  "0%",   "50%"],
        ]}
      />
      <Body>
        Inflationary regimes lean cash + gold + short Treasuries; deflationary regimes lean long Treasuries; neutral splits the difference. The mix is not optimized weekly — it is a regime-keyed lookup table chosen against the 1986 → 2026 sample.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Sector tilts inside the equity bucket</h4>
      <Body>
        Within the equity sleeve, sector and industry-group weights tilt away from SPY based on how each sector responds to the six cycle mechanisms today:
      </Body>
      <Formula>{`for each sector:
   tilt_score = Σᵢ ( sensitivityᵢ × normalized_scoreᵢ )
       where normalized_scoreᵢ = ( mechanism_scoreᵢ − 50 ) / 50  ∈ [−1, +1]

   if tilt_score > +0.3   →  rating = OW,  multiplier = 1.20× SPY weight
   if tilt_score < −0.3   →  rating = UW,  multiplier = 0.75× SPY weight
   else                   →  rating = MW,  multiplier = 1.00× SPY weight

equity dollars = SPY_weight × multiplier  (renormalized so total = equity_pct × $100)`}</Formula>
      <Body>
        Each sector's six sensitivities are coefficients between roughly −1.5 and +1.5. Positive means the sector benefits when that mechanism is in caution / risk-off territory; negative means the sector is hurt. Industry groups inherit their parent sector's sensitivities plus IG-specific deltas.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>What's NOT in the engine today</h4>
      <Body>
        The v9 model's 1.5× leverage rule was orphaned by the cutover to the 2-axis engine (its input composites are no longer computed). The page currently ships unlevered — equity ceiling is 100%, no levered Risk On stance. Re-validating a levered version against MOVE percentile + ΔY-3M inputs is an open Senior Quant task.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Audit checks — every refresh</h4>
      <Body>
        Before the engine output ships, the workflow runs four assertions:
      </Body>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}><Code>0 ≤ equity_pct ≤ 100</Code> and <Code>0 ≤ defensive_pct ≤ 50</Code></li>
        <li style={styles.bullet}><Code>equity_pct + defensive_pct = 100</Code></li>
        <li style={styles.bullet}><Code>Stress and Yield labels match their percentile cutoffs</Code></li>
        <li style={styles.bullet}><Code>Sleeve composition rows sum to 100% for the active yield regime</Code></li>
      </ul>
      <Body>
        Any assertion failure halts the workflow and the page keeps the last-known-good allocation. No partial or inconsistent outputs ship.
      </Body>
    </>
  ),

  // ============================================================
  // §3 TRADING OPPORTUNITIES - Signal Intelligence (v5 ship)
  //
  // Rewritten in place per LESSONS rule #31 (rewrite, do not append).
  // v5 swaps the v4.1 three-filter / three-signal pipeline for a
  // six-signal weighted composite with bidirectional bands.
  // ============================================================
  "ops-why": (
    <>
      <Body>
        Asset Tilt tells you which sectors and industry groups to lean into. Trading Opportunities
        goes one level finer: <strong>which specific stocks within those</strong>. The page scores
        every US-listed stock over $300 million in market cap, daily, across six independent
        signals - and blends them into a single MacroTilt Score from -100 to +100.
      </Body>
      <Body>
        Positive scores mean the signals lean bullish. Negative scores mean they lean bearish.
        Cutoffs at -50, -20, +20, and +50 sort every name into one of five bands - Strong Sell,
        Watch Sell, Neutral, Watch Buy, Strong Buy. The page works as a top-to-bottom ranking of
        the entire market every trading day. Click any row for the per-stock dossier.
      </Body>
    </>
  ),
  "ops-how": (
    <>
      <Body>
        Open the page. The funnel card on the right shows how the full equity universe collapses
        to today's universe, what signal coverage looks like, and the count in each of the five
        bands. The table below ranks every scored name. Filter chips at the top let you focus on
        a single band or your held names.
      </Body>
      <Body>
        Action bands on the MacroTilt Score:
      </Body>
      <DocsTable
        cols={["Score", "Band", "What it means"]}
        rows={[
          [<Code>+50 to +100</Code>,  "Strong Buy",  "Multiple bullish signals firing strongly. Highest conviction on the buy side."],
          [<Code>+20 to +50</Code>,   "Watch Buy",   "Tilting bullish on one or two signals. Smaller position size or wait for confirmation."],
          [<Code>-20 to +20</Code>,   "Neutral",     "Signals are mixed or quiet. No clear directional read."],
          [<Code>-50 to -20</Code>,   "Watch Sell",  "Tilting bearish on one or two signals. Watch list for trim or hedge."],
          [<Code>-100 to -50</Code>,  "Strong Sell", "Multiple bearish signals firing strongly. Highest conviction on the sell side."],
        ]}
      />
      <Body>
        Every name in the universe is shown. There is no upper cap ceiling: NVDA, AAPL, GOOGL,
        KO - all scored, all visible. The same six signals run on every name. The only difference
        at the largest end of the cap range is that the insider weight is shrunk (see "Cap-aware
        insider weight" below).
      </Body>
    </>
  ),
  "ops-data": (
    <>
      <Body>
        The pipeline is built on six independent data streams plus a universe definition:
      </Body>
      <DocsTable
        cols={["Stream", "Provider", "What it carries"]}
        rows={[
          ["Universe + reference",  "Polygon Massive",              "Every US-listed Common Stock + ADR with market cap at least $300 million and last close above $5. About 3,300 names."],
          ["EOD prices + volume",   "Polygon Massive",              "OHLCV for all names; feeds the technicals signal (Bollinger BandWidth, RSI, 50-day moving average, relative volume)."],
          ["Insider buys + sells",  "Unusual Whales (SEC Form 4)",  "Open-market purchases and sales by officers and directors (transaction code \"P\" and \"S\"). RSU grants, option exercises, and tax-withholding are filtered out."],
          ["Options flow",          "Unusual Whales",               "Daily call and put volume vs open interest; flags unusual activity."],
          ["Congress trades",       "Quiver Quant",                 "Disclosed buy and sell trades by US senators and representatives within reporting windows."],
          ["Analyst actions",       "Unusual Whales",               "Wall Street equity research: upgrades, downgrades, price target changes, initiations."],
          ["Short interest",        "FINRA short interest report",  "Bi-monthly short interest as percent of float, plus day-to-cover."],
        ]}
      />
      <Body>
        The nightly scan runs after the close and writes one row per (ticker, scan_date) to{" "}
        <Code>public.signal_intel_v5_daily</Code>. Each row carries the MacroTilt Score, the band,
        all six sub-scores, the weights actually applied (after the cap-aware insider adjustment),
        and a plain-English "so what" summary. The Trading Opportunities page reads from that
        table directly.
      </Body>
    </>
  ),
  "ops-models": (
    <>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 0 }}>Universe</h4>
      <Body>
        Every US-listed Common Stock + ADR with market cap at least $300 million and last close
        above $5. About 3,300 names. There is no upper cap ceiling - mega-caps like NVDA, MSFT,
        AAPL are scored alongside small caps. The $300 million floor drops micro-caps where
        execution risk dominates; the $5 close filter drops penny names.
      </Body>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>The six signals</h4>
      <Body>
        Each signal returns a sub-score from -100 to +100. Strong bullish reads (around +50 or
        higher) and strong bearish reads (around -50 or lower) are the actionable extremes.
      </Body>
      <DocsTable
        cols={["Signal", "What it reads"]}
        rows={[
          ["Insider buying",  "Open-market Form 4 buys (and sells) by company officers and directors. Cap-normalized so a $1 million buy is read the same way at every company size. First-buy refinement: bonus for buyers with no prior purchase in the previous twelve months."],
          ["Options flow",    "Unusual call and put volume vs open interest. Persistent call-side imbalance is bullish, persistent put-side imbalance is bearish."],
          ["Congress trades", "Recent disclosed buys and sells by US senators and representatives within the legal reporting window. Buying tilts bullish, selling tilts bearish."],
          ["Technicals",      "20-day Bollinger BandWidth, 14-day RSI, distance from the 50-day moving average, relative volume. Reads \"tape strength\" without leaning on any single indicator."],
          ["Analyst actions", "Recent Wall Street equity research changes: upgrades, downgrades, price target moves, initiations. Upward momentum positive, downward momentum negative."],
          ["Short interest",  "Short interest as percent of float, plus week-over-week direction. Rising short interest is mildly bearish; falling short interest from elevated levels can be bullish (squeeze setup)."],
        ]}
      />

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>The MacroTilt Score (calibrated weights)</h4>
      <Body>
        The composite is a weighted average of the six sub-scores. Weights were fit on a 12-month
        walk-forward backtest (52 weekly Mondays, May 2025 through May 2026) using realized 21-day
        forward returns as the truth signal. Signals with insufficient historical data sit at the
        equal-weight floor (1/6) until the data layer is backfilled.
      </Body>
      <DocsTable
        cols={["Signal", { label: "Weight", numeric: true }, "Calibration status"]}
        rows={[
          ["Insider buying",  <strong>36.30%</strong>, "Calibrated. Highest alpha in backtest (+7.18 percentage points vs SPY when strong, 61% hit rate)."],
          ["Options flow",    "16.67%",                "Equal-weight floor. Full history backfill in progress."],
          ["Congress trades", "16.67%",                "Equal-weight floor. Only 13 strong-signal events across the backtest year - thin history."],
          ["Technicals",      <strong>8.69%</strong>,  "Calibrated. Reliable mid-tier (+3.42 percentage points alpha when strong, 56% hit rate)."],
          ["Analyst actions", <strong>5.00%</strong>,  "Calibrated. Broad coverage but the lowest alpha among signals we could fit (+1.65 percentage points)."],
          ["Short interest",  "16.67%",                "Equal-weight floor. Sparse coverage (93 tickers historically)."],
          [<strong>Total</strong>, <strong>100.00%</strong>, ""],
        ]}
      />

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Cap-aware insider weight</h4>
      <Body>
        Only the insider signal is haircut by market cap. A $1 million open-market purchase by a
        director is meaningful at a $500 million company - it is a real, visible commitment. The
        same $1 million purchase at a $500 billion mega-cap is rounding error: it carries less
        information per dollar. The weight on the insider signal therefore shrinks as market cap
        grows. The weight freed up by the haircut is redistributed pro-rata across the other five
        signals so the total still sums to 100%.
      </Body>
      <DocsTable
        cols={[
          "Market cap",
          { label: "Insider weight factor",    numeric: true },
          { label: "Effective insider weight", numeric: true },
        ]}
        rows={[
          ["$500 million or less",  "1.00", "36.3%"],
          ["$5 billion",            "0.75", "27.2%"],
          ["$50 billion",           "0.50", "18.2%"],
          ["$500 billion or more",  "0.25", "9.1%"],
        ]}
      />
      <Body>
        Academic basis: Lakonishok &amp; Lee (2001){" "}
        <em>Are Insider Trades Informative?</em>, <em>Review of Financial Studies</em> 14(1),
        pp. 79-111 - the predictive content of insider buying is strongest in small caps.
        Cohen, Malloy &amp; Pomorski (2012) <em>Decoding Inside Information</em>,{" "}
        <em>Journal of Finance</em> 67(3), pp. 1009-1043 - the information content scales with
        how unusual the trade is for that specific insider.
      </Body>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Backtest results</h4>
      <Body>
        12-month walk-forward, 52 weekly Mondays from 2025-05-12 through 2026-05-04. Universe
        sized at about 2,800 names per scan date (the historical market-cap data layer covers
        $300M-$25B during the backtest window). Forward return is realized close-to-close, 21
        trading days forward. Alpha is the strategy return minus SPY's return on the same scan
        date. Sharpe is annualized from 12 non-overlapping monthly windows.
      </Body>
      <DocsTable
        cols={[
          "Band",
          { label: "Mean 21-day return", numeric: true },
          { label: "Alpha vs SPY",       numeric: true },
          { label: "Beats SPY",          numeric: true },
          { label: "Sharpe",             numeric: true },
        ]}
        rows={[
          [<strong>Strong Buy</strong>,  <strong>+8.30%</strong>, <strong>+7.21 pp</strong>, <strong>55.4%</strong>, <strong>3.00</strong>],
          ["Watch Buy",                  "+3.39%", "+2.23 pp", "53.3%", "3.31"],
          ["Watch Sell",                 "+2.72%", "+0.68 pp", "47.6%", "0.61"],
          ["Strong Sell",                "-1.42%", "-2.99 pp", "35.3%", "--"],
          ["SPY benchmark",              "+1.80%", "--",       "--",    "2.87"],
        ]}
      />
      <Body>
        The Strong Buy band beats SPY by more than 7 percentage points on average and earns a
        Sharpe ratio of 3.00 against SPY's 2.87 over the same window. The Strong Sell band
        actually falls during an up year for the market - a real negative alpha that holds up
        even when SPY is rising. The bands are monotonic with realized return: the methodology
        works as a top-to-bottom sorter.
      </Body>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Per-signal performance</h4>
      <Body>
        For each signal alone, the table below shows how the bullish leg (sub-score around +50 or
        higher) performed when that signal was firing on its own.
      </Body>
      <DocsTable
        cols={[
          "Signal",
          { label: "Mean 21-day return", numeric: true },
          { label: "Alpha vs SPY",       numeric: true },
          { label: "Hit rate",           numeric: true },
          "Read",
        ]}
        rows={[
          [<strong>Insider buying</strong>, <strong>+8.87%</strong>, <strong>+7.18 pp</strong>, <strong>61.1%</strong>, "Strongest signal by a wide margin."],
          ["Technicals",      "+4.28%", "+3.42 pp", "55.6%", "Reliable mid-tier contributor."],
          ["Analyst actions", "+3.24%", "+1.65 pp", "56.6%", "Modest but the broadest coverage."],
          ["Options flow",    "--",     "--",       "--",    "Calibration pending. Sits at equal-weight floor."],
          ["Congress trades", "--",     "--",       "--",    "Only 13 strong events in the backtest year. Floor weight."],
          ["Short interest",  "--",     "--",       "--",    "Sparse coverage. Floor weight."],
        ]}
      />

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Where the alpha lives</h4>
      <Body>
        The Strong Buy alpha is concentrated in the small-cap segment of the universe. The
        cap-bucket breakdown explains why - and is also why the insider weight is haircut on
        larger names.
      </Body>
      <DocsTable
        cols={[
          "Cap bucket",
          "Band",
          { label: "Mean 21-day return", numeric: true },
          { label: "Alpha vs SPY",       numeric: true },
          { label: "Beats SPY",          numeric: true },
        ]}
        rows={[
          [<strong>$300M to $8.1B (small)</strong>,  <strong>Strong Buy</strong>, <strong>+9.66%</strong>, <strong>+8.58 pp</strong>, <strong>58.3%</strong>],
          ["$8.1B to $23.5B (mid)",                  "Strong Buy",                "+0.70%", "-0.43 pp", "39.0%"],
          ["$23.5B to $200B (large)",                "Watch Buy",                 "-4.14%", "-4.41 pp", "27.3%"],
          ["$200B+ (mega)",                          "--",                        "--",     "--",       "(unmeasured in backtest)"],
        ]}
      />
      <Body>
        The clearest read: signal-driven alpha is concentrated in the $300M to $8.1B range. The
        cap-aware insider weight tries to bake that finding into the live composite, by reducing
        how much the insider signal can swing the score at larger sizes.
      </Body>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Honesty caveats</h4>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}>
          <strong>Three signals are at the equal-weight floor.</strong> Options flow, congress
          trades, and short interest had insufficient historical data to calibrate. They are not
          worthless; we just cannot tell yet. The freed weight when those signals do produce a
          read flows through the composite proportionally, and the next calibration pass (planned
          quarterly) will refit once the data is backfilled.
        </li>
        <li style={styles.bullet}>
          <strong>Forward return is close-to-close, dividends excluded.</strong> Understates total
          return on high-yield names (REITs, BDCs) by approximately 30 to 80 basis points over
          21 days.
        </li>
        <li style={styles.bullet}>
          <strong>Historical market cap uses single-snapshot shares outstanding.</strong> Drift is
          typically less than 5% on small and mid caps; worst-case ~8% on high-buyback or
          recently-issued names. Affects cap-bucket assignment at the boundaries.
        </li>
        <li style={styles.bullet}>
          <strong>Mega-cap performance is unmeasured in the backtest.</strong> The historical
          market-cap data layer ended at $25B during the backtest window. Live production scores
          mega-caps (NVDA, MSFT, AAPL etc.) using the same six signals, but the empirical
          performance read on the $200B+ band will only be visible once the data layer is
          backfilled and the next quarterly calibration runs.
        </li>
        <li style={styles.bullet}>
          <strong>First 7 scan dates have incomplete insider lookback.</strong> The insider
          history table starts 2025-03-10; scan dates before 2025-06-23 have a truncated 365-day
          prior-window check. Re-aggregated alpha excluding the first 7 scans was +6.84
          percentage points vs the full-window +7.21 - the bias is small, the headline holds.
        </li>
        <li style={styles.bullet}>
          <strong>No transaction costs, slippage, or implementation lag.</strong> Net of
          round-trip costs the headline alpha narrows by ~50 basis points. Does not reverse.
        </li>
        <li style={styles.bullet}>
          <strong>Cross-sectional alpha, not factor alpha.</strong> "Alpha vs SPY" is the
          ticker's return minus SPY's return on the same scan date - not a Fama-French
          factor-model alpha. Small-cap (IWM) underperformed SPY by about 5 percentage points
          over this window, so the tilt-to-small-caps bias works against the headline. The alpha
          read is real.
        </li>
        <li style={styles.bullet}>
          <strong>Survivorship bias.</strong> Tickers that delisted between scan date and scan
          date + 21 trading days drop out of the realized-return measurement rather than being
          counted as -100%. Biases the headline upward; remediation requires the Polygon
          delisted-corpus, out of scope for the initial ship.
        </li>
        <li style={styles.bullet}>
          Harness code is at{" "}
          <Code>trading-scanner/scanner/signal_intelligence_v5/backtest_harness.py</Code>{" "}
          and is auditable.
        </li>
      </ul>
    </>
  ),

  // ============================================================
  // §4 PORTFOLIO INSIGHTS
  // ============================================================
  "port-why": (
    <>
      <Body>
        Connect the tactical signals to your actual holdings. Without this surface, the rest of the
        site is theoretical — interesting macro charts and ranked stock lists, but no integration with
        what you actually own.
      </Body>
      <Body>
        The page reads your brokerage positions and cross-references them against today's scanner
        scores and Asset Tilt sector ratings. Each position gets an action label tailored to what
        the data is currently saying about it.
      </Body>
    </>
  ),
  "port-how": (
    <>
      <Body>
        Connect via Plaid (read-only — MacroTilt cannot place trades). Once connected, your positions
        appear sorted by dollar value, with each row carrying the scanner's action label:
      </Body>
      <DocsTable
        cols={["Label", "When it shows"]}
        rows={[
          ["BUY ZONE",     "Scanner score 60+. Position aligned with the strongest current signal."],
          ["HOLD",         "Scanner score 35–60. Healthy hold range."],
          ["WATCH",        "Scanner score 20–35. Signals weakening."],
          ["REVIEW",       "Scanner score < 20. Sell-watch zone."],
          ["OUT OF SCOPE", "Position is in a sector the scanner doesn't evaluate (commodities, crypto, HY bond funds, broad international)."],
          ["NO SIGNAL",    "Ticker isn't in the daily scanned universe."],
          ["CORE",         "Broad index fund (FXAIX, FSKAX, etc.). Not a tactical position."],
          ["MONITOR",      "Position is in a non-tactical account (401k, plan-fund). Can't act on tactical signals here."],
        ]}
      />
    </>
  ),
  "port-data": (
    <>
      <Body>
        Three streams come together:
      </Body>
      <DocsTable
        cols={["Stream", "Source", "What it carries"]}
        rows={[
          ["Brokerage positions", "Plaid",                                  "Per-account: tickers, share counts, market value, cost basis, account type"],
          ["Scanner scores",      <Code>latest_scan_data.json</Code>,       "Per-ticker composite score + signal-by-signal breakdown"],
          ["Account metadata",    "Local config",                           "Tactical / plan-fund / IRA flags per account"],
        ]}
      />
      <Body>
        Account-type flagging matters because a 401k position with limited fund choices isn't
        actionable in the same way as a self-directed brokerage. The MONITOR label exists so the
        scanner doesn't waste your attention on positions you can't tactically rotate.
      </Body>
    </>
  ),
  "port-models": (
    <>
      <Body>
        The action mapping is deterministic — given a ticker score and an account type, the label
        is fully determined:
      </Body>
      <Formula>{`if account.tactical == false              →  MONITOR
elif sector ∈ {Commodity, Crypto, HY Bond, Intl Equity}
                                          →  OUT OF SCOPE
elif ticker ∈ {FXAIX, FSKAX, FZILX, FSGGX, FXNAX, FXIIX}
                                          →  CORE
elif ticker not in scan_universe          →  NO SIGNAL
elif score >= 60                          →  BUY ZONE
elif score >= 35                          →  HOLD
elif score >= 20                          →  WATCH
else                                      →  REVIEW`}</Formula>
      <Body>
        Logic lives in <Code>src/App.jsx</Code> at the <Code>actionFor()</Code> function (currently
        around line 6445). Aggregations: by-account totals, by-sector exposure, by-action counts.
        The page renders these as a single sortable table plus three rollup cards (cash deployable,
        actions needed, total exposure).
      </Body>
    </>
  ),

  // ============================================================
  // APPENDICES
  // ============================================================
  "hard-rules-content": (
    <>
      <Body>
        Four constraints bind every allocation decision. They are enforced in the engine workflow itself — assertion failures halt the deploy and the page keeps the last-known-good allocation — so the caps hold in production rather than just being promised in copy.
      </Body>
      <DocsTable
        cols={["Rule", "Why it exists", "Enforced where"]}
        rows={[
          [<strong>Defensive ≤ 50%</strong>,            "Even in a maximum-stress regime, the engine never sells more than half the equity book. Intent: stay invested through stress.", <><Code>macrotilt-engine-daily.yml</Code> + workflow audit</>],
          [<strong>Equity floor ≥ 50%</strong>,         "Equity bucket cannot fall below 50% under any regime combination. The flip side of the defensive cap — guarantees the strategy stays directionally long over the long run.", <><Code>macrotilt-engine-daily.yml</Code> + workflow audit</>],
          [<strong>Sleeve fires only at Watch+</strong>, "The defensive sleeve activates only when the stress signal crosses the 75th percentile (Watch) or higher. No defensive bucket in Risk On regimes.", <><Code>macrotilt-engine-daily.yml</Code> + workflow audit</>],
          [<strong>No leverage in the current engine</strong>, "The v9 1.5× rule is orphaned by the 2-axis cutover (its input composites are no longer computed). Engine ships unlevered until a re-validation against MOVE + ΔY-3M lands.", "Engine spec — Senior Quant punch list"],
        ]}
      />
      <Callout>
        <strong>Why these rules are non-negotiable.</strong> The hard caps are not optimization constraints we accept reluctantly — they're the discipline that keeps the strategy inside reasonable risk bounds across every regime, including ones we haven't seen yet. Back-tested-best-fit rules can drift in unfamiliar regimes; hard caps don't.
      </Callout>
    </>
  ),
  "backtest-content": (
    <>
      <Body>
        The locked engine has been validated against the full available history of US Treasury and equity-volatility data — 1986 → 2026, 2,056 weekly observations. Every weekly allocation comes from running the engine's rules against the data available at that point in time (no look-ahead). Sector returns come from broad-index ETF returns proxied for the era; the defensive sleeve uses BIL · GLD · SHY · TLT.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Four strategies, head-to-head</h4>
      <DocsTable
        cols={["Strategy", "$1 →", "CAGR", "Sharpe", "Max DD"]}
        rows={[
          ["SPY buy & hold",            "$65.61",   "11.16%",  "0.47",   "−54.6%"],
          ["Regime + Cash",             "$72.31",   "11.44%",  "0.57",   "−36.0%"],
          ["Regime + Defensive Sleeve", "$76.72",   "11.60%",  "0.58",   "−34.9%"],
          [<strong>Engine + Asset Tilt (MacroTilt)</strong>, <strong>$86.08</strong>, <strong>11.93%</strong>, <strong>0.61</strong>, <strong>−32.1%</strong>],
        ]}
      />
      <Body>
        The MacroTilt headline strategy beats SPY on Sharpe (0.61 vs 0.47), CAGR (11.93% vs 11.16%), and max drawdown (−32.1% vs −54.6%). The improvement compounds: $1 invested in 1986 grows to $86 under the MacroTilt strategy vs $66 under buy-and-hold SPY. The risk-adjusted return is the goal — the strategy is doing what it was designed to do.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Per-drawdown attribution — 11 major peak-to-trough episodes</h4>
      <DocsTable
        cols={["Episode", "SPY depth", "Engine depth", "Engine − SPY", "Dominant yield regime"]}
        rows={[
          ["1987 Black Monday",    "−32.7%",   "−31.7%",   "+1.1 pp",    "Inflationary"],
          ["1990 Recession",       "−17.7%",   "−17.0%",   "+0.7 pp",    "Deflationary"],
          ["1998 LTCM",            "−17.5%",   "−17.5%",   "+0.0 pp",    "Deflationary"],
          ["2000 Dot-com",         "−45.7%",   "−34.9%",   "+10.8 pp",   "Deflationary"],
          ["2007 GFC",             "−54.6%",   "−31.6%",   "+23.0 pp",   "Deflationary"],
          ["2011 Eurozone",        "−21.9%",   "−17.0%",   "+4.9 pp",    "Deflationary"],
          ["2015 China",           "−11.2%",   "−10.9%",   "+0.3 pp",    "Neutral"],
          ["2018 Q4",              "−17.1%",   "−17.1%",   "+0.0 pp",    "Inflationary"],
          ["2020 COVID",           "−31.8%",   "−22.3%",   "+9.5 pp",    "Deflationary"],
          ["2022 bear",            "−23.9%",   "−14.9%",   "+9.1 pp",    "Inflationary"],
          ["2025 spring",          "−16.9%",   "−16.9%",   "+0.0 pp",    "Neutral"],
        ]}
      />
      <Body>
        Where the engine adds the most value: deep deflationary drawdowns (2007 GFC: 23pp saved; 2000 Dot-com: 11pp saved; 2020 COVID: 9.5pp saved) and the 2022 inflationary regime that the yield-axis sleeve mix was specifically designed for (+9.1pp). Where it adds nothing: short, neutral-regime episodes where the stress signal didn't trigger in time (2015 China, 2018 Q4, 2025 spring). That pattern is the engine working as intended — it is calibrated to protect against sustained deep drawdowns, not to dodge every wobble.
      </Body>
      <Callout>
        <strong>Splice continuity validation.</strong> Pre-2002 MOVE history uses a Z-standardized proxy (21-day rolling std of daily 10Y yield changes × √252, rescaled to match MOVE's 2002-2007 distribution). The splice was validated on the boundary: fire rate in the 6 months before the splice was 65.4%; in the 6 months after 80.8%; settling back to 53.8% by 18 months later. Continuous behavior across the discontinuity. Full splice diagnostics: <Code>FINAL_LOCKED_ENGINE_2026-05-13.md</Code> in the project workspace.
      </Callout>
    </>
  ),
  "sources-content": (
    <>
      <Body>
        Every number on the site traces back to one of these public sources:
      </Body>
      <DocsTable
        cols={["Source", "Used for"]}
        rows={[
          ["FRED (Federal Reserve Economic Data)", "Most macro indicators — Treasury yields (DGS10, DGS2), real yields (DFII10), credit spreads (BAMLH0A0HYM2, BAMLC0A0CM), breakevens (T10YIE), commercial paper risk premium (CPFF), Chicago Fed and St. Louis FCI, jobless claims (IC4WSA), JOLTS quits rate, ANFCI, Fed balance sheet (WALCL), bank credit, USD broad index (DTWEXBGS), SLOOS C&I and CRE tightening, CFNAI."],
          ["ICE BofA via FRED",                    "High-yield and investment-grade option-adjusted spread series."],
          ["ICE BofA via Yahoo (^MOVE)",           "MOVE Index — bond market volatility, the locked engine's stress axis input (2002 → today)."],
          ["NY Fed ACM model",                     "Term premium decomposition of the 10y Treasury yield."],
          ["CBOE",                                 "VIX (equity volatility) and SKEW (tail risk)."],
          ["Shiller · multpl",                     "CAPE (cyclically-adjusted P/E)."],
          ["ISM via FRED NAPMPI",                  "Manufacturing PMI."],
          ["BLS via FRED",                         "JOLTS quits rate."],
          ["Yahoo Finance",                        "Copper / Gold ratio, KBW Bank vs SPX, and stock fundamentals (forward P/E, revenue growth, profitability) for the Trading Opportunities scanner."],
          ["Massive (Polygon Basic)",              "Daily price data for the equity universe, universe master, dividends, splits."],
          ["Unusual Whales",                       "Options flow, Form 4 insider buying, congressional trade disclosure, analyst actions."],
          ["FINRA short interest",                 "Bi-monthly short interest as % of float."],
          ["Quiver Quant",                         "Congressional trade disclosures."],
          ["ZeroHedge (RSS + Premium)",            "News sentiment overlay."],
          ["Plaid",                                "Brokerage feed (read-only — MacroTilt cannot place trades)."],
        ]}
      />
      <Body>
        Every data element is registered in <Code>public/data_manifest.json</Code> with cadence, freshness SLA, and consumer surfaces. The freshness chip system on every page reads from that manifest plus <Code>pipeline_health</Code> in Supabase to show green / amber / red per data flow. Pipelines that fail twice in a row auto-file a P1 bug; pipelines stale more than seven days raise a page-level red banner.
      </Body>
    </>
  ),
  "glossary-content": (
    <>
      <DocsTable
        cols={["Term", "Definition"]}
        rows={[
          [<><Code>bp</Code> (basis points)</>, "One basis point = 0.01%. 100bp = 1%."],
          ["CAPE",                              "Cyclically-Adjusted P/E (Shiller). S&P 500 price divided by 10-year average inflation-adjusted earnings. Smooths earnings cycles."],
          ["Cycle mechanism",                   "One of six factor-level categorical inputs driving the in-equity sector tilts on Asset Tilt: Valuation, Credit, Funding, Growth, Liquidity & Policy, Positioning & Breadth. Each rolls up from its own indicator panel. Does not produce a top-level regime call — that is the 2-axis engine's job."],
          ["Defensive sleeve",                  "The non-equity allocation when stress crosses Watch. Four buckets: BIL (cash, 1-3M T-bills), GLD (gold), SHY (short Treasuries, 1-3y), TLT (long Treasuries, 20+y). Composition keyed to the yield regime."],
          ["Deflationary",                      "Yield regime label. ΔY-3M ≤ 30th percentile over the trailing 5y. Falling yields. Engine sleeve leans long Treasuries + cash."],
          ["ERP",                               "Equity Risk Premium = S&P 500 earnings yield minus 10-year Treasury yield. A near-zero or negative ERP means stocks are priced for perfection."],
          ["HY OAS",                            "High-Yield Option-Adjusted Spread. Yield premium that junk bonds offer over Treasuries."],
          ["IG (Industry Group)",               "GICS Industry Group, one classification level below Sector. The site uses 24 IGs across 11 sectors. Example: Semiconductors is an IG inside the Information Technology sector."],
          ["IG OAS",                            "Investment-Grade Option-Adjusted Spread. Yield premium that corporate bonds offer over Treasuries."],
          ["Inflationary",                      "Yield regime label. ΔY-3M ≥ 70th percentile over the trailing 5y. Rising yields. Engine sleeve leans cash + gold + short Treasuries."],
          ["MOVE",                              "ICE BofA MOVE Index. Implied volatility on Treasury options. The engine's stress axis input from 2002 onwards; before 2002, a Z-standardized proxy built from 10Y yield realized vol."],
          ["Neutral (yield)",                   "Yield regime label. ΔY-3M between the 30th and 70th percentile over the trailing 5y. No directional yield call. Engine sleeve splits the difference between Inflationary and Deflationary mixes."],
          ["OW / MW / UW",                      "Overweight / Market-weight / Underweight. Refers to a sector or IG's allocation versus its SPY benchmark weight."],
          ["Percentile",                        "Where a current value sits in a historical sample. p100 = highest reading on record; p0 = lowest. All thresholds on Asset Tilt are percentile-keyed against the trailing 5-year window."],
          ["Risk On / Watch / Risk Off",        "Stress signal label, set by the spliced MOVE percentile. Risk On = below 75p (equity 100%). Watch = 75-85p (equity 80%, sleeve 20%). Risk Off = above 85p (equity 50%, sleeve 50%)."],
          ["Sharpe ratio",                      "Annualized excess return divided by annualized volatility. Higher = better risk-adjusted return."],
          ["SLOOS",                             "Senior Loan Officer Opinion Survey. Federal Reserve quarterly survey of bank lending standards."],
          ["SPY",                               "SPDR S&P 500 ETF. The benchmark used for sector vs market relative weights and the comparison baseline for the backtest."],
          ["Stress axis",                       "Axis 1 of the locked engine. Spliced MOVE percentile drives the Risk On / Watch / Risk Off label, which drives equity vs defensive split."],
          [<><Code>ΔY-3M</Code></>,             "Three-month change in the 10-year Treasury yield. Today's 10y minus the 10y from 63 trading days ago. The yield-direction axis input."],
          ["Yield regime",                      "Axis 2 of the locked engine. ΔY-3M percentile drives the Inflationary / Neutral / Deflationary label, which drives the defensive sleeve composition."],
        ]}
      />
    </>
  ),
};

// Build a search blob per section for the search filter. Includes title, blurb, and the
// concatenated text content extracted from the React tree (best-effort).
function extractText(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join(" ");
  if (node.props && node.props.children) return extractText(node.props.children);
  return "";
}

function buildSearchIndex() {
  const idx = {};
  SECTIONS.forEach(s => {
    let text = `${s.title} ${s.blurb}`;
    if (s.sub.length) {
      s.sub.forEach(sub => {
        const content = SECTION_CONTENT[sub.id];
        text += " " + sub.label + " " + extractText(content);
      });
    } else {
      const content = SECTION_CONTENT[s.id + "-content"];
      text += " " + extractText(content);
    }
    idx[s.id] = text.toLowerCase();
  });
  return idx;
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function MethodologyPage() {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState(() => new Set(SECTIONS.map(s => s.id)));
  const searchIndex = useMemo(() => buildSearchIndex(), []);

  // Filter sections by search
  const matchingSectionIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return new Set(SECTIONS.map(s => s.id));
    const matches = new Set();
    SECTIONS.forEach(s => {
      if (searchIndex[s.id].includes(q)) matches.add(s.id);
    });
    return matches;
  }, [search, searchIndex]);

  function toggleSection(id) {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function scrollToAnchor(id, e) {
    if (e) e.preventDefault();
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main style={{
      maxWidth: 1280, margin: "0 auto", padding: "32px 28px 60px",
      display: "grid", gridTemplateColumns: "260px 1fr", gap: 32,
    }}>

      {/* ─── HERO + content (right column) ─── */}
      <div style={{ gridColumn: "1 / -1", marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
          How MacroTilt thinks
        </div>
        <h1 style={{
          fontFamily: "var(--font-display, Georgia, serif)",
          fontSize: 44, fontWeight: 500, margin: "8px 0 12px",
          letterSpacing: "-0.02em", lineHeight: 1.05,
        }}>Methodology</h1>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: "var(--text-muted)", maxWidth: 760, margin: 0 }}>
          MacroTilt runs a four-stage funnel from macro tape to actual holdings.
          <strong style={{ color: "var(--text)" }}> Macro Overview</strong> is the indicator backdrop — 27 indicators across five domains, with no regime call on the page.
          <strong style={{ color: "var(--text)" }}> Asset Tilt</strong> runs the 2-axis engine that turns the tape into an explicit allocation: equity %, defensive sleeve composition keyed to yield direction, plus sector and industry-group tilts.
          <strong style={{ color: "var(--text)" }}> Trading Opportunities</strong> picks specific stocks within those.
          <strong style={{ color: "var(--text)" }}> Portfolio Insights</strong> connects all of it to your actual brokerage holdings.
        </p>
        <div style={{ marginTop: 18, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          <span>Last updated · 2026-05-18</span>
          <span>Engine · LOCKED · 1986 → 2026 validation</span>
          <span>Daily refresh · 15:45 ET weekdays</span>
        </div>
      </div>

      {/* ─── LEFT: sticky TOC ─── */}
      <nav style={{
        position: "sticky", top: 24, alignSelf: "start",
        borderRight: "0.5px solid var(--border)", paddingRight: 16,
        maxHeight: "calc(100vh - 48px)", overflowY: "auto",
      }}>
        {/* Search input */}
        <input
          type="search"
          placeholder="Search the methodology…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: "100%", padding: "8px 10px", fontSize: 13,
            border: "0.5px solid var(--border)", borderRadius: 6,
            background: "var(--surface)", color: "var(--text)",
            fontFamily: "var(--font-ui, Inter, sans-serif)",
            marginBottom: 16,
          }}
        />
        {search && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
            {matchingSectionIds.size} of {SECTIONS.length} sections match.
          </div>
        )}

        {/* TOC */}
        {SECTIONS.map(s => {
          const isOpen = openSections.has(s.id);
          const matches = matchingSectionIds.has(s.id);
          if (!matches) return null;
          return (
            <div key={s.id} style={{ marginBottom: 8 }}>
              <button
                onClick={() => toggleSection(s.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: "transparent", border: 0, padding: "5px 0",
                  fontFamily: "var(--font-display, Georgia, serif)",
                  fontSize: 14, fontWeight: 500, color: "var(--text)",
                  cursor: "pointer", letterSpacing: "-0.005em",
                }}
              >
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 9,
                  color: "var(--text-muted)", letterSpacing: "0.10em",
                  fontWeight: 600, marginRight: 6,
                }}>{s.num}</span>
                {s.title}
                {s.sub.length > 0 && (
                  <span style={{ float: "right", fontSize: 10, color: "var(--text-muted)", transition: "transform 0.15s", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0)" }}>▸</span>
                )}
              </button>
              {isOpen && s.sub.length > 0 && (
                <div style={{ paddingLeft: 16, marginTop: 4, marginBottom: 8 }}>
                  {s.sub.map(sub => (
                    <a
                      key={sub.id}
                      href={`#${sub.id}`}
                      onClick={e => scrollToAnchor(sub.id, e)}
                      style={{
                        display: "block", padding: "3px 0",
                        fontSize: 12.5, color: "var(--text-muted)",
                        textDecoration: "none", lineHeight: 1.45,
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
                      onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
                    >
                      {sub.label}
                    </a>
                  ))}
                </div>
              )}
              {isOpen && s.sub.length === 0 && (
                <div style={{ paddingLeft: 16, marginTop: 4, marginBottom: 8 }}>
                  <a
                    href={`#${s.id}`}
                    onClick={e => scrollToAnchor(s.id, e)}
                    style={{ display: "block", padding: "3px 0", fontSize: 12.5, color: "var(--text-muted)", textDecoration: "none", lineHeight: 1.45 }}
                    onMouseEnter={e => e.currentTarget.style.color = "var(--accent)"}
                    onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
                  >View →</a>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ─── RIGHT: content ─── */}
      <div>
        {SECTIONS.map(s => {
          const matches = matchingSectionIds.has(s.id);
          if (!matches) return null;
          return (
            <section key={s.id} id={s.id} style={styles.section}>
              <div style={styles.sectionEyebrow}>{s.num} · {s.id.startsWith("hard-") || s.id === "backtest" || s.id === "sources" || s.id === "glossary" ? "Appendix" : "Section"}</div>
              <h2 style={styles.sectionH2}>{s.title}</h2>
              <p style={styles.sectionBlurb}>{s.blurb}</p>

              {/* Subsections */}
              {s.sub.length > 0 ? (
                s.sub.map(sub => (
                  <div key={sub.id}>
                    <h3 id={sub.id} style={styles.subH3}>{sub.label}</h3>
                    {SECTION_CONTENT[sub.id]}
                  </div>
                ))
              ) : (
                <div style={{ marginTop: 20 }}>
                  {SECTION_CONTENT[s.id + "-content"]}
                </div>
              )}
            </section>
          );
        })}

        {/* End-of-page footer */}
        <div style={{
          marginTop: 60, paddingTop: 20, borderTop: "0.5px solid var(--border)",
          fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6,
        }}>
          <strong style={{ color: "var(--text)" }}>Built for one user.</strong>{" "}
          MacroTilt is a personal market dashboard, not a registered investment advisor.
          Backtested performance is no guarantee of future returns. Hard caps protect against
          regime drift but cannot prevent drawdowns. See full disclosures in the site footer.
        </div>
      </div>
    </main>
  );
}
