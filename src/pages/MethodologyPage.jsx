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

// ─── Section schema ────────────────────────────────────────────────────────
// Used for TOC, search filtering, and content rendering. Each subsection's
// `body` is a JSX renderer; the searchable text comes from `searchText`.

const SECTIONS = [
  {
    id: "macro-overview",
    num: "01",
    title: "Macro Overview",
    blurb: "Where the cycle sits today.",
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
    blurb: "Where the cycle says to lean.",
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
    blurb: "v10.1c against v9 baseline.",
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
  table: {
    width: "100%", fontSize: 12.5, borderCollapse: "collapse", margin: "10px 0 16px",
  },
  th: {
    textAlign: "left", padding: "8px 10px", fontWeight: 500, fontSize: 10,
    color: "var(--text-muted)", letterSpacing: "0.06em",
    textTransform: "uppercase", borderBottom: "0.5px solid var(--border)",
    background: "var(--surface-2)",
  },
  td: {
    padding: "9px 10px", borderBottom: "0.5px dashed var(--border)",
    verticalAlign: "top",
  },
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

// ─── Section content (hand-written prose, no auto-generation) ──────────────

const SECTION_CONTENT = {
  // ============================================================
  // §1 MACRO OVERVIEW
  // ============================================================
  "macro-why": (
    <>
      <Body>
        Market regime drives every other decision on the site. Without a clean read of where the cycle
        sits, every allocation choice and every stock pick is a guess about the macro context. The Macro
        Overview answers one question: <strong>given everything we can measure, where are we?</strong>
      </Body>
      <Body>
        We do not predict drawdowns. We describe state. The page shows six independent mechanisms scored
        0–100. A high score means that mechanism is showing late-cycle / stress characteristics; a low
        score means it's running calm. Six mechanisms, not one, because no single indicator is reliable
        across all regimes — but mechanisms that disagree tell you something useful, and mechanisms
        that agree tell you something obvious.
      </Body>
      <Callout>
        <strong>The page-level composite is descriptive, not prescriptive.</strong> A score of 64 doesn't
        mean "sell." It means "the average mechanism reads in caution territory; here are the specific
        ones running hot, here are the ones running calm." What you do about it lives one click away,
        in <em>Asset Tilt</em>.
      </Callout>
    </>
  ),
  "macro-how": (
    <>
      <Body>
        Read the composite first. The bands at the top of the dial are the cohort:
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Composite</th>
          <th style={styles.th}>Band</th>
          <th style={styles.th}>What it means</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}><Code>0–25</Code></td><td style={styles.td}>Risk-on</td><td style={styles.td}>Most mechanisms read benign. Cycle is in a low-risk regime.</td></tr>
          <tr><td style={styles.td}><Code>25–50</Code></td><td style={styles.td}>Neutral</td><td style={styles.td}>Composite sits in the middle. A few mechanisms run hot, the rest stay calm.</td></tr>
          <tr><td style={styles.td}><Code>50–75</Code></td><td style={styles.td}>Caution</td><td style={styles.td}>Several mechanisms above the cohort. Heat is selective, not system-wide.</td></tr>
          <tr><td style={styles.td}><Code>75–100</Code></td><td style={styles.td}>Risk-off</td><td style={styles.td}>Multiple mechanisms in the upper quartile. Broad-based heat.</td></tr>
        </tbody>
      </table>
      <Body>
        Then look at the six mechanism dials. The one furthest from the cohort tells you the asymmetric
        risk; the others give context. Click any mechanism to see the underlying indicators that drove
        its score, the score's recent trajectory, and which way the score will move when each indicator
        shifts.
      </Body>
      <Body>
        Refresh cadence is nightly at 22:30 UTC weekdays. Most mechanism scores move slowly
        (weeks-to-months between meaningful shifts). Some indicators inside them — HY OAS, IG OAS,
        VIX, MOVE — can move daily.
      </Body>
    </>
  ),
  "macro-data": (
    <>
      <Body>
        Six mechanisms, three or four indicators each, all from public sources. The exact panels
        running in production today:
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Mechanism</th>
          <th style={styles.th}>Indicators</th>
          <th style={styles.th}>Source</th>
          <th style={styles.th}>Cadence</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}>Valuation</td><td style={styles.td}>CAPE (Shiller), Equity Risk Premium (1/CAPE − 10y Treasury), Buffett Indicator (corporate equities ÷ GDP)</td><td style={styles.td}>Shiller · FRED</td><td style={styles.td}>Monthly + quarterly</td></tr>
          <tr><td style={styles.td}>Credit</td><td style={styles.td}>IG OAS (Baa − 10y), HY OAS, HY/IG ratio</td><td style={styles.td}>ICE BofA via FRED</td><td style={styles.td}>Daily</td></tr>
          <tr><td style={styles.td}>Funding</td><td style={styles.td}>Commercial paper risk premium, St. Louis Fed Financial Stress Index, Bank reserves at the Fed, Reverse repo balance</td><td style={styles.td}>FRED</td><td style={styles.td}>Daily + weekly</td></tr>
          <tr><td style={styles.td}>Growth</td><td style={styles.td}>CFNAI 3-month, Jobless claims (4-week average), ISM Manufacturing PMI, Banks vs S&P 500 (BKX/SPX ratio)</td><td style={styles.td}>Chicago Fed · DOL · ISM · Yahoo</td><td style={styles.td}>Mixed (weekly + monthly + daily)</td></tr>
          <tr><td style={styles.td}>Liquidity & Policy</td><td style={styles.td}>Chicago Fed ANFCI, Fed balance sheet YoY %, SLOOS C&I lending standards, M2 money supply YoY</td><td style={styles.td}>FRED · Chicago Fed</td><td style={styles.td}>Mixed (weekly + monthly + quarterly)</td></tr>
          <tr><td style={styles.td}>Positioning & Breadth</td><td style={styles.td}>CBOE SKEW, VIX, equity-credit correlation (60-day), MOVE Index (Treasury vol)</td><td style={styles.td}>CBOE · ICE</td><td style={styles.td}>Daily</td></tr>
        </tbody>
      </table>
      <Body>
        Sprint 1 panels (Valuation, Credit, Growth) are exposed in
        <Code>methodology_calibration_v11.json</Code> with hand-curated descriptions, percentile
        anchors, and direction tags. Sprint 2 panels (Funding, Liquidity & Policy, Positioning &
        Breadth) are computed live from <Code>indicator_history.json</Code> against the post-2011
        sample. Both feed the same direction-corrected percentile scoring described below.
      </Body>
      <Body>
        Sample windows differ by indicator: most market-data indicators use post-2011 (the stable
        post-GFC regime), some macro series go back to 1971 or 1986. The window is documented per
        indicator inside its drill-down on the Macro Overview page.
      </Body>
    </>
  ),
  "macro-models": (
    <>
      <Body>
        Two layers: indicator → score, then mechanism → composite.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Indicator score</h4>
      <Body>
        Each indicator's current value is converted to a 0–100 "concerning score" based on its percentile
        in the indicator's historical sample, adjusted for direction:
      </Body>
      <Formula>{`high_is_concerning   →  score = percentile
low_is_concerning    →  score = 100 − percentile
bidir_top            →  score = percentile
bidir_bottom         →  score = 100 − percentile`}</Formula>
      <Body>
        Direction encoding handles indicators where either tail is concerning. Credit spreads are the
        canonical example: very high spreads = stress (top concerning), very low spreads = late-cycle
        complacency (bottom concerning). The calibration JSON tags each indicator with one of the four
        direction labels.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Mechanism score</h4>
      <Formula>{`mechanism_score = round( mean(indicator_scores) )`}</Formula>
      <Body>
        Simple equal-weight average. We chose simple average over score-weighted (where higher-scoring
        indicators carry more weight) because the latter overstates conviction when one indicator is
        already in the extreme. Equal weight gives every input a steady voice.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Composite (page-level)</h4>
      <Formula>{`composite = round( mean(mechanism_scores) )`}</Formula>
      <Body>
        Same logic at the page level. Six mechanisms, simple average. The score lands in one of the
        four bands above and that becomes the page-level stance pill.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Refresh pipeline</h4>
      <Body>
        <Code>scripts/compute_v11_mechanisms.py</Code> runs nightly at 22:30 UTC weekdays via
        the <Code>cycle-mechanisms-daily</Code> GitHub Actions workflow. It reads
        <Code>methodology_calibration_v11.json</Code> for Sprint 1 mechanism inputs (Valuation,
        Credit, Growth) and <Code>public/indicator_history.json</Code> for Sprint 2 mechanisms
        (Funding, Liquidity & Policy, Positioning & Breadth). Output: <Code>public/cycle_board_snapshot.json</Code>,
        which every consumer surface (home page tile, Macro Overview, Asset Tilt) reads.
      </Body>
    </>
  ),

  // ============================================================
  // §2 ASSET TILT
  // ============================================================
  "tilt-why": (
    <>
      <Body>
        The macro state is useless if it doesn't translate into portfolio actions. The Asset Tilt page
        does that translation: given today's mechanism scores, it produces an explicit allocation
        recommendation — equity %, defensive %, leverage, sector tilts, industry-group tilts.
      </Body>
      <Body>
        Two design principles. First, <strong>every threshold is backtested</strong>. No hand-picked
        cutoffs, no narrative reasoning that drifts when the regime shifts. The decision rules are
        deterministic, calibrated against 2012–2026 history, and re-run on every new data point.
      </Body>
      <Body>
        Second, <strong>hard caps prevent any regime from blowing past prudent bounds</strong>:
      </Body>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}>Defensive sleeve never exceeds 50% of capital, even in a maximum-stress regime.</li>
        <li style={styles.bullet}>Leverage never exceeds 1.5×.</li>
        <li style={styles.bullet}>Defensive and leverage are never on at the same time. If the engine wants any defensive sleeve, leverage drops to 1.0×.</li>
        <li style={styles.bullet}>All six mechanisms feed every decision. No single point of failure in the input layer.</li>
      </ul>
      <Body>
        These rules are constraints in the optimization, not assumptions about what's optimal. Within
        the constraints, the decision rules learn from history what allocation has historically
        delivered the best risk-adjusted return at each stress level.
      </Body>
    </>
  ),
  "tilt-how": (
    <>
      <Body>
        The page reads top-to-bottom in five blocks:
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>1. Hero & KPI strip</h4>
      <Body>
        Page-level stance pill (Risk On / Neutral / Cautious / Risk Off) plus five KPIs: Equity %,
        Defensive %, Leverage, Stress score, Gross exposure. The headline copy describes the regime
        in one sentence — and only claims defensive activation when defensive % is actually positive.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>2. Cycle mechanisms strip</h4>
      <Body>
        The same six mechanisms from Macro Overview, repeated here as a quick-glance reference for
        what's driving today's allocation. Each card is clickable to see the mechanism's underlying
        indicators.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>3. Recommended Asset Tilt table</h4>
      <Body>
        Eleven sectors plus four defensive buckets. Each row shows the sector name, ETF tickers
        (clickable for ETF detail), a visual bar, the dollar tilt (leverage-adjusted; per $100 of
        capital), and the rating + delta vs SPY. Click any sector to expand its industry groups
        inline. Click any IG to see the constituent ETFs and stocks.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>4. Mechanism heatmap</h4>
      <Body>
        Six mechanisms × eleven sectors. Each cell shows whether that mechanism is currently a tailwind
        (green) or headwind (red) for that sector. The math is the sector's historical sensitivity to
        the mechanism multiplied by today's mechanism score. Hover any cell for the math, click for the
        sector's full breakdown.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>5. Methodology footer</h4>
      <Body>
        One-line summary of the calibration plus a link to this page. The page refreshes nightly at
        22:45 UTC, fifteen minutes after the Macro Overview's cycle board.
      </Body>
    </>
  ),
  "tilt-data": (
    <>
      <Body>
        Inputs live in three files:
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>File</th>
          <th style={styles.th}>What it carries</th>
          <th style={styles.th}>Refreshed by</th>
        </tr></thead>
        <tbody>
          <tr>
            <td style={styles.td}><Code>cycle_board_snapshot.json</Code></td>
            <td style={styles.td}>Today's six mechanism scores (0–100 each)</td>
            <td style={styles.td}><Code>compute_v11_mechanisms.py</Code> · 22:30 UTC</td>
          </tr>
          <tr>
            <td style={styles.td}><Code>v10_allocation.json</Code></td>
            <td style={styles.td}>Allocator output: equity %, defensive %, leverage, 11 sector tilts, 24 IG tilts, contribution matrix</td>
            <td style={styles.td}><Code>compute_v10_allocation.py</Code> · 22:45 UTC</td>
          </tr>
          <tr>
            <td style={styles.td}><Code>methodology_calibration_v11.json</Code></td>
            <td style={styles.td}>Sprint 1 mechanism input panels with hand-curated percentiles + descriptions</td>
            <td style={styles.td}>Manually updated when calibration windows change</td>
          </tr>
        </tbody>
      </table>
      <Body>
        Per-sector and per-IG sensitivities are baked into the allocator script as constants
        (see <Code>SECTOR_SENSITIVITY</Code> and <Code>INDUSTRY_GROUPS</Code> in
        <Code>compute_v10_allocation.py</Code>). Each sector has six sensitivity coefficients —
        one per mechanism — anchored on per-sector regression studies in the
        <Code>v6_per_sector_factor_map.md</Code> document. Each IG inherits its parent sector's
        sensitivities plus IG-specific adjustments (e.g. Semiconductors carries an extra negative
        sensitivity to Growth and Positioning & Breadth on top of the Tech-sector base).
      </Body>
      <Body>
        Sector ETF universe: eleven GICS sectors with three ETF families to choose from per sector —
        the SPDR XL series (XLK / XLC / XLF / XLV / XLY / XLI / XLP / XLE / XLB / XLRE / XLU), the
        Vanguard V series (VGT / VOX / VFH / VHT / VCR / VIS / VDC / VDE / VAW / VNQ / VPU), and the
        Fidelity F series (FTEC / FCOM / FNCL / FHLC / FDIS / FIDU / FSTA / FENY / FMAT / FREL / FUTY).
        Plus four defensive buckets: BIL (cash), TLT (long Treasuries), GLD (gold), LQD (IG corporate
        bonds). SPY weights for the relative-tilt computation come from a quarterly snapshot.
      </Body>
    </>
  ),
  "tilt-models": (
    <>
      <Body>
        The allocator runs in five steps. Each step is deterministic and the rules are versioned
        in the script.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 1 — Stress score</h4>
      <Body>
        The stress score is the count, weighted, of how many of the three stress-detection mechanisms
        are flagging concern. The three are <strong>Credit</strong>, <strong>Liquidity & Policy</strong>,
        and <strong>Positioning & Breadth</strong> — chosen because together they cover credit-side
        contagion (Credit), policy/liquidity reversals (Liq&Pol), and crowd / sentiment dynamics (Pos&Br).
      </Body>
      <Formula>{`for each of [Credit, Liq&Pol, Pos&Br]:
   if mechanism band == "Caution" (50–75)  →  +1
   if mechanism band == "Risk Off" (75–100) →  +2

stress_score ∈ [0, 6]`}</Formula>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 2 — Equity vs Defensive split</h4>
      <Formula>{`if stress_score < 4   →  defensive_pct = 0%
else                  →  defensive_pct = (stress_score − 3) × 20%, capped at 50%

equity_pct = 1 − defensive_pct`}</Formula>
      <Body>
        Calibrated 2026-05-04. The intent: <em>most of the time at 100% equity</em> (Joe directive).
        The threshold 4 means the engine activates defensive only when stress is severe — three
        mechanisms in caution, or one in risk-off plus two in caution. In the 2012–2026 sample, this
        rule kept the allocator at 100% equity 88% of the time.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 3 — Leverage</h4>
      <Formula>{`if defensive_pct > 0           →  leverage = 1.0×    (XOR rule)
elif all 6 mechs in {Risk-on, Neutral} →  leverage = 1.25×
else                            →  leverage = 1.0×

(future v10.2: V-bottom regime-flip detection unlocks up to 1.5×)`}</Formula>
      <Body>
        Leverage activates only in genuinely calm regimes. The 1.5× ceiling is reserved for V-bottom
        regime-flip events (three or more mechanisms transitioning Risk-Off → Caution in a single
        month) — a v10.2 follow-up that requires historical state tracking we haven't built yet.
        Today's allocator stays at 1.0× or 1.25×.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 4 — Per-sector tilt</h4>
      <Formula>{`for each sector:
   tilt_score = Σᵢ (sensitivityᵢ × normalized_scoreᵢ)
       where normalized_scoreᵢ = (mechanism_scoreᵢ − 50) / 50  ∈ [−1, +1]

   if tilt_score > +0.3  →  rating = OW,  multiplier = 1.20× SPY weight
   if tilt_score < −0.3  →  rating = UW,  multiplier = 0.75× SPY weight
   else                  →  rating = MW,  multiplier = 1.00× SPY weight

equity dollars = SPY_weight × multiplier  (renormalized so total = equity_pct × $100)`}</Formula>
      <Body>
        Each sector's six sensitivities are coefficients between roughly −1.5 and +1.5. Positive means
        the sector benefits when that mechanism is in caution/risk-off; negative means the sector is
        hurt. The sensitivity matrix is anchored on per-sector regression studies but documented as
        constants in code rather than re-fit every night — refits happen on a calibration cadence
        (Sprint 2 was 2026-05-04).
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Step 5 — Per-IG tilt</h4>
      <Formula>{`for each industry group:
   ig_sensitivity = parent_sector_sensitivity + ig_specific_adjustment
   tilt_score, rating same logic as sector
   ig dollars renormalized so each sector's IGs sum back to its sector total`}</Formula>
      <Body>
        IGs inherit the parent sector's sensitivity and add IG-specific deltas. Example: the Banks
        IG inside Financials adds −0.4 to Funding and −0.3 to Credit on top of the Financials base
        — banks are more sensitive to funding stress than the sector's other IGs (Insurance,
        Diversified Financials).
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Defensive sleeve composition</h4>
      <Body>
        When defensive_pct &gt; 0, the four buckets (BIL · TLT · GLD · LQD) are equal-weighted:
        each gets <Code>defensive_pct / 4</Code> of capital. This is intentionally simple — the
        allocator's value is in the equity-vs-defensive decision, not in micro-optimizing within
        the defensive sleeve.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Audit checks (every refresh)</h4>
      <Body>
        Before <Code>v10_allocation.json</Code> is committed, the workflow runs four assertions:
      </Body>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}><Code>defensive_pct ≤ 50%</Code></li>
        <li style={styles.bullet}><Code>leverage ≤ 1.5×</Code></li>
        <li style={styles.bullet}><Code>NOT (defensive_pct &gt; 0 AND leverage &gt; 1.0×)</Code></li>
        <li style={styles.bullet}><Code>all 6 mechanisms present in input</Code></li>
      </ul>
      <Body>
        Any assertion failure halts the workflow and the page keeps the last-known-good allocation.
        No partial / inconsistent allocations ship.
      </Body>
    </>
  ),

  // ============================================================
  // §3 TRADING OPPORTUNITIES
  // ============================================================
  "ops-why": (
    <>
      <Body>
        Asset Tilt tells you which sectors and industry groups to lean into. Trading Opportunities
        goes one level finer: <strong>which specific stocks within those</strong>. The output is a
        single composite score per ticker that combines technicals, fundamentals, options flow, and
        news sentiment into one number from −100 to +100.
      </Body>
      <Body>
        Daily cadence so positioning can move with the data. Single composite (not parallel scoring
        systems) so there's no ambiguity about which signal wins.
      </Body>
    </>
  ),
  "ops-how": (
    <>
      <Body>
        Run the daily scan; results sort by composite score, highest first. Action labels are bands
        on that single score:
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Score</th>
          <th style={styles.th}>Action</th>
          <th style={styles.th}>Meaning</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}><Code>60+</Code></td><td style={styles.td}>BUY ZONE</td><td style={styles.td}>All four signal categories aligned bullish; high-conviction long.</td></tr>
          <tr><td style={styles.td}><Code>35–60</Code></td><td style={styles.td}>HOLD</td><td style={styles.td}>Healthy hold range; no immediate action.</td></tr>
          <tr><td style={styles.td}><Code>20–35</Code></td><td style={styles.td}>WATCH</td><td style={styles.td}>Signals weakening; pre-position trim.</td></tr>
          <tr><td style={styles.td}><Code>&lt; 20</Code></td><td style={styles.td}>REVIEW</td><td style={styles.td}>Sell-watch zone; review for harvest or rotate.</td></tr>
        </tbody>
      </table>
      <Body>
        Filter by sector or IG to align with Asset Tilt's overweights. Click any ticker to open the
        per-stock modal: signal-by-signal breakdown, recent earnings, options flow context, and the
        scanner's recommended position size.
      </Body>
    </>
  ),
  "ops-data": (
    <>
      <Body>
        Five live data streams power the daily scan:
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Stream</th>
          <th style={styles.th}>Provider</th>
          <th style={styles.th}>What it carries</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}>Universe + EOD prices</td><td style={styles.td}>Massive (Polygon Basic)</td><td style={styles.td}>~12,500 active US-listed tickers; OHLCV + corporate actions</td></tr>
          <tr><td style={styles.td}>Options flow + insider + congressional</td><td style={styles.td}>Unusual Whales API</td><td style={styles.td}>Block trades, dark pool, sweep volume, Form 4 insider, congressional disclosure</td></tr>
          <tr><td style={styles.td}>Fundamentals</td><td style={styles.td}>Yahoo Finance</td><td style={styles.td}>Forward P/E, revenue / EPS growth, profitability ratios</td></tr>
          <tr><td style={styles.td}>News sentiment</td><td style={styles.td}>ZeroHedge RSS + Premium</td><td style={styles.td}>Per-ticker headline sentiment, daily aggregation</td></tr>
          <tr><td style={styles.td}>Index membership</td><td style={styles.td}>Wikipedia · iShares</td><td style={styles.td}>S&P 500, NASDAQ-100, Russell 2000 membership flags</td></tr>
        </tbody>
      </table>
      <Body>
        The full daily scan runs at 15:45 ET (after market close) and writes to
        <Code>public/latest_scan_data.json</Code>. Each record carries the ticker, sector, IG,
        composite score, signal-by-signal sub-scores, action label, and the contributing data points.
      </Body>
    </>
  ),
  "ops-models": (
    <>
      <Body>
        The composite is the weighted sum of four sub-scores, each itself a 0-to-100 rollup. Weights
        are calibrated by backtesting historical Buy-zone alerts against forward 30-day returns
        (script: <Code>scripts/conviction-backtest.js</Code>).
      </Body>
      <Formula>{`composite = w_tech × technicals
          + w_fund × fundamentals
          + w_flow × flow
          + w_news × news_sentiment

scaled to [−100, +100], then banded as above.`}</Formula>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Technical sub-score</h4>
      <Body>
        Eight indicators: RSI, MACD, ADX, Bollinger Bands position, ATR(14), OBV, Stochastic K/D,
        Ichimoku cloud position. Each contributes a sign-and-strength reading; the sub-score is the
        weighted average. Math lives in <Code>trading-scanner/scanner/technicals.py</Code>.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Fundamental sub-score</h4>
      <Body>
        Forward P/E vs sector median, revenue growth (YoY), profitability (operating margin). Quality
        screen filters first (no negative earnings); then composite z-score across the three.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Flow sub-score</h4>
      <Body>
        Options flow (calls vs puts, 30d), dark pool volume %, insider buying (Form 4) within 90 days,
        congressional purchases within 90 days. Each contributes a directional vote; equally-weighted
        composite.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>News sentiment sub-score</h4>
      <Body>
        Daily ZeroHedge headline sentiment (positive / negative / neutral classification), 7-day
        rolling average per ticker. Provides the smallest weight in the composite — too noisy for
        primary signal use.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Calibration</h4>
      <Body>
        Conviction bands (LOW / NORMAL / ELEVATED / EXTREME) anchored against full 2006-01-03
        through 2026-04-22 composite history. Thresholds at p60 / p85 / p97.5 so 2008 GFC and
        2020 COVID sit in EXTREME, while 2022 bear and 2023 SVB sit in ELEVATED. Recalibrated
        2026-04-22 (PR #78).
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
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Label</th>
          <th style={styles.th}>When it shows</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}>BUY ZONE</td><td style={styles.td}>Scanner score 60+. Position aligned with the strongest current signal.</td></tr>
          <tr><td style={styles.td}>HOLD</td><td style={styles.td}>Scanner score 35–60. Healthy hold range.</td></tr>
          <tr><td style={styles.td}>WATCH</td><td style={styles.td}>Scanner score 20–35. Signals weakening.</td></tr>
          <tr><td style={styles.td}>REVIEW</td><td style={styles.td}>Scanner score &lt; 20. Sell-watch zone.</td></tr>
          <tr><td style={styles.td}>OUT OF SCOPE</td><td style={styles.td}>Position is in a sector the scanner doesn't evaluate (commodities, crypto, HY bond funds, broad international).</td></tr>
          <tr><td style={styles.td}>NO SIGNAL</td><td style={styles.td}>Ticker isn't in the daily scanned universe.</td></tr>
          <tr><td style={styles.td}>CORE</td><td style={styles.td}>Broad index fund (FXAIX, FSKAX, etc.). Not a tactical position.</td></tr>
          <tr><td style={styles.td}>MONITOR</td><td style={styles.td}>Position is in a non-tactical account (401k, plan-fund). Can't act on tactical signals here.</td></tr>
        </tbody>
      </table>
    </>
  ),
  "port-data": (
    <>
      <Body>
        Three streams come together:
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Stream</th>
          <th style={styles.th}>Source</th>
          <th style={styles.th}>What it carries</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}>Brokerage positions</td><td style={styles.td}>Plaid</td><td style={styles.td}>Per-account: tickers, share counts, market value, cost basis, account type</td></tr>
          <tr><td style={styles.td}>Scanner scores</td><td style={styles.td}><Code>latest_scan_data.json</Code></td><td style={styles.td}>Per-ticker composite score + signal-by-signal breakdown</td></tr>
          <tr><td style={styles.td}>Account metadata</td><td style={styles.td}>Local config</td><td style={styles.td}>Tactical / plan-fund / IRA flags per account</td></tr>
        </tbody>
      </table>
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
        Four constraints bind every allocation decision. They are enforced in the workflow itself
        (assertion failures halt the deploy), so they are guaranteed to hold in production rather
        than just promised in copy.
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Rule</th>
          <th style={styles.th}>Why it exists</th>
          <th style={styles.th}>Enforced where</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}><strong>Defensive ≤ 50%</strong></td><td style={styles.td}>Even in a maximum-stress regime, the engine never sells more than half the equity sleeve. Intent: stay invested through stress.</td><td style={styles.td}><Code>compute_v10_allocation.py</Code> + workflow audit</td></tr>
          <tr><td style={styles.td}><strong>Leverage ≤ 1.5×</strong></td><td style={styles.td}>The 1.5× ceiling is the only path to leverage above 1.25×, and it's reserved for V-bottom regime-flip events. No path to runaway leverage.</td><td style={styles.td}><Code>compute_v10_allocation.py</Code> + workflow audit</td></tr>
          <tr><td style={styles.td}><strong>Defensive XOR Leverage</strong></td><td style={styles.td}>Defensive sleeve and leverage are never on simultaneously. The two represent opposite tactical bets and the engine doesn't run them against each other.</td><td style={styles.td}><Code>compute_v10_allocation.py</Code> + workflow audit</td></tr>
          <tr><td style={styles.td}><strong>All 6 mechanisms present</strong></td><td style={styles.td}>If any of the six mechanism scores is missing, the allocator does not produce a recommendation. No partial input → partial output.</td><td style={styles.td}><Code>compute_v10_allocation.py</Code> + workflow audit</td></tr>
        </tbody>
      </table>
      <Callout>
        <strong>Why these rules are non-negotiable.</strong> The hard caps are not optimization
        constraints we accept reluctantly — they're the discipline that keeps the strategy
        inside reasonable risk bounds across every regime, including ones we haven't seen yet.
        Backtested-best-fit rules can drift in unfamiliar regimes; hard caps don't.
      </Callout>
    </>
  ),
  "backtest-content": (
    <>
      <Body>
        v10.1c (current production engine) is backtested against 2012-01 through 2026-03 (171
        months) using monthly rebalancing. Each historical month's allocation comes from running
        the v10.1c rules against the mechanism scores available at that point in time (no
        lookahead). Sector returns from yfinance for the eleven sector ETFs plus the four
        defensive ETFs (BIL / TLT / GLD / LQD). Numbers below are produced by
        <Code>scripts/backtest_v10_v11.py</Code> and refreshed in
        <Code>public/backtest_v10_v11_summary.json</Code>:
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Metric</th>
          <th style={styles.th}>v10.1c</th>
          <th style={styles.th}>SPY</th>
          <th style={styles.th}>v9 baseline (2008-2026)</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}>CAGR</td><td style={styles.td}><strong>13.89%</strong></td><td style={styles.td}>14.66%</td><td style={styles.td}>13.88%</td></tr>
          <tr><td style={styles.td}>Sharpe (annualized)</td><td style={styles.td}><strong>1.029</strong></td><td style={styles.td}>1.030</td><td style={styles.td}>0.610</td></tr>
          <tr><td style={styles.td}>Max drawdown</td><td style={styles.td}><strong>−21.36%</strong></td><td style={styles.td}>−23.97%</td><td style={styles.td}>−23.64%</td></tr>
          <tr><td style={styles.td}>Calendar wins vs SPY</td><td style={styles.td}>5 of 15</td><td style={styles.td}>—</td><td style={styles.td}>10 of 19</td></tr>
          <tr><td style={styles.td}>Months at 100% equity</td><td style={styles.td}>83%</td><td style={styles.td}>—</td><td style={styles.td}>—</td></tr>
        </tbody>
      </table>
      <Body>
        The v10.1c value proposition: about 70% better risk-adjusted return than v9 (Sharpe 1.029
        vs 0.610), nearly identical Sharpe to SPY (1.029 vs 1.030), and 2.6 percentage points
        smaller maximum drawdown than SPY (−21.36% vs −23.97%) — at the cost of about 80bp of
        annualized CAGR vs SPY. The strategy is doing what it's designed to do: take less risk per
        unit of return.
      </Body>
      <Body>
        v10.1c outperformed SPY in 5 of 15 calendar years; the standout was 2022 (+2.66pp vs SPY)
        — precisely the inflation / rates regime the engine is built for. The four other wins
        (2016, 2019, 2020, 2021) came from sector tilts firing correctly. The largest miss was
        2024 (−6.25pp vs SPY), where the tech underweight (correctly flagged by stretched
        Valuation) dragged in a tech-led bull market.
      </Body>
      <Callout>
        <strong>Honest gap.</strong> v10.1c has not been tested against 2008–2011 (the GFC and
        post-GFC recovery) because the indicator history file we backfill from starts in 2011.
        v9's edge in the 2008-2026 backtest came largely from its GFC handling. Until we backfill
        pre-2011 indicator data, the engine has not been stress-tested against a real systemic
        crisis. Rule discipline (the hard caps) is what protects against unfamiliar regimes in
        the meantime.
      </Callout>
      <Body>
        Full evidence pack: <Code>PHASE2_V10_BACKTEST.md</Code> in the project workspace. Every
        threshold in v10.1c was tuned against this backtest before being committed to code.
      </Body>
    </>
  ),
  "sources-content": (
    <>
      <Body>
        Every number on the site traces back to one of these public sources:
      </Body>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Source</th>
          <th style={styles.th}>Used for</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}>FRED (Federal Reserve Economic Data)</td><td style={styles.td}>Most macro indicators — Buffett Indicator inputs (NCBCEL/GDP), credit spreads (BAA, BAMLH0A0HYM2), CFNAI, jobless claims (IC4WSA), ANFCI, M2 YoY, Fed balance sheet, bank reserves, reverse repo balance, commercial paper risk premium, SLOOS C&I, St. Louis Fed FSI</td></tr>
          <tr><td style={styles.td}>ICE BofA via FRED</td><td style={styles.td}>HY OAS spread series</td></tr>
          <tr><td style={styles.td}>CBOE</td><td style={styles.td}>VIX, SKEW</td></tr>
          <tr><td style={styles.td}>ICE BofA</td><td style={styles.td}>MOVE Index (Treasury volatility)</td></tr>
          <tr><td style={styles.td}>Shiller / multpl</td><td style={styles.td}>CAPE (cyclically-adjusted P/E)</td></tr>
          <tr><td style={styles.td}>ISM (via FRED NAPMPI)</td><td style={styles.td}>Manufacturing PMI</td></tr>
          <tr><td style={styles.td}>Yahoo Finance</td><td style={styles.td}>BKX (banks index) and SPX for the BKX/SPX growth signal; stock fundamentals (forward P/E, revenue growth, profitability) for the Trading Opportunities scanner</td></tr>
          <tr><td style={styles.td}>Massive (Polygon Basic)</td><td style={styles.td}>Daily price data, universe master, dividends, splits</td></tr>
          <tr><td style={styles.td}>Unusual Whales</td><td style={styles.td}>Options flow, dark pool volume, Form 4 insider buying, congressional disclosure</td></tr>
          <tr><td style={styles.td}>ZeroHedge (RSS + Premium)</td><td style={styles.td}>News sentiment</td></tr>
          <tr><td style={styles.td}>Wikipedia · iShares</td><td style={styles.td}>Index membership flags (S&P 500, NASDAQ-100, Russell 2000)</td></tr>
          <tr><td style={styles.td}>Plaid</td><td style={styles.td}>Brokerage feed (read-only)</td></tr>
        </tbody>
      </table>
      <Body>
        Every data element is registered in <Code>public/data_manifest.json</Code> with cadence,
        freshness SLA, and consumer surfaces. The freshness chip system on every page reads from
        that manifest plus <Code>pipeline_health</Code> in Supabase to show green / amber / red
        per data flow.
      </Body>
    </>
  ),
  "glossary-content": (
    <>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Term</th>
          <th style={styles.th}>Definition</th>
        </tr></thead>
        <tbody>
          <tr><td style={styles.td}><Code>bp</Code> (basis points)</td><td style={styles.td}>One basis point = 0.01%. 100bp = 1%.</td></tr>
          <tr><td style={styles.td}>CAPE</td><td style={styles.td}>Cyclically-Adjusted P/E (Shiller). S&P 500 price divided by 10-year average inflation-adjusted earnings. Smooths earnings cycles.</td></tr>
          <tr><td style={styles.td}>Composite</td><td style={styles.td}>Page-level 0–100 score; the simple average of the six cycle mechanisms.</td></tr>
          <tr><td style={styles.td}>Cycle mechanism</td><td style={styles.td}>One of six categorical inputs to the cycle board: Valuation, Credit, Funding, Growth, Liquidity & Policy, Positioning & Breadth.</td></tr>
          <tr><td style={styles.td}>Defensive sleeve</td><td style={styles.td}>The four-bucket non-equity allocation: BIL (cash), TLT (long Treasuries), GLD (gold), LQD (IG corporate bonds).</td></tr>
          <tr><td style={styles.td}>ERP</td><td style={styles.td}>Equity Risk Premium = S&P 500 earnings yield minus 10-year Treasury yield. A near-zero or negative ERP means stocks are priced for perfection.</td></tr>
          <tr><td style={styles.td}>Gross exposure</td><td style={styles.td}>Total dollar exposure as % of capital. With leverage on, can exceed 100%; with defensive on, the equity slice falls below 100%.</td></tr>
          <tr><td style={styles.td}>HY OAS</td><td style={styles.td}>High-Yield Option-Adjusted Spread. Yield premium that junk bonds offer over Treasuries.</td></tr>
          <tr><td style={styles.td}>IG (Industry Group)</td><td style={styles.td}>GICS Industry Group, one classification level below Sector. The site uses 24 IGs across 11 sectors. Example: Semiconductors is an IG inside the Information Technology sector.</td></tr>
          <tr><td style={styles.td}>IG OAS</td><td style={styles.td}>Investment-Grade Option-Adjusted Spread. Yield premium that corporate bonds offer over Treasuries.</td></tr>
          <tr><td style={styles.td}>OW / MW / UW</td><td style={styles.td}>Overweight / Market-weight / Underweight. Refers to a sector or IG's allocation versus its SPY benchmark weight.</td></tr>
          <tr><td style={styles.td}>Percentile</td><td style={styles.td}>Where a current value sits in a historical sample. p100 = highest reading on record; p0 = lowest.</td></tr>
          <tr><td style={styles.td}>Sharpe ratio</td><td style={styles.td}>Annualized excess return divided by annualized volatility. Higher = better risk-adjusted return.</td></tr>
          <tr><td style={styles.td}>SLOOS</td><td style={styles.td}>Senior Loan Officer Opinion Survey. Federal Reserve quarterly survey of bank lending standards.</td></tr>
          <tr><td style={styles.td}>SPY</td><td style={styles.td}>SPDR S&P 500 ETF. The benchmark used for sector vs market relative weights.</td></tr>
          <tr><td style={styles.td}>Stress score</td><td style={styles.td}>A 0–6 count: number of stress-detection mechanisms (Credit, Liq&Pol, Pos&Br) in caution or risk-off bands, weighted (caution=+1, risk-off=+2).</td></tr>
        </tbody>
      </table>
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
          <strong style={{ color: "var(--text)" }}> Macro Overview</strong> describes where the cycle sits today.
          <strong style={{ color: "var(--text)" }}> Asset Tilt</strong> turns that into an explicit allocation recommendation
          across equity, defensive sleeve, leverage, sectors, and industry groups.
          <strong style={{ color: "var(--text)" }}> Trading Opportunities</strong> picks specific stocks within those.
          <strong style={{ color: "var(--text)" }}> Portfolio Insights</strong> connects all of it to your actual holdings.
        </p>
        <div style={{ marginTop: 18, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          <span>Last updated · 2026-05-04</span>
          <span>Calibration · v10.1c · Sprint 2 (2026-05-03)</span>
          <span>Backtest window · 2012-01 through 2026-03 (171 months)</span>
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
