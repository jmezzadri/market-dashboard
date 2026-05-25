import React, { useEffect, useMemo, useState } from 'react';

/**
 * MethodologyBody — Signal Intelligence framework, plain-English methodology.
 *
 * Source of truth for what is described here:
 *   Risk_Off_Framework_Methodology.md (spec, repo workspace)
 *   src/v2/pages/MacroOverviewPage.jsx (live engine — formulas, thresholds,
 *     stage logic, regime classifier)
 *
 * Anything that names a vol trigger, a cycle indicator, a stage, a quintile
 * cutoff, or a regime state must match the engine character-for-character.
 * Do not introduce a value here that is not produced by the engine. If the
 * engine changes, this page changes in the same PR.
 *
 * Rendered by both /#readme (default URL, legacy wrapper) and the
 * preview-URL v2 Methodology page, so the surfaces cannot drift.
 */

// ── Four-state lexicon — identical to the engine. ────────────────────────
const REGIME_STATES = [
  {
    label: 'Risk On',
    cls:   'r-on',
    short: 'No volatility trigger above its mark.',
    detail: 'Vol is calm. The fully-invested default position. No action.',
  },
  {
    label: 'Neutral',
    cls:   'r-neu',
    short: 'Exactly one trigger crossed for exactly one week.',
    detail: 'Roughly one in four single-week crosses are head-fakes — they slip back below the mark within a week. Note it. Do not act yet.',
  },
  {
    label: 'Cautionary',
    cls:   'r-cau',
    short: 'A trigger has held above its mark for at least two weeks.',
    detail: 'Head-fake filtered. Vol is real. The cycle composite is in the middle to upper zone — the cycle has either started to confirm or already broken. Past the forward-looking signal point; act on personal risk tolerance.',
  },
  {
    label: 'Risk Off',
    cls:   'r-off',
    short: 'A trigger has held for at least two weeks AND the cycle composite is in the deepest calm zone.',
    detail: 'The actionable signal. Vol has cracked while the macro cycle still looks fine — leading edge, not trailing edge. Late-cycle setup, early-stress confirmation. This is when broad confirmation is most likely to follow.',
  },
];

// ── Three vol triggers — identical to the engine. ────────────────────────
const VOL_TRIGGERS = [
  {
    name: 'Equity Volatility',
    measures: 'The 30-day implied move on the S&P 500.',
    position: 'Often the LAST to confirm. The most-cited stress measure, but the slowest of the three.',
  },
  {
    name: 'Bond Volatility',
    measures: 'Implied volatility on Treasury options. Captures rate-policy uncertainty and bond-market stress.',
    position: 'MIDDLE. Often follows funding stress and leads equity vol.',
  },
  {
    name: 'Funding Stress',
    measures: 'The spread of commercial paper rates over Treasury bills — how expensive it is for blue-chip companies to borrow for 30 days.',
    position: 'Often the LEADING trigger. In 2008, this was elevated from May onwards while equity vol stayed calm through August.',
  },
];

// ── Five stages — identical to the engine. ───────────────────────────────
const STAGE_TABLE = [
  { stage: 'Calm',       weeks: 'Below the mark',         meaning: 'No action.' },
  { stage: 'Watching',   weeks: 'One week above',         meaning: 'About one in four single-week crosses are head-fakes — they resolve back below within a week. Note it. Do not act yet.' },
  { stage: 'Holding',    weeks: 'Two to three weeks',     meaning: 'Head-fake filtered out. Worth preparing.' },
  { stage: 'Confirmed',  weeks: 'Four to seven weeks',    meaning: 'The signal is real. Act consistent with your own risk tolerance.' },
  { stage: 'Entrenched', weeks: 'Eight weeks or longer',  meaning: 'Late-stage signal. The math still says drawdown probability is elevated even if you have not acted yet.' },
];

// ── Seven cycle indicators — identical to the engine. ────────────────────
// flipped=true means LOW value is the bearish direction. The engine inverts
// the percentile rank for those four (100 minus raw rank) so all seven point
// in the same direction inside the average.
const CYCLE_INDICATORS = [
  { name: 'Copper / Gold ratio',          higherMeans: 'Cyclical demand is healthy (bullish).',                flipped: true  },
  { name: 'KBW Bank index / S&P ratio',   higherMeans: 'Banks are leading the market (bullish, healthy credit).', flipped: true  },
  { name: '10-year minus 2-year Treasury spread', higherMeans: 'Yield curve is steeper (bullish, banks make money lending).', flipped: true  },
  { name: 'Chicago Fed financial conditions',     higherMeans: 'Conditions are tighter (bearish).',           flipped: false },
  { name: 'Initial jobless claims',       higherMeans: 'More people are losing their jobs (bearish).',         flipped: false },
  { name: 'High-Yield credit spread',     higherMeans: 'Risky-borrower lenders demand more compensation (bearish, credit stress).', flipped: false },
  { name: 'Investment-Grade credit spread', higherMeans: 'Safer-borrower lenders demand more compensation (bearish, credit stress).', flipped: false },
];

