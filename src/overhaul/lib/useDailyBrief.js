/* useDailyBrief — the daily editorial brief shown in the Home left column.
   Reads /daily_brief.json, the same narrative the 7am Market Brief email
   carries (headline, stance, key news, implications, what-to-watch, the
   three section write-ups with positioning + single-name tags, and the
   prior-session movers). This is a durable daily slot: the morning brief
   routine writes this file each day, so the page stays in lockstep with the
   email and never shows a hard-coded one-day story.

   Editions (Joe, 2026-11-03): the brief has three editions a day. The
   Morning Brief is /daily_brief.json; the Midday Update
   (/midday_update.json, only on a day a gate fired at the 11:30 check) and
   the Market Close (/market_close.json) share one shape — headline, stance,
   scorecard, items, watch, plus the midday trigger and bullets or the close's
   three sections. /midday_gates.json records the 11:30 check every trading
   day, fired or not, so the tile can say "nothing tripped" on a quiet day.
   Each extra file is fetched on its own and a missing or malformed one is
   simply null — the Morning Brief never depends on them. The tile shows the
   edition with the greatest (date, written_at), so Friday's close stays up
   through the weekend and a midday update replaces the morning until the
   close posts (pickEdition). */

import { useEffect, useState } from 'react';

function fetchJson(url) {
  return fetch(url, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/* A plain object with a date is the least an edition can be; anything else
   (an HTML 404 page served as 200, an empty file) is treated as absent. */
function asEdition(d) {
  return d && typeof d === 'object' && !Array.isArray(d) && typeof d.date === 'string' ? d : null;
}

export const EDITION_LABEL = { morning: 'Morning Brief', midday: 'Midday Update', close: 'Market Close' };
const EDITION_RANK = { morning: 0, midday: 1, close: 2 };

/* The name the label line leads with: "Morning Brief" for the daily brief,
   otherwise what the edition file calls itself. */
export function editionLabel(kind, data) {
  if (kind === 'morning') return EDITION_LABEL.morning;
  return (data && typeof data.label === 'string' && data.label.trim()) || EDITION_LABEL[kind] || 'Brief';
}

function writtenMs(d) {
  const t = d?.written_at ? Date.parse(d.written_at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/* The edition to show: greatest (date, written_at) among the three; a tie
   goes to the later edition of the day. Returns {kind, data}; data is null
   when nothing has loaded (kind 'morning', so the tile renders its honest
   empty state). */
export function pickEdition(brief, editions) {
  const cands = [
    { kind: 'morning', data: asEdition(brief) },
    { kind: 'midday', data: asEdition(editions?.midday) },
    { kind: 'close', data: asEdition(editions?.close) },
  ].filter((c) => c.data);
  if (cands.length === 0) return { kind: 'morning', data: null };
  cands.sort((a, b) => {
    if (a.data.date !== b.data.date) return a.data.date < b.data.date ? 1 : -1;
    const dt = writtenMs(b.data) - writtenMs(a.data);
    if (dt !== 0) return dt;
    return EDITION_RANK[b.kind] - EDITION_RANK[a.kind];
  });
  return cands[0];
}

/* Every edition OTHER than the shown one that carries the same date, newest
   first — the modal's "Earlier today" list. */
export function sameDayEditions(shown, brief, editions) {
  if (!shown?.data) return [];
  const all = [
    { kind: 'morning', data: asEdition(brief) },
    { kind: 'midday', data: asEdition(editions?.midday) },
    { kind: 'close', data: asEdition(editions?.close) },
  ];
  return all
    .filter((c) => c.data && c.kind !== shown.kind && c.data.date === shown.data.date)
    .sort((a, b) => (writtenMs(b.data) - writtenMs(a.data)) || (EDITION_RANK[b.kind] - EDITION_RANK[a.kind]));
}

export default function useDailyBrief() {
  const [brief, setBrief] = useState(null);
  const [editions, setEditions] = useState({ midday: null, close: null });
  const [gates, setGates] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // All four land together so the tile never flashes the morning edition
    // before a later one arrives. None of the fetches can reject.
    Promise.all([
      fetchJson('/daily_brief.json'),
      fetchJson('/midday_update.json'),
      fetchJson('/market_close.json'),
      fetchJson('/midday_gates.json'),
    ]).then(([morning, midday, close, g]) => {
      if (cancelled) return;
      setBrief(morning);
      setEditions({ midday: asEdition(midday), close: asEdition(close) });
      setGates(g && typeof g === 'object' && !Array.isArray(g) ? g : null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { brief, loading, editions, gates };
}
