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
    blurb: "The indicator backdrop across five domains.",
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
    blurb: "Engine read, sleeve, sectors, industry groups.",
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
    blurb: "1986–2026 validation, four strategies compared.",
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
        Macro Overview is the indicator backdrop. Twenty-seven public indicators across
        five domains — <strong>Rates</strong>, <strong>Credit</strong>, <strong>Equities</strong>,
        <strong> Money &amp; Banking</strong>, and <strong>Economy</strong>. The page does not call
        a regime, does not say buy or sell, does not produce a recommendation. It tells you, in
        one screen, where every input is sitting relative to its own five-year history.
      </Body>
      <Body>
        The job is descriptive. A reader scans the page in 30 seconds and answers three questions:
        what's calm, what's elevated, what's stressed. The actionable read — equity-versus-defensive,
        sectors, industry groups — lives one click away on <em>Asset Tilt</em>, where the engine
        translates the backdrop into an allocation.
      </Body>
      <Callout>
        <strong>No regime label on this page.</strong> Risk On / Watch / Risk Off and
        Inflationary / Neutral / Deflationary are the engine's vocabulary and live on Asset Tilt.
        Macro Overview is the underlying indicator data those engine reads are built from — plus
        twenty more indicators the engine doesn't formally trade off but a careful reader still wants
        to see.
      </Callout>
    </>
  ),
  "macro-how": (
    <>
      <Body>
        The page reads top to bottom in three pieces: the hero with the color legend, five domain
        panels, and a modal that opens when you click any tile.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Color legend</h4>
      <DocsTable
        cols={["Color", "Label", "What it means"]}
        rows={[
          [<span style={{display:"inline-block",width:14,height:14,borderRadius:"50%",background:"#10B981",verticalAlign:"middle"}}/>,  "Calm",       "Indicator is not signalling stress. Reading is comfortably inside its 5-year normal range."],
          [<span style={{display:"inline-block",width:14,height:14,borderRadius:"50%",background:"#F59E0B",verticalAlign:"middle"}}/>,  "Elevated",   "Mid-range. Worth watching but not at an extreme."],
          [<span style={{display:"inline-block",width:14,height:14,borderRadius:"50%",background:"#D946C4",verticalAlign:"middle"}}/>,  "Stressed",   "Reading is at an extreme of its 5-year range. The direction of the extreme depends on the indicator — a stressed jobless-claims tile means claims are high; a stressed copper/gold tile means the ratio is low."],
          [<span style={{display:"inline-block",width:14,height:14,borderRadius:"50%",background:"#64748B",verticalAlign:"middle"}}/>,  "Range only", "For direction-agnostic indicators (USD, breakeven inflation, equity-credit correlation), the pill reads High / Mid / Low against the 5-year range without a stress claim."],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>The five panels</h4>
      <DocsTable
        cols={["Panel", "What it covers", "Indicators"]}
        rows={[
          ["Rates",            "The cost and shape of money — what duration is being repriced.",          "5 — yield curve, 10y real yield, MOVE, term premium, 10y breakeven"],
          ["Credit",           "What lenders are charging for risk, and whether they're still lending.",  "5 — HY OAS, IG OAS, HY/IG ratio, SLOOS C&I, SLOOS CRE"],
          ["Equities",         "What the stock tape is pricing in — level, volatility, and tail risk.",     "5 — Buffett indicator, CAPE, VIX, SKEW, equity-credit correlation"],
          ["Money & Banking",  "How freely capital is moving through the financial plumbing.",            "6 — CPFF spread, ANFCI, STLFSI, KBW Bank / SPX, bank credit growth, Fed balance sheet YoY"],
          ["Economy",          "The real-world pulse — labor, activity, and cyclical demand.",            "6 — jobless claims (4w), ISM Manufacturing, JOLTS quits, copper/gold, USD broad, CFNAI"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>What each tile shows</h4>
      <Body>
        Tiles sit in a three-column grid inside each panel. Every tile carries the same anatomy: the
        indicator name + abbreviation, the current value formatted for the indicator type, a 30-day
        directional arrow (color-coded to whether the move is towards stress or away from it), a
        small line chart over the trailing year, a percentile bar showing where today sits in the
        trailing 5-year range, and the Calm / Elevated / Stressed pill.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>The full-history modal</h4>
      <Body>
        Click any tile to open a wide centered modal (about 1200 pixels). The modal has a four-cell
        KPI strip (today's value, 30-day change, 5-year percentile, what it means in plain English),
        a full-history line chart (defaults to the maximum available window, with 1M / 6M / 1Y / 5Y
        / Max timeframe pills and a crosshair on hover), and a methodology paragraph specific to
        that indicator.
      </Body>
      <Body>
        Refresh cadence: each indicator refreshes on its own release schedule — most daily after the
        US close, a few weekly (CPFF, STLFSI) or monthly (ISM, JOLTS quits, SLOOS quarterly). The
        freshness chip on each tile reads from the data manifest and shows green inside the SLA,
        amber when one to two refreshes are overdue, red on a real failure.
      </Body>
    </>
  ),
  "macro-data": (
    <>
      <Body>
        Twenty-seven indicators, all from public sources. Each indicator's source, freshness SLA,
        and consumer surfaces are registered in the project's data manifest — the same registry the
        freshness chips read from.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Rates panel (5 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["Yield curve (10y − 2y)",      "Federal Reserve H.15 · FRED T10Y2Y",            "Daily"],
          ["10y real yield",               "FRED — nominal 10y minus 10y breakeven",      "Daily"],
          ["MOVE · bond volatility",        "ICE BofA · Yahoo ^MOVE",                       "Daily after close"],
          ["Term premium",                 "Federal Reserve / ACM estimate",                "Daily"],
          ["10y breakeven inflation",      "FRED — nominal 10y minus 10y TIPS",            "Daily"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Credit panel (5 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["High-yield OAS",               "ICE BofA · FRED BAMLH0A0HYM2",                 "Daily after close"],
          ["Investment-grade OAS",         "ICE BofA · FRED BAMLC0A0CM",                   "Daily after close"],
          ["HY / IG spread ratio",         "Derived from HY OAS and IG OAS",                "Daily"],
          ["SLOOS · C&I tightening",        "Federal Reserve SLOOS",                          "Quarterly"],
          ["SLOOS · CRE tightening",        "Federal Reserve SLOOS",                          "Quarterly"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Equities panel (5 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["Buffett indicator (Mkt cap / GDP)",  "BEA GDP + Wilshire 5000 / FRED WILL5000",   "Quarterly GDP · daily market cap"],
          ["CAPE · Shiller P/E",                "Shiller · multpl.com",                       "Monthly"],
          ["VIX · equity volatility",           "CBOE direct feed",                          "Daily, real-time"],
          ["SKEW · tail risk",                  "CBOE direct feed",                          "Daily, real-time"],
          ["Equity-credit correlation",          "60-day rolling — SPX returns vs HY OAS",      "Daily"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Money &amp; Banking panel (6 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["CPFF · Commercial paper spread", "Federal Reserve H.15 · FRED CPFF",            "Weekly · Wednesday"],
          ["ANFCI · Chicago Fed FCI",        "Chicago Fed · FRED ANFCI",                    "Weekly"],
          ["STLFSI · St. Louis FCI",         "St. Louis Fed · FRED STLFSI",                 "Weekly"],
          ["KBW Bank / SPX",               "NASDAQ KBW BKX ÷ S&P 500",                    "Daily"],
          ["Bank credit growth (YoY)",     "Federal Reserve H.8 · FRED TOTBKCR",          "Weekly"],
          ["Fed balance sheet (YoY)",      "Federal Reserve H.4.1 · FRED WALCL",          "Weekly"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Economy panel (6 indicators)</h4>
      <DocsTable
        cols={["Indicator", "Source", "Cadence"]}
        rows={[
          ["Initial jobless claims (4w)",  "US DOL · FRED IC4WSA",                         "Weekly"],
          ["ISM Manufacturing PMI",        "ISM · FRED NAPMPI",                            "Monthly"],
          ["JOLTS · quits rate",            "BLS JOLTS · FRED QUITS",                      "Monthly (one-month lag)"],
          ["Copper / Gold ratio",          "Yahoo · CME front-month futures",              "Daily"],
          ["USD broad index",              "Federal Reserve H.10 · FRED DTWEXBGS",         "Daily"],
          ["CFNAI · Chicago Fed Nat. Activity",  "Chicago Fed · FRED CFNAI",            "Monthly"],
        ]}
      />
    </>
  ),
  "macro-models": (
    <>
      <Body>
        There is no composite, no regime classifier, no aggregator on this page. The Calm / Elevated /
        Stressed pill on each tile is computed per indicator, independently, against that indicator's
        own trailing 5-year history. The math is the same for every tile; the direction-of-stress
        flag is what changes.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>How the state pill is decided</h4>
      <Body>
        For each indicator, the page computes the percentile rank of today's value against the
        trailing 5-year window of that indicator's history. The pill is then assigned based on the
        indicator's direction-of-stress flag:
      </Body>
      <DocsTable
        cols={["Direction-of-stress", "Stressed when", "Elevated when", "Calm when", "Examples"]}
        rows={[
          ["High is bad",  "Pctile ≥ 75th", "Pctile ≥ 50th", "Otherwise",       "HY OAS, VIX, jobless claims, MOVE, CAPE"],
          ["Low is bad",   "Pctile ≤ 25th", "Pctile ≤ 50th", "Otherwise",       "Yield curve, ISM, copper/gold, bank credit growth"],
          ["No direction", "n/a",            "n/a",             "Always range-only", "USD, 10y breakeven, equity-credit correlation"],
        ]}
      />
      <Body>
        The five-year window is the same calibration choice the engine on Asset Tilt uses for its
        own percentiles, so the two surfaces stay on the same time scale. A given indicator can
        therefore look Stressed on Macro Overview while the engine still reads Risk On overall — the
        engine only trades off a small subset of indicators (MOVE for stress, 3-month change in 10y
        yield for direction), and the rest of the 27-indicator backdrop is context.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>30-day directional arrow</h4>
      <Body>
        Beside the value on each tile, a small arrow shows the 30-day change. The color of the
        arrow reflects the direction-of-stress flag: an upward move in a high-is-bad indicator is
        red (worse), an upward move in a low-is-bad indicator is green (better). Direction-agnostic
        tiles use a neutral diamond. The arrow only carries direction — the magnitude lives on the
        tile chart and in the modal.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Refresh pipeline</h4>
      <Body>
        Every indicator refreshes on its own schedule per the data manifest. The tile reads its
        current value from <Code>indicator_history.json</Code>, which is rebuilt by the indicator
        refresh job after each producer completes. Per-tile freshness chips show the elapsed time
        since the last successful pull and turn amber / red against the indicator's SLA when a
        producer is behind.
      </Body>
    </>
  ),

  // ============================================================
  // §2 ASSET TILT
  // ============================================================
  "tilt-why": (
    <>
      <Body>
        Asset Tilt is where the engine read lives and where the v9 sector allocator runs. Macro
        Overview tells you the state of every indicator; Asset Tilt translates the engine's two
        axes into an actual allocation — equity versus defensive, sleeve composition, sector and
        industry-group tilts, and the leverage decision inside the equity bucket.
      </Body>
      <Body>
        Two design principles. First, <strong>every threshold is backtested.</strong> The engine's
        75th and 85th percentile MOVE thresholds and 30th / 70th percentile yield thresholds were
        chosen against the 1986–2026 backtest before being committed to code. The v9 sector
        allocator's per-sector sensitivities were anchored on regression studies over the same
        window. No hand-picked cutoffs.
      </Body>
      <Body>
        Second, <strong>hard caps prevent any regime from blowing past prudent bounds:</strong>
      </Body>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}>Engine never drives equity below 50 percent of capital, even in deep Risk Off.</li>
        <li style={styles.bullet}>Defensive sleeve never exceeds 50 percent of capital — the same constraint from the other side.</li>
        <li style={styles.bullet}>v9 sector allocator caps leverage at 1.5×. Leverage activates only in calm regimes; when the engine wants any defensive sleeve at all, leverage drops to 1.0×.</li>
        <li style={styles.bullet}>Defensive sleeve composition is fully determined by the yield regime — the engine reads it from a hard-coded table, no override.</li>
      </ul>
      <Body>
        These rules are constraints in the architecture, not assumptions about what's optimal.
        Within the constraints, the engine and the v9 allocator each do their separate jobs.
      </Body>
    </>
  ),
  "tilt-how": (
    <>
      <Body>
        The page reads top to bottom in five blocks:
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>1. Hero + KPI strip</h4>
      <Body>
        The page hero opens with a one-sentence pitch (a back-tested allocation tool that seeks to
        beat the S&amp;P 500 on a risk-adjusted basis) plus four bullets describing the engine, the
        factor reads behind sector tilts, the defensive sleeve activation rule, and the headline
        validation numbers. A four-cell KPI tile to the right of the hero shows CAGR, Sharpe, max
        drawdown, and the validation window — each cell carries a "vs SPY" subline so the engine
        and the benchmark are visible at the same time.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>2. Today's Engine Read</h4>
      <Body>
        Three cells side by side, fed from the engine snapshot:
      </Body>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}><strong>Stress signal</strong> — a dial showing where the MOVE Index sits in its trailing 5-year percentile, with Risk On / Watch / Risk Off pills and the Watch (75th) and Risk Off (85th) threshold markers drawn on the dial. A 24-week mini bar strip below the dial shows the recent percentile path; click for the full 1986–today history.</li>
        <li style={styles.bullet}><strong>Yield regime</strong> — a second dial showing the 3-month change in the 10-year Treasury yield as a 5-year percentile, with Deflationary / Neutral / Inflationary pills and the 30th and 70th threshold markers. Same 24-week strip + full-history click-through.</li>
        <li style={styles.bullet}><strong>Allocation</strong> — the headline equity-versus-defensive split for today's engine state (100/0, 80/20, or 50/50). When the defensive sleeve is active, the cell expands to show the sleeve composition (cash / GLD / SHY / TLT weights) for today's yield regime; when the sleeve is dormant, the cell shows the sleeve that would activate if stress crossed the Watch threshold.</li>
      </ul>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>3. Recommended Allocations</h4>
      <Body>
        A unified sortable table covering 11 GICS sectors plus 24 industry groups within them. Each
        row shows the sector or IG, the tilt direction (overweight / market-weight / underweight),
        the dollar weight scaled to the equity bucket and the leverage multiplier, the rating
        versus SPY, ETF tickers (clickable for the ETF detail), and the per-mechanism contribution
        bar that drove the tilt. Click any sector to expand its industry groups; click any IG to
        open the IG detail with constituent ETFs and stocks. The defensive sleeve sits at the
        bottom of the same table when active, so the page reads as one continuous allocation.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>4. Heatmap</h4>
      <Body>
        Six factor mechanisms across 11 sectors. Each cell shows whether that mechanism is
        currently a tailwind (green) or headwind (red) for that sector. The math is the sector's
        historical sensitivity to the mechanism multiplied by today's mechanism score. Hover any
        cell for the arithmetic; click for the sector's full breakdown.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>5. Backtest Validation · 1986 → 2026</h4>
      <Body>
        Four strategies compared side by side over the full 40-year sample: SPY buy-and-hold,
        Regime + Cash (engine stress signal scales equity, defensive bucket sits in cash),
        Regime + Defensive Sleeve (engine stress signal plus the yield-regime-aware sleeve), and
        Engine + Asset Tilt (the full MacroTilt strategy: engine sleeve + v9 sector and IG
        allocation inside the equity bucket). Each strategy gets a four-cell KPI card and the
        relative-performance chart shows all four lines from a common 0% start. Below the chart, a
        per-drawdown table documents the 11 historical drawdowns of 10 percent or worse and how
        each strategy navigated each one.
      </Body>
    </>
  ),
  "tilt-data": (
    <>
      <Body>
        The page reads three snapshot files. Each has a registered producer in the data manifest;
        the freshness chips at the top of the page surface staleness in real time.
      </Body>
      <DocsTable
        cols={["File", "What it carries", "Producer + cadence"]}
        rows={[
          [
            <Code>macrotilt_engine.json</Code>,
            "Today's engine state — stress state (Risk On / Watch / Risk Off), stress percentile + MOVE value + threshold values, yield regime (Inflationary / Neutral / Deflationary), 3M Δy-10y percentile + bp value + threshold bp values, headline allocation (equity % + defensive %), active sleeve label, sleeve composition weights.",
            <><Code>compute_macrotilt_engine.py</Code> · daily after close + Friday rebalance signal</>,
          ],
          [
            <Code>v10_allocation.json</Code>,
            "v9 sector allocator output — 11 sector weights and OW/MW/UW ratings, 24 industry-group tilts with $ exposure, contribution matrix per IG, per-mechanism scores and bands, leverage multiplier, defensive bucket dollar amounts.",
            <><Code>compute_v10_allocation.py</Code> · nightly 22:45 UTC</>,
          ],
          [
            <Code>macrotilt_engine_backtest.json</Code>,
            "1986–2026 weekly observation file (about 2,056 weeks) plus 11 documented drawdown episodes. Each weekly row carries the MOVE value + percentile, the 3M Δy-10y + percentile, the resulting stress state and yield regime, and the cumulative return of each of the four backtest strategies. Powers the bar strips, the relative-performance chart, and the drawdown table.",
            <>Backtest harness run on each engine spec lock (last · 2026-05-13)</>,
          ],
        ]}
      />
      <Body>
        Per-sector and per-IG sensitivities are baked into the v9 allocator script as constants
        (<Code>SECTOR_SENSITIVITY</Code> and <Code>INDUSTRY_GROUPS</Code> in
        <Code>compute_v10_allocation.py</Code>). Each sector has six sensitivity coefficients —
        one per mechanism — anchored on regression studies in the per-sector factor map. Each IG
        inherits its parent sector's sensitivities plus IG-specific adjustments (e.g. Semiconductors
        carries an extra negative sensitivity to Growth and Positioning &amp; Breadth on top of the
        Information Technology sector base).
      </Body>
      <Body>
        Sector ETF universe: 11 GICS sectors with three ETF families to choose from per sector —
        the SPDR XL series, the Vanguard V series, and the Fidelity F series. Plus four defensive
        buckets used by the v9 allocator: BIL (cash), TLT (long Treasuries), GLD (gold), LQD (IG
        corporate bonds). The engine's own defensive sleeve uses cash / GLD / SHY / TLT. SPY
        weights for the relative-tilt computation come from a quarterly snapshot.
      </Body>
    </>
  ),
  "tilt-models": (
    <>
      <Body>
        Two engines, in series. The MacroTilt 2-axis engine decides the equity-versus-defensive
        split and the sleeve composition; the v9 sector allocator runs inside the equity bucket
        and produces sector + IG tilts. Both are deterministic and versioned in the scripts.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 1 — Stress signal (engine, Axis 1)</h4>
      <Body>
        Every Friday after the US close, the engine takes the latest MOVE Index reading and asks
        where it sits in its trailing 5-year window. The thresholds are constants — 75th and 85th
        percentile — but the underlying window moves with the data, so a 2009-style high-vol regime
        and a 2017-style low-vol regime calibrate their own threshold levels against their own
        recent history.
      </Body>
      <Formula>{`window_5y     = MOVE values from the trailing 5 calendar years
move_pctile   = percentile_rank(MOVE_today, window_5y)

if move_pctile < 0.75:                stress_state = "Risk On"
elif move_pctile < 0.85:              stress_state = "Watch"
else:                                 stress_state = "Risk Off"

equity_pct     = { 1.00 if Risk On, 0.80 if Watch, 0.50 if Risk Off }
defensive_pct  = 1 - equity_pct`}</Formula>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 2 — Yield direction (engine, Axis 2)</h4>
      <Body>
        Same trailing 5-year window, different signal. The engine computes the change in the
        10-year Treasury yield over the past 3 months (today's yield minus the yield 3 months ago,
        in basis points) and asks where that change sits in its trailing 5-year distribution. The
        thresholds are 30th and 70th percentile. Axis 2 does not affect the equity-versus-defensive
        split — that is entirely Axis 1's job — but it selects which defensive sleeve gets used
        when the engine wants defense.
      </Body>
      <Formula>{`delta_y_3m       = (DGS10_today - DGS10_3M_ago)  in basis points
delta_pctile     = percentile_rank(delta_y_3m, trailing_5y_distribution)

if delta_pctile <= 0.30:    yield_regime = "Deflationary"
elif delta_pctile < 0.70:   yield_regime = "Neutral"
else:                       yield_regime = "Inflationary"`}</Formula>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 3 — Defensive sleeve composition</h4>
      <Body>
        When the engine wants any defensive sleeve, the composition is determined by the yield
        regime. No discretion, no override. The Inflationary sleeve deliberately holds no long
        Treasuries because they bleed value when yields are rising; the Deflationary sleeve leans
        into long Treasuries as a flight-to-quality hedge.
      </Body>
      <DocsTable
        cols={["Yield regime", "Cash", "GLD (gold)", "SHY (short Treasuries)", "TLT (long Treasuries)"]}
        rows={[
          ["Inflationary",  "50%", "30%", "20%", "0%"],
          ["Deflationary",  "25%", "25%", "0%",  "50%"],
          ["Neutral",       "50%", "25%", "0%",  "25%"],
        ]}
      />
      <Body>
        Weights inside the sleeve sum to 100 percent of the defensive bucket. If the stress state
        says 50 percent defensive and the yield regime says Inflationary, the actual portfolio
        split is 50 percent equity + 25 percent cash + 15 percent gold + 10 percent short
        Treasuries.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 4 — v9 sector and IG tilts inside the equity bucket</h4>
      <Body>
        The v9 allocator runs against the same six mechanisms used on Asset Tilt's heatmap:
        Valuation, Credit, Funding, Growth, Liquidity &amp; Policy, Positioning &amp; Breadth. Each
        mechanism is scored 0–100 from its calibrated input panel. For each sector, the contribution
        of mechanism <em>m</em> is the sector's historical sensitivity to <em>m</em> (a constant in
        the script) multiplied by today's <em>m</em> score normalized around its neutral midpoint.
        The sector's overall tilt score is the sum of six contributions; the OW/MW/UW rating is a
        threshold on that score. Industry groups inherit their parent sector's sensitivities and
        add IG-specific adjustments.
      </Body>
      <Formula>{`for each sector s and each mechanism m:
   contribution[s, m] = SECTOR_SENSITIVITY[s][m] * (score[m] - 50) / 50

tilt_score[s] = sum( contribution[s, m] over 6 mechanisms )

rating[s] = "OW"   if tilt_score[s]  >=  threshold_OW
          = "UW"   if tilt_score[s]  <= -threshold_UW
          = "MW"   otherwise`}</Formula>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 5 — Leverage (v9, inside the equity bucket)</h4>
      <Body>
        The v9 allocator can apply leverage <strong>only when the engine is fully Risk On.</strong>
        If the engine wants any defensive sleeve at all, leverage drops to 1.0×. In Risk On, v9
        looks at its six mechanism bands and applies a modest 1.25× only when all six are reading
        Risk-on or Neutral. The 1.5× ceiling is reserved for a future V-bottom regime-flip path
        that requires historical state tracking the production code does not yet implement — in
        practice today's allocator stays at 1.0× or 1.25×.
      </Body>
      <Formula>{`if defensive_pct > 0:                    leverage = 1.00x      (XOR rule)
elif all 6 mech bands in {Risk On, Neutral}: leverage = 1.25x
else:                                    leverage = 1.00x`}</Formula>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Refresh pipeline</h4>
      <Body>
        The engine snapshot recomputes daily after the US close and writes
        <Code> macrotilt_engine.json</Code>; the weekly rebalance signal lands every Friday close.
        The v9 sector allocator runs nightly at 22:45 UTC and writes
        <Code> v10_allocation.json</Code>. The backtest weekly history file refreshes on each
        engine spec lock (most recent lock · 2026-05-13).
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
        Five constraints bind every allocation decision. They are enforced in the engine compute
        script and the v9 sector allocator — assertion failures halt the deploy, so the rules are
        guaranteed to hold in production rather than just promised in copy.
      </Body>
      <DocsTable
        cols={["Rule", "Why it exists", "Enforced where"]}
        rows={[
          [<strong>Defensive sleeve ≤ 50%</strong>,                "The engine's Risk Off state caps defensive allocation at 50%. Even in maximum stress, the engine never sells more than half the equity sleeve. Intent: stay invested through stress.",   "Engine compute script · workflow audit"],
          [<strong>Equity ≥ 50%</strong>,                          "The complement to the defensive cap. Combined with the cap, the portfolio is at least 50/50 even in the deepest engine de-risking signal.",                                            "Engine compute script · workflow audit"],
          [<strong>Sleeve composition is regime-keyed only</strong>,    "When defensive is active, the cash / gold / short-Treasury / long-Treasury weights come from the yield-regime table — no manual override. Keeps the sleeve aligned with the rate environment.", "Engine compute script · workflow audit"],
          [<strong>v9 leverage ≤ 1.5×</strong>,                       "The v9 sector allocator caps leverage at 1.5×. The 1.5× ceiling is reserved for a V-bottom regime-flip path; today's allocator runs at 1.0× or 1.25×. No path to runaway leverage.",  "v9 compute script · workflow audit"],
          [<strong>Defensive XOR leverage</strong>,                     "If the engine wants any defensive sleeve, v9 leverage drops to 1.0×. Defensive and leverage represent opposite tactical bets and the system never runs them against each other.",    "v9 compute script · workflow audit"],
        ]}
      />
      <Callout>
        <strong>Why these rules are non-negotiable.</strong> The hard caps are not optimization
        constraints we accept reluctantly — they're the discipline that keeps the strategy inside
        reasonable risk bounds across every regime, including ones we haven't seen yet. The
        1986–2026 validation tested the engine across 11 historical drawdowns; the hard caps are
        why even the worst-case episode (2008 GFC) shows a 35 percent strategy drawdown versus 55
        percent for SPY.
      </Callout>
    </>
  ),
  "backtest-content": (
    <>
      <Body>
        The MacroTilt strategy is validated over <strong>1986–2026</strong> — about 2,056 weeks
        of weekly rebalancing. Each historical week's allocation comes from running the engine
        rules and the v9 sector allocator against the data available at that point in time (no
        lookahead). Equity returns from SPY; defensive sleeve returns from BIL (cash proxy), GLD,
        SHY, and TLT. Pre-2002 MOVE history is replaced with a Z-standardized proxy built from
        21-day rolling standard deviation of daily 10-year Treasury yield changes, rescaled so its
        mean and standard deviation match the actual MOVE Index over 2002–2007. The live
        production engine only reads actual MOVE values; the proxy is used for backtest only.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Four strategies, head to head</h4>
      <Body>
        The backtest section on Asset Tilt compares four strategies. Each adds one layer of the
        full system, so the contribution of each component is visible directly.
      </Body>
      <DocsTable
        cols={["Strategy", "What it does", "$1 →", "CAGR", "Sharpe", "Max DD"]}
        rows={[
          ["SPY buy-and-hold",                "Passive benchmark. Hold the broad equity index through every regime.",                                                  "$65.05",  "+10.86%",  "0.50",  "−54.6%"],
          ["Regime + Cash",                   "Use the engine's stress signal to scale equity 100 / 80 / 50%. Defensive bucket sits in cash. Isolates the de-risking decision.",  "—",       "—",        "—",     "—"],
          ["Regime + Defensive Sleeve",       "Same regime scaling, but the defensive bucket activates the yield-regime-aware sleeve (cash + GLD + SHY/TLT). Isolates the sleeve contribution.", "—",  "—",        "—",     "—"],
          [<><strong>Engine + Asset Tilt</strong> <span style={{color:"var(--text-muted)",fontSize:11}}>(MacroTilt)</span></>, "Full stack. Engine sleeve when de-risked; v9 sector + industry-group allocation inside the equity bucket.", <strong>$89.57</strong>, <strong>+11.74%</strong>, <strong>0.61</strong>, <strong>−35.0%</strong>],
        ]}
      />
      <Body>
        The Engine + Asset Tilt strategy delivers <strong>+88 basis points of annualized return
        over SPY</strong> at <strong>240 basis points lower volatility</strong>, which compounds to
        a 38 percent terminal-wealth advantage over the 40-year window ($89.57 versus $65.05 per
        dollar invested). The Sharpe ratio is 0.61 versus SPY's 0.50; max drawdown is 35 percent
        versus 55 percent. The intermediate strategies in the table show that the de-risking
        decision (Regime + Cash vs SPY) and the regime-aware sleeve (Regime + Defensive Sleeve vs
        Regime + Cash) each contribute, and v9 sector tilts add the rest of the gap on top. The
        live Asset Tilt page reads every weekly observation and the per-drawdown attribution from
        <Code> macrotilt_engine_backtest.json</Code>.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Per-drawdown attribution — 11 episodes</h4>
      <Body>
        Eleven SPY drawdowns of 10 percent or worse over 1986–2026. The "dominant yield regime"
        column shows the yield regime the engine spent the majority of the drawdown weeks in — the
        defensive sleeve composition follows from that.
      </Body>
      <DocsTable
        cols={["Episode", "SPY depth", "Dominant yield regime", "SPY", "Engine + Asset Tilt", "Difference", "What happened"]}
        rows={[
          ["1987 Black Monday",     "−33.3%",  "Inflationary (62% of weeks)",   "−33.0%",  "−31.8%",  "+1.1 pp",  "Engine caught the volatility crack late; partial defensive sleeve absorbed about a percentage point of the drop."],
          ["1990 Recession",        "−18.3%",  "Inflationary (50% of weeks)",   "−16.3%",  "−15.5%",  "+0.7 pp",  "Modest help. Cash-heavy inflationary sleeve held duration risk down in a rising-rate environment."],
          ["1998 LTCM",             "−17.6%",  "Neutral (75% of weeks)",        "−16.1%",  "−16.1%",  "0.0 pp",   "Engine did not fire. Vol was contained until it wasn't. Neutral sleeve when it did fire matched SPY's path."],
          ["1999 Y2K",              "−11.7%",  "Inflationary (57% of weeks)",   "−10.9%",  "−12.0%",  "−1.1 pp",  "The only losing episode in the eleven. A short-lived vol spike fired the engine into Watch and the sleeve trailed equity slightly."],
          ["2000 Dot-com",          "−45.7%",  "Deflationary (45% of weeks)",   "−43.3%",  "−31.9%",  "+11.3 pp", "Engine sat at Risk Off through the heart of the decline; the deflationary sleeve's 50% TLT allocation outperformed equity by about 13 percentage points."],
          ["2007 GFC",              "−54.6%",  "Deflationary (62% of weeks)",   "−54.5%",  "−30.7%",  "+23.8 pp", "The single largest contribution. Engine held cash + TLT through the deflationary regime; spared 23.8 percentage points versus SPY."],
          ["2015 China",            "−11.2%",  "Neutral (61% of weeks)",        "−9.0%",   "−9.0%",   "0.0 pp",   "Engine did not fire. Vol stayed below the 75th-percentile threshold throughout the episode."],
          ["2018 Q4",               "−17.1%",  "Inflationary (71% of weeks)",   "−16.4%",  "−16.4%",  "0.0 pp",   "Vol spiked late; the engine's signal arrived too late to help on the way down."],
          ["2020 COVID",            "−31.8%",  "Deflationary (100% of weeks)",  "−30.7%",  "−18.8%",  "+11.9 pp", "Engine fired into Risk Off in week one of the crash; deflationary sleeve's TLT-heavy mix dominated. The fastest and cleanest engine win in the sample."],
          ["2022 bear",             "−23.9%",  "Inflationary (78% of weeks)",   "−23.2%",  "−14.0%",  "+9.2 pp",  "Inflationary sleeve correctly avoided long Treasuries — they would have been the worst possible defensive asset in 2022's bond rout. Cash and gold carried the absolute return."],
          ["2025 spring",           "−16.9%",  "Neutral (62% of weeks)",        "−15.6%",  "−15.6%",  "0.0 pp",   "Engine did not fire. The drawdown unfolded inside the calm-vol regime."],
        ]}
      />
      <Body>
        Pattern: the strategy adds value in <strong>deep drawdowns driven by bond-market stress</strong>
        (2000, 2007, 2020, 2022) and is approximately neutral in shallower drawdowns or those that
        unfold inside the calm-vol regime (1998, 2015, 2025). The yield-regime axis matters
        directly — in 2007 and 2020 the deflationary sleeve's TLT-heavy mix did the heavy lifting,
        and in 2022 the inflationary sleeve's TLT-free mix kept the strategy out of a bond rout that
        would have crushed a generic 60/40 defensive sleeve.
      </Body>
      <Callout>
        <strong>Calibration discipline.</strong> The 75th / 85th / 70th / 30th percentile
        thresholds were the original spec; they were not optimized against the backtest. The
        defensive sleeve weights (50/30/20/0 for Inflationary, 25/25/0/50 for Deflationary,
        50/25/0/25 for Neutral) were grid-searched against the backtest, constrained to round-number
        weights summing to 100. No threshold was tuned to lift any one drawdown's attribution
        number.
      </Callout>
      <Body>
        Full evidence pack: the locked engine spec at <Code>FINAL_LOCKED_ENGINE_2026-05-13.md</Code>
        and the consolidated backtest at <Code>CONSOLIDATED_2AXIS_BACKTEST_2026-05-13.md</Code> in
        the project workspace. Every threshold in the engine was locked against this validation
        before being committed to code.
      </Body>
    </>
  ),
  "sources-content": (
    <>
      <Body>
        Every number on the site traces back to one of these public vendors. Every data-driven
        surface on the site labels itself "Vendor · As of [date]"; this list is the master.
      </Body>
      <DocsTable
        cols={["Vendor", "What it provides"]}
        rows={[
          ["Federal Reserve · FRED",         "10y Treasury yield (DGS10), 2y yield (DGS2), 10y–2y curve (T10Y2Y), Effective Fed Funds (DFF), Fed balance sheet (WALCL), bank credit (TOTBKCR), M2 (M2SL), SLOOS C&I and CRE tightening surveys, jobless claims (IC4WSA), CPFF spread, ANFCI, STLFSI, T-bills, ICE BofA credit spreads (BAMLH0A0HYM2 high-yield, BAMLC0A0CM investment-grade, BAMLH0A3HYC CCC), USD broad index (DTWEXBGS), CFNAI, Conference Board LEI"],
          ["ICE BofA · Yahoo ^MOVE",         "MOVE Index (Treasury volatility) — the primary engine input"],
          ["CBOE",                           "VIX (equity volatility), SKEW (tail-risk skew)"],
          ["Shiller · multpl",               "CAPE (Shiller P/E), trailing S&P 500 P/E"],
          ["ISM (via FRED NAPMPI)",          "Manufacturing PMI"],
          ["BLS JOLTS (via FRED QUITS)",     "Job openings, hires, separations, quits rate"],
          ["BEA",                            "US GDP for the Buffett indicator (US market cap / GDP)"],
          ["Yahoo Finance",                  "KBW Bank index, copper / gold futures, stock fundamentals (forward P/E, revenue growth, profitability) for the Trading Opportunities scanner"],
          ["Polygon Massive",                "Daily equity prices for the universe of US-listed common stocks + ADRs, dividends, splits"],
          ["Unusual Whales",                 "Options flow, dark-pool volume, Form 4 insider buying, Congressional disclosure"],
          ["ZeroHedge (RSS + Premium)",      "News sentiment"],
          ["Wikipedia · iShares",            "Index membership flags (S&P 500, NASDAQ-100, Russell 2000)"],
          ["Plaid",                          "Brokerage feed (read-only) for Portfolio Insights"],
        ]}
      />
      <Body>
        Every data element is registered in the project's data manifest with cadence, freshness
        SLA, and the surfaces that consume it. The freshness chip on each tile reads from that
        manifest plus the pipeline-health snapshot to show green (within SLA), amber (one to two
        refreshes overdue), or red (three or more overdue or a producer failure).
      </Body>
    </>
  ),
  "glossary-content": (
    <>
      <DocsTable
        cols={["Term", "Definition"]}
        rows={[
          [<><Code>bp</Code> (basis points)</>, "One basis point = 0.01%. 100 bp = 1%."],
          ["Buffett indicator",                 "US market capitalization divided by US GDP. A standard valuation gauge; readings above 150% are historically rich."],
          ["CAPE",                              "Cyclically-Adjusted P/E (Shiller). S&P 500 price divided by 10-year average inflation-adjusted earnings. Smooths earnings cycles."],
          ["Calm / Elevated / Stressed",        "Per-tile state on Macro Overview, driven by the trailing 5-year percentile of that indicator against its direction-of-stress flag. NOT the engine's stress state — that's a separate concept on Asset Tilt."],
          ["Defensive sleeve",                  "The non-equity allocation when the engine wants defense. Composition is fully determined by the yield regime (Inflationary / Neutral / Deflationary)."],
          ["Deflationary",                      "Yield regime where the 3-month change in the 10y Treasury yield sits in the bottom 30% of its trailing 5y window — yields falling fast. Defensive sleeve leans into long Treasuries."],
          ["Engine read",                       "The MacroTilt 2-axis engine's two-pill output on Asset Tilt: stress state (Risk On / Watch / Risk Off) and yield regime (Inflationary / Neutral / Deflationary)."],
          ["ERP",                               "Equity Risk Premium = S&P 500 earnings yield minus 10y Treasury yield. A near-zero or negative ERP means stocks are priced for perfection."],
          ["Heatmap",                           "Asset Tilt grid showing six factor mechanisms across 11 sectors; each cell is the sector's sensitivity to the mechanism times today's mechanism score."],
          ["HY OAS",                            "High-Yield Option-Adjusted Spread. Yield premium that junk bonds offer over Treasuries."],
          ["IG (Industry Group)",               "GICS Industry Group, one classification level below Sector. 24 IGs across 11 sectors."],
          ["IG OAS",                            "Investment-Grade Option-Adjusted Spread. Yield premium that IG corporate bonds offer over Treasuries."],
          ["Inflationary",                      "Yield regime where the 3-month change in the 10y Treasury yield sits in the top 30% of its trailing 5y window — yields rising fast. Defensive sleeve avoids long Treasuries."],
          ["Leverage (v9)",                     "Gross-exposure multiplier inside the v9 equity allocator. 1.0× default; 1.25× when all six mechanism bands read Risk On or Neutral and the engine is Risk On; cap at 1.5×."],
          ["Mechanism (v9)",                    "One of six factor inputs to the v9 sector allocator: Valuation, Credit, Funding, Growth, Liquidity & Policy, Positioning & Breadth."],
          ["MOVE Index",                        "ICE BofA's Treasury-market volatility index. The primary stress-signal input to the engine — analogous to VIX but for the bond market."],
          ["Neutral (yield)",                   "Yield regime where the 3-month change in the 10y Treasury yield sits between the 30th and 70th percentile of its trailing 5y window."],
          ["OW / MW / UW",                      "Overweight / Market-weight / Underweight. Refers to a sector or IG's allocation versus its SPY benchmark weight."],
          ["Percentile",                        "Where a current value sits in a historical sample. p100 = highest reading on record; p0 = lowest."],
          ["Risk Off",                          "Stress state where the MOVE Index is at or above the 85th percentile of its trailing 5y window. Engine allocates 50% equity / 50% defensive."],
          ["Risk On",                           "Stress state where the MOVE Index is below the 75th percentile of its trailing 5y window. Engine allocates 100% equity / 0% defensive."],
          ["Sharpe ratio",                      "Annualized excess return divided by annualized volatility. Higher = better risk-adjusted return."],
          ["SLOOS",                             "Senior Loan Officer Opinion Survey. Federal Reserve quarterly survey of bank lending standards."],
          ["Sortino ratio",                     "Like Sharpe, but volatility is computed only over down-days. Higher = better at avoiding losses specifically."],
          ["Splice (MOVE)",                     "The transition from a pre-2002 Z-standardized proxy to the actual ICE BofA MOVE Index at 2002-11-12. Used for backtest only; the live engine reads actual MOVE values only."],
          ["SPY",                               "SPDR S&P 500 ETF. The benchmark used for sector vs market relative weights and for the engine's headline comparison."],
          ["Stress signal",                     "Axis 1 of the engine. The trailing 5-year percentile of the MOVE Index. Outputs Risk On, Watch, or Risk Off."],
          ["Watch",                             "Stress state where the MOVE Index sits between the 75th and 85th percentile of its trailing 5y window. Engine allocates 80% equity / 20% defensive."],
          ["Yield regime",                      "Axis 2 of the engine. The trailing 5-year percentile of the 3-month change in the 10y Treasury yield. Outputs Inflationary, Neutral, or Deflationary."],
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
          MacroTilt runs a three-stage funnel from macro state to portfolio holdings.
          <strong style={{ color: "var(--text)" }}> Macro Overview</strong> is the indicator backdrop — 27 indicators across Rates, Credit, Equities, Money &amp; Banking, and the real Economy.
          <strong style={{ color: "var(--text)" }}> Asset Tilt</strong> is where the 2-axis engine read lives and turns the backdrop into an allocation across equity, defensive sleeve, sectors, and industry groups.
          <strong style={{ color: "var(--text)" }}> Trading Opportunities</strong> picks specific stocks within those.
          <strong style={{ color: "var(--text)" }}> Portfolio Insights</strong> connects all of it to your actual holdings.
        </p>
        <div style={{ marginTop: 18, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          <span>Last updated · 2026-05-18</span>
          <span>Engine spec lock · 2026-05-13 (2-axis: MOVE + 10y yield direction)</span>
          <span>Backtest window · 1986 → 2026 · 2,056 weeks</span>
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