// ── Cycle composite quintile bands — identical to the engine. ────────────
const QUINTILE_BANDS = [
  { band: 'Q1', range: 'Under 20',  meaning: 'Deepest calm. Late expansion, nothing has broken yet.' },
  { band: 'Q2', range: '20 to 40',  meaning: 'Calm. Late-cycle territory.' },
  { band: 'Q3', range: '40 to 60',  meaning: 'Middle. Early stress visible in some places.' },
  { band: 'Q4', range: '60 to 80',  meaning: 'Stress is broad and confirmed in several places.' },
  { band: 'Q5', range: '80 and up', meaning: 'Full-blown macro stress. The cycle has already broken.' },
];

// ── Limitations — sourced verbatim from the spec doc, plain language. ────
const LIMITATIONS = [
  {
    head: 'It does not call entries or bottoms.',
    body: 'The framework answers one question: when to take chips off the table. It is silent on when to put them back. A separate decision rule (not this page) governs re-entry.',
  },
  {
    head: 'A bounce-back and a grind look the same here.',
    body: 'The framework measures the deepest peak-to-trough drop over a forward window. A drop that recovers in three months and a drop that grinds for a year are scored identically. For a fully-invested investor with patience, those are roughly equivalent. For a stop-loss-driven investor, the second is much worse — the framework does not distinguish.',
  },
  {
    head: 'Two crises dominate the deep-stress sample.',
    body: 'The conditional drawdown numbers behind the framework are heavily shaped by the 2008 financial crisis and the 2020 pandemic crash. Slower-grinding tops (2000 to 2002) contribute, but the deepest-stress readings are dominated by those two episodes.',
  },
  {
    head: 'Pre-2002 history runs on two triggers, not three.',
    body: 'Bond Volatility is not available in free public data before 2002. Any back-test that pre-dates 2002 reduces to Equity Vol plus Funding Stress. The 1998 LTCM crisis — the most consequential pre-2006 test — cannot be fully verified with the three-trigger framework.',
  },
  {
    head: 'Credit-spread substitutes used before 2011 are not exact.',
    body: 'Native high-yield and investment-grade credit-spread series only run back to 2011 (investment grade) and 2011 (high yield). Before that the framework uses BAA-AAA spreads as a proxy. Correlation is high (0.87 for high yield, 0.98 for investment grade) but the proxy is less sensitive to the deepest credit-stress episodes.',
  },
  {
    head: '1996 had seven false positives.',
    body: 'The framework fired Risk Off seven times during 1996 mid-bull-market wobbles that did not lead to drawdowns. Vol triggers twitched, but credit was tight and cyclicals were not weakening. A filter for sustained cyclical weakness would have cleared most of those out — it was deliberately not added to keep the framework simple.',
  },
];

// ── Sections shown in the jump-nav. ──────────────────────────────────────
// Anchors point at section IDs in the body. They are NOT URL-hash anchors —
// clicking a chip calls scrollToSection(id) which jumps the viewport without
// touching window.location.hash (the site's tab router watches the hash and
// would swallow any unknown value back to the Home tab).
const SECTIONS = [
  // Group 1 — Macro Overview / Signal Intelligence
  { id: 'mo-question',     label: 'Macro Overview · the question',  group: 'Macro Overview' },
  { id: 'mo-architecture', label: 'Two layers' },
  { id: 'mo-triggers',     label: 'Layer 1 — volatility triggers' },
  { id: 'mo-composite',    label: 'Layer 2 — cycle composite' },
  { id: 'mo-regime',       label: 'The four-state read' },
  { id: 'mo-thresholds',   label: 'How thresholds are set' },
  { id: 'mo-limits',       label: 'What this does not do' },
  // Group 2 — the rest of the site
  { id: 'asset-tilt',      label: 'Asset Tilt',          group: 'Other pages' },
  { id: 'trading-opps',    label: 'Trading Opportunities' },
  { id: 'portfolio',       label: 'Portfolio Insights' },
  { id: 'scenarios',       label: 'Scenario Analysis' },
  // Group 3 — registry
  { id: 'sources',         label: 'Where the data comes from', group: 'Sources' },
];

