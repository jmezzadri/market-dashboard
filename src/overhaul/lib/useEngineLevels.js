/* useEngineLevels — the Engine's own published MOVE lines.

   Joe, 2026-10-01, on the MOVE Index chart: "the shaded chart should anchor to
   what we're saying is Risk On, Watch and Risk Off on the Home page and Macro
   page." The chart had been shading the generic 3-year pill zones (amber from
   ~107) while the Engine — which ranks MOVE against five years of Friday
   closes — put Watch at ~116. Two yardsticks on one indicator.

   Source: /macrotilt_engine.json (stress.watch_threshold_value /
   risk_off_threshold_value), the same file the Engine card reads. Falls back
   to STRESS_THRESH, the constants the Home and Macro regime call uses.

   2026-11-17 (health sweep): the same file also carries the yield regime's
   lines (`yield_regime.inflationary_threshold_bp` / `deflationary_threshold_bp`,
   the 70th / 30th percentile of five years of Friday 3-month changes in the
   10-year). Home and Macro had drawn hard-coded +32 / -11 while the Engine
   called the regime on +37 / -6. They now read the Engine's own lines too. */

import { useEffect, useState } from 'react';
// The fallback lives here (not in useEngineRegime) because useIndicators reads
// this hook and useEngineRegime reads useIndicators — one direction only.
export const STRESS_THRESH = { watch: 116, riskOff: 124 };

let cached = null;
let pending = null;

function load() {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = fetch('/macrotilt_engine.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const w = d?.stress?.watch_threshold_value;
        const r = d?.stress?.risk_off_threshold_value;
        const yi = d?.yield_regime?.inflationary_threshold_bp;
        const yd = d?.yield_regime?.deflationary_threshold_bp;
        const yOk = Number.isFinite(yi) && Number.isFinite(yd) && yi > yd;
        if (Number.isFinite(w) && Number.isFinite(r) && r > w) {
          cached = { watch: w, riskOff: r, inflBp: yOk ? yi : null, deflBp: yOk ? yd : null, asOf: d.as_of || null };
        }
        return cached;
      })
      .catch(() => null)
      .finally(() => { pending = null; });
  }
  return pending;
}

export default function useEngineLevels() {
  const [lv, setLv] = useState(cached);
  useEffect(() => {
    let dead = false;
    load().then((v) => { if (!dead && v) setLv(v); });
    return () => { dead = true; };
  }, []);
  return lv || { watch: STRESS_THRESH.watch, riskOff: STRESS_THRESH.riskOff, inflBp: null, deflBp: null, asOf: null };
}

export function engineZone(value, lv) {
  if (value == null || !Number.isFinite(value) || !lv) return null;
  if (value >= lv.riskOff) return 'Risk Off';
  if (value >= lv.watch) return 'Watch';
  return 'Risk On';
}
