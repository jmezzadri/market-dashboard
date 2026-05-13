import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * MethodologyBody — full rebuild (2026-05-12).
 *
 * Two-column layout: sticky table of contents on the left, content on the
 * right. Five numbered sections (01 Macro Overview · 02 Asset Tilt · 03
 * Trading Opportunities · 04 Portfolio Insights · 05 Scenario Analysis),
 * each with the same four subsections — Why we built it · How to use it ·
 * Data behind it · Models & calcs.
 *
 * Source-of-truth:
 *   Risk_Off_Framework_Methodology.md  (Signal Intelligence spec)
 *   src/v2/pages/MacroOverviewPage.jsx  (the engine — Macro Overview section)
 *   Legacy src/pages/MethodologyPage.jsx (Asset Tilt / Trading Opps /
 *     Portfolio Insights subsections are lifted from the legacy file because
 *     those engines have not changed).
 */

// ─── styles ─────────────────────────────────────────────────────────────
const ST = {
  layout: { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 36, alignItems: 'start' },
  toc: {
    position: 'sticky', top: 24, padding: '8px 0 24px',
    fontSize: 13, fontFamily: 'inherit',
    maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
  },
  tocEyebrow: { fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-3, var(--text-muted, #5e5e63))', fontWeight: 600, marginBottom: 14 },
  tocSection: { marginBottom: 18 },
  tocSectionHead: {
    display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, alignItems: 'baseline',
    cursor: 'pointer', padding: '6px 0',
  },
  tocNum: { fontFamily: 'var(--font-display, Fraunces, serif)', fontWeight: 400, fontSize: 14, color: 'var(--ink-3, var(--text-muted, #5e5e63))', fontVariantNumeric: 'tabular-nums' },
  tocSectionLabel: { fontFamily: 'var(--font-display, Fraunces, serif)', fontWeight: 400, fontSize: 15, color: 'var(--ink-0, var(--text, #0e1115))', letterSpacing: '-0.005em' },
  tocBlurb: { fontSize: 11.5, color: 'var(--ink-3, var(--text-muted, #5e5e63))', marginLeft: 32, marginTop: 1, fontStyle: 'italic' },
  tocSubs: { listStyle: 'none', padding: 0, margin: '6px 0 0 32px' },
  tocSub: {
    fontSize: 12, color: 'var(--ink-2, var(--text, #2a2a2e))',
    padding: '4px 0', cursor: 'pointer',
    borderLeft: '2px solid transparent', paddingLeft: 10, marginLeft: -10,
  },
  tocSubActive: { color: 'var(--accent, #0071e3)', borderLeftColor: 'var(--accent, #0071e3)', fontWeight: 500 },
  content: { minWidth: 0 },
  section: { padding: '8px 0 32px', marginBottom: 24, scrollMarginTop: 24, borderBottom: '0.5px solid var(--line-1, var(--border, rgba(14,17,21,0.06)))' },
  sectionEyebrow: { fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent, #0071e3)', fontWeight: 600, marginBottom: 6 },
  sectionH2: { fontFamily: 'var(--font-display, Fraunces, serif)', fontSize: 32, fontWeight: 400, margin: '0 0 8px', letterSpacing: '-0.015em', lineHeight: 1.1, color: 'var(--ink-0, var(--text, #0e1115))' },
  sectionBlurb: { fontFamily: 'var(--font-display, Fraunces, serif)', fontSize: 17, fontStyle: 'italic', color: 'var(--ink-3, var(--text-muted, #5e5e63))', margin: '0 0 28px', lineHeight: 1.4 },
  subBlock: { padding: '8px 0', marginBottom: 14, scrollMarginTop: 24 },
  subH3: { fontFamily: 'var(--font-display, Fraunces, serif)', fontSize: 22, fontWeight: 400, margin: '24px 0 12px', letterSpacing: '-0.01em', lineHeight: 1.15, color: 'var(--ink-0, var(--text, #0e1115))' },
  subH4: { fontFamily: 'var(--font-display, Fraunces, serif)', fontSize: 16, fontWeight: 500, margin: '24px 0 8px', letterSpacing: '-0.005em', color: 'var(--ink-0, var(--text, #0e1115))' },
  body: { fontSize: 14.5, lineHeight: 1.65, color: 'var(--ink-1, var(--text, #2a2a2e))', margin: '0 0 12px' },
  callout: { background: 'var(--bg-2, var(--surface-2, #f4f5f7))', border: '0.5px solid var(--line-1, var(--border, rgba(0,0,0,0.10)))', borderRadius: 8, padding: '14px 16px', margin: '12px 0 16px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-1, var(--text, #2a2a2e))' },
  honestCallout: { background: 'rgba(0,113,227,0.06)', borderLeft: '3px solid var(--accent, #0071e3)', borderRadius: '0 6px 6px 0', padding: '14px 16px', margin: '18px 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-1, var(--text, #2a2a2e))' },
  formula: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, background: 'var(--bg-2, var(--surface-2, #f4f5f7))', padding: '12px 16px', borderRadius: 6, borderLeft: '3px solid var(--accent, #0071e3)', margin: '10px 0', whiteSpace: 'pre-wrap', lineHeight: 1.55, color: 'var(--ink-1, var(--text, #2a2a2e))' },
  inlineCode: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, background: 'var(--bg-2, var(--surface-2, #f4f5f7))', padding: '1px 6px', borderRadius: 3, color: 'var(--ink-0, var(--text, #0e1115))' },
  bullet: { margin: '8px 0', lineHeight: 1.6, fontSize: 14.5, color: 'var(--ink-1, var(--text, #2a2a2e))' },
  tableWrap: { margin: '14px 0 18px', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 },
  th: { textAlign: 'left', padding: '10px 12px 8px 0', borderBottom: '1px solid var(--ink-0, var(--text, #0e1115))', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3, var(--text-muted, #5e5e63))' },
  td: { padding: '10px 12px 10px 0', borderBottom: '0.5px dashed var(--line-1, var(--border, rgba(0,0,0,0.10)))', color: 'var(--ink-2, var(--text, #2a2a2e))', verticalAlign: 'top' },
};

// ─── helper components ─────────────────────────────────────────────────
function Code({ children }) { return <code style={ST.inlineCode}>{children}</code>; }
function Body({ children }) { return <p style={ST.body}>{children}</p>; }
function Formula({ children }) { return <div style={ST.formula}>{children}</div>; }
function Callout({ children }) { return <div style={ST.callout}>{children}</div>; }
function HonestCallout({ children }) { return <div style={ST.honestCallout}>{children}</div>; }
function DocsTable({ cols, rows }) {
  return (
    <div style={ST.tableWrap}>
      <table style={ST.table}>
        <thead><tr>{cols.map((c, i) => {
          const label = typeof c === 'string' ? c : c.label;
          const numeric = typeof c !== 'string' && c.numeric;
          return <th key={i} style={{ ...ST.th, textAlign: numeric ? 'right' : 'left' }}>{label}</th>;
        })}</tr></thead>
        <tbody>{rows.map((r, ri) => (
          <tr key={ri}>{r.map((cell, ci) => {
            const numeric = typeof cols[ci] !== 'string' && cols[ci].numeric;
            return <td key={ci} style={{ ...ST.td, textAlign: numeric ? 'right' : 'left', fontVariantNumeric: numeric ? 'tabular-nums' : 'normal' }}>{cell}</td>;
          })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ─── sections + subsections ─────────────────────────────────────────────
const SECTIONS = [
  {
    id: 'macro-overview', num: '01', title: 'Macro Overview',
    blurb: 'Where the cycle sits today.',
    sub: [
      { id: 'macro-why',    label: 'Why we built it' },
      { id: 'macro-how',    label: 'How to use it' },
      { id: 'macro-data',   label: 'Data behind it' },
      { id: 'macro-models', label: 'Models & calcs' },
    ],
  },
  {
    id: 'asset-tilt', num: '02', title: 'Asset Tilt',
    blurb: 'Where the cycle says to lean.',
    sub: [
      { id: 'tilt-why',    label: 'Why we built it' },
      { id: 'tilt-how',    label: 'How to use it' },
      { id: 'tilt-data',   label: 'Data behind it' },
      { id: 'tilt-models', label: 'Models & calcs' },
    ],
  },
  {
    id: 'trading-opps', num: '03', title: 'Trading Opportunities',
    blurb: 'What to act on today.',
    sub: [
      { id: 'ops-why',    label: 'Why we built it' },
      { id: 'ops-how',    label: 'How to use it' },
      { id: 'ops-data',   label: 'Data behind it' },
      { id: 'ops-models', label: 'Models & calcs' },
    ],
  },
  {
    id: 'portfolio-insights', num: '04', title: 'Portfolio Insights',
    blurb: 'How your actual book is positioned.',
    sub: [
      { id: 'port-why',    label: 'Why we built it' },
      { id: 'port-how',    label: 'How to use it' },
      { id: 'port-data',   label: 'Data behind it' },
      { id: 'port-models', label: 'Models & calcs' },
    ],
  },
  {
    id: 'scenarios', num: '05', title: 'Scenario Analysis',
    blurb: 'How your portfolio reacts under stress.',
    sub: [
      { id: 'sc-why',    label: 'Why we built it' },
      { id: 'sc-how',    label: 'How to use it' },
      { id: 'sc-data',   label: 'Data behind it' },
      { id: 'sc-models', label: 'Models & calcs' },
    ],
  },
];

// ─── content per subsection ─────────────────────────────────────────────
const SECTION_CONTENT = {

  // ============================================================
  // §1 MACRO OVERVIEW — Signal Intelligence framework
  // ============================================================
  'macro-why': (
    <>
      <Body>
        Market regime drives every other decision on the site. Without a clean read of where the cycle
        sits, every allocation choice and every stock pick is a guess about the macro context. The
        Macro Overview answers one question: <strong>given everything we can measure, when do we take risk off?</strong>
      </Body>
      <Body>
        We do not predict tops. We do not call entries. We describe state. The framework is a
        forward-looking sell-warning system — when do the conditions look like a meaningful drawdown
        is closer than the calm surface suggests.
      </Body>
      <Callout>
        <strong>The regime label is descriptive, not prescriptive.</strong> A read of "Risk Off" does
        not mean "sell everything." It means "vol has cracked while the cycle still looks calm — that
        is the leading edge, act on your own risk tolerance." What to do about it lives one click
        away, in <em>Asset Tilt</em>.
      </Callout>
    </>
  ),
  'macro-how': (
    <>
      <Body>
        The page reads in two layers and rolls up to a single four-state label.
      </Body>
      <h4 style={ST.subH4}>Read the regime label first</h4>
      <Body>
        The right-rail Regime tile shows one of four labels: <strong>Risk On</strong> ·{' '}
        <strong>Neutral</strong> · <strong>Cautionary</strong> · <strong>Risk Off</strong>. The current
        state has the colored pill; the other three are dimmed. The descriptions tell you what each
        state means.
      </Body>
      <DocsTable
        cols={['State', 'Definition', 'What it means']}
        rows={[
          ['Risk On',     'No volatility trigger above its 85th-percentile level.', 'Vol is calm. Fully-invested default. No action.'],
          ['Neutral',     'Exactly one trigger crossed for exactly one week.',       'Roughly one-in-four single-week crosses are head-fakes. Note it. Do not act yet.'],
          ['Cautionary',  'A trigger has held above for 2+ weeks AND the cycle composite is at 40 or above.', 'Vol is real but the cycle has either started to confirm or already broken — past the forward-looking signal point.'],
          ['Risk Off',    'A trigger has held above for 2+ weeks AND the cycle composite is below 40.', 'Vol cracked while the cycle still looks fine. The actionable late-cycle setup — broad confirmation is most likely to follow.'],
        ]}
      />
      <h4 style={ST.subH4}>Layer 1 — three volatility triggers</h4>
      <Body>
        Three dials at the top of the page: Equity Volatility · Bond Volatility · Funding Stress.
        Each one has its own mark — the trailing-5y 85th-percentile level. The arrow on the dial
        shows where today sits relative to that level. Each dial also carries a five-stage progression
        (Calm → Watching → Holding → Confirmed → Entrenched) based on how many consecutive weeks the
        reading has stayed above its mark.
      </Body>
      <h4 style={ST.subH4}>Layer 2 — cycle composite</h4>
      <Body>
        Below the three triggers, a single 0-to-100 score plus the seven indicators that feed it. The
        composite is the simple average of seven stress-direction percentile ranks. Higher means more
        stress. The score is bucketed into five 20-point bands so you can read the cycle position at a
        glance.
      </Body>
    </>
  ),
  'macro-data': (
    <>
      <Body>
        Two layers, ten indicators total. All from public sources.
      </Body>
      <h4 style={ST.subH4}>Layer 1 — three volatility triggers</h4>
      <DocsTable
        cols={['Trigger', 'Source', 'Cadence', 'Sample']}
        rows={[
          ['Equity Volatility (VIX)',         'CBOE direct feed',                  'Daily, real-time',  '1996 to today'],
          ['Bond Volatility (MOVE Index)',    'ICE BofA via FRED',                 'Daily after close',  '2002 to today'],
          ['Funding Stress (CPFF spread)',    'Federal Reserve H.15 · FRED CPFF',  'Weekly · Wed',       '2006 to today (TED proxy pre-2006)'],
        ]}
      />
      <h4 style={ST.subH4}>Layer 2 — seven cycle composite indicators</h4>
      <DocsTable
        cols={['Indicator', 'Direction', 'Source', 'Sample']}
        rows={[
          ['Copper / Gold ratio',                'Low = stress (flipped)',  'Yahoo · CME front-month futures',     '2000 to today'],
          ['KBW Bank / S&P ratio',               'Low = stress (flipped)',  'NASDAQ KBW BKX index',                '1993 to today'],
          ['Yield curve (10y − 2y)',             'Low = stress (flipped)',  'Federal Reserve H.15 · FRED T10Y2Y',  '1976 to today'],
          ['Chicago Fed financial conditions',   'High = stress',           'Chicago Fed · FRED ANFCI',            '1971 to today'],
          ['Initial jobless claims (4-week avg)', 'High = stress',          'US DOL · FRED IC4WSA',                '1967 to today'],
          ['High-Yield credit spread',           'High = stress',           'ICE BofA · FRED BAMLH0A0HYM2',        '2011 to today (BAA-AAA proxy pre-2011)'],
          ['Investment-Grade credit spread',     'High = stress',           'ICE BofA · FRED BAMLC0A0CM',          '2006 to today (BAA10Y proxy pre-2006)'],
        ]}
      />
      <Body>
        Pre-2002 history runs on the reduced 2-anchor stack because public Bond Volatility data is
        only available from 2002. Pre-2011 high-yield and investment-grade spreads use proxy series
        (BAA-AAA and BAA10Y respectively); correlations to the native series during the overlap window
        are 0.87 and 0.98.
      </Body>
    </>
  ),
  'macro-models': (
    <>
      <Body>
        The framework is two layers plus a regime classifier.
      </Body>
      <h4 style={ST.subH4}>Layer 1 — trigger mark, stage, and progression</h4>
      <Body>
        Each trigger has a mark — the trailing-5y 85th-percentile level of its own values. The mark
        is recomputed every weekday at 7 AM ET against the new five-year window. As markets evolve
        the mark drifts; today's 2009-style high-vol regime and a 2017-style low-vol regime each get
        their own calibrated mark.
      </Body>
      <Formula>{`mark_i = quantile_85( trigger_i.values[last 5 years] )

if trigger_i.current >= mark_i:
   consecutive_weeks_above += 1
else:
   consecutive_weeks_above = 0

stage = 0  (Calm)       if weeks_above == 0
        1  (Watching)   if weeks_above == 1
        2  (Holding)    if 2 <= weeks_above <= 3
        3  (Confirmed)  if 4 <= weeks_above <= 7
        4  (Entrenched) if weeks_above >= 8`}</Formula>

      <h4 style={ST.subH4}>Layer 2 — cycle composite</h4>
      <Body>
        Each cycle indicator is ranked against its own <strong>full history</strong>. The longest
        series (Initial Jobless Claims) runs back to 1967; the shortest (Copper/Gold) back to 2000.
        Full history because macro indicators have decades of cycle structure to anchor against —
        unlike vol triggers, whose market regime drifts, so they use a rolling 5-year window.
      </Body>
      <Formula>{`for each cycle indicator i:
   raw_pct = percentile_rank( indicator_i.current, indicator_i.history )
   if indicator_i.bearish_direction == "low":  stress_pct = 100 - raw_pct
   else:                                       stress_pct = raw_pct

cycle_composite = round( mean(stress_pct over all 7 indicators) )    # in [0, 100]

band = "0–20 deepest calm"      if cycle_composite <  20
       "20–40 calm / late-cycle" if cycle_composite < 40
       "40–60 middle"             if cycle_composite < 60
       "60–80 broad stress"       if cycle_composite < 80
       "80–100 macro stress"      otherwise`}</Formula>

      <h4 style={ST.subH4}>Regime classifier</h4>
      <Formula>{`max_stage = max( stage over all 3 triggers )
sum_at_stage_1 = count( triggers with stage == 1 )

if max_stage == 0:                                    regime = "Risk On"
elif max_stage == 1 and sum_at_stage_1 == 1:          regime = "Neutral"
elif max_stage >= 2 and cycle_composite < 40:         regime = "Risk Off"
elif max_stage >= 2:                                  regime = "Cautionary"`}</Formula>
      <Body>
        The classifier favors the actionable Risk Off label only when vol has cracked AND the cycle
        composite is still low — that is the late-cycle setup the framework is calibrated for.
        Sustained vol with a stressed cycle composite reads Cautionary instead, because the
        forward-looking edge has already been priced in.
      </Body>
      <h4 style={ST.subH4}>Refresh pipeline</h4>
      <Body>
        Triggers refresh after the US close (or after their underlying release for CPFF). The cycle
        composite recomputes once any of its seven indicators updates. The regime classifier runs on
        every change and writes a snapshot file the rest of the site reads.
      </Body>
    </>
  ),

  // ============================================================
  // §2 ASSET TILT
  // ============================================================
  'tilt-why': (
    <>
      <Body>
        The macro state is useless if it doesn't translate into portfolio actions. The Asset Tilt page
        does that translation: given today's regime read, it produces an explicit allocation
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
      <ul style={{ paddingLeft: 22, margin: '8px 0 12px' }}>
        <li style={ST.bullet}>Defensive sleeve never exceeds 50% of capital, even in a maximum-stress regime.</li>
        <li style={ST.bullet}>Leverage never exceeds 1.5×.</li>
        <li style={ST.bullet}>Defensive and leverage are never on at the same time. If the engine wants any defensive sleeve, leverage drops to 1.0×.</li>
        <li style={ST.bullet}>All input mechanisms feed every decision. No single point of failure in the input layer.</li>
      </ul>
    </>
  ),
  'tilt-how': (
    <>
      <Body>
        The page reads top-to-bottom in five blocks.
      </Body>
      <h4 style={ST.subH4}>1. Hero & KPI strip</h4>
      <Body>
        Page-level stance pill plus five KPIs: Equity %, Defensive %, Leverage, stress score, gross
        exposure. The headline copy describes the regime in one sentence — and only claims defensive
        activation when defensive % is actually positive.
      </Body>
      <h4 style={ST.subH4}>2. Cycle inputs strip</h4>
      <Body>
        The same cycle inputs from Macro Overview, repeated here as a quick-glance reference for
        what's driving today's allocation. Each card is clickable to see the inputs that drove its
        state.
      </Body>
      <h4 style={ST.subH4}>3. Recommended Asset Tilt table</h4>
      <Body>
        Eleven sectors plus four defensive buckets. Each row shows the sector name, ETF tickers
        (clickable for ETF detail), a visual bar, the dollar tilt (leverage-adjusted; per $100 of
        capital), and the rating + delta vs SPY. Click any sector to expand its industry groups
        inline. Click any IG to see the constituent ETFs and stocks.
      </Body>
      <h4 style={ST.subH4}>4. Mechanism heatmap</h4>
      <Body>
        Cycle mechanisms × eleven sectors. Each cell shows whether that mechanism is currently a
        tailwind (positive) or headwind (negative) for that sector. The math is the sector's
        historical sensitivity to the mechanism multiplied by today's mechanism score.
      </Body>
      <h4 style={ST.subH4}>5. Methodology footer</h4>
      <Body>
        One-line summary of the calibration plus a link to this page. The page refreshes nightly,
        shortly after the Macro Overview snapshot.
      </Body>
    </>
  ),
  'tilt-data': (
    <>
      <Body>
        Inputs live in three places:
      </Body>
      <DocsTable
        cols={['Input', 'What it carries', 'Refreshed by']}
        rows={[
          ['Cycle snapshot',          'Today\'s regime read + the underlying mechanism scores', 'The Macro Overview pipeline, nightly'],
          ['Allocator output',        'Equity %, defensive %, leverage, 11 sector tilts, 24 industry-group tilts, contribution matrix', 'The allocator script, nightly after the cycle snapshot'],
          ['Calibration constants',   'Per-sector and per-IG sensitivity coefficients, hard caps, threshold values', 'Manually updated when calibration windows change'],
        ]}
      />
      <Body>
        Per-sector and per-IG sensitivities are baked into the allocator as constants. Each sector
        has a small set of sensitivity coefficients — one per mechanism — anchored on per-sector
        regression studies. Each industry group inherits its parent sector's sensitivities plus
        IG-specific adjustments (e.g. Semiconductors carries an extra negative sensitivity to growth
        and positioning on top of the Tech-sector base).
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
  'tilt-models': (
    <>
      <Body>
        The allocator runs in five deterministic steps. The rules are versioned in the script.
      </Body>
      <h4 style={ST.subH4}>Step 1 — Stress score</h4>
      <Body>
        The stress score is a weighted count of how many stress-detection mechanisms are flagging
        concern. The three are Credit, Liquidity &amp; Policy, and Positioning &amp; Breadth — chosen
        because together they cover credit-side contagion (Credit), policy/liquidity reversals
        (Liq&amp;Pol), and crowd / sentiment dynamics (Pos&amp;Br).
      </Body>
      <Formula>{`for each of [Credit, Liq&Pol, Pos&Br]:
   if mechanism band == "Caution"  →  +1
   if mechanism band == "Risk Off" →  +2

stress_score ∈ [0, 6]`}</Formula>
      <h4 style={ST.subH4}>Step 2 — Equity vs Defensive split</h4>
      <Formula>{`if stress_score < 4:    defensive_pct = 0%
else:                   defensive_pct = (stress_score - 3) × 20%, capped at 50%

equity_pct = 1 - defensive_pct`}</Formula>
      <Body>
        The intent: <em>most of the time at 100% equity</em>. The threshold 4 means the engine only
        activates defensive when stress is severe. In the 2012-2026 calibration window, this rule kept
        the allocator at 100% equity 88% of the time.
      </Body>
      <h4 style={ST.subH4}>Step 3 — Leverage</h4>
      <Formula>{`if defensive_pct > 0:                                     leverage = 1.0×    (XOR rule)
elif all mechanisms in {Risk On, Neutral}:               leverage = 1.25×
else:                                                     leverage = 1.0×

(future: V-bottom regime-flip detection unlocks up to 1.5×)`}</Formula>
      <h4 style={ST.subH4}>Step 4 — Per-sector tilt</h4>
      <Formula>{`for each sector:
   tilt_score = Σᵢ (sensitivityᵢ × normalized_scoreᵢ)
       where normalized_scoreᵢ = (mechanism_scoreᵢ - 50) / 50  ∈ [-1, +1]

   if tilt_score > +0.3:  rating = OW, multiplier = 1.20× SPY weight
   if tilt_score < -0.3:  rating = UW, multiplier = 0.75× SPY weight
   else:                   rating = MW, multiplier = 1.00× SPY weight

equity dollars = SPY_weight × multiplier  (renormalized so total = equity_pct × $100)`}</Formula>
      <h4 style={ST.subH4}>Step 5 — Per-industry-group tilt</h4>
      <Formula>{`for each industry group:
   ig_sensitivity = parent_sector_sensitivity + ig_specific_adjustment
   tilt_score, rating same logic as sector
   ig dollars renormalized so each sector's IGs sum back to its sector total`}</Formula>
      <h4 style={ST.subH4}>Audit checks (every refresh)</h4>
      <Body>
        Before the allocation file is committed, four assertions run:
      </Body>
      <ul style={{ paddingLeft: 22, margin: '8px 0 12px' }}>
        <li style={ST.bullet}><Code>defensive_pct ≤ 50%</Code></li>
        <li style={ST.bullet}><Code>leverage ≤ 1.5×</Code></li>
        <li style={ST.bullet}><Code>NOT (defensive_pct &gt; 0 AND leverage &gt; 1.0×)</Code></li>
        <li style={ST.bullet}><Code>all mechanisms present in input</Code></li>
      </ul>
      <Body>
        Any assertion failure halts the pipeline and the page keeps the last-known-good allocation.
        No partial or inconsistent allocations ship.
      </Body>
      <HonestCallout>
        <strong>Honest status today.</strong> The Asset Tilt engine was built and back-tested against
        an older cycle-mechanism framework that Signal Intelligence replaced on Macro Overview.
        The recommendations on Asset Tilt today are still produced by that older engine. Recalibrating
        against Signal Intelligence is multi-week work — it sits on the active punch list, scoped for
        the Senior Quant. Until the recalibration lands and is back-tested, treat the Asset Tilt
        numbers as a v1 recommendation, not a Signal-Intelligence-anchored one.
      </HonestCallout>
    </>
  ),

  // ============================================================
  // §3 TRADING OPPORTUNITIES — lifted from legacy, current engine
  // ============================================================
  'ops-why': (
    <>
      <Body>
        Asset Tilt tells you which sectors and industry groups to lean into. Trading Opportunities
        goes one level finer: <strong>which specific stocks within those</strong>. The page scores
        every US-listed stock over $300 million in market cap, daily, across six independent signals
        — and blends them into a single MacroTilt Score from −100 to +100.
      </Body>
      <Body>
        Positive scores mean the signals lean bullish. Negative scores mean they lean bearish. Cutoffs
        at −50, −20, +20, and +50 sort every name into one of five bands — Strong Sell, Watch Sell,
        Neutral, Watch Buy, Strong Buy. The page works as a top-to-bottom ranking of the entire market
        every trading day.
      </Body>
    </>
  ),
  'ops-how': (
    <>
      <Body>
        Open the page. The funnel card on the right shows how the full equity universe collapses to
        today's universe, what signal coverage looks like, and the count in each of the five bands.
        The table below ranks every scored name. Filter chips at the top let you focus on a single
        band or your held names.
      </Body>
      <Body>Action bands on the MacroTilt Score:</Body>
      <DocsTable
        cols={['Score', 'Band', 'What it means']}
        rows={[
          [<Code>+50 to +100</Code>,  'Strong Buy',  'Multiple bullish signals firing strongly. Highest conviction on the buy side.'],
          [<Code>+20 to +50</Code>,   'Watch Buy',   'Tilting bullish on one or two signals. Smaller position size or wait for confirmation.'],
          [<Code>−20 to +20</Code>,   'Neutral',     'Signals are mixed or quiet. No clear directional read.'],
          [<Code>−50 to −20</Code>,   'Watch Sell',  'Tilting bearish on one or two signals. Watch list for trim or hedge.'],
          [<Code>−100 to −50</Code>,  'Strong Sell', 'Multiple bearish signals firing strongly. Highest conviction on the sell side.'],
        ]}
      />
      <Body>
        Every name in the universe is shown. There is no upper cap ceiling: NVDA, AAPL, GOOGL, KO —
        all scored, all visible. The same six signals run on every name. The only difference at the
        largest end of the cap range is that the insider weight is shrunk (see "Cap-aware insider
        weight" in Models &amp; calcs).
      </Body>
    </>
  ),
  'ops-data': (
    <>
      <Body>The pipeline is built on six independent data streams plus a universe definition.</Body>
      <DocsTable
        cols={['Stream', 'Provider', 'What it carries']}
        rows={[
          ['Universe + reference',  'Polygon Massive',              'Every US-listed Common Stock + ADR with market cap at least $300 million and last close above $5. About 3,300 names.'],
          ['EOD prices + volume',   'Polygon Massive',              'OHLCV for all names; feeds the technicals signal (Bollinger BandWidth, RSI, 50-day moving average, relative volume).'],
          ['Insider buys + sells',  'Unusual Whales (SEC Form 4)',  'Open-market purchases and sales by officers and directors. Tax-withholding, RSU grants, and option exercises filtered out.'],
          ['Options flow',          'Unusual Whales',               'Daily call and put volume vs open interest; flags unusual activity.'],
          ['Congress trades',       'Quiver Quant',                 'Disclosed buy and sell trades by US senators and representatives.'],
          ['Analyst actions',       'Unusual Whales',               'Wall Street equity research: upgrades, downgrades, price target changes, initiations.'],
          ['Short interest',        'FINRA short interest report',  'Bi-monthly short interest as percent of float, plus day-to-cover.'],
        ]}
      />
      <Body>
        The nightly scan runs after the close and writes one row per (ticker, scan_date) to the
        signal-scoring table. Each row carries the MacroTilt Score, the band, all six sub-scores, the
        weights actually applied (after the cap-aware insider adjustment), and a plain-English summary.
      </Body>
    </>
  ),
  'ops-models': (
    <>
      <h4 style={ST.subH4}>Universe</h4>
      <Body>
        Every US-listed Common Stock + ADR with market cap at least $300 million and last close above
        $5. About 3,300 names. No upper cap ceiling. The $300 million floor drops micro-caps where
        execution risk dominates; the $5 close filter drops penny names.
      </Body>
      <h4 style={ST.subH4}>The six signals</h4>
      <Body>
        Each signal returns a sub-score from −100 to +100. Strong bullish reads (around +50 or higher)
        and strong bearish reads (around −50 or lower) are the actionable extremes.
      </Body>
      <DocsTable
        cols={['Signal', 'What it reads']}
        rows={[
          ['Insider buying',  'Open-market Form 4 buys and sells by company officers and directors. Cap-normalized so a $1 million buy reads the same way at every company size. First-buy refinement: bonus for buyers with no prior purchase in the previous twelve months.'],
          ['Options flow',    'Unusual call and put volume vs open interest. Persistent call-side imbalance is bullish, persistent put-side imbalance is bearish.'],
          ['Congress trades', 'Recent disclosed buys and sells by US senators and representatives. Buying tilts bullish, selling tilts bearish.'],
          ['Technicals',      '20-day Bollinger BandWidth, 14-day RSI, distance from the 50-day moving average, relative volume. Reads "tape strength" without leaning on any single indicator.'],
          ['Analyst actions', 'Recent Wall Street research changes: upgrades, downgrades, price target moves, initiations.'],
          ['Short interest',  'Short interest as percent of float, plus week-over-week direction. Rising short interest is mildly bearish; falling short interest from elevated levels can be bullish (squeeze setup).'],
        ]}
      />
      <h4 style={ST.subH4}>The MacroTilt Score (calibrated weights)</h4>
      <Body>
        The composite is a weighted average of the six sub-scores. Weights were fit on a 12-month
        walk-forward backtest (52 weekly Mondays, May 2025 through May 2026) using realized 21-day
        forward returns as the truth signal. Signals with insufficient historical data sit at the
        equal-weight floor (one-sixth) until the data layer is backfilled.
      </Body>
      <DocsTable
        cols={['Signal', { label: 'Weight', numeric: true }, 'Calibration status']}
        rows={[
          ['Insider buying',  <strong>36.30%</strong>, 'Calibrated. Highest alpha in backtest (+7.18 pp vs SPY when strong, 61% hit rate).'],
          ['Options flow',    '16.67%',                'Equal-weight floor. Full history backfill in progress.'],
          ['Congress trades', '16.67%',                'Equal-weight floor. Thin history (only 13 strong-signal events across backtest year).'],
          ['Technicals',      <strong>8.69%</strong>,  'Calibrated. Reliable mid-tier (+3.42 pp alpha when strong, 56% hit rate).'],
          ['Analyst actions', <strong>5.00%</strong>,  'Calibrated. Broad coverage; the lowest alpha among signals we could fit (+1.65 pp).'],
          ['Short interest',  '16.67%',                'Equal-weight floor. Sparse coverage (93 tickers historically).'],
          [<strong>Total</strong>, <strong>100.00%</strong>, ''],
        ]}
      />
      <h4 style={ST.subH4}>Cap-aware insider weight</h4>
      <Body>
        Only the insider signal is haircut by market cap. A $1 million open-market purchase by a
        director is meaningful at a $500 million company. The same purchase at a $500 billion mega-cap
        is rounding error. The weight on the insider signal shrinks as market cap grows; the freed
        weight is redistributed pro-rata across the other five signals so the total still sums to 100%.
      </Body>
      <DocsTable
        cols={['Market cap', { label: 'Insider weight factor', numeric: true }, { label: 'Effective insider weight', numeric: true }]}
        rows={[
          ['$500 million or less', '1.00', '36.3%'],
          ['$5 billion',           '0.75', '27.2%'],
          ['$50 billion',          '0.50', '18.2%'],
          ['$500 billion or more', '0.25', '9.1%'],
        ]}
      />
      <h4 style={ST.subH4}>Backtest results</h4>
      <Body>
        12-month walk-forward, 52 weekly Mondays from 2025-05-12 through 2026-05-04. Universe sized at
        about 2,800 names per scan date. Forward return is realized close-to-close, 21 trading days
        forward.
      </Body>
      <DocsTable
        cols={['Band', { label: 'Mean 21-day return', numeric: true }, { label: 'Alpha vs SPY', numeric: true }, { label: 'Beats SPY', numeric: true }, { label: 'Sharpe', numeric: true }]}
        rows={[
          [<strong>Strong Buy</strong>,  <strong>+8.30%</strong>, <strong>+7.21 pp</strong>, <strong>55.4%</strong>, <strong>3.00</strong>],
          ['Watch Buy',                  '+3.39%', '+2.23 pp', '53.3%', '3.31'],
          ['Watch Sell',                 '+2.72%', '+0.68 pp', '47.6%', '0.61'],
          ['Strong Sell',                '−1.42%', '−2.99 pp', '35.3%', '—'],
          ['SPY benchmark',              '+1.80%', '—',        '—',     '2.87'],
        ]}
      />
      <Body>
        The Strong Buy band beats SPY by more than 7 percentage points on average and earns a Sharpe
        of 3.00 against SPY's 2.87. The Strong Sell band falls during an up year — a real negative
        alpha. The bands are monotonic with realized return: the methodology works as a top-to-bottom
        sorter.
      </Body>
    </>
  ),

  // ============================================================
  // §4 PORTFOLIO INSIGHTS — lifted from legacy
  // ============================================================
  'port-why': (
    <>
      <Body>
        Connect the tactical signals to your actual holdings. Without this surface, the rest of the
        site is theoretical — interesting macro charts and ranked stock lists, but no integration with
        what you actually own.
      </Body>
      <Body>
        The page reads your brokerage positions and cross-references them against today's scanner
        scores and Asset Tilt sector ratings. Each position gets an action label tailored to what the
        data is currently saying about it.
      </Body>
    </>
  ),
  'port-how': (
    <>
      <Body>
        Top of the page: hero with totals (net asset value, year-to-date realized profit/loss, today's
        unrealized change) and a stance pill that summarizes overall book risk.
      </Body>
      <Body>
        Below: <strong>Allocation</strong> bar showing how today's value splits across asset classes
        (equity / option / cash / other). <strong>Accounts</strong> rollup showing each brokerage
        sub-tile with its own value, return, and top positions. <strong>Watchlist</strong> for names
        you are tracking but not holding. <strong>Trade History</strong> ledger of every closed
        position with realized profit/loss, holding period, and reason for the close.
      </Body>
      <Body>
        Click any position to open the same Ticker Detail modal used on Trading Opportunities — that
        is the integration point. The position shows today's MacroTilt Score, the score's recent
        trajectory, what would have to change for the score to move out of its current band, and the
        suggested action.
      </Body>
    </>
  ),
  'port-data': (
    <>
      <Body>Two streams feed the page:</Body>
      <DocsTable
        cols={['Stream', 'What it carries', 'Refreshed by']}
        rows={[
          ['Brokerage positions', 'Today\'s positions across all linked accounts: ticker, account, quantity, cost basis, unrealized profit/loss, asset class.', 'Plaid (account sync) writes to the positions table; the page reads it directly on load.'],
          ['Closed trade ledger', 'Every realized close, partial close, or expiration. Date, ticker, account, gross/net proceeds, realized profit/loss, holding period, lot-match method.', 'The close-position RPC writes one row per close. Tax-year totals are computed on the fly.'],
        ]}
      />
      <Body>
        Realized P&amp;L uses FIFO lot-matching with wash-sale treatment per IRS rules. Wash-sale
        disallowed losses are not deducted from the current-year P&amp;L total; they are added to the
        basis of the replacement lot and shown in a separate column in the trade history.
      </Body>
    </>
  ),
  'port-models': (
    <>
      <h4 style={ST.subH4}>Allocation rollup</h4>
      <Body>
        Positions are bucketed by asset class. Short option positions (negative quantity × premium)
        are bucketed separately from long options. Negative cash balances are flagged as margin debt.
        Short stock positions reduce the long-equity total.
      </Body>
      <h4 style={ST.subH4}>Today's unrealized change</h4>
      <Body>
        Computed by comparing today's mark against yesterday's close mark, summed across all positions.
        Options use the bid/ask midpoint where available, fallback to the model price.
      </Body>
      <h4 style={ST.subH4}>Position action label</h4>
      <Body>
        Each position carries a suggested action derived from three inputs:
      </Body>
      <Formula>{`band       = MacroTilt Score band of the ticker (Strong Buy / Watch Buy / Neutral / Watch Sell / Strong Sell)
sector_tilt = Asset Tilt sector rating for the ticker's sector (OW / MW / UW)
hold_pct    = position's % of total portfolio value

action =
  if band == "Strong Sell":                                          "Trim / Close"
  elif band == "Watch Sell" and hold_pct > 5%:                        "Trim"
  elif band == "Strong Buy" and sector_tilt == "OW" and hold_pct<3%:  "Add"
  elif band == "Strong Buy":                                          "Hold +"
  elif band == "Neutral":                                             "Hold"
  elif sector_tilt == "UW" and hold_pct > 5%:                         "Trim (sector UW)"
  else:                                                                "Hold"`}</Formula>
      <Body>
        Action labels are <strong>suggestions, not commands</strong>. The page is descriptive; the
        decision to execute stays with you.
      </Body>
    </>
  ),

  // ============================================================
  // §5 SCENARIO ANALYSIS — fresh
  // ============================================================
  'sc-why': (
    <>
      <Body>
        Macro Overview tells you where the cycle sits today. Asset Tilt tells you how to lean.
        Scenario Analysis answers the next question: <strong>what happens to my book — and to the Asset
        Tilt recommendation — when the macro panel moves?</strong>
      </Body>
      <Body>
        Two flavors. <strong>Historical scenarios</strong> replay the actual shock from a named episode
        (GFC, COVID, Volmageddon, the 2022 rate-hike cycle, etc.) through today's factor structure.
        <strong> Bespoke shocks</strong> let you pin one or more factors at a chosen size of move and
        propagate the rest using historical correlations.
      </Body>
    </>
  ),
  'sc-how': (
    <>
      <Body>
        Pick a scenario from the list, or build a bespoke shock by pinning one or more factor sliders.
        The page returns three reads:
      </Body>
      <ul style={{ paddingLeft: 22, margin: '8px 0 12px' }}>
        <li style={ST.bullet}><strong>Portfolio impact.</strong> Estimated profit/loss across your book under the shock. Per-position breakdown of which holdings move most.</li>
        <li style={ST.bullet}><strong>Cycle inputs after the shock.</strong> Where each macro indicator lands once the shock has propagated.</li>
        <li style={ST.bullet}><strong>Updated Asset Tilt.</strong> What the allocator would recommend under the new regime — equity %, defensive %, leverage, sector tilts.</li>
      </ul>
      <Body>
        Use historical scenarios when you want a literal "if 2008 happened again from today" read.
        Use bespoke shocks when you want to stress-test a single factor (e.g., "what if HY OAS widens
        300 basis points by itself").
      </Body>
    </>
  ),
  'sc-data': (
    <>
      <Body>
        The scenario engine reads from four sources:
      </Body>
      <DocsTable
        cols={['Source', 'What it carries']}
        rows={[
          ['Macro factor panel',          'Current values for the 16-factor macro panel (rates, credit, equity vol, FX, commodity, growth indicators).'],
          ['Factor correlation matrix',   'Pairwise correlations on weekly first differences. Calibrated against the full sample (1996 to today).'],
          ['Sector / IG sensitivity matrix', 'Same matrix used by the Asset Tilt allocator — per-sector and per-IG coefficients against each factor.'],
          ['Historical scenario archive', '8 named episodes (GFC, COVID, Volmageddon, 2022 rate-hike, 1998 LTCM, 2011 EU debt, 2018 Q4, 2015 China). Each carries the realized shock to every factor over the episode window.'],
        ]}
      />
    </>
  ),
  'sc-models': (
    <>
      <h4 style={ST.subH4}>Bespoke shock propagation</h4>
      <Body>
        Pinning a factor at <Code>+kσ</Code> moves the other factors by their correlation to the pinned
        factor, bounded by the size of the pinned move.
      </Body>
      <Formula>{`for each unpinned factor j:
   propagated_j = β_j,pinned × pin_size_in_sigmas    where β_j,pinned ≈ corr(j, pinned)

bounded to ±max(|pin_size|) so unpinned factors never exceed the pinned factor's magnitude.

multi-pin: weighted average of each pin's propagation, weighted by 1/distance_from_pin.`}</Formula>
      <h4 style={ST.subH4}>Historical replay</h4>
      <Body>
        A named scenario carries the realized factor shocks from its episode window. The engine applies
        those shocks to today's factor levels, then re-runs the cycle composite + regime classifier
        against the post-shock factor panel.
      </Body>
      <h4 style={ST.subH4}>Portfolio P&amp;L estimate</h4>
      <Formula>{`for each position p:
   factor_betas = sector_sensitivity[p.sector] + ig_specific_adjustment[p.industry_group]
   delta_return = Σf factor_betas[f] × factor_shock[f]
   delta_value  = p.market_value × delta_return

portfolio_pnl = Σp delta_value`}</Formula>
      <h4 style={ST.subH4}>Updated Asset Tilt under the shock</h4>
      <Body>
        After the cycle inputs have been re-computed against the shocked factor panel, the standard
        five-step allocator runs as normal. Output: equity %, defensive %, leverage, and per-sector
        tilts under the new regime.
      </Body>
      <HonestCallout>
        <strong>Honest status today.</strong> Like Asset Tilt, the scenario engine was built around the
        older cycle-mechanism framework. The factor shocks it propagates and the per-indicator responses
        it shows are anchored to that older framework. Migrating Scenario Analysis to Signal Intelligence
        is multi-week work — it sits on the active punch list. Treat scenario outputs today as
        directional rather than literal, until the rebuild lands.
      </HonestCallout>
    </>
  ),
};

// ─── component ──────────────────────────────────────────────────────────
export default function MethodologyBody() {
  const [activeId, setActiveId] = useState(SECTIONS[0].sub[0].id);

  // Scroll spy — observe each subsection, pick the one closest to the viewport top
  useEffect(() => {
    const ids = SECTIONS.flatMap(s => s.sub.map(x => x.id));
    const handler = () => {
      let best = activeId;
      let bestTop = -Infinity;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= 80 && top > bestTop) { bestTop = top; best = id; }
      }
      if (best !== activeId) setActiveId(best);
    };
    handler();
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [activeId]);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={ST.layout}>

      {/* ─── LEFT · sticky table of contents ─── */}
      <aside style={ST.toc}>
        <div style={ST.tocEyebrow}>Contents</div>
        {SECTIONS.map((s) => (
          <div key={s.id} style={ST.tocSection}>
            <div
              style={ST.tocSectionHead}
              onClick={() => scrollTo(s.sub[0].id)}
            >
              <span style={ST.tocNum}>{s.num}</span>
              <span style={ST.tocSectionLabel}>{s.title}</span>
            </div>
            <div style={ST.tocBlurb}>{s.blurb}</div>
            <ul style={ST.tocSubs}>
              {s.sub.map((sub) => (
                <li
                  key={sub.id}
                  style={{ ...ST.tocSub, ...(activeId === sub.id ? ST.tocSubActive : null) }}
                  onClick={() => scrollTo(sub.id)}
                >
                  {sub.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      {/* ─── RIGHT · content ─── */}
      <main style={ST.content}>
        {SECTIONS.map((s, sIdx) => (
          <section key={s.id} id={s.id} style={ST.section}>
            <div style={ST.sectionEyebrow}>{s.num} · {s.title}</div>
            <h2 style={ST.sectionH2}>{s.title}</h2>
            <p style={ST.sectionBlurb}>{s.blurb}</p>
            {s.sub.map((sub) => (
              <div key={sub.id} id={sub.id} style={ST.subBlock}>
                <h3 style={ST.subH3}>{sub.label}</h3>
                {SECTION_CONTENT[sub.id] || <Body>Coming soon.</Body>}
              </div>
            ))}
          </section>
        ))}
      </main>

    </div>
  );
}