// scrollToSection — used instead of href="#id" to avoid touching the URL hash
// (which the site's tab router uses for navigation).
function scrollToSection(e, id) {
  if (e && e.preventDefault) e.preventDefault();
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Small style helpers reused below. ────────────────────────────────────
const sectionBox = {
  background: 'var(--bg-1, var(--surface, #fff))',
  border: '1px solid var(--line-1, var(--border, rgba(0,0,0,0.08)))',
  borderRadius: 'var(--r-tile, 12px)',
  padding: 28,
  marginTop: 24,
  scrollMarginTop: 80,
};
const eyebrow = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-2, var(--text-muted, #555))',
  fontWeight: 500,
  marginBottom: 8,
};
const h2 = {
  fontFamily: 'var(--font-display, inherit)',
  fontWeight: 400,
  fontSize: 26,
  lineHeight: 1.18,
  margin: '6px 0 0',
  color: 'var(--ink-0, var(--text, #000))',
};
const body = {
  fontSize: 14,
  color: 'var(--ink-1, var(--text, #222))',
  lineHeight: 1.6,
  maxWidth: '68ch',
};
const tableBase = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: 16,
  fontSize: 13,
};
const th = {
  textAlign: 'left',
  padding: '10px 8px',
  borderBottom: '1px solid var(--line-1, var(--border, #ddd))',
  color: 'var(--ink-2, var(--text-muted, #555))',
  fontWeight: 500,
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};
const td = {
  padding: '10px 8px',
  borderBottom: '1px solid var(--line-0, rgba(0,0,0,0.06))',
  color: 'var(--ink-1, var(--text, #222))',
  verticalAlign: 'top',
};

