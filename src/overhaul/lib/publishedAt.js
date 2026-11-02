/* One reading of "when was this note published", used by the Home tile, the
   note itself and the Scorecard rows, so every surface prints the same date.

   A note carries two dates: `date`, the research day the note is written for,
   and `published_at`, the moment it actually went out (stamped by the
   publisher, UTC). The reader sees the second one: the 2026-08-24 note went
   out on Aug 26 and was marked from the Aug 25 close, and "Published Aug 24 ·
   marked from the Aug 25 close" read as a chronology error on the 2026-11-02
   check. Shown with its time, the entry close is visibly the last close
   before publication. A note with no stamp falls back to its date. */

const ET = 'America/New_York';

function parse(obj) {
  const ts = obj?.published_at ? String(obj.published_at) : '';
  if (!ts) return null;
  const d = new Date(/[Z+-]/.test(ts.slice(10)) ? ts : `${ts}Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/* "Aug 26, 2026" — or "Aug 26, 2026, 6:59 am ET" with withTime. */
export function publishedLabel(obj, { withTime = false, weekday = false, fallback = null } = {}) {
  const d = parse(obj);
  if (!d) return fallback;
  const date = d.toLocaleDateString('en-US', {
    ...(weekday ? { weekday: 'short' } : {}), month: 'short', day: 'numeric', year: 'numeric', timeZone: ET,
  });
  if (!withTime) return date;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET }).toLowerCase();
  return `${date}, ${time} ET`;
}
