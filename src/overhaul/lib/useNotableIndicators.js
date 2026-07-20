/* useNotableIndicators — the homepage "Macro indicators" selection rule.
   Joe (2026-07-07): the homepage list is NOT a fixed set. Surface what a PM
   should know about: every non-deprecated indicator that is either
     (a) at a 3-year extreme — its site-wide percentile pill (pct, the same
         3-yr basis every pill uses) at >= 95 or <= 5, or
     (b) just printed an outsized move FOR ITS OWN CADENCE — the latest
         print-over-print change is >= 2.5 standard deviations from that
         indicator's own 3-yr distribution of print-over-print changes
         (daily series compare day moves, weekly compare week moves, monthly
         compare month moves — never a "single day" assumption).
   Ranked by severity = max(|pct-50|/50, |z|/3). Display cap 8 with a
   "more at extremes" count. Calibrated 2026-07-07 over the trailing 500
   sessions: median 14 qualify/day, min 4, max 27, zero empty days — the
   section always has content and the cap keeps it scannable.
   Senior Quant sign-off in PR. Reuses useIndicators' pct so this list can
   never disagree with the pills (one shared computation). */

import { useMemo } from 'react';
import useIndicators from './useIndicators';

const SHORT_FAMILY = {
  equity: 'Equities', credit: 'Credit', bank: 'Credit', rates: 'Rates',
  fincond: 'Fin Cond.', labor: 'Econ', commodities: 'Commod.', fx: 'FX',
};
const EXT_HI = 95, EXT_LO = 5, Z_BIG = 2.5, SHOW = 8;

export default function useNotableIndicators() {
  const { loading, indicators } = useIndicators();

  return useMemo(() => {
    if (loading || !Array.isArray(indicators)) return { loading, rows: [], moreCount: 0 };
    const rows = [];
    for (const ind of indicators) {
      if (ind.deprecated || !Array.isArray(ind.points) || ind.points.length < 21) continue;
      if (ind.pct == null || !Number.isFinite(ind.value)) continue;
      const vals = ind.points.map((p) => p[1]).filter((v) => v != null && Number.isFinite(v));
      if (vals.length < 21) continue;
      const chg = [];
      for (let i = 1; i < vals.length; i += 1) chg.push(vals[i] - vals[i - 1]);
      const lastChg = chg[chg.length - 1];
      const mean = chg.reduce((a, b) => a + b, 0) / chg.length;
      const sd = Math.sqrt(chg.reduce((a, b) => a + (b - mean) * (b - mean), 0) / chg.length) || 1e-9;
      const z = (lastChg - mean) / sd;
      const atExtreme = ind.pct >= EXT_HI || ind.pct <= EXT_LO;
      const bigMove = Math.abs(z) >= Z_BIG;
      if (!atExtreme && !bigMove) continue;
      const atMax = ind.pct >= 99.5, atMin = ind.pct <= 0.5;
      rows.push({
        id: ind.id,
        name: ind.name,
        family: SHORT_FAMILY[ind.familyId] || ind.familyLabel || '',
        value: ind.value,
        decimals: ind.decimals,
        unit: ind.unit,
        freq: ind.freq || 'D',
        lastChg,
        pct: ind.pct,
        // why-label: extremes win the label; big moves label as such
        why: atMax ? '3-yr high' : atMin ? '3-yr low'
          : atExtreme ? `${Math.round(ind.pct)}th %ile · 3-yr`
          : 'Outsized move',
        severity: Math.max(Math.abs(ind.pct - 50) / 50, Math.abs(z) / 3),
      });
    }
    rows.sort((a, b) => b.severity - a.severity);
    return { loading: false, rows: rows.slice(0, SHOW), moreCount: Math.max(0, rows.length - SHOW) };
  }, [loading, indicators]);
}
