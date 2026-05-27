/* Shared placeholder hero for the 9 page surfaces shipping in PR-O1.
   Each page replaces this with real content in its own PR. */

import React from 'react';
import FreshnessChip from '../components/FreshnessChip';

export default function Stub({ eyebrow, title, accent, deck, phaseLabel = 'Foundation shipped — real content in next PR' }) {
  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">{eyebrow}</div>
          <h1 className="mt-h1">
            {title.before}
            {accent && <i>{accent}</i>}
            {title.after}
          </h1>
          {deck && <p className="mt-deck">{deck}</p>}
        </div>
        <div className="mt-card" style={{ minWidth: 220, maxWidth: 280 }}>
          <div className="mt-eyebrow" style={{ marginBottom: 8 }}>Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FreshnessChip elementId="universe-master-daily" variant="dot" />
            <span style={{ fontSize: 13, color: 'var(--mt-ink-1)' }}>{phaseLabel}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
