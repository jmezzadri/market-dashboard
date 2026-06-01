/* useCotPositioning — observation-only read of futures-market crowding from
   the weekly CFTC Commitments of Traders (COT) report.

   For seven published markets the backend has already computed each watch
   group's net position as a % of open interest, ranked into that group's OWN
   trailing-3-year percentile (0 = most bearish in 3yr, 100 = most bullish).
   The long/short SIGN is discarded on purpose — several groups sit in
   permanent structural positions, so only the percentile + z-score carry
   signal. This hook reads those pre-computed stats out of the shared
   indicator_history.json (same file useIndicators reads) and shapes them for
   the COT surfaces.

   OBSERVATION MODE ONLY — this feeds no score and makes no buy/sell or
   predictive claim. A forward-return backtest is pending.

   Returns:
     {
       loading,
       rows,      // one per present cot_ key, sorted extremes-first then |z|
       extremes,  // rows.filter(isExtreme)
       asOf,      // max as_of across rows
     }
   where each row is:
     { key, market, group, label, netPctOi, pctile3yr, z3yr,
       direction, isExtreme, read, points, asOf }
*/

import { useEffect, useMemo, useState } from 'react';

// The seven published COT markets, in a stable display order. The hook
// tolerates any of these being absent from the history file.
const COT_KEYS = [
  'cot_spx_lev',
  'cot_spx_am',
  'cot_jpy_lev',
  'cot_vix_lev',
  'cot_gold_mm',
  'cot_wti_mm',
  'cot_dxy_noncomm',
];

export default function useCotPositioning() {
  const [hist, setHist] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/indicator_history.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setHist(d); setLoaded(true); } })
      .catch(() => { if (!cancelled) { setHist(null); setLoaded(true); } });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    if (!hist) return [];
    const out = [];
    COT_KEYS.forEach((key) => {
      const h = hist[key];
      if (!h || !h.stats) return;
      const s = h.stats;
      const label = s.label || key;
      // label looks like "S&P 500 · Hedge Funds" — split market · group.
      const partsRaw = String(label).split(' · ');
      const market = partsRaw[0] || label;
      const group = partsRaw.length > 1 ? partsRaw.slice(1).join(' · ') : '';
      out.push({
        key,
        market,
        group,
        label,
        netPctOi: typeof s.net_pct_oi === 'number' ? s.net_pct_oi : null,
        pctile3yr: typeof s.pctile_3yr === 'number' ? s.pctile_3yr : null,
        z3yr: typeof s.z_3yr === 'number' ? s.z_3yr : null,
        direction: s.direction || null,
        isExtreme: s.is_extreme === true,
        read: s.read || '',
        points: Array.isArray(h.points) ? h.points : [],
        asOf: h.as_of || null,
      });
    });

    // Extremes first, then by descending magnitude of the z-score so the most
    // stretched markets sit at the top.
    out.sort((a, b) => {
      if (a.isExtreme !== b.isExtreme) return a.isExtreme ? -1 : 1;
      const az = Math.abs(a.z3yr ?? 0);
      const bz = Math.abs(b.z3yr ?? 0);
      return bz - az;
    });
    return out;
  }, [hist]);

  const extremes = useMemo(() => rows.filter((r) => r.isExtreme), [rows]);

  const asOf = useMemo(() => {
    let max = null;
    rows.forEach((r) => {
      if (r.asOf && (max == null || r.asOf > max)) max = r.asOf;
    });
    return max;
  }, [rows]);

  return {
    loading: !loaded,
    rows,
    extremes,
    asOf,
  };
}

export { COT_KEYS };
