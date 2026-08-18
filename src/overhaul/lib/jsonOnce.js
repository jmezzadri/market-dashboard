/* jsonOnce — one in-flight fetch per URL, shared by every hook that wants the
   same JSON file.

   Why (2026-08-18): the home page mounts `useMarketLevels` for the market tape
   and, since the tape's drill modal moved onto Home, `useIndicators` too. Both
   read `/indicator_history.json`, which is ~4.9 MB. Two independent
   `fetch(..., { cache: 'no-cache' })` calls meant downloading it twice on one
   page load — `no-cache` forces a revalidation, so the browser's own cache
   could not save us.

   Contract:
   - Concurrent callers share ONE promise, so N hooks cost one request.
   - A resolved result is reused for TTL_MS, then the next caller refetches.
     The underlying files are rebuilt a few times a day; 5 minutes is far
     inside that and keeps a long-lived tab from serving yesterday's numbers.
   - A rejected fetch is NOT cached — the next caller retries. A transient
     failure must not pin an error for the life of the tab.
   - `cache: 'no-cache'` is preserved on the wire: this de-duplicates our own
     requests, it does not weaken freshness (LESSONS 0.1 — a stale number that
     looks live is the thing we are always guarding against). */

const TTL_MS = 5 * 60 * 1000;

const inflight = new Map();  // url -> Promise
const settled = new Map();   // url -> { at, value }

export default function jsonOnce(url) {
  const hit = settled.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);

  const pending = inflight.get(url);
  if (pending) return pending;

  const p = fetch(url, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      settled.set(url, { at: Date.now(), value: d });
      inflight.delete(url);
      return d;
    })
    .catch((e) => {
      inflight.delete(url);   // never cache a failure
      throw e;
    });

  inflight.set(url, p);
  return p;
}