export default function MethodologyBody({ withJumpNav = true }) {
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    fetch('/data_manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setManifest)
      .catch(() => {});
  }, []);

  // Build the live source-vendor list from the data registry. Bug #1189:
  // strip parenthetical qualifiers (they carry internal table / file names),
  // split on every delimiter, and drop placeholder / internal-only tokens so
  // the Sources list shows only clean, real vendor names.
  const sources = useMemo(() => {
    const els = manifest?.elements || {};
    const isInternal = (t) => {
      const x = t.toLowerCase();
      return !x
        || /^(n\/a|tbd|self|none|unknown)\b/.test(x)
        || x.startsWith('internal')
        || /\.(json|py|csv|yml|yaml)\b/.test(x);
    };
    const out = new Set();
    Object.values(els).forEach((e) => {
      const v = e?.source_vendor || e?.source || '';
      if (!v) return;
      v.replace(/\([^)]*\)/g, '')
        .split(/[·,;|+]/)
        .forEach((s) => {
          const t = s.trim().replace(/\s{2,}/g, ' ');
          if (t && !isInternal(t)) out.add(t);
        });
    });
    return Array.from(out).sort();
  }, [manifest]);

  return (
    <div>
      {withJumpNav && (
        <nav
          aria-label="Methodology sections"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            padding: '10px 0 4px',
            marginBottom: 8,
          }}
        >
          <span style={{ ...eyebrow, marginBottom: 0, marginRight: 4 }}>Jump to</span>
          {SECTIONS.map((s) => (
            <React.Fragment key={s.id}>
              {s.group && (
                <span style={{
                  fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--ink-2, var(--text-muted, #666))',
                  fontWeight: 600, marginLeft: 8, marginRight: 2,
                }}>{s.group} ›</span>
              )}
              <a
                href="#readme"
                onClick={(e) => scrollToSection(e, s.id)}
                style={{
                  fontSize: 12,
                  padding: '5px 11px',
                  borderRadius: 999,
                  border: '1px solid var(--line-1, var(--border, #ddd))',
                  color: 'var(--ink-1, var(--text, #222))',
                  textDecoration: 'none',
                  background: 'var(--bg-2, var(--surface-2, transparent))',
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </a>
            </React.Fragment>
          ))}
        </nav>
      )}

      {/* ────────────────────────────────────────────────────────────────
          MACRO OVERVIEW — sections 1 through 7 cover the Macro Overview
          page (Signal Intelligence framework).
          ──────────────────────────────────────────────────────────────── */}

      <div style={{
        margin: '20px 0 8px',
        padding: '10px 0',
        fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--ink-2, var(--text-muted, #666))', fontWeight: 600,
        borderTop: '1px solid var(--line-1, var(--border, #ddd))',
        textAlign: 'center',
      }}>Macro Overview</div>

      {/* 1. The question */}
      <section id="mo-question" style={sectionBox}>
        <div style={eyebrow}>The question this framework answers</div>
        <h2 style={h2}>When to take chips off the table.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          MacroTilt is built for an investor who is almost always fully invested in equities. The operational question is not when to buy — it is when to take risk off. Signal Intelligence is the framework that answers it.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          It is not a buy signal. It does not call entries, bottoms, or "buy the dip" moments. It is a forward-looking sell-warning system: when do the conditions look like a meaningful drawdown is closer than the calm surface suggests.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          2. Two layers
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-architecture" style={sectionBox}>
        <div style={eyebrow}>The architecture</div>
        <h2 style={h2}>Two layers of evidence, one regime read.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          Two layers, each looking at a different kind of evidence:
        </p>
        <ul style={{ ...body, paddingLeft: 22, marginTop: 8 }}>
          <li style={{ marginBottom: 8 }}>
            <strong>Layer 1 — three volatility triggers.</strong> Equity Vol, Bond Vol, Funding Stress. These are fast, forward-looking, and crack before the macro economy confirms.
          </li>
          <li>
            <strong>Layer 2 — one cycle composite.</strong> Seven macro indicators averaged into a single 0-to-100 score. Tells you whether the cycle is calm (the dangerous setup) or already broken.
          </li>
        </ul>
        <p style={{ ...body, marginTop: 14 }}>
          Layer 1 tells us when trouble has arrived. Layer 2 tells us whether that trouble matters yet. Combined, they produce one of four labels — Risk On, Neutral, Cautionary, or Risk Off — that describes the tape today.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          3. Layer 1 — volatility triggers
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-triggers" style={sectionBox}>
        <div style={eyebrow}>Layer 1</div>
        <h2 style={h2}>Three volatility triggers, ordered by who cracks first.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          Each trigger has a mark on a half-circle dial. The mark is the level the reading has been at or above on only the worst one-in-seven trading days over the past five years. That is the trailing five-year 85th percentile of the trigger's own values.
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Trigger</th>
            <th style={th}>What it measures</th>
            <th style={th}>Position in the stress chain</th>
          </tr></thead>
          <tbody>
            {VOL_TRIGGERS.map((t) => (
              <tr key={t.name}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>{t.name}</td>
                <td style={td}>{t.measures}</td>
                <td style={td}>{t.position}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ ...h2, fontSize: 18, marginTop: 28 }}>How the mark stays current.</h3>
        <p style={{ ...body, marginTop: 8 }}>
          Every weekday at 7 AM Eastern Time, the underlying weekly history refreshes. The five-year window slides forward one day. The mark is re-computed against the new window. Nothing manual — the mark drifts as markets evolve, so a 2009-style high-vol regime and a 2017-style low-vol regime each get their own calibrated mark.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          Each dial is scaled so the mark always lands at the same arc position, no matter the units. So an Equity Vol of 18, a Bond Vol of 90, and a Funding Stress of 25 basis points are all visually comparable — same arc position, different units.
        </p>

        <h3 style={{ ...h2, fontSize: 18, marginTop: 28 }}>Five stages, one per trigger.</h3>
        <p style={{ ...body, marginTop: 8 }}>
          Once a trigger crosses its mark, it moves through five stages based on how many consecutive weeks it has stayed above. Each trigger has its own stage at any given moment.
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Stage</th>
            <th style={th}>How long above the mark</th>
            <th style={th}>What it means</th>
          </tr></thead>
          <tbody>
            {STAGE_TABLE.map((s) => (
              <tr key={s.stage}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>{s.stage}</td>
                <td style={td}>{s.weeks}</td>
                <td style={td}>{s.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          4. Layer 2 — cycle composite
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-composite" style={sectionBox}>
        <div style={eyebrow}>Layer 2</div>
        <h2 style={h2}>One cycle composite, built from seven indicators.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          The cycle composite is the fact-check on Layer 1. Each of the seven indicators below is ranked against its own full history — the longest one runs back to the 1960s. The rank is then converted into a 0-to-100 stress percentile: higher means more stress. For four of the seven indicators, low readings actually mean stress, so we flip the rank (100 minus the raw rank) before averaging. That way all seven point in the same direction.
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Indicator</th>
            <th style={th}>Higher reading means</th>
            <th style={{ ...th, textAlign: 'center' }}>Direction flipped before averaging?</th>
          </tr></thead>
          <tbody>
            {CYCLE_INDICATORS.map((i) => (
              <tr key={i.name}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>{i.name}</td>
                <td style={td}>{i.higherMeans}</td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{i.flipped ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...body, marginTop: 14 }}>
          The seven stress percentiles are averaged into a single 0-to-100 score. Then the score is bucketed into a quintile:
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Quintile</th>
            <th style={th}>Score range</th>
            <th style={th}>What it means</th>
          </tr></thead>
          <tbody>
            {QUINTILE_BANDS.map((q) => (
              <tr key={q.band}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>{q.band}</td>
                <td style={td}>{q.range}</td>
                <td style={td}>{q.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ ...h2, fontSize: 18, marginTop: 28 }}>Why a calm cycle composite is the dangerous setup.</h3>
        <p style={{ ...body, marginTop: 8 }}>
          A low composite reading means the cycle looks fine on the surface. That is the exact moment a vol crack is most actionable — the engine is deep in the expansion and the things that usually break first have not broken yet. When vol cracks while the cycle still looks calm, we are at the leading edge of trouble, not the back end of it. That is the setup the framework is designed to catch.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          If the composite is already in the upper half (Q3 to Q5) when a vol trigger fires, we are already inside a downturn. The forward-looking edge is gone — by then it is reactive, not preemptive.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          5. The four-state read
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-regime" style={sectionBox}>
        <div style={eyebrow}>The four-state read</div>
        <h2 style={h2}>One label that combines both layers.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          Every reading rolls up into one of four labels. No exceptions, no in-between states.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
          marginTop: 18,
        }}>
          {REGIME_STATES.map((r) => (
            <div
              key={r.label}
              style={{
                padding: 18,
                background: 'var(--bg-2, var(--surface-2, rgba(0,0,0,0.02)))',
                border: '1px solid var(--line-1, var(--border, #e3e3e3))',
                borderRadius: 'var(--r-md, 10px)',
              }}
            >
              <span className={`v2-pill ${r.cls}`} style={{
                display: 'inline-block',
                fontFamily: 'var(--font-display, inherit)',
                fontStyle: 'italic',
                fontWeight: 500,
                fontSize: 14,
                padding: '4px 14px',
                borderRadius: 14,
                background: 'var(--bg-1, rgba(255,255,255,0.85))',
                border: '1px solid var(--line-1, #d8d8d8)',
                color: 'var(--ink-0, #111)',
              }}>{r.label}</span>
              <p style={{ ...body, fontSize: 13, marginTop: 10, fontWeight: 500, color: 'var(--ink-0, #111)' }}>{r.short}</p>
              <p style={{ ...body, fontSize: 12.5, marginTop: 8 }}>{r.detail}</p>
            </div>
          ))}
        </div>
        <p style={{ ...body, marginTop: 20, fontSize: 13 }}>
          The Risk Off label is the actionable one — vol has cracked while the cycle still looks calm. That is the moment broad confirmation is most likely to follow. The Cautionary label is the reactive cousin — vol has cracked but the cycle has already broken, so the forward-looking edge has already been priced in.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          6. Thresholds
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-thresholds" style={sectionBox}>
        <div style={eyebrow}>How the thresholds are set</div>
        <h2 style={h2}>Same percentile, regime-adaptive window.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          Three decisions sit behind every threshold on this page:
        </p>
        <ul style={{ ...body, paddingLeft: 22, marginTop: 8 }}>
          <li style={{ marginBottom: 10 }}>
            <strong>Same percentile across triggers.</strong> All three vol triggers are marked at their own 85th percentile. That makes them like-for-like — an 85th-percentile reading is equally rare for each trigger regardless of the absolute units.
          </li>
          <li style={{ marginBottom: 10 }}>
            <strong>Trailing five-year window.</strong> Funding markets changed after the 2009 reforms. Bond-market behavior shifted in the 2010s. Equity vol drifted lower across the same decade. A rolling five-year window absorbs those regime shifts so the mark stays calibrated to today's market, not to a structural era that has already ended.
          </li>
          <li>
            <strong>85th percentile, not 95th or 75th.</strong> The 95th only fires during a full-blown crisis — by then it is too late to act forward-looking. The 75th has too many false positives. 85th is calibrated for the risk-off decision, validated across the available history.
          </li>
        </ul>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          7. What this does not do
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-limits" style={sectionBox}>
        <div style={eyebrow}>What this framework will not do</div>
        <h2 style={h2}>Honest limits.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          A framework that does not name its limits is not a framework — it is a sales pitch. These are the limits.
        </p>
        <div style={{ marginTop: 8 }}>
          {LIMITATIONS.map((l) => (
            <div key={l.head} style={{ marginTop: 18 }}>
              <div style={{ fontWeight: 600, color: 'var(--ink-0, var(--text, #000))', fontSize: 14, marginBottom: 4 }}>{l.head}</div>
              <p style={{ ...body, marginTop: 0, fontSize: 13.5 }}>{l.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          OTHER PAGES — what each other site surface does and how it works
          ──────────────────────────────────────────────────────────────── */}

      <div style={{
        margin: '36px 0 8px',
        padding: '10px 0',
        fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--ink-2, var(--text-muted, #666))', fontWeight: 600,
        borderTop: '1px solid var(--line-1, var(--border, #ddd))',
        textAlign: 'center',
      }}>The other pages on the site</div>

      {/* Asset Tilt */}
      <section id="asset-tilt" style={sectionBox}>
        <div style={eyebrow}>Asset Tilt</div>
        <h2 style={h2}>Translating the macro read into portfolio actions.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          The Macro Overview page describes <em>where we are</em>. The Asset Tilt page answers <em>what to do about it</em> — an explicit allocation recommendation across eleven equity sectors, twenty-four industry groups, and a four-bucket defensive sleeve. Equity percentage, defensive percentage, leverage, and per-sector tilts all come out of a single decision engine.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          Two hard rules constrain every output. <strong>Defensive sleeve never exceeds 50%</strong> of capital, even in the worst regime — the system will not put more than half the book in bonds, cash, and gold. <strong>Leverage never exceeds 1.5×</strong>, and defensive and leverage are never on at the same time. If the engine wants any defensive sleeve, leverage drops to 1.0×. These are constraints in the optimization, not assumptions about what is optimal.
        </p>
        <div style={{
          marginTop: 18, padding: 16,
          background: 'var(--bg-2, var(--surface-2, rgba(0,0,0,0.02)))',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '0 6px 6px 0',
          fontSize: 13.5, color: 'var(--ink-1, #222)',
        }}>
          <strong style={{ color: 'var(--ink-0, #000)' }}>Honest status today.</strong> The Asset Tilt engine was built and back-tested against the older cycle-mechanism framework that Signal Intelligence replaced on Macro Overview. The recommendations on Asset Tilt today are still produced by that older engine. Recalibrating the engine against Signal Intelligence is multi-week work — it sits on the active punch list, scoped for the Senior Quant. Until that recalibration lands and is back-tested, treat the Asset Tilt numbers as a v1 recommendation, not a Signal-Intelligence-anchored one.
        </div>
      </section>

      {/* Trading Opportunities */}
      <section id="trading-opps" style={sectionBox}>
        <div style={eyebrow}>Trading Opportunities</div>
        <h2 style={h2}>Specific names to act on today.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          The Trading Opportunities page is the actionable end of the funnel. The Macro Overview tells you the regime; the Asset Tilt tells you how to lean by sector; Trading Opportunities turns that lean into <strong>specific tickers</strong>. It is an end-of-day screener — it runs once after the close and publishes a daily buy list of individual stocks worth a closer look.
        </p>

        <h3 style={{ ...h2, fontSize: 18, marginTop: 28 }}>The universe it scans.</h3>
        <p style={{ ...body, marginTop: 8 }}>
          Every night the screener scores every US-listed common stock that clears two plain gates: the share price is at least $5, and the stock trades at least $1.5 million of value a day, measured as a 90-day median. That leaves roughly two to two-and-a-half thousand names. Anything cheaper or thinner is dropped before scoring — those are names a normal-sized order cannot get into and out of cleanly. There is no trend or momentum pre-filter; the score itself does all the work of separating signal from noise.
        </p>

        <h3 style={{ ...h2, fontSize: 18, marginTop: 28 }}>How a name earns its score.</h3>
        <p style={{ ...body, marginTop: 8 }}>
          Each name is scored on <strong>four</strong> layers of evidence. The <strong>insider layer</strong> is the anchor — corporate insiders buying their own company&rsquo;s stock is, by a wide margin, the strongest predictor in our own testing. The <strong>trend layer</strong> is a guardrail that keeps the screener from chasing a falling or badly overheated stock. The <strong>dark-pool layer</strong> reads large off-exchange block trades (&ldquo;dark pool&rdquo;) for the price level big institutions recently transacted around. The <strong>options layer</strong> reads fresh, aggressively-bought call activity. All four are live, and the score runs from 0 to <strong>10</strong>.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          The insider layer rewards three patterns of open-market buying by a company&rsquo;s own officers and directors, over a rolling 30-day window. Routine pre-scheduled trades and trades by 10%-plus shareholders are excluded — only conviction buying counts.
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Insider pattern</th>
            <th style={th}>What earns the points</th>
            <th style={{ ...th, textAlign: 'center' }}>Points</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>Conviction buy</td>
              <td style={td}>A CEO or CFO buying on the open market, in a trade that lifts their personal stake by at least 10% and is worth at least $100,000.</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>4</td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>Size</td>
              <td style={td}>All insider buying in the window, added up, comes to at least 0.05% of the company&rsquo;s market value.</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>4</td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>Consensus</td>
              <td style={td}>At least three different insiders buying within the same window.</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>2</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...body, marginTop: 14 }}>
          The insider layer is capped at 4 points, so one stock cannot run away with the score on insider evidence alone. The trend layer then adjusts: a name trading above its 200-day average price adds 1 point; below it subtracts 2; an overheated momentum reading (a 14-day RSI above 65) subtracts another 2. A name <strong>launches</strong> onto the buy list when its insider-and-trend score reaches <strong>3</strong> — that gate is unchanged. The dark-pool and options layers then add their points on top, lifting the displayed score toward the ceiling of 10. They sharpen the score and the ranking, but they never add a name to the list or take one off it.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          One refinement matters: insider signals fade with age. A fresh insider buy carries full weight for its first 15 days, then tapers steadily to nothing by day 31. The list retires its own stale ideas — a buy that surfaced three weeks ago is worth less than one filed yesterday.
        </p>

        <h3 style={{ ...h2, fontSize: 18, marginTop: 28 }}>The dark-pool and options layers.</h3>
        <p style={{ ...body, marginTop: 8 }}>
          The <strong>dark-pool layer</strong> looks at the last two trading days of large off-exchange block trades. Where that block volume piles up inside a narrow price band, that band is an institutional anchor — a price level big money cared about. If the stock now trades above the band, the band sits beneath the price as a support floor: <strong>2 points</strong>. If there is no tight band but one standout large block printed below the price, that lone block is a weaker anchor: <strong>1 point</strong>. The layer is capped at 2 points, and the anchor price it finds also sets the entry, stop and target levels.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          The <strong>options layer</strong> looks at medium-dated call contracts — 14 to 45 days to expiry — that are moderately out-of-the-money. It rewards a contract showing two things at once: fresh positioning (today&rsquo;s volume is large versus the open interest already on the contract) and aggressive execution (at least 65% of that volume printed at the ask — the buyer paid up). Volume of three times the open interest or more earns <strong>4 points</strong>; one to three times earns <strong>3 points</strong>. The layer is capped at 4 points.
        </p>
        <div style={{
          marginTop: 18, padding: 16,
          background: 'var(--bg-2, var(--surface-2, rgba(0,0,0,0.02)))',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '0 6px 6px 0',
          fontSize: 13.5, color: 'var(--ink-1, #222)',
        }}>
          <strong style={{ color: 'var(--ink-0, #000)' }}>Not yet backtested.</strong> The dark-pool and options point values above come from the screener specification and have been sanity-checked by the Senior Quant — but, unlike the insider and trend layers, they have not been through a back-test. There is not yet enough of their own history. They were switched on by owner decision so the screener can begin using them; treat them as developing signals, and expect their point values to be revisited once a back-test is possible.
        </div>

        <h3 style={{ ...h2, fontSize: 18, marginTop: 28 }}>What the back-test showed.</h3>
        <p style={{ ...body, marginTop: 8 }}>
          The insider point values, the trend adjustments and the launch threshold were set by a back-test, not by guesswork — the same standing rule that retired the previous screener. (The dark-pool and options point values were not — see the note above.) Across the twelve months of insider history available, the 88 names the screener launched, measured one month (21 trading days) later:
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Measure</th>
            <th style={{ ...th, textAlign: 'center' }}>Result</th>
            <th style={th}>In plain terms</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>Win rate</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>59.1%</td>
              <td style={td}>Roughly three of every five launched names were higher a month later.</td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>Average move</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>+5.96%</td>
              <td style={td}>The average launched name over the following month.</td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>Versus the broad market</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>+2.42%</td>
              <td style={td}>How much the launched names beat the average eligible stock, per month.</td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>Profit factor</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>2.76</td>
              <td style={td}>About $2.76 earned for every $1.00 lost across all launched names.</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...body, marginTop: 14 }}>
          The screener is built to produce a sell / short list as well as a buy list. The back-test found no reliable edge on the short side, so only the buy list is published today — the short list turns on automatically if and when the evidence supports it.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          Each name on the list carries an entry reference price, a stop, and a profit target. Clicking any row opens the full stock view — the layer-by-layer score, the price chart, and the insider filings behind it.
        </p>
        <div style={{
          marginTop: 18, padding: 16,
          background: 'var(--bg-2, var(--surface-2, rgba(0,0,0,0.02)))',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '0 6px 6px 0',
          fontSize: 13.5, color: 'var(--ink-1, #222)',
        }}>
          <strong style={{ color: 'var(--ink-0, #000)' }}>Honest status today.</strong> The insider screener was calibrated on a single twelve-month window — and a mostly-rising one. That is enough history to launch it on, but it is not a multi-cycle proof: it has not yet been tested through a real downturn. The dark-pool and options layers went live on 21 May 2026 without a back-test of their own, by owner decision — there is not yet enough of their history to test honestly. The calibration is re-checked every quarter, and immediately if a market correction enters the data. Treat the win rate as a reasonable expectation, not a promise.
        </div>
      </section>

      {/* Portfolio Insights */}
      <section id="portfolio" style={sectionBox}>
        <div style={eyebrow}>Portfolio Insights</div>
        <h2 style={h2}>How your actual book is positioned.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          The Portfolio Insights page reads your live brokerage positions and shows where your book actually sits today — allocation across asset classes, sector exposure, top holdings by weight, account-by-account breakdowns, watch list, and a trade-history ledger of every closed position. It is descriptive, not prescriptive.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          Positions are imported from your brokerage account via a secure read-only connection. The page recomputes every metric on load — your account-level returns, your asset-class rollup, your sector concentration, your option mark-to-market — using live prices for stocks and live option-chain data for any open options. Realized profit and loss for the tax year is computed from your actual close-position records using FIFO lot-matching with wash-sale treatment.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          The page does not give portfolio recommendations. It tells you what you are holding. If you want to know what to lean toward, that lives on Asset Tilt. If you want specific names, that lives on Trading Opportunities.
        </p>
      </section>

      {/* Scenario Analysis */}
      <section id="scenarios" style={sectionBox}>
        <div style={eyebrow}>Scenario Analysis</div>
        <h2 style={h2}>How your portfolio reacts under stress.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          The Scenario Analysis page runs a shock through the macro factor panel and tells you how your portfolio, the Asset Tilt recommendation, and each cycle indicator move in response. Two flavors: <strong>historical scenarios</strong> (the GFC, COVID, Volmageddon, the 2022 rate-hike cycle, and several others) replay the actual shock through today's factor structure; <strong>bespoke shocks</strong> let you pin one or more factors at a chosen size of move and propagate the rest using historical correlations.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          The page returns a portfolio-level profit-and-loss estimate, a per-position breakdown of which holdings move most under that shock, and the updated Asset Tilt recommendation the engine would produce in that scenario.
        </p>
        <div style={{
          marginTop: 18, padding: 16,
          background: 'var(--bg-2, var(--surface-2, rgba(0,0,0,0.02)))',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '0 6px 6px 0',
          fontSize: 13.5, color: 'var(--ink-1, #222)',
        }}>
          <strong style={{ color: 'var(--ink-0, #000)' }}>Honest status today.</strong> Like Asset Tilt, the scenario engine was built around the older cycle-mechanism framework. The shocks it propagates and the per-indicator responses it shows are anchored to that older framework. Migrating Scenario Analysis to Signal Intelligence is multi-week work — it sits on the active punch list. Treat scenario outputs today as directional rather than literal, until the rebuild lands.
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          Sources — auto-populated from the data registry
          ──────────────────────────────────────────────────────────────── */}

      <div style={{
        margin: '36px 0 8px',
        padding: '10px 0',
        fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--ink-2, var(--text-muted, #666))', fontWeight: 600,
        borderTop: '1px solid var(--line-1, var(--border, #ddd))',
        textAlign: 'center',
      }}>Sources</div>

      <section id="sources" style={sectionBox}>
        <div style={eyebrow}>Where the data comes from</div>
        <h2 style={h2}>Sources.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          Every data element on MacroTilt is registered against a vendor and a freshness window. The list below is generated live — it stays in sync with what is actually wired today, not what was wired six months ago.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: 10,
          marginTop: 16,
        }}>
          {sources.length
            ? sources.map((s) => (
                <div
                  key={s}
                  style={{
                    padding: '9px 13px',
                    background: 'var(--bg-2, var(--surface-2, rgba(0,0,0,0.02)))',
                    borderRadius: 'var(--r-sm, 6px)',
                    border: '1px solid var(--line-1, var(--border, #e3e3e3))',
                    fontSize: 13,
                    color: 'var(--ink-0, var(--text, #111))',
                  }}
                >
                  {s}
                </div>
              ))
            : (
              <span style={{ ...body, fontSize: 12.5, color: 'var(--ink-2, var(--text-muted, #555))' }}>
                Loading sources…
              </span>
            )}
        </div>
      </section>

      {/* Footer line. */}
      <div style={{
        margin: '40px 0 24px',
        paddingTop: 22,
        borderTop: '1px solid var(--line-0, rgba(0,0,0,0.08))',
        textAlign: 'center',
        color: 'var(--ink-2, var(--text-muted, #555))',
        fontSize: 11,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        Signal Intelligence · {sources.length} source vendors · {Object.keys(manifest?.elements || {}).length} registered data elements
      </div>
    </div>
  );
}
