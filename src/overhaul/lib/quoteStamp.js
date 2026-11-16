/* quoteStamp — the words that sit beside an intraday quote.

   "live" is a claim about the SESSION (LESSONS 4.32) AND about the quote
   keeping up with the clock. A quote is stamped live only when the vendor's
   own quote time keeps pace with the moment we asked for it; when it trails
   by more than DELAYED_AFTER_MS it is a DELAYED feed and says so, with the
   time of the quote it actually shows.

   2026-11-09 weekly check: the Russell 2000 on the free feed runs ~15 minutes
   behind the other three US indexes, and the banner read "live 12:33 pm"
   beside "live 12:48 pm". The same stamp is used by the banner and the index
   detail panel so the two can never disagree (LESSONS 4.5). */

export const DELAYED_AFTER_MS = 3 * 60 * 1000;

export function stampLive(ts, fetchedAt) {
  const d = ts ? new Date(ts) : null;
  if (!d || !Number.isFinite(d.getTime())) return 'live';
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).toLowerCase();
  const f = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const delayed = Number.isFinite(f) && f - d.getTime() > DELAYED_AFTER_MS;
  return `${delayed ? 'delayed' : 'live'} ${t}`;
}
