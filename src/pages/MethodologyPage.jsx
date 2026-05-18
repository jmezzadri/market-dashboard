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
        Market regime drives every other decision on the site. Without a clean read of where the cycle
        sits, every allocation choice and every stock pick is a guess about the macro context. The Macro
        Overview answers one question: <strong>given everything we can measure, when do we de-risk?</strong>
      </Body>
      <Body>
        We do not predict tops. We do not call entries. We describe state. The MacroTilt engine is a
        forward-looking de-risking system — when bond-market volatility tells us the next drawdown is
        closer than the calm surface suggests, the engine reduces equity and rotates into a defensive
        sleeve tuned to the yield environment. Two axes, one equity-versus-defensive decision, validated
        on 1986–2026 data.
      </Body>
      <Callout>
        <strong>The engine read is descriptive, not prescriptive.</strong> A read of "Risk Off" does not
        mean "sell everything." It means "bond volatility is in the top fifteen percent of its trailing
        five years — the engine sits at 50 percent equity until the signal clears." What the
        recommendation actually translates into for sectors and industry groups lives one click away, in
        <em> Asset Tilt</em>.
      </Callout>
    </>
  ),
  "macro-how": (
    <>
      <Body>
        The Macro Overview page reads in two layers. The engine read sits at the top; a five-domain
        backdrop of 26 supporting indicators sits below.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Read the engine state first</h4>
      <Body>
        The header tile shows two pills. The left pill is the stress state — <strong>Risk On</strong>,
        <strong> Watch</strong>, or <strong>Risk Off</strong> — driven entirely by where bond volatility
        sits in its trailing five-year distribution. The right pill is the yield regime —
        <strong> Inflationary</strong>, <strong> Neutral</strong>, or <strong> Deflationary</strong> —
        driven by the trailing three-month change in the 10-year Treasury yield. Together they answer
        two questions: how much equity to hold, and what defensive sleeve to rotate into if the engine
        wants any defense at all.
      </Body>
      <DocsTable
        cols={["Stress state", "Trigger", "Equity / Defensive"]}
        rows={[
          ["Risk On",   "MOVE Index below the 75th percentile of its trailing 5y window.",  "100% equity / 0% defensive"],
          ["Watch",     "MOVE Index between the 75th and 85th percentile.",                  "80% equity / 20% defensive"],
          ["Risk Off",  "MOVE Index at or above the 85th percentile.",                       "50% equity / 50% defensive"],
        ]}
      />
      <DocsTable
        cols={["Yield regime", "Trigger", "What it means"]}
        rows={[
          ["Inflationary",  "3-month change in 10Y yield is in the top 30% of its trailing 5y window.",     "Yields rising fast. Defensive sleeve favors short-duration cash and gold; avoids long Treasuries."],
          ["Neutral",       "3-month change in 10Y yield sits between the 30th and 70th percentile.",        "No strong directional pressure. Defensive sleeve is balanced across cash, gold, and long Treasuries."],
          ["Deflationary",  "3-month change in 10Y yield is in the bottom 30% of its trailing 5y window.",   "Yields falling fast. Defensive sleeve leans into long Treasuries as a flight-to-quality hedge."],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Then scan the 26-indicator backdrop</h4>
      <Body>
        Below the engine read, five panels show the broader macro context: <strong>Rates</strong>,
        <strong> Credit</strong>, <strong> Equities</strong>, <strong> Money &amp; Banking</strong>, and
        <strong> Economy</strong>. Each panel holds five to seven indicator tiles arranged on a grid.
        Every tile has a Calm / Elevated / Stressed pill in the corner, a mini-chart, and a one-line
        plain-English reading. Click any tile for the full-history modal.
      </Body>
      <Body>
        The backdrop does not drive the engine — the engine's decision is the two pills at the top —
        but it gives context. If the engine is sitting at Risk On while the Credit panel is
        flashing red across the board, that is a signal worth looking at directly even though it
        hasn't crossed the bond-volatility threshold yet.
      </Body>
      <Body>
        Refresh cadence: the engine recomputes Friday after the US close (the rebalance signal is
        weekly). The supporting indicator panels refresh on each indicator's own release schedule —
        most are daily, a few are weekly or monthly.
      </Body>
    </>
  ),
  "macro-data": (
    <>
      <Body>
        The engine reads two market series. The 26-indicator backdrop reads from public sources across
        five domains. All series are listed in the project's data manifest with cadence, freshness
        SLA, and consumer surfaces.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Engine inputs (2 series)</h4>
      <DocsTable
        cols={["Input", "Source", "Cadence", "Sample"]}
        rows={[
          ["Bond volatility (MOVE Index)",          "ICE BofA · Yahoo ^MOVE",          "Daily after close",   "2002-11-12 to today (live engine); spliced standardized proxy 1986–2002 for validation only"],
          ["10-year Treasury yield (DGS10)",        "Federal Reserve H.15 · FRED",     "Daily after close",   "1986 to today"],
        ]}
      />
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>5-domain indicator backdrop (26 indicators)</h4>
      <DocsTable
        cols={["Domain", "Indicators"]}
        rows={[
          ["Rates",              "10Y Treasury yield, 2Y Treasury yield, 10y–2y curve, 10y–3m curve, real 10Y yield, 30Y mortgage rate, Effective Fed Funds rate"],
          ["Credit",             "High-yield OAS, investment-grade OAS, BAA–10Y spread, CCC OAS, NFCI financial-conditions index, ANFCI adjusted index"],
          ["Equities",           "S&P 500 trailing P/E, CAPE (Shiller P/E), Equity Risk Premium, Buffett indicator (US market cap / GDP), VIX, SKEW"],
          ["Money & Banking",    "M2 money supply growth, bank reserves, SLOOS C&I loan tightening, KBW Bank / S&P ratio"],
          ["Economy",            "Initial jobless claims (4-week avg), ISM Manufacturing PMI, Conference Board LEI"],
        ]}
      />
      <Body>
        The engine uses a <strong>trailing 5-year window</strong> for both percentile calculations —
        market volatility regimes drift over decades, so the 5-year window keeps the calibration honest
        as the trend evolves. The 26 backdrop indicators each carry their own percentile reference
        window documented on the per-indicator tile.
      </Body>
    </>
  ),
  "macro-models": (
    <>
      <Body>
        Two axes, two formulas, one allocation rule. The math is plain percentile thresholds. The non-obvious
        piece is the MOVE Index history — only published from 2002-11-12 onward — and what the engine does
        about that for backtesting. The full formulas live in <strong>Appendix B</strong>; the prose below
        describes what they do in plain English.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Axis 1 — Stress signal</h4>
      <Body>
        Every Friday after the US close, the engine takes the latest MOVE Index reading and asks:
        where does this sit in its trailing 5-year window? Below the 75th percentile is Risk On.
        Between the 75th and 85th is Watch. At or above the 85th is Risk Off. The thresholds are
        constants — they don't move with the regime, only the underlying 5-year window moves. A
        2009-style high-vol regime and a 2017-style low-vol regime each calibrate their own
        85th-percentile MOVE level against their own recent history.
      </Body>
      <Body>
        For backtesting before 2002, the engine uses a Z-standardized proxy built from the daily
        change in 10-year Treasury yields. The proxy is rescaled so that its mean and standard
        deviation match the actual MOVE Index over the first five years of MOVE history. This
        keeps the pre-2002 percentile thresholds on the same numerical scale as the post-2002
        actual readings, which is what the validation depends on. The live production engine
        never reads the proxy — it only reads actual MOVE values from 2002 onward.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Axis 2 — Yield direction filter</h4>
      <Body>
        Same trailing 5-year window, different signal. The engine takes the 3-month change in the
        10-year Treasury yield (today's yield minus the yield three months ago, in basis points) and
        asks: where does that change sit in its trailing 5-year distribution? Top 30 percent of the
        distribution is Inflationary (yields rising fast). Bottom 30 percent is Deflationary (yields
        falling fast). Anything in between is Neutral.
      </Body>
      <Body>
        Axis 2 does not change the stress-state decision — that is entirely Axis 1's job — but it
        selects which defensive sleeve gets used when the engine wants defense.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Defensive sleeve selection</h4>
      <DocsTable
        cols={["Yield regime", "Cash", "GLD (gold)", "SHY (short Treasuries)", "TLT (long Treasuries)"]}
        rows={[
          ["Inflationary",  "50%", "30%", "20%", "0%"],
          ["Deflationary",  "25%", "25%", "0%",  "50%"],
          ["Neutral",       "50%", "25%", "0%",  "25%"],
        ]}
      />
      <Body>
        The sleeve weights sum to 100 percent of the defensive bucket. If the stress state says 50
        percent defensive and the yield regime says Inflationary, the actual portfolio split is 50
        percent equity + 25 percent cash + 15 percent gold + 10 percent short Treasuries. The
        Inflationary sleeve deliberately holds no long Treasuries — they bleed value when yields are
        rising. The Deflationary sleeve leans into long Treasuries as a flight-to-quality hedge.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Refresh pipeline</h4>
      <Body>
        The engine recomputes Friday after the US close (the rebalance signal is weekly). The MOVE
        Index updates from Yahoo; the 10-year Treasury yield updates from FRED. The output is
        written to a snapshot file the rest of the site reads — Macro Overview displays the engine
        pills, Asset Tilt uses the equity-versus-defensive split before running the sector
        allocator, and the Home page tile mirrors the read.
      </Body>
    </>
  ),

  // ============================================================
  // §2 ASSET TILT
  // ============================================================
  "tilt-why": (
    <>
      <Body>
        Asset Tilt translates the engine read into a real portfolio. The engine produces the headline
        equity-versus-defensive split — 100/0, 80/20, or 50/50 — and Asset Tilt fills it in.
        Within the equity bucket, the v9 allocator distributes capital across 11 sectors and 24
        industry groups. Within the defensive bucket, the regime-dependent sleeve table from the
        engine spec sets the cash / gold / short-Treasury / long-Treasury mix.
      </Body>
      <Body>
        Two design principles. First, <strong>the engine's split is non-negotiable.</strong> If
        the engine says Risk Off, the page shows 50 percent in the defensive sleeve and 50 percent
        in the v9 sector allocator — the allocator does not get to override the engine. The engine's
        thresholds (75th / 85th percentile MOVE) are <strong>backtested over 1986–2026</strong>
        against actual market data; the validation is documented in Appendix B.
      </Body>
      <Body>
        Second, <strong>hard caps prevent any regime from blowing past prudent bounds</strong>:
      </Body>
      <ul style={{ ...styles.body, paddingLeft: 22 }}>
        <li style={styles.bullet}>Defensive sleeve never exceeds 50% of capital. The engine's Risk Off state is the cap.</li>
        <li style={styles.bullet}>Equity allocation never falls below 50%. Even in Risk Off the engine stays half-invested.</li>
        <li style={styles.bullet}>The v9 allocator only runs inside the equity bucket. It does not see the defensive sleeve.</li>
        <li style={styles.bullet}>Defensive sleeve composition is fully determined by the yield regime — no manual override.</li>
      </ul>
      <Body>
        These rules are constraints in the architecture, not assumptions about what's optimal.
        Within the constraints, the v9 sector allocator continues to do what it has always done:
        tilt sector and industry-group weights based on the macro state and the per-sector
        sensitivity coefficients.
      </Body>
    </>
  ),
  "tilt-how": (
    <>
      <Body>
        The page reads top-to-bottom in five blocks:
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>1. Engine header</h4>
      <Body>
        Two pills at the top of the page — the stress state (Risk On / Watch / Risk Off) and the
        yield regime (Inflationary / Neutral / Deflationary). These come straight from the engine
        snapshot and match what the Macro Overview page shows. The header also shows the headline
        equity-versus-defensive split that follows from the stress state.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>2. Defensive sleeve table</h4>
      <Body>
        Shown only when the engine wants defense (Watch or Risk Off). The four defensive buckets —
        cash, gold (GLD), short Treasuries (SHY), long Treasuries (TLT) — with their dollar weights
        for today's yield regime. In Risk On the sleeve is dormant and this block is hidden.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>3. v9 sector allocation</h4>
      <Body>
        Eleven GICS sectors plus 24 industry groups within them. Each row shows the sector name, ETF
        tickers (clickable for ETF detail), a visual bar, the dollar tilt scaled to the equity bucket
        (not total capital), and the rating plus delta versus SPY. Click any sector to expand its
        industry groups inline. Click any IG to see the constituent ETFs and stocks.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>4. Mechanism heatmap</h4>
      <Body>
        The v9 mechanism heatmap is preserved for sector-level diagnostic — six factor mechanisms
        across eleven sectors, each cell showing whether that mechanism is currently a tailwind
        (green) or headwind (red) for that sector. The math is the sector's historical sensitivity
        to the mechanism multiplied by today's mechanism score. The heatmap is informational; it
        does not drive the equity-versus-defensive split.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>5. Methodology footer</h4>
      <Body>
        One-line summary plus a link back to this page. The page refreshes after the engine snapshot
        writes — Friday after the US close for the engine, every weekday for the v9 sector
        sensitivities.
      </Body>
    </>
  ),
  "tilt-data": (
    <>
      <Body>
        Inputs live in three files:
      </Body>
      <DocsTable
        cols={["File", "What it carries", "Refreshed by"]}
        rows={[
          [
            <Code>cycle_board_snapshot.json</Code>,
            "Today's six mechanism scores (0–100 each)",
            <><Code>compute_v11_mechanisms.py</Code> · 22:30 UTC</>,
          ],
          [
            <Code>v10_allocation.json</Code>,
            "Allocator output: equity %, defensive %, leverage, 11 sector tilts, 24 IG tilts, contribution matrix",
            <><Code>compute_v10_allocation.py</Code> · 22:45 UTC</>,
          ],
          [
            <Code>methodology_calibration_v11.json</Code>,
            "Sprint 1 mechanism input panels with hand-curated percentiles + descriptions",
            "Manually updated when calibration windows change",
          ],
        ]}
      />
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
        Four constraints bind every allocation decision. They are enforced in the engine's compute
        script and in the v9 sector allocator's compute script — assertion failures halt the deploy,
        so the rules are guaranteed to hold in production rather than just promised in copy.
      </Body>
      <DocsTable
        cols={["Rule", "Why it exists", "Enforced where"]}
        rows={[
          [<strong>Defensive sleeve ≤ 50%</strong>,                "The engine's Risk Off state caps defensive allocation at 50%. Even in a maximum-stress regime, the engine never sells more than half the equity sleeve. Intent: stay invested through stress.",          "Engine compute script · workflow audit"],
          [<strong>Equity ≥ 50%</strong>,                          "The complement to the defensive cap — equity never drops below half of capital. Combined with the defensive cap, the portfolio is always at least 50/50 even in the deepest engine drawdown signal.",     "Engine compute script · workflow audit"],
          [<strong>Defensive sleeve is regime-dependent only</strong>,  "When defensive is active, the cash / gold / short-Treasury / long-Treasury weights come from the yield regime table — no manual override. This keeps the sleeve aligned with the rate environment.", "Engine compute script · workflow audit"],
          [<strong>v9 allocator runs inside equity only</strong>,       "The v9 sector allocator distributes capital within the equity bucket, scaled to the engine's equity percentage. The allocator never sees the defensive sleeve and does not affect the engine's split.",  "v9 compute script · workflow audit"],
        ]}
      />
      <Callout>
        <strong>Why these rules are non-negotiable.</strong> The hard caps are not optimization
        constraints we accept reluctantly — they're the discipline that keeps the strategy inside
        reasonable risk bounds across every regime, including ones we haven't seen yet. The 1986–2026
        validation tested the engine across eleven historical drawdowns; the hard caps are why even
        the worst-case episode (2008 GFC) shows a 35 percent drawdown for the engine versus 55 percent
        for SPY.
      </Callout>
    </>
  ),
  "backtest-content": (
    <>
      <Body>
        The MacroTilt 2-axis engine is validated over <strong>1986-01-01 through 2026-03-31</strong> —
        2,105 weeks of weekly rebalancing. Each historical week's allocation comes from running
        the locked engine rules against the data available at that point in time (no lookahead).
        Equity returns from SPY; defensive sleeve returns from BIL (cash proxy), GLD (gold), SHY
        (short Treasuries), and TLT (long Treasuries). Pre-2002 MOVE history is replaced with a
        Z-standardized proxy built from 21-day rolling standard deviation of daily 10-year Treasury
        yield changes, rescaled so its mean and standard deviation match the actual MOVE Index over
        2002–2007. The live production engine reads actual MOVE values only.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Headline metrics — 1986–2026</h4>
      <DocsTable
        cols={["Strategy", "$1 →", "CAGR", "Vol", "Sharpe", "Sortino", "Calmar", "Ulcer", "Max DD", "Worst calendar year"]}
        rows={[
          [<strong>MacroTilt 2-axis engine</strong>,  <strong>$89.57</strong>,  <strong>+11.74%</strong>,  <strong>14.4%</strong>,  <strong>0.61</strong>,  <strong>0.83</strong>,  <strong>0.34</strong>,  <strong>9.1%</strong>,   <strong>−35.0%</strong>,  <strong>2008 −15.5%</strong>],
          ["Buy-and-hold SPY",                       "$65.05",                  "+10.86%",                 "16.8%",                  "0.50",                  "0.64",                  "0.20",                  "13.9%",                  "−54.6%",                  "2008 −39.4%"],
          ["Always 1.5× SPY",                        "$159.76",                 "+13.35%",                 "25.2%",                  "0.49",                  "0.64",                  "0.19",                  "22.4%",                  "−71.9%",                  "2008 −55.7%"],
        ]}
      />
      <Body>
        The engine delivers <strong>+88 basis points of annualized return over SPY</strong> at
        <strong> 240 basis points lower volatility</strong>, which compounds to a 38 percent
        terminal-wealth advantage over 40 years ($89.57 versus $65.05 per dollar invested). The
        Sharpe ratio is 0.61 versus SPY's 0.50; the Sortino ratio (which only penalizes downside
        volatility) is 0.83 versus 0.64. Max drawdown is 35 percent versus SPY's 55 percent — the
        engine cut the worst-case loss almost in half. The 1.5× leveraged buy-and-hold comparison
        is included as a ceiling reference: it produces a higher CAGR but at a 0.49 Sharpe and a
        72 percent max drawdown — the engine beats it on every risk-adjusted measure.
      </Body>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Per-drawdown attribution</h4>
      <Body>
        Eleven SPY drawdowns of 10 percent or worse over 1986–2026. The "dominant yield regime"
        column shows which regime the engine was in for the majority of the drawdown weeks; the
        defensive sleeve composition follows from that regime.
      </Body>
      <DocsTable
        cols={["Episode", "SPY depth", "Dominant yield regime", "SPY", "Engine", "Difference", "What happened"]}
        rows={[
          ["1987 Black Monday",     "−33.3%",  "Inflationary (62% of weeks)",   "−33.0%",  "−31.8%",  "+1.1 pp",  "Engine caught the volatility crack late; partial defensive sleeve absorbed about a percentage point of the drop."],
          ["1990 Recession",        "−18.3%",  "Inflationary (50% of weeks)",   "−16.3%",  "−15.5%",  "+0.7 pp",  "Modest help. Short cash-heavy sleeve held duration risk down in a rising-rate environment."],
          ["1998 LTCM",             "−17.6%",  "Neutral (75% of weeks)",        "−16.1%",  "−16.1%",  "0.0 pp",   "Engine did not fire — vol was contained until it wasn't. Neutral sleeve when it did fire matched SPY's path."],
          ["1999 Y2K",              "−11.7%",  "Inflationary (57% of weeks)",   "−10.9%",  "−12.0%",  "−1.1 pp",  "Engine's only losing episode in the eleven. A short-lived vol spike fired the engine into Watch and the defensive sleeve trailed equity slightly."],
          ["2000 Dot-com",          "−45.7%",  "Deflationary (45% of weeks)",   "−43.3%",  "−31.9%",  "+11.3 pp", "Engine sat at Risk Off through the heart of the decline; the deflationary sleeve's 50% TLT allocation outperformed equity by ~13 percentage points."],
          ["2007 GFC",              "−54.6%",  "Deflationary (62% of weeks)",   "−54.5%",  "−30.7%",  "+23.8 pp", "The single largest contribution. Engine held cash + TLT through the deflationary regime; spared 23.8 percentage points versus SPY."],
          ["2015 China",            "−11.2%",  "Neutral (61% of weeks)",        "−9.0%",   "−9.0%",   "0.0 pp",   "Engine did not fire. Vol stayed below the 75th-percentile threshold throughout the episode."],
          ["2018 Q4",               "−17.1%",  "Inflationary (71% of weeks)",   "−16.4%",  "−16.4%",  "0.0 pp",   "Vol spiked late in the episode; the engine's signal arrived too late to help on the way down."],
          ["2020 COVID",            "−31.8%",  "Deflationary (100% of weeks)",  "−30.7%",  "−18.8%",  "+11.9 pp", "Engine fired into Risk Off in week one of the crash; deflationary sleeve's TLT-heavy mix dominated. The fastest and cleanest engine win in the sample."],
          ["2022 bear",             "−23.9%",  "Inflationary (78% of weeks)",   "−23.2%",  "−14.0%",  "+9.2 pp",  "Inflationary sleeve correctly avoided long Treasuries — they would have been the worst possible defensive asset in 2022's bond rout. Cash and gold carried the absolute return."],
          ["2025 spring",           "−16.9%",  "Neutral (62% of weeks)",        "−15.6%",  "−15.6%",  "0.0 pp",   "Engine did not fire — the drawdown unfolded inside the calm-vol regime."],
        ]}
      />
      <Body>
        Pattern: the engine adds value in <strong>deep drawdowns driven by bond-market stress</strong>
        (2000, 2007, 2020, 2022) and is approximately neutral in shallower drawdowns or those that
        unfold inside the calm-vol regime (1998, 2015, 2025). The yield-regime axis matters: in 2007
        and 2020 the deflationary sleeve's TLT-heavy mix did the heavy lifting; in 2022 the
        inflationary sleeve's TLT-free mix was what saved the strategy from a bond rout that would
        have crushed a generic 60/40 defensive sleeve.
      </Body>
      <Callout>
        <strong>Calibration discipline.</strong> The 75th / 85th / 70th / 30th percentile thresholds
        were the original spec, not tuned to the backtest. The defensive sleeve weights (50/30/20/0
        for Inflationary, 25/25/0/50 for Deflationary, 50/25/0/25 for Neutral) are the only
        parameters that were grid-searched against the backtest, and the search was constrained to
        round-number weights summing to 100. No threshold was optimized to lift any one drawdown's
        attribution number.
      </Callout>
      <h4 style={{ ...styles.subH3, fontSize: 15, marginTop: 18 }}>Splice continuity check</h4>
      <Body>
        Because the engine reads a different MOVE source pre- and post-2002-11-12, the splice point
        was checked directly. The 18 months before and 18 months after the splice show similar
        fire rates (53.8% versus 53.8%) and similar Risk-Off percentages (34.6% versus 7.7% — the
        post-splice window happens to be a calm period). The engine's behavior does not change
        meaningfully at the splice; the Z-standardization keeps the proxy and the actual on the
        same numerical scale.
      </Body>
      <Body>
        Full evidence pack: <Code>FINAL_LOCKED_ENGINE_2026-05-13.md</Code>,
        <Code> CANONICAL_DEEP_BACKTEST_2026-05-13.md</Code>, and the per-drawdown attribution CSV in
        the project workspace. Every threshold in the engine was locked against this validation
        before being committed to code.
      </Body>
    </>
  ),
  "sources-content": (
    <>
      <Body>
        Every number on the site traces back to one of these public vendors. The site shows
        "<Code>Vendor · As of [date]</Code>" on every data-driven surface; this list is the master.
      </Body>
      <DocsTable
        cols={["Vendor", "What it provides"]}
        rows={[
          ["Federal Reserve · FRED",         "10Y Treasury yield (DGS10), 2Y yield (DGS2), 10y–2y curve (T10Y2Y), 10y–3m curve (T10Y3M), Effective Fed Funds rate (DFF), 30Y mortgage rate, M2 money supply, bank reserves, SLOOS C&I loan tightening, ICE BofA credit spreads (BAMLH0A0HYM2 high-yield · BAMLC0A0CM investment-grade · BAMLH0A3HYC CCC), Chicago Fed financial conditions (NFCI · ANFCI), Initial Jobless Claims (IC4WSA), Conference Board LEI"],
          ["ICE BofA · Yahoo ^MOVE",         "MOVE Index (Treasury volatility) — the primary engine input"],
          ["CBOE",                           "VIX (equity volatility), SKEW (tail-risk skew)"],
          ["Shiller · multpl",               "CAPE (cyclically-adjusted P/E), S&P 500 trailing P/E"],
          ["ISM (via FRED NAPMPI)",          "Manufacturing PMI"],
          ["Yahoo Finance",                  "KBW Bank index for the KBW/SPX growth signal; stock fundamentals (forward P/E, revenue growth, profitability) for the Trading Opportunities scanner"],
          ["BEA",                            "US GDP for the Buffett indicator (US market cap / GDP)"],
          ["Polygon Massive",                "Daily equity prices for ~12,600 US-listed names, universe master, dividends, splits"],
          ["Unusual Whales",                 "Options flow, dark-pool volume, Form 4 insider buying, Congressional disclosure"],
          ["ZeroHedge (RSS + Premium)",      "News sentiment"],
          ["Wikipedia · iShares",            "Index membership flags (S&P 500, NASDAQ-100, Russell 2000)"],
          ["Plaid",                          "Brokerage feed (read-only)"],
        ]}
      />
      <Body>
        Every data element is registered in the project's data manifest with cadence, freshness SLA,
        and the surfaces that consume it. The freshness chip on each tile reads from that manifest
        plus the pipeline-health snapshot to show green (within SLA), amber (1–2× overdue), or red
        (3× overdue or upstream failure).
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
          ["Defensive sleeve",                  "The four-bucket non-equity allocation: cash, GLD (gold), SHY (short Treasuries), TLT (long Treasuries). Composition is fully determined by the yield regime."],
          ["Deflationary",                      "Yield regime where the 3-month change in the 10-year Treasury yield sits in the bottom 30% of its trailing 5-year window — i.e. yields are falling fast. Defensive sleeve leans into long Treasuries."],
          ["Engine read",                       "The two-pill output of the MacroTilt 2-axis engine: stress state (Risk On / Watch / Risk Off) and yield regime (Inflationary / Neutral / Deflationary)."],
          ["ERP",                               "Equity Risk Premium = S&P 500 earnings yield minus 10-year Treasury yield. A near-zero or negative ERP means stocks are priced for perfection."],
          ["HY OAS",                            "High-Yield Option-Adjusted Spread. Yield premium that junk bonds offer over Treasuries."],
          ["IG (Industry Group)",               "GICS Industry Group, one classification level below Sector. The site uses 24 IGs across 11 sectors. Example: Semiconductors is an IG inside Information Technology."],
          ["IG OAS",                            "Investment-Grade Option-Adjusted Spread. Yield premium that corporate bonds offer over Treasuries."],
          ["Inflationary",                      "Yield regime where the 3-month change in the 10-year Treasury yield sits in the top 30% of its trailing 5-year window — i.e. yields are rising fast. Defensive sleeve avoids long Treasuries."],
          ["MOVE Index",                        "ICE BofA's Treasury-market volatility index. The primary stress-signal input to the MacroTilt engine — analogous to VIX but for the bond market."],
          ["Neutral (yield)",                   "Yield regime where the 3-month change in the 10-year Treasury yield sits between the 30th and 70th percentile of its trailing 5-year window. Defensive sleeve is balanced."],
          ["OW / MW / UW",                      "Overweight / Market-weight / Underweight. Refers to a sector or IG's allocation versus its SPY benchmark weight."],
          ["Percentile",                        "Where a current value sits in a historical sample. p100 = highest reading on record; p0 = lowest. The engine uses trailing 5-year percentile for both axes."],
          ["Risk Off",                          "Stress state where the MOVE Index is at or above the 85th percentile of its trailing 5-year window. Engine allocates 50% equity / 50% defensive."],
          ["Risk On",                           "Stress state where the MOVE Index is below the 75th percentile of its trailing 5-year window. Engine allocates 100% equity / 0% defensive."],
          ["Sharpe ratio",                      "Annualized excess return divided by annualized volatility. Higher = better risk-adjusted return."],
          ["SLOOS",                             "Senior Loan Officer Opinion Survey. Federal Reserve quarterly survey of bank lending standards."],
          ["Sortino ratio",                     "Like Sharpe, but volatility is computed only over down-days. Higher = better at avoiding losses specifically."],
          ["Splice (MOVE)",                     "The transition from the pre-2002 Z-standardized proxy to the actual ICE BofA MOVE Index at 2002-11-12. Used only for backtesting; the live engine reads actual MOVE values only."],
          ["SPY",                               "SPDR S&P 500 ETF. The benchmark used for sector vs market relative weights and for the engine's headline comparison."],
          ["Stress state",                      "The Axis 1 output: Risk On / Watch / Risk Off, driven by where the MOVE Index sits in its trailing 5-year window."],
          ["Watch",                             "Stress state where the MOVE Index sits between the 75th and 85th percentile of its trailing 5-year window. Engine allocates 80% equity / 20% defensive."],
          ["Yield regime",                      "The Axis 2 output: Inflationary / Neutral / Deflationary, driven by the trailing 3-month change in the 10-year Treasury yield."],
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
