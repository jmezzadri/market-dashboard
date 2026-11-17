/* useEngineRegime — single source of truth for the regime call.
   Per Joe's directive 2026-05-27:
     stress_zone   = derived from MOVE (Risk On / Watch / Risk Off)
     yield_regime  = derived from 3M Δ 10y (Inflationary / Neutral / Deflationary)
   Methodology thresholds (prototype.lm-shared, methodology.jsx):
     stress: MOVE < 116 Risk On · 116-124 Watch · ≥ 124 Risk Off
     yield : 3M Δ 10y ≥ +32 bp Inflationary · ≤ -11 bp Deflationary · else Neutral

   2026-11-17 (health sweep): the dial read "10Y · 3-month change +51bp"
   while the 10-year had moved +40bp. The number was the 10-year TIPS (real)
   yield's change, under a label — and a click-through chart — for the
   nominal 10-year, and was ranked against hard-coded +32 / -11 lines while the
   Engine (FRED DGS10, 13 weeks) called the regime on its own +37 / -6. Now:
   the series is the nominal 10-year (`ust_10y`, the Treasury curve the tape
   shows; same yields as DGS10), the change is measured over 91 calendar days
   exactly as the Engine's daily headline is, and every line comes from
   /macrotilt_engine.json (useEngineLevels), the constants below being only
   the fallback when that file cannot be read.

   Surfaced wherever the regime is shown — Home stat tiles, Home Engine Call
   card, Tilt hero, Tilt gauges. Never derive these inline in a page. */

import { useMemo } from 'react';
import useIndicators from './useIndicators';
import useEngineLevels, { STRESS_THRESH } from './useEngineLevels';

export { STRESS_THRESH };
// Fallback only — the live lines come from the Engine file (see above).
export const YIELD_THRESH = { inflBp: 32, deflBp: -11 };

function stressZone(moveValue, t) {
  if (moveValue == null || !Number.isFinite(moveValue)) return null;
  if (moveValue < t.watch) return 'Risk On';
  if (moveValue < t.riskOff) return 'Watch';
  return 'Risk Off';
}

function yieldRegime(threeMonthDeltaBp, t) {
  if (threeMonthDeltaBp == null || !Number.isFinite(threeMonthDeltaBp)) return null;
  if (threeMonthDeltaBp >= t.inflBp) return 'Inflationary';
  if (threeMonthDeltaBp <= t.deflBp) return 'Deflationary';
  return 'Neutral';
}

function colorForStress(zone) {
  if (zone === 'Risk On') return 'var(--mt-up)';
  if (zone === 'Watch') return 'var(--mt-warn)';
  if (zone === 'Risk Off') return 'var(--mt-down)';
  return 'var(--mt-ink-2)';
}

function colorForYield(regime) {
  if (regime === 'Inflationary') return 'var(--mt-warn)';
  if (regime === 'Deflationary') return 'var(--mt-up)';
  return 'var(--mt-ink-2)';
}

// 3-month change in the 10-year, in bp: the latest close minus the close on
// or before the date 91 calendar days earlier — the Engine's own daily
// headline (compute_macrotilt_engine.py, delta_y_3m_bp_live). Series values
// in % are converted to bp.
function threeMonthDeltaBp(ind) {
  const pts = ind?.points;
  if (!pts || pts.length < 65) return null;
  const [lastDate, last] = pts[pts.length - 1] || [];
  if (!Number.isFinite(last) || !lastDate) return null;
  const anchor = new Date(`${lastDate}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - 91);
  const anchorIso = anchor.toISOString().slice(0, 10);
  let prev = null;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i]?.[0] <= anchorIso && Number.isFinite(pts[i]?.[1])) { prev = pts[i][1]; break; }
  }
  if (prev == null) return null;
  const delta = last - prev;
  const unit = (ind.unit || '').toLowerCase();
  if (unit === '%') return delta * 100;
  return delta;
}

// Percentile of MOVE in its own 5y distribution
function percentileOf(ind) {
  return ind?.pct ?? null;
}

export default function useEngineRegime() {
  const { active, loading } = useIndicators();
  const lv = useEngineLevels();

  return useMemo(() => {
    // Lines: the Engine's own (raw values for the call, as useIndicators'
    // engineZone does; whole numbers for display), constants as fallback.
    const stressT = { watch: lv.watch, riskOff: lv.riskOff };
    const yieldT = Number.isFinite(lv.inflBp) && Number.isFinite(lv.deflBp)
      ? { inflBp: lv.inflBp, deflBp: lv.deflBp }
      : YIELD_THRESH;
    const stressShow = { watch: Math.round(stressT.watch), riskOff: Math.round(stressT.riskOff) };
    const yieldShow = { inflBp: Math.round(yieldT.inflBp), deflBp: Math.round(yieldT.deflBp) };
    if (loading || !active?.length) {
      return {
        loading: true,
        move: null,
        stressZone: null,
        stressColor: 'var(--mt-ink-2)',
        yieldDeltaBp: null,
        yieldRegime: null,
        yieldColor: 'var(--mt-ink-2)',
        regimeLabel: '—',
        sleeveMix: null,
        stressThresholds: stressShow,
        yieldThresholds: yieldShow,
      };
    }
    const move = active.find((i) => i.id === 'move');
    // The nominal 10-year — the series the label, the click-through chart and
    // the Engine all mean. (Until 2026-11-17 this read the 10-year TIPS.)
    const yieldInd = active.find((i) => i.id === 'ust_10y') || null;

    const moveVal = move?.value ?? null;
    const yDelta = threeMonthDeltaBp(yieldInd);
    const sZone = stressZone(moveVal, stressT);
    const yReg = yieldRegime(yDelta, yieldT);

    // Sleeve mix per the methodology grid: only fires when stress ≥ Watch.
    const sleeveMix =
      sZone === 'Risk On'
        ? null
        : yReg === 'Inflationary'
          ? { gold: 12, tlt: 9, cash: 4 }
          : { gold: 4, tlt: 16, cash: 5 };

    return {
      loading: false,
      // Stress
      move: moveVal,
      movePct: percentileOf(move),
      moveInd: move || null,
      stressZone: sZone,
      stressColor: colorForStress(sZone),
      // Yield
      yieldInd: yieldInd || null,
      yieldDeltaBp: yDelta,
      yieldPct: percentileOf(yieldInd),
      yieldRegime: yReg,
      yieldColor: colorForYield(yReg),
      // Combined
      regimeLabel: [sZone, yReg].filter(Boolean).join(' · ') || '—',
      sleeveMix,
      // Thresholds (so pages can render legend numbers consistently)
      stressThresholds: stressShow,
      yieldThresholds: yieldShow,
    };
  }, [active, loading, lv]);
}
