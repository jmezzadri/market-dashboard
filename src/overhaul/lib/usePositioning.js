/* usePositioning — the COT positioning extremes shown on Home and Macro.
   Reads the public brief-positioning edge feed (the same one the 7am brief
   uses): cot.domains{} each with extremes[] carrying a market name and a
   plain-English lean. We flatten to the strongest few and classify each as a
   "washed out · contrarian floor" (specs gone) or "crowded · contrarian
   warning" (specs piled in). */

import { useEffect, useState } from 'react';

const FEED = 'https://yqaqqzseepebrocgibcw.supabase.co/functions/v1/brief-positioning';

function classify(lean) {
  const s = (lean || '').toLowerCase();
  if (s.includes('wash') || s.includes('contrarian-bull') || s.includes('floor')) return 'wash';
  if (s.includes('crowd') || s.includes('contrarian-bear') || s.includes('piled')) return 'crowd';
  return null;
}

export default function usePositioning() {
  const [rows, setRows] = useState(null);
  const [asOf, setAsOf] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(FEED, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setAsOf(d?.cot?.as_of || null);
        const out = [];
        const domains = d?.cot?.domains || {};
        Object.values(domains).forEach((dom) => {
          (dom.extremes || []).forEach((e) => {
            const lean = classify(e.lean);
            if (!lean) return;
            out.push({
              market: e.market,
              lean,
              label: lean === 'wash' ? 'Washed out · contrarian floor' : 'Crowded · contrarian warning',
              rank: Math.abs((e.spec_pctile ?? 50) - 50) + (e.divergence ? 25 : 0),
            });
          });
        });
        out.sort((a, b) => b.rank - a.rank);
        // De-dupe by market, keep strongest, cap at 4.
        const seen = new Set();
        const top = [];
        for (const r of out) { if (seen.has(r.market)) continue; seen.add(r.market); top.push(r); if (top.length === 4) break; }
        setRows(top);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return { rows, asOf };
}
