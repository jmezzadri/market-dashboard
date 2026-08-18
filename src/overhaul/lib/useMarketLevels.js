/* useMarketLevels — raw access to the indicator history file for the market
   LEVELS the Home ribbon and Macro-Indicators tile show (S&P, 10Y, ¥/$,
   Copper, …). These live in indicator_history.json but are not all in the
   indicator REGISTRY that useIndicators filters to, so the ribbon reads them
   straight from the source file. Every value carries its own as-of date and a
   day-over-day change computed from the last two stored points — so the page
   leads with the CHANGE, per the brief design rules. */

import { useEffect, useState } from 'react';
import jsonOnce from './jsonOnce';

export default function useMarketLevels() {
  const [hist, setHist] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Shared with useIndicators — the home page mounts both and the file is
    // ~4.9 MB, so this must not be two requests (jsonOnce, 2026-08-18).
    jsonOnce('/indicator_history.json')
      .then((d) => { if (!cancelled) setHist(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // level(key) -> { value, asOf, dd } | null. dd = last stored print minus the
  // one before it, in the series' native unit.
  const level = (key) => {
    const h = hist?.[key];
    const pts = h?.points;
    if (!Array.isArray(pts) || !pts.length) return null;
    const last = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const value = Number(last?.[1]);
    if (!Number.isFinite(value)) return null;
    const dd = prev && Number.isFinite(Number(prev[1])) ? value - Number(prev[1]) : null;
    return { value, asOf: last?.[0] || h?.as_of || null, dd, unit: h?.unit || '' };
  };

  return { level, loaded: !!hist };
}
