/* usePositioning — the COT positioning extremes shown on Home and Macro.
   Reads the same-origin /cot_positioning.json the rest of the site uses (the
   edge feed blocks browser requests). Each domain carries markets[] with a
   speculator percentile `spec` (0 = specs fully washed out, 100 = specs fully
   crowded) and a `div` flag (specs and hedgers at opposite extremes). We keep
   only genuine extremes and classify each as a "washed out · contrarian floor"
   (specs gone) or "crowded · contrarian warning" (specs piled in), then show
   the strongest few. */

import { useEffect, useState } from 'react';

const WASH_AT = 15;   // spec percentile at/below = washed out
const CROWD_AT = 85;  // spec percentile at/above = crowded

// Plain-English display names where the raw market name reads like jargon.
const NAME = { '3M SOFR': 'Short rates (SOFR)', 'High-yield bonds': 'HY bonds' };

export default function usePositioning() {
  const [rows, setRows] = useState(null);
  const [asOf, setAsOf] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/cot_positioning.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setAsOf(d.as_of || null);
        const out = [];
        Object.values(d.domains || {}).forEach((dom) => {
          (dom.markets || []).forEach((m) => {
            const s = m.spec;
            if (s == null || !Number.isFinite(s)) return;
            const lean = s <= WASH_AT ? 'wash' : s >= CROWD_AT ? 'crowd' : null;
            if (!lean) return;
            out.push({
              market: NAME[m.market] || m.market,
              rawMarket: m.market,
              lean,
              label: lean === 'wash' ? 'Washed out · contrarian floor' : 'Crowded · contrarian warning',
              // Rank by extremity (distance from neutral 50), tiny tiebreak for
              // a spec/hedger divergence so it never overrides a bigger extreme.
              rank: Math.abs(s - 50) + (m.div ? 0.5 : 0),
            });
          });
        });
        out.sort((a, b) => b.rank - a.rank);
        const seen = new Set();
        const top = [];
        for (const r of out) { if (seen.has(r.market)) continue; seen.add(r.market); top.push(r); if (top.length === 4) break; }
        setRows(top);
      })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  return { rows, asOf };
}
