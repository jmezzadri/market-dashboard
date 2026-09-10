/* useEconReleaseHistory — the prints-and-nowcasts feed behind the release
   modal on Home's "Upcoming data" tile.

   Reads /econ_release_history.json, rebuilt twice a day by
   scripts/build_econ_release_history.py right after the calendar itself: for
   every release the calendar names, three years of actual prints (FRED,
   current vintage) and — where a free, public, NAMED forecaster covers it —
   the nowcast for the print that has not landed yet (Cleveland Fed for
   inflation, Atlanta Fed GDPNow for GDP, fed funds futures for the FOMC).

   Fetched lazily: the file is ~65 KB and Home does not need it until a
   release is actually clicked. One fetch per page life; every modal after the
   first opens instantly. */

import { useEffect, useState } from 'react';

let cache = null;
let inflight = null;

function load() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('/econ_release_history.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { cache = d; return d; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export default function useEconReleaseHistory(enabled) {
  const [data, setData] = useState(cache);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || data) return undefined;
    let cancelled = false;
    load()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [enabled, data]);

  return { data, failed, loading: enabled && !data && !failed };
}
