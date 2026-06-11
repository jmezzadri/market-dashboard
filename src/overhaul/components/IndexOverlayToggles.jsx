/* IndexOverlayToggles — S&P 500 / Nasdaq / Dow overlay chips shared by the
   indicator and positioning detail panels on Macro Overview (and the All
   Indicators drill). Each chip toggles one index line on the chart and
   carries its own freshness dot — the three index feeds are registered
   manifest elements (market-spx_index-daily / market-ndx_index-daily /
   market-dji_index-daily) produced by the daily indicator-history refresh.
   Theme tokens only; no hardcoded colors (light/dark/navy safe). */

import React from 'react';
import FreshnessChip from './FreshnessChip';

export default function IndexOverlayToggles({ series = [], on = {}, onToggle }) {
  if (!series.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--mt-ink-2)' }}>
      <span>Add index to chart:</span>
      {/* Same .mt-pillgroup chrome as the timeframe buttons so these read as
          buttons, not a legend — Joe couldn't tell they were clickable
          (2026-06-10). Multi-select: each pill toggles independently. */}
      <div className="mt-pillgroup">
        {series.map((s) => {
          const active = !!on[s.key];
          return (
            <button
              key={s.key}
              type="button"
              className={`mt-pill ${active ? 'on' : ''}`}
              onClick={() => onToggle(s.key)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title={active ? `Remove ${s.label} from the chart` : `Draw ${s.label} on the chart (indexed — scales differ)`}
            >
              <span style={{ width: 12, height: 0, borderTop: `2px dashed ${s.color}`, display: 'inline-block' }} />
              {s.label}
              <FreshnessChip elementId={s.elementId} fallback={{ asOfIso: s.asOf }} variant="dot" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
