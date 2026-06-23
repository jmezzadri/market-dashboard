/* useDailyBrief — the daily editorial brief shown in the Home left column.
   Reads /daily_brief.json, the same narrative the 7am Market Brief email
   carries (headline, stance, key news, implications, what-to-watch, the
   three section write-ups with positioning + single-name tags, and the
   prior-session movers). This is a durable daily slot: the morning brief
   routine writes this file each day, so the page stays in lockstep with the
   email and never shows a hard-coded one-day story. */

import { useEffect, useState } from 'react';

export default function useDailyBrief() {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/daily_brief.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setBrief(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { brief, loading };
}
