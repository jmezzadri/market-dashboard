import React from 'react';
import CountUp from './CountUp';
import FreshnessChip from './FreshnessChip';

/**
 * MarcusHero — drop-in replacement for the legacy RichHero, but rendered
 * in the v2 Marcus design language. Same prop surface where possible:
 *   eyebrow      — small caps line above the headline
 *   headline     — main H1 (plain)
 *   italicAccent — italic accent fragment appended in champagne
 *   italicSub    — italic sub-line below the headline
 *   stance       — small chip on the right (e.g. "RISK ON", "AWAITING SCAN")
 *   stanceColor  — "strong" (up green) | "warn" (warn) | "down" (red) | "mute"
 *   freshLine    — small sub-line under the stance chip
 *   freshChip    — { indicatorId, asOfIso } — wires the v2 FreshnessChip
 *   lead         — paragraph below the headline
 *   kpis         — array of { lbl, v, sub, col, animate?: bool, suffix?: string }
 *
 * Renders inside an existing legacy layout container without bringing the
 * full v2 page chrome — only the hero block.
 */
export default function MarcusHero({
  eyebrow, headline, italicAccent, italicSub,
  stance, stanceColor, freshLine, freshChip,
  lead, kpis,
}) {
  const stanceClass = ({
    strong: 'r-on',
    warn:   'r-cau',
    down:   'r-off',
    mute:   'r-neu',
  })[stanceColor || 'strong'] || 'r-on';

  return (
    <div className="v2-root v2-marcus-hero" style={{ padding: '36px 28px 28px', marginBottom: 14, borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line-1)', position: 'relative', overflow: 'hidden' }}>
      {/* Decorative arc — same motif as v2-hero on standalone v2 pages */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pointerEvents: 'none', opacity: 0.32 }}>
        <svg viewBox="0 0 600 400" preserveAspectRatio="xMaxYMid slice" style={{ width: '46%', height: '100%' }}>
          <g transform="translate(440 200)">
            {[60, 100, 140, 180, 220, 260, 300, 340].map((r) => (
              <circle key={r} r={r} fill="none" stroke="var(--ink-1)" strokeWidth="0.5" opacity="0.18" />
            ))}
          </g>
        </svg>
      </div>

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            <div className="t-eyebrow accent" style={{ marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-block', width: 22, height: 1, background: 'var(--accent)', opacity: 0.6 }} />
              {eyebrow}
              {freshChip && <FreshnessChip elementId={freshChip.indicatorId} fallback={freshChip.asOfIso} />}
            </div>
            <h1 style={{
              fontFamily: 'Fraunces, serif',
              fontVariationSettings: '"opsz" 144, "SOFT" 30, "wght" 400',
              fontSize: 'clamp(30px, 4vw, 44px)',
              lineHeight: 1.06,
              letterSpacing: '-0.018em',
              color: 'var(--ink-0)',
              margin: '0 0 8px',
              maxWidth: 760,
              fontFeatureSettings: '"tnum","lnum"',
            }}>
              {headline}
              {italicAccent && (
                <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>{italicAccent}</em>
              )}
            </h1>
            {italicSub && (
              <div style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                {italicSub}
              </div>
            )}
          </div>
          {(stance || freshLine) && (
            <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
              {stance && (
                <span className={`v2-pill ${stanceClass}`} style={{ padding: '6px 14px', fontSize: 11, letterSpacing: '0.10em' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                  {stance}
                </span>
              )}
              {freshLine && (
                <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, color: 'var(--ink-2)', letterSpacing: '0.04em', marginTop: 8 }}>
                  {freshLine}
                </div>
              )}
            </div>
          )}
        </div>

        {lead && (
          <p style={{ fontSize: 14, color: 'var(--ink-1)', lineHeight: 1.65, maxWidth: 980, margin: '4px 0 18px' }}>
            {lead}
          </p>
        )}

        {kpis && kpis.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {kpis.map((k, i) => {
              const colMap = {
                'var(--green-text)': 'var(--up)',
                'var(--orange-text)': 'var(--warn)',
                'var(--red-text)': 'var(--down)',
                'var(--yellow-text)': 'var(--warn)',
              };
              const col = colMap[k.col] || k.col || 'var(--ink-0)';
              return (
                <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--line-0)', borderRadius: 10, padding: '12px 16px' }}>
                  <div className="t-eyebrow" style={{ fontSize: 10, letterSpacing: '0.12em', marginBottom: 6 }}>{k.lbl}</div>
                  <div style={{
                    fontFamily: 'Fraunces, serif',
                    fontVariationSettings: '"opsz" 96, "wght" 400',
                    fontSize: 26, lineHeight: 1.1, color: col,
                    fontFeatureSettings: '"tnum","lnum"',
                  }}>
                    {k.v}
                  </div>
                  {k.sub && (
                    <div style={{ fontSize: 10.5, color: 'var(--ink-2)', marginTop: 4, letterSpacing: '0.04em' }}>
                      {k.sub}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
