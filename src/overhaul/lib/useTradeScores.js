/* useTradeScores — the scorer's output (public/trade_idea_scores.json) keyed
   by idea id, for the surfaces that show a call's schedule outside the
   Scorecard page (the homepage card and the full note). One shared fetch per
   page life (jsonOnce). */

import { useEffect, useMemo, useState } from 'react';
import jsonOnce from './jsonOnce';

export default function useTradeScores(enabled = true) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    jsonOnce('/trade_idea_scores.json')
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [enabled]);
  const byId = useMemo(() => {
    const m = new Map();
    (data?.scores || []).forEach((r) => { if (r?.id) m.set(r.id, r); });
    return m;
  }, [data]);
  return { byId, loading: enabled && !data && !failed, failed };
}
