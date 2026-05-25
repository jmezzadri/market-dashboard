import React, { useEffect, useMemo, useState } from 'react';

/**
 * MethodologyBody — MacroTilt methodology, plain-English.
 *
 * Source of truth for what is described here:
 *   src/v2/pages/MacroOverviewPage.jsx (live engine — the indicator registry,
 *     the trailing-5-year percentile math, and the quartile-band classifier:
 *     see trailingPctile(), heatColor() and heatLabel()).
 *
 * The macro engine does NOT use hard count rules ("flagged when 3 of 4
 * indicators sit in their concerning quarter"). It places each indicator by
 * where its current value sits in its OWN trailing five-year history — four
 * quartile bands — and reads stress directionally. This page describes THAT.
 *
 * Anything that names a percentile cutoff, a band color, a direction, or a
 * regime label must match the engine character-for-character. Do not
 * introduce a value here that is not produced by the engine. If the engine
 * changes, this page changes in the same PR.
 *
 * Rendered by both /#readme (default URL, legacy wrapper) and the
 * preview-URL v2 Methodology page, so the surfaces cannot drift.
 */

// ── Three-state lexicon — the labels the engine uses. ────────────────────
// A reading is placed by its trailing-five-year percentile, then read in the
// direction of stress for that series. These three labels describe where a
// reading sits — they are not count rules.
const REGIME_STATES = [
  {
    label: 'Risk On',
    cls:   'r-on',
    short: 'The reading sits in the calm quarter of its own five-year range.',
    detail: 'Where the indicator currently sits is among the calmest quarter of its last five years. Nothing here argues for taking risk off.',
  },
  {
    label: 'Watch',
    cls:   'r-cau',
    short: 'The reading has drifted into the middle or upper-middle of its five-year range.',
    detail: 'The indicator is no longer calm but not yet extreme — somewhere between the 25th and 75th percentile of its own history. Worth noting; not yet an actionable signal on its own.',
  },
  {
    label: 'Risk Off',
    cls:   'r-off',
    short: 'The reading sits in the most-elevated quarter of its own five-year range, on the Risk-Off side.',
    detail: 'The indicator is in the top quarter of its five-year history on the stress side. This is the actionable end of the scale — the reading is as elevated as it has been on only the worst one-in-four days of the last five years.',
  },
];

// ── Quartile bands — identical cutoffs to the engine. ────────────────────
// heatColor()/heatLabel() in MacroOverviewPage.jsx split each indicator's
// trailing-5y percentile at 25 / 50 / 75. For a HIGH-is-stress series the
// top quarter is Risk Off; for a LOW-is-stress series the bands invert.
const PERCENTILE_BANDS = [
  {
    band:   'Bottom quarter',
    range:  'Below the 25th percentile',
    tint:   'Green',
    call:   'Risk-On zone',
    meaning: 'On the stress side, the reading is among the calmest quarter of its own five-year history.',
  },
  {
    band:   'Lower-middle',
    range:  '25th to 50th percentile',
    tint:   'Grey',
    call:   'Neutral',
    meaning: 'Below the midpoint of its five-year range. Unremarkable — neither calm nor elevated.',
  },
  {
    band:   'Upper-middle',
    range:  '50th to 75th percentile',
    tint:   'Amber',
    call:   'Cautionary',
    meaning: 'Above the midpoint and drifting toward the Risk-Off end of the range. Worth watching.',
  },
  {
    band:   'Top quarter',
    range:  'Above the 75th percentile',
    tint:   'Red',
    call:   'Risk-Off zone',
    meaning: 'On the stress side, the reading is among the most elevated quarter of its own five-year history.',
  },
];

// ── The five indicator domains — identical to the engine panels. ─────────
const INDICATOR_DOMAINS = [
  {
    domain: 'Rates',
    reads:  'How the bond market is pricing duration, real yields and policy uncertainty.',
    examples: 'The 10-year-minus-2-year yield curve, the 10-year real yield, bond volatility, the term premium, and 10-year breakeven inflation.',
  },
  {
    domain: 'Credit',
    reads:  'What lenders are charging to take on borrower risk.',
    examples: 'High-yield and investment-grade option-adjusted spreads, the high-yield-to-investment-grade ratio, and the Senior Loan Officer survey on tightening standards.',
  },
  {
    domain: 'Equities',
    reads:  'How richly stocks are priced and how much crash protection the options market is buying.',
    examples: 'The Buffett indicator, the Shiller CAPE, the VIX, the SKEW tail-risk index, and the equity-credit correlation.',
  },
  {
    domain: 'Money & Banking',
    reads:  'How loose or tight financial plumbing and bank balance sheets are.',
    examples: 'The commercial-paper spread, the Chicago and St. Louis financial-conditions indices, the KBW Bank-to-S&P ratio, bank-credit growth, and the Fed balance sheet.',
  },
  {
    domain: 'Economy',
    reads:  'Whether the real economy is firming or softening.',
    examples: 'Initial jobless claims, ISM Manufacturing, the JOLTS quits rate, the copper-to-gold ratio, the broad dollar, and the Chicago Fed activity index.',
  },
];

