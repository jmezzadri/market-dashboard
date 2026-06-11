/* MorningRead — the "Since yesterday's close" strip at the top of Macro
   Overview (Joe-approved design + provisionally blessed trigger rulebook,
   2026-06-11). Every bullet is machine-built by morningRead.js from the same
   data the tiles render — nothing hand-written, nothing forced. Split into
   Indicators and Positioning signals; each says "nothing notable" honestly.
   The flagged counter is deliberately visible so Joe can watch daily volume
   and right-size the trigger thresholds. */

import React, { useMemo } from 'react';
import { buildMorningRead } from '../lib/morningRead';
import { getWeekGrid } from '../lib/econCalendar';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nextPrints() {
  const iso = todayISO();
  const out = [];
  try {
    const grid = getWeekGrid(iso, 2).flat();
    grid.forEach((day) => {
      if (day.iso < iso) return;
      (day.events || []).forEach((e) => {
        if (out.length >= 2) return;
        const when = day.iso === iso ? 'today' : `${day.weekday} ${day.month} ${day.dayNum}`;
        out.push(`${e.short} · ${when} ${e.time.replace(' ET', '')}`);
      });
    });
  } catch {
    /* calendar unavailable — schedule line degrades to COT only */
  }
  out.push('Positioning (COT) · Sat 7:00a');
  return out.slice(0, 3);
}

function Bullets({ eyebrow, lines, quietText, overflow }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="mt-eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>
      {lines.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--mt-ink-3)', lineHeight: 1.6 }}>{quietText}</div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--mt-ink-1)', lineHeight: 1.7 }}>
          {lines.map((l, k) => (
            <div key={k} style={{ display: 'flex', gap: 7 }}>
              <span style={{ color: 'var(--mt-ink-3)' }}>•</span>
              <span>{l}</span>
            </div>
          ))}
          {overflow > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--mt-ink-3)', marginTop: 2 }}>
              +{overflow} more cleared the bar — the tiles below have them
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MorningRead({ indicators, cotPos, indexSeries }) {
  const read = useMemo(
    () => buildMorningRead({ indicators, cotPos, indexSeries }),
    [indicators, cotPos, indexSeries],
  );
  const prints = useMemo(nextPrints, []);
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (!indicators || indicators.length === 0) return null;
  return (
    <div className="mt-card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontFamily: 'var(--mt-font-display)', fontSize: 20, letterSpacing: '-0.01em' }}>
          Since yesterday's close
        </div>
        <div className="num" style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}>
          {dateLabel} · {read.printed} of {read.total} printed · {read.flagged} flagged
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px 28px', marginTop: 10 }}>
        <Bullets
          eyebrow="Indicators"
          lines={read.indicatorBullets}
          overflow={read.indicatorOverflow}
          quietText="Nothing notable since yesterday's close."
        />
        <Bullets
          eyebrow="Positioning signals"
          lines={read.positioningBullets}
          overflow={read.positioningOverflow}
          quietText={read.posFresh ? 'Fresh positioning print — nothing crossed a threshold.' : 'Awaiting next print — Sat 7:00a ET.'}
        />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--mt-ink-3)', borderTop: '1px solid var(--mt-line-0)', marginTop: 12, paddingTop: 9 }}>
        <span>Next prints:</span>
        {prints.map((p, k) => <span key={k}>{p}</span>)}
      </div>
    </div>
  );
}
