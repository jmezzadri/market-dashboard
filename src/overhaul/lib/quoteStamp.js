/* quoteStamp — the words that sit beside an intraday quote.

   "live" is a claim about the SESSION (LESSONS 4.32) AND about the quote
   keeping up with the clock. A quote is stamped live only when the vendor's
   own quote time keeps pace with the moment we asked for it; when it trails
   by more than DELAYED_AFTER_MS it is a DELAYED feed and says so, with the
   time of the quote it actually shows.

   2026-11-09 weekly check: the Russell 2000 on the free feed runs ~15 minutes
   behind the other three US indexes, and the banner read "live 12:33 pm"
   beside "live 12:48 pm". The same stamp is used by the banner and the index
   detail panel so the two can never disagree (LESSONS 4.5).

   2026-11-23 weekly check: for its first fifteen minutes of a session the
   delayed Russell quote is still the PREVIOUS session's last print, so its
   pop-up read "▲ 0.8% today" on Monday morning for Friday's move. A quote
   whose own time is not in today's New York day is that earlier day's close
   and is named by its weekday — never "live", "delayed" or "today". */

export const DELAYED_AFTER_MS = 3 * 60 * 1000;

const NY = 'America/New_York';
const nyDay = (d) => d.toLocaleDateString('en-CA', { timeZone: NY });

/* Which session a quote belongs to, read off the quote's own time.
   { today, weekday: 'Fri', weekdayLong: 'Friday' } — null when there is no
   usable time. `now` is injectable so the rule can be tested. */
export function quoteSession(ts, now = Date.now()) {
  const d = ts ? new Date(ts) : null;
  if (!d || !Number.isFinite(d.getTime())) return null;
  return {
    today: nyDay(d) === nyDay(new Date(now)),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: NY }),
    weekdayLong: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: NY }),
  };
}

export function stampLive(ts, fetchedAt, now = Date.now()) {
  const s = quoteSession(ts, now);
  if (!s) return 'live';
  if (!s.today) return `${s.weekday} close`;
  const d = new Date(ts);
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: NY }).toLowerCase();
  const f = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const delayed = Number.isFinite(f) && f - d.getTime() > DELAYED_AFTER_MS;
  return `${delayed ? 'delayed' : 'live'} ${t}`;
}
