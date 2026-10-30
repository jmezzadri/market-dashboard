/* ReleaseCalendarModal — the full ten-week release calendar, opened from the
   "All N releases →" link on Home's "Upcoming data" tile.

   That link used to go to the Macro Overview page, which has never carried a
   release calendar — it was a link to nothing in particular (found while
   fixing the tile, 2026-09-10). The tile shows four days of the two top tiers;
   this is every release the feed holds, grouped by day, each one opening the
   same release detail the tile rows do. Same skin as the other Home modals. */

import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import ImpactMark from './ImpactMark';
import useScrollLock from '../lib/useScrollLock';
import useModalEscape from '../lib/useModalEscape';
import { nowET, isReleased, releaseResult } from '../lib/releaseStatus';

function weekdayLong(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export default function ReleaseCalendarModal({ open, events, todayISO, meta, onClose, onPick, impactOf, relHist, nowEt }) {
  useModalEscape(open, onClose);
  useScrollLock(open);

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
  // "Through" names the last date the list actually reaches (2026-10-29: it
  // named the feed's requested window end, Jan 8, two days past the last
  // listed release).
  const lastDate = days.length ? days[days.length - 1][0] : null;

  return createPortal(
    <div onClick={onClose} className="home-v12 briefmodal-veil">
      <div onClick={(e) => e.stopPropagation()} className="briefmodal relcal-modal" role="dialog" aria-label="Upcoming data releases">
        <button type="button" className="briefmodal-x" onClick={onClose} aria-label="Close">×</button>
        <div className="eyebrow2"><span className="dot" />Upcoming data · {count} releases{lastDate ? ` through ${weekdayLong(lastDate).replace(/^[A-Za-z]+, /, '')}` : ''}</div>
        <h2 className="briefmodal-h">Release calendar</h2>
        <p className="rel-blurb">Every scheduled US release the calendar holds, on the agencies&rsquo; own published dates. Times are Eastern. The bars grade each release&rsquo;s measured market impact — how far stocks, the 10-year and the dollar moved on its release days over the last three years against an ordinary session. Click a release for its history.</p>
        {/* What the marks mean, where they are read (2026-10-29). */}
        <p className="rel-legend">Three bars = high impact, two = medium, one = low. Hollow bars = <b>shared</b>: the release always lands on the same day as a bigger one, so its own effect cannot be separated. No bars = <b>not graded</b>: its release days have not been studied yet (the ECB, Bank of England and Bank of Japan decisions among them), or there are too few to measure.</p>
        <div className="relcal-days">
          {days.map(([date, evs]) => (
            <div key={date} className={`relcal-day${date === todayISO ? ' is-today' : ''}`}>
              <h3 className="relcal-date">{date === todayISO ? 'Today · ' : ''}{weekdayLong(date)}</h3>
              <ul className="relcal-list">
                {evs.slice().sort((a, b) => a.tier - b.tier).map((e) => {
                  const done = isReleased(e, nowEt || nowET());
                  const res = done ? releaseResult(e, relHist) : null;
                  return (
                    <li key={e.name} className={done ? 'is-done' : undefined}>
                      <button type="button" className={`cal-ev${e.tier === 1 ? ' cal-ev--major' : ''}`} onClick={() => onPick?.(e)}>
                        <span className="cal-ev-name">{e.name}</span>
                        <span className="cal-time">
                          {done ? (res ? <><span className="cal-out">{res.kind === 'print' ? 'actual ' : ''}</span><b>{res.short}</b></> : <span className="cal-out">Released</span>) : e.time_et}
                        </span>
                      </button>
                      <ImpactMark impact={impactOf?.(e.name)} />
                    </li>
                  );
                })}
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
