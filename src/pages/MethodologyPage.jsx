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
  // Reference / docs tables render in look-only mode (Tier B): no filter,
  // sort, resize or Columns toolbar — those controls are for the large data
  // tables (the screener), not a docs page. Each table still gets a unique
  // storageKey derived from its column shape.
  const sk = "methodology_" + columns.map((c) => c.label).join("|").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  return <MTTable columns={columns} rows={rowObjs} rowKey="_id" features="look" storageKey={sk} />;
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
          ["Extreme",      "Reading is at an extreme of its 5y range, in the direction that historically means stress."],
          ["Range-only",   "Direction-agnostic indicator — color suppressed; the tile shows position in 5y range only."],
        ]}
      />
      <Body>
        Click any tile for full history (back to 1986 where available), the indicator's methodology card, and overlay options for cross-indicator comparison. The hero strip at the top of the page summarizes today's count: how many indicators are Calm vs. Elevated vs. Extreme, and which domains carry the stress.
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
          ["Chicago Fed National Activity",       "Chicago Fed · FRED CFNAI",    "Monthly"],
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
        "Extreme"     if stress_pct >= 80
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
  // §3 TRADING OPPORTUNITIES — current end-of-day screener
  //
  // Rewritten in place 2026-05-21 per LESSONS rule #31 (rewrite, do not
  // append). The retired six-signal weighted composite (insider / options /
  // congress / technicals / analyst / short interest, MacroTilt Score
  // -100..+100, five bands, signal_intel_v5_daily) is gone. This section now
  // describes the current screener: two plain gates ($5 price + $1.5M median
  // daily dollar-volume) and four live scoring layers (insider + trend +
  // dark pool + options). Dark-pool and options activated 2026-05-21 (score
  // ceiling 5 -> 10); their point values are not yet backtested. Names launch
  // at an insider+trend score of 3. Ported from MethodologyBody.jsx.
  // ============================================================
  "ops-why": (
    <>
      <Body>
        The Trading Opportunities page is the actionable end of the funnel. Macro Overview tells you
        the regime; Asset Tilt tells you how to lean by sector; Trading Opportunities turns that lean
        into <strong>specific tickers</strong>. It is an end-of-day screener — it runs once after the
        close and publishes a daily <strong>buy list</strong> of individual stocks worth a closer
        look.
      </Body>
      <Body>
        The screener is built to produce a sell / short list as well as a buy list, but only the
        buy list is published today — the short side cannot be judged yet. The one piece testable
        so far, a trend-only short score, showed no edge in the back-test; but that window was
        entirely a bull market, where shorting loses by default. The real short signal — insiders
        selling their own stock — produced zero qualifying events in the test window, so it is
        genuinely untested. The short list turns on once the insider-sell, dark-pool and options
        layers have enough history of their own to be back-tested honestly.
      </Body>
    </>
  ),
  "ops-how": (
    <>
      <Body>
        Open the page. The table ranks the names that launched onto today's buy list. Each row
        carries the name's combined score, the live layers that earned it, and an entry reference
        price, a stop, and a profit target. Click any row to open the full stock view — the
        layer-by-layer score, the price chart, and the insider filings behind it.
      </Body>
      <Body>
        A name <strong>launches</strong> onto the buy list when its insider-and-trend score
        reaches <strong>3</strong>. The score itself runs out of <strong>10</strong> — all four
        scoring layers (insider, trend, dark pool, options) are live. The dark-pool and options
        layers add conviction on top of the launch decision but never add or drop a name from the
        list (see "Models &amp; calcs" below). The score does all the work of ranking — there is no
        separate macro or sector overlay applied on this page.
      </Body>
      <Callout>
        <strong>Honest status today.</strong> The insider screener was calibrated on a single
        twelve-month window — and a mostly-rising one. That is enough history to launch it on, but it
        is not a multi-cycle proof: it has not yet been tested through a real downturn. The dark-pool
        and options layers went live on 21 May 2026 without a back-test of their own, by owner
        decision — there is not yet enough of their history to test honestly. The calibration is
        re-checked every quarter, and immediately if a market correction enters the data. Treat the
        win rate as a reasonable expectation, not a promise.
      </Callout>
    </>
  ),
  "ops-data": (
    <>
      <Body>
        Every night the screener scores every US-listed common stock that clears two plain gates:
        the share price is at least <strong>$5</strong>, and the stock trades at least{" "}
        <strong>$1.5 million of value a day</strong>, measured as a 90-day median of daily dollar
        volume. That leaves roughly two to two-and-a-half thousand names. Anything cheaper or thinner
        is dropped before scoring — those are names a normal-sized order cannot get into and out of
        cleanly. There is no trend or momentum pre-filter; the score itself does all the work of
        separating signal from noise.
      </Body>
      <DocsTable
        cols={["Stream", "Provider", "What it carries"]}
        rows={[
          ["EOD prices + volume", "Polygon Massive",             "Daily close and volume for every US-listed name — feeds the $5 price gate and the $1.5M 90-day median dollar-volume gate, and the 200-day moving average and 14-day RSI used by the trend layer."],
          ["Insider buys",        "Unusual Whales (SEC Form 4)", "Open-market purchases by company officers and directors. Routine pre-scheduled trades and trades by 10%-plus shareholders are excluded — only conviction buying counts."],
          ["Dark-pool prints",    "Unusual Whales",              "Large off-exchange block trades. The dark-pool layer reads the last two trading days of these prints for an institutional clustering band. Live since 2026-05-21; point values not yet backtested."],
          ["End-of-day options",  "Unusual Whales",              "Per-contract end-of-day options activity. The options layer reads it for fresh, aggressively-bought call volume. Live since 2026-05-21; point values not yet backtested."],
        ]}
      />
    </>
  ),
  "ops-models": (
    <>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 0 }}>How a name earns its score</h4>
      <Body>
        Each name is scored on <strong>four</strong> layers of evidence. The{" "}
        <strong>insider layer</strong> is the anchor — corporate insiders buying their own company's
        stock is, by a wide margin, the strongest predictor in our own testing. The{" "}
        <strong>trend layer</strong> is a guardrail that keeps the screener from chasing a falling or
        badly overheated stock. The <strong>dark-pool layer</strong> reads large off-exchange block
        trades for the price level big institutions recently transacted around, and the{" "}
        <strong>options layer</strong> reads fresh, aggressively-bought call activity. All four are
        live, and the score runs from 0 to <strong>10</strong>.
      </Body>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>The insider layer</h4>
      <Body>
        The insider layer rewards three patterns of open-market buying by a company's own officers
        and directors, over a rolling 30-day window. The three rules below — A, B and C — are the rule tags shown in the Insider Activity column on the Trading Opportunities table. Routine pre-scheduled trades and trades by
        10%-plus shareholders are excluded — only conviction buying counts.
      </Body>
      <DocsTable
        cols={["Rule", "Pattern", "What earns the points", { label: "Points", numeric: true }]}
        rows={[
          [<strong>Rule A</strong>, "Conviction buy", "A CEO or CFO buying on the open market, in a trade that lifts their personal stake by at least 10% and is worth at least $100,000.", <strong>4</strong>],
          [<strong>Rule B</strong>, "Size", "All insider buying in the window, added up, comes to at least 0.05% of the company's market value.", <strong>4</strong>],
          [<strong>Rule C</strong>, "Consensus", "At least three different insiders buying within the same window.", <strong>2</strong>],
        ]}
      />
      <Body>
        The insider layer is <strong>capped at 4 points</strong>, so one stock cannot run away with
        the score on insider evidence alone. One refinement matters: insider signals fade with age. A
        fresh insider buy carries full weight for its first <strong>15 days</strong>, then tapers
        steadily to nothing by <strong>day 31</strong>. The list retires its own stale ideas — a buy
        that surfaced three weeks ago is worth less than one filed yesterday.
      </Body>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>The trend layer</h4>
      <Body>
        The trend layer then adjusts the insider score so the screener does not chase a broken or
        overheated chart:
      </Body>
      <DocsTable
        cols={["Trend condition", { label: "Points", numeric: true }]}
        rows={[
          ["Price above its 200-day average",               <strong>+1</strong>],
          ["Price below its 200-day average",               <strong>&minus;2</strong>],
          ["Overheated momentum (14-day RSI above 65)",      <strong>&minus;2</strong>],
        ]}
      />
      <Body>
        Insider points (capped at 4) plus the trend adjustment give the combined score. A name{" "}
        <strong>launches</strong> onto the buy list when that combined score reaches{" "}
        <strong>3</strong>.
      </Body>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>The dark-pool layer</h4>
      <Body>
        The dark-pool layer looks at the last two trading days of large off-exchange block trades.
        Where that block volume piles up inside a narrow price band, that band is an institutional
        anchor — a price level big money cared about. If the stock now trades above the band, the
        band sits beneath the price as a support floor: <strong>2 points</strong>. If there is no
        tight band but one standout large block printed below the price, that lone block is a weaker
        anchor: <strong>1 point</strong>. The layer is capped at 2 points, and the anchor price it
        finds also sets the entry, stop and target levels.
      </Body>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>The options layer</h4>
      <Body>
        The options layer looks at medium-dated call contracts — 14 to 45 days to expiry — that are
        moderately out-of-the-money. It rewards a contract showing two things at once: fresh
        positioning (today's volume is large versus the open interest already on the contract) and
        aggressive execution (at least 65% of that volume printed at the ask — the buyer paid up).
        Volume of three times the open interest or more earns <strong>4 points</strong>; one to three
        times earns <strong>3 points</strong>. The layer is capped at 4 points.
      </Body>
      <Callout>
        <strong>Not yet backtested.</strong> The dark-pool and options point values above come from
        the screener specification and have been sanity-checked by the Senior Quant — but, unlike the
        insider and trend layers, they have not been through a back-test. There is not yet enough of
        their own history. They were switched on by owner decision so the screener can begin using
        them; treat them as developing signals, and expect their point values to be revisited once a
        back-test is possible.
      </Callout>

      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>What the back-test showed</h4>
      <Body>
        The insider point values, the trend adjustments and the launch threshold were set by a
        back-test, not by guesswork — the same standing rule that retired the previous screener. (The
        dark-pool and options point values were not — see the note above.) Across the twelve months
        of insider history available, the <strong>88 names</strong> the screener launched, measured
        one month (21 trading days) later:
      </Body>
      <DocsTable
        cols={["Measure", { label: "Result", numeric: true }, "In plain terms"]}
        rows={[
          [<strong>Win rate</strong>,              <strong>59.1%</strong>, "Roughly three of every five launched names were higher a month later."],
          [<strong>Average move</strong>,          <strong>+5.96%</strong>, "The average launched name over the following month."],
          [<strong>Versus the broad market</strong>, <strong>+2.42%</strong>, "How much the launched names beat the average eligible stock, per month."],
          [<strong>Profit factor</strong>,         <strong>2.76</strong>, "About $2.76 earned for every $1.00 lost across all launched names."],
        ]}
      />
      <Body>
        The short side is held back. The only part of it testable in this window — a trend-only
        short score — showed no edge, but the test ran entirely in a bull market, where shorting
        loses by default; and the real short signal, insider selling, produced zero qualifying
        events, so it could not be tested at all. Only the buy list publishes today; the short
        list turns on once the insider-sell, dark-pool and options layers have enough history to
        be back-tested.
      </Body>
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
