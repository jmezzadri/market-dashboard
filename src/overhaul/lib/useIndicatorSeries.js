/* useIndicatorSeries — lazy loader for public/indicator_history.json.

   That file is ~4.5 MB, so it is NOT fetched on page load. The Trade Idea tile
   asks for it only when a chart is about to be drawn, and the promise is cached
   at module scope so the tile chart, the modal charts and any later note all
   share ONE request per session.

   Shape (do not "fix" this): each series is
     { freq, unit, as_of, stats, points: [[isoDate, value], …] }
   points are ARRAYS, not objects. */

import { useEffect, useState } from 'react';

let cache = null;

export function loadIndicatorHistory() {
  if (!cache) {
    cache = fetch('/indicator_history.json', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

/* keys: array of series names the caller intends to draw. Returns only those,
   so a component never holds the whole 4.5 MB object in state. */
export default function useIndicatorSeries(keys) {
  const [series, setSeries] = useState(null);
  const [failed, setFailed] = useState(false);
  const want = (keys || []).filter(Boolean).join(',');

  useEffect(() => {
    if (!want) { setSeries({}); return undefined; }
    let cancelled = false;
    loadIndicatorHistory()
      .then((all) => {
        if (cancelled) return;
        const out = {};
        want.split(',').forEach((k) => { if (all[k]) out[k] = all[k]; });
        setSeries(out);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [want]);

  return { series, failed, loading: !series && !failed };
}
