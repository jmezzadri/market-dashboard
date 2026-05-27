/* useEngineRegime — single source of truth for the regime call.
   Per Joe's directive 2026-05-27:
     stress_zone   = derived from MOVE (Risk On / Watch / Risk Off)
     yield_regime  = derived from 3M Δ 10y (Inflationary / Neutral / Deflationary)
   Methodology thresholds (prototype.lm-shared, methodology.jsx):
     stress: MOVE < 116 Risk On · 116-124 Watch · ≥ 124 Risk Off
     yield : 3M Δ 10y ≥ +32 bp Inflationary · ≤ -11 bp Deflationary · else Neutral

   Surfaced wherever the regime is shown — Home stat tiles, Home Engine Call
   card, Tilt hero, Tilt gauges. Never derive these inline in a page. */

import { useMemo } from 'react';
import useIndicators from './useIndicators';

const STRESS_THRESH = { watch: 116, riskOff: 124 };
const YIELD_THRESH = { inflBp: 32, deflBp: -11 };

function stressZone(moveValue) {
  if (moveValue == null || !Number.isFinite(moveValue)) return null;
  if (moveValue < STRESS_THRESH.watch) return 'Risk On';
  if (moveValue < STRESS_THRESH.riskOff) return 'Watch';
  return 'Risk Off';
}

function yieldRegime(threeMonthDeltaBp) {
  if (threeMonthDeltaBp == null || !Number.isFinite(threeMonthDeltaBp)) return null;
  if (threeMonthDeltaBp >= YIELD_THRESH.inflBp) return 'Inflationary';
  if (threeMonthDeltaBp <= YIELD_THRESH.deflBp) return 'Deflationary';
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

// Compute the 3-month rates delta in basis points from the 10y/curve series.
// Prefer real_rates (10y TIPS) → yield_curve (10-2 slope) → fall back null.
// All input series store [date, value]; values are already in their natural
// unit (TIPS in %, curve in bp). For 3M change we look ~63 trading days back.
function threeMonthDeltaBp(ind) {
  if (!ind?.points || ind.points.length < 65) return null;
  const last = ind.points[ind.points.length - 1]?.[1];
  const prev = ind.points[Math.max(0, ind.points.length - 64)]?.[1];
  if (!Number.isFinite(last) || !Number.isFinite(prev)) return null;
  const delta = last - prev;
  // real_rates / be10 are in %; multiply by 100 to get bp.
  // yield_curve / tp / move are already in bp / index points.
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

  return useMemo(() => {
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
      };
    }
    const move = active.find((i) => i.id === 'move');
    // Prefer real_rates for the yield change (10y TIPS direction is the
    // cleaner regime proxy); fall back to yield_curve.
    const yieldInd =
      active.find((i) => i.id === 'real_rates') ||
      active.find((i) => i.id === 'yield_curve') ||
      active.find((i) => i.id === 'tp');

    const moveVal = move?.value ?? null;
    const yDelta = threeMonthDeltaBp(yieldInd);
    const sZone = stressZone(moveVal);
    const yReg = yieldRegime(yDelta);

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
      stressThresholds: STRESS_THRESH,
      yieldThresholds: YIELD_THRESH,
    };
  }, [active, loading]);
}
