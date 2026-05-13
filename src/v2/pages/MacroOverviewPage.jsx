import React from 'react';

/**
 * Macro Overview — wired to the approved clickable mockup at
 * /macro_overview_mockup.html. Renders the mockup inside an iframe at the
 * native /#overview URL so the live page shows the new design immediately.
 *
 * Full React port (six click patterns, dynamic charts, full regime history
 * modal, same-percentile-band episodes) is tracked under bug #1192. The
 * underlying calibration foundation issue is bug #1191 — both must clear
 * before this page reads live data; until then the mockup carries sample
 * data that demonstrates the design.
 */
export default function MacroOverviewPage() {
  return (
    <div style={{ width: '100%', height: 'calc(100vh - 80px)', overflow: 'hidden' }}>
      <iframe
        src="/macro_overview_mockup.html"
        title="Macro Overview"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          background: 'var(--bg, #fafaf7)',
        }}
      />
    </div>
  );
}
