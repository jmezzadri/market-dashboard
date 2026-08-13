/* useEconCalendar — the economic release calendar behind Home's "Upcoming
   data" tile and the Macro week strip.

   Reads /econ_calendar.json, rebuilt every morning by
   scripts/build_econ_calendar.py off the agencies' own published schedules
   (FRED's release calendar for BLS / BEA / Census / Federal Reserve, the
   Board's FOMC calendar, and ISM's 1st-and-3rd-business-day rule).

   It replaces src/overhaul/lib/econCalendar.js, a hand-typed array whose last
   entry was 2026-07-31 — so from 2026-08-01 the tile read "No scheduled
   releases coming up." every single day, including the morning PPI printed.
   A calendar that has to be re-typed each month is wrong most months.

   Contract note: events carry NO reference period. The release calendar gives
   the date a report lands, not the month it covers, and that lag is not
   uniform across releases — a derived "(Jul)" would be wrong for a whole class
   of them. See the header of build_econ_calendar.py. */

import { useEffect, useMemo, useState } from 'react';

export default function useEconCalendar({ maxTier = 2, limit = 7 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/econ_calendar.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const todayISO = useMemo(() => {
    // ET date, so a release "today" stays today until the US session rolls.
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
  }, []);

  // Group forward events by date so one row = one day, which is how the tile
  // reads. Only releases at or above the requested importance tier.
  const days = useMemo(() => {
    const evs = (data?.events || []).filter((e) => e.date >= todayISO && e.tier <= maxTier);
    const byDate = new Map();
    evs.forEach((e) => {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    });
    return [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, limit)
      .map(([date, events]) => ({
        date,
        isToday: date === todayISO,
        // The earliest time on the day is the one that matters for planning.
        time: events[0]?.time_et || '',
        topTier: Math.min(...events.map((e) => e.tier)),
        events,
      }));
  }, [data, todayISO, maxTier, limit]);

  return { days, all: data?.events || [], meta: data, todayISO, loading, failed };
}
