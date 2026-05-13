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
const SECTIONS = [
  { id: 'question',      label: 'The question' },
  { id: 'architecture',  label: 'Two layers' },
  { id: 'triggers',      label: 'Layer 1 — volatility triggers' },
  { id: 'composite',     label: 'Layer 2 — cycle composite' },
  { id: 'regime',        label: 'The four-state read' },
  { id: 'thresholds',    label: 'How thresholds are set' },
  { id: 'limits',        label: 'What this does not do' },
  { id: 'sources',       label: 'Where the data comes from' },
];

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

  // Build the live source-vendor list from the data registry.
  const sources = useMemo(() => {
    const els = manifest?.elements || {};
    const out = new Set();
    Object.values(els).forEach((e) => {
      const v = e?.source_vendor || e?.source || '';
      if (v) v.split(/[·,;|]/).forEach((s) => { const t = s.trim(); if (t) out.add(t); });
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
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                fontSize: 12,
                padding: '5px 11px',
                borderRadius: 999,
                border: '1px solid var(--line-1, var(--border, #ddd))',
                color: 'var(--ink-1, var(--text, #222))',
                textDecoration: 'none',
                background: 'var(--bg-2, var(--surface-2, transparent))',
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>
      )}

      {/* ────────────────────────────────────────────────────────────────
          1. The question
          ──────────────────────────────────────────────────────────────── */}
      <section id="question" style={sectionBox}>
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
      <section id="architecture" style={sectionBox}>
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
      <section id="triggers" style={sectionBox}>
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
      <section id="composite" style={sectionBox}>
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
      <section id="regime" style={sectionBox}>
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
      <section id="thresholds" style={sectionBox}>
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
      <section id="limits" style={sectionBox}>
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
          8. Sources — auto-populated from the data registry
          ──────────────────────────────────────────────────────────────── */}
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