// ── Direction of stress — three reading types in the engine. ─────────────
// Mirrors the dir flag in the engine registry: 'hw' (high warns), 'lw' (low
// warns), 'neutral' (range-only — no good/bad direction).
const DIRECTION_TYPES = [
  {
    type:  'High readings warn',
    plain: 'For these series a high reading is the Risk-Off reading. The top quarter of the five-year range is the Risk-Off zone, the bottom quarter is the Risk-On zone.',
    examples: 'The VIX, bond volatility, credit spreads, the Chicago Fed financial-conditions index, and initial jobless claims.',
  },
  {
    type:  'Low readings warn',
    plain: 'For these series a low reading is the Risk-Off reading. The bands invert — the bottom quarter is the Risk-Off zone and the top quarter is the Risk-On zone.',
    examples: 'The yield curve, the copper-to-gold ratio, the KBW Bank-to-S&P ratio, bank-credit growth, and ISM Manufacturing.',
  },
  {
    type:  'Range-only',
    plain: 'A handful of series have no inherent good or bad direction. They are still placed against their five-year range, but shown as position-in-range only — no Risk-On or Risk-Off call is attached.',
    examples: 'Breakeven inflation, the equity-credit correlation, the commercial-paper spread, and the broad dollar index.',
  },
];

// ── Limitations — honest limits of the percentile-band approach. ─────────
const LIMITATIONS = [
  {
    head: 'It does not call entries or bottoms.',
    body: 'The framework answers one question: when the backdrop looks elevated enough to take chips off the table. It is silent on when to put them back. A separate decision rule (not this page) governs re-entry.',
  },
  {
    head: 'A five-year window has a memory, and it forgets.',
    body: 'Every indicator is ranked against its own trailing five years. That keeps each reading calibrated to the market we actually have — but it also means a long calm stretch resets what "elevated" means. After several quiet years, a reading that would have looked benign mid-crisis can land in the top quarter simply because the recent baseline is so low.',
  },
  {
    head: 'Quartile placement is relative, not absolute.',
    body: 'A reading in the top quarter is extreme relative to its own recent history — not necessarily extreme in absolute terms. In a structurally low-volatility era the top quarter can still be a calm absolute level. The bands tell you where a series sits versus itself; they do not claim a universal danger line.',
  },
  {
    head: 'Indicators are read one at a time.',
    body: 'Each indicator is placed in its own band independently. The page deliberately does not collapse the twenty-six readings into a single score or fire a regime label off a count of how many sit in the top quarter. The reader sees the spread of evidence and weighs it; the page does not weigh it for them.',
  },
  {
    head: 'Quarterly and survey series move in steps.',
    body: 'Some inputs — the Senior Loan Officer survey, ISM, JOLTS — update monthly or quarterly. Their band can sit unchanged for weeks and then jump a full quartile on a single release. A daily series and a quarterly series share the same band scale but not the same responsiveness.',
  },
  {
    head: 'History depth varies across indicators.',
    body: 'The trailing-five-year window is the same length for every series, but some series only have a few years of clean public history to begin with. Where the underlying record is short, the percentile rank is computed on fewer observations and is correspondingly less stable.',
  },
];

