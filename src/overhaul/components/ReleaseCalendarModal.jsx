/* ReleaseCalendarModal — the full ten-week release calendar, opened from the
   "All N releases →" link on Home's "Upcoming data" tile.

   That link used to go to the Macro Overview page, which has never carried a
   release calendar — it was a link to nothing in particular (found while
   fixing the tile, 2026-09-10). The tile shows four days of the two top tiers;
   this is every release the feed holds, grouped by day, each one opening the
   same release detail the tile rows do. Same skin as the other Home modals. */

import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ImpactMark from './ImpactMark';

function weekdayLong(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export default function ReleaseCalendarModal({ open, events, todayISO, meta, onClose, onPick, impactOf }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const days = useMemo(() => {
    const byDate = new Map();
    (events || []).filter((e) => e.date >= todayISO).forEach((e) => {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    });
    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [events, todayISO]);

  const target = (typeof document !== 'undefined'
    && (document.querySelector('.mt-overhaul') || document.body)) || null;
  if (!open || !target) return null;

  const count = days.reduce((n, [, evs]) => n + evs.length, 0);

  return createPortal(
    <div onClick={onClose} className="home-v12 briefmodal-veil">
      <div onClick={(e) => e.stopPropagation()} className="briefmodal relcal-modal" role="dialog" aria-label="Upcoming data releases">
        <button type="button" className="briefmodal-x" onClick={onClose} aria-label="Close">×</button>
        <div className="eyebrow2"><span className="dot" />Upcoming data · {count} releases{meta?.window?.to ? ` through ${weekdayLong(meta.window.to).replace(/^[A-Za-z]+, /, '')}` : ''}</div>
        <h2 className="briefmodal-h">Release calendar</h2>
        <p className="rel-blurb">Every scheduled US release the calendar holds, on the agencies&rsquo; own published dates. Times are Eastern. The bars grade each release&rsquo;s measured market impact — how far stocks, the 10-year and the dollar moved on its release days over the last three years against an ordinary session. Click a release for its history.</p>
        <div className="relcal-days">
          {days.map(([date, evs]) => (
            <div key={date} className={`relcal-day${date === todayISO ? ' is-today' : ''}`}>
              <h3 className="relcal-date">{date === todayISO ? 'Today · ' : ''}{weekdayLong(date)}</h3>
              <ul className="relcal-list">
                {evs.slice().sort((a, b) => a.tier - b.tier).map((e) => (
                  <li key={e.name}>
                    <button type="button" className={`cal-ev${e.tier === 1 ? ' cal-ev--major' : ''}`} onClick={() => onPick?.(e)}>
                      <span className="cal-ev-name">{e.name}</span>
                      <span className="cal-time">{e.time_et}</span>
                    </button>
                    <ImpactMark impact={impactOf?.(e.name)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {days.length === 0 && <p className="secnote">No releases are scheduled in the window the calendar holds.</p>}
        </div>
      </div>
    </div>,
    target,
  );
}
