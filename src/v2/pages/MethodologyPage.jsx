import React from 'react';
import FreshnessChip from '../components/FreshnessChip';
import MethodologyBody from '../components/MethodologyBody';

/**
 * MethodologyPage v2 — Signal Intelligence rewrite.
 *
 * The page body lives in MethodologyBody so the legacy /#readme route and the
 * v2 preview route stay in sync. This page is the v2 hero + body sandwich.
 */
export default function MethodologyPageV2() {
  return (
    <div className="v2-root">
      <header className="v2-hero">
        <div className="arc" aria-hidden="true">
          <svg viewBox="0 0 600 600" preserveAspectRatio="xMaxYMid slice">
            <g transform="translate(420 300)">
              {[60, 100, 140, 180, 220, 260, 300, 340].map((r) => <circle key={r} r={r} />)}
            </g>
          </svg>
        </div>
        <div className="v2-shell">
          <div className="v2-hero-row">
            <div>
              <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>Methodology.</h1>
              <p className="t-body" style={{ marginTop: 14, maxWidth: '62ch' }}>
                How MacroTilt reads the market. One question — when to take chips off the table — answered with two layers of evidence and one regime label.
              </p>
            </div>
            <FreshnessChip elementId="indicator_history" fallback={null} />
          </div>
        </div>
      </header>

      <div className="v2-shell" style={{ marginTop: 24 }}>
        <MethodologyBody />
      </div>
    </div>
  );
}