// ── Sections shown in the jump-nav. ──────────────────────────────────────
// Anchors point at section IDs in the body. They are NOT URL-hash anchors —
// clicking a chip calls scrollToSection(id) which jumps the viewport without
// touching window.location.hash (the site's tab router watches the hash and
// would swallow any unknown value back to the Home tab).
const SECTIONS = [
  // Group 1 — Macro Overview
  { id: 'mo-question',   label: 'Macro Overview · the question', group: 'Macro Overview' },
  { id: 'mo-approach',   label: 'How a reading is placed' },
  { id: 'mo-bands',      label: 'The four quartile bands' },
  { id: 'mo-direction',  label: 'Which way is stress' },
  { id: 'mo-domains',    label: 'The five indicator domains' },
  { id: 'mo-regime',     label: 'Reading the bands' },
  { id: 'mo-window',     label: 'Why a five-year window' },
  { id: 'mo-limits',     label: 'What this does not do' },
  // Group 2 — the rest of the site
  { id: 'asset-tilt',    label: 'Asset Tilt',           group: 'Other pages' },
  { id: 'trading-opps',  label: 'Trading Opportunities' },
  { id: 'portfolio',     label: 'Portfolio Insights' },
  { id: 'scenarios',     label: 'Scenario Analysis' },
  // Group 3 — registry
  { id: 'sources',       label: 'Where the data comes from', group: 'Sources' },
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

// Swatch dot for the band tint table — matches the chart tint palette:
// green Risk-On, grey Neutral, amber Cautionary, red Risk-Off.
const TINT_SWATCH = {
  Green: '#10B981',
  Grey:  '#64748B',
  Amber: '#F59E0B',
  Red:   '#D946C4',
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
          MACRO OVERVIEW — sections 1 through 8 cover the Macro Overview
          page (the indicator backdrop and its calibrated percentile bands).
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
        <div style={eyebrow}>The question this page answers</div>
        <h2 style={h2}>When does the backdrop look elevated.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          MacroTilt is built for an investor who is almost always fully invested in equities. The operational question is not when to buy — it is when the macro backdrop has stretched far enough to think about taking risk off. The Macro Overview page answers it by reading a panel of indicators against their own recent history.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          It is not a buy signal, and it does not call entries, bottoms, or "buy the dip" moments. It is a backdrop read: for each indicator, how stretched is today&rsquo;s reading versus where that same indicator has been over the last five years.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          2. How a reading is placed
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-approach" style={sectionBox}>
        <div style={eyebrow}>The approach</div>
        <h2 style={h2}>Every reading is placed against its own history.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          There are no hard count rules on this page — nothing fires because "three of four indicators" did something. Instead, each indicator is placed by where its current value sits inside its <strong>own</strong> trailing five-year distribution. The output for every indicator is a single percentile: the share of the last five years that indicator spent at a lower reading than today.
        </p>
        <ul style={{ ...body, paddingLeft: 22, marginTop: 8 }}>
          <li style={{ marginBottom: 8 }}>
            A reading near the bottom of its five-year range lands at a <strong>low percentile</strong>.
          </li>
          <li style={{ marginBottom: 8 }}>
            A reading near the top of its five-year range lands at a <strong>high percentile</strong>.
          </li>
          <li>
            A reading near the middle lands near the <strong>50th percentile</strong>.
          </li>
        </ul>
        <p style={{ ...body, marginTop: 14 }}>
          Because every indicator is scored against itself, indicators measured in completely different units — a volatility index, a credit spread in basis points, a ratio — become directly comparable. An indicator at its 80th percentile is equally stretched whatever its units. The percentile is the common scale.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          3. The four quartile bands
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-bands" style={sectionBox}>
        <div style={eyebrow}>The calibration</div>
        <h2 style={h2}>Four quartile bands, calibrated to each indicator.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          Each indicator&rsquo;s five-year percentile is split into four quartile bands at the 25th, 50th and 75th percentiles. The bands are the same tints used to tint every chart on the site, so the band an indicator sits in is legible at a glance without reading the axis.
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Quartile band</th>
            <th style={th}>Where the reading sits</th>
            <th style={th}>Chart tint</th>
            <th style={th}>The call (on the stress side)</th>
            <th style={th}>What it means</th>
          </tr></thead>
          <tbody>
            {PERCENTILE_BANDS.map((b) => (
              <tr key={b.band}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>{b.band}</td>
                <td style={td}>{b.range}</td>
                <td style={td}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span style={{
                      width: 11, height: 11, borderRadius: '50%',
                      background: TINT_SWATCH[b.tint], flexShrink: 0, opacity: 0.9,
                    }} />
                    {b.tint}
                  </span>
                </td>
                <td style={{ ...td, fontWeight: 600 }}>{b.call}</td>
                <td style={td}>{b.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...body, marginTop: 14 }}>
          So the chart tint legend reads directly off the bands: <strong>green</strong> is the Risk-On zone (the calm quarter), <strong>grey</strong> is neutral, <strong>amber</strong> is cautionary, and <strong>red</strong> is the Risk-Off zone (the elevated quarter). Same four bands, whether you are reading a number, a band label, or a tinted chart.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          4. Which way is stress
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-direction" style={sectionBox}>
        <div style={eyebrow}>Direction of stress</div>
        <h2 style={h2}>For some series, high is bad; for others, low is.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          A high percentile is not automatically bad news. Whether the top quarter is the Risk-Off zone or the Risk-On zone depends on which direction means stress for that particular series. Every indicator is tagged one of three ways.
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Reading type</th>
            <th style={th}>How the bands work</th>
            <th style={th}>Examples</th>
          </tr></thead>
          <tbody>
            {DIRECTION_TYPES.map((d) => (
              <tr key={d.type}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>{d.type}</td>
                <td style={td}>{d.plain}</td>
                <td style={td}>{d.examples}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...body, marginTop: 14 }}>
          The percentile is computed the same way for every indicator. The direction tag only decides which end of the five-year range gets painted as the Risk-Off zone — so a low-warns series like the yield curve flips the bands, and its <em>bottom</em> quarter is the red Risk-Off zone.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          5. The five indicator domains
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-domains" style={sectionBox}>
        <div style={eyebrow}>The panel</div>
        <h2 style={h2}>Twenty-six indicators across five domains.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          The Macro Overview page groups its indicators into five domains. Each indicator within a domain is placed in its own quartile band; the domain grouping is for legibility, not for any scoring step.
        </p>
        <table style={tableBase}>
          <thead><tr>
            <th style={th}>Domain</th>
            <th style={th}>What it reads</th>
            <th style={th}>Indicators include</th>
          </tr></thead>
          <tbody>
            {INDICATOR_DOMAINS.map((d) => (
              <tr key={d.domain}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--ink-0, var(--text, #000))' }}>{d.domain}</td>
                <td style={td}>{d.reads}</td>
                <td style={td}>{d.examples}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...body, marginTop: 14 }}>
          Every weekday the underlying history refreshes, the trailing five-year window slides forward, and each indicator&rsquo;s percentile and band are recomputed against the new window. Nothing is set by hand — the bands drift as the market evolves.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          6. Reading the bands
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-regime" style={sectionBox}>
        <div style={eyebrow}>Reading the page</div>
        <h2 style={h2}>One band per indicator — read the spread.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          Each indicator carries one of three calls, taken straight from the quartile band it sits in on the stress side of its range.
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
          The page deliberately stops there. It does not collapse the panel into a single headline regime or fire a label off a count of how many indicators sit in the top quarter. The reader sees the spread of evidence — how many domains are in the Risk-Off zone, how many are still calm — and weighs it. A worked example: High-Yield OAS, a high-warns credit series, recently sat near the 12th percentile of its trailing five-year range. That is the bottom quarter, so its chart paints green and the indicator reads Risk On — credit spreads are about as calm as they have been on all but the quietest one-in-eight days of the last five years.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          7. Why a five-year window
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-window" style={sectionBox}>
        <div style={eyebrow}>How the bands stay current</div>
        <h2 style={h2}>A trailing five-year window, sliding daily.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          Two decisions sit behind every band on this page:
        </p>
        <ul style={{ ...body, paddingLeft: 22, marginTop: 8 }}>
          <li style={{ marginBottom: 10 }}>
            <strong>The same quartile cutoffs for every indicator.</strong> All twenty-six indicators are split at the 25th, 50th and 75th percentiles of their own history. That makes the bands like-for-like — a top-quarter reading is equally rare for each indicator regardless of its absolute units.
          </li>
          <li>
            <strong>A trailing five-year window.</strong> Funding markets, bond behavior and equity volatility all shift across a decade. Ranking against a rolling five-year window keeps each band calibrated to today&rsquo;s market rather than to a structural era that has already ended. The window slides forward one day every weekday, and the bands re-calibrate with it.
          </li>
        </ul>
        <p style={{ ...body, marginTop: 14 }}>
          The trade-off is honest: a five-year window has a memory, and it forgets. After a long calm stretch the baseline drops, and a reading that would once have looked ordinary can land in the top quarter simply because the recent past was so quiet. The bands tell you where a series sits versus its own recent self — not against an all-time danger line.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          8. What this does not do
          ──────────────────────────────────────────────────────────────── */}
      <section id="mo-limits" style={sectionBox}>
        <div style={eyebrow}>What this page will not do</div>
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
      </section>

      {/* Trading Opportunities */}
      <section id="trading-opps" style={sectionBox}>
        <div style={eyebrow}>Trading Opportunities</div>
        <h2 style={h2}>Specific names to act on today.</h2>
        <p style={{ ...body, marginTop: 14 }}>
          The Trading Opportunities page is the actionable end of the funnel. The Macro Overview tells you the backdrop; the Asset Tilt tells you how to lean by sector; Trading Opportunities turns that lean into <strong>specific tickers</strong>. It is an end-of-day screener — it runs once after the close and publishes a daily buy list of individual stocks worth a closer look.
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
          The Scenario Analysis page runs a shock through the macro factor panel and tells you how your portfolio, the Asset Tilt recommendation, and each macro indicator move in response. Two flavors: <strong>historical scenarios</strong> (the GFC, COVID, Volmageddon, the 2022 rate-hike cycle, and several others) replay the actual shock through today's factor structure; <strong>bespoke shocks</strong> let you pin one or more factors at a chosen size of move and propagate the rest using historical correlations.
        </p>
        <p style={{ ...body, marginTop: 14 }}>
          The page returns a portfolio-level profit-and-loss estimate, a per-position breakdown of which holdings move most under that shock, and the updated Asset Tilt recommendation the engine would produce in that scenario.
        </p>
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
        MacroTilt methodology · {sources.length} source vendors · {Object.keys(manifest?.elements || {}).length} registered data elements
      </div>
    </div>
  );
}
