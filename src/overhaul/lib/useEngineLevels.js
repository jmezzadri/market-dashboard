/* useEngineLevels — the Engine's own published MOVE lines.

   Joe, 2026-10-01, on the MOVE Index chart: "the shaded chart should anchor to
   what we're saying is Risk On, Watch and Risk Off on the Home page and Macro
   page." The chart had been shading the generic 3-year pill zones (amber from
   ~107) while the Engine — which ranks MOVE against five years of Friday
   closes — put Watch at ~116. Two yardsticks on one indicator.

   Source: /macrotilt_engine.json (stress.watch_threshold_value /
   risk_off_threshold_value), the same file the Engine card reads. Falls back
   to STRESS_THRESH, the constants the Home and Macro regime call uses. */

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
        if (Number.isFinite(w) && Number.isFinite(r) && r > w) {
          cached = { watch: w, riskOff: r, asOf: d.as_of || null };
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
  return lv || { watch: STRESS_THRESH.watch, riskOff: STRESS_THRESH.riskOff, asOf: null };
}

export function engineZone(value, lv) {
  if (value == null || !Number.isFinite(value) || !lv) return null;
  if (value >= lv.riskOff) return 'Risk Off';
  if (value >= lv.watch) return 'Watch';
  return 'Risk On';
}
